import test from 'node:test';
import assert from 'node:assert/strict';

import {
  callTranslateApi,
  clearTranslationCache,
  loadTranslateSettings,
  saveTranslateSettings,
  translateTexts,
} from '../src/translate.js';
import { isTauriEnv } from '../src/tauri-env.js';

// ---------------------------------------------------------------------------
// L5：DeepL source_lang 不再硬编码 EN，仅在显式配置 sourceLang 时下发
// ---------------------------------------------------------------------------
test('L5: DeepL 默认不下发 source_lang（交给自动检测）', async () => {
  clearTranslationCache();
  let body = null;
  const fetchImpl = async (url, init) => {
    body = init.body;
    return {
      ok: true,
      async json() {
        return { translations: [{ text: '你好' }] };
      },
      async text() {
        return '';
      },
    };
  };

  await callTranslateApi(
    ['Hello'],
    { provider: 'deepl', apiKey: 'k', deeplEndpoint: 'free', targetLang: 'zh-CN' },
    { fetchImpl }
  );

  const params = new URLSearchParams(body);
  assert.equal(params.has('source_lang'), false, '默认不应下发 source_lang');
  assert.equal(params.get('target_lang'), 'ZH');
});

test('L5: DeepL 显式 sourceLang 时下发映射后的 source_lang', async () => {
  clearTranslationCache();
  let body = null;
  const fetchImpl = async (url, init) => {
    body = init.body;
    return {
      ok: true,
      async json() {
        return { translations: [{ text: '你好' }] };
      },
      async text() {
        return '';
      },
    };
  };

  await callTranslateApi(
    ['Hallo'],
    { provider: 'deepl', apiKey: 'k', deeplEndpoint: 'pro', targetLang: 'zh-CN', sourceLang: 'de' },
    { fetchImpl }
  );

  const params = new URLSearchParams(body);
  assert.equal(params.get('source_lang'), 'DE', '应下发映射后的源语言代码');
});

// ---------------------------------------------------------------------------
// L6：翻译 API Key 混淆存储（非明文落盘）
// ---------------------------------------------------------------------------
function memoryLocalStorage() {
  const store = new Map();
  return {
    _store: store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

test('L6: API Key 落盘为混淆内容，且 load 可还原', async () => {
  const ls = memoryLocalStorage();
  globalThis.localStorage = ls;
  try {
    const saved = await saveTranslateSettings({
      provider: 'openai',
      apiKey: 'sk-secret-12345',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      targetLang: 'zh-CN',
    });

    const raw = ls.getItem('md-translate-settings');
    assert.ok(raw, '应有落盘内容');
    assert.ok(raw.includes('md-tr-obf:'), '落盘内容应带混淆前缀');
    assert.ok(
      !raw.includes('sk-secret-12345'),
      '明文 API Key 不应出现在 localStorage 中'
    );
    assert.equal(saved.apiKey, 'sk-secret-12345');

    const loaded = await loadTranslateSettings();
    assert.equal(
      loaded.apiKey,
      'sk-secret-12345',
      'load 应能反混淆还原 API Key'
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test('L6: 旧版明文数据仍可读取（向后兼容）', async () => {
  const ls = memoryLocalStorage();
  ls.setItem('md-translate-settings', JSON.stringify({ apiKey: 'legacy-key', targetLang: 'en' }));
  globalThis.localStorage = ls;
  try {
    const loaded = await loadTranslateSettings();
    assert.equal(loaded.apiKey, 'legacy-key', '无混淆前缀的旧数据应原样读取');
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------------------------------------------------------------------------
// L7：翻译缓存带 LRU 上限（500 条），淘汰最旧、保留最近
// ---------------------------------------------------------------------------
test('L7: 缓存超过 500 条后淘汰最旧、保留最近', async () => {
  clearTranslationCache();
  const N = 600;
  const all = Array.from({ length: N }, (_, i) => `T${i}`);

  let received = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const texts = JSON.parse(body.messages[1].content);
    received.push(...texts);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(texts.map((t) => '译:' + t)) } }] };
      },
      async text() {
        return '';
      },
    };
  };

  const settings = {
    provider: 'openai',
    apiKey: 'k',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    targetLang: 'zh-CN',
  };

  // 首次填满 600 条（全部 miss，经 translateTexts 缓存层）
  await translateTexts(all, settings, { fetchImpl });

  // 二次请求：T0 应已被淘汰（重新走网络），T599 应仍在缓存（命中）
  received = [];
  await translateTexts(['T0', 'T599'], settings, { fetchImpl });

  assert.ok(received.includes('T0'), '最旧的 T0 应被淘汰并重新请求');
  assert.ok(!received.includes('T599'), '最近的 T599 应仍在缓存中');
});

// ---------------------------------------------------------------------------
// M10：Tauri 环境判定口径统一（覆盖 __TAURI_INTERNALS__ / isTauri / __TAURI__）
// ---------------------------------------------------------------------------
test('M10: isTauriEnv 统一判定三种注入写法', () => {
  const original = globalThis.window;
  try {
    globalThis.window = undefined;
    assert.equal(isTauriEnv(), false, '非浏览器环境应为 false');

    globalThis.window = {};
    assert.equal(isTauriEnv(), false, '无 Tauri 标记应为 false');

    globalThis.window = { __TAURI_INTERNALS__: {} };
    assert.equal(isTauriEnv(), true, '__TAURI_INTERNALS__ 应判定为 Tauri');

    globalThis.window = { isTauri: true };
    assert.equal(isTauriEnv(), true, 'isTauri 应判定为 Tauri');

    globalThis.window = { __TAURI__: {} };
    assert.equal(isTauriEnv(), true, '__TAURI__ 应判定为 Tauri');
  } finally {
    globalThis.window = original;
  }
});
