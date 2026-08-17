// compare-images.js — 图片上传区（T5）
//
// 契约导出（严格匹配签名）：
//   insertImagesAtCursor(files: File[], getCursor: () => number): Promise<void>
//
// 复用（零改写，见 src/image-support.js）：
//   - buildPastedImageMarkdown({ alt, imagePath }) => "![alt](imagePath)"
//   - createPastedImageFilename({ extension })            => pasted-<stamp>-<suffix>.<ext>
//   - mimeTypeToExtension(type)                           => jpg/gif/webp/svg/png
// 图片统一转为内嵌 data URL（与 editor.js 的 persistPastedImage 回退分支行为一致），
// 再在 getCursor() 返回的光标位置插入 Markdown 图片语法。
//
// 禁用类名闸门：
//   禁止使用 btnCenterBold / btnCenterBoldRed / styleGroup。
//   本文件统一使用 compare-dropzone / compare-fileinput / compare-filebtn 等新类名。
//
// 插入目标：需要某个 CodeMirror EditorView 才能落字。UI-A 在创建 MergeView（两栏/三栏）后，
// 通过 bindCompareEditorView(view) 注册「当前活动编辑器」；若未注册，则降级派发
// CustomEvent('compare-image-insert', { detail: { pos, markdown } }) 交由宿主页面处理。

import {
  buildPastedImageMarkdown,
  createPastedImageFilename,
  mimeTypeToExtension,
} from './image-support.js';

// 模块级插入目标：由 UI-A 注册当前活动编辑器视图。
let activeEditorView = null;

/**
 * 注册当前活动编辑器视图（两栏/三栏的可编辑面板）。
 * @param {import('@codemirror/view').EditorView | null} view
 */
export function bindCompareEditorView(view) {
  activeEditorView = view;
}

/** 解绑当前活动编辑器视图。 */
export function unbindCompareEditorView() {
  activeEditorView = null;
}

/** File/Blob → data URL（FileReader 封装）。 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片为 data URL 失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 把 Markdown 图片语法插入到编辑器视图的光标位置。
 * 含空行分隔逻辑，与 editor.js 的 insertMarkdownSnippet 行为一致。
 * @param {import('@codemirror/view').EditorView|null} view
 * @param {number} pos 插入位置（文档坐标）
 * @param {string} markdown 要插入的 Markdown
 */
function insertMarkdownAt(view, pos, markdown) {
  if (!view || !view.state || typeof view.dispatch !== 'function') {
    // 兜底：宿主页面自行处理（如对比上下文尚未绑定编辑器）
    document.dispatchEvent(
      new CustomEvent('compare-image-insert', { detail: { pos, markdown } })
    );
    return;
  }
  const doc = view.state.doc;
  const clamped = Math.max(0, Math.min(Number.isFinite(pos) ? pos : doc.length, doc.length));
  const beforeChar = clamped > 0 ? doc.sliceString(clamped - 1, clamped) : '';
  const afterChar = clamped < doc.length ? doc.sliceString(clamped, clamped + 1) : '';

  let insert = markdown;
  if (beforeChar && beforeChar !== '\n') insert = '\n' + insert;
  if (afterChar && afterChar !== '\n') insert = insert + '\n';

  const anchor = clamped + insert.length;
  view.dispatch({
    changes: { from: clamped, to: clamped, insert },
    selection: { anchor, head: anchor },
  });
  view.focus();
}

/**
 * 契约函数：把一组图片文件转 data URL 并插入到 getCursor() 指定的光标位置。
 * @param {File[]} files 用户选择的图片文件（非图片会被忽略）
 * @param {() => number} getCursor 返回当前光标位置（文档坐标）的函数
 * @returns {Promise<void>}
 */
export async function insertImagesAtCursor(files, getCursor) {
  const imageFiles = Array.from(files || []).filter(
    (f) => f && f.type && f.type.startsWith('image/')
  );
  if (imageFiles.length === 0) return;

  const cursorPos = typeof getCursor === 'function' ? Number(getCursor()) : 0;

  const snippets = [];
  for (const file of imageFiles) {
    const ext = mimeTypeToExtension(file.type);
    const filename = createPastedImageFilename({ extension: ext });
    const dataUrl = await blobToDataUrl(file);
    snippets.push(buildPastedImageMarkdown({ alt: file.name || filename, imagePath: dataUrl }));
  }

  const markdown = snippets.join('\n\n');
  insertMarkdownAt(activeEditorView, cursorPos, markdown);
}

/**
 * UI 工厂：生成一个图片拖拽区（规范类名 compare-dropzone）。
 * 支持点击选择 / 拖拽放入，内部调用 insertImagesAtCursor。
 * @param {object} [opts]
 * @param {() => number} [opts.getCursor] 返回插入位置的光标函数
 * @param {() => void} [opts.onInserted] 插入完成回调
 * @param {string} [opts.label='拖拽图片到此处，或点击选择']
 * @returns {HTMLDivElement}
 */
export function createImageUploadArea({
  getCursor,
  onInserted,
  label = '拖拽图片到此处，或点击选择',
} = {}) {
  const resolveCursor = typeof getCursor === 'function' ? getCursor : () => 0;

  const zone = document.createElement('div');
  zone.className = 'compare-dropzone';
  zone.setAttribute('role', 'button');
  zone.tabIndex = 0;
  zone.setAttribute('aria-label', label);

  const hint = document.createElement('span');
  hint.className = 'compare-dropzone-hint';
  hint.textContent = label;
  zone.appendChild(hint);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.className = 'compare-fileinput';
  input.hidden = true;
  zone.appendChild(input);

  const handleFiles = async (fileList) => {
    await insertImagesAtCursor(Array.from(fileList || []), resolveCursor);
    input.value = '';
    if (typeof onInserted === 'function') onInserted();
  };

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', async () => {
    await handleFiles(input.files);
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('compare-dropzone-dragover');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('compare-dropzone-dragover');
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('compare-dropzone-dragover');
    const dt = e.dataTransfer;
    if (dt) await handleFiles(dt.files);
  });

  return zone;
}

/**
 * UI 便捷绑定：把现有工具栏「图片」按钮（如 #btnAddImages）接到图片选择器。
 * @param {HTMLButtonElement|null} button
 * @param {object} [opts]
 * @param {() => number} [opts.getCursor]
 * @param {() => void} [opts.onInserted]
 */
export function bindImageToolbarButton(button, { getCursor, onInserted } = {}) {
  if (!button) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    await insertImagesAtCursor(
      Array.from(input.files || []),
      typeof getCursor === 'function' ? getCursor : () => 0
    );
    input.value = '';
    if (typeof onInserted === 'function') onInserted();
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 对接提示（给 UI-A / compare.js 整合用）：
//
// 1) 在创建好 MergeView（两栏/三栏）后，
//    注册活动编辑器，使 insertImagesAtCursor 知道往哪插：
//      import { bindCompareEditorView } from './compare-images.js';
//      bindCompareEditorView(resultPaneView);
//
// 2) 工具栏「图片」按钮（#btnAddImages）：
//      import { bindImageToolbarButton } from './compare-images.js';
//      bindImageToolbarButton(document.getElementById('btnAddImages'), {
//        getCursor: () => <当前活动视图>.state.selection.main.head,
//      });
//
// 3) 拖拽区（#compareImageDrop 占位元素）替换为真实拖拽区：
//      import { createImageUploadArea } from './compare-images.js';
//      const area = createImageUploadArea({
//        getCursor: () => <活动视图>.state.selection.main.head,
//      });
//      window.__compareMount.imageDrop.replaceWith(area);
//
// 4) getCursor 返回的是文档坐标（CodeMirror 用 view.state.selection.main.head），
//    与「插入到当前对比块」一致：光标落在哪块，图片就插到哪块。
// ───────────────────────────────────────────────────────────────────────────
