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
  highlightActiveLine, keymap, EditorView, ViewPlugin, Decoration,
} from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting, defaultHighlightStyle, indentOnInput,
  bracketMatching, foldGutter, foldKeymap,
} from '@codemirror/language';
import {
  closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap,
} from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
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

// ==========================================
// 需求 A：自定义「选中字符串高亮」ViewPlugin（替换内置 highlightSelectionMatches）
// 根因：内置 highlightSelectionMatches() 在拖动选区的每一帧都重建匹配集并重绘，
//       多处匹配时产生可见闪烁。此处改为「拖动中不高亮、松开后一次性高亮全部」：
//       - 选区/文档变化（拖动、Shift 方向键、输入）时立即清除高亮，重置 150ms 防抖计时器；
//         清空心高亮对每帧而言均为空→空，无视觉跳变，故拖动全程无闪烁。
//       - 连续变化停止 150ms（空闲 / 落定）后，由计时器派发一次性事务触发重算；
//       - 仅扫描视口 visibleRanges，maxMatches 封顶 100，避免大文档全量扫描拖帧；
//       - 幂等备忘：落定后若选中文本与上次查询相同则跳过重算（避免不必要的重绘）。
//       保留「高亮全部相同串」功能，仅消除闪烁。
// ==========================================
const SELECTION_MATCH_MAX = 100;
const SELECTION_MATCH_MIN = 2;       // 与内置默认 minMatch 对齐，避免单字符满屏高亮
const SELECTION_MATCH_DEBOUNCE = 150; // ms，选区落定后的空闲阈值

// 计时器派发事务用的注解：仅携带此注解的事务才触发重算，避免与正常事务耦合。
const recomputeAnnotation = Annotation.define();

function computeSelectionMatches(view, maxMatches) {
  const sel = view.state.selection.main;
  const text = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to);
  if (!text || text.length < SELECTION_MATCH_MIN) return Decoration.set([], true);

  const needle = text;
  const builder = [];
  let count = 0;

  for (const { from, to } of view.visibleRanges) {
    const slice = view.state.doc.sliceString(from, to);
    let idx = slice.indexOf(needle);
    while (idx !== -1) {
      const start = from + idx;
      const end = start + needle.length;
      // 跳过「选中范围本身」，只装饰选区之外的相同串（与内置语义一致）。
      if (!(start <= sel.from && end >= sel.to)) {
        builder.push(Decoration.mark({ class: 'cm-selectionMatch' }).range(start, end));
        count++;
        if (count >= maxMatches) break;
      }
      idx = slice.indexOf(needle, idx + 1);
    }
    if (count >= maxMatches) break;
  }
  return Decoration.set(builder, true);
}

const selectionMatchHighlighter = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.decorations = Decoration.set([], true);
      this.lastQuery = null;
      this.timer = null;
      // 首屏若已有选区，150ms 后一次性高亮（等效于原内置行为，且不闪）。
      this.schedule();
    }

    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        // 空闲阈值到达：派发一次性事务，由 update 识别后重算。
        this.view.dispatch({ annotations: recomputeAnnotation.of(true) });
      }, SELECTION_MATCH_DEBOUNCE);
    }

    update(update) {
      // 选区或文档变化：拖动 / 编辑进行中 → 立即清空心高亮（拖动中不高亮），
      // 重置备忘与防抖计时器；本帧不重算，故无逐帧闪烁。
      if (update.selectionSet || update.docChanged) {
        this.decorations = Decoration.set([], true);
        this.lastQuery = null;
        this.schedule();
        return;
      }
      // 由本插件计时器派发的空闲事务：落定后一次性重算。
      if (update.transactions.some((tr) => tr.annotation(recomputeAnnotation))) {
        this.recompute();
      }
    }

    recompute() {
      const view = this.view;
      const sel = view.state.selection.main;
      const text = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to);
      // 幂等备忘：选中文本与上次查询相同（且非空）则跳过重算，避免几何不变时的重绘 churn。
      if (text && text === this.lastQuery) return;
      this.lastQuery = text;
      this.decorations = computeSelectionMatches(view, SELECTION_MATCH_MAX);
    }

    destroy() {
      clearTimeout(this.timer);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

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
    // 需求 A：自写落定式「选中字符串高亮」，替换内置 highlightSelectionMatches()（消除拖动闪烁）。
    selectionMatchHighlighter,
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
