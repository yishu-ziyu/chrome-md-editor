// io-bridge.js — 文件读写环境分流（浏览器 / 桌面 Tauri）
//
// 设计要点：
//   1) 浏览器侧读写目标是 FileSystemFileHandle（不是路径字符串），
//      Tauri 侧是绝对路径字符串。两者差异通过「目标描述符」抽象：
//        - 浏览器：{ handle }   （File System Access API 的 FileSystemFileHandle）
//        - Tauri ：{ path }     （绝对路径字符串）
//      read/write 统一接收该描述符，调用方无需关心当前运行形态。
//   2) 沿用项目既有约定判定 Tauri：只用全局守卫，严禁 import '@tauri-apps/*'。
//   3) 分流逻辑做成可注入工厂 createIoBridge({ isTauri, invoke })，
//      便于单测在 node 环境下注入 mock，而非依赖真实 window / Tauri 运行时。
//   4) 另存为能力：pickSaveTarget(suggestedName) 选择新目标 { handle }|{ path }，
//      saveAs(target, content) 写入该新目标（语义等同 write），供 src/save-poll.js 调用。

// 是否在 Tauri 桌面壳内：沿用项目既有约定（src/compare-shims.js / src/editor.js）。
export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 从全局对象取出 Tauri 的 invoke（桌面端由 __TAURI_INTERNALS__ 暴露）。
// 浏览器侧没有该全局，返回 undefined；调用方在 Tauri 分流分支会保证它可用。
function getInvoke() {
  if (typeof window === 'undefined') return undefined;
  const internals = window.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === 'function') return internals.invoke;
  // 兼容 withGlobalTauri 开启时的 window.__TAURI__
  const g = window.__TAURI__;
  if (g && typeof g.invoke === 'function') return g.invoke;
  return undefined;
}

// 默认（真实环境）的 Tauri 判定，供工厂兜底使用。
function globalIsTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 非安全上下文降级（M4）：用隐藏 <input type=file> 让用户选文件，取文件名作为下载名。
// 返回文件名字符串；用户取消或无 DOM 环境时返回 null。不接触真实写盘。
function pickSaveTargetViaInputFallback() {
  if (typeof document === 'undefined' || !document.createElement || !document.body) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,.text';
    input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    const done = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      done(file ? file.name : null);
    }, { once: true });
    // 用户取消文件框：部分浏览器触发 cancel，部分不触发；均视为放弃。
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// 非安全上下文降级（M4）：用 Blob + 临时 <a download> 触发浏览器下载（无 FSAPI 写盘能力）。
function downloadViaAnchor(name, content) {
  if (typeof document === 'undefined' || !document.createElement || !document.body) {
    return Promise.reject(new Error('ioBridge: 当前环境无 DOM，无法触发下载'));
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'untitled.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Promise.resolve();
}

// 工厂函数：注入环境依赖，返回 { read, write, pickSaveTarget, saveAs }。
// 参数：
//   isTauri (boolean) - 是否桌面端；省略则按真实 window 守卫推断。
//   invoke  (function) - Tauri 的 invoke；省略则按真实全局对象推断。
export function createIoBridge({ isTauri: injectedTauri, invoke: injectedInvoke } = {}) {
  const envIsTauri = injectedTauri != null ? injectedTauri : globalIsTauri();
  const envInvoke = injectedInvoke != null ? injectedInvoke : getInvoke();

  // 校验目标描述符：必须为非空对象。
  function assertTarget(target) {
    if (!target || typeof target !== 'object') {
      throw new Error('ioBridge: 目标描述符无效（应为 { handle } 或 { path } 对象）');
    }
  }

  // 读取目标文本。
  //   Tauri：invoke('read_text_file', { path })
  //   浏览器：handle.getFile().text()
  function read(target) {
    assertTarget(target);
    if (envIsTauri) {
      if (!('path' in target)) {
        throw new Error('ioBridge.read: Tauri 模式目标描述符必须含 path');
      }
      if (typeof envInvoke !== 'function') {
        throw new Error('ioBridge.read: 桌面端缺少可用的 invoke');
      }
      // 桌面侧真实命令（desktop/src/lib.rs: read_text_file(path: String)）
      return envInvoke('read_text_file', { path: target.path });
    }
    // 浏览器侧：目标形如 { handle }
    if (!('handle' in target) || !target.handle) {
      throw new Error('ioBridge.read: 浏览器模式目标描述符必须含 handle');
    }
    return target.handle.getFile().then(async (file) => {
      // 编码兜底（L4）：浏览器 File.text() 永远按 UTF-8 解码，遇到非 UTF-8（如 GBK/GB2312）
      // 的 .md/.txt 会静默产生乱码并随保存固化。这里优先用原始字节做「UTF-8 严格解码」，
      // 失败（含非法字节序列）再回退常见中文编码 GBK，仍失败才宽松 UTF-8（保留替换符）返回，
      // 避免把乱码当作正常内容写回。无 arrayBuffer（旧环境/桩件）时退回 file.text()。
      if (typeof file.arrayBuffer === 'function') {
        try {
          const buf = await file.arrayBuffer();
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(buf);
          } catch (_) {
            try {
              return new TextDecoder('gbk').decode(buf);
            } catch (_) {
              return new TextDecoder('utf-8').decode(buf);
            }
          }
        } catch (_) {
          // arrayBuffer 读取失败，退回 text() 兜底
        }
      }
      return file.text();
    });
  }

  // 写入目标内容。
  //   Tauri：invoke('write_text_file', { path, content })
  //   浏览器：handle.createWritable() -> write(content) -> close()
  function write(target, content) {
    assertTarget(target);
    if (typeof content !== 'string') {
      throw new Error('ioBridge.write: content 必须为字符串');
    }
    if (envIsTauri) {
      if (!('path' in target)) {
        throw new Error('ioBridge.write: Tauri 模式目标描述符必须含 path');
      }
      if (typeof envInvoke !== 'function') {
        throw new Error('ioBridge.write: 桌面端缺少可用的 invoke');
      }
      // 桌面侧真实命令（desktop/src/lib.rs: write_text_file(path: String, content: String)）
      return envInvoke('write_text_file', { path: target.path, content });
    }
    // 浏览器侧：目标形如 { handle }
    // M4 降级描述符：{ download:true, name } —— 非安全上下文走 Blob 下载，不静默跳过。
    if (target && target.download && typeof target.name === 'string') {
      return downloadViaAnchor(target.name, content);
    }
    if (!('handle' in target) || !target.handle) {
      throw new Error('ioBridge.write: 浏览器模式目标描述符必须含 handle');
    }
    return target.handle.createWritable().then((w) =>
      w.write(content).then(() => w.close())
    );
  }

  // 选择「另存为」目标（不覆盖源文件）。
  //   浏览器：showSaveFilePicker（FSAPI，仅 https/扩展安全上下文可用），返回 { handle }
  //   Tauri ：save_file_dialog（桌面端不可用时退化为 open_save_dialog），返回 { path }
  // 返回统一的「目标描述符」{ handle } | { path }，与 read/write 约定一致。
  async function pickSaveTarget(suggestedName) {
    if (envIsTauri) {
      if (typeof envInvoke !== 'function') {
        throw new Error('ioBridge.pickSaveTarget: 桌面端缺少可用的 invoke');
      }
      const defaultPath = suggestedName || 'untitled.md';
      try {
        const path = await envInvoke('save_file_dialog', { defaultPath });
        return { path };
      } catch (firstErr) {
        // 退化为 open_save_dialog（命令名在不同桌面端发布下可能不同）
        try {
          const path = await envInvoke('open_save_dialog', { defaultPath });
          return { path };
        } catch (secondErr) {
          throw firstErr; // 抛出首个错误，保留最贴近的失败原因
        }
      }
    }
    // 浏览器侧：优先 File System Access API 的 showSaveFilePicker（仅 https/扩展安全上下文）。
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName });
        return { handle };
      } catch (pickerErr) {
        // 用户取消（AbortError）原样上抛，避免误降级；其余错误降级兜底。
        if (pickerErr && pickerErr.name === 'AbortError') throw pickerErr;
        console.warn('[io-bridge] showSaveFilePicker 失败，降级 <input type=file>：', pickerErr);
      }
    }
    // M4：非安全上下文（如 360Chromex 扩展页）无 showSaveFilePicker —— 降级为
    // <input type=file> 选文件名，返回 download 描述符，由 write 用 Blob 下载实现「另存为」。
    const fallbackName = await pickSaveTargetViaInputFallback();
    if (fallbackName) return { download: true, name: fallbackName };
    throw new Error('当前环境不支持「另存为」：缺少 showSaveFilePicker，且 <input type=file> 降级也不可用');
  }

  // 写入「另存为」选中的目标。语义上等同 write，直接复用内部 write。
  async function saveAs(target, content) {
    return write(target, content);
  }

  return { read, write, pickSaveTarget, saveAs };
}

// 默认导出：用真实环境实例化（node 下 isTauri 为 false、invoke 为 undefined，
// 不会在导入时触发任何真实 IO，单测可另行注入）。
export const ioBridge = createIoBridge();
