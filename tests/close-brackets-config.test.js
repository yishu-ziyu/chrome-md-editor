// ============================================================
// closeBrackets brackets 配置正确性测试（BUG-4 回归）
// ------------------------------------------------------------
// 验证 BRACKETS_STR 满足 CodeMirror 6 closeBrackets 的解析约束：
//   1. 长度为偶数
//   2. BRACKET_PAIRS 中每对 (open, close) 在字符串中恰好相邻（偶/奇索引）
//   3. ASCII 引号 (', ", `) 自配对（同一字符连续两次）
//   4. 中文标点（" " ' ' （ ））开/闭为不同字符且正确相邻
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRACKET_PAIRS, BRACKETS_STR } from '../src/close-brackets-config.js';

test('close-brackets-config: BRACKETS_STR 长度为偶数（CM6 按相邻成对解析）', () => {
  assert.equal(BRACKETS_STR.length % 2, 0, `length=${BRACKETS_STR.length}, not even`);
});

test('close-brackets-config: 每对 (open, close) 在字符串中恰好相邻', () => {
  for (let i = 0; i < BRACKET_PAIRS.length; i++) {
    const [open, close] = BRACKET_PAIRS[i];
    const idx = i * 2;
    assert.equal(BRACKETS_STR[idx], open, `pair[${i}] open expected at ${idx}, got ${BRACKETS_STR[idx]}`);
    assert.equal(BRACKETS_STR[idx + 1], close, `pair[${i}] close expected at ${idx + 1}, got ${BRACKETS_STR[idx + 1]}`);
  }
});

test('close-brackets-config: ASCII 配对括号 () [] {} <> 正确', () => {
  // 验证 BRACKETS_STR 中包含相邻的 `(` `)` 等
  const idx = BRACKETS_STR.indexOf('(');
  assert.notEqual(idx, -1);
  assert.equal(BRACKETS_STR[idx + 1], ')');
  assert.equal(BRACKETS_STR.indexOf('[') + 1, BRACKETS_STR.indexOf(']'));
  assert.equal(BRACKETS_STR.indexOf('{') + 1, BRACKETS_STR.indexOf('}'));
  assert.equal(BRACKETS_STR.indexOf('<') + 1, BRACKETS_STR.indexOf('>'));
});

test('close-brackets-config: ASCII 自配对引号 \' " ` 出现两次且相邻', () => {
  // CM6 对自配对的解析要求相同字符连续出现两次（位置 i 和 i+1）
  const findPair = (ch) => {
    const i = BRACKETS_STR.indexOf(ch);
    assert.notEqual(i, -1, `${ch} not found`);
    assert.equal(BRACKETS_STR[i + 1], ch, `${ch} not self-paired at ${i}`);
    return i;
  };
  findPair("'");
  findPair('"');
  findPair('`');
});

test('close-brackets-config: 中文双引号 \"\" 正确相邻（不同字符）', () => {
  // 这是原 BUG-4 的核心：旧数组配置下 "\u201c" 被错误配到 `` ` ``，现在必须配到 "\u201d"
  const i = BRACKETS_STR.indexOf('\u201c');
  assert.notEqual(i, -1, 'LEFT DOUBLE QUOTATION MARK not found');
  assert.equal(BRACKETS_STR[i + 1], '\u201d', 'should be paired with RIGHT DOUBLE QUOTATION MARK');
});

test('close-brackets-config: 中文单引号 \'\' 正确相邻（不同字符）', () => {
  const i = BRACKETS_STR.indexOf('\u2018');
  assert.notEqual(i, -1, 'LEFT SINGLE QUOTATION MARK not found');
  assert.equal(BRACKETS_STR[i + 1], '\u2019', 'should be paired with RIGHT SINGLE QUOTATION MARK');
});

test('close-brackets-config: 全角括号 （） 正确相邻', () => {
  const i = BRACKETS_STR.indexOf('\uff08');
  assert.notEqual(i, -1, 'FULLWIDTH LEFT PARENTHESIS not found');
  assert.equal(BRACKETS_STR[i + 1], '\uff09', 'should be paired with FULLWIDTH RIGHT PARENTHESIS');
});

test('close-brackets-config: 旧 BUG-4 错配对不再存在', () => {
  // 旧错误配置：\"[\"(\", \"[\"]\" 意味着 `(` 被配到 `[`、\"[\"\u201c\", \"\"\u2018\"\"] 意味着 \"被配到 `` ` ``
  // 验证新配置中所有「相邻一对」都是预期的开闭配对
  for (let i = 0; i < BRACKETS_STR.length; i += 2) {
    const pair = BRACKETS_STR.slice(i, i + 2);
    // 遍历 BRACKET_PAIRS 验证 pair 在其中
    const found = BRACKET_PAIRS.some(([o, c]) => o + c === pair);
    assert.equal(found, true, `unexpected adjacent pair at ${i}: ${JSON.stringify(pair)}`);
  }
});