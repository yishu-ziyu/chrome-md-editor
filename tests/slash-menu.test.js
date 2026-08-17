// ============================================================
// 斜杠菜单纯逻辑测试（需求 5 / P1 E1）
// ------------------------------------------------------------
// 仅测试模块级纯函数（isSlashTrigger / filterSlashCommands / 命令表），
// 不依赖 CodeMirror 6 实例。CM6 相关行为（StateField 自启、浮层渲染）
// 标注为 todo，待集成测试环境补充。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  isSlashTrigger,
  filterSlashCommands,
  slashMenuCommands,
  typedRangeFromState,
  getSlashMenuState,
  markraSlashMenu,
  runSelectedAction,
  moveSelection,
} from '../src/slash-menu.js';
import {
  matchSlashTrigger,
  nodeChainHasCodeBlock,
  isSlashPrecedingAllowed,
  SLASH_TRIGGER_RE,
} from '../src/slash-menu-core.js';

// ------------------------------------------------------------
// 触发判断
// ------------------------------------------------------------
test('isSlashTrigger: / 前缀 + 查询词触发', () => {
  assert.deepEqual(isSlashTrigger('/hea'), { before: '', query: 'hea' });
  assert.deepEqual(isSlashTrigger('/'), { before: '', query: '' });
});

test('isSlashTrigger: 中文顿号 、 已取消触发资格（BUG4 定稿）', () => {
  assert.equal(isSlashTrigger('、引用'), null);
  assert.equal(isSlashTrigger('  、表格'), null);
  assert.equal(isSlashTrigger('苹果、'), null);
  assert.equal(isSlashTrigger('- 列表项、'), null);
  // `、` 退化为普通字符，可作为查询词内容参与过滤（无匹配时由上层关面板）
  assert.deepEqual(isSlashTrigger('中文/、'), { before: '中文', query: '、' });
});

test('isSlashTrigger: 触发正则不再包含顿号分支', () => {
  // 元防御：防止有人只改守卫、漏改正则（或反之）导致两处口径漂移
  assert.equal(SLASH_TRIGGER_RE.source.includes('、'), false);
  assert.equal(SLASH_TRIGGER_RE.test('、x'), false);
});

test('isSlashTrigger: 普通文本不触发', () => {
  assert.equal(isSlashTrigger('hello'), null);
  // BUG4 定稿收窄：Latin 字母紧邻 `/` 不再触发（需「单词 + 空格 + /」）
  assert.equal(isSlashTrigger('foo/bar'), null);
  assert.equal(isSlashTrigger('列表 - 项'), null);
  assert.equal(isSlashTrigger(''), null);
});

test('isSlashTrigger: 查询词含空白/分隔符不触发', () => {
  assert.equal(isSlashTrigger('/heading 1'), null);
  // /a/b 的末个 `/` 紧邻 a（ASCII 字母）→ 拦截
  assert.equal(isSlashTrigger('/a/b'), null);
});

// ------------------------------------------------------------
// BUG4 定稿触发矩阵（2026-08-08 用户拍板）
//   激活：行首 /、中文 + /、英文单词 + 空格 + /、数字 + 空格 + /、
//         http/https + 空格 + /
//   不激活：数字 + /、http + /、https + /（以及任何 ASCII 可见字符紧邻 /）
//   位置：行首 / 行中 / 行尾一视同仁，光标后有文字也照常激活
// ------------------------------------------------------------

// 【前置放行判定】直接锁 isSlashPrecedingAllowed 契约
test('BUG4 契约: isSlashPrecedingAllowed 放行/拦截边界', () => {
  // 放行：行首、空白、非 ASCII
  assert.equal(isSlashPrecedingAllowed(''), true);
  assert.equal(isSlashPrecedingAllowed('apple '), true);
  assert.equal(isSlashPrecedingAllowed('  '), true);
  assert.equal(isSlashPrecedingAllowed('苹果'), true);
  assert.equal(isSlashPrecedingAllowed('结束。'), true);
  // 拦截：ASCII 字母 / 数字 / 半角标点
  assert.equal(isSlashPrecedingAllowed('http'), false);
  assert.equal(isSlashPrecedingAllowed('2026'), false);
  assert.equal(isSlashPrecedingAllowed('https:'), false);
  assert.equal(isSlashPrecedingAllowed('a/b'), false);
  assert.equal(isSlashPrecedingAllowed('**'), false);
});

// 【激活 0】行首直接 /（含仅空白缩进）
test('BUG4 激活: 行首 / 与缩进后 / 均触发', () => {
  assert.deepEqual(isSlashTrigger('/'), { before: '', query: '' });
  assert.deepEqual(isSlashTrigger('  /'), { before: '  ', query: '' });
  assert.deepEqual(isSlashTrigger('\t/co'), { before: '\t', query: 'co' });
});

// 【激活 1】中文 + /（无需空格）
test('BUG4 激活: 中文 + / 直接触发', () => {
  assert.deepEqual(isSlashTrigger('苹果/'), { before: '苹果', query: '' });
  assert.deepEqual(isSlashTrigger('# 标题/'), { before: '# 标题', query: '' });
  assert.deepEqual(isSlashTrigger('苹果/co'), { before: '苹果', query: 'co' });
  // 中文标点同属「非 ASCII」，一并放行
  assert.deepEqual(isSlashTrigger('结束。/'), { before: '结束。', query: '' });
});

// 【激活 2】英文单词 + 空格 + /
test('BUG4 激活: 英文单词 + 空格 + / 触发', () => {
  assert.deepEqual(isSlashTrigger('apple /'), { before: 'apple ', query: '' });
  assert.deepEqual(isSlashTrigger('- 列表项 /'), {
    before: '- 列表项 ',
    query: '',
  });
});

// 【激活 3】数字 + 空格 + /
test('BUG4 激活: 数字 + 空格 + / 触发', () => {
  assert.deepEqual(isSlashTrigger('2026 /'), { before: '2026 ', query: '' });
});

// 【激活 4 / 5】http、https + 空格 + /
test('BUG4 激活: http(s) + 空格 + / 触发', () => {
  assert.deepEqual(isSlashTrigger('http /'), { before: 'http ', query: '' });
  assert.deepEqual(isSlashTrigger('https /'), { before: 'https ', query: '' });
});

// 【不激活 1】数字 + /（日期、分数）
test('BUG4 不激活: 数字紧邻 / 不触发', () => {
  assert.equal(isSlashTrigger('2026/'), null);
  assert.equal(isSlashTrigger('2026/08/08/'), null);
  assert.equal(isSlashTrigger('1/2'), null);
});

// 【不激活 2 / 3】http、https 紧邻 / 及 URL 片段
test('BUG4 不激活: http(s) 紧邻 / 与 URL 片段不触发', () => {
  assert.equal(isSlashTrigger('http/'), null);
  assert.equal(isSlashTrigger('https/'), null);
  assert.equal(isSlashTrigger('https:/'), null);
  assert.equal(isSlashTrigger('https://'), null);
  assert.equal(isSlashTrigger('https://a.com/'), null);
  assert.equal(isSlashTrigger('a/b/'), null);
});

// 【不激活 4】其余 ASCII 可见字符紧邻 / 一律拦截（保守口径）
test('BUG4 不激活: ASCII 字母与半角标点紧邻 / 不触发', () => {
  assert.equal(isSlashTrigger('src/'), null);
  assert.equal(isSlashTrigger('abc/'), null);
  assert.equal(isSlashTrigger('abc/co'), null);
  assert.equal(isSlashTrigger('**/'), null);
  assert.equal(isSlashTrigger('a./'), null);
});

// 【代码块】代码块内不触发（由 nodeChainHasCodeBlock 拦截）
test('BUG4: 代码块内 中文/ 不触发', () => {
  // 触发检测本身认可 中文/
  assert.ok(matchSlashTrigger('中文/'));
  // 真实「代码块内」判定走 nodeChainHasCodeBlock：含代码块祖先链 → 拦截
  const inside = { name: 'Document', parent: { name: 'FencedCode', parent: null } };
  const outside = { name: 'Paragraph', parent: { name: 'Document', parent: null } };
  assert.equal(nodeChainHasCodeBlock(inside), true);
  assert.equal(nodeChainHasCodeBlock(outside), false);
});

// 【行尾约束已放开】光标后仍有文字也触发；无匹配命令时仍关闭面板
test('BUG4: 行中触发（光标后有文字）成立；无匹配命令时面板关闭', () => {
  const doc = '中文/内容';
  // 光标停在 / 后（offset 3），其后还有「内容」两字 → 仍应触发
  const midLine = EditorState.create({ doc, selection: { anchor: 3 } });
  const midRange = typedRangeFromState(midLine);
  assert.ok(midRange, '行中（光标后有文字）应触发');
  assert.equal(midRange.from, 2); // from 精确落在 / 处，不吞前面的「中文」
  assert.equal(midRange.to, 3); // to 停在光标，不吞后面的「内容」
  assert.equal(midRange.query, '');
  // query=def 无匹配命令 → 面板关闭（补强：空面板不滞留）
  const noMatchDoc = '中文/def';
  const noMatch = EditorState.create({
    doc: noMatchDoc,
    selection: { anchor: noMatchDoc.length },
  });
  assert.equal(typedRangeFromState(noMatch), null);
  // 对照：有匹配命令（co → code-block）时触发，from 精确落在 / 处
  const doc2 = '中文/co';
  const atEndMatch = EditorState.create({
    doc: doc2,
    selection: { anchor: doc2.length },
  });
  const range = typedRangeFromState(atEndMatch);
  assert.ok(range);
  assert.equal(range.from, 2);
  assert.equal(range.to, doc2.length);
});

// ------------------------------------------------------------
// BUG4 放宽后交互风险补验：空面板不吞 Enter/方向键（A/B/C/D）
// ------------------------------------------------------------

// A. 无匹配项时面板自动关闭（而非「开着但列表为空」）
test('BUG4-A: query 无匹配命令时面板自动关闭', () => {
  // 苹果/香蕉 → query=香蕉，无任何命令匹配
  const state = EditorState.create({
    doc: '苹果/香蕉',
    selection: { anchor: '苹果/香蕉'.length },
    extensions: markraSlashMenu(),
  });
  const menu = getSlashMenuState({ state, dispatch() {}, focus() {} });
  assert.equal(menu.open, false);
  assert.equal(menu.actions.length, 0);
  // 对照：苹果/ → query 空匹配全部命令，面板应开着
  const openState = EditorState.create({
    doc: '苹果/',
    selection: { anchor: '苹果/'.length },
    extensions: markraSlashMenu(),
  });
  assert.equal(
    getSlashMenuState({ state: openState, dispatch() {}, focus() {} }).open,
    true,
  );
});

// B. Enter 不被吞：无匹配场景下按 Enter 不插入任何命令、键事件放行
test('BUG4-B: 无匹配命令时 Enter 不被吞（不插入命令）', () => {
  const state = EditorState.create({
    doc: '苹果/香蕉',
    selection: { anchor: '苹果/香蕉'.length },
    extensions: markraSlashMenu(),
  });
  let dispatched = 0;
  const view = {
    state,
    dispatch() {
      dispatched += 1;
    },
    focus() {},
  };
  // runSelectedAction 是 keymap 中 Enter 的处理函数；返回 false 表示键未消费
  const handled = runSelectedAction(view);
  assert.equal(handled, false); // 键放行给编辑器 → 现实里会插入换行
  assert.equal(dispatched, 0); // 绝未插入任何命令内容
});

// C. 方向键 / Esc：无候选时方向键放行；Esc 始终能关面板且不留副作用
test('BUG4-C: 无匹配命令时方向键放行、Esc 可关面板', () => {
  const state = EditorState.create({
    doc: '苹果/香蕉',
    selection: { anchor: '苹果/香蕉'.length },
    extensions: markraSlashMenu(),
  });
  let dispatched = 0;
  const view = {
    state,
    dispatch() {
      dispatched += 1;
    },
    focus() {},
  };
  // moveSelection 是 keymap 中 ↑↓ 的处理函数；无候选时应返回 false（不放行光标移动）
  assert.equal(moveSelection(view, 1), false);
  assert.equal(moveSelection(view, -1), false);
  assert.equal(dispatched, 0); // 未 dispatch 任何 select，光标不被卡在面板
});

// D. 空格键：「apple /」弹面板后打空格 → query 因含空白失败，面板关闭，空格入文档
test('BUG4-D: 触发后再打空格，面板关闭且空格正常入文档', () => {
  // 先确认「apple /」（英文单词 + 空格 + /）会开面板
  const openState = EditorState.create({
    doc: 'apple /',
    selection: { anchor: 'apple /'.length },
    extensions: markraSlashMenu(),
  });
  assert.equal(
    getSlashMenuState({ state: openState, dispatch() {}, focus() {} }).open,
    true,
  );
  // 再打一个空格：query 段 [^\s/]* 无法跨空格，匹配失败 → 面板关闭
  const afterSpace = EditorState.create({
    doc: 'apple / ',
    selection: { anchor: 'apple / '.length },
    extensions: markraSlashMenu(),
  });
  const menu = getSlashMenuState({ state: afterSpace, dispatch() {}, focus() {} });
  assert.equal(menu.open, false);
  assert.equal(afterSpace.doc.toString(), 'apple / '); // 空格已正常进入文档
});

// ------------------------------------------------------------
// 命令过滤
// ------------------------------------------------------------
test('filterSlashCommands: 空查询返回全部', () => {
  const all = filterSlashCommands('');
  assert.ok(all.length >= 8);
});

test('filterSlashCommands: /hea 过滤出标题命令', () => {
  const result = filterSlashCommands('hea');
  const commands = result.map((c) => c.command);
  assert.ok(commands.includes('heading1'));
  assert.ok(commands.includes('heading2'));
  assert.ok(commands.includes('heading3'));
});

test('filterSlashCommands: 中文「引用」也能匹配 quote', () => {
  const result = filterSlashCommands('引用');
  assert.ok(result.some((c) => c.command === 'quote'));
});

test('filterSlashCommands: 无匹配返回空数组', () => {
  assert.deepEqual(filterSlashCommands('zzzzz'), []);
});

// ------------------------------------------------------------
// 命令表结构
// ------------------------------------------------------------
test('slashMenuCommands: 每个命令都有 run 函数', () => {
  assert.ok(slashMenuCommands.length >= 8 && slashMenuCommands.length <= 16);
  for (const command of slashMenuCommands) {
    assert.equal(typeof command.run, 'function', `${command.command} 缺 run`);
    assert.ok(typeof command.insert === 'string', `${command.command} 缺 insert`);
  }
});

test('slashMenuCommands: 覆盖核心 Markdown 块/行内命令', () => {
  const ids = slashMenuCommands.map((c) => c.command);
  for (const expected of [
    'heading1',
    'heading2',
    'heading3',
    'bold',
    'italic',
    'inline-code',
    'code-block',
    'bullet-list',
    'ordered-list',
    'quote',
    'table',
    'divider',
    'image',
    'link',
  ]) {
    assert.ok(ids.includes(expected), `命令表缺少 ${expected}`);
  }
});

// ------------------------------------------------------------
// 集成（CM6）相关：环境无 node_modules，标记为 todo
// ------------------------------------------------------------
test.todo('CM6: 键入 "/" 后 StateField 自启并使菜单 open');
test.todo('CM6: 代码块内键入 "/" 不触发菜单');
test.todo('CM6: ↑/↓ 移动 selectedIndex，Enter 执行并删除 /query');
