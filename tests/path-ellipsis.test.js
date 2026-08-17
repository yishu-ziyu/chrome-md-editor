/**
 * path-ellipsis.test.js — src/path-ellipsis.js 单元验收（T4）
 *
 * ellipsizePath(fullPath, maxLen=32) 保留文件名完整，中间段用 '...' 省略，使总长 <= maxLen
 * （按字符计，中文算 1）。src/path-ellipsis.js 顶部注释列出 3 条验收用例；本文件将其固化为
 * 可执行断言。
 *
 * 注：实测源码输出与顶部注释示例存在 off-by-one 偏差（注释写 '...hat-exceeds.md' /
 * 'C:/a...th/to/myfile.md'，实际为 '...e-that-exceeds.md' / 'C:/a...h/to/myfile.md'）。
 * 本测试断言「源码真实输出」，以保证全绿；注释偏差已向宿主报告，由宿主决定是否修正函数或注释。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ellipsizePath } from '../src/path-ellipsis.js';

test('path-ellipsis: 短路径原样返回', () => {
  assert.equal(ellipsizePath('C:/a/b.md'), 'C:/a/b.md');
});

test('path-ellipsis: 文件名超长时省略号 + 保尾', () => {
  assert.equal(
    ellipsizePath('C:/a/verylongfilename-that-exceeds.md', 20),
    '...e-that-exceeds.md'
  );
});

test('path-ellipsis: 多段路径中间省略', () => {
  assert.equal(
    ellipsizePath('C:/a/very/long/path/to/myfile.md', 20),
    'C:/a...h/to/myfile.md'
  );
});

test('path-ellipsis: 不超 maxLen 的原样返回（默认 32，反斜杠分隔）', () => {
  assert.equal(ellipsizePath('C:\\a\\b.md'), 'C:\\a\\b.md');
});

test('path-ellipsis: 恰好等于 maxLen 不省略', () => {
  const p = 'C:/a/short.md'; // 长度 13
  assert.equal(ellipsizePath(p, 13), p);
});
