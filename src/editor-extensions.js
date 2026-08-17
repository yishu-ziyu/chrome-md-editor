// ==========================================
// 共享编辑器扩展工厂 createEditorExtensions(opts)
// 从 editor.js 的 extensions 数组（原 441–525 行）整体抽取为可复用工厂，
// 供编辑页与对比/合并页共用同一套 CodeMirror 6 内核。
// 本文件不得 import editor.js —— 所有编辑页专属胶水（updateListener 等）
// 都不在此工厂内（见下方说明 / 设计文档 §8.3）。
// ==========================================

import {
  lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor,
  highlightActiveLine, keymap, EditorView,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting, defaultHighlightStyle, indentOnInput,
  bracketMatching, foldGutter, foldKeymap,
} from '@codemirror/language';
import {
  closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap,
} from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';

import { mdEditorHighlightExtensions } from './md-editor-highlight.js';
import { makeSearchPanel } from './search-panel.js';
import { markraSlashMenu } from './slash-menu.js';
import { codeMirrorBlockDragPlugin } from './block-drag.js';
import { initBase64Fold } from './base64-fold.js';
import { BRACKETS_STR } from './close-brackets-config.js';
import { themeCompartment, lightTheme } from './editor-theme-base.js';
import { selectedBracketHighlight } from './bracket-highlight.js';
import { codeBlockLanguageCompletions } from './codeblock-complete.js';

/**
 * 共享编辑器扩展工厂。返回与编辑页等价的扩展数组：
 * 语法高亮彩色 / 查找替换 / 斜杠菜单 / 块拖拽 / 括号匹配 / base64 折叠 /
 * 主题 compartment / markdown 高亮 / 含自定义快捷键的 keymap。
 *
 * 注意（设计文档 §8.3）：工厂【排除】编辑页专属的 updateListener
 * （updatePreview / markModified / scheduleAutosave / updateStatus /
 * maybeCenterActiveLine）—— 该 listener 仍由 editor.js 自身保留，不进入工厂。
 *
 * @param {object} [opts]
 * @param {string} [opts.theme='light'] 当前主题，'dark' 用 oneDark，其余用 lightTheme
 * @param {Array}  [opts.extraKeymap=[]] 追加到 keymap 的自定义绑定（如编辑页的
 *        Mod-s/Mod-o/Mod-b/Mod-i/Mod-g，由各调用方通过此参数注入，保持工厂与
 *        editor.js 解耦）
 * @returns {Array} CodeMirror 6 扩展数组
 */
export function createEditorExtensions(opts = {}) {
  const theme = opts.theme === 'dark' ? oneDark : lightTheme;

  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    // A+B 方案 Phase 2：编辑区 Markdown 语法彩色字体（class 驱动）+ 行底色。
    // 叠加在通用高亮之上，不冲突（前者管通用 token，后者管 markdown tag 的 cm-md-* 类）。
    ...mdEditorHighlightExtensions,
    bracketMatching(),
    // 中文符号自动配对：closeBrackets 本身不接受配置参数（配置经 languageDataAt 读取）。
    // BRACKETS_STR 由 ./close-brackets-config.js 的 BRACKET_PAIRS 权威派生，本处仅消费。
    EditorState.languageData.of((state, pos) => [
      {
        closeBrackets: {
          brackets: BRACKETS_STR,
        },
      },
    ]),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ createPanel: makeSearchPanel }),
    selectedBracketHighlight,
    ...initBase64Fold(),
    // === MARKRA_HOOK: SLASH_MENU === 斜杠菜单
    markraSlashMenu(),
    // === MARKRA_HOOK: BLOCK_DRAG === 块拖拽
    codeMirrorBlockDragPlugin(),
    // === MARKRA_HOOK: VIEW_MODE === 视图模式（预留）
    // === MARKRA_HOOK: WORKSPACE_SEARCH === 工作区搜索（预留）
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
      // 自定义快捷键由各调用方通过 opts.extraKeymap 注入（编辑页：Mod-s/o/b/i/g）
      ...(opts.extraKeymap || []),
    ]),
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [
        markdownLanguage.data.of({ autocomplete: codeBlockLanguageCompletions }),
      ],
    }),
    EditorView.lineWrapping,
    themeCompartment.of(theme),
    // 注意：编辑页专属 updateListener 不放入工厂（见上方函数注释 / 设计文档 §8.3）
  ];
}
