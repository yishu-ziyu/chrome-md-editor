// ==========================================
// Markdown Editor - 核心逻辑
// ==========================================

// 桌面端（Tauri）兼容垫片：注入 window.showOpenFilePicker / showSaveFilePicker /
// showDirectoryPicker / __tauriFileHandle 等，使同一套 Web 源码既能在 Chrome
// 扩展运行、也能在 Tauri 桌面壳里运行（垫片内部有 isTauri 守卫，扩展环境零影响）。
// 必须在 src/editor.js 顶部以 ES Module 形式 import，否则 vite 不会把它打包进
// bundle（src/editor.html 中的 <script src="./desktop-shims.js"> 会被 vite 静默移除）。
import './desktop-shims.js';

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Transaction } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel, setSearchQuery, closeSearchPanel, replaceNext, replaceAll, selectMatches, SearchQuery } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import MarkdownIt from 'markdown-it';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import {
  buildImagesRelativePath,
  buildPastedImageMarkdown,
  createPastedImageFilename,
  dirnameFromRelativePath,
  mimeTypeToExtension,
  resolvePreviewImageSource,
  splitRelativePath,
} from './image-support.js';
import { resolvePreviewLinkClickTarget } from './link-support.js';
import { initWorkspaceSearchPanel, runWorkspaceSearch, setGlobalDirectoryHandle } from './workspace-search.js';
import { showOnboarding, hideOnboarding } from './onboarding.js';
import { applyEditorThemePreset, getStoredEditorTheme, setStoredEditorTheme, initThemeSelect, getThemeKind, getCounterpartTheme } from './theme-presets.js';
import { initFeedbackButton } from './feedback.js';
import { highlightPlugin } from './highlight-plugin.js';
import { rememberLastFile, loadLastFile } from './session-restore.js';
import { initToolbarScroll } from './toolbar-scroll.js';
import { htmlToMarkdown } from './html-to-markdown.js';
import { openFileViaPicker, saveViaPickerOrDownload } from './file-picker.js';
// 共享内核：从 editor.js 抽取，供 editor.js 与 editor-extensions.js 复用（避免工厂反向依赖 editor.js）
import { themeCompartment, lightTheme } from './editor-theme-base.js';
import { selectedBracketHighlight } from './bracket-highlight.js';
// 新建共享模块接入：扩展工厂（§8）+ 滚动同步（§9），均由本文件 import，二者不反向 import editor.js
import { createEditorExtensions } from './editor-extensions.js';
import { createScrollSync, scrollAdapter } from './scroll-sync.js';
import { showConfirm } from './confirm-dialog.js';

// Ctrl+G 跳转行号：注意 @codemirror/commands 在当前版本**不导出** gotoLine
// （CodeMirror 6 无内置「跳行」命令，此前误引入该不存在的导出，导致 vite/rollup 构建失败）。
// 这里自实现，用轻量内联行号输入浮层（而非 window.prompt），以兼容 Tauri webview 原生对话框缺失的环境。
let gotoLineOverlay = null;
function gotoLineCommand(view) {
  showGotoLineInput(view);
  return true;
}
function showGotoLineInput(view) {
  hideGotoLineInput();
  const doc = view.state.doc;
  const overlay = document.createElement('div');
  overlay.className = 'preview-context-menu';
  overlay.style.cssText =
    'position:fixed;top:46px;right:16px;padding:6px 8px;display:flex;gap:6px;align-items:center;z-index:9999;';
  overlay.innerHTML = `
    <span style="font-size:12px;">行号</span>
    <input id="glInput" type="number" min="1" style="width:60px;" />
    <button id="glGo" type="button" class="preview-context-item">跳转</button>`;
  document.body.appendChild(overlay);
  gotoLineOverlay = overlay;
  const input = overlay.querySelector('#glInput');
  const commit = () => {
    const n = Math.floor(Number(input.value));
    hideGotoLineInput();
    if (Number.isFinite(n) && n >= 1) {
      const line = doc.line(Math.min(n, doc.lines));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    }
  };
  overlay.querySelector('#glGo').addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideGotoLineInput(); }
  });
  document.addEventListener('mousedown', onGotoLineOutside, true);
  input.focus();
}
function onGotoLineOutside(e) {
  if (gotoLineOverlay && !gotoLineOverlay.contains(e.target)) hideGotoLineInput();
}
function hideGotoLineInput() {
  if (gotoLineOverlay) {
    gotoLineOverlay.remove();
    gotoLineOverlay = null;
    document.removeEventListener('mousedown', onGotoLineOutside, true);
  }
}
import { applyViewMode, getStoredViewMode, setStoredViewMode, nextViewMode, initChromeModeButton } from './view-mode.js';
import { makeSearchPanel } from './search-panel.js';
import { markraSlashMenu } from './slash-menu.js';
import { restoreScroll } from './scroll-restore.js';
import { codeMirrorBlockDragPlugin } from './block-drag.js';
import {
  scheduleAutosave,
  initAutosave,
  listSnapshots,
  restoreSnapshot,
  offerDraftRestore,
  resolveFileKey,
  initDiskAutosave,
  autosaveToDisk,
  stopAutosaveToDisk,
  isAutosaveToDiskOn,
  normalizeIntervalSec,
  resetDiskAutosaveBaseline,
} from './autosave.js';
import { newInstanceId, pendingFileStorageKey } from './instance-id.js';
import {
  selectionInsideRoot,
  toggleMarkOnRange,
} from './preview-format.js';
import {
  applyPreviewTranslation,
  clearPreviewTranslations,
  ensureTranslateHostPermission,
  loadTranslateSettings,
  normalizeTranslateSettings,
  saveTranslateSettings,
} from './translate.js';

/** Visible build stamp so we can tell if Chrome reloaded the new package.
 *  版本由 Vite 在构建时从 package.json 注入(__APP_VERSION__)，与 manifest 自动同步；
 *  若在未经 Vite 的环境(如使用 node 直接 import)中运行，回退到 "1.9.5"。 */
export const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.9.5";
import {
  getPresetDefaultModel,
  getTranslatePreset,
  groupTranslatePresets,
} from './translate-presets.js';

// A-6 代码块语言名补全
import { codeBlockLanguageCompletions } from './codeblock-complete.js';
// A-7 Callout 提示框（markdown-it 插件）
import { calloutPlugin } from './callout.js';
// A-8 专注模式 + 显示设置
import {
  initDisplaySettings,
  toggleFocusMode,
  toggleTypewriter,
  isFocusMode,
  isTypewriter,
  maybeCenterActiveLine,
  setEditorFontSize,
  getEditorFontSize,
  setPreviewFontSize,
  getPreviewFontSize,
  setDensity,
  getDensity,
} from './focus-mode.js';
// A-9 超长 Base64 行折叠
import { initBase64Fold } from './base64-fold.js';
// A-10 Mermaid 全屏缩放 / 平移
import { enhanceMermaidDiagrams } from './mermaid-zoom.js';
// A-3 大纲面板
import { getOutlineItems, renderOutline, setOutlineEditor } from './outline.js';
// A-12 任务列表面板
import { getTaskItems, renderTaskList, setTaskEditor } from './tasklist-panel.js';

// Markdown 语法高亮（A+B 方案）：编辑区 class 驱动高亮 + 行底色（P2）、
// 预览区 highlight.js 代码块高亮（P3）、多套配色令牌与切换（Phase 1/P4）。
import { mdEditorHighlightExtensions } from './md-editor-highlight.js';
import { createMarkdownHighlight } from './md-preview-highlight.js';
import { getColorScheme, setColorScheme, applyStoredColorScheme } from './md-theme-tokens.js';

// ==========================================
// Mermaid 初始化
// ==========================================
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
  fontFamily: 'Inter, sans-serif',
});

// ==========================================
// Markdown-it 初始化
// ==========================================
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  // A+B 方案 Phase 3：预览区代码块语法高亮（highlight.js 11）。
  // 回调内部已对输出外包 sanitizePreviewHtml（DOMPurify），保持 XSS 防护链不回退。
  highlight: createMarkdownHighlight(sanitizePreviewHtml),
});

// M1 修复（预览 XSS）：markdown-it 保留 html:true，以支持样式工具栏写入的
// <font>/<center> 等标记；但渲染结果必须先经 DOMPurify 净化再注入 DOM，
// 杜绝 DOM-XSS（攻击者可构造含 <script> 或 onerror= 的 .md 文件）。
// 显式放行应用依赖的 font/center 标记与 color/face/size/align 属性；
// class/id/style/data-* 由 DOMPurify 默认策略保留并净化。
function sanitizePreviewHtml(dirty) {
  return DOMPurify.sanitize(dirty, {
    ADD_TAGS: ['font', 'center', 'mark'],
    ADD_ATTR: ['color', 'face', 'size', 'align'],
  });
}

// 任务列表支持
md.use(function taskListPlugin(md) {
  md.core.ruler.after('inline', 'task-list', function(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'inline') {
        const content = tokens[i].content;
        if (/^\[[ xX]\]\s/.test(content)) {
          const checked = /^\[[xX]\]/.test(content);
          tokens[i].content = content.replace(/^\[[ xX]\]\s/, '');
          tokens[i].children[0].content = tokens[i].children[0].content.replace(/^\[[ xX]\]\s/, '');

          // 在内容前插入 checkbox
          const checkboxToken = new state.Token('html_inline', '', 0);
          checkboxToken.content = `<input type="checkbox" disabled ${checked ? 'checked' : ''}>`;
          tokens[i].children.unshift(checkboxToken);

          // 给父级 li 添加 class
          for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].type === 'list_item_open') {
              tokens[j].attrSet('class', 'task-list-item');
              break;
            }
          }
        }
      }
    }
  });
});

// A-7 Callout 提示框（markdown-it 插件；data-callout 属性供预览回写还原）
md.use(calloutPlugin);
// A-8 高亮语法（==高亮== → <mark>）；ADD_TAGS 已放行 'mark' 以免被 DOMPurify 剥除
md.use(highlightPlugin);

// ==========================================
// 状态管理
// ==========================================
let editor = null;
let currentFileHandle = null;
// 已加载文件名（file:// 打开时没有 FileHandle，用此值作为自动保存/快照键的回退来源，见 Bug #1 修复）
let currentFileName = 'unsaved';
let isModified = false;
// 标记「用户主动跳转（如点击对比/合并按钮打开 compare.html）」，用于抑制
// beforeunload 的「是否离开网站？」误报；短延迟后复位，保证独立标签页场景仍受保护。
let intentionalLeave = false;
// 修复 THM-01：明暗基底的单一事实源是「当前编辑器主题预设的 kind」（applyEditorThemePreset 写 data-theme）。
// currentTheme 只是该 kind 的派生量，用于驱动 CM6 明暗扩展 / mermaid / 主题图标。
// 旧实现从独立键 md-editor-theme 读取（默认 'dark'），会与默认预设「豆沙绿（亮）」相互矛盾，
// 导致首屏 CM6 用 oneDark 而 data-theme=light 的割裂。此处统一从预设派生，消除双事实源。
let currentTheme = getThemeKind(getStoredEditorTheme());
let currentViewMode = localStorage.getItem('md-editor-view-mode') || 'split';
let scrollSyncEnabled = true;
// 模块级滚动同步控制器（由 initScrollSync 赋值，bindEvents 的滚动按钮需引用）
let scrollSync = null;
let isPreviewEditing = false; // 防止预览编辑时循环更新
let previewEditReleaseTimer = null; // 智能释放 isPreviewEditing 的计时器（替代固定 120ms）
let mermaidCounter = 0; // mermaid 图表 ID 计数器
let currentFileUrl = null; // file:// 打开的 Markdown 原始地址
let currentDirectoryPath = null; // 相对已打开文件夹根目录的当前 Markdown 目录
let previewObjectUrls = []; // 用于释放通过 File System Access API 生成的 blob URL
let translateEnabled = false; // 预览区阅读翻译（双语对照，不改源码）
let translateBusy = false;
let translateRunId = 0;
let translateSettingsCache = null;

// Theme compartment for dynamic switching（themeCompartment 现已提取到 ./editor-theme-base.js，见顶部 import）

// A+B 方案 Phase 1/4：应用启动即把持久化的配色方案同步到 <html data-color-scheme>，
// 使编辑区(CM6)与预览区(hljs)的令牌色随配色方案即时生效（无需 reconfigure 高亮）。
applyStoredColorScheme();

// Custom light theme（lightTheme 现已提取到 ./editor-theme-base.js，见顶部 import）

// ==========================================
// 符号配对高亮：选中单个配对符号时高亮其另一半
// 纯逻辑已抽取至 ./bracket-utils.js（便于单元测试，行为不变）
// ==========================================
import { PAIR_GROUPS, SELF_PAIRS, bracketMatchMap, findSelfPair, findPairedBracket } from './bracket-utils.js';
// CodeMirror closeBrackets 配置（单一事实源：BRACKETS_STR 已按 CM6 「相邻成对」规则构造）
import { BRACKETS_STR } from './close-brackets-config.js';
// 预览区符号自动配对（与编辑器 closeBrackets 行为对齐）
import { getAutoPairClose } from './auto-pair.js';

// 符号配对高亮（selectedBracketHighlight 现已提取到 ./bracket-highlight.js，见顶部 import）

// ==========================================
// 编辑器初始化
// ==========================================
function createEditor() {
  const editorContainer = document.getElementById('editorContainer');

  const startDoc = `# 欢迎使用 Markdown Editor

> 一个简洁、高效的 Markdown 编辑器 Chrome 扩展

## 快速开始

- 按 \`Ctrl+O\` 打开本地 .md 文件
- 按 \`Ctrl+S\` 保存当前文件
- 使用工具栏快捷按钮进行格式化
- 拖拽中间分隔条调整编辑/预览比例
- **直接在预览区编辑内容**，修改会自动同步回源码

## 支持的 Markdown 语法

### 文本格式

**粗体文本** _斜体文本_ ~~删除线~~ \`行内代码\`

### 列表

- 无序列表项 1
- 无序列表项 2
  - 嵌套列表项

1. 有序列表项 1
2. 有序列表项 2

### 任务列表

- [x] 已完成任务
- [ ] 未完成任务

### 代码块

\`\`\`javascript
function hello() {
  console.log('Hello, Markdown!');
}
\`\`\`

### 表格

| 功能 | 快捷键 | 说明 |
|------|--------|------|
| 打开 | Ctrl+O | 打开文件 |
| 保存 | Ctrl+S | 保存文件 |
| 加粗 | Ctrl+B | 加粗文本 |
| 斜体 | Ctrl+I | 斜体文本 |

### 引用

> 这是一段引用文本。
> 支持多行引用。

### Mermaid 图表

\`\`\`mermaid
graph LR
    A[编辑 Markdown] --> B[实时预览]
    B --> C{满意吗?}
    C -->|是| D[保存文件]
    C -->|否| A
\`\`\`

### 链接和图片

[访问 GitHub](https://github.com)

---

*开始编辑你的 Markdown 文档吧！*
`;

  // 共享扩展工厂接入（设计文档 §8）：原内联扩展数组整体迁入 createEditorExtensions，
  // 自定义快捷键经 extraKeymap 注入；编辑页专属 updateListener 不进工厂（§8.3），下方单独追加。
  const extensions = createEditorExtensions({
    theme: currentTheme,
    extraKeymap: [
      { key: 'Mod-s', run: handleSave, preventDefault: true },
      { key: 'Mod-o', run: handleOpen, preventDefault: true },
      { key: 'Mod-b', run: () => wrapSelection('**', '**'), preventDefault: true },
      { key: 'Mod-i', run: () => wrapSelection('*', '*'), preventDefault: true },
      { key: 'Mod-g', run: gotoLineCommand },
    ],
  });
  // 编辑页专属胶水（更新预览 / 状态 / 自动保存 / 居中活动行），由 editor.js 保留，不进工厂。
  extensions.push(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        updatePreview();
        updateStatus();
        markModified();
        scheduleStructureRefresh();
        scheduleAutosave();
      }
      if (update.selectionSet) {
        updateCursorStatus();
        maybeCenterActiveLine(editor);
      }
    })
  );

  editor = new EditorView({
    state: EditorState.create({
      doc: startDoc,
      extensions,
    }),
    parent: editorContainer,
  });

  // A-3 / A-12：把编辑器视图交给大纲 / 任务面板模块
  setOutlineEditor(editor);
  setTaskEditor(editor);

  // 初始化预览
  updatePreview();
  updateStatus();

  // 初始构建一次大纲 / 任务列表
  try {
    renderOutline(getOutlineItems(editor));
    renderTaskList(getTaskItems(editor));
  } catch (err) {
    
  }
}

// ==========================================
// 预览更新
// ==========================================
let previewUpdateTimer = null;

function updatePreview() {
  if (isPreviewEditing) {
    
    return; // 避免预览编辑时循环
  }

  // 防抖：快速输入时减少渲染次数；开启翻译时略加长，降低 API 调用频率
  clearTimeout(previewUpdateTimer);
  const delay = translateEnabled ? 450 : 80;
  
  previewUpdateTimer = setTimeout(() => {
    doUpdatePreview();
  }, delay);
}

// ==========================================
// 大纲 / 任务列表结构刷新（防抖）
// ==========================================
let structureRefreshTimer = null;
function scheduleStructureRefresh() {
  clearTimeout(structureRefreshTimer);
  structureRefreshTimer = setTimeout(() => {
    try {
      const items = getOutlineItems(editor);
      renderOutline(items);
      const tasks = getTaskItems(editor);
      renderTaskList(tasks);
    } catch (err) {
      
    }
  }, 150);
}

function buildEnvSnapshot() {
  const snap = {
    version: APP_VERSION,
    theme: currentTheme,
    viewMode: currentViewMode,
    isTauri: !!(window && window.__TAURI_INTERNALS__),
    docLen: editor ? editor.state.doc.length : null,
    lineCount: editor ? editor.state.doc.lines : null,
    selectionHead: editor ? editor.state.selection.main.head : null,
    previewScrollTop: (() => {
      const p = document.getElementById('previewContainer');
      return p ? p.scrollTop : null;
    })(),
  };
  try {
    snap.userAgent = navigator.userAgent;
  } catch { /* ignore */ }
  return snap;
}

// M11 修复：轻量字符串哈希（cyrb53），作为预览防闪烁的稳健内容指纹。
// 旧实现仅取「长度 + 首尾各 50 字符」，当两次变更等长且首尾相同时会误判未变，
// 从而跳过重渲染、预览陈旧。cyrb53 对全文取哈希，碰撞概率可忽略。
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// 预览区上一帧渲染内容的哈希（用于跳过无变化渲染，消除闪烁）
let lastRenderedHash = '';

async function doUpdatePreview() {
  const previewContainer = document.getElementById('previewContainer');
  if (!previewContainer) return;
  const content = editor.state.doc.toString();
    let html = sanitizePreviewHtml(md.render(content));

  // 防闪烁优化：如果渲染结果与上帧完全相同，跳过 DOM 替换（消除视觉闪烁）。
  // M11 修复：改用 cyrb53 全文哈希替代「长度 + 首尾 50 字符」，避免等长且首尾相同的
  // 中部变更被误判为未变而跳过重渲染（预览陈旧）。cyrb53 为 O(n) 轻量哈希，开销可控。
  const quickHash = cyrb53(html);
  if (quickHash === lastRenderedHash && lastRenderedHash !== '') {
    return; // 内容未变，跳过渲染
  }

  // 渲染 Mermaid 图表
  // markdown-it 会把 ```mermaid 渲染成 <pre><code class="language-mermaid">...</code></pre>
  cleanupPreviewObjectUrls();
  const previewScrollTopBefore = previewContainer.scrollTop;
  const previewScrollHeightBefore = previewContainer.scrollHeight;

  // 使用淡入过渡减少替换时的视觉闪烁
  previewContainer.style.opacity = '0';
  previewContainer.innerHTML = html;
  const previewScrollTopAfter = previewContainer.scrollTop;
  

  // 查找所有 mermaid 代码块并渲染
  const mermaidBlocks = previewContainer.querySelectorAll('code.language-mermaid');
  for (const block of mermaidBlocks) {
    const source = block.textContent;
    const pre = block.parentElement;
    // 记录原始 fence 源码（Critical 数据丢失修复）：
    // 下面会把 <pre><code> 整块替换成渲染后的 <div>，该 DOM 不可逆向回 Markdown。
    // 预览区是 contenteditable，失焦会触发 syncPreviewToEditor 用 htmlToMarkdown 的
    // 结果整体覆盖编辑器全文；若无此属性，Mermaid 源码会被静默永久删除。
    // html-to-markdown.js convertNode 读取该属性还原代码块。
    const mermaidSource = `\`\`\`mermaid\n${String(source).replace(/\s+$/, '')}\n\`\`\``;
    try {
      mermaidCounter++;
            const { svg } = await mermaid.render(`mermaid-${mermaidCounter}`, source);
      const div = document.createElement('div');
      div.className = 'mermaid-diagram';
      div.setAttribute('data-md-source', mermaidSource);
      // 渲染结果为不可编辑整体：避免用户在预览区误改 SVG 内部结构后回写出脏数据
      div.setAttribute('contenteditable', 'false');
      // M8 修复：mermaid 返回的 svg 也必须过 DOMPurify，复用项目已引入的 DOMPurify
      // （见顶部 import）。mermaid 自身 securityLevel:'strict' 仅为缓解，不可作为唯一防线。
      div.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      pre.replaceWith(div);
    } catch (err) {
      // 渲染失败时显示错误
            const div = document.createElement('div');
      div.className = 'mermaid-error';
      div.setAttribute('data-md-source', mermaidSource);
      div.setAttribute('contenteditable', 'false');
      div.textContent = 'Mermaid 渲染错误: ' + err.message;
      pre.replaceWith(div);
    }
  }

  // A-10：为每个 mermaid 图表补充「全屏 / 缩放 / 平移」按钮（仅增强一次）
  try {
    enhanceMermaidDiagrams(previewContainer);
  } catch (err) {
    
  }

  // 不可逆 / 易损渲染块设为不可编辑，避免用户在 contenteditable 预览区误改后，
  // syncPreviewToEditor 把脏数据回写覆盖源码（与 Mermaid 同理，见下方 protectPreviewBlocks）。
  try {
    protectPreviewBlocks(previewContainer);
  } catch (err) {
    
  }

  await resolvePreviewImages(previewContainer);

  if (translateEnabled) {
    await runPreviewTranslation(previewContainer);
  } else {
    setTranslateUiState({ active: false });
  }
  // 修复 BUG-2：预览区 innerHTML 重建会把滚动位置复位到头部（编辑区或预览区变更都会触发）。
  // 在此恢复重建前的滚动位置（含 requestAnimationFrame 兜底）。若内容变短，浏览器会自动 clamp 到末尾，无副作用。
  try {
    if (previewContainer && previewScrollTopBefore != null) {
      restoreScroll(previewContainer, previewScrollTopBefore);
    }
  } catch (e) {
    
  }

  // 一致性检查（开发调试用，仅 console 输出，不阻塞渲染 / 用户操作）
  checkPreviewConsistency();

  // 防闪烁：淡入恢复 + 记录当前帧哈希
  requestAnimationFrame(() => {
    if (previewContainer) previewContainer.style.opacity = '';
  });
  lastRenderedHash = quickHash;
}

async function getTranslateSettings() {
  if (translateSettingsCache) return translateSettingsCache;
  translateSettingsCache = await loadTranslateSettings();
  return translateSettingsCache;
}

function setTranslateUiState({ active, busy, error, message } = {}) {
  const btn = document.getElementById('btnTranslate');
  const title = document.getElementById('previewPanelTitle');
  const status = document.getElementById('translateStatus');
  const previewContainer = document.getElementById('previewContainer');

  if (btn) {
    btn.classList.toggle('active-translate', !!active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.title = active
      ? '关闭阅读翻译'
      : '阅读翻译：预览双语对照（右键打开设置）';
  }

  if (title) {
    title.textContent = active ? '预览 · 双语' : '预览';
  }

  if (previewContainer) {
    previewContainer.classList.toggle('translate-active', !!active);
    // Avoid WYSIWYG round-trip while translation nodes are present
    previewContainer.setAttribute('contenteditable', active ? 'false' : 'true');
  }

  if (!status) return;

  if (busy) {
    status.hidden = false;
    status.className = 'panel-header-meta is-busy';
    status.textContent = message || '翻译中…';
    return;
  }

  if (error) {
    status.hidden = false;
    status.className = 'panel-header-meta is-error';
    status.textContent = message || '翻译失败';
    return;
  }

  if (active && message) {
    status.hidden = false;
    status.className = 'panel-header-meta';
    status.textContent = message;
    return;
  }

  status.hidden = true;
  status.textContent = '';
  status.className = 'panel-header-meta';
}

async function runPreviewTranslation(previewContainer) {
  const runId = ++translateRunId;
  const settings = await getTranslateSettings();

  if (!settings.apiKey) {
    setTranslateUiState({ active: true, error: true, message: '未配置 API Key' });
    showToast('请先配置翻译 API Key', 'error');
    openTranslateSettingsModal();
    return;
  }

  translateBusy = true;
  setTranslateUiState({ active: true, busy: true, message: '翻译中…' });

  try {
    // Validate origin only. Do NOT chrome.permissions.request here — after
    // awaits it loses the user gesture and throws misleading errors.
    await ensureTranslateHostPermission(settings);

    const result = await applyPreviewTranslation(previewContainer, settings, {
      onProgress: ({ done, total }) => {
        if (runId !== translateRunId) return;
        setTranslateUiState({
          active: true,
          busy: true,
          message: `翻译中 ${done}/${total}`,
        });
      },
    });

    if (runId !== translateRunId) return;

    setTranslateUiState({
      active: true,
      message: result.total ? `已译 ${result.applied}/${result.total}` : '无可译段落',
    });
  } catch (err) {
    if (runId !== translateRunId) return;
    console.warn('translate failed', err);
    setTranslateUiState({
      active: true,
      error: true,
      message: '翻译失败',
    });
    const msg = String(err?.message || '翻译失败');
    // Friendlier network / permission failures
    if (/Failed to fetch|NetworkError|ERR_FAILED|blocked/i.test(msg)) {
      showToast(
        '无法连接翻译 API。请确认已重新加载最新扩展，且预设域名正确；自定义域名可在设置保存时授权。',
        'error'
      );
    } else {
      showToast(msg, 'error');
    }
  } finally {
    if (runId === translateRunId) {
      translateBusy = false;
    }
  }
}

async function toggleTranslateMode() {
  if (translateBusy) {
    showToast('翻译进行中，请稍候…');
    return;
  }

  if (translateEnabled) {
    translateEnabled = false;
    translateRunId += 1;
    const previewContainer = document.getElementById('previewContainer');
    clearPreviewTranslations(previewContainer);
    setTranslateUiState({ active: false });
    // Re-render clean preview (also restores contenteditable)
    doUpdatePreview();
    showToast('已关闭阅读翻译');
    return;
  }

  const settings = await getTranslateSettings();
  if (!settings.apiKey) {
    openTranslateSettingsModal();
    showToast('请先配置翻译 API Key');
    return;
  }

  translateEnabled = true;
  setTranslateUiState({ active: true, busy: true, message: '翻译中…' });
  await doUpdatePreview();
}

function openTranslateSettingsModal() {
  const modal = document.getElementById('translateSettingsModal');
  if (!modal) return;

  ensureTranslatePresetOptions();
  getTranslateSettings().then((settings) => {
    fillTranslateSettingsForm(settings);
    modal.hidden = false;
    document.getElementById('translateApiKey')?.focus();
  });
}

function closeTranslateSettingsModal() {
  const modal = document.getElementById('translateSettingsModal');
  if (modal) modal.hidden = true;
}

function ensureTranslatePresetOptions() {
  const select = document.getElementById('translatePreset');
  if (!select || select.dataset.ready === '1') return;

  select.innerHTML = '';
  for (const group of groupTranslatePresets()) {
    const og = document.createElement('optgroup');
    og.label = group.groupLabel;
    for (const p of group.items) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      og.appendChild(opt);
    }
    select.appendChild(og);
  }
  select.dataset.ready = '1';
}

function fillTranslateSettingsForm(settings) {
  const s = normalizeTranslateSettings(settings);
  ensureTranslatePresetOptions();

  const presetEl = document.getElementById('translatePreset');
  const apiKey = document.getElementById('translateApiKey');
  const baseUrl = document.getElementById('translateBaseUrl');
  const modelOverride = document.getElementById('translateModel');
  const targetLang = document.getElementById('translateTargetLang');

  if (presetEl) presetEl.value = s.presetId;
  if (apiKey) apiKey.value = s.apiKey;
  if (baseUrl) baseUrl.value = s.baseUrl;
  if (modelOverride) modelOverride.value = '';
  if (targetLang) targetLang.value = s.targetLang;

  applyPresetToForm(s.presetId, { model: s.model, baseUrl: s.baseUrl, keepBaseUrl: s.useCustomEndpoint });
}

function applyPresetToForm(presetId, { model, baseUrl, keepBaseUrl } = {}) {
  const preset = getTranslatePreset(presetId);
  const note = document.getElementById('translatePresetNote');
  const apiKey = document.getElementById('translateApiKey');
  const modelFields = document.getElementById('translateModelFields');
  const modelSelect = document.getElementById('translateModelSelect');
  const modelCustomWrap = document.getElementById('translateModelCustomWrap');
  const modelCustom = document.getElementById('translateModelCustom');
  const baseUrlEl = document.getElementById('translateBaseUrl');
  const advanced = document.getElementById('translateAdvanced');

  if (note) {
    const bits = [];
    if (preset.note) bits.push(preset.note);
    if (preset.docsUrl) bits.push(`申请 Key：${preset.docsUrl}`);
    note.textContent = bits.join(' · ');
  }

  if (apiKey && preset.keyHint) {
    apiKey.placeholder = `例如 ${preset.keyHint}`;
  }

  const isDeepl = preset.kind === 'deepl';
  if (modelFields) modelFields.hidden = isDeepl;

  if (!isDeepl && modelSelect) {
    modelSelect.innerHTML = '';
    const models = preset.models?.length
      ? preset.models
      : [{ id: getPresetDefaultModel(preset), label: getPresetDefaultModel(preset), default: true }];

    let matched = false;
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      modelSelect.appendChild(opt);
      if (model && m.id === model) matched = true;
    }

    // Freeform model not in list
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '其他（手动输入模型名）';
    modelSelect.appendChild(customOpt);

    if (model && matched) {
      modelSelect.value = model;
      if (modelCustomWrap) modelCustomWrap.hidden = true;
    } else if (model && !matched) {
      modelSelect.value = '__custom__';
      if (modelCustomWrap) modelCustomWrap.hidden = false;
      if (modelCustom) modelCustom.value = model;
    } else {
      modelSelect.value = getPresetDefaultModel(preset) || models[0]?.id || '';
      if (modelCustomWrap) modelCustomWrap.hidden = true;
    }
  }

  if (baseUrlEl) {
    if (keepBaseUrl && baseUrl) {
      baseUrlEl.value = baseUrl;
    } else {
      baseUrlEl.value = preset.baseUrl || '';
    }
  }

  // Open advanced by default for custom / oneapi
  if (advanced) {
    advanced.open = preset.id === 'custom' || preset.id === 'oneapi' || preset.id === 'doubao';
  }
}

function readModelFromForm() {
  const override = document.getElementById('translateModel')?.value?.trim();
  if (override) return override;

  const modelSelect = document.getElementById('translateModelSelect');
  if (!modelSelect || modelSelect.closest('#translateModelFields')?.hidden) {
    return '';
  }
  if (modelSelect.value === '__custom__') {
    return document.getElementById('translateModelCustom')?.value?.trim() || '';
  }
  return modelSelect.value || '';
}

async function saveTranslateSettingsFromForm() {
  const presetId = document.getElementById('translatePreset')?.value || 'deepseek';
  const preset = getTranslatePreset(presetId);
  const baseUrlInput = document.getElementById('translateBaseUrl')?.value?.trim() || '';
  const presetBase = (preset.baseUrl || '').replace(/\/+$/, '');
  const useCustomEndpoint =
    presetId === 'custom' ||
    presetId === 'oneapi' ||
    (baseUrlInput && baseUrlInput.replace(/\/+$/, '') !== presetBase);

  const next = normalizeTranslateSettings({
    presetId,
    apiKey: document.getElementById('translateApiKey')?.value || '',
    baseUrl: baseUrlInput || presetBase,
    model: readModelFromForm(),
    targetLang: document.getElementById('translateTargetLang')?.value || 'zh-CN',
    useCustomEndpoint,
    provider: preset.kind === 'deepl' ? 'deepl' : 'openai',
    deeplEndpoint: preset.deeplEndpoint || 'free',
  });

  if (!next.apiKey) {
    showToast('API Key 不能为空', 'error');
    return;
  }

  translateSettingsCache = await saveTranslateSettings(next);
  closeTranslateSettingsModal();
  showToast(`已保存 · ${preset.label}`, 'success');

  if (translateEnabled) {
    await doUpdatePreview();
  }
}

function initTranslateSettingsModal() {
  const modal = document.getElementById('translateSettingsModal');
  if (!modal) return;

  ensureTranslatePresetOptions();

  document.getElementById('translatePreset')?.addEventListener('change', (e) => {
    applyPresetToForm(e.target.value, {});
  });

  document.getElementById('translateModelSelect')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('translateModelCustomWrap');
    if (wrap) wrap.hidden = e.target.value !== '__custom__';
    if (e.target.value === '__custom__') {
      document.getElementById('translateModelCustom')?.focus();
    }
  });

  document.getElementById('translateSettingsCancel')?.addEventListener('click', closeTranslateSettingsModal);
  document.getElementById('translateSettingsSave')?.addEventListener('click', () => {
    saveTranslateSettingsFromForm();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeTranslateSettingsModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) {
      closeTranslateSettingsModal();
    }
  });
}

function cleanupPreviewObjectUrls() {
  for (const url of previewObjectUrls) {
    URL.revokeObjectURL(url);
  }
  previewObjectUrls = [];
}

function hasDirectImageUrl(src) {
  return /^(https?:|data:|blob:|chrome-extension:|file:\/\/)/i.test(src);
}

function looksLikeLocalImageSource(src) {
  const normalized = String(src || '').trim();
  if (!normalized) return false;
  if (hasDirectImageUrl(normalized)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) return true;
  if (normalized.startsWith('/')) return true;
  return !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalized);
}

async function resolvePreviewImages(previewContainer) {
  const images = previewContainer.querySelectorAll('img');

  await Promise.all(
    Array.from(images, async (img) => {
      const originalSrc = img.getAttribute('src') || '';
      const resolvedSrc = resolvePreviewImageSource(originalSrc, {
        currentFileUrl,
        currentDirectoryPath,
      });

      if (!resolvedSrc) {
        if (looksLikeLocalImageSource(originalSrc)) {
          img.title = '无法解析本地图片路径。请使用“打开文件夹”或拖拽 file:// 文件打开 Markdown。';
        }
        return;
      }

      try {
        const finalSrc = await materializePreviewImageSource(resolvedSrc);
        img.setAttribute('data-md-original-src', originalSrc);
        img.setAttribute('src', finalSrc);
      } catch (err) {
        console.warn('本地图片加载失败:', originalSrc, err);
        img.title = '本地图片加载失败: ' + err.message;
      }
    })
  );
}

async function materializePreviewImageSource(resolvedSrc) {
  if (hasDirectImageUrl(resolvedSrc)) {
    return resolvedSrc;
  }

  if (!directoryHandle) {
    return resolvedSrc;
  }

  const file = await getFileFromDirectoryPath(resolvedSrc);
  const objectUrl = URL.createObjectURL(file);
  previewObjectUrls.push(objectUrl);
  return objectUrl;
}

async function getFileFromDirectoryPath(relativePath) {
  const segments = splitRelativePath(relativePath);
  if (segments.length === 0) {
    throw new Error('图片路径为空');
  }

  let handle = directoryHandle;
  for (const segment of segments.slice(0, -1)) {
    handle = await handle.getDirectoryHandle(segment);
  }

  const fileHandle = await handle.getFileHandle(segments[segments.length - 1]);
  return fileHandle.getFile();
}

function setCurrentDocumentContext({ fileUrl = null, directoryPath = null } = {}) {
  currentFileUrl = fileUrl;
  currentDirectoryPath = directoryPath;
}

function clearCurrentDocumentContext() {
  setCurrentDocumentContext({ fileUrl: null, directoryPath: null });
}

// ==========================================
// 预览区可编辑（WYSIWYG）
// ==========================================
// 预览区选区缓存：点工具栏时 preview 会失焦，需在 mousedown 前保住 Range
let savedPreviewRange = null;

function rememberPreviewSelection() {
  const previewContainer = document.getElementById('previewContainer');
  const sel = window.getSelection();
  if (!selectionInsideRoot(sel, previewContainer)) {
    // 当前选区不在预览区（例如用户改在编辑区选中）→ 必须清掉上一次的预览选区，
    // 否则合并后的高亮按钮会拿陈旧 Range 去高亮预览里早已不相关的文字。
    savedPreviewRange = null;
    return null;
  }
  try {
    savedPreviewRange = sel.getRangeAt(0).cloneRange();
    return savedPreviewRange;
  } catch {
    savedPreviewRange = null;
    return null;
  }
}

function restorePreviewSelection(range) {
  if (!range) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

/**
 * 在右侧预览选中文字上切换高亮；成功后同步回左侧 Markdown。
 * 工具栏 / 右键菜单共用。
 */
function applyPreviewHighlight() {
  const previewContainer = document.getElementById('previewContainer');
  let range = savedPreviewRange;
  const sel = window.getSelection();

  if ((!range || range.collapsed) && selectionInsideRoot(sel, previewContainer)) {
    range = sel.getRangeAt(0).cloneRange();
  }

  if (!range || range.collapsed) {
    // 预览没有选区时：若左侧有选区，则在源码侧包 <mark>
    const edSel = editor.state.selection.main;
    if (edSel.from !== edSel.to) {
      wrapSelection('<mark>', '</mark>');
      showToast('已在源码中高亮选中文字', 'success');
      return true;
    }
    showToast('请先在预览区选中文字，再点高亮', 'error');
    return false;
  }

  isPreviewEditing = true;
  previewContainer.focus();
  restorePreviewSelection(range);

  const liveSel = window.getSelection();
  const liveRange =
    liveSel && liveSel.rangeCount > 0 ? liveSel.getRangeAt(0) : range;

  const result = toggleMarkOnRange(liveRange, previewContainer);
  if (result === 'noop') {
    showToast('请先在预览区选中文字，再点高亮', 'error');
    isPreviewEditing = false;
    return false;
  }

  savedPreviewRange = null;
  syncPreviewToEditor(true);
  showToast(result === 'wrapped' ? '已高亮' : '已取消高亮', 'success');
  return true;
}

function hidePreviewContextMenu() {
  const menu = document.getElementById('previewContextMenu');
  if (menu) menu.remove();
}

function showPreviewContextMenu(clientX, clientY) {
  hidePreviewContextMenu();

  const menu = document.createElement('div');
  menu.id = 'previewContextMenu';
  menu.className = 'preview-context-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" class="preview-context-item" data-action="highlight" role="menuitem">
      高亮 / 取消高亮
    </button>
  `;

  document.body.appendChild(menu);

  const pad = 8;
  const rect = menu.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - pad) {
    left = window.innerWidth - rect.width - pad;
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = window.innerHeight - rect.height - pad;
  }
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;

  menu.querySelector('[data-action="highlight"]').addEventListener('mousedown', (e) => {
    e.preventDefault(); // 保住选区
  });
  menu.querySelector('[data-action="highlight"]').addEventListener('click', (e) => {
    e.preventDefault();
    hidePreviewContextMenu();
    applyPreviewHighlight();
  });
}

function initPreviewEditing() {
  const previewContainer = document.getElementById('previewContainer');

  // 使预览区可编辑
  previewContainer.setAttribute('contenteditable', 'true');
  previewContainer.setAttribute('spellcheck', 'true');

  // 编辑时：标记为正在预览编辑，防止循环更新
  previewContainer.addEventListener('focus', () => {
    isPreviewEditing = true;
    previewContainer.classList.add('editing');
    
  });

  // 失焦时：把编辑后的 HTML 转回 Markdown，同步到编辑器并重新渲染预览
  previewContainer.addEventListener('blur', () => {
    // 打开右键菜单 / 点工具栏时不要立刻清掉选区同步（由那些动作自己 sync）
    if (document.getElementById('previewContextMenu')) return;
    if (!isPreviewEditing) return;
    isPreviewEditing = false;
    previewContainer.classList.remove('editing');
    
    syncPreviewToEditor(true);
  });

  // 实时同步 + 实时 Markdown 渲染：每次输入后短延迟处理
  let syncTimer = null;
  let previewRenderTimer = null;
  previewContainer.addEventListener('input', (e) => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncPreviewToEditor();
    }, 500);

    // 预览区实时 Markdown 渲染（问题 4 修复）：
    // 用户在 contenteditable 预览区输入 Markdown 语法（如 **粗体**、`代码`、# 标题等）时，
    // 实时将输入内容通过 markdown-it 渲染为富文本，实现"所见即所得"预览体验。
    // 仅在预览区处于焦点（正在编辑）时生效：改用稳定的「焦点判定」而非易失的
    // isPreviewEditing 标志，避免重渲染 innerHTML 触发 blur 清零标志后，后续输入不再渲染。
    if (document.activeElement !== previewContainer) return;
    clearTimeout(previewRenderTimer);
    previewRenderTimer = setTimeout(() => {
      try { renderLivePreviewMarkdown(); } catch (err) {
        console.warn('[Live Preview] render error', err);
      }
    }, 150); // 150ms 防抖：平衡响应速度与性能
  });

  // 符号自动配对：与编辑器侧 closeBrackets 行为对齐。
  // 输入开符号（(、[、{、<、"、'、（）时，自动补闭符号并把光标移回中间。
  // 仅在文本节点内、有选区时跳过、nextChar 为字母/数字时跳过（由 getAutoPairClose 处理）。
  // 程序插入的闭符号不会触发额外 input 事件（避免与上方 sync 监听相互干扰）。
  previewContainer.addEventListener('input', (e) => {
    if (document.activeElement !== previewContainer) return;
    if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
    const inserted = e.data;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return; // 有选区时不处理（避免破坏选区替换语义）
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return; // 仅在文本节点内做配对

    const nextChar = node.data[range.startOffset] || '';
    const close = getAutoPairClose(inserted, nextChar);
    if (!close) return;

    // 在光标位置插入闭符号文本节点
    const closeNode = document.createTextNode(close);
    if (range.startOffset >= node.data.length) {
      // 文本节点末尾插入
      node.parentNode.insertBefore(closeNode, node.nextSibling);
    } else {
      range.insertNode(closeNode);
    }

    // 把光标移回开闭符号中间（保持在原文本节点的偏移处）
    const newRange = document.createRange();
    newRange.setStart(node, range.startOffset);
    newRange.setEnd(node, range.startOffset);
    sel.removeAllRanges();
    sel.addRange(newRange);
  });

  // 记录预览选区
  previewContainer.addEventListener('mouseup', () => {
    rememberPreviewSelection();
  });
  previewContainer.addEventListener('keyup', () => {
    rememberPreviewSelection();
  });

  // 右键：有选区时出「高亮」菜单
  previewContainer.addEventListener('contextmenu', (event) => {
    rememberPreviewSelection();
    const sel = window.getSelection();
    if (!selectionInsideRoot(sel, previewContainer) && !savedPreviewRange) {
      return; // 无选区：保留浏览器默认菜单
    }
    event.preventDefault();
    showPreviewContextMenu(event.clientX, event.clientY);
  });

  document.addEventListener('mousedown', (event) => {
    const menu = document.getElementById('previewContextMenu');
    if (menu && !menu.contains(event.target)) {
      hidePreviewContextMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePreviewContextMenu();
  });
}

function initPreviewLinkNavigation() {
  const previewContainer = document.getElementById('previewContainer');

  previewContainer.addEventListener('click', async (event) => {
    const targetUrl = resolvePreviewLinkClickTarget(event.target, previewContainer, {
      currentFileUrl,
    });
    if (!targetUrl) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      await openPreviewLink(targetUrl);
    } catch (err) {
      showToast('打开链接失败: ' + err.message, 'error');
    }
  });
}

async function openPreviewLink(targetUrl) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await chrome.tabs.create({ url: targetUrl });
    return;
  }

  const opened = window.open(targetUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    throw new Error('浏览器阻止了新标签页');
  }
}

function syncPreviewToEditor(rerender = false) {
  const previewContainer = document.getElementById('previewContainer');
  const html = previewContainer.innerHTML;
  const markdownContent = htmlToMarkdown(html);

  // 仅在内容真的变了时才同步
  const currentContent = editor.state.doc.toString();
  
  if (markdownContent.trim() !== currentContent.trim()) {
    isPreviewEditing = true; // 临时标记，避免 updatePreview 被触发
    
    setEditorContent(markdownContent);
    markModified();
    updateStatus();
    // 用智能释放替代固定 120ms 延迟（见 releasePreviewEditing）：
    // 在确认回写写入后再解除标记，并在解除后立即做一次一致性检查。
    releasePreviewEditing();
  }

  // 失焦时：用规范化后的 Markdown 重新渲染预览，保证预览与编辑器一致，
  // 避免下一次编辑基于「被篡改的 contenteditable DOM」继续累加空行与漂移
  if (rerender) {
    doUpdatePreview();
  }

  // 一致性检查（开发调试用，仅 console 输出，不阻塞用户操作）
  checkPreviewConsistency();
}

// 智能释放 isPreviewEditing：替代原来的固定 120ms setTimeout。
// 回写动作（setEditorContent）是同步完成的，但 contenteditable 的后续 input/blur
// 事件可能紧随其后；用 200ms 的相对保守窗口避免快速操作竞态，并在解除标记后
// 立即做一次一致性检查，尽早暴露「编辑器 ≠ 预览渲染」的偏差。
function releasePreviewEditing() {
  clearTimeout(previewEditReleaseTimer);
  previewEditReleaseTimer = setTimeout(() => {
    isPreviewEditing = false;
    checkPreviewConsistency(); // 释放后立即检查一致性
  }, 200);
}

// 一致性检测：检测「编辑器内容」与「预览渲染结果回写」是否一致（所见即所得）。
// 仅做规范化比较并 console 输出，不阻塞用户操作，也不做任何自动修正。
// 规范化规则与回写链路一致：忽略行尾空白差异、把 ≥3 个连续空行压成 2 个
// （markdown-it 渲染本就会把 2+ 空行折叠为单个段间空行，故此处只比语义差异）。
function checkPreviewConsistency() {
  if (!editor) return;
  const previewContainer = document.getElementById('previewContainer');
  if (!previewContainer) return;

  const editorText = editor.state.doc.toString();
  const previewHtml = previewContainer.innerHTML;
  let roundtrip;
  try {
    roundtrip = htmlToMarkdown(previewHtml);
  } catch (err) {
    // 回写转换异常不应影响用户，仅记录
    console.warn('[Preview Consistency] htmlToMarkdown failed', err);
    return;
  }

  // 规范化比较（忽略行尾空白差异）
  const normEditor = editorText.replace(/\s+$/gm, '').replace(/\n{3,}/g, '\n\n');
  const normRoundtrip = roundtrip.replace(/\s+$/gm, '').replace(/\n{3,}/g, '\n\n');

  if (normEditor !== normRoundtrip) {
    console.warn('[Preview Consistency] Mismatch detected', {
      editorLen: normEditor.length,
      roundtripLen: normRoundtrip.length,
    });
    return false;
  }
  return true;
}

// 预览区不可逆 / 易损渲染块保护：设为 contenteditable="false"，
// 防止用户在 contenteditable 预览区直接误改这些块的内部结构，
// 进而被 syncPreviewToEditor 当成「新源码」整体覆盖编辑器（导致数据损坏）。
// 与 Mermaid（doUpdatePreview 内已设）同理。
function protectPreviewBlocks(container) {
  if (!container) return;

  // 非 mermaid 的代码块（<pre><code>）：高亮后的代码块内部被包裹大量 <span>，
  // 用户在预览区手改极易写出脏 HTML；置为不可编辑。
  container
    .querySelectorAll('pre:not([data-md-source])')
    .forEach((pre) => pre.setAttribute('contenteditable', 'false'));

  // 表格：单元格结构较脆，误改容易破坏往返保真（见 html-to-markdown.js 表格分支），
  // 置为不可编辑防止污染。
  container
    .querySelectorAll('table')
    .forEach((tbl) => tbl.setAttribute('contenteditable', 'false'));

  // 数学公式（KaTeX / MathJax）：若项目接入了对应渲染器，渲染产物会出现
  // .katex / .mathjax / [data-math]，同样不可逆，置为不可编辑。
  // 未启用数学渲染时该选择器返回空，无副作用。
  container
    .querySelectorAll('.katex, .mathjax, [data-math]')
    .forEach((el) => el.setAttribute('contenteditable', 'false'));
}

// ==========================================
// 预览区实时 Markdown 渲染（问题 4 修复）
// ==========================================

// 检测文本中是否含有尚未被渲染的 Markdown 内联/块级语法。
// 用于决定是否需要对预览区做实时渲染：纯文本则不打扰光标（原生 caret 保留）。
// 注意：采用「过包含」策略——只要疑似含语法就触发，因为渲染本身经过往返（htmlToMarkdown→md.render）
// 是幂等的，真正无变化的渲染会被下方的 normalizeHtml 比较跳过。
const MD_SYNTAX_RE =
  /\*\*|\b__|\b(?:^|\n)#{1,6}\s|`[^`]+`|~~[^~]+~~|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|^\s*[-*+]\s|^\s*>\s|^\s*\d+\.\s/m;

// 计算 caret 在元素 textContent 中的字符偏移
function getCaretCharacterOffsetWithin(element) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

// 将 caret 设置到元素 textContent 的指定字符偏移处
function setCaretCharacterOffsetWithin(element, offset) {
  if (offset == null || offset < 0) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  let remaining = offset;
  let lastNode = null;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    lastNode = node;
  }
  // 偏移超出文本总长：落在最后一个文本节点末尾
  if (lastNode) {
    range.setStart(lastNode, lastNode.textContent.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// 将「含标记的原始文本」偏移映射到「标记被剥离后的渲染文本」偏移：
// 统计 rawOffset 之前被 markdown-it 渲染时剥离的标记字符数，做减法。
function mapRawToRenderedOffset(text, rawOffset) {
  let count = 0;
  let i = 0;
  while (i < rawOffset) {
    if (text[i] === '*' && text[i + 1] === '*') {
      count += 2;
      i += 2;
      while (i < rawOffset && !(text[i] === '*' && text[i + 1] === '*')) i++;
      if (i < rawOffset && text[i] === '*' && text[i + 1] === '*') { count += 2; i += 2; }
      continue;
    }
    if (text[i] === '`') {
      count += 1; i += 1;
      while (i < rawOffset && text[i] !== '`') i++;
      if (i < rawOffset && text[i] === '`') { count += 1; i += 1; }
      continue;
    }
    if (text[i] === '~' && text[i + 1] === '~') {
      count += 2; i += 2;
      while (i < rawOffset && !(text[i] === '~' && text[i + 1] === '~')) i++;
      if (i < rawOffset && text[i] === '~' && text[i + 1] === '~') { count += 2; i += 2; }
      continue;
    }
    if (text[i] === '*') { count += 1; i += 1; continue; }
    i += 1;
  }
  return Math.max(0, rawOffset - count);
}

// 归一化 HTML（去标签间空白与多余空白），用于判断「渲染后内容是否真的变化」
function normalizeHtml(html) {
  return html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

// 预览区实时 Markdown 渲染（问题 4 核心）：
// 用户在 contenteditable 预览区直接输入 Markdown 语法（如 **粗体**、`代码`、# 标题）时，
// 实时将其渲染为富文本，并把含语法的内容同步回编辑器（经 syncPreviewToEditor 既有链路）。
// 采用「往返渲染」策略：先 htmlToMarkdown(当前预览) 还原为源码，再 md.render 重新渲染。
// 这样既能渲染新输入的语法，又能保留已渲染块（如已存在的 <strong>）——往返对 markdown 是保真的。
function renderLivePreviewMarkdown() {
  const previewContainer = document.getElementById('previewContainer');
  // 改用稳定的焦点判定：重渲染 innerHTML 会使 contenteditable 短暂失焦（blur 已把
  // isPreviewEditing 清零），导致后续输入不再渲染；只要预览区仍持有焦点就继续渲染。
  if (!previewContainer || document.activeElement !== previewContainer) return;

  const text = previewContainer.textContent || '';
  // 纯文本（不含任何疑似 Markdown 语法）不渲染，避免打断原生光标
  if (!MD_SYNTAX_RE.test(text)) return;

  // 记录光标在「原始文本」中的偏移，渲染后用映射还原
  const rawCaret = getCaretCharacterOffsetWithin(previewContainer);
  const atEnd = rawCaret === null ? true : rawCaret >= text.length;

  const oldHtml = previewContainer.innerHTML;
  let source;
  let newHtml;
  try {
    // 往返：把当前预览（可能已含渲染块）还原为源码，再渲染，保证已渲染格式不丢
    source = htmlToMarkdown(oldHtml);
    newHtml = sanitizePreviewHtml(md.render(source));
  } catch (err) {
    console.warn('[Live Preview] markdown render failed', err);
    return;
  }

  // 真正无变化（如文本含 * 但未被渲染为 emphasis）则不替换 DOM，避免无谓光标丢失。
  // 注意：必须在赋值 innerHTML【之前】用 oldHtml 比较，否则比较对象恒等于自身。
  if (normalizeHtml(newHtml) === normalizeHtml(oldHtml)) return;

  previewContainer.innerHTML = newHtml;

  // 重新聚焦预览区：innerHTML 置换会使 contenteditable 短暂失焦（blur 已把
  // isPreviewEditing 清零），此处重新聚焦可让 focus 监听复位标志，并保证后续
  // 输入继续触发实时渲染；同时让下方光标还原真正生效。
  try { previewContainer.focus(); } catch (_) {}

  // 还原光标（独立容错：即使还原失败也不影响编辑器同步）
  try {
    if (atEnd) {
      setCaretCharacterOffsetWithin(previewContainer, previewContainer.textContent.length);
    } else {
      setCaretCharacterOffsetWithin(previewContainer, mapRawToRenderedOffset(text, rawCaret));
    }
  } catch (err) {
    console.warn('[Live Preview] caret restore skipped', err);
  }

  // 同步含语法的内容到编辑器（htmlToMarkdown 会把 <strong> 还原为 **...**）
  syncPreviewToEditor();
}

// HTML→Markdown: see ./html-to-markdown.js (tested for Issue #1 / #3)

// ==========================================
// 状态栏更新
// ==========================================
function updateStatus() {
  const content = editor.state.doc.toString();
  const lines = editor.state.doc.lines;

  // 字数（中文+英文）
  const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
  const wordCount = chineseChars + englishWords;

  document.getElementById('statusWords').textContent = `字数: ${wordCount}`;
  document.getElementById('statusChars').textContent = `字符: ${content.length}`;
  document.getElementById('statusLines').textContent = `行: ${lines}`;
}

function updateCursorStatus() {
  const sel = editor.state.selection.main;
  const line = editor.state.doc.lineAt(sel.head);
  const col = sel.head - line.from + 1;

  document.getElementById('statusCursor').textContent = `列: ${col}`;

  // 选中文本信息
  const selStatus = document.getElementById('statusSelection');
  if (sel.from !== sel.to) {
    const selectedText = editor.state.sliceDoc(sel.from, sel.to);
    selStatus.textContent = `已选: ${selectedText.length} 字符`;
  } else {
    selStatus.textContent = '';
  }
}

// ==========================================
// 会话恢复：记住当前文档内容（无法持久化 FileHandle）
// ==========================================
async function rememberCurrentDocument(extra = {}) {
  if (!editor) return;
  const filenameEl = document.getElementById('filename');
  const filename =
    extra.filename ||
    (filenameEl && filenameEl.textContent && filenameEl.textContent !== '未打开文件'
      ? filenameEl.textContent
      : 'untitled.md');
  await rememberLastFile({
    content: editor.state.doc.toString(),
    filename,
    sourceUrl: extra.sourceUrl ?? currentFileUrl ?? null,
  });
}

async function tryRestoreLastDocument() {
  const last = await loadLastFile();
  if (!last) return false;
  // 仅在仍是空白会话时恢复，避免覆盖刚打开的 pending 文件
  const content = editor?.state?.doc?.toString?.() ?? '';
  if (content.trim().length > 0) return false;

  clearCurrentDocumentContext();
  if (last.sourceUrl) {
    setCurrentDocumentContext({ fileUrl: last.sourceUrl, directoryPath: null });
  }
  setEditorContent(last.content);
  updateFilename(last.filename);
  currentFileHandle = null;
  markSaved();
  hideOnboarding();
  showToast(`已恢复: ${last.filename}（保存时可能需另选位置）`, 'success');
  return true;
}

// ==========================================
// 文件操作
// ==========================================
// 把已获取的 FileHandle（来自「打开文件」对话框或桌面端命令行路径）加载进编辑器
async function openWithHandle(fileHandle) {
  const file = await fileHandle.getFile();
  const content = await file.text();

  currentFileHandle = fileHandle;
  clearCurrentDocumentContext();
  setEditorContent(content);
  updateFilename(file.name);
  markSaved();
  await rememberCurrentDocument({ filename: file.name });
  showToast(`已打开: ${file.name}`, 'success');
  hideOnboarding();
}

async function handleOpen() {
  try {
    const { handle, file } = await openFileViaPicker();
    if (handle) {
      await openWithHandle(handle);
    } else if (file) {
      // 降级路径（非 Chromium 环境）：无持久文件句柄，仅加载内容，
      // currentFileHandle 保持 null，后续 Ctrl+S 会自动回退「另存为（下载）」。
      const content = await file.text();
      currentFileHandle = null;
      clearCurrentDocumentContext();
      setEditorContent(content);
      updateFilename(file.name);
      markSaved();
      await rememberCurrentDocument({ filename: file.name });
      showToast(`已打开: ${file.name}`, 'success');
      hideOnboarding();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('打开文件失败: ' + err.message, 'error');
    }
  }
  return true;
}

// 桌面端：按命令行传入的 .md 绝对路径打开（构造 Tauri 文件句柄，
// 其 getFile/createWritable 走 Rust 命令读写，绕开 fs 作用域限制）
async function openFileByPath(path) {
    try {
    const factory = window.__tauriFileHandle;
    if (typeof factory !== 'function') {
      showToast('无法打开文件：桌面端文件句柄未就绪，请重试或重新打开程序', 'error');
      return;
    }
    await openWithHandle(factory(path));
  } catch (err) {
    showToast('打开文件失败: ' + (err && err.message ? err.message : err), 'error');
  }
}

// 桌面端：读取「双击 .md 启动 EXE」时命令行传入的路径并打开。
// 直接在初始化时 invoke Rust 命令取路径，不依赖事件握手（更简单、时序更稳）。
// 多实例：每个 EXE 实例只处理自己启动时的那份路径。
async function openInitialCliFile() {
  if (!('__TAURI_INTERNALS__' in window)) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke('get_initial_file');
    if (path) {
      await openFileByPath(path);
      return;
    }
    // 未检测到 .md 启动参数：把原始命令行打出来，便于排查
    // Windows 文件关联到底有没有把文件路径传给 EXE。
    const args = await invoke('debug_args');
    if (args && args.length > 1) {
      showToast('未检测到.md启动参数，argv=' + JSON.stringify(args), 'warn');
    }
  } catch (err) {
    // 让失败可见：invoke 调用异常（模块缺失/命令未注册等）直接提示
    showToast('启动参数读取失败: ' + (err && err.message ? err.message : err), 'error');
  }
}

async function handleSave() {
    try {
    if (currentFileHandle) {
      // 保存到已有文件
      const writable = await currentFileHandle.createWritable();
      await writable.write(editor.state.doc.toString());
      await writable.close();
      markSaved();
      await rememberCurrentDocument();
            showToast('文件已保存', 'success');
    } else {
      // 另存为
      await handleSaveAs();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('保存失败: ' + err.message, 'error');
    }
  }
  return true;
}

async function handleSaveAs() {
  try {
    const { handle } = await saveViaPickerOrDownload(
      'untitled.md',
      editor.state.doc.toString()
    );
    if (handle) {
      currentFileHandle = handle;
      clearCurrentDocumentContext();
      const savedName = (await handle.getFile()).name;
      updateFilename(savedName);
      markSaved();
      await rememberCurrentDocument({ filename: savedName });
      showToast('文件已保存', 'success');
    } else {
      // 降级路径（非 Chromium 环境）：已触发浏览器下载，无法自动覆盖原文件。
      currentFileHandle = null;
      showToast('已下载到本地下载目录（无法自动覆盖原文件）', 'success');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('保存失败: ' + err.message, 'error');
    }
  }
}

// ==========================================
// 自动保存（定时落盘副本）
// ==========================================
// 与 A-5 的「草稿 / 快照环」不同：那套只写 chrome.storage.local，永远不碰磁盘；
// 这里是用户显式开启的磁盘副本——每 N 秒在源文件同目录写出
// <主文件名>_<秒级时间戳>.md（例：这是测试文件_20260804133025.md）。
// 只新建带时间戳的副本，绝不覆盖源文件。
let autosaveDirHandle = null; // Web 侧用户为自动保存显式授权的目录句柄

// 桌面端（Tauri）的文件句柄自带绝对路径，可直接推导「源文件同目录」
function tauriSourceFilePath() {
  const p =
    currentFileHandle && typeof currentFileHandle.path === 'string'
      ? currentFileHandle.path
      : null;
  return p && typeof window.__tauriFileHandle === 'function' ? p : null;
}

// 解析落盘目录（纯推导，绝不弹目录选择器——弹窗只由「右键自动保存按钮」触发）。
//   桌面端 → { kind: 'tauri', dir }
//   Web 侧 → { kind: 'handle', handle }
//   推导不出 → null（调用方提示用户右键授权目录）
async function resolveAutosaveTarget() {
  const srcPath = tauriSourceFilePath();
  if (srcPath) {
    const idx = Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\'));
    return { kind: 'tauri', dir: idx > 0 ? srcPath.slice(0, idx) : srcPath };
  }

  // 已通过「打开文件夹」授权、且当前文件来自该文件树 → 每次现算，保证跟随文件所在子目录
  if (directoryHandle && currentDirectoryPath !== null) {
    try {
      return { kind: 'handle', handle: await getCurrentMarkdownDirectoryHandle() };
    } catch (err) {
      console.warn('[autosave] 无法定位当前文件所在目录，改用显式授权目录:', err);
    }
  }

  // 只有 File System Access API 打开的单文件句柄拿不到父目录（规范限制），
  // 这种情况下需要用户右键按钮授权一次目录（建议就选源文件所在目录）。
  if (autosaveDirHandle) return { kind: 'handle', handle: autosaveDirHandle };
  return null;
}

// 实际落盘一份副本，返回展示用路径。由 autosave.js 的定时器调用。
async function writeAutosaveCopy(filename, content) {
  if (!filename || filename === currentFileName) {
    throw new Error('自动保存副本名非法，已放弃写入以保护源文件');
  }
  const target = await resolveAutosaveTarget();
  if (!target) {
    throw new Error('没有可写目录，请重新开启自动保存并授权目录');
  }

  if (target.kind === 'tauri') {
    const path = `${target.dir}/${filename}`;
    const handle = window.__tauriFileHandle(path);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return path;
  }

  const hasPermission = await ensureDirectoryPermission(target.handle, 'readwrite');
  if (!hasPermission) {
    throw new Error('没有写入所选目录的权限');
  }
  const fileHandle = await target.handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return `${target.handle.name}/${filename}`;
}

function initAutosaveDiskUI() {
  const btn = document.getElementById('btnAutosaveDisk');
  const input = document.getElementById('autosaveIntervalInput');
  if (!btn || !input) return;

  const OFF_TITLE =
    '自动保存（左键开关）：每 N 秒在源文件同目录生成「文件名_时间戳.md」副本，不覆盖源文件；右键可指定保存目录';
  let announcedFirstSave = false;

  input.value = String(
    normalizeIntervalSec(localStorage.getItem('md-editor-autosave-interval') || 30)
  );

  const syncButton = (lastTarget) => {
    const on = isAutosaveToDiskOn();
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) {
      btn.title = OFF_TITLE;
      return;
    }
    const sec = normalizeIntervalSec(input.value);
    btn.title = lastTarget
      ? `自动保存已开启（每 ${sec} 秒）：最近副本 ${lastTarget}（点击关闭）`
      : `自动保存已开启：每 ${sec} 秒在源文件同目录生成「文件名_时间戳.md」副本（点击关闭）`;
  };

  initDiskAutosave({
    getContent: () => editor.state.doc.toString(),
    getSourceName: () => currentFileName,
    writeFile: writeAutosaveCopy,
    onSaved: (target) => {
      syncButton(target);
      if (!announcedFirstSave) {
        announcedFirstSave = true;
        showToast(`已自动保存副本: ${target}`, 'success');
      }
    },
    onError: (err) => {
      stopAutosaveToDisk();
      syncButton();
      showToast('自动保存失败，已关闭: ' + (err && err.message ? err.message : err), 'error');
    },
  });

  const startAutosave = () => {
    const sec = normalizeIntervalSec(input.value);
    input.value = String(sec);
    localStorage.setItem('md-editor-autosave-interval', String(sec));
    announcedFirstSave = false;
    resetDiskAutosaveBaseline();
    autosaveToDisk(sec);
    syncButton();
    showToast(`自动保存已开启：每 ${sec} 秒写入一份带时间戳的副本`, 'success');
  };

  // 左键 = 纯粹的开关（原设计）。此处绝不弹目录选择器：
  // 旧实现在开启前调用 resolveAutosaveTarget({ interactive: true })，
  // 只要落盘目录无法自动推导（Web 侧单文件句柄拿不到父目录 / 桌面端尚未打开文件），
  // 点一下按钮就会弹出「选择文件夹」窗口，与「点击即开关」的设计不符。
  // 需要显式授权目录时改由右键触发（见下方 contextmenu）。
  btn.addEventListener('click', async () => {
    if (isAutosaveToDiskOn()) {
      stopAutosaveToDisk();
      syncButton();
      showToast('自动保存已关闭', 'success');
      return;
    }

    try {
      const target = await resolveAutosaveTarget();
      if (!target) {
        // 右键入口不易被发现，这里把「下一步该做什么」放在句首而不是句尾。
        showToast(
          '尚未指定保存目录：请【右键点击此按钮】选择一个目录，即可开启自动保存（或先打开文件 / 文件夹，再左键开启）',
          'error'
        );
        return;
      }
      startAutosave();
    } catch (err) {
      showToast('开启自动保存失败: ' + (err && err.message ? err.message : err), 'error');
    }
  });

  // 右键 = 显式选择落盘目录（唯一会弹目录选择器的入口），选完即开启。
  btn.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (typeof window.showDirectoryPicker !== 'function') {
      showToast('当前环境不支持选择目录', 'error');
      return;
    }
    try {
      autosaveDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (isAutosaveToDiskOn()) {
        syncButton();
        showToast(`自动保存目录已切换为「${autosaveDirHandle.name}」`, 'success');
        return;
      }
      startAutosave();
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 用户取消目录选择
      showToast('选择自动保存目录失败: ' + (err && err.message ? err.message : err), 'error');
    }
  });

  input.addEventListener('change', () => {
    const sec = normalizeIntervalSec(input.value);
    input.value = String(sec);
    localStorage.setItem('md-editor-autosave-interval', String(sec));
    if (isAutosaveToDiskOn()) {
      autosaveToDisk(sec); // 按新间隔重启
      showToast(`自动保存间隔已改为 ${sec} 秒`, 'success');
    }
    syncButton();
  });

  syncButton();
}

function handleNew() {
    if (isModified) {
    if (!confirm('当前文件有未保存的更改，确定要新建文件吗？')) {
      return;
    }
  }
  currentFileHandle = null;
  clearCurrentDocumentContext();
  setEditorContent('');
  updateFilename('未打开文件');
  markSaved();
}

function setEditorContent(content) {
  const scroller = editor.scrollDOM;
  const scrollTopBefore = scroller ? scroller.scrollTop : null;
  const selHeadBefore = editor.state.selection.main.head;
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: content,
    },
  });
  // 修复 BUG-2：预览区回写会触发编辑器内容全量替换，CodeMirror 会将滚动位置复位到头部。
  // 此处显式恢复替换前的滚动位置（含 requestAnimationFrame 兜底），确保布局完成后位置稳定。
  if (scroller && scrollTopBefore != null) {
    restoreScroll(scroller, scrollTopBefore);
  }
  const scrollTopAfter = scroller ? scroller.scrollTop : null;
  
}

// ==========================================
// 编辑区标题栏：文件图标 + 绝对路径
// ==========================================
// 解析当前文件的展示路径。按「信息量从高到低」逐级回退：
//   1) 桌面端(Tauri)句柄自带 .path        → 真正的绝对路径（本需求的主目标）
//   2) 已打开文件夹(FSA) + 相对目录        → 「根文件夹名/子目录/文件名」
//      （浏览器安全模型不暴露磁盘绝对路径，这已是 Web 侧能拿到的最完整路径）
//   3) file:// 打开                        → 由 URL 反解出路径
//   4) 兜底                                → 仅文件名
// 返回 null 表示当前没有任何已打开文件。
const NO_FILE_NAMES = new Set(['unsaved', '未打开文件', '']);

function resolveCurrentFilePath() {
  const name = currentFileName && !NO_FILE_NAMES.has(currentFileName) ? currentFileName : null;

  const handlePath =
    currentFileHandle && typeof currentFileHandle.path === 'string' ? currentFileHandle.path : null;
  if (handlePath) return handlePath.replace(/\\/g, '/');

  // currentDirectoryPath !== null 才说明当前文件确实来自已打开的文件树
  // （与 resolveAutosaveTarget 同一判据）。仅凭 directoryHandle 存在就拼路径，
  // 会把「用打开文件对话框单独打开的外部文件」误标成工作区内文件。
  if (name && directoryHandle && currentDirectoryPath !== null) {
    // 桌面端目录句柄同样带 .path，可拼出绝对路径；Web 侧只有目录名。
    const root =
      typeof directoryHandle.path === 'string' && directoryHandle.path
        ? directoryHandle.path.replace(/\\/g, '/')
        : directoryHandle.name || '';
    const segs = [root, currentDirectoryPath || '', name].filter(Boolean);
    return segs.join('/').replace(/\/{2,}/g, '/');
  }

  if (currentFileUrl) {
    try {
      const u = new URL(currentFileUrl);
      if (u.protocol === 'file:') {
        // file:///D:/a/b.md → D:/a/b.md；file:///home/x.md → /home/x.md
        return decodeURIComponent(u.pathname).replace(/^\/(?=[A-Za-z]:)/, '');
      }
    } catch {
      /* 非法 URL：走下面的文件名兜底 */
    }
  }

  return name;
}

function updateEditorFilePath() {
  const wrap = document.getElementById('editorFileInfo');
  const pathEl = document.getElementById('editorFilePath');
  if (!wrap || !pathEl) return;
  const path = resolveCurrentFilePath();
  // textContent 防 XSS：路径来自文件系统，可能含 < > 等字符。
  pathEl.textContent = path || '未打开文件';
  wrap.title = path ? `当前文件：${path}` : '当前未打开文件';
  wrap.classList.toggle('is-empty', !path);
}

function updateFilename(name) {
  document.getElementById('filename').textContent = name;
  // Bug #1 修复：记录当前文件名，供 getFileId 在 file://（无句柄）场景下回退使用，
  // 避免所有 file:// 文件共用 'unsaved' 键导致草稿/快照串档。
  currentFileName = name || 'unsaved';
  // 顶部「编辑」标题栏同步展示图标 + 绝对路径。所有打开/切换/另存路径都会经过
  // updateFilename，故此处是唯一刷新点（单一事实源）。
  updateEditorFilePath();
  // 换文件后，之前为自动保存授权的目录可能已不是新文件所在目录 → 作废，
  // 避免把副本写进错误的目录；同时重置去重基准，保证新文件首次到点必写。
  autosaveDirHandle = null;
  resetDiskAutosaveBaseline();
}

function markModified() {
  if (!isModified) {
    isModified = true;
    document.getElementById('modifiedIndicator').style.display = 'inline';
  }
}

function markSaved() {
  isModified = false;
  document.getElementById('modifiedIndicator').style.display = 'none';
}

// ==========================================
// 格式化工具
// ==========================================
function wrapSelection(before, after) {
  const sel = editor.state.selection.main;
  const selectedText = editor.state.sliceDoc(sel.from, sel.to);

  // 检查是否已经被包裹
  const textBefore = editor.state.sliceDoc(Math.max(0, sel.from - before.length), sel.from);
  const textAfter = editor.state.sliceDoc(sel.to, Math.min(editor.state.doc.length, sel.to + after.length));

  if (textBefore === before && textAfter === after) {
    // 已包裹 → 取消
    editor.dispatch({
      changes: [
        { from: sel.from - before.length, to: sel.from, insert: '' },
        { from: sel.to, to: sel.to + after.length, insert: '' },
      ],
      selection: { anchor: sel.from - before.length, head: sel.to - before.length },
    });
  } else if (selectedText) {
    // 有选中文本 → 包裹
    editor.dispatch({
      changes: { from: sel.from, to: sel.to, insert: before + selectedText + after },
      selection: { anchor: sel.from + before.length, head: sel.to + before.length },
    });
  } else {
    // 无选中 → 插入模板
    const placeholder = before === '**' ? '加粗文本' : before === '*' ? '斜体文本' : before === '~~' ? '删除线文本' : before === '`' ? '代码' : '文本';
    editor.dispatch({
      changes: { from: sel.from, insert: before + placeholder + after },
      selection: { anchor: sel.from + before.length, head: sel.from + before.length + placeholder.length },
    });
  }
  editor.focus();
  return true;
}

// 应用 <font> 行内样式（颜色 / 字号）。
// 相对朴素 wrapSelection 的改进：
//  - 已存在同类 <font> 时「替换」属性而非嵌套（修复 v1.4.x 初版颜色重选嵌套的瑕疵）；
//  - 再次选择同一值时「智能取消」（移除该属性，若已无属性则整体去标签）；
//  - 保留其它属性（如 color 与 size 可共存）。
// 修复 STY-10：<font> 属性值白名单校验。
// 旧实现把 value 直接拼进 attr="value"，若 DOM 上的 data-size / data-color 被篡改
// （或将来新增入口传入脏值），会写出 <font size="abc"> 这类坏标签污染 Markdown 源码。
// 这里对已知属性做严格校验，未知属性一律拒绝——当前 UI 仅使用 color 与 size 两种。
function isValidFontAttrValue(attr, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  if (attr === 'size') return /^[1-7]$/.test(v);            // HTML font size 合法范围 1-7
  if (attr === 'color') return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^[a-zA-Z]{3,20}$/.test(v);
  return false;
}

function applyFontStyle(attr, value) {
  if (!isValidFontAttrValue(attr, value)) {
    console.error(`[font] 非法的 ${attr} 值，已拒绝应用:`, value);
    showToast(`字体${attr === 'size' ? '字号' : '颜色'}取值非法，已忽略`, 'error');
    return false;
  }
    const sel = editor.state.selection.main;
  const selectedText = editor.state.sliceDoc(sel.from, sel.to);

  // 选区两侧紧邻的 <font ...> 开标签与 </font> 闭标签
  const beforeText = editor.state.sliceDoc(Math.max(0, sel.from - 64), sel.from);
  const afterText = editor.state.sliceDoc(sel.to, Math.min(editor.state.doc.length, sel.to + 8));
  const openMatch = beforeText.match(/<font([^>]*)>$/);
  const closeMatch = afterText.startsWith('</font>');

  const buildTag = (attrs) => (attrs && attrs.trim()) ? '<font ' + attrs.trim() + '>' : '<font>';

  if (openMatch && closeMatch) {
    const openLen = openMatch[0].length;
    let attrs = openMatch[1].trim();
    const attrRegex = new RegExp('\\s*' + attr + '="[^"]*"');
    const sameValue = new RegExp(attr + '="' + String(value) + '"').test(attrs);

    if (sameValue) {
      // 智能取消：移除该属性
      attrs = attrs.replace(attrRegex, '').trim();
    } else if (attrRegex.test(attrs)) {
      // 替换：更新该属性，保留其它
      attrs = attrs.replace(attrRegex, ' ' + attr + '="' + value + '"').trim();
    } else {
      // 新增：追加该属性（与已有属性共存）
      attrs = (attrs ? attrs + ' ' : '') + attr + '="' + value + '"';
    }

    if (!attrs) {
      // 已无任何属性 → 整体移除 <font>/</font>
      editor.dispatch({
        changes: [
          { from: sel.from - openLen, to: sel.from, insert: '' },
          { from: sel.to, to: sel.to + '</font>'.length, insert: '' },
        ],
        selection: { anchor: sel.from - openLen, head: sel.to - openLen },
      });
    } else {
      const newOpen = buildTag(attrs);
      editor.dispatch({
        changes: { from: sel.from - openLen, to: sel.from, insert: newOpen },
        selection: { anchor: sel.from - openLen + newOpen.length, head: sel.to - openLen + newOpen.length },
      });
    }
  } else if (selectedText) {
    const open = '<font ' + attr + '="' + value + '">';
    editor.dispatch({
      changes: { from: sel.from, to: sel.to, insert: open + selectedText + '</font>' },
      selection: { anchor: sel.from + open.length, head: sel.to + open.length },
    });
  } else {
    const open = '<font ' + attr + '="' + value + '">';
    const placeholder = '文本';
    editor.dispatch({
      changes: { from: sel.from, insert: open + placeholder + '</font>' },
      selection: { anchor: sel.from + open.length, head: sel.from + open.length + placeholder.length },
    });
  }
  editor.focus();
  return true;
}

function insertAtLineStart(prefix) {
  const sel = editor.state.selection.main;
  const line = editor.state.doc.lineAt(sel.head);
  const currentContent = line.text;

  if (currentContent.startsWith(prefix)) {
    // 已有前缀 → 移除
    editor.dispatch({
      changes: { from: line.from, to: line.from + prefix.length, insert: '' },
    });
  } else {
    // 插入前缀
    editor.dispatch({
      changes: { from: line.from, insert: prefix },
    });
  }
  editor.focus();
  return true;
}

function insertBlock(text) {
  const sel = editor.state.selection.main;
  const line = editor.state.doc.lineAt(sel.head);

  // 确保在行尾插入，加上换行
  const insertPos = line.to;
  const prefix = line.text.length > 0 ? '\n\n' : '';

  editor.dispatch({
    changes: { from: insertPos, insert: prefix + text },
  });
  editor.focus();
  return true;
}

// ==========================================
// 主题切换
// ==========================================
// 把「明暗基底」同步到本页运行时：CM6 明暗扩展、mermaid 主题、主题图标、预览重渲染。
// 不负责写 data-theme / data-editor-theme（那是 applyEditorThemePreset 的职责，单一事实源）。
// 供 toggleTheme 与主题下拉共用，保证两个入口的运行时状态永远一致。
function syncThemeRuntime(kind) {
  currentTheme = kind === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem('md-editor-theme', currentTheme);
  } catch {
    /* localStorage 不可用时静默忽略，不阻断主题切换 */
  }

  if (editor) {
    editor.dispatch({
      effects: themeCompartment.reconfigure(
        currentTheme === 'dark' ? oneDark : lightTheme
      ),
    });
  }

  // 更新 Mermaid 主题
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'Inter, sans-serif',
  });
  // 重新渲染预览中的 Mermaid
  doUpdatePreview();

  // 更新主题图标
  updateThemeIcon();
  // A+B 方案 Phase 4：主题切换时防御性重设配色方案属性（data-color-scheme 与 data-theme 正交）。
  document.documentElement.setAttribute('data-color-scheme', getColorScheme());
}

// 明/暗切换（工具栏 #btnTheme）。
// 修复 THM-01：旧实现只翻转 currentTheme 并直接写 data-theme，随后 applyEditorThemePreset
// 立刻用「已存预设的 kind」把 data-theme 覆盖回去，导致按钮对 CSS 变量层完全无效。
// 现改为切换到「同族对偶预设」，让 data-theme 与 data-editor-theme 随预设一起翻转，
// 再同步运行时状态；同时回写下拉选中项，保持三处（属性 / 下拉 / CM6）一致。
function toggleTheme() {
  const nextThemeId = getCounterpartTheme(getStoredEditorTheme());
  setStoredEditorTheme(nextThemeId);
  // === MARKRA_HOOK: THEMES === 主题预设：写 data-editor-theme / data-theme / data-skin
  const applied = applyEditorThemePreset(nextThemeId);

  // 玻璃拟态 skin 维度（data-skin="glass"）已由 applyEditorThemePreset 统一设置，
  // 此处不再重复，保持单一事实源。

  const sel = document.getElementById('editorThemeSelect');
  if (sel) sel.value = applied;

  syncThemeRuntime(getThemeKind(applied));
}

function updateThemeIcon() {
  const icon = document.getElementById('themeIcon');
  if (currentTheme === 'dark') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
}

// ==========================================
// 视图模式切换
// ==========================================
function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('md-editor-view-mode', mode);

  document.getElementById('editorMain').setAttribute('data-mode', mode);

  // 更新按钮状态
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // 切换后刷新编辑器布局
  if (editor) {
    requestAnimationFrame(() => editor.requestMeasure());
  }
}

// ==========================================
// 拖拽分屏调整
// ==========================================
const SIDEBAR_WIDTH_KEY = 'md-editor-sidebar-width';
const SIDEBAR_MIN_WIDTH = 180; // 与 editor.css .file-sidebar min-width 对齐（单一事实源）
const SIDEBAR_MAX_WIDTH = 500; // 与 editor.css .file-sidebar max-width 对齐

function initResizer() {
  const resizer = document.getElementById('resizer');
  const editorPanel = document.getElementById('editorPanel');
  const previewPanel = document.getElementById('previewPanel');
  const editorMain = document.getElementById('editorMain');

  // 侧栏宽度恢复
  const sidebar = document.getElementById('fileSidebar');
  const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
  if (sidebar && !isNaN(savedWidth) && savedWidth >= SIDEBAR_MIN_WIDTH && savedWidth <= SIDEBAR_MAX_WIDTH) {
    sidebar.style.width = savedWidth + 'px';
  }

  // 侧栏拖拽分隔条
  const sidebarResizer = document.getElementById('resizerSidebar');
  if (sidebarResizer && sidebar) {
    let isSidebarResizing = false;

    // 用 Pointer Capture：按下时把指针捕获到分隔条本身，即便拖出浏览器窗口再松手，
    // pointerup / pointercancel 仍会送达本元素，避免 document 级监听在窗口外丢失 mouseup
    // 导致分隔条卡在拖拽态（宽度「粘住」）。
    sidebarResizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      isSidebarResizing = true;
      sidebarResizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const startX = e.clientX;
      const startSidebarWidth = sidebar.offsetWidth;

      function onPointerMove(ev) {
        if (!isSidebarResizing) return;
        const dx = ev.clientX - startX;
        let newWidth = startSidebarWidth + dx;
        if (newWidth < SIDEBAR_MIN_WIDTH) newWidth = SIDEBAR_MIN_WIDTH;
        if (newWidth > SIDEBAR_MAX_WIDTH) newWidth = SIDEBAR_MAX_WIDTH;
        sidebar.style.width = newWidth + 'px';
      }

      function onPointerUp(ev) {
        if (!isSidebarResizing) return;
        isSidebarResizing = false;
        sidebarResizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        sidebarResizer.removeEventListener('pointermove', onPointerMove);
        sidebarResizer.removeEventListener('pointerup', onPointerUp);
        sidebarResizer.removeEventListener('pointercancel', onPointerUp);
        try { sidebarResizer.releasePointerCapture(ev.pointerId); } catch (_) { /* 未捕获则忽略 */ }

        // 存内联 style 宽度（目标值），避免 CSS transition 动画期间 offsetWidth 返回中间帧导致持久化失真
        const savedWidth = sidebar.style.width ? parseInt(sidebar.style.width, 10) : sidebar.offsetWidth;
        localStorage.setItem(SIDEBAR_WIDTH_KEY, savedWidth);
        if (editor) editor.requestMeasure();
      }

      try { sidebarResizer.setPointerCapture(e.pointerId); } catch (_) { /* 指针不可用则忽略 */ }
      sidebarResizer.addEventListener('pointermove', onPointerMove);
      sidebarResizer.addEventListener('pointerup', onPointerUp);
      sidebarResizer.addEventListener('pointercancel', onPointerUp);
    });
  }

  let isResizing = false;

  // 用 Pointer Capture：捕获到分隔条本身，拖出窗口再松手也能收到 pointerup/pointercancel，
  // 不会卡在拖拽态。
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isResizing = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const totalWidth = editorMain.offsetWidth;
    const startEditorWidth = editorPanel.offsetWidth;

    function onPointerMove(ev) {
      if (!isResizing) return;
      const dx = ev.clientX - startX;
      const newEditorWidth = startEditorWidth + dx;
      const editorPercent = (newEditorWidth / totalWidth) * 100;

      if (editorPercent > 20 && editorPercent < 80) {
        editorPanel.style.flex = `0 0 ${editorPercent}%`;
        previewPanel.style.flex = `0 0 ${100 - editorPercent}%`;
      }
    }

    function onPointerUp(ev) {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      try { resizer.releasePointerCapture(ev.pointerId); } catch (_) { /* 未捕获则忽略 */ }

      if (editor) editor.requestMeasure();
    }

    try { resizer.setPointerCapture(e.pointerId); } catch (_) { /* 指针不可用则忽略 */ }
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
  });
}

// ==========================================
// 镶入式大纲面板：宽度拖拽 + 展开态同步
// ==========================================
const OUTLINE_WIDTH_KEY = 'md-editor-outline-width';
const OUTLINE_WIDTH_DEFAULT = 260;
const OUTLINE_MIN_WIDTH = 160; // 与 editor.css .side-panel-docked min-width 对齐（单一事实源）
const OUTLINE_MAX_WIDTH_ABS = 520;

function outlineMaxWidth() {
  const main = document.getElementById('editorMain');
  const avail = main ? main.clientWidth : 0;
  if (!avail) return OUTLINE_MAX_WIDTH_ABS;
  // 不写死上限：窄窗口下 520px 会把编辑区挤没，取「主区宽度的 45%」与绝对上限的较小值。
  return Math.max(OUTLINE_MIN_WIDTH, Math.min(OUTLINE_MAX_WIDTH_ABS, Math.round(avail * 0.45)));
}

function applyOutlineWidth(px, { persist = false } = {}) {
  const panel = document.getElementById('outlinePanel');
  if (!panel) return;
  const n = Number(px);
  const w = Number.isFinite(n)
    ? Math.round(Math.min(outlineMaxWidth(), Math.max(OUTLINE_MIN_WIDTH, n)))
    : OUTLINE_WIDTH_DEFAULT;
  panel.style.setProperty('--outline-width', `${w}px`);
  if (persist) {
    try {
      localStorage.setItem(OUTLINE_WIDTH_KEY, String(w));
    } catch {
      /* storage 不可用：仅本次会话生效 */
    }
  }
}

// 大纲分隔条的可见性必须跟随「面板真正可见」而非仅仅「用户点开过」：
// 视图模式（专注 / 沉浸）会给面板加 .view-hidden（display:none!important），
// 此时若分隔条还在，编辑区右侧会挂着一根拖不动任何东西的空条。
// CSS 选不到「前一个兄弟」，故用 MutationObserver 监听 class 变化统一同步。
function syncOutlineDockState() {
  const main = document.getElementById('editorMain');
  const panel = document.getElementById('outlinePanel');
  if (!main || !panel) return;
  const visible = panel.classList.contains('open') && !panel.classList.contains('view-hidden');
  main.classList.toggle('outline-docked-open', visible);
}

function initOutlineDock() {
  const panel = document.getElementById('outlinePanel');
  const resizer = document.getElementById('resizerOutline');
  if (!panel) return;

  let saved = null;
  try {
    saved = localStorage.getItem(OUTLINE_WIDTH_KEY);
  } catch {
    /* 忽略 */
  }
  if (saved != null && saved !== '') applyOutlineWidth(saved);

  syncOutlineDockState();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(syncOutlineDockState).observe(panel, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  if (!resizer) return;

  // 用 Pointer Capture：捕获到分隔条本身，拖出窗口再松手也能收到 pointerup/pointercancel，
  // 不会卡在拖拽态（新版镶入式大纲面板自带交互，必须稳健）。
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;

    function onPointerMove(ev) {
      if (!dragging) return;
      // 大纲在最右侧：鼠标左移（dx<0）应变宽，故用 startX - clientX。
      applyOutlineWidth(startWidth + (startX - ev.clientX));
    }

    function onPointerUp(ev) {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      try { resizer.releasePointerCapture(ev.pointerId); } catch (_) { /* 未捕获则忽略 */ }
      applyOutlineWidth(panel.getBoundingClientRect().width, { persist: true });
      if (editor) editor.requestMeasure();
    }

    try { resizer.setPointerCapture(e.pointerId); } catch (_) { /* 指针不可用则忽略 */ }
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
  });

  resizer.addEventListener('dblclick', () => {
    applyOutlineWidth(OUTLINE_WIDTH_DEFAULT, { persist: true });
    if (editor) editor.requestMeasure();
  });
}

// ==========================================
// Toast 通知
// ==========================================
let toastTimeout = null;

function showToast(message, type = '') {
  // 移除已有 toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  clearTimeout(toastTimeout);
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ==========================================
// 滚动同步
// ==========================================
function initScrollSync() {
  const editorContainer = document.getElementById('editorContainer');
  const previewContainer = document.getElementById('previewContainer');

  // 编辑页滚动同步接入共享模块（设计文档 §9）：原 editorScroller↔previewContainer 双向比例同步
  // 迁入 createScrollSync；scrollSync 为模块级变量（bindEvents 的滚动按钮需引用）。
  const previewAdapter = scrollAdapter(previewContainer);
  scrollSync = createScrollSync({
    views: () => [editor, previewAdapter],
    isEnabled: () => scrollSyncEnabled,
    setEnabled: (v) => {
      scrollSyncEnabled = v;
      // M1 修复：同步滚动同步按钮的 active 高亮态与 title 文案
      const btnScrollSync = document.getElementById('btnScroll');
      if (btnScrollSync) {
        btnScrollSync.classList.toggle('active', v);
        btnScrollSync.title = '滚动同步：' + (v ? '开' : '关');
      }
    },
    onMisalign: () => { /* 编辑页默认静默对齐，无需弹窗 */ },
  });

  // M1 修复：按初值同步滚动同步按钮高亮态。bindEvents 时 scrollSync 尚为 null，
  // 此处创建完成后补一次初始态，保证首屏按钮与 scrollSyncEnabled 一致。
  const btnScrollInit = document.getElementById('btnScroll');
  if (btnScrollInit) {
    btnScrollInit.classList.toggle('active', scrollSyncEnabled);
    btnScrollInit.title = '滚动同步：' + (scrollSyncEnabled ? '开' : '关');
  }
}

// 工具栏弹层定位：.style-popover 用 position:fixed（宿主 .toolbar 是
// overflow-x:auto/overflow-y:hidden 的滚动容器，absolute 会被裁掉），
// 因此打开时按锚点按钮实时算出视口坐标；右对齐按钮右边缘并夹在视口内。
function positionStylePopover(anchorBtn, popover) {
  if (!anchorBtn || !popover || popover.hidden) return;
  const rect = anchorBtn.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = 'auto';
  popover.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
}

// ==========================================
// 事件绑定
// ==========================================
function bindEvents() {
  // M2 修复：统一按钮绑定辅助函数，带 null 守卫——单个按钮 HTML 改名不再导致整页初始化失败。
  const bindBtn = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  };

  // 文件操作
  bindBtn('btnOpen', handleOpen);
  bindBtn('btnSave', handleSave);
  bindBtn('btnNew', handleNew);

  // 自动保存（定时落盘副本）：开关按钮 + 间隔秒数输入框
  initAutosaveDiskUI();

  // 查找 / 替换面板（Ctrl+F 亦可触发）
  const btnFind = document.getElementById('btnFind');
  if (btnFind) btnFind.addEventListener('click', () => {
    openSearchPanel(editor);
  });

  // 滚动同步开关（编辑↔预览联动，设计文档 §9/D16）
  const btnScrollEl = document.getElementById('btnScroll');
  if (btnScrollEl) btnScrollEl.addEventListener('click', () => { if (!scrollSync) return; scrollSync.toggle(); });

  // 查找/替换面板里的「工作区搜索」结果被点击：把对应文件载入编辑器并跳到命中行。
  // 面板（search-panel.js）不直接依赖 editor.js，通过自定义事件解耦，避免循环导入。
  document.addEventListener('cme:workspace-search-open', async (e) => {
    const detail = e.detail || {};
    if (!detail.handle) {
      showToast('无法打开该文件：句柄已失效，请重新检索', 'error');
      return;
    }
    try {
      await openWithHandle(detail.handle);
      const line = Number(detail.line);
      if (Number.isFinite(line) && line >= 1 && line <= editor.state.doc.lines) {
        const pos = editor.state.doc.line(line).from;
        editor.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        editor.focus();
      }
    } catch (err) {
      showToast('打开文件失败: ' + (err && err.message ? err.message : err), 'error');
    }
  });

  // A-5：快照 / 历史版本面板
  const btnSnapshots = document.getElementById('btnSnapshots');
  if (btnSnapshots) btnSnapshots.addEventListener('click', () => openSnapshotsDialog());
  const snapshotsDialog = document.getElementById('snapshotsDialog');
  const snapshotsClose = document.getElementById('snapshotsClose');
  if (snapshotsClose) snapshotsClose.addEventListener('click', () => { if (snapshotsDialog) snapshotsDialog.hidden = true; });
  if (snapshotsDialog) {
    snapshotsDialog.addEventListener('click', (e) => { if (e.target === snapshotsDialog) snapshotsDialog.hidden = true; });
    // 改为 document 级监听：对话框由工具栏按钮打开时焦点停留在按钮（位于遮罩之下），
    // 原 keydown 绑定在 dialog 元素上无法收到事件，导致 Esc 失效。改为全局监听，
    // 只要对话框处于打开态，无论焦点在哪都能用 Esc 关闭。
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !snapshotsDialog.hidden) snapshotsDialog.hidden = true;
    });
  }

  // 格式化按钮
  bindBtn('btnBold', () => wrapSelection('**', '**'));
  bindBtn('btnItalic', () => wrapSelection('*', '*'));
  bindBtn('btnStrike', () => wrapSelection('~~', '~~'));
  bindBtn('btnCode', () => wrapSelection('`', '`'));

  // ===== 样式工具栏：居中 / 加粗 / 高亮 / 颜色 / 字号 =====
  // 复用 wrapSelection：包裹后选区被重定位到内层文本，因此连续点击多个按钮会
  // 自动嵌套，例如 <center><b><font color="red">文本</font></b></center>；
  // 再次点击同一按钮则取消包裹（toggle）。每个按钮独立生效，也可任意组合。
  const btnStyleCenter = document.getElementById('btnStyleCenter');
  if (btnStyleCenter) btnStyleCenter.addEventListener('click', () => {  wrapSelection('<center>', '</center>'); });

  // 高亮（唯一入口，v1.5.1 合并原「格式化组 btnHighlight」与「样式组 btnStyleHighlight」）：
  // 无论选区在编辑区还是预览区，最终都落到源码的 <mark>…</mark>，并由 updatePreview /
  // syncPreviewToEditor 同步渲染，行为与加粗/斜体等按钮完全一致。
  const btnStyleHighlight = document.getElementById('btnStyleHighlight');
  if (btnStyleHighlight) {
    btnStyleHighlight.addEventListener('mousedown', (e) => {
      // 避免按钮抢走焦点导致预览选区丢失
      e.preventDefault();
      rememberPreviewSelection();
    });
    btnStyleHighlight.addEventListener('click', () => {
      applyPreviewHighlight();
    });
  }

  // 颜色 / 字号：弹出对应弹窗，点选项即应用 <font color>/<font size>。
  // 关键改进（相对 v1.4.x 初版与 v1.3.0）：重选同一属性时「替换」而非「嵌套」，
  // 再次点同一值则「智能取消」；并记忆上次选择，弹窗重新打开时高亮。
  const colorPopover = document.getElementById('colorPopover');
  const fontSizePopover = document.getElementById('fontSizePopover');
  const btnColor = document.getElementById('btnColor');
  const btnFontSize = document.getElementById('btnFontSize');

  // 记忆上次选择（持久化到 localStorage，跨会话保留）
  let lastColor = localStorage.getItem('md-editor-last-color') || 'red';
  let lastSize = localStorage.getItem('md-editor-last-size') || '3';

  function closeStylePopovers() {
    if (colorPopover) colorPopover.hidden = true;
    if (fontSizePopover) fontSizePopover.hidden = true;
  }

  // 弹窗打开时高亮上次选择
  function markFontChoice() {
    if (colorPopover) colorPopover.querySelectorAll('.swatch').forEach((sw) =>
      sw.classList.toggle('selected', sw.dataset.color === lastColor));
    if (fontSizePopover) fontSizePopover.querySelectorAll('.fs-option').forEach((opt) =>
      opt.classList.toggle('selected', opt.dataset.size === lastSize));
  }

  if (btnColor && colorPopover) {
    btnColor.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = colorPopover.hidden;
      closeStylePopovers();
      colorPopover.hidden = !willShow;
      if (!colorPopover.hidden) {
        positionStylePopover(btnColor, colorPopover);
        markFontChoice();
      }
    });
    colorPopover.querySelectorAll('.swatch').forEach((sw) => {
      sw.addEventListener('mousedown', (e) => e.preventDefault()); // 保住编辑器选区
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        lastColor = sw.dataset.color;
        localStorage.setItem('md-editor-last-color', lastColor);
                applyFontStyle('color', lastColor);
        markFontChoice();
        // 不自动关闭，便于在同组色板内快速改色（替换而非嵌套）
      });
    });
  }

  if (btnFontSize && fontSizePopover) {
    btnFontSize.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = fontSizePopover.hidden;
      closeStylePopovers();
      fontSizePopover.hidden = !willShow;
      if (!fontSizePopover.hidden) {
        positionStylePopover(btnFontSize, fontSizePopover);
        markFontChoice();
      }
    });
    fontSizePopover.querySelectorAll('.fs-option').forEach((opt) => {
      opt.addEventListener('mousedown', (e) => e.preventDefault());
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        lastSize = opt.dataset.size;
        localStorage.setItem('md-editor-last-size', lastSize);
                applyFontStyle('size', lastSize);
        markFontChoice();
      });
    });
  }

  // 点击空白 / 按 Esc 关闭弹窗
  document.addEventListener('click', (e) => {
    if (colorPopover && !colorPopover.contains(e.target) && e.target !== btnColor) closeStylePopovers();
    if (fontSizePopover && !fontSizePopover.contains(e.target) && e.target !== btnFontSize) closeStylePopovers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStylePopovers();
  });

  // fixed 弹层不随锚点按钮移动：窗口缩放或工具栏横向滚动后会错位，直接关闭。
  const closeAllStylePopovers = () => {
    document.querySelectorAll('.style-popover:not([hidden])').forEach((p) => {
      p.hidden = true;
    });
  };
  window.addEventListener('resize', closeAllStylePopovers);
  document
    .querySelector('.toolbar')
    ?.addEventListener('scroll', closeAllStylePopovers, { passive: true });

  // 使用说明（重新打开引导说明书）
  const btnHelp = document.getElementById('btnHelp');
  if (btnHelp) {
    btnHelp.addEventListener('click', () => {
      showOnboarding({ force: true, mode: 'guide' });
    });
  }

  // 标题
  bindBtn('btnH1', () => insertAtLineStart('# '));
  bindBtn('btnH2', () => insertAtLineStart('## '));
  bindBtn('btnH3', () => insertAtLineStart('### '));

  // 列表和引用
  bindBtn('btnUL', () => insertAtLineStart('- '));
  bindBtn('btnOL', () => insertAtLineStart('1. '));
  bindBtn('btnQuote', () => insertAtLineStart('> '));

  // 代码块
  bindBtn('btnCodeBlock', () => insertBlock('```\n\n```'));

  // 链接
  bindBtn('btnLink', () => {
    const sel = editor.state.selection.main;
    const selectedText = editor.state.sliceDoc(sel.from, sel.to);
    if (selectedText) {
      editor.dispatch({
        changes: { from: sel.from, to: sel.to, insert: `[${selectedText}](url)` },
        selection: { anchor: sel.from + selectedText.length + 3, head: sel.from + selectedText.length + 6 },
      });
    } else {
      editor.dispatch({
        changes: { from: sel.from, insert: '[链接文本](url)' },
        selection: { anchor: sel.from + 1, head: sel.from + 5 },
      });
    }
    editor.focus();
  });

  // 表格
  bindBtn('btnTable', () => {
    insertBlock('| 列1 | 列2 | 列3 |\n|------|------|------|\n| 内容 | 内容 | 内容 |');
  });

  // 水平线
  bindBtn('btnHR', () => insertBlock('---'));

  // 上传图片：复用粘贴图片的落盘 / data URL 逻辑，插入到光标处
  const btnImage = document.getElementById('btnImage');
  if (btnImage) {
    btnImage.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        try {
          for (const file of files) {
            const { imagePath } = await persistPastedImage(file);
            insertMarkdownSnippet(buildPastedImageMarkdown({ alt: 'image', imagePath }));
          }
          showToast(files.length > 1 ? `已插入 ${files.length} 张图片` : '图片已插入', 'success');
        } catch (err) {
          showToast('插入图片失败: ' + err.message, 'error');
        }
      });
      input.click();
    });
  }

  // 视图模式
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
  });

  // 主题切换
  bindBtn('btnTheme', toggleTheme);

  // 阅读翻译（预览双语对照）
  const btnTranslate = document.getElementById('btnTranslate');
  if (btnTranslate) {
    btnTranslate.addEventListener('click', () => {
            toggleTranslateMode();
    });
    btnTranslate.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTranslateSettingsModal();
    });
  }
  // v1.5.1：原独立的「翻译设置」按钮（btnTranslateSettings）已删除——
  // 右键 btnTranslate 即可打开设置，无需第二个按钮。
  initTranslateSettingsModal();

  // 对比/合并视图入口
  const btnCompare = document.getElementById('btnCompare');
  if (btnCompare) {
    btnCompare.addEventListener('click', () => {
      // 标记为「主动跳转」，抑制 beforeunload 的「是否离开网站？」误报；
      // 100ms 后复位，保证编辑器页在独立标签页场景下后续误关仍受保护。
      intentionalLeave = true;
      // 在新标签页打开 compare.html（Chrome 扩展中为同源页面）
      window.open('compare.html', '_blank');
      setTimeout(() => { intentionalLeave = false; }, 100);
    });
  }

  // 拦截浏览器默认 Ctrl+S
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'o') {
        e.preventDefault();
        handleOpen();
      }
    }
  });

  // 离开提示
  window.addEventListener('beforeunload', (e) => {
    if (isModified && !intentionalLeave) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // 拖拽文件打开
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt')) {
        try {
          const content = await file.text();
          setEditorContent(content);
          updateFilename(file.name);
          currentFileHandle = null; // 拖拽打开无 handle
          clearCurrentDocumentContext();
          markSaved();
          await rememberCurrentDocument({ filename: file.name });
          hideOnboarding();
          showToast(`已打开: ${file.name}`, 'success');
        } catch (err) {
          showToast('打开文件失败: ' + (err && err.message ? err.message : err), 'error');
        }
      } else {
        showToast('请拖入 .md 或 .markdown 文件', 'error');
      }
    }
  });

  // Tauri 原生文件拖放（桌面端）。Tauri v2 默认 fileDropEnabled=true 时，
  // 操作系统文件拖放会被 Tauri 拦截并通过 Webview 的 onDragDropEvent 下发真实路径
  // （注意：不能用 listen('tauri://drop')，该事件在 WebView2 下不可靠）。
  // 打开首个 .md/.markdown/.txt 文件。
  if ('__TAURI_INTERNALS__' in window) {
    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type !== 'drop') return;
          const paths = payload.paths || [];
          const md = paths.find((p) => /\.(md|markdown|mdown|mkd|mkdn|txt)$/i.test(p));
          if (md) {
            openFileByPath(md);
          } else if (paths.length) {
            showToast('请拖入 .md 或 .markdown 文件', 'error');
          }
        });
      } catch (e) {
        // 监听注册失败不影响双击打开；忽略
      }
    })();
  }

  // ==================================================
  // A-8 专注模式 / 打字机 / 显示设置
  // ==================================================
  const btnFocusMode = document.getElementById('btnFocusMode');
  if (btnFocusMode) {
    btnFocusMode.addEventListener('click', () => {
      const on = toggleFocusMode();
      btnFocusMode.classList.toggle('active', on);
          });
  }
  const btnTypewriter = document.getElementById('btnTypewriter');
  if (btnTypewriter) {
    btnTypewriter.addEventListener('click', () => {
      const on = toggleTypewriter();
      btnTypewriter.classList.toggle('active', on);
          });
  }

  // 显示设置弹层
  const btnDisplaySettings = document.getElementById('btnDisplaySettings');
  const displayPopover = document.getElementById('displaySettingsPopover');
  if (btnDisplaySettings && displayPopover) {
    const eFont = displayPopover.querySelector('#dsEditorFont');
    const pFont = displayPopover.querySelector('#dsPreviewFont');
    const density = displayPopover.querySelector('#dsDensity');
    const colorScheme = displayPopover.querySelector('#dsColorScheme');
    const curEf = getEditorFontSize();
    const curPf = getPreviewFontSize();
    if (eFont && curEf > 0) eFont.value = curEf;
    if (pFont && curPf > 0) pFont.value = curPf;
    if (density) density.value = getDensity();
    if (colorScheme) colorScheme.value = getColorScheme();

    btnDisplaySettings.addEventListener('click', (e) => {
      e.stopPropagation();
      displayPopover.hidden = !displayPopover.hidden;
      if (!displayPopover.hidden) positionStylePopover(btnDisplaySettings, displayPopover);
    });
    if (eFont) eFont.addEventListener('change', () => {
            setEditorFontSize(parseInt(eFont.value, 10) || 0);
    });
    if (pFont) pFont.addEventListener('change', () => {
            setPreviewFontSize(parseInt(pFont.value, 10) || 0);
    });
    if (density) density.addEventListener('change', () => {
            setDensity(density.value);
    });
    if (colorScheme) colorScheme.addEventListener('change', () => {
            setColorScheme(colorScheme.value);
    });
    document.addEventListener('click', (e) => {
      if (!displayPopover.hidden && !displayPopover.contains(e.target) && e.target !== btnDisplaySettings) {
        displayPopover.hidden = true;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') displayPopover.hidden = true;
    });
  }

  // ==================================================
  // A-3 大纲面板 / A-12 任务面板
  // ==================================================
  const btnOutline = document.getElementById('btnOutline');
  if (btnOutline) {
    btnOutline.addEventListener('click', () => {
      const panel = document.getElementById('outlinePanel');
      if (!panel) return;
      const open = panel.classList.toggle('open');
      btnOutline.classList.toggle('active', open);
      if (open) {
        renderOutline(getOutlineItems(editor));
      }
      // 镶入式面板会挤压编辑区宽度 → 软换行重排，必须让 CM6 重测
      if (editor) requestAnimationFrame(() => editor.requestMeasure());
    });
  }
  const btnTasks = document.getElementById('btnTasks');
  if (btnTasks) {
    btnTasks.addEventListener('click', () => {
      const panel = document.getElementById('taskListPanel');
      if (!panel) return;
      const open = panel.classList.toggle('open');
      btnTasks.classList.toggle('active', open);
      if (open) {
        renderTaskList(getTaskItems(editor));
              }
    });
  }
  document.getElementById('outlineClose')?.addEventListener('click', () => {
    document.getElementById('outlinePanel')?.classList.remove('open');
    document.getElementById('btnOutline')?.classList.remove('active');
    if (editor) requestAnimationFrame(() => editor.requestMeasure());
  });
  document.getElementById('taskClose')?.addEventListener('click', () => {
    document.getElementById('taskListPanel')?.classList.remove('open');
    document.getElementById('btnTasks')?.classList.remove('active');
  });

  window.__setEditorContent = setEditorContent;
  window.__editor = editor;
}

// 同步专注模式 / 打字机按钮的 active 状态（init 恢复持久化设置后调用）
function syncFocusModeButtons() {
  const f = document.getElementById('btnFocusMode');
  const t = document.getElementById('btnTypewriter');
  if (f) f.classList.toggle('active', isFocusMode());
  if (t) t.classList.toggle('active', isTypewriter());
  }

// 粘贴模式：由编辑区右键菜单「粘贴为文本 / 粘贴为富文本」显式设置；
// 普通 Ctrl+V / 系统右键粘贴恒为 null（走 CodeMirror 默认纯文本，零污染）。
let pasteMode = null;

/**
 * 粘贴「富文本」前对剪贴板 HTML 做样式清洗：
 *  - 拆掉纯样式包裹标签 <span>/<font>/<center>（保留其内部文本，转 Markdown 时不再产生裸标签）；
 *  - 全局剥离 style 属性（消除 WorkBuddy 等「伪富文本」带来的内联样式噪音）；
 *  - 结构性标签（strong/em/a/table/ul 等）原样保留，交由 htmlToMarkdown 正常转换。
 * 该清洗仅作用于「粘贴为富文本」路径，不影响预览区→源码的回写（不动 html-to-markdown.js）。
 */
function cleanStyleHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('span, font, center').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  doc.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
  return doc.body.innerHTML;
}

function initPasteImageSupport() {
  editor.contentDOM.addEventListener('paste', async (event) => {
    const cd = event.clipboardData;
    if (!cd) return;

    // —— 1) 图片优先（保持原有全部逻辑）——
    const items = Array.from(cd.items || []);
    const imageItem = items.find((it) => it.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        try {
          const { imagePath, storageMode } = await persistPastedImage(file);
          insertMarkdownSnippet(buildPastedImageMarkdown({ alt: 'pasted-image', imagePath }));
          showToast(storageMode === 'file'
            ? `图片已保存并插入: ${imagePath}` : '图片已以内嵌 data URL 插入 Markdown', 'success');
        } catch (err) { showToast('粘贴图片失败: ' + err.message, 'error'); }
      }
      return;
    }

    // —— 2) 右键显式模式（粘贴为文本 / 粘贴为富文本）——
    if (pasteMode === 'text') {
      event.preventDefault();
      insertMarkdownSnippet(cd.getData('text/plain') || '');
      pasteMode = null;
      return;
    }
    if (pasteMode === 'rich') {
      event.preventDefault();
      const html = cd.getData('text/html');
      if (html) {
        insertMarkdownSnippet(htmlToMarkdown(cleanStyleHtml(html)));
      } else {
        insertMarkdownSnippet(cd.getData('text/plain') || '');
      }
      pasteMode = null;
      return;
    }

    // —— 3) 默认（Ctrl+V / 系统右键粘贴）：纯文本 ——
    // 不拦截、不 preventDefault，交由 CodeMirror 以纯文本插入（与记事本一致，零污染）。
    // 不再自动把 HTML 转 Markdown，避免 WorkBuddy 等「伪富文本」污染正文。
  });
}

// ==========================================
// 编辑区右键菜单（粘贴为文本 / 粘贴为富文本）
// 复用预览区右键菜单的样式与定位范式（previewContextMenu）。
// ==========================================
function hideEditorContextMenu() {
  const menu = document.getElementById('editorContextMenu');
  if (menu) menu.remove();
}

function showEditorContextMenu(clientX, clientY) {
  hideEditorContextMenu();

  const menu = document.createElement('div');
  menu.id = 'editorContextMenu';
  menu.className = 'preview-context-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" class="preview-context-item" data-action="paste-text" role="menuitem">粘贴为文本</button>
    <button type="button" class="preview-context-item" data-action="paste-rich" role="menuitem">粘贴为富文本</button>
  `;

  document.body.appendChild(menu);

  const pad = 8;
  const rect = menu.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - pad) {
    left = window.innerWidth - rect.width - pad;
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = window.innerHeight - rect.height - pad;
  }
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;

  menu.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // 保住选区
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      hideEditorContextMenu();
      triggerPaste(btn.dataset.action === 'paste-rich' ? 'rich' : 'text');
    });
  });
}

// 程序化触发粘贴，复用粘贴事件管线（携带 clipboardData）；
// execCommand('paste') 在 Chromium 系（扩展页 / Tauri webview）可靠，且在用户手势内调用。
function triggerPaste(mode) {
  pasteMode = mode;
  editor.contentDOM.focus();
  let fired = false;
  try {
    fired = document.execCommand('paste');
  } catch {
    fired = false;
  }
  // 兜底复位：若 execCommand 未真正派发 paste 事件（返回 false / 沙箱 / 受限 CSP），
  // pasteMode 会滞留并污染后续普通 Ctrl+V。用一次性超时复位，确保至多生效一次。
  // 正常派发时，paste 事件处理器会同步把 pasteMode 复位为 null，此处判断失效、无副作用。
  if (!fired) {
    setTimeout(() => {
      if (pasteMode === mode) pasteMode = null;
    }, 300);
  }
}

let editorContextMenuInitialized = false;
function initEditorContextMenu() {
  // 幂等保护：init() 若被重复调用，避免 document 级监听被重复堆叠（每次都新增一对 mousedown/keydown）。
  if (editorContextMenuInitialized) return;
  editorContextMenuInitialized = true;
  editor.contentDOM.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showEditorContextMenu(event.clientX, event.clientY);
  });
  document.addEventListener('mousedown', (event) => {
    const menu = document.getElementById('editorContextMenu');
    if (menu && !menu.contains(event.target)) hideEditorContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideEditorContextMenu();
  });
}

function insertMarkdownSnippet(snippet) {
  const sel = editor.state.selection.main;
  const beforeChar = sel.from > 0 ? editor.state.sliceDoc(sel.from - 1, sel.from) : '';
  const afterChar = sel.to < editor.state.doc.length ? editor.state.sliceDoc(sel.to, sel.to + 1) : '';

  let insert = snippet;
  if (beforeChar && beforeChar !== '\n') {
    insert = '\n' + insert;
  }
  if (afterChar && afterChar !== '\n') {
    insert = insert + '\n';
  }

  const anchor = sel.from + insert.length;
  editor.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor, head: anchor },
  });
  editor.focus();
}

async function persistPastedImage(file) {
  if (directoryHandle && currentDirectoryPath !== null) {
    try {
      const imagePath = await savePastedImageToDirectory(file);
      return { imagePath, storageMode: 'file' };
    } catch (err) {
      console.warn('写入 images/ 目录失败，回退到 data URL:', err);
    }
  }

  const imagePath = await blobToDataUrl(file);
  return { imagePath, storageMode: 'data-url' };
}

async function savePastedImageToDirectory(file) {
  const hasPermission = await ensureDirectoryPermission(directoryHandle, 'readwrite');
  if (!hasPermission) {
    throw new Error('没有写入当前文件夹的权限');
  }

  const currentDirHandle = await getCurrentMarkdownDirectoryHandle();
  const imagesHandle = await currentDirHandle.getDirectoryHandle('images', { create: true });
  const filename = createPastedImageFilename({
    timestamp: new Date(),
    extension: mimeTypeToExtension(file.type),
  });
  const imageFileHandle = await imagesHandle.getFileHandle(filename, { create: true });
  const writable = await imageFileHandle.createWritable();
  await writable.write(file);
  await writable.close();

  return buildImagesRelativePath(filename);
}

async function getCurrentMarkdownDirectoryHandle() {
  if (!directoryHandle || currentDirectoryPath === null) {
    throw new Error('当前文件没有可写目录上下文');
  }

  let handle = directoryHandle;
  for (const segment of splitRelativePath(currentDirectoryPath)) {
    handle = await handle.getDirectoryHandle(segment);
  }

  return handle;
}

async function ensureDirectoryPermission(handle, mode = 'read') {
  if (!handle?.queryPermission || !handle?.requestPermission) {
    return true;
  }

  const options = { mode };
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  return (await handle.requestPermission(options)) === 'granted';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取剪贴板图片失败'));
    reader.readAsDataURL(blob);
  });
}

// ==========================================
// 文件浏览器侧边栏
// ==========================================
export let directoryHandle = null;
let isSidebarCollapsed = localStorage.getItem('md-sidebar-collapsed') === 'true';

async function handleOpenFolder() {
    try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    setGlobalDirectoryHandle(directoryHandle);   // 同步句柄给工作区搜索模块
    await renderFileTree();
        showToast(`已打开文件夹: ${directoryHandle.name}`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('打开文件夹失败: ' + err.message, 'error');
    }
  }
}

async function readDirectoryRecursive(dirHandle, depth = 0, parentPath = '') {
  const entries = [];
  for await (const entry of dirHandle.values()) {
    // 跳过隐藏文件和 node_modules / dist 等
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

    const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      const children = depth < 5 ? await readDirectoryRecursive(entry, depth + 1, entryPath) : [];
      entries.push({ name: entry.name, kind: 'directory', handle: entry, path: entryPath, children });
    } else {
      entries.push({ name: entry.name, kind: 'file', handle: entry, path: entryPath });
    }
  }

  // 排序：文件夹在前，再按名称排序
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });

  return entries;
}

/**
 * 构造文件树的名称节点（安全注入）。
 * 文件名/目录名来自用户选择的任意本地目录，可被构造成
 * `<img src=x onerror=...>.md` 之类的载荷。此前这些名字被直接拼进
 * innerHTML 模板，会在扩展特权页（可访问 chrome.* API）形成 XSS。
 * 名称一律经 textContent 注入，从根上消除该注入面。
 * @param {string} name 原始文件名/目录名
 * @returns {HTMLSpanElement}
 */
function createTreeNameSpan(name) {
  const span = document.createElement('span');
  span.className = 'tree-item-name';
  span.textContent = String(name == null ? '' : name);
  return span;
}

async function renderFileTree() {
  const container = document.getElementById('fileTree');
  if (!directoryHandle) return;

  container.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center;">加载中...</div>';

  try {
    const entries = await readDirectoryRecursive(directoryHandle);
    container.innerHTML = '';

    // 根目录标题
    const rootDiv = document.createElement('div');
    rootDiv.className = 'tree-item';
    rootDiv.style.fontWeight = '600';
    rootDiv.style.paddingLeft = '8px';
    // 图标为静态 SVG 常量，可安全走 innerHTML；目录名单独走 textContent。
    rootDiv.innerHTML = `
      <span class="tree-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </span>
    `;
    rootDiv.appendChild(createTreeNameSpan(directoryHandle.name));
    container.appendChild(rootDiv);

    renderTreeEntries(container, entries, 1);
  } catch (err) {
    // 错误信息可能内嵌文件名等外部数据，同样不得进入 innerHTML。
    container.innerHTML = '';
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'padding:12px;color:var(--danger);font-size:12px;';
    errDiv.textContent = err && err.message ? err.message : String(err);
    container.appendChild(errDiv);
  }
}

function renderTreeEntries(parent, entries, depth) {
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      renderDirectoryNode(parent, entry, depth);
    } else {
      renderFileNode(parent, entry, depth);
    }
  }
}

function renderDirectoryNode(parent, entry, depth) {
  const itemDiv = document.createElement('div');
  itemDiv.className = 'tree-item';
  itemDiv.style.paddingLeft = `${depth * 16 + 8}px`;

  const chevron = `<span class="tree-item-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,6 15,12 9,18"/></svg></span>`;
  const icon = `<span class="tree-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>`;

  // chevron / icon 为静态 SVG 常量；目录名走 textContent，防止文件名 XSS。
  itemDiv.innerHTML = `${chevron}${icon}`;
  itemDiv.appendChild(createTreeNameSpan(entry.name));

  // 子节点容器
  const childrenDiv = document.createElement('div');
  childrenDiv.className = 'tree-children';

  if (entry.children && entry.children.length > 0) {
    renderTreeEntries(childrenDiv, entry.children, depth + 1);
  }

  // 点击展开/折叠
  itemDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    const chevronEl = itemDiv.querySelector('.tree-item-chevron');
    chevronEl.classList.toggle('expanded');
    childrenDiv.classList.toggle('expanded');
  });

  parent.appendChild(itemDiv);
  parent.appendChild(childrenDiv);
}

function renderFileNode(parent, entry, depth) {
  const itemDiv = document.createElement('div');
  itemDiv.className = 'tree-item';
  itemDiv.style.paddingLeft = `${depth * 16 + 24}px`; // 多缩进一点，对齐文件夹下的文件

  const isMarkdown = /\.(md|markdown|mdown|mkd|mkdn|txt)$/i.test(entry.name);
  const iconColor = isMarkdown ? 'var(--accent)' : 'var(--text-muted)';
  const icon = isMarkdown
    ? `<span class="tree-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/></svg></span>`
    : `<span class="tree-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/></svg></span>`;

  // icon 由 iconColor（内部常量）拼成，无外部输入；文件名走 textContent。
  itemDiv.innerHTML = `${icon}`;
  itemDiv.appendChild(createTreeNameSpan(entry.name));

  if (isMarkdown) {
    itemDiv.addEventListener('click', async (e) => {
      e.stopPropagation();
      await openFileFromTree(entry.handle, entry.name, entry.path);
      // 高亮当前文件
      document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
      itemDiv.classList.add('active');
    });
  } else {
    itemDiv.style.opacity = '0.5';
    itemDiv.style.cursor = 'default';
  }

  parent.appendChild(itemDiv);
}

async function openFileFromTree(fileHandle, filename, relativePath) {
  try {
    if (isModified) {
      if (!confirm('当前文件有未保存的更改，确定要打开新文件吗？')) return;
    }

    const file = await fileHandle.getFile();
    const content = await file.text();

    currentFileHandle = fileHandle;
    setCurrentDocumentContext({
      fileUrl: null,
      directoryPath: dirnameFromRelativePath(relativePath),
    });
    setEditorContent(content);
    updateFilename(filename);
    markSaved();
    await rememberCurrentDocument({ filename });
    showToast(`已打开: ${filename}`, 'success');
    hideOnboarding();
  } catch (err) {
    showToast('打开文件失败: ' + err.message, 'error');
  }
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('fileSidebar');
  const toggleBtn = document.getElementById('sidebarToggle');

  // 显示目标：显式指定时取反；未指定时「当前隐藏（手动收起或视图模式隐藏）则显示，否则隐藏」。
  let show;
  if (forceState !== undefined) {
    show = !forceState;
  } else {
    show = sidebar.classList.contains('collapsed') || sidebar.classList.contains('view-hidden');
  }

  if (show) {
    // 修复 BUG2：恢复侧栏时同时清除 .collapsed 与 .view-hidden（视图模式隐藏也可恢复），
    // 否则仅去 .collapsed 会被 .view-hidden(display:none!important) 继续压制，导致「点恢复无效」。
    sidebar.classList.remove('collapsed', 'view-hidden');
    // 恢复宽度：清除内联 width 后由 CSS 默认/拖拽持久化值接管
    const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
    if (!isNaN(savedWidth) && savedWidth >= SIDEBAR_MIN_WIDTH && savedWidth <= SIDEBAR_MAX_WIDTH) {
      sidebar.style.width = savedWidth + 'px';
    } else {
      sidebar.style.width = '';
    }
    isSidebarCollapsed = false;
  } else {
    sidebar.classList.add('collapsed');
    // 收起时清除内联宽度，确保 .collapsed { width: 0 } 生效
    sidebar.style.width = '';
    isSidebarCollapsed = true;
  }

  localStorage.setItem('md-sidebar-collapsed', isSidebarCollapsed);

  if (toggleBtn) {
    toggleBtn.classList.toggle('visible', !show);
  }

  // 刷新编辑器布局
  if (editor) {
    requestAnimationFrame(() => editor.requestMeasure());
  }
}

function initFileSidebar() {
  // 打开文件夹
  document.getElementById('btnOpenFolder').addEventListener('click', handleOpenFolder);

  // 刷新
  document.getElementById('btnRefreshTree').addEventListener('click', async () => {
    if (directoryHandle) {
      await renderFileTree();
      showToast('文件树已刷新', 'success');
    } else {
      showToast('请先打开一个文件夹', 'error');
    }
  });

  // 收起侧边栏
  document.getElementById('btnCollapseSidebar').addEventListener('click', () => toggleSidebar(true));

  // 添加侧边栏展开的 toggle bar
  const editorMain = document.getElementById('editorMain');
  const toggleBtn = document.createElement('div');
  toggleBtn.className = 'sidebar-toggle';
  toggleBtn.id = 'sidebarToggle';
  toggleBtn.title = '展开文件浏览器';
  toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,6 15,12 9,18"/></svg>`;
  toggleBtn.addEventListener('click', () => toggleSidebar(false));
  editorMain.insertBefore(toggleBtn, editorMain.querySelector('.editor-panel'));

  // 恢复侧边栏状态
  if (isSidebarCollapsed) {
    toggleSidebar(true);
  }

  // 修复 BUG2 初始化顺序：applyViewMode 可能早于 initFileSidebar 执行，
  // 导致首屏若持久化为 focus/immersive，#sidebarToggle 尚未创建、未被点亮。
  // 此处补一次可见性同步：侧栏被视图隐藏(.view-hidden)或手动收起(.collapsed)时点亮恢复条。
  const __sb = document.getElementById('fileSidebar');
  const __hidden = __sb && (__sb.classList.contains('collapsed') || __sb.classList.contains('view-hidden'));
  toggleBtn.classList.toggle('visible', !!__hidden);
}

// A-5：打开快照 / 历史版本对话框，列出当前文件的快照环，支持回滚
async function openSnapshotsDialog() {
  const dialog = document.getElementById('snapshotsDialog');
  const list = document.getElementById('snapshotsList');
  if (!dialog || !list) return;
  list.innerHTML = '';
  const snapshots = await listSnapshots();
  if (!snapshots.length) {
    const empty = document.createElement('p');
    empty.className = 'snapshots-empty';
    empty.textContent = '暂无快照。编辑停顿后会自动保存草稿；每隔一段时间或累计一定改动会生成历史快照。';
    list.appendChild(empty);
  } else {
    snapshots.forEach((snap) => {
      const item = document.createElement('div');
      item.className = 'snapshots-item';

      const meta = document.createElement('div');
      meta.className = 'snapshots-meta';
      meta.textContent = `${new Date(snap.timestamp).toLocaleString()} · ${snap.content.length} 字符`;

      const preview = document.createElement('div');
      preview.className = 'snapshots-preview';
      preview.textContent = snap.preview || '(空)';

      const actions = document.createElement('div');
      actions.className = 'snapshots-actions';
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'modal-btn modal-btn-primary';
      restoreBtn.textContent = '恢复此版本';
      restoreBtn.addEventListener('click', async () => {
        if (await showConfirm('恢复此快照将覆盖当前编辑区内容（不会自动写入磁盘文件）。是否继续？')) {
          const ok = await restoreSnapshot(snap.id);
          if (ok) {
            dialog.hidden = true;
            showToast('已恢复到所选历史版本', 'success');
          }
        }
      });
      actions.appendChild(restoreBtn);

      item.appendChild(meta);
      item.appendChild(preview);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }
  dialog.hidden = false;
}

function closeSnapshotsDialog() {
  const dialog = document.getElementById('snapshotsDialog');
  if (dialog) dialog.hidden = true;
}

function init() {
  // Stamp version so we can confirm Chrome loaded the new package
  document.documentElement.dataset.appVersion = APP_VERSION;
  document.title = `Markdown 编辑器 v${APP_VERSION}`;
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = `v${APP_VERSION}`;
  console.info(`[MD Editor] build v${APP_VERSION}`);

  
  // 恢复主题（修复 THM-01 的首屏分支）：
  // data-theme / data-editor-theme 由 init 尾部的 applyEditorThemePreset 统一落定（单一事实源），
  // 此处只按派生出的明暗基底对齐 mermaid 与主题图标。旧实现仅在 light 分支初始化 mermaid，
  // 且默认 currentTheme='dark' 与默认预设「豆沙绿（亮）」矛盾，会造成首屏明暗错配。
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'Inter, sans-serif',
  });
  updateThemeIcon();

  // 创建编辑器
  createEditor();

  // A-5：初始化自动保存上下文（注入 editor 实例与文件唯一键解析器）
  // Bug #1 修复：用 resolveFileKey 优先句柄名、回退已加载文件名，避免 file:// 文件串档。
  initAutosave({ editor, getFileId: () => resolveFileKey(currentFileHandle?.name, currentFileName) });
  // A-5：启动后若发现未保存草稿，提示恢复（异步，不阻塞初始化）
  // 已禁用：设计文档 §13 将「自动保存 / 会话恢复」列为 OUT OF SCOPE，
  // 新开扩展不应再弹出「发现未保存草稿」恢复弹窗（用户反馈 BUG 1）。
  // 保留函数体（autosave.js）不动，仅不在此处调用，便于后续若重新启用。
  // offerDraftRestore().catch((e) => console.error('[autosave] 草稿恢复检查失败', e));

  // A-8：恢复专注模式 / 显示字号 / 密度 持久化设置
  initDisplaySettings();

  syncFocusModeButtons();

  // 绑定事件
  bindEvents();

  // 初始化分屏拖拽
  initResizer();

  // 镶入式大纲面板：宽度恢复 + 拖拽 + 展开态同步
  initOutlineDock();

  // v1.8.5：工具栏横向溢出滚动按钮（已知问题3）
  initToolbarScroll('#toolbar');

  // 初始化预览区可编辑
  initPreviewEditing();
  initPreviewLinkNavigation();

  // 初始化编辑区图片粘贴
  initPasteImageSupport();
  // 初始化编辑区右键菜单（粘贴为文本 / 粘贴为富文本）
  initEditorContextMenu();

  // 初始化文件浏览器侧边栏
  initFileSidebar();

  // 编辑区标题栏的「文件图标 + 绝对路径」首帧对齐当前状态
  updateEditorFilePath();

  // 初始化反馈按钮
  initFeedbackButton();

  // 监听 onboarding 自定义事件
  document.addEventListener('onboarding:load-example', (e) => {
    setEditorContent(e.detail.content);
    updateFilename('示例文件.md');
    markSaved();
  });

  document.addEventListener('onboarding:open-folder', () => {
    handleOpenFolder();
  });

  // 显示新用户引导（无文件打开时）
  showOnboarding();

  // 恢复视图模式
  setViewMode(currentViewMode);
  // === MARKRA_HOOK: INIT === 各功能初始化挂载点（斜杠菜单/块拖拽/视图/搜索/主题等 initXxx 调用）
  // —— markra 移植功能启动接线（集中此处，避免各分支在标记处冲突）——
  applyEditorThemePreset(getStoredEditorTheme());   // 默认豆沙绿(亮) / 已存主题
  applyViewMode(getStoredViewMode());               // 视图模式（日常/专注/沉浸/全显）
  requestAnimationFrame(() => editor.requestMeasure());
  // 主题下拉绑定：传入回调，使「下拉换预设」也同步 CM6 明暗扩展 / mermaid / 主题图标，
  // 与 #btnTheme 明暗切换走同一条运行时同步路径（修复 THM-01 的反向不一致）。
  initThemeSelect((_id, kind) => syncThemeRuntime(kind));
  initChromeModeButton();                            // 视图模式 ⊞ 按钮循环
  // 工作区搜索独立弹窗（保留兜底入口；主入口已并入查找/替换面板的「工作区搜索」子按钮）。
  // renderResults 回调传的是 {path, handle} 而非裸句柄，必须解包后再交给 openWithHandle。
  initWorkspaceSearchPanel(directoryHandle, (detail) => {
    if (detail && detail.handle) openWithHandle(detail.handle);
  });
  setGlobalDirectoryHandle(directoryHandle);                    // 同步当前文件夹句柄给搜索模块

  // 延迟初始化滚动同步(等待 CM 挂载完成)
  setTimeout(initScrollSync, 200);

  // 检查是否有从 content script 传入的 pending file
  loadPendingFile();

  // 桌面端：处理「双击 .md 文件启动 EXE」传入的路径参数
  openInitialCliFile();
}

// ==========================================
// 从 Chrome Storage 加载 pending file
// （用户拖拽 .md 文件到 Chrome 时触发）
// ==========================================
async function loadPendingFile() {
  // 在非扩展环境（dev server）中跳过 storage 读取，但仍尝试本地恢复不可用
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  // 每个编辑器实例通过 URL 上的 ?i=<instanceId> 标识自己，
  // 以此读取「专属」的 pendingFile_<instanceId>，避免多个实例争用同一个键。
  const params = new URLSearchParams(window.location.search);
  const instanceId = params.get('i');
  const storageKey = pendingFileStorageKey(instanceId);

  try {
    const result = await chrome.storage.local.get(storageKey);
    const pendingFile = result[storageKey];

    if (!pendingFile) {
      // 没有刚拖入的文件时，恢复上次编辑内容（Issue #2）
      await tryRestoreLastDocument();
      return;
    }

    // 检查时间戳，超过 30 秒的视为过期
    if (Date.now() - pendingFile.timestamp > 30000) {
      await chrome.storage.local.remove(storageKey);
      await tryRestoreLastDocument();
      return;
    }

    setCurrentDocumentContext({
      fileUrl: pendingFile.sourceUrl || null,
      directoryPath: null,
    });
    // 加载文件内容到编辑器
    setEditorContent(pendingFile.content);
    updateFilename(pendingFile.filename);
    currentFileHandle = null; // file:// 打开无法获得 FileHandle
    markSaved();
    await rememberCurrentDocument({
      filename: pendingFile.filename,
      sourceUrl: pendingFile.sourceUrl || null,
    });
    showToast(`已打开: ${pendingFile.filename}`, 'success');
    hideOnboarding();

    // 清除 pending file
    await chrome.storage.local.remove(storageKey);
  } catch (err) {
    console.warn('加载 pending file 失败:', err);
    await tryRestoreLastDocument();
  }
}

// DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
