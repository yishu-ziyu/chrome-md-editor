// ============================================================
// 预览区符号自动配对纯逻辑测试（BUG-3 回归）
// ------------------------------------------------------------
// 验证 getAutoPairClose 对各开符号、nextChar 边界（字母/数字/中文/空/标点）行为正确。
// 与编辑器侧 CodeMirror closeBrackets 默认行为对齐：nextChar 为字母/数字时不补。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutoPairClose, AUTO_PAIR_TABLE } from '../src/auto-pair.js';

test('auto-pair: ASCII 开符号返回正确闭符号（nextChar 为空）', () => {
  assert.equal(getAutoPairClose('(', ''), ')');
  assert.equal(getAutoPairClose('[', ''), ']');
  assert.equal(getAutoPairClose('{', ''), '}');
  assert.equal(getAutoPairClose('<', ''), '>');
});

test('auto-pair: 中文开符号返回对应闭符号（不同字符）', () => {
  assert.equal(getAutoPairClose('\u201c', ''), '\u201d'); // " → "
  assert.equal(getAutoPairClose('\u2018', ''), '\u2019'); // ' → '
  assert.equal(getAutoPairClose('\uff08', ''), '\uff09'); // （ → ）
});

test('auto-pair: nextChar 为 ASCII 字母/数字时跳过（避免中间输入配对）', () => {
  // 用户在中间输入 "foo|" 不会变成 "foo()|"
  assert.equal(getAutoPairClose('(', 'f'), null);
  assert.equal(getAutoPairClose('(', 'o'), null);
  assert.equal(getAutoPairClose('(', '1'), null);
  assert.equal(getAutoPairClose('[', 'a'), null);
  assert.equal(getAutoPairClose('{', 'Z'), null);
  assert.equal(getAutoPairClose('<', '9'), null);
});

test('auto-pair: nextChar 为下划线/中文/标点时仍配对', () => {
  // \w 在 JS 正则中（无 u 标志）只匹配 ASCII [A-Za-z0-9_]——下划线算字母
  assert.equal(getAutoPairClose('(', '_'), null);
  // 中文字符不属 \w 范畴 → 仍配对（与中文写作习惯「中(文)」一致）
  assert.equal(getAutoPairClose('(', '中'), ')');
  // 空格属于非 \w 非闭符号 → 应配对
  assert.equal(getAutoPairClose('(', ' '), ')');
  // 另一个开括号 → 应配对（CM6 风格："a(|(b" → "a(()|b"）
  assert.equal(getAutoPairClose('(', '('), ')');
  // 已是闭符号 → 跳过（调用方应只移光标，避免重复插入）
  assert.equal(getAutoPairClose('(', ')'), null);
  assert.equal(getAutoPairClose('[', ']'), null);
  assert.equal(getAutoPairClose('"', '"'), null);
});

test('auto-pair: 非开符号返回 null', () => {
  assert.equal(getAutoPairClose(')', ''), null);
  assert.equal(getAutoPairClose(']', ''), null);
  assert.equal(getAutoPairClose('a', ''), null);
  assert.equal(getAutoPairClose(' ', ''), null);
});

test('auto-pair: 多字符或空输入返回 null', () => {
  assert.equal(getAutoPairClose('', ''), null);
  assert.equal(getAutoPairClose('()', ''), null);
  assert.equal(getAutoPairClose('ab', ''), null);
});

test('auto-pair: AUTO_PAIR_TABLE 含所有期望对（与编辑器配置一致）', () => {
  // 与 src/close-brackets-config.js 的 BRACKET_PAIRS 保持一一对应
  const expected = [
    ['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'],
    ["'", "'"], ['"', '"'], ['`', '`'],
    ['\u201c', '\u201d'], ['\u2018', '\u2019'],
    ['\uff08', '\uff09'],
  ];
  assert.equal(AUTO_PAIR_TABLE.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(AUTO_PAIR_TABLE[i], expected[i], `pair[${i}] mismatch`);
  }
});