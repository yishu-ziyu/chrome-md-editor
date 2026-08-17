// 选中的配对符号高亮（selectedBracketHighlight）
// 从 editor.js 抽取为独立模块，供 editor.js 与 editor-extensions.js 共享，
// 避免工厂反向依赖 editor.js 形成循环依赖。
import { ViewPlugin, Decoration } from '@codemirror/view';
import { bracketMatchMap, findPairedBracket } from './bracket-utils.js';

export const selectedBracketHighlight = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.cachedDoc = null;
      this.decorations = this.build(view);
    }
    update(update) {
      // S3-A：符号配对高亮触发入口
      if (update.selectionSet || update.docChanged) {
        if (update.docChanged) this.cachedDoc = null;
        this.decorations = this.build(update.view);
      }
    }
    build(view) {
      const sel = view.state.selection.main;
      if (sel.empty) { this.cachedDoc = null; return Decoration.none; }
      const doc = view.state.doc;
      const selText = doc.sliceString(sel.from, sel.to);
      // 仅当选区恰好为一个配对字符时，高亮其另一半
      if (selText.length !== 1) { this.cachedDoc = null; return Decoration.none; }
      const ch = selText;
      const info = bracketMatchMap[ch];
      if (!info) { this.cachedDoc = null; return Decoration.none; }
      const docText = this.cachedDoc ?? (this.cachedDoc = doc.toString());
      // S3-B：findPairedBracket 配对计算结果
      const matchPos = findPairedBracket(docText, ch, info, sel.from);
      if (matchPos == null) return Decoration.none;
      const deco = Decoration.mark({ class: 'cm-bracket-match-active' });
      // 必须传 sort=true：选中的是「闭符号」时（`)]}>”’）` 或处于偶数序位的
      // 自配对 ' " ` ），findPairedBracket 走 dir=-1 / findSelfPair 反向分支，
      // 返回的 matchPos < sel.from，数组即为逆序。RangeSet.of 不排序会直接抛
      // 「Ranges must be added sorted by `from` position and `startSide`」，
      // 整个 ViewPlugin 被 CM6 卸载（控制台 "CodeMirror plugin crashed"），
      // 连带该 EditorView 上后续依赖装饰的交互（如选区拖拽手柄）一起失效。
      return Decoration.set([
        deco.range(sel.from, sel.to),
        deco.range(matchPos, matchPos + 1),
      ], true);
    }
  },
  { decorations: (v) => v.decorations }
);
