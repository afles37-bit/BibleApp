// Backend API endpoints
const API_BASE = '/api';
const RESULTS_PER_PAGE = 5;

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
      this.errors.shift();
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

// User-friendly error messages
function getUserFriendlyMessage(error, context = '') {
  if (!error) return 'An unexpected error occurred.';
  const message = error.message || String(error);
  
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Unable to connect to the server. Check your internet connection.';
  }
  if (message.includes('403') || message.includes('Forbidden')) {
    return 'Access denied. Check your API key.';
  }
  if (message.includes('404') || message.includes('Not found')) {
    return 'The requested resource was not found.';
  }
  if (message.includes('429')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (message.includes('500') || message.includes('Internal Server')) {
    return 'Server error. Please try again later.';
  }
  if (message.includes('timeout')) {
    return 'Request timed out. Please try again.';
  }
  if (message.includes('JSON') || message.includes('parse')) {
    return 'Failed to process response. Please try again.';
  }
  
  return message;
}

// DOM elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const statusNode = document.getElementById('status');
const resultsNode = document.getElementById('results');
const searchButton = document.getElementById('search-button');
const clearButton = document.getElementById('clear-button');
const inputClear = document.getElementById('input-clear');

let allResults = [];
let currentResultOffset = 0;
const chapterCache = new Map();

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function highlightQuery(text, query) {
  const cleanedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b(${cleanedQuery.split(/\s+/).join('|')})\\b`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

// Fetch chapter content with caching
async function fetchChapterContent(bibleId, chapterId) {
  if (!bibleId || !chapterId) {
    errorLog.add('CHAPTER_FETCH', 'Invalid chapter parameters', { bibleId, chapterId });
    throw new Error('Invalid chapter parameters');
  }

  const cacheKey = `${bibleId}:${chapterId}`;
  if (chapterCache.has(cacheKey)) {
    return chapterCache.get(cacheKey);
  }

  try {
    const url = `${API_BASE}/chapters/${encodeURIComponent(bibleId)}/${encodeURIComponent(chapterId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Chapter fetch failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const html = json.data || '';
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

// Highlight verse in chapter HTML
function highlightVerseHtml(html, verseId) {
  if (!html || typeof html !== 'string') return '';
  if (!verseId) return html;

  try {
    const normalizedSid = verseId.replace(/^([^\.]+)\.(\d+)\.(\d+)$/, '$1 $2:$3');
    if (!normalizedSid) return html;

    const marker = `data-sid="${normalizedSid}"`;
    const start = html.indexOf(marker);
    if (start === -1) return html;

    const spanStart = html.lastIndexOf('<', start);
    if (spanStart === -1 || spanStart >= start) return html;

    let end = html.indexOf('data-sid="', start + marker.length);
    if (end === -1) {
      end = html.length;
    } else {
      end = html.lastIndexOf('<', end);
      if (end === -1 || end <= spanStart) end = html.length;
    }

    return html.slice(0, spanStart) + `<span class="original-verse">` + html.slice(spanStart, end) + `</span>` + html.slice(end);
  } catch (error) {
    console.error('Error highlighting verse:', error);
    return html;
  }
}

// Render search results with pagination
function renderResults(results, query, offset = 0) {
  resultsNode.innerHTML = '';
  if (!results.length) {
    resultsNode.innerHTML = '<p class="helper-text">No results found. Try a shorter phrase or different words.</p>';
    return;
  }

  const start = offset * RESULTS_PER_PAGE;
  const end = start + RESULTS_PER_PAGE;
  const pageResults = results.slice(start, end);

  pageResults.forEach((result) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const header = document.createElement('div');
    header.className = 'result-header';
    const panelId = `chapter-panel-${Math.random().toString(36).slice(2, 8)}`;
    const otherVersions = Array.isArray(result.otherVersions) ? result.otherVersions : [];
    const versionSummary = otherVersions.length > 0
      ? `<p class="result-versions">Also available in ${escapeHtml(otherVersions.join(', '))}</p>`
      : '';
    header.innerHTML = `
      <div class="result-top-row">
        <span class="version-badge">${escapeHtml(result.version)}</span>
        <button class="chapter-toggle-button" type="button" aria-expanded="false" aria-controls="${panelId}">Show whole Chapter</button>
      </div>
      <h2 class="result-title">${escapeHtml(result.reference)}</h2>
      ${versionSummary}
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

      if (!result.bibleId || !result.chapterId) {
        setStatus('Chapter content is not available for this verse.', true);
        return;
      }

      chapterButton.disabled = true;
      chapterButton.textContent = 'Loading chapter...';

      try {
        let chapterHtml = await fetchChapterContent(result.bibleId, result.chapterId);
        
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

  // Pagination
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

// Main search handler
async function handleSearch(event) {
  event.preventDefault();
  let query = searchInput.value.trim();
  if (!query) {
    setStatus('Please enter some text to search.', true);
    return;
  }

  setStatus('Searching verses…', false);
  searchButton.disabled = true;
  resultsNode.innerHTML = '';

  try {
    const startTime = performance.now();
    const url = `${API_BASE}/search?query=${encodeURIComponent(query)}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Search failed: ${response.status}`);
    }

    const json = await response.json();
    const results = json.data || [];

    allResults = results;
    currentResultOffset = 0;
    renderResults(results, query, 0);

    const elapsed = Math.round(performance.now() - startTime);
    if (results.length) {
      setStatus(`Found ${results.length} match${results.length === 1 ? '' : 'es'} in ${elapsed}ms.`, false);
    } else {
      setStatus('No matches found. Try a shorter phrase or different words.', true);
    }
  } catch (error) {
    errorLog.add('SEARCH_HANDLER', 'Search failed', { error: error.message });
    const friendlyMessage = getUserFriendlyMessage(error, 'search');
    setStatus(`Error: ${friendlyMessage}`, true);
  } finally {
    searchButton.disabled = false;
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  setStatus('Ready. Enter a verse phrase to search.', false);
});

// Event listeners
searchForm.addEventListener('submit', handleSearch);

clearButton.addEventListener('click', () => {
  searchInput.value = '';
  resultsNode.innerHTML = '';
  allResults = [];
  currentResultOffset = 0;
  setStatus('Search cleared.', false);
});

inputClear.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
});

searchInput.addEventListener('input', () => {
  inputClear.hidden = !searchInput.value;
});
