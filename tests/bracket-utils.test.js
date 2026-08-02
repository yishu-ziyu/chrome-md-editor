/**
 * 单元测试：本次新功能的纯逻辑部分（对应 code-review 复审指出的 M1 修复）。
 *
 * 覆盖范围：
 *   - bracketMatchMap 构建正确性（无 undefined 污染、各符号 type/dir 正确）
 *   - findPairedBracket 括号栈匹配（含嵌套、中文引号）
 *   - findSelfPair 自身配对符号就近匹配（英文引号/反引号）
 *
 * 说明：H1（closeBrackets 经 languageData 配置）、L1（selectedBracketHighlight
 * 的 ViewPlugin 缓存）与查找/替换面板均依赖 CodeMirror + DOM 运行时，无法在
 * node 纯环境单测；其正确性已由构建（npm run build）通过 + 浏览器/EXE 侧
 * 探针日志（src/probe.js）运行时验证。本文件覆盖可纯逻辑验证的 M1 部分。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIR_GROUPS,
  SELF_PAIRS,
  bracketMatchMap,
  findSelfPair,
  findPairedBracket,
} from '../src/bracket-utils.js';

// ─── M1: bracketMatchMap 构建正确性 ────────────────────────────────────────

test('M1: bracketMatchMap 无 undefined 键污染', () => {
  assert.equal('undefined' in bracketMatchMap, false);
});

test('M1: 英文单/双引号与反引号为 self 类型且 other 指向自身', () => {
  assert.deepEqual(bracketMatchMap["'"], { other: "'", type: 'self' });
  assert.deepEqual(bracketMatchMap['"'], { other: '"', type: 'self' });
  assert.deepEqual(bracketMatchMap['`'], { other: '`', type: 'self' });
});

test('M1: 中文双引号开/闭 dir 正确 (pair)', () => {
  assert.deepEqual(bracketMatchMap['“'], { other: '”', dir: 1, type: 'pair' });
  assert.deepEqual(bracketMatchMap['”'], { other: '“', dir: -1, type: 'pair' });
});

test('M1: 中文单引号与全角圆括号 dir 正确 (pair)', () => {
  assert.equal(bracketMatchMap['‘'].dir, 1);
  assert.equal(bracketMatchMap['’'].dir, -1);
  assert.equal(bracketMatchMap['（'].dir, 1);
  assert.equal(bracketMatchMap['）'].dir, -1);
});

test('M1: PAIR_GROUPS/SELF_PAIRS 覆盖全部需求符号', () => {
  const flat = PAIR_GROUPS.flat();
  // 中文双引号 / 单引号 / 全角括号
  assert.ok(flat.includes('“') && flat.includes('”'));
  assert.ok(flat.includes('‘') && flat.includes('’'));
  assert.ok(flat.includes('（') && flat.includes('）'));
  // 英文 ()[]{}<>
  for (const c of ['(', ')', '[', ']', '{', '}', '<', '>']) {
    assert.ok(flat.includes(c), `PAIR_GROUPS 应包含 ${c}`);
  }
  // 英文引号 / 反引号（自身配对）
  for (const c of ["'", '"', '`']) {
    assert.ok(SELF_PAIRS.includes(c), `SELF_PAIRS 应包含 ${c}`);
  }
});

// ─── findPairedBracket: 括号栈匹配 ──────────────────────────────────────────

test('findPairedBracket: 简单括号配对', () => {
  const doc = 'a(b)c';
  const info = bracketMatchMap['('];
  assert.equal(findPairedBracket(doc, '(', info, 1), 3);
});

test('findPairedBracket: 嵌套括号跳过内层', () => {
  const doc = 'a(b[c]d)e';
  const info = bracketMatchMap['('];
  // 最外 ')' 在索引 8（a( b[ c] d ) e → 索引: 0a 1( 2b 3[ 4c 5] 6d 7) 8e）
  assert.equal(findPairedBracket(doc, '(', info, 1), 7);
});

test('findPairedBracket: 中文双引号配对', () => {
  const doc = '说“你好”结束';
  // 索引: 0说 1“ 2你 3好 4” 5结 6束
  const info = bracketMatchMap['“'];
  assert.equal(findPairedBracket(doc, '“', info, 1), 4);
});

test('findPairedBracket: 全角圆括号配对', () => {
  const doc = '甲（乙）丙';
  // 0甲 1（ 2乙 3） 4丙
  const info = bracketMatchMap['（'];
  assert.equal(findPairedBracket(doc, '（', info, 1), 3);
});

test('findPairedBracket: 无配对返回 null', () => {
  const doc = 'a(b';
  const info = bracketMatchMap['('];
  assert.equal(findPairedBracket(doc, '(', info, 1), null);
});

// ─── findSelfPair: 自身配对就近匹配 ─────────────────────────────────────────

test('findSelfPair: 闭引号向前就近找开引号', () => {
  const doc = "he said 'hello' then 'world'";
  // 索引: 0h1e2 3s4a5i6d7 8'9h10e11l12l13o14'15 16t17h18e19n20 21'22w23o24r25l26d27'
  const secondClose = doc.indexOf("'", 11); // 第二个 ' 的索引 = 14（闭引号，前有奇数个 '）
  assert.equal(findSelfPair(doc, "'", secondClose), 8); // 向前就近找开引号，在索引 8
});

test('findSelfPair: 开引号向后就近找闭引号', () => {
  const doc = "he said 'hello' then";
  // 索引: 0h1e2 3s4a5i6d7 8'9h10e11l12l13o14'15 16t17h18e19n
  const open = doc.indexOf("'"); // 第一个 ' 的索引 = 8（开引号，前有偶数个 '）
  assert.equal(findSelfPair(doc, "'", open), 14); // 向后就近找闭引号，在索引 14
});

test('findSelfPair: 反引号就近匹配', () => {
  const doc = 'a `code` b';
  const open = doc.indexOf('`');
  assert.equal(findSelfPair(doc, '`', open), 7); // 闭 ` 在 7
});

test('findSelfPair: 无配对返回 null', () => {
  const doc = "only one ' quote";
  const open = doc.indexOf("'");
  assert.equal(findSelfPair(doc, "'", open), null);
});
