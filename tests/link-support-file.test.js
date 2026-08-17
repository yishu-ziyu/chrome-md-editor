/**
 * link-support-file.test.js — L8 file: 协议上下文感知回归
 *   file: 仅在「本地文件上下文」(currentFileUrl 为 file://)、桌面端(Tauri)、或调用方显式
 *   allowFileLinks 时放行；扩展/远程预览页直接点击绝对 file: 链接应被拒绝，避免信息泄露/意外导航。
 *   （相对链接在本地文件上下文中解析为 file:// 仍需放行，保持既有行为。）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreviewLinkTarget } from '../src/link-support.js';

test('L8: 远程/扩展上下文直接点击绝对 file: 链接被拒绝', () => {
  assert.equal(resolvePreviewLinkTarget('file:///C:/secret.txt', {}), null);
  assert.equal(
    resolvePreviewLinkTarget('file:///Users/me/notes/private.md', { currentFileUrl: 'https://example.com/page' }),
    null
  );
});

test('L8: 本地文件上下文（file:// base）的相对链接解析放行', () => {
  assert.equal(
    resolvePreviewLinkTarget('../notes/next.md', { currentFileUrl: 'file:///Users/demo/docs/focus/current.md' }),
    'file:///Users/demo/docs/notes/next.md'
  );
});

test('L8: 调用方显式 allowFileLinks 时放行绝对 file: 链接', () => {
  assert.equal(
    resolvePreviewLinkTarget('file:///C:/x.txt', { allowFileLinks: true }),
    'file:///C:/x.txt'
  );
});

test('L8: 远程 http(s)/mailto 链接不受影响', () => {
  assert.equal(resolvePreviewLinkTarget('https://example.com/a', {}), 'https://example.com/a');
  assert.equal(resolvePreviewLinkTarget('mailto:a@b.com', {}), 'mailto:a@b.com');
  assert.equal(resolvePreviewLinkTarget('javascript:alert(1)', {}), null);
});
