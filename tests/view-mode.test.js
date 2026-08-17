// BUG1 回归单测：视图沉浸/日常模式下 ⊞ 按钮的 reparent 逻辑（linkedom 模拟 DOM）
// 覆盖 code-review-combo 审计 F-03（BUG1/BUG2 修复零单测覆盖）。
import { parseHTML } from 'linkedom';
import { applyViewMode } from '../src/view-mode.js';
import { test } from 'node:test';
import assert from 'node:assert';

function setup() {
  const { document } = parseHTML(`<!doctype html><html><body>
    <main id="editorMain">
      <div id="toolbar"><button id="btnChromeMode">⊞</button></div>
      <div id="fileSidebar"></div>
    </main>
  </body></html>`);
  global.document = document;
  return document;
}

test('immersive：工具栏隐藏且 ⊞ 按钮脱离被隐藏容器挂到 body', () => {
  const document = setup();
  applyViewMode('immersive');
  const toolbar = document.getElementById('toolbar');
  const btn = document.getElementById('btnChromeMode');
  assert.ok(toolbar.classList.contains('view-hidden'), 'immersive 下 #toolbar 应被 view-hidden');
  assert.strictEqual(btn.parentElement, document.body, '⊞ 应脱离 #toolbar 挂到 body');
  assert.ok(btn.classList.contains('force-visible'), '⊞ 应带 force-visible');
});

test('immersive→daily：⊞ 按钮精确插回 #toolbar 且不再 force-visible', () => {
  const document = setup();
  applyViewMode('immersive');
  applyViewMode('daily');
  const toolbar = document.getElementById('toolbar');
  const btn = document.getElementById('btnChromeMode');
  assert.ok(!toolbar.classList.contains('view-hidden'), 'daily 下 #toolbar 不应有 view-hidden');
  assert.strictEqual(btn.parentElement.id, 'toolbar', '⊞ 应回到 #toolbar 内');
  assert.ok(!btn.classList.contains('force-visible'), 'daily 下 ⊞ 不应带 force-visible');
});

test('focus：文件侧栏隐藏（view-hidden）且侧栏恢复条点亮', () => {
  const document = setup();
  // 注入侧栏恢复条，模拟 editor.js 的 initFileSidebar
  const toggle = document.createElement('div');
  toggle.id = 'sidebarToggle';
  document.getElementById('editorMain').appendChild(toggle);
  applyViewMode('focus');
  const sidebar = document.getElementById('fileSidebar');
  assert.ok(sidebar.classList.contains('view-hidden'), 'focus 下 #fileSidebar 应被 view-hidden');
  assert.ok(document.getElementById('sidebarToggle').classList.contains('visible'), 'focus 下恢复条应 visible');
});
