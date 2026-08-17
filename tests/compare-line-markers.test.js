/**
 * compare-line-markers.test.js — 验证 H1 修复（unified 视图 side==='b' 删除行标记）（L3）
 *
 * 背景（H1 根因）：CM6 的 unifiedMergeView 内部以 `mergeConfig.of({ side: "b" })` 装配，
 * 因此 unified 单栏视图下 `getChunks(state).side` 取字符串 "b"（而非 null / undefined）。
 * 旧实现错误假设 unified 的 side 为 null，走了错误的去标记分支，导致删除行在 unified
 * 视图下不被标记。本测试锁定 `side === "b"` 这一事实，并验证 computeChunkDecorations
 * 在 unified 状态下（删除 / 插入两种差异）不抛错且能产出合法的 DecorationSet。
 *
 * 纯 state 层验证：EditorState.create 即可装配 merge 扩展，无需 DOM / EditorView。
 * computeChunkDecorations 通过 re-export 直接调用（其仅依赖 view.state）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedMergeView, getChunks } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';

import {
  applyCompareLineMarkers,
  computeChunkDecorations,
} from '../src/compare-line-markers.js';

// 装配一个 unified EditorState（original 为对照基准，doc 为当前文档）。
function buildUnifiedState(original, doc) {
  return EditorState.create({
    doc,
    extensions: [
      unifiedMergeView({ original, gutter: true, highlightChanges: true }),
      ...applyCompareLineMarkers(),
    ],
  });
}

test('H1: unified 视图 getChunks().side 必须为字符串 "b"（非 null / undefined）', () => {
  const state = buildUnifiedState('a\nb\nc\n', 'a\nc\n');
  const res = getChunks(state);
  assert.ok(res, 'unified 视图应返回非空 chunks 结果');
  assert.equal(res.side, 'b', 'unifiedMergeView 的 side 应为 "b"（H1 根因：side 假设）');
  assert.notEqual(res.side, null, 'side 不应为 null');
  assert.notEqual(res.side, undefined, 'side 不应为 undefined');
});

test('H1: unified 视图能检出删除块（chunks.length >= 1 且存在 A 侧删除区间）', () => {
  const state = buildUnifiedState('a\nb\nc\n', 'a\nc\n');
  const res = getChunks(state);
  assert.ok(res.chunks.length >= 1, '应至少检出 1 个差异块');
  const c = res.chunks[0];
  // 删除行 "b\n" 落在 A 侧区间 (fromA..toA)，证明删除被识别
  assert.ok(c.fromA !== c.toA, 'A 侧删除区间 (fromA..toA) 应非空，证明删除行被识别');
  assert.equal(c.fromB, c.toB, 'B 侧对应区间应为空（纯删除）');
});

test('H1: computeChunkDecorations 在 unified 删除态下不抛错且返回合法 DecorationSet', () => {
  const state = buildUnifiedState('a\nb\nc\n', 'a\nc\n');
  let deco;
  assert.doesNotThrow(() => {
    // computeChunkDecorations 仅依赖 view.state；以 { state } 注入即可
    deco = computeChunkDecorations({ state });
  }, 'unified 删除态下 computeChunkDecorations 不应抛错');
  assert.ok(deco, 'computeChunkDecorations 应返回 DecorationSet');
  assert.equal(typeof deco.iter, 'function', '返回值应具备 DecorationSet.iter 接口');
});

test('H1: unified 插入态下 computeChunkDecorations 实际产出非空装饰（走 markRangeLines 分支）', () => {
  // doc 中插入了 X 行：fromB != toB，side==='b' 时应标记 ADDED 区间
  const state = buildUnifiedState('a\nb\nc\n', 'a\nb\nX\nc\n');
  const res = getChunks(state);
  assert.equal(res.side, 'b');
  assert.ok(res.chunks.length >= 1);
  const c = res.chunks[0];
  assert.ok(c.fromB !== c.toB, '插入态 B 侧区间应非空');

  let deco;
  assert.doesNotThrow(() => {
    deco = computeChunkDecorations({ state });
  });

  // 统计装饰数量：DecorationSet.size 为已添加的装饰条数，
  // size >= 1 证明 markRangeLines 真的执行、未抛错。
  assert.ok(deco.size >= 1, '应在插入行上产出至少 1 个 line 装饰（验证装饰逻辑真实运行）');
});
