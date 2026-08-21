// ==========================================
// Reading-time bilingual translation (preview only)
// ==========================================

import {
  DEFAULT_PRESET_ID,
  buildAnthropicMessagesUrl,
  collectPresetHostPatterns,
  getPresetDefaultModel,
  getTranslatePreset,
  inferPresetIdFromLegacy,
  resolveTranslateEndpoint,
} from './translate-presets.js';

export const TRANSLATE_SETTINGS_KEY = 'md-translate-settings';

export const DEFAULT_TRANSLATE_SETTINGS = {
  presetId: DEFAULT_PRESET_ID,
  provider: 'anthropic', // openai | anthropic | deepl (derived from preset)
  apiKey: '',
  baseUrl: 'https://api.minimaxi.com/anthropic/v1',
  model: 'MiniMax-M2.5-highspeed',
  targetLang: 'zh-CN',
  deeplEndpoint: 'free', // free | pro
  useCustomEndpoint: false, // advanced: override base URL / model freely
};

const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, th, td';
const SKIP_ANCESTOR = 'pre, code, .mermaid-diagram, .mermaid-error, .md-translation';

/** In-memory cache: source text -> translation */
const translationCache = new Map();

function providerFromPresetKind(kind) {
  if (kind === 'deepl') return 'deepl';
  if (kind === 'anthropic') return 'anthropic';
  return 'openai';
}

export function defaultTranslateSettings() {
  const preset = getTranslatePreset(DEFAULT_PRESET_ID);
  return {
    ...DEFAULT_TRANSLATE_SETTINGS,
    presetId: preset.id,
    provider: providerFromPresetKind(preset.kind),
    baseUrl: (preset.baseUrl || '').replace(/\/+$/, ''),
    model: getPresetDefaultModel(preset),
    deeplEndpoint: preset.deeplEndpoint || 'free',
  };
}

export function normalizeTranslateSettings(raw) {
  const base = defaultTranslateSettings();
  if (!raw || typeof raw !== 'object') return base;

  const presetId = inferPresetIdFromLegacy(raw);
  const preset = getTranslatePreset(presetId);
  const useCustomEndpoint = presetId === 'custom' || raw.useCustomEndpoint === true;

  const apiKey = String(raw.apiKey || '').trim();
  const targetLang =
    String(raw.targetLang || base.targetLang).trim() || base.targetLang;

  let model = String(raw.model || '').trim();
  let baseUrl = String(raw.baseUrl || '').trim().replace(/\/+$/, '');

  if (preset.kind === 'deepl') {
    return {
      presetId: preset.id,
      provider: 'deepl',
      apiKey,
      baseUrl: '',
      model: '',
      targetLang,
      deeplEndpoint: preset.deeplEndpoint || 'free',
      useCustomEndpoint: false,
    };
  }

  if (useCustomEndpoint) {
    if (!baseUrl) baseUrl = (preset.baseUrl || base.baseUrl || '').replace(/\/+$/, '');
    if (!model) model = getPresetDefaultModel(preset) || base.model;
  } else {
    // Locked to preset endpoint; model may be chosen from preset list or kept as freeform id
    baseUrl = (preset.baseUrl || '').replace(/\/+$/, '');
    if (!model) model = getPresetDefaultModel(preset);
  }

  return {
    presetId: preset.id,
    provider: providerFromPresetKind(preset.kind),
    apiKey,
    baseUrl,
    model,
    targetLang,
    deeplEndpoint: 'free',
    useCustomEndpoint: !!useCustomEndpoint,
  };
}

export async function loadTranslateSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(TRANSLATE_SETTINGS_KEY);
      if (result[TRANSLATE_SETTINGS_KEY]) {
        return normalizeTranslateSettings(result[TRANSLATE_SETTINGS_KEY]);
      }
    }
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(TRANSLATE_SETTINGS_KEY);
    if (raw) return normalizeTranslateSettings(JSON.parse(raw));
  } catch {
    // ignore
  }
  return defaultTranslateSettings();
}

export async function saveTranslateSettings(settings) {
  const normalized = normalizeTranslateSettings(settings);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [TRANSLATE_SETTINGS_KEY]: normalized });
    }
  } catch {
    // still try localStorage
  }
  try {
    localStorage.setItem(TRANSLATE_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // ignore quota
  }
  return normalized;
}

export function clearTranslationCache() {
  translationCache.clear();
}

/**
 * Text for an element excluding nested lists, code, mermaid, and existing translations.
 */
export function extractUnitText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone
    .querySelectorAll('ul, ol, pre, code, .mermaid-diagram, .mermaid-error, .md-translation')
    .forEach((node) => node.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether text looks worth sending to a translator (has Latin letters).
 */
export function shouldTranslateText(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return false;
  // Skip pure CJK / numbers / punctuation - no English to translate
  if (!/[A-Za-z\u00C0-\u024F]{2,}/.test(t)) return false;
  return true;
}

/**
 * Collect block-level units from a rendered preview root.
 * Returns { el, text }[] in document order.
 */
export function collectTranslateUnits(root) {
  if (!root) return [];
  const units = [];
  const seen = new Set();

  for (const el of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (seen.has(el)) continue;
    if (el.closest(SKIP_ANCESTOR)) continue;
    // Prefer inner blocks when a container also matches (e.g. avoid double-counting)
    if (el.matches('p, li') && el.querySelector('p, h1, h2, h3, h4, h5, h6')) {
      continue;
    }

    const text = extractUnitText(el);
    if (!shouldTranslateText(text)) continue;

    seen.add(el);
    units.push({ el, text });
  }

  return units;
}

/**
 * Remove previously injected translation nodes under root.
 */
export function clearPreviewTranslations(root) {
  if (!root) return;
  root.querySelectorAll('.md-translation').forEach((node) => node.remove());
}

/**
 * Inject bilingual translations under each unit.
 * translations[i] maps to units[i].
 */
export function applyBilingualTranslations(units, translations) {
  if (!units || !units.length) return 0;
  let applied = 0;

  units.forEach((unit, i) => {
    const translated = translations[i];
    if (!unit?.el || translated == null || String(translated).trim() === '') return;

    unit.el.querySelectorAll(':scope > .md-translation').forEach((n) => n.remove());

    const span = unit.el.ownerDocument.createElement('span');
    span.className = 'md-translation';
    span.setAttribute('data-md-translation', '1');
    span.setAttribute('contenteditable', 'false');
    span.textContent = String(translated).trim();
    unit.el.appendChild(span);
    applied += 1;
  });

  return applied;
}

/**
 * Translate a list of strings with caching. Missing cache entries are batched to the API.
 */
export async function translateTexts(texts, settings, { fetchImpl, onProgress } = {}) {
  const list = Array.isArray(texts) ? texts : [];
  const results = new Array(list.length);
  const missingIndexes = [];

  list.forEach((text, i) => {
    if (translationCache.has(text)) {
      results[i] = translationCache.get(text);
    } else {
      missingIndexes.push(i);
    }
  });

  if (missingIndexes.length === 0) {
    onProgress?.({ done: list.length, total: list.length, fromCache: true });
    return results;
  }

  const missingTexts = missingIndexes.map((i) => list[i]);
  const batches = chunkByCharBudget(missingTexts, missingIndexes, 3500);
  let done = list.length - missingIndexes.length;

  for (const batch of batches) {
    const translated = await callTranslateApi(batch.texts, settings, { fetchImpl });
    if (!Array.isArray(translated) || translated.length !== batch.texts.length) {
      throw new Error(
        `翻译返回数量不匹配：期望 ${batch.texts.length}，实际 ${translated?.length ?? 0}`
      );
    }
    batch.indexes.forEach((origIndex, j) => {
      const value = String(translated[j] ?? '').trim();
      results[origIndex] = value;
      translationCache.set(list[origIndex], value);
    });
    done += batch.texts.length;
    onProgress?.({ done, total: list.length, fromCache: false });
  }

  return results;
}

function chunkByCharBudget(texts, indexes, budget) {
  const batches = [];
  let curTexts = [];
  let curIndexes = [];
  let size = 0;

  texts.forEach((text, i) => {
    const cost = text.length + 8;
    if (curTexts.length > 0 && size + cost > budget) {
      batches.push({ texts: curTexts, indexes: curIndexes });
      curTexts = [];
      curIndexes = [];
      size = 0;
    }
    curTexts.push(text);
    curIndexes.push(indexes[i]);
    size += cost;
  });

  if (curTexts.length) {
    batches.push({ texts: curTexts, indexes: curIndexes });
  }
  return batches;
}

/**
 * Extension-safe fetch: route through the background service worker so
 * host_permissions apply and CORS does not strip custom headers (x-api-key).
 * Falls back to global fetch in dev server / Node tests.
 */
export async function extensionFetch(url, init = {}, { fetchImpl } = {}) {
  if (typeof fetchImpl === 'function') {
    return fetchImpl(url, init);
  }

  // Chrome extension page → background proxy (avoids CORS on Anthropic headers)
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime?.id &&
    typeof chrome.runtime.sendMessage === 'function'
  ) {
    const payload = {
      url: String(url),
      method: init.method || 'POST',
      headers: init.headers || {},
      body: init.body != null ? String(init.body) : undefined,
    };

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'translate-fetch',
        payload,
      });
    } catch (err) {
      throw new Error(
        `扩展后台代理失败: ${err?.message || err}。请重新加载扩展后再试。`
      );
    }

    if (!response) {
      throw new Error('扩展后台无响应。请重新加载扩展后再试。');
    }
    if (response.error && !response.status) {
      throw new Error(`网络请求失败: ${response.error}`);
    }

    return {
      ok: !!response.ok,
      status: response.status || 0,
      statusText: response.statusText || '',
      async text() {
        return response.text || '';
      },
      async json() {
        return JSON.parse(response.text || '{}');
      },
    };
  }

  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('当前环境不支持网络请求');
  }
  return fetchFn(url, init);
}

export async function callTranslateApi(texts, settings, { fetchImpl } = {}) {
  const cfg = normalizeTranslateSettings(settings);
  if (!cfg.apiKey) {
    throw new Error('请先配置翻译 API Key');
  }
  if (!texts.length) return [];

  const fetchFn = (url, init) => extensionFetch(url, init, { fetchImpl });

  const endpoint = resolveTranslateEndpoint(cfg);
  if (endpoint.kind === 'deepl') {
    return translateWithDeepL(texts, { ...cfg, ...endpoint }, fetchFn);
  }
  if (endpoint.kind === 'anthropic') {
    return translateWithAnthropicCompatible(
      texts,
      { ...cfg, baseUrl: endpoint.baseUrl, model: endpoint.model },
      fetchFn
    );
  }
  return translateWithOpenAICompatible(
    texts,
    { ...cfg, baseUrl: endpoint.baseUrl, model: endpoint.model },
    fetchFn
  );
}

function translationSystemPrompt(targetLang) {
  const target = targetLangLabel(targetLang);
  return (
    `You are a professional translator for technical Markdown documents. ` +
    `Translate each string in the user JSON array into ${target}. ` +
    `Return ONLY a valid JSON array of strings with the same length and order. ` +
    `Preserve product names, code-like tokens, URLs, and inline identifiers when appropriate. ` +
    `Do not wrap the array in markdown fences. Do not add explanations.`
  );
}

/**
 * Anthropic Messages API (MiniMax Token Plan / Step Plan / Claude-compatible).
 * POST {base}/messages with x-api-key + anthropic-version.
 */
async function translateWithAnthropicCompatible(texts, cfg, fetchFn) {
  const url = buildAnthropicMessagesUrl(cfg.baseUrl);
  if (!url) {
    throw new Error('Anthropic Base URL 为空，请检查服务预设');
  }

  const isMiniMax = /minimax/i.test(url) || /^MiniMax-/i.test(String(cfg.model || ''));
  const isStepFun = /stepfun\.com/i.test(url) || /^step[-_]/i.test(String(cfg.model || ''));

  const body = {
    model: cfg.model,
    max_tokens: 8192,
    temperature: 0.2,
    system: translationSystemPrompt(cfg.targetLang),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(texts),
      },
    ],
  };

  // MiniMax-M3 Anthropic: thinking disabled by default; keep explicit for safety
  if (isMiniMax && String(cfg.model || '').includes('M3')) {
    body.thinking = { type: 'disabled' };
  }

  // StepFun: lower effort to save Step Plan Credit on translation
  if (isStepFun && /flash|router/i.test(String(cfg.model || ''))) {
    body.output_config = { effort: 'low' };
  }

  // MiniMax Anthropic docs: x-api-key + anthropic-version.
  // Must go through extensionFetch (background) so CORS does not block x-api-key.
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': cfg.apiKey,
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await safeReadText(res);
    throw new Error(`Anthropic 兼容接口错误 ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  let content = extractAnthropicText(data);
  if (!content) {
    throw new Error('Anthropic 兼容接口返回格式异常（无 text 内容）');
  }
  content = stripModelThinkingNoise(content);
  return parseJsonStringArray(content, texts.length);
}

/** Extract plain text from Anthropic Messages response content blocks. */
export function extractAnthropicText(data) {
  if (!data) return '';
  if (typeof data.content === 'string') return data.content;
  if (!Array.isArray(data.content)) return '';
  return data.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function translateWithOpenAICompatible(texts, cfg, fetchFn) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!base) {
    throw new Error('Base URL 为空，请检查服务预设或高级设置');
  }
  const url = `${base}/chat/completions`;
  const isMiniMax = /minimax/i.test(base) || /^MiniMax-/i.test(String(cfg.model || ''));

  const body = {
    model: cfg.model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: translationSystemPrompt(cfg.targetLang),
      },
      {
        role: 'user',
        content: JSON.stringify(texts),
      },
    ],
  };

  // MiniMax-M3: disable thinking to save Token Plan quota and keep JSON clean
  // (M2.x cannot disable thinking; we strip <think> tags from the response)
  if (isMiniMax && String(cfg.model || '').includes('M3')) {
    body.thinking = { type: 'disabled' };
  }

  // StepFun (阶跃星辰): use low reasoning for translation to save Step Plan Credit
  // Docs: reasoning_effort low|medium|high ; step-3.5-flash-2603 supports low|high
  const isStepFun = /stepfun\.com/i.test(base) || /^step[-_]/i.test(String(cfg.model || ''));
  if (isStepFun) {
    const model = String(cfg.model || '');
    if (/flash|router/i.test(model)) {
      body.reasoning_effort = 'low';
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  // Context7 OpenRouter quickstart: optional ranking headers
  if (/openrouter\.ai/i.test(base)) {
    headers['HTTP-Referer'] = 'https://github.com/yishu-ziyu/chrome-md-editor';
    headers['X-OpenRouter-Title'] = 'Chrome MD Editor';
  }

  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await safeReadText(res);
    throw new Error(`OpenAI 兼容接口错误 ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  let content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI 兼容接口返回格式异常');
  }
  content = stripModelThinkingNoise(content);
  return parseJsonStringArray(content, texts.length);
}

/** Strip MiniMax / reasoning models' <think>...</think> wrappers if present. */
export function stripModelThinkingNoise(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

async function translateWithDeepL(texts, cfg, fetchFn) {
  const host =
    cfg.deeplEndpoint === 'pro'
      ? 'https://api.deepl.com'
      : 'https://api-free.deepl.com';
  const url = `${host}/v2/translate`;
  const params = new URLSearchParams();
  texts.forEach((t) => params.append('text', t));
  params.set('target_lang', deeplTargetLang(cfg.targetLang));
  params.set('source_lang', 'EN');

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${cfg.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await safeReadText(res);
    throw new Error(`DeepL 错误 ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const translations = data?.translations;
  if (!Array.isArray(translations)) {
    throw new Error('DeepL 返回格式异常');
  }
  return translations.map((t) => String(t.text || '').trim());
}

function targetLangLabel(code) {
  const c = String(code || '').toLowerCase();
  if (c.startsWith('zh')) return 'Simplified Chinese (简体中文)';
  if (c.startsWith('ja')) return 'Japanese';
  if (c.startsWith('ko')) return 'Korean';
  return code || 'Simplified Chinese';
}

function deeplTargetLang(code) {
  const c = String(code || '').toLowerCase();
  if (c === 'zh' || c === 'zh-cn' || c === 'zh-hans') return 'ZH';
  if (c === 'zh-tw' || c === 'zh-hant') return 'ZH';
  if (c.startsWith('ja')) return 'JA';
  if (c.startsWith('ko')) return 'KO';
  if (c.startsWith('en')) return 'EN-US';
  return 'ZH';
}

export function parseJsonStringArray(content, expectedLength) {
  let raw = String(content || '').trim();
  // Strip common markdown fences
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to extract first JSON array
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      throw new Error('无法解析翻译结果 JSON');
    }
    parsed = JSON.parse(match[0]);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('翻译结果不是数组');
  }

  const out = parsed.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
    return String(item ?? '');
  });

  if (expectedLength != null && out.length !== expectedLength) {
    // Pad or trim gently rather than hard-fail on small model drift
    if (out.length < expectedLength) {
      while (out.length < expectedLength) out.push('');
    } else {
      out.length = expectedLength;
    }
  }

  return out;
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Origins covered by public/manifest.json host_permissions.
 * Keep in sync with manifest + preset hostOrigins.
 * Never call chrome.permissions.request for these - they are already granted
 * at install, and request() after await often fails with a false "denied".
 */
const MANIFEST_HOST_ORIGINS = new Set([
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

/**
 * True if origin is covered by install-time host_permissions.
 */
export function isManifestHostOrigin(origin) {
  const o = String(origin || '').replace(/\/+$/, '').toLowerCase();
  if (!o) return false;
  if (MANIFEST_HOST_ORIGINS.has(o)) return true;
  for (const pattern of collectPresetHostPatterns()) {
    // patterns look like "https://api.stepfun.com/*"
    const base = pattern.replace(/\/\*$/, '').toLowerCase();
    if (o === base) return true;
  }
  return false;
}

export function getTranslateApiOrigin(settings) {
  const cfg = normalizeTranslateSettings(settings);
  const endpoint = resolveTranslateEndpoint(cfg);
  if (endpoint.kind === 'deepl') {
    return endpoint.deeplEndpoint === 'pro'
      ? 'https://api.deepl.com'
      : 'https://api-free.deepl.com';
  }
  return new URL(endpoint.baseUrl).origin;
}

/**
 * Validate API origin only.
 *
 * Never call chrome.permissions.request from this module.
 * Preset hosts are covered by manifest host_permissions; network calls go
 * through the service-worker translate-fetch proxy. Custom OneAPI hosts
 * should be listed in host_permissions at install time — runtime request()
 * after async gaps causes false failures.
 */
export async function ensureTranslateHostPermission(settings) {
  try {
    getTranslateApiOrigin(settings);
  } catch {
    throw new Error('API Base URL 无效');
  }
  return true;
}

/**
 * Full pipeline: collect units from preview DOM, translate, apply bilingual nodes.
 */
export async function applyPreviewTranslation(root, settings, options = {}) {
  clearPreviewTranslations(root);
  const units = collectTranslateUnits(root);
  if (!units.length) {
    return { applied: 0, total: 0, units: [] };
  }

  const texts = units.map((u) => u.text);
  const translations = await translateTexts(texts, settings, options);
  const applied = applyBilingualTranslations(units, translations);
  return { applied, total: units.length, units, translations };
}
