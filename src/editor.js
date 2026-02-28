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
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import MarkdownIt from 'markdown-it';
import mermaid from 'mermaid';

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

  // 防抖：快速输入时减少渲染次数
  clearTimeout(previewUpdateTimer);
  previewUpdateTimer = setTimeout(() => {
    doUpdatePreview();
  }, 80);
}

async function doUpdatePreview() {
  const previewContainer = document.getElementById('previewContainer');
  const content = editor.state.doc.toString();
  let html = md.render(content);

  // 渲染 Mermaid 图表
  // markdown-it 会把 ```mermaid 渲染成 <pre><code class="language-mermaid">...</code></pre>
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
}

// ==========================================
// 预览区可编辑（WYSIWYG）
// ==========================================
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

  // 失焦时：把编辑后的 HTML 转回 Markdown，同步到编辑器
  previewContainer.addEventListener('blur', () => {
    if (!isPreviewEditing) return;
    isPreviewEditing = false;
    previewContainer.classList.remove('editing');
    syncPreviewToEditor();
  });

  // 实时同步：每次输入后短延迟同步
  let syncTimer = null;
  previewContainer.addEventListener('input', () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncPreviewToEditor();
    }, 500);
  });
}

function syncPreviewToEditor() {
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
    setTimeout(() => { isPreviewEditing = false; }, 100);
  }
}

// ==========================================
// HTML → Markdown 转换器（内置轻量实现）
// ==========================================
function htmlToMarkdown(html) {
  // 创建临时 DOM 来遍历
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return convertNode(doc.body).trim() + '\n';
}

function convertNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map(convertNode).join('');
  const childText = children();

  switch (tag) {
    case 'h1': return `# ${childText.trim()}\n\n`;
    case 'h2': return `## ${childText.trim()}\n\n`;
    case 'h3': return `### ${childText.trim()}\n\n`;
    case 'h4': return `#### ${childText.trim()}\n\n`;
    case 'h5': return `##### ${childText.trim()}\n\n`;
    case 'h6': return `###### ${childText.trim()}\n\n`;
    case 'p': return `${childText.trim()}\n\n`;
    case 'br': return '\n';
    case 'strong': case 'b': return `**${childText}**`;
    case 'em': case 'i': return `*${childText}*`;
    case 'del': case 's': return `~~${childText}~~`;
    case 'code':
      if (node.parentElement && node.parentElement.tagName === 'PRE') {
        return childText;
      }
      return `\`${childText}\``;
    case 'pre': {
      const codeEl = node.querySelector('code');
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
      const code = codeEl ? codeEl.textContent : childText;
      return `\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n\n`;
    }
    case 'blockquote':
      return childText.trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
    case 'ul': {
      let result = '';
      for (const li of node.children) {
        if (li.tagName === 'LI') {
          const checkbox = li.querySelector('input[type="checkbox"]');
          const prefix = checkbox
            ? (checkbox.checked ? '- [x] ' : '- [ ] ')
            : '- ';
          const text = Array.from(li.childNodes)
            .filter(n => !(n.tagName === 'INPUT'))
            .map(convertNode).join('').trim();
          result += `${prefix}${text}\n`;
        }
      }
      return result + '\n';
    }
    case 'ol': {
      let result = '';
      let i = 1;
      for (const li of node.children) {
        if (li.tagName === 'LI') {
          result += `${i}. ${convertNode(li).trim()}\n`;
          i++;
        }
      }
      return result + '\n';
    }
    case 'li': return childText;
    case 'a': {
      const href = node.getAttribute('href') || '';
      return `[${childText}](${href})`;
    }
    case 'img': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }
    case 'hr': return '---\n\n';
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return childText;
      let result = '';
      rows.forEach((row, idx) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        result += '| ' + cells.map(c => c.textContent.trim()).join(' | ') + ' |\n';
        if (idx === 0) {
          result += '| ' + cells.map(() => '------').join(' | ') + ' |\n';
        }
      });
      return result + '\n';
    }
    case 'input': return ''; // skip checkboxes etc
    case 'div': {
      // Mermaid 图 → 保持原始代码块（无法反向还原SVG，留空）
      if (node.classList.contains('mermaid-diagram')) {
        return ''; // Mermaid 图无法反向还原，忽略
      }
      return childText;
    }
    default:
      return childText;
  }
}

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
    setEditorContent(content);
    updateFilename(file.name);
    markSaved();
    showToast(`已打开: ${file.name}`, 'success');
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
    updateFilename((await fileHandle.getFile()).name);
    markSaved();
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
        markSaved();
        showToast(`已打开: ${file.name}`, 'success');
      } else {
        showToast('请拖入 .md 或 .markdown 文件', 'error');
      }
    }
  });
}

// ==========================================
// 文件浏览器侧边栏
// ==========================================
let directoryHandle = null;
let isSidebarCollapsed = localStorage.getItem('md-sidebar-collapsed') === 'true';

async function handleOpenFolder() {
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
    await renderFileTree();
    showToast(`已打开文件夹: ${directoryHandle.name}`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('打开文件夹失败: ' + err.message, 'error');
    }
  }
}

async function readDirectoryRecursive(dirHandle, depth = 0) {
  const entries = [];
  for await (const entry of dirHandle.values()) {
    // 跳过隐藏文件和 node_modules / dist 等
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

    if (entry.kind === 'directory') {
      const children = depth < 5 ? await readDirectoryRecursive(entry, depth + 1) : [];
      entries.push({ name: entry.name, kind: 'directory', handle: entry, children });
    } else {
      entries.push({ name: entry.name, kind: 'file', handle: entry });
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
      await openFileFromTree(entry.handle, entry.name);
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

async function openFileFromTree(fileHandle, filename) {
  try {
    if (isModified) {
      if (!confirm('当前文件有未保存的更改，确定要打开新文件吗？')) return;
    }

    const file = await fileHandle.getFile();
    const content = await file.text();

    currentFileHandle = fileHandle;
    setEditorContent(content);
    updateFilename(filename);
    markSaved();
    showToast(`已打开: ${filename}`, 'success');
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
function init() {
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

  // 绑定事件
  bindEvents();

  // 初始化分屏拖拽
  initResizer();

  // 初始化预览区可编辑
  initPreviewEditing();

  // 初始化文件浏览器侧边栏
  initFileSidebar();

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
  // 在非扩展环境（dev server）中跳过
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  try {
    const result = await chrome.storage.local.get('pendingFile');
    const pendingFile = result.pendingFile;

    if (!pendingFile) return;

    // 检查时间戳，超过 30 秒的视为过期
    if (Date.now() - pendingFile.timestamp > 30000) {
      await chrome.storage.local.remove('pendingFile');
      return;
    }

    // 加载文件内容到编辑器
    setEditorContent(pendingFile.content);
    updateFilename(pendingFile.filename);
    currentFileHandle = null; // file:// 打开无法获得 FileHandle
    markSaved();
    showToast(`已打开: ${pendingFile.filename}`, 'success');

    // 清除 pending file
    await chrome.storage.local.remove('pendingFile');
  } catch (err) {
    console.warn('加载 pending file 失败:', err);
  }
}

// DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
