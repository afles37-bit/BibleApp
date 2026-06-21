// API requests are proxied through the local dev server at /api
const API_BASE = '/api';
const TARGET_VERSIONS = {
  'a81b73293d3080c9-01': 'AMP',
  'de4e12af7f28f599-02': 'engKJV',
  'd6e14a625393b4da-01': 'NLT'
};

// Error logging and statistics
const errorLog = {
  errors: [],
  maxErrors: 50,
  add(type, message, details = {}) {
    this.errors.push({
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    });
    if (this.errors.length > this.maxErrors) {
      this.errors.shift(); // Keep only recent errors
    }
    console.error(`[${type}] ${message}`, details);
  },
  getStats() {
    const stats = {};
    this.errors.forEach(error => {
      stats[error.type] = (stats[error.type] || 0) + 1;
    });
    return stats;
  },
  clear() {
    this.errors = [];
  }
};

// User-friendly error message mapping
function getUserFriendlyMessage(error, context = '') {
  if (!error) return 'An unexpected error occurred.';
  
  const message = error.message || String(error);
  
  // Network errors
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Unable to connect to the server. Please check your internet connection.';
  }
  
  // API errors
  if (message.includes('403') || message.includes('Forbidden')) {
    return 'Access denied. The API key may be invalid or expired.';
  }
  if (message.includes('404') || message.includes('Not found')) {
    return 'The requested resource was not found.';
  }
  if (message.includes('500') || message.includes('Internal Server')) {
    return 'The server encountered an error. Please try again in a moment.';
  }
  if (message.includes('timeout')) {
    return 'Request took too long. Please try again.';
  }
  
  // Parse errors
  if (message.includes('JSON') || message.includes('parse')) {
    return 'Failed to process the response. Please try again.';
  }
  
  // Default: return original if it's already user-friendly
  return message;
}

// Retry with exponential backoff for transient failures
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
  const backoff = (attempt) => Math.min(1000 * Math.pow(2, attempt), 5000);
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Don't retry on client errors (4xx), only on server errors (5xx) and network issues
      if (response.ok) {
        return response;
      }
      
      // Retry on 429 (rate limited) or 5xx errors
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const waitTime = backoff(attempt);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      
      // Don't retry other errors
      return response;
    } catch (error) {
      // Retry on network errors (e.g., connection timeout)
      if (attempt < maxRetries) {
        const waitTime = backoff(attempt);
        console.warn(`Attempt ${attempt + 1} failed, retrying in ${waitTime}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
}

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const statusNode = document.getElementById('status');
const resultsNode = document.getElementById('results');
const searchButton = document.getElementById('search-button');
const clearButton = document.getElementById('clear-button');
const inputClear = document.getElementById('input-clear');

let bibleVersions = [];
const chapterCache = new Map();
const searchCache = new Map();
let allResults = [];
let currentResultOffset = 0;
const RESULTS_PER_PAGE = 5;

async function fetchBibleVersions() {
  try {
    setStatus('Loading available versions...', false);
    const response = await fetchWithRetry(`${API_BASE}/bibles`);
    if (!response.ok) {
      throw new Error(`Version lookup failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    const versions = Array.isArray(json.data) ? json.data : [];
    bibleVersions = versions
      .filter((version) => TARGET_VERSIONS[version.id])
      .map((version) => ({
        id: version.id,
        name: version.name,
        abbreviation: TARGET_VERSIONS[version.id]
      }));

    if (bibleVersions.length === 0) {
      throw new Error('Could not find the requested Bible versions from the API.');
    }

    setStatus(`Ready. Searching ${bibleVersions.map((v) => v.abbreviation).join(', ')}.`, false);
  } catch (error) {
    errorLog.add('VERSION_LOOKUP', 'Failed to fetch Bible versions', { error: error.message });
    const friendlyMessage = getUserFriendlyMessage(error, 'version lookup');
    setStatus(`Error: ${friendlyMessage}`, true);
  }
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

// Utility functions are now loaded from utils.js
// (normalizeText, cleanSearchInput, stemSearchWord, buildFallbackQueries, scoreMatch)

function highlightQuery(text, query) {
  const cleanedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!cleanedQuery) return text;
  const regex = new RegExp(`(${cleanedQuery})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

async function fetchSearchResults(versionId, query, limit = 8) {
  try {
    const url = `${API_BASE}/bibles/${versionId}/search?query=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`Search failed for version ${versionId}: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (Array.isArray(json.data)) {
      return json.data;
    }
    if (json.data && Array.isArray(json.data.verses)) {
      return json.data.verses;
    }
    if (json.data && Array.isArray(json.data.passages)) {
      return json.data.passages;
    }
    return [];
  } catch (error) {
    errorLog.add('SEARCH_FETCH', `Failed to fetch search results for version ${versionId}`, { 
      query, 
      error: error.message 
    });
    throw error;
  }
}

async function searchBibleVersion(versionId, query) {
  const cacheKey = `${versionId}|${query}`;
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  let results = await fetchSearchResults(versionId, query);
  if (results.length > 0) {
    searchCache.set(cacheKey, results);
    return results;
  }

  const fallbackQueries = buildFallbackQueries(query);
  const seenIds = new Set();
  const combinedResults = [];

  for (const fallbackQuery of fallbackQueries) {
    if (normalizeText(fallbackQuery) === normalizeText(query)) continue;

    try {
      const items = await fetchSearchResults(versionId, fallbackQuery, 8);
      items.forEach((item) => {
        const id = item.id || `${item.reference}|${item.text}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          combinedResults.push(item);
        }
      });
      if (combinedResults.length >= 8) {
        break;
      }
    } catch (e) {
      // Continue to next fallback query
    }
  }

  searchCache.set(cacheKey, combinedResults);
  return combinedResults;
}

async function fetchChapterContent(bibleId, chapterId) {
  // Defensive: validate inputs
  if (!bibleId || !chapterId) {
    errorLog.add('CHAPTER_FETCH', 'Invalid chapter parameters', { bibleId, chapterId });
    throw new Error('Invalid bibleId or chapterId for chapter fetch');
  }

  const cacheKey = `${bibleId}:${chapterId}`;
  if (chapterCache.has(cacheKey)) {
    return chapterCache.get(cacheKey);
  }

  try {
    const url = `${API_BASE}/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(chapterId)}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`Chapter fetch failed for ${chapterId}: ${response.status} ${response.statusText}`);
    }

    let html = '';
    try {
      const json = await response.json();
      html = json.data?.content || '';
    } catch (parseError) {
      errorLog.add('CHAPTER_PARSE', 'Failed to parse chapter JSON', { 
        chapterId, 
        error: parseError.message 
      });
      throw new Error('Failed to parse chapter content from API');
    }

    chapterCache.set(cacheKey, html);
    return html;
  } catch (error) {
    errorLog.add('CHAPTER_FETCH', `Failed to fetch chapter ${chapterId}`, { 
      bibleId, 
      chapterId, 
      error: error.message 
    });
    throw error;
  }
}

function parseResult(item, versionName, query) {
  // Defensive: safely extract fields with fallbacks
  if (!item || typeof item !== 'object') {
    console.warn('Invalid item passed to parseResult:', item);
    return null;
  }

  const text = item.text || item.content || item.passages || '';
  const reference = item.reference || item?.passage?.reference || item?.passage?.display || item?.id || 'Unknown reference';
  
  // Defensive: check for required fields for chapter viewing
  const bibleId = item.bibleId || null;
  const chapterId = item.chapterId || null;
  
  return {
    version: versionName,
    bibleId,
    chapterId,
    verseId: item.id || '',
    reference,
    text: String(text).trim(),
    score: scoreMatch(query, text)
  };
}

function normalizeVerseId(verseId) {
  if (!verseId) return '';
  return verseId.replace(/^([^\.]+)\.(\d+)\.(\d+)$/, '$1 $2:$3');
}

function highlightVerseHtml(html, verseId) {
  // Defensive: validate inputs
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  if (!verseId) {
    return html;
  }

  const normalizedSid = normalizeVerseId(verseId);
  if (!normalizedSid) {
    return html;
  }

  try {
    const marker = `data-sid="${normalizedSid}"`;
    const start = html.indexOf(marker);
    if (start === -1) {
      // Verse not found in HTML, return original
      return html;
    }

    const spanStart = html.lastIndexOf('<', start);
    if (spanStart === -1 || spanStart >= start) {
      // No valid tag found, return original
      return html;
    }

    let end = html.indexOf('data-sid="', start + marker.length);
    if (end === -1) {
      end = html.length;
    } else {
      end = html.lastIndexOf('<', end);
      if (end === -1 || end <= spanStart) {
        end = html.length;
      }
    }

    return html.slice(0, spanStart) + `<span class="original-verse">` + html.slice(spanStart, end) + `</span>` + html.slice(end);
  } catch (error) {
    console.error('Error highlighting verse:', error);
    return html; // Return original if highlighting fails
  }
}

function renderResults(results, query, offset = 0) {
  resultsNode.innerHTML = '';
  if (!results.length) {
    resultsNode.innerHTML = '<p class="helper-text">No results found. Try a shorter phrase or a different set of words.</p>';
    return;
  }

  const start = offset * RESULTS_PER_PAGE;
  const end = start + RESULTS_PER_PAGE;
  const pageResults = results.slice(start, end);
  const topResults = pageResults;
  topResults.forEach((result) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const header = document.createElement('div');
    header.className = 'result-header';
    const panelId = `chapter-panel-${Math.random().toString(36).slice(2, 8)}`;
    header.innerHTML = `
      <div class="result-top-row">
        <span class="version-badge">${escapeHtml(result.version)}</span>
        <button class="chapter-toggle-button" type="button" aria-expanded="false" aria-controls="${panelId}">Show whole Chapter</button>
      </div>
      <h2 class="result-title">${escapeHtml(result.reference)}</h2>
    `;

    const scoreBadge = document.createElement('span');
    scoreBadge.className = 'score-pill';
    scoreBadge.textContent = `Relevance ${result.score}`;

    const chapterButton = header.querySelector('.chapter-toggle-button');
    const chapterPanel = document.createElement('div');
    chapterPanel.className = 'chapter-panel';
    chapterPanel.id = panelId;
    chapterPanel.hidden = true;

    chapterButton.addEventListener('click', async () => {
      const isOpen = !chapterPanel.hidden;
      if (isOpen) {
        chapterPanel.hidden = true;
        chapterButton.textContent = 'Show whole Chapter';
        chapterButton.setAttribute('aria-expanded', 'false');
        return;
      }

      // Defensive: check if we have the required IDs
      if (!result.bibleId || !result.chapterId) {
        setStatus('Chapter content is not available for this verse.', true);
        return;
      }

      chapterButton.disabled = true;
      chapterButton.textContent = 'Loading chapter...';

      try {
        let chapterHtml = await fetchChapterContent(result.bibleId, result.chapterId);
        
        // Defensive: check if HTML is valid before highlighting
        if (!chapterHtml || typeof chapterHtml !== 'string') {
          chapterHtml = '<p class="helper-text">Chapter content is unavailable.</p>';
        } else {
          chapterHtml = highlightVerseHtml(chapterHtml, result.verseId);
        }
        
        chapterPanel.innerHTML = chapterHtml;
        chapterPanel.hidden = false;
        chapterButton.textContent = 'Hide whole Chapter';
        chapterButton.setAttribute('aria-expanded', 'true');
      } catch (error) {
        errorLog.add('CHAPTER_LOAD', `Failed to load chapter ${result.chapterId}`, { 
          bibleId: result.bibleId,
          verseId: result.verseId,
          error: error.message 
        });
        const friendlyMessage = getUserFriendlyMessage(error, 'chapter loading');
        setStatus(`Unable to load chapter: ${friendlyMessage}`, true);
        chapterButton.textContent = 'Show whole Chapter';
        chapterPanel.innerHTML = '<p class="helper-text">Failed to load chapter content. Please try again.</p>';
      } finally {
        chapterButton.disabled = false;
      }
    });

    card.innerHTML = `
      <p class="result-text">${highlightQuery(escapeHtml(result.text), query)}</p>
    `;
    card.insertBefore(header, card.firstChild);
    card.appendChild(scoreBadge);
    card.appendChild(chapterPanel);
    resultsNode.appendChild(card);
  });

  const totalPages = Math.ceil(results.length / RESULTS_PER_PAGE);
  const currentPage = offset + 1;
  const hasPrevious = offset > 0;
  const hasNext = end < results.length;

  const paginationContainer = document.createElement('div');
  paginationContainer.className = 'pagination-container';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'pagination-button';
  prevBtn.textContent = '← Previous';
  prevBtn.disabled = !hasPrevious;
  prevBtn.addEventListener('click', () => {
    if (hasPrevious) {
      currentResultOffset -= 1;
      renderResults(results, query, currentResultOffset);
      resultsNode.scrollIntoView({ behavior: 'smooth' });
    }
  });
  paginationContainer.appendChild(prevBtn);

  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  paginationContainer.appendChild(pageInfo);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'pagination-button';
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = !hasNext;
  nextBtn.addEventListener('click', () => {
    if (hasNext) {
      currentResultOffset += 1;
      renderResults(results, query, currentResultOffset);
      resultsNode.scrollIntoView({ behavior: 'smooth' });
    }
  });
  paginationContainer.appendChild(nextBtn);

  resultsNode.appendChild(paginationContainer);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function handleSearch(event) {
  event.preventDefault();
  let query = searchInput.value.trim();
  if (!query) {
    setStatus('Please enter some text to search.', true);
    return;
  }

  query = cleanSearchInput(query);
  if (!query) {
    setStatus('Please enter some text to search.', true);
    return;
  }

  setStatus('Searching verses…', false);
  searchButton.disabled = true;
  resultsNode.innerHTML = '';

  try {
    const startTime = performance.now();
    let foundPartial = false;
    let apiErrors = 0;

    const searchPromises = bibleVersions.map(async (version) => {
      try {
        const items = await searchBibleVersion(version.id, query);
        if (items.length > 0) {
          foundPartial = true;
        }
        return items.map((item) => parseResult(item, version.abbreviation, query)).filter((result) => result !== null);
      } catch (error) {
        apiErrors += 1;
        errorLog.add('VERSION_SEARCH', `Search failed for version ${version.abbreviation}`, { 
          query, 
          version: version.id,
          error: error.message 
        });
        return [];
      }
    });

    const resultSets = await Promise.all(searchPromises);
    const combined = resultSets.flat().filter((item) => item.score > 0);

    const uniqueResults = [];
    const seenKeys = new Set();
    combined.forEach((item) => {
      const key = `${item.version}|${item.reference}|${item.text}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueResults.push(item);
      }
    });

    uniqueResults.sort((a, b) => b.score - a.score);

    allResults = uniqueResults;
    currentResultOffset = 0;
    renderResults(uniqueResults, query, 0);

    const elapsed = Math.round(performance.now() - startTime);
    if (combined.length) {
      const sourceMessage = foundPartial ? 'Showing the best available matches.' : 'No exact matches found; showing broader results.';
      setStatus(`Found ${combined.length} possible match${combined.length === 1 ? '' : 'es'} in ${elapsed}ms. ${sourceMessage}`, false);
    } else if (apiErrors > 0) {
      setStatus('Search completed, but some versions could not be retrieved. Try again in a moment.', true);
    } else {
      setStatus('No matches found. Try a shorter phrase or a different set of words.', true);
    }
  } catch (error) {
    errorLog.add('SEARCH_HANDLER', 'Unexpected error during search', { error: error.message });
    const friendlyMessage = getUserFriendlyMessage(error, 'search');
    setStatus(`Error: ${friendlyMessage}`, true);
  } finally {
    searchButton.disabled = false;
  }
}

searchForm.addEventListener('submit', handleSearch);
clearButton.addEventListener('click', () => {
  searchInput.value = '';
  resultsNode.innerHTML = '';
  allResults = [];
  currentResultOffset = 0;
  setStatus('Search cleared.', false);
});

if (inputClear) {
  const updateInputClear = () => {
    if (searchInput.value && searchInput.value.trim() !== '') {
      inputClear.hidden = false;
    } else {
      inputClear.hidden = true;
    }
  };

  searchInput.addEventListener('input', updateInputClear);
  inputClear.addEventListener('click', () => {
    searchInput.value = '';
    updateInputClear();
    searchInput.focus();
  });
  // initialize visibility
  updateInputClear();
}

window.addEventListener('DOMContentLoaded', () => {
  fetchBibleVersions();
});
