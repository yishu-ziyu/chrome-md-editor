// pane-active.js — 活动栏（Ctrl+S 写盘目标）持久标识扩展
//
// 【为什么不能用 view.dom.classList.add()】
// CodeMirror 6 把 .cm-editor 根节点的 class 属性当作【自己的私产】：它由
// EditorView.editorAttributes facet 计算出完整字符串，在每次 updateAttrs()
// 时【整体覆写】。焦点变化（要写入/移除 cm-focused）就是最常见的一次覆写。
// 因此任何用 classList 手工追加的外部类，都会在用户「点一下编辑器」的瞬间
// 被静默抹掉 —— 真机实测：render 后类在，点击 .cm-content 后类消失。
//
// 【正确做法】把这个类交回给 CodeMirror 管理：用 StateField 存「本栏是否活动」，
// 经 editorAttributes 提供 class。这样无论 CM 何时重算 class，都会把它带上。
//
// 语义：cmp-pane-active 表达【持久】的写盘目标，与 CodeMirror 自带的 cm-focused
// （瞬时焦点，失焦即消失）是两回事，二者不可互相替代。
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** 活动栏描边类名；与 compare.css 的 #compareRoot 提权规则一一对应 */
export const PANE_ACTIVE_CLASS = "cmp-pane-active";

/** 内部 effect：切换本栏的活动态 */
const setPaneActiveEffect = StateEffect.define();

/**
 * 活动态字段。每个 EditorView 有独立 EditorState，故同一份扩展数组可安全地
 * 同时注入 a / b / theirs 三栏，互不串扰。
 */
const paneActiveField = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setPaneActiveEffect)) value = e.value === true;
    }
    return value;
  },
  // 返回 {} 而非 null：editorAttributes 的合并逻辑对空对象是无副作用的，
  // 而 null 在部分版本会被当作「函数式 attrs」路径处理，徒增分支风险。
  provide: (f) =>
    EditorView.editorAttributes.from(f, (active) =>
      active ? { class: PANE_ACTIVE_CLASS } : {},
    ),
});

/**
 * 供面板 extensions 注入的扩展。
 * @returns {import("@codemirror/state").Extension[]}
 */
export function paneActiveExtension() {
  return [paneActiveField];
}

/**
 * 设置某栏的活动态。
 *
 * @param {import("@codemirror/view").EditorView|null|undefined} view
 * @param {boolean} active
 * @returns {boolean} true=已由本扩展接管；false=该 view 未挂载扩展（调用方应走兜底）
 */
export function setPaneActiveClass(view, active) {
  if (!view || !view.state || typeof view.dispatch !== "function") return false;
  let cur;
  try {
    // 第二参 false = 字段未挂载时返回 undefined 而非抛错
    cur = view.state.field(paneActiveField, false);
  } catch (_) {
    return false;
  }
  if (cur === undefined) return false; // 未挂扩展：交回调用方兜底
  const next = active === true;
  if (cur === next) return true; // 幂等：避免无谓事务
  try {
    view.dispatch({ effects: setPaneActiveEffect.of(next) });
  } catch (_) {
    return false; // 视图已销毁等异常：让调用方兜底
  }
  return true;
}

/**
 * 读取某栏当前活动态（供测试与诊断）。
 * @param {import("@codemirror/view").EditorView|null|undefined} view
 * @returns {boolean|undefined} undefined=未挂载扩展
 */
export function isPaneActive(view) {
  if (!view || !view.state) return undefined;
  try {
    return view.state.field(paneActiveField, false);
  } catch (_) {
    return undefined;
  }
}
