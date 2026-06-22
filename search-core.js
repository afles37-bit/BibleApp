const APPROVED_BIBLES = {
  'a81b73293d3080c9-01': 'AMP',
  'de4e12af7f28f599-02': 'engKJV',
  'd6e14a625393b4da-01': 'NLT'
};

const MAX_QUERY_LENGTH = 120;
const FALLBACK_LIMIT = 3;
const MAX_TOTAL_API_CALLS = 20;
const MIN_DISPLAY_SCORE = 25;

function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function cleanSearchInput(text) {
  if (!text) return '';
  return text.replace(/[\[\]{}<>]/g, '').replace(/\s+/g, ' ').trim();
}

function stemSearchWord(word) {
  if (!word || word.length < 3) return word;
  if (word.endsWith('eth')) return word.slice(0, -3);
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

function buildFallbackQueries(query, limit = FALLBACK_LIMIT) {
  if (!query || !query.trim()) return [];

  const cleaned = cleanSearchInput(query);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const variants = [cleaned];

  if (words.length > 1) {
    variants.push(words.slice(0, -1).join(' '));
    variants.push(words[0]);
  }

  const stemmed = words.map(stemSearchWord).join(' ');
  if (normalizeText(stemmed) && normalizeText(stemmed) !== normalizeText(cleaned)) {
    variants.push(stemmed);
  }

  // Deduplicate by normalized representation and cap.
  const unique = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = normalizeText(variant);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(variant);
    if (unique.length >= limit) break;
  }

  return unique;
}

function validateQuery(query) {
  if (!query || typeof query !== 'string') return { valid: false, error: 'Query is required' };
  if (query.trim().length === 0) return { valid: false, error: 'Query cannot be empty' };
  if (query.length > MAX_QUERY_LENGTH) return { valid: false, error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` };
  return { valid: true };
}

function scoreMatch(query, verseText) {
  if (!query || !verseText) return 0;

  const cleanQuery = normalizeText(query);
  const cleanVerse = normalizeText(verseText);
  if (!cleanQuery || !cleanVerse) return 0;

  const queryWords = cleanQuery.split(/\s+/).filter(Boolean);
  const matchedWords = queryWords.filter((word) => cleanVerse.includes(word));

  // Hard floor: no matching words means no score.
  if (matchedWords.length === 0) return 0;

  const wordRatio = matchedWords.length / queryWords.length;
  const exactPhraseBonus = cleanVerse.includes(cleanQuery) ? 0.2 : 0;
  const score = Math.round((wordRatio + exactPhraseBonus) * 100);
  return Math.min(100, Math.max(1, score));
}

function dedupeResults(results) {
  const out = [];
  const seen = new Set();
  for (const item of results) {
    const key = `${item.version}|${item.reference}|${normalizeText(item.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function groupResultsAcrossVersions(results) {
  const groups = new Map();

  for (const item of results) {
    const groupKey = item.verseId || item.reference || normalizeText(item.text);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        reference: item.reference,
        verseId: item.verseId,
        chapterId: item.chapterId,
        text: item.text,
        score: item.score,
        bibleId: item.bibleId,
        version: item.version,
        versions: [item.version],
        variants: [{ version: item.version, bibleId: item.bibleId, chapterId: item.chapterId, text: item.text }]
      });
      continue;
    }

    const group = groups.get(groupKey);
    if (!group.versions.includes(item.version)) {
      group.versions.push(item.version);
      group.variants.push({ version: item.version, bibleId: item.bibleId, chapterId: item.chapterId, text: item.text });
    }

    // Keep the best scoring representative as primary.
    if (item.score > group.score) {
      group.score = item.score;
      group.text = item.text;
      group.bibleId = item.bibleId;
      group.chapterId = item.chapterId;
      group.version = item.version;
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      otherVersions: group.versions.filter((version) => version !== group.version)
    }))
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  APPROVED_BIBLES,
  MAX_QUERY_LENGTH,
  FALLBACK_LIMIT,
  MAX_TOTAL_API_CALLS,
  MIN_DISPLAY_SCORE,
  normalizeText,
  cleanSearchInput,
  stemSearchWord,
  buildFallbackQueries,
  validateQuery,
  scoreMatch,
  dedupeResults,
  groupResultsAcrossVersions
};
