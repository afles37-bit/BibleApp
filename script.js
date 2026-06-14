const API_KEY = '3vDlHU3AM0f7_8fBZAIPu';
const API_BASE = 'https://api.scripture.api.bible/v1';
const TARGET_VERSIONS = {
  'a81b73293d3080c9-01': 'AMP',
  'de4e12af7f28f599-02': 'engKJV',
  'd6e14a625393b4da-01': 'NLT'
};

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
    const response = await fetch(`${API_BASE}/bibles`, {
      headers: {
        'api-key': API_KEY
      }
    });
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
    setStatus(error.message, true);
  }
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[\n\r]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSearchInput(text) {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\{.*?\}/g, '')
    .replace(/<.*?>/g, '')
    .replace(/[{}[\]<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemSearchWord(word) {
  return word.replace(/(eth|ing|es|s)$/i, '').trim();
}

function buildFallbackQueries(query) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  const queries = new Set();
  queries.add(query);

  const maxWindow = Math.min(4, words.length);
  for (let window = maxWindow; window >= 2; window -= 1) {
    for (let start = 0; start + window <= words.length; start += 1) {
      queries.add(words.slice(start, start + window).join(' '));
      const windowWords = words.slice(start, start + window).map((word) => stemSearchWord(word));
      queries.add(windowWords.join(' '));
    }
  }

  words.forEach((word) => {
    if (word.length >= 4) {
      queries.add(word);
      queries.add(stemSearchWord(word));
    }
  });

  return Array.from(queries).filter((q) => q && q.split(' ').length > 0);
}

function scoreMatch(query, verseText) {
  const normalizedQuery = normalizeText(query);
  const normalizedVerse = normalizeText(verseText);
  if (!normalizedQuery || !normalizedVerse) return 0;

  const exactMatch = normalizedVerse.includes(normalizedQuery) ? 30 : 0;
  const queryWords = normalizedQuery.split(' ');
  const verseWords = new Set(normalizedVerse.split(' ').filter(Boolean));

  let commonCount = 0;
  queryWords.forEach((word) => {
    if (verseWords.has(word)) {
      commonCount += 1;
      return;
    }
    const stemmed = stemSearchWord(word);
    if (verseWords.has(stemmed)) {
      commonCount += 1;
      return;
    }
    for (const verseWord of verseWords) {
      if (verseWord.startsWith(word) || word.startsWith(verseWord)) {
        const minLen = Math.min(word.length, verseWord.length);
        if (minLen >= 5) {
          commonCount += 1;
          return;
        }
      }
    }
  });

  const overlapScore = (commonCount / queryWords.length) * 50;
  const lengthPenalty = Math.max(0, 20 - Math.abs(normalizedVerse.length - normalizedQuery.length) / 5);
  return Math.min(100, Math.round(exactMatch + overlapScore + lengthPenalty));
}

function highlightQuery(text, query) {
  const cleanedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!cleanedQuery) return text;
  const regex = new RegExp(`(${cleanedQuery})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

async function fetchSearchResults(versionId, query, limit = 8) {
  const url = `${API_BASE}/bibles/${versionId}/search?query=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await fetch(url, {
    headers: {
      'api-key': API_KEY
    }
  });

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
  const cacheKey = `${bibleId}:${chapterId}`;
  if (chapterCache.has(cacheKey)) {
    return chapterCache.get(cacheKey);
  }

  const url = `${API_BASE}/bibles/${bibleId}/chapters/${chapterId}`;
  const response = await fetch(url, {
    headers: {
      'api-key': API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Chapter fetch failed for ${chapterId}: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const html = json.data?.content || '';
  chapterCache.set(cacheKey, html);
  return html;
}

function parseResult(item, versionName, query) {
  const text = item.text || item.content || item.passages || '';
  const reference = item.reference || item?.passage?.reference || item?.passage?.display || item?.id || 'Unknown reference';
  return {
    version: versionName,
    bibleId: item.bibleId,
    chapterId: item.chapterId,
    verseId: item.id,
    reference,
    text: text.trim(),
    score: scoreMatch(query, text)
  };
}

function normalizeVerseId(verseId) {
  if (!verseId) return '';
  return verseId.replace(/^([^\.]+)\.(\d+)\.(\d+)$/, '$1 $2:$3');
}

function highlightVerseHtml(html, verseId) {
  const normalizedSid = normalizeVerseId(verseId);
  if (!normalizedSid) return html;

  const marker = `data-sid="${normalizedSid}"`;
  const start = html.indexOf(marker);
  if (start === -1) return html;

  const spanStart = html.lastIndexOf('<', start);
  if (spanStart === -1) return html;

  let end = html.indexOf('data-sid="', start + marker.length);
  if (end === -1) {
    end = html.length;
  } else {
    end = html.lastIndexOf('<', end);
    if (end === -1) {
      end = html.length;
    }
  }

  return html.slice(0, spanStart) + `<span class="original-verse">` + html.slice(spanStart, end) + `</span>` + html.slice(end);
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

      chapterButton.disabled = true;
      chapterButton.textContent = 'Loading chapter...';

      try {
        let chapterHtml = await fetchChapterContent(result.bibleId, result.chapterId);
        chapterHtml = highlightVerseHtml(chapterHtml, result.verseId);
        chapterPanel.innerHTML = chapterHtml || '<p class="helper-text">Chapter content is unavailable.</p>';
        chapterPanel.hidden = false;
        chapterButton.textContent = 'Hide whole Chapter';
        chapterButton.setAttribute('aria-expanded', 'true');
      } catch (error) {
        setStatus(error.message, true);
        chapterButton.textContent = 'Show whole Chapter';
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
        return items.map((item) => parseResult(item, version.abbreviation, query));
      } catch (error) {
        apiErrors += 1;
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
    setStatus(error.message, true);
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
