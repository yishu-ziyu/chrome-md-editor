// move-connectors.js — 移动块双层连线绘制（第三期）
//
// 【职责】在对比页的相邻栏之间，用 SVG 覆盖层绘制「移动块 src → dst」的连接带。
//   主体侧边：A↔B 层（Yours→Result）与 B↔C 层（Result→Theirs）各画一层。
//   Location Pane 内：复用同一坐标算法，在概览条上画 src→dst 连线（由 location-pane.js 调用）。
//
// 【视觉范式：连接带（ribbon）而非单根线】
//   对齐 GitHub / VS Code 的 diff 连接带：每个移动对画成一个**闭合区域**，
//   左边界是 fromView 上 [srcStartLine 顶部, srcEndLine 底部] 这一段竖直线，
//   右边界是 toView 上 [dstStartLine 顶部, dstEndLine 底部] 这一段竖直线，
//   上下两条边用三次贝塞尔平滑过渡。半透明填充 + 同色描边。
//   这样用户既能看到「挪到哪去了」，也能看到「挪走的是多大一块」。
//
// 【坐标系约定（实现者必读）】
//   - EditorView.coordsAtPos(pos) 返回**视口（viewport）坐标**（{top,left,bottom,right}），
//     不同 EditorView 的坐标必须归一到同一公共祖先（通常是挂载容器 container 的
//     getBoundingClientRect()），否则跨 EditorView 的连线会错位。
//   - **横坐标只取栏的边缘，绝不取行内文字坐标**：连接带的起点 x = fromView 容器的
//     右边缘，终点 x = toView 容器的左边缘，两者都已归一化。这样整条带子只落在
//     两栏之间的缝隙里，不会横穿正文压住文字。纵坐标才用行坐标。
//   - 取某 pair 的行坐标：fromView.state.doc.line(pair[fromLineKey]).from 对应块首行，
//     line(pair[fromEndKey]).to 对应块末行行尾；同理 toView 取 toLineKey / toEndKey。
//   - 折叠占位 / 视口外：当某行被 collapseUnchanged 折叠、或滚出 CM6 渲染视口时，
//     coordsAtPos 会返回 null（该行根本没有 DOM）。三级降级：
//       ① view.coordsAtPos(pos)            —— 有 DOM，最准；
//       ② view.lineBlockAt(pos) + documentTop —— 拿块的文档坐标再换算成视口坐标，
//          折叠占位块也能落在它真实的垂直位置上（而不是全部堆在同一个 y）；
//       ③ view 可见区上/下边界        —— 兜底，绝不返回 null 导致整页崩溃。
//   - **可见区裁剪**：端点 y 一律夹到各自 view 可见区 [top, bottom] 内，
//     滚动时连接带会「收」在栏的上下边缘而不是飞到容器外面去。
//     若源块与目标块**同时**完全滚出各自可见区，则整条跳过（纯噪声）。
//   - truncated=true（超大文件降级）：只高亮不连线 —— 连线层对该层直接跳过绘制。
//   - 单层 pairs 超过 MAX_PAIRS_PER_LAYER 条时只画前 N 条，避免超大文件掉帧；
//     被丢弃的总条数会写到 svg 根元素的 data-truncated-pairs 属性上（未超限时该属性不存在），
//     让「没画出来」这件事有明确语义出口、可被自动化测试断言。
//   - revert 按钮中间列：MergeView 的 revertDOM（class=cm-merge-revert）会占用相邻栏中间
//     空间，连线层须设 pointer-events:none 避免吃掉点击；同时 compare.css 给该列
//     z-index:2，压在本层（z-index:1）之上，避免 SVG 划花「⇄ 接受此块」按钮。
//
// 【调用约定】
//   createCompareMergeView 在构造时创建本 painter：
//     const painter = createConnectorPainter({
//       container,                                   // SVG 覆盖层父节点（.compare-view）
//       getLayers: () => instance.getConnectorLayers(),
//     });
//   并在以下时机调用 painter.draw()：
//     - diff 落定后（scheduler.onRefresh）
//     - 任意 fromView/toView 的 scroll 事件
//     - 窗口 resize（ResizeObserver）/ 主题切换
//   draw() 内部用 requestAnimationFrame 做**同帧合并节流**：滚动事件每秒可触发上百次，
//   但一帧内只会真正重绘一次。无 rAF 的环境（node 单测）退化为同步绘制。
//   另见下方「resize 落定补绘」：尺寸变化那一帧画出来的坐标是**过期**的，必须补一次。
//
// 【样式出口】本文件只负责生成结构与 CSS 变量引用，具体配色在 src/compare.css 里给：
//   - 类名：.cm-move-connector-layer（SVG 根）
//           .cm-move-connector / .cm-move-connector-ab / .cm-move-connector-bc（每条带子）
//   - 变量：--diff-connector-ab / --diff-connector-ab-fill
//           --diff-connector-bc / --diff-connector-bc-fill

// 【第三期增量：独属内容连线（exclusive / wedge）】
//   除「移动块」外，本文件还承担「某侧独有的内容 → 对侧插入点」的连线。
//   二者共用同一套坐标算法与同一个 SVG 覆盖层，区别只在端点形态：
//     · 移动块（ribbon）：两端都是**块跨度**，画成上下两条贝塞尔边围出的连接带；
//     · 独属内容（wedge）：一端是块跨度、另一端收敛成对侧的**插入点**（零高度），
//       于是连接带自然退化为一个楔形（三角形），尖端精确指向「这段内容该插到哪」。
//   端点形态由 pair 上的 srcCaret / dstCaret 布尔字段声明（见 ConnectorPair）。
//   配色不再固定按层取：独属内容需要「红=左侧独有 / 绿=右侧独有」与其行内高亮同色，
//   因此 pair 自身可携带 stroke / fill / variant 覆盖层默认色（见 ConnectorPair）。

/**
 * 单条连线的数据。
 *
 * 行号字段名由所属层的 fromLineKey / toLineKey 决定（历史约定：移动块用
 * srcStartLine / dstStartLine，末行为同名的 *EndLine）。以下为**可选**增量字段：
 *
 * @typedef {Object} ConnectorPair
 * @property {boolean} [srcCaret] 源端是否为「插入点」而非块跨度。
 *   为真时只取 srcStartLine 的**行首**作为零高度端点，忽略 srcEndLine。
 * @property {boolean} [dstCaret] 目标端是否为插入点，语义同上。
 * @property {string}  [stroke]   本条连线的描边色，覆盖层默认色。
 * @property {string}  [fill]     本条连线的填充色，覆盖层默认色。**必须显著淡于描边**。
 * @property {string}  [variant]  语义变体名，会渲染成 `cm-diff-connector-<variant>`
 *   类名与 data-variant 属性，供 CSS 精确着色与自动化测试断言。
 *   约定取值：'added'（仅右侧独有）/ 'removed'（仅左侧独有）/ 'moved'（块移动）。
 */

/**
 * @typedef {Object} ConnectorLayer
 * @property {'ab'|'bc'|'diff'} layer
 * @property {import('@codemirror/view').EditorView} fromView
 * @property {import('@codemirror/view').EditorView} toView
 * @property {Array<{srcStartLine:number,srcEndLine:number,dstStartLine:number,dstEndLine:number,text?:string}>} pairs
 *   ⚠【只读】compare-merge.js 侧对 Chunk.build 的结果按 doc 引用做了 WeakMap 缓存，
 *   本数组（及其元素）可能是**跨轮次、跨层共享**的同一份实例。本文件只允许读取，
 *   绝不可 push / sort / splice / 改元素字段 —— 就地修改会污染缓存，
 *   让下一轮渲染乃至其他消费方拿到被改过的数据，且极难排查。
 *   需要子集时一律用 slice() 等非破坏性方式另取一份。
 * @property {'srcStartLine'|'dstStartLine'} fromLineKey
 * @property {'srcStartLine'|'dstStartLine'} toLineKey
 * @property {boolean} [truncated]
 * @property {string} [stroke] 描边色覆盖；缺省用 LAYER_PAINT 里该层的默认描边色。
 * @property {string} [fill]   填充色覆盖；**必须比描边更淡**，否则半透明连接带会糊成
 *                             实心块盖住栏间内容（见 compare.css 里 -fill 的同款约定）。
 * @property {string} [color]  【兼容别名】等价于 stroke，且**只作用于描边**。
 *                             历史上它同时充当描边与填充，会把填充顶成实色，已废弃该语义；
 *                             要改填充请显式传 fill。
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** 单层最多绘制的连接带条数；超出部分直接丢弃（超大文件防卡顿）。 */
const MAX_PAIRS_PER_LAYER = 200;

/**
 * 连接带的最小水平宽度（px）。
 * 两栏模式下 MergeView 的 a / b 面板紧邻，fromView 右边缘与 toView 左边缘几乎重合，
 * 直接按边缘取值会得到一条零宽度的带子（等于看不见）。此时以两边缘中点为中心
 * 强撑出这个最小宽度——代价是带子会轻微压到两栏最外侧（滚动条/边框区域），
 * 远好过完全不可见。栏间一旦有真实缝隙（三栏的 revert 列 / CSS 加了间距），
 * 该兜底自动失效，带子严格落在缝隙内。
 */
const MIN_BAND_WIDTH = 14;

/**
 * ③ 级兜底（coordsAtPos 与 lineBlockAt 双双失效）时，贴在可见区边缘的带子高度（px）。
 * 必须 > 0：零高度会被「滚出可见区」判定误杀，导致兜底分支形同虚设。
 */
const FALLBACK_BAND = 2;

/**
 * 【resize 落定补绘】尺寸稳定后的补绘采样帧（相对「尺寸不再变化」那一帧的偏移），指数退避。
 *
 * 【为什么必须补绘】ResizeObserver 回调触发的那次 draw，早于 MergeView 重算 spacer
 * （两栏行对齐用的空白填充块）。spacer 一旦重算，两栏所有行的屏幕纵坐标会整体位移
 * （实测约 79px），而此后再没有任何事件会触发重绘 —— 端点就永久停在旧行位上，
 * 与它该连的那一行错开。补一次「基于 spacer 最终位置」的重绘即可归位。
 *
 * 【为什么是指数退避而非每帧重算】spacer 常在 1~2 帧内就绪，但重排慢时可能拖到十几帧。
 * 每帧全量重算会在拖拽窗口边框时把测量成本翻倍（coordsAtPos 触发强制回流）；
 * 采样 1/2/4/8/16 帧共 5 次，既覆盖快慢两端，又把额外开销压到常数级。
 */
const SETTLE_SAMPLE_FRAMES = [1, 2, 4, 8, 16];

/**
 * 补绘观察窗的**硬帧数上限**（约 1s）。拖拽窗口边框期间尺寸会连续变化，
 * 观察窗一直等不到「落定」，此处强制退出避免无限空转；退出后下一次 draw
 * （ResizeObserver 每次回调都会触发）会重新武装观察窗，不会漏掉最终那次落定。
 */
const SETTLE_MAX_FRAMES = 60;

/**
 * 每层的默认描边 / 填充色，写在 path 的 fill / stroke **表现属性**上。
 *
 * 【单一事实源是 src/compare.css】：.cm-move-connector-ab / -bc 这类**类选择器**的
 * 优先级恒高于表现属性，正常环境下真正生效的永远是 CSS（含亮/暗主题自动切换）。
 * 这里保留表现属性，只是为了「CSS 未加载 / 被裁掉」时连线仍然可见的降级。
 *
 * 【为什么必须写死色值、不能用 var()】SVG **表现属性**中的 var() 各浏览器支持不一致，
 * 写 `var(--x, 回退值)` 等于没有兜底 —— 恰恰在 CSS 缺失（变量也不存在）的场景下失效。
 * 故取 compare.css 亮色主题 --diff-connector-* 的实测值写死。
 * ⚠ 改 compare.css 的这四个变量时，请同步改这里，两处色值需人工保持一致。
 */
const LAYER_PAINT = {
  ab: {
    stroke: "rgba(56, 139, 253, 0.7)", // = --diff-connector-ab（亮色）
    fill: "rgba(56, 139, 253, 0.14)", // = --diff-connector-ab-fill（亮色）
  },
  bc: {
    stroke: "rgba(163, 113, 247, 0.7)", // = --diff-connector-bc（亮色）
    fill: "rgba(163, 113, 247, 0.14)", // = --diff-connector-bc-fill（亮色）
  },
  // 独属内容层：层级默认色只是兜底，实际每条 pair 都会带 variant 专属色
  // （红/绿），见 VARIANT_PAINT。
  diff: {
    stroke: "rgba(140, 140, 140, 0.6)",
    fill: "rgba(140, 140, 140, 0.12)",
  },
};

/**
 * 语义变体的默认配色。与 LAYER_PAINT 同理，这里是 CSS 缺失时的降级值，
 * 单一事实源仍是 src/compare.css 的 `--diff-connector-added / -removed`。
 * ⚠ 改 compare.css 的对应变量时请同步这里。
 *
 * 【色值来源】直接取自 compare.css 的行级差异色（--diff-line-added-bg /
 * --diff-line-removed-bg）的同色相、更高透明度版本 —— 这是「连线颜色必须与它
 * 连接的高亮块同色」这条需求的落点：绿连绿、红连红，用户一眼能看出
 * 「这条线连的是哪一块」。
 */
const VARIANT_PAINT = {
  added: {
    // 与 compare.css 的 --diff-added-rgb（= --diff-word-added-bg 的基色）同源，仅 alpha 更高。
    stroke: "rgba(46, 160, 67, 0.75)",
    fill: "rgba(46, 160, 67, 0.16)",
  },
  removed: {
    // 与 compare.css 的 --diff-removed-rgb（= --diff-word-removed-bg 的基色）同源。
    stroke: "rgba(248, 81, 73, 0.75)",
    fill: "rgba(248, 81, 73, 0.16)",
  },
};

/** 允许的层名白名单；未知层名一律归到 'ab'（保持旧行为，不静默丢弃）。 */
const KNOWN_LAYERS = new Set(["ab", "bc", "diff"]);

/**
 * 楔形（wedge）尖端的最小高度（px）。
 *
 * 插入点端点在几何上是零高度的一个点，但零高度会被 computeGeometry 里
 * 「两侧同时滚出可见区」的判据（sBot > top && sTop < bottom）在**恰好贴边**时误杀，
 * 且 SVG 描边在完全退化的路径上有些浏览器不渲染。给尖端撑开 1px 既保证可见，
 * 又在视觉上仍是一个「点」。
 */
const CARET_HEIGHT = 1;

/** 保留两位小数，避免 path 属性里出现超长浮点串。 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

function clamp(v, lo, hi) {
  if (!(hi > lo)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 创建连线绘制器。
 * @param {{container:HTMLElement, getLayers:()=>ConnectorLayer[]}} opts
 * @returns {{draw:()=>void, destroy:()=>void}}
 */
export function createConnectorPainter(opts) {
  const { container, getLayers } = opts || {};
  if (!container || typeof getLayers !== "function") {
    // 契约缺失：安全降级为空操作，不抛错、不白屏。
    return { draw() {}, destroy() {} };
  }

  // SVG 覆盖层：挂在 container 上，绝对定位覆盖整个对比区。
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cm-move-connector-layer");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none", // 不拦截编辑器交互（含 revert 按钮）
    zIndex: "1", // 低于 revert 按钮，高于编辑器底色
    overflow: "visible",
  });

  // 覆盖层用 absolute 定位，若 container 自身是 static，定位会落到更外层的
  // 已定位祖先上，导致整层偏移。这里做一次运行时兜底（正解是在 compare.css 里
  // 给 .compare-view 加 position:relative，见交付说明）。
  try {
    if (typeof getComputedStyle === "function") {
      const cs = getComputedStyle(container);
      if (cs && cs.position === "static") container.style.position = "relative";
    }
  } catch (_) {
    /* 非浏览器环境：忽略 */
  }
  container.appendChild(svg);

  let rafId = 0;
  let destroyed = false;

  // ── resize 落定补绘的状态（详见 SETTLE_SAMPLE_FRAMES 注释）──
  /** 补绘观察窗的 rAF 句柄；非 0 表示观察窗正在跑（单例守卫，防止叠加多条 rAF 链）。 */
  let settleRaf = 0;
  /** 观察窗已消耗的总帧数，用于 SETTLE_MAX_FRAMES 硬上限。 */
  let settleFrames = 0;
  /** 「尺寸不再变化」已持续的帧数；采样点按它取（见 SETTLE_SAMPLE_FRAMES）。 */
  let settleStable = 0;
  /** 最近一次量到的布局尺寸指纹；与新值不同即判定「刚发生过 resize」。 */
  let lastSizeSig = null;
  /** 已渲染进 DOM 的几何指纹；补绘前比对它，几何没变就不写 DOM（不制造无谓的重排与 MutationRecord）。 */
  let renderedSig = null;

  /** 归一化：把视口坐标转成相对 container 的坐标。 */
  function normalize(rect, box) {
    return {
      top: rect.top - box.top,
      left: rect.left - box.left,
      bottom: rect.bottom - box.top,
      right: rect.right - box.left,
    };
  }

  /**
   * 取某 view 的几何信息：
   *  - left/right 用 view.dom（栏的外边缘，连接带的横向锚点）；
   *  - top/bottom 用 view.scrollDOM（真正的可见区，端点裁剪范围）。
   * 均已归一化到 container 坐标系。
   * @returns {{left:number,right:number,top:number,bottom:number}|null}
   */
  function viewGeometry(view, box) {
    try {
      if (!view || !view.dom || typeof view.dom.getBoundingClientRect !== "function") return null;
      const outer = normalize(view.dom.getBoundingClientRect(), box);
      let top = outer.top;
      let bottom = outer.bottom;
      const scroller = view.scrollDOM;
      if (scroller && typeof scroller.getBoundingClientRect === "function") {
        const inner = normalize(scroller.getBoundingClientRect(), box);
        // 退化环境（linkedom 等）下 rect 全为 0，此时不要用它覆盖外框
        if (inner.bottom > inner.top) {
          top = inner.top;
          bottom = inner.bottom;
        }
      }
      return { left: outer.left, right: outer.right, top, bottom };
    } catch (_) {
      return null;
    }
  }

  /**
   * 取某 view 上 [startLine, endLine]（1-based 闭区间）这一块的**视口纵向范围**。
   * 三级降级：coordsAtPos → lineBlockAt + documentTop → null（由调用方兜底到可见区边界）。
   * 返回值仍是**未归一化**的视口坐标，交给调用方统一减 box.top。
   * @returns {{top:number, bottom:number}|null}
   */
  function rawSpan(view, startLine, endLine) {
    try {
      const doc = view.state.doc;
      const total = doc.lines;
      // 【越界即跳过，绝不夹到末行】refreshDecorations 走 200ms debounce，用户连续删行的
      // 那段窗口期内 painter 拿到的是陈旧 pairs。若把越界行号 clamp 到 total，多条 ribbon
      // 会一起堆在文末，制造「明明没这么多移动」的视觉噪音。数据已失效时不画，
      // 比画在错误位置更诚实 —— 返回 null 自然走调用方既有的「跳过」分支。
      const s = Math.floor(Number(startLine));
      if (!Number.isFinite(s) || s < 1 || s > total) return null;
      const e = Math.floor(Number(endLine));
      // 末行早于首行属畸形数据（同样多半来自陈旧 pairs），不做「纠正」，一并跳过。
      if (!Number.isFinite(e) || e < s || e > total) return null;
      const head = edgeOf(view, doc.line(s), "top");
      const tail = s === e ? null : edgeOf(view, doc.line(e), "bottom");
      if (head == null && tail == null) return null;
      // 【多行块末行测不出坐标：用行高估算补齐，不静默塌缩】
      // 直接退回 head.bottom 会让整条 ribbon 从「块的完整高度」缩成一行高，
      // 且不留任何降级痕迹（不像 !srcRaw 分支还有 FALLBACK_BAND 可辨认），
      // 用户会以为移动的只有一行。拿不到有效行高时返回 null，交给下游三级兜底。
      if (head != null && tail == null && e > s) {
        const lh =
          typeof view.defaultLineHeight === "number" && view.defaultLineHeight > 0
            ? view.defaultLineHeight
            : 0;
        if (lh <= 0) return null;
        return { top: head.top, bottom: head.bottom + (e - s) * lh };
      }
      const top = head != null ? head.top : tail.top;
      const bottom = tail != null ? tail.bottom : head.bottom;
      return bottom >= top ? { top, bottom } : { top: bottom, bottom: top };
    } catch (_) {
      return null;
    }
  }

  /**
   * 取某 view 上「第 line 行之前」这个**插入点**的视口纵向位置（零高度端点）。
   *
   * 语义：楔形连线的尖端指向「这段独属内容应该被插到哪里」，即第 line 行的**行首**。
   * 当 line 超过文档末行时（内容应追加到文末），取末行的**行尾**。
   *
   * 返回的仍是未归一化的视口坐标，且 top === bottom（真正的点）；
   * 撑开 CARET_HEIGHT 的工作交给调用方，便于与 ribbon 分支共用后续裁剪逻辑。
   * @returns {{top:number, bottom:number}|null}
   */
  function rawCaret(view, line) {
    try {
      const doc = view.state.doc;
      const total = doc.lines;
      const n = Math.floor(Number(line));
      if (!Number.isFinite(n) || n < 1) return null;
      if (n > total) {
        // 追加到文末：取末行下沿
        const edge = edgeOf(view, doc.line(total), "bottom");
        return edge ? { top: edge.bottom, bottom: edge.bottom } : null;
      }
      const edge = edgeOf(view, doc.line(n), "top");
      return edge ? { top: edge.top, bottom: edge.top } : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 取单行的视口上下沿。which 只影响「哪一端更重要」，两端都会返回。
   * @returns {{top:number, bottom:number}|null}
   */
  function edgeOf(view, line, which) {
    // ① 行有 DOM：coordsAtPos 最准。行首取 top、行尾取 bottom，
    //    这样软换行（一行占多行显示）的块也能量到真实高度。
    try {
      const anchor = which === "bottom" ? line.to : line.from;
      const rect = view.coordsAtPos(anchor);
      if (rect) {
        const other = view.coordsAtPos(which === "bottom" ? line.from : line.to);
        const top = other ? Math.min(rect.top, other.top) : rect.top;
        const bottom = other ? Math.max(rect.bottom, other.bottom) : rect.bottom;
        return { top, bottom };
      }
    } catch (_) {
      /* 落到 ② */
    }
    // ② 行被折叠占位 / 滚出渲染视口：用 lineBlockAt 拿文档坐标，
    //    再加 documentTop（文档顶部的视口坐标，向下滚动时为负）换算回视口坐标。
    try {
      const block = view.lineBlockAt(line.from);
      if (block && typeof block.top === "number") {
        const dt = typeof view.documentTop === "number" ? view.documentTop : 0;
        return { top: block.top + dt, bottom: block.bottom + dt };
      }
    } catch (_) {
      /* 落到 ③ */
    }
    return null;
  }

  /**
   * 生成一条连接带的 path。
   * 上沿：(x1, sTop) →(贝塞尔)→ (x2, dTop)
   * 右沿：(x2, dTop) → (x2, dBottom)
   * 下沿：(x2, dBottom) →(贝塞尔)→ (x1, sBottom)
   * 闭合回 (x1, sTop)。
   */
  function ribbonPath(x1, x2, sTop, sBottom, dTop, dBottom) {
    const cx = x1 + (x2 - x1) / 2; // 两个控制点同在中线，得到对称的 S 形过渡
    return (
      `M ${round2(x1)} ${round2(sTop)} ` +
      `C ${round2(cx)} ${round2(sTop)}, ${round2(cx)} ${round2(dTop)}, ${round2(x2)} ${round2(dTop)} ` +
      `L ${round2(x2)} ${round2(dBottom)} ` +
      `C ${round2(cx)} ${round2(dBottom)}, ${round2(cx)} ${round2(sBottom)}, ${round2(x1)} ${round2(sBottom)} Z`
    );
  }

  /**
   * 坐标原点：container 的 **padding box** 左上角。
   *
   * 【为什么不是 border box】getBoundingClientRect() 给的是 border box，而本层 SVG 用
   * position:absolute; inset:0 定位，其 (0,0) 落在 padding box 左上角，二者相差一圈边框宽度。
   * 当前 .compare-view 无 border/padding 所以恰好等价，但后人给它加 1px 边框，整层连线
   * 就会静默偏移 1px 且没有任何报错或测试能发现。这里显式扣掉边框宽度
   * （clientTop/clientLeft 即上/左边框宽度），与 CSS 解耦。
   */
  function originBox() {
    const rect = container.getBoundingClientRect();
    return {
      top: rect.top + (container.clientTop || 0),
      left: rect.left + (container.clientLeft || 0),
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * 廉价的「布局尺寸指纹」：只量容器与各栏的盒子，**不量任何行坐标**。
   *
   * 补绘观察窗每帧都要判断「尺寸还在变没有」，若用全量几何（含 coordsAtPos）去比，
   * 成本与一次完整重绘相当，拖拽窗口边框时会明显掉帧。盒子指纹只有几次
   * getBoundingClientRect，足以区分 resize / 侧栏开合（会变）与滚动（不会变）。
   * @returns {string|null} 量不到时返回 null（此时按「未变化」处理，不误触发补绘）。
   */
  function sizeSignature() {
    try {
      const box = originBox();
      let sig = `${round2(box.width)}x${round2(box.height)}`;
      for (const layerItem of getLayers() || []) {
        if (!layerItem) continue;
        for (const view of [layerItem.fromView, layerItem.toView]) {
          const g = viewGeometry(view, box);
          sig += g
            ? `|${round2(g.left)},${round2(g.right)},${round2(g.top)},${round2(g.bottom)}`
            : "|-";
        }
      }
      return sig;
    } catch (_) {
      return null;
    }
  }

  /**
   * 【纯测量阶段】算出本轮该画哪些连接带，**不写任何 DOM**。
   * 与 renderGeometry 拆开是为了让补绘观察窗能「先测量、几何没变就不写 DOM」，
   * 避免每次采样都重建一遍 SVG 子树（那会白白制造重排与 MutationRecord）。
   * @returns {{specs:Array<{d:string,layerName:string,fill:string,stroke:string,index:number}>, dropped:number, sig:string}}
   */
  function computeGeometry() {
    const layers = getLayers() || [];
    const box = originBox();
    /** @type {Array<{d:string,layerName:string,fill:string,stroke:string,index:number}>} */
    const specs = [];
    /** 因超过 MAX_PAIRS_PER_LAYER 被丢弃的连接带总条数（跨层累加）。 */
    let droppedPairs = 0;

    for (const layerItem of layers) {
      if (!layerItem || !Array.isArray(layerItem.pairs) || layerItem.pairs.length === 0) continue;
      if (layerItem.truncated === true) continue; // 超大文件：只高亮不连线（既定语义）

      const { fromView, toView } = layerItem;
      const fromGeo = viewGeometry(fromView, box);
      const toGeo = viewGeometry(toView, box);
      if (!fromGeo || !toGeo) continue;

      const layerName = KNOWN_LAYERS.has(layerItem.layer) ? layerItem.layer : "ab";
      const paint = LAYER_PAINT[layerName];
      // stroke 与 fill 是两个独立的可选覆盖字段：填充必须比描边淡得多，
      // 二者绝不能共用同一个色值（否则半透明连接带糊成实心块，盖住栏间内容）。
      // color 只作为 stroke 的兼容别名参与描边，不再影响填充。
      const layerStroke = layerItem.stroke || layerItem.color || paint.stroke;
      const layerFill = layerItem.fill || paint.fill;

      // 行号字段名：调用方只给了 *StartLine，末行由同名的 *EndLine 推出。
      const fromStartKey = layerItem.fromLineKey || "srcStartLine";
      const toStartKey = layerItem.toLineKey || "dstStartLine";
      const fromEndKey = fromStartKey.replace("StartLine", "EndLine");
      const toEndKey = toStartKey.replace("StartLine", "EndLine");

      // 横向锚点：只走栏间缝隙，永不进入正文区域。
      let x1 = fromGeo.right;
      let x2 = toGeo.left;
      if (x2 - x1 < MIN_BAND_WIDTH) {
        const mid = (x1 + x2) / 2;
        x1 = mid - MIN_BAND_WIDTH / 2;
        x2 = mid + MIN_BAND_WIDTH / 2;
      }

      const overflow = layerItem.pairs.length - MAX_PAIRS_PER_LAYER;
      const pairs = overflow > 0 ? layerItem.pairs.slice(0, MAX_PAIRS_PER_LAYER) : layerItem.pairs;
      if (overflow > 0) droppedPairs += overflow;

      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i];
        if (!p) continue;

        // 端点形态：caret 端只取一行的行首（插入点），span 端取整块跨度。
        // 二者返回结构相同，后续裁剪 / 路径生成完全共用。
        const srcRaw = p.srcCaret
          ? rawCaret(fromView, p[fromStartKey])
          : rawSpan(fromView, p[fromStartKey], p[fromEndKey] ?? p[fromStartKey]);
        const dstRaw = p.dstCaret
          ? rawCaret(toView, p[toStartKey])
          : rawSpan(toView, p[toStartKey], p[toEndKey] ?? p[toStartKey]);
        // 两侧都量不出坐标（视图未测量 / 已销毁）→ 无从下笔，跳过。
        // 只有一侧量不出时仍要画：该侧走 ③ 级兜底贴到可见区顶部，至少保住方向指示。
        if (!srcRaw && !dstRaw) continue;

        // 归一化到 container 坐标系；③ 级兜底给一条 FALLBACK_BAND 高的贴边细带，
        // 否则退化成零高度线段会被下面的「滚出可见区」规则误判掉。
        // caret 端本身就是零高度，同样要撑开 CARET_HEIGHT 才不会被误杀（见常量说明）。
        const sTopRaw = srcRaw ? srcRaw.top - box.top : fromGeo.top;
        const sBotRaw = srcRaw
          ? Math.max(srcRaw.bottom - box.top, srcRaw.top - box.top + (p.srcCaret ? CARET_HEIGHT : 0))
          : fromGeo.top + FALLBACK_BAND;
        const dTopRaw = dstRaw ? dstRaw.top - box.top : toGeo.top;
        const dBotRaw = dstRaw
          ? Math.max(dstRaw.bottom - box.top, dstRaw.top - box.top + (p.dstCaret ? CARET_HEIGHT : 0))
          : toGeo.top + FALLBACK_BAND;

        // 两侧同时完全滚出各自可见区 → 这条带子只会退化成贴边的一根直线，纯噪声，跳过。
        const srcOnScreen = sBotRaw > fromGeo.top && sTopRaw < fromGeo.bottom;
        const dstOnScreen = dBotRaw > toGeo.top && dTopRaw < toGeo.bottom;
        if (!srcOnScreen && !dstOnScreen) continue;

        const sTop = clamp(sTopRaw, fromGeo.top, fromGeo.bottom);
        const sBottom = clamp(sBotRaw, fromGeo.top, fromGeo.bottom);
        const dTop = clamp(dTopRaw, toGeo.top, toGeo.bottom);
        const dBottom = clamp(dBotRaw, toGeo.top, toGeo.bottom);

        // 逐条取色：pair 自带 > variant 默认 > 层默认。
        // 「独属内容连线与其高亮块同色」这条需求就落在 variant 这一档上。
        const variant = typeof p.variant === "string" ? p.variant : "";
        const vPaint = VARIANT_PAINT[variant];
        specs.push({
          d: ribbonPath(x1, x2, sTop, sBottom, dTop, dBottom),
          layerName,
          variant,
          fill: p.fill || (vPaint && vPaint.fill) || layerFill,
          stroke: p.stroke || (vPaint && vPaint.stroke) || layerStroke,
          index: i,
        });
      }
    }

    // 几何指纹：把「画出来会长什么样」压成一个字符串。补绘采样时用它判断
    // spacer 是否已经落定 —— 与上次渲染一致就说明还没动，不必写 DOM。
    // 必须含 variant：同一层同一下标的连线可能只是换了语义色（例如某块从
    // 「新增」变成「移动」），几何不变但颜色要变，漏掉它会导致颜色僵在旧值。
    let sig = `${droppedPairs}`;
    for (const s of specs) sig += `;${s.layerName}:${s.variant}:${s.index}:${s.d}`;
    return { specs, dropped: droppedPairs, sig };
  }

  /** 【写 DOM 阶段】把 computeGeometry 的结果落到 SVG 上。 */
  function renderGeometry(geo) {
    // 清空旧路径（保留 svg 节点本身，避免反复挂载/卸载引起重排）
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const frag = document.createDocumentFragment();
    for (const s of geo.specs) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", s.d);
      // 类名三段：通用钩子 + 层 + 语义变体。变体段只在有 variant 时追加，
      // 保证既有的 .cm-move-connector-ab / -bc 选择器行为完全不变（向后兼容）。
      let cls = `cm-move-connector cm-move-connector-${s.layerName}`;
      if (s.variant) cls += ` cm-diff-connector cm-diff-connector-${s.variant}`;
      path.setAttribute("class", cls);
      path.setAttribute("data-layer", s.layerName);
      if (s.variant) path.setAttribute("data-variant", s.variant);
      path.setAttribute("data-pair", String(s.index));
      path.setAttribute("fill", s.fill);
      path.setAttribute("stroke", s.stroke);
      path.setAttribute("stroke-width", "1");
      path.setAttribute("stroke-linejoin", "round");
      frag.appendChild(path);
    }
    svg.appendChild(frag);

    // 超限丢弃必须留下可断言的语义出口（对齐 truncated 的做法）：否则「少了几条带子」
    // 到底是防卡顿丢弃还是绘制 BUG，自动化测试与人工排查都无从分辨。
    // 未超限时移除属性，不留上一帧的脏状态。
    if (geo.dropped > 0) svg.setAttribute("data-truncated-pairs", String(geo.dropped));
    else svg.removeAttribute("data-truncated-pairs");

    renderedSig = geo.sig;
  }

  /** 真正的绘制；只应由 draw() 经 rAF 节流后调用。 */
  function drawNow() {
    if (destroyed) return;
    try {
      // 先把所有「读」做完再统一「写」：sizeSignature 与 computeGeometry 都只读几何，
      // 放在 renderGeometry 之前可避免「写 DOM → 再读 rect」引发的额外强制回流。
      const sizeSig = sizeSignature();
      const geo = computeGeometry();
      renderGeometry(geo);
      // 尺寸变了说明刚发生过 resize / 侧栏开合：此刻 MergeView 的 spacer 多半还没重算完，
      // 画出来的端点是旧行位 —— 武装观察窗，等布局落定后补一次。
      if (sizeSig !== lastSizeSig) {
        lastSizeSig = sizeSig;
        armSettleWatch();
      }
    } catch (err) {
      // 对比页崩溃不可接受：任何异常只记录，绝不向上抛。
      console.error("[move-connectors] 绘制连线失败:", err);
    }
  }

  /**
   * 武装 / 重置「resize 落定补绘」观察窗。
   * 防重入靠三处：① settleRaf 单例（永不并发两条 rAF 链）；② 必须先等尺寸稳定才采样；
   * ③ SETTLE_MAX_FRAMES 硬上限。补绘只改 SVG 内的 path，覆盖层是 absolute + 不参与布局，
   * 不会反过来改变任何元素尺寸，故不存在「补绘→触发 resize→再补绘」的自激回路。
   */
  function armSettleWatch() {
    if (destroyed) return;
    // 无 rAF 的环境（node 单测）：draw 本就是同步的，且没有真实布局可等，直接不启用。
    if (typeof requestAnimationFrame !== "function") return;
    settleFrames = 0;
    settleStable = 0;
    if (settleRaf) return; // 已有观察窗在跑：重置计数复用它即可
    settleRaf = requestAnimationFrame(settleTick);
  }

  function settleTick() {
    settleRaf = 0;
    if (destroyed) return;
    try {
      const sizeSig = sizeSignature();
      if (sizeSig !== lastSizeSig) {
        // 尺寸仍在变（正在拖拽窗口边框）：还没到「落定」，重新计时，先不补绘。
        lastSizeSig = sizeSig;
        settleStable = 0;
      } else {
        settleStable++;
        if (SETTLE_SAMPLE_FRAMES.includes(settleStable)) {
          const geo = computeGeometry();
          // 只有端点真的变了才写 DOM：spacer 没动的采样帧不制造任何重排。
          if (geo.sig !== renderedSig) renderGeometry(geo);
        }
        // 采样表跑完 = 布局已充分落定，收工。
        if (settleStable >= SETTLE_SAMPLE_FRAMES[SETTLE_SAMPLE_FRAMES.length - 1]) return;
      }
      if (++settleFrames >= SETTLE_MAX_FRAMES) return; // 硬上限：绝不无限空转
      settleRaf = requestAnimationFrame(settleTick);
    } catch (_) {
      // 观察窗只是「锦上添花」的补绘，出错就安静收尾：既不刷屏也不打断主绘制链路。
      settleRaf = 0;
    }
  }

  /**
   * 请求一次重绘。滚动事件会高频触发，这里用 rAF 把同一帧内的多次调用合并成一次。
   * 无 rAF 的环境（node 单测）直接同步绘制，保证测试可断言。
   */
  function draw() {
    if (destroyed) return;
    if (typeof requestAnimationFrame !== "function") {
      drawNow();
      return;
    }
    if (rafId) return; // 本帧已排队
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      drawNow();
    });
  }

  function destroy() {
    destroyed = true;
    try {
      // 必须先取消挂起的 rAF：否则销毁后回调仍会跑，触碰已卸载的 DOM。
      // 补绘观察窗同理，且它是**连续续帧**的，漏取消会一直空转到硬上限。
      if (typeof cancelAnimationFrame === "function") {
        if (rafId) cancelAnimationFrame(rafId);
        if (settleRaf) cancelAnimationFrame(settleRaf);
      }
    } catch (_) {
      /* 忽略 */
    }
    rafId = 0;
    settleRaf = 0;
    try {
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    } catch (_) {
      /* 忽略 */
    }
  }

  return { draw, destroy };
}
