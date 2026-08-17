/**
 * compare-active-pane.test.js — 活动栏描边「持久性」回归断言
 *
 * 背景：Ctrl+S /「保存」写回的是【活动栏】（save.js 的 activePane），这是【写盘】操作。
 * 用户必须能在按下保存的那一刻确认「现在会覆盖哪个文件」，否则三栏模式下先瞄一眼
 * Theirs 栏再点保存，就会在毫无提示的情况下写回 Theirs 的源文件。
 *
 * 曾经的实现只用 CodeMirror 自带的 `.cm-focused` 表达活动栏。该类由 CM 自动管理、
 * 【失焦即移除】：用户点工具栏「保存」按钮的瞬间编辑器已失焦，描边随即消失 ——
 * 恰好在做写盘决策时屏幕上没有任何视觉锚点。
 *
 * 修复一：引入持久类 `cmp-pane-active`，由 compare.js 在 focusin 时切换、失焦不清除。
 *
 * 修复二（真机点检暴露的第二层坑，务必读）：持久类最初是用
 * `view.dom.classList.toggle()` 手工加到 `.cm-editor` 上的，静态断言全绿、
 * 却在真机 100% 失效。根因是 CodeMirror 6 把 `.cm-editor` 根节点的 class 属性
 * 当作【自己的私产】：它由 `EditorView.editorAttributes` facet 算出完整字符串，
 * 并在每次 updateAttrs() 时【整体覆写】，而焦点变化（写入/移除 cm-focused）
 * 正是最常见的一次覆写。于是「用户点一下编辑器」就把外部手工加的类冲掉了。
 * 真机实测：render 后类在，点击 .cm-content 后类消失 → 描边丢失。
 * 因此该类必须交回给 CodeMirror 管理 —— 见 src/compare/pane-active.js。
 *
 * 本测试为静态源码断言：compare.js 顶层有 localStorage / DOM 访问，无法在 node 中
 * import（与 editor.js 同源限制），故不做运行时断言。断言目标是防止后人把持久类删掉
 * 又退回纯 `.cm-focused` 方案、或退回手工 classList 方案 —— 二者都是不会让任何单元
 * 测试变红、却能让用户覆盖错文件的静默回归。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const js = fs.readFileSync(path.join(root, 'src', 'compare.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'compare.css'), 'utf8');
const paneActiveSrc = fs.readFileSync(
  path.join(root, 'src', 'compare', 'pane-active.js'),
  'utf8'
);

const ACTIVE_CLASS = 'cmp-pane-active';

/**
 * 剥掉注释后再做「禁止某种写法」的扫描。
 *
 * 必须这么做的理由：pane-active.js 的顶部注释【刻意】写明了错误做法
 * （view.dom.classList.add()）以警示后人，若直接对原文扫描，最有价值的那段
 * 注释反而会把测试搞红，逼着后人删注释——这是典型的「测试惩罚好文档」。
 * `[^:]` 用于避开 http:// 这类含双斜杠的字符串。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('活动栏：compare.js 必须引用持久活动栏类标示保存目标', () => {
  // 类名字面量已收敛到 pane-active.js（单一事实源），compare.js 侧既可能直接写
  // 字面量，也可能只导入 PANE_ACTIVE_CLASS —— 两种都算「引用」，都能防住
  // 「退回纯 .cm-focused」这个真正要拦的回归。
  assert.ok(
    js.includes(ACTIVE_CLASS) || /PANE_ACTIVE_CLASS/.test(js),
    `compare.js 应引用持久活动栏类 ${ACTIVE_CLASS}（字面量或导入 PANE_ACTIVE_CLASS）；` +
      '仅靠 CM 的 .cm-focused 会在编辑器失焦时丢失描边（点「保存」按钮即失焦）'
  );
  assert.match(
    js,
    /function\s+applyActivePaneClass/,
    '应存在 applyActivePaneClass()：集中负责把活动栏类同步到 DOM'
  );
  assert.match(
    js,
    /from\s+["']\.\/compare\/pane-active\.js["']/,
    'compare.js 应从 ./compare/pane-active.js 导入活动栏机制，而不是自己手搓 classList'
  );
});

test('活动栏：类必须经 EditorView.editorAttributes 交给 CodeMirror 渲染', () => {
  // 这是真机暴露的核心回归点。CodeMirror 会在焦点变化时整体覆写 .cm-editor 的
  // class 属性，任何用 classList 手工追加的类都会被抹掉。唯一可靠的做法是把类
  // 通过 editorAttributes facet 提供给 CM，让它每次重算 class 时自己带上。
  assert.ok(
    paneActiveSrc.includes(ACTIVE_CLASS),
    `pane-active.js 应持有 ${ACTIVE_CLASS} 类名字面量（单一事实源）`
  );
  assert.match(
    paneActiveSrc,
    /EditorView\.editorAttributes/,
    'pane-active.js 必须用 EditorView.editorAttributes 提供活动栏类；' +
      '改回 view.dom.classList.add/toggle 会在用户点击编辑器时被 CM 静默覆写掉'
  );
  assert.ok(
    !/\.dom\.classList\.(add|toggle)\(/.test(stripComments(paneActiveSrc)),
    'pane-active.js 的【实际代码】中不得出现 view.dom.classList.add/toggle：' +
      '那正是被 CodeMirror 覆写掉的错误做法（注释里举例说明它是错的，不算违规）'
  );
  // 扩展必须被真正注入到面板，否则 field 不存在、setPaneActiveClass 会一路走兜底
  assert.match(
    js,
    /paneActiveExtension\(\)/,
    'compare.js 的 baseExtensions() 必须注入 paneActiveExtension()，否则扩展形同虚设'
  );
});

test('活动栏：compare.css 必须为 cmp-pane-active 定义可见描边', () => {
  const rule = new RegExp(`\\.${ACTIVE_CLASS}\\s*\\{[^}]*outline\\s*:`, 's');
  assert.match(
    css,
    rule,
    `compare.css 应为 .${ACTIVE_CLASS} 定义 outline 描边。` +
      '用 outline 而非 border：outline 不参与布局，切换活动栏不会引起面板尺寸抖动'
  );
});

test('活动栏：描边不得在失焦时被清除（禁止 focusout/blur 里摘掉活动栏类）', () => {
  // 持久性的核心：只在 focusin 时切换，绝不在 focusout / blur 时移除。
  //
  // 注意正则写法：不能用 /addEventListener\(...\)/ 去「配平括号」——回调常写成
  // `() => {...}`，非贪婪匹配会在箭头函数的 `()` 处提前收尾，扫不到回调体，
  // 断言就退化成永真。这里改为从监听器起点向后取【固定字符窗口】。
  //
  // 注意：类名字面量已收敛到 pane-active.js，compare.js 侧改动活动栏的手段变成了
  // 标识符（PANE_ACTIVE_CLASS / setPaneActiveClass / applyActivePaneClass）。
  // 若只查字面量，本断言在 compare.js 上会退化成永真，故一并查这些标识符。
  const listenerRe = /addEventListener\(\s*["'](?:focusout|blur)["'][\s\S]{0,400}/g;
  const forbidden = new RegExp(
    `${ACTIVE_CLASS}|PANE_ACTIVE_CLASS|setPaneActiveClass|applyActivePaneClass`
  );
  const hits = js.match(listenerRe) || [];
  for (const h of hits) {
    assert.ok(
      !forbidden.test(h),
      'focusout / blur 监听器中不得触碰活动栏类：' +
        '失焦后描边必须保留，否则点工具栏「保存」时用户看不到写盘目标。命中片段：' +
        h.slice(0, 160)
    );
  }
});

test('活动栏：不得单独 remove 活动栏类（统一由 applyActivePaneClass 的 toggle 管理）', () => {
  // 活动栏类的增删应当只有一个出口：applyActivePaneClass() 内的 classList.toggle。
  // 任何散落在别处的 classList.remove('cmp-pane-active') 都意味着有第二条控制路径，
  // 极易与保存目标失步（描边没了但 activePane 还在，或反之）。
  // 同时覆盖字面量写法与 PANE_ACTIVE_CLASS 标识符写法，并扫描两个源文件——
  // 类名搬到 pane-active.js 后，只扫 compare.js 的字面量会让本断言退化成永真。
  const bareRemove = new RegExp(
    `classList\\.remove\\(\\s*(?:["'\`][^"'\`]*${ACTIVE_CLASS}|PANE_ACTIVE_CLASS)`
  );
  for (const [name, src] of Object.entries({
    'compare.js': js,
    'compare/pane-active.js': paneActiveSrc,
  })) {
    assert.ok(
      !bareRemove.test(src),
      `${name} 不应出现 classList.remove(${ACTIVE_CLASS})：` +
        '活动栏类的唯一出口应是 applyActivePaneClass() → setPaneActiveClass()'
    );
  }
});

test('活动栏：pane 键映射必须与 currentPanes() 一致（a/b/c）', () => {
  // 描边的 pane→view 映射若与保存用的 currentPanes() 错位，会出现
  // 「描边在 A 栏、实际存到 B 栏」这类最危险的不一致。二者都必须是
  // a=instance.a, b=instance.b, c=instance.theirsView。
  assert.match(
    js,
    /paneViewMap[\s\S]{0,300}?a:\s*instance\.a[\s\S]{0,120}?b:\s*instance\.b[\s\S]{0,160}?c:\s*instance\.theirsView/,
    'paneViewMap() 应为 { a: instance.a, b: instance.b, c: instance.theirsView }'
  );
  assert.match(
    js,
    /function\s+currentPanes[\s\S]{0,900}?theirsView/,
    'currentPanes() 仍应把 c 栏映射到 instance.theirsView（与 paneViewMap 保持一致）'
  );
});

test('BUG3 接线：onPickFiles 必须按活动栏路由，禁止回到无视活动栏的旧逻辑', () => {
  // BUG 3 根因：原 onPickFiles 写死 `files.a = picked[0]; files.b = picked[1]`，
  // 无论激活哪一栏都落到最左栏。修复后必须按 getActivePane() 路由，且把
  // 「活动栏→目标栏」的映射收敛到纯函数 resolvePickTarget（见 pick-target.js）。
  // 本断言防两类回归：① 又写回 picked[1]/picked[0] 的硬编码双文件索引；
  // ② onPickFiles 不再引用 getActivePane / resolvePickTarget（绕回无视活动栏）。
  assert.ok(
    /resolvePickTarget/.test(js) && /getActivePane/.test(js),
    'compare.js 必须在 onPickFiles 路径上同时引用 resolvePickTarget 与 getActivePane：' +
      '二者缺一即意味路由不再跟随活动栏（BUG 3 复发）'
  );
  assert.ok(
    !/files\.[abc]\s*=\s*picked\[\d\]/.test(js),
    'compare.js 不得再出现 files.x = picked[N] 的硬编码索引写入：' +
      '那正是 BUG 3「永远落最左栏」的旧写法'
  );
  // 路由纯函数须从独立模块导入（单一事实源、可单测），不得重新内联旧分支
  // BUG 5（拖拽路由）新增 resolveDropTargets 共导入，允许同行多 identifier
  assert.match(
    js,
    /import\s*\{\s*resolvePickTarget[\s\S]*?\}\s*from\s*["']\.\/compare\/pick-target\.js["']/,
    'compare.js 应从 ./compare/pick-target.js 导入 resolvePickTarget（含 resolveDropTargets 等共导入），' +
      '而非把「活动栏→目标栏」逻辑重新内联，否则回归测试无法覆盖'
  );
});
