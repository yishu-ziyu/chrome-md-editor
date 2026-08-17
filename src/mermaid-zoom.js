// ============================================================
// A-10 Mermaid 图表全屏缩放 / 平移
//  - 预览渲染后，为每个 .mermaid-diagram 添加「⛶」按钮（仅增强一次）；
//  - 点击按钮打开全屏浮层，内含该图表的 SVG 副本；
//  - 浮层内：Ctrl/Cmd + 滚轮以光标为中心缩放；拖拽平移；按钮 +/- / 重置 / 关闭；
//  - Esc 或点击背景关闭。
// 纯前端，不改 Markdown 源码。
// ============================================================

let overlayEl = null;
let overlayCanvas = null;
let zoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPan = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement('div');
  overlayEl.className = 'mermaid-zoom-overlay';
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="mz-toolbar">
      <button type="button" class="mz-btn" data-act="zoom-out" title="缩小">−</button>
      <span class="mz-zoom-label">100%</span>
      <button type="button" class="mz-btn" data-act="zoom-in" title="放大">＋</button>
      <button type="button" class="mz-btn" data-act="reset" title="重置视图">重置</button>
      <button type="button" class="mz-btn" data-act="close" title="关闭 (Esc)">✕</button>
    </div>
    <div class="mz-stage">
      <div class="mz-canvas"></div>
    </div>
  `;
  document.body.appendChild(overlayEl);
  overlayCanvas = overlayEl.querySelector('.mz-canvas');

  overlayEl.querySelector('[data-act="zoom-in"]').addEventListener('click', () => setZoom(zoom * 1.2));
  overlayEl.querySelector('[data-act="zoom-out"]').addEventListener('click', () => setZoom(zoom / 1.2));
  overlayEl.querySelector('[data-act="reset"]').addEventListener('click', resetView);
  overlayEl.querySelector('[data-act="close"]').addEventListener('click', closeOverlay);

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mz-toolbar')) return;
    isPanning = true;
    startPan = { x: e.clientX - panX, y: e.clientY - panY };
    overlayEl.classList.add('mz-panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - startPan.x;
    panY = e.clientY - startPan.y;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    overlayEl && overlayEl.classList.remove('mz-panning');
  });

  overlayEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // 仅 Ctrl/Cmd+滚轮缩放，避免吞掉普通滚动
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom(zoom * factor, e);
  }, { passive: false });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeOverlay(); // 点击背景关闭
  });
  document.addEventListener('keydown', (e) => {
    if (overlayEl.hidden) return;
    if (e.key === 'Escape') closeOverlay();
  });
  return overlayEl;
}

function applyTransform() {
  if (overlayCanvas) {
    overlayCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }
  const label = overlayEl && overlayEl.querySelector('.mz-zoom-label');
  if (label) label.textContent = Math.round(zoom * 100) + '%';
}

function setZoom(next, originEvent) {
  const prev = zoom;
  zoom = Math.min(8, Math.max(0.2, next));
  if (originEvent && overlayCanvas) {
    const rect = overlayCanvas.getBoundingClientRect();
    const cx = originEvent.clientX - rect.left;
    const cy = originEvent.clientY - rect.top;
    // 以光标为锚点缩放
    panX = cx - (cx - panX) * (zoom / prev);
    panY = cy - (cy - panY) * (zoom / prev);
  }
  applyTransform();
  }

function resetView() {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyTransform();
  }

function openOverlay(svgEl) {
  ensureOverlay();
  overlayCanvas.innerHTML = '';
  const clone = svgEl.cloneNode(true);
  overlayCanvas.appendChild(clone);
  resetView();
  overlayEl.hidden = false;
  }

function closeOverlay() {
  if (!overlayEl) return;
  overlayEl.hidden = true;
  }

// 预览渲染后调用：为每个 .mermaid-diagram 添加全屏按钮（仅增强一次）
export function enhanceMermaidDiagrams(container) {
  if (!container) return;
  const diagrams = container.querySelectorAll('.mermaid-diagram:not([data-zoom-enhanced])');
  diagrams.forEach((div) => {
    div.setAttribute('data-zoom-enhanced', '1');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mermaid-zoom-btn';
    btn.title = '全屏查看 / 缩放 / 平移 (Ctrl+滚轮)';
    btn.textContent = '⛶';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svg = div.querySelector('svg');
      if (svg) openOverlay(svg);
    });
    div.appendChild(btn);
  });
  }

export { openOverlay, closeOverlay };
