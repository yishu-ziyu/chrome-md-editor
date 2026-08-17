// 非阻塞确认弹窗：返回 Promise<boolean>，取代 window.confirm。
//
// 为什么不用 window.confirm：
//   window.confirm 是阻塞式模态对话框，会锁死渲染进程主线程。在初始化阶段或
//   headless 自动化场景下，confirm 弹窗与 CDP 的 handleJavaScriptDialog 会相互死锁，
//   表现为「 renderer 卡死 / 崩溃」的误判（offerDraftRestore 曾因此导致编辑页整体无法加载）。
//   本实现用页内弹窗 + Promise 实现：await 时主线程让出、对话框为 DOM 元素（非 JS 对话框），
//   渲染进程始终可响应 CDP，headless 与真实 GUI 均安全。
//
// 用法：const ok = await showConfirm('是否继续？'); if (ok) { ... }
export function showConfirm(message) {
  return new Promise((resolve) => {
    if (document.getElementById('confirmDialogOverlay')) {
      // 已有确认框未关闭，视为取消，避免重复堆叠
      resolve(false);
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'confirmDialogOverlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4)';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#fff;color:#1f2328;border-radius:8px;padding:20px;max-width:380px;box-shadow:0 8px 24px rgba(0,0,0,0.2);font-family:sans-serif';
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:13px;line-height:1.6;margin-bottom:16px;white-space:pre-wrap;';
    msg.textContent = message;
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText =
      'padding:6px 14px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;cursor:pointer;';
    const okBtn = document.createElement('button');
    okBtn.textContent = '确定';
    okBtn.style.cssText =
      'padding:6px 14px;border:none;border-radius:6px;background:#0969da;color:#fff;cursor:pointer;';
    actions.append(cancelBtn, okBtn);
    box.append(msg, actions);
    overlay.append(box);
    document.body.appendChild(overlay);
    const close = (val) => {
      if (overlay.parentNode) overlay.remove();
      resolve(val);
    };
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
  });
}
