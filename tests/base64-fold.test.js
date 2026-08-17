/**
 * base64-fold.test.js — A-9 超长 Base64 行折叠（M1/M2/M3 修复）纯逻辑单测
 *
 * 覆盖：
 *   - isFoldableDataLine 判定（短/长 data: 行、非 data:、非字符串）
 *   - unfoldedField + toggleFold：展开/收起切换（M1 确定性重建的状态基础）
 *   - 文档编辑后 offset 经 mapPos 映射（M2 行号漂移修复）
 *
 * 说明：折叠装饰的 ViewPlugin 依赖 CodeMirror + DOM 运行时，无法在 node 纯环境
 * 实测；但其正确性已由构建通过 + 浏览器/EXE 探针日志运行时验证。此处锁定
 * 可纯逻辑验证的核心状态机（StateField/StateEffect）与纯函数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { unfoldedField, toggleFold, isFoldableDataLine } from '../src/base64-fold.js';

// ─── isFoldableDataLine 纯函数 ───────────────────────────────────────────────

test('isFoldableDataLine: 超长 data: 行可折叠', () => {
  const long = 'data:image/png;base64,' + 'A'.repeat(400);
  assert.equal(isFoldableDataLine(long), true);
});

test('isFoldableDataLine: 短 data: 行不可折叠', () => {
  assert.equal(isFoldableDataLine('data:image/png;base64,short'), false);
});

test('isFoldableDataLine: 非 data: 前缀不可折叠', () => {
  assert.equal(isFoldableDataLine('hello world'), false);
});

test('isFoldableDataLine: 非字符串返回 false', () => {
  assert.equal(isFoldableDataLine(null), false);
  assert.equal(isFoldableDataLine(undefined), false);
  assert.equal(isFoldableDataLine(123), false);
});

// ─── unfoldedField + toggleFold 状态机 ───────────────────────────────────────

test('unfoldedField: 初始为空', () => {
  const state = EditorState.create({ doc: 'a\nb\nc', extensions: [unfoldedField] });
  assert.equal(state.field(unfoldedField).size, 0);
});

test('unfoldedField: toggleFold 展开后记录 offset，再次切换取消（M1）', () => {
  // "a\n" 长 2，b 行起始 offset = 2
  let state = EditorState.create({ doc: 'a\nb\nc', extensions: [unfoldedField] });
  state = state.update({ effects: toggleFold.of(2) }).state;
  assert.equal(state.field(unfoldedField).has(2), true);
  // 再次派发同一 offset → 取消展开
  state = state.update({ effects: toggleFold.of(2) }).state;
  assert.equal(state.field(unfoldedField).has(2), false);
});

test('unfoldedField: 文档编辑后 offset 映射（M2 行号漂移修复）', () => {
  // "line1\n" 长 6，line2 起始 offset = 6
  let state = EditorState.create({ doc: 'line1\nline2\n', extensions: [unfoldedField] });
  state = state.update({ effects: toggleFold.of(6) }).state;
  assert.equal(state.field(unfoldedField).has(6), true);
  // 在第 0 行前插入 "X\n"（2 字符），line2 起始应映射为 8
  state = state.update({ changes: { from: 0, insert: 'X\n' } }).state;
  assert.equal(state.field(unfoldedField).has(8), true, '编辑后旧 offset 应映射到新位置');
  assert.equal(state.field(unfoldedField).has(6), false, '旧 offset 不应残留');
});

test('unfoldedField: 多行独立展开，互不影响', () => {
  // "a\n"=2, "b\n"=4, "c"=6
  const state0 = EditorState.create({ doc: 'a\nb\nc', extensions: [unfoldedField] });
  const s1 = state0.update({ effects: toggleFold.of(2) }).state;
  const s2 = s1.update({ effects: toggleFold.of(4) }).state;
  assert.equal(s2.field(unfoldedField).has(2), true);
  assert.equal(s2.field(unfoldedField).has(4), true);
  // 仅取消 offset 4
  const s3 = s2.update({ effects: toggleFold.of(4) }).state;
  assert.equal(s3.field(unfoldedField).has(2), true);
  assert.equal(s3.field(unfoldedField).has(4), false);
});
