/**
 * compare-io-bridge.test.js — io-bridge / save.js / chunk-ops 单元测试
 *
 * 用 node:test 运行，覆盖：
 *   1) io-bridge：注入 mock 的 isTauri=true/false，验证 read/write 分流到正确后端、
 *      参数正确传递；目标为空或类型不符时抛错。
 *   2) save.js：mock ioBridge，验证 saveActivePane 取活动栏内容并调用 write；
 *      活动栏切换生效；无 target 的回退行为。
 *   3) chunk-ops：验证 rejectChunk 与 applyNonConflicting 的纯函数筛选逻辑
 *      （轻量 fake view/state，无需真实 CodeMirror）。
 *
 * 运行：node --test tests/compare-io-bridge.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createIoBridge } from '../src/compare/io-bridge.js';
import { setActivePane, getActivePane, saveActivePane, saveAs, exportDiff } from '../src/compare/save.js';
import { acceptChunk, rejectChunk, applyNonConflicting, selectNonConflicting, filterReject } from '../src/compare/chunk-ops.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// 1) io-bridge
// ─────────────────────────────────────────────────────────────────────────

test('io-bridge: Tauri 模式 read 调用 read_text_file 且参数正确', async () => {
  const calls = [];
  const invoke = (cmd, args) => {
    calls.push({ cmd, args });
    return Promise.resolve('desktop-content');
  };
  const bridge = createIoBridge({ isTauri: true, invoke });
  const out = await bridge.read({ path: '/abs/file.md' });
  assert.equal(out, 'desktop-content');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'read_text_file');
  assert.deepEqual(calls[0].args, { path: '/abs/file.md' });
});

test('io-bridge: Tauri 模式 write 调用 write_text_file 且参数正确', async () => {
  const calls = [];
  const invoke = (cmd, args) => {
    calls.push({ cmd, args });
    return Promise.resolve();
  };
  const bridge = createIoBridge({ isTauri: true, invoke });
  await bridge.write({ path: '/abs/file.md' }, 'hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'write_text_file');
  assert.deepEqual(calls[0].args, { path: '/abs/file.md', content: 'hello' });
});

test('io-bridge: 浏览器模式 read 经过 handle.getFile().text()', async () => {
  let gotFile = false;
  const handle = {
    getFile() {
      gotFile = true;
      return Promise.resolve({ text: () => Promise.resolve('browser-content') });
    },
  };
  const bridge = createIoBridge({ isTauri: false });
  const out = await bridge.read({ handle });
  assert.equal(out, 'browser-content');
  assert.equal(gotFile, true);
});

test('io-bridge: 浏览器模式 write 经过 handle.createWritable().write().close()', async () => {
  let written = null;
  let closed = false;
  const handle = {
    createWritable() {
      return Promise.resolve({
        write(c) {
          written = c;
          return Promise.resolve();
        },
        close() {
          closed = true;
          return Promise.resolve();
        },
      });
    },
  };
  const bridge = createIoBridge({ isTauri: false });
  await bridge.write({ handle }, 'payload');
  assert.equal(written, 'payload');
  assert.equal(closed, true);
});

test('io-bridge: 目标为空时 read 抛错', () => {
  const bridge = createIoBridge({ isTauri: false });
  assert.throws(() => bridge.read(null), /目标描述符无效/);
  assert.throws(() => bridge.read(undefined), /目标描述符无效/);
});

test('io-bridge: 目标为空时 write 抛错', () => {
  const bridge = createIoBridge({ isTauri: false });
  assert.throws(() => bridge.write(null, 'x'), /目标描述符无效/);
});

test('io-bridge: Tauri 模式目标缺 path 时抛错', () => {
  const invoke = () => Promise.resolve();
  const bridge = createIoBridge({ isTauri: true, invoke });
  assert.throws(() => bridge.read({}), /必须含 path/);
  assert.throws(() => bridge.write({}, 'x'), /必须含 path/);
});

test('io-bridge: 浏览器模式目标缺 handle 时抛错', () => {
  const bridge = createIoBridge({ isTauri: false });
  assert.throws(() => bridge.read({ path: '/x' }), /必须含 handle/);
  assert.throws(() => bridge.write({ path: '/x' }, 'x'), /必须含 handle/);
});

test('io-bridge: content 非字符串时 write 抛错', () => {
  const bridge = createIoBridge({ isTauri: false });
  assert.throws(() => bridge.write({ handle: {} }, 123), /content 必须为字符串/);
});

// ─────────────────────────────────────────────────────────────────────────
// 2) save.js
// ─────────────────────────────────────────────────────────────────────────

function fakePane(content) {
  return { view: { state: { doc: { toString: () => content } } } };
}

test('save.js: saveActivePane 取活动栏(A)内容并调用 ioBridge.write', async () => {
  const writes = [];
  const io = { write: async (target, content) => { writes.push({ target, content }); } };
  const panes = {
    a: { ...fakePane('AAA'), target: { path: '/a.md' } },
    b: { ...fakePane('BBB'), target: { path: '/b.md' } },
    c: { ...fakePane('CCC'), target: { path: '/c.md' } },
  };
  const res = await saveActivePane(panes, io);
  assert.equal(res.saved, true);
  assert.equal(res.pane, 'a');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].target, { path: '/a.md' });
  assert.equal(writes[0].content, 'AAA');
});

test('save.js: 活动栏切换后 saveActivePane 使用对应栏内容', async () => {
  const writes = [];
  const io = { write: async (target, content) => { writes.push({ target, content }); } };
  const panes = {
    a: { ...fakePane('AAA'), target: { path: '/a.md' } },
    b: { ...fakePane('BBB'), target: { path: '/b.md' } },
    c: { ...fakePane('CCC'), target: { path: '/c.md' } },
  };
  setActivePane('b');
  assert.equal(getActivePane(), 'b');
  const res = await saveActivePane(panes, io);
  assert.equal(res.pane, 'b');
  assert.equal(writes[0].content, 'BBB');
  // 还原默认活动栏，避免影响其它用例
  setActivePane('a');
});

test('save.js: 活动栏取值非法时 setActivePane 抛错', () => {
  assert.throws(() => setActivePane('x'), /a\/b\/c/);
});

test('save.js: 无 target 的活动栏回退为 { saved:false, reason:"no-target" }', async () => {
  const writes = [];
  const io = { write: async () => { writes.push(true); } };
  const panes = {
    a: { ...fakePane('AAA') }, // 无 target
    b: { ...fakePane('BBB'), target: { path: '/b.md' } },
    c: { ...fakePane('CCC'), target: { path: '/c.md' } },
  };
  const res = await saveActivePane(panes, io);
  assert.equal(res.saved, false);
  assert.equal(res.pane, 'a');
  assert.equal(res.reason, 'no-target');
  assert.equal(writes.length, 0);
});

test('save.js: saveAs 对指定栏另存并调用 ioBridge.write', async () => {
  const writes = [];
  const io = { write: async (target, content) => { writes.push({ target, content }); } };
  const panes = {
    a: { ...fakePane('AAA'), target: { path: '/a.md' } },
    b: { ...fakePane('BBB'), target: { path: '/b.md' } },
    c: { ...fakePane('CCC'), target: { path: '/c.md' } },
  };
  const res = await saveAs('c', panes, io);
  assert.equal(res.saved, true);
  assert.equal(res.pane, 'c');
  assert.equal(writes[0].content, 'CCC');
});

test('save.js: saveAs 缺少 target 时抛错', async () => {
  const io = { write: async () => {} };
  const panes = { a: { ...fakePane('AAA') } };
  await assert.rejects(() => saveAs('a', panes, io), /未提供保存目标/);
});

test('save.js: exportDiff 通过注入 buildDiffText 返回非空 diff 字符串', async () => {
  const panes = {
    a: fakePane('line1\nline2\nline3'),
    b: fakePane('line1\nCHANGED\nline3'),
  };
  let captured = null;
  const fakeBuildDiffText = (a, b) => {
    captured = { a, b };
    return '@@ -1,3 +1,3 @@\n line1\n-line2\n+CHANGED\n line3\n';
  };
  const out = await exportDiff(panes, { buildDiffText: fakeBuildDiffText });
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0, '应返回非空 diff 文本');
  // 验证 A/B 两栏文档被正确透传给 buildDiffText
  assert.equal(captured.a, 'line1\nline2\nline3');
  assert.equal(captured.b, 'line1\nCHANGED\nline3');
});

test('save.js: exportDiff B 缺失时回退到 C（注入 buildDiffText）', async () => {
  const panes = {
    a: fakePane('AAA'),
    c: fakePane('CCC'),
  };
  let captured = null;
  const fakeBuildDiffText = (a, b) => { captured = { a, b }; return 'DIFF'; };
  const out = await exportDiff(panes, { buildDiffText: fakeBuildDiffText });
  assert.equal(out, 'DIFF');
  assert.equal(captured.b, 'CCC');
});

test('save.js: exportDiff 动态 import 路径应解析到 src/compare-diff-export.js（回归 BUG-1）', () => {
  // save.js 位于 src/compare/，目标在上级 src/，正确相对路径为 ../compare-diff-export.js
  const target = path.resolve(ROOT, 'src', 'compare-diff-export.js');
  assert.ok(fs.existsSync(target), '动态 import 目标 src/compare-diff-export.js 应存在');
});

// ─────────────────────────────────────────────────────────────────────────
// 3) chunk-ops
// ─────────────────────────────────────────────────────────────────────────

test('chunk-ops: rejectChunk 从列表移除指定 id（不可变）', () => {
  const list = [
    { id: 1, srcFrom: 0, srcTo: 5 },
    { id: 2, srcFrom: 6, srcTo: 9 },
    { id: 3, srcFrom: 10, srcTo: 12 },
  ];
  const next = rejectChunk(list, 2);
  assert.deepEqual(next.map((c) => c.id), [1, 3]);
  // 原列表不被修改
  assert.equal(list.length, 3);
});

test('chunk-ops: selectNonConflicting 仅保留非冲突块', () => {
  const chunks = [
    { id: 1, conflict: true },
    { id: 2, conflict: false },
    { id: 3 }, // 默认非冲突
  ];
  const out = selectNonConflicting(chunks);
  assert.deepEqual(out.map((c) => c.id), [2, 3]);
});

// 构造可记录 dispatch 的 fake view 工厂
function makeFakeViews(srcText) {
  const srcView = {
    state: { doc: { sliceString: (from, to) => srcText.slice(from, to) } },
  };
  const dispatchCalls = [];
  const dstView = {
    dispatch(spec) {
      dispatchCalls.push(spec);
    },
  };
  return { srcView, dstView, dispatchCalls };
}

// 用例 A：3 个非冲突块 → 合并为单次 dispatch，changes 数组长度 3，
// 每项 from/to/insert 均等于「基于原始文档」的期望值。
// （旧实现逐个 dispatch 会调用 3 次并发生位置漂移，本用例是其回归护栏。）
test('chunk-ops: applyNonConflicting 3 个非冲突块合并为单次 dispatch（修复漂移）', () => {
  const { srcView, dstView, dispatchCalls } = makeFakeViews('ABCDEFGHIJ'); // 10 字符
  const chunks = [
    { id: 0, conflict: true, srcFrom: 0, srcTo: 2, dstFrom: 0, dstTo: 1 }, // 冲突，应被排除
    { id: 1, srcFrom: 0, srcTo: 3, dstFrom: 0, dstTo: 1 },  // ABC -> [0,1)
    { id: 2, srcFrom: 3, srcTo: 6, dstFrom: 2, dstTo: 4 },  // DEF -> [2,4)
    { id: 3, srcFrom: 6, srcTo: 10, dstFrom: 5, dstTo: 8 }, // GHIJ -> [5,8)
  ];
  const n = applyNonConflicting({ chunks, srcView, dstView });
  assert.equal(n, 3);
  // 关键：只派发一次
  assert.equal(dispatchCalls.length, 1);
  const changes = dispatchCalls[0].changes;
  assert.ok(Array.isArray(changes), 'dispatch 的 changes 应为数组');
  assert.equal(changes.length, 3);
  assert.deepEqual(changes, [
    { from: 0, to: 1, insert: 'ABC' },
    { from: 2, to: 4, insert: 'DEF' },
    { from: 5, to: 8, insert: 'GHIJ' },
  ]);
});

// 用例 B：块区间重叠时抛错（不静默产出损坏文档）
test('chunk-ops: applyNonConflicting 块区间重叠时抛错', () => {
  const { srcView, dstView, dispatchCalls } = makeFakeViews('ABCDEFGHIJ');
  const chunks = [
    { id: 1, srcFrom: 0, srcTo: 3, dstFrom: 0, dstTo: 5 },  // [0,5)
    { id: 2, srcFrom: 3, srcTo: 6, dstFrom: 3, dstTo: 6 },  // [3,6) 与前一个重叠
  ];
  assert.throws(() => applyNonConflicting({ chunks, srcView, dstView }), /重叠/);
  assert.equal(dispatchCalls.length, 0, '重叠时不应派发任何变更');
});

// 用例 C：chunks 为空（或全冲突）时返回 0 且不调用 dispatch
test('chunk-ops: applyNonConflicting 空列表返回 0 且不 dispatch', () => {
  const { srcView, dstView, dispatchCalls } = makeFakeViews('ABCDEFGHIJ');
  assert.equal(applyNonConflicting({ chunks: [], srcView, dstView }), 0);
  assert.equal(dispatchCalls.length, 0);
  const allConflict = [
    { id: 1, conflict: true, srcFrom: 0, srcTo: 1, dstFrom: 0, dstTo: 1 },
  ];
  assert.equal(applyNonConflicting({ chunks: allConflict, srcView, dstView }), 0);
  assert.equal(dispatchCalls.length, 0);
});

// 用例 C2：dst 区间越界时钳制到文档末尾，而非抛 RangeError。
// 背景：@codemirror/merge 的 chunk `to` 可能指向文档末尾之后（尾部块的 toA 常等于
// 「文档长度 + 1」，表达“连同行尾换行一起替换”）。未钳制会让「应用非冲突变更」在
// 最后一个差异块位于文末时整体失败。此用例是该修复的回归护栏。
test('chunk-ops: applyNonConflicting 对越界 dst 区间做钳制', () => {
  const srcText = 'ABCDEFGHIJ';
  const dstText = '0123456789'; // 长度 10
  const srcView = {
    state: { doc: { sliceString: (from, to) => srcText.slice(from, to) } },
  };
  const dispatchCalls = [];
  const dstView = {
    // 与生产环境一致：提供 state 以便读取文档长度
    state: { doc: { length: dstText.length } },
    dispatch(spec) {
      dispatchCalls.push(spec);
    },
  };
  const chunks = [
    // dstTo = 11 越过文档末尾（10），应被钳制为 10
    { id: 1, srcFrom: 0, srcTo: 3, dstFrom: 8, dstTo: 11 },
  ];
  const n = applyNonConflicting({ chunks, srcView, dstView });
  assert.equal(n, 1);
  assert.equal(dispatchCalls.length, 1);
  assert.deepEqual(dispatchCalls[0].changes, [
    { from: 8, to: 10, insert: 'ABC' },
  ]);
});

// 用例 C3：dstView 未提供 state 时降级放行（契约保真）。
// applyNonConflicting 对 dstView 的原始契约只要求 dispatch，读 state 属可选增强，
// 缺失时必须退化为「不钳制」，行为与钳制前一致，不可抛错。
test('chunk-ops: applyNonConflicting 在 dstView 无 state 时不抛错', () => {
  const { srcView, dstView, dispatchCalls } = makeFakeViews('ABCDEFGHIJ');
  const chunks = [{ id: 1, srcFrom: 0, srcTo: 3, dstFrom: 0, dstTo: 99 }];
  assert.doesNotThrow(() => applyNonConflicting({ chunks, srcView, dstView }));
  assert.equal(dispatchCalls.length, 1);
  // 无 state 时原样放行，不做钳制
  assert.deepEqual(dispatchCalls[0].changes, [
    { from: 0, to: 99, insert: 'ABC' },
  ]);
});

// 用例 D：acceptChunk 非法参数抛错
test('chunk-ops: acceptChunk 参数非法时抛错', () => {
  const { srcView, dstView } = makeFakeViews('ABCDEFGHIJ');
  // from > to
  assert.throws(
    () => acceptChunk({ srcView, dstView, srcFrom: 5, srcTo: 2, dstFrom: 0, dstTo: 1 }),
    /from <= to/
  );
  // 非数字
  assert.throws(
    () => acceptChunk({ srcView, dstView, srcFrom: 'a', srcTo: 2, dstFrom: 0, dstTo: 1 }),
    /必须为数字/
  );
  // 缺 view
  assert.throws(
    () => acceptChunk({ srcView: null, dstView, srcFrom: 0, srcTo: 1, dstFrom: 0, dstTo: 1 }),
    /需要 srcView/
  );
});


test('chunk-ops: filterReject 空列表安全返回空数组', () => {
  assert.deepEqual(filterReject(null, 1), []);
  assert.deepEqual(filterReject([], 1), []);
});
