// M11 回归测试：预览防闪烁哈希（cyrb53）的碰撞修复验证。
//
// 说明：src/editor.js 是浏览器模块（加载即执行 init()，依赖 document / CodeMirror /
// DOMPurify / mermaid / chrome.* 等运行时），无法在 node 测试环境中直接 import。
// 本测试镜像 src/editor.js 中的 cyrb53 实现，用于锁定「等长且首尾相同的中部变更」
// 不再被误判为未变这一核心性质。完整的预览「跳过渲染」路径需浏览器真机验证。
import test from 'node:test';
import assert from 'node:assert/strict';

// 与 src/editor.js 中 cyrb53 实现保持一致（请勿随意改动，保持与源同步）。
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

test('cyrb53：相同内容哈希稳定（预览跳过渲染依赖此性质）', () => {
  const html = '<p>hello world</p>';
  assert.equal(cyrb53(html), cyrb53(html));
});

test('cyrb53：等长且首尾相同的中部变更不再碰撞（M11 核心修复）', () => {
  // 旧方案 quickHash = len + slice(0,50) + slice(-50) 在此场景下会碰撞，导致跳过渲染、预览陈旧。
  const head = 'A'.repeat(50);
  const tail = 'Z'.repeat(50);
  const a = head + 'X'.repeat(100) + tail;
  const b = head + 'Y'.repeat(100) + tail; // 中部不同，但等长、首尾相同
  assert.notEqual(cyrb53(a), cyrb53(b));
});

test('cyrb53：仅中部插入一段（首尾不变）仍能区分', () => {
  const head = 'B'.repeat(50);
  const tail = 'C'.repeat(50);
  const base = head + 'fixed-middle' + tail;
  const inserted = head + 'fixed-middle INSERTED TEXT' + tail;
  assert.notEqual(cyrb53(base), cyrb53(inserted));
});

test('cyrb53：空串不抛错且返回字符串', () => {
  assert.equal(typeof cyrb53(''), 'string');
});

test('cyrb53：首尾 50 字符相同但长度不同也能区分', () => {
  const head = 'H'.repeat(50);
  const tail = 'T'.repeat(50);
  const short = head + tail;
  const long = head + 'extra content'.repeat(20) + tail;
  assert.notEqual(cyrb53(short), cyrb53(long));
});
