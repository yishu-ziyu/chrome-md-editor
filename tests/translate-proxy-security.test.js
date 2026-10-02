import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/background.js', import.meta.url), 'utf8');
const editorUrl = 'chrome-extension://test-extension/src/editor.html';
const editor = { id: 'test-extension', url: editorUrl + '?i=123' };
const payload = { url: 'https://api.openai.com/v1/chat/completions', method: 'POST', body: '{}' };

function harness(fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'ok' })) {
  let listener;
  const calls = [];
  runInNewContext(source, {
    URL,
    chrome: {
      runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`,
        onMessage: { addListener: fn => { listener = fn; } } },
      action: { onClicked: { addListener: () => {} } },
    },
    fetch: (...args) => { calls.push(args); return fetchImpl(...args); },
  });
  return { calls, send: (sender, data = payload) => new Promise(resolve => {
    listener({ type: 'translate-fetch', payload: data }, sender, resolve);
  }) };
}

test('translation proxy only accepts the editor page of this extension', async () => {
  for (const sender of [undefined, {}, { ...editor, id: 'other' },
    { ...editor, url: 'file:///tmp/private.md', tab: { id: 1 } },
    { ...editor, url: 'https://example.com', tab: { id: 1 } },
    { ...editor, url: editorUrl + '/other' }, { id: editor.id }]) {
    const h = harness();
    assert.equal((await h.send(sender)).error, 'forbidden sender');
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.equal((await h.send(editor)).ok, true);
  assert.equal(h.calls.length, 1);
});

test('translation proxy rejects method, origin and URL credential bypasses', async () => {
  for (const override of [{ method: 'GET' }, { url: 'http://api.openai.com/v1' },
    { url: 'https://api.openai.com.evil.test/v1' }, { url: 'https://api.openai.com:8443/v1' },
    { url: 'https://user:pass@api.openai.com/v1' }, { url: 'not a URL' }]) {
    const h = harness();
    assert.equal((await h.send(editor, { ...payload, ...override })).ok, false);
    assert.equal(h.calls.length, 0);
  }
});

test('translation proxy uses allowed headers and disables redirects and cookies', async () => {
  const h = harness();
  const response = await h.send(editor, { ...payload, headers: {
    Authorization: 'test-value', 'x-api-key': 'test-value', Cookie: 'secret', 'X-Forwarded-Host': 'evil.test' } });
  assert.equal(response.text, 'ok');
  const init = h.calls[0][1];
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(Object.keys(init.headers).sort(), ['Authorization', 'x-api-key']);
});

test('translation proxy surfaces a failed redirect without returning success', async () => {
  const h = harness(async () => { throw new TypeError('redirect blocked'); });
  const response = await h.send(editor);
  assert.equal(response.ok, false);
  assert.equal(response.status, 0);
});
