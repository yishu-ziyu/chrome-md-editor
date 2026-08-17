// compare-delta-align.test.js — src/compare/delta-align.js 单元测试
//
// 覆盖点：
//   1. tokenize：词整体成 token、分隔符逐字素簇、哨兵空串、CJK 不被逐字拆散
//   2. annotatePair：改动区间偏移无损（切片能拼回原行）、距离取值合理
//   3. inferEdits：同源行配对、独属行识别、贪心顺序、行数相等时的严格阈值
//   4. toRuns：连续下标压成区间
//   5. 防爆：超长行短路不卡死

import test from "node:test";
import assert from "node:assert/strict";

import {
  tokenize,
  annotatePair,
  inferEdits,
  buildAlignedWordDiffData,
  buildExclusiveConnectorPairs,
  toRuns,
  DEFAULT_MAX_LINE_DISTANCE,
} from "../src/compare/delta-align.js";

/** 断言：区间数组按 from 升序、互不重叠、且都落在 [0, line.length] 内 */
function assertRangesSane(ranges, line, label) {
  let prevTo = -1;
  for (const r of ranges) {
    assert.ok(r.from >= 0, `${label}: from 越界 ${r.from}`);
    assert.ok(r.to <= line.length, `${label}: to 越界 ${r.to} > ${line.length}`);
    assert.ok(r.from < r.to, `${label}: 空区间 ${r.from}-${r.to}`);
    assert.ok(r.from >= prevTo, `${label}: 区间重叠或乱序`);
    prevTo = r.to;
  }
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

test("tokenize：首元素恒为哨兵空串，其余拼接后等于原行", () => {
  for (const line of ["", "abc", "a b", "  lead", "trail  ", "a, b; c!", "中文测试"]) {
    const tokens = tokenize(line);
    assert.equal(tokens[0], "", `「${line}」首元素应为哨兵空串`);
    assert.equal(tokens.join(""), line, `「${line}」token 拼接应无损`);
  }
});

test("tokenize：词整体成一个 token，分隔符逐字符拆开", () => {
  const tokens = tokenize("foo, bar").filter((t) => t !== "");
  assert.deepEqual(tokens, ["foo", ",", " ", "bar"]);
});

test("tokenize：CJK 作为词整体，不被逐字拆散（JS 的 \\w 只认 ASCII，故必须用 \\p{L}）", () => {
  const tokens = tokenize("你好 世界").filter((t) => t !== "");
  assert.deepEqual(tokens, ["你好", " ", "世界"]);
});

// ---------------------------------------------------------------------------
// annotatePair
// ---------------------------------------------------------------------------

test("annotatePair：完全相同的行距离为 0 且无改动区间", () => {
  const r = annotatePair("hello world", "hello world");
  assert.equal(r.distance, 0);
  assert.deepEqual(r.minusRanges, []);
  assert.deepEqual(r.plusRanges, []);
});

test("annotatePair：单词替换只高亮被改的那个词", () => {
  const before = "the quick brown fox";
  const after = "the quick red fox";
  const r = annotatePair(before, after);

  assertRangesSane(r.minusRanges, before, "minus");
  assertRangesSane(r.plusRanges, after, "plus");

  const removed = r.minusRanges.map((x) => before.slice(x.from, x.to)).join("");
  const added = r.plusRanges.map((x) => after.slice(x.from, x.to)).join("");
  assert.equal(removed, "brown");
  assert.equal(added, "red");
  // 只改了 1 个词 / 共 4 个词，距离应明显小于同源阈值
  assert.ok(r.distance < DEFAULT_MAX_LINE_DISTANCE, `距离 ${r.distance} 应 < 0.6`);
});

test("annotatePair：毫无共同内容的两行距离为 1", () => {
  const r = annotatePair("aaa bbb", "xxx yyy");
  assert.equal(r.distance, 1);
});

test("annotatePair：纯新增（左侧为空）只在右侧产出区间", () => {
  const r = annotatePair("", "brand new line");
  assert.deepEqual(r.minusRanges, []);
  assert.equal(r.plusRanges.length, 1);
  assert.equal(r.plusRanges[0].from, 0);
  assert.equal(r.plusRanges[0].to, "brand new line".length);
});

test("annotatePair：区间 type 与所属侧一致（左 removed / 右 added）", () => {
  const r = annotatePair("alpha beta", "alpha gamma");
  for (const x of r.minusRanges) assert.equal(x.type, "removed");
  for (const x of r.plusRanges) assert.equal(x.type, "added");
});

test("annotatePair：CJK 行内改动能定位到词而非整行", () => {
  const before = "这是一段中文文本";
  const after = "这是一段英文文本";
  const r = annotatePair(before, after);
  // 中文没有空格分词，整串是一个 token，因此期望是「整体替换」而非误报空区间
  assertRangesSane(r.minusRanges, before, "minus");
  assertRangesSane(r.plusRanges, after, "plus");
  assert.ok(r.minusRanges.length > 0 && r.plusRanges.length > 0);
});

test("annotatePair：超长行走防爆短路，返回整行区间且不超时", () => {
  const long = "x".repeat(5000) + " " + "y ".repeat(2000);
  const t0 = Date.now();
  const r = annotatePair(long, long + " tail");
  const cost = Date.now() - t0;
  assert.ok(cost < 2000, `超长行应短路，实测 ${cost}ms`);
  assert.equal(r.distance, 1);
});

// ---------------------------------------------------------------------------
// inferEdits
// ---------------------------------------------------------------------------

test("inferEdits：3 行 ↔ 5 行也能配出同源行（原实现会整块跳过）", () => {
  const minus = ["function foo() {", "  return 1;", "}"];
  const plus = [
    "function foo() {",
    "  // 新增注释",
    "  const x = 1;",
    "  return x;",
    "}",
  ];
  const res = inferEdits(minus, plus);

  // 三行都应找到同源行
  assert.equal(res.pairs.length, 3, "应配出 3 对同源行");
  assert.deepEqual(
    res.pairs.map((p) => [p.minusIndex, p.plusIndex]),
    [
      [0, 0],
      [1, 3],
      [2, 4],
    ]
  );
  // 中间两行是右侧独属
  assert.deepEqual(res.unpairedPlus, [1, 2]);
  assert.deepEqual(res.unpairedMinus, []);
});

test("inferEdits：找不到同源行时判为左侧独属，且不消费 plus 游标", () => {
  const minus = ["完全无关的一行", "shared line"];
  const plus = ["shared line"];
  const res = inferEdits(minus, plus);

  assert.deepEqual(res.unpairedMinus, [0], "第 0 行应判为左侧独属");
  assert.equal(res.pairs.length, 1);
  assert.deepEqual([res.pairs[0].minusIndex, res.pairs[0].plusIndex], [1, 0]);
  assert.deepEqual(res.unpairedPlus, []);
});

test("inferEdits：alignment 完整覆盖两侧全部行且顺序正确", () => {
  const minus = ["a1", "b1"];
  const plus = ["zzz", "a1x"];
  const res = inferEdits(minus, plus);

  const seenMinus = res.alignment.filter((x) => x[0] !== null).map((x) => x[0]);
  const seenPlus = res.alignment.filter((x) => x[1] !== null).map((x) => x[1]);
  assert.deepEqual(seenMinus, [0, 1], "每个 minus 行应恰好出现一次");
  assert.deepEqual(seenPlus, [0, 1], "每个 plus 行应恰好出现一次");
});

test("inferEdits：两侧行数相等时用更严阈值，仅完全相同的行走快速通道", () => {
  // 两行都「相似但不相同」。naive 阈值为 0，所以它们不会被快速通道接受，
  // 但仍会被常规阈值 0.6 接受 —— 最终结果依然是逐行配对。
  const minus = ["alpha one", "beta two"];
  const plus = ["alpha ONE", "beta TWO"];
  const res = inferEdits(minus, plus);
  assert.equal(res.pairs.length, 2);
  assert.deepEqual(
    res.pairs.map((p) => [p.minusIndex, p.plusIndex]),
    [
      [0, 0],
      [1, 1],
    ]
  );
});

test("inferEdits：空输入不抛错", () => {
  const res = inferEdits([], []);
  assert.deepEqual(res.pairs, []);
  assert.deepEqual(res.unpairedMinus, []);
  assert.deepEqual(res.unpairedPlus, []);
  assert.deepEqual(res.alignment, []);
});

test("inferEdits：整段重写（无任何同源行）→ 两侧全部独属", () => {
  const minus = ["aaa", "bbb", "ccc"];
  const plus = ["xxx", "yyy", "zzz"];
  const res = inferEdits(minus, plus);
  assert.equal(res.pairs.length, 0);
  assert.deepEqual(res.unpairedMinus, [0, 1, 2]);
  assert.deepEqual(res.unpairedPlus, [0, 1, 2]);
});

test("inferEdits：超大块触发降级预算后仍返回完整结果、不卡死", () => {
  const minus = Array.from({ length: 150 }, (_, i) => `left unique line ${i}`);
  const plus = Array.from({ length: 150 }, (_, i) => `right unique line ${i}`);
  const t0 = Date.now();
  const res = inferEdits(minus, plus);
  const cost = Date.now() - t0;
  assert.ok(cost < 5000, `应在预算内结束，实测 ${cost}ms`);
  // 无论是否降级，两侧每一行都必须在结果中出现且仅出现一次
  const total = res.pairs.length * 2 + res.unpairedMinus.length + res.unpairedPlus.length;
  assert.equal(total, 300, "所有行都应被归类");
});

// ---------------------------------------------------------------------------
// buildAlignedWordDiffData
// ---------------------------------------------------------------------------

test("buildAlignedWordDiffData：行号按同源行的真实下标偏移，而非按顺序累加", () => {
  const minus = ["head", "the tail line here"];
  const plus = ["head", "inserted", "the tail line HERE"];
  const data = buildAlignedWordDiffData(minus, plus, "after", 10);

  // plus 侧同源行是下标 0（head，无改动，不产出）与下标 2（tail），
  // 故唯一一条数据的行号应为 10 + 2 = 12
  assert.equal(data.length, 1);
  assert.equal(data[0].lineNumber, 12);
  assert.ok(data[0].ranges.length > 0);
});

test("buildAlignedWordDiffData：before 侧行号基于 minusIndex", () => {
  const minus = ["x", "changed here"];
  const plus = ["x", "changed there"];
  const data = buildAlignedWordDiffData(minus, plus, "before", 1);
  assert.equal(data.length, 1);
  assert.equal(data[0].lineNumber, 2);
});

// ---------------------------------------------------------------------------
// toRuns
// ---------------------------------------------------------------------------

test("toRuns：连续下标压成闭区间", () => {
  assert.deepEqual(toRuns([0, 1, 2, 5, 6, 9]), [
    [0, 2],
    [5, 6],
    [9, 9],
  ]);
  assert.deepEqual(toRuns([]), []);
  assert.deepEqual(toRuns([3]), [[3, 3]]);
});

// ---------------------------------------------------------------------------
// buildExclusiveConnectorPairs（compare-merge.js refreshDecorations 连线逻辑提炼）
// ---------------------------------------------------------------------------

test("buildExclusiveConnectorPairs：右侧多出的行 → added 楔形连到 A 侧块尾", () => {
  // 左 1 行 ↔ 右 2 行：第 2 行右侧独有（新增）。
  const pairs = buildExclusiveConnectorPairs(
    ["keep this line"],
    ["keep this line", "brand new line"],
    10, // aStart
    20 // bStart
  );
  // 仅一条（右侧独有），variant 为 added，span 在 B 侧 [21,21]、caret 在 A 侧块尾 11。
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].variant, "added");
  assert.equal(pairs[0].srcCaret, true);
  assert.equal(pairs[0].dstCaret, false);
  assert.equal(pairs[0].srcStartLine, 11); // aEnd = 10 + 1
  assert.equal(pairs[0].srcEndLine, 11);
  assert.equal(pairs[0].dstStartLine, 21); // bStart + 1（右侧唯一那行）
  assert.equal(pairs[0].dstEndLine, 21);
});

test("buildExclusiveConnectorPairs：左侧多出的行（块首）→ removed 楔形连到 B 侧块首", () => {
  // 左 2 行 ↔ 右 1 行：第 1 行被删（左侧独有，且在块首）。
  const pairs = buildExclusiveConnectorPairs(
    ["only on left", "keep this line"],
    ["keep this line"],
    5,
    8
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].variant, "removed");
  assert.equal(pairs[0].srcCaret, false);
  assert.equal(pairs[0].dstCaret, true);
  // span 在 A 侧 [5,5]（被删的第 1 行）
  assert.equal(pairs[0].srcStartLine, 5);
  assert.equal(pairs[0].srcEndLine, 5);
  // 被删内容在块首，插入点落在 B 侧块首（8）而非块尾（9）—— 精确锚点。
  assert.equal(pairs[0].dstStartLine, 8);
  assert.equal(pairs[0].dstEndLine, 8);
});

test("buildExclusiveConnectorPairs：连续独属行合并成一条连接带（而非逐行）", () => {
  // 左 4 行 ↔ 右 1 行：前 3 行左侧独有且连续，应压成一条 removed 楔形。
  const pairs = buildExclusiveConnectorPairs(
    ["a", "b", "c", "shared"],
    ["shared"],
    1,
    1
  );
  const removed = pairs.filter((p) => p.variant === "removed");
  assert.equal(removed.length, 1); // 合并：不逐行
  assert.equal(removed[0].srcStartLine, 1);
  assert.equal(removed[0].srcEndLine, 3); // 闭区间 [1,3]
});

test("buildExclusiveConnectorPairs：接受预计算的 ie 可省一次对齐", () => {
  const aLines = ["x", "y", "z only"];
  const bLines = ["x", "y"];
  const ie = inferEdits(aLines, bLines, { maxLineDistance: DEFAULT_MAX_LINE_DISTANCE });
  const withPre = buildExclusiveConnectorPairs(aLines, bLines, 1, 1, ie);
  const fresh = buildExclusiveConnectorPairs(aLines, bLines, 1, 1);
  assert.deepEqual(withPre, fresh); // 预计算与现算结果一致
  assert.equal(withPre.length, 1); // 左侧第 3 行独有
  assert.equal(withPre[0].variant, "removed");
});

test("buildExclusiveConnectorPairs：块中间插入 → 尖端落在正确间隙而非块尾", () => {
  // 右栏在「line B」之后插入了一行，左栏没有。被插行应连到左栏「line B 之后、line C 之前」的间隙。
  const aLines = ["line A", "line B", "line C", "line D"];
  const bLines = ["line A", "line B", "CHANGED B", "line C", "line D"];
  const pairs = buildExclusiveConnectorPairs(aLines, bLines, 1, 1);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].variant, "added");
  // 精确锚点：紧邻前一条已配对 plus（line B，plusIndex=1）对应的 minus（line B，minusIndex=1）
  // 之后 → 1 + 1 + 1 = 3（左栏第 3 行顶部，即 line B 与 line C 之间）。
  assert.equal(pairs[0].srcStartLine, 3);
  assert.equal(pairs[0].srcEndLine, 3);
  // 反例：若错误地落块尾，应为 5（1 + 4）；这里断言它不等于块尾。
  assert.notEqual(pairs[0].srcStartLine, 5);
  // span 在右栏被插的那一行（bStart + 2 = 3）。
  assert.equal(pairs[0].dstStartLine, 3);
  assert.equal(pairs[0].dstEndLine, 3);
});

test("buildExclusiveConnectorPairs：块中间删除 → 尖端落在右栏正确间隙而非块尾", () => {
  // 左栏在「line B」之后多了一行，右栏没有（被删）。删除点应连到右栏「line B 之后、line C 之前」。
  const aLines = ["line A", "line B", "X deleted", "line C", "line D"];
  const bLines = ["line A", "line B", "line C", "line D"];
  const pairs = buildExclusiveConnectorPairs(aLines, bLines, 1, 1);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].variant, "removed");
  // span 在左栏被删的那一行（aStart + 2 = 3）。
  assert.equal(pairs[0].srcStartLine, 3);
  assert.equal(pairs[0].srcEndLine, 3);
  // 精确锚点：紧邻前一条已配对 minus（line B，minusIndex=1）对应的 plus（line B，plusIndex=1）
  // 之后 → 1 + 1 + 1 = 3（右栏第 3 行顶部，line B 与 line C 之间）。
  assert.equal(pairs[0].dstStartLine, 3);
  assert.equal(pairs[0].dstEndLine, 3);
  assert.notEqual(pairs[0].dstStartLine, 5); // 不等于块尾
});

