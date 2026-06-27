const assert = require('assert');
const { createApp } = require('./server');
const {
  buildFallbackQueries,
  cleanSearchInput,
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
  assert(philippiansScore >= 80, `Expected strong score for Philippians 4:13, got ${philippiansScore}`);

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
      { id: 'JHN.3.16', chapterId: 'JHN.3', reference: 'John 3:16', text: 'For God so loved the world' }
    ],
    'd6e14a625393b4da-01': [
      { id: 'JHN.3.16', chapterId: 'JHN.3', reference: 'John 3:16', text: 'For this is how God loved the world' }
    ]
  });

  const app = createApp({ apiKey: 'test-key', fetchImpl: mockFetch });
  await withServer(app, async (baseUrl) => {
    const badResp = await fetch(`${baseUrl}/api/search?query=`);
    assert.strictEqual(badResp.status, 400, 'Empty query should return 400');

    const longQuery = 'a'.repeat(121);
    const longResp = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent(longQuery)}`);
    assert.strictEqual(longResp.status, 400, 'Too-long query should return 400');

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
