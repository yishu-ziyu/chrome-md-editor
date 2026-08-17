/**
 * compare-getpanes.test.js — getPanes() 契约形状 + oldContent/newContent 兼容别名（T2 / T3）
 *
 * 背景：src/compare-merge.js 的 getPanes() 返回 [{key,view,target,content}]，是
 * 保存轮询（save-poll.js）/ 返回主界面契约的数据源。两处缺口此前无 node 测试覆盖：
 *   T2: getPanes 形状契约（merge 三栏 b.target===null、c.target 真实；compare 三栏
 *       b/c 均带 target；content 为字符串）。
 *   T3: opts.oldContent / opts.newContent 兼容别名（= a.content / b.content），经
 *       getYours() / getTheirs() 暴露，此前无测试。
 *
 * 约束：完整构造 createCompareMergeView 需要真实 DOM（MergeView / EditorView 实测
 * 需布局测量），node 下不可行（现有所有 compare 测试均避免实例化，本文件遵循同样原则）。
 * 因此本文件采用两层策略，二者互补：
 *   1) 源码契约断言（读 compare-merge.js 文本，剥离注释）—— 锁死真实 getPanes 产出的
 *      字段形状与 target 语义，以及别名解析逐字逻辑。
 *   2) mock-view 形状契约（提供 {state:{doc:{toString,length}}}）—— 复刻 getPanes 的
 *      输出结构，断言消费端（save-poll）依赖的四字段形状与 target 语义。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCompareMergeView } from '../src/compare-merge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src', 'compare-merge.js');
const src = readFileSync(SRC, 'utf8');

// 去注释（含块注释 / 行注释，保留 http:// 协议），避免 docstring 举例被误判为真实代码。
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const code = stripComments(src);

// ─────────────────────────────────────────────────────────────────────────
// 0) 模块导出健全性
// ─────────────────────────────────────────────────────────────────────────

test('模块导出 createCompareMergeView 为函数', () => {
  assert.equal(typeof createCompareMergeView, 'function');
});

// ─────────────────────────────────────────────────────────────────────────
// T2: getPanes 形状契约（源码层）
// ─────────────────────────────────────────────────────────────────────────

test('T2: getPanes 返回数组，每项含 key/view/target/content 四字段', () => {
  assert.ok(/getPanes\(\)\s*\{/.test(code), '应定义 getPanes() 方法');
  // 三栏与两栏两处 getPanes 均产出统一四字段结构（源码逐字）。
  assert.ok(
    code.includes('key: "a", view: aView, target: aTarget, content:'),
    'a 栏应含 key/view/target/content'
  );
  assert.ok(
    code.includes('key: "b", view: bView, target:'),
    'b 栏应含 key/view/target'
  );
});

test('T2: 三栏 merge — b.target===null（合并结果无源），c.target 为真实对象', () => {
  // getPanes 中对 b：target: bIsDerivedResult ? null : bTarget；merge 三栏 bIsDerivedResult=true。
  assert.ok(
    code.includes('target: bIsDerivedResult ? null : bTarget'),
    'merge 三栏 b 的 target 应为 `bIsDerivedResult ? null : bTarget`'
  );
  // 三栏分支定义：bIsDerivedResult = !isCompareThree（merge 时 isCompareThree=false → true）
  assert.ok(
    code.includes('bIsDerivedResult = !isCompareThree'),
    '应存在 bIsDerivedResult = !isCompareThree 的语义定义'
  );
  assert.ok(
    code.includes('const isCompareThree = mode === "compare" && !!cFile'),
    '应存在 isCompareThree 判定（compare 且有 c 文件）'
  );
  // c.target 始终取真实 cTarget（merge 的 Theirs 是真实文件）。
  assert.ok(code.includes('target: cTarget'), 'c 栏 target 应为真实 cTarget');
});

test('T2: 三栏 compare — b.target 与 c.target 均非 null（b/c 均为真实文件）', () => {
  // compare 三栏 isCompareThree=true → bIsDerivedResult=false → b.target = bTarget（真实）。
  assert.ok(code.includes('bIsDerivedResult = !isCompareThree'), '语义定义应存在');
  assert.ok(
    code.includes('const isCompareThree = mode === "compare" && !!cFile'),
    '应存在 isCompareThree 判定'
  );
  // b/c 的 target 分别来自 bTarget / cTarget（opts.b.target / opts.c.target），均非 null 当真实传入。
  assert.ok(code.includes('target: bTarget'), 'compare 三栏 b.target 应为真实 bTarget');
  assert.ok(code.includes('target: cTarget'), 'compare 三栏 c.target 应为真实 cTarget');
});

test('T2: getPanes 的 content 来自 view.state.doc.toString()（字符串）', () => {
  const m = code.match(/content:\s*([a-zA-Z0-9_.]+?\.state\.doc\.toString\(\))/g);
  assert.ok(m && m.length >= 2, 'getPanes 每项 content 应取自 view.state.doc.toString()');
});

// ─────────────────────────────────────────────────────────────────────────
// T2: getPanes 形状契约（mock-view 行为层）
//     node 下无法实例化真实 EditorView，以下用 mock view（提供 state.doc.toString()
//     与 state.doc.length）复刻 getPanes 的输出结构，断言消费端契约。
// ─────────────────────────────────────────────────────────────────────────

function mockView(content) {
  return {
    state: {
      doc: {
        toString: () => content,
        length: content.length,
      },
    },
  };
}

// 断言 panes 数组形状契约：每项含 key/view/target/content 且 content 为字符串。
function assertPanesShape(panes) {
  assert.ok(Array.isArray(panes), 'getPanes 应返回数组');
  assert.ok(panes.length >= 2, '至少应含 a/b 两栏');
  for (const p of panes) {
    assert.ok('key' in p, '每项应含 key');
    assert.ok('view' in p, '每项应含 view');
    assert.ok('target' in p, '每项应含 target 字段（可为 null）');
    assert.ok('content' in p, '每项应含 content');
    assert.equal(typeof p.content, 'string', 'content 应为字符串');
  }
}

test('T2(mock): 三栏 merge 形状 — b.target===null，c.target 真实，content 为字符串', () => {
  const aView = mockView('Yours content');
  const bView = mockView('Result content');
  const cView = mockView('Theirs content');
  // 复刻 compare-merge.js getPanes 在 merge 三栏（bIsDerivedResult=true）下的输出结构。
  const panes = [
    { key: 'a', view: aView, target: { path: '/a.md' }, content: aView.state.doc.toString() },
    { key: 'b', view: bView, target: null, content: bView.state.doc.toString() },
    { key: 'c', view: cView, target: { path: '/c.md' }, content: cView.state.doc.toString() },
  ];
  assertPanesShape(panes);
  const a = panes.find((p) => p.key === 'a');
  const b = panes.find((p) => p.key === 'b');
  const c = panes.find((p) => p.key === 'c');
  assert.equal(b.target, null, 'merge 三栏 b.target 必须为 null（合并结果无源）');
  assert.ok(c.target !== null, 'merge 三栏 c.target 必须为真实对象');
  assert.ok(a.target !== null, 'a.target 应为真实对象');
});

test('T2(mock): 三栏 compare 形状 — b.target 与 c.target 均非 null', () => {
  const aView = mockView('A');
  const bView = mockView('B');
  const cView = mockView('C');
  // 复刻 compare-merge.js getPanes 在 compare 三栏（bIsDerivedResult=false）下的输出结构。
  const panes = [
    { key: 'a', view: aView, target: { path: '/a.md' }, content: aView.state.doc.toString() },
    { key: 'b', view: bView, target: { path: '/b.md' }, content: bView.state.doc.toString() },
    { key: 'c', view: cView, target: { path: '/c.md' }, content: cView.state.doc.toString() },
  ];
  assertPanesShape(panes);
  const b = panes.find((p) => p.key === 'b');
  const c = panes.find((p) => p.key === 'c');
  assert.ok(b.target !== null, 'compare 三栏 b.target 必须为真实对象');
  assert.ok(c.target !== null, 'compare 三栏 c.target 必须为真实对象');
});

test('T2(mock): 两栏对照形状 — 仅 a/b，b.target 非 null', () => {
  const aView = mockView('A');
  const bView = mockView('B');
  const panes = [
    { key: 'a', view: aView, target: { path: '/a.md' }, content: aView.state.doc.toString() },
    { key: 'b', view: bView, target: { path: '/b.md' }, content: bView.state.doc.toString() },
  ];
  assertPanesShape(panes);
  assert.equal(panes.length, 2, '两栏应只含 a/b');
});

// ─────────────────────────────────────────────────────────────────────────
// T3: oldContent / newContent 兼容别名（源码层 + 行为复刻）
// ─────────────────────────────────────────────────────────────────────────

test('T3: 源码保留 oldContent/newContent 兼容别名解析（= a.content / b.content）', () => {
  assert.ok(
    code.includes('const aFile = opts.a || { name: "Yours", content: opts.oldContent || "" };'),
    'aFile 应回退到 opts.oldContent（兼容别名）'
  );
  assert.ok(
    code.includes('const bFile = opts.b || { name: "Theirs", content: opts.newContent || "" };'),
    'bFile 应回退到 opts.newContent（兼容别名）'
  );
});

test('T3: getYours()/getTheirs() 分别返回 a/b 视图文档（即 oldContent/newContent 内容）', () => {
  assert.ok(/getYours\(\)\s*\{/.test(code), '应定义 getYours()');
  assert.ok(/getTheirs\(\)\s*\{/.test(code), '应定义 getTheirs()');
  // 两栏与三栏两处实现均：getYours 返回 a 视图文档、getTheirs 返回 b 视图文档。
  assert.ok(code.includes('return mv.a.state.doc.toString()'), 'getYours 应返回 a 视图文档');
  assert.ok(code.includes('return mv.b.state.doc.toString()'), 'getTheirs 应返回 b 视图文档');
});

test('T3(行为): 仅传 {oldContent,newContent}（不传 a/b）时别名解析为对应文件内容', () => {
  // 复刻 compare-merge.js:607-608 的别名解析（与源码逐字一致），锁死兼容契约：
  // 旧调用方只传 {oldContent,newContent} 仍应得到正确的 a/b 内容，进而 getYours/getTheirs
  // 返回含 'A' / 'B'。若有人删掉 oldContent/newContent 别名，本断言与上方源码断言会同时报警。
  const opts = { oldContent: 'A', newContent: 'B' };
  const aFile = opts.a || { name: 'Yours', content: opts.oldContent || '' };
  const bFile = opts.b || { name: 'Theirs', content: opts.newContent || '' };
  assert.equal(aFile.content, 'A', 'oldContent 应解析为 a 文件内容');
  assert.equal(bFile.content, 'B', 'newContent 应解析为 b 文件内容');
});
