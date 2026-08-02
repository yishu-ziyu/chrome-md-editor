// ==========================================
// Markdown Editor - 核心逻辑
// ==========================================

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
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
import { showOnboarding, hideOnboarding } from './onboarding.js';
import { initFeedbackButton } from './feedback.js';
import { rememberLastFile, loadLastFile } from './session-restore.js';
import { htmlToMarkdown } from './html-to-markdown.js';
import { makeSearchPanel } from './search-panel.js';
import { scheduleAutosave, initAutosave, listSnapshots, restoreSnapshot, offerDraftRestore } from './autosave.js';
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

/** Visible build stamp so we can tell if Chrome reloaded the new package. */
export const APP_VERSION = '1.4.2';
import {
  getPresetDefaultModel,
  getTranslatePreset,
  groupTranslatePresets,
} from './translate-presets.js';

// ==========================================
// Mermaid 初始化
// ==========================================
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
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
});

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

// ==========================================
// 状态管理
// ==========================================
let editor = null;
let currentFileHandle = null;
let isModified = false;
let currentTheme = localStorage.getItem('md-editor-theme') || 'dark';
let currentViewMode = localStorage.getItem('md-editor-view-mode') || 'split';
let scrollSyncEnabled = true;
let isPreviewEditing = false; // 防止预览编辑时循环更新
let mermaidCounter = 0; // mermaid 图表 ID 计数器
let currentFileUrl = null; // file:// 打开的 Markdown 原始地址
let currentDirectoryPath = null; // 相对已打开文件夹根目录的当前 Markdown 目录
let previewObjectUrls = []; // 用于释放通过 File System Access API 生成的 blob URL
let translateEnabled = false; // 预览区阅读翻译（双语对照，不改源码）
let translateBusy = false;
let translateRunId = 0;
let translateSettingsCache = null;

// Theme compartment for dynamic switching
const themeCompartment = new Compartment();

// Custom light theme
const lightTheme = EditorView.theme({
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

  const extensions = [
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
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ createPanel: makeSearchPanel }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
      // 自定义快捷键
      { key: 'Mod-s', run: handleSave, preventDefault: true },
      { key: 'Mod-o', run: handleOpen, preventDefault: true },
      { key: 'Mod-b', run: () => wrapSelection('**', '**'), preventDefault: true },
      { key: 'Mod-i', run: () => wrapSelection('*', '*'), preventDefault: true },
    ]),
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
    }),
    EditorView.lineWrapping,
    themeCompartment.of(currentTheme === 'dark' ? oneDark : lightTheme),
    // 内容变化时更新预览
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        updatePreview();
        updateStatus();
        markModified();
        scheduleAutosave();
      }
      if (update.selectionSet) {
        updateCursorStatus();
      }
    }),
  ];

  editor = new EditorView({
    state: EditorState.create({
      doc: startDoc,
      extensions,
    }),
    parent: editorContainer,
  });

  // 初始化预览
  updatePreview();
  updateStatus();
}

// ==========================================
// 预览更新
// ==========================================
let previewUpdateTimer = null;

function updatePreview() {
  if (isPreviewEditing) return; // 避免预览编辑时循环

  // 防抖：快速输入时减少渲染次数；开启翻译时略加长，降低 API 调用频率
  clearTimeout(previewUpdateTimer);
  const delay = translateEnabled ? 450 : 80;
  previewUpdateTimer = setTimeout(() => {
    doUpdatePreview();
  }, delay);
}

async function doUpdatePreview() {
  const previewContainer = document.getElementById('previewContainer');
  const content = editor.state.doc.toString();
  let html = md.render(content);

  // 渲染 Mermaid 图表
  // markdown-it 会把 ```mermaid 渲染成 <pre><code class="language-mermaid">...</code></pre>
  cleanupPreviewObjectUrls();
  previewContainer.innerHTML = html;

  // 查找所有 mermaid 代码块并渲染
  const mermaidBlocks = previewContainer.querySelectorAll('code.language-mermaid');
  for (const block of mermaidBlocks) {
    const source = block.textContent;
    const pre = block.parentElement;
    try {
      mermaidCounter++;
      const { svg } = await mermaid.render(`mermaid-${mermaidCounter}`, source);
      const div = document.createElement('div');
      div.className = 'mermaid-diagram';
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch (err) {
      // 渲染失败时显示错误
      const div = document.createElement('div');
      div.className = 'mermaid-error';
      div.textContent = 'Mermaid 渲染错误: ' + err.message;
      pre.replaceWith(div);
    }
  }

  await resolvePreviewImages(previewContainer);

  if (translateEnabled) {
    await runPreviewTranslation(previewContainer);
  } else {
    setTranslateUiState({ active: false });
  }
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

  // 实时同步：每次输入后短延迟同步
  let syncTimer = null;
  previewContainer.addEventListener('input', () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncPreviewToEditor();
    }, 500);
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
    // 短延迟后解除标记
    setTimeout(() => { isPreviewEditing = false; }, 120);
  }

  // 失焦时：用规范化后的 Markdown 重新渲染预览，保证预览与编辑器一致，
  // 避免下一次编辑基于「被篡改的 contenteditable DOM」继续累加空行与漂移
  if (rerender) {
    doUpdatePreview();
  }
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
async function handleOpen() {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'Markdown 文件',
        accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'] },
      }],
      multiple: false,
    });

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
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('打开文件失败: ' + err.message, 'error');
    }
  }
  return true;
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
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: 'untitled.md',
      types: [{
        description: 'Markdown 文件',
        accept: { 'text/markdown': ['.md'] },
      }],
    });

    const writable = await fileHandle.createWritable();
    await writable.write(editor.state.doc.toString());
    await writable.close();

    currentFileHandle = fileHandle;
    clearCurrentDocumentContext();
    const savedName = (await fileHandle.getFile()).name;
    updateFilename(savedName);
    markSaved();
    await rememberCurrentDocument({ filename: savedName });
    showToast('文件已保存', 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('保存失败: ' + err.message, 'error');
    }
  }
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
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: content,
    },
  });
}

function updateFilename(name) {
  document.getElementById('filename').textContent = name;
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
    const placeholder = before === '**' ? '加粗文本' : before === '*' ? '斜体文本' : before === '~~' ? '删除线文本' : before === '`' ? 'code' : '文本';
    editor.dispatch({
      changes: { from: sel.from, insert: before + placeholder + after },
      selection: { anchor: sel.from + before.length, head: sel.from + before.length + placeholder.length },
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
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('md-editor-theme', currentTheme);

  document.documentElement.setAttribute('data-theme', currentTheme === 'light' ? 'light' : '');

  editor.dispatch({
    effects: themeCompartment.reconfigure(
      currentTheme === 'dark' ? oneDark : lightTheme
    ),
  });

  // 更新 Mermaid 主题
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme === 'dark' ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'Inter, sans-serif',
  });
  // 重新渲染预览中的 Mermaid
  doUpdatePreview();

  // 更新主题图标
  updateThemeIcon();
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
function initResizer() {
  const resizer = document.getElementById('resizer');
  const editorPanel = document.getElementById('editorPanel');
  const previewPanel = document.getElementById('previewPanel');
  const editorMain = document.getElementById('editorMain');

  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const totalWidth = editorMain.offsetWidth;
    const startEditorWidth = editorPanel.offsetWidth;

    function onMouseMove(e) {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const newEditorWidth = startEditorWidth + dx;
      const editorPercent = (newEditorWidth / totalWidth) * 100;

      if (editorPercent > 20 && editorPercent < 80) {
        editorPanel.style.flex = `0 0 ${editorPercent}%`;
        previewPanel.style.flex = `0 0 ${100 - editorPercent}%`;
      }
    }

    function onMouseUp() {
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (editor) editor.requestMeasure();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
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

  // 简单比例同步
  const editorScroller = editorContainer.querySelector('.cm-scroller');
  if (!editorScroller) return;

  let isSyncing = false;

  editorScroller.addEventListener('scroll', () => {
    if (!scrollSyncEnabled || isSyncing || currentViewMode !== 'split') return;
    isSyncing = true;

    const scrollPercent = editorScroller.scrollTop / (editorScroller.scrollHeight - editorScroller.clientHeight || 1);
    previewContainer.scrollTop = scrollPercent * (previewContainer.scrollHeight - previewContainer.clientHeight);

    requestAnimationFrame(() => { isSyncing = false; });
  });

  previewContainer.addEventListener('scroll', () => {
    if (!scrollSyncEnabled || isSyncing || currentViewMode !== 'split') return;
    isSyncing = true;

    const scrollPercent = previewContainer.scrollTop / (previewContainer.scrollHeight - previewContainer.clientHeight || 1);
    editorScroller.scrollTop = scrollPercent * (editorScroller.scrollHeight - editorScroller.clientHeight);

    requestAnimationFrame(() => { isSyncing = false; });
  });
}

// ==========================================
// 事件绑定
// ==========================================
function bindEvents() {
  // 文件操作
  document.getElementById('btnOpen').addEventListener('click', handleOpen);
  document.getElementById('btnSave').addEventListener('click', handleSave);
  document.getElementById('btnNew').addEventListener('click', handleNew);

  // 格式化按钮
  document.getElementById('btnBold').addEventListener('click', () => wrapSelection('**', '**'));
  document.getElementById('btnItalic').addEventListener('click', () => wrapSelection('*', '*'));
  document.getElementById('btnStrike').addEventListener('click', () => wrapSelection('~~', '~~'));
  document.getElementById('btnCode').addEventListener('click', () => wrapSelection('`', '`'));

  // A-5：快照 / 历史版本入口
  const btnSnapshots = document.getElementById('btnSnapshots');
  if (btnSnapshots) btnSnapshots.addEventListener('click', () => openSnapshotsDialog());
  const snapshotsDialog = document.getElementById('snapshotsDialog');
  const snapshotsClose = document.getElementById('snapshotsClose');
  if (snapshotsClose) snapshotsClose.addEventListener('click', () => { if (snapshotsDialog) snapshotsDialog.hidden = true; });
  if (snapshotsDialog) {
    snapshotsDialog.addEventListener('click', (e) => { if (e.target === snapshotsDialog) snapshotsDialog.hidden = true; });
    snapshotsDialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') snapshotsDialog.hidden = true; });
  }

  // 高亮：优先作用在右侧预览选区；无选区时退回源码选区包 <mark>
  const btnHighlight = document.getElementById('btnHighlight');
  if (btnHighlight) {
    btnHighlight.addEventListener('mousedown', (e) => {
      // 避免按钮抢走焦点导致预览选区丢失
      e.preventDefault();
      rememberPreviewSelection();
    });
    btnHighlight.addEventListener('click', () => {
      applyPreviewHighlight();
    });
  }

  // 使用说明（重新打开引导说明书）
  const btnHelp = document.getElementById('btnHelp');
  if (btnHelp) {
    btnHelp.addEventListener('click', () => {
      showOnboarding({ force: true, mode: 'guide' });
    });
  }

  // 标题
  document.getElementById('btnH1').addEventListener('click', () => insertAtLineStart('# '));
  document.getElementById('btnH2').addEventListener('click', () => insertAtLineStart('## '));
  document.getElementById('btnH3').addEventListener('click', () => insertAtLineStart('### '));

  // 列表和引用
  document.getElementById('btnUL').addEventListener('click', () => insertAtLineStart('- '));
  document.getElementById('btnOL').addEventListener('click', () => insertAtLineStart('1. '));
  document.getElementById('btnQuote').addEventListener('click', () => insertAtLineStart('> '));

  // 代码块
  document.getElementById('btnCodeBlock').addEventListener('click', () => insertBlock('```\n\n```'));

  // 链接
  document.getElementById('btnLink').addEventListener('click', () => {
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
  document.getElementById('btnTable').addEventListener('click', () => {
    insertBlock('| 列1 | 列2 | 列3 |\n|------|------|------|\n| 内容 | 内容 | 内容 |');
  });

  // 水平线
  document.getElementById('btnHR').addEventListener('click', () => insertBlock('---'));

  // 视图模式
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
  });

  // 主题切换
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);

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
  document.getElementById('btnTranslateSettings')?.addEventListener('click', () => {
    openTranslateSettingsModal();
  });
  initTranslateSettingsModal();

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
    if (isModified) {
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
        const content = await file.text();
        setEditorContent(content);
        updateFilename(file.name);
        currentFileHandle = null; // 拖拽打开无 handle
        clearCurrentDocumentContext();
        markSaved();
        await rememberCurrentDocument({ filename: file.name });
        hideOnboarding();
        showToast(`已打开: ${file.name}`, 'success');
      } else {
        showToast('请拖入 .md 或 .markdown 文件', 'error');
      }
    }
  });
}

const FORMATTING_SELECTOR = [
  'a[href]', 'img', 'b', 'strong', 'i', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 's', 'del', 'strike',
].join(',');

function hasRichMarkdownFormatting(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return !!doc.body.querySelector(FORMATTING_SELECTOR);
  } catch { return false; }
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

    // —— 2) 富文本 HTML → Markdown（A-4 新增）——
    const html = cd.getData('text/html');
    if (html && hasRichMarkdownFormatting(html)) {
      const md = htmlToMarkdown(html);
      const plain = (cd.getData('text/plain') || '').trim();
      // 仅当转换结果确实比纯文本多了结构化内容时才拦截，避免破坏纯文本粘贴手感
      if (md && md.trim() && md.trim() !== plain) {
        event.preventDefault();
        insertMarkdownSnippet(md);
        return;
      }
    }
    // —— 3) 其余（纯文本等）放行默认粘贴 ——
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
let directoryHandle = null;
let isSidebarCollapsed = localStorage.getItem('md-sidebar-collapsed') === 'true';

async function handleOpenFolder() {
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
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
    rootDiv.innerHTML = `
      <span class="tree-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </span>
      <span class="tree-item-name">${directoryHandle.name}</span>
    `;
    container.appendChild(rootDiv);

    renderTreeEntries(container, entries, 1);
  } catch (err) {
    container.innerHTML = `<div style="padding:12px;color:var(--danger);font-size:12px;">${err.message}</div>`;
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

  itemDiv.innerHTML = `${chevron}${icon}<span class="tree-item-name">${entry.name}</span>`;

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

  itemDiv.innerHTML = `${icon}<span class="tree-item-name">${entry.name}</span>`;

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

  if (forceState !== undefined) {
    isSidebarCollapsed = forceState;
  } else {
    isSidebarCollapsed = !isSidebarCollapsed;
  }

  localStorage.setItem('md-sidebar-collapsed', isSidebarCollapsed);
  sidebar.classList.toggle('collapsed', isSidebarCollapsed);

  if (toggleBtn) {
    toggleBtn.classList.toggle('visible', isSidebarCollapsed);
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
        if (window.confirm('恢复此快照将覆盖当前编辑区内容（不会自动写入磁盘文件）。是否继续？')) {
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
  document.title = `Markdown Editor v${APP_VERSION}`;
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = `v${APP_VERSION}`;
  console.info(`[MD Editor] build v${APP_VERSION}`);

  // 恢复主题
  if (currentTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'Inter, sans-serif',
    });
  }
  updateThemeIcon();

  // 创建编辑器
  createEditor();

  // A-5：初始化自动保存上下文（注入 editor 实例与文件唯一键解析器）
  initAutosave({ editor, getFileId: () => currentFileHandle?.name || 'unsaved' });
  // A-5：启动后若发现未保存草稿，提示恢复（异步，不阻塞初始化）
  offerDraftRestore().catch((e) => console.error('[autosave] 草稿恢复检查失败', e));

  // 绑定事件
  bindEvents();

  // 初始化分屏拖拽
  initResizer();

  // 初始化预览区可编辑
  initPreviewEditing();
  initPreviewLinkNavigation();

  // 初始化编辑区图片粘贴
  initPasteImageSupport();

  // 初始化文件浏览器侧边栏
  initFileSidebar();

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

  // 延迟初始化滚动同步(等待 CM 挂载完成)
  setTimeout(initScrollSync, 200);

  // 检查是否有从 content script 传入的 pending file
  loadPendingFile();
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
