// desktop-shims.js
// ---------------------------------------------------------------------------
// 兼容垫片：让同一套 Web 源码（src/editor.* 等）既能在 Chrome 扩展运行，
// 也能在 Tauri 桌面壳里运行。

// 与 compare-shims.js（对比合并垫片）共用同一 Tauri 环境判定，避免双端口径分歧。
import { isTauriEnv } from "./tauri-env.js";
//
// 判定逻辑：
//   - 在 Chrome 扩展中：window.chrome 与 window.showOpenFilePicker 均原生存在
//     → 两段垫片全部跳过，对扩展零影响。
//   - 在 Tauri 桌面壳中：window.__TAURI_INTERNALS__ 存在 → 一律安装
//     File System Access API 垫片（覆盖 showOpenFilePicker / __tauriFileHandle 等）。
//     注意：Tauri v2 WebView2 里 window.showOpenFilePicker 是「原生函数」但在
//     沙箱 webview 中并不可用；若按「不存在才装」判断会被跳过，导致
//     __tauriFileHandle 工厂缺失、双击/拖入 .md 静默失败。故 Tauri 下无条件安装。
// ---------------------------------------------------------------------------
(function () {
  if (typeof window === "undefined") return;

  // 与原生 `window.__TAURI_INTERNALS__ in window` 判定不同：改为复用共享的
  // isTauriEnv()，兼容 window.isTauri / window.__TAURI__ 写法，且与
  // compare-shims.js 判定口径统一（详见 src/tauri-env.js）。
  const isTauri = isTauriEnv();

  // =========================================================================
  // 1. chrome 垫片
  //    作用：让 session-restore（恢复上次文件）、translate（翻译设置持久化）
  //          在桌面端也能正常工作。扩展里 chrome 已存在 → 跳过。
  // =========================================================================
  // 判定改为「能力检测」而非「chrome 是否存在」：
  // Tauri v2 的 WebView2 会注入一个只含 chrome.webview 的全局 chrome 对象，
  // 原先 `typeof chrome === "undefined"` 会误判为「已有 chrome」直接跳过垫片，
  // 导致桌面端 chrome.storage 缺失 —— 会话恢复与翻译设置持久化静默失效。
  // 同时绝不整体覆盖既有 chrome 对象（那会抹掉 chrome.webview，破坏 Tauri IPC），
  // 只补齐缺失字段。Chrome 扩展中 chrome.storage.local 原生存在 → 整块跳过，零影响。
  const existingChrome = typeof chrome !== "undefined" && chrome ? chrome : null;
  const needsChromeShim =
    !existingChrome || !existingChrome.storage || !existingChrome.storage.local;
  if (needsChromeShim) {
    const PREFIX = "chrome-shim:";
    const makeArea = () => ({
      async get(key) {
        if (typeof key === "string") {
          const v = localStorage.getItem(PREFIX + key);
          return v == null ? {} : { [key]: JSON.parse(v) };
        }
        if (Array.isArray(key)) {
          const out = {};
          for (const k of key) {
            const v = localStorage.getItem(PREFIX + k);
            if (v != null) out[k] = JSON.parse(v);
          }
          return out;
        }
        if (key && typeof key === "object") {
          const out = {};
          for (const k of Object.keys(key)) {
            const v = localStorage.getItem(PREFIX + k);
            out[k] = v == null ? key[k] : JSON.parse(v);
          }
          return out;
        }
        return {};
      },
      async set(items) {
        for (const k of Object.keys(items)) {
          localStorage.setItem(PREFIX + k, JSON.stringify(items[k]));
        }
      },
      async remove(key) {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) localStorage.removeItem(PREFIX + k);
      },
      async clear() {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) toRemove.push(k);
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
      },
    });
    const shim = {
      storage: { local: makeArea(), sync: makeArea() },
      runtime: {
        id: "",
        getURL: (p) => p,
        sendMessage: async () => undefined,
        onMessage: { addListener() {} },
      },
      tabs: {
        create: async (opts) =>
          window.open(opts && opts.url, "_blank", "noopener,noreferrer"),
      },
    };

    if (!existingChrome) {
      window.chrome = shim;
    } else {
      // 逐字段补齐，保住 WebView2 注入的 chrome.webview 等既有能力
      try {
        if (!existingChrome.storage || !existingChrome.storage.local) {
          existingChrome.storage = shim.storage;
        }
        if (!existingChrome.runtime) existingChrome.runtime = shim.runtime;
        if (!existingChrome.tabs) existingChrome.tabs = shim.tabs;
      } catch (e) {
        // 既有 chrome 对象被冻结/只读时，合并出一个新对象覆盖，仍保留原有字段
        window.chrome = Object.assign({}, existingChrome, shim);
      }
    }
  }

  // =========================================================================
  // 2. File System Access API 垫片（Tauri 后端）
  //    编辑器使用：showOpenFilePicker / showSaveFilePicker / showDirectoryPicker
  //    以及 FileSystemFileHandle(.getFile/.createWritable) 与
  //    FileSystemDirectoryHandle(.getFileHandle/.getDirectoryHandle/.values)。
  // =========================================================================
  if (isTauri) {
    const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+/g, "/");
    const joinPath = (base, name) => {
      const b = norm(base).replace(/\/$/, "");
      return `${b}/${name}`;
    };
    const toFilters = (types) => {
      if (!types || !types[0] || !types[0].accept) return undefined;
      const exts = [];
      for (const mime of Object.keys(types[0].accept)) {
        for (const e of types[0].accept[mime] || []) {
          exts.push(e.startsWith(".") ? e : "." + e);
        }
      }
      return exts.length ? [{ name: types[0].description || "All Files", extensions: exts }] : undefined;
    };

    // 延迟加载 Tauri 插件 / API（仅桌面端执行，扩展端永不触发）
    // - dialog：选取文件/目录（返回路径字符串），不受 fs scope 限制
    // - fs：仅用于目录操作（TDirHandle 的 readDir/mkdir/exists）
    // - invoke：调用 Rust 命令做「按绝对路径的文本读写」，绕开 fs scope 限制
    const setup = (async () => {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const fs = await import("@tauri-apps/plugin-fs");
      const { invoke } = await import("@tauri-apps/api/core");
      return { dialog, fs, invoke };
    })();

    class TFileHandle {
      constructor(path) {
        this.path = norm(path);
        this.name = this.path.split("/").pop() || "untitled";
      }
      async getFile() {
        // 文本读取改走 Rust 命令，避免 fs 插件 scope 拒绝绝对路径
        const { invoke } = await setup;
        const text = await invoke("read_text_file", { path: this.path });
        const enc = new TextEncoder();
        return {
          name: this.name,
          size: text.length,
          type: "",
          text: async () => text,
          arrayBuffer: async () => enc.encode(text).buffer,
        };
      }
      async createWritable() {
        const self = this;
        return {
          write: async (content) => {
            const { invoke } = await setup;
            if (typeof content === "string") {
              await invoke("write_text_file", { path: self.path, content });
              return;
            }

            // 归一化为字节数组
            let u8;
            if (content instanceof Uint8Array) u8 = content;
            else if (content instanceof ArrayBuffer) u8 = new Uint8Array(content);
            else if (content && typeof content.arrayBuffer === "function")
              u8 = new Uint8Array(await content.arrayBuffer());
            else u8 = new Uint8Array(content);

            // 原实现无条件 TextDecoder().decode(u8) 转字符串再走 write_text_file，
            // 非 UTF-8 字节会被替换成 U+FFFD —— 粘贴图片（editor.js 直接
            // writable.write(File)）落盘后必定损坏且不可恢复。
            // 这里用严格模式试解码：能无损还原为文本才走文本通道，
            // 否则走 write_binary_file 按原始字节写入。
            let text = null;
            try {
              text = new TextDecoder("utf-8", { fatal: true }).decode(u8);
            } catch (e) {
              text = null;
            }

            if (text !== null) {
              await invoke("write_text_file", { path: self.path, content: text });
            } else {
              await invoke("write_binary_file", {
                path: self.path,
                content: Array.from(u8),
              });
            }
          },
          close: async () => {},
        };
      }
    }

    class TDirHandle {
      constructor(path) {
        this.path = norm(path);
        this.name = this.path.split("/").pop() || "/";
      }
      async getFileHandle(name) {
        return new TFileHandle(joinPath(this.path, name));
      }
      async getDirectoryHandle(name, opts = {}) {
        const p = joinPath(this.path, name);
        const { fs } = await setup;
        if (opts.create && !(await fs.exists(p))) {
          await fs.mkdir(p, { recursive: true });
        }
        return new TDirHandle(p);
      }
      async * values() {
        const { fs } = await setup;
        const entries = await fs.readDir(this.path);
        for (const e of entries) {
          const child = e.isDirectory
            ? new TDirHandle(joinPath(this.path, e.name))
            : new TFileHandle(joinPath(this.path, e.name));
          Object.assign(child, { name: e.name, kind: e.isDirectory ? "directory" : "file" });
          yield child;
        }
      }
      async * entries() {
        for await (const v of this.values()) yield [v.name, v];
      }
    }

    window.showOpenFilePicker = async (opts = {}) => {
      const { dialog } = await setup;
      const selected = await dialog.open({ multiple: !!opts.multiple, filters: toFilters(opts.types) });
      if (!selected) throw new DOMException("用户取消", "AbortError");
      const paths = Array.isArray(selected) ? selected : [selected];
      return paths.map((p) => new TFileHandle(p));
    };

    window.showSaveFilePicker = async (opts = {}) => {
      const { dialog } = await setup;
      const path = await dialog.save({
        defaultPath: opts.suggestedName,
        filters: toFilters(opts.types),
      });
      if (!path) throw new DOMException("用户取消", "AbortError");
      return new TFileHandle(path);
    };

    window.showDirectoryPicker = async () => {
      const { dialog } = await setup;
      const dir = await dialog.open({ directory: true, multiple: false });
      if (!dir) throw new DOMException("用户取消", "AbortError");
      return new TDirHandle(dir);
    };

    // 供编辑器按「命令行传入的绝对路径」构造文件句柄（双击 .md 启动 EXE 时使用）。
    // 返回的对象与 showOpenFilePicker 得到的句柄接口一致（getFile/createWritable）。
    window.__tauriFileHandle = (path) => new TFileHandle(path);

    // -----------------------------------------------------------------------
    // window.open 接管（Tauri 桌面壳）
    //   浏览器侧：window.open 原生可用（开新标签 / 外链），此分支不执行，零影响。
    //   Tauri 侧：原生 window.open 被 Tauri 拦截（无窗口创建权限 / 外链无通道），
    //   导致「对比/合并」入口与外链点击无反应。此处统一接管：
    //     - 站内相对路径（如 compare.html）→ 开受管子窗口（最接近扩展「新标签」语义）；
    //       子窗口不可用（权限/能力缺失）时退化为同窗导航，保证功能可达。
    //     - 外部协议（http/https/mailto/tel/ftp）→ tauri-plugin-shell 调系统默认程序。
    //   注意：返回 truthy 对象，兼容 openPreviewLink 中 `if (!opened) throw` 的判空。
    // -----------------------------------------------------------------------
    const isExternalUrl = (u) => /^(https?:|mailto:|tel:|ftp:)/i.test(u);

    window.open = (url, _target, _features) => {
      try {
        const u = String(url == null ? "" : url);
        if (!u) return null;

        if (isExternalUrl(u)) {
          (async () => {
            try {
              const { open } = await import("@tauri-apps/plugin-shell");
              await open(u);
            } catch (e) {
              console.error("[desktop-shims] 打开外部链接失败:", e);
            }
          })();
          return { closed: false, focus() {}, close() {} };
        }

        // 站内相对路径：归一化为 dist 根下的相对路径（compare.html / ./compare.html 等）
        const rel = u.startsWith("/") ? u.slice(1) : u;
        const label = "cmw-" + Date.now() + "-" + Math.floor(Math.random() * 1e4);
        (async () => {
          try {
            const { WebviewWindow } = await import("@tauri-apps/api/window");
            new WebviewWindow(label, { url: rel, title: "Markdown 对比合并" });
          } catch (e) {
            // 子窗口不可用（权限/能力缺失）时退化为同窗导航，保证功能可达
            console.warn("[desktop-shims] 子窗口创建失败，退化为同窗导航:", e);
            try {
              window.location.assign(rel);
            } catch (_) {
              /* noop */
            }
          }
        })();
        return { closed: false, focus() {}, close() {} };
      } catch (e) {
        console.error("[desktop-shims] window.open 接管失败:", e);
        return null;
      }
    };
  }
})();
