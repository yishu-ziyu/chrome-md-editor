import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  applyBilingualTranslations,
  clearPreviewTranslations,
  collectTranslateUnits,
  extractUnitText,
  normalizeTranslateSettings,
  parseJsonStringArray,
  shouldTranslateText,
  translateTexts,
  clearTranslationCache,
  callTranslateApi,
  stripModelThinkingNoise,
  ensureTranslateHostPermission,
  getTranslateApiOrigin,
  isManifestHostOrigin,
  extractAnthropicText,
  extensionFetch,
} from '../src/translate.js';
import {
  DEFAULT_PRESET_ID,
  buildAnthropicMessagesUrl,
  getTranslatePreset,
  groupTranslatePresets,
  inferPresetIdFromLegacy,
  listTranslatePresets,
  resolveTranslateEndpoint,
} from '../src/translate-presets.js';
import { htmlToMarkdown } from '../src/html-to-markdown.js';

function setup(html) {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body><div id="root" class="markdown-body">${html}</div></body></html>`
  );
  return { document, root: document.getElementById('root') };
}

test('shouldTranslateText requires Latin letters', () => {
  assert.equal(shouldTranslateText('Hello world'), true);
  assert.equal(shouldTranslateText('这是中文段落'), false);
  assert.equal(shouldTranslateText('123'), false);
  assert.equal(shouldTranslateText('a'), false);
});

test('collectTranslateUnits picks headings and paragraphs, skips code', () => {
  const { root } = setup(`
    <h1>Introduction</h1>
    <p>This is a long English paragraph about product design.</p>
    <pre><code>const x = 1;</code></pre>
    <p>纯中文不翻译</p>
    <ul><li>First item in English</li><li>第二项</li></ul>
  `);

  const units = collectTranslateUnits(root);
  const texts = units.map((u) => u.text);
  assert.ok(texts.includes('Introduction'));
  assert.ok(texts.some((t) => t.includes('product design')));
  assert.ok(texts.includes('First item in English'));
  assert.ok(!texts.some((t) => t.includes('const x')));
  assert.ok(!texts.includes('纯中文不翻译'));
});

test('extractUnitText drops nested lists and translation nodes', () => {
  const { root } = setup(`
    <li>Parent item
      <ul><li>Nested child</li></ul>
      <span class="md-translation">父项</span>
    </li>
  `);
  const li = root.querySelector('li');
  assert.equal(extractUnitText(li), 'Parent item');
});

test('applyBilingualTranslations injects contenteditable=false nodes', () => {
  const { root } = setup('<p id="p1">Hello product managers</p>');
  const units = collectTranslateUnits(root);
  applyBilingualTranslations(units, ['你好，产品经理']);
  const tr = root.querySelector('.md-translation');
  assert.ok(tr);
  assert.equal(tr.textContent, '你好，产品经理');
  assert.equal(tr.getAttribute('contenteditable'), 'false');
  assert.equal(tr.getAttribute('data-md-translation'), '1');
});

test('clearPreviewTranslations removes injected nodes', () => {
  const { root } = setup('<p>Hello world again here</p>');
  const units = collectTranslateUnits(root);
  applyBilingualTranslations(units, ['你好世界']);
  assert.equal(root.querySelectorAll('.md-translation').length, 1);
  clearPreviewTranslations(root);
  assert.equal(root.querySelectorAll('.md-translation').length, 0);
});

test('htmlToMarkdown ignores translation nodes', () => {
  const md = htmlToMarkdown(
    '<p>Hello world<span class="md-translation" data-md-translation="1">你好世界</span></p>',
    { parseHTML }
  );
  assert.equal(md.trim(), 'Hello world');
  assert.ok(!md.includes('你好'));
});

test('parseJsonStringArray handles fenced JSON', () => {
  const out = parseJsonStringArray('```json\n["一","二"]\n```', 2);
  assert.deepEqual(out, ['一', '二']);
});

test('normalizeTranslateSettings defaults to MiniMax Anthropic Token Plan', () => {
  const s = normalizeTranslateSettings({ apiKey: ' k ' });
  assert.equal(s.presetId, DEFAULT_PRESET_ID);
  assert.equal(s.presetId, 'minimax');
  assert.equal(s.provider, 'anthropic');
  assert.equal(s.apiKey, 'k');
  assert.equal(s.model, 'MiniMax-M2.5-highspeed');
  assert.equal(s.baseUrl, 'https://api.minimaxi.com/anthropic/v1');
});

test('Context7-synced critical base URLs stay current', () => {
  assert.equal(getTranslatePreset('minimax').kind, 'anthropic');
  assert.equal(getTranslatePreset('minimax').baseUrl, 'https://api.minimaxi.com/anthropic/v1');
  assert.equal(getTranslatePreset('minimax').defaultModel, 'MiniMax-M2.5-highspeed');
  assert.equal(getTranslatePreset('minimax-openai').baseUrl, 'https://api.minimaxi.com/v1');
  assert.equal(getTranslatePreset('minimax-intl').baseUrl, 'https://api.minimax.io/anthropic/v1');
  assert.equal(getTranslatePreset('stepfun-plan').kind, 'anthropic');
  assert.equal(getTranslatePreset('stepfun-plan').baseUrl, 'https://api.stepfun.com/step_plan/v1');
  assert.equal(getTranslatePreset('stepfun-plan').defaultModel, 'step-3.5-flash-2603');
  assert.equal(getTranslatePreset('stepfun-plan-openai').kind, 'openai');
  assert.equal(getTranslatePreset('stepfun').baseUrl, 'https://api.stepfun.com/v1');
  assert.equal(getTranslatePreset('deepseek').baseUrl, 'https://api.deepseek.com');
  assert.equal(getTranslatePreset('deepseek').defaultModel, 'deepseek-v4-flash');
  assert.equal(getTranslatePreset('openai').baseUrl, 'https://api.openai.com/v1');
  assert.equal(getTranslatePreset('openrouter').baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(getTranslatePreset('moonshot').baseUrl, 'https://api.moonshot.cn/v1');
  assert.equal(getTranslatePreset('moonshot-intl').baseUrl, 'https://api.moonshot.ai/v1');
  assert.equal(getTranslatePreset('siliconflow').baseUrl, 'https://api.siliconflow.cn/v1');
  assert.equal(getTranslatePreset('siliconflow-intl').baseUrl, 'https://api.siliconflow.com/v1');
  assert.equal(
    getTranslatePreset('gemini').baseUrl,
    'https://generativelanguage.googleapis.com/v1beta/openai'
  );
  assert.equal(getTranslatePreset('qwen').baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(getTranslatePreset('zhipu').baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(getTranslatePreset('groq').baseUrl, 'https://api.groq.com/openai/v1');
});

test('normalizeTranslateSettings applies OpenRouter preset without manual URL', () => {
  const s = normalizeTranslateSettings({
    presetId: 'openrouter',
    apiKey: 'sk-or-test',
  });
  assert.equal(s.provider, 'openai');
  assert.equal(s.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(s.model, 'openai/gpt-4o-mini');
});

test('normalizeTranslateSettings DeepL free preset', () => {
  const s = normalizeTranslateSettings({
    presetId: 'deepl-free',
    apiKey: 'key:fx',
  });
  assert.equal(s.provider, 'deepl');
  assert.equal(s.deeplEndpoint, 'free');
});

test('preset catalog is rich and grouped', () => {
  const all = listTranslatePresets();
  assert.ok(all.length >= 15, `expected many presets, got ${all.length}`);
  const ids = new Set(all.map((p) => p.id));
  for (const id of [
    'openai',
    'deepseek',
    'moonshot',
    'moonshot-intl',
    'qwen',
    'minimax',
    'minimax-openai',
    'minimax-intl',
    'stepfun-plan',
    'stepfun-plan-openai',
    'stepfun',
    'openrouter',
    'siliconflow',
    'siliconflow-intl',
    'aihubmix',
    'api302',
    'oneapi',
    'deepl-free',
    'custom',
  ]) {
    assert.ok(ids.has(id), `missing preset ${id}`);
  }
  const groups = groupTranslatePresets();
  assert.ok(groups.some((g) => g.group === 'aggregator'));
  assert.ok(getTranslatePreset('siliconflow').baseUrl.includes('siliconflow'));
});

test('inferPresetIdFromLegacy maps base URLs', () => {
  assert.equal(
    inferPresetIdFromLegacy({ baseUrl: 'https://api.siliconflow.cn/v1' }),
    'siliconflow'
  );
  assert.equal(
    inferPresetIdFromLegacy({ provider: 'deepl', deeplEndpoint: 'pro' }),
    'deepl-pro'
  );
});

test('resolveTranslateEndpoint fills defaults from preset', () => {
  const ep = resolveTranslateEndpoint({
    presetId: 'qwen',
    apiKey: 'x',
    model: '',
    baseUrl: '',
  });
  assert.equal(ep.kind, 'openai');
  assert.ok(ep.baseUrl.includes('dashscope'));
  assert.equal(ep.model, 'qwen-turbo');
});

test('translateTexts uses cache and mock fetch only for misses', async () => {
  clearTranslationCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify(['缓存乙']) } }],
        };
      },
      async text() {
        return '';
      },
    };
  };

  const settings = {
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    targetLang: 'zh-CN',
  };

  const first = await translateTexts(['Alpha text'], settings, { fetchImpl });
  assert.deepEqual(first, ['缓存乙']);
  assert.equal(calls, 1);

  const second = await translateTexts(['Alpha text', 'Alpha text'], settings, {
    fetchImpl,
  });
  assert.deepEqual(second, ['缓存乙', '缓存乙']);
  assert.equal(calls, 1);
});

test('stripModelThinkingNoise removes MiniMax think tags', () => {
  const raw = '<think>plan the json</think>\n["你好","世界"]';
  assert.equal(stripModelThinkingNoise(raw), '["你好","世界"]');
});

test('buildAnthropicMessagesUrl and extractAnthropicText', () => {
  assert.equal(
    buildAnthropicMessagesUrl('https://api.minimaxi.com/anthropic/v1'),
    'https://api.minimaxi.com/anthropic/v1/messages'
  );
  assert.equal(
    buildAnthropicMessagesUrl('https://api.stepfun.com/step_plan'),
    'https://api.stepfun.com/step_plan/v1/messages'
  );
  assert.equal(
    extractAnthropicText({
      content: [
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: '["你好"]' },
      ],
    }),
    '["你好"]'
  );
});

test('extensionFetch uses inject fetchImpl when provided', async () => {
  let hit = false;
  const res = await extensionFetch(
    'https://example.com',
    { method: 'GET' },
    {
      fetchImpl: async (url) => {
        hit = true;
        assert.equal(url, 'https://example.com');
        return {
          ok: true,
          status: 200,
          async text() {
            return 'ok';
          },
          async json() {
            return { ok: true };
          },
        };
      },
    }
  );
  assert.equal(hit, true);
  assert.equal(res.ok, true);
  assert.equal(await res.text(), 'ok');
});

test('extensionFetch 超时：fetchImpl 永不应答时按时 reject（H2 回归）', async () => {
  // 用一个永远 pending 的 fetchImpl 模拟「翻译 API 挂起」，必须在 timeoutMs 内 reject，
  // 否则翻译 UI 会永久卡在「翻译中」。
  const neverResolve = () => new Promise(() => {}); // 永不应答
  await assert.rejects(
    () => extensionFetch('https://example.com', { method: 'GET' }, { fetchImpl: neverResolve, timeoutMs: 200 }),
    /超时/
  );
});

test('callTranslateApi MiniMax Anthropic path uses /messages + x-api-key', async () => {
  clearTranslationCache();
  let seenUrl = '';
  let seenHeaders = null;
  let seenBody = null;
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenHeaders = init.headers;
    seenBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          content: [{ type: 'text', text: '<think>x</think>["译A"]' }],
        };
      },
      async text() {
        return '';
      },
    };
  };

  const out = await callTranslateApi(['Hello'], {
    presetId: 'minimax',
    apiKey: 'sk-cp-test',
    model: 'MiniMax-M3',
  }, { fetchImpl });

  assert.equal(seenUrl, 'https://api.minimaxi.com/anthropic/v1/messages');
  assert.equal(seenHeaders['x-api-key'], 'sk-cp-test');
  assert.equal(seenHeaders['anthropic-version'], '2023-06-01');
  assert.equal(seenBody.model, 'MiniMax-M3');
  assert.equal(seenBody.max_tokens, 8192);
  assert.deepEqual(seenBody.thinking, { type: 'disabled' });
  assert.deepEqual(out, ['译A']);
});

test('getTranslateApiOrigin and ensureTranslateHostPermission allow known presets', async () => {
  assert.equal(
    getTranslateApiOrigin({ presetId: 'minimax', apiKey: 'x' }),
    'https://api.minimaxi.com'
  );
  assert.equal(
    getTranslateApiOrigin({ presetId: 'stepfun-plan', apiKey: 'x' }),
    'https://api.stepfun.com'
  );
  // Outside extension chrome is undefined → always true; never throws 未授权
  assert.equal(
    await ensureTranslateHostPermission({ presetId: 'minimax', apiKey: 'x' }),
    true
  );
  assert.equal(
    await ensureTranslateHostPermission({ presetId: 'stepfun-plan', apiKey: 'x' }),
    true
  );
  assert.equal(isManifestHostOrigin('https://api.minimaxi.com'), true);
  assert.equal(isManifestHostOrigin('https://api.minimax.chat'), true);
  assert.equal(isManifestHostOrigin('https://api.stepfun.com'), true);
  assert.equal(isManifestHostOrigin('https://evil.example.com'), false);
});

test('callTranslateApi Step Plan Anthropic uses /step_plan/v1/messages', async () => {
  clearTranslationCache();
  let seenUrl = '';
  let seenBody = null;
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          content: [{ type: 'text', text: JSON.stringify(['译B']) }],
        };
      },
      async text() {
        return '';
      },
    };
  };

  const out = await callTranslateApi(['Hello'], {
    presetId: 'stepfun-plan',
    apiKey: 'step-plan-key',
  }, { fetchImpl });

  assert.equal(seenUrl, 'https://api.stepfun.com/step_plan/v1/messages');
  assert.equal(seenBody.model, 'step-3.5-flash-2603');
  assert.deepEqual(seenBody.output_config, { effort: 'low' });
  assert.deepEqual(out, ['译B']);
});

test('callTranslateApi MiniMax OpenAI path still works', async () => {
  clearTranslationCache();
  let seenUrl = '';
  const fetchImpl = async (url) => {
    seenUrl = String(url);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify(['译C']) } }],
        };
      },
      async text() {
        return '';
      },
    };
  };

  const out = await callTranslateApi(['Hello'], {
    presetId: 'minimax-openai',
    apiKey: 'mm-key',
  }, { fetchImpl });

  assert.equal(seenUrl, 'https://api.minimaxi.com/v1/chat/completions');
  assert.deepEqual(out, ['译C']);
});

test('callTranslateApi DeepL path builds expected result', async () => {
  clearTranslationCache();
  const fetchImpl = async (url, init) => {
    assert.ok(String(url).includes('api-free.deepl.com'));
    assert.ok(String(init.headers.Authorization).includes('DeepL-Auth-Key'));
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

  const out = await callTranslateApi(['Hello'], {
    provider: 'deepl',
    apiKey: 'deepl-key',
    deeplEndpoint: 'free',
    targetLang: 'zh-CN',
  }, { fetchImpl });

  assert.deepEqual(out, ['你好']);
});
