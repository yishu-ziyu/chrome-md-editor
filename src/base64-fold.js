// ============================================================
// A-9 超长 Base64 图片行折叠
// 用 ViewPlugin + Decoration 把超长 data: 行（粘贴图片生成的 base64）替换为
// 占位装饰，避免长行拖慢编辑器；点击占位可临时展开该行。
// 复用 selectedBracketHighlight 的 ViewPlugin + Decoration 范式。
// ============================================================
import { Decoration, ViewPlugin, EditorView, WidgetType } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';

const FOLD_MIN_LEN = 200; // 超过此长度的 data: 行才折叠

// 折叠状态进入「文档状态」（StateField），以「行首 offset」记录已展开行。
// 跨事务通过 tr.changes.mapPos 映射，修复三处缺陷：
//   - M1：点击展开不再依赖空 dispatch（已聚焦时不触发重建），改为派发
//         toggleFold effect 确定性强制重建；
//   - M2：不以可变绝对行号记录，改以 line.from offset 并在编辑时映射，
//         避免上方增删行导致展开状态漂移/错配；
//   - M3：装饰重建条件收敛为 docChanged||viewportChanged||折叠切换，
//         不再每次光标移动/聚焦都 O(n) 遍历。
export const toggleFold = StateEffect.define();

export const unfoldedField = StateField.define({
  create() {
    return new Set();
  },
  update(value, tr) {
    // 文档编辑后，旧 offset 需映射到新位置（行首尽量保持边界关联）
    let next = value;
    if (tr.docChanged) {
      const mapped = new Set();
      for (const pos of value) {
        mapped.add(tr.changes.mapPos(pos, -1));
      }
      next = mapped;
    }
    // 应用折叠/展开切换
    for (const e of tr.effects) {
      if (e.is(toggleFold)) {
        const off = e.value;
        if (next.has(off)) {
          next.delete(off);
        } else {
          next = new Set(next);
          next.add(off);
        }
      }
    }
    return next;
  },
});

class Base64FoldWidget extends WidgetType {
  constructor(offset, len) { super(); this.offset = offset; this.len = len; }
  eq(other) {
    return other instanceof Base64FoldWidget && other.len === this.len && other.offset === this.offset;
  }
  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-base64-fold';
    wrap.textContent = `📎 图片 base64 已折叠（长度 ${this.len}）— 点击展开`;
    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      const off = this.offset;
            // 派发确定性事务（仅 effect，无 doc/selection 变动），强制 StateField 变更
      // 且 ViewPlugin 据此重建装饰，修正 M1（空 dispatch 在已聚焦时不重建）。
      view.dispatch({ effects: toggleFold.of(off) });
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

// 判断一行文本是否可被折叠（纯逻辑，供单测复用）
export function isFoldableDataLine(text) {
  return typeof text === 'string' && text.startsWith('data:') && text.length > FOLD_MIN_LEN;
}

function buildFolds(view) {
  const builder = new RangeSetBuilder();
  const unfolded = view.state.field(unfoldedField);
  const doc = view.state.doc;
  let foldedCount = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const txt = line.text;
    if (isFoldableDataLine(txt) && !unfolded.has(line.from)) {
      builder.add(
        line.from,
        line.to,
        Decoration.replace({ widget: new Base64FoldWidget(line.from, txt.length) })
      );
      foldedCount++;
    }
  }
    return builder.finish();
}

export const base64FoldPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) { this.view = view; this.decorations = buildFolds(view); }
    update(u) {
      // 仅文档变更 / 视口变更 / 折叠切换时重建，收敛 M3 的过宽条件
      const toggled = u.transactions.some((tr) =>
        tr.effects.some((e) => e.is(toggleFold))
      );
      if (u.docChanged || u.viewportChanged || toggled) {
        this.decorations = buildFolds(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// 返回 [plugin, field]：两者须同处一个 EditorState，ViewPlugin 才能读取 field。
export function initBase64Fold() {
    return [base64FoldPlugin, unfoldedField];
}
