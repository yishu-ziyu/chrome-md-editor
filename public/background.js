// Service Worker - 打开编辑器标签页 + 翻译 API 代理

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
// Locked down: same-extension sender, POST, https + host_permissions origins only.
// Keep TRANSLATE_ALLOWED_ORIGINS in sync with public/manifest.json host_permissions.
// ==========================================
const TRANSLATE_ALLOWED_ORIGINS = new Set([
  'https://api.openai.com',
  'https://api.deepseek.com',
  'https://api.moonshot.cn',
  'https://api.moonshot.ai',
  'https://dashscope.aliyuncs.com',
  'https://open.bigmodel.cn',
  'https://ark.cn-beijing.volces.com',
  'https://api.minimax.chat',
  'https://api.minimaxi.com',
  'https://api.minimax.io',
  'https://api.stepfun.com',
  'https://generativelanguage.googleapis.com',
  'https://api.groq.com',
  'https://api.mistral.ai',
  'https://openrouter.ai',
  'https://api.siliconflow.cn',
  'https://api.siliconflow.com',
  'https://aihubmix.com',
  'https://api.302.ai',
  'https://oa.api2d.net',
  'https://api.openai-proxy.org',
  'https://api.together.xyz',
  'https://api.fireworks.ai',
  'https://api.deepl.com',
  'https://api-free.deepl.com',
]);

const TRANSLATE_ALLOWED_HEADERS = new Set([
  'content-type',
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
]);

function pickAllowedHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (TRANSLATE_ALLOWED_HEADERS.has(String(key).toLowerCase())) {
      out[key] = String(value);
    }
  }
  return out;
}

function parseAllowedTranslateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, error: 'missing url' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'invalid url' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'only https urls are allowed' };
  }
  if (!TRANSLATE_ALLOWED_ORIGINS.has(parsed.origin)) {
    return { ok: false, error: 'origin not allowed' };
  }
  return { ok: true, url: parsed.href };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'translate-fetch') return false;

  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, status: 0, error: 'forbidden sender' });
    return false;
  }

  const payload = message.payload || {};
  const method = String(payload.method || '').toUpperCase();
  if (method !== 'POST') {
    sendResponse({ ok: false, status: 0, error: 'only POST is allowed' });
    return false;
  }

  const parsed = parseAllowedTranslateUrl(payload.url);
  if (!parsed.ok) {
    sendResponse({ ok: false, status: 0, error: parsed.error });
    return false;
  }

  const headers = pickAllowedHeaders(payload.headers);
  const body = payload.body == null ? undefined : String(payload.body);

  (async () => {
    try {
      const res = await fetch(parsed.url, {
        method: 'POST',
        headers,
        body,
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
          ? `${raw}（请确认已重新加载扩展 v1.4.3+，且目标域名在 host_permissions 中）`
          : raw;
      sendResponse({
        ok: false,
        status: 0,
        error: hint,
      });
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
