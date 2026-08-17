/**
 * compare-phase3.test.js — 第三期（三栏重构 / 双层连线 / 位置概览）回归断言
 *
 * 【为什么是静态源码断言而不是运行时测试】
 * 本期改动集中在 MergeView / EditorView 的装配与 CSS 布局上，这两者都无法在纯 node
 * 环境实例化（CodeMirror 需要真实 DOM 布局与测量），沿用本仓库既有做法
 * （见 compare-merge-regression.test.js）：对「一旦写错就会静默失效」的关键约束
 * 做源码级断言，把回归拦在提交前。真实渲染效果由 .test-run/ 下的 Playwright
 * 真机点检覆盖，二者分工不重叠。
 *
 * 覆盖的六类约束：
 *   1) 三栏 CSS 必须显式 flex-direction: row（否则被上游 column 规则压住，三栏上下堆叠）
 *   2) 连线覆盖层的定位基准（.compare-view 必须 position: relative）
 *   3) B↔C 层必须自算 chunks（不得复用 MergeView 的 getChunks）
 *   4) 调度器 attach 必须接收数组（多对化契约）
 *   5) 中栏 Result 不得被两层同时写装饰（writeA:false 守卫）
 *   6) 连线配色变量在亮 / 暗两套主题下均已定义
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const mergeSrc = read('src', 'compare-merge.js');
const cssSrc = read('src', 'compare.css');
const htmlSrc = read('src', 'compare.html');
const compareJsSrc = read('src', 'compare.js');

/** 去注释，避免文档里的举例文本被当成真实代码命中 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const mergeCode = stripComments(mergeSrc);

/**
 * 抽取某个函数的【完整函数体】（大括号配平，跳过字符串字面量内的括号）。
 *
 * 【为何不用固定字符窗口】早期这里写的是 `code.slice(idx, idx + 1400)`，
 * 等于把断言锚在「实现必须写在头 1400 个字符内」这一文本形态上：任何合理的
 * 函数抽取 / 注释补充都会把目标语句挤出窗口，产生与行为无关的误报
 * （本期重构中已实际发生过一次）。测试应约束行为，不应锁死写法。
 */
function fnBody(code, header) {
  const idx = code.indexOf(header);
  if (idx === -1) return null;
  const open = code.indexOf('{', idx);
  if (open === -1) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * 函数体 + 其【直接调用的同文件内函数】的函数体（展开一层）。
 *
 * 断言的语义是「这条控制流最终会触达某个动作」，而不是「这条语句必须内联写在这里」。
 * 展开一层后，把动作抽进辅助函数（如 scheduleAfterLayout 回调、refreshXxx()）依然通过，
 * 而彻底删掉该动作仍会被拦下。
 */
function fnBodyWithCallees(code, header) {
  const body = fnBody(code, header);
  if (body == null) return null;
  let out = body;
  const names = new Set();
  for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[2]);
  for (const name of names) {
    const sub = fnBody(code, `function ${name}(`);
    if (sub) out += '\n' + sub;
  }
  return out;
}

/** 抽取某个 CSS 选择器的规则体（只取第一处匹配） */
function cssBlock(source, selector) {
  const idx = source.indexOf(selector);
  if (idx === -1) return null;
  const open = source.indexOf('{', idx);
  const close = source.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return source.slice(open + 1, close);
}

// ── 1) 三栏横向布局 ──────────────────────────────────────────────
test('三栏：.compare-three-layout 必须显式声明 flex-direction: row', () => {
  const block = cssBlock(cssSrc, '.compare-three-layout {');
  assert.ok(block, '未找到 .compare-three-layout 规则');
  assert.match(
    block,
    /flex-direction:\s*row/,
    '.compare-three-layout 缺少 flex-direction: row —— ' +
      '上游 `.compare-view:not([hidden])`（特异性 0-2-0）已声明 column，' +
      '本规则（0-1-0）不显式覆盖就会让 MergeView 与 Theirs 上下堆叠，三栏直接失效'
  );
});

test('三栏：flex-direction 必须带 !important（特异性低于上游 column 规则）', () => {
  const block = cssBlock(cssSrc, '.compare-three-layout {');
  assert.match(
    block,
    /flex-direction:\s*row\s*!important/,
    '.compare-three-layout 的 flex-direction 缺 !important，会被 ' +
      '.compare-view:not([hidden]) 的 column 压住'
  );
});

// ── 2) 连线覆盖层定位基准 ────────────────────────────────────────
test('连线：.compare-view 必须 position: relative（SVG 覆盖层的定位基准）', () => {
  const block = cssBlock(cssSrc, '.compare-view {');
  assert.ok(block, '未找到 .compare-view 规则');
  assert.match(
    block,
    /position:\s*relative/,
    '.compare-view 缺 position: relative —— 连线层用 position:absolute; inset:0 ' +
      '挂在该容器上，缺定位基准会向上冒到 body，坐标全错'
  );
});

test('连线：覆盖层必须 pointer-events: none（否则吃掉「接受此块」按钮点击）', () => {
  const block = cssBlock(cssSrc, '.cm-move-connector-layer {');
  assert.ok(block, '未找到 .cm-move-connector-layer 规则');
  assert.match(block, /pointer-events:\s*none/);
});

// ── 2.5) B2 层叠上下文守卫 ────────────────────────────────────
// fix-conn 在 compare.css:286-289 用 `#compareRoot .cm-merge-revert { position:relative; z-index:2 }`
// 抬升 revert 列（z-index:2）以压过移动块连线层 `.cm-move-connector-layer`（z-index:1）。
// 该修复成立的前提是 revert 与连线层处在【同一个层叠上下文】。CSS 里 transform / filter /
// opacity（<1）/ will-change / contain:paint 会凭空创建层叠上下文；一旦下列任一容器被加上，
// revert 的 z-index:2 会被关进新上下文内部，无法再压过连线层，B2 无声复发且运行期测不到
// （红线禁止在 node 单测里实例化 MergeView）。故用静态断言兜底。
//
// 【为何不能用 cssBlock 逐个选择器查】cssBlock 走 indexOf，只取【第一处】匹配。
// 实测 .cm-mergeView 在本表中出现两次：216 行的基础规则、236 行的
// `.compare-three-layout .cm-mergeView`（三栏专属）。而三栏恰恰是 B2 的必现场景 ——
// 只查第一处等于给最危险的那条规则开了后门。故改为【全表扫描所有规则】，
// 按「选择器最后一个复合段作用于谁」判定归属：
//   .compare-three-layout .cm-mergeView → 作用于 .cm-mergeView   → 查
//   .compare-view .cm-editor            → 作用于 .cm-editor      → 不查（它不是容器）
//   #compareRoot .cm-merge-revert       → 作用于 .cm-merge-revert → 不查（它正是要被抬升的元素）
test('B2 守卫：关键容器不得创建新层叠上下文（transform/filter/opacity/will-change/contain）', () => {
  const css = stripComments(cssSrc);
  // 受保护的容器：连线层与 revert 列的共同祖先，任一被加上述属性都会隔断层叠上下文
  const guarded = ['.cm-mergeView', '.compare-view', '.compare-views', '#compareRoot'];
  const propRe = /\b(transform|filter|opacity|will-change|contain)\s*:/;

  /** 取选择器的最后一个复合段（后代/子/兄弟组合符切分后的末段），即该规则真正作用的元素 */
  const lastCompound = (sel) => sel.trim().split(/\s*[>+~]\s*|\s+/).pop() || '';
  /** 末段是否命中受保护 token（后置断言排除 .compare-view 误吞 .compare-views） */
  const hits = (compound, token) =>
    new RegExp(token.replace(/[.#]/g, '\\$&') + '(?![\\w-])').test(compound);

  // 本表无 @media/@supports 等嵌套 at-rule（已核），故可用扁平规则正则遍历
  let matched = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorList = m[1];
    const body = m[2];
    if (selectorList.trim().startsWith('@')) continue; // 保险：跳过 at-rule 头
    const propHit = body.match(propRe);
    if (!propHit) continue;
    for (const sel of selectorList.split(',')) {
      const compound = lastCompound(sel);
      const token = guarded.find((t) => hits(compound, t));
      if (!token) continue;
      matched++;
      const prop = propHit[1];
      const msg =
        `选择器 \`${sel.trim()}\` 的规则体里出现了 ${prop}: —— 它会创建新的层叠上下文，` +
      '使 #compareRoot .cm-merge-revert 的 z-index:2 被关在内部，' +
      '无法再压过 .cm-move-connector-layer(z-index:1)，' +
      'B2（连线划花「⇄ 接受此块」按钮）会复发。' +
      '若确需该属性，必须同步改用其他方式隔离连线层，并更新本断言。' +
        (prop === 'opacity'
          ? '（即便写成 opacity:1 本身不创建层叠上下文，这里仍一律禁止：' +
            '后人手滑改成 opacity:0.9 时本断言才能兜住，避免「改小不自觉」）'
          : '');
      assert.fail(msg);
    }
  }
  // 自证扫描确实跑过：guarded 里至少 .cm-mergeView / .compare-view / .compare-views
  // 三者在表中有规则，若正则失效（如日后引入 @media 嵌套导致匹配错位）会静默零命中，
  // 断言退化为永远通过。这里反查一次「规则总数」兜底。
  assert.ok(matched === 0, '内部一致性：命中即应已 fail');
  const scanned = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].length;
  assert.ok(
    scanned > 40,
    `全表规则扫描仅得 ${scanned} 条，远少于预期 —— 正则可能因 CSS 结构变化（如新增 @media 嵌套）失效，` +
      '此时本守卫会静默失效，必须改用真正的 CSS 解析'
  );
});

// ── 3) B↔C 层必须自算 chunks ─────────────────────────────────────
test('三栏：B↔C 层必须以 computeChunks 自算差异块', () => {
  assert.match(
    mergeCode,
    /computeChunks:\s*true/,
    '未发现 computeChunks: true —— B↔C 的两个视图分属不同实例，' +
      'getChunks(mv.b.state) 返回的是 MergeView 自己的 A↔B 结果，与本层无关'
  );
  assert.match(
    mergeCode,
    /Chunk\.build\(\s*aDoc\s*,\s*bDoc\s*,\s*DIFF_CONFIG\s*\)/,
    'refreshDecorations 内未见 Chunk.build 自算路径'
  );
});

test('三栏：就绪判据必须排除 computeChunks 层（否则中右两栏相同时永远等不到就绪）', () => {
  assert.match(
    mergeCode,
    /filter\(\s*\(vp\)\s*=>\s*!\(vp\.sides\s*&&\s*vp\.sides\.computeChunks\)\s*\)/,
    'rAF 轮询的就绪判据未排除自算层。自算层任何时刻都有结果，' +
      '把它纳入 every() 判据会让「中右两栏内容相同」这一常见场景永久轮询到超时'
  );
});

// ── 4) 调度器多对化 ──────────────────────────────────────────────
test('调度器：attach 必须接收视图对数组（不得退回 attach(a, b) 单对形态）', () => {
  assert.ok(
    !/scheduler\.attach\(\s*mv\.a\s*,\s*mv\.b\s*\)/.test(mergeCode),
    '发现旧的单对调用 scheduler.attach(mv.a, mv.b)，多对化契约被破坏'
  );
  assert.match(
    mergeCode,
    /scheduler\.attach\(\s*\[/,
    '未发现 scheduler.attach([...]) 的数组形态调用'
  );
});

test('调度器：必须暴露 getPairs 与 onRefresh（连线与概览面板的数据出口）', () => {
  assert.match(mergeCode, /getPairs\(\)\s*\{/);
  assert.match(mergeCode, /onRefresh\(fn\)\s*\{/);
});

// ── 5) 中栏装饰不得被两层互相覆盖 ────────────────────────────────
test('三栏：B↔C 层必须 writeA:false，避免覆写中栏 Result 的 A↔B 装饰', () => {
  assert.match(
    mergeCode,
    /writeA:\s*false/,
    '未见 writeA: false —— 中栏 Result 同时是 A↔B 层的 b 与 B↔C 层的 a，' +
      '两层都写会让后写者整体覆盖先写者（setWordDiffEffect / setMoveBlocks 均为全量替换语义）'
  );
});

test('三栏：B↔C 层的 aSide 必须为 null（中栏不画本层移动块底纹）', () => {
  assert.match(mergeCode, /aSide:\s*null/);
});

// ── 6) 主题变量完整性 ────────────────────────────────────────────
test('主题：连线配色变量在 :root 与 [data-theme="dark"] 两套下均已定义', () => {
  const lightBlock = cssBlock(cssSrc, ':root {');
  const darkIdx = cssSrc.indexOf('[data-theme="dark"] {');
  assert.ok(lightBlock, '未找到 :root 变量块');
  assert.ok(darkIdx !== -1, '未找到暗色变量块');
  const darkBlock = cssSrc.slice(
    cssSrc.indexOf('{', darkIdx) + 1,
    cssSrc.indexOf('}', darkIdx)
  );
  for (const name of [
    '--diff-connector-ab',
    '--diff-connector-ab-fill',
    '--diff-connector-bc',
    '--diff-connector-bc-fill',
  ]) {
    assert.ok(
      lightBlock.includes(name),
      `亮色 :root 缺少变量 ${name}`
    );
    assert.ok(
      darkBlock.includes(name),
      `暗色 [data-theme="dark"] 缺少变量 ${name}（暗底下低透明度会糊掉，必须单独给值）`
    );
  }
});

// ── 7) 位置概览面板装配 ──────────────────────────────────────────
test('概览：compare.html 必须提供 #locationPane 容器', () => {
  assert.match(htmlSrc, /id="locationPane"/);
  assert.match(
    htmlSrc,
    /id="btnToggleLocationPane"/,
    '缺少概览开关按钮，用户无法关闭侧栏'
  );
});

test('概览：compare.js 必须在 teardown 中先于视图实例销毁概览面板', () => {
  const code = stripComments(compareJsSrc);
  const tail = fnBody(code, 'function teardown()');
  assert.ok(tail, '未找到 teardown 函数');
  const paneIdx = tail.indexOf('locationPane.destroy()');
  const instIdx = tail.indexOf('instance.destroy()');
  assert.ok(paneIdx !== -1, 'teardown 未销毁 locationPane，切换模式会泄漏监听');
  assert.ok(instIdx !== -1, 'teardown 未销毁 instance');
  assert.ok(
    paneIdx < instIdx,
    '概览面板必须【先于】视图实例销毁：它持有 instance.a/b 的引用与 scroll 监听，' +
      '若视图先毁，其后任何一次 update() 都会摸到已销毁的 view'
  );
});

test('概览：切换侧栏后必须重绘连线（栏宽变化会让端点 x 坐标失效）', () => {
  const code = stripComments(compareJsSrc);
  // 本断言已不依赖内联写法：fnBodyWithCallees 会展开一层被调用函数体，
  // 因此后续可自由把重绘抽到辅助函数（如 refreshOverviewAndConnectors()），
  // 只要「同帧内既刷新概览又重绘连线」的控制流仍在，断言不会失败。
  const body = fnBodyWithCallees(code, 'function toggleLocationPane()');
  assert.ok(body, '未找到 toggleLocationPane');
  assert.match(
    body,
    /redrawConnectors/,
    '切换概览侧栏后未触发连线重绘，连线会停留在旧栏宽的位置上'
  );
  // 概览刷新与连线重绘必须共用同一次 reflow 后的量取（见 compare.js scheduleAfterLayout 注释）：
  // 侧栏 176px 的出入会改变栏宽，同帧读到的仍是旧宽度，分帧推送则两者互不自洽。
  assert.match(
    body,
    /scheduleAfterLayout/,
    '切换概览侧栏后的重绘未推到下一帧：同帧量取拿到的是旧栏宽，连线端点会落在错位置'
  );
});

// ── 8) 桩残留清理 ────────────────────────────────────────────────
test('清理：move-connectors.js 不得残留接口契约桩的 layer 再导出', () => {
  const src = read('src', 'compare', 'move-connectors.js');
  assert.ok(
    !/export\s*\{\s*layer\s*,/.test(src),
    'move-connectors.js 仍残留 `export { layer, ... }` —— ' +
      '该导出是接口契约桩遗留，layer() API 并未采用，留着会误导后人'
  );
});
