/**
 * Utility functions for Bible verse searching.
 * Exported for both browser use and Node.js testing.
 */

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

  // Keep parity with backend scoring: no matching words means no score.
  if (commonCount === 0) {
    return 0;
  }

  const overlapScore = (commonCount / queryWords.length) * 50;
  const lengthPenalty = Math.max(0, 20 - Math.abs(normalizedVerse.length - normalizedQuery.length) / 5);
  return Math.min(100, Math.round(exactMatch + overlapScore + lengthPenalty));
}

function normalizeVerseId(verseId) {
  if (!verseId) return '';
  return verseId.replace(/^([^\.]+)\.(\d+)\.(\d+)$/, '$1 $2:$3');
}

// Export for Node.js (tests) and browser (via <script>)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeText,
    cleanSearchInput,
    stemSearchWord,
    buildFallbackQueries,
    scoreMatch,
    normalizeVerseId
  };
}
