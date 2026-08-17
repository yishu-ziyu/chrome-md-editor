// bnd-lib.mjs — 边界/异常用例专用工具层（不改动 e2e-lib.mjs，避免与其他成员冲突）
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const EXE = "D:\\Tools\\360Chrome\\360chromex.exe";
export const EXT = "D:\\Tools\\360Chrome\\Chrome-Markdown-Edit";

export async function launch(profileName) {
  const PROFILE = join(HERE, profileName);
  mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EXE,
    headless: false,
    viewport: { width: 1680, height: 980 },
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
  return { ctx, EXT_ID: new URL(sw.url()).host };
}

// 页面初始化脚本：cmp-debug 钩子 + showSaveFilePicker 屏蔽 + chrome.storage.local 内存 shim。
// 360Chrome 的 chrome.storage.local 会抛 "Invalid context type provided."（环境限制），
// 用内存 shim 补偿以消除 [autosave] 噪声，避免污染控制台错误判定。
function initScript() {
  try {
    localStorage.setItem("cmp-debug", "1");
  } catch (_) {}
  try {
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    });
  } catch (_) {}
  try {
    if (typeof chrome === "undefined" || !chrome.storage) {
      window.__storageShim = "no-chrome-storage";
      return;
    }
    const mem = new Map();
    const pick = (keys) => {
      const out = {};
      if (keys == null) {
        for (const [k, v] of mem) out[k] = v;
        return out;
      }
      if (typeof keys === "string") {
        if (mem.has(keys)) out[keys] = mem.get(keys);
        return out;
      }
      if (Array.isArray(keys)) {
        for (const k of keys) if (mem.has(k)) out[k] = mem.get(k);
        return out;
      }
      for (const k of Object.keys(keys)) out[k] = mem.has(k) ? mem.get(k) : keys[k];
      return out;
    };
    const done = (cb, val) => {
      if (typeof cb === "function") {
        cb(val);
        return undefined;
      }
      return Promise.resolve(val);
    };
    const shim = {
      get: (keys, cb) => done(cb, pick(keys)),
      set: (obj, cb) => {
        for (const k of Object.keys(obj || {})) mem.set(k, obj[k]);
        return done(cb, undefined);
      },
      remove: (keys, cb) => {
        for (const k of [].concat(keys)) mem.delete(k);
        return done(cb, undefined);
      },
      clear: (cb) => {
        mem.clear();
        return done(cb, undefined);
      },
      getBytesInUse: (_k, cb) => done(cb, 0),
      onChanged: { addListener() {}, removeListener() {} },
    };
    try {
      Object.defineProperty(chrome.storage, "local", {
        value: shim,
        configurable: true,
        writable: true,
      });
      window.__storageShim = "ok:storage.local";
    } catch (_) {
      Object.defineProperty(chrome, "storage", {
        value: { local: shim, sync: shim, session: shim, onChanged: shim.onChanged },
        configurable: true,
        writable: true,
      });
      window.__storageShim = "ok:chrome.storage";
    }
  } catch (e) {
    window.__storageShim = "fail:" + String(e);
  }
}

export async function openCompare(ctx, EXT_ID) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e)));
  await page.addInitScript(initScript);
  await page.goto(`chrome-extension://${EXT_ID}/src/compare.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("#compareRoot", { timeout: 20000 });
  await page.waitForFunction(() => typeof window.__cmp === "object" && window.__cmp !== null, {
    timeout: 15000,
  });
  const shim = await page.evaluate(() => window.__storageShim);
  return { page, errors, shim };
}

export async function dropFiles(page, list) {
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      dt.items.add(new File([f.text], f.name, { type: "text/markdown" }));
    }
    document
      .getElementById("compareFiles")
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, list);
}

// 等 diff 落定：轮询 getChunks().length，连续 3 次不变即视为稳定。
export async function waitSettled(page, timeout = 30000) {
  const t0 = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - t0 < timeout) {
    const n = await page.evaluate(() => {
      const i = window.__cmp && window.__cmp.instance;
      if (!i || typeof i.getChunks !== "function") return -1;
      try {
        return i.getChunks().length;
      } catch (_) {
        return -1;
      }
    });
    if (n >= 0 && n === last) {
      stable++;
      if (stable >= 3) return n;
    } else {
      stable = 0;
      last = n;
    }
    await page.waitForTimeout(120);
  }
  return last;
}

export function paneDocs(page) {
  return page.evaluate(() => {
    const i = window.__cmp && window.__cmp.instance;
    if (!i) return { a: null, b: null, c: null };
    return {
      a: i.a ? i.a.state.doc.toString() : null,
      b: i.b ? i.b.state.doc.toString() : null,
      c: i.theirsView ? i.theirsView.state.doc.toString() : null,
    };
  });
}

export function chunkModel(page) {
  return page.evaluate(() => {
    const i = window.__cmp && window.__cmp.instance;
    if (!i || typeof i.getChunks !== "function") return [];
    try {
      return i.getChunks().map((c) => ({
        id: c.id,
        layer: c.layer,
        conflict: !!c.conflict,
        srcFrom: c.srcFrom,
        srcTo: c.srcTo,
        dstFrom: c.dstFrom,
        dstTo: c.dstTo,
      }));
    } catch (e) {
      return [{ error: String(e) }];
    }
  });
}

export async function setResult(page, text) {
  await page.evaluate((t) => {
    const v = window.__cmp.instance.b;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
  }, text);
  await page.waitForTimeout(300);
}

export function statusCount(page) {
  return page.evaluate(() => {
    const el = document.getElementById("compareStatusCount");
    const t = el.textContent.trim();
    const m = t.match(/(\d+)\s*处变更[，,]\s*(\d+)\s*处冲突/);
    return {
      text: t,
      changes: m ? Number(m[1]) : null,
      conflicts: m ? Number(m[2]) : null,
    };
  });
}

// 三栏就绪：切三栏 → 装载 Yours/Theirs → 写入 Result 基线 → 等落定
export async function setupThree(page, yours, theirs, resultText) {
  await page.click("#btnViewThree");
  await page.waitForFunction(() => document.querySelector(".cm-compare-theirs"), {
    timeout: 20000,
  });
  await dropFiles(page, [
    { name: "yours.md", text: yours },
    { name: "theirs.md", text: theirs },
  ]);
  await page.waitForTimeout(500);
  await page.waitForFunction(() => document.querySelector(".cm-compare-theirs"), {
    timeout: 20000,
  });
  await setResult(page, resultText);
  await waitSettled(page);
}

export async function setupTwo(page, yours, theirs) {
  await dropFiles(page, [
    { name: "yours.md", text: yours },
    { name: "theirs.md", text: theirs },
  ]);
  await page.waitForTimeout(400);
  await waitSettled(page);
}

// ── 控制台错误分类 ──────────────────────────────────────────────────────
const IGNORE = [/fonts\.googleapis\.com/i, /net::ERR_/i, /favicon/i];
const KNOWN_ENV = [/Invalid context type provided/i, /\[autosave\]\s*草稿写入失败/];
export function splitErrors(list) {
  const real = [];
  const env = [];
  for (const t of list) {
    if (IGNORE.some((re) => re.test(t))) continue;
    if (KNOWN_ENV.some((re) => re.test(t))) {
      env.push(t);
      continue;
    }
    real.push(t);
  }
  return { real, env };
}
