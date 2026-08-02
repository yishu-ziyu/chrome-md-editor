/**
 * 单元测试：BUG-2 滚动复位修复核心逻辑（src/scroll-restore.js 的 restoreScroll）。
 *
 * 背景：预览区 innerHTML 重建或编辑器内容全量替换会把容器 scrollTop 重置到头部，
 * 需在重置后显式恢复重建前的滚动位置，并用 requestAnimationFrame 兜底一次。
 *
 * 该纯函数无浏览器依赖（仅对 requestAnimationFrame 做能力探测 + try/catch 守卫），
 * 可在 node 纯环境单测，覆盖保存/恢复/兜底/边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreScroll } from '../src/scroll-restore.js';

// 模拟 BUG-2 真实时序：记录 savedTop → 外部 mutate（如 CodeMirror dispatch）把
// scrollTop 重置为 0 → 调用 restoreScroll 恢复。
test('restoreScroll 在外部 mutate 重置 scrollTop 后仍恢复到 savedTop（含 rAF 兜底）', () => {
  let rafCb = null;
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  try {
    const el = { scrollTop: 0 };
    const savedTop = 1000;
    el.scrollTop = 0; // 模拟 mutate 重置
    restoreScroll(el, savedTop); // 恢复
    assert.equal(el.scrollTop, savedTop);
    // rAF 兜底再次恢复
    rafCb();
    assert.equal(el.scrollTop, savedTop);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

test('restoreScroll savedTop 为 null/undefined 时不修改', () => {
  const el = { scrollTop: 0 };
  restoreScroll(el, null);
  assert.equal(el.scrollTop, 0);
  restoreScroll(el, undefined);
  assert.equal(el.scrollTop, 0);
});

test('restoreScroll el 为 null/undefined 时不抛', () => {
  assert.doesNotThrow(() => restoreScroll(null, 100));
  assert.doesNotThrow(() => restoreScroll(undefined, 100));
});

test('restoreScroll 在无 requestAnimationFrame 环境下不抛', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  delete globalThis.requestAnimationFrame;
  try {
    const el = { scrollTop: 0 };
    assert.doesNotThrow(() => restoreScroll(el, 100));
    assert.equal(el.scrollTop, 100);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

test('restoreScroll scrollTop 赋值异常时被捕获不抛出', () => {
  let rafCb = null;
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  try {
    const el = {
      get scrollTop() { return 0; },
      set scrollTop(v) { throw new Error('boom'); },
    };
    assert.doesNotThrow(() => restoreScroll(el, 100));
    // rAF 兜底中的赋值异常也被捕获
    assert.doesNotThrow(() => rafCb());
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});
