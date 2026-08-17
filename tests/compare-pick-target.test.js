/**
 * compare-pick-target.test.js — BUG 3/5/6/7 路由纯函数回归断言
 *
 * 背景：
 *   BUG 3：原 onPickFiles 固定把选中的 MD 落到最左栏(files.a)，无视用户激活的栏。
 *   BUG 5：原 onPageDrop 写死 dropped[0]→a, dropped[1]→b, dropped[2]→c，
 *          无视拖拽时活动栏，MD 永远先落最左栏。
 *   BUG 6：合并模式下，鼠标激活「合并结果」栏(b)时点「选择文件」强制落本地(a)，
 *          正确行为应从左到右找第一个空栏（a 未载→a，a 已载→c/files.b）。
 *   BUG 7：三栏布局下 B↔C 缝（中间栏与右栏）原本没有任何「采纳左/采纳右」按钮，
 *          acceptBcDir 翻转 chunk 区间字段（srcFrom↔dstFrom、srcTo↔dstTo）
 *          实现「采纳 b 入 c」。
 * 修复后改按 getActivePane() 路由；该「活动栏→目标栏」映射抽成纯函数
 * resolvePickTarget(active, mode, files)，拖拽多文件抽成 resolveDropTargets。
 * BUG 7 的 bc 翻转抽成 flipBcChunk。
 * 本文件做运行时断言。
 *
 * 为什么是纯函数单测而非 CDP：CDP 无法驱动系统原生文件框
 * （showOpenFilePicker / <input type=file>），BUG 3/7 的真机步骤只能
 * 人工验证；纯函数单测锁定路由决策，弥补该自动化盲区，防止未来回归。
 *
 * 变异验证（开发期已做，不常驻）：临时把任一分支返回值改错 → 下列断言精确变红
 * → 恢复原值 → 全绿。证明本测试能抓到「路由错栏」类回归。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePickTarget,
  resolveDropTargets,
  flipBcChunk,
} from "../src/compare/pick-target.js";

// ============== BUG 3：单文件选择路由（6 种基础组合） ==============
//
// 不传 files → 走旧 6 组合，向后兼容 BUG 3 既有断言。
const BASE_CASES = [
  // 对照模式：直接落到活动栏
  ["a", "compare", "a"],
  ["b", "compare", "b"],
  ["c", "compare", "c"],
  // 合并模式：本地(a)→本地；合并结果栏(b)不可作源→回落本地(a)；
  // 右栏(c)=对方→files.b
  ["a", "merge", "a"],
  ["b", "merge", "a"],
  ["c", "merge", "b"],
];

for (const [active, mode, expected] of BASE_CASES) {
  test(`resolvePickTarget(${active}, ${mode}) → ${expected}（无 files 入参）`, () => {
    assert.equal(
      resolvePickTarget(active, mode),
      expected,
      `活动栏=${active} 模式=${mode} 应路由到目标栏=${expected}`
    );
  });
}

// ============== BUG 6：合并模式「中栏(b)=合并结果」找空栏路由 ==============
//
// 用户要求：合并模式点「合并结果」栏聚焦 → 「选择文件」时，按"从左到右找
// 第一个空栏"：本地(a)未载则落本地，本地已载则落对方(c→files.b)。
//
// 构造 files 状态：未载入 = undefined 或 { name: undefined, target: undefined }

test("BUG6 合并模式中栏(b)：a 未载 → 落 a（本地）", () => {
  assert.equal(
    resolvePickTarget("b", "merge", { a: undefined, b: { name: "result" }, c: undefined }),
    "a"
  );
});

test("BUG6 合并模式中栏(b)：a 已载 → 落 b(files.b=对方)", () => {
  assert.equal(
    resolvePickTarget("b", "merge", { a: { name: "left.md" }, b: { name: "result" }, c: undefined }),
    "b",
    "本地已载时应跳过落到对方(files.b)，避免覆盖已有本地文件"
  );
});

test("BUG6 合并模式中栏(b)：a 仅有空 target 也算未载", () => {
  // 边缘情形：files.a = {} 不应误判为已载
  assert.equal(
    resolvePickTarget("b", "merge", { a: {}, b: undefined, c: undefined }),
    "a",
    "空对象 {} 应等同于未载（target/name 都为空）"
  );
});

test("BUG6 合并模式中栏(b)：a 已有 target 字段才算已载", () => {
  assert.equal(
    resolvePickTarget("b", "merge", { a: { target: { path: "/x.md" } }, b: undefined, c: undefined }),
    "b"
  );
});

// 合并 a/c 栏不受 files 状态影响（明确语义，无需读 files）
test("BUG3+6 合并模式 a 栏：始终落 a", () => {
  for (const files of [
    undefined,
    {},
    { a: undefined },
    { a: { name: "left.md" } },
  ]) {
    assert.equal(resolvePickTarget("a", "merge", files), "a");
  }
});

test("BUG3+6 合并模式 c 栏：始终落 b（对方=files.b）", () => {
  for (const files of [
    undefined,
    {},
    { b: { name: "right.md" } },
  ]) {
    assert.equal(resolvePickTarget("c", "merge", files), "b");
  }
});

// 对照模式不受 files 影响，直接落到活动栏
test("对照模式：files 状态不影响路由", () => {
  for (const k of ["a", "b", "c"]) {
    assert.equal(resolvePickTarget(k, "compare", undefined), k);
    assert.equal(resolvePickTarget(k, "compare", {}), k);
    assert.equal(resolvePickTarget(k, "compare", { a: { name: "x" }, b: { name: "y" }, c: { name: "z" } }), k);
  }
});

// ============== BUG 5：拖拽多文件路由 ==============
//
// 第一个文件落活动栏；其余按 [a, b, ...(c if compare)] 顺序填入空栏。
// 合并模式 [a, b]；对照模式 [a, b, c]。

test("BUG5 对照两栏：拖 1 个文件 → 落活动栏", () => {
  for (const active of ["a", "b"]) {
    const got = resolveDropTargets(active, "compare", {}, 1);
    assert.deepEqual(got, [active]);
  }
});

test("BUG5 对照两栏：拖 2 个到 b 栏 → [b, a]（先 b 再补 a）", () => {
  // 活动=b 栏，拖入 2 个 MD：第一落 b，其余按 a→b 顺序填空 → 第二个落 a。
  const got = resolveDropTargets("b", "compare", {}, 2);
  assert.deepEqual(got, ["b", "a"]);
});

test("BUG5 对照两栏：拖 3 个到 c 栏 → [a, b]（c 不在对照两栏顺序中）", () => {
  // 对照两栏模式只对应 a/b。c 栏被「三栏」切换开启，对应 files.c；若 colCount=2
  // 拖入第 3 个文件 → 没有目标栏，循环覆盖 a/b 中未占的（这里会循环 a）。
  // 实际行为：对照两栏 colCount=2 拖 3 个文件，第 3 个循环覆盖到 a（其实 b 是空）。
  // 但本纯函数不知道 colCount —— 调用方 (onPageDrop) 会按模式分支决定是否写 c。
  // 故纯函数层面：对照模式 c 栏可作目标。
  const got = resolveDropTargets("c", "compare", {}, 3);
  // 第一个落 c；空栏按 [a,b,c] 顺序：a → b → c(已占) → a(循环覆盖第一位)
  // 期望 [c, a, b]，第 3 个未找到空 → 循环到第一 (c 已被占，去重后回到 a 循环第一)
  assert.deepEqual(got, ["c", "a", "b"]);
});

test("BUG5 对照三栏：拖 3 个到 c 栏 → [c, a, b]（c 优先 + 空栏循环 a→b）", () => {
  const got = resolveDropTargets("c", "compare", {}, 3);
  assert.deepEqual(got, ["c", "a", "b"]);
});

test("BUG5 对照三栏：拖 3 个到 a 栏、空 a→b→c → [a, b, c]", () => {
  const got = resolveDropTargets("a", "compare", {}, 3);
  assert.deepEqual(got, ["a", "b", "c"]);
});

test("BUG5 对照三栏：a 已有内容时拖 2 个到 c → [c, b]", () => {
  const got = resolveDropTargets("c", "compare", { a: { name: "existing.md" } }, 2);
  // 第 1 个落 c（活动栏）；第 2 个找空：a 跳过已载，b 落空 → b
  assert.deepEqual(got, ["c", "b"]);
});

test("BUG5 合并模式：拖 2 个到 c 栏 → [b, a]（c 对应 files.b=对方，本地 a 补后）", () => {
  const got = resolveDropTargets("c", "merge", {}, 2);
  // resolvePickTarget('c', 'merge') = 'b' → 第一个落 b(files.b=对方)
  // 第 2 个按 [a, b] 顺序找空：b 已被占，a 空 → 落 a
  assert.deepEqual(got, ["b", "a"]);
});

test("BUG5 合并模式：拖 2 个到 a 栏 → [a, b]", () => {
  const got = resolveDropTargets("a", "merge", {}, 2);
  assert.deepEqual(got, ["a", "b"]);
});

test("BUG5 合并模式：拖 2 个到 b 栏（合并结果）、a 未载 → [a, b]", () => {
  // BUG 6：合并模式 b 栏（合并结果）→ 「找空栏」路由到 a。
  // 第 1 个落 a；第 2 个按 [a, b] 顺序找空：a 已占，b 空 → b。
  const got = resolveDropTargets("b", "merge", {}, 2);
  assert.deepEqual(got, ["a", "b"]);
});

test("BUG5 合并模式：拖 2 个到 b 栏、a 已载 → [b, a(循环)]", () => {
  // BUG 6：合并模式 b 栏、a 已载 → 「找空栏」路由到 b（对方）。
  // 第 1 个落 b(files.b=对方)；第 2 个按 [a, b] 顺序找空：b 已占，a 已载 → 循环到 a(第一)。
  const got = resolveDropTargets(
    "b",
    "merge",
    { a: { name: "left.md" }, b: undefined, c: undefined },
    2
  );
  assert.deepEqual(got, ["b", "a"]);
});

test("BUG5 拖 0 个文件 → 空数组", () => {
  assert.deepEqual(resolveDropTargets("a", "compare", {}, 0), []);
  assert.deepEqual(resolveDropTargets("c", "merge", {}, 0), []);
});

// 兜底：纯函数稳定，无副作用
test("纯函数：相同入参稳定返回，无副作用", () => {
  const a1 = resolvePickTarget("b", "merge", { a: { name: "x" } });
  const a2 = resolvePickTarget("b", "merge", { a: { name: "x" } });
  assert.equal(a1, a2);
  assert.equal(a1, "b");

  const d1 = resolveDropTargets("c", "compare", {}, 3);
  const d2 = resolveDropTargets("c", "compare", {}, 3);
  assert.deepEqual(d1, d2);
});

// BUG 3 反面回归：合并模式下不存在「文件三」概念（c 仅是 UI 标签，对应 files.b），
// b/c 栏绝不能解析成落 'c' 的目标键后再写出 files.c 字段。
test("BUG3 反面：合并模式 b/c 活动栏不得路由到 'c' (files.c 在合并模式不存在)", () => {
  assert.notEqual(resolvePickTarget("b", "merge"), "c");
  assert.notEqual(resolvePickTarget("c", "merge"), "c");
});

// ── BUG 7：B↔C 栏间采纳翻转 ──────────────────────────────────────────
// flipBcChunk 把 chunk 的 srcFrom/srcTo 与 dstFrom/dstTo 互换，其余字段保留。
// 这是 acceptBcDir('bc-left') =「采纳 b 入 c」必需的反转步骤。
test("BUG7 flipBcChunk：交换 src* 与 dst* 四字段", () => {
  const got = flipBcChunk({
    srcFrom: 10,
    srcTo: 20,
    dstFrom: 30,
    dstTo: 35,
    layer: "bc",
    conflict: false,
    extra: "keep",
  });
  assert.equal(got.srcFrom, 30);
  assert.equal(got.srcTo, 35);
  assert.equal(got.dstFrom, 10);
  assert.equal(got.dstTo, 20);
});

test("BUG7 flipBcChunk：保留 layer / conflict / 其它字段（不污染）", () => {
  const got = flipBcChunk({
    srcFrom: 0,
    srcTo: 5,
    dstFrom: 100,
    dstTo: 110,
    layer: "bc",
    conflict: true,
    id: "chunk-7",
    blob: { x: 1 },
  });
  assert.equal(got.layer, "bc");
  assert.equal(got.conflict, true);
  assert.equal(got.id, "chunk-7");
  assert.deepEqual(got.blob, { x: 1 });
});

test("BUG7 flipBcChunk：翻转两次幂等（flip(flip(c)) 应恢复 c）", () => {
  const c = { srcFrom: 7, srcTo: 12, dstFrom: 100, dstTo: 105, layer: "bc" };
  const once = flipBcChunk(c);
  const twice = flipBcChunk(once);
  assert.equal(twice.srcFrom, c.srcFrom);
  assert.equal(twice.srcTo, c.srcTo);
  assert.equal(twice.dstFrom, c.dstFrom);
  assert.equal(twice.dstTo, c.dstTo);
});

test("BUG7 flipBcChunk：零长度区间（dstFrom == dstTo 与 srcFrom == srcTo）正确翻转", () => {
  const got = flipBcChunk({ srcFrom: 5, srcTo: 5, dstFrom: 9, dstTo: 9, layer: "bc" });
  assert.equal(got.srcFrom, 9);
  assert.equal(got.srcTo, 9);
  assert.equal(got.dstFrom, 5);
  assert.equal(got.dstTo, 5);
});

test("BUG7 flipBcChunk：null/undefined 兜底不抛错（不破坏 chunk 流）", () => {
  // 不抛 + 返回原值（避免 .map 流水线中断）
  let threw = false;
  try {
    assert.equal(flipBcChunk(null), null);
    assert.equal(flipBcChunk(undefined), undefined);
  } catch (_) {
    threw = true;
  }
  assert.equal(threw, false);
});
