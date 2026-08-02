/**
 * init-regression.test.js — 初始化崩溃反模式源码守卫（M2）
 *
 * 目的：防止 C1 / C2 / C3 三类「构造期初始化崩溃」反模式在后续改动中复发。
 * 这些 bug 都会使 `new EditorView(...)` 在构造期即抛 TypeError，导致编辑器
 * 实例从未创建（表现为按键全失效 / 双击 .md 无内容 / 主题切换失效 / 探针无 log）。
 *
 * 由于 `init()` 依赖大量浏览器 API（document / mermaid / chrome.storage /
 * Tauri / ResizeObserver），完整运行时实测极脆；此处采用源码模式正则 + 括号
 * 配对守卫，直接在合并前锁死反模式，成本极低且不依赖浏览器环境。
 *
 *   C1: selectedBracketHighlight 误以 `()` 调用（ViewPlugin 返回值不可被调用）
 *   C2: EditorState.languageData.of 传入普通对象而非「返回数组的函数」
 *   C3: updateListener 探针在构造期访问未初始化的全局 `editor.scrollDOM`
 *       （改用 update.view.scrollDOM 并整段 try/catch）
 *
 * 同时锁定 M1 修复：markdown 渲染结果必须经理 DOMPurify 净化后才注入 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/editor.js', import.meta.url), 'utf8');

// 提取 EditorView.updateListener.of((update) => { ... }) 的完整箭头函数体
// （括号配对，仅在块内有 `{`/`}` 且不在字符串/注释中时才计数；该块内无此类干扰）。
function extractUpdateListenerBlock(source) {
  const marker = 'EditorView.updateListener.of((update) => {';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

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

// ─── C3: updateListener 探针不得访问未初始化的 editor.scrollDOM ────────────────

test('C3: updateListener probe uses update.view.scrollDOM and is guarded by try/catch', () => {
  const block = extractUpdateListenerBlock(src);
  assert.ok(block, '未在源码中找到 EditorView.updateListener.of((update) => { 块');
  // 修复点：探针通过回调参数 update.view 取得 view，再访问 view.scrollDOM
  // （源码写法：const view = update.view; ... view.scrollDOM）
  assert.ok(
    block.includes('view.scrollDOM') && /update\.view/.test(block),
    'updateListener 应改用 update.view 取得的 view.scrollDOM，而非全局 editor.scrollDOM'
  );
  // 反模式：在构造期（全局 editor 仍为 null 时）访问 editor.scrollDOM
  assert.equal(
    block.includes('editor.scrollDOM'),
    false,
    'updateListener 块内不得出现 editor.scrollDOM（构造期全局 editor 为 null）'
  );
  // 整段探针须被 try/catch 包裹，确保探针异常不再中断初始化
  assert.ok(block.includes('try {'), 'updateListener 探针块应含 try {');
  assert.ok(/}\s*catch/.test(block), 'updateListener 探针块应含 } catch');
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
