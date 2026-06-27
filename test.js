/**
 * Unit tests for Bible verse search utilities.
 * Run with: node test.js
 */

const assert = require('assert');
const {
  normalizeText,
  cleanSearchInput,
  stemSearchWord,
  buildFallbackQueries,
  scoreMatch,
  normalizeVerseId
} = require('./public/utils.js');

console.log('Running unit tests...\n');

// Test: normalizeText
console.log('Testing normalizeText()');
assert.strictEqual(normalizeText('The LORD is my shepherd'), 'the lord is my shepherd');
assert.strictEqual(normalizeText('Hello, World!'), 'hello world');
assert.strictEqual(normalizeText('  Multiple   spaces  '), 'multiple spaces');
assert.strictEqual(normalizeText('123 ABC'), '123 abc');
console.log('✓ normalizeText passed\n');

// Test: cleanSearchInput
console.log('Testing cleanSearchInput()');
assert.strictEqual(cleanSearchInput('The {quick} [brown] <fox>'), 'The');
assert.strictEqual(cleanSearchInput('test[abc]text'), 'testtext');
assert.strictEqual(cleanSearchInput('  hello  world  '), 'hello world');
console.log('✓ cleanSearchInput passed\n');

// Test: stemSearchWord
console.log('Testing stemSearchWord()');
assert.strictEqual(stemSearchWord('running'), 'runn');
assert.strictEqual(stemSearchWord('loves'), 'lov');
assert.strictEqual(stemSearchWord('churches'), 'church');
assert.strictEqual(stemSearchWord('faith'), 'faith'); // no suffix match
console.log('✓ stemSearchWord passed\n');

// Test: buildFallbackQueries
console.log('Testing buildFallbackQueries()');
const queries = buildFallbackQueries('the lord is my shepherd');
assert(queries.includes('the lord is my shepherd'), 'Full query should be included');
assert(queries.some(q => q.length < 'the lord is my shepherd'.length), 'Should include shorter queries');
assert(queries.length > 1, 'Should generate multiple queries');
console.log(`Generated ${queries.length} fallback queries`);
console.log('✓ buildFallbackQueries passed\n');

// Test: scoreMatch - exact match
console.log('Testing scoreMatch()');
const score1 = scoreMatch('lord shepherd', 'The LORD is my shepherd');
assert(score1 > 0, 'Should score a partial match');
assert(score1 >= 30, 'Exact phrase should score >= 30 (exact match bonus)');
console.log(`Score for "lord shepherd" in verse: ${score1}`);

const score2 = scoreMatch('lord', 'The LORD is my shepherd');
assert(score2 > 0, 'Should score single word match');
console.log(`Score for "lord" in verse: ${score2}`);

const score3 = scoreMatch('xyz', 'The LORD is my shepherd');
assert.strictEqual(score3, 0, 'Non-matching query should score 0');
console.log(`Score for "xyz" in verse: ${score3}`);

const score4 = scoreMatch('', 'The LORD is my shepherd');
assert.strictEqual(score4, 0, 'Empty query should score 0');
console.log('✓ scoreMatch passed\n');

// Test: normalizeVerseId
console.log('Testing normalizeVerseId()');
assert.strictEqual(normalizeVerseId('MAT.3.16'), 'MAT 3:16');
assert.strictEqual(normalizeVerseId('JHN.1.1'), 'JHN 1:1');
assert.strictEqual(normalizeVerseId(''), '');
assert.strictEqual(normalizeVerseId(null), '');
assert.strictEqual(normalizeVerseId('invalid-id'), 'invalid-id'); // no match, returns as-is
console.log('✓ normalizeVerseId passed\n');

// Edge cases
console.log('Testing edge cases');
assert.strictEqual(scoreMatch('    ', 'verse text'), 0, 'Whitespace-only query should score 0');
assert.strictEqual(normalizeText(''), '', 'Empty string normalization');
assert.deepStrictEqual(buildFallbackQueries(''), [], 'Empty query should return empty array');
console.log('✓ Edge cases passed\n');

console.log('✅ All tests passed!');
