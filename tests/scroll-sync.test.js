/**
 * scroll-sync.test.js — src/scroll-sync.js 单元验收（T4）
 *
 * createScrollSync 不依赖 @codemirror（只用鸭子类型读 view.scrollDOM / scrollBox），故可用
 * 纯 node 下的「mock 滚动盒」真实驱动逻辑，无需 jsdom / 浏览器：
 *   - linkPair 比例换算：a 滚动 → 按 (scrollTop/max) 比例驱动 b.scrollTop
 *   - checkAligned 阈值：位置比差 <= ±15% 视为对齐；超阈值但段落文本高度相似（Jaccard >= 0.8）兜底对齐
 *   - alignToActive：把其余栏滚到激活栏光标段落对应的相对位置
 *
 * mock 滚动盒只需实现：nodeType===1、scrollTop/scrollHeight/clientHeight、addEventListener /
 * removeEventListener / dispatch、closest（返回 null 即视为普通盒子）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollSync, scrollAdapter } from '../src/scroll-sync.js';

// 构造一个最小化的滚动盒 mock。
function makeBox(opts = {}) {
  const { scrollTop = 0, scrollHeight = 1000, clientHeight = 100 } = opts;
  const listeners = {};
  return {
    nodeType: 1,
    scrollTop,
    scrollHeight,
    clientHeight,
    addEventListener(type, h) {
      (listeners[type] = listeners[type] || []).push(h);
    },
    removeEventListener(type, h) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((x) => x !== h);
    },
    dispatch(type, ev) {
      (listeners[type] || []).forEach((h) => h(ev || {}));
    },
    closest() {
      return null;
    },
  };
}

const noop = () => {};
const baseOpts = () => ({ isEnabled: () => true, setEnabled: noop, onMisalign: noop });

test('scroll-sync: linkPair 按比例换算驱动对端 scrollTop', () => {
  const a = makeBox({ scrollHeight: 1000, clientHeight: 100, scrollTop: 0 });
  const b = makeBox({ scrollHeight: 2000, clientHeight: 200, scrollTop: 0 });
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [scrollAdapter(a), scrollAdapter(b)],
    pairs: [[0, 1]],
  });
  // a 滚到 450，max=900 → ratio 0.5；b.max=1800 → 期望 b.scrollTop = 0.5*1800 = 900
  a.scrollTop = 450;
  a.dispatch('scroll');
  assert.equal(b.scrollTop, 900);
  ctrl.destroy();
});

test('scroll-sync: linkPair 反向（b 滚动驱动 a）比例换算', () => {
  const a = makeBox({ scrollHeight: 2000, clientHeight: 200, scrollTop: 0 });
  const b = makeBox({ scrollHeight: 1000, clientHeight: 100, scrollTop: 0 });
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [scrollAdapter(a), scrollAdapter(b)],
    pairs: [[0, 1]],
  });
  b.scrollTop = 450; // ratio 0.5；a.max=1800 → 期望 900
  b.dispatch('scroll');
  assert.equal(a.scrollTop, 900);
  ctrl.destroy();
});

test('scroll-sync: checkAligned 位置比在 ±15% 内判定对齐', () => {
  const paraA = { ratio: 0.5, text: 'alpha beta gamma', cursorLine: 5, totalLines: 10 };
  const paraB = { ratio: 0.55, text: 'alpha beta gamma' };
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [
      scrollAdapter(makeBox(), { getCursorParagraph: () => paraA }),
      scrollAdapter(makeBox(), { getCursorParagraph: () => paraB }),
    ],
    pairs: [[0, 1]],
  });
  assert.equal(ctrl.isAligned(), true);
  ctrl.destroy();
});

test('scroll-sync: checkAligned 位置比超阈值且文本不相似 → 未对齐', () => {
  const paraA = { ratio: 0.5, text: 'apple banana cherry dog' };
  const paraB = { ratio: 0.95, text: 'xylophone zebra quantum nebula' };
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [
      scrollAdapter(makeBox(), { getCursorParagraph: () => paraA }),
      scrollAdapter(makeBox(), { getCursorParagraph: () => paraB }),
    ],
    pairs: [[0, 1]],
  });
  assert.equal(ctrl.isAligned(), false);
  ctrl.destroy();
});

test('scroll-sync: checkAligned 位置比超阈值但文本高度相似 → 兜底对齐', () => {
  const paraA = { ratio: 0.5, text: 'the quick brown fox jumps over' };
  const paraB = { ratio: 0.95, text: 'the quick brown fox jumps over' };
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [
      scrollAdapter(makeBox(), { getCursorParagraph: () => paraA }),
      scrollAdapter(makeBox(), { getCursorParagraph: () => paraB }),
    ],
    pairs: [[0, 1]],
  });
  assert.equal(ctrl.isAligned(), true);
  ctrl.destroy();
});

test('scroll-sync: 单栏 isAligned 恒为 true（不足两栏无法判未对齐）', () => {
  const paraA = { ratio: 0.5, text: 'x' };
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [scrollAdapter(makeBox(), { getCursorParagraph: () => paraA })],
  });
  assert.equal(ctrl.isAligned(), true);
  ctrl.destroy();
});

test('scroll-sync: alignToActive 把其余栏滚到激活栏相对位置', () => {
  const a = makeBox({ scrollHeight: 1000, clientHeight: 100, scrollTop: 0 });
  const b = makeBox({ scrollHeight: 1000, clientHeight: 100, scrollTop: 0 });
  const ctrl = createScrollSync({
    ...baseOpts(),
    views: [scrollAdapter(a), scrollAdapter(b)],
    pairs: [[0, 1]],
  });
  // 激活栏 = a：focusin 设置 activeItem
  a.dispatch('focusin');
  // a 滚到 300 → ratio 300/900 = 0.3333；b 应被同步到 0.3333*(1000-100) = 300
  a.scrollTop = 300;
  ctrl.alignToActive();
  assert.equal(b.scrollTop, 300);
  ctrl.destroy();
});

test('scroll-sync: 构造参数校验 — isEnabled/setEnabled 缺失抛 TypeError', () => {
  assert.throws(
    () => createScrollSync({ views: [], onMisalign: noop }),
    /isEnabled \/ setEnabled/
  );
});
