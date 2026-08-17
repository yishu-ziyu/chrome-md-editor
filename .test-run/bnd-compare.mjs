// bnd-compare.mjs — compare 页「边界与异常」E2E（BND / CMPM / CMPX / CMPV-05）
// 运行：NODE_OPTIONS= node .test-run/bnd-compare.mjs
// 产物：.test-run/bnd-compare-result.json + 失败项截图 .test-run/bnd-<ID>.png
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import {
  HERE,
  launch,
  openCompare,
  dropFiles,
  waitSettled,
  paneDocs,
  chunkModel,
  setResult,
  statusCount,
  setupThree,
  setupTwo,
  splitErrors,
} from "./bnd-lib.mjs";
import * as F from "./bnd-fixtures.mjs";

const OUT = join(HERE, "bnd-compare-result.json");
const results = [];
let CTX = null;
let EXT_ID = null;

const log = (...a) => console.log("[bnd]", ...a);

function flush() {
  writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");
}

const cut = (s, n = 400) =>
  typeof s === "string" ? (s.length > n ? s.slice(0, n) + `…(共 ${s.length} 字符)` : s) : s;

/**
 * 用例执行器：每条用例独占一个页面，自动计时、收集控制台错误、失败截图。
 * fn(page, api) 返回 { pass, expected, actual, verdict?, note? }
 */
async function run(id, title, fn) {
  const t0 = Date.now();
  let page = null;
  let errors = [];
  let out = null;
  let thrown = null;
  try {
    const o = await openCompare(CTX, EXT_ID);
    page = o.page;
    errors = o.errors;
    out = await fn(page, { errors });
  } catch (e) {
    thrown = e;
  }
  const ms = Date.now() - t0;
  const { real, env } = splitErrors(errors);
  let status;
  let expected;
  let actual;
  let verdict;
  if (thrown) {
    status = "failed";
    expected = out ? out.expected : "用例正常执行完毕";
    actual = "脚本抛出异常：" + String(thrown && thrown.stack ? thrown.stack.split("\n")[0] : thrown);
    verdict = "待裁决";
  } else {
    status = out.pass && real.length === 0 ? "passed" : "failed";
    expected = out.expected;
    actual = out.actual;
    verdict = out.verdict || (status === "passed" ? "通过" : "待裁决");
    if (out.pass && real.length > 0) {
      actual = actual + ` ｜ 但捕获到控制台错误：${real.join(" / ")}`;
    }
  }
  let screenshot = null;
  if (status === "failed" && page) {
    screenshot = join(HERE, `bnd-${id}.png`);
    try {
      await page.screenshot({ path: screenshot, fullPage: false });
    } catch (_) {
      screenshot = null;
    }
  }
  results.push({
    id,
    title,
    expected,
    actual,
    status,
    verdict,
    ms,
    consoleErrors: real,
    envNoise: env,
    screenshot,
    note: out && out.note ? out.note : undefined,
  });
  flush();
  log(`${status === "passed" ? "✔" : "✘"} ${id} (${ms}ms) — ${title}`);
  if (status !== "passed") log(`    期望：${expected}\n    实际：${actual}`);
  if (page) await page.close();
}

// ── 点某层「应用非冲突变更」并等落定 ──
async function applyNonConf(page) {
  await page.click("#btnApplyNonConflicting");
  await page.waitForTimeout(400);
  await waitSettled(page);
}

// ═══════════════════════════ 用例 ═══════════════════════════
async function main() {
  const boot = await launch("profile-bnd");
  CTX = boot.ctx;
  EXT_ID = boot.EXT_ID;
  log("扩展 ID:", EXT_ID);

  // ── BND-01 两侧均为空 ──
  await run("BND-01", "两侧均为空文档", async (page) => {
    await setupTwo(page, F.EMPTY, F.EMPTY);
    const sc = await statusCount(page);
    const docs = await paneDocs(page);
    const chunks = await chunkModel(page);
    const ok = sc.changes === 0 && sc.conflicts === 0 && docs.a === "" && docs.b === "";
    return {
      pass: ok,
      expected: "不崩溃；状态计数 = 「0 处变更，0 处冲突」；两栏文档均为空",
      actual: `状态="${sc.text}"，a=${JSON.stringify(docs.a)}，b=${JSON.stringify(docs.b)}，chunks=${chunks.length}`,
    };
  });

  // ── BND-02 一侧空、一侧有内容 ──
  await run("BND-02", "一侧空、一侧有内容", async (page) => {
    await setupTwo(page, F.B02_CONTENT, F.EMPTY);
    const before = await chunkModel(page);
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const ok = before.length === 1 && docs.b === F.B02_CONTENT;
    return {
      pass: ok,
      expected: `全文识别为 1 个变更块；接受后 b 栏 === 非空侧（${F.B02_CONTENT.length} 字符）`,
      actual: `块数=${before.length}；接受后 b 长度=${docs.b.length}，b===非空侧？${docs.b === F.B02_CONTENT}`,
    };
  });

  // ── BND-03 无尾随换行 vs 有尾随换行 ──
  await run("BND-03", "无尾随换行 vs 有尾随换行", async (page) => {
    await setupTwo(page, F.B03_A, F.B03_B);
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const dupBlank = /\n\n$/.test(docs.b);
    const lineOk = docs.b.split("\n").length === F.B03_A.split("\n").length;
    const ok = docs.b === F.B03_A && !dupBlank && lineOk;
    return {
      pass: ok,
      expected: `接受后 b === A（${JSON.stringify(F.B03_A)}），无重复空行、无吞行`,
      actual: `b=${JSON.stringify(docs.b)}；重复尾空行=${dupBlank}；行数 ${docs.b.split("\n").length} vs 期望 ${F.B03_A.split("\n").length}`,
    };
  });

  // ── BND-04 单行超长 20000 字符 ──
  await run("BND-04", "单行超长文本（20000 字符，无换行）", async (page) => {
    await setupTwo(page, F.B04_A, F.B04_B);
    const rendered = await page.evaluate(() => {
      const i = window.__cmp && window.__cmp.instance;
      return { aLen: i.a.state.doc.length, bLen: i.b.state.doc.length, lines: i.a.state.doc.lines };
    });
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const ok =
      rendered.aLen === F.B04_LEN &&
      rendered.lines === 1 &&
      docs.b.length === F.B04_LEN &&
      docs.b === F.B04_A;
    return {
      pass: ok,
      expected: `渲染为单行 ${F.B04_LEN} 字符；接受后 b 长度精确 = ${F.B04_LEN} 且内容 === A`,
      actual: `渲染 a 长度=${rendered.aLen}/行数=${rendered.lines}；接受后 b 长度=${docs.b.length}，内容相等？${docs.b === F.B04_A}`,
    };
  });

  // ── BND-05 大文档 3000 行 / 50 处差异 ──
  // 断言口径按需求书：渲染耗时可接受（记录）+ 应用后结果行数与内容正确。
  // 「差异块粒度」另立 BND-05b 单独取证（属库算法降级，不并入本条判定）。
  let b05Chunks = null;
  await run("BND-05", "大文档（3000 行 / 50 处分散差异）", async (page) => {
    const t0 = Date.now();
    await setupTwo(page, F.B05_A, F.B05_B);
    const renderMs = Date.now() - t0;
    const chunks = await chunkModel(page);
    b05Chunks = chunks.length;
    const tApply = Date.now();
    await applyNonConf(page);
    const applyMs = Date.now() - tApply;
    const docs = await paneDocs(page);
    const lines = docs.b.split("\n").length;
    const expLines = F.B05_A.split("\n").length;
    const ok = docs.b === F.B05_A && lines === expLines && renderMs < 10000;
    return {
      pass: ok,
      expected: `渲染耗时可接受（< 10s）；应用非冲突后 b === A（逐字符），结果行数 = ${expLines}`,
      actual: `渲染耗时 ${renderMs}ms，应用耗时 ${applyMs}ms；结果行数=${lines}，内容逐字符相等？${docs.b === F.B05_A}；识别块数=${chunks.length}`,
      note: `3000 行 / 50 处差异：装载+diff 落定 ${renderMs}ms，应用非冲突 ${applyMs}ms，结果无损。差异块被合并为 ${chunks.length} 块（见 BND-05b）`,
    };
  });

  // ── BND-05b 大文档差异块粒度退化（取证，非产品数据正确性问题） ──
  results.push({
    id: "BND-05b",
    title: "大文档差异块粒度退化（50 处分散差异被并成 1 块）",
    expected: "3000 行 / 50 处分散差异应识别为 50 个独立差异块，状态计数显示「50 处变更」",
    actual: `实际仅识别为 ${b05Chunks} 块，状态计数显示「${b05Chunks} 处变更」；整篇文档成为一个巨块，块级「接受此块」退化为全有全无，逐块合并能力在大文档上失效。合并结果本身逐字符正确（见 BND-05）。`,
    status: "warning",
    verdict:
      "环境限制（@codemirror/merge 算法降级），非产品数据 BUG，但属真实可用性缺陷。根因：src/compare-merge.js:79 `DIFF_CONFIG = { scanLimit: 500, timeout: 1500 }`。库内 scanLimit 会先 >>1（node_modules/@codemirror/merge/dist/index.js:494 → 250），findSnake 在「去掉公共前后缀后的差异跨度」min(lenA,lenB) > 250*64 = 16000 字符时直接返回单个 Change（同文件 :98-102），完全跳过精确 diff。500 恰为库自带默认值（:770），非本项目误配。",
    ms: 0,
    consoleErrors: [],
    envNoise: [],
    screenshot: null,
    note:
      "实测阈值（.test-run/bnd-diff-probe.mjs 直调 Chunk.build）：差异跨度 2500/4100/5700/7300 字符 → 块数均精确=5；17220 字符 → 退化为 1 块。提高 scanLimit 的收益/代价：scanLimit=500 → 1 块 / 1ms；2000 → 50 块 / 19ms；8000 → 50 块 / 25ms；32000 → 50 块 / 23ms。建议将 src/compare-merge.js:79 的 scanLimit 提到 2000 左右即可在 3000 行文档上恢复精确分块，代价约 +20ms（仍远低于 timeout:1500 上限）。本条仅取证，未修改任何 src/ 文件。",
  });
  flush();
  log(`▲ BND-05b (warning) — 大文档差异块粒度退化：实得 ${b05Chunks} 块`);

  // ── BND-06 CRLF 与 LF 混用 ──
  await run("BND-06", "CRLF 与 LF 混用", async (page) => {
    await setupTwo(page, F.B06_A, F.B06_B);
    const before = await chunkModel(page);
    const bBefore = (await paneDocs(page)).b;
    const crBefore = (bBefore.match(/\r/g) || []).length;
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const crAfter = (docs.b.match(/\r/g) || []).length;
    const ok =
      before.length === 1 && crBefore === 0 && crAfter === 0 && docs.b === F.B06_EXPECT;
    return {
      pass: ok,
      expected:
        "CRLF 装载时归一为 LF：仅 1 个差异块（而非逐行全差）；文档内无 \\r；接受后 b === A（LF 版）",
      actual: `块数=${before.length}；装载后 b 中 \\r 数=${crBefore}，接受后 \\r 数=${crAfter}；b===期望？${docs.b === F.B06_EXPECT}`,
    };
  });

  // ── BND-07 中文 / emoji / 组合字符 ──
  await run("BND-07", "中文 + emoji + 组合字符（ZWJ）差异接受", async (page) => {
    await setupTwo(page, F.B07_A, F.B07_B);
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const missing = F.B07_CRITICAL.filter((s) => !docs.b.includes(s));
    const cpExpect = Array.from(F.B07_A).length;
    const cpActual = Array.from(docs.b).length;
    const zwjExpect = (F.B07_A.match(/\u200d/g) || []).length;
    const zwjActual = (docs.b.match(/\u200d/g) || []).length;
    const ok =
      docs.b === F.B07_A && missing.length === 0 && cpExpect === cpActual && zwjExpect === zwjActual;
    return {
      pass: ok,
      expected: `接受后 b === A；关键字素簇 ${F.B07_CRITICAL.join(" ")} 完整；码点数 ${cpExpect}；ZWJ 数 ${zwjExpect}`,
      actual: `b===A？${docs.b === F.B07_A}；缺失字素=${missing.length ? missing.join(",") : "无"}；码点 ${cpActual}；ZWJ ${zwjActual}`,
    };
  });

  // ── CMPM-01 三栏 6 个分散非冲突块，一次应用 ──
  await run("CMPM-01", "三栏 6 个分散非冲突块，一次「应用非冲突变更」逐块校验", async (page) => {
    await setupThree(page, F.M01_YOURS, F.M01_THEIRS, F.M01_BASE);
    const before = await chunkModel(page);
    const nonConf = before.filter((c) => !c.conflict);
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const got = docs.b.split("\n");
    const exp = F.M01_EXPECT.split("\n");
    const badLines = [];
    for (let i = 0; i < Math.max(got.length, exp.length); i++) {
      if (got[i] !== exp[i]) badLines.push(`L${i + 1}: 期望 ${JSON.stringify(exp[i])} 实得 ${JSON.stringify(got[i])}`);
    }
    const ok = docs.b === F.M01_EXPECT && nonConf.length >= 5;
    return {
      pass: ok,
      expected: `≥5 个非冲突块；应用后 Result 逐行等于预期合并文本（${exp.length} 行）`,
      actual: `块数=${before.length}（非冲突 ${nonConf.length}，冲突 ${before.length - nonConf.length}）；不匹配行数=${badLines.length}${badLines.length ? "：" + badLines.slice(0, 6).join(" | ") : ""}`,
    };
  });

  // ── CMPM-02 ab 层与 bc 层改动都必须保留 ──
  await run("CMPM-02", "三栏 ab 层与 bc 层各一非冲突块，应用后两层都保留", async (page) => {
    await setupThree(page, F.M02_YOURS, F.M02_THEIRS, F.M02_BASE);
    const before = await chunkModel(page);
    const abN = before.filter((c) => c.layer === "ab").length;
    const bcN = before.filter((c) => c.layer === "bc").length;
    await applyNonConf(page);
    const docs = await paneDocs(page);
    const hasYours = docs.b.includes("【Yours 层改动，必须保留】");
    const hasTheirs = docs.b.includes("【Theirs 层改动，必须保留】");
    const ok = hasYours && hasTheirs && docs.b === F.M02_EXPECT;
    return {
      pass: ok,
      expected: "应用后 Result 同时含 ab 层与 bc 层改动，且全文 === 预期合并文本",
      actual: `ab 块=${abN}，bc 块=${bcN}；含 Yours 改动=${hasYours}，含 Theirs 改动=${hasTheirs}，全文相等？${docs.b === F.M02_EXPECT}`,
    };
  });

  // ── CMPM-03 逆序点击块级按钮 ──
  await run("CMPM-03", "两栏逆序点击块级「采纳左」（先末块后首块）", async (page) => {
    await setupTwo(page, F.M03_YOURS, F.M03_BASE);
    const groups0 = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-merge-revert .cm-compare-revert-group")].map((e) =>
        Number(e.dataset.chunk)
      )
    );
    if (groups0.length < 3) {
      return {
        pass: false,
        expected: "revert 列渲染出 3 个块级按钮组",
        actual: `实际只有 ${groups0.length} 个（data-chunk=${JSON.stringify(groups0)}）`,
        verdict: "待裁决",
      };
    }
    const clickChunk = async (idx) => {
      await page.click(
        `.cm-merge-revert .cm-compare-revert-group[data-chunk="${idx}"] .cm-compare-accept-left`
      );
      await page.waitForTimeout(350);
      await waitSettled(page);
    };
    // ① 先点最后一块
    await clickChunk(Math.max(...groups0));
    const step1 = (await paneDocs(page)).b;
    // ② 再点第一块（重新取 data-chunk，索引已随块数变化）
    const groups1 = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-merge-revert .cm-compare-revert-group")].map((e) =>
        Number(e.dataset.chunk)
      )
    );
    await clickChunk(Math.min(...groups1));
    const step2 = (await paneDocs(page)).b;
    // ③ 收尾：把剩余块也接受，最终应与 A 完全一致
    let guard = 0;
    while (guard++ < 8) {
      const g = await page.evaluate(() =>
        [...document.querySelectorAll(".cm-merge-revert .cm-compare-revert-group")].map((e) =>
          Number(e.dataset.chunk)
        )
      );
      if (!g.length) break;
      await clickChunk(Math.max(...g));
    }
    const final = (await paneDocs(page)).b;
    const ok1 = step1 === F.M03_ONLY_LAST;
    const ok2 = step2 === F.M03_FIRST_AND_LAST;
    const ok3 = final === F.M03_YOURS;
    return {
      pass: ok1 && ok2 && ok3,
      expected:
        "① 点末块后仅第 25 行变更；② 再点首块后第 5+25 行变更；③ 全部接受后 b === A（无位置漂移）",
      actual: `① 匹配=${ok1}；② 匹配=${ok2}；③ 最终 b===A=${ok3}${ok1 ? "" : " ｜ step1 差异行=" + firstDiffLine(step1, F.M03_ONLY_LAST)}${ok2 ? "" : " ｜ step2 差异行=" + firstDiffLine(step2, F.M03_FIRST_AND_LAST)}`,
    };
  });

  // ── CMPM-04 连续两次「全部」幂等 ──
  await run("CMPM-04", "连续两次点击「全部」方向按钮（幂等性）", async (page) => {
    await setupTwo(page, F.M04_A, F.M04_B);
    await page.click("#btnAcceptAll");
    await page.waitForTimeout(400);
    await waitSettled(page);
    const first = await paneDocs(page);
    await page.click("#btnAcceptAll");
    await page.waitForTimeout(400);
    await waitSettled(page);
    const second = await paneDocs(page);
    const ok =
      first.a === first.b &&
      first.a === F.M04_A &&
      second.a === first.a &&
      second.b === first.b;
    return {
      pass: ok,
      expected: "第一次点击后 a === b === A；第二次点击结果与第一次完全一致（幂等）",
      actual: `第一次 a===b=${first.a === first.b}，a===A=${first.a === F.M04_A}；第二次 a 变化=${second.a !== first.a}，b 变化=${second.b !== first.b}`,
    };
  });

  // ── CMPX-01 冲突块必须保持未解决 ──
  await run("CMPX-01", "冲突块存在时点「应用非冲突变更」，冲突保持未解决", async (page) => {
    await setupThree(page, F.X01_YOURS, F.X01_THEIRS, F.X01_BASE);
    const scBefore = await statusCount(page);
    const before = await chunkModel(page);
    const confBefore = before.filter((c) => c.conflict && c.layer === "ab").length;
    await applyNonConf(page);
    const scAfter = await statusCount(page);
    const after = await chunkModel(page);
    const confAfter = after.filter((c) => c.conflict && c.layer === "ab").length;
    const docs = await paneDocs(page);
    const line5 = docs.b.split("\n")[4];
    const ok =
      confBefore === 1 &&
      confAfter === 1 &&
      scBefore.conflicts === scAfter.conflicts &&
      line5 === F.X01_BASE_LINE5 &&
      docs.b === F.X01_EXPECT;
    return {
      pass: ok,
      expected: `冲突数应用前后均为 1；冲突行（第 5 行）保持基线原文；非冲突行 11/17 被应用`,
      actual: `冲突 ${confBefore}→${confAfter}；状态计数 "${scBefore.text}" → "${scAfter.text}"；第 5 行=${JSON.stringify(line5)}（基线=${JSON.stringify(F.X01_BASE_LINE5)}）；全文===期望？${docs.b === F.X01_EXPECT}`,
    };
  });

  // ── CMPX-02 高亮粒度不影响接受结果 ──
  await run("CMPX-02", "切换高亮粒度（字符/单词/关闭）后接受，结果不受影响", async (page) => {
    const got = {};
    for (const mode of ["char", "word", "off"]) {
      await dropFiles(page, [
        { name: "yours.md", text: F.X02_A },
        { name: "theirs.md", text: F.X02_B },
      ]);
      await page.waitForTimeout(400);
      await waitSettled(page);
      await page.selectOption("#selHighlightWords", mode);
      await page.waitForTimeout(300);
      await applyNonConf(page);
      got[mode] = (await paneDocs(page)).b;
    }
    const ok =
      got.char === F.X02_A && got.word === F.X02_A && got.off === F.X02_A;
    return {
      pass: ok,
      expected: "三种粒度下「应用非冲突变更」的结果均 === A",
      actual: `char===A:${got.char === F.X02_A}，word===A:${got.word === F.X02_A}，off===A:${got.off === F.X02_A}`,
    };
  });

  // ── CMPX-03 关栏后接受，再重开 ──
  await run("CMPX-03", "关闭某一栏后执行接受操作，重开栏内容一致", async (page) => {
    await setupTwo(page, F.X03_A, F.X03_B);
    await page.click('.pane-header-close[data-pane="a"]');
    await page.waitForTimeout(300);
    const offOk = await page.evaluate(() =>
      document.getElementById("comparePanes").classList.contains("pane-off-a")
    );
    await applyNonConf(page);
    const afterClose = await paneDocs(page);
    // 重开：勾回 checkbox（change 事件触发 reopenPane）
    await page.check("#paneToggleA");
    await page.waitForTimeout(400);
    await waitSettled(page);
    const afterReopen = await paneDocs(page);
    const reopened = await page.evaluate(() => ({
      off: document.getElementById("comparePanes").classList.contains("pane-off-a"),
      isOff: document
        .querySelector('.pane-header[data-pane="a"]')
        .classList.contains("is-off"),
    }));
    const ok =
      offOk &&
      afterClose.b === F.X03_A &&
      afterReopen.a === afterClose.a &&
      afterReopen.b === afterClose.b &&
      !reopened.off &&
      !reopened.isOff;
    return {
      pass: ok,
      expected: "关栏后接受不抛异常且 b === A；重开后 a/b 内容与关栏时一致，pane-off-a / is-off 已撤除",
      actual: `关栏类=${offOk}；关栏后 b===A=${afterClose.b === F.X03_A}；重开后 a 一致=${afterReopen.a === afterClose.a}，b 一致=${afterReopen.b === afterClose.b}；残留 pane-off-a=${reopened.off}，is-off=${reopened.isOff}`,
    };
  });

  // ── CMPX-04 两栏 / 三栏来回切 3 次 ──
  await run("CMPX-04", "两栏与三栏之间来回切换 3 次，无残留 DOM、零控制台错误", async (page) => {
    await setupTwo(page, F.X04_A, F.X04_B);
    for (let i = 0; i < 3; i++) {
      await page.click("#btnViewThree");
      await page.waitForFunction(() => document.querySelector(".cm-compare-theirs"), {
        timeout: 20000,
      });
      await page.waitForTimeout(350);
      await page.click("#btnViewTwo");
      await page.waitForFunction(
        () => !document.querySelector(".cm-compare-theirs"),
        { timeout: 20000 }
      );
      await page.waitForTimeout(350);
    }
    await waitSettled(page);
    const dom = await page.evaluate(() => ({
      mode: window.__cmp.mode,
      viewTwoEditors: document.querySelectorAll("#viewTwo .cm-editor").length,
      viewThreeEditors: document.querySelectorAll("#viewThree .cm-editor").length,
      viewThreeChildren: document.getElementById("viewThree").children.length,
      theirs: document.querySelectorAll(".cm-compare-theirs").length,
      mergeViews: document.querySelectorAll("#comparePanes .cm-mergeView").length,
      revertCols: document.querySelectorAll("#comparePanes .cm-merge-revert").length,
    }));
    const ok =
      dom.mode === "two" &&
      dom.viewTwoEditors === 2 &&
      dom.viewThreeEditors === 0 &&
      dom.viewThreeChildren === 0 &&
      dom.theirs === 0 &&
      dom.mergeViews === 1 &&
      dom.revertCols === 1;
    return {
      pass: ok,
      expected:
        "结束于两栏：#viewTwo 内 2 个编辑器、#viewThree 完全清空、无 .cm-compare-theirs、仅 1 个 MergeView 与 1 条 revert 列",
      actual: JSON.stringify(dom),
    };
  });

  // ── CMPV-05 折叠未改动区域复核 ──
  await run("CMPV-05", "折叠未改动区域（.cm-collapsedLines）复核", async (page) => {
    // 1) 静态取证：源码是否启用 collapseUnchanged
    const src = readFileSync(
      join(HERE, "..", "src", "compare-merge.js"),
      "utf8"
    );
    const srcCompare = readFileSync(join(HERE, "..", "src", "compare.js"), "utf8");
    const hasOption = /collapseUnchanged:\s*collapse/.test(src);
    const defaultConf = /opts\.collapseUnchanged === undefined[\s\S]{0,120}margin:\s*3,\s*minSize:\s*6/.test(src);
    const defaultOff = /let collapsed = false;/.test(srcCompare);
    const hasToggle = /btnToggleCollapse.*addEventListener\("click", onToggleCollapse\)/.test(
      srcCompare
    );

    // 2) 动态取证：默认态应无折叠；点「折叠未改」后应出现折叠占位
    await setupTwo(page, F.V05_A, F.V05_B);
    const beforeToggle = await page.evaluate(
      () => document.querySelectorAll(".cm-collapsedLines").length
    );
    await page.click("#btnToggleCollapse");
    await page.waitForTimeout(800);
    const afterToggle = await page.evaluate(() => ({
      collapsed: document.querySelectorAll(".cm-collapsedLines").length,
      btnText: document.getElementById("btnToggleCollapse").textContent.trim(),
    }));
    // 3) 再点一次应回到展开
    await page.click("#btnToggleCollapse");
    await page.waitForTimeout(600);
    const afterRestore = await page.evaluate(
      () => document.querySelectorAll(".cm-collapsedLines").length
    );

    const ok = beforeToggle === 0 && afterToggle.collapsed > 0 && afterRestore === 0;
    const verdict = ok
      ? "测试预期错误（非 BUG）：产品折叠功能默认关闭（compare.js `let collapsed = false` + render 时 setCollapse(false)），需点击工具栏「折叠未改」才启用。上一轮用例未点击该按钮就断言 .cm-collapsedLines 存在，属断言前置条件缺失。"
      : afterToggle.collapsed === 0
        ? "真 BUG：已启用 collapseUnchanged 但点击「折叠未改」后未产生 .cm-collapsedLines"
        : "待裁决";
    return {
      pass: ok,
      expected:
        "源码启用 collapseUnchanged（默认 {margin:3,minSize:6}）但初始为展开态；点「折叠未改」后出现 .cm-collapsedLines，再点回到 0",
      actual: `源码 collapseUnchanged 传参=${hasOption}，默认配置={margin:3,minSize:6}=${defaultConf}，compare.js 初始 collapsed=false=${defaultOff}，切换按钮已绑定=${hasToggle}；DOM：切换前 ${beforeToggle} 个折叠占位 → 点击后 ${afterToggle.collapsed} 个（按钮文案「${afterToggle.btnText}」）→ 再点回 ${afterRestore} 个`,
      verdict,
      note: "源码定位：src/compare-merge.js:551-554（默认 {margin:3,minSize:6}）、:758 / :1136（构造时传入）、:158-163 resolveCollapse；src/compare.js:644（let collapsed = false）、:396-398（render 时 setCollapse(collapsed)）、:645-653 onToggleCollapse",
    };
  });

  // ── 汇总 ──
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const warned = results.filter((r) => r.status === "warning").length;
  log(
    `════ 完成：共 ${results.length} 条 → 通过 ${passed}，失败 ${failed}，警告 ${warned} ════`
  );
  const shim = await (async () => {
    try {
      const o = await openCompare(CTX, EXT_ID);
      await o.page.close();
      return o.shim;
    } catch (_) {
      return "unknown";
    }
  })();
  log("storage shim 状态:", shim);
  flush();
  await CTX.close();
}

function firstDiffLine(got, exp) {
  const g = String(got).split("\n");
  const e = String(exp).split("\n");
  for (let i = 0; i < Math.max(g.length, e.length); i++) {
    if (g[i] !== e[i]) return `L${i + 1} 期望 ${JSON.stringify(e[i])} 实得 ${JSON.stringify(g[i])}`;
  }
  return "无（长度不同）";
}

main().catch(async (e) => {
  console.error("[bnd] 致命错误:", e);
  flush();
  try {
    if (CTX) await CTX.close();
  } catch (_) {}
  process.exit(1);
});
