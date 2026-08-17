// Service Worker - 管理编辑器标签页 + 拦截 .md 文件 + 翻译 API 代理

// 生成唯一实例 ID，用于区分多个编辑器实例（避免 pendingFile 单键竞态）
function newInstanceId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'i-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ==========================================
// 翻译 API 代理
// 扩展页 fetch 会走 CORS；service worker + host_permissions 不走 CORS，
// 可发送 x-api-key / anthropic-version 等自定义头（MiniMax Anthropic 必需）。
// ==========================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'translate-fetch') return false;

  const { url, method, headers, body } = message.payload || {};
  if (!url || typeof url !== 'string') {
    sendResponse({ ok: false, status: 0, error: 'missing url' });
    return false;
  }

  (async () => {
    // 超时保护：外部翻译 API 挂起时中断连接并返回错误，避免代理与前景侧都空等。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: method || 'POST',
        headers: headers || {},
        body: body ?? undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      sendResponse({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        text,
      });
    } catch (err) {
      const raw = err?.message || String(err);
      // Surface a clearer hint when host permission / network is the real issue
      const hint =
        /Failed to fetch|NetworkError|ERR_/i.test(raw)
          ? `${raw}（请确认已重新加载扩展 v1.4.2+，且目标域名在 host_permissions 中）`
          : raw;
      sendResponse({
        ok: false,
        status: 0,
        error: hint,
      });
    } finally {
      clearTimeout(timer);
    }
  })();

  // Keep the message channel open for async sendResponse
  return true;
});

// 点击扩展图标时打开编辑器页面
// 每次点击都新建一个独立实例（支持同时打开多个编辑器）
chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('src/editor.html') + '?i=' + newInstanceId(),
  });
});

// ==========================================
// 对比合并入口（T1）：右键菜单「打开对比合并」
// 点击后新开 compare.html 独立实例（沿用 newInstanceId，不复定义）。
// 用 chrome.contextMenus 存在性守护，避免缺少权限时抛出异常。
// ==========================================
if (chrome.contextMenus) {
  // 菜单创建移到 onInstalled：MV3 service worker 每次唤醒若无条件
  // create 同 id 会触发 runtime.lastError（菜单已存在）。
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create(
        {
          id: 'open-compare-merge',
          title: '打开对比合并',
          contexts: ['action', 'page'],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn('[MD Editor] 创建右键菜单失败:', chrome.runtime.lastError);
          }
        }
      );
    });
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== 'open-compare-merge') return;
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/compare.html') + '?i=' + newInstanceId(),
    });
  });
}

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

    // 用「每个实例独立」的 storage 键，避免多个 .md 同时打开时相互覆盖
    const instanceId = newInstanceId();
    await chrome.storage.local.set({
      ['pendingFile_' + instanceId]: {
        content: content,
        filename: filename,
        sourceUrl: tab.url,
        timestamp: Date.now(),
      },
    });

    // 重定向到编辑器（携带实例 ID，使该标签页精确加载对应文件）
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL('src/editor.html') + '?i=' + instanceId,
    });
  } catch (err) {
    console.warn('[MD Editor] 拦截 .md 文件失败:', err);
  }
});
