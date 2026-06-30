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
const NORMAL_QUERY_UPSTREAM_LIMIT = 16;
const SHORT_QUERY_PER_VERSION_CAP = 20;
const NORMAL_QUERY_PER_VERSION_CAP = 10;

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

    if (searchCache.has(cacheKey)) {
      const cached = searchCache.get(cacheKey);
      return res.json({
        data: cached,
        cached: true,
        meta: {
          fallbackLimit: FALLBACK_LIMIT,
          grouped: true
        }
      });
    }

    try {
      const results = [];
      let apiCallCount = 0;
      const queryWordCount = cleanedQuery.split(/\s+/).filter(Boolean).length;
      const isShortQuery = queryWordCount <= 2;
      const upstreamLimit = isShortQuery ? SHORT_QUERY_UPSTREAM_LIMIT : NORMAL_QUERY_UPSTREAM_LIMIT;
      const perVersionCap = isShortQuery ? SHORT_QUERY_PER_VERSION_CAP : NORMAL_QUERY_PER_VERSION_CAP;

      for (const [bibleId, abbreviation] of Object.entries(APPROVED_BIBLES)) {
        if (apiCallCount >= MAX_TOTAL_API_CALLS) break;

        const fallbackQueries = buildFallbackQueries(cleanedQuery, FALLBACK_LIMIT);
        const versionResults = [];
        const seenIds = new Set();

        for (const fallbackQuery of fallbackQueries) {
          if (apiCallCount >= MAX_TOTAL_API_CALLS) break;

          try {
            const url = `${API_BASE}/bibles/${encodeURIComponent(bibleId)}/search?query=${encodeURIComponent(fallbackQuery)}&limit=${upstreamLimit}`;
            const response = await fetchImpl(url, { headers: { 'api-key': apiKey } });
            apiCallCount += 1;

            if (!response.ok) continue;

            const json = await response.json();
            const items = Array.isArray(json.data)
              ? json.data
              : json.data?.verses || json.data?.passages || [];

            for (const item of items) {
              const id = item.id || item.verseId || item.reference || `${item.chapterId}:${item.text || item.content || ''}`;
              if (seenIds.has(id)) continue;
              seenIds.add(id);

              const text = (item.text || item.content || '').trim();
              const score = scoreMatch(cleanedQuery, text);
              if (score < MIN_DISPLAY_SCORE) continue;

              versionResults.push({
                version: abbreviation,
                bibleId,
                reference: item.reference || item?.passage?.display || item?.passage?.reference || 'Unknown reference',
                text,
                verseId: item.id || item.verseId || '',
                chapterId: item.chapterId || '',
                score
              });
            }
          } catch (err) {
            console.error(`Error searching ${abbreviation} with fallback '${fallbackQuery}':`, err.message);
          }

          if (versionResults.length >= perVersionCap) break;
        }

        versionResults.sort((a, b) => b.score - a.score);
        results.push(...versionResults.slice(0, perVersionCap));
      }

      const deduped = dedupeResults(results).sort((a, b) => b.score - a.score);
      const grouped = groupResultsAcrossVersions(deduped);

      searchCache.set(cacheKey, grouped);
      return res.json({
        data: grouped,
        cached: false,
        meta: {
          grouped: true,
          fallbackLimit: FALLBACK_LIMIT,
          totalApiCalls: apiCallCount,
          totalGroups: grouped.length
        }
      });
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
