// CMPX-08 复验：拖拽图片插入区修复（#compareImageDrop 占位 → 真实 .compare-dropzone）。
// 验证点：
//   1) 结构：占位元素已消失，真实拖拽区 + 隐藏 file input 已挂载；
//   2) 功能：聚焦右侧(b)编辑器后，向拖拽区注入 PNG，b pane 出现 ![...](data:image...)。
import { writeFileSync } from "node:fs";
import { HERE, launch, dismissOnboarding, closeModals } from "./e2e-editor-lib.mjs";

// 1x1 透明 PNG（base64）
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngPath = `${HERE}/cmpx-fixture.png`;
writeFileSync(pngPath, Buffer.from(PNG_B64, "base64"));

const { ctx, EXT_ID } = await launch("profile-cmpx");
const page = await ctx.newPage();
await page.addInitScript(() => {
  const mem = new Map();
  const shim = {
    async get(keys) {
      const out = {};
      const list = keys == null ? [...mem.keys()] : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (mem.has(k)) out[k] = mem.get(k);
      return out;
    },
    async set(o) { for (const [k, v] of Object.entries(o)) mem.set(k, v); },
    async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) mem.delete(x); },
    async clear() { mem.clear(); },
  };
  try { window.chrome = window.chrome || {}; window.chrome.storage = window.chrome.storage || {}; window.chrome.storage.local = shim; } catch {}
});

await page.goto(`chrome-extension://${EXT_ID}/src/compare.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#compareToolbar", { timeout: 20000 });
await dismissOnboarding(page);
await closeModals(page);
await page.waitForSelector(".cm-editor", { timeout: 20000 });
await page.waitForTimeout(400);

// 结构断言
const struct = await page.evaluate(() => ({
  placeholderGone: !document.getElementById("compareImageDrop"),
  dropzoneExists: !!document.querySelector(".compare-dropzone"),
  hasFileInput: !!document.querySelector(".compare-dropzone input.compare-fileinput"),
}));
console.log("STRUCT:", JSON.stringify(struct));

// 聚焦右侧(b)编辑器
const contents = await page.$$(".cm-content");
console.log("PANE_COUNT:", contents.length);
await contents[contents.length - 1].click();
await page.waitForTimeout(300);

// 注入 PNG 到拖拽区隐藏 file input
await page.setInputFiles(".compare-dropzone input.compare-fileinput", pngPath);
await page.waitForTimeout(900);

// 读取各 pane 文本
const texts = await page.evaluate(() =>
  [...document.querySelectorAll(".cm-content")].map((c, i) => `#${i}:${JSON.stringify(c.innerText)}`)
);
const inserted = texts.some((t) => t.includes("](data:image"));
console.log("PANE_TEXTS:", JSON.stringify(texts, null, 0));

console.log("\n==== CMPX-08 结论 ====");
const ok = struct.placeholderGone && struct.dropzoneExists && struct.hasFileInput && inserted;
console.log(`占位已替换=${struct.placeholderGone} | 拖拽区存在=${struct.dropzoneExists} | 文件输入=${struct.hasFileInput} | 图片已插入=${inserted}`);
console.log(ok ? "RESULT: PASS —— CMPX-08 已修复" : "RESULT: FAIL —— CMPX-08 仍存在");
await ctx.close();
