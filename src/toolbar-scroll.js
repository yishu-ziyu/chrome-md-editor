// 工具栏横向溢出滚动按钮（v1.8.5 修复：已知问题3）
// 当工具栏内容宽于可视区时，在最左/最右按需显示 chevron，点击平滑滚动，
// 保证用户在任意窗口宽度（含 320px 极端窄）下都能看到并点按到所有按钮。
// 设计：用 .toolbar-wrap 包裹滚动容器 #toolbar/#compareToolbar，chevron 为 wrap 的
// 绝对定位兄弟节点（不随内容滚动），JS 按 scrollLeft 实时显隐。
// 此模块为纯工具，不反向依赖 editor.js / compare.js（遵守 markra 集成铁律）。

export function initToolbarScroll(toolbarSelector) {
  const tb = document.querySelector(toolbarSelector);
  if (!tb) return null;

  // 确保存在 .toolbar-wrap 包裹（仅包裹一次）
  let wrap = tb.parentElement;
  if (!wrap || !wrap.classList.contains('toolbar-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'toolbar-wrap';
    tb.parentNode.insertBefore(wrap, tb);
    wrap.appendChild(tb);
  }

  const makeBtn = (side) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toolbar-scroll-btn toolbar-scroll-' + side;
    b.setAttribute('aria-label', side === 'left' ? '向左滚动工具栏' : '向右滚动工具栏');
    b.hidden = true;
    b.textContent = side === 'left' ? '‹' : '›';
    const step = Math.max(160, Math.round(tb.clientWidth * 0.8));
    b.addEventListener('click', () => {
      tb.scrollBy({ left: (side === 'left' ? -1 : 1) * step, behavior: 'smooth' });
    });
    wrap.appendChild(b);
    return b;
  };

  const left = wrap.querySelector('.toolbar-scroll-left') || makeBtn('left');
  const right = wrap.querySelector('.toolbar-scroll-right') || makeBtn('right');

  const update = () => {
    const max = tb.scrollWidth - tb.clientWidth;
    const sl = tb.scrollLeft;
    // 仅在确有可滚动内容时显示对应方向的按钮（容忍 ≤2px 亚像素滚动误差，避免临界值下按钮闪烁）
    left.hidden = !(sl > 2);
    right.hidden = !(sl < max - 2);
  };

  tb.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (window.ResizeObserver) {
    new ResizeObserver(update).observe(tb);
  }
  // 工具栏按钮为动态注入时，子节点变化也要重算显隐
  if (window.MutationObserver) {
    new MutationObserver(update).observe(tb, { childList: true, subtree: true });
  }
  // 初始计算（延迟一帧确保布局完成）
  requestAnimationFrame(update);
  return update;
}
