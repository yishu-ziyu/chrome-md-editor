// 聚焦诊断：CM6 明暗扩展是否真正跟随 data-theme。
// 同时用「计算背景色」(版本无关、绝对可靠) 与「cm-dark 类」双探针交叉验证。
import { join } from "node:path";
import { HERE, launch, dismissOnboarding, closeModals } from "./e2e-editor-lib.mjs";

const { ctx, EXT_ID } = await launch("profile-diag");
const page = await ctx.newPage();
await page.addInitScript(() => {
  const mem = new Map();
  const shim = {
    async get(keys) { const out = {}; const list = keys == null ? [...mem.keys()] : (Array.isArray(keys) ? keys : [keys]); for (const k of list) if (mem.has(k)) out[k] = mem.get(k); return out; },
    async set(o) { for (const [k, v] of Object.entries(o)) mem.set(k, v); },
    async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) mem.delete(x); },
    async clear() { mem.clear(); },
  };
  try { window.chrome = window.chrome || {}; window.chrome.storage = window.chrome.storage || {}; window.chrome.storage.local = shim; } catch {}
});
await page.goto(`chrome-extension://${EXT_ID}/src/editor.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#toolbar", { timeout: 20000 });
await page.waitForFunction(() => typeof window.__editor === "object" && window.__editor, { timeout: 20000 });
await dismissOnboarding(page);
await closeModals(page);

const probe = () => page.evaluate(() => {
  const editors = [...document.querySelectorAll(".cm-editor")];
  const main = window.__editor && window.__editor.dom ? window.__editor.dom : document.querySelector(".cm-editor");
  const cs = main ? getComputedStyle(main) : null;
  const content = document.querySelector(".cm-content");
  const contentBg = content ? getComputedStyle(content).backgroundColor : null;
  return {
    count: editors.length,
    cmDarkClass: main ? main.classList.contains("cm-dark") : null,
    cmLightClass: main ? main.classList.contains("cm-light") : null,
    editorBg: cs ? cs.backgroundColor : null,
    contentBg,
    dataTheme: document.documentElement.getAttribute("data-theme"),
  };
});

const before = await probe();
console.log("BEFORE(初始):", JSON.stringify(before));

await page.click("#btnTheme");
await page.waitForTimeout(600);
const dark = await probe();
console.log("AFTER 点击#btnTheme:", JSON.stringify(dark));

await page.click("#btnTheme");
await page.waitForTimeout(600);
const back = await probe();
console.log("AFTER 再点(回亮):", JSON.stringify(back));

console.log("\n==== 结论 ====");
console.log("oneDark 背景应为 #282c34(暗)；lightTheme 背景 #ffffff(亮)。");
console.log(`初态 editorBg=${before.editorBg} cmDark=${before.cmDarkClass} | 暗态 editorBg=${dark.editorBg} cmDark=${dark.cmDarkClass} | 回亮 editorBg=${back.editorBg} cmDark=${back.cmDarkClass}`);
await ctx.close();
