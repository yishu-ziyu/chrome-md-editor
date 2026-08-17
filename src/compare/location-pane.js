// location-pane.js — 位置概览面板（第三期，自研）
//
// 【职责】在对比页右侧提供一个窄条侧栏，把整篇文档压缩成一屏的缩略图：
//   1. 差异概览条：按【行号比例】把差异块（增/删/改）渲染成彩色竖色块，一眼看清全文变更分布；
//   2. 移动块连线：在概览条内部用 SVG 画「移动块 src → dst」的迷你弧线；
//   3. 视口指示器：半透明矩形叠在概览条上，标示 Yours 面板当前可见区在全文中的比例位置；
//   4. 大纲：基于语法树提取的 Markdown 标题层级，标记文档结构；
//   5. 点击跳转：点击概览条任意比例位置 / 色块 / 大纲项，把对应 EditorView 滚动到目标位置。
//
// 【为何自研而非 @replit/codemirror-minimap】
//   - 本项目环境纪律：不引入新依赖（禁用 Docker、本机不装编译器、依赖最小化）。
//   - @replit/codemirror-minimap 的 gutters 仅是「行号→颜色」单值映射，移动块连线仍需
//     自研 SVG 叠加；纯自研（div 色条 + SVG 连线）净增复杂度更低，且不引入 peer deps 风险。
//   - 现有 getOutlineItems(outline.js) / getChunks(@codemirror/merge) / MovePair 数据齐备，
//     零改造即可复用。
//
// 【数据来源】
//   - 差异块：instance.getConnectorLayers()[0].chunks（A↔B 层）。
//     取不到时回退 safeChunks(instance.a.state) —— getChunks 在 MergeView 未初始化完成时
//     会返回 null，必须走 safeChunks 兜底，裸写 .chunks 会抛 TypeError。
//   - 移动对：各 ConnectorLayer.pairs（MovePair，1-based 行号）。truncated 层跳过。
//   - 大纲：getOutlineItems(view)（outline.js，基于 markdown() 提供的语法树）。
//
// 【坐标系约定（务必看懂再改）】
//   概览条只有一条纵轴，但【不同数据源用各自的标尺换算】，切勿混用：
//
//   1) 差异色块 & 视口指示器 —— 标尺 = instance.a（Yours）的【总行数】。
//      - Chunk 的 fromA/toA/fromB/toB 是【字符偏移】，不是行号，必须经 doc.lineAt(off).number
//        换算才能算比例；直接拿字符偏移除以文档长度会得到完全错误的分布（长行 / 短行权重失真）。
//      - 视口指示器同样走【行号标尺】（posAtCoords 反查可见区上下沿 → lineAt），
//        不可退回 scrollTop/scrollHeight 的【像素标尺】：在 lineWrapping（长行占多行像素）
//        与 collapseUnchanged（折叠占位吃掉大量行）之下，像素比例与行号比例非线性偏离，
//        指示器会指到与色块对不上的位置。
//
//   2) 移动块弧线 —— 标尺 = 【该层 fromView 自己的总行数】，按层各算，不共用 Yours 的行数。
//      - ab 层：src=Yours、dst=Result；bc 层：src=Result、dst=Theirs（见 compare-merge.js
//        buildConnectorLayers）。三栏下 Result 初始为空、行数与 Yours 差很远，若两层混用
//        Yours 的行数，bc 层行号会被夹到末行，多条弧线叠在概览条底部同一 y，
//        表达出「所有移动都发生在文末」的错误信息。
//      - MovePair 的 srcStartLine/dstStartLine 已是 1-based 行号，直接换算比例即可；
//        同一层内两端仍共用一把尺（见 computeMoveArcs 的「刻意近似」说明）。
//
// 【调用约定】
//   compare.js 在 render() 两栏/三栏构造完成后创建：
//     const lp = createLocationPane({
//       container,                                    // <aside id="locationPane">
//       instance,                                     // 当前 CompareMergeInstance
//       getConnectorLayers: () => instance.getConnectorLayers(),
//     });
//   并在以下时机调用 lp.update()：
//     - 构造完成 / diff 落定后（instance.refreshDecorations 的回调里）
//     - 文档变更、模式切换、主题切换后
//   teardown 时调用 lp.destroy()。update() 幂等，destroy() 后再调 update() 为安全空操作。
//
// 【CSS 分工】本文件只写「功能性内联样式」（position / top / height / width 百分比定位），
//   颜色、宽度、圆角、缩进、min-height 一律由 compare.css 承担（变量 --lp-* 已就绪）。
//   ⚠ .lp-overview 必须由 CSS 给定可见高度（如 flex:1 或固定 px），否则概览条高度为 0、不可见。

import { getOutlineItems } from "../outline.js";
import { getChunks } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
// ensureSyntaxTree：CM6 的语法解析是惰性增量的，长文档首屏之外的标题默认解析不到。
// 已是既有依赖（outline.js 就从这里取 syntaxTree），不构成新增依赖。
import { ensureSyntaxTree } from "@codemirror/language";
// MergeView 内的 view.scrollDOM 不是滚动盒（可滚余量恒 0、且收不到 scroll 事件），
// 取滚动盒一律走 scrollBoxOf —— 理由见 scroll-box.js 顶部说明。
import { scrollBoxOf } from "./scroll-box.js";

/** 单个色块的最小可视高度百分比（防止 1 行的差异在长文档里塌成 0 高度不可见）。 */
const MIN_SEGMENT_PCT = 0.5;
/** 色块数量上限：超长文档（数千 chunk）全量建 div 会拖垮渲染，超出部分静默丢弃。 */
const DEFAULT_MAX_SEGMENTS = 500;
/** 移动连线数量上限（需求指定 100）。 */
const DEFAULT_MAX_ARCS = 100;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 安全读取差异块（getChunks 在 MergeView 未初始化时可返回 null）。
 * @param {import('@codemirror/state').EditorState} state
 * @returns {readonly any[]}
 */
function safeChunks(state) {
  try {
    const res = getChunks(state);
    return res && res.chunks ? res.chunks : [];
  } catch (_) {
    return [];
  }
}

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
// DOM 层
// ────────────────────────────────────────────────────────────────────────────

/** 清空节点子元素。刻意不用 innerHTML=''，与项目现有风格保持一致。 */
function clearNode(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

const TYPE_LABEL = { change: "修改", insert: "新增", delete: "删除" };

/**
 * @typedef {Object} LocationPaneOpts
 * @property {HTMLElement} container
 * @property {any} instance           CompareMergeInstance
 * @property {() => Array<any>} getConnectorLayers
 */

/**
 * 创建 Location Pane。
 * @param {LocationPaneOpts} opts
 * @returns {{update:()=>void, destroy:()=>void}}
 */
export function createLocationPane(opts) {
  const { container, instance } = opts || {};
  const getLayers = opts && typeof opts.getConnectorLayers === "function" ? opts.getConnectorLayers : null;
  if (!container || !instance) {
    // 契约缺失：安全降级为空操作，不抛错、不白屏。
    return { update() {}, destroy() {} };
  }

  let destroyed = false;
  /** 上次渲染大纲时的 doc（CM 的 Text 不可变，引用相等即内容未变）。O8 缓存判据。 */
  let lastOutlineDoc = null;

  // ── 事件解绑：优先 AbortController 一次性 abort；环境不支持时退回手工解绑清单 ──
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  /** @type {Array<() => void>} */
  const manualOff = [];
  function on(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    const o = Object.assign({}, options || {});
    if (ac) {
      o.signal = ac.signal;
      target.addEventListener(type, handler, o);
      return;
    }
    target.addEventListener(type, handler, o);
    manualOff.push(() => {
      try {
        target.removeEventListener(type, handler, o);
      } catch (_) {}
    });
  }
  function offAll() {
    if (ac) {
      try {
        ac.abort();
      } catch (_) {}
    }
    while (manualOff.length) {
      const fn = manualOff.pop();
      try {
        fn();
      } catch (_) {}
    }
  }

  // ── 静态骨架：只在创建时建一次。update() 只重建 bars / arcs / outline 三处动态内容，
  //    因此重复 update() 不会累积节点、不会重复绑事件（幂等的关键）。 ──
  clearNode(container);

  const root = document.createElement("div");
  root.className = "lp-root";

  // 上区 · 差异概览条
  const secOverview = document.createElement("div");
  secOverview.className = "lp-section lp-section-overview";
  const titleOverview = document.createElement("div");
  titleOverview.className = "lp-section-title";
  titleOverview.textContent = "差异概览";
  const overview = document.createElement("div");
  overview.className = "lp-overview";
  overview.setAttribute("role", "presentation");
  overview.title = "点击跳转到对应位置";
  overview.style.position = "relative"; // 内部所有图层依赖此定位上下文，属功能性样式

  const track = document.createElement("div");
  track.className = "lp-track";
  Object.assign(track.style, { position: "absolute", inset: "0" });

  const barsEl = document.createElement("div");
  barsEl.className = "lp-bars";
  Object.assign(barsEl.style, { position: "absolute", inset: "0" });

  // 弧线层：viewBox 固定 0 0 100 100 + preserveAspectRatio=none，
  // 于是路径坐标直接就是百分比；非等比缩放会拉伸描边，故用 non-scaling-stroke 保线宽。
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "lp-arcs");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  Object.assign(svg.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none", // 不拦截概览条点击
    overflow: "visible",
  });

  const viewportEl = document.createElement("div");
  viewportEl.className = "lp-viewport";
  Object.assign(viewportEl.style, {
    position: "absolute",
    left: "0",
    width: "100%",
    top: "0",
    height: "0",
    pointerEvents: "none",
  });

  overview.appendChild(track);
  overview.appendChild(barsEl);
  overview.appendChild(svg);
  overview.appendChild(viewportEl);
  secOverview.appendChild(titleOverview);
  secOverview.appendChild(overview);

  // 下区 · 文档大纲
  const secOutline = document.createElement("div");
  secOutline.className = "lp-section lp-section-outline";
  const titleOutline = document.createElement("div");
  titleOutline.className = "lp-section-title";
  titleOutline.textContent = "大纲";
  const outlineEl = document.createElement("div");
  outlineEl.className = "lp-outline";
  secOutline.appendChild(titleOutline);
  secOutline.appendChild(outlineEl);

  // 大纲点击走【事件委托】，在此一次性绑定（O(1)）。
  // 【不可改回给每个 item 单独绑】renderOutline() 每次 update() 都重建全部 item，
  // 若逐个 on(el,"click")，注销记录会随 update 次数单调累积：clearNode 只摘 DOM 节点，
  // 摘不掉 manualOff[] 里的闭包（无 AbortController 的环境下即确定性内存泄漏）。
  on(outlineEl, "click", (ev) => {
    if (destroyed) return;
    const t = ev && ev.target;
    const item = t && typeof t.closest === "function" ? t.closest(".lp-outline-item") : null;
    if (!item) return;
    const raw = item.getAttribute("data-lp-pos");
    const pos = raw === null ? NaN : parseInt(raw, 10);
    if (!Number.isFinite(pos)) return;
    scrollViewToPos(instance.a, pos);
  });

  root.appendChild(secOverview);
  root.appendChild(secOutline);
  container.appendChild(root);

  /** 三栏判定：存在独立 Theirs 面板即三栏。 */
  function isThree() {
    return !!instance.theirsView;
  }

  /** 取基准文档（Yours / a 面板）。 */
  function baseDoc() {
    try {
      return instance.a && instance.a.state ? instance.a.state.doc : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 滚动某 view 到指定字符偏移。只滚动、不改选区、不抢焦点 ——
   * 抢焦点会改变「活动栏」，进而改变 Ctrl+S 的写盘目标，是危险的副作用。
   */
  function scrollViewToPos(view, pos) {
    try {
      if (!view || !view.dom || !view.state) return;
      const len = view.state.doc.length;
      const p = Math.max(0, Math.min(num(pos, 0), len));
      view.dispatch({ effects: EditorView.scrollIntoView(p, { y: "center" }) });
    } catch (_) {
      /* 视图已销毁 / 位置越界：静默忽略，跳转失败不应影响页面 */
    }
  }

  /** 滚动某 view 到指定 1-based 行（行号自动夹进文档范围）。 */
  function scrollViewToLine(view, line) {
    try {
      if (!view || !view.state) return;
      const doc = view.state.doc;
      if (!doc.lines) return;
      const n = Math.max(1, Math.min(Math.round(num(line, 1)), doc.lines));
      scrollViewToPos(view, doc.line(n).from);
    } catch (_) {}
  }

  /**
   * 概览条跳转：以 A 面板的行号为准；三栏下同步把中栏 Result 也滚到同一行比例，
   * 避免用户点了概览条却发现中栏没动（两栏下 MergeView 自身已做行对齐，无需重复滚）。
   */
  function jumpToLine(line) {
    scrollViewToLine(instance.a, line);
    if (isThree()) scrollViewToLine(instance.b, line);
  }

  /**
   * 把算好的百分比写进视口指示器。
   *
   * 【O5：top 的夹取与 height 必须用同一个 h】旧实现 top 按 100-hPct 夹、height 却写
   * Math.max(hPct,2)，当 hPct<2 时 height 被抬到 2 而 top 没跟着让位，指示器最多溢出底部 2%。
   */
  function applyViewport(topPct, hPct) {
    const h = Math.max(hPct, 2);
    viewportEl.style.top = round4(Math.min(topPct, Math.max(0, 100 - h))) + "%";
    viewportEl.style.height = round4(h) + "%";
  }

  /**
   * 兜底：像素标尺算法（scrollTop/scrollHeight）。
   * 仅在 posAtCoords 不可用 / 抛错时使用 —— 结果与色块的行号标尺不完全一致，
   * 但「位置略偏」远好过「指示器整个消失」。
   */
  function updateViewportByPixels() {
    try {
      // 必须取滚动盒而非 scrollDOM：两栏/三栏下 Yours 在 MergeView 内，
      // 其 scrollDOM 的 clientHeight ≡ scrollHeight，hPct 恒 100% → 指示器恒被判为
      // 「全文一屏可见」而隐藏，兜底路径同样失效。
      const sd = scrollBoxOf(instance.a);
      if (!sd) return;
      const sh = num(sd.scrollHeight, 0);
      if (sh <= 0) {
        viewportEl.style.height = "0";
        return;
      }
      const topPct = clampPct((num(sd.scrollTop, 0) / sh) * 100);
      const hPct = clampPct((num(sd.clientHeight, 0) / sh) * 100);
      if (hPct >= 99.5) {
        viewportEl.style.height = "0";
        return;
      }
      applyViewport(topPct, hPct);
    } catch (_) {}
  }

  /**
   * 刷新视口指示器：反映 Yours 面板可见区在全文中的比例位置。
   *
   * 【必须用行号标尺，不能用像素标尺】色块走的是行号标尺（buildSegments 里的
   * (startLine-1)/total）。若指示器改用 scrollTop/scrollHeight 的像素比例，在 lineWrapping
   * （一个长行占多行像素高度）与 collapseUnchanged（折叠占位把成百上千行压成一个小条）
   * 之下，两把标尺是非线性偏离的 —— 指示器会明显指到与色块对不上的位置。
   * 这里用 posAtCoords 反查可见区上下沿对应的字符位置，再 lineAt 换算行号，与色块同尺。
   */
  function updateViewport() {
    try {
      const view = instance.a;
      // 【纵向取滚动盒、横向取本栏】两者在 MergeView 下不是同一个元素：
      //   · 可见区的上下沿 = 滚动盒（.cm-mergeView）的 rect —— 栏内 scrollDOM 被库置为
      //     height:auto，它的 rect 覆盖整篇文档，拿它算出的可见区永远是「全文」，
      //     hPct 恒 100% → 指示器永久隐藏（B1 的直接成因）。
      //   · 横坐标必须落在 Yours 这一栏内 —— 三栏下滚动盒横跨 Yours+Result 两栏，
      //     用它的 left 也还在 Yours 栏内，但两栏/三栏统一取本栏更稳妥。
      const sd = scrollBoxOf(view);
      const paneDOM = view && view.scrollDOM;
      const doc = view && view.state ? view.state.doc : null;
      const total = docLines(doc);
      if (!sd || !paneDOM || total < 1) {
        viewportEl.style.height = "0";
        return;
      }
      const r = sd.getBoundingClientRect();
      if (!r || !(r.height > 0)) {
        viewportEl.style.height = "0";
        return;
      }
      // x 取本栏左内沿 +1px：落在内容区内即可，避免取到 gutter 外侧导致解析失败。
      // posAtCoords 第二参传 false：保证越界坐标也返回最近的有效位置（number）而非 null。
      const x = paneDOM.getBoundingClientRect().left + 1;
      const topPos = view.posAtCoords({ x, y: r.top + 1 }, false);
      const botPos = view.posAtCoords({ x, y: r.bottom - 1 }, false);
      if (!Number.isFinite(topPos) || !Number.isFinite(botPos)) {
        throw new Error("posAtCoords 不可用"); // 交给 catch 走像素兜底
      }
      const topLine = doc.lineAt(topPos).number;
      const botLine = Math.max(doc.lineAt(botPos).number, topLine);

      const topPct = clampPct(((topLine - 1) / total) * 100);
      const hPct = clampPct(((botLine - topLine + 1) / total) * 100);
      // 全文一屏可见时隐藏：否则整条概览条被半透明矩形罩住，反而看不清色块分布。
      if (hPct >= 99.5) {
        viewportEl.style.height = "0";
        return;
      }
      applyViewport(topPct, hPct);
    } catch (_) {
      updateViewportByPixels();
    }
  }

  /** 概览条点击：优先用色块自带的行号（精确定位到块首），否则按点击比例换算行号。 */
  function onOverviewClick(ev) {
    if (destroyed) return;
    try {
      const doc = baseDoc();
      const total = docLines(doc);
      if (total < 1) return;

      const target = ev && ev.target;
      const attr = target && target.getAttribute ? target.getAttribute("data-lp-line") : null;
      if (attr) {
        const n = parseInt(attr, 10);
        if (Number.isFinite(n) && n >= 1) {
          jumpToLine(n);
          return;
        }
      }

      const rect = overview.getBoundingClientRect();
      if (!rect || !(rect.height > 0)) return;
      const ratio = Math.max(0, Math.min((num(ev.clientY, rect.top) - rect.top) / rect.height, 1));
      jumpToLine(Math.floor(ratio * total) + 1);
    } catch (err) {
      console.error("[location-pane] 概览条跳转失败:", err);
    }
  }

  // 概览条点击 / 窗口 resize（尺寸变化后可见比例会变，需重算视口指示器）
  on(overview, "click", onOverviewClick);
  if (typeof window !== "undefined") on(window, "resize", updateViewport, { passive: true });

  // A 面板滚动 → 刷新视口指示器。scrollDOM 在构造后即存在；万一晚到，update() 里会补绑。
  // 【必须绑在滚动盒上，不能绑 scrollDOM】scroll 事件【不冒泡】，MergeView 里真正派发
  // scroll 的是 .cm-mergeView；绑在栏内 scrollDOM 上一辈子收不到事件，指示器永不刷新。
  let scrollBound = false;
  function bindScroll() {
    if (scrollBound || destroyed) return;
    const sd = scrollBoxOf(instance.a);
    if (!sd) return;
    on(sd, "scroll", updateViewport, { passive: true });
    scrollBound = true;
  }
  bindScroll();

  /** 收集差异块：优先 A↔B 连线层的 chunks，取不到时回退 MergeView 自身的 chunks。 */
  function collectChunks(layers) {
    const first = layers && layers.length ? layers[0] : null;
    if (first && Array.isArray(first.chunks) && first.chunks.length) return first.chunks;
    try {
      return instance.a && instance.a.state ? safeChunks(instance.a.state) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * 按【层】收集移动对，并给出每层各自的行号标尺。跳过 truncated 层
   * （超大文件降级：只高亮不连线）。
   *
   * 【为何必须分层给标尺】ConnectorLayer 的 src/dst 归属随层而变：
   * ab 层 src=Yours、dst=Result；bc 层 src=Result、dst=Theirs
   * （见 compare-merge.js buildConnectorLayers / scheduler.attach）。三栏下 Result 初始为空，
   * 行数与 Yours 差很远，若两层混用 Yours 的行数换算，bc 层行号会被 computeMoveArcs
   * 内部的 Math.min(..., total) 硬夹到末行 —— 多条弧线叠在概览条底部同一 y，
   * 用户看到的是「所有移动都发生在文末」这个纯粹的错误结论。
   *
   * 标尺取 fromView（src 侧）的行数：同层两端仍共用一把尺（computeMoveArcs 的刻意近似），
   * 选 src 侧是因为它与该层「差异从哪来」的语义一致。
   *
   * @returns {Array<{layer:string,pairs:any[],total:number}>}
   */
  function collectPairsByLayer(layers) {
    const out = [];
    if (!layers || !layers.length) return out;
    for (const l of layers) {
      if (!l || l.truncated) continue;
      if (!Array.isArray(l.pairs) || !l.pairs.length) continue;
      let total = 0;
      try {
        total = l.fromView && l.fromView.state ? docLines(l.fromView.state.doc) : 0;
      } catch (_) {
        total = 0;
      }
      // 标尺取不到就整层跳过：绝不借用别层的行数冒充，那正是本项要修的 BUG。
      if (total < 1) continue;
      out.push({ layer: l.layer || "ab", pairs: l.pairs, total });
    }
    return out;
  }

  /** 重建差异色块。 */
  function renderBars(chunks) {
    clearNode(barsEl);
    const aDoc = baseDoc();
    let bDoc = null;
    try {
      bDoc = instance.b && instance.b.state ? instance.b.state.doc : null;
    } catch (_) {}
    const segs = buildSegments(chunks, aDoc, bDoc, DEFAULT_MAX_SEGMENTS);
    for (const s of segs) {
      const bar = document.createElement("div");
      bar.className = "lp-bar lp-bar-" + s.type;
      Object.assign(bar.style, {
        position: "absolute",
        left: "0",
        width: "100%",
        top: s.topPct + "%",
        height: s.heightPct + "%",
      });
      bar.setAttribute("data-lp-line", String(s.startLine));
      const label = TYPE_LABEL[s.type] || "差异";
      bar.title =
        s.startLine === s.endLine
          ? `${label}：第 ${s.startLine} 行`
          : `${label}：第 ${s.startLine}–${s.endLine} 行`;
      barsEl.appendChild(bar);
    }
  }

  /**
   * 重建移动连线（概览条内部的迷你弧线）。每层用自己的行号标尺换算。
   *
   * DEFAULT_MAX_ARCS 是【全局总额度】而非每层额度：逐层递减剩余预算，
   * 防止「两层各 100 条」把上限悄悄翻倍。
   *
   * @param {Array<{layer:string,pairs:any[],total:number}>} groups collectPairsByLayer 的产出
   */
  function renderArcs(groups) {
    clearNode(svg);
    if (!groups || !groups.length) return;
    let budget = DEFAULT_MAX_ARCS;
    for (const g of groups) {
      if (budget <= 0) break;
      const arcs = computeMoveArcs(g.pairs, g.total, budget);
      budget -= arcs.length;
      for (const arc of arcs) {
        const path = document.createElementNS(SVG_NS, "path");
        // 左侧起、左侧收，中间向右鼓出的贝塞尔弧：在窄条里也能看清「从哪到哪」。
        const d = `M 6 ${arc.fromPct} C 72 ${arc.fromPct}, 72 ${arc.toPct}, 6 ${arc.toPct}`;
        path.setAttribute("class", "lp-arc lp-arc-" + g.layer);
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        // 以下两项为无 CSS 时的兜底，CSS 属性优先级高于表现属性，compare.css 可自由覆盖。
        // 按层区分默认色，与连线层（move-connectors 的 LAYER_PAINT）保持同一套语义：ab 蓝 / bc 紫。
        path.setAttribute(
          "stroke",
          g.layer === "bc" ? "var(--lp-arc-bc, #a371f7)" : "var(--lp-arc, #388bfd)"
        );
        path.setAttribute("stroke-width", "1.5");
        svg.appendChild(path);
      }
    }
  }

  /**
   * 重建大纲列表。
   *
   * R10：`getOutlineItems` 内部走 `syntaxTree(state)`，而 CM6 的 markdown 解析是
   * 【惰性增量】的 —— 长文档刚打开时只解析了视口附近，超出已解析区间的标题会静默缺失，
   * 且没有任何提示。故先用 ensureSyntaxTree 给 50ms 预算把树补齐；补不满或抛错就用现有部分，
   * 宁可少几个标题也绝不阻塞渲染。
   *
   * O8：`lastOutlineDoc` 缓存 —— 三栏下 instance.a 是只读面板，文档基本不变，
   * 而 update() 会被 onRefresh / scroll / resize 频繁调用，每次全量重走语法树纯属浪费。
   */
  function renderOutline() {
    const view = instance.a;
    let curDoc = null;
    try {
      curDoc = view && view.state ? view.state.doc : null;
    } catch (_) {
      curDoc = null;
    }
    // 文档对象未变（CM 的 Text 是不可变的，引用相等即内容相等）→ 现有 DOM 仍然正确，整段跳过。
    if (curDoc && curDoc === lastOutlineDoc) return;

    clearNode(outlineEl);
    let items = [];
    try {
      if (view && view.state) {
        try {
          ensureSyntaxTree(view.state, view.state.doc.length, 50);
        } catch (_) {
          /* 解析超时 / 该语言无解析器：用已解析出的部分，不影响后续渲染 */
        }
        items = getOutlineItems(view) || [];
      }
    } catch (_) {
      items = [];
    }
    // 缓存放在 clearNode 之后：中途抛错时缓存不会被写成「已渲染」，下次仍会重试。
    lastOutlineDoc = curDoc;
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "lp-outline-empty";
      empty.textContent = "（无标题）";
      outlineEl.appendChild(empty);
      return;
    }
    for (const it of items) {
      if (!it) continue;
      const level = Math.max(1, Math.min(num(it.level, 1), 6));
      const el = document.createElement("div");
      el.className = `lp-outline-item lp-outline-h${level}`;
      // 缩进交给 CSS：这里只提供层级变量，compare.css 用
      // padding-left: calc(<base> + var(--lp-indent) * <step>) 即可。
      el.style.setProperty("--lp-indent", String(level - 1));
      // 【必须 textContent】标题文本来自用户文档，innerHTML 会让 <script> / 尖括号破坏 DOM。
      const text = typeof it.text === "string" && it.text ? it.text : "(空标题)";
      el.textContent = text;
      el.title = `${"#".repeat(level)} ${text}`;
      // 只写数据，不绑事件：点击由 outlineEl 上那个一次性委托统一处理（见 B3 注释）。
      el.setAttribute("data-lp-pos", String(num(it.pos, 0)));
      outlineEl.appendChild(el);
    }
  }

  function update() {
    if (destroyed) return; // destroy() 后再调用：安全空操作
    try {
      bindScroll(); // 补绑：视图或 scrollDOM 晚于本面板就绪时兜底
      let layers = [];
      try {
        layers = (getLayers ? getLayers() : []) || [];
      } catch (_) {
        layers = [];
      }
      renderBars(collectChunks(layers));
      renderArcs(collectPairsByLayer(layers));
      renderOutline();
      updateViewport();
    } catch (err) {
      console.error("[location-pane] 更新概览失败:", err);
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    offAll();
    lastOutlineDoc = null; // 释放对 Text 的引用，避免面板销毁后仍钉住整份文档
    try {
      if (root.parentNode) root.parentNode.removeChild(root);
    } catch (_) {}
  }

  return { update, destroy };
}
