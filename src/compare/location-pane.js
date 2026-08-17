// location-pane.js — 差异导航线（需求8 退化实现）
//
// 【职责】对比页最右侧一条可点击的「粗竖线」（#locationPane 内部渲染 .lp-diff-line）。
//   点击行为（跳到下一处差异）由 compare.js 绑在 #locationPane 上、复用现有块导航；
//   本文件只负责渲染这条线，并提供幂等的 update()/destroy()。
//
// 【历史】原「位置概览侧栏」包含差异缩略条 + 移动连线 + 文档大纲三部分；
//   需求7 将大纲提取为独立 #outlinePanel（由 compare.js 控制渲染），需求8 将差异概览
//   退化为最右侧细线，故本文件不再渲染缩略图（bars/arcs/viewport）与大纲。
//
// 【纯函数保留说明】computeBarSegments / computeMoveArcs 两个纯函数被
//   tests/compare-location-pane.test.js 覆盖，签名与行为一律保持不变，便于将来若需
//   恢复缩略图时直接复用，故本文件仍导出它们（虽然当前 DOM 层不再调用）。

// ────────────────────────────────────────────────────────────────────────────
// 纯计算层：以下函数【不依赖 DOM、不依赖 EditorView】，只吃原始数据，可在 node 直接单测。
// 「doc-like」对象只需满足：{ lines:number, length?:number, lineAt(offset):{number:number} }
// —— @codemirror/state 的 Text 天然满足，测试里用最小桩件即可。
// ────────────────────────────────────────────────────────────────────────────

/** 取有限数值，非法值回退 fallback。 */
function num(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 保留 4 位小数，消除浮点尾数噪音，便于单测做精确断言。 */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** 把百分比夹到 [0,100]。 */
function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 100 ? 100 : n;
}

/** 取 doc-like 的总行数，取不到返回 0。 */
function docLines(doc) {
  if (!doc) return 0;
  const n = num(doc.lines, 0);
  return n > 0 ? Math.floor(n) : 0;
}

/** 把字符偏移夹进文档范围内（doc.length 缺失时不夹上界，只保证非负）。 */
function clampOffset(doc, offset) {
  const n = Math.max(0, num(offset, 0));
  const max = doc && typeof doc.length === "number" && Number.isFinite(doc.length) ? doc.length : null;
  return max === null ? n : Math.min(n, Math.max(0, max));
}

/**
 * 字符偏移 → 1-based 行号。
 *
 * 【失败返回哨兵 0，而不是回退到第 1 行】回退 1 会让一个坏偏移在文首凭空多画一个色块，
 * 且该色块带 data-lp-line="1"，用户点它会莫名跳到文首 —— 这是「静默给出错误答案」。
 * 返回 0 让上游（lineRange / buildSegments）能识别出「这个 chunk 的行号不可信」并整块跳过：
 * 少画一个块是可察觉的缺失，画错一个块是不可察觉的误导，前者远优于后者。
 *
 * @param {{lines?:number,length?:number,lineAt?:(o:number)=>{number:number}}} doc
 * @param {number} offset
 * @returns {number} 1-based 行号；换算失败返回 0
 */
function lineNumberAt(doc, offset) {
  if (!doc || typeof doc.lineAt !== "function") return 0;
  try {
    const line = doc.lineAt(clampOffset(doc, offset));
    const n = num(line && line.number, 0);
    return n >= 1 ? Math.floor(n) : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * 把 [from, to) 字符区间换算成 1-based 闭区间行号 [start, end]。
 *
 * 【为何用 to-1 而不是 to 探测末行】@codemirror/merge 的 chunk 边界通常落在
 * 「末行换行符之后」，即 to 恰好等于下一行行首，直接 lineAt(to) 会多算一行。
 * to-1 指向末行的换行符本身，CM 的 lineAt 判定为 `pos <= line.to`，仍归属末行，
 * 因此 to-1 恒定落在正确的末行上，且不依赖 lineAt 返回 `.from` 字段（对桩件更友好）。
 *
 * @returns {{start:number,end:number}|null} 空区间返回 null；任一端行号换算失败（哨兵 0）也返回 null
 */
function lineRange(doc, from, to) {
  if (!doc || !(to > from)) return null;
  const start = lineNumberAt(doc, from);
  const end = lineNumberAt(doc, Math.max(from, to - 1));
  if (start < 1 || end < 1) return null; // 行号不可信：上游据此整块跳过，不画错位色块
  return { start, end: Math.max(start, end) };
}

/**
 * 内部版：比 computeBarSegments 多带 startLine / endLine，供 DOM 层做 title 与点击跳转。
 * 对外导出的 computeBarSegments 只裁剪出契约字段，避免调用方误用内部字段。
 * @returns {Array<{type:string,topPct:number,heightPct:number,startLine:number,endLine:number}>}
 */
function buildSegments(chunks, aDoc, bDoc, maxSegments) {
  /** @type {Array<{type:string,topPct:number,heightPct:number,startLine:number,endLine:number}>} */
  const out = [];
  if (!Array.isArray(chunks) || chunks.length === 0) return out;
  const total = docLines(aDoc);
  if (total < 1) return out; // 文档为空 / doc 不合法：不画任何色块
  const limit = num(maxSegments, 0) > 0 ? Math.floor(maxSegments) : DEFAULT_MAX_SEGMENTS;

  for (const c of chunks) {
    if (!c) continue;
    if (out.length >= limit) break;
    const fromA = num(c.fromA);
    const toA = num(c.toA);
    const fromB = num(c.fromB);
    const toB = num(c.toB);
    const aEmpty = !(toA > fromA);
    const bEmpty = !(toB > fromB);
    if (aEmpty && bEmpty) continue; // 两侧都空：非差异，跳过

    // 类型判定与 refreshDecorations / detectMoves 保持同一套语义：
    //   两侧都有内容 → 修改；只有 B 有 → 新增；只有 A 有 → 删除。
    const type = !aEmpty && !bEmpty ? "change" : aEmpty ? "insert" : "delete";

    let startLine;
    let span;
    // 注意分支判据用 aEmpty 而不是「lineRange 返回 null」：自 lineNumberAt 改用哨兵 0 起，
    // null 既可能表示「A 侧空区间（纯新增）」，也可能表示「行号换算失败」，两者处置不同。
    if (!aEmpty) {
      const aRange = lineRange(aDoc, fromA, toA);
      if (!aRange) continue; // A 侧有内容却算不出行号：跳过，不在文首伪造色块
      startLine = aRange.start;
      span = aRange.end - aRange.start + 1;
    } else {
      // 纯新增：A 侧只有一个插入点，不占 A 的行。位置取插入点所在行，
      // 视觉厚度借用 B 侧的行数 —— 否则「新增 200 行」和「新增 1 行」在概览条上一样细。
      startLine = lineNumberAt(aDoc, fromA);
      if (startLine < 1) continue; // 插入点行号不可信：同样跳过
      const bRange = lineRange(bDoc, fromB, toB);
      span = bRange ? bRange.end - bRange.start + 1 : 1;
    }

    startLine = Math.max(1, Math.min(startLine, total));
    span = Math.max(1, Math.min(span, total));

    let topPct = clampPct(((startLine - 1) / total) * 100);
    const heightPct = Math.max(MIN_SEGMENT_PCT, clampPct((span / total) * 100));
    // 末尾块被最小高度撑出下边界时整体上移，保证始终落在概览条内且可见。
    if (topPct + heightPct > 100) topPct = Math.max(0, 100 - heightPct);

    out.push({
      type,
      topPct: round4(topPct),
      heightPct: round4(heightPct),
      startLine,
      endLine: Math.min(total, startLine + span - 1),
    });
  }
  return out;
}

/**
 * 【纯函数 · 可单测】把差异块换算成概览条上的色块几何。
 *
 * 纵轴标尺 = aDoc 的总行数（1 行 = 100/lines 百分比）。
 *
 * @param {Array<{fromA:number,toA:number,fromB:number,toB:number}>} chunks
 *        差异块数组（字符偏移，非行号）。非数组 / 空数组 → 返回 []。
 * @param {{lines:number,length?:number,lineAt:(o:number)=>{number:number}}} aDoc
 *        A（Yours）文档，doc-like；lines<1 或缺失 → 返回 []。
 * @param {{lines:number,length?:number,lineAt:(o:number)=>{number:number}}} [bDoc]
 *        B 文档，doc-like；仅用于给「纯新增」块估算视觉厚度，缺失时新增块按 1 行计。
 * @param {number} [maxSegments=500] 色块数量上限，超出静默丢弃。
 *        传 0 / 负数 / 非有限值时回退默认上限 500，**不表示「不画」**——
 *        本函数没有「画 0 个」的入参表达方式，需要空结果请直接不调用。
 * @returns {Array<{type:'change'|'insert'|'delete',topPct:number,heightPct:number}>}
 *          topPct/heightPct 单位为百分比（0~100），已四舍五入到 4 位小数。
 *          行号换算失败（坏偏移 / lineAt 抛错）的 chunk 会被整块跳过，不产出色块。
 */
export function computeBarSegments(chunks, aDoc, bDoc, maxSegments) {
  return buildSegments(chunks, aDoc, bDoc, maxSegments).map((s) => ({
    type: s.type,
    topPct: s.topPct,
    heightPct: s.heightPct,
  }));
}

/**
 * 【纯函数 · 可单测】把移动块对换算成概览条上的弧线端点比例。
 *
 * 两端都以同一把标尺（totalLines）换算：srcStartLine 属 A 文档、dstStartLine 属 B 文档，
 * 概览条只有一条纵轴，故统一按 A 的行数取比例 —— 这是【刻意的近似】，
 * 目的是让用户看到「从上面挪到了下面」这一相对关系，而非精确行对齐。
 *
 * @param {Array<{srcStartLine:number,dstStartLine:number}>} pairs
 *        MovePair 数组（1-based 行号）。非数组 / 空数组 → 返回 []。
 * @param {number} totalLines 纵轴总行数，必须 ≥1，否则返回 []。
 *        调用方须传【该层 fromView 自己的行数】，不同层不得共用同一个值（见模块头坐标系约定）。
 * @param {number} [maxArcs=100] 弧线数量上限，超出只取前 N 条。
 *        传 0 / 负数 / 非有限值时回退默认上限 100，**不表示「不画」**——
 *        本函数没有「画 0 条」的入参表达方式，需要空结果请直接不调用。
 * @returns {Array<{fromPct:number,toPct:number}>} 百分比（0~100），保留 4 位小数。
 */
export function computeMoveArcs(pairs, totalLines, maxArcs) {
  /** @type {Array<{fromPct:number,toPct:number}>} */
  const out = [];
  if (!Array.isArray(pairs) || pairs.length === 0) return out;
  const total = num(totalLines, 0) > 0 ? Math.floor(totalLines) : 0;
  if (total < 1) return out;
  const limit = num(maxArcs, 0) > 0 ? Math.floor(maxArcs) : DEFAULT_MAX_ARCS;

  for (const p of pairs) {
    if (!p) continue;
    if (out.length >= limit) break;
    const src = num(p.srcStartLine, 0);
    const dst = num(p.dstStartLine, 0);
    if (src < 1 || dst < 1) continue; // 行号非法：跳过而非画到 0 位置造成误导
    const s = Math.min(Math.floor(src), total);
    const d = Math.min(Math.floor(dst), total);
    out.push({
      fromPct: round4(clampPct(((s - 1) / total) * 100)),
      toPct: round4(clampPct(((d - 1) / total) * 100)),
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 差异导航线（DOM 层）
// ────────────────────────────────────────────────────────────────────────────

/** 单个色块的最小可视高度百分比（防止 1 行的差异在长文档里塌成 0 高度不可见）。 */
const MIN_SEGMENT_PCT = 0.5;
/** 色块数量上限：超长文档（数千 chunk）全量建 div 会拖垮渲染，超出部分静默丢弃。 */
const DEFAULT_MAX_SEGMENTS = 500;
/** 移动连线数量上限（需求指定 100）。 */
const DEFAULT_MAX_ARCS = 100;

/** 清空节点子元素。刻意不用 innerHTML=''，与项目现有风格保持一致。 */
function clearNode(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * 创建差异导航线（需求8 退化实现）。
 *
 * 仅渲染一条可点击的竖线（.lp-diff-line 装饰 + #locationPane 本体作为点击热区）。
 * 点击跳转逻辑由 compare.js 绑在 #locationPane（即本函数的 container）上，复用现有
 * 块导航 navNext，故本函数不绑定 click、也不依赖 instance。
 *
 * @param {{container?:HTMLElement, instance?:any, getConnectorLayers?:()=>Array<any>}} opts
 * @returns {{update:()=>void, destroy:()=>void}}
 */
export function createLocationPane(opts) {
  const { container } = opts || {};
  if (!container) {
    // 契约缺失：安全降级为空操作，不抛错、不白屏。
    return { update() {}, destroy() {} };
  }

  let destroyed = false;

  clearNode(container);

  const root = document.createElement("div");
  root.className = "lp-diff-line-root";

  const line = document.createElement("div");
  line.className = "lp-diff-line";
  line.setAttribute("role", "presentation");
  line.title = "点击跳到下一处差异";
  // .lp-diff-line 纯装饰、pointer-events:none（见 compare.css），点击热区落在 #locationPane 上。
  root.appendChild(line);
  container.appendChild(root);

  function update() {
    if (destroyed) return; // destroy() 后再调用：安全空操作
    // 细线为静态装饰，无动态内容需刷新（差异跳转由 compare.js 的 navNext 处理）。
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try {
      if (root.parentNode) root.parentNode.removeChild(root);
    } catch (_) {}
  }

  return { update, destroy };
}
