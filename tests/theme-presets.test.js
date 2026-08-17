// tests/theme-presets.test.js
// 编辑器主题预设单元测试（不依赖 @codemirror/*，仅用标准 DOM + localStorage 伪造）
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_THEMES,
  DEFAULT_EDITOR_THEME,
  DEFAULT_DARK_EDITOR_THEME,
  THEME_VARS_KEYS,
  getStoredEditorTheme,
  setStoredEditorTheme,
  applyEditorThemePreset,
  getThemeKind,
  getCounterpartTheme,
} from '../src/theme-presets.js';

// 读取 compare.css 用于静态硬约束断言（M3 审计报告：MergeView 层叠禁区 + 窄窗滚动修复）
const __dirname = dirname(fileURLToPath(import.meta.url));
const compareCss = readFileSync(join(__dirname, '../src/compare.css'), 'utf8');
// 去除 /* ... */ 注释（注释中可能含 { } 干扰块解析/属性匹配），供静态断言使用
const compareCssClean = compareCss.replace(/\/\*[\s\S]*?\*\//g, '');

// 用 linkedom 提供 document（与 syntax-highlight.test.js 一致），并注入内存版
// localStorage，避免依赖未安装的 jsdom / 真实浏览器 / CM6。
const { document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
globalThis.document = document;

const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
  clear: () => __store.clear(),
};

test('EDITOR_THEMES 共 33 项（21 标准 + 豆沙绿亮/暗 + 4 套玻璃皮肤 + 6 套原型玻璃主题）', () => {
  assert.strictEqual(EDITOR_THEMES.length, 33);
});

test('全部 10 套玻璃类主题均注册且含全部 5 个材质键（4 标准玻璃 + 6 原型玻璃）', () => {
  const materialKeys = ['--ambient', '--accent-glow', '--btn-top', '--btn-bot', '--edge'];
  const glassThemes = [
    'glacier', 'aurora', 'fluent', 'macos',
    'github-glass-light', 'github-glass-dark', 'nord-glass',
    'aurora-glass', 'dou-sha-lv-glass', 'mac-glass',
  ];
  for (const id of glassThemes) {
    const t = EDITOR_THEMES.find((x) => x.id === id);
    assert.ok(t, `应包含玻璃主题 ${id}`);
    assert.ok(t.vars['--bg-primary'], `${id} 应定义 --bg-primary`);
    for (const k of materialKeys) {
      assert.ok(t.vars[k] !== undefined, `${id} 应定义材质键 ${k}`);
    }
  }
});

// 审计 M3 修复：全部主题（含 6 套新玻璃）必须含 THEME_VARS_KEYS 全部变量键，
// 防止后续重构删键导致配色/玻璃变量缺失。复用已导出的 THEME_VARS_KEYS。
test('全部 33 个主题均含 THEME_VARS_KEYS 全部变量键', () => {
  for (const t of EDITOR_THEMES) {
    for (const k of THEME_VARS_KEYS) {
      assert.ok(t.vars[k] !== undefined, `主题 ${t.id} 缺失变量键 ${k}`);
    }
  }
});

test('含豆沙绿(亮) 且 --bg-primary 为 #C7EDCC', () => {
  const t = EDITOR_THEMES.find((x) => x.id === 'dou-sha-lv-light');
  assert.ok(t, '应包含 dou-sha-lv-light');
  assert.strictEqual(t.vars['--bg-primary'], '#C7EDCC');
  assert.strictEqual(t.kind, 'light');
});

test('含豆沙绿(暗) 且为深墨绿（重做以强化与亮版的区分度）', () => {
  const t = EDITOR_THEMES.find((x) => x.id === 'dou-sha-lv-dark');
  assert.ok(t, '应包含 dou-sha-lv-dark');
  assert.strictEqual(t.vars['--bg-primary'], '#16271c');
  assert.strictEqual(t.kind, 'dark');
});

test('DEFAULT_EDITOR_THEME 为 dou-sha-lv-light', () => {
  assert.strictEqual(DEFAULT_EDITOR_THEME, 'dou-sha-lv-light');
});

test('get/setStoredEditorTheme 经 localStorage 往返正确', () => {
  localStorage.clear();
  setStoredEditorTheme('github');
  assert.strictEqual(getStoredEditorTheme(), 'github');
  setStoredEditorTheme('nord');
  assert.strictEqual(getStoredEditorTheme(), 'nord');
});

test('getStoredEditorTheme 无存储时回退默认', () => {
  localStorage.clear();
  assert.strictEqual(getStoredEditorTheme(), DEFAULT_EDITOR_THEME);
});

test('applyEditorThemePreset 在 documentElement 设置 data-editor-theme', () => {
  applyEditorThemePreset('nord');
  assert.strictEqual(
    document.documentElement.getAttribute('data-editor-theme'),
    'nord'
  );
});

test('applyEditorThemePreset 未知主题回退默认', () => {
  applyEditorThemePreset('not-a-real-theme');
  assert.strictEqual(
    document.documentElement.getAttribute('data-editor-theme'),
    DEFAULT_EDITOR_THEME
  );
});

// ── 修复 THM-01：明暗对偶切换 ────────────────────────────────
// 旧缺陷：#btnTheme 只翻转独立变量并直接写 data-theme，随后 applyEditorThemePreset
// 用「已存预设的 kind」把 data-theme 覆盖回去，导致明暗按钮对 CSS 变量层完全无效。
// 修复后：明暗切换 = 切换到同族对偶预设，data-theme 随预设 kind 一起翻转。

test('getThemeKind 正确识别每个预设的明暗归属', () => {
  for (const t of EDITOR_THEMES) {
    assert.strictEqual(getThemeKind(t.id), t.kind === 'dark' ? 'dark' : 'light');
  }
});

test('getThemeKind 未知预设视为 light（与 applyEditorThemePreset 兜底一致）', () => {
  assert.strictEqual(getThemeKind('not-a-real-theme'), 'light');
});

test('getCounterpartTheme 在同族明暗之间往返配对', () => {
  const pairs = [
    ['light', 'dark'],
    ['github', 'github-dark'],
    ['one-light', 'one-dark'],
    ['solarized-light', 'solarized-dark'],
    ['catppuccin-latte', 'catppuccin-mocha'],
    ['dou-sha-lv-light', 'dou-sha-lv-dark'],
  ];
  for (const [a, b] of pairs) {
    assert.strictEqual(getCounterpartTheme(a), b, `${a} 的对偶应为 ${b}`);
    assert.strictEqual(getCounterpartTheme(b), a, `${b} 的对偶应为 ${a}`);
  }
});

test('getCounterpartTheme 对无同族配对的预设回退到目标 kind 的默认预设', () => {
  // nord 是暗色且无同族亮色版本 → 回退到默认亮色预设
  assert.strictEqual(getThemeKind('nord'), 'dark');
  assert.strictEqual(getCounterpartTheme('nord'), DEFAULT_EDITOR_THEME);
  // sepia 是亮色且无同族暗色版本 → 回退到默认暗色预设
  assert.strictEqual(getThemeKind('sepia'), 'light');
  assert.strictEqual(getCounterpartTheme('sepia'), DEFAULT_DARK_EDITOR_THEME);
});

test('getCounterpartTheme 的结果必定是已知预设，且 kind 与原预设相反', () => {
  for (const t of EDITOR_THEMES) {
    const next = getCounterpartTheme(t.id);
    assert.ok(
      EDITOR_THEMES.some((x) => x.id === next),
      `${t.id} 的对偶 ${next} 必须是已知预设`
    );
    assert.notStrictEqual(
      getThemeKind(next),
      getThemeKind(t.id),
      `${t.id}(${t.kind}) 的对偶 ${next} 明暗必须相反`
    );
  }
});

test('明暗切换链路：连续两次对偶切换后 data-theme 回到原值', () => {
  localStorage.clear();
  const start = DEFAULT_EDITOR_THEME;
  applyEditorThemePreset(start);
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'light');

  const dark = getCounterpartTheme(start);
  applyEditorThemePreset(dark);
  assert.strictEqual(
    document.documentElement.getAttribute('data-theme'),
    'dark',
    '切到对偶暗色预设后 data-theme 必须变为 dark（旧实现在此恒为 light）'
  );

  const back = getCounterpartTheme(dark);
  applyEditorThemePreset(back);
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'light');
  assert.strictEqual(back, start, '往返切换应回到起点预设');
});

// ── 审计 M3 修复：compare.css 功能性硬约束静态回归 ────────────────
// 防止重构丢失「MergeView 层叠禁区」与「窄窗滚动修复（H1）」两条关键不变量。

test('compare.css 硬约束：MergeView 禁区选择器块不得含层叠/变换属性', () => {
  // compare.css 为扁平规则（已确认无 @media/@supports 嵌套），按规则块解析安全。
  const forbidden = ['backdrop-filter', 'transform', 'filter', 'will-change', 'contain'];
  const cssNoComment = compareCssClean;
  const blocks = cssNoComment.match(/[^{}]+\{[^{}]*\}/g) || [];
  const zoneTokens = ['.compare-panes', '.cm-mergeView', '.compare-view'];
  for (const block of blocks) {
    const brace = block.indexOf('{');
    const selector = block.slice(0, brace);
    const body = block.slice(brace + 1);
    if (zoneTokens.some((t) => selector.includes(t))) {
      for (const f of forbidden) {
        assert.ok(!body.includes(f), `MergeView 禁区选择器「${selector.trim()}」不得含 ${f}`);
      }
    }
  }
});

test('compare.css 窄窗滚动修复落地（H1）：.toolbar-wrap 包裹态可收缩触发 overflow', () => {
  assert.ok(
    /\.toolbar-wrap\s+\.compare-toolbar\s*\{[^}]*flex:\s*1\s+1\s+auto/.test(compareCssClean),
    'compare.css 应含 .toolbar-wrap .compare-toolbar { flex: 1 1 auto } 以修复窄窗裁切'
  );
  assert.ok(
    /\.compare-toolbar\s*\{[^}]*overflow-x:\s*auto/.test(compareCssClean),
    'compare.css .compare-toolbar 应保留 overflow-x:auto'
  );
});
