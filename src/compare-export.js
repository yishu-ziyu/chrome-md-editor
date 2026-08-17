// compare-export.js
// 导出合并结果（T6）。
// 三级降级策略，与 src/editor.js 的 handleSaveAs 行为保持一致：
//   1) 优先 File System Access API：showSaveFilePicker 取句柄并留存，后续写回同一文件；
//   2) 失败降级：<a download> + Blob 触发浏览器下载；
//   3) 再失败降级：navigator.clipboard 写入剪贴板。
// 句柄按「文件名」留存，避免导出 merged.md 后再导出 diff.diff 时误写回同一文件。

/**
 * @type {Map<string, FileSystemFileHandle>}
 * 文件名 -> 已授权的文件句柄，实现「句柄留存写回」（与编辑器 currentFileHandle 同思路）。
 */
const savedHandles = new Map();

/**
 * 清除已留存的句柄（可选，便于重新弹出选择器）。
 * @param {string} [filename] 不传则清空全部。
 */
export function resetExportHandle(filename) {
  if (filename) savedHandles.delete(filename);
  else savedHandles.clear();
}

/**
 * 导出文本内容到文件。
 * @param {string} content 要写出的文本（如合并结果 / diff 报告）。
 * @param {string} [filename="merged.md"] 建议文件名；已留存的同名句柄将直接写回。
 * @returns {Promise<void>}
 */
export async function exportResult(content, filename = "merged.md") {
  // 桌面端（Tauri）：委派到 compare-shims.js，走 Rust 命令 save_compare_result
  const { isTauriEnv, saveFile } = await import("./compare-shims.js");
  if (isTauriEnv()) return saveFile(filename, content);
  // 1) 优先：File System Access API（句柄留存写回）
  if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    try {
      let handle = savedHandles.get(filename);
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "Markdown 文件", accept: { "text/markdown": [".md"] } }],
        });
        savedHandles.set(filename, handle);
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err) {
      // 用户主动取消选择器：不静默下载，直接返回。
      if (err && err.name === "AbortError") return;
      // 其他错误（权限被拒 / 不支持等）降级到 Blob 方式，并丢弃失效句柄。
      savedHandles.delete(filename);
    }
  }

  // 2) 降级：<a download> + Blob
  try {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    // 延迟移除元素与回收 URL，确保下载已发起（Firefox 同步移除会导致下载失败）。
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    return;
  } catch (_) {
    // 继续降级到剪贴板
  }

  // 3) 最终降级：剪贴板
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(content);
  }
}
