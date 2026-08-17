/**
 * compare-io-bridge-encoding.test.js — L4 编码兜底回归
 *   浏览器侧 read 优先按 UTF-8 严格解码，失败（含非法字节）回退 GBK，再失败回退宽松 UTF-8；
 *   无 arrayBuffer 的旧环境/桩件退回 file.text()。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIoBridge } from '../src/compare/io-bridge.js';

const enc = new TextEncoder();

function fileWithBytes(bytes, withText = true) {
  const buf = Uint8Array.from(bytes).buffer;
  const f = { arrayBuffer: () => Promise.resolve(buf) };
  if (withText) f.text = () => Promise.resolve(new TextDecoder('utf-8').decode(buf));
  return f;
}

test('L4: 合法 UTF-8 正常解码（含中文）', async () => {
  const bytes = enc.encode('hello 世界');
  const bridge = createIoBridge({ isTauri: false });
  const out = await bridge.read({ handle: { getFile: () => Promise.resolve(fileWithBytes(bytes)) } });
  assert.equal(out, 'hello 世界');
});

test('L4: 非 UTF-8（GBK）字节回退 GBK 解码，不乱码固化', async () => {
  // '你好' 的 GBK 编码（非法 UTF-8 序列，UTF-8 严格解码会失败）
  const gbkBytes = [0xc4, 0xe3, 0xba, 0xc3];
  const bridge = createIoBridge({ isTauri: false });
  const out = await bridge.read({ handle: { getFile: () => Promise.resolve(fileWithBytes(gbkBytes)) } });
  assert.equal(out, '你好');
});

test('L4: 无 arrayBuffer 时退回 file.text()（旧环境/桩件兼容）', async () => {
  const bridge = createIoBridge({ isTauri: false });
  const out = await bridge.read({
    handle: { getFile: () => Promise.resolve({ text: () => Promise.resolve('browser-content') }) },
  });
  assert.equal(out, 'browser-content');
});

test('L4: Tauri 模式仍走 read_text_file，不经过浏览器解码分支', async () => {
  const calls = [];
  const invoke = (cmd, args) => {
    calls.push({ cmd, args });
    return Promise.resolve('desktop-content');
  };
  const bridge = createIoBridge({ isTauri: true, invoke });
  const out = await bridge.read({ path: '/abs/file.md' });
  assert.equal(out, 'desktop-content');
  assert.equal(calls[0].cmd, 'read_text_file');
});
