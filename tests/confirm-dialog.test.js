/**
 * confirm-dialog.test.js — src/confirm-dialog.js 单元验收
 *
 * showConfirm(message) 返回 Promise<boolean>，用页内 DOM 弹窗（非阻塞）取代 window.confirm。
 * 修复前 autosave 的 offerDraftRestore 在初始化期调用 window.confirm 会锁死渲染进程主线程
 * （表现为 editor 页「renderer 崩溃」误判）。本文件用 linkedom 桩 document 验证：
 *   - 调用后出现 #confirmDialogOverlay，且全程不调用 window.confirm（非阻塞）
 *   - 点「确定」→ resolve(true) 且弹窗移除
 *   - 点「取消」→ resolve(false) 且弹窗移除
 *   - 已存在弹窗时再次调用 → 直接 resolve(false)（防堆叠）
 */

import { parseHTML } from 'linkedom';
import test from 'node:test';
import assert from 'node:assert/strict';

const { document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
globalThis.document = document;

// 捕获任何意外原生阻塞对话框调用：本模块必须完全不依赖 window.confirm
let nativeConfirmCalls = 0;
globalThis.confirm = () => { nativeConfirmCalls++; return false; };

const { showConfirm } = await import('../src/confirm-dialog.js');

const fireClick = (el) => { if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new (document.defaultView?.Event || Event)('click')); };

test('showConfirm 出现页内弹窗且不使用 window.confirm（非阻塞）', async () => {
  const p = showConfirm('是否继续？');
  assert.ok(p instanceof Promise, '应返回 Promise<boolean>');
  const overlay = document.getElementById('confirmDialogOverlay');
  assert.ok(overlay, 'body 内应出现 #confirmDialogOverlay');
  assert.equal(nativeConfirmCalls, 0, '不得调用 window.confirm（避免阻塞主线程）');
  // 清理：点第一个按钮（取消）
  fireClick(overlay.querySelector('button'));
  assert.equal(await p, false);
});

test('点「确定」resolve(true) 且弹窗移除', async () => {
  const p = showConfirm('确定执行？');
  const overlay = document.getElementById('confirmDialogOverlay');
  const btns = overlay.querySelectorAll('button');
  fireClick(btns[btns.length - 1]); // 最后一个按钮 = 确定
  assert.equal(await p, true);
  assert.equal(document.getElementById('confirmDialogOverlay'), null, '弹窗应被移除');
});

test('点「取消」resolve(false) 且弹窗移除', async () => {
  const p = showConfirm('取消？');
  const overlay = document.getElementById('confirmDialogOverlay');
  fireClick(overlay.querySelector('button')); // 第一个按钮 = 取消
  assert.equal(await p, false);
  assert.equal(document.getElementById('confirmDialogOverlay'), null, '弹窗应被移除');
});

test('已存在弹窗时再次调用 resolve(false)（防堆叠）', async () => {
  const p1 = showConfirm('first');
  const p2 = showConfirm('second'); // 此时 overlay 已存在，应直接 resolve(false)
  assert.equal(await p2, false, '第二个调用应直接 resolve(false)');
  // 清理第一个调用产生的弹窗
  const overlay = document.getElementById('confirmDialogOverlay');
  const btns = overlay.querySelectorAll('button');
  fireClick(btns[btns.length - 1]);
  assert.equal(await p1, true);
});
