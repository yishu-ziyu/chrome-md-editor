// Service Worker - 管理编辑器标签页 + 拦截 .md 文件

// 点击扩展图标时打开编辑器页面
chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({
    url: chrome.runtime.getURL('src/editor.html'),
  });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('src/editor.html'),
    });
  }
});

// ==========================================
// 方案 B：通过 tabs.onUpdated 拦截 .md 文件
// 当 content script 不生效时作为备用
// ==========================================
const MD_EXTENSIONS = /\.(md|markdown|mdown|mkd|mkdn)(\?.*)?$/i;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 只处理 file:// 协议的 .md 文件加载完成时
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('file://')) return;
  if (!MD_EXTENSIONS.test(tab.url)) return;

  try {
    // 注入脚本读取页面内容
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        return document.body.innerText || document.body.textContent || '';
      },
    });

    const content = results?.[0]?.result;
    if (!content || !content.trim()) return;

    // 从 URL 中提取文件名
    const decodedUrl = decodeURIComponent(tab.url);
    const filename = decodedUrl.split('/').pop() || 'untitled.md';

    // 存入 storage
    await chrome.storage.local.set({
      pendingFile: {
        content: content,
        filename: filename,
        sourceUrl: tab.url,
        timestamp: Date.now(),
      },
    });

    // 重定向到编辑器
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL('src/editor.html'),
    });
  } catch (err) {
    console.warn('[MD Editor] 拦截 .md 文件失败:', err);
  }
});
