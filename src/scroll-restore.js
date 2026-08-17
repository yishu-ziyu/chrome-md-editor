// BUG-2 修复核心：在预览区 innerHTML 重建或编辑器内容全量替换（二者都会把容器
// scrollTop 重置到头部）之后，显式恢复重建前的滚动位置，并用 requestAnimationFrame
// 兜底一次，确保布局完成后位置稳定。
//
// 使用场景（src/editor.js）：
//   - doUpdatePreview：预览区 innerHTML 重建后恢复 previewContainer.scrollTop
//   - setEditorContent：CodeMirror 全量替换后恢复 scroller.scrollTop
//
// 设计要点：
//   - savedTop 为 null/undefined 时不操作（容器不存在或无需恢复）
//   - 内部 try/catch 防止极端环境下 scrollTop 赋值异常导致主流程中断
//   - 若运行环境无 requestAnimationFrame（如 node 测试环境），静默跳过兜底

export function restoreScroll(el, savedTop) {
  if (!el || savedTop == null) return;
  try {
    el.scrollTop = savedTop;
  } catch (e) {
    // 容器不可滚动或赋值异常时忽略，不影响主流程
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (el) {
        try {
          el.scrollTop = savedTop;
        } catch (e) {
          // 兜底阶段异常同样忽略
        }
      }
    });
  }
}
