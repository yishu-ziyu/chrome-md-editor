/**
 * compare-move-decorations.test.js — 移动块蓝色背景装饰（src/compare/move-decorations.js）单元测试
 *
 * 不依赖 DOM：用 @codemirror/state 的 Text.of(...) 造真实文档，
 * 再给 buildMoveDecorations 传一个最小 view 桩件 { state: { doc, field() } }，
 * 这样 doc.line(n) / doc.lines 都是真的，能验证 RangeSetBuilder 的顺序与去重。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Text } from "@codemirror/state";

import { buildMoveDecorations } from "../src/compare/move-decorations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/**
 * 造一个最小 view 桩件。
 * @param {string[]} lines 文档各行（不含换行符）
 * @param {'a'|'b'} side
 * @param {Array<object>} pairs
 */
function makeView(lines, side, pairs) {
  const doc = Text.of(lines);
  return {
    state: {
      doc,
      // buildMoveDecorations 调用 view.state.field(moveBlockField, false)
      field() {
        return { pairs, side };
      },
    },
  };
}

/** 收集装饰集里所有 from 位置，升序返回。 */
function collectFroms(set) {
  const out = [];
  const it = set.iter();
  while (it.value) {
    out.push(it.from);
    it.next();
  }
  return out.sort((a, b) => a - b);
}

/** 期望行号 -> 真实 from 位置。 */
function lineFroms(doc, lineNumbers) {
  return lineNumbers.map((n) => doc.line(n).from).sort((a, b) => a - b);
}

test("乱序回归(core)：side='b' 时 dst 行号倒置也不抛错且恰好覆盖 1,2,9,10 行", () => {
  // 10 行文档
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  const doc = Text.of(lines);
  const pairs = [
    { srcStartLine: 1, srcEndLine: 2, dstStartLine: 9, dstEndLine: 10 },
    { srcStartLine: 5, srcEndLine: 6, dstStartLine: 1, dstEndLine: 2 },
  ];
  const view = makeView(lines, "b", pairs);

  // 旧实现会在 builder.add 时抛 "Ranges must be added sorted"，这里必须不抛
  let set;
  assert.doesNotThrow(() => {
    set = buildMoveDecorations(view);
  });

  const actual = collectFroms(set);
  const expected = lineFroms(doc, [1, 2, 9, 10]);
  assert.deepEqual(actual, expected);
});

test("side='a' 只画 src 区间，绝不出现 dst 行", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  const doc = Text.of(lines);
  const pairs = [
    { srcStartLine: 1, srcEndLine: 2, dstStartLine: 9, dstEndLine: 10 },
    { srcStartLine: 5, srcEndLine: 6, dstStartLine: 1, dstEndLine: 2 },
  ];
  const view = makeView(lines, "a", pairs);

  const actual = collectFroms(buildMoveDecorations(view));
  const expected = lineFroms(doc, [1, 2, 5, 6]); // 仅 src 区间
  assert.deepEqual(actual, expected);

  // dst 专属行（9,10）绝对不能出现
  const dstFroms = lineFroms(doc, [9, 10]);
  for (const f of dstFroms) assert.ok(!actual.includes(f), `dst 行不应被装饰: ${f}`);
});

test("side='b' 只画 dst 区间，绝不出现 src 行", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  const doc = Text.of(lines);
  const pairs = [
    { srcStartLine: 1, srcEndLine: 2, dstStartLine: 9, dstEndLine: 10 },
    { srcStartLine: 5, srcEndLine: 6, dstStartLine: 1, dstEndLine: 2 },
  ];
  const view = makeView(lines, "b", pairs);

  const actual = collectFroms(buildMoveDecorations(view));
  const expected = lineFroms(doc, [1, 2, 9, 10]); // 仅 dst 区间
  assert.deepEqual(actual, expected);

  // src 专属行（5,6）绝对不能出现
  const srcFroms = lineFroms(doc, [5, 6]);
  for (const f of srcFroms) assert.ok(!actual.includes(f), `src 行不应被装饰: ${f}`);
});

test("两个 pair 区间重叠同一行时，该行只装饰一次（去重）", () => {
  // 5 行文档
  const lines = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);
  const doc = Text.of(lines);
  const pairs = [
    { srcStartLine: 2, srcEndLine: 4 }, // 行 2,3,4
    { srcStartLine: 3, srcEndLine: 5 }, // 行 3,4,5 -> 并集 {2,3,4,5}
  ];
  const view = makeView(lines, "a", pairs);

  const actual = collectFroms(buildMoveDecorations(view));
  const expected = lineFroms(doc, [2, 3, 4, 5]);
  assert.deepEqual(actual, expected);
  // 装饰总数应等于去重后的行数（4），而非 6
  assert.equal(actual.length, 4);
  // 且 from 互不重复
  assert.equal(new Set(actual).size, actual.length);
});

test("行号越界时 clamp 到末行，不抛错", () => {
  const lines = Array.from({ length: 3 }, (_, i) => `line ${i + 1}`);
  const doc = Text.of(lines);
  // dstEndLine=10 远超 doc.lines(3)
  const pairs = [{ dstStartLine: 1, dstEndLine: 10 }];
  const view = makeView(lines, "b", pairs);

  let set;
  assert.doesNotThrow(() => {
    set = buildMoveDecorations(view);
  });

  const actual = collectFroms(set);
  const expected = lineFroms(doc, [1, 2, 3]); // 被 clamp 到末行
  assert.deepEqual(actual, expected);
});

test("pairs 为空时返回空装饰集", () => {
  const lines = ["a", "b", "c"];
  const view = makeView(lines, "a", []);
  const set = buildMoveDecorations(view);
  assert.deepEqual(collectFroms(set), []);
});

test("side 非法值静默降级为 'a'（只画 src）", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  const doc = Text.of(lines);
  const pairs = [
    { srcStartLine: 1, srcEndLine: 2, dstStartLine: 9, dstEndLine: 10 },
    { srcStartLine: 5, srcEndLine: 6, dstStartLine: 1, dstEndLine: 2 },
  ];
  // 传入非法 side
  const view = makeView(lines, "zzz", pairs);

  const actual = collectFroms(buildMoveDecorations(view));
  const expected = lineFroms(doc, [1, 2, 5, 6]); // 按 'a' 处理
  assert.deepEqual(actual, expected);
});

// ────────────────────────────────────────────────────────────────────────
// 移动块底色的【层叠优先级】回归断言
//
// 真机点检 5-C 暴露：装饰打得完全正确（.cm-move-block 类确实在 DOM 上），
// 但取到的背景色是 rgba(248,81,73,.12)（浅红）而不是蓝。
//
// 根因是纯 CSS 层叠问题，单元测试如果只验证「装饰位置对不对」是抓不到的：
//   · 移动 = 一侧删除 + 另一侧新增，所以移动块的行【必然】同时被
//     @codemirror/merge 打上 .cm-changedLine；
//   · compare.css 里 changedLine 的红/绿规则特异性是 1-3-0；
//   · 而蓝底原本只由 move-decorations.js 的 baseTheme 提供，特异性 0-1-0，
//     且 baseTheme 按 CodeMirror 的设计就是「供用户覆盖」的最低层。
// 结果蓝底 100% 被压死，移动检测算得再准，用户一个像素也看不见。
//
// 因此 compare.css 必须有一条足够高优先级的 .cm-move-block 规则。本断言就是
// 防止后人「清理重复样式」时把它删掉，从而静默退回全红。
// ────────────────────────────────────────────────────────────────────────
test("compare.css 必须为 .cm-move-block 提权，否则蓝底会被 changedLine 的红/绿压死", () => {
  const css = fs.readFileSync(
    path.join(projectRoot, "src", "compare.css"),
    "utf8",
  );
  // 先剥注释：本文件的说明性注释里也会出现 .cm-move-block 字样，会干扰匹配
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const m = cssNoComment.match(/([^{}]*\.cm-move-block[^{}]*)\{([^}]*)\}/);
  assert.ok(
    m,
    "compare.css 中必须存在 .cm-move-block 的样式规则（仅靠 move-decorations.js 的 baseTheme 会被压死）",
  );

  const [, selector, body] = m;
  assert.ok(
    selector.includes("#compareRoot"),
    "选择器必须用 #compareRoot 提权到 1-x-0，否则压不过 changedLine 的 1-3-0。当前选择器：" +
      selector.trim(),
  );
  assert.ok(
    selector.includes(".cm-line"),
    "选择器必须带 .cm-line 把特异性抬到 1-4-0（严格高于 changedLine 的 1-3-0）。当前选择器：" +
      selector.trim(),
  );
  assert.match(
    body,
    /background-color\s*:\s*var\(--diff-move-bg/,
    "移动块底色必须走 --diff-move-bg 变量，保证亮/暗主题各自取到对应色值",
  );
});

test("--diff-move-bg 变量必须在亮/暗两种主题下都有定义", () => {
  const css = fs.readFileSync(
    path.join(projectRoot, "src", "compare.css"),
    "utf8",
  );
  const hits = css.match(/--diff-move-bg\s*:/g) || [];
  assert.ok(
    hits.length >= 2,
    `--diff-move-bg 至少应定义 2 次（亮色 + 暗色主题各一），实际 ${hits.length} 次。` +
      "只定义一次会导致暗色主题下移动块底色对比度不足",
  );
});
