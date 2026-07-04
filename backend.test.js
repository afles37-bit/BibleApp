const assert = require('assert');
const { createApp } = require('./server');
const {
  buildFallbackQueries,
  cleanSearchInput,
  cleanVerseText,
  scoreMatch,
  groupResultsAcrossVersions,
  validateQuery,
  FALLBACK_LIMIT
} = require('./search-core');

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function createMockFetch(itemsByBible = {}) {
  return async (url, options = {}) => {
    if (url.includes('/search?')) {
      const bibleId = decodeURIComponent(url.split('/bibles/')[1].split('/search')[0]);
      const payload = itemsByBible[bibleId] || [];
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { verses: payload } };
        }
      };
    }

    if (url.includes('/chapters/')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { content: '<p>chapter content</p>' } };
        }
      };
    }

    return {
      ok: false,
      status: 404,
      async json() {
        return { error: 'not found' };
      }
    };
  };
}

(async () => {
  console.log('Running backend tests...');

  // 1) Fallback limit enforcement
  const fallbacks = buildFallbackQueries('the lord is my shepherd forever and ever');
  assert(fallbacks.length <= FALLBACK_LIMIT, 'Fallback queries should be capped');
  assert(fallbacks.length > 0, 'Should include at least one fallback');
  const rescueFallbacks = buildFallbackQueries('The Lord will certainly rescue us');
  assert(
    rescueFallbacks.some((query) => query.toLowerCase().includes('certainly rescue us')),
    'Fallback queries should include a shorter meaningful phrase for verse-text searches'
  );

  // 2) Score floor for no-match
  assert.strictEqual(scoreMatch('xyz', 'The LORD is my shepherd'), 0, 'No-match score should be 0');

  // 2b) Bracketed markup should be removed cleanly from queries
  assert.strictEqual(
    cleanSearchInput('I can do all things through Christ [b]who strengthens me'),
    'I can do all things through Christ who strengthens me',
    'Bracketed tags should be stripped without gluing words together'
  );

  const philippiansScore = scoreMatch(
    'I can do all things through Christ [b]who strengthens me',
    'I can do all things through Christ which strengtheneth me'
  );
  assert(philippiansScore >= 60, `Expected strong score for Philippians 4:13, got ${philippiansScore}`);

  const htmlVerse = '<p class="p"><span data-number="13" data-sid="EPH 6:13" class="v">13</span>Therefore, put on the complete armor of God.</p>';
  assert.strictEqual(
    cleanVerseText(htmlVerse),
    'Therefore, put on the complete armor of God.',
    'Verse HTML should be stripped for scoring and display'
  );
  assert.strictEqual(
    cleanVerseText('resist «span class="it">and</span> stand your ground'),
    'resist and stand your ground',
    'Malformed guillemet tags should be normalized and stripped'
  );
  assert.strictEqual(
    cleanVerseText('The L<span class="nd">ord</span> will certainly rescue us'),
    'The Lord will certainly rescue us',
    'Inline markup inside a word should not introduce artificial spaces'
  );
  assert.strictEqual(
    cleanVerseText('nor let Hezekiah make you trust in and rely on the L ord , saying, “The L ord will certainly rescue us.”'),
    'nor let Hezekiah make you trust in and rely on the Lord , saying, “The Lord will certainly rescue us.”',
    'Split small-caps LORD text should be normalized for display'
  );
  const htmlScore = scoreMatch('Therefore put on the complete armor of God', htmlVerse);
  assert(htmlScore >= 90, `Expected strong score for HTML-wrapped verse, got ${htmlScore}`);

  const evilDayExactScore = scoreMatch(
    'evil day',
    'that ye may be able to withstand in the evil day, and having done all, to stand.'
  );
  const evilDayLooseScore = scoreMatch(
    'evil day',
    'all day long they plan evil in their hearts.'
  );
  assert(
    evilDayExactScore > evilDayLooseScore,
    `Expected exact phrase score (${evilDayExactScore}) to outrank loose match (${evilDayLooseScore})`
  );

  const refPreferredScore = scoreMatch(
    'ephesians 3:16',
    'May He grant you out of the riches of His glory, to be strengthened spiritually energized with power through His Spirit in your inner self.',
    'Ephesians 3:16'
  );
  const mentionOnlyScore = scoreMatch(
    'ephesians 3:16',
    'Great is Artemis of the Ephesians!',
    'Acts 19:28'
  );
  assert(
    refPreferredScore > mentionOnlyScore,
    `Expected exact reference score (${refPreferredScore}) to outrank mention-only match (${mentionOnlyScore})`
  );

  // 3) Group duplicate references across versions
  const grouped = groupResultsAcrossVersions([
    {
      version: 'AMP', bibleId: 'a81b73293d3080c9-01', reference: 'John 3:16', text: 'For God so loved the world',
      verseId: 'JHN.3.16', chapterId: 'JHN.3', score: 95
    },
    {
      version: 'NLT', bibleId: 'd6e14a625393b4da-01', reference: 'John 3:16', text: 'For this is how God loved the world',
      verseId: 'JHN.3.16', chapterId: 'JHN.3', score: 92
    }
  ]);
  assert.strictEqual(grouped.length, 1, 'Duplicates should be grouped to one result');
  assert(grouped[0].versions.includes('AMP') && grouped[0].versions.includes('NLT'), 'Group should include both versions');

  // 4) Query validation helper
  assert.strictEqual(validateQuery('').valid, false, 'Empty query should be invalid');
  assert.strictEqual(validateQuery('ok').valid, true, 'Valid query should pass');

  // 5) /api/search validation and /api/search response shape
  const mockFetch = createMockFetch({
    'a81b73293d3080c9-01': [
      { id: 'EPH.3.16', chapterId: 'EPH.3', reference: 'Ephesians 3:16', text: 'May He grant you out of the riches of His glory' },
      { id: 'JHN.3.16', chapterId: 'JHN.3', reference: 'John 3:16', text: 'For God so loved the world' }
    ],
    'd6e14a625393b4da-01': [
      { id: 'EPH.3.16', chapterId: 'EPH.3', reference: 'Ephesians 3:16', text: 'I pray that from his glorious, unlimited resources he will empower you with inner strength through his Spirit.' },
      { id: 'JHN.3.16', chapterId: 'JHN.3', reference: 'John 3:16', text: 'For this is how God loved the world' }
    ]
  });

  const app = createApp({ apiKey: 'test-key', fetchImpl: mockFetch });
  await withServer(app, async (baseUrl) => {
    const badResp = await fetch(`${baseUrl}/api/search?query=`);
    assert.strictEqual(badResp.status, 400, 'Empty query should return 400');

    const longQuery = 'a'.repeat(501);
    const longResp = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent(longQuery)}`);
    assert.strictEqual(longResp.status, 400, 'Too-long query should return 400');

    const fullVerseQuery = 'Therefore, put on the complete armor of God, so that you will be able to resist and stand your ground in the evil day.';
    const fullVerseResp = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent(fullVerseQuery)}`);
    assert.strictEqual(fullVerseResp.status, 200, 'Full verse text query should be accepted');

    const referenceResp = await fetch(`${baseUrl}/api/search?query=ephesians%203:16`);
    assert.strictEqual(referenceResp.status, 200, 'Exact verse reference should be accepted');
    const referenceBody = await referenceResp.json();
    assert.strictEqual(referenceBody.data.length, 1, 'Exact verse reference should return only one grouped result');
    assert.strictEqual(referenceBody.data[0].reference, 'Ephesians 3:16', 'Exact verse reference should be the only result');
    assert.strictEqual(referenceBody.meta.exactMatchType, 'reference', 'Exact reference queries should be labeled in metadata');

    const exactVerseText = 'May He grant you out of the riches of His glory, to be strengthened and spiritually energized with power through His Spirit in your inner self, [indwelling your innermost being and personality],';
    const exactVerseTextResp = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent(exactVerseText)}`);
    assert.strictEqual(exactVerseTextResp.status, 200, 'Exact verse text should be accepted');
    const exactVerseTextBody = await exactVerseTextResp.json();
    assert.strictEqual(exactVerseTextBody.data.length, 1, 'Exact verse text should return only one grouped result');
    assert.strictEqual(exactVerseTextBody.data[0].reference, 'Ephesians 3:16', 'Exact verse text should resolve to the matching verse');
    assert.strictEqual(exactVerseTextBody.meta.exactMatchType, 'verse-text', 'Exact verse text queries should be labeled in metadata');

    const okResp = await fetch(`${baseUrl}/api/search?query=god loved world`);
    assert.strictEqual(okResp.status, 200, 'Valid query should return 200');
    const body = await okResp.json();
    assert(Array.isArray(body.data), 'Response data should be an array');
    assert.strictEqual(body.meta.grouped, true, 'Results should be grouped');
    assert.strictEqual(body.meta.fallbackLimit, FALLBACK_LIMIT, 'Meta should report fallback limit');
  });

  // 6) Rate limit behavior
  const appForRateLimit = createApp({ apiKey: 'test-key', fetchImpl: createMockFetch() });
  await withServer(appForRateLimit, async (baseUrl) => {
    let lastStatus = 200;
    for (let i = 0; i < 35; i += 1) {
      const resp = await fetch(`${baseUrl}/api/search?query=lord`);
      lastStatus = resp.status;
      if (resp.status === 429) break;
    }
    assert.strictEqual(lastStatus, 429, 'Rate limiting should eventually return 429');
  });

  // 7) Missing API key handling still responds (mocked fetch avoids upstream failure)
  const appNoKey = createApp({ apiKey: undefined, fetchImpl: createMockFetch() });
  await withServer(appNoKey, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/search?query=lord`);
    assert.strictEqual(resp.status, 200, 'App should remain responsive without API key when fetch is mocked');
  });

  console.log('All backend tests passed!');
})().catch((err) => {
  console.error('Backend tests failed:', err);
  process.exit(1);
});
