const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const {
  APPROVED_BIBLES,
  FALLBACK_LIMIT,
  MAX_TOTAL_API_CALLS,
  MIN_DISPLAY_SCORE,
  cleanSearchInput,
  cleanVerseText,
  normalizeText,
  buildFallbackQueries,
  validateQuery,
  scoreMatch,
  dedupeResults,
  groupResultsAcrossVersions
} = require('./search-core');

const API_BASE = 'https://api.scripture.api.bible/v1';
const API_KEY = process.env.SCRIPTURE_API_KEY;
const PORT = process.env.PORT || 3000;
const SHORT_QUERY_UPSTREAM_LIMIT = 40;
const NORMAL_QUERY_UPSTREAM_LIMIT = 40;
const SHORT_QUERY_PER_VERSION_CAP = 20;
const NORMAL_QUERY_PER_VERSION_CAP = 10;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_STALE_MS = 2 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 500;

if (!API_KEY) {
  console.warn('WARNING: SCRIPTURE_API_KEY is not set. API requests will fail.');
}

function createApp(options = {}) {
  const app = express();
  const apiKey = options.apiKey || API_KEY;
  const fetchImpl = options.fetchImpl || fetch;

  const searchCache = new Map();
  const chapterCache = new Map();
  const ipRequestCounts = new Map();

  const RATE_LIMIT = 30;
  const RATE_WINDOW_MS = 60 * 1000;

  function sanitizeSearchPayload(payload) {
    if (!payload || !Array.isArray(payload.data)) return payload;

    return {
      ...payload,
      data: payload.data.map((item) => ({
        ...item,
        text: cleanVerseText(item.text || ''),
        variants: Array.isArray(item.variants)
          ? item.variants.map((variant) => ({
              ...variant,
              text: cleanVerseText(variant.text || '')
            }))
          : item.variants
      }))
    };
  }

  function isLikelyReferenceQuery(query) {
    if (!query) return false;

    const cleaned = cleanSearchInput(query).toLowerCase().replace(/\s+/g, ' ').trim();
    return /^(?:[1-3]\s+)?[a-z][a-z'’.-]*(?:\s+[a-z][a-z'’.-]*)*\s+\d+:\d+(?:-\d+)?$/.test(cleaned);
  }

  function isLikelyVerseTextQuery(query) {
    if (!query || isLikelyReferenceQuery(query)) return false;

    const cleaned = normalizeText(cleanSearchInput(query));
    if (!cleaned) return false;

    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.length >= 6;
  }

  function filterExactReferenceResults(results, query) {
    if (!isLikelyReferenceQuery(query) || !Array.isArray(results) || results.length === 0) {
      return { results, exactMatchType: '' };
    }

    const normalizedQuery = normalizeText(cleanSearchInput(query));
    const exactMatches = results.filter((item) => normalizeText(item.reference || '') === normalizedQuery);

    return exactMatches.length > 0
      ? { results: exactMatches, exactMatchType: 'reference' }
      : { results, exactMatchType: '' };
  }

  function filterExactVerseTextResults(results, query) {
    if (!isLikelyVerseTextQuery(query) || !Array.isArray(results) || results.length === 0) {
      return { results, exactMatchType: '' };
    }

    const normalizedQuery = normalizeText(cleanSearchInput(query));
    const exactPhraseMatches = results.filter((item) => {
      const normalizedText = normalizeText(item.text || '');
      return normalizedText.includes(normalizedQuery) || normalizedQuery.includes(normalizedText);
    });

    if (exactPhraseMatches.length > 0) {
      return { results: exactPhraseMatches, exactMatchType: 'verse-text' };
    }

    if (results.length === 1) {
      return { results, exactMatchType: 'verse-text' };
    }

    const [topResult, secondResult] = results;
    if (topResult && topResult.score >= 90 && (!secondResult || topResult.score - secondResult.score >= 20)) {
      return { results: [topResult], exactMatchType: 'verse-text' };
    }

    return { results, exactMatchType: '' };
  }

  function checkRateLimit(ip) {
    const now = Date.now();
    const record = ipRequestCounts.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };

    if (now > record.resetAt) {
      ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }

    if (record.count >= RATE_LIMIT) {
      return false;
    }

    record.count += 1;
    ipRequestCounts.set(ip, record);
    return true;
  }

  function setSearchCacheEntry(key, payload) {
    const entry = {
      payload,
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      staleUntil: Date.now() + SEARCH_CACHE_STALE_MS,
      refreshing: false
    };

    if (searchCache.has(key)) {
      searchCache.delete(key);
    }
    searchCache.set(key, entry);

    if (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldestKey = searchCache.keys().next().value;
      searchCache.delete(oldestKey);
    }
  }

  function getSearchCacheState(key) {
    const entry = searchCache.get(key);
    if (!entry) {
      return { state: 'miss' };
    }

    const now = Date.now();
    if (now <= entry.expiresAt) {
      // refresh insertion order (LRU-like behavior)
      searchCache.delete(key);
      searchCache.set(key, entry);
      return { state: 'fresh', entry };
    }

    if (now <= entry.staleUntil) {
      searchCache.delete(key);
      searchCache.set(key, entry);
      return { state: 'stale', entry };
    }

    searchCache.delete(key);
    return { state: 'miss' };
  }

  async function runSearchQuery(cleanedQuery) {
    const results = [];
    const queryWordCount = cleanedQuery.split(/\s+/).filter(Boolean).length;
    const isShortQuery = queryWordCount <= 2;
    const upstreamLimit = isShortQuery ? SHORT_QUERY_UPSTREAM_LIMIT : NORMAL_QUERY_UPSTREAM_LIMIT;
    const perVersionCap = isShortQuery ? SHORT_QUERY_PER_VERSION_CAP : NORMAL_QUERY_PER_VERSION_CAP;

    const fallbackQueries = buildFallbackQueries(cleanedQuery, FALLBACK_LIMIT);

    async function searchSingleVersion([bibleId, abbreviation]) {
      const versionResults = [];
      const seenIds = new Set();
      let versionApiCalls = 0;

      for (const fallbackQuery of fallbackQueries) {
        try {
          const url = `${API_BASE}/bibles/${encodeURIComponent(bibleId)}/search?query=${encodeURIComponent(fallbackQuery)}&limit=${upstreamLimit}`;
          const response = await fetchImpl(url, { headers: { 'api-key': apiKey } });
          versionApiCalls += 1;

          if (!response.ok) continue;

          const json = await response.json();
          const items = Array.isArray(json.data)
            ? json.data
            : json.data?.verses || json.data?.passages || [];

          for (const item of items) {
            const id = item.id || item.verseId || item.reference || `${item.chapterId}:${item.text || item.content || ''}`;
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            const text = cleanVerseText(item.text || item.content || '');
            const reference = item.reference || item?.passage?.display || item?.passage?.reference || 'Unknown reference';
            const score = scoreMatch(cleanedQuery, text, reference);
            if (score < MIN_DISPLAY_SCORE) continue;

            versionResults.push({
              version: abbreviation,
              bibleId,
              reference,
              text,
              verseId: item.id || item.verseId || '',
              chapterId: item.chapterId || '',
              score
            });
          }
        } catch (err) {
          console.error(`Error searching ${abbreviation} with fallback '${fallbackQuery}':`, err.message);
        }

        versionResults.sort((a, b) => b.score - a.score);
        const strongHits = versionResults.filter((item) => item.score >= 95).length;

        if (strongHits >= 3 || versionResults.length >= perVersionCap) {
          break;
        }
      }

      return {
        apiCalls: versionApiCalls,
        results: versionResults.slice(0, perVersionCap)
      };
    }

    const versionResults = await Promise.all(Object.entries(APPROVED_BIBLES).map(searchSingleVersion));
    const apiCallCount = versionResults.reduce((sum, item) => sum + item.apiCalls, 0);

    versionResults.forEach((item) => {
      results.push(...item.results);
    });

    const deduped = dedupeResults(results).sort((a, b) => b.score - a.score);
    const groupedResults = groupResultsAcrossVersions(deduped);
    const verseTextFilter = filterExactVerseTextResults(groupedResults, cleanedQuery);
    const referenceFilter = filterExactReferenceResults(verseTextFilter.results, cleanedQuery);
    const grouped = referenceFilter.results;
    const exactMatchType = referenceFilter.exactMatchType || verseTextFilter.exactMatchType || '';

    return {
      data: grouped,
      cached: false,
      meta: {
        grouped: true,
        fallbackLimit: FALLBACK_LIMIT,
        totalApiCalls: apiCallCount,
        totalGroups: grouped.length,
        exactMatchType,
        cacheStatus: 'miss'
      }
    };
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/search', async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const { query } = req.query;
    const validation = validateQuery(query);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const cleanedQuery = cleanSearchInput(query.trim());
    const cacheKey = `search:${normalizeText(cleanedQuery)}`;

    const cacheState = getSearchCacheState(cacheKey);
    if (cacheState.state === 'fresh') {
      const cachedPayload = sanitizeSearchPayload(cacheState.entry.payload);
      return res.json({
        ...cachedPayload,
        cached: true,
        meta: {
          ...cachedPayload.meta,
          cacheStatus: 'hit'
        }
      });
    }

    if (cacheState.state === 'stale') {
      const staleEntry = cacheState.entry;
      if (!staleEntry.refreshing) {
        staleEntry.refreshing = true;
        runSearchQuery(cleanedQuery)
          .then((freshPayload) => {
            setSearchCacheEntry(cacheKey, freshPayload);
          })
          .catch((err) => {
            console.error(`Background cache refresh failed for '${cleanedQuery}':`, err.message);
          })
          .finally(() => {
            const entry = searchCache.get(cacheKey);
            if (entry) {
              entry.refreshing = false;
            }
          });
      }

      const stalePayload = staleEntry.payload;
      const sanitizedStalePayload = sanitizeSearchPayload(stalePayload);
      return res.json({
        ...sanitizedStalePayload,
        cached: true,
        meta: {
          ...sanitizedStalePayload.meta,
          cacheStatus: 'stale'
        }
      });
    }

    try {
      const payload = sanitizeSearchPayload(await runSearchQuery(cleanedQuery));
      setSearchCacheEntry(cacheKey, payload);
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: `Search failed: ${error.message}` });
    }
  });

  app.get('/api/chapters/:bibleId/:chapterId', async (req, res) => {
    const { bibleId, chapterId } = req.params;

    if (!APPROVED_BIBLES[bibleId]) {
      return res.status(400).json({ error: 'Invalid Bible ID' });
    }

    const cacheKey = `chapter:${bibleId}:${chapterId}`;
    if (chapterCache.has(cacheKey)) {
      return res.json({ data: chapterCache.get(cacheKey), cached: true });
    }

    try {
      const url = `${API_BASE}/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(chapterId)}`;
      const response = await fetchImpl(url, { headers: { 'api-key': apiKey } });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Chapter not found' });
      }

      const json = await response.json();
      const content = json.data?.content || '';
      chapterCache.set(cacheKey, content);
      return res.json({ data: content, cached: false });
    } catch (error) {
      return res.status(500).json({ error: `Chapter fetch failed: ${error.message}` });
    }
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Production server running at http://localhost:${PORT}`);
    console.log(`Serving from: ${path.join(__dirname, 'public')}`);
  });
}

module.exports = { createApp };
