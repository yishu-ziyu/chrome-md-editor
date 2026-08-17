// 统一的文件「打开 / 保存」选择器，带 File System Access API → <input type=file> / 下载 降级。
// 与 compare-files.js 的降级策略对齐（同一检测条件、同一降级手段），消除 editor 模块
// 与 compare 模块在「打开/保存」能力上的内部不一致（原 editor 模块裸调 window.show*
// Picker 且无降级，非 Chromium 环境会静默失败）。

const MD_OPEN_TYPES = [{
  description: 'Markdown 文件',
  accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mkdn'] },
}];

const MD_SAVE_TYPES = [{
  description: 'Markdown 文件',
  accept: { 'text/markdown': ['.md'] },
}];

/**
 * 打开文件。优先走 File System Access API（可留存句柄用于原地回写）；
 * 不可用（非 Chromium / 沙箱上下文）时降级到 <input type=file>。
 * @returns {Promise<{handle: FileSystemFileHandle|null, file: File|null}>}
 *   handle 存在表示走 API 路径；file 存在表示降级路径（无持久句柄）。
 */
export async function openFileViaPicker() {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: MD_OPEN_TYPES,
        multiple: false,
      });
      return { handle, file: null };
    } catch (err) {
      // 用户取消（AbortError）原样上抛：调用方已忽略，若在此降级会再弹一个选择框。
      if (err && err.name === 'AbortError') throw err;
      // 其余错误（如 MV3 沙箱 SecurityError）才降级到 <input type=file>。
      console.warn('[file-picker] showOpenFilePicker 不可用，降级 <input type=file>:', err);
    }
  }

  const file = await pickFileViaInput('.md,.markdown,.mdown,.mkd,.mkdn,text/markdown');
  return { handle: null, file };
}

/**
 * 保存文件。优先走 File System Access API（原地回写）；不可用则降级为
 * Blob + <a download> 触发浏览器下载（Web 标准「另存为」兜底）。
 * @param {string} suggestedName 建议文件名
 * @param {string} content 文件内容
 * @returns {Promise<{handle: FileSystemFileHandle|null}>}
 *   handle 为 null 表示走了下载降级（无法自动覆盖原文件）。
 */
export async function saveViaPickerOrDownload(suggestedName, content) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName || 'untitled.md',
        types: MD_SAVE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { handle };
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      console.warn('[file-picker] showSaveFilePicker 不可用，降级下载:', err);
    }
  }

  downloadAsFile(suggestedName || 'untitled.md', content);
  return { handle: null };
}

function pickFileViaInput(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) {
        reject(new DOMException('未选择文件', 'AbortError'));
        return;
      }
      resolve(f);
    }, { once: true });
    // 用户取消文件选择框时 reject，避免 Promise 永不 settle。
    input.oncancel = () => reject(new DOMException('用户取消', 'AbortError'));
    input.click();
  });
}

function downloadAsFile(name, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
