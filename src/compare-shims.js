// compare-shims.js
// ---------------------------------------------------------------------------
// 对比合并模块（compare/*）专用的「浏览器 / 桌面」文件读写垫片。
//
// 让 compare 页在两种形态下都能「选择多文件 / 按路径读 / 按路径写结果」，
// 且对调用方（UI-A 等整合 Agent）提供统一签名，无需关心当前运行形态：
//
//   - Chrome 扩展 / 普通浏览器：走 <input type=file multiple> + File.text()
//     与 File System Access API（showSaveFilePicker），无后端依赖。
//   - Tauri 桌面壳（window.__TAURI_INTERNALS__ 存在）：走 Rust 命令
//       read_multiple_text_files / save_compare_result（std::fs，绕开 fs scope）。
//
// 导出（供 compare 模块 import）：
//   pickFiles(accept?)        -> Promise<CompareFile[]>   // { name, content, target }[]
//     target 为「回写目标描述符」，交给 compare/io-bridge.js 的 write(target, content)：
//       桌面（Tauri）：{ path: string }   —— 由 Rust 返回的绝对路径原样保留
//       浏览器：        null              —— <input type=file> 拿不到句柄，无法原地回写
//   readFile(path)            -> Promise<string>
//   saveFile(path, content)   -> Promise<void>
//
// 说明：本文件不创建任何 DOM 元素类名，故不触碰验收闸门禁用类名清单
//       （btnCenterBold / btnCenterBoldRed / styleGroup）。
//
// 命名说明：项目已存在 src/desktop-shims.js（编辑器 FS Access 垫片，IIFE、
// 无导出），为避免覆盖破坏编辑器功能，本文件独立命名 compare-shims.js。
// ---------------------------------------------------------------------------

// 判定是否运行在 Tauri 桌面壳内。统一复用 src/tauri-env.js 的实现，
// 保证与 desktop-shims.js（编辑器垫片）口径一致，避免双端判定分歧。
export { isTauriEnv } from "./tauri-env.js";

// 延迟加载 Tauri API（仅桌面端调用，浏览器端永不触发 import，避免打包报错）。
let _tauri = null;
async function getTauri() {
  if (_tauri) return _tauri;
  const dialogMod = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  _tauri = { dialog: dialogMod, invoke };
  return _tauri;
}

// 从 accept 字符串（".md,.txt"）提取扩展名数组（去点），喂给 dialog 过滤器。
function acceptToExtensions(accept) {
  return (accept || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith(".") ? e.slice(1) : e));
}

// 按目标路径后缀挑选桌面保存对话框的过滤器。
// 导出 diff 报告时默认文件名为 diff.diff，若仍用 Markdown 过滤器，用户在保存框里
// 看不到 .diff 文件、也无法保持后缀，故单独给 diff/patch 一组过滤器。
function saveFiltersForPath(path) {
  const lower = (path || "").toLowerCase();
  if (lower.endsWith(".diff") || lower.endsWith(".patch")) {
    return [{ name: "Diff / Patch", extensions: ["diff", "patch"] }];
  }
  return [{ name: "Markdown / Text", extensions: ["md", "markdown", "txt"] }];
}

// 浏览器端：隐藏 <input type=file multiple> 选取并读取全部文本。
function browserPickFiles(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (accept) input.accept = accept;
    input.onchange = async () => {
      try {
        const files = Array.from(input.files || []);
        const out = await Promise.all(
          // <input type=file> 拿不到 FileSystemFileHandle，故 target 恒为 null；
          // 字段仍然存在，避免调用方同时面对 undefined 与 null 两种缺失形态。
          files.map(async (f) => ({
            name: f.name,
            content: await f.text(),
            target: null,
          }))
        );
        resolve(out);
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => reject(new DOMException("用户取消", "AbortError"));
    input.click();
  });
}

// 浏览器端：按路径语义读取一个文件（浏览器无绝对路径，转为交互选取）。
async function browserReadFile() {
  if (typeof window !== "undefined" && window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker();
    const file = await handle.getFile();
    return file.text();
  }
  const f = await new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => resolve(input.files && input.files[0]);
    input.oncancel = () => reject(new DOMException("用户取消", "AbortError"));
    input.click();
  });
  if (!f) throw new DOMException("用户取消", "AbortError");
  return f.text();
}

// 浏览器端：保存结果（优先 File System Access，降级为 <a download>）。
async function browserSaveFile(path, content) {
  const name = (path || "merged.md").split(/[\\/]/).pop();
  if (typeof window !== "undefined" && window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({ suggestedName: name });
    const w = await handle.createWritable();
    await w.write(content);
    await w.close();
    return;
  }
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Firefox 等浏览器的 <a download> 下载是异步的：a.click() 后立即 revoke
  // 会让浏览器拿到已失效的 blob URL，导致下载静默失败。与 compare-export.js
  // 保持一致，延迟回收（1000ms 足够覆盖大多数浏览器的异步下载落地）。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===========================================================================
// 导出 API
// ===========================================================================

// 选择多个文件，返回 CompareFile[]（契约数据结构：{ name, content }）。
export async function pickFiles(
  accept = ".md,.markdown,.mdown,.mkd,.mkdn,.txt",
  multiple = true
) {
  if (isTauriEnv()) {
    const { dialog, invoke } = await getTauri();
    const selected = await dialog.open({
      multiple,
      filters: [
        { name: "Markdown / Text", extensions: acceptToExtensions(accept) },
      ],
    });
    if (!selected) throw new DOMException("用户取消", "AbortError");
    const paths = Array.isArray(selected) ? selected : [selected];
    // 批量读走 Rust 命令，绕开 fs scope；返回 FileReadResult 数组：
    //   { path, content: Option<String>, error: Option<String> }
    // 逐文件容错：成功的转 CompareFile，失败的 console.warn 收集。
    const results = await invoke("read_multiple_text_files", { paths });
    const out = [];
    const failed = [];
    for (const r of results || []) {
      if (r.content != null) {
        out.push({
          name: r.path.split(/[\\/]/).pop() || r.path,
          content: r.content,
          // 保留磁盘绝对路径，供 io-bridge 的 write(target, content) 原地回写
          target: { path: r.path },
        });
      } else {
        failed.push(r.path);
        console.warn(`[compare-shims] 读取失败 ${r.path}: ${r.error || "未知错误"}`);
      }
    }
    if (failed.length) {
      console.warn(`[compare-shims] 共 ${failed.length} 个文件读取失败: ${failed.join(", ")}`);
    }
    return out;
  }
  return browserPickFiles(accept);
}

// 按绝对路径（桌面）或交互选取（浏览器）读取单个文件，返回文本内容。
export async function readFile(path) {
  if (isTauriEnv()) {
    const { invoke } = await getTauri();
    const results = await invoke("read_multiple_text_files", { paths: [path] });
    if (!results || !results.length) throw new Error("读取失败：" + path);
    const r = results[0];
    if (r.content == null) {
      throw new Error(`读取失败 ${path}: ${r.error || "未知错误"}`);
    }
    return r.content;
  }
  return browserReadFile();
}

// 按绝对路径（桌面）或交互保存（浏览器）写入结果内容。
export async function saveFile(path, content) {
  if (isTauriEnv()) {
    const { dialog, invoke } = await getTauri();
    const savePath = await dialog.save({
      defaultPath: path || "merged.md",
      filters: saveFiltersForPath(path),
    });
    if (!savePath) throw new DOMException("用户取消", "AbortError");
    await invoke("save_compare_result", { path: savePath, content });
    return;
  }
  return browserSaveFile(path, content);
}
