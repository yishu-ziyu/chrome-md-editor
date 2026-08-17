// compare-line-markers.js — 行号差异标记（T2）
//
// 思路（抄 manaflow diff-line-number-markers，仅改 import 为 @codemirror/merge）：
//   用 getChunks(state) 计算差异块，给差异块覆盖的行追加行级高亮类
//   （cm-compare-line-removed / cm-compare-line-added），并在自定义 gutter 上标记「− / +」。
//
// 兼容 MergeView 的 a / b 面板（side='a'|'b'）：
//   - side='a' 面板：差异行标记为「删除（相对 b）」，整行高亮 REMOVED_CLASS；不标新增。
//   - side='b' 面板（两栏/三栏的 Theirs）：差异行标记为「新增（相对 a）」，整行高亮 ADDED_CLASS；不标删除（b 面板无 A 内容）。
//   - side='b'：文档为 B，新增行高亮 ADDED_CLASS 照常（[fromB,toB)），删除内容由 CM 自带 deletedChunks widget 显示，无需自研整行高亮。
//
// 导出：
//   applyCompareLineMarkers() -> Extension[]   （工厂，便于调用方注入 extensions）
//   compareLineMarkers        -> Extension[]   （同上的常量化）
//
// 注意：getChunks 仅在编辑器挂载了 merge 扩展时返回非空；本扩展对普通编辑器安全降级（无标记）。

import { getChunks } from "@codemirror/merge";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  ViewPlugin,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const REMOVED_CLASS = "cm-compare-line-removed";
const ADDED_CLASS = "cm-compare-line-added";

/**
 * 为给定文档区间 [from, to) 内的每一行生成 line 装饰（追加到 builder）。
 * @param {import('@codemirror/view').EditorView} view
 * @param {number} from
 * @param {number} to
 * @param {string} cls
 * @param {RangeSetBuilder<any>} builder
 */
function markRangeLines(view, from, to, cls, builder) {
  if (from === to) return;
  let pos = from;
  const doc = view.state.doc;
  while (pos < to && pos <= doc.length) {
    const line = doc.lineAt(pos);
    builder.add(line.from, line.from, Decoration.line({ class: cls }));
    pos = line.to + 1;
  }
}

/**
 * 计算当前视图的差异行装饰（基于 getChunks）。
 * @param {import('@codemirror/view').EditorView} view
 * @returns {import('@codemirror/view').DecorationSet}
 */
export function computeChunkDecorations(view) {
  const res = getChunks(view.state);
  if (!res || !res.chunks.length) return Decoration.none;
  const builder = new RangeSetBuilder();
  const side = res.side;
  for (const chunk of res.chunks) {
    // 删除行整行高亮：仅 a 面板（side==='a'，文档为 A）对 [fromA,toA) 打 REMOVED_CLASS。
    // side==='b'（b 面板，即两栏/三栏的 Theirs）文档为 B，[fromA,toA) 无法映射到 B 文档，
    // 且删除内容已由 CM 自带 deletedChunks widget 显示，故此处不打整行高亮。
    if (side === "a") markRangeLines(view, chunk.fromA, chunk.toA, REMOVED_CLASS, builder);
    // 当前侧（B）行：标记为新增（a 面板 side==='a' 不打，b 面板打）
    if (side !== "a") markRangeLines(view, chunk.fromB, chunk.toB, ADDED_CLASS, builder);
  }
  return builder.finish();
}

/** 差异行高亮 ViewPlugin */
const compareLineDecoPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = computeChunkDecorations(view);
    }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = computeChunkDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/** 自定义差异块 gutter：在差异行处显示 − / + 标记 */
class CompareChunkMarker extends GutterMarker {
  /**
   * @param {string} sign
   */
  constructor(sign) {
    super();
    this.sign = sign;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-compare-chunk-marker";
    el.textContent = this.sign;
    return el;
  }
}

const compareChunkGutter = gutter({
  class: "cm-compare-chunk-gutter",
  lineMarker(view, line) {
    const res = getChunks(view.state);
    if (!res) return null;
    const side = res.side;
    const lf = line.from;
    if (side === "a") {
      // A 面板（两/三栏 Yours，文档即 A）：行位置是 A 坐标，比对 fromA/toA。
      // 纯新增（fromA==toA && fromB!=toB）在 A 面板无对应行，不显示。
      for (const chunk of res.chunks) {
        const fromA = chunk.fromA;
        const toA = chunk.toA;
        const fromB = chunk.fromB;
        const toB = chunk.toB;
        // 修改块（A 有删除且 B 有新增）→ ±
        if (fromA !== toA && fromB !== toB && lf >= fromA && lf < toA) {
          return new CompareChunkMarker("±");
        }
        // 纯删除（A 有删除，B 无对应新增）→ −
        if (fromA !== toA && lf >= fromA && lf < toA) {
          return new CompareChunkMarker("−");
        }
      }
      return null;
    }
    // 其余（side==='b' 或 undefined，即 b 面板）：行位置是 B 坐标，比对 fromB/toB。
    for (const chunk of res.chunks) {
      const fromA = chunk.fromA;
      const toA = chunk.toA;
      const fromB = chunk.fromB;
      const toB = chunk.toB;
      // 修改块（A 有删除且 B 有新增）→ ±（删除内容以 deletedChunks widget 显示于 [fromB,toB) 上方）
      if (fromA !== toA && fromB !== toB && lf >= fromB && lf < toB) {
        return new CompareChunkMarker("±");
      }
      // 纯删除（A 有删除，B 无对应新增）→ −
      if (fromA !== toA && lf >= fromB && lf < toB) {
        return new CompareChunkMarker("−");
      }
      // 纯新增（B 有新增）→ +
      if (fromB !== toB && lf >= fromB && lf < toB) {
        return new CompareChunkMarker("+");
      }
    }
    return null;
  },
  lineMarkerChange() {
    return true;
  },
});

/** @type {import('@codemirror/state').Extension[]} */
const compareLineMarkers = [compareLineDecoPlugin, compareChunkGutter];

/**
 * 工厂：返回行号差异标记的 CodeMirror 扩展数组（供 compare-merge.js 注入）。
 * @returns {import('@codemirror/state').Extension[]}
 */
export function applyCompareLineMarkers() {
  return compareLineMarkers;
}

export { compareLineMarkers };
