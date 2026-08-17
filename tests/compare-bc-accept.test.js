/**
 * compare-bc-accept.test.js — BUG 7 B↔C 逐块采纳「双向 + 越界钳制」算术单测
 *
 * 背景：
 *   code-review-combo 三阶段审计报告（tmp-mde/code-review-combo-bug7-report.json）
 *   第 1 项（Medium）指出：acceptBcChunkAt 的「双向采纳 + 越界钳制」逻辑缺乏单测。
 *   该逻辑原内联在 acceptBcChunkAt 闭包中（依赖真实 EditorView 与 acceptChunk，
 *   node 下不可实例化），故抽成纯函数 computeBcAcceptRange 并由此文件锁定。
 *
 * 覆盖点：
 *   1) 方向语义：dir='right'(◀ 采纳右)=c→b(Theirs→Result)，dir='left'(采纳左 ▶)=b→c(Result→Theirs)
 *   2) 正常区间：offset 在文档长度内 → 原样返回（不钳制）
 *   3) 越界钳制：尾部块 to / src 超过文档长度 → 被 Math.min 钳到 len，绝不返回 > len 的值
 *   4) 非 'right' 方向回退 else 分支（b→c），锁定当前语义，防止误把未知方向当 right
 *   5) 源码契约：acceptBcChunkAt 确实委托 computeBcAcceptRange（防止重构后掉链）
 *
 * 变异验证（开发期已做，不常驻）：临时把 right 分支的 srcSide 改成 'b' → 方向断言精确变红
 *   → 恢复原值 → 全绿。证明本测试能抓到「方向写反」类回归。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeBcAcceptRange } from "../src/compare-merge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src", "compare-merge.js");
const srcCode = readFileSync(SRC, "utf8");

// 去注释（避免 docstring 里的举例被误判为真实代码）
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const code = stripComments(srcCode);

// 一个典型的 B↔C 块：Theirs 侧(src*) 与 Result 侧(dst*) 坐标不对称，
// 便于断言方向映射确实交换了两侧区间。
const CHUNK = { srcFrom: 10, srcTo: 20, dstFrom: 30, dstTo: 35 };
const B_LEN = 100; // Result(mv.b) 文档长度
const C_LEN = 50; // Theirs(theirsView) 文档长度

// ============== 1) 方向语义 ==============

test("dir='right'（◀ 采纳右）→ c→b：src 取自 Theirs 侧(src*)，dst 取到 Result 侧(dst*)", () => {
  const r = computeBcAcceptRange(CHUNK, "right", B_LEN, C_LEN);
  assert.equal(r.srcSide, "c");
  assert.equal(r.srcFrom, CHUNK.srcFrom);
  assert.equal(r.srcTo, CHUNK.srcTo);
  assert.equal(r.dstFrom, CHUNK.dstFrom);
  assert.equal(r.dstTo, CHUNK.dstTo);
});

test("dir='left'（采纳左 ▶）→ b→c：src 取自 Result 侧(dst*)，dst 取到 Theirs 侧(src*)", () => {
  const r = computeBcAcceptRange(CHUNK, "left", B_LEN, C_LEN);
  assert.equal(r.srcSide, "b");
  // 源现在来自块的 Result 侧
  assert.equal(r.srcFrom, CHUNK.dstFrom);
  assert.equal(r.srcTo, CHUNK.dstTo);
  // 目标现在落到块的 Theirs 侧
  assert.equal(r.dstFrom, CHUNK.srcFrom);
  assert.equal(r.dstTo, CHUNK.srcTo);
});

test("双向互为镜像：right 与 left 的 src/dst 区间恰好互换两侧", () => {
  const right = computeBcAcceptRange(CHUNK, "right", B_LEN, C_LEN);
  const left = computeBcAcceptRange(CHUNK, "left", B_LEN, C_LEN);
  // right 把 src=[10,20] 写到 dst=[30,35]；left 把 src=[30,35] 写到 dst=[10,20]
  assert.deepEqual([right.srcFrom, right.srcTo], [left.dstFrom, left.dstTo]);
  assert.deepEqual([right.dstFrom, right.dstTo], [left.srcFrom, left.srcTo]);
  assert.notEqual(right.srcSide, left.srcSide);
});

// ============== 2) 正常区间（不钳制） ==============

test("正常区间：offset 均小于文档长度 → 原样返回，不触发钳制", () => {
  const r = computeBcAcceptRange(CHUNK, "right", B_LEN, C_LEN);
  // Theirs 侧最大 offset=20 < C_LEN(50)，Result 侧最大 offset=35 < B_LEN(100)
  assert.equal(r.srcTo, 20);
  assert.equal(r.dstTo, 35);
});

// ============== 3) 越界钳制 ==============

test("尾部块 srcTo 越界（> C_LEN）→ 钳到 C_LEN", () => {
  const chunk = { srcFrom: 40, srcTo: 60, dstFrom: 30, dstTo: 35 }; // srcTo=60 > C_LEN=50
  const r = computeBcAcceptRange(chunk, "right", B_LEN, C_LEN);
  assert.equal(r.srcTo, C_LEN); // 60 → 50
  assert.equal(r.srcFrom, 40); // 仍在界内
});

test("尾部块 dstTo 越界（> B_LEN）→ 钳到 B_LEN", () => {
  const chunk = { srcFrom: 10, srcTo: 20, dstFrom: 90, dstTo: 130 }; // dstTo=130 > B_LEN=100
  const r = computeBcAcceptRange(chunk, "right", B_LEN, C_LEN);
  assert.equal(r.dstTo, B_LEN); // 130 → 100
  assert.equal(r.dstFrom, 90);
});

test("left 方向同样钳制：Result 侧 srcTo(=chunk.dstTo) 越界 → 钳到 B_LEN", () => {
  const chunk = { srcFrom: 10, srcTo: 20, dstFrom: 90, dstTo: 130 };
  const r = computeBcAcceptRange(chunk, "left", B_LEN, C_LEN);
  // left 的 src 取自 chunk.dst*，dst 取自 chunk.src*
  assert.equal(r.srcSide, "b");
  assert.equal(r.srcTo, B_LEN); // 130 → 100
  assert.equal(r.dstTo, 20); // chunk.srcTo=20 < C_LEN(50) → 保持 20
});

test("钳制边界：offset 精确等于文档长度 → 命中 len（Math.min 不越界）", () => {
  const chunk = { srcFrom: 0, srcTo: C_LEN, dstFrom: 0, dstTo: B_LEN };
  const r = computeBcAcceptRange(chunk, "right", B_LEN, C_LEN);
  assert.equal(r.srcTo, C_LEN);
  assert.equal(r.dstTo, B_LEN);
  // 所有返回值都 <= 对应文档长度
  assert.ok(r.srcFrom <= C_LEN && r.srcTo <= C_LEN);
  assert.ok(r.dstFrom <= B_LEN && r.dstTo <= B_LEN);
});

test("钳制不变量：任意 chunk + 任意长度，返回值永不超过对应文档长度（防 RangeError）", () => {
  const samples = [
    { chunk: { srcFrom: 999, srcTo: 9999, dstFrom: 888, dstTo: 8888 }, b: 100, c: 50 },
    { chunk: { srcFrom: 0, srcTo: 10, dstFrom: 0, dstTo: 20 }, b: 100, c: 50 },
    { chunk: { srcFrom: 0, srcTo: 0, dstFrom: 0, dstTo: 0 }, b: 1, c: 1 },
  ];
  for (const { chunk, b, c } of samples) {
    for (const dir of ["left", "right"]) {
      const r = computeBcAcceptRange(chunk, dir, b, c);
      assert.ok(r.srcFrom >= 0 && r.srcTo >= 0, `src 区间非负 (dir=${dir})`);
      assert.ok(r.dstFrom >= 0 && r.dstTo >= 0, `dst 区间非负 (dir=${dir})`);
      const srcLen = r.srcSide === "c" ? c : b;
      const dstLen = r.srcSide === "c" ? b : c;
      assert.ok(r.srcTo <= srcLen, `srcTo<=${srcLen} (dir=${dir})`);
      assert.ok(r.dstTo <= dstLen, `dstTo<=${dstLen} (dir=${dir})`);
    }
  }
});

// ============== 4) 非 'right' 方向回退 ==============

test("非 'right' 方向（含 undefined / 未知串）→ 回退 else 分支(b→c, srcSide='b')", () => {
  for (const dir of [undefined, "left", "foo", "RIGHT", ""]) {
    const r = computeBcAcceptRange(CHUNK, dir, B_LEN, C_LEN);
    assert.equal(r.srcSide, "b", `方向=${JSON.stringify(dir)} 应回退 b→c`);
    assert.equal(r.srcFrom, CHUNK.dstFrom);
    assert.equal(r.dstFrom, CHUNK.srcFrom);
  }
});

// ============== 5) 源码契约：acceptBcChunkAt 委托 computeBcAcceptRange ==============

test("源码契约：acceptBcChunkAt 调用 computeBcAcceptRange(target, dir, bLen, cLen)", () => {
  assert.ok(
    /function acceptBcChunkAt\(i, dir\)\s*\{[\s\S]*?computeBcAcceptRange\(target, dir, bLen, cLen\)/.test(
      code
    ),
    "acceptBcChunkAt 应委托 computeBcAcceptRange(target, dir, bLen, cLen)"
  );
});

test("源码契约：computeBcAcceptRange 为已导出纯函数", () => {
  assert.ok(
    /export function computeBcAcceptRange\(chunk, dir, bLen, cLen\)/.test(code),
    "computeBcAcceptRange 必须导出，供本单测与被测代码共用"
  );
});
