// 编辑器明暗主题基座：从 editor.js 抽取，供 editor.js 与 editor-extensions.js
// 共享（动态主题切换 compartment + 自定义亮色主题）。
// 本模块不依赖 editor.js，避免工厂反向依赖 editor.js 造成循环依赖。
import { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';

// Theme compartment for dynamic switching
export const themeCompartment = new Compartment();

// Custom light theme
export const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#1f2328',
  },
  '.cm-content': {
    caretColor: '#0969da',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#0969da',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(9, 105, 218, 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(9, 105, 218, 0.04)',
  },
  '.cm-gutters': {
    backgroundColor: '#f6f8fa',
    color: '#8c959f',
    borderRight: '1px solid #e8eaed',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#f0f2f5',
    color: '#656d76',
  },
}, { dark: false });
