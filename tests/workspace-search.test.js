// tests/workspace-search.test.js
// 工作区搜索纯算法单测（不依赖 CM6 / FSA / 浏览器环境，全部用内存数据）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchQuery, extractSnippet, searchInFiles } from '../src/workspace-search.js';

test('matchQuery: 英文大小写不敏感', () => {
  assert.deepEqual(matchQuery('Hello World', 'hello'), [0]);
  assert.deepEqual(matchQuery('HELLO', 'hello'), [0]);
});

test('matchQuery: 中文不敏感（含中文命中）', () => {
  assert.deepEqual(matchQuery('世界 世界', '世界'), [0, 3]);
  assert.deepEqual(matchQuery('WORLD 世界 world', '世界'), [6]);
});

test('matchQuery: 多命中', () => {
  assert.deepEqual(matchQuery('alpha beta alpha', 'alpha'), [0, 11]);
  assert.deepEqual(matchQuery('aaaa', 'aa'), [0, 2]);
});

test('matchQuery: 空查询返回空', () => {
  assert.deepEqual(matchQuery('anything', ''), []);
});

test('extractSnippet: 短行直接返回原行', () => {
  const line = '# Alpha guide';
  assert.equal(extractSnippet(line, 2, 'Alpha'), line);
});

test('extractSnippet: 长行截断且不超过 96 字符且包含命中', () => {
  const long = 'x'.repeat(50) + 'needle' + 'y'.repeat(50);
  const snippet = extractSnippet(long, 50, 'needle');
  assert.ok(snippet.includes('needle'), '片段应包含命中串');
  assert.ok([...snippet].length <= 96, `片段字符数应 ≤96，实际 ${[...snippet].length}`);
  assert.ok(snippet.startsWith('...') || snippet.endsWith('...'), '长行应带省略号');
});

test('extractSnippet: 中文命中截断且包含命中', () => {
  const long = '中'.repeat(50) + '世界' + '文'.repeat(50);
  const snippet = extractSnippet(long, 50, '世界');
  assert.ok(snippet.includes('世界'));
  assert.ok([...snippet].length <= 96);
});

test('searchInFiles: 正确返回行号/列号/snippet（英文）', () => {
  const files = [
    { path: 'guide.md', content: '# Alpha guide\nbeta notes\nanother alpha marker' },
  ];
  const hits = searchInFiles(files, 'alpha');
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((h) => [h.path, h.lineNumber, h.columnNumber, h.snippet]),
    [
      ['guide.md', 1, 3, '# Alpha guide'],
      ['guide.md', 3, 9, 'another alpha marker'],
    ],
  );
});

test('searchInFiles: 多文件 + 中文 + 片段', () => {
  const files = [
    { path: 'docs/release.markdown', content: 'release plan\nALPHA rollout' },
    { path: 'note.md', content: '第一行\n世界第二行\n第三行 世界' },
  ];
  const hits = searchInFiles(files, 'alpha');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'docs/release.markdown');
  assert.equal(hits[0].lineNumber, 2);
  assert.equal(hits[0].snippet, 'ALPHA rollout');

  const cn = searchInFiles(files, '世界');
  assert.equal(cn.length, 2);
  assert.deepEqual(cn.map((h) => [h.path, h.lineNumber, h.columnNumber]), [
    ['note.md', 2, 1],
    ['note.md', 3, 5],
  ]);
  for (const h of cn) assert.ok(h.snippet.includes('世界'));
});

test('searchInFiles: 空查询返回空', () => {
  assert.deepEqual(searchInFiles([{ path: 'a.md', content: 'x' }], ''), []);
});
