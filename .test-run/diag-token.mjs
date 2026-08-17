// 质量闸门：暗色模式下，非 markdown token（代码块内容，走 defaultHighlightStyle fallback）
// 的文字颜色是否能在深色背景上读清（浅色字 = 可读；深色字 = 不可读 BUG）。
import { join } from "node:path";
import { HERE, launch, dismissOnboarding, closeModals, setDoc } from "./e2e-editor-lib.mjs";

const { ctx, EXT_ID } = await launch("profile-diag2");
const page = await ctx.newPage();
await page.addInitScript(() => {
  const mem = new Map();
  const shim = { async get(k){const o={};const l=k==null?[...mem.keys()]:(Array.isArray(k)?k:[k]);for(const x of l)if(mem.has(x))o[x]=mem.get(x);return o;} , async set(o){for(const [k,v] of Object.entries(o))mem.set(k,v);}, async remove(k){for(const x of (Array.isArray(k)?k:[k]))mem.delete(x);}, async clear(){mem.clear();} };
  try { window.chrome = window.chrome||{}; window.chrome.storage=window.chrome.storage||{}; window.chrome.storage.local=shim; } catch {}
});
await page.goto(`chrome-extension://${EXT_ID}/src/editor.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#toolbar", { timeout: 20000 });
await page.waitForFunction(() => typeof window.__editor === "object" && window.__editor, { timeout: 20000 });
await dismissOnboarding(page);
await closeModals(page);

// 写入一段含代码块与标题的文档
await setDoc(page, "# 标题\n\n正文段落。\n\n```js\nconst x = 1;\nfunction f(){ return x; }\n```\n");
await page.waitForTimeout(500);

// 切到暗色（豆沙绿暗）
await page.click("#btnTheme");
await page.waitForTimeout(600);

const probe = () => page.evaluate(() => {
  const get = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor };
  };
  // 代码块内容（defaultHighlightStyle fallback 作用区）
  const codeLine = document.querySelector(".cm-line .cm-inlineCode, .cm-line span") ;
  // 直接取代码块内的 token span（高亮后的 .ͼ 类）
  const tokenSpans = [...document.querySelectorAll(".cm-content .cm-line span")];
  const samples = tokenSpans.slice(0, 6).map(s => {
    const cs = getComputedStyle(s);
    return { txt: s.textContent.slice(0,12), color: cs.color, bg: cs.backgroundColor };
  });
  const editorBg = getComputedStyle(document.querySelector(".cm-editor")).backgroundColor;
  return { editorBg, samples };
});

const r = await probe();
console.log(JSON.stringify(r, null, 2));

// 判读：找非透明、非继承的颜色样本，看是否与深色背景反差足够（浅色字 = 可读）
const bgLum = r.editorBg;
console.log("\n编辑器背景:", bgLum);
console.log("token 样本颜色如上。浅色(rgb 含大值)在深底上 = 可读；深色(接近黑) = 不可读。");
await ctx.close();
