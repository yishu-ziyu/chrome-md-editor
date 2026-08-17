// 一次性生成脚本：根据 src/theme-presets.js 的 EDITOR_THEMES 生成 23 段
// [data-editor-theme="<id>"] { ...vars... } CSS 块，插入 editor.css 的
// MARKRA_CSS: THEME_PRESETS 标记之后。保证 JS 预设与 CSS 变量块完全一致。
import { EDITOR_THEMES } from '../src/theme-presets.js';
import { readFileSync, writeFileSync } from 'node:fs';

const cssPath = new URL('../src/editor.css', import.meta.url);
const MARKER = '/* === MARKRA_CSS: THEME_PRESETS ===';
const SENTINEL = '/* === MARKRA_CSS: THEME_PRESETS:BEGIN === */';

const css = readFileSync(cssPath, 'utf8');
if (css.includes(SENTINEL)) {
  console.error('CSS 已包含 THEME_PRESETS 块，跳过生成。');
  process.exit(0);
}

const markerIdx = css.indexOf(MARKER);
if (markerIdx === -1) throw new Error('找不到 MARKRA_CSS: THEME_PRESETS 标记');

let blocks = `\n\n${SENTINEL}\n`;
blocks += '/* 以下 23 段由 src/theme-presets.js 的 EDITOR_THEMES 生成，勿手动改色值 */\n';
for (const t of EDITOR_THEMES) {
  const lines = Object.entries(t.vars).map(([k, v]) => `  ${k}: ${v};`);
  blocks += `\n[data-editor-theme="${t.id}"] {\n${lines.join('\n')}\n}\n`;
}
blocks += `/* === MARKRA_CSS: THEME_PRESETS:END === */\n`;

// 在标记行（含其后的换行）之后插入
const nlIdx = css.indexOf('\n', markerIdx);
const insertAt = nlIdx === -1 ? css.length : nlIdx + 1;
const out = css.slice(0, insertAt) + blocks + css.slice(insertAt);
writeFileSync(cssPath, out, 'utf8');
console.log(`已生成 ${EDITOR_THEMES.length} 段主题 CSS 变量块。`);
