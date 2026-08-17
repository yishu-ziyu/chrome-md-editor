// scroll-box.js — 取「某个 EditorView 真正在滚动的那个盒子」
//
// 【为什么不能裸用 view.scrollDOM】
// @codemirror/merge 6.12.2 的滚动模型是【MergeView 自身是滚动盒，两栏共用它】：
//   externalTheme  `.cm-mergeView { overflow-y: auto }`                    (dist/index.js:1078-1080)
//   baseTheme      `.cm-mergeView & .cm-scroller, .cm-mergeView & {
//                     height: auto !important; overflow-y: visible !important }` (:1108-1112)
// 即 MergeView 内的 .cm-editor 与 .cm-scroller 被两条 !important 强制成
// 「随内容自然增高、自己不滚动」——A↔B 的行对齐正是靠共用这一个滚动盒实现的。
// 后果是对 MergeView 里的面板：
//   · view.scrollDOM.clientHeight ≡ scrollHeight（可滚余量恒 0）
//   · view.scrollDOM.scrollTop 恒 0
//   · view.scrollDOM 上【永远收不到 scroll 事件】——scroll 事件不冒泡，
//     真正派发事件的是外层 .cm-mergeView
// 所以凡是「读可见比例 / 读可滚余量 / 绑 scroll 监听」的地方，都必须先经本函数换算。
//
// 三栏右侧的 Theirs 是独立 EditorView，不在 MergeView 内，其 .cm-scroller 就是滚动盒，
// 本函数原样返回，调用方无需分支判断。
//
// 【与 compare.css 的成对约定】compare.css 里 `.cm-mergeView` 段落明确禁止把
// overflow 关死、也禁止反向把 .cm-scroller 改造成滚动盒。若日后真要改滚动模型，
// 必须 CSS 与本文件同步改，否则两边各自「看起来都对」而行为全错且无任何报错。

/**
 * @param {{scrollDOM?: HTMLElement}|null|undefined} view EditorView（或含 scrollDOM 的桩件）
 * @returns {HTMLElement|null} 真正的滚动盒；view 不可用时返回 null
 */
export function scrollBoxOf(view) {
  const sd = view && view.scrollDOM;
  if (!sd) return null;
  try {
    // closest 会先看自身：.cm-scroller 本身不带 cm-mergeView 类，故只会命中祖先。
    if (typeof sd.closest === "function") {
      const mv = sd.closest(".cm-mergeView");
      if (mv) return mv;
    }
  } catch (_) {
    /* 桩件 / 已脱离文档：退回 scrollDOM */
  }
  return sd;
}
