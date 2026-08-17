/**
 * block-drag.test.js — 需求 9 块拖拽：readCodeMirrorBlockRanges 纯逻辑 + isBlockStart 纯函数
 *
 * 说明：readCodeMirrorBlockRanges 依赖 @codemirror/lang-markdown 语法树，需在 node
 * 环境用 ensureSyntaxTree 强制完整解析后断言块范围。拖拽交互（moveCodeMirrorBlock /
 * addCodeMirrorBlockBelow / 工具栏 DOM）依赖 CodeMirror + DOM 运行时，无法在 node 纯环境
 * 实测；其正确性由构建通过 + 浏览器/EXE 探针运行时验证。此处锁定可纯逻辑验证的块解析。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  readCodeMirrorBlockRanges,
  isBlockStart,
  readSelectionBlockRange,
  moveCodeMirrorSelection,
} from '../src/block-drag.js';

// 构造带完整语法的 Markdown 文档（标题/段落/无序列表+嵌套/有序列表/引用/代码块）
const SAMPLE = [
  '# 标题',
  '',
  '第一段段落文字，用于验证 Paragraph 块。',
  '',
  '- 项目一',
  '- 项目二',
  '  - 嵌套项',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '> 引用一行',
  '> 引用二行',
  '',
  '```',
  '代码块内容',
  '```',
  '',
].join('\n');

function parseBlocks(doc) {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  // 并行负载下语法树可能未完全展开（顶部节点缺失），仅靠树长度判据不够稳：
  // 须确认 readCodeMirrorBlockRanges 实际返回的块真正覆盖文档首尾，才算解析完整。
  // 提高 guard 上限并循环 ensure，直到块范围覆盖整篇文档或达到上限。
  let blocks = readCodeMirrorBlockRanges(state);
  for (let guard = 0; guard < 30; guard += 1) {
    ensureSyntaxTree(state, doc.length, 1e9);
    const next = readCodeMirrorBlockRanges(state);
    const coversFull =
      next.length > 0 &&
      next[0].from === 0 &&
      next[next.length - 1].to >= doc.length - 1;
    if (coversFull) {
      blocks = next;
      break;
    }
    if (next.length >= blocks.length) blocks = next;
  }
  return blocks;
}

// ─── readCodeMirrorBlockRanges：多块解析 ──────────────────────────────────────

test('readCodeMirrorBlockRanges: 解析出标题/段落/列表/引用/代码块等块', () => {
  const blocks = parseBlocks(SAMPLE);
  const names = blocks.map((b) => b.name);

  assert.ok(blocks.length >= 8, `块数量应 >= 8，实际 ${blocks.length}`);
  assert.ok(names.some((n) => n.startsWith('ATXHeading')), '应包含标题块');
  assert.ok(names.includes('Paragraph'), '应包含段落块');
  assert.ok(names.filter((n) => n === 'ListItem').length >= 5, '应含 >=5 个 ListItem');
  assert.ok(names.includes('Blockquote'), '应包含引用块');
  assert.ok(
    names.some((n) => n === 'FencedCode' || n === 'CodeBlock'),
    '应包含代码块',
  );
});

test('readCodeMirrorBlockRanges: 块按文档顺序从前到后排列', () => {
  const blocks = parseBlocks(SAMPLE);
  for (let i = 1; i < blocks.length; i += 1) {
    assert.ok(
      blocks[i].from >= blocks[i - 1].from,
      `块应按 from 升序排列（索引 ${i}）`,
    );
  }
});

test('readCodeMirrorBlockRanges: 首块从文档起点开始，末块覆盖到文档末尾', () => {
  const blocks = parseBlocks(SAMPLE);
  assert.equal(blocks[0].from, 0, '首块应始于文档起点');
  assert.equal(blocks[blocks.length - 1].to, SAMPLE.length, '末块应覆盖到文档末尾');
});

test('readCodeMirrorBlockRanges: 嵌套列表项带有 depth=1', () => {
  const blocks = parseBlocks(SAMPLE);
  const nested = blocks.filter((b) => b.name === 'ListItem' && b.depth === 1);
  assert.equal(nested.length, 1, '应恰好 1 个 depth=1 的嵌套列表项');
});

test('readCodeMirrorBlockRanges: 单块文档返回单块且覆盖全文档', () => {
  const doc = '# 仅一个标题';
  const blocks = parseBlocks(doc);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].from, 0);
  assert.equal(blocks[0].to, doc.length);
});

test('readCodeMirrorBlockRanges: 空文档返回空数组', () => {
  const blocks = parseBlocks('');
  assert.deepEqual(blocks, []);
});

// ─── isBlockStart：不依赖 CM6 的纯函数 ───────────────────────────────────────

test('isBlockStart: 命中首行偏移返回 true', () => {
  const blocks = [
    { from: 0, to: 5, name: 'ATXHeading1' },
    { from: 7, to: 20, name: 'Paragraph' },
  ];
  assert.equal(isBlockStart(blocks, 0), true);
  assert.equal(isBlockStart(blocks, 7), true);
});

test('isBlockStart: 非首行偏移返回 false', () => {
  const blocks = [
    { from: 0, to: 5, name: 'ATXHeading1' },
    { from: 7, to: 20, name: 'Paragraph' },
  ];
  assert.equal(isBlockStart(blocks, 3), false);
  assert.equal(isBlockStart(blocks, 12), false);
});

test('isBlockStart: 非法入参安全返回 false', () => {
  assert.equal(isBlockStart(null, 0), false);
  assert.equal(isBlockStart([], undefined), false);
  assert.equal(isBlockStart([{ from: 1 }], 'x'), false);
});

// ─── BUG5-1：选区拖拽吸附到块边界（readSelectionBlockRange）───────────────────
// 只做行对齐会把围栏 / 表格 / 列表项从中间切断，只搬走半个块 → Markdown 结构失配
// （悬空 ``` 、丢表头的分隔行）。吸附后两端必须落在 readCodeMirrorBlockRanges
// 给出的块边界上。

function stateWithSelection(doc, anchor, head) {
  const state = EditorState.create({
    doc,
    extensions: [markdown()],
    selection: { anchor, head },
  });
  let guard = 0;
  while (guard < 5) {
    const tree = ensureSyntaxTree(state, doc.length, 1e9);
    if (tree && tree.length >= doc.length) break;
    guard += 1;
  }
  return state;
}

// 与 verifier v3-struct 的围栏夹具逐字节一致。
const FENCE_DOC = '段落A\n\n```js\nconst x = 1;\n```\n\n段落B\n';

test('readSelectionBlockRange: 选区切开围栏（含闭围栏不含开围栏）→ 吸附到整个代码块', () => {
  // 24..31 即 verifier S1 实测选区："```" + 空行 + "段落"，只含闭围栏。
  const state = stateWithSelection(FENCE_DOC, 24, 31);
  assert.equal(state.doc.sliceString(24, 31), '```\n\n段落', '前置：夹具偏移应与 S1 一致');
  const range = readSelectionBlockRange(state);
  assert.ok(range, '应返回临时块范围');
  const text = state.doc.sliceString(range.from, range.to);
  assert.ok(text.includes('```js'), '吸附后必须含开围栏，实际: ' + JSON.stringify(text));
  assert.ok(text.includes('const x = 1;'), '吸附后必须含代码块正文');
  assert.equal((text.match(/`/g) || []).length % 2, 0, '吸附后反引号必须成对');
  const fence = readCodeMirrorBlockRanges(state).find((b) => b.name === 'FencedCode');
  assert.equal(range.from, fence.from, '起点应吸附到 FencedCode 块首');
});

test('readSelectionBlockRange: 两端落在块间空白 → 起点取右侧最近块、终点取左侧最近块', () => {
  // 4 = 开围栏前那个空行的行首；28 = 闭围栏后那个空行的行首。两端都不属于任何块。
  const state = stateWithSelection(FENCE_DOC, 4, 28);
  const range = readSelectionBlockRange(state);
  const fence = readCodeMirrorBlockRanges(state).find((b) => b.name === 'FencedCode');
  assert.equal(range.from, fence.from, '起点应取右侧最近块（FencedCode）的 from');
  assert.equal(range.to, fence.to, '终点应取左侧最近块（FencedCode）的 to');
});

test('readSelectionBlockRange: 列表按 ListItem 吸附，不会被撑成整个列表', () => {
  const doc = '段落A\n\n- 列表项一\n- 列表项二\n- 列表项三\n\n段落B\n';
  const state = stateWithSelection(
    doc,
    doc.indexOf('列表项二') + 1,
    doc.indexOf('列表项三') + 1,
  );
  const range = readSelectionBlockRange(state);
  const text = state.doc.sliceString(range.from, range.to);
  assert.equal(
    text,
    '- 列表项二\n- 列表项三',
    '只应吸附到被选中的两个 ListItem，实际: ' + JSON.stringify(text),
  );
});

test('readSelectionBlockRange: 选区切开表头分隔行 → 吸附到整张表', () => {
  const doc = '段落A\n\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n| c | d |\n\n段落B\n';
  const state = stateWithSelection(
    doc,
    doc.indexOf('| --- |') + 2,
    doc.indexOf('| c | d |') + 5,
  );
  const range = readSelectionBlockRange(state);
  const text = state.doc.sliceString(range.from, range.to);
  assert.ok(text.startsWith('| 列1 | 列2 |'), '吸附后必须含表头行，实际: ' + JSON.stringify(text));
  assert.ok(text.includes('| --- | --- |'), '吸附后必须含分隔行');
});

// ─── BUG5-3：连续空行不被压掉（relocateRange 把吞掉的换行带到目标端）─────────

function blankRuns(text) {
  const runs = [];
  const re = /\n{2,}/g;
  let m;
  while ((m = re.exec(text))) runs.push(m[0].length - 1);
  return runs.sort((a, b) => a - b);
}

// EditorView 在 node 无法实例化，但 relocateRange 只用到 state / dispatch / focus，
// 用 state.update 落回文档即可走完整条真实代码路径。
function fakeView(state) {
  const view = {
    state,
    dispatch(spec) { view.state = view.state.update(spec).state; },
    focus() {},
  };
  return view;
}

// verifier v3-struct 场景 E 的现场结果是 "段落A\n\n\n\n段落B\n\n段落C\n"（[1,3]）：
// B 与 C 之间的 3 空行被压成 1。这里用四段夹具（保证落点前后都有内容、位移真实发生），
// 两个方向各验一次：修复前 before 得 [1,3,3]、after 得 [1,3,3]，修复后都应是 [3,3,3]。
const BLANK_DOC = '段落A\n\n\n\n段落B\n\n\n\n段落C\n\n\n\n段落D\n';

function moveParagraph(doc, sourceText, targetText, side) {
  const state = stateWithSelection(doc, doc.indexOf(sourceText), doc.indexOf(sourceText) + 3);
  const range = readSelectionBlockRange(state);
  const target = readCodeMirrorBlockRanges(state)
    .find((b) => state.doc.sliceString(b.from, b.to).startsWith(targetText));
  const view = fakeView(state);
  const ok = moveCodeMirrorSelection(view, range.from, range.to, target.from, side);
  return { ok, after: view.state.doc.toString() };
}

test('moveCodeMirrorSelection: 落到目标块之前，3 空行段不被压成 1', () => {
  assert.deepEqual(blankRuns(BLANK_DOC), [3, 3, 3], '前置：夹具应有三段 3 空行');
  const { ok, after } = moveParagraph(BLANK_DOC, '段落A', '段落C', 'before');
  assert.equal(ok, true, '搬运应成功');
  assert.equal(
    after,
    '段落B\n\n\n\n段落A\n\n\n\n段落C\n\n\n\n段落D\n',
    '被吞掉的 4 个换行必须原样带到新造出的边界上',
  );
  assert.deepEqual(blankRuns(after), [3, 3, 3], '空行段应保持 [3,3,3]');
});

test('moveCodeMirrorSelection: 落到目标块之后，3 空行段同样不被压成 1', () => {
  const { ok, after } = moveParagraph(BLANK_DOC, '段落A', '段落C', 'after');
  assert.equal(ok, true, '搬运应成功');
  assert.equal(
    after,
    '段落B\n\n\n\n段落C\n\n\n\n段落A\n\n\n\n段落D\n',
    '向后落点时携带的换行应补在「目标|块」这条新边界上',
  );
  assert.deepEqual(blankRuns(after), [3, 3, 3], '空行段应保持 [3,3,3]');
});

test('moveCodeMirrorSelection: 单空行文档的换行规范化行为不变（无回归）', () => {
  const doc = 'A\n\nB\n\nC\n';
  const state = stateWithSelection(doc, 0, 1);
  const range = readSelectionBlockRange(state);
  const target = readCodeMirrorBlockRanges(state)
    .find((b) => state.doc.sliceString(b.from, b.to).startsWith('C'));
  const view = fakeView(state);
  assert.equal(
    moveCodeMirrorSelection(view, range.from, range.to, target.from, 'after'),
    true,
  );
  assert.equal(
    view.state.doc.toString(),
    'B\n\nC\n\nA',
    '单空行场景应与既有规范化结果逐字节一致',
  );
});
