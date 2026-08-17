/**
 * move-detection.js — 对照 / 合并视图的「块移动检测」纯算法（第二期）
 *
 * 目标：把「同一段连续内容从一处挪到另一处」识别为一次 *移动*，而不是
 * 「A 侧删除 + B 侧新增」两处互不相干的差异。
 *
 * 算法参考：
 *  - Git `--color-moved=blocks`：先从行级 diff 中挑出「纯删除块」与「纯新增块」，
 *    再用行指纹（归一化后哈希）在两组块之间做配对，最后把逐行配对里
 *    「A 侧与 B 侧同时连续递增」的部分合并成更大的移动块。
 *  - chennan47/wikEdDiff（Public Domain）：blockMinLength 阈值思路 —— 过短的
 *    “移动块”（行数太少 / 实际字符太少）噪声远大于信息量，直接丢弃。
 *
 * 设计约束：
 *  - 纯函数、纯 ESM，不 import 任何 CodeMirror 运行时，便于 node:test 直接单测。
 *  - 输入的 chunks 结构对齐 `@codemirror/merge` 的 `getChunks(state)` 返回值，
 *    即 `{ chunks: [{ fromA, toA, fromB, toB, ... }] }`，其中 from/to 均为
 *    **字符偏移**（fromA/toA 属于 a 文档，fromB/toB 属于 b 文档）。
 *  - 只做识别，不做渲染；移动块连线属于第三期。
 */

/** 默认阈值。 */
const DEFAULTS = {
  minLines: 2,
  minChars: 20,
  maxPairs: 200,
  ignoreWhitespace: true,
};

/**
 * cyrb53 —— 53 bit 非加密哈希，冲突率远低于 djb2，且纯 32 位整数运算（Math.imul）。
 * @param {string} str
 * @param {number} [seed]
 * @returns {number}
 */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * 行归一化。
 *
 * - `ignoreWs === true`：删除**所有**空白字符（已隐含 trim），因此仅缩进 /
 *   仅内部空格数量不同的两行会得到相同指纹。
 * - `ignoreWs === false`：仅去掉行尾空白（trimEnd，抹平 CRLF / 行尾空格这类
 *   不可见噪声），**保留缩进与内部空白**，从而能区分「只是缩进变了」的块。
 *
 * @param {string} line
 * @param {boolean} ignoreWs
 * @returns {string}
 */
function normalizeLine(line, ignoreWs) {
  const s = line == null ? '' : String(line);
  return ignoreWs ? s.replace(/\s+/g, '') : s.replace(/\s+$/, '');
}

/**
 * 计算单行指纹。
 * @param {string} line 原始行文本（不含换行符）
 * @param {boolean} [ignoreWs] 是否忽略空白，默认 true
 * @returns {string} 36 进制指纹字符串
 */
export function fingerprint(line, ignoreWs = true) {
  return cyrb53(normalizeLine(line, ignoreWs)).toString(36);
}

/**
 * 计算每行起始字符偏移（按 `\n` 拼接的文档模型）。
 * @param {string[]} lines
 * @returns {number[]} starts[i] 为第 i 行首字符在文档中的偏移
 */
export function buildLineStarts(lines) {
  const starts = new Array(lines.length);
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = off;
    off += String(lines[i] ?? '').length + 1; // +1 为行尾 \n
  }
  return starts;
}

/**
 * 二分查找：字符偏移落在第几行（0 基）。
 * @param {number[]} starts buildLineStarts 的结果
 * @param {number} offset
 * @returns {number}
 */
export function lineIndexAt(starts, offset) {
  if (starts.length === 0) return 0;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 把 [from, to) 字符区间换算成闭区间行号 [start, end]。
 *
 * `@codemirror/merge` 的 chunk 边界通常落在「最后一行的换行符之后」，
 * 即 to 恰好等于下一行行首；此时要把末行回退一行。
 *
 * @returns {{ start: number, end: number } | null} 区间为空时返回 null
 */
function rangeToLines(starts, from, to) {
  if (!(to > from)) return null;
  const start = lineIndexAt(starts, from);
  let end = lineIndexAt(starts, to);
  if (to === starts[end] && end > start) end -= 1;
  return { start, end };
}

function toNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 一个移动块对，同时携带**两套坐标**，调用方按用途各取所需、无需自行换算：
 *
 *  1. 字符偏移（srcFrom/srcTo/dstFrom/dstTo）—— 用于 `Decoration.mark` 的 range、
 *     块操作（采纳 / 回退整块）以及 Location Pane 的定位跳转。
 *     区间语义为 [from, to)：to 指向该块**末行行尾**，不含末行换行符。
 *  2. 1-based 行号（srcStartLine/srcEndLine/dstStartLine/dstEndLine）—— 用于
 *     `Decoration.line` 的整块行高亮（CM6 的 `doc.line(n)` 即为 1-based）。
 *     区间语义为**闭区间 [start, end]**：含首含尾，单行块时 start === end。
 *
 * src* 一律基于 a 文档，dst* 一律基于 b 文档。
 *
 * @typedef {Object} MovePair
 * @property {number} srcFrom      a 文档中源块起始字符偏移
 * @property {number} srcTo        a 文档中源块结束字符偏移（末行行尾，不含换行符）
 * @property {number} dstFrom      b 文档中目标块起始字符偏移
 * @property {number} dstTo        b 文档中目标块结束字符偏移（末行行尾，不含换行符）
 * @property {number} srcStartLine a 文档中源块首行行号（1-based，闭区间起点）
 * @property {number} srcEndLine   a 文档中源块末行行号（1-based，闭区间终点，含）
 * @property {number} dstStartLine b 文档中目标块首行行号（1-based，闭区间起点）
 * @property {number} dstEndLine   b 文档中目标块末行行号（1-based，闭区间终点，含）
 * @property {string} text         移动块的源文本（以 \n 连接）
 */

/**
 * 检测「移动块」。
 *
 * @param {string[]} aLines 文件 A 的各行（不含换行符）
 * @param {string[]} bLines 文件 B 的各行（不含换行符）
 * @param {{ chunks: Array<{fromA:number,toA:number,fromB:number,toB:number}> }|Array} chunks
 *        `getChunks(viewA.state)` 的返回值；也容忍直接传入 chunk 数组
 * @param {{minLines?:number,minChars?:number,maxPairs?:number,ignoreWhitespace?:boolean}} [opts]
 * @returns {{ pairs: MovePair[], truncated: boolean }}
 */
export function detectMoves(aLines, bLines, chunks, opts = {}) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const empty = { pairs: [], truncated: false };

  if (!Array.isArray(aLines) || !Array.isArray(bLines)) return empty;
  const list = Array.isArray(chunks) ? chunks
    : (chunks && Array.isArray(chunks.chunks) ? chunks.chunks : null);
  if (!list || list.length === 0) return empty;

  const aStarts = buildLineStarts(aLines);
  const bStarts = buildLineStarts(bLines);

  // —— 步骤 1：收集纯删除行（只在 A）与纯新增行（只在 B）。
  // modified 块（两侧都有内容）跳过：那部分交给行内字词级 diff，避免重复标注。
  const delSet = new Set();
  const addSet = new Set();
  for (const c of list) {
    if (!c) continue;
    const fromA = toNum(c.fromA);
    const toA = toNum(c.toA);
    const fromB = toNum(c.fromB);
    const toB = toNum(c.toB);
    const aEmpty = !(toA > fromA);
    const bEmpty = !(toB > fromB);
    if (!aEmpty && bEmpty) {
      const r = rangeToLines(aStarts, fromA, toA);
      if (r) for (let i = r.start; i <= r.end && i < aLines.length; i++) delSet.add(i);
    } else if (aEmpty && !bEmpty) {
      const r = rangeToLines(bStarts, fromB, toB);
      if (r) for (let i = r.start; i <= r.end && i < bLines.length; i++) addSet.add(i);
    }
  }
  if (delSet.size === 0 || addSet.size === 0) return empty;

  const delList = [...delSet].sort((x, y) => x - y);
  const addList = [...addSet].sort((x, y) => x - y);

  // —— 步骤 2：逐行指纹。
  const ignoreWs = o.ignoreWhitespace !== false;
  const fpA = new Map();
  for (const i of delList) fpA.set(i, fingerprint(aLines[i], ignoreWs));
  const fpB = new Map();
  for (const i of addList) fpB.set(i, fingerprint(bLines[i], ignoreWs));

  const isBlankA = (i) => normalizeLine(aLines[i], true) === '';
  const isBlankB = (i) => normalizeLine(bLines[i], true) === '';

  // 指纹 → 候选 B 行号（升序）。空白行不入索引：它们无法独立发起配对，
  // 只能作为已有连续块的延续被吸收，否则会把两段无关内容误粘成一块。
  const byFp = new Map();
  for (const i of addList) {
    if (isBlankB(i)) continue;
    const key = fpB.get(i);
    let arr = byFp.get(key);
    if (!arr) byFp.set(key, (arr = []));
    arr.push(i);
  }

  // —— 步骤 3：逐行配对，优先「延续上一条配对」以保住整段连续性。
  const consumed = new Set();
  const matches = [];
  let prevA = -2;
  let prevB = -2;
  for (const ai of delList) {
    const key = fpA.get(ai);
    let chosen = -1;

    const contB = prevB + 1;
    if (ai === prevA + 1 && addSet.has(contB) && !consumed.has(contB) && fpB.get(contB) === key) {
      chosen = contB;
    } else if (!isBlankA(ai)) {
      const cands = byFp.get(key);
      if (cands) {
        for (const bi of cands) {
          if (!consumed.has(bi)) { chosen = bi; break; }
        }
      }
    }

    if (chosen < 0) { prevA = -2; prevB = -2; continue; }
    consumed.add(chosen);
    matches.push([ai, chosen]);
    prevA = ai;
    prevB = chosen;
  }
  if (matches.length === 0) return empty;

  // —— 步骤 3b：把 A / B 两侧同时连续递增的相邻配对合并成一个大移动块。
  const runs = [];
  let run = null;
  for (const [ai, bi] of matches) {
    if (run && ai === run.aEnd + 1 && bi === run.bEnd + 1) {
      run.aEnd = ai;
      run.bEnd = bi;
    } else {
      run = { aStart: ai, aEnd: ai, bStart: bi, bEnd: bi };
      runs.push(run);
    }
  }

  // —— 步骤 4：阈值过滤（行数 + 非空白字符数）。
  const pairs = [];
  for (const r of runs) {
    const lineCount = r.aEnd - r.aStart + 1;
    if (lineCount < o.minLines) continue;

    const srcLines = aLines.slice(r.aStart, r.aEnd + 1);
    let chars = 0;
    for (const l of srcLines) chars += String(l ?? '').replace(/\s/g, '').length;
    if (chars < o.minChars) continue;

    pairs.push({
      // 字符偏移：mark 装饰 / 块操作 / Location Pane
      srcFrom: aStarts[r.aStart],
      srcTo: aStarts[r.aEnd] + String(aLines[r.aEnd] ?? '').length,
      dstFrom: bStarts[r.bStart],
      dstTo: bStarts[r.bEnd] + String(bLines[r.bEnd] ?? '').length,
      // 1-based 闭区间行号：line 装饰（内部行索引 0-based，+1 转换）
      srcStartLine: r.aStart + 1,
      srcEndLine: r.aEnd + 1,
      dstStartLine: r.bStart + 1,
      dstEndLine: r.bEnd + 1,
      text: srcLines.join('\n'),
    });
  }

  pairs.sort((x, y) => x.srcFrom - y.srcFrom || x.dstFrom - y.dstFrom);

  // —— 步骤 5：超量截断（超大文件降级：只高亮不连线，连线属于第三期）。
  const max = Number.isFinite(o.maxPairs) && o.maxPairs >= 0 ? o.maxPairs : DEFAULTS.maxPairs;
  if (pairs.length > max) return { pairs: pairs.slice(0, max), truncated: true };
  return { pairs, truncated: false };
}
