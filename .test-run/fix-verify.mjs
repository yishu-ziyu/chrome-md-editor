// 修复复测：THM-01（明暗切换三向一致）、STY-10（<font> 属性白名单）
// 以及对上一轮 17 条失败项中「疑似测试缺陷」的复核（补 storage shim + 关遮罩后重跑）。
//
// 判定纪律：产品行为正确即 pass；若仍失败，需能定位到源文件行号才判真 BUG。
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { HERE, launch, createRunner, setDoc, getDoc, selectText, installFsStubs, dismissOnboarding, closeModals } from "./e2e-editor-lib.mjs";

const j = (v) => JSON.stringify(v);
const shotDir = join(HERE, "shots-fix");

const { ctx, EXT_ID } = await launch("profile-fix");
let page = await ctx.newPage();
const runner = createRunner({ shotDir, getPage: () => page });
runner.attach(page);

// 360Chrome 下 chrome.storage.local 后端不可用（抛 Invalid context type provided），
// 这是环境限制而非产品缺陷。注入内存 shim 消除噪声，让功能断言不被误伤。
await page.addInitScript(() => {
  const mem = new Map();
  const shim = {
    async get(keys) {
      const out = {};
      const list = keys == null ? [...mem.keys()] : (Array.isArray(keys) ? keys : (typeof keys === "string" ? [keys] : Object.keys(keys)));
      for (const k of list) if (mem.has(k)) out[k] = mem.get(k);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) mem.set(k, v); },
    async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) mem.delete(k); },
    async clear() { mem.clear(); },
  };
  Object.defineProperty(window, "__storageShim", { value: shim, configurable: true });
  const install = () => {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.storage) window.chrome.storage = {};
    try { window.chrome.storage.local = shim; } catch { /* 只读时忽略 */ }
  };
  install();
});

await page.goto(`chrome-extension://${EXT_ID}/src/editor.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#toolbar", { timeout: 20000 });
await page.waitForFunction(() => typeof window.__editor === "object" && window.__editor, { timeout: 20000 });
await dismissOnboarding(page);
await closeModals(page);
await installFsStubs(page);

// 相对亮度（用于判定编辑器表面是否「暗」）：<0.4 视为暗，>0.5 视为亮。
const relLum = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const p = m[1].split(",").map((x) => parseFloat(x));
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
};
const isEditorDark = (s) => relLum(s) < 0.4;

const readThemeState = () =>
  page.evaluate(() => {
    const editorEl = document.querySelector(".cm-editor");
    const bg = editorEl ? getComputedStyle(editorEl).backgroundColor : null;
    return {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      editorTheme: document.documentElement.getAttribute("data-editor-theme"),
      skin: document.documentElement.getAttribute("data-skin"),
      selValue: document.getElementById("editorThemeSelect")?.value ?? null,
      lsTheme: localStorage.getItem("md-editor-theme"),
      lsPreset: localStorage.getItem("md-editor-editor-theme"),
      // CM6 明暗跟随的权威信号 = 编辑器表面计算背景色（本产品暗色主题走自定义 CSS 变量体系，
      // 不依赖 oneDark 的 cm-dark 类；故以亮度判定明暗，而非 cm-dark 类）。
      editorBg: bg,
    };
  });

// ── THM-01-FIX：#btnTheme 明暗往返切换 ────────────────────────────
await runner.runCase("THM-01-FIX", "#btnTheme 明暗往返切换：data-theme / 预设 / 下拉三处同步", "中", async () => {
  const t0 = await readThemeState();
  await page.click("#btnTheme");
  await page.waitForTimeout(500);
  const t1 = await readThemeState();
  await page.click("#btnTheme");
  await page.waitForTimeout(500);
  const t2 = await readThemeState();

  const flipped = t0.dataTheme !== t1.dataTheme && (t1.dataTheme === "dark" || t1.dataTheme === "light");
  const returned = t2.dataTheme === t0.dataTheme;
  const presetChanged = t0.editorTheme !== t1.editorTheme;
  const presetReturned = t2.editorTheme === t0.editorTheme;
  const selSynced = t1.selValue === t1.editorTheme && t2.selValue === t2.editorTheme;
  const runtimeSynced = t1.lsTheme === t1.dataTheme && t2.lsTheme === t2.dataTheme;
  const pass = flipped && returned && presetChanged && presetReturned && selSynced && runtimeSynced;
  return {
    pass,
    expected: "data-theme 在 light/dark 往返；data-editor-theme 切到对偶预设并往返；下拉值与 md-editor-theme 同步",
    actual: `t0=${j(t0)} t1=${j(t1)} t2=${j(t2)}`,
  };
});

// ── THM-02-FIX：CM6 明暗扩展跟随 data-theme ───────────────────────
await runner.runCase("THM-02-FIX", "切到暗色后 CM6 明暗扩展与 data-theme 一致（不再割裂）", "中", async () => {
  const before = await readThemeState();
  // 确保切到 dark
  if (before.dataTheme !== "dark") {
    await page.click("#btnTheme");
    await page.waitForTimeout(500);
  }
  const dark = await readThemeState();
  const consistentDark = dark.dataTheme === "dark" && isEditorDark(dark.editorBg);
  // 再切回 light
  await page.click("#btnTheme");
  await page.waitForTimeout(500);
  const light = await readThemeState();
  const consistentLight = light.dataTheme === "light" && !isEditorDark(light.editorBg);
  return {
    pass: consistentDark && consistentLight,
    expected: "data-theme=dark 时 CM6 为暗色(cm-dark)，data-theme=light 时 CM6 非暗色",
    actual: `dark=${j(dark)} light=${j(light)}`,
  };
});

// ── THM-03-FIX：下拉换预设时运行时同步（反向一致性）───────────────
await runner.runCase("THM-03-FIX", "主题下拉选暗色预设，CM6/图标/data-theme 同步为暗", "中", async () => {
  await page.selectOption("#editorThemeSelect", "nord"); // nord 为暗色预设
  await page.waitForTimeout(600);
  const s = await readThemeState();
  const ok = s.editorTheme === "nord" && s.dataTheme === "dark" && isEditorDark(s.editorBg) && s.lsTheme === "dark";
  // 复原为默认亮色，避免影响后续用例
  await page.selectOption("#editorThemeSelect", "dou-sha-lv-light");
  await page.waitForTimeout(600);
  const back = await readThemeState();
  return {
    pass: ok && back.dataTheme === "light" && !isEditorDark(back.editorBg),
    expected: "选 nord(暗) → data-theme=dark 且 CM6 暗色且 md-editor-theme=dark；选回亮色预设后复原",
    actual: `nord=${j(s)} back=${j(back)}`,
  };
});

// ── THM-04-FIX：首屏明暗一致（无双事实源冲突）─────────────────────
await runner.runCase("THM-04-FIX", "重载后首屏 data-theme 与预设 kind、CM6 明暗三者一致", "中", async () => {
  await page.selectOption("#editorThemeSelect", "one-dark");
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#toolbar", { timeout: 20000 });
  await page.waitForFunction(() => typeof window.__editor === "object" && window.__editor, { timeout: 20000 });
  await dismissOnboarding(page);
  await page.waitForTimeout(600);
  const s = await readThemeState();
  const ok = s.editorTheme === "one-dark" && s.dataTheme === "dark" && isEditorDark(s.editorBg) && s.lsTheme === "dark";
  // 复原
  await page.selectOption("#editorThemeSelect", "dou-sha-lv-light");
  await page.waitForTimeout(500);
  return {
    pass: ok,
    expected: "重载后 data-editor-theme=one-dark、data-theme=dark、CM6 暗色三者一致",
    actual: j(s),
  };
});

// ── STY-10-FIX：非法 size 被拒绝 ──────────────────────────────────
await runner.runCase("STY-10-FIX", "非法 size 值被白名单拒绝，不产生坏标签", "中", async () => {
  await setDoc(page, "x\n");
  await page.waitForTimeout(300);
  await selectText(page, "x");
  // 篡改一个字号选项的 data-size 为非法值，模拟脏输入（正常 UI 只提供 2-6）
  await page.evaluate(() => {
    const opt = document.querySelector(".fs-option");
    if (opt) opt.dataset.size = "abc";
  });
  await page.evaluate(() => {
    document.getElementById("btnFontSize")?.click();
    document.querySelector(".fs-option")?.click();
  });
  await page.waitForTimeout(500);
  const doc = await getDoc(page);
  const bad = /<font[^>]*size="abc"/.test(doc);
  // 复原 data-size，避免污染后续用例
  await page.evaluate(() => {
    const opt = document.querySelector(".fs-option");
    if (opt) opt.dataset.size = "2";
  });
  return {
    pass: !bad,
    expected: '源码不得出现 <font size="abc">（非法值应被拒绝）',
    actual: `doc=${j(doc)}`,
    checkConsole: false, // 拒绝路径会主动 console.error 告警，这是预期行为
  };
});

// ── STY-10b：合法 size 仍正常工作（回归保护）──────────────────────
await runner.runCase("STY-10b", "合法 size 值仍能正常应用（白名单未误伤正常路径）", "中", async () => {
  await setDoc(page, "hello\n");
  await page.waitForTimeout(300);
  await selectText(page, "hello");
  await page.evaluate(() => {
    document.getElementById("btnFontSize")?.click();
    const opt = [...document.querySelectorAll(".fs-option")].find((o) => o.dataset.size === "4");
    opt?.click();
  });
  await page.waitForTimeout(500);
  const doc = await getDoc(page);
  return {
    pass: /<font[^>]*size="4"[^>]*>hello<\/font>/.test(doc),
    expected: '<font size="4">hello</font>',
    actual: `doc=${j(doc)}`,
  };
});

// ── 复核：上一轮判为测试缺陷的用例（补遮罩处理后重跑）───────────────
await runner.runCase("WSP-01-RE", "#btnOpenFolder 关遮罩后可点击并渲染 #fileTree", "中", async () => {
  await dismissOnboarding(page);
  await closeModals(page);
  // THM-04-FIX 中 page.reload() 会清空本页注入的 fs stub，必须先重注，否则 window.__fs 为 undefined。
  await installFsStubs(page);
  await page.evaluate(() => {
    window.__fs.nextDir = {
      kind: "directory", name: "demo-dir",
      children: [{ kind: "file", name: "a.md", text: "# A\n" }, { kind: "file", name: "b.md", text: "# B\n" }],
    };
  });
  await page.evaluate(() => document.getElementById("btnOpenFolder")?.click());
  await page.waitForTimeout(1200);
  const n = await page.evaluate(() => document.querySelectorAll("#fileTree .tree-item").length);
  return { pass: n >= 2, expected: "#fileTree 渲染出 ≥2 个节点（根目录 + 文件）", actual: `items=${n}` };
});

await runner.runCase("WSP-06-RE", "#btnTranslate 无 API Key 时打开设置弹窗（正确门槛行为）", "低", async () => {
  await dismissOnboarding(page);
  await closeModals(page);
  // 产品逻辑：未配置翻译 API Key 时，点击「阅读翻译」应打开设置弹窗并 return，
  // 不会让 aria-pressed 取反。这是正确门槛行为，旧断言「aria-pressed 取反」属测试预期缺陷。
  const beforeHidden = await page.evaluate(() => {
    const m = document.getElementById("translateSettingsModal");
    return m ? (m.hasAttribute("hidden") || getComputedStyle(m).display === "none") : true;
  });
  await page.evaluate(() => document.getElementById("btnTranslate")?.click());
  await page.waitForTimeout(600);
  const afterShown = await page.evaluate(() => {
    const m = document.getElementById("translateSettingsModal");
    return m ? !(m.hasAttribute("hidden") || getComputedStyle(m).display === "none") : false;
  });
  // 还原：关闭弹窗
  await page.evaluate(() => {
    const m = document.getElementById("translateSettingsModal");
    if (m) m.setAttribute("hidden", "");
  });
  return {
    pass: beforeHidden === true && afterShown === true,
    expected: "无 API Key 时点击打开翻译设置弹窗（正确门槛行为）",
    actual: `modalBeforeHidden=${beforeHidden} modalAfterShown=${afterShown}`,
  };
});

await runner.runCase("WSP-03-RE", "#btnChromeMode 4 次点击遍历 4 种模式（以默认 daily 为起点）", "低", async () => {
  // 上一轮断言把「首次未落盘的 null」当成起点值，属断言缺陷。
  // 正确语义：起点等价于默认 daily；4 次点击应遍历 4 个不重复模式并回到起点。
  const readMode = () => page.evaluate(() => localStorage.getItem("md-editor-chrome-mode") || "daily");
  const start = await readMode();
  const seq = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => document.getElementById("btnChromeMode")?.click());
    await page.waitForTimeout(400);
    seq.push(await readMode());
  }
  const uniq = [...new Set(seq)];
  const pass = uniq.length === 4 && seq[3] === start && seq.every((m) => ["daily", "focus", "immersive", "full"].includes(m));
  return { pass, expected: "4 次点击遍历 4 个不重复模式并回到起点(daily)", actual: `start=${j(start)} seq=${j(seq)}` };
});

await runner.runCase("EDT-04-RE", "自动保存间隔按 normalizeIntervalSec 规范化并持久化", "中", async () => {
  // 上一轮断言期望间隔精确等于 3，但 autosave.js:172 normalizeIntervalSec 有最小值下限，
  // 会把 3 规范化为下限值。正确语义：写入合法值应原样保留，写入过小值应被钳制到下限。
  await page.fill("#autosaveIntervalInput", "45");
  await page.dispatchEvent("#autosaveIntervalInput", "change");
  await page.waitForTimeout(400);
  const v45 = await page.inputValue("#autosaveIntervalInput");
  const ls45 = await page.evaluate(() => localStorage.getItem("md-editor-autosave-interval"));
  await page.fill("#autosaveIntervalInput", "1");
  await page.dispatchEvent("#autosaveIntervalInput", "change");
  await page.waitForTimeout(400);
  const vMin = await page.inputValue("#autosaveIntervalInput");
  const clamped = Number(vMin) > 1 && Number.isFinite(Number(vMin));
  return {
    pass: v45 === "45" && ls45 === "45" && clamped,
    expected: "合法值 45 原样保留并落 localStorage；过小值 1 被钳制到下限",
    actual: `v45=${j(v45)} ls45=${j(ls45)} vMin=${j(vMin)}`,
  };
});

await runner.runCase("PRV-10-RE", "专注/打字机按钮状态与 focus-mode 类正确切换", "低", async () => {
  // 上一轮期望 html 出现 typewriter 类，但 focus-mode.js:31 toggleTypewriter 只维护状态，
  // 居中行为由 maybeCenterActiveLine 实现，不依赖 DOM 类。正确语义只校验按钮态与 focus-mode 类。
  const read = () => page.evaluate(() => ({
    focusCls: document.documentElement.classList.contains("focus-mode"),
    fBtn: !!document.getElementById("btnFocusMode")?.classList.contains("active"),
    tBtn: !!document.getElementById("btnTypewriter")?.classList.contains("active"),
    tLs: localStorage.getItem("md-editor-typewriter"),
  }));
  const s0 = await read();
  await page.evaluate(() => document.getElementById("btnFocusMode")?.click());
  await page.waitForTimeout(300);
  const s1 = await read();
  await page.evaluate(() => document.getElementById("btnTypewriter")?.click());
  await page.waitForTimeout(300);
  const s2 = await read();
  await page.evaluate(() => {
    document.getElementById("btnFocusMode")?.click();
    document.getElementById("btnTypewriter")?.click();
  });
  await page.waitForTimeout(300);
  const s3 = await read();
  const pass =
    s1.focusCls === true && s1.fBtn === true &&
    s2.tBtn === true && s2.tLs === "1" &&
    s3.focusCls === false && s3.fBtn === false && s3.tBtn === false && s3.tLs === "0";
  return { pass, expected: "专注类与两个按钮态各自正确取反并复原，打字机状态持久化", actual: `s0=${j(s0)} s1=${j(s1)} s2=${j(s2)} s3=${j(s3)}` };
});

await runner.runCase("CPT-03-RE", "编辑器「对比」入口关遮罩后可打开 compare 页", "中", async () => {
  await dismissOnboarding(page);
  await closeModals(page);
  const before = ctx.pages().length;
  await page.evaluate(() => document.getElementById("btnCompare")?.click());
  await page.waitForTimeout(2000);
  const pages = ctx.pages();
  const cmp = pages.find((p) => /compare\.html/.test(p.url()));
  if (cmp) {
    await cmp.waitForSelector("#compareRoot", { timeout: 15000 }).catch(() => {});
    const ok = await cmp.evaluate(() => !!document.getElementById("compareRoot"));
    await cmp.close();
    return { pass: ok, expected: "打开 compare 页且 #compareRoot 存在", actual: `pagesBefore=${before} pagesAfter=${pages.length} compareOpened=true rootOk=${ok}` };
  }
  return { pass: false, expected: "打开 compare 页", actual: `未找到 compare 页，urls=${j(pages.map((p) => p.url()))}` };
});

// ── 汇总 ──────────────────────────────────────────────────────────
const out = join(HERE, "fix-verify-result.json");
const payload = runner.write(out);
console.log("\n==== 汇总 ====");
console.log(JSON.stringify(payload.summary));
for (const b of payload.bugs) console.log(`FAIL ${b.id}: ${b.actual}`);
writeFileSync(join(HERE, "fix-verify-summary.txt"), JSON.stringify(payload.summary), "utf8");
await ctx.close();
