// === MARKRA MODULE: theme-presets ===
// 编辑器主题预设（21 标准主题 + 豆沙绿亮/暗）+ 默认豆沙绿亮 + 主题下拉
// 集成契约：
//  - 设置存 localStorage，键 md-editor-editor-theme
//  - 通过 documentElement 的 data-editor-theme 属性驱动 editor.css 中的变量块
//  - 主题预设允许直接使用色值（无需 CSS 变量）

// 标准 21 主题（含豆沙绿 2 项 = 23 项）用的核心变量键
const THEME_KEYS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-toolbar',
  '--bg-statusbar', '--bg-panel-header', '--bg-hover', '--bg-active',
  '--border-primary', '--border-subtle',
  '--text-primary', '--text-secondary', '--text-muted', '--text-accent',
  '--accent', '--accent-hover', '--danger', '--success', '--warning',
  '--shadow-sm', '--shadow-md', '--shadow-lg',
  '--radius-sm', '--radius-md', '--radius-lg',
];

// 浅色阴影 / 深色阴影 模板
const LIGHT_SHADOW = {
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.06)',
  '--shadow-md': '0 4px 12px rgba(0,0,0,.1)',
  '--shadow-lg': '0 8px 24px rgba(0,0,0,.15)',
};
const DARK_SHADOW = {
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.3)',
  '--shadow-md': '0 4px 12px rgba(0,0,0,.4)',
  '--shadow-lg': '0 8px 24px rgba(0,0,0,.5)',
};
const RADIUS = {
  '--radius-sm': '4px',
  '--radius-md': '6px',
  '--radius-lg': '8px',
};

// 21 项标准主题预设（含 well-known 配色）。'custom' 作为中性回退预设。
const STANDARD_THEMES = [
  {
    id: 'light', label: 'Light', kind: 'light',
    vars: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#f6f8fa', '--bg-tertiary': '#eaeef2',
      '--bg-toolbar': '#f6f8fa', '--bg-statusbar': '#f6f8fa', '--bg-panel-header': '#eaeef2',
      '--bg-hover': '#e8eaed', '--bg-active': '#0969da1a',
      '--border-primary': '#d0d7de', '--border-subtle': '#e8eaed',
      '--text-primary': '#1f2328', '--text-secondary': '#656d76', '--text-muted': '#8c959f',
      '--text-accent': '#0969da',
      '--accent': '#0969da', '--accent-hover': '#0550ae', '--accent-glow': 'rgba(9,105,218,.16)',
      '--danger': '#cf222e', '--success': '#1a7f37', '--warning': '#9a6700',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'dark', label: 'Dark', kind: 'dark',
    vars: {
      '--bg-primary': '#0d1117', '--bg-secondary': '#161b22', '--bg-tertiary': '#1c2128',
      '--bg-toolbar': '#161b22', '--bg-statusbar': '#0d1117', '--bg-panel-header': '#1c2128',
      '--bg-hover': '#30363d', '--bg-active': '#388bfd26',
      '--border-primary': '#30363d', '--border-subtle': '#21262d',
      '--text-primary': '#e6edf3', '--text-secondary': '#8b949e', '--text-muted': '#484f58',
      '--text-accent': '#58a6ff',
      '--accent': '#58a6ff', '--accent-hover': '#79c0ff', '--accent-glow': 'rgba(88,166,255,.18)',
      '--danger': '#f85149', '--success': '#3fb950', '--warning': '#d29922',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'github', label: 'GitHub', kind: 'light',
    vars: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#f6f8fa', '--bg-tertiary': '#eaeef2',
      '--bg-toolbar': '#f6f8fa', '--bg-statusbar': '#f6f8fa', '--bg-panel-header': '#eaeef2',
      '--bg-hover': '#e8eaed', '--bg-active': '#0969da1a',
      '--border-primary': '#d0d7de', '--border-subtle': '#e8eaed',
      '--text-primary': '#1f2328', '--text-secondary': '#656d76', '--text-muted': '#8c959f',
      '--text-accent': '#0969da',
      '--accent': '#0969da', '--accent-hover': '#0550ae', '--accent-glow': 'rgba(9,105,218,.16)',
      '--danger': '#cf222e', '--success': '#1a7f37', '--warning': '#9a6700',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'github-dark', label: 'GitHub Dark', kind: 'dark',
    vars: {
      '--bg-primary': '#010409', '--bg-secondary': '#0d1117', '--bg-tertiary': '#161b22',
      '--bg-toolbar': '#010409', '--bg-statusbar': '#010409', '--bg-panel-header': '#161b22',
      '--bg-hover': '#30363d', '--bg-active': '#388bfd26',
      '--border-primary': '#30363d', '--border-subtle': '#21262d',
      '--text-primary': '#c9d1d9', '--text-secondary': '#8b949e', '--text-muted': '#484f58',
      '--text-accent': '#58a6ff',
      '--accent': '#58a6ff', '--accent-hover': '#79c0ff', '--accent-glow': 'rgba(88,166,255,.18)',
      '--danger': '#f85149', '--success': '#3fb950', '--warning': '#d29922',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'one-dark', label: 'One Dark', kind: 'dark',
    vars: {
      '--bg-primary': '#282c34', '--bg-secondary': '#21252b', '--bg-tertiary': '#2c313a',
      '--bg-toolbar': '#21252b', '--bg-statusbar': '#282c34', '--bg-panel-header': '#2c313a',
      '--bg-hover': '#2c313a', '--bg-active': '#61afef22',
      '--border-primary': '#3a3f4b', '--border-subtle': '#2c313a',
      '--text-primary': '#abb2bf', '--text-secondary': '#828997', '--text-muted': '#5c6370',
      '--text-accent': '#61afef',
      '--accent': '#61afef', '--accent-hover': '#82b8f5', '--accent-glow': 'rgba(97,175,239,.18)',
      '--danger': '#e06c75', '--success': '#98c379', '--warning': '#e5c07b',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'one-light', label: 'One Light', kind: 'light',
    vars: {
      '--bg-primary': '#fafafa', '--bg-secondary': '#f0f0f0', '--bg-tertiary': '#e8e8e8',
      '--bg-toolbar': '#fafafa', '--bg-statusbar': '#fafafa', '--bg-panel-header': '#e8e8e8',
      '--bg-hover': '#e8e8e8', '--bg-active': '#4078f21a',
      '--border-primary': '#e8e8e8', '--border-subtle': '#f0f0f0',
      '--text-primary': '#383a42', '--text-secondary': '#6b6f7a', '--text-muted': '#a0a1a7',
      '--text-accent': '#4078f2',
      '--accent': '#4078f2', '--accent-hover': '#3b69d6', '--accent-glow': 'rgba(64,120,242,.16)',
      '--danger': '#e45649', '--success': '#50a14f', '--warning': '#c18401',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'one-dark-pro', label: 'One Dark Pro', kind: 'dark',
    vars: {
      '--bg-primary': '#282c34', '--bg-secondary': '#1e2127', '--bg-tertiary': '#1e2127',
      '--bg-toolbar': '#21252b', '--bg-statusbar': '#282c34', '--bg-panel-header': '#1e2127',
      '--bg-hover': '#2c313a', '--bg-active': '#56b6c222',
      '--border-primary': '#181a1f', '--border-subtle': '#1e2127',
      '--text-primary': '#abb2bf', '--text-secondary': '#828997', '--text-muted': '#5c6370',
      '--text-accent': '#56b6c2',
      '--accent': '#56b6c2', '--accent-hover': '#7ed0db', '--accent-glow': 'rgba(86,182,194,.16)',
      '--danger': '#e06c75', '--success': '#98c379', '--warning': '#e5c07b',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'gothic', label: 'Gothic', kind: 'dark',
    vars: {
      '--bg-primary': '#1a1a2e', '--bg-secondary': '#16213e', '--bg-tertiary': '#0f3460',
      '--bg-toolbar': '#16213e', '--bg-statusbar': '#1a1a2e', '--bg-panel-header': '#16213e',
      '--bg-hover': '#23314f', '--bg-active': '#7b68ee22',
      '--border-primary': '#2a2a4a', '--border-subtle': '#16213e',
      '--text-primary': '#e0e0e0', '--text-secondary': '#b0b0c0', '--text-muted': '#7a7a90',
      '--text-accent': '#7b68ee',
      '--accent': '#7b68ee', '--accent-hover': '#9d8bff', '--accent-glow': 'rgba(123,104,238,.18)',
      '--danger': '#e94560', '--success': '#4ecca3', '--warning': '#f0a500',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'newsprint', label: 'Newsprint', kind: 'light',
    vars: {
      '--bg-primary': '#f4f1ea', '--bg-secondary': '#ece7d9', '--bg-tertiary': '#e3ddca',
      '--bg-toolbar': '#ece7d9', '--bg-statusbar': '#ece7d9', '--bg-panel-header': '#e3ddca',
      '--bg-hover': '#e3ddca', '--bg-active': '#8a6d3b1a',
      '--border-primary': '#d8d0bb', '--border-subtle': '#ece7d9',
      '--text-primary': '#2b2b2b', '--text-secondary': '#5a5246', '--text-muted': '#8a8270',
      '--text-accent': '#8a6d3b',
      '--accent': '#8a6d3b', '--accent-hover': '#6f562d', '--accent-glow': 'rgba(138,109,59,.16)',
      '--danger': '#a83232', '--success': '#4a7a3a', '--warning': '#9a6700',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'night', label: 'Night', kind: 'dark',
    vars: {
      '--bg-primary': '#0b0c10', '--bg-secondary': '#1f2833', '--bg-tertiary': '#1f2833',
      '--bg-toolbar': '#0b0c10', '--bg-statusbar': '#0b0c10', '--bg-panel-header': '#1f2833',
      '--bg-hover': '#1f2833', '--bg-active': '#66fcf122',
      '--border-primary': '#1f2833', '--border-subtle': '#0b0c10',
      '--text-primary': '#c5c6c7', '--text-secondary': '#9aa0a6', '--text-muted': '#66707a',
      '--text-accent': '#66fcf1',
      '--accent': '#66fcf1', '--accent-hover': '#45a29e', '--accent-glow': 'rgba(102,252,241,.16)',
      '--danger': '#ff5e5e', '--success': '#45a29e', '--warning': '#f0a500',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'pixyll', label: 'Pixyll', kind: 'light',
    vars: {
      '--bg-primary': '#f9f9f9', '--bg-secondary': '#f0f0f0', '--bg-tertiary': '#e8e8e8',
      '--bg-toolbar': '#f9f9f9', '--bg-statusbar': '#f9f9f9', '--bg-panel-header': '#f0f0f0',
      '--bg-hover': '#eeeeee', '--bg-active': '#77b59a1a',
      '--border-primary': '#e0e0e0', '--border-subtle': '#f0f0f0',
      '--text-primary': '#333333', '--text-secondary': '#555555', '--text-muted': '#888888',
      '--text-accent': '#77b59a',
      '--accent': '#77b59a', '--accent-hover': '#5f987f', '--accent-glow': 'rgba(119,181,154,.16)',
      '--danger': '#cc4b37', '--success': '#4a7a3a', '--warning': '#b58900',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'whitey', label: 'Whitey', kind: 'light',
    vars: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#fbfbfb', '--bg-tertiary': '#f2f2f2',
      '--bg-toolbar': '#ffffff', '--bg-statusbar': '#ffffff', '--bg-panel-header': '#f2f2f2',
      '--bg-hover': '#f2f2f2', '--bg-active': '#2980b91a',
      '--border-primary': '#e6e6e6', '--border-subtle': '#f2f2f2',
      '--text-primary': '#333333', '--text-secondary': '#5a5a5a', '--text-muted': '#8c8c8c',
      '--text-accent': '#2980b9',
      '--accent': '#2980b9', '--accent-hover': '#20638f', '--accent-glow': 'rgba(41,128,185,.16)',
      '--danger': '#c0392b', '--success': '#27ae60', '--warning': '#f39c12',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'sepia', label: 'Sepia', kind: 'light',
    vars: {
      '--bg-primary': '#f4ecd8', '--bg-secondary': '#efe3c8', '--bg-tertiary': '#e8d9b8',
      '--bg-toolbar': '#efe3c8', '--bg-statusbar': '#efe3c8', '--bg-panel-header': '#e8d9b8',
      '--bg-hover': '#e8d9b8', '--bg-active': '#a0522d1a',
      '--border-primary': '#d9c9a3', '--border-subtle': '#efe3c8',
      '--text-primary': '#5b4636', '--text-secondary': '#7a6552', '--text-muted': '#9b8570',
      '--text-accent': '#a0522d',
      '--accent': '#a0522d', '--accent-hover': '#80411f', '--accent-glow': 'rgba(160,82,45,.16)',
      '--danger': '#a83232', '--success': '#5a7a3a', '--warning': '#9a6700',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'solarized-light', label: 'Solarized Light', kind: 'light',
    vars: {
      '--bg-primary': '#fdf6e3', '--bg-secondary': '#eee8d5', '--bg-tertiary': '#eae3cb',
      '--bg-toolbar': '#fdf6e3', '--bg-statusbar': '#fdf6e3', '--bg-panel-header': '#eee8d5',
      '--bg-hover': '#eee8d5', '--bg-active': '#268bd21a',
      '--border-primary': '#eee8d5', '--border-subtle': '#fdf6e3',
      '--text-primary': '#657b83', '--text-secondary': '#586e75', '--text-muted': '#93a1a1',
      '--text-accent': '#268bd2',
      '--accent': '#268bd2', '--accent-hover': '#1f6aa5', '--accent-glow': 'rgba(38,139,210,.16)',
      '--danger': '#dc322f', '--success': '#859900', '--warning': '#b58900',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'solarized-dark', label: 'Solarized Dark', kind: 'dark',
    vars: {
      '--bg-primary': '#002b36', '--bg-secondary': '#073642', '--bg-tertiary': '#073642',
      '--bg-toolbar': '#002b36', '--bg-statusbar': '#002b36', '--bg-panel-header': '#073642',
      '--bg-hover': '#073642', '--bg-active': '#268bd21a',
      '--border-primary': '#073642', '--border-subtle': '#002b36',
      '--text-primary': '#839496', '--text-secondary': '#586e75', '--text-muted': '#586e75',
      '--text-accent': '#268bd2',
      '--accent': '#268bd2', '--accent-hover': '#1f6aa5', '--accent-glow': 'rgba(38,139,210,.18)',
      '--danger': '#dc322f', '--success': '#859900', '--warning': '#b58900',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'nord', label: 'Nord', kind: 'dark',
    vars: {
      '--bg-primary': '#2e3440', '--bg-secondary': '#3b4252', '--bg-tertiary': '#434c5e',
      '--bg-toolbar': '#2e3440', '--bg-statusbar': '#2e3440', '--bg-panel-header': '#3b4252',
      '--bg-hover': '#434c5e', '--bg-active': '#4c566a33',
      '--border-primary': '#3b4252', '--border-subtle': '#2e3440',
      '--text-primary': '#eceff4', '--text-secondary': '#d8dee9', '--text-muted': '#4c566a',
      '--text-accent': '#88c0d0',
      '--accent': '#88c0d0', '--accent-hover': '#8fbcbb', '--accent-glow': 'rgba(136,192,208,.18)',
      '--danger': '#bf616a', '--success': '#a3be8c', '--warning': '#ebcb8b',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'catppuccin-latte', label: 'Catppuccin Latte', kind: 'light',
    vars: {
      '--bg-primary': '#eff1f5', '--bg-secondary': '#e6e9ef', '--bg-tertiary': '#ccd0da',
      '--bg-toolbar': '#eff1f5', '--bg-statusbar': '#eff1f5', '--bg-panel-header': '#e6e9ef',
      '--bg-hover': '#e6e9ef', '--bg-active': '#1e66f51a',
      '--border-primary': '#ccd0da', '--border-subtle': '#eff1f5',
      '--text-primary': '#4c4f69', '--text-secondary': '#6c6f85', '--text-muted': '#9ca0b0',
      '--text-accent': '#1e66f5',
      '--accent': '#1e66f5', '--accent-hover': '#1857d6', '--accent-glow': 'rgba(30,102,245,.16)',
      '--danger': '#d20f39', '--success': '#40a02b', '--warning': '#df8e1d',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'catppuccin-mocha', label: 'Catppuccin Mocha', kind: 'dark',
    vars: {
      '--bg-primary': '#1e1e2e', '--bg-secondary': '#181825', '--bg-tertiary': '#313244',
      '--bg-toolbar': '#1e1e2e', '--bg-statusbar': '#1e1e2e', '--bg-panel-header': '#181825',
      '--bg-hover': '#313244', '--bg-active': '#89b4fa33',
      '--border-primary': '#313244', '--border-subtle': '#1e1e2e',
      '--text-primary': '#cdd6f4', '--text-secondary': '#bac2de', '--text-muted': '#6c7086',
      '--text-accent': '#89b4fa',
      '--accent': '#89b4fa', '--accent-hover': '#b4befe', '--accent-glow': 'rgba(137,180,250,.18)',
      '--danger': '#f38ba8', '--success': '#a6e3a1', '--warning': '#f9e2af',
      ...DARK_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'academic', label: 'Academic', kind: 'light',
    vars: {
      '--bg-primary': '#fcfcfa', '--bg-secondary': '#f5f5f3', '--bg-tertiary': '#ecece8',
      '--bg-toolbar': '#fcfcfa', '--bg-statusbar': '#fcfcfa', '--bg-panel-header': '#f5f5f3',
      '--bg-hover': '#eeeeea', '--bg-active': '#3b6ea51a',
      '--border-primary': '#e2e2dc', '--border-subtle': '#f5f5f3',
      '--text-primary': '#2e2e2e', '--text-secondary': '#555555', '--text-muted': '#8a8a82',
      '--text-accent': '#3b6ea5',
      '--accent': '#3b6ea5', '--accent-hover': '#2c547e', '--accent-glow': 'rgba(59,110,165,.16)',
      '--danger': '#b03030', '--success': '#3a7a3a', '--warning': '#9a6700',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'minimal', label: 'Minimal', kind: 'light',
    vars: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#fafafa', '--bg-tertiary': '#f2f2f2',
      '--bg-toolbar': '#ffffff', '--bg-statusbar': '#ffffff', '--bg-panel-header': '#fafafa',
      '--bg-hover': '#f2f2f2', '--bg-active': '#0077cc1a',
      '--border-primary': '#e8e8e8', '--border-subtle': '#fafafa',
      '--text-primary': '#2d2d2d', '--text-secondary': '#5a5a5a', '--text-muted': '#8c8c8c',
      '--text-accent': '#0077cc',
      '--accent': '#0077cc', '--accent-hover': '#005fa3', '--accent-glow': 'rgba(0,119,204,.16)',
      '--danger': '#cc3333', '--success': '#2e8b57', '--warning': '#b8860b',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
  {
    id: 'custom', label: 'Custom', kind: 'light',
    vars: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#f6f8fa', '--bg-tertiary': '#eaeef2',
      '--bg-toolbar': '#f6f8fa', '--bg-statusbar': '#f6f8fa', '--bg-panel-header': '#eaeef2',
      '--bg-hover': '#e8eaed', '--bg-active': '#0969da1a',
      '--border-primary': '#d0d7de', '--border-subtle': '#e8eaed',
      '--text-primary': '#1f2328', '--text-secondary': '#656d76', '--text-muted': '#8c959f',
      '--text-accent': '#0969da',
      '--accent': '#0969da', '--accent-hover': '#0550ae', '--accent-glow': 'rgba(9,105,218,.16)',
      '--danger': '#cf222e', '--success': '#1a7f37', '--warning': '#9a6700',
      ...LIGHT_SHADOW, ...RADIUS,
    },
  },
];

// 两项新增：豆沙绿（护眼绿）亮 / 暗。两者均浅底，kind 均为 'light'。
const DOU_SHA_LV_LIGHT = {
  id: 'dou-sha-lv-light', label: '豆沙绿（亮）', kind: 'light',
  vars: {
    '--bg-primary': '#C7EDCC', '--bg-secondary': '#d6f2d9', '--bg-tertiary': '#cfeccf',
    '--bg-toolbar': '#bfe6c4', '--bg-statusbar': '#bfe6c4', '--bg-panel-header': '#cfeccf',
    '--bg-hover': '#b9e0bf', '--bg-active': '#2e7d3233',
    '--border-primary': '#a9d6b0', '--border-subtle': '#c2e6c8',
    '--text-primary': '#1f3d1f', '--text-secondary': '#3a5a3a', '--text-muted': '#557a55',
    '--text-accent': '#1f6b3a',
    '--accent': '#2e7d32', '--accent-hover': '#1b5e20',
    '--danger': '#c62828', '--success': '#2e7d32', '--warning': '#f9a825',
    ...LIGHT_SHADOW, ...RADIUS,
    '--ambient': 'rgba(46,125,50,.36)', '--accent-glow': 'rgba(46,125,50,.20)', '--btn-top': 'rgba(255,255,255,.80)', '--btn-bot': 'rgba(199,237,204,.55)', '--edge': 'rgba(255,255,255,.78)',
  },
};
const DOU_SHA_LV_DARK = {
  id: 'dou-sha-lv-dark', label: '豆沙绿（暗）', kind: 'dark',
  vars: {
    '--bg-primary': '#16271c', '--bg-secondary': '#112017', '--bg-tertiary': '#1c3326',
    '--bg-toolbar': '#112017', '--bg-statusbar': '#112017', '--bg-panel-header': '#1c3326',
    '--bg-hover': '#234031', '--bg-active': 'rgba(80,200,120,.16)',
    '--border-primary': '#2e4a3a', '--border-subtle': '#1c3326',
    '--text-primary': '#d6f5dd', '--text-secondary': '#a9d6b5', '--text-muted': '#6fae7e',
    '--text-accent': '#8be0a0',
    '--accent': '#4caf6a', '--accent-hover': '#6fd089',
    '--danger': '#ff6b6b', '--success': '#4caf6a', '--warning': '#ffd166',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,.3)', '--shadow-md': '0 4px 12px rgba(0,0,0,.4)', '--shadow-lg': '0 8px 24px rgba(0,0,0,.5)',
    '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(80,200,120,.28)', '--accent-glow': 'rgba(80,200,120,.26)', '--btn-top': 'rgba(72,122,92,.56)', '--btn-bot': 'rgba(16,34,26,.66)', '--edge': 'rgba(120,200,150,.24)',
  },
};

// 4 套新增主题（玻璃拟态 skin 配套调色板）
const GLACIER_THEME = {
  id: 'glacier', label: '冰川青蓝', kind: 'light',
  vars: {
    '--bg-primary': '#eaf2f9', '--bg-secondary': '#dce8f2', '--bg-tertiary': '#cdddee',
    '--bg-toolbar': '#dce8f2', '--bg-statusbar': '#dce8f2', '--bg-panel-header': '#cdddee',
    '--bg-hover': '#c5d8e8', '--bg-active': 'rgba(31,156,240,.12)',
    '--border-primary': '#b3c9dc', '--border-subtle': '#d0e0ec',
    '--text-primary': '#16242f', '--text-secondary': '#33485a', '--text-muted': '#6b8095',
    '--text-accent': '#0a7fc2',
    '--accent': '#1f9cf0', '--accent-hover': '#0a7fc2',
    '--danger': '#e5484d', '--success': '#2e9e5b', '--warning': '#d99e0b',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,.06)', '--shadow-md': '0 4px 12px rgba(0,0,0,.1)', '--shadow-lg': '0 8px 24px rgba(0,0,0,.15)',
    '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(120,195,235,.62)', '--accent-glow': 'rgba(31,156,240,.24)', '--btn-top': 'rgba(255,255,255,.96)', '--btn-bot': 'rgba(208,226,242,.66)', '--edge': 'rgba(255,255,255,.92)',
  },
};
const AURORA_THEME = {
  id: 'aurora', label: '紫晶极光', kind: 'dark',
  vars: {
    '--bg-primary': '#1c1636', '--bg-secondary': '#15102c', '--bg-tertiary': '#241a44',
    '--bg-toolbar': '#15102c', '--bg-statusbar': '#15102c', '--bg-panel-header': '#241a44',
    '--bg-hover': '#2c2150', '--bg-active': 'rgba(160,107,255,.16)',
    '--border-primary': '#3a2d63', '--border-subtle': '#241a44',
    '--text-primary': '#ece8ff', '--text-secondary': '#c3b8ec', '--text-muted': '#8e82bd',
    '--text-accent': '#c79bff',
    '--accent': '#a06bff', '--accent-hover': '#c79bff',
    '--danger': '#ff6b8a', '--success': '#5be0a0', '--warning': '#ffd166',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,.3)', '--shadow-md': '0 4px 12px rgba(0,0,0,.4)', '--shadow-lg': '0 8px 24px rgba(0,0,0,.5)',
    '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(150,105,255,.50)', '--accent-glow': 'rgba(160,107,255,.38)', '--btn-top': 'rgba(98,74,158,.70)', '--btn-bot': 'rgba(36,24,66,.76)', '--edge': 'rgba(174,149,255,.26)',
  },
};
const FLUENT_THEME = {
  id: 'fluent', label: 'Fluent', kind: 'dark',
  vars: {
    '--bg-primary': '#232327', '--bg-secondary': '#1b1b1f', '--bg-tertiary': '#2b2b30',
    '--bg-toolbar': '#1b1b1f', '--bg-statusbar': '#1b1b1f', '--bg-panel-header': '#2b2b30',
    '--bg-hover': '#33333a', '--bg-active': 'rgba(76,194,255,.14)',
    '--border-primary': '#3a3a40', '--border-subtle': '#2b2b30',
    '--text-primary': '#f3f3f3', '--text-secondary': '#d6d6d6', '--text-muted': '#9a9a9a',
    '--text-accent': '#7fd4ff',
    '--accent': '#4cc2ff', '--accent-hover': '#7fd4ff',
    '--danger': '#ff5f57', '--success': '#28c840', '--warning': '#febc2e',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,.3)', '--shadow-md': '0 4px 12px rgba(0,0,0,.4)', '--shadow-lg': '0 8px 24px rgba(0,0,0,.5)',
    '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(0,120,212,.37)', '--accent-glow': 'rgba(76,194,255,.30)', '--btn-top': 'rgba(255,255,255,.18)', '--btn-bot': 'rgba(255,255,255,.05)', '--edge': 'rgba(255,255,255,.18)',
  },
};
const MACOS_THEME = {
  id: 'macos', label: 'macOS', kind: 'light',
  vars: {
    '--bg-primary': '#f2f2f7', '--bg-secondary': '#e7e7ec', '--bg-tertiary': '#dcdce2',
    '--bg-toolbar': '#e7e7ec', '--bg-statusbar': '#e7e7ec', '--bg-panel-header': '#dcdce2',
    '--bg-hover': '#d2d2da', '--bg-active': 'rgba(10,132,255,.12)',
    '--border-primary': '#c4c4cc', '--border-subtle': '#dcdce2',
    '--text-primary': '#1d1d1f', '--text-secondary': '#3a3a3f', '--text-muted': '#7c7c82',
    '--text-accent': '#0066d6',
    '--accent': '#0a84ff', '--accent-hover': '#0066d6',
    '--danger': '#ff3b30', '--success': '#34c759', '--warning': '#ff9f0a',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,.06)', '--shadow-md': '0 4px 12px rgba(0,0,0,.1)', '--shadow-lg': '0 8px 24px rgba(0,0,0,.15)',
    '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(120,160,255,.48)', '--accent-glow': 'rgba(10,132,255,.24)', '--btn-top': 'rgba(255,255,255,.97)', '--btn-bot': 'rgba(212,212,220,.70)', '--edge': 'rgba(255,255,255,.94)',
  },
};

// 6 套新增原型玻璃主题（oklch 翻译为 hex/rgba；玻璃键用 accent 派生写法，随主题自适应）
const GITHUB_GLASS_DARK = {
  id: 'github-glass-dark', label: 'GitHub 玻璃（暗）', kind: 'dark',
  vars: {
    '--bg-primary': '#010409', '--bg-secondary': '#0d1117', '--bg-tertiary': '#161b22',
    '--bg-toolbar': '#010409', '--bg-statusbar': '#010409', '--bg-panel-header': '#161b22',
    '--bg-hover': '#30363d', '--bg-active': '#388bfd26',
    '--border-primary': '#30363d', '--border-subtle': '#21262d',
    '--text-primary': '#c9d1d9', '--text-secondary': '#8b949e', '--text-muted': '#484f58', '--text-accent': '#58a6ff',
    '--accent': '#58a6ff', '--accent-hover': '#79c0ff', '--danger': '#f85149', '--success': '#3fb950', '--warning': '#d29922',
    ...DARK_SHADOW, '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(88,166,255,.30)', '--accent-glow': 'rgba(88,166,255,.22)',
    '--btn-top': 'rgba(70,90,120,.55)', '--btn-bot': 'rgba(20,28,40,.65)', '--edge': 'rgba(120,160,210,.22)',
  },
};
const GITHUB_GLASS_LIGHT = {
  id: 'github-glass-light', label: 'GitHub 玻璃（亮）', kind: 'light',
  vars: {
    '--bg-primary': '#ffffff', '--bg-secondary': '#f6f8fa', '--bg-tertiary': '#eaeef2',
    '--bg-toolbar': '#f6f8fa', '--bg-statusbar': '#f6f8fa', '--bg-panel-header': '#eaeef2',
    '--bg-hover': '#e8eaed', '--bg-active': '#0969da1a',
    '--border-primary': '#d0d7de', '--border-subtle': '#e8eaed',
    '--text-primary': '#1f2328', '--text-secondary': '#656d76', '--text-muted': '#8c959f', '--text-accent': '#0969da',
    '--accent': '#0969da', '--accent-hover': '#0550ae', '--danger': '#cf222e', '--success': '#1a7f37', '--warning': '#9a6700',
    ...LIGHT_SHADOW, '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(9,105,218,.28)', '--accent-glow': 'rgba(9,105,218,.20)',
    '--btn-top': 'rgba(255,255,255,.92)', '--btn-bot': 'rgba(225,232,240,.70)', '--edge': 'rgba(255,255,255,.85)',
  },
};
const NORD_GLASS = {
  id: 'nord-glass', label: 'Nord 玻璃', kind: 'dark',
  vars: {
    '--bg-primary': '#2e3440', '--bg-secondary': '#3b4252', '--bg-tertiary': '#434c5e',
    '--bg-toolbar': '#2e3440', '--bg-statusbar': '#2e3440', '--bg-panel-header': '#3b4252',
    '--bg-hover': '#434c5e', '--bg-active': '#4c566a33',
    '--border-primary': '#3b4252', '--border-subtle': '#2e3440',
    '--text-primary': '#eceff4', '--text-secondary': '#d8dee9', '--text-muted': '#4c566a', '--text-accent': '#88c0d0',
    '--accent': '#88c0d0', '--accent-hover': '#8fbcbb', '--danger': '#bf616a', '--success': '#a3be8c', '--warning': '#ebcb8b',
    ...DARK_SHADOW, '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(136,192,208,.32)', '--accent-glow': 'rgba(136,192,208,.24)',
    '--btn-top': 'rgba(90,104,128,.55)', '--btn-bot': 'rgba(40,48,66,.65)', '--edge': 'rgba(143,188,187,.24)',
  },
};
// aurora-glass 与既有 aurora(紫晶极光) 区分：采用青绿极光配色，id 唯一
const AURORA_GLASS = {
  id: 'aurora-glass', label: '极光玻璃（青）', kind: 'dark',
  vars: {
    '--bg-primary': '#0e1b1a', '--bg-secondary': '#0a1514', '--bg-tertiary': '#132625',
    '--bg-toolbar': '#0a1514', '--bg-statusbar': '#0a1514', '--bg-panel-header': '#132625',
    '--bg-hover': '#1b3634', '--bg-active': 'rgba(64,224,208,.16)',
    '--border-primary': '#1f3b39', '--border-subtle': '#132625',
    '--text-primary': '#d6f5ee', '--text-secondary': '#a9d6cd', '--text-muted': '#6fae9e', '--text-accent': '#5be0c8',
    '--accent': '#3ad0b8', '--accent-hover': '#5be0c8', '--danger': '#ff6b8a', '--success': '#5be0a0', '--warning': '#ffd166',
    ...DARK_SHADOW, '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(58,208,184,.30)', '--accent-glow': 'rgba(58,208,184,.24)',
    '--btn-top': 'rgba(45,90,84,.55)', '--btn-bot': 'rgba(14,30,28,.65)', '--edge': 'rgba(91,224,200,.22)',
  },
};
const DOU_SHA_LV_GLASS = {
  id: 'dou-sha-lv-glass', label: '豆沙绿玻璃', kind: 'light',
  vars: {
    '--bg-primary': '#C7EDCC', '--bg-secondary': '#d6f2d9', '--bg-tertiary': '#cfeccf',
    '--bg-toolbar': '#bfe6c4', '--bg-statusbar': '#bfe6c4', '--bg-panel-header': '#cfeccf',
    '--bg-hover': '#b9e0bf', '--bg-active': '#2e7d3233',
    '--border-primary': '#a9d6b0', '--border-subtle': '#c2e6c8',
    '--text-primary': '#1f3d1f', '--text-secondary': '#3a5a3a', '--text-muted': '#557a55', '--text-accent': '#1f6b3a',
    '--accent': '#2e7d32', '--accent-hover': '#1b5e20', '--danger': '#c62828', '--success': '#2e7d32', '--warning': '#f9a825',
    ...LIGHT_SHADOW, '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(46,125,50,.32)', '--accent-glow': 'rgba(46,125,50,.22)',
    '--btn-top': 'rgba(255,255,255,.85)', '--btn-bot': 'rgba(199,237,204,.58)', '--edge': 'rgba(255,255,255,.80)',
  },
};
// mac-glass 与既有 macos(亮) 区分：采用 macOS 暗色模式配色，id 唯一
const MAC_GLASS = {
  id: 'mac-glass', label: 'macOS 玻璃（暗）', kind: 'dark',
  vars: {
    '--bg-primary': '#1d1d1f', '--bg-secondary': '#2c2c2e', '--bg-tertiary': '#3a3a3c',
    '--bg-toolbar': '#2c2c2e', '--bg-statusbar': '#1d1d1f', '--bg-panel-header': '#3a3a3c',
    '--bg-hover': '#48484a', '--bg-active': 'rgba(10,132,255,.16)',
    '--border-primary': '#3a3a3c', '--border-subtle': '#2c2c2e',
    '--text-primary': '#f5f5f7', '--text-secondary': '#d6d6da', '--text-muted': '#9a9aa0', '--text-accent': '#0a84ff',
    '--accent': '#0a84ff', '--accent-hover': '#409cff', '--danger': '#ff453a', '--success': '#32d74b', '--warning': '#ffd60a',
    ...DARK_SHADOW, '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px',
    '--ambient': 'rgba(10,132,255,.32)', '--accent-glow': 'rgba(10,132,255,.24)',
    '--btn-top': 'rgba(90,90,96,.55)', '--btn-bot': 'rgba(28,28,32,.65)', '--edge': 'rgba(120,160,210,.24)',
  },
};

// 完整 33 项主题列表：21 标准 + 豆沙绿亮/暗 + 4 套玻璃 + 6 套原型玻璃
export const EDITOR_THEMES = [
  ...STANDARD_THEMES,
  DOU_SHA_LV_LIGHT,
  DOU_SHA_LV_DARK,
  GLACIER_THEME,
  AURORA_THEME,
  FLUENT_THEME,
  MACOS_THEME,
  GITHUB_GLASS_DARK,
  GITHUB_GLASS_LIGHT,
  NORD_GLASS,
  AURORA_GLASS,
  DOU_SHA_LV_GLASS,
  MAC_GLASS,
];

// 默认主题：豆沙绿（亮）
export const DEFAULT_EDITOR_THEME = 'dou-sha-lv-light';

const EDITOR_THEME_KEY = 'md-editor-editor-theme';

const isKnownTheme = (id) => EDITOR_THEMES.some((t) => t.id === id);

// 默认暗色主题：豆沙绿（暗），与 DEFAULT_EDITOR_THEME 构成默认明暗对偶。
export const DEFAULT_DARK_EDITOR_THEME = 'dou-sha-lv-dark';

// 明暗对偶预设映射（同族配对）。
// 背景（修复 THM-01）：data-theme 的单一事实源是「当前编辑器主题预设的 kind」
// （见下方 applyEditorThemePreset）。因此「明/暗切换」不能只翻转一个独立变量，
// 否则会被 applyEditorThemePreset 立刻覆盖回预设 kind，使按钮对 CSS 变量层完全失效
// （表现为：编辑区文本变暗，但工具栏/预览区仍是亮色的割裂状态）。
// 正确语义：明暗切换 = 切换到同族的对偶预设；无同族对偶时回退到目标 kind 的默认预设。
const THEME_COUNTERPARTS = {
  light: 'dark',
  dark: 'light',
  github: 'github-dark',
  'github-dark': 'github',
  'one-light': 'one-dark',
  'one-dark': 'one-light',
  'solarized-light': 'solarized-dark',
  'solarized-dark': 'solarized-light',
  'catppuccin-latte': 'catppuccin-mocha',
  'catppuccin-mocha': 'catppuccin-latte',
  'dou-sha-lv-light': 'dou-sha-lv-dark',
  'dou-sha-lv-dark': 'dou-sha-lv-light',
  // ── 审计 M1 修复：6 套原型玻璃主题明暗对偶（尽量同族/同色系，均留在玻璃家族内） ──
  // github 玻璃同族完美配对；其余暗色玻璃无原生亮色玻璃版，配对到色系最近的亮色玻璃，
  // 避免明暗切换回退默认时跳出玻璃家族（data-theme kind 仍正确翻转）。
  'github-glass-light': 'github-glass-dark',
  'github-glass-dark': 'github-glass-light',
  'dou-sha-lv-glass': 'nord-glass',
  'nord-glass': 'dou-sha-lv-glass',
  'aurora-glass': 'glacier',
  'glacier': 'aurora-glass',
  'mac-glass': 'macos',
  'macos': 'mac-glass',
};

// 读取预设的明暗归属；未知 id 视为 light（与 applyEditorThemePreset 的兜底保持一致）。
export function getThemeKind(themeId) {
  const t = EDITOR_THEMES.find((x) => x.id === themeId);
  return t && t.kind === 'dark' ? 'dark' : 'light';
}

// 取当前预设的「明暗对偶」预设 id：优先同族配对，否则回退到目标 kind 的默认预设。
export function getCounterpartTheme(themeId) {
  const paired = THEME_COUNTERPARTS[themeId];
  if (paired && isKnownTheme(paired)) return paired;
  return getThemeKind(themeId) === 'dark' ? DEFAULT_EDITOR_THEME : DEFAULT_DARK_EDITOR_THEME;
}

// 应用主题预设：设置 documentElement 的 data-editor-theme；未知用默认。
// 修复 BUG6：编辑器明暗基底(data-theme)与所选配色预设(kind)必须一致，否则出现
// "暗色主题下编辑区仍白底"或双轴错乱。此处按预设 kind 同步 data-theme，
// 使 CM6 明暗主题(oneDark/lightTheme)与 23 套配色变量对齐。
export function applyEditorThemePreset(themeId) {
  const theme = EDITOR_THEMES.find((t) => t.id === themeId);
  const id = theme ? theme.id : DEFAULT_EDITOR_THEME;
  const kind = theme ? theme.kind : 'light';
  document.documentElement.setAttribute('data-editor-theme', id);
  document.documentElement.setAttribute('data-theme', kind === 'dark' ? 'dark' : 'light');
  // 玻璃拟态 skin 维度（默认玻璃，与主题正交）：在此统一设置，使首屏与切换主题时
  // 均挂载 [data-skin="glass"]，避免 init 遗漏导致玻璃皮肤旗舰特性首屏不生效（审计 F-01）。
  document.documentElement.setAttribute('data-skin', 'glass');
  return id;
}

// 读取已存储主题；无则返回默认
export function getStoredEditorTheme() {
  try {
    const v = localStorage.getItem(EDITOR_THEME_KEY);
    return v ? v : DEFAULT_EDITOR_THEME;
  } catch {
    return DEFAULT_EDITOR_THEME;
  }
}

// 存储主题到 localStorage
export function setStoredEditorTheme(themeId) {
  try {
    localStorage.setItem(EDITOR_THEME_KEY, themeId);
  } catch {
    /* localStorage 不可用时静默忽略 */
  }
}

// 初始化主题下拉：填充 <option> 并绑定切换。
// onChange（可选）：预设切换后回调，入参 (themeId, kind)。宿主页据此同步自身运行时状态
// （CM6 明暗扩展 / mermaid 主题 / 主题图标），避免「下拉选了暗色预设但编辑器仍用亮色扩展」
// 的反向不一致（修复 THM-01 的第二个方向）。不传时行为与旧版完全一致，保持向后兼容。
export function initThemeSelect(onChange) {
  const sel = document.getElementById('editorThemeSelect');
  if (!sel) return;
  sel.textContent = '';
  for (const t of EDITOR_THEMES) {
    const opt = document.createElement('option');
    opt.value = t.id;            // 用属性赋值，避免注入
    opt.textContent = t.label;   // textContent 防注入
    sel.appendChild(opt);
  }
  const current = getStoredEditorTheme();
  sel.value = current;
  sel.addEventListener('change', () => {
    setStoredEditorTheme(sel.value);
    const applied = applyEditorThemePreset(sel.value);
    if (typeof onChange === 'function') {
      try {
        onChange(applied, getThemeKind(applied));
      } catch (err) {
        // 宿主回调失败不应阻断主题本身的切换（预设已生效）
        console.error('[theme] onChange 回调失败', err);
      }
    }
  });
}

// 便于测试：导出变量键（非契约必需）
export const THEME_VARS_KEYS = THEME_KEYS;
