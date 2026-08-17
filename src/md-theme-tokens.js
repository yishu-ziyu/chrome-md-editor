// Markdown 语法高亮：多套配色方案令牌（设计层）
// 本文件为《Markdown 语法高亮实施方案》Phase 1 产物（原创设计，非外部复用）。
// 设计要点：
//  - 配色方案（data-color-scheme）与深浅主题（data-theme）正交，互不耦合；
//  - 真实颜色值定义在 editor.css 的 [data-color-scheme] 变量块中，本文件只暴露
//    “配色清单 + 读写 localStorage + 切换 <html data-color-scheme> 属性”的薄封装；
//  - 采用 class 驱动 + CSS 变量分层，切换配色仅需改 data-color-scheme 属性，
//    编辑区(CM6)与预览区(markdown-it/hljs)的样式瞬时跟随，无需 reconfigure 高亮。

/** 支持的配色方案清单（label 用于切换 UI 下拉） */
export const COLOR_SCHEMES = [
  { id: 'classic',       label: '经典' },
  { id: 'sepia',         label: '护眼（米黄）' },
  { id: 'high-contrast', label: '高对比' },
];

/** localStorage 持久化键名 */
export const COLOR_SCHEME_KEY = 'md-editor-color-scheme';

/** 默认配色方案 */
export const DEFAULT_COLOR_SCHEME = 'classic';

/**
 * 读取当前配色方案（持久化优先，缺省 classic）。
 * @returns {string}
 */
export function getColorScheme() {
  const stored = localStorage.getItem(COLOR_SCHEME_KEY);
  if (stored && COLOR_SCHEMES.some((s) => s.id === stored)) return stored;
  return DEFAULT_COLOR_SCHEME;
}

/**
 * 设定配色方案：写入 localStorage 并同步到 <html data-color-scheme> 属性。
 * 真实颜色由 editor.css 中对应的 [data-color-scheme="..."] 变量块提供。
 * @param {string} id 配色方案 id（须为 COLOR_SCHEMES 中的一项）
 */
export function setColorScheme(id) {
  if (!COLOR_SCHEMES.some((s) => s.id === id)) id = DEFAULT_COLOR_SCHEME;
  localStorage.setItem(COLOR_SCHEME_KEY, id);
  document.documentElement.setAttribute('data-color-scheme', id);
}

/**
 * 应用启动时调用：将持久化的配色方案同步到文档属性（避免刷新后丢失）。
 */
export function applyStoredColorScheme() {
  document.documentElement.setAttribute('data-color-scheme', getColorScheme());
}
