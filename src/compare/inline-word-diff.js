// inline-word-diff.js — 行内字词级差异装饰（inline word / char diff）
//
// ============================================================================
// 【移植来源】udamir/api-diff-viewer —— MIT License
//   https://github.com/udamir/api-diff-viewer  (branch: master)
//   - src/codemirror/extensions/word-diff.ts        （主体：StateField + ViewPlugin + mark 装饰）
//   - src/codemirror/extensions/inline-word-diff.ts （参考：config field、排序、主题变量写法）
//   Copyright (c) udamir，原始许可证见上游仓库 LICENSE（MIT）。
//
// 【相对上游的改动】
//   1. TypeScript → ESM JavaScript；接口类型改用 JSDoc @typedef 表达。
//   2. 移除对上游私有类型 `LineMapping`（../types）的依赖，helper 改为直接接收行数组，
//      不再耦合 api-diff-viewer 自己的行映射结构。
//   3. 合并上游两个文件，只保留 Decoration.mark 方案（word-diff.ts）；
//      未移植 inline-word-diff.ts 里的 RemovedTextWidget（把删除文本当 widget 插进 after 行）——
//      本项目用 @codemirror/merge 的 MergeView 双栏展示，删除内容已由左栏 / deletedChunks 呈现，
//      再插 widget 会和 MergeView 的行对齐打架。
//   4. 修复上游隐患：RangeSetBuilder 要求按文档位置升序添加，而上游 buildWordDiffDecorations
//      未对 data 及 ranges 排序，外部传入乱序数据会直接抛错；此处先排序再构建。
//   5. 越界处理由「整段丢弃」改为「裁剪到行尾」：diff 包的 diffWords 会做空白归一化，
//      偶发导致 offset 略微溢出，裁剪比丢弃更稳，不会整行丢高亮。
//   6. 导出命名按本项目约定调整：
//      setWordDiffDataEffect → setWordDiffEffect，wordDiff() → inlineWordDiffExtension(config)。
//
// 【依赖提醒 —— 请主 Agent 处理】
//   本文件 import 了 npm 包 `diff`，但当前 package.json 的 dependencies 中【尚未声明】它。
//   本文件不擅自改 package.json，请主 Agent 补上：
//       npm i diff
//   建议 ^7 或更高（v7+ 重写过 diffWords，才保证各分片 value 能无损拼回原字符串；
//   v5/v6 的空白归一化会让 offset 漂移，虽然本文件已做裁剪兜底，但仍建议用新版）。
//
// 【适用范围】
//   两栏（MergeView 的 a / b 面板）完整可用；三栏（Base / Yours / Theirs）尽力适配 ——
//   每个面板本就是独立 EditorView，各自注入本扩展并分别 dispatch setWordDiffEffect 即可。
//   移动块连线（moved chunk 连接线）不在本期范围内。
//
// 【用法示例】
//   import { inlineWordDiffExtension, computeWordDiff, setWordDiffEffect }
//     from "./compare/inline-word-diff.js";
//
//   // 1) 装配扩展
//   const extensions = [ ...others, ...inlineWordDiffExtension({ mode: "word" }) ];
//
//   // 2) 算出某个修改行的字词级 ranges，推给对应面板
//   const { beforeRanges, afterRanges } = computeWordDiff(oldLine, newLine, "word");
//   viewA.dispatch({ effects: setWordDiffEffect.of([{ lineNumber: 12, ranges: beforeRanges }]) });
//   viewB.dispatch({ effects: setWordDiffEffect.of([{ lineNumber: 12, ranges: afterRanges }]) });
// ============================================================================

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { diffChars, diffWords } from "diff";

/**
 * 行内某一段被改动的区间（偏移量相对【行首】，不是文档绝对位置）。
 * @typedef {Object} WordDiffRange
 * @property {number} from 相对行首的起始偏移
 * @property {number} to   相对行首的结束偏移（不含）
 * @property {'added'|'removed'} type 该区间是新增还是删除
 */

/**
 * 一行的字词级差异数据。
 * @typedef {Object} WordDiffData
 * @property {number} lineNumber 行号，1-based（对应 doc.line(lineNumber)）
 * @property {WordDiffRange[]} ranges 该行内所有改动区间
 */

/**
 * 扩展配置。
 * @typedef {Object} WordDiffConfig
 * @property {'word'|'char'} mode 差异粒度：按词或按字符
 */

const ADDED_CLASS = "cm-diff-word-added";
const REMOVED_CLASS = "cm-diff-word-removed";

// ---------------------------------------------------------------------------
// 计算：字符串级字词 diff
// ---------------------------------------------------------------------------

/**
 * 计算两个字符串之间的字词级 / 字符级差异。
 *
 * 返回的偏移量分别相对 `before` 和 `after` 两个字符串的开头，
 * 因此可以直接用于左右两个面板（左栏用 beforeRanges，右栏用 afterRanges）。
 *
 * @param {string} before 变更前文本（通常是左栏 / A 侧的一行）
 * @param {string} after  变更后文本（通常是右栏 / B 侧的一行）
 * @param {'word'|'char'} [mode='word'] 差异粒度
 * @returns {{ beforeRanges: WordDiffRange[], afterRanges: WordDiffRange[] }}
 */
export function computeWordDiff(before, after, mode = "word") {
  /** @type {WordDiffRange[]} */
  const beforeRanges = [];
  /** @type {WordDiffRange[]} */
  const afterRanges = [];

  const beforeText = typeof before === "string" ? before : "";
  const afterText = typeof after === "string" ? after : "";
  if (beforeText === afterText) return { beforeRanges, afterRanges };

  const diffFn = mode === "char" ? diffChars : diffWords;
  const changes = diffFn(beforeText, afterText) || [];

  let beforeOffset = 0;
  let afterOffset = 0;

  for (const change of changes) {
    const length = change.value.length;
    if (!length) continue;

    if (change.removed) {
      // 只存在于 before：记为删除，仅推进 beforeOffset
      beforeRanges.push({ from: beforeOffset, to: beforeOffset + length, type: "removed" });
      beforeOffset += length;
    } else if (change.added) {
      // 只存在于 after：记为新增，仅推进 afterOffset
      afterRanges.push({ from: afterOffset, to: afterOffset + length, type: "added" });
      afterOffset += length;
    } else {
      // 两侧共有：同时推进
      beforeOffset += length;
      afterOffset += length;
    }
  }

  return { beforeRanges, afterRanges };
}

/**
 * 便捷 helper：把成对的行数组批量算成 WordDiffData[]。
 *
 * 按【下标】配对 beforeLines[i] 与 afterLines[i]，适合喂一个已对齐的修改块
 * （例如 @codemirror/merge 的一个 chunk 内、A 与 B 行数相同的部分）。
 * 内容相同或任一侧为空的行会被跳过（整行增删交给行级高亮，不需要字词高亮）。
 *
 * @param {string[]} beforeLines 变更前的行内容
 * @param {string[]} afterLines  变更后的行内容
 * @param {'before'|'after'} side 生成哪一侧的数据
 * @param {number} [startLineNumber=1] 这批行在目标文档中的起始行号（1-based）
 * @param {'word'|'char'} [mode='word'] 差异粒度
 * @returns {WordDiffData[]}
 */
export function buildWordDiffData(beforeLines, afterLines, side, startLineNumber = 1, mode = "word") {
  /** @type {WordDiffData[]} */
  const result = [];
  const count = Math.min(beforeLines.length, afterLines.length);

  for (let i = 0; i < count; i++) {
    const beforeLine = beforeLines[i] || "";
    const afterLine = afterLines[i] || "";
    if (!beforeLine || !afterLine || beforeLine === afterLine) continue;

    const { beforeRanges, afterRanges } = computeWordDiff(beforeLine, afterLine, mode);
    const ranges = side === "before" ? beforeRanges : afterRanges;
    if (ranges.length) result.push({ lineNumber: startLineNumber + i, ranges });
  }

  return result;
}

// ---------------------------------------------------------------------------
// 状态：数据 field + config field + effect
// ---------------------------------------------------------------------------

/**
 * 设置字词级差异数据的 Effect。
 * dispatch 时传入 WordDiffData[]，会整体替换当前面板的数据（传 [] 即清空）。
 * @type {import('@codemirror/state').StateEffectType<WordDiffData[]>}
 */
export const setWordDiffEffect = StateEffect.define();

/** 修改扩展配置的 Effect（可选，一般在初始化时用 inlineWordDiffExtension 传即可） */
export const setWordDiffConfigEffect = StateEffect.define();

/**
 * 存放当前面板全部字词级差异数据的 StateField。
 * @type {StateField<WordDiffData[]>}
 */
export const wordDiffDataField = StateField.define({
  create() {
    return [];
  },
  update(data, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setWordDiffEffect)) {
        return Array.isArray(effect.value) ? effect.value : [];
      }
    }
    return data;
  },
});

/**
 * 存放差异粒度配置的 StateField，供调用方读取统一的 mode：
 *   const { mode } = view.state.field(wordDiffConfigField);
 * @type {StateField<WordDiffConfig>}
 */
export const wordDiffConfigField = StateField.define({
  create() {
    return { mode: "word" };
  },
  update(config, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setWordDiffConfigEffect)) return effect.value;
    }
    return config;
  },
});

// ---------------------------------------------------------------------------
// 渲染：Decoration + ViewPlugin
// ---------------------------------------------------------------------------

const addedMark = Decoration.mark({ class: ADDED_CLASS });
const removedMark = Decoration.mark({ class: REMOVED_CLASS });

/**
 * 把 WordDiffData[] 规范化成「按行号升序、行内按 from 升序」的形式。
 * RangeSetBuilder 强制要求升序添加，外部传入的数据不保证有序，故必须先排。
 * @param {WordDiffData[]} data
 * @returns {WordDiffData[]}
 */
function normalizeData(data) {
  return data
    .filter((d) => d && Number.isFinite(d.lineNumber) && Array.isArray(d.ranges) && d.ranges.length)
    .map((d) => ({
      lineNumber: d.lineNumber,
      ranges: [...d.ranges].sort((a, b) => a.from - b.from || a.to - b.to),
    }))
    .sort((a, b) => a.lineNumber - b.lineNumber);
}

/**
 * 依据 state 中的 WordDiffData[] 构建行内装饰集合。
 * @param {EditorView} view
 * @returns {import('@codemirror/view').DecorationSet}
 */
export function buildWordDiffDecorations(view) {
  const data = view.state.field(wordDiffDataField, false);
  if (!data || !data.length) return Decoration.none;

  const doc = view.state.doc;
  const builder = new RangeSetBuilder();

  for (const lineData of normalizeData(data)) {
    if (lineData.lineNumber < 1 || lineData.lineNumber > doc.lines) continue;
    const line = doc.line(lineData.lineNumber);

    for (const range of lineData.ranges) {
      // 裁剪到行边界：diffWords 的空白归一化可能让 offset 略微溢出，
      // 裁剪比丢弃更稳（否则整行高亮会消失）。
      const from = Math.max(line.from + range.from, line.from);
      const to = Math.min(line.from + range.to, line.to);
      if (from >= to) continue;
      builder.add(from, to, range.type === "removed" ? removedMark : addedMark);
    }
  }

  return builder.finish();
}

/** 行内字词差异的 ViewPlugin：文档变化或收到 setWordDiffEffect 时重建装饰 */
const wordDiffPlugin = ViewPlugin.fromClass(
  class {
    /** @param {EditorView} view */
    constructor(view) {
      this.decorations = buildWordDiffDecorations(view);
    }

    /** @param {import('@codemirror/view').ViewUpdate} update */
    update(update) {
      const effectFired = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setWordDiffEffect) || e.is(setWordDiffConfigEffect))
      );
      if (update.docChanged || effectFired) {
        this.decorations = buildWordDiffDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// ---------------------------------------------------------------------------
// 主题
// ---------------------------------------------------------------------------

/**
 * 行内字词差异配色。所有颜色都留了 CSS 变量出口，
 * 便于 compare.css / theme-presets.js 覆盖而不必改本文件。
 */
export const wordDiffTheme = EditorView.baseTheme({
  [`.${ADDED_CLASS}`]: {
    backgroundColor: "var(--diff-word-added-bg, rgba(46, 160, 67, 0.4))",
    borderRadius: "2px",
    padding: "0 1px",
  },
  [`.${REMOVED_CLASS}`]: {
    // 不加删除线：左侧独属/被删内容一律只用浅红高亮底示意。
    // 删除线在中日文等宽字形上会直接压住字身、显著降低可读性，
    // 而底色本身已经完成了「这段是左侧独有」的语义传达，删除线是冗余噪音。
    backgroundColor: "var(--diff-word-removed-bg, rgba(248, 81, 73, 0.4))",
    borderRadius: "2px",
    padding: "0 1px",
  },
  // 暗色变体：底色略深，保证在深色编辑器背景上仍有足够对比度
  [`&dark .${ADDED_CLASS}`]: {
    backgroundColor: "var(--diff-word-added-bg, rgba(46, 160, 67, 0.55))",
  },
  [`&dark .${REMOVED_CLASS}`]: {
    backgroundColor: "var(--diff-word-removed-bg, rgba(248, 81, 73, 0.55))",
  },
});

// ---------------------------------------------------------------------------
// 装配入口
// ---------------------------------------------------------------------------

/**
 * 创建行内字词级差异扩展。
 *
 * @param {Partial<WordDiffConfig>} [config] 可选配置，目前支持 mode: 'word' | 'char'
 * @returns {import('@codemirror/state').Extension[]} 含 data field / config field / plugin / theme
 */
export function inlineWordDiffExtension(config) {
  /** @type {WordDiffConfig} */
  const initialConfig = { mode: config?.mode === "char" ? "char" : "word" };

  return [
    wordDiffDataField,
    wordDiffConfigField.init(() => initialConfig),
    wordDiffPlugin,
    wordDiffTheme,
  ];
}

// 重导出 diff 原语，方便调用方直接复用（无需再额外 import 'diff'）
export { diffWords, diffChars };
