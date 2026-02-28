// Content Script: 拦截 Chrome 打开的 .md 文件，重定向到编辑器
// 当用户拖拽 .md 文件到 Chrome 时，Chrome 会以 file:/// 协议打开
// 此脚本检测到 .md 文件后，将内容传递给编辑器打开

(function () {
  // 只处理 file:// 协议的 .md 文件
  const url = window.location.href;
  if (!url.startsWith('file://')) return;

  const isMarkdown = /\.(md|markdown|mdown|mkd|mkdn)$/i.test(url);
  if (!isMarkdown) return;

  // 从 URL 提取文件名
  const decodedUrl = decodeURIComponent(url);
  const filename = decodedUrl.split('/').pop() || 'untitled.md';

  // 获取页面上的原始 Markdown 文本
  // Chrome 打开 .md 文件时，内容在 <pre> 或 body 中以纯文本显示
  const content = document.body.innerText || document.body.textContent || '';

  if (!content.trim()) return;

  // 将文件内容和来源信息存入 chrome.storage.local
  chrome.storage.local.set(
    {
      pendingFile: {
        content: content,
        filename: filename,
        sourceUrl: url,
        timestamp: Date.now(),
      },
    },
    () => {
      // 重定向到编辑器页面
      const editorUrl = chrome.runtime.getURL('src/editor.html');
      window.location.href = editorUrl;
    }
  );
})();
