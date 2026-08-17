/**
 * compare-location-pane.test.js — 位置概览面板纯函数（src/compare/location-pane.js）单元测试
 *
 * 【测试对象】仅两个导出的纯函数，均不碰 DOM、不碰 EditorView：
 *   - computeBarSegments(chunks, aDoc, bDoc, maxSegments) → [{type, topPct, heightPct}]
 *   - computeMoveArcs(pairs, totalLines, maxArcs)          → [{fromPct, toPct}]
 *
 * 【绝不实例化 MergeView / EditorView】CodeMirror 视图需要真实 DOM 布局与测量，
 * 纯 node 环境下必崩。这两个函数只吃「doc-like」对象，故一律用最小桩件
 * `{ lines, length, lineAt(offset) -> {number} }` 喂数据 —— 与 @codemirror/state
 * 的 Text 契约一致（见被测文件顶部「坐标系约定」注释）。
 *
 * 【坐标系要点（写用例时最容易踩的坑）】
 *   chunk 的 fromA/toA/fromB/toB 是**字符偏移**不是行号，必须经 lineAt 换算；
 *   且 to 通常落在「末行换行符之后」= 下一行行首，故实现用 `to-1` 探测末行防多算一行。
 *   本文件所有 chunk 都按这个真实形态构造（to = 下一行行首偏移）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeBarSegments, computeMoveArcs } from '../src/compare/location-pane.js';

// ——— 测试辅助：doc-like 桩件 ——————————————————————————————————

/**
 * 构造最小 doc-like 桩件，行为对齐 @codemirror/state 的 Text：
 * 第 i 行占据 [from_i, to_i]，换行符位于 to_i；lineAt 判定为 `pos <= line.to`，
 * 因此「落在换行符上的偏移」仍归属该行 —— 这正是实现里 `to-1` 能探到末行的前提。
 * @param {string[]} lines
 */
function makeDoc(lines) {
  const text = lines.join('\n');
  const starts = [];
  let p = 0;
  for (const l of lines) {
    starts.push(p);
    p += l.length + 1; // +1 为换行符
  }
  return {
    lines: lines.length,
    length: text.length,
    /** @param {number} off */
    lineAt(off) {
      const pos = Math.max(0, Math.min(off, text.length));
      // 二分找「最后一个行首 <= pos」的行
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return { number: lo + 1, from: starts[lo], to: starts[lo] + lines[lo].length };
    },
  };
}

/** 第 idx 行（0-based）行首偏移；idx === lines.length 时返回文档末尾。 */
function off(lines, idx) {
  if (idx >= lines.length) return lines.join('\n').length;
  let p = 0;
  for (let i = 0; i < idx; i++) p += lines[i].length + 1;
  return p;
}

/** 生成 n 行内容各异的文档行数组。 */
function genLines(n, prefix = 'line') {
  const out = [];
  for (let i = 0; i < n; i++) out.push(`${prefix}-${i}`);
  return out;
}

/** 修改块：A 覆盖行 [aStart, aEnd)，B 覆盖行 [bStart, bEnd)（均 0-based 半开区间）。 */
function changeChunk(aLines, bLines, aStart, aEnd, bStart, bEnd) {
  return {
    fromA: off(aLines, aStart),
    toA: off(aLines, aEnd),
    fromB: off(bLines, bStart),
    toB: off(bLines, bEnd),
  };
}

/** 纯删除块：A 覆盖行 [aStart, aEnd)，B 侧塌缩在 bAnchor 行首。 */
function delChunk(aLines, bLines, aStart, aEnd, bAnchor) {
  const p = off(bLines, bAnchor);
  return { fromA: off(aLines, aStart), toA: off(aLines, aEnd), fromB: p, toB: p };
}

/** 纯新增块：B 覆盖行 [bStart, bEnd)，A 侧塌缩在 aAnchor 行首。 */
function addChunk(aLines, bLines, bStart, bEnd, aAnchor) {
  const p = off(aLines, aAnchor);
  return { fromA: p, toA: p, fromB: off(bLines, bStart), toB: off(bLines, bEnd) };
}

// ════════════════════════════════════════════════════════════════
// computeBarSegments
// ════════════════════════════════════════════════════════════════

// ——— 1. 空输入 / 非法输入 ————————————————————————————————

test('computeBarSegments 空输入：非数组 / 空数组一律返回 []', () => {
  const a = makeDoc(genLines(10));
  assert.deepEqual(computeBarSegments([], a), []);
  assert.deepEqual(computeBarSegments(null, a), []);
  assert.deepEqual(computeBarSegments(undefined, a), []);
  assert.deepEqual(computeBarSegments('not-an-array', a), []);
  assert.deepEqual(computeBarSegments({ chunks: [] }, a), [], '传整个 getChunks 结果而非数组也应安全');
});

test('computeBarSegments 非法 aDoc：缺失 / lines<1 时返回 []（不画任何色块）', () => {
  const aLines = genLines(10);
  const chunks = [changeChunk(aLines, aLines, 0, 2, 0, 2)];
  assert.deepEqual(computeBarSegments(chunks, null), []);
  assert.deepEqual(computeBarSegments(chunks, undefined), []);
  assert.deepEqual(computeBarSegments(chunks, { lines: 0, length: 0, lineAt: () => ({ number: 1 }) }), []);
  assert.deepEqual(computeBarSegments(chunks, { lines: -3, length: 0, lineAt: () => ({ number: 1 }) }), []);
  assert.deepEqual(computeBarSegments(chunks, { lines: NaN, length: 0, lineAt: () => ({ number: 1 }) }), []);
  assert.deepEqual(computeBarSegments(chunks, {}), [], 'doc 无 lines 字段视为空文档');
});

// ——— 2. 返回值契约：严格三键 ————————————————————————————————

test('computeBarSegments 契约：返回对象严格只有 type/topPct/heightPct 三个键', () => {
  const aLines = genLines(10);
  const bLines = genLines(10, 'other');
  const chunks = [
    changeChunk(aLines, bLines, 0, 2, 0, 2),
    delChunk(aLines, bLines, 4, 5, 4),
    addChunk(aLines, bLines, 6, 8, 6),
  ];
  const segs = computeBarSegments(chunks, makeDoc(aLines), makeDoc(bLines));
  assert.equal(segs.length, 3);
  for (const s of segs) {
    assert.deepEqual(Object.keys(s).sort(), ['heightPct', 'topPct', 'type'], '不得泄漏 startLine/endLine 等内部字段');
    assert.equal(typeof s.type, 'string');
    assert.equal(typeof s.topPct, 'number');
    assert.equal(typeof s.heightPct, 'number');
    assert.ok(Number.isFinite(s.topPct) && Number.isFinite(s.heightPct));
    assert.ok(s.topPct >= 0 && s.topPct <= 100, 'topPct 必须夹在 [0,100]');
    assert.ok(s.heightPct > 0 && s.heightPct <= 100, 'heightPct 必须为正且不超 100');
  }
});

// ——— 3. 类型判定 ——————————————————————————————————————

test('computeBarSegments 类型判定：两侧都有→change，仅 B→insert，仅 A→delete', () => {
  const aLines = genLines(10);
  const bLines = genLines(10, 'b');
  const segs = computeBarSegments(
    [
      changeChunk(aLines, bLines, 0, 1, 0, 1),
      addChunk(aLines, bLines, 2, 4, 3),
      delChunk(aLines, bLines, 5, 7, 5),
    ],
    makeDoc(aLines),
    makeDoc(bLines),
  );
  assert.deepEqual(segs.map((s) => s.type), ['change', 'insert', 'delete']);
});

test('computeBarSegments 两侧都空的伪 chunk 与 null 项一律跳过', () => {
  const aLines = genLines(10);
  const p = off(aLines, 3);
  const segs = computeBarSegments(
    [
      null,
      undefined,
      { fromA: p, toA: p, fromB: 0, toB: 0 },           // 两侧都空
      { fromA: 5, toA: 5, fromB: 7, toB: 7 },           // 两侧都空
      changeChunk(aLines, aLines, 0, 1, 0, 1),          // 唯一真差异
    ],
    makeDoc(aLines),
    makeDoc(aLines),
  );
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'change');
});

// ——— 4. 行号换算与百分比几何 ————————————————————————————————

test('computeBarSegments 几何：10 行文档中 chunk 覆盖第 3–4 行 → top 20% / height 20%', () => {
  const aLines = genLines(10);
  const segs = computeBarSegments(
    [changeChunk(aLines, aLines, 2, 4, 2, 4)],
    makeDoc(aLines),
    makeDoc(aLines),
  );
  assert.deepEqual(segs, [{ type: 'change', topPct: 20, heightPct: 20 }]);
});

test('computeBarSegments 用 to-1 探末行：to 落在下一行行首时不得多算一行', () => {
  // 行长度刻意不等，验证「字符偏移 ÷ 文档长度」的错误算法会被识破
  const aLines = ['a', 'bbbbbbbbbbbbbbbbbbbb', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const doc = makeDoc(aLines);

  // 只覆盖第 1 行：to = 第 2 行行首
  const one = computeBarSegments([changeChunk(aLines, aLines, 0, 1, 0, 1)], doc, doc);
  assert.deepEqual(one, [{ type: 'change', topPct: 0, heightPct: 10 }], '1 行应为 10%，多算一行会变 20%');

  // 覆盖第 2 行（超长行）：仍应是 1 行 = 10%，位置在 10%
  const longLine = computeBarSegments([changeChunk(aLines, aLines, 1, 2, 1, 2)], doc, doc);
  assert.deepEqual(longLine, [{ type: 'change', topPct: 10, heightPct: 10 }], '按行号而非字符权重');
});

test('computeBarSegments 单行文档：唯一的 chunk 占满整条概览条', () => {
  const aLines = ['only one line'];
  const doc = makeDoc(aLines);
  const segs = computeBarSegments([changeChunk(aLines, aLines, 0, 1, 0, 1)], doc, doc);
  assert.deepEqual(segs, [{ type: 'change', topPct: 0, heightPct: 100 }]);
});

test('computeBarSegments 百分比保留 4 位小数（3 行文档的 1/3 → 33.3333）', () => {
  const aLines = genLines(3);
  const doc = makeDoc(aLines);
  const segs = computeBarSegments([changeChunk(aLines, aLines, 1, 2, 1, 2)], doc, doc);
  assert.deepEqual(segs, [{ type: 'change', topPct: 33.3333, heightPct: 33.3333 }]);

  // 7 行文档：2/7 → 28.5714（验证四舍五入而非截断）
  const seven = genLines(7);
  const d7 = makeDoc(seven);
  const s7 = computeBarSegments([changeChunk(seven, seven, 2, 4, 2, 4)], d7, d7);
  assert.deepEqual(s7, [{ type: 'change', topPct: 28.5714, heightPct: 28.5714 }]);
});

// ——— 5. 最小高度与下边界回收 ————————————————————————————————

test('computeBarSegments 最小高度：长文档里的 1 行差异被撑到 0.5%', () => {
  const aLines = genLines(400);
  const doc = makeDoc(aLines);
  const segs = computeBarSegments([changeChunk(aLines, aLines, 0, 1, 0, 1)], doc, doc);
  // 真实比例 0.25% < 0.5%，应被 MIN_SEGMENT_PCT 抬起，避免塌成不可见
  assert.deepEqual(segs, [{ type: 'change', topPct: 0, heightPct: 0.5 }]);
});

test('computeBarSegments 末尾块被最小高度撑出下边界时整体上移，始终落在条内', () => {
  const aLines = genLines(400);
  const doc = makeDoc(aLines);
  const segs = computeBarSegments([changeChunk(aLines, aLines, 399, 400, 399, 400)], doc, doc);
  const s = segs[0];
  assert.equal(s.heightPct, 0.5);
  assert.equal(s.topPct, 99.5, '原始 99.75 + 0.5 = 100.25 越界，应回收到 99.5');
  assert.equal(s.topPct + s.heightPct, 100, '块底恰好贴住概览条底部');
});

// ——— 6. 纯新增块借 B 侧行数估厚度 ——————————————————————————————

test('computeBarSegments 纯新增：A 侧无行占位，厚度借 B 侧行数', () => {
  const aLines = genLines(10);
  const bLines = genLines(20, 'b');
  // B 第 3–7 行（共 5 行）新增，插入点在 A 第 5 行行首
  const chunk = addChunk(aLines, bLines, 2, 7, 4);
  const segs = computeBarSegments([chunk], makeDoc(aLines), makeDoc(bLines));
  assert.deepEqual(segs, [{ type: 'insert', topPct: 40, heightPct: 50 }], '5 行 / 10 行标尺 = 50%');
});

test('computeBarSegments 纯新增：缺 bDoc 时按 1 行计厚度（不崩、不为 0）', () => {
  const aLines = genLines(10);
  const bLines = genLines(20, 'b');
  const chunk = addChunk(aLines, bLines, 2, 7, 4);
  assert.deepEqual(
    computeBarSegments([chunk], makeDoc(aLines), null),
    [{ type: 'insert', topPct: 40, heightPct: 10 }],
  );
  assert.deepEqual(
    computeBarSegments([chunk], makeDoc(aLines)),
    [{ type: 'insert', topPct: 40, heightPct: 10 }],
    'bDoc 省略与传 null 行为一致',
  );
});

test('computeBarSegments 纯新增：B 侧行数远超 A 总行数时厚度被夹到 100% 并回收 top', () => {
  const aLines = genLines(10);
  const bLines = genLines(200, 'b');
  const chunk = addChunk(aLines, bLines, 0, 200, 4);
  const segs = computeBarSegments([chunk], makeDoc(aLines), makeDoc(bLines));
  assert.deepEqual(segs, [{ type: 'insert', topPct: 0, heightPct: 100 }]);
});

// ——— 7. maxSegments 截断 ————————————————————————————————

test('computeBarSegments maxSegments：超出上限静默截断，保留前 N 个', () => {
  const aLines = genLines(40);
  const doc = makeDoc(aLines);
  const chunks = [];
  for (let i = 0; i < 10; i++) chunks.push(changeChunk(aLines, aLines, 2 * i, 2 * i + 1, 2 * i, 2 * i + 1));

  assert.equal(computeBarSegments(chunks, doc, doc, 3).length, 3);
  assert.equal(computeBarSegments(chunks, doc, doc, 1).length, 1);
  assert.equal(computeBarSegments(chunks, doc, doc, 3.9).length, 3, '小数上限向下取整');
  assert.equal(computeBarSegments(chunks, doc, doc, 100).length, 10, '上限大于实际数量时全量返回');

  // 截断保留的是靠前的块（顺序稳定）
  const cut = computeBarSegments(chunks, doc, doc, 2);
  assert.deepEqual(cut.map((s) => s.topPct), [0, 5]);
});

test('computeBarSegments maxSegments 非法值回退默认 500', () => {
  const aLines = genLines(1300);
  const doc = makeDoc(aLines);
  const chunks = [];
  for (let i = 0; i < 600; i++) chunks.push(changeChunk(aLines, aLines, 2 * i, 2 * i + 1, 2 * i, 2 * i + 1));

  assert.equal(computeBarSegments(chunks, doc, doc).length, 500, '缺省即 500');
  assert.equal(computeBarSegments(chunks, doc, doc, 0).length, 500);
  assert.equal(computeBarSegments(chunks, doc, doc, -5).length, 500);
  assert.equal(computeBarSegments(chunks, doc, doc, NaN).length, 500);
  assert.equal(computeBarSegments(chunks, doc, doc, 'many').length, 500);
});

// ——— 8. 异常偏移与坏桩件容错 ——————————————————————————————

test('computeBarSegments 异常偏移：负数 / 越界 / NaN 均被夹回文档范围', () => {
  const aLines = genLines(10);
  const doc = makeDoc(aLines);

  // 负 from：夹到 0 → 第 1 行
  const neg = computeBarSegments([{ fromA: -999, toA: off(aLines, 1), fromB: 0, toB: 5 }], doc, doc);
  assert.deepEqual(neg, [{ type: 'change', topPct: 0, heightPct: 10 }]);

  // to 远超 doc.length：夹到末尾 → 末行
  const over = computeBarSegments(
    [{ fromA: off(aLines, 9), toA: 999999, fromB: 0, toB: 5 }],
    doc,
    doc,
  );
  assert.deepEqual(over, [{ type: 'change', topPct: 90, heightPct: 10 }]);

  // NaN 偏移 → num() 归零 → 两侧都空 → 跳过
  assert.deepEqual(
    computeBarSegments([{ fromA: NaN, toA: NaN, fromB: NaN, toB: NaN }], doc, doc),
    [],
  );
});

test('computeBarSegments 容错：lineAt 抛错的 chunk 被整块跳过，且不崩溃', () => {
  // R7：行号换算失败时 lineNumberAt 返回哨兵 0，上游据此跳过整块。
  // 【绝不能回退到第 1 行】那会在文首凭空多画一个色块，还带 data-lp-line="1"，
  // 用户点它会莫名跳到文首 —— 静默给出错误答案，比缺一个色块恶劣得多。
  const bad = {
    lines: 10,
    length: 100,
    lineAt() {
      throw new Error('boom');
    },
  };
  assert.deepEqual(
    computeBarSegments([{ fromA: 30, toA: 60, fromB: 30, toB: 60 }], bad, bad),
    [],
    '坏 doc 既不应崩溃，也不应伪造色块',
  );
});

test('computeBarSegments 容错：lineAt 返回非法 number 的 chunk 同样被跳过', () => {
  const mk = (n) => ({ lines: 10, length: 100, lineAt: () => ({ number: n }) });
  for (const n of [0, -1, NaN, undefined, null, 'x']) {
    assert.deepEqual(
      computeBarSegments([{ fromA: 30, toA: 60, fromB: 30, toB: 60 }], mk(n), mk(n)),
      [],
      `lineAt 返回 ${String(n)} 时应跳过`,
    );
  }
});

test('computeBarSegments 容错：纯新增块的插入点行号不可信时也跳过', () => {
  // 纯新增走的是 lineNumberAt 而非 lineRange 的分支，需单独覆盖
  const badA = {
    lines: 10,
    length: 100,
    lineAt() {
      throw new Error('boom');
    },
  };
  const bLines = genLines(20, 'b');
  const chunk = { fromA: 30, toA: 30, fromB: off(bLines, 2), toB: off(bLines, 7) };
  assert.deepEqual(computeBarSegments([chunk], badA, makeDoc(bLines)), []);
});

test('computeBarSegments 容错：坏 chunk 被跳过时，同批次的好 chunk 仍正常产出', () => {
  // 隔离性：一个坏块不得连累整条概览条
  const aLines = genLines(10);
  const good = makeDoc(aLines);
  let calls = 0;
  const flaky = {
    lines: 10,
    length: good.length,
    lineAt(o) {
      calls += 1;
      if (calls === 1) throw new Error('第一次调用失败'); // 只让第一个 chunk 换算失败
      return good.lineAt(o);
    },
  };
  const segs = computeBarSegments(
    [
      changeChunk(aLines, aLines, 0, 1, 0, 1),  // 坏：首次 lineAt 抛错
      changeChunk(aLines, aLines, 4, 6, 4, 6),  // 好
    ],
    flaky,
    good,
  );
  assert.deepEqual(segs, [{ type: 'change', topPct: 40, heightPct: 20 }]);
});

test('computeBarSegments 容错：doc 有 lines 但缺 lineAt 方法时跳过全部 chunk', () => {
  const aLines = genLines(10);
  const noLineAt = { lines: 10, length: 100 };
  assert.deepEqual(computeBarSegments([changeChunk(aLines, aLines, 0, 2, 0, 2)], noLineAt), []);
});

test('computeBarSegments 容错：doc 缺 length 字段时不夹上界，仍能正常换算', () => {
  const aLines = genLines(10);
  const full = makeDoc(aLines);
  const noLen = { lines: full.lines, lineAt: (o) => full.lineAt(o) };
  const segs = computeBarSegments([changeChunk(aLines, aLines, 2, 4, 2, 4)], noLen, noLen);
  assert.deepEqual(segs, [{ type: 'change', topPct: 20, heightPct: 20 }]);
});

// ════════════════════════════════════════════════════════════════
// computeMoveArcs
// ════════════════════════════════════════════════════════════════

// ——— 1. 空输入 / 非法输入 ————————————————————————————————

test('computeMoveArcs 空输入：非数组 / 空数组一律返回 []', () => {
  assert.deepEqual(computeMoveArcs([], 10), []);
  assert.deepEqual(computeMoveArcs(null, 10), []);
  assert.deepEqual(computeMoveArcs(undefined, 10), []);
  assert.deepEqual(computeMoveArcs('pairs', 10), []);
  assert.deepEqual(computeMoveArcs({ pairs: [] }, 10), []);
});

test('computeMoveArcs totalLines < 1 一律返回 []', () => {
  const pairs = [{ srcStartLine: 1, dstStartLine: 2 }];
  assert.deepEqual(computeMoveArcs(pairs, 0), []);
  assert.deepEqual(computeMoveArcs(pairs, -10), []);
  assert.deepEqual(computeMoveArcs(pairs, NaN), []);
  assert.deepEqual(computeMoveArcs(pairs, undefined), []);
  assert.deepEqual(computeMoveArcs(pairs, '10'), [], '字符串不算合法行数');
  assert.deepEqual(computeMoveArcs(pairs, 0.5), [], '向下取整后为 0');
});

// ——— 2. 返回值契约与基本换算 ——————————————————————————————

test('computeMoveArcs 契约：返回对象严格只有 fromPct/toPct 两个键', () => {
  const arcs = computeMoveArcs([{ srcStartLine: 1, dstStartLine: 10 }], 10);
  assert.equal(arcs.length, 1);
  assert.deepEqual(Object.keys(arcs[0]).sort(), ['fromPct', 'toPct']);
  assert.equal(typeof arcs[0].fromPct, 'number');
  assert.equal(typeof arcs[0].toPct, 'number');
});

test('computeMoveArcs 基本换算：1-based 行号 → (line-1)/total 百分比', () => {
  const arcs = computeMoveArcs(
    [
      { srcStartLine: 1, dstStartLine: 10 },  // 首行 → 末行
      { srcStartLine: 6, dstStartLine: 2 },
    ],
    10,
  );
  assert.deepEqual(arcs, [
    { fromPct: 0, toPct: 90 },
    { fromPct: 50, toPct: 10 },
  ]);
});

test('computeMoveArcs 单行文档：唯一合法行号映射到 0%', () => {
  assert.deepEqual(computeMoveArcs([{ srcStartLine: 1, dstStartLine: 1 }], 1), [{ fromPct: 0, toPct: 0 }]);
});

test('computeMoveArcs 百分比保留 4 位小数（3 行文档的 1/3 → 33.3333）', () => {
  assert.deepEqual(
    computeMoveArcs([{ srcStartLine: 2, dstStartLine: 3 }], 3),
    [{ fromPct: 33.3333, toPct: 66.6667 }],
  );
});

// ——— 3. 非法行号 / 越界行号 ——————————————————————————————

test('computeMoveArcs 非法行号（<1 / NaN / 缺失）跳过，不画到 0 位置造成误导', () => {
  const arcs = computeMoveArcs(
    [
      { srcStartLine: 0, dstStartLine: 5 },
      { srcStartLine: 5, dstStartLine: 0 },
      { srcStartLine: -3, dstStartLine: -4 },
      { srcStartLine: NaN, dstStartLine: 5 },
      { srcStartLine: 5, dstStartLine: undefined },
      { dstStartLine: 5 },
      {},
      null,
      undefined,
      { srcStartLine: 3, dstStartLine: 8 },   // 唯一合法项
    ],
    10,
  );
  assert.deepEqual(arcs, [{ fromPct: 20, toPct: 70 }]);
});

test('computeMoveArcs 越界行号夹到末行，小数行号向下取整', () => {
  assert.deepEqual(
    computeMoveArcs([{ srcStartLine: 999, dstStartLine: 10 }], 10),
    [{ fromPct: 90, toPct: 90 }],
    '超出总行数的行号夹到第 10 行',
  );
  assert.deepEqual(
    computeMoveArcs([{ srcStartLine: 3.9, dstStartLine: 7.2 }], 10),
    [{ fromPct: 20, toPct: 60 }],
  );
  assert.deepEqual(
    computeMoveArcs([{ srcStartLine: 5, dstStartLine: 5 }], 10.9),
    [{ fromPct: 40, toPct: 40 }],
    'totalLines 也向下取整为 10',
  );
});

test('computeMoveArcs 所有百分比恒落在 [0,100]', () => {
  const arcs = computeMoveArcs(
    [
      { srcStartLine: 1, dstStartLine: 1 },
      { srcStartLine: 50, dstStartLine: 50 },
      { srcStartLine: 1e9, dstStartLine: 1e9 },
    ],
    50,
  );
  assert.equal(arcs.length, 3);
  for (const a of arcs) {
    assert.ok(a.fromPct >= 0 && a.fromPct <= 100, `fromPct 越界: ${a.fromPct}`);
    assert.ok(a.toPct >= 0 && a.toPct <= 100, `toPct 越界: ${a.toPct}`);
  }
  // 末行永远映射到 (total-1)/total，绝不会是 100%
  assert.equal(arcs[1].fromPct, 98);
  assert.equal(arcs[2].fromPct, 98);
});

// ——— 4. maxArcs 截断 ————————————————————————————————

test('computeMoveArcs maxArcs：超出上限只取前 N 条', () => {
  const pairs = [];
  for (let i = 1; i <= 10; i++) pairs.push({ srcStartLine: i, dstStartLine: 11 - i });

  assert.equal(computeMoveArcs(pairs, 10, 4).length, 4);
  assert.equal(computeMoveArcs(pairs, 10, 1).length, 1);
  assert.equal(computeMoveArcs(pairs, 10, 4.7).length, 4, '小数上限向下取整');
  assert.deepEqual(
    computeMoveArcs(pairs, 10, 2),
    [{ fromPct: 0, toPct: 90 }, { fromPct: 10, toPct: 80 }],
    '截断保留靠前的条目且顺序稳定',
  );
});

test('computeMoveArcs maxArcs 非法值回退默认 100', () => {
  const pairs = [];
  for (let i = 1; i <= 150; i++) pairs.push({ srcStartLine: i, dstStartLine: 151 - i });

  assert.equal(computeMoveArcs(pairs, 200).length, 100, '缺省即 100');
  assert.equal(computeMoveArcs(pairs, 200, 0).length, 100);
  assert.equal(computeMoveArcs(pairs, 200, -1).length, 100);
  assert.equal(computeMoveArcs(pairs, 200, NaN).length, 100);
  assert.equal(computeMoveArcs(pairs, 200, 'lots').length, 100);
});

test('computeMoveArcs 截断计数只算「实际产出」，被跳过的非法项不占额度', () => {
  const pairs = [
    { srcStartLine: 0, dstStartLine: 0 },   // 非法，跳过
    { srcStartLine: 0, dstStartLine: 0 },   // 非法，跳过
    { srcStartLine: 1, dstStartLine: 5 },
    { srcStartLine: 2, dstStartLine: 6 },
  ];
  assert.deepEqual(
    computeMoveArcs(pairs, 10, 2),
    [{ fromPct: 0, toPct: 40 }, { fromPct: 10, toPct: 50 }],
  );
});

// ——— 5. 与 move-detection 的 MovePair 形态对接 ——————————————————

test('computeMoveArcs 只读 srcStartLine/dstStartLine，MovePair 其余字段不干扰', () => {
  // 形态对齐 detectMoves 产出的 MovePair（9 字段）
  const pair = {
    srcFrom: 0, srcTo: 42, dstFrom: 100, dstTo: 142,
    srcStartLine: 1, srcEndLine: 3, dstStartLine: 6, dstEndLine: 8,
    text: 'moved block',
  };
  assert.deepEqual(computeMoveArcs([pair], 10), [{ fromPct: 0, toPct: 50 }]);
});
