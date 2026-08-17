// compare-files.js — 文件多选 + 拖拽上传（T3）
//
// 契约导出：
//   - pickFiles(accept?: string) => Promise<CompareFile[]>
//     CompareFile = { name: string; content: string; target: SaveTarget|null }
//     target 是「回写目标描述符」，交给 compare/io-bridge.js 的 write(target, content)
//     用于 Ctrl+S 把当前栏写回它的源文件；共三种形态：
//       { path: string }                     桌面（Tauri）：Rust 返回的绝对路径
//       { handle: FileSystemFileHandle }     浏览器且支持 File System Access API
//       null                                 <input type=file> / 拖拽：拿不到句柄，
//                                            调用方应降级为「另存为」
//
// 复用模式：沿用 editor.js 现有的「<input type="file" multiple> + File.text()」读取方式，
// 并额外提供拖拽区 / 按钮工厂，供 UI-A（compare.js）直接挂载到 compare.html。
//
// 禁用类名闸门：
//   禁止使用 btnCenterBold / btnCenterBoldRed / styleGroup。
//   本文件统一使用 compare-filebtn / compare-dropzone 等新类名。
//
// 注意：本文件只负责「读取文件 → CompareFile[]」与 UI 工厂，不负责把内容喂给视图；
// 喂给多视图由 UI-A 调用方处理（参见文件末尾的对接提示）。

import { isTauriEnv } from "./compare-shims.js";

const DEFAULT_ACCEPT = '.md,.markdown,.mdown,.mkd,.mkdn,.txt';

/**
 * 读取一批 File 为 CompareFile[]（{name, content, target}）。
 * content 通过 File.text() 同步读取为字符串（Markdown / 纯文本）。
 * 裸 File 对象（拖拽 / <input type=file>）不携带 FileSystemFileHandle，
 * 故 target 恒为 null —— 字段仍然存在，避免调用方同时面对 undefined 与 null。
 * @param {FileList|File[]|ArrayLike<File>} fileList
 * @returns {Promise<{name:string, content:string, target:null}[]>}
 */
export async function readCompareFiles(fileList) {
  const files = Array.from(fileList || []);
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      content: await file.text(),
      target: null,
    }))
  );
}

/**
 * 把 accept 串（".md,.txt"）编译为 showOpenFilePicker 的 types 参数。
 * 只取以点开头的后缀规则；无可用后缀时返回 undefined（表示不限类型）。
 * @param {string} [accept]
 * @returns {{description:string, accept:Record<string,string[]>}[]|undefined}
 */
function acceptToPickerTypes(accept) {
  const exts = (accept || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.startsWith('.'));
  if (!exts.length) return undefined;
  return [{ description: 'Markdown / 文本', accept: { 'text/plain': exts } }];
}

/**
 * 弹出系统文件选择框，多选文件，返回 CompareFile[]。
 * 浏览器端优先走 File System Access API，以便拿到 FileSystemFileHandle 作为
 * 回写 target（Ctrl+S 原地保存的前提）；不可用时降级 <input type=file>，target 为 null。
 * @param {string} [accept] 形如 ".md,.txt" 的 accept 过滤串；省略则默认 Markdown/文本。
 * @returns {Promise<{name:string, content:string, target:object|null}[]>}
 */
export async function pickFiles(accept = DEFAULT_ACCEPT, multiple = true) {
  // 桌面端（Tauri）：委派到 compare-shims.js，走 Rust 命令 read_multiple_text_files
  if (isTauriEnv()) {
    const { pickFiles: shimPick } = await import("./compare-shims.js");
    return shimPick(accept, multiple);
  }

  // 浏览器优先分支：File System Access API，可留存句柄用于原地回写。
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        types: acceptToPickerTypes(accept),
        writable: true,
      });
      const handleList = Array.isArray(handles) ? handles : [handles];
      return await Promise.all(
        handleList.map(async (h) => {
          const file = await h.getFile();
          return { name: file.name, content: await file.text(), target: { handle: h } };
        })
      );
    } catch (err) {
      // 用户取消（AbortError）原样上抛：调用方已忽略它，若在此降级会再弹一个选择框。
      if (err && err.name === 'AbortError') throw err;
      // 其余错误（如 MV3 沙箱上下文的 SecurityError）才降级到 <input type=file>。
      console.warn('[compare-files] showOpenFilePicker 不可用，降级 <input type=file>:', err);
    }
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = multiple;
  if (accept) input.accept = accept;

  return new Promise((resolve, reject) => {
    input.addEventListener(
      'change',
      async () => {
        const result = await readCompareFiles(input.files);
        resolve(result);
      },
      { once: true }
    );
    // 用户取消文件选择框时 reject，避免 Promise 永不 settle。
    input.oncancel = () => reject(new DOMException('用户取消', 'AbortError'));
    input.click();
  });
}

/**
 * 弹出系统文件选择框，单选一个文件，返回单个 CompareFile（或 null）。
 * 用于「对比/合并」界面「选择文件」按钮：把文件载入当前鼠标激活栏。
 * @param {string} [accept]
 * @returns {Promise<{name:string, content:string, target:object|null}|null>}
 */
export async function pickSingleFile(accept = DEFAULT_ACCEPT) {
  const files = await pickFiles(accept, false);
  return files && files.length ? files[0] : null;
}

/**
 * 把 accept 串编译为文件名后缀 / MIME 通配匹配函数，供拖拽区过滤用。
 * @param {string} [accept]
 * @returns {(file: File) => boolean}
 */
function makeAcceptor(accept) {
  if (!accept) return () => true;
  const rules = accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return (file) => {
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return rules.some((rule) => {
      if (rule.includes('*')) {
        const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
        return re.test(type) || re.test(name);
      }
      if (rule.startsWith('.')) return name.endsWith(rule);
      return type.includes(rule);
    });
  };
}

/**
 * UI 工厂：生成一个「选择文件」按钮（规范类名 compare-filebtn）。
 * @param {object} [opts]
 * @param {string} [opts.label='选择文件']
 * @param {string} [opts.accept]
 * @param {(files:{name:string,content:string,target:object|null}[]) => void} [opts.onPick]
 * @param {string} [opts.className='compare-filebtn']
 * @returns {HTMLButtonElement}
 */
export function createFilePickerButton({
  label = '选择文件',
  accept,
  onPick,
  className = 'compare-filebtn',
} = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    try {
      const files = await pickFiles(accept);
      if (files.length && typeof onPick === 'function') onPick(files);
    } catch (err) {
      console.error('[compare-files] 选择文件失败:', err);
    }
  });
  return btn;
}

/**
 * UI 工厂：把任意元素变为文件拖拽区（dragover/drop 读取 File）。
 * 拖入的文件经 accept 过滤后，以 CompareFile[] 形式交给 onFiles。
 * 拖拽拿不到 FileSystemFileHandle，故这些 CompareFile 的 target 恒为 null。
 * @param {HTMLElement} element 作为拖拽区的 DOM 元素
 * @param {object} [opts]
 * @param {string} [opts.accept]
 * @param {boolean} [opts.multiple=true]
 * @param {(files:{name:string,content:string,target:null}[]) => void} [opts.onFiles]
 * @returns {() => void} 解绑函数（移除监听器）
 */
export function enableFileDropZone(element, { accept, multiple = true, onFiles } = {}) {
  if (!element) return () => {};
  const acceptFn = makeAcceptor(accept);

  const onDragOver = (e) => {
    e.preventDefault();
    element.classList.add('compare-dropzone-dragover');
  };
  const onDragLeave = () => {
    element.classList.remove('compare-dropzone-dragover');
  };
  const onDrop = async (e) => {
    e.preventDefault();
    element.classList.remove('compare-dropzone-dragover');
    const dt = e.dataTransfer;
    if (!dt) return;
    const all = Array.from(dt.files || []);
    const filtered = accept ? all.filter(acceptFn) : all;
    const files = await readCompareFiles(filtered);
    if (files.length && typeof onFiles === 'function') onFiles(files);
  };

  element.addEventListener('dragover', onDragOver);
  element.addEventListener('dragleave', onDragLeave);
  element.addEventListener('drop', onDrop);
  return () => {
    element.removeEventListener('dragover', onDragOver);
    element.removeEventListener('dragleave', onDragLeave);
    element.removeEventListener('drop', onDrop);
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 对接提示（给 UI-A / compare.js 整合用）：
//
// 1) 工具栏「选择文件」按钮（#btnPickFiles）：
//      import { pickFiles } from './compare-files.js';
//      btnPickFiles.addEventListener('click', async () => {
//        const files = await pickFiles();           // CompareFile[]
//        // 取 files[0] 给 Yours(A) 槽、files[1] 给 Theirs(B) 槽，再渲染 MergeView
//      });
//
// 2) 文件拖拽：把 compare.html 的 #compareFiles 或 window.__compareMount.root 设为拖拽区：
//      import { enableFileDropZone } from './compare-files.js';
//      enableFileDropZone(window.__compareMount.root, {
//        accept: '.md,.txt',
//        onFiles: (files) => { /* files: CompareFile[] → 喂给多视图 */ },
//      });
//
// 3) CompareFile[] 即 { name, content, target }，其 content 直接对应
//    createCompareMergeView 的 oldContent/newContent（A=Yours, B=Theirs）。
//
// 4) target 是「回写目标描述符」，务必随文件一起存进对应栏的 pane 状态
//    （panes[pane].target），compare/save.js 的 saveActivePane 会取它交给
//    compare/io-bridge.js 的 write(target, content) 实现 Ctrl+S 原地保存。
//    三种形态与降级策略：
//      { path }    桌面（Tauri）    → invoke('write_text_file', { path, content })
//      { handle }  浏览器 + FSAPI   → handle.createWritable() 写回原文件
//      null        input / 拖拽     → saveActivePane 返回 { saved:false,
//                                     reason:'no-target' }，UI 应降级为「另存为」
// ───────────────────────────────────────────────────────────────────────────
