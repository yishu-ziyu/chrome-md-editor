/**
 * compare-move-detection.test.js — 块移动检测（src/compare/move-detection.js）单元测试
 *
 * chunks 一律以**字符偏移**构造，对齐 `@codemirror/merge` 的 getChunks 真实结构：
 * `{ chunks: [{ fromA, toA, fromB, toB }] }`，其中 to 落在「末行换行符之后」。
 *
 * MovePair 携带两套坐标，本测试对二者都做断言并交叉校验：
 *  - 字符偏移 srcFrom/srcTo/dstFrom/dstTo —— [from, to)，to 指向末行行尾（不含换行符）
 *  - 1-based 闭区间行号 srcStartLine/srcEndLine/dstStartLine/dstEndLine —— 含首含尾
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectMoves,
  fingerprint,
  buildLineStarts,
} from '../src/compare/move-detection.js';

// ——— 测试辅助：行号 → 字符偏移 ———————————————————————————————

/** 文档总长度（以 \n 连接，末行无换行符）。 */
function docLen(lines) {
  return lines.join('\n').length;
}

/** 第 idx 行行首偏移；idx === lines.length 时返回文档末尾。 */
function off(lines, idx) {
  if (idx >= lines.length) return docLen(lines);
  return buildLineStarts(lines)[idx];
}

/** 纯删除块：A 侧覆盖行 [aStart, aEnd)，B 侧塌缩在 bAnchor 行首。 */
function delChunk(aLines, bLines, aStart, aEnd, bAnchor) {
  const p = off(bLines, bAnchor);
  return { fromA: off(aLines, aStart), toA: off(aLines, aEnd), fromB: p, toB: p };
}

/** 纯新增块：B 侧覆盖行 [bStart, bEnd)，A 侧塌缩在 aAnchor 行首。 */
function addChunk(aLines, bLines, bStart, bEnd, aAnchor) {
  const p = off(aLines, aAnchor);
  return { fromA: p, toA: p, fromB: off(bLines, bStart), toB: off(bLines, bEnd) };
}

/** 从 pair 的字符偏移反查 0-based 行号，便于断言可读。 */
function lineOf(lines, offset) {
  return buildLineStarts(lines).findIndex((s, i, arr) => (
    offset >= s && (i === arr.length - 1 || offset < arr[i + 1])
  ));
}

/**
 * 交叉校验一个 MovePair 的两套坐标自洽：
 * 1-based 行号必须与字符偏移反查出的行号一致；且 to 偏移应精确落在末行行尾。
 */
function assertPairCoordsConsistent(pair, aLines, bLines) {
  assert.equal(pair.srcStartLine, lineOf(aLines, pair.srcFrom) + 1, 'srcStartLine 应与 srcFrom 一致');
  assert.equal(pair.srcEndLine, lineOf(aLines, pair.srcTo) + 1, 'srcEndLine 应与 srcTo 一致');
  assert.equal(pair.dstStartLine, lineOf(bLines, pair.dstFrom) + 1, 'dstStartLine 应与 dstFrom 一致');
  assert.equal(pair.dstEndLine, lineOf(bLines, pair.dstTo) + 1, 'dstEndLine 应与 dstTo 一致');

  // 行号为闭区间：start <= end，且 1-based 不得为 0
  assert.ok(pair.srcStartLine >= 1 && pair.srcStartLine <= pair.srcEndLine, 'src 行号闭区间合法');
  assert.ok(pair.dstStartLine >= 1 && pair.dstStartLine <= pair.dstEndLine, 'dst 行号闭区间合法');

  // to 偏移应精确等于「末行行首 + 末行长度」（行尾，不含换行符）
  const aStarts = buildLineStarts(aLines);
  const bStarts = buildLineStarts(bLines);
  const aEndIdx = pair.srcEndLine - 1;
  const bEndIdx = pair.dstEndLine - 1;
  assert.equal(pair.srcTo, aStarts[aEndIdx] + aLines[aEndIdx].length, 'srcTo 落在源块末行行尾');
  assert.equal(pair.dstTo, bStarts[bEndIdx] + bLines[bEndIdx].length, 'dstTo 落在目标块末行行尾');

  // 行号闭区间覆盖的行数应与 text 行数一致
  assert.equal(pair.srcEndLine - pair.srcStartLine + 1, pair.text.split('\n').length, '行数与 text 一致');
}

// ——— fingerprint ————————————————————————————————————————

test('fingerprint: 同内容稳定、不同内容不同', () => {
  assert.equal(fingerprint('const a = 1;'), fingerprint('const a = 1;'));
  assert.notEqual(fingerprint('const a = 1;'), fingerprint('const a = 2;'));
  assert.equal(typeof fingerprint('x'), 'string');
});

test('fingerprint: ignoreWs=true 抹平缩进与内部空白，false 时保留缩进', () => {
  assert.equal(fingerprint('    const a = 1;', true), fingerprint('const a=1;', true));
  assert.notEqual(fingerprint('    const a = 1;', false), fingerprint('const a = 1;', false));
  // 行尾空白在两种模式下都视为噪声
  assert.equal(fingerprint('const a = 1;   ', false), fingerprint('const a = 1;', false));
});

// ——— 1. 基本移动识别 ——————————————————————————————————————

test('基本移动：一段代码从顶部移到尾部，识别为 1 个移动对（而非删+增）', () => {
  const aLines = [
    'function alpha() {',
    "  return 'alpha payload value';",
    '}',
    'const KEEP_ONE = 1;',
    'const KEEP_TWO = 2;',
  ];
  const bLines = [
    'const KEEP_ONE = 1;',
    'const KEEP_TWO = 2;',
    'function alpha() {',
    "  return 'alpha payload value';",
    '}',
  ];
  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 3, 0),
      addChunk(aLines, bLines, 2, 5, aLines.length),
    ],
  };

  const { pairs, truncated } = detectMoves(aLines, bLines, chunks);

  assert.equal(truncated, false);
  assert.equal(pairs.length, 1, '应合并为 1 个移动对');
  const p = pairs[0];
  assert.equal(lineOf(aLines, p.srcFrom), 0, '源块从 A 第 0 行开始');
  assert.equal(lineOf(aLines, p.srcTo), 2, '源块到 A 第 2 行结束');
  assert.equal(lineOf(bLines, p.dstFrom), 2, '目标块从 B 第 2 行开始');
  assert.equal(lineOf(bLines, p.dstTo), 4, '目标块到 B 第 4 行结束');
  assert.equal(p.text, aLines.slice(0, 3).join('\n'));
  // 偏移必须是真实字符偏移，且 src / dst 位置不同 → 确实是「移动」
  assert.equal(p.srcFrom, 0);
  assert.equal(p.srcTo, aLines.slice(0, 3).join('\n').length);
  assert.notEqual(p.srcFrom, p.dstFrom);

  // 1-based 闭区间行号（渲染侧 Decoration.line 直接使用）
  assert.equal(p.srcStartLine, 1, 'A 第 1 行（1-based）');
  assert.equal(p.srcEndLine, 3, 'A 第 3 行结束，闭区间含尾');
  assert.equal(p.dstStartLine, 3, 'B 第 3 行（1-based）');
  assert.equal(p.dstEndLine, 5, 'B 第 5 行结束，闭区间含尾');
  assertPairCoordsConsistent(p, aLines, bLines);
});

test('modified 块（两侧都有内容）不参与移动判定', () => {
  const aLines = ['const value = 1111111111;', 'const other = 2222222222;'];
  const bLines = ['const value = 9999999999;', 'const other = 2222222222;'];
  const chunks = {
    chunks: [{
      fromA: off(aLines, 0), toA: off(aLines, 1),
      fromB: off(bLines, 0), toB: off(bLines, 1),
    }],
  };
  const { pairs } = detectMoves(aLines, bLines, chunks);
  assert.equal(pairs.length, 0, 'modified 交给行内 diff，不应产出移动对');
});

// ——— 2. 阈值过滤 ————————————————————————————————————————

test('阈值过滤：仅 1 行的移动块被 minLines 过滤掉', () => {
  const aLines = [
    "const SOLO = 'a fairly long single line payload';",
    'const KEEP = 1;',
  ];
  const bLines = [
    'const KEEP = 1;',
    "const SOLO = 'a fairly long single line payload';",
  ];
  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 1, 0),
      addChunk(aLines, bLines, 1, 2, aLines.length),
    ],
  };

  assert.equal(detectMoves(aLines, bLines, chunks).pairs.length, 0, '1 行 < minLines=2');
  // 放宽 minLines 后应能识别出来（证明是被阈值挡掉，而非没匹配上）
  const relaxed = detectMoves(aLines, bLines, chunks, { minLines: 1 });
  assert.equal(relaxed.pairs.length, 1);
});

test('阈值过滤：非空白字符数 < minChars 的移动块被过滤掉', () => {
  const aLines = ['ab', 'cd', 'const KEEP = 1;'];
  const bLines = ['const KEEP = 1;', 'ab', 'cd'];
  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 2, 0),
      addChunk(aLines, bLines, 1, 3, aLines.length),
    ],
  };

  assert.equal(detectMoves(aLines, bLines, chunks).pairs.length, 0, '共 4 个字符 < minChars=20');
  const relaxed = detectMoves(aLines, bLines, chunks, { minChars: 4 });
  assert.equal(relaxed.pairs.length, 1);
});

// ——— 3. 空白忽略 ————————————————————————————————————————

test('空白忽略：仅缩进不同的移动块，ignoreWhitespace=true 可识别，false 时区分', () => {
  const aLines = [
    'const movedAlpha = 1234567890;',
    'const movedBeta  = 1234567890;',
    'const KEEP = 0;',
  ];
  const bLines = [
    'const KEEP = 0;',
    '    const movedAlpha = 1234567890;',   // 仅缩进不同
    '    const movedBeta  = 1234567890;',
  ];
  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 2, 0),
      addChunk(aLines, bLines, 1, 3, aLines.length),
    ],
  };

  const on = detectMoves(aLines, bLines, chunks, { ignoreWhitespace: true });
  assert.equal(on.pairs.length, 1, 'ignoreWhitespace=true 应识别为移动');
  assert.equal(lineOf(bLines, on.pairs[0].dstFrom), 1);

  const offRes = detectMoves(aLines, bLines, chunks, { ignoreWhitespace: false });
  assert.equal(offRes.pairs.length, 0, 'ignoreWhitespace=false 应区分缩进，不算移动');
});

// ——— 4. 跨多行块 ————————————————————————————————————————

test('跨多行块：5 行连续内容整体移动仍正确配对为单个移动对', () => {
  const moved = [
    '## Section Title Here',
    '',
    'Paragraph one with enough characters.',
    'Paragraph two with enough characters.',
    '- bullet item alpha',
  ];
  const aLines = [...moved, 'Tail keep line one.', 'Tail keep line two.'];
  const bLines = ['Tail keep line one.', 'Tail keep line two.', ...moved];

  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 5, 0),
      addChunk(aLines, bLines, 2, 7, aLines.length),
    ],
  };

  const { pairs } = detectMoves(aLines, bLines, chunks);
  assert.equal(pairs.length, 1, '5 行（含 1 个空行）应合并为单个移动对');
  const p = pairs[0];
  assert.equal(p.text, moved.join('\n'));
  assert.equal(lineOf(aLines, p.srcFrom), 0);
  assert.equal(lineOf(aLines, p.srcTo), 4);
  assert.equal(lineOf(bLines, p.dstFrom), 2);
  assert.equal(lineOf(bLines, p.dstTo), 6);

  // 1-based 闭区间行号：A 第 1..5 行 → B 第 3..7 行，跨度均为 5 行
  assert.equal(p.srcStartLine, 1);
  assert.equal(p.srcEndLine, 5);
  assert.equal(p.dstStartLine, 3);
  assert.equal(p.dstEndLine, 7);
  assert.equal(p.srcEndLine - p.srcStartLine + 1, 5, '源块覆盖 5 行');
  assert.equal(p.dstEndLine - p.dstStartLine + 1, 5, '目标块覆盖 5 行');
  assertPairCoordsConsistent(p, aLines, bLines);
});

test('跨多行块：3 行移动 + 另一处 3 行移动，产出 2 个互不干扰的移动对', () => {
  const blk1 = ['alpha line one payload', 'alpha line two payload', 'alpha line three ok'];
  const blk2 = ['beta line one payload', 'beta line two payload', 'beta line three ok'];
  const aLines = [...blk1, 'KEEP MIDDLE LINE', ...blk2, 'KEEP TAIL LINE'];
  const bLines = ['KEEP MIDDLE LINE', ...blk2, 'KEEP TAIL LINE', ...blk1];

  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 3, 0),          // blk1 从 A 头部删除
      delChunk(aLines, bLines, 4, 7, 1),          // blk2 从 A 中部删除
      addChunk(aLines, bLines, 1, 4, 4),          // blk2 出现在 B 前部
      addChunk(aLines, bLines, 5, 8, aLines.length), // blk1 出现在 B 尾部
    ],
  };

  const { pairs } = detectMoves(aLines, bLines, chunks);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].text, blk1.join('\n'));
  assert.equal(pairs[1].text, blk2.join('\n'));
  assert.equal(lineOf(bLines, pairs[0].dstFrom), 5, 'blk1 落到 B 第 5 行');
  assert.equal(lineOf(bLines, pairs[1].dstFrom), 1, 'blk2 落到 B 第 1 行');

  // 1-based 闭区间行号：blk1 A1..3 → B6..8；blk2 A5..7 → B2..4
  assert.deepEqual(
    [pairs[0].srcStartLine, pairs[0].srcEndLine, pairs[0].dstStartLine, pairs[0].dstEndLine],
    [1, 3, 6, 8],
  );
  assert.deepEqual(
    [pairs[1].srcStartLine, pairs[1].srcEndLine, pairs[1].dstStartLine, pairs[1].dstEndLine],
    [5, 7, 2, 4],
  );
  for (const p of pairs) assertPairCoordsConsistent(p, aLines, bLines);
});

test('契约：每个 pair 都齐备两套坐标（4 个偏移 + 4 个 1-based 行号 + text）', () => {
  const moved = ['moved alpha line payload', 'moved beta line payload'];
  const aLines = [...moved, 'keep tail line here'];
  const bLines = ['keep tail line here', ...moved];
  const chunks = {
    chunks: [
      delChunk(aLines, bLines, 0, 2, 0),
      addChunk(aLines, bLines, 1, 3, aLines.length),
    ],
  };

  const { pairs } = detectMoves(aLines, bLines, chunks);
  assert.equal(pairs.length, 1);
  const p = pairs[0];

  assert.deepEqual(
    Object.keys(p).sort(),
    ['dstEndLine', 'dstFrom', 'dstStartLine', 'dstTo',
      'srcEndLine', 'srcFrom', 'srcStartLine', 'srcTo', 'text'],
    'MovePair 字段集合应恰好为约定的 9 个',
  );
  for (const k of ['srcFrom', 'srcTo', 'dstFrom', 'dstTo',
    'srcStartLine', 'srcEndLine', 'dstStartLine', 'dstEndLine']) {
    assert.equal(typeof p[k], 'number', `${k} 应为 number`);
    assert.ok(Number.isInteger(p[k]) && p[k] >= 0, `${k} 应为非负整数`);
  }
  assert.equal(typeof p.text, 'string');
  assertPairCoordsConsistent(p, aLines, bLines);
});

// ——— 5. 大文件截断 ————————————————————————————————————————

test('大文件截断：移动对数量超过 maxPairs 时截断并置 truncated=true', () => {
  const N = 250;
  const aLines = [];
  const bLines = [];
  const tail = [];
  for (let i = 0; i < N; i++) {
    // A: [moved1_i, moved2_i, keep_i] × N  —— 相邻移动块之间被 keep 行隔开，不会被合并
    aLines.push(`const MOVED_ALPHA_${i} = 'payload value';`);
    aLines.push(`const MOVED_BETA_${i} = 'payload value';`);
    aLines.push(`const KEEP_${i} = ${i};`);
    // B: 先全部 keep 行，再全部 moved 行
    bLines.push(`const KEEP_${i} = ${i};`);
    tail.push(`const MOVED_ALPHA_${i} = 'payload value';`);
    tail.push(`const MOVED_BETA_${i} = 'payload value';`);
  }
  bLines.push(...tail);

  const chunkList = [];
  for (let i = 0; i < N; i++) {
    chunkList.push(delChunk(aLines, bLines, 3 * i, 3 * i + 2, i));
    chunkList.push(addChunk(aLines, bLines, N + 2 * i, N + 2 * i + 2, 3 * i + 2));
  }

  const res = detectMoves(aLines, bLines, { chunks: chunkList });
  assert.equal(res.truncated, true, '超出 maxPairs 应置 truncated');
  assert.equal(res.pairs.length, 200, '默认 maxPairs=200');
  // 截断保留的是 srcFrom 最小的前 N 个
  assert.equal(lineOf(aLines, res.pairs[0].srcFrom), 0);
  assert.equal(lineOf(aLines, res.pairs[199].srcFrom), 3 * 199);

  // 抬高 maxPairs 后应拿到全部，且不再截断
  const full = detectMoves(aLines, bLines, { chunks: chunkList }, { maxPairs: 1000 });
  assert.equal(full.truncated, false);
  assert.equal(full.pairs.length, N);
});

// ——— 边界 ——————————————————————————————————————————————

test('边界：空输入 / 无 chunks / 无匹配时安全返回空结果', () => {
  assert.deepEqual(detectMoves([], [], { chunks: [] }), { pairs: [], truncated: false });
  assert.deepEqual(detectMoves(null, null, null), { pairs: [], truncated: false });
  assert.deepEqual(detectMoves(['a'], ['b'], undefined), { pairs: [], truncated: false });

  // 只有删除、没有新增 → 不是移动
  const aLines = ['removed line with plenty of chars', 'removed line two here', 'keep'];
  const bLines = ['keep'];
  const chunks = { chunks: [delChunk(aLines, bLines, 0, 2, 0)] };
  assert.equal(detectMoves(aLines, bLines, chunks).pairs.length, 0);
});
