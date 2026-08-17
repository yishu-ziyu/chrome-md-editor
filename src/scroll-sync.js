// scroll-sync.js — 可复用的多栏滚动同步模块（编辑页 edit↔preview / 对照·合并多栏共用）
//
// 设计依据：对比合并重构设计文档 §9（滚动同步模块）、§10.1/§10.2。
// 行为对齐：
//   · editor.js:2703-2736 的「双向比例同步 + 单一 isSyncing 标志防回环」
//   · compare-merge.js:738-779 的「每对共享 lock + Math.abs<1 守卫」与「必须取真滚动盒」
//
// 本模块不依赖 @codemirror（只用鸭子类型读 view.scrollDOM / view.state），故可被
// 编辑页（editor.js）与对照/合并页（compare-merge.js）共用，且不反向 import 它们。

/**
 * 块对齐判定的相对位置比阈值（±15%）。各栏光标段落 cursorLine/totalLines 的差 <= 此值视为对齐。
 * @type {number}
 */
const ALIGN_THRESHOLD = 0.15;

/**
 * 文本相似度兜底阈值：段落文本相似度 >= 此值视为对齐（位置比未对齐时的第二判据，见 §9.2「或」）。
 * @type {number}
 */
const TEXT_SIMILARITY = 0.8;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 异步释放锁：优先 rAF，退化到 setTimeout，再退化到同步执行。 */
function raf(fn) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else if (typeof setTimeout === "function") setTimeout(fn, 0);
  else fn();
}

/**
 * 取「某个 EditorView 真正在滚动的那个盒子」。
 * 对齐 compare/scroll-box.js 的逻辑：@codemirror/merge 的 MergeView 自身才是滚动盒，
 * 内部的 .cm-scroller 被 !important 置成随内容增高、永不滚动（scrollTop 恒 0、收不到 scroll 事件）。
 * 故 MergeView 内的栏必须先经此换算，否则比例同步会成为死代码。
 * @param {{scrollDOM?: HTMLElement}|null|undefined} view
 * @returns {HTMLElement|null}
 */
function resolveScrollBox(view) {
  const sd = view && view.scrollDOM;
  if (!sd) return null;
  try {
    if (typeof sd.closest === "function") {
      const mv = sd.closest(".cm-mergeView");
      if (mv) return mv;
    }
  } catch (_) {
    /* 桩件 / 已脱离文档：退回 scrollDOM */
  }
  return sd;
}

/**
 * 生成一个「非 CodeMirror 滚动容器」的适配器，供 views() 返回（编辑页预览区即非 CM 容器）。
 * @param {HTMLElement} scrollBox 真正滚动的 DOM 元素
 * @param {{view?: object|null, getCursorParagraph?: (() => object|null)|null}} [opts]
 * @returns {{scrollBox: HTMLElement, view: object|null, getCursorParagraph: (() => object|null)|null}}
 */
export function scrollAdapter(scrollBox, opts = {}) {
  return {
    scrollBox,
    view: opts.view || null,
    getCursorParagraph: opts.getCursorParagraph || null,
  };
}

// ---------------------------------------------------------------------------
// getCursorParagraph：以空行 / Markdown 块边界切分，返回光标所在段范围与文本
// ---------------------------------------------------------------------------

/**
 * 判断第 n 行是否为「Markdown 块起点」（ATX 标题、围栏代码），用作段落切分边界。
 * @param {import('@codemirror/state').Text} doc
 * @param {number} n 行号（1-based）
 * @returns {boolean}
 */
function isBlockStart(doc, n) {
  let t = "";
  try {
    t = doc.line(n).text;
  } catch (_) {
    return false;
  }
  if (/^\s{0,3}#{1,6}\s/.test(t)) return true; // ATX 标题
  if (/^\s{0,3}(?:```|~~~)/.test(t)) return true; // 围栏代码
  return false;
}

/** 第 n 行是否为空行（trim 后为空）。 */
function isBlankLine(doc, n) {
  try {
    return doc.line(n).text.trim() === "";
  } catch (_) {
    return false;
  }
}

/**
 * 从光标所在行向两侧扩展，得到其所属段落（空行 / Markdown 块边界分隔）的字符范围。
 * @param {import('@codemirror/state').Text} doc
 * @param {number} cursorLineNo 光标所在行（1-based）
 * @returns {{from: number, to: number}}
 */
function paragraphBounds(doc, cursorLineNo) {
  let start = cursorLineNo;
  while (start > 1) {
    if (isBlankLine(doc, start)) break; // 当前行即空行 → 段落在它之后开始
    const prev = start - 1;
    if (isBlankLine(doc, prev)) break; // 上一行空 → 段落在当前行开始
    if (isBlockStart(doc, prev)) break; // 上一行是块起点 → 不并入
    start = prev;
  }
  let end = cursorLineNo;
  while (end < doc.lines) {
    if (isBlankLine(doc, end)) break; // 当前行空 → 段落在它之前结束
    const next = end + 1;
    if (isBlankLine(doc, next)) break; // 下一行空 → 停在当前行
    if (isBlockStart(doc, next)) break; // 下一行是块起点 → 停在当前行
    end = next;
  }
  return { from: doc.line(start).from, to: doc.line(end).to };
}

/**
 * 取某 EditorView 光标所在段落（块对齐检查的「块」= 段落，见 D15）。
 * @param {{state?: {doc?: import('@codemirror/state').Text, selection?: {main?: {head?: number}}}}|null|undefined} view
 * @returns {{from:number,to:number,text:string,cursorLine:number,totalLines:number,ratio:number}|null}
 */
export function getCursorParagraph(view) {
  if (!view || !view.state || !view.state.doc) return null;
  const state = view.state;
  const head = state.selection && state.selection.main ? state.selection.main.head : 0;
  const doc = state.doc;
  const totalLines = doc.lines;
  if (totalLines < 1) return null;
  const cursorLineNo = doc.lineAt(head).number;
  const { from, to } = paragraphBounds(doc, cursorLineNo);
  const text = doc.sliceString(from, to);
  // 相对位置比：cursorLine/totalLines（§9.2）。仅 1 行时取 0.5 居中，避免 0/1 两极。
  const ratio = totalLines > 1 ? cursorLineNo / totalLines : 0.5;
  return { from, to, text, cursorLine: cursorLineNo, totalLines, ratio };
}

/** 简单词汇 Jaccard 相似度（0~1），用于段落文本兜底对齐判定。 */
function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const na = a.trim().toLowerCase().replace(/\s+/g, " ");
  const nb = b.trim().toLowerCase().replace(/\s+/g, " ");
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const sa = new Set(na.split(" "));
  const sb = new Set(nb.split(" "));
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

// ---------------------------------------------------------------------------
// 内部：把 views() 返回的原始项规整为统一「pane」描述
// ---------------------------------------------------------------------------

/**
 * @param {object} item EditorView，或 scrollAdapter() 返回的对象
 * @returns {{kind:'cm'|'adapter', scrollBox: HTMLElement, view: object|null, getParagraph: (()=>object|null)|null, item: object}|null}
 */
function normalizePane(item) {
  if (!item) return null;
  // 适配器（带显式 scrollBox）
  if (item.scrollBox && item.scrollBox.nodeType === 1) {
    return {
      kind: "adapter",
      scrollBox: item.scrollBox,
      view: item.view || null,
      getParagraph: typeof item.getCursorParagraph === "function" ? item.getCursorParagraph : null,
      item,
    };
  }
  // EditorView 形态（含 scrollDOM）
  if (item.scrollDOM && item.scrollDOM.nodeType === 1) {
    return {
      kind: "cm",
      scrollBox: resolveScrollBox(item),
      view: item,
      getParagraph: null,
      item,
    };
  }
  return null;
}

/** 取某 pane 的段落信息（适配器优先用自己的 getCursorParagraph，否则回退到 CM 的 getCursorParagraph）。 */
function paneParagraph(pane) {
  if (!pane) return null;
  if (pane.getParagraph) return pane.getParagraph();
  if (pane.view) return getCursorParagraph(pane.view);
  return null;
}

/** 默认两两配对（A-B/B-C/A-C 等）。N 栏 = 全部 C(N,2) 对。 */
function defaultPairs(n) {
  const ps = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) ps.push([i, j]);
  return ps;
}

// ---------------------------------------------------------------------------
// createScrollSync：主入口
// ---------------------------------------------------------------------------

/**
 * 创建可复用的多栏滚动同步控制器。
 *
 * @param {object} opts
 * @param {() => Array<object>|Array<object>} opts.views
 *   返回栏数组的函数或数组。每栏为 EditorView（自动取真滚动盒）或 scrollAdapter() 产物。
 *   编辑页：[editorView, previewAdapter?]；对照页：[a,b,(c)]；合并页：[a,b,c]。
 * @param {() => boolean} opts.isEnabled 读取同步开关（绑定「滚动」按钮状态）。
 * @param {(v: boolean) => void} opts.setEnabled 写入同步开关（更新按钮 UI）。
 * @param {(activeView: object|null) => void} opts.onMisalign
 *   启用同步但各栏光标段落未对齐时的回调（弹窗询问）。参数为激活栏原始项。
 *   调用方弹窗后，选项 A 调 controller.alignToActive()，选项 B 调 controller.keepAsIs()（或仅关闭）。
 * @param {Array<[number, number]>} [opts.pairs]
 *   显式配对（栏索引对）。不传则默认全部两两配对。合并三栏建议传 [[0,1],[1,2]]（a-b 同滚动盒为 no-op，仅 b-c 生效）。
 * @returns {{
 *   enable: () => void,
 *   disable: () => void,
 *   toggle: () => void,
 *   alignToActive: () => void,
 *   keepAsIs: () => void,
 *   isAligned: () => boolean,
 *   refresh: () => void,
 *   destroy: () => void,
 * }}
 */
export function createScrollSync(opts) {
  const { views, isEnabled, setEnabled, onMisalign } = opts;
  const pairsOpt = opts.pairs || null;

  if (typeof isEnabled !== "function" || typeof setEnabled !== "function") {
    throw new TypeError("createScrollSync: isEnabled / setEnabled 必须是函数");
  }

  /** @type {Array<{box: HTMLElement, handler: Function}>} */
  const scrollHandlers = [];
  /** @type {Array<{box: HTMLElement, type: string, handler: Function}>} */
  const focusHandlers = [];
  let activeItem = null; // 最近聚焦/交互的栏原始项（激活栏）

  // ---- 解析当前栏 ----
  function resolvePanes() {
    const raw = typeof views === "function" ? views() : views;
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePane).filter(Boolean);
  }

  function getActivePane(panes) {
    if (activeItem != null) {
      const found = panes.find((p) => p.item === activeItem);
      if (found) return found;
    }
    return panes[0] || null;
  }

  // ---- 比例同步：链接一对滚动盒（沿用 compare-merge 的「每对共享 lock」策略） ----
  function linkPair(a, b) {
    const bx = a.scrollBox;
    const by = b.scrollBox;
    if (!bx || !by || bx === by) return; // 同滚动盒无需同步（也避免自己驱动自己）
    let lock = false;
    const make = (srcBox, dstBox) => () => {
      if (lock) return; // 共享锁：一次用户滚动只产生一次跨栏写入，杜绝双向浮点回写抖动
      if (!isEnabled()) return;
      const sMax = srcBox.scrollHeight - srcBox.clientHeight;
      const dMax = dstBox.scrollHeight - dstBox.clientHeight;
      if (sMax <= 0 || dMax <= 0) return; // 无可滚余量（MergeView 内栏 scrollDOM 即此情况）
      const next = (srcBox.scrollTop / sMax) * dMax;
      if (Math.abs(dstBox.scrollTop - next) < 1) return; // 已对齐，避免无谓写入
      lock = true;
      dstBox.scrollTop = next;
      raf(() => {
        lock = false;
      });
    };
    const h1 = make(bx, by);
    const h2 = make(by, bx);
    bx.addEventListener("scroll", h1);
    by.addEventListener("scroll", h2);
    scrollHandlers.push({ box: bx, handler: h1 });
    scrollHandlers.push({ box: by, handler: h2 });
  }

  function detachAll() {
    for (const { box, handler } of scrollHandlers) box.removeEventListener("scroll", handler);
    scrollHandlers.length = 0;
    for (const { box, type, handler } of focusHandlers) box.removeEventListener(type, handler);
    focusHandlers.length = 0;
  }

  // 跟踪激活栏：focusin（可聚焦栏）与 pointerdown（预览等不可聚焦栏）双保险。
  function trackFocus(panes) {
    for (const p of panes) {
      const box = p.scrollBox;
      if (!box) continue;
      const onFocus = () => {
        activeItem = p.item;
      };
      box.addEventListener("focusin", onFocus);
      box.addEventListener("pointerdown", onFocus);
      focusHandlers.push({ box, type: "focusin", handler: onFocus });
      focusHandlers.push({ box, type: "pointerdown", handler: onFocus });
    }
  }

  // ---- 块对齐检查（§9.2） ----
  function checkAligned(panes) {
    const paras = panes.map(paneParagraph).filter(Boolean);
    // 不足两栏「可取得段落」时视为已对齐（返回 true）。
    // 注意：编辑页 [editorView, previewAdapter] 中预览适配器无 CM 视图、paneParagraph 恒返回 null，
    // 故 paras 恒只有编辑栏 1 项 → 此处恒为 true，编辑↔预览的「块对齐提示」因此有意不生效。
    // 这是设计取舍：编辑↔预览靠比例同步（linkPair）联动，二者内容形态不同（源码行 vs 渲染 HTML），
    // 段落光标位置比本身无意义，块对齐弹窗只在对照/合并页（各栏并行行结构）才有意义。
    // 若未来需要编辑页也做块对齐提示，应给预览适配器接一个 getCursorParagraph（由预览滚动比例/选区推导）。
    if (paras.length < 2) return true; // 不足两栏无法判定未对齐
    const ratios = paras.map((p) => p.ratio);
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    if (max - min <= ALIGN_THRESHOLD) return true; // 位置比均在 ±15% 内 → 对齐
    // 兜底：以激活栏（或首栏）段落文本为参照，其余段落文本均高度相似 → 视为对齐
    const ref = getActivePane(panes);
    const refPara = ref ? paneParagraph(ref) : paras[0];
    if (refPara && refPara.text) {
      const allSimilar = paras.every(
        (p) => p === refPara || textSimilarity(p.text, refPara.text) >= TEXT_SIMILARITY
      );
      if (allSimilar) return true;
    }
    return false;
  }

  // ---- 比例换算辅助 ----
  function scrollRatio(box) {
    const max = box.scrollHeight - box.clientHeight;
    return max > 0 ? box.scrollTop / max : 0;
  }
  function scrollToRatio(box, ratio) {
    const max = box.scrollHeight - box.clientHeight;
    if (max <= 0) return;
    box.scrollTop = ratio * max;
  }
  // 把 CM 栏光标移到相对位置 ratio 对应的行并滚入视野（选项 A 用）。
  function setCursorAtRatio(view, ratio) {
    const doc = view.state.doc;
    if (doc.lines < 1) return;
    const lineNo = Math.min(doc.lines, Math.max(1, Math.round(ratio * (doc.lines - 1)) + 1));
    const pos = doc.line(lineNo).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  }

  // ---- 公共方法 ----
  function enable() {
    if (isEnabled()) return; // 仅在「不同步→同步」跳变瞬间跑对齐检查
    setEnabled(true);
    const panes = resolvePanes();
    if (!checkAligned(panes)) {
      const active = getActivePane(panes);
      onMisalign(active ? active.item : null); // 未对齐 → 弹窗；调用方据选项回调 alignToActive/keepAsIs
    }
  }

  function disable() {
    if (!isEnabled()) return;
    setEnabled(false);
  }

  function toggle() {
    if (isEnabled()) disable();
    else enable();
  }

  /** 选项 A：把各栏滚动（并移动光标）到激活栏光标段落对应的相对位置，强制对齐后再联动。 */
  function alignToActive() {
    const panes = resolvePanes();
    const active = getActivePane(panes);
    if (!active) return;
    const para = paneParagraph(active);
    const targetRatio = para ? para.ratio : scrollRatio(active.scrollBox);
    for (const p of panes) {
      if (p === active) continue;
      if (p.kind === "cm" && p.view) setCursorAtRatio(p.view, targetRatio);
      else scrollToRatio(p.scrollBox, targetRatio);
    }
  }

  /** 选项 B：维持各栏原位直接同步（比例同步天然以当前位置为基准，无需额外偏移，故为 no-op）。 */
  function keepAsIs() {
    /* 比例联动下「维持原位」即保持同步开启即可，无需动作。 */
  }

  /** 当前各栏是否对齐（供调用方/测试即时查询）。 */
  function isAligned() {
    return checkAligned(resolvePanes());
  }

  /** 重新解析 views() 并重建滚动/焦点监听（对照·合并页切换模式/重建视图后调用）。 */
  function refresh() {
    detachAll();
    const panes = resolvePanes();
    const pairIdx = pairsOpt || defaultPairs(panes.length);
    for (const [i, j] of pairIdx) {
      if (i < 0 || j < 0 || i >= panes.length || j >= panes.length) continue;
      if (i === j) continue;
      linkPair(panes[i], panes[j]);
    }
    trackFocus(panes);
  }

  function destroy() {
    detachAll();
    activeItem = null;
  }

  // 构造即装配监听（编辑页视图稳定；对照/合并页重建后调用 refresh() 即可）。
  refresh();

  return { enable, disable, toggle, alignToActive, keepAsIs, isAligned, refresh, destroy };
}

export default createScrollSync;
