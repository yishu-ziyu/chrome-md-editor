// bnd-fixtures.mjs — 边界/异常用例夹具（全部内存字符串，不落盘）

export const nl = (arr) => arr.join("\n") + "\n";

// 通用「第 N 行」基线生成器
export function baseLines(n, prefix = "第") {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} 行公共内容，用于对照测试。`);
}

// 在基线上按 {行号:新文本} 改写，行号从 1 起
export function edit(lines, map) {
  const a = [...lines];
  for (const k of Object.keys(map)) a[Number(k) - 1] = map[k];
  return a;
}

// ── BND-01 空 ─────────────────────────────────────────────────────────
export const EMPTY = "";

// ── BND-02 一侧空 ─────────────────────────────────────────────────────
export const B02_CONTENT = nl([
  "# 单侧内容标题",
  "",
  "这是仅存在于一侧的正文段落。",
  "- 列表项甲",
  "- 列表项乙",
  "",
  "结尾行。",
]);

// ── BND-03 尾随换行 ───────────────────────────────────────────────────
export const B03_A = ["第一行内容", "第二行内容", "第三行已被修改且无尾随换行"].join("\n");
export const B03_B = ["第一行内容", "第二行内容", "第三行原始内容"].join("\n") + "\n";

// ── BND-04 单行超长（无换行） ─────────────────────────────────────────
export const B04_LEN = 20000;
export const B04_A = "A".repeat(B04_LEN);
export const B04_B = "A".repeat(B04_LEN - 40) + "B".repeat(40);

// ── BND-05 大文档 3000 行 / 50 处差异 ─────────────────────────────────
export const B05_LINES = 3000;
export const B05_DIFFS = 50;
export const B05_BASE_ARR = baseLines(B05_LINES);
export const B05_A_ARR = (() => {
  const a = [...B05_BASE_ARR];
  for (let k = 0; k < B05_DIFFS; k++) {
    const idx = 20 + k * 59; // 20, 79, 138 ... 最大 20+49*59=2911 < 3000
    a[idx] = `>>> 第 ${idx + 1} 行【Yours 改动 ${k + 1}】<<<`;
  }
  return a;
})();
export const B05_A = nl(B05_A_ARR);
export const B05_B = nl(B05_BASE_ARR);

// ── BND-06 CRLF / LF 混用 ─────────────────────────────────────────────
const B06_BASE = [
  "# CRLF 兼容测试",
  "",
  "第一段正文。",
  "第二段正文。",
  "第三段正文。",
  "",
  "结尾行。",
];
export const B06_A = nl(edit(B06_BASE, { 4: "第二段正文（Yours 改）。" })); // 全 LF
export const B06_B = B06_BASE.join("\r\n") + "\r\n"; // 全 CRLF
export const B06_EXPECT = B06_A; // 接受 a→b 后 b 应等于 A（LF）

// ── BND-07 中文 / emoji / 组合字符 ────────────────────────────────────
const B07_BASE = [
  "# 多语种与 emoji 边界",
  "",
  "家庭组合字符：👨‍👩‍👧 与 👨‍👩‍👧‍👦 都必须完整。",
  "国旗与肤色：🇨🇳 👍🏻 é ﬁ ǆ",
  "日文假名：こんにちは、カタカナ。",
  "中文标点：全角，测试！——「引号」",
  "",
  "结尾行。",
];
export const B07_A = nl(
  edit(B07_BASE, {
    3: "家庭组合字符：👨‍👩‍👧 与 👨‍👩‍👧‍👦 都必须完整【Yours 改：🧑‍🚀🎉】。",
    6: "中文标点：全角，测试！——「引号」【已改】",
  })
);
export const B07_B = nl(B07_BASE);
export const B07_CRITICAL = ["👨‍👩‍👧", "👨‍👩‍👧‍👦", "🇨🇳", "👍🏻", "🧑‍🚀"];

// ── CMPM-01 三栏 6 个分散非冲突块 ─────────────────────────────────────
export const M01_N = 42;
export const M01_BASE_ARR = baseLines(M01_N);
export const M01_YOURS_ARR = edit(M01_BASE_ARR, {
  4: "第 4 行【Yours 改动一】",
  12: "第 12 行【Yours 改动二】",
  20: "第 20 行【Yours 改动三】",
});
export const M01_THEIRS_ARR = edit(M01_BASE_ARR, {
  28: "第 28 行【Theirs 改动一】",
  34: "第 34 行【Theirs 改动二】",
  40: "第 40 行【Theirs 改动三】",
});
export const M01_EXPECT_ARR = edit(M01_BASE_ARR, {
  4: "第 4 行【Yours 改动一】",
  12: "第 12 行【Yours 改动二】",
  20: "第 20 行【Yours 改动三】",
  28: "第 28 行【Theirs 改动一】",
  34: "第 34 行【Theirs 改动二】",
  40: "第 40 行【Theirs 改动三】",
});
export const M01_BASE = nl(M01_BASE_ARR);
export const M01_YOURS = nl(M01_YOURS_ARR);
export const M01_THEIRS = nl(M01_THEIRS_ARR);
export const M01_EXPECT = nl(M01_EXPECT_ARR);

// ── CMPM-02 跨层保留（ab 一块 + bc 一块） ─────────────────────────────
export const M02_N = 24;
const M02_BASE_ARR = baseLines(M02_N);
export const M02_BASE = nl(M02_BASE_ARR);
export const M02_YOURS = nl(edit(M02_BASE_ARR, { 3: "第 3 行【Yours 层改动，必须保留】" }));
export const M02_THEIRS = nl(edit(M02_BASE_ARR, { 20: "第 20 行【Theirs 层改动，必须保留】" }));
export const M02_EXPECT = nl(
  edit(M02_BASE_ARR, {
    3: "第 3 行【Yours 层改动，必须保留】",
    20: "第 20 行【Theirs 层改动，必须保留】",
  })
);

// ── CMPM-03 两栏逆序点块级按钮 ────────────────────────────────────────
export const M03_N = 30;
const M03_BASE_ARR = baseLines(M03_N);
export const M03_BASE = nl(M03_BASE_ARR);
export const M03_YOURS = nl(
  edit(M03_BASE_ARR, {
    5: "第 5 行【改动 #1】",
    15: "第 15 行【改动 #2】",
    25: "第 25 行【改动 #3】",
  })
);
export const M03_ONLY_LAST = nl(edit(M03_BASE_ARR, { 25: "第 25 行【改动 #3】" }));
export const M03_FIRST_AND_LAST = nl(
  edit(M03_BASE_ARR, { 5: "第 5 行【改动 #1】", 25: "第 25 行【改动 #3】" })
);

// ── CMPM-04 幂等 ──────────────────────────────────────────────────────
const M04_BASE_ARR = baseLines(20);
export const M04_A = nl(
  edit(M04_BASE_ARR, { 3: "第 3 行【A 侧】", 10: "第 10 行【A 侧】", 17: "第 17 行【A 侧】" })
);
export const M04_B = nl(
  edit(M04_BASE_ARR, { 3: "第 3 行【B 侧】", 10: "第 10 行【B 侧】", 17: "第 17 行【B 侧】" })
);

// ── CMPX-01 冲突块保留 ────────────────────────────────────────────────
export const X01_N = 24;
const X01_BASE_ARR = baseLines(X01_N);
export const X01_BASE = nl(X01_BASE_ARR);
export const X01_YOURS = nl(
  edit(X01_BASE_ARR, {
    5: "第 5 行【Yours 冲突版】",
    11: "第 11 行【Yours 独立改动】",
  })
);
export const X01_THEIRS = nl(
  edit(X01_BASE_ARR, {
    5: "第 5 行【Theirs 冲突版】",
    17: "第 17 行【Theirs 独立改动】",
  })
);
// 期望：冲突行 5 保持基线，11 与 17 被应用
export const X01_EXPECT = nl(
  edit(X01_BASE_ARR, {
    11: "第 11 行【Yours 独立改动】",
    17: "第 17 行【Theirs 独立改动】",
  })
);
export const X01_BASE_LINE5 = X01_BASE_ARR[4];

// ── CMPX-02 高亮粒度 ──────────────────────────────────────────────────
const X02_BASE_ARR = baseLines(18);
export const X02_A = nl(
  edit(X02_BASE_ARR, { 4: "第 4 行【粒度测试改动】", 12: "第 12 行【粒度测试改动】" })
);
export const X02_B = nl(X02_BASE_ARR);

// ── CMPX-03 关栏后接受 ────────────────────────────────────────────────
const X03_BASE_ARR = baseLines(16);
export const X03_A = nl(edit(X03_BASE_ARR, { 6: "第 6 行【关栏测试改动】" }));
export const X03_B = nl(X03_BASE_ARR);

// ── CMPX-04 两/三栏来回切 ─────────────────────────────────────────────
const X04_BASE_ARR = baseLines(14);
export const X04_A = nl(edit(X04_BASE_ARR, { 5: "第 5 行【切换测试】" }));
export const X04_B = nl(X04_BASE_ARR);

// ── CMPV-05 折叠未改动区域 ────────────────────────────────────────────
export const V05_N = 80;
const V05_BASE_ARR = baseLines(V05_N);
export const V05_A = nl(edit(V05_BASE_ARR, { 5: "第 5 行【折叠测试改动】", 75: "第 75 行【折叠测试改动】" }));
export const V05_B = nl(V05_BASE_ARR);
