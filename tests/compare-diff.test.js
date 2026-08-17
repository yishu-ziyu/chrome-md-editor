/**
 * compare-diff.test.js — compare 模块 diff / 合并相关单测（T8）
 *
 * 测试策略（避免需要真实 DOM 的 MergeView 实例化）：
 *  - 对纯函数层做单测：compare-diff-export.js 的 buildDiffText（消费 presentableDiff 的 Change[]）。
 *  - 对 @codemirror/merge 的 presentableDiff()/diff() 做集成验证（纯函数，无需 DOM），
 *    断言返回的 Change[] 结构与内容正确（字符偏移 fromA/toA/fromB/toB + slice 一致性）。
 *  - 对 compare-merge.js 的 countChunks、compare-nav.js 的 bindChunkNavigation 做安全降级验证
 *    （非 merge 状态下不抛错、返回合理值）。
 *
 * 不实例化 MergeView / EditorView（那需要 DOM）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { presentableDiff, diff, Chunk } from '@codemirror/merge';
import { EditorState, Text } from '@codemirror/state';

import { countChunks } from '../src/compare-merge.js';
import {
  bindChunkNavigation,
  bindChunkNavigationKeys,
  resolveChunkNavAction,
  isEditableTarget,
} from '../src/compare-nav.js';
import { buildDiffText, exportDiffReport } from '../src/compare-diff-export.js';

// 与 compare-diff-export.js 默认一致的 diff 配置
const CFG = { scanLimit: 500, timeout: 1500 };

// ───────────────────────────────────────────────────────────────────────────
// A. @codemirror/merge 的 presentableDiff / diff 集成（纯函数，无 DOM）
// ───────────────────────────────────────────────────────────────────────────

test('presentableDiff: 返回 Change[]，且偏移为字符位置、slice 与内容一致', () => {
  const a = 'line1\nline2\nline3';
  const b = 'line1\nCHANGED\nline3';
  const changes = presentableDiff(a, b, CFG);
  assert.equal(changes.length, 1);
  const c = changes[0];
  for (const k of ['fromA', 'toA', 'fromB', 'toB']) {
    assert.equal(typeof c[k], 'number', `Change.${k} 应为 number`);
  }
  assert.equal(a.slice(c.fromA, c.toA), 'line2');
  assert.equal(b.slice(c.fromB, c.toB), 'CHANGED');
});

test('presentableDiff: 纯删除块（b 侧为空）', () => {
  const a = 'keep\nremove\nkeep';
  const b = 'keep\nkeep';
  const changes = presentableDiff(a, b, CFG);
  assert.equal(changes.length, 1);
  const c = changes[0];
  // chunk 偏移按行对齐，可能含行尾 \n，断言去掉行尾换行后的内容
  assert.equal(a.slice(c.fromA, c.toA).replace(/\n$/, ''), 'remove');
  assert.equal(b.slice(c.fromB, c.toB), '');
});

test('presentableDiff: 纯插入块（a 侧为空）', () => {
  const a = 'keep\nkeep';
  const b = 'keep\ninserted\nkeep';
  const changes = presentableDiff(a, b, CFG);
  assert.equal(changes.length, 1);
  const c = changes[0];
  assert.equal(a.slice(c.fromA, c.toA), '');
  assert.equal(b.slice(c.fromB, c.toB).replace(/\n$/, ''), 'inserted');
});

test('presentableDiff: 文档相同时返回空数组', () => {
  const a = 'a\nb\nc';
  assert.equal(presentableDiff(a, a, CFG).length, 0);
});

test('presentableDiff: 多块 diff，所有块的 slice 与内容可校验', () => {
  const a = 'A1\nA2\nA3\nA4\nA5';
  const b = 'B1\nA2\nA3\nB4\nA5';
  const changes = presentableDiff(a, b, CFG);
  assert.ok(changes.length >= 2, `期望 >=2 个 chunk，实际 ${changes.length}`);
  const removed = changes.map((c) => a.slice(c.fromA, c.toA));
  const added = changes.map((c) => b.slice(c.fromB, c.toB));
  assert.ok(removed.includes('A1'));
  assert.ok(removed.includes('A4'));
  assert.ok(added.includes('B1'));
  assert.ok(added.includes('B4'));
});

test('diff(): 同样返回 Change[] 结构化结果', () => {
  const changes = diff('a\nb', 'a\nc', CFG);
  assert.ok(changes.length >= 1, 'diff 应至少产出 1 个 Change');
  const c = changes[0];
  assert.equal(typeof c.fromA, 'number');
  assert.equal(typeof c.toB, 'number');
});

// ───────────────────────────────────────────────────────────────────────────
// B. compare-diff-export.js 的 buildDiffText 渲染层（行级：消费 Chunk.build → git 风格文本）
// ───────────────────────────────────────────────────────────────────────────

test('buildDiffText: 无差异时返回空串', () => {
  assert.equal(buildDiffText('same\ntext', 'same\ntext', CFG), '');
});

test('buildDiffText: 单块渲染为 git 风格并锁格式', () => {
  const a = 'line1\nline2\nline3';
  const b = 'line1\nCHANGED\nline3';
  const out = buildDiffText(a, b, CFG);
  assert.ok(out.startsWith('@@'), '应以 hunk 头 @@ 开头');
  assert.match(out, /@@ -2,1 \+2,1 @@/);
  assert.ok(out.includes('- line2'), '应包含删除行');
  assert.ok(out.includes('+ CHANGED'), '应包含新增行');
  assert.ok(out.endsWith('\n'), '应以换行结尾');
});

test('buildDiffText: 多块拼接——hunk 数 == Chunk.build 行级块数，且每块 -/+ 内容齐全', () => {
  const a = 'A1\nA2\nA3\nA4\nA5';
  const b = 'B1\nA2\nA3\nB4\nA5';
  const ta = Text.of(a.split('\n'));
  const tb = Text.of(b.split('\n'));
  // buildDiffText 内部使用 Chunk.build 做行级对齐，预期 hunk 数与之同源
  const expectedChunks = Chunk.build(ta, tb, CFG);
  const out = buildDiffText(a, b, CFG);
  const hunkCount = (out.match(/^@@ /gm) || []).length;
  assert.equal(hunkCount, expectedChunks.length, 'hunk 头数量应等于行级 chunk 数');
  for (const c of expectedChunks) {
    const oldLines = [];
    const newLines = [];
    for (let pos = c.fromA; pos < c.toA; ) {
      const line = ta.lineAt(pos);
      oldLines.push(line.text);
      pos = line.to + 1;
    }
    for (let pos = c.fromB; pos < c.toB; ) {
      const line = tb.lineAt(pos);
      newLines.push(line.text);
      pos = line.to + 1;
    }
    for (const l of oldLines) if (l !== '') assert.ok(out.includes('- ' + l), `应包含删除行: ${l}`);
    for (const l of newLines) if (l !== '') assert.ok(out.includes('+ ' + l), `应包含新增行: ${l}`);
  }
});

test('buildDiffText: 缺省 config 也能工作（presentableDiff 默认参数）', () => {
  const out = buildDiffText('x\ny', 'x\nz');
  assert.ok(out.includes('- y'));
  assert.ok(out.includes('+ z'));
});

test('exportDiffReport: 作为函数被导出（调用需 DOM，不在此实例化）', () => {
  assert.equal(typeof exportDiffReport, 'function');
});

// ───────────────────────────────────────────────────────────────────────────
// C. compare-merge.js 的 countChunks（非 merge 状态下安全降级）
// ───────────────────────────────────────────────────────────────────────────

test('countChunks: 普通 EditorState（无 merge 扩展）返回 0 且不抛错', () => {
  const st = EditorState.create({ doc: 'a\nb\nc' });
  assert.doesNotThrow(() => {
    assert.equal(countChunks(st), 0);
  });
});

test('countChunks: 确为可导出的函数', () => {
  assert.equal(typeof countChunks, 'function');
});

// ───────────────────────────────────────────────────────────────────────────
// D. compare-nav.js 的 bindChunkNavigation（封装 goToNextChunk/goToPreviousChunk）
// ───────────────────────────────────────────────────────────────────────────

test('bindChunkNavigation: 传入 null/undefined 时返回安全的 no-op next/prev', () => {
  const nav = bindChunkNavigation(null);
  assert.equal(typeof nav.next, 'function');
  assert.equal(typeof nav.prev, 'function');
  assert.doesNotThrow(() => {
    nav.next();
    nav.prev();
  });
});

test('bindChunkNavigation: 真实 EditorState + mock dispatch 不抛错', () => {
  let dispatched = 0;
  const view = {
    state: EditorState.create({ doc: 'a\nb\nc' }),
    dispatch: () => {
      dispatched++;
    },
  };
  const nav = bindChunkNavigation(view);
  assert.doesNotThrow(() => {
    nav.next();
    nav.prev();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// E. compare-nav.js 的块导航快捷键（resolveChunkNavAction / bindChunkNavigationKeys）
// ───────────────────────────────────────────────────────────────────────────

const ev = (over) => ({
  key: 'b',
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: null,
  ...over,
});

test('resolveChunkNavAction: B → next，Shift+B → prev', () => {
  assert.equal(resolveChunkNavAction(ev({ key: 'b' })), 'next');
  assert.equal(resolveChunkNavAction(ev({ key: 'B', shiftKey: true })), 'prev');
});

test('resolveChunkNavAction: ] → next，[ → prev', () => {
  assert.equal(resolveChunkNavAction(ev({ key: ']' })), 'next');
  assert.equal(resolveChunkNavAction(ev({ key: '[' })), 'prev');
});

test('resolveChunkNavAction: Ctrl/Cmd 组合与无关按键一律不响应', () => {
  assert.equal(resolveChunkNavAction(ev({ key: 'b', ctrlKey: true })), null);
  assert.equal(resolveChunkNavAction(ev({ key: 'b', metaKey: true })), null);
  assert.equal(resolveChunkNavAction(ev({ key: 'a' })), null);
  assert.equal(resolveChunkNavAction(null), null);
});

test('resolveChunkNavAction: 可编辑区域内不劫持 b/[/]，但 Alt 组合仍生效', () => {
  const editable = { isContentEditable: true };
  const input = { tagName: 'INPUT' };
  assert.equal(resolveChunkNavAction(ev({ key: 'b', target: editable })), null);
  assert.equal(resolveChunkNavAction(ev({ key: ']', target: input })), null);
  assert.equal(resolveChunkNavAction(ev({ key: 'b', altKey: true, target: editable })), 'next');
  assert.equal(
    resolveChunkNavAction(ev({ key: 'B', altKey: true, shiftKey: true, target: editable })),
    'prev'
  );
});

test('isEditableTarget: 识别 input/textarea/select 与 contenteditable', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
  assert.equal(isEditableTarget(null), false);
});

test('bindChunkNavigationKeys: 快捷键调用与按钮同一组 next/prev，并可解绑', () => {
  const calls = [];
  const listeners = [];
  const fakeTarget = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };

  const unbind = bindChunkNavigationKeys(
    { next: () => calls.push('next'), prev: () => calls.push('prev') },
    { target: fakeTarget }
  );
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'keydown');

  let prevented = 0;
  const fire = (over) =>
    listeners[0].fn(ev({ ...over, preventDefault: () => prevented++ }));

  fire({ key: 'b' });
  fire({ key: 'B', shiftKey: true });
  fire({ key: ']' });
  fire({ key: '[' });
  fire({ key: 'z' }); // 无关按键
  assert.deepEqual(calls, ['next', 'prev', 'next', 'prev']);
  assert.equal(prevented, 4, '命中的快捷键应阻止默认行为');

  unbind();
  assert.equal(listeners.length, 0);
});

test('bindChunkNavigationKeys: 无 handlers / 无 target 时返回安全 no-op', () => {
  assert.doesNotThrow(() => {
    bindChunkNavigationKeys(null, { target: null })();
    bindChunkNavigationKeys({}, { target: null })();
  });
});
