/**
 * save-poll.test.js — src/save-poll.js 单元验收（T4）
 *
 * runSavePoll(panes, order) 从左到右逐栏弹原生 DOM modal，四按钮：保存 / 另存为 / 不保存 /
 * 取消。本文件用 linkedom 提供桩 document（showPaneSaveDialog / showSaveAsDialog 需要
 * createElement / appendChild / onclick 等 DOM API，但 linkedom 足以驱动），桩 ioBridge
 * 记录 write/saveAs/pickSaveTarget 调用，验证：
 *   - order 决定从左到右轮询顺序
 *   - 点「取消」→ aborted=true 且中止整轮（已处理栏之外不再写盘）
 *   - 「不保存」计入 skip 且不写盘
 *   - 无源 target（合并结果 b）点「保存」走 saveAs（经 pickSaveTarget 拿新目标）
 *
 * 注意：linkedom 的 <input> 缺 select()，save-poll 在 showSaveAsDialog 中调用 input.select()，
 * 故在 HTMLElement.prototype 上补 no-op select。
 */

import { parseHTML, HTMLElement } from 'linkedom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSavePoll } from '../src/save-poll.js';
import { ioBridge } from '../src/compare/io-bridge.js';

const { document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
globalThis.document = document;
if (HTMLElement && typeof HTMLElement.prototype.select !== 'function') {
  // save-poll 在 showSaveAsDialog 中调用 input.select()
  HTMLElement.prototype.select = function () {};
}

// 桩 ioBridge：记录写盘调用（ioBridge 为单例对象，属性可改写）
let writes = [];
let saves = [];
let picked = [];
ioBridge.write = async (target, content) => {
  writes.push({ target, content });
};
ioBridge.saveAs = async (target, content) => {
  saves.push({ target, content });
};
ioBridge.pickSaveTarget = async (name) => {
  picked.push(name);
  return { path: '/tmp/' + name };
};

function resetRecords() {
  writes = [];
  saves = [];
  picked = [];
}
function clearOverlays() {
  const els = Array.from(document.body.querySelectorAll('.save-poll-overlay'));
  for (const el of els) el.remove();
}

// 点击当前（最后一个）modal 中指定文本的按钮
function clickButton(label) {
  const modals = Array.from(document.body.querySelectorAll('.save-poll-modal'));
  assert.ok(modals.length > 0, '应有弹出的保存 modal');
  const modal = modals[modals.length - 1];
  const btns = Array.from(modal.querySelectorAll('button'));
  for (const b of btns) {
    if (b.textContent === label) {
      b.onclick();
      return;
    }
  }
  throw new Error('未找到按钮: ' + label);
}

const flush = () => new Promise((r) => setImmediate(r));
async function click(label) {
  clickButton(label);
  await flush();
}

// ─────────────────────────────────────────────────────────────────────────

test('save-poll: order 决定从左到右轮询顺序', async () => {
  resetRecords();
  clearOverlays();
  const panes = [
    { key: 'a', view: {}, target: { path: '/a.md' }, content: 'AA' },
    { key: 'b', view: {}, target: { path: '/b.md' }, content: 'BB' },
    { key: 'c', view: {}, target: { path: '/c.md' }, content: 'CC' },
  ];
  const p = runSavePoll(panes, ['a', 'b', 'c']);
  await click('保存');
  await click('保存');
  await click('保存');
  const res = await p;

  assert.equal(res.aborted, false);
  assert.deepEqual(
    res.actions.map((a) => a.key),
    ['a', 'b', 'c'],
    'actions 顺序应与 order 一致'
  );
  assert.deepEqual(
    res.actions.map((a) => a.action),
    ['save', 'save', 'save']
  );
  assert.equal(writes.length, 3, '三栏均保存应写盘 3 次');
  assert.deepEqual(
    writes.map((w) => w.content),
    ['AA', 'BB', 'CC']
  );
});

test('save-poll: 点「取消」→ aborted=true 且中止整轮', async () => {
  resetRecords();
  clearOverlays();
  const panes = [
    { key: 'a', view: {}, target: { path: '/a.md' }, content: 'AA' },
    { key: 'b', view: {}, target: { path: '/b.md' }, content: 'BB' },
    { key: 'c', view: {}, target: { path: '/c.md' }, content: 'CC' },
  ];
  const p = runSavePoll(panes, ['a', 'b', 'c']);
  await click('保存'); // a 保存
  await click('取消'); // b 取消 → 中止
  const res = await p;

  assert.equal(res.aborted, true, '取消应置 aborted=true');
  assert.deepEqual(
    res.actions.map((a) => a.key),
    ['a'],
    '取消后只处理了已保存的 a'
  );
  assert.equal(writes.length, 1, '中止后 b/c 不应写盘');
});

test('save-poll: 「不保存」计入 skip 且不写盘', async () => {
  resetRecords();
  clearOverlays();
  const panes = [
    { key: 'a', view: {}, target: { path: '/a.md' }, content: 'AA' },
    { key: 'b', view: {}, target: { path: '/b.md' }, content: 'BB' },
    { key: 'c', view: {}, target: { path: '/c.md' }, content: 'CC' },
  ];
  const p = runSavePoll(panes, ['a', 'b', 'c']);
  await click('不保存');
  await click('不保存');
  await click('不保存');
  const res = await p;

  assert.equal(res.aborted, false);
  assert.equal(res.actions.length, 3, '三栏均跳过应记 3 个 skip');
  assert.ok(res.actions.every((a) => a.action === 'skip'), '所有 action 应为 skip');
  assert.equal(writes.length, 0, 'skip 不应写盘');
  assert.equal(saves.length, 0, 'skip 不应另存为');
});

test('save-poll: 无源 target（合并结果 b）点「保存」走 saveAs', async () => {
  resetRecords();
  clearOverlays();
  const panes = [
    { key: 'a', view: {}, target: { path: '/a.md' }, content: 'AA' },
    { key: 'b', view: {}, target: null, content: 'MERGED' }, // 合并结果，无源
  ];
  const p = runSavePoll(panes, ['a', 'b']);
  await click('保存'); // a → 覆盖写盘
  await click('保存'); // b 无源 → 打开另存为弹窗
  // 在另存为弹窗中填文件名并确认
  const inputs = Array.from(document.body.querySelectorAll('.save-poll-input'));
  assert.ok(inputs.length > 0, '无源栏「保存」应弹出另存为输入框');
  const input = inputs[inputs.length - 1];
  input.value = 'merged.md';
  clickButton('选择路径并保存');
  await flush();

  const res = await p;
  assert.equal(res.aborted, false);
  assert.deepEqual(
    res.actions.map((a) => a.key),
    ['a', 'b']
  );
  assert.equal(writes.length, 1, 'a 应走覆盖写盘');
  assert.equal(saves.length, 1, 'b 无源应走 saveAs');
  assert.equal(saves[0].content, 'MERGED', 'saveAs 内容应为合并结果内容');
  assert.deepEqual(picked, ['merged.md'], '另存为 suggestedName 应为 merged.md');
});
