// ==========================================
// Feedback Button — 编辑器内嵌反馈入口
// ==========================================

export function initFeedbackButton() {
  const statusbarRight = document.querySelector('.statusbar-right');
  if (!statusbarRight) return;

  // 避免重复初始化
  if (statusbarRight.querySelector('.feedback-link')) return;

  const link = document.createElement('a');
  link.href = 'https://github.com/yishu-ziyu/chrome-md-editor/issues';
  link.className = 'status-item feedback-link';
  link.textContent = '反馈';

  // 样式与状态栏现有 item 一致
  link.style.fontSize = '11px';
  link.style.color = 'var(--text-muted)';
  link.style.textDecoration = 'none';
  link.style.cursor = 'pointer';
  link.style.transition = 'color 150ms ease';

  link.addEventListener('mouseenter', () => {
    link.style.color = 'var(--text-accent)';
  });

  link.addEventListener('mouseleave', () => {
    link.style.color = 'var(--text-muted)';
  });

  // 当前标签页打开 GitHub Issues
  link.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = link.href;
  });

  statusbarRight.appendChild(link);
}
