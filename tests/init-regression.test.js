/**
 * init-regression.test.js — 初始化崩溃反模式源码守卫（M2）
 *
 * 目的：防止 C1 / C2 两类「构造期初始化崩溃」反模式在后续改动中复发。
 * 这些 bug 都会使 `new EditorView(...)` 在构造期即抛 TypeError，导致编辑器
 * 实例从未创建（表现为按键全失效 / 双击 .md 无内容 / 主题切换失效）。
 *
 * 由于 `init()` 依赖大量浏览器 API（document / mermaid / chrome.storage /
 * Tauri / ResizeObserver），完整运行时实测极脆；此处采用源码模式正则 + 括号
 * 配对守卫，直接在合并前锁死反模式，成本极低且不依赖浏览器环境。
 *
 *   C1: selectedBracketHighlight 误以 `()` 调用（ViewPlugin 返回值不可被调用）
 *   C2: EditorState.languageData.of 传入普通对象而非「返回数组的函数」
 *
 * 同时锁定 M1 修复：markdown 渲染结果必须经理 DOMPurify 净化后才注入 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 重构后扩展定义迁移到 editor-extensions.js（createEditorExtensions 工厂，承载
// selectedBracketHighlight 裸用 / languageData.of 返回数组函数等 C1/C2 守卫）；
// 而 DOMPurify 净化守卫（M1）仍在 editor.js。拼接两者文本以满足全部契约守卫。
const editorSrc = readFileSync(new URL('../src/editor.js', import.meta.url), 'utf8');
const extSrc = readFileSync(new URL('../src/editor-extensions.js', import.meta.url), 'utf8');
const src = editorSrc + '\n' + extSrc;

// ─── C1: selectedBracketHighlight 不得被 `()` 调用 ───────────────────────────

test('C1: selectedBracketHighlight never called with () (ViewPlugin return value is not callable)', () => {
  assert.equal(
    /\bselectedBracketHighlight\s*\(/.test(src),
    false,
    'selectedBracketHighlight 被 () 调用会抛 "Xet is not a function"，须作为扩展裸用'
  );
  // 同时确认它确实作为扩展被编排进 extensions 数组（逗号分隔项）
  assert.ok(
    /selectedBracketHighlight\s*,/.test(src),
    'selectedBracketHighlight 应作为扩展裸用（如 `selectedBracketHighlight,`）'
  );
});

// ─── C2: languageData.of 必须是「返回数组的函数」而非普通对象 ─────────────────

test('C2: EditorState.languageData.of receives a function returning an array, not a plain object', () => {
  // 致命反模式：languageData.of({ closeBrackets: {...} })
  assert.equal(
    /\blanguageData\.of\(\s*\{/.test(src),
    false,
    'languageData.of 传入普通对象会使 languageDataAt 的 for...of 抛 "not iterable"'
  );
  // 正确形态：languageData.of((state, pos) => [{ ... }])
  assert.ok(
    /\blanguageData\.of\(\s*\(/.test(src),
    'languageData.of 应传入返回数组的 provider 函数'
  );
});

// ─── M1: 预览 HTML 必须经 DOMPurify 净化 ─────────────────────────────────────

test('M1: markdown preview HTML is sanitized by DOMPurify before innerHTML', () => {
  assert.ok(
    /\bimport DOMPurify from 'dompurify'/.test(src),
    '应导入 dompurify 依赖'
  );
  assert.ok(
    src.includes('function sanitizePreviewHtml'),
    '应定义 sanitizePreviewHtml 净化函数'
  );
  assert.ok(
    src.includes('sanitizePreviewHtml(md.render'),
    'md.render 的结果必须经理 sanitizePreviewHtml 净化后再赋值给 preview html'
  );
  assert.ok(
    src.includes('DOMPurify.sanitize'),
    '净化须经由 DOMPurify.sanitize 实现'
  );
});

// ─── T1: init() 必须接入扩展工厂 + 追加编辑页专属 updateListener 胶水 ─────────
// 背景：既有守卫（C1/C2/M1）只锁「库函数契约」（selectedBracketHighlight 裸用、
// languageData.of 返回函数、DOMPurify 净化），不锁「业务调用点」。若 init() 漏调
// createEditorExtensions() 或漏追加 EditorView.updateListener.of(...)，编辑器仍会
// 建出来但缺预览联动 / 状态更新 / 自动保存，且旧守卫仍绿。本组在编辑器源码层面锁死
// 这两个业务调用点（§8 / §8.3）。

test('T1: init() 调用 createEditorExtensions() 工厂接入共享扩展', () => {
  assert.ok(
    editorSrc.includes('createEditorExtensions('),
    'init 应通过 createEditorExtensions(...) 接入共享扩展工厂（§8）'
  );
  // 且是「真正调用工厂」而非仅 import：应存在 const extensions = createEditorExtensions({...})
  assert.ok(
    /const extensions = createEditorExtensions\(\{/.test(editorSrc),
    '应以 `const extensions = createEditorExtensions({...})` 形式真正调用工厂'
  );
});

test('T1: init() 在 new EditorView 前追加编辑页专属 EditorView.updateListener.of(...) 胶水', () => {
  const idxUpdate = editorSrc.indexOf('EditorView.updateListener.of(');
  const idxNew = editorSrc.indexOf('new EditorView(');
  assert.ok(idxUpdate > -1, 'init 应保留 EditorView.updateListener.of(...) 编辑页胶水');
  assert.ok(idxNew > -1, 'init 应构造 new EditorView(...)');
  // 胶水必须在 new EditorView 之前（即作为 extensions 数组的 push 项被消费），
  // 否则即便写了 updateListener 也进不了编辑器扩展链，预览/状态/自动保存全部失效。
  assert.ok(
    idxUpdate < idxNew,
    'updateListener 应在 new EditorView 之前追加，确保进入编辑器扩展链'
  );
  // 且该胶水确实是「追加」到 extensions 数组（而非被误删 / 孤立）。
  assert.ok(
    editorSrc.includes('extensions.push('),
    'updateListener 应通过 extensions.push(...) 追加进扩展数组'
  );
});

test('T1: 工厂输出与 updateListener 两者俱在（编辑页扩展链路完整）', () => {
  assert.ok(editorSrc.includes('createEditorExtensions('));
  assert.ok(editorSrc.includes('EditorView.updateListener.of('));
  assert.ok(editorSrc.includes('new EditorView('));
});
