/**
 * path-ellipsis-fix.test.js — L1 边界容错回归
 *   1) 混合分隔符路径：sep 须与真正命中的最后一个分隔符一致（'a/b\c.md' 末分隔符是 '\'）
 *   2) maxLen < 6 时直接返回原路径，不产出空串或比 maxLen 还长的 '...'
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ellipsizePath } from '../src/path-ellipsis.js';

test('L1: 混合分隔符路径最后分隔符为反斜杠时，拼接用反斜杠', () => {
  // 末分隔符是 '\'（idx 落在 '\'），应以 '\' 连接 dir 与 file，而非被 includes('/') 误导成 '/'
  const out = ellipsizePath('a/b/longdir\\c.md', 12);
  assert.equal(out, 'a/b...ir\\c.md');
  assert.ok(out.includes('\\'), '重建后的连接分隔符应为反斜杠');
});

test('L1: 纯反斜杠路径仍正常省略（maxLen 小于全长时按反斜杠重建）', () => {
  // 'C:\\a\\b\\c.md' 全长 11，maxLen=10 触发省略；边界分隔符为 '\'，重建用 '\' 连接
  assert.equal(ellipsizePath('C:\\a\\b\\c.md', 10), 'C:...b\\c.md');
  assert.ok(ellipsizePath('C:\\a\\b\\c.md', 10).includes('\\'), '重建连接分隔符应为反斜杠');
});

test('L1: maxLen < 6 时返回原路径（避免空串/超长省略号）', () => {
  assert.equal(ellipsizePath('C:/a/b.md', 1), 'C:/a/b.md');
  assert.equal(ellipsizePath('C:/a/b.md', 2), 'C:/a/b.md');
  assert.equal(ellipsizePath('C:/a/b.md', 5), 'C:/a/b.md');
});

test('L1: maxLen === 6 边界仍走正常省略分支（>=6 不提前返回）', () => {
  const out = ellipsizePath('C:/a/longfilename.md', 6);
  // 文件名本身超长 -> '...' + 末尾 (6-3)=3 字符（'.md'）
  assert.equal(out, '....md');
});
