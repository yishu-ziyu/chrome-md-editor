// compare-nav.js — 块导航封装（T4 / 增量 B）
//
// 契约导出：
//   bindChunkNavigation(view: EditorView) => { next(): void; prev(): void }
//   bindChunkNavigationKeys(handlers, options?) => () => void   // 键盘快捷键
//   resolveChunkNavAction(event) => 'next' | 'prev' | null       // 纯函数，可单测
//   isEditableTarget(target) => boolean
//
// 自行实现块导航：基于 @codemirror/merge 的 getChunks(view.state) 定位差异块，
// 自行 dispatch 选区 + 滚动。不依赖 goToNextChunk/goToPreviousChunk 的内部 StateCommand
// （实测在 MergeView 包裹层调用时不稳定返回 false，导致导航完全无效果，见 BUG-B1/B2/B3/D8）。
// getChunks 与 compare-line-markers.js 共用同一公共 API，已证实行得通（A7 差异标记正常）。
//
// 快捷键映射（见 compare.html 上一块/下一块按钮 title）：
//   B / ]            → 下一块
//   Shift+B / [      → 上一块
//   Alt+B            → 下一块（编辑区内也生效）
//   Alt+Shift+B      → 上一块（编辑区内也生效）
// 不带 Alt 时在可编辑区域（CodeMirror / input / textarea）内不响应，避免吞掉正常输入。

import { getChunks } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

/**
 * 绑定块导航到某个 CodeMirror 编辑器视图。
 * 返回的 next()/prev() 分别对应「下一块 / 上一块」按钮行为（增量 B 块导航）。
 * @param {import('@codemirror/view').EditorView|null|undefined} view
 * @returns {{next:()=>void, prev:()=>void}}
 */
export function bindChunkNavigation(view) {
  const safe = view && typeof view.dispatch === "function" && view.state;
  if (!safe) {
    return { next() {}, prev() {} };
  }
  /**
   * 跳转到下一/上一差异块（dir=1 下一块，dir=-1 上一块）。
   * 逻辑等效于 @codemirror/merge 的 moveByChunk，但使用 getChunks 直接读取块与侧信息。
   * @param {1|-1} dir
   */
  function move(dir) {
    const res = getChunks(view.state);
    if (!res || !res.chunks || !res.chunks.length) return;
    const { chunks, side } = res;
    const head = view.state.selection.main.head;
    // 边界正确的块步进：光标精确落在某块起始 from 时，按方向应「越过」该块到相邻块，
    // 而非原地选中（避免 CM6 moveByChunk 的「停在 from 边界」歧义导致连续下一步失效）。
    //   next：第一个 from 严格 > head 的块；找不到（head 已在最后一块之后）则环绕到第 0 块。
    //   prev：最后一个 to 严格 <= head 的块；找不到（head 在所有块之前）则环绕到最后一块。
    const spans = chunks.map((c) =>
      side === "b" ? [c.fromB, c.toB] : [c.fromA, c.toA]
    );
    let target;
    if (dir > 0) {
      target = spans.find((s) => s[0] > head);
      if (target === undefined) target = spans[0];
    } else {
      let found = null;
      for (const s of spans) if (s[1] <= head) found = s;
      target = found || spans[spans.length - 1];
    }
    const [from, to] = target;
    view.dispatch(
      view.state.update({
        selection: { anchor: from },
        userEvent: "select.byChunk",
        scrollIntoView: true,
        effects: EditorView.scrollIntoView(EditorSelection.range(to, from)),
      })
    );
  }
  return {
    next() {
      move(1);
    },
    prev() {
      move(-1);
    },
  };
}

/**
 * 判断事件目标是否处于可编辑区域（CodeMirror 的 .cm-content 是 contenteditable）。
 * @param {any} target
 * @returns {boolean}
 */
export function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable === true;
}

/**
 * 把一个 keydown 事件解析成块导航动作（纯函数，便于单测）。
 * @param {{key?:string, shiftKey?:boolean, altKey?:boolean, ctrlKey?:boolean, metaKey?:boolean, target?:any}} event
 * @returns {'next'|'prev'|null}
 */
export function resolveChunkNavAction(event) {
  if (!event) return null;
  // Ctrl/Cmd 组合留给浏览器与编辑器自身快捷键
  if (event.ctrlKey || event.metaKey) return null;

  const key = typeof event.key === "string" ? event.key : "";
  let action = null;
  if (key === "b" || key === "B") action = event.shiftKey ? "prev" : "next";
  else if (key === "]") action = "next";
  else if (key === "[") action = "prev";
  if (!action) return null;

  // 编辑区内只认 Alt 组合，否则 b / [ / ] 会被当成导航而无法正常输入
  if (!event.altKey && isEditableTarget(event.target)) return null;
  return action;
}

/**
 * 绑定块导航键盘快捷键。传入的 next/prev 应与「上一块 / 下一块」按钮点击调用的
 * 是同一组函数，保证按钮与快捷键行为完全一致（单一实现）。
 * @param {{next?:()=>void, prev?:()=>void}} handlers
 * @param {{target?:any}} [options] target 默认为 document，便于测试注入
 * @returns {() => void} 解绑函数
 */
export function bindChunkNavigationKeys(handlers, options) {
  const next = handlers && typeof handlers.next === "function" ? handlers.next : null;
  const prev = handlers && typeof handlers.prev === "function" ? handlers.prev : null;
  const target =
    (options && options.target) || (typeof document !== "undefined" ? document : null);
  if (!target || typeof target.addEventListener !== "function" || (!next && !prev)) {
    return () => {};
  }

  const onKeyDown = (event) => {
    const action = resolveChunkNavAction(event);
    if (!action) return;
    const run = action === "next" ? next : prev;
    if (!run) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    run();
  };

  // 捕获阶段：确保 Alt 组合在 CodeMirror 消费之前被处理
  target.addEventListener("keydown", onKeyDown, true);
  return () => target.removeEventListener("keydown", onKeyDown, true);
}
