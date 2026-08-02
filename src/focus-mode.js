// ============================================================
// A-8 专注模式 + 显示字号 / 界面密度
//  - 专注模式：给 documentElement 加 .focus-mode，由 editor.css 淡化非当前行
//  - 打字机：光标行始终居中（选区变化时滚动到视图中部）
//  - 显示设置：编辑器/预览独立字号 + 界面密度，写入 CSS 变量并持久化 localStorage
// 纯前端、不改 Markdown 源码。
// ============================================================

const LS = {
  focus: 'md-editor-focus-mode',
  typewriter: 'md-editor-typewriter',
  editorFont: 'md-editor-font-size',
  previewFont: 'md-editor-preview-font-size',
  density: 'md-editor-density',
};

let focusMode = localStorage.getItem(LS.focus) === '1';
let typewriter = localStorage.getItem(LS.typewriter) === '1';

// ---- 专注 / 打字机 ----
export function isFocusMode() { return focusMode; }
export function isTypewriter() { return typewriter; }

export function toggleFocusMode() {
  focusMode = !focusMode;
  localStorage.setItem(LS.focus, focusMode ? '1' : '0');
  document.documentElement.classList.toggle('focus-mode', focusMode);
    return focusMode;
}

export function toggleTypewriter() {
  typewriter = !typewriter;
  localStorage.setItem(LS.typewriter, typewriter ? '1' : '0');
    return typewriter;
}

// 选区变化时，若开启打字机则把光标行滚到视图中部
export function maybeCenterActiveLine(view) {
  if (!typewriter || !view) return;
  try {
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    const lineTop = view.lineBlockAt(line.from).top;
    const target = lineTop - view.scrollDOM.clientHeight / 2 + 20;
    view.scrollDOM.scrollTop = Math.max(0, target);
  } catch (err) {
      }
}

// ---- 显示字号 / 密度 ----
export function getEditorFontSize() { return parseInt(localStorage.getItem(LS.editorFont) || '0', 10); }
export function getPreviewFontSize() { return parseInt(localStorage.getItem(LS.previewFont) || '0', 10); }
export function getDensity() { return localStorage.getItem(LS.density) || 'standard'; }

const DENSITY_GAP = { compact: '4px', standard: '8px', comfortable: '14px' };

export function applyDisplaySettings() {
  const root = document.documentElement.style;
  const ef = getEditorFontSize();
  if (ef > 0) root.setProperty('--editor-font-size', `${ef}px`);
  const pf = getPreviewFontSize();
  if (pf > 0) root.setProperty('--preview-font-size', `${pf}px`);
  const d = getDensity();
  root.setProperty('--ui-gap', DENSITY_GAP[d] || DENSITY_GAP.standard);
}

export function setEditorFontSize(px) {
  localStorage.setItem(LS.editorFont, String(px));
  if (px > 0) document.documentElement.style.setProperty('--editor-font-size', `${px}px`);
  else document.documentElement.style.removeProperty('--editor-font-size');
  }

export function setPreviewFontSize(px) {
  localStorage.setItem(LS.previewFont, String(px));
  if (px > 0) document.documentElement.style.setProperty('--preview-font-size', `${px}px`);
  else document.documentElement.style.removeProperty('--preview-font-size');
  }

export function setDensity(level) {
  localStorage.setItem(LS.density, level);
  document.documentElement.style.setProperty('--ui-gap', DENSITY_GAP[level] || DENSITY_GAP.standard);
  }

// 初始化：恢复持久化设置
export function initDisplaySettings() {
  document.documentElement.classList.toggle('focus-mode', focusMode);
  applyDisplaySettings();
  }
