// save.js — 活动栏保存 / 导出 diff
//
// 维护「活动栏」状态（用户最后聚焦的栏，取值 'a' | 'b' | 'c'），并提供：
//   - setActivePane / getActivePane：活动栏读写
//   - saveActivePane(panes)：保存当前活动栏内容到其关联的 target（落盘）
//   - saveAs(pane, panes)：对指定栏另存
//   - exportDiff(panes)：生成统一 diff 文本字符串（不落盘）
//
// 落盘依赖 io-bridge.js 的 ioBridge（read/write 环境分流）。
// 为可测，ioBridge 作为可选参数注入（默认用真实环境实例）。

import { ioBridge as defaultIoBridge } from './io-bridge.js';

// 当前活动栏，默认 'a'。
let activePane = 'a';

const VALID_PANES = ['a', 'b', 'c'];

// 设置活动栏（取值 'a' | 'b' | 'c'）。
export function setActivePane(pane) {
  if (!VALID_PANES.includes(pane)) {
    throw new Error('setActivePane: 活动栏必须是 a/b/c 之一，收到 ' + String(pane));
  }
  activePane = pane;
}

// 获取当前活动栏。
export function getActivePane() {
  return activePane;
}

// 取栏的文档内容（通过 CodeMirror EditorView.state.doc.toString()）。
function paneContent(entry) {
  if (!entry || !entry.view) return null;
  return entry.view.state.doc.toString();
}

// 保存当前活动栏内容到其关联 target。
// 返回 { saved: boolean, pane, reason? }：
//   - saved=true   ：已落盘
//   - saved=false  ：未关联文件（无 target），回退到「另存为」语义，
//     交由调用方决定（例如弹保存框）；这里仅返回标志，不弹框。
// 参数：
//   panes：{ a: { view, target }, b: {... }, c: {... } }
//   io   ：可选注入的 ioBridge（默认真实环境）。
export async function saveActivePane(panes, io = defaultIoBridge) {
  const pane = activePane;
  const entry = panes && panes[pane];
  if (!entry) {
    throw new Error('saveActivePane: 找不到活动栏 ' + pane);
  }
  if (!entry.view) {
    throw new Error('saveActivePane: 活动栏 ' + pane + ' 缺少 view');
  }
  const content = paneContent(entry);
  if (!entry.target) {
    // 未关联文件：回退「另存为」，返回标志交由调用方决定
    return { saved: false, pane, reason: 'no-target' };
  }
  await io.write(entry.target, content);
  return { saved: true, pane };
}

// 对指定栏另存（显式指定 pane）。
// 同样返回 { saved, pane }；若未提供 target 则直接抛错，由调用方补 path 后再调用。
export async function saveAs(pane, panes, io = defaultIoBridge) {
  if (!VALID_PANES.includes(pane)) {
    throw new Error('saveAs: 栏必须是 a/b/c 之一，收到 ' + String(pane));
  }
  const entry = panes && panes[pane];
  if (!entry) {
    throw new Error('saveAs: 找不到栏 ' + pane);
  }
  if (!entry.view) {
    throw new Error('saveAs: 栏 ' + pane + ' 缺少 view');
  }
  const content = paneContent(entry);
  if (!entry.target) {
    throw new Error('saveAs: 栏 ' + pane + ' 未提供保存目标（target），无法另存');
  }
  await io.write(entry.target, content);
  return { saved: true, pane };
}

// 生成统一 diff 文本字符串（不落盘）。
// 复用 compare-diff-export.js 的 buildDiffText（git 风格行级统一 diff），
// 以 A 为原始、B 为修订（B 缺失则退用 C），返回 diff 文本。
// 复用 compare-diff-export.js 的 buildDiffText（git 风格行级统一 diff）。
// 默认通过动态 import('../compare-diff-export.js') 加载真实实现
// （save.js 位于 src/compare/，目标在上级 src/，故用 '../'），避免把
// @codemirror/* 拉进 node 测试依赖图。deps.buildDiffText 可注入，便于单测
// 在不加载 CodeMirror 的情况下验证；注入不改变生产行为。
export async function exportDiff(panes, deps = {}) {
  const buildDiffText =
    deps && typeof deps.buildDiffText === 'function'
      ? deps.buildDiffText
      : (await import('../compare-diff-export.js')).buildDiffText;
  const docOf = (p) => {
    const entry = panes && panes[p];
    return entry && entry.view ? entry.view.state.doc.toString() : null;
  };
  const a = docOf('a');
  const bDoc = docOf('b');
  const b = bDoc != null ? bDoc : docOf('c');
  if (a == null || b == null) {
    throw new Error('exportDiff: 至少需要两个含 view 的栏（A 与 B/C）');
  }
  return buildDiffText(a, b);
}
