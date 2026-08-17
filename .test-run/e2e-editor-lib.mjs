// 编辑器页 E2E 公共库：启动 360Chrome + 加载扩展 + 用例执行框架。
// 与 smoke.mjs 同源的启动参数；profile 一律落在 .test-run/ 下（safe-delete 守卫）。
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const EXE = "D:\\Tools\\360Chrome\\360chromex.exe";
export const EXT = "D:\\Tools\\360Chrome\\Chrome-Markdown-Edit";

// 基线白名单：与被测功能无关的资源加载失败（离线环境字体/CDN）不计入证实信号。
const WHITELIST = [
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /favicon/i,
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_)/i,
  /Failed to load resource: net::ERR_FILE_NOT_FOUND.*\.(woff2?|ttf)/i,
  // 环境限制：360Chrome 用 --load-extension + 自定义持久化 profile 启动时，chrome.storage.local
  // 后端不可用（直连 set/get 均抛 "Invalid context type provided"）。这是测试环境缺陷，
  // 并非产品代码 bug——autosave 的 chrome.storage.local.set 写法标准正确。据此把草稿/快照落盘
  // 写入失败的环境错误白名单，仅保留功能行为断言；存储依赖的持久化能力本环境无法验证。
  /Invalid context type provided/i,
];
export const isWhitelisted = (t) => WHITELIST.some((re) => re.test(String(t)));

export async function launch(profileName) {
  const PROFILE = join(HERE, profileName);
  mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EXE,
    headless: false,
    viewport: { width: 1600, height: 950 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
    ],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 25000 });
  const EXT_ID = new URL(sw.url()).host;
  return { ctx, EXT_ID, sw };
}

// ── 用例执行框架 ────────────────────────────────────────────────
export function createRunner({ shotDir, getPage }) {
  mkdirSync(shotDir, { recursive: true });
  const results = [];
  const bugs = [];
  const errBuf = [];

  function attach(page) {
    page.on("console", (m) => {
      if (m.type() === "error") errBuf.push(m.text());
    });
    page.on("pageerror", (e) => errBuf.push("pageerror: " + String(e)));
    page.on("dialog", (d) => d.accept().catch(() => {}));
  }

  function takeErrors() {
    const all = errBuf.splice(0, errBuf.length);
    return all.filter((t) => !isWhitelisted(t));
  }

  /**
   * fn 返回 { pass, expected, actual, note?, blocked? }
   * pass=false → 记 BUG 并截图。
   */
  async function runCase(id, title, risk, fn) {
    errBuf.length = 0;
    const started = Date.now();
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { pass: false, expected: "用例可执行完毕", actual: "执行抛异常: " + (e && e.message ? e.message : String(e)) };
    }
    const consoleErrors = takeErrors();
    // 用例自身声明不检查控制台时（checkConsole:false）跳过
    if (r.checkConsole !== false && consoleErrors.length && r.pass) {
      r = { ...r, pass: false, actual: (r.actual || "") + " ｜ 但控制台出现错误: " + JSON.stringify(consoleErrors.slice(0, 3)) };
    }
    const status = r.blocked ? "blocked" : r.pass ? "passed" : "failed";
    const rec = {
      id,
      title,
      risk,
      status,
      expected: r.expected,
      actual: r.actual,
      note: r.note || null,
      consoleErrors,
      ms: Date.now() - started,
    };
    results.push(rec);
    if (status === "failed") {
      bugs.push({ id, title, risk, expected: r.expected, actual: r.actual, consoleErrors });
      try {
        const p = getPage();
        if (p && !p.isClosed()) {
          await p.screenshot({ path: join(shotDir, `e2e-editor-bug-${id}.png`) });
          rec.screenshot = `.test-run/e2e-editor-bug-${id}.png`;
        }
      } catch { /* 截图失败不影响结论 */ }
    }
    const mark = status === "passed" ? "PASS" : status === "blocked" ? "BLOCK" : "FAIL";
    console.log(`[${mark}] ${id} ${title} :: ${r.actual}`);
    return rec;
  }

  function write(outFile, extra = {}) {
    const summary = {
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      blocked: results.filter((r) => r.status === "blocked").length,
      total: results.length,
    };
    const payload = { summary, ...extra, results, bugs };
    writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }

  return { runCase, attach, results, bugs, write, takeErrors };
}

// ── 编辑器页常用操作 ──────────────────────────────────────────
export const getDoc = (page) => page.evaluate(() => window.__editor.state.doc.toString());

export async function setDoc(page, text) {
  await page.evaluate((t) => {
    window.__setEditorContent(t);
    window.__editor.dispatch({ selection: { anchor: 0, head: 0 } });
  }, text);
}

/** 在文档中选中首个 needle，返回是否命中 */
export function selectText(page, needle) {
  return page.evaluate((n) => {
    const ed = window.__editor;
    const s = ed.state.doc.toString();
    const i = s.indexOf(n);
    if (i < 0) return false;
    ed.focus();
    ed.dispatch({ selection: { anchor: i, head: i + n.length } });
    return true;
  }, needle);
}

/** 把光标放到第 line 行（1-based）行首 */
export function putCursorLine(page, line) {
  return page.evaluate((ln) => {
    const ed = window.__editor;
    const l = ed.state.doc.line(Math.min(ln, ed.state.doc.lines));
    ed.focus();
    ed.dispatch({ selection: { anchor: l.from, head: l.from } });
    return l.from;
  }, line);
}

/**
 * 安装 File System Access API 假句柄（原生对话框 Playwright 不可驱动）。
 * 假句柄行为与真实句柄同构：getFile / createWritable / write / close，
 * 因此走的仍是产品代码的完整读写链路，只是把「用户选路径」这一步换成脚本注入。
 */
export async function installFsStubs(page) {
  await page.evaluate(() => {
    window.__fs = {
      openCalls: 0,
      saveCalls: 0,
      dirCalls: 0,
      files: {},          // name -> 内容
      writes: [],         // { name, text }
      nextOpen: null,     // { name, text } 或 'abort'
      nextSave: null,     // { name } 或 'abort'
      nextDir: null,      // 目录树或 'abort'
    };
    const mkFile = (name) => {
      const h = {
        kind: "file",
        name,
        async getFile() {
          return new File([window.__fs.files[name] ?? ""], name, { type: "text/markdown" });
        },
        async createWritable() {
          let buf = "";
          return {
            async write(d) { buf += typeof d === "string" ? d : await d.text(); },
            async close() { window.__fs.files[name] = buf; window.__fs.writes.push({ name, text: buf }); },
            async truncate() {},
          };
        },
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        isSameEntry(o) { return o === h; },
      };
      return h;
    };
    window.__mkFileHandle = mkFile;
    const mkDir = (name, children) => {
      const h = {
        kind: "directory",
        name,
        async *values() { for (const c of children) yield c; },
        async *entries() { for (const c of children) yield [c.name, c]; },
        async getFileHandle(n, opts) {
          let f = children.find((c) => c.name === n && c.kind === "file");
          if (!f) {
            if (opts && opts.create) { f = mkFile(n); children.push(f); }
            else throw new DOMException("NotFound", "NotFoundError");
          }
          return f;
        },
        async getDirectoryHandle(n) {
          const d = children.find((c) => c.name === n && c.kind === "directory");
          if (!d) throw new DOMException("NotFound", "NotFoundError");
          return d;
        },
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        isSameEntry(o) { return o === h; },
      };
      return h;
    };
    window.__mkDirHandle = mkDir;

    const abort = () => { const e = new DOMException("The user aborted a request.", "AbortError"); throw e; };

    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true, writable: true,
      value: async () => {
        window.__fs.openCalls++;
        const n = window.__fs.nextOpen;
        if (!n || n === "abort") abort();
        window.__fs.files[n.name] = n.text;
        return [mkFile(n.name)];
      },
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true, writable: true,
      value: async () => {
        window.__fs.saveCalls++;
        const n = window.__fs.nextSave;
        if (!n || n === "abort") abort();
        if (!(n.name in window.__fs.files)) window.__fs.files[n.name] = "";
        return mkFile(n.name);
      },
    });
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true, writable: true,
      value: async () => {
        window.__fs.dirCalls++;
        const n = window.__fs.nextDir;
        if (!n || n === "abort") abort();
        const build = (node) =>
          node.kind === "directory"
            ? mkDir(node.name, (node.children || []).map(build))
            : (() => { window.__fs.files[node.name] = node.text ?? ""; return mkFile(node.name); })();
        return build(n);
      },
    });
  });
}

/**
 * 关闭首次启动/重载后可能出现的 onboarding 遮罩（拦截指针事件，导致按钮点击超时）。
 * 点击其关闭按钮（data-action="close"/"close-empty"），没有则直接移除节点。
 */
export async function dismissOnboarding(page) {
  await page.evaluate(() => {
    const ov = document.getElementById("onboardingOverlay");
    if (ov && ov.isConnected) {
      const btn = ov.querySelector('[data-action="close"],[data-action="close-empty"]');
      if (btn) btn.click();
      else ov.remove();
    }
  });
  await page.waitForTimeout(150);
}

/** 关闭所有可见的 modal-overlay（点其关闭按钮，否则置 hidden），避免遮挡后续点击。 */
export async function closeModals(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(".modal-overlay:not([hidden])").forEach((m) => {
      const c = m.querySelector(".modal-close,[data-action='close'],#translateSettingsClose,.close-btn");
      if (c) c.click();
      else m.hidden = true;
    });
  });
  await page.waitForTimeout(200);
}
