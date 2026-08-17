// move-decorations.js — 移动块蓝色背景装饰（行级 line decoration）
//
// 配合 move-detect 的 detectMoves(aLines, bLines, chunks, opts) -> { pairs, truncated }
// 把检测到的「移动块」用蓝色背景标识出来。
//
// 【坐标系独立｜关键约束】
//   pair 里 srcStartLine/srcEndLine 属于 **A 文档**（被比较的原文档），
//   dstStartLine/dstEndLine 属于 **B 文档**（结果文档），二者坐标系独立。
//   MergeView 的 a、b 是两个独立 EditorView，各自持有各自的文档。
//   因此绝不能在同一 view 上同时画 src 与 dst：
//     - side === 'a'：只画 src 区间（srcStartLine..srcEndLine）
//     - side === 'b'：只画 dst 区间（dstStartLine..dstEndLine）
//   调用方应分别在 a 视图、b 视图挂载本扩展，并传入对应 side。
//
// 装饰样式由 CSS 变量 --diff-move-bg 提供（默认半透明蓝），可随主题（含豆沙绿皮肤）切换。
//
// 本期只做蓝色背景标识，不画连线；SVG 连线属于第三期。

import { StateField, StateEffect, RangeSetBuilder, Facet } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

/**
 * @typedef {Object} MovePair
 * @property {number} srcFrom      源区间起始字符偏移（仅由 move-detection 提供，本模块不使用）
 * @property {number} srcTo        源区间结束字符偏移（同上）
 * @property {number} dstFrom      目标区间起始字符偏移（同上）
 * @property {number} dstTo        目标区间结束字符偏移（同上）
 * @property {number} srcStartLine 源区间起始行号（A 文档，1-based 闭区间，含）
 * @property {number} srcEndLine   源区间结束行号（A 文档，1-based 闭区间，含）
 * @property {number} dstStartLine 目标区间起始行号（B 文档，1-based 闭区间，含）
 * @property {number} dstEndLine   目标区间结束行号（B 文档，1-based 闭区间，含）
 * @property {string} [text]       移动块文本（仅用于展示/调试）
 */

/** 规范化 side：非 'a'/'b' 一律按 'a' 处理，静默降级不抛错。 */
function normalizeSide(side) {
  return side === "b" ? "b" : "a";
}

/**
 * 用于设置视图所属侧的初始值（'a' | 'b'），供 moveBlockField.create 读取。
 * 没有显式提供时默认 'a'。
 * @type {import('@codemirror/state').Facet<string, string>}
 */
const moveSideFacet = Facet.define({
  combine(values) {
    return values.length ? normalizeSide(values[values.length - 1]) : "a";
  },
});

/**
 * 存 { pairs, side } 的 StateField：
 *   - pairs：MovePair[]（由 move-detect 产出）
 *   - side ：'a' | 'b'，标记本视图属于哪一侧；'a' 只画 src 区间，'b' 只画 dst 区间
 * @type {import('@codemirror/state').StateField<{ pairs: MovePair[]; side: 'a' | 'b' }>}
 */
export const moveBlockField = StateField.define({
  create(state) {
    return { pairs: [], side: state.facet(moveSideFacet) };
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setMoveBlocksEffect)) {
        return {
          pairs: e.value.pairs,
          side: normalizeSide(e.value.side),
        };
      }
    }
    return value;
  },
});

/** 设置移动块的 StateEffect。value 为 { pairs: MovePair[], side: 'a' | 'b' }。 */
export const setMoveBlocksEffect = StateEffect.define();

/** 单例 line 装饰。 */
const moveDeco = Decoration.line({ class: "cm-move-block" });

/**
 * 取某 pair 在给定 side 下的 [start, end] 行号区间（1-based 闭区间）。
 * @param {MovePair} pair
 * @param {'a' | 'b'} side
 * @returns {[number, number]}
 */
function rangeForSide(pair, side) {
  if (side === "a") {
    return [pair.srcStartLine, pair.srcEndLine];
  }
  return [pair.dstStartLine, pair.dstEndLine];
}

/**
 * 遍历 pairs，按 side 只画「本侧」区间的蓝色背景 line 装饰：
 *   - side==='a'：只画 src 区间（srcStartLine..srcEndLine，A 文档坐标）
 *   - side==='b'：只画 dst 区间（dstStartLine..dstEndLine，B 文档坐标）
 * 绝不在同一 view 上绘制另一侧区间，避免跨文档坐标系错位。
 *
 * 实现采用「先收集 → 去重 → 排序 → 再 add」三段式：
 *   pairs 按 srcFrom 升序，但 side==='b' 时 dst 行号序列可能乱序，
 *   而 RangeSetBuilder.add 要求位置严格非递减，故必须收集后排序再 add。
 *   Set 天然去重，避免多个 pair 覆盖同一行时重复 add 同一位置。
 *
 * @param {import('@codemirror/view').EditorView} view
 * @returns {import('@codemirror/view').DecorationSet}
 */
export function buildMoveDecorations(view) {
  const state = view.state.field(moveBlockField, false);
  const builder = new RangeSetBuilder();
  if (!state || !state.pairs || state.pairs.length === 0) {
    return builder.finish();
  }

  const side = normalizeSide(state.side);
  const totalLines = view.state.doc.lines;

  // 1) 收集 + clamp 到 [1, doc.lines] + 去重
  const lineSet = new Set();
  for (const pair of state.pairs) {
    const [rawFrom, rawTo] = rangeForSide(pair, side);
    const nFrom = Math.max(1, Math.min(rawFrom, totalLines));
    const nTo = Math.max(1, Math.min(rawTo, totalLines));
    if (nFrom > nTo) continue;
    for (let n = nFrom; n <= nTo; n++) lineSet.add(n);
  }

  // 2) 按行号升序排序（保证 RangeSetBuilder 严格非递减）
  const sorted = Array.from(lineSet).sort((a, b) => a - b);

  // 3) 依次 add；仅单次 doc.line(n) 调用保留防御性 catch（用 error 暴露编程错误）
  for (const n of sorted) {
    try {
      const line = view.state.doc.line(n);
      builder.add(line.from, line.from, moveDeco);
    } catch (err) {
      console.error("[move-decorations] doc.line(%d) failed:", n, err);
    }
  }

  return builder.finish();
}

/** ViewPlugin：构建并缓存移动块装饰。 */
export const moveDecorationsPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildMoveDecorations(view);
    }
    update(update) {
      if (
        update.docChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setMoveBlocksEffect))
        )
      ) {
        this.decorations = buildMoveDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/** 移动块蓝色背景主题。 */
export const moveBlockTheme = EditorView.baseTheme({
  ".cm-move-block": {
    backgroundColor: "var(--diff-move-bg, rgba(56,139,253,0.22))",
  },
  "&dark .cm-move-block": {
    backgroundColor: "var(--diff-move-bg, rgba(56,139,253,0.30))",
  },
});

/**
 * 组合扩展。
 * @param {{ side?: 'a' | 'b' }} [opts] side 标记本视图属于哪一侧；
 *         'a'（默认）只画 src 区间，'b' 只画 dst 区间。
 *         该值作为 moveBlockField 的初始 side（之后可被 setMoveBlocks 覆盖）。
 * @returns {import('@codemirror/state').Extension[]}
 */
export function moveDecorationsExtension({ side = "a" } = {}) {
  return [
    moveSideFacet.of(normalizeSide(side)),
    moveBlockField,
    moveDecorationsPlugin,
    moveBlockTheme,
  ];
}

/**
 * 辅助：设置移动块。
 * @param {import('@codemirror/view').EditorView} view
 * @param {MovePair[]} pairs
 * @param {'a' | 'b'} [side='a'] 本视图所属侧；side==='a' 只画 src，'b' 只画 dst
 */
export function setMoveBlocks(view, pairs, side = "a") {
  view.dispatch({
    effects: setMoveBlocksEffect.of({ pairs, side: normalizeSide(side) }),
  });
}
