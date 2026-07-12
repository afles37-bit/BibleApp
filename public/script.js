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
let currentSearchMeta = {};
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

function getChapterLegendHtml() {
  return `<aside class="chapter-legend" aria-label="Chapter colour guide">
    <span class="legend-swatch legend-swatch--add"></span>Words in <strong>brown italic</strong> were added by translators to clarify meaning — not present in the original manuscripts.
    <a href="about.html#added-words" target="_blank" rel="noopener">Learn more</a>
  </aside>`;
}

function attachChapterToggle(button, panel, verseData, options = {}) {
  const {
    unavailableMessage = 'Chapter content is not available for this verse.',
    loadErrorContext = 'chapter loading'
  } = options;

  button.addEventListener('click', async () => {
    const isOpen = !panel.hidden;
    if (isOpen) {
      panel.hidden = true;
      button.textContent = 'Show whole Chapter';
      button.setAttribute('aria-expanded', 'false');
      return;
    }

    if (!verseData.bibleId || !verseData.chapterId) {
      setStatus(unavailableMessage, true);
      return;
    }

    button.disabled = true;
    button.textContent = 'Loading chapter...';

    try {
      let chapterHtml = await fetchChapterContent(verseData.bibleId, verseData.chapterId);

      if (!chapterHtml || typeof chapterHtml !== 'string') {
        chapterHtml = '<p class="helper-text">Chapter content is unavailable.</p>';
      } else {
        chapterHtml = highlightVerseHtml(chapterHtml, verseData.verseId);
      }

      panel.innerHTML = getChapterLegendHtml() + chapterHtml;
      panel.hidden = false;
      button.textContent = 'Hide whole Chapter';
      button.setAttribute('aria-expanded', 'true');
    } catch (error) {
      errorLog.add('CHAPTER_LOAD', `Failed to load chapter ${verseData.chapterId}`, {
        bibleId: verseData.bibleId,
        verseId: verseData.verseId,
        error: error.message
      });
      const friendlyMessage = getUserFriendlyMessage(error, loadErrorContext);
      setStatus(`Unable to load chapter: ${friendlyMessage}`, true);
      button.textContent = 'Show whole Chapter';
      panel.innerHTML = '<p class="helper-text">Failed to load chapter content. Please try again.</p>';
    } finally {
      button.disabled = false;
    }
  });
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
    if (currentSearchMeta.exactMatchType) {
      card.classList.add('result-card--exact-match');
      card.classList.add(`result-card--exact-${currentSearchMeta.exactMatchType}`);
    }

    const resultText = document.createElement('p');
    resultText.className = 'result-text';
    resultText.innerHTML = highlightQuery(escapeHtml(result.text), query);

    const header = document.createElement('div');
    header.className = 'result-header';
    const panelId = `chapter-panel-${Math.random().toString(36).slice(2, 8)}`;
    const otherPanelId = `other-versions-${Math.random().toString(36).slice(2, 8)}`;
    const otherVersions = Array.isArray(result.otherVersions) ? result.otherVersions : [];
    const otherVariants = Array.isArray(result.variants)
      ? result.variants.filter((variant) => variant.version !== result.version)
      : [];
    const versionSummary = otherVersions.length > 0
      ? `<p class="result-versions">Also available in ${escapeHtml(otherVersions.join(', '))}</p>`
      : '';
    const exactMatchBanner = currentSearchMeta.exactMatchType
      ? `<p class="exact-match-banner">Exact ${escapeHtml(currentSearchMeta.exactMatchType === 'reference' ? 'reference' : 'verse text')} match</p>`
      : '';
    header.innerHTML = `
      <div class="result-top-row">
        <span class="version-badge">${escapeHtml(result.version)}</span>
        <button class="chapter-toggle-button" type="button" aria-expanded="false" aria-controls="${panelId}">Show whole Chapter</button>
      </div>
      ${exactMatchBanner}
      <h2 class="result-title">${escapeHtml(result.reference)}</h2>
      ${versionSummary}
    `;

    let otherVersionsPanel = null;

    if (otherVariants.length > 0) {
      const otherVersionsButton = document.createElement('button');
      otherVersionsButton.type = 'button';
      otherVersionsButton.className = 'other-versions-toggle';
      otherVersionsButton.textContent = 'Show other versions';
      otherVersionsButton.setAttribute('aria-expanded', 'false');
      otherVersionsButton.setAttribute('aria-controls', otherPanelId);
      header.appendChild(otherVersionsButton);

      otherVersionsPanel = document.createElement('div');
      otherVersionsPanel.className = 'other-versions-panel';
      otherVersionsPanel.id = otherPanelId;
      otherVersionsPanel.hidden = true;

      otherVariants.forEach((variant, index) => {
        const item = document.createElement('article');
        item.className = 'other-version-item';
        const variantPanelId = `${otherPanelId}-chapter-${index}`;
        item.innerHTML = `
          <div class="other-version-header">
            <p class="other-version-label">${escapeHtml(variant.version || 'Other version')}</p>
            <button class="chapter-toggle-button chapter-toggle-button--inline" type="button" aria-expanded="false" aria-controls="${variantPanelId}">Show whole Chapter</button>
          </div>
          <p class="other-version-text">${highlightQuery(escapeHtml((variant.text || '').trim()), query)}</p>
        `;

        const variantChapterPanel = document.createElement('div');
        variantChapterPanel.className = 'chapter-panel chapter-panel--nested';
        variantChapterPanel.id = variantPanelId;
        variantChapterPanel.hidden = true;

        const variantChapterButton = item.querySelector('.chapter-toggle-button');
        attachChapterToggle(variantChapterButton, variantChapterPanel, variant, {
          unavailableMessage: `Chapter content is not available for ${variant.version || 'this version'}.`,
          loadErrorContext: `${variant.version || 'other version'} chapter loading`
        });

        otherVersionsPanel.appendChild(item);
        otherVersionsPanel.appendChild(variantChapterPanel);
      });

      otherVersionsButton.addEventListener('click', () => {
        const isOpen = !otherVersionsPanel.hidden;
        otherVersionsPanel.hidden = isOpen;
        otherVersionsButton.textContent = isOpen ? 'Show other versions' : 'Hide other versions';
        otherVersionsButton.setAttribute('aria-expanded', String(!isOpen));
      });
    }

    const scoreBadge = document.createElement('span');
    scoreBadge.className = 'score-pill';
    scoreBadge.textContent = `Relevance ${result.score}`;

    const chapterButton = header.querySelector('.chapter-toggle-button');
    const chapterPanel = document.createElement('div');
    chapterPanel.className = 'chapter-panel';
    chapterPanel.id = panelId;
    chapterPanel.hidden = true;

    attachChapterToggle(chapterButton, chapterPanel, result);

    card.appendChild(header);
    card.appendChild(resultText);
    if (otherVersionsPanel) {
      card.appendChild(otherVersionsPanel);
    }
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
    currentSearchMeta = json.meta || {};

    allResults = results;
    currentResultOffset = 0;
    renderResults(results, query, 0);

    const elapsed = Math.round(performance.now() - startTime);
    if (results.length) {
      if (currentSearchMeta.exactMatchType) {
        const label = currentSearchMeta.exactMatchType === 'reference' ? 'reference' : 'verse text';
        setStatus(`Found exact ${label} match in ${elapsed}ms.`, false);
      } else {
        setStatus(`Found ${results.length} match${results.length === 1 ? '' : 'es'} in ${elapsed}ms.`, false);
      }
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
  currentSearchMeta = {};
  setStatus('Search cleared.', false);
});

inputClear.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
});

searchInput.addEventListener('input', () => {
  inputClear.hidden = !searchInput.value;
});
