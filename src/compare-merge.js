// compare-merge.js — 两栏 / 三栏 diff 视图（T2 / T4）
//
// 封装 @codemirror/merge 的 MergeView。
//
// 导出（签名在冻结契约基础上做超集扩展，不破坏既有字段）：
//   createCompareMergeView(opts): CompareMergeInstance
//
// 设计要点：
//   - layout='two'   ：纯两栏对照，a=Yours（可编辑或只读，默认可编辑）、b=Theirs（可编辑）。
//                      差异块红绿高亮 + 行号差异标记（由调用方在 extensions 注入 applyCompareLineMarkers）。
//   - layout='three' ：三栏。按 mode 区分（§0 / D3 / D6）：
//                      合并(merge)    ：左 a=本地(可编辑) / 中 b=合并结果(可编辑,无源) / 右 c=对方(可编辑)。
//                                      三栏全部可编辑（§6 已推翻本地只读）；B↔C 第二层差异装饰 + A↔B/B↔C 连线。
//                      对照三栏(compare)：a/b/c 为三个真实独立文件（b 在 MergeView 的 b 面板，c 为独立编辑器），
//                                      无合并结果栏；连线组 A-B / B-C / A-C 三组（见 createDecorationScheduler）。
//                      Theirs/第三文件 默认可编辑（opts.theirsReadonly===true 才锁定）。
//                      「接受此块」按钮用自定义 renderRevertControl（类名 cm-compare-revert，中文「⇄ 接受此块」），
//                      把 Yours 的当前块拷入 Result（revertControls: 'a-to-b'）；
//                      Theirs→Result 通过实例方法 acceptTheirsAt(pos?) 逐块拷贝（基于 Chunk.build 对齐）。
//
// 禁用类名闸门：
//   严禁使用方案列明的禁用类名；自定义按钮仅用 cm-compare-revert。
//
// 其余配置（契约超集字段，保持向后兼容旧 {oldContent,newContent,extensions,parent} 形态）：
//   opts.layout            'two' | 'three'（默认 'two'）
//   opts.a                 { name, content }  左侧 / Yours
//   opts.b                 { name, content }  右侧 / Theirs（三栏时作为 Theirs 参考，Result 单独生成）
//   opts.oldContent        兼容别名，等同 opts.a.content
//   opts.newContent        兼容别名，等同 opts.b.content
//   opts.extensions        CodeMirror 扩展数组（调用方注入 markdown() / applyCompareLineMarkers() 等）
//   opts.parent            挂载容器 HTMLElement
//   opts.collapseUnchanged 折叠未改配置（默认 { margin:3, minSize:6 }），T2 增量 E
//   opts.aReadonly         两栏模式下是否把 a 设为只读（默认 false）
//   opts.bReadonly         两栏模式下是否把 b 设为只读（默认 false）
//   opts.enableWordDiff    是否启用行内字词级差异（默认 true，仅 === false 时关闭）
//   opts.enableMoveDetect  是否启用块移动检测蓝色标识（默认 true，仅 === false 时关闭）

import { MergeView, getChunks, Chunk } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  inlineWordDiffExtension,
  setWordDiffEffect,
  buildWordDiffData,
} from "./compare/inline-word-diff.js";
import { detectMoves } from "./compare/move-detection.js";
import {
  moveDecorationsExtension,
  setMoveBlocks,
} from "./compare/move-decorations.js";
import { createConnectorPainter } from "./compare/move-connectors.js";
// 元素级差异（移植自 dandavison/delta）：N↔M 块的同源行配对 + 独属行清单。
// 仅用于「行数不等的修改块」—— 行数相等的块仍走既有 buildWordDiffData（按下标配对）。
import {
  inferEdits,
  buildExclusiveConnectorPairs,
  DEFAULT_MAX_LINE_DISTANCE,
} from "./compare/delta-align.js";
// 块级「采纳右侧」按钮复用统一的写入原语（单次 dispatch、区间校验），不自己拼 changes。
import { acceptChunk } from "./compare/chunk-ops.js";
// MergeView 内的 view.scrollDOM 不是滚动盒（可滚余量恒 0、且收不到 scroll 事件），
// 取滚动盒一律走 scrollBoxOf —— 理由见 compare/scroll-box.js 顶部说明。
import { scrollBoxOf } from "./compare/scroll-box.js";
// 共享滚动同步模块（编辑页 edit↔preview / 对照·合并多栏共用，§9 / D16）
import { createScrollSync } from "./scroll-sync.js";

/**
 * 安全读取差异块数组。
 *
 * 【务必经由本函数取 chunks，不要写 getChunks(state).chunks】
 * @codemirror/merge 的官方声明（dist/index.d.ts）明确：
 *   "Returns null if the editor doesn't have a merge extension active
 *    or the merge view hasn't finished initializing yet."
 * 即 getChunks 在【MergeView 尚未初始化完成】时返回 null —— 而这恰恰是构造完成瞬间、
 * 以及 rAF 轮询首帧所处的窗口。裸写 .chunks 会抛 TypeError；若该处又包在
 * catch 里静默吞掉，就会表现为「装饰永远不出现」这种极难定位的故障。
 *
 * @param {import('@codemirror/state').EditorState} state
 * @returns {readonly import('@codemirror/merge').Chunk[]} 永远是数组，未就绪时为空数组
 */
function safeChunks(state) {
  const res = getChunks(state);
  return res && res.chunks ? res.chunks : [];
}

/**
 * diff 计算参数。提为模块级常量，因为第三期的 B↔C 层需要在 refreshDecorations
 * （模块级函数）内用 Chunk.build 自算差异块，无法访问 createCompareMergeView 的局部作用域。
 */
// scanLimit：@codemirror/merge 的差异块细分上限。库内会先 scanLimit >> 1（默认 500 → 250），
// 当「去掉公共前后缀后的差异跨度」> 250*64 = 16000 字符时直接返回单个 Change，跳过精确 diff，
// 导致大文档（如 3000 行 / 50 处分散差异）的 50 处差异被并成 1 个巨块，
// 块级「接受此块」退化为全有全无（BND-05b 确证）。实测将 scanLimit 提到 2000 即可在
// 3000 行文档上恢复精确分块（50 块 / ~19ms），且仍远低于 timeout:1500 上限，合并结果逐字符不变。
// 故采用 2000 而非库默认 500。
const DIFF_CONFIG = { scanLimit: 2000, timeout: 1500 };

/**
 * 创建「按文档对象引用做脏检查」的热路径复用缓存（O1）。
 *
 * ── 背景 ──
 * 每次 runAll() 都要把整篇文档字符串化后按行切分（detectMoves 的入参），三栏一轮
 * 就是 4 次全文 toString()+split() 外加 1 次全文 Chunk.build；而用户输入时每 200ms
 * （debounce）就触发一轮。长文档下这是对照视图的主要开销，且绝大多数轮次里
 * 至少有一侧文档根本没变（例如只在中栏敲字，左右两栏纹丝不动）。
 *
 * ── 为什么可以按对象引用判脏 ──
 * CodeMirror 的 `Text`（即 state.doc）是**不可变**数据结构：任何一次文档修改都会
 * 产出一个全新的 Text 对象，绝不存在「同一个对象内容变了」的情形。因此
 * `prevDoc === nextDoc` 是充分且 O(1) 的「内容未变」判据。
 * 【不要改用长度或内容哈希】长度相等不代表内容相同（会误判成未变，装饰就此僵死）；
 * 内容哈希要遍历全文，开销与本来想省掉的 toString() 同量级，纯属负优化。
 *
 * ── 为什么用 WeakMap ──
 * 键就是 doc 对象本身：文档一旦被新版本取代且无人再引用，缓存项随之被 GC 回收，
 * 不会随编辑轮次无限增长。缓存实例挂在单个 scheduler（即单个对照视图实例）闭包上，
 * dispose 时整体丢弃，避免跨实例串味。
 *
 * ── 只读约定（务必遵守）──
 * getLines / getBuiltChunks 返回的是**共享**数组，调用方一律只读，
 * 不得 push / sort / splice / 元素赋值。后人若需要就地改，请自行浅拷贝。
 */
function createDocCache() {
  /** @type {WeakMap<object, string[]>} doc → 行数组 */
  let lineCache = new WeakMap();
  /** @type {WeakMap<object, WeakMap<object, readonly any[]>>} aDoc →（bDoc → chunks） */
  let chunkCache = new WeakMap();
  return {
    /**
     * 取文档的按行数组（共享，只读）。
     * @param {import('@codemirror/state').Text} doc
     * @returns {string[]}
     */
    getLines(doc) {
      let arr = lineCache.get(doc);
      if (!arr) {
        arr = doc.toString().split("\n");
        lineCache.set(doc, arr);
      }
      return arr;
    },
    /**
     * 取自算差异块（共享，只读）。缓存键是 aDoc 与 bDoc **两个引用都未变**，
     * 任一侧换了新 Text 对象即重算。两级 WeakMap 使得多个自算层互不挤占。
     * @param {import('@codemirror/state').Text} aDoc
     * @param {import('@codemirror/state').Text} bDoc
     */
    getBuiltChunks(aDoc, bDoc) {
      let inner = chunkCache.get(aDoc);
      if (!inner) chunkCache.set(aDoc, (inner = new WeakMap()));
      let res = inner.get(bDoc);
      if (!res) {
        res = Chunk.build(aDoc, bDoc, DIFF_CONFIG);
        inner.set(bDoc, res);
      }
      return res;
    },
    /** 实例销毁时整体丢弃 */
    clear() {
      lineCache = new WeakMap();
      chunkCache = new WeakMap();
    },
  };
}

/**
 * 计算 collapseUnchanged 重配置参数。
 * 修复 A6：当两文件完全相同（无任何差异块）时，不折叠——否则整篇文档会被折叠成单个占位，
 * 导致内容不可见（误判为「渲染为空」）。
 * @param {boolean} collapsed
 * @param {{margin?:number,minSize?:number}} collapseConf
 * @param {import('@codemirror/view').EditorView} viewA
 * @returns {undefined|{margin?:number,minSize?:number}}
 */
function resolveCollapse(collapsed, collapseConf, viewA) {
  if (collapsed) {
    if (!safeChunks(viewA.state).length) return undefined; // 无差异 / 未就绪：不折叠
  }
  return collapsed ? collapseConf : undefined;
}

/**
 * 依据当前 diff chunks 重算并推送「行内字词级差异」与「块移动」装饰。
 *
 * 只 dispatch StateEffect，【绝不产生文档变更】——这是不触发 updateListener 递归的关键前提
 * （见 createDecorationScheduler 的注释）。后人若在此加入 changes，会立刻造成死循环。
 *
 * ── 第三期 sides 参数的存在理由（勿删）──
 * 三栏下中栏 Result 同时是 A↔B 层的 b 和 B↔C 层的 a。若两层都向它 dispatch 装饰，
 * 后写的一层会整体覆盖先写的一层（setWordDiffEffect / setMoveBlocks 都是全量替换语义），
 * 表现为「中栏装饰随机闪烁 / 只剩一层」。故由 sides 显式声明每层各自向哪个视图写：
 *   A↔B 层：{ aSide:'a', bSide:'b', writeA:true,  writeB:true  }
 *   B↔C 层：{ aSide:null, bSide:'b', writeA:false, writeB:true }
 * 即中栏的装饰只反映「与左栏 Yours 的差异」，右栏 Theirs 的装饰反映「与中栏 Result 的差异」。
 *
 * @param {EditorView|null} viewA A 面板（Yours / Result）
 * @param {EditorView|null} viewB B 面板（Result / Theirs）
 * @param {{wordDiff:boolean, moveDetect:boolean, wordMode?:'off'|'word'|'char'}} flags
 *        wordMode 由工具栏「行内高亮」下拉实时切换（见 instance.setWordDiffMode）：
 *        'off' 时依旧走 dispatch，但推空数组 —— 必须推，否则上一次的高亮会僵在屏幕上。
 * @param {{aSide?:'a'|'b'|null,bSide?:'a'|'b'|null,writeA?:boolean,writeB?:boolean,computeChunks?:boolean}} [sides]
 * @param {ReturnType<typeof createDocCache>} cache 实例级脏检查缓存（O1，由调度器持有）
 * @returns {{pairs:import('./compare/move-detection.js').MovePair[], chunks:readonly any[], truncated:boolean}}
 */
function refreshDecorations(viewA, viewB, flags, sides, cache) {
  const wordDiff = flags.wordDiff;
  const moveDetect = flags.moveDetect;
  const wordMode =
    flags.wordMode === "off" || flags.wordMode === "char" ? flags.wordMode : "word";
  const EMPTY = { pairs: [], chunks: [], truncated: false, diffPairs: [] };
  if (!viewA || !viewB || !viewA.dom || !viewB.dom) return EMPTY;
  const opt = sides || {};
  const writeA = opt.writeA !== false;
  const writeB = opt.writeB !== false;
  try {
    const aDoc = viewA.state.doc;
    const bDoc = viewB.state.doc;
    // computeChunks：B↔C 层的两个视图分属不同 MergeView / 独立 EditorView，
    // getChunks(viewA.state) 拿到的是 MergeView 自己的 A↔B 结果，与本层无关，必须自算。
    // 自算走 cache.getBuiltChunks（O1）：Chunk.build 是 (aDoc,bDoc,DIFF_CONFIG) 的纯函数，
    // 两侧 doc 引用都没变时结果必然相同，直接复用。非自算层的 chunks 由
    // @codemirror/merge 的 StateField 自己缓存，无需本层再管。
    const chunks = opt.computeChunks
      ? cache.getBuiltChunks(aDoc, bDoc)
      : safeChunks(viewA.state);

    // 独属内容连线对（左侧独有 / 右侧独有）：由下方 wordDiff 分支按块累积，
    // 供 buildConnectorLayers 构造 'diff' 层绘制「独属内容 → 对侧插入点」同色楔形连线。
    // 仅在 wordDiff 开启时才有意义；未开启时恒为空数组，不画 diff 层。
    const exclusivePairs = [];

    if (wordDiff) {
      const aData = [];
      const bData = [];
      // wordMode==='off'：跳过计算，下面照常 dispatch 空数组以清掉存量高亮。
      for (const c of wordMode === "off" ? [] : chunks) {
        // 只处理「两侧都有内容」的 modified 块；纯增 / 纯删交给移动检测与整块高亮。
        if (!(c.toA > c.fromA) || !(c.toB > c.fromB)) continue;
        const aLines = aDoc.sliceString(c.fromA, c.toA).split("\n");
        const bLines = bDoc.sliceString(c.fromB, c.toB).split("\n");
        const aStart = aDoc.lineAt(c.fromA).number;
        const bStart = bDoc.lineAt(c.fromB).number;
        // 行数不等（N↔M 块）：改用 delta 移植的 inferEdits 做内容相似度配对，
        // 既能对任意行数给出元素级高亮，又顺带产出「独属行」清单。
        // 旧的 `if (aLines.length !== bLines.length) continue;` 会直接放弃这类块的行内高亮，
        // 退化成大片纯色（见 delta-align.js 文件头的问题描述）。
        // char 模式下 diff 包按字符细分，且没有同源配对概念，沿用旧行为跳过 N↔M。
        if (aLines.length !== bLines.length) {
          if (wordMode === "char") continue;
          const ie = inferEdits(aLines, bLines, {
            maxLineDistance: DEFAULT_MAX_LINE_DISTANCE,
          });
          // 同源行对 → 行内字词高亮（左侧用 minusRanges、右侧用 plusRanges）。
          for (const pair of ie.pairs) {
            if (pair.minusRanges.length) {
              aData.push({
                lineNumber: aStart + pair.minusIndex,
                ranges: pair.minusRanges,
              });
            }
            if (pair.plusRanges.length) {
              bData.push({
                lineNumber: bStart + pair.plusIndex,
                ranges: pair.plusRanges,
              });
            }
          }
          // 独属行 → 连接带对（左侧独有 / 右侧独有）：尖端指向对侧块尾的插入点。
          // 用同一份 ie 结果，避免浏览器主线程每 200ms 重算时重复做同源配对。
          exclusivePairs.push(
            ...buildExclusiveConnectorPairs(aLines, bLines, aStart, bStart, ie)
          );
          continue;
        }
        aData.push(...buildWordDiffData(aLines, bLines, "before", aStart, wordMode));
        bData.push(...buildWordDiffData(aLines, bLines, "after", bStart, wordMode));
      }
      if (writeA) viewA.dispatch({ effects: setWordDiffEffect.of(aData) });
      if (writeB) viewB.dispatch({ effects: setWordDiffEffect.of(bData) });
    }

    if (moveDetect) {
      // O1：行数组按 doc 引用复用（detectMoves 全程只读入参，已核实无就地修改）。
      // 三栏下中栏 Result 的 doc 同时是 A↔B 层的 bDoc 与 B↔C 层的 aDoc，
      // 命中同一缓存项，一轮里只切分一次。
      const { pairs, truncated } = detectMoves(
        cache.getLines(aDoc),
        cache.getLines(bDoc),
        chunks
      );
      // src 行号属 A 文档、dst 行号属 B 文档，坐标系独立：a 视图只画 src，b 视图只画 dst。
      // sides.aSide/bSide 允许每层指定各自画 src 还是 dst（三栏 B↔C 层：中栏 Result 不画、
      // 右栏 Theirs 画 dst），避免同一视图被两层同时写入 moveBlockField 而互相覆盖。
      if (writeA && opt.aSide) setMoveBlocks(viewA, pairs, opt.aSide);
      if (writeB && opt.bSide) setMoveBlocks(viewB, pairs, opt.bSide);
      return {
        pairs,
        chunks,
        truncated: !!truncated,
        diffPairs: exclusivePairs,
      };
    }
    return { pairs: [], chunks, truncated: false, diffPairs: exclusivePairs };
  } catch (err) {
    console.error("[compare-merge] 刷新差异装饰失败:", err);
    return EMPTY;
  }
}

/**
 * 创建「差异装饰刷新调度器」（支持多对视图：两栏单对 / 三栏两对）。
 *
 * 为什么要工厂 + attach 两段式：updateListener 必须在 MergeView 构造【之前】就作为扩展注入，
 * 而 viewA / viewB 要构造完才存在。故先建调度器（持可变视图引用数组），构造完再 attach 回填。
 *
 * 为什么要 rAF 轮询：MergeView 的 diff 计算是异步落定的，构造完成的瞬间 getChunks() 往往
 * 仍是空数组，此时算装饰等于清空。照抄 setCollapse 已有的轮询模式，等 chunks 就绪后重算一次；
 * 帧数上限避免「两文件完全相同、chunks 恒为 0」时无限轮询。
 *
 * @param {{wordDiff:boolean, moveDetect:boolean}} flags
 */
function createDecorationScheduler(flags) {
  /**
   * 视图对数组。两栏：[ {a, b, layer:'ab'} ]；
   * 合并三栏：[ {a,b,layer:'ab'}, {b,c,layer:'bc'} ]（结果作为中间栏）；
   * 对照三栏：[ {a,b,layer:'ab'}, {b,c,layer:'bc'}, {a,c,layer:'ac'} ]（a/b/c 三个真实独立文件）。
   * moveSides.aSide/bSide 为 null 表示该侧不画移动块蓝底（避免中栏被两层互相覆盖）。
   * @type {Array<{a:EditorView,b:EditorView,layer?:string,moveSides?:{aSide?:'a'|'b',bSide?:'a'|'b'},pairs?:any[]}>}
   */
  let viewPairs = [];
  let rafId = 0;
  let debounceTimer = 0;
  let disposed = false;
  /** 实例级热路径缓存（O1）：行数组 / 自算 chunks 的引用脏检查复用 */
  const docCache = createDocCache();
  /** 每次重算后回调（供连线绘制器重绘） */
  const listeners = new Set();

  function runAll() {
    for (const vp of viewPairs) {
      const r = refreshDecorations(vp.a, vp.b, flags, vp.sides, docCache);
      vp.pairs = r.pairs;
      vp.chunks = r.chunks;
      vp.truncated = r.truncated;
      vp.diffPairs = r.diffPairs;
    }
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error("[compare-merge] 装饰刷新回调失败:", err);
      }
    }
  }

  function scheduleRefresh() {
    if (disposed) return;
    runAll();
    if (typeof requestAnimationFrame !== "function") return;
    if (rafId) cancelAnimationFrame(rafId);
    let frames = 0;
    const MAX = 120; // ~2s 上限，避免「两文件相同 chunks 恒为 0」时无限轮询
    // B5：「视图已销毁」的判据。旧写法 `vp.a.dom === null` 恒为假 ——
    // EditorView.destroy() 只是把 dom 从父节点摘掉并停掉插件，从不把 view.dom 置空，
    // 于是守卫形同虚设，销毁后轮询仍会空转满 MAX 帧（约 2s）反复读已销毁视图的 state。
    // 改判「曾经挂进过 document、现在全部断连」：单看 isConnected 会误伤
    // 「构造完成但尚未 append 到 document」的首帧窗口，加上 wasConnected 门闩即可区分。
    // 环境不提供 Node.isConnected 时 wasConnected 恒为 false，退化为旧的帧数上限兜底。
    let wasConnected = false;
    const tick = () => {
      try {
        if (disposed || !viewPairs.length) return;
        const anyConnected = viewPairs.some(
          (vp) => !!(vp.a && vp.a.dom && vp.a.dom.isConnected)
        );
        if (anyConnected) wasConnected = true;
        else if (wasConnected) return; // 曾在文档中、现已全部断连 → 视图已销毁
        // 必须走 safeChunks：本轮询要等的正是「MergeView 尚未初始化完成」的窗口，
        // 而 getChunks 在该窗口返回 null。裸写 .chunks 会在首帧抛错并被下方 catch
        // 吞掉，导致轮询永久终止、装饰永远停在空状态。
        // 只以「依赖 MergeView 的层」(computeChunks 为假) 作为就绪判据：B↔C 层用
        // Chunk.build 自算，任何时刻都有结果，把它纳入判据会让「中右两栏相同」的
        // 常见场景永远等不到就绪。
        const gated = viewPairs.filter((vp) => !(vp.sides && vp.sides.computeChunks));
        const ready = gated.length
          ? gated.every((vp) => safeChunks(vp.a.state).length > 0)
          : true;
        if (ready) {
          runAll();
          return;
        }
        if (++frames < MAX) rafId = requestAnimationFrame(tick);
      } catch (_) {
        /* 视图已销毁（访问 vp.a.state 抛错）：终止轮询，不再续帧 */
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  // 文档变更后 debounce 重算。
  // 【不会递归】：refreshDecorations 内部只 dispatch effects、不改文档，因此它引发的
  // ViewUpdate 的 docChanged 恒为 false，不会再次进入本分支。改动 refreshDecorations 时
  // 务必保持「只发 effects、不发 changes」这一约束，否则此处将变成无限循环。
  const listener = EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scheduleRefresh, 200);
  });

  return {
    /** 供面板 extensions 注入的 updateListener 扩展 */
    listener,
    /** 构造完 MergeView 后回填视图对（两栏单对 / 三栏两对） */
    attach(pairs) {
      viewPairs = pairs || [];
    },
    /** 暴露当前各层移动块 pairs / chunks，供连线 / Location Pane 读取 */
    getPairs() {
      return viewPairs;
    },
    /** 注册「装饰重算完成」回调，返回解绑函数 */
    onRefresh(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    scheduleRefresh,
    /** 销毁：停掉 rAF 轮询与 debounce 定时器，防止视图销毁后回调越界 */
    dispose() {
      disposed = true;
      listeners.clear();
      if (rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
      rafId = 0;
      clearTimeout(debounceTimer);
      debounceTimer = 0;
      docCache.clear(); // O1：丢弃行数组 / chunks 缓存，不跨实例串味
    },
  };
}

/**
 * @typedef {Object} CompareFile
 * @property {string} name
 * @property {string} content
 */

/**
 * @typedef {Object} CompareMergeOptions
 * @property {'compare'|'merge'} [mode]  模式（默认 'compare'）；merge 固定三栏，compare 两/三栏
 * @property {'two'|'three'} [layout]
 * @property {CompareFile} [a]  左栏 / 本地（含 name/content/target）
 * @property {CompareFile} [b]  右栏 / 合并结果（merge 时作结果或对方，取决于是否有 opts.c）
 * @property {CompareFile} [c]  对照三栏的第三个真实文件（仅 compare && layout==='three' 时使用）
 * @property {string} [oldContent]  兼容别名（= a.content）
 * @property {string} [newContent]  兼容别名（= b.content）
 * @property {any[]} [extensions]
 * @property {HTMLElement} parent
 * @property {{margin?:number,minSize?:number}} [collapseUnchanged]
 * @property {boolean} [aReadonly]
 * @property {boolean} [bReadonly]
 * @property {boolean} [enableWordDiff]   行内字词级差异（默认 true）
 * @property {boolean} [enableMoveDetect] 块移动检测蓝色标识（默认 true）
 * @property {'off'|'word'|'char'} [wordDiffMode] 行内高亮初始粒度（默认 'word'）
 */

/**
 * 两个偏移区间是否相交。
 *
 * 【为什么不能只写 f1 < t2 && f2 < t1】diff 块里大量存在**空区间**（纯新增时
 * 目标侧 from===to、纯删除时源侧 from===to）。标准的严格相交判定对空区间恒为 false，
 * 于是「Theirs 在 Result 的某处纯插入」这类块永远不会被判成冲突，双侧按钮就不出现。
 * 故空区间退化为「点落在闭区间内」判定。
 *
 * @param {number} f1 @param {number} t1 @param {number} f2 @param {number} t2
 * @returns {boolean}
 */
function rangesOverlap(f1, t1, f2, t2) {
  if (f1 === t1 || f2 === t2) return f1 <= t2 && f2 <= t1;
  return f1 < t2 && f2 < t1;
}

/**
 * 自定义 renderRevertControl 工厂：生成块级操作按钮组。
 *
 * ── 与 @codemirror/merge 的协作方式（改这里前务必读完）──
 * 库的 renderRevertButton(top, i) 拿到本函数返回的元素后，会给它打上 data-chunk=i
 * 并塞进 .cm-merge-revert 列；该列上挂了一个 **mousedown** 监听（revertClicked），
 * 它从 e.target 一路上溯到「revertDOM 的直接子节点」，据其 data-chunk 执行
 * revertControls 指定方向（本项目恒为 a→b）的整块覆写。
 * 因此：
 *   · 「接受此块 / ACCEPT LEFT」= 让事件正常冒泡给库，一行自定义代码都不用写；
 *   · 「ACCEPT RIGHT」= 必须在 mousedown 阶段 stopPropagation 掐断冒泡，
 *      否则库会先把 a→b 写一遍，我们再写一遍右侧，产生双重写入。
 * 【勿改成 click 上拦截】库监听的是 mousedown，click 时早已写完。
 *
 * 返回的是 div 而非 button：库的外部主题有 `.cm-merge-revert button{position:absolute}`，
 * 若直接返回 button，两个并列按钮会绝对定位叠在一起。改由外层 div 承担绝对定位
 * （compare.css 中 #compareRoot 提权覆盖），内部 button 复位为 static。
 *
 * @param {(chunkIndex:number)=>void} onAcceptRight 采纳右侧时的回调，入参为 data-chunk
 * @returns {HTMLDivElement}
 */
function makeRevertGroup(onAcceptRight) {
  const box = document.createElement("div");
  box.className = "cm-compare-revert-group";

  const mk = (cls, label, title) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    return btn;
  };

  // 非冲突块：单按钮（沿用既有语义与类名 cm-compare-revert）
  box.appendChild(
    mk("cm-compare-revert cm-compare-revert-single", "⇄ 采纳此块", "采纳此块（将左侧内容并入结果）")
  );
  // 冲突块 / 两栏：双向按钮
  // 箭头语义 = 内容流向：左栏内容向右写入结果（采纳左 ▶），右栏内容向左写入结果（◀ 采纳右）。
  box.appendChild(
    mk("cm-compare-revert cm-compare-accept-left", "采纳左 ▶", "采纳左侧：用左栏内容覆写本块")
  );
  const right = mk(
    "cm-compare-revert cm-compare-accept-right",
    "◀ 采纳右",
    "采纳右侧：用右栏内容覆写本块"
  );
  // 掐断冒泡，阻止库的默认 a→b 覆写（理由见上方大段说明）
  right.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  right.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const idx = Number(box.dataset.chunk);
    if (Number.isFinite(idx)) onAcceptRight(idx);
  });
  box.appendChild(right);
  return box;
}

/**
 * 让 .cm-merge-revert 列里的按钮组随「块是否冲突」切换单 / 双按钮形态。
 *
 * 库在每次 measure（滚动 / 视口变化 / 文档变化）时会增删按钮元素，且**复用**
 * data-chunk 未变的旧元素；块内容却可能已经变了。因此形态不能在 makeRevertGroup
 * 里一次性定死，必须有一个「事后校正」通道：
 *   1) MutationObserver 捕获库对该列的增删（覆盖滚动/视口变化）；
 *   2) 调度器的 onRefresh 覆盖文档变化后的重算。
 *
 * @param {HTMLElement} parent 视图容器（.cm-merge-revert 必在其子树内）
 * @param {() => Set<number>} getDualIndexes 返回「应显示双按钮」的 chunk 下标集合
 * @returns {{sync:()=>void, dispose:()=>void}}
 */
function createRevertGroupSync(parent, getDualIndexes) {
  let observer = null;
  let host = null;

  function sync() {
    if (!host || !host.isConnected) host = parent.querySelector(".cm-merge-revert");
    if (!host) return;
    let dual;
    try {
      dual = getDualIndexes();
    } catch (err) {
      console.error("[compare-merge] 计算冲突块下标失败:", err);
      return;
    }
    for (const el of Array.from(host.children)) {
      if (!el.classList || !el.classList.contains("cm-compare-revert-group")) continue;
      el.classList.toggle("is-dual", dual.has(Number(el.dataset.chunk)));
    }
  }

  if (typeof MutationObserver === "function") {
    host = parent.querySelector(".cm-merge-revert");
    if (host) {
      observer = new MutationObserver(() => sync());
      observer.observe(host, { childList: true });
    }
  }

  return {
    sync,
    dispose() {
      if (observer) observer.disconnect();
      observer = null;
      host = null;
    },
  };
}

/**
 * B↔C 栏间逐块操作按钮组工厂（独立于 MergeView 的 a↔b revert 列）。
 *
 * a↔b 的 makeRevertGroup 依赖库内 `.cm-merge-revert` 的 mousedown 监听执行默认 a→b；
 * B↔C 两栏是 mv.b 与独立 theirsView，没有库的 revert 列，故【三个按钮全部自接线】：
 *   · 单按钮（非冲突）= 采纳左（b→c，默认左→右流向）
 *   · 采纳左 ▶（冲突）= b→c
 *   · ◀ 采纳右（冲突）= c→b
 * 方向语义与 a↔b 列的「采纳左 ▶ / ◀ 采纳右」一致（箭头指向内容流向）。
 *
 * @param {(i:number, dir:'left'|'right')=>void} onAccept
 * @returns {HTMLDivElement}
 */
function makeBcRevertGroup(onAccept) {
  const box = document.createElement("div");
  box.className = "cm-compare-revert-group";
  box.style.display = "none"; // 初始隐藏，待 reposition 命中块位置后再显

  const mk = (cls, label, title) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    return btn;
  };

  const wire = (btn, dir) => {
    // 掐断冒泡，避免被任何祖先的默认 revert 行为误触发（B↔C 无库监听，但保持与 a↔b 同款防御）
    btn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const i = Number(box.dataset.chunk);
      if (Number.isFinite(i)) onAccept(i, dir);
    });
  };

  const single = mk(
    "cm-compare-revert cm-compare-revert-single",
    "⇄ 采纳此块",
    "采纳此块：用中间栏内容覆写右栏"
  );
  const left = mk(
    "cm-compare-revert cm-compare-accept-left",
    "采纳左 ▶",
    "采纳左：用中间栏(b)内容覆写右栏(c)"
  );
  const right = mk(
    "cm-compare-revert cm-compare-accept-right",
    "◀ 采纳右",
    "采纳右：用右栏(c)内容覆写中间栏(b)"
  );
  wire(single, "left");
  wire(left, "left");
  wire(right, "right");
  box.appendChild(single);
  box.appendChild(left);
  box.appendChild(right);
  return box;
}

/**
 * 在中间栏(b)与右栏(c)之间挂载「逐块采纳」列，复用 a↔b 列的视觉与方向语义，
 * 但完全自建（无 MergeView revert 列支撑）：每个 B↔C 差异块渲染一组单/双按钮，
 * 垂直对齐到该块在 Result(b) 侧的起始行；随滚动与 diff 重算重定位。
 *
 * 坐标约定复用 move-connectors.js：view.coordsAtPos(pos) 返回【视口坐标】，
 * 跨栏定位需减去容器 getBoundingClientRect().top 并补偿 clientTop。
 *
 * @param {{parent:HTMLElement, mv:object, theirsView:EditorView, scheduler:object|null, getChunkModel:()=>({ab:any[],bc:any[]}), acceptBcChunkAt:(i:number,dir:string)=>boolean}} ctx
 * @returns {{dispose:()=>void}}
 */
function mountBcRevertColumn(ctx) {
  const { parent, mv, theirsView, scheduler, getChunkModel, acceptBcChunkAt } = ctx;
  const col = document.createElement("div");
  col.className = "cm-compare-revert-bc";
  // 夹在 MergeView(a+b) 与 theirsView(c) 之间（viewThree 为 row flex，故视觉上紧邻二者）。
  // 注意：insertBefore 的 ref 节点必须是真实 DOM 节点（theirsView.dom），而非 EditorView 实例本身。
  parent.insertBefore(col, theirsView.dom);

  /** @type {Array<{el:HTMLElement, index:number}>} */
  let groups = [];
  let lastSig = "";
  const ac = typeof AbortController === "function" ? new AbortController() : null;

  function getBc() {
    try {
      return getChunkModel().bc || [];
    } catch (err) {
      console.error("[compare-merge] 读取 B↔C 块模型失败:", err);
      return [];
    }
  }

  // 仅在块数量 / 冲突标记变化时才重建按钮组；否则仅重定位（避免每帧 coordsAtPos 强制回流）。
  function rebuild() {
    const bc = getBc();
    const sig = bc.map((c) => `${c.index}:${c.conflict ? 1 : 0}`).join("|");
    if (sig === lastSig) {
      reposition();
      return;
    }
    lastSig = sig;
    col.textContent = "";
    groups = [];
    bc.forEach((chunk) => {
      const box = makeBcRevertGroup((i, dir) => acceptBcChunkAt(i, dir));
      box.dataset.chunk = String(chunk.index);
      box.classList.toggle("is-dual", !!chunk.conflict);
      col.appendChild(box);
      groups.push({ el: box, index: chunk.index });
    });
    reposition();
  }

  // 把每个按钮组绝对定位到其块在 Result(b) 侧的起始行；屏外块（coordsAtPos 返回 null）隐藏。
  function reposition() {
    const bc = getBc();
    const colRect = col.getBoundingClientRect();
    const top0 = colRect.top + (col.clientTop || 0);
    for (const g of groups) {
      const chunk = bc[g.index];
      if (!chunk) {
        g.el.style.display = "none";
        continue;
      }
      let coords = null;
      try {
        coords = mv.b.coordsAtPos(chunk.dstFrom);
      } catch (_) {
        coords = null;
      }
      if (!coords) {
        g.el.style.display = "none";
        continue;
      }
      g.el.style.display = "flex";
      g.el.style.top = coords.top - top0 + "px";
    }
  }

  let unsubRefresh = null;
  if (scheduler) {
    unsubRefresh = scheduler.onRefresh(() => rebuild());
  } else {
    rebuild();
  }
  // 滚动重定位：MergeView 滚动盒（mv.b 共享）与 theirsView 各自派发 scroll（已由滚动同步联动）。
  for (const v of [mv.b, theirsView]) {
    const box = scrollBoxOf(v);
    if (box) {
      const opts = { passive: true };
      if (ac) opts.signal = ac.signal;
      box.addEventListener("scroll", () => reposition(), opts);
    }
  }
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => reposition());
    ro.observe(parent);
    if (ac) ac.signal.addEventListener("abort", () => ro.disconnect());
    else ro.disconnect.bind(ro);
  }

  return {
    dispose() {
      if (ac) ac.abort();
      if (unsubRefresh) unsubRefresh(); // 解绑装饰重算回调，消除对 destroy() 顺序的隐式依赖
      if (col.parentNode) col.parentNode.removeChild(col);
    },
  };
}

/**
 * 纯函数：根据 B↔C 块模型 + 采纳方向 + 两侧文档长度，算出 acceptChunk 所需的
 * 「源侧 / 源区间 / 目标区间」五元组。
 *
 * 方向语义（与 acceptBcChunkAt 一致）：
 *   dir 'right'（◀ 采纳右）= c→b（Theirs→Result）：src 取自块 Theirs 侧(src*)，dst 取到 Result 侧(dst*)
 *   dir 'left' （采纳左 ▶）= b→c（Result→Theirs）：src 取自块 Result 侧(dst*)，dst 取到 Theirs 侧(src*)
 *
 * 越界钳制：对齐 acceptRightAt / chunk-ops.acceptChunk，用 Math.min(off, len) 防止
 * 尾部块 to 越界抛 RangeError（Result/Theirs 尾部块的 fromA/toA 或 fromB/toB 可能等于
 * 「文档长度 + 1」含行尾换行，直接喂给 dispatch 会抛 RangeError）。
 *
 * 抽成纯函数是为了让「双向采纳 + 越界钳制」这段算术可被 node 单测直接锁定
 * （acceptBcChunkAt 闭包依赖真实 EditorView 与 acceptChunk，不便直接单测）。
 *
 * @param {{srcFrom:number,srcTo:number,dstFrom:number,dstTo:number}} chunk B↔C 块模型（已归一）
 * @param {'left'|'right'} dir
 * @param {number} bLen Result(mv.b) 文档长度
 * @param {number} cLen Theirs(theirsView) 文档长度
 * @returns {{srcSide:'b'|'c', srcFrom:number, srcTo:number, dstFrom:number, dstTo:number}}
 */
export function computeBcAcceptRange(chunk, dir, bLen, cLen) {
  const clamp = Math.min;
  if (dir === "right") {
    return {
      srcSide: "c",
      srcFrom: clamp(chunk.srcFrom, cLen),
      srcTo: clamp(chunk.srcTo, cLen),
      dstFrom: clamp(chunk.dstFrom, bLen),
      dstTo: clamp(chunk.dstTo, bLen),
    };
  }
  return {
    srcSide: "b",
    srcFrom: clamp(chunk.dstFrom, bLen),
    srcTo: clamp(chunk.dstTo, bLen),
    dstFrom: clamp(chunk.srcFrom, cLen),
    dstTo: clamp(chunk.srcTo, cLen),
  };
}

/**
 * 创建两栏 / 三栏对比合并视图。
 * @param {CompareMergeOptions} opts
 * @returns {CompareMergeInstance}
 */
export function createCompareMergeView(opts) {
  const mode = opts.mode || "compare";
  const layout = opts.layout || "two";
  const aFile = opts.a || { name: "Yours", content: opts.oldContent || "" };
  const bFile = opts.b || { name: "Theirs", content: opts.newContent || "" };
  const cFile = opts.c || null;
  // 块对齐未对齐回调：由调用方（compare.js）传入，用于弹窗询问对齐策略（§9.2）。
  // 缺省静默忽略。修复 H1：统一由调用方注入，避免三栏下静默吞掉对齐提示。
  const onMisalign = typeof opts.onMisalign === "function" ? opts.onMisalign : () => {};
  const baseExtensions = Array.isArray(opts.extensions) ? opts.extensions : [];
  // 栏目标描述符（供 getPanes 暴露给保存轮询）：merge 的 b=合并结果无源（target=null）。
  const aTarget = (opts.a && opts.a.target) || null;
  const bTarget = (opts.b && opts.b.target) || null;
  const cTarget = (opts.c && opts.c.target) || null;
  /** 视图引用（供 getPanes / 滚动同步闭包捕获；各分支构造完回填） */
  let aView = null,
    bView = null,
    cView = null;
  /** 滚动同步开关与控制器（共用 scroll-sync.js，§9 / D16） */
  let scrollSync = null;
  let scrollSyncEnabled = true;
  let bcColCtl = null; // B↔C 栏间逐块采纳列控制器（三栏专属，destroy 时释放）
  /** 三栏下 b 是否为「合并结果」派生栏（无源 → getPanes 的 target=null）；compare 三栏为真实文件 */
  let bIsDerivedResult = false;
  const collapse =
    opts.collapseUnchanged === undefined
      ? { margin: 3, minSize: 6 }
      : opts.collapseUnchanged;
  const diffConfig = DIFF_CONFIG;

  /** @type {HTMLElement} */
  const parent = opts.parent;

  // ── 行内字词差异 / 块移动检测：默认开启，仅显式传 false 才关闭 ──
  // wordMode 可变（工具栏「行内高亮」下拉）：调度器闭包持有的就是这个对象引用，
  // 原地改字段即可让下一轮 refreshDecorations 读到新值，无需重建实例。
  const flags = {
    wordDiff: opts.enableWordDiff !== false,
    moveDetect: opts.enableMoveDetect !== false,
    wordMode: opts.wordDiffMode === "off" || opts.wordDiffMode === "char"
      ? opts.wordDiffMode
      : "word",
  };
  const decoEnabled = flags.wordDiff || flags.moveDetect;
  const scheduler = decoEnabled ? createDecorationScheduler(flags) : null;

  // 面板专属装饰扩展：move-decorations 的 side 必须按面板区分（a 只画 src，b 只画 dst），
  // 所以不能由调用方通过 opts.extensions 统一注入（那是 a/b 共用的同一份数组）。
  // decoExtC 为三栏右栏 Theirs 专用：它在 B↔C 层中充当 b 侧，故 move 装饰取 side:'b'（画 dst）。
  const decoExtA = [];
  const decoExtB = [];
  const decoExtC = [];
  if (flags.wordDiff) {
    decoExtA.push(...inlineWordDiffExtension());
    decoExtB.push(...inlineWordDiffExtension());
    decoExtC.push(...inlineWordDiffExtension());
  }
  if (flags.moveDetect) {
    decoExtA.push(...moveDecorationsExtension({ side: "a" }));
    decoExtB.push(...moveDecorationsExtension({ side: "b" }));
    decoExtC.push(...moveDecorationsExtension({ side: "b" }));
  }
  if (scheduler) {
    decoExtA.push(scheduler.listener);
    decoExtB.push(scheduler.listener);
    decoExtC.push(scheduler.listener);
  }

  // ── 第三期基础设施：移动块连线绘制器 + 三栏滚动同步 ──
  // 连线数据来自 scheduler 各层 pairs；由 move-connectors.js 负责 SVG 渲染
  // （含折叠占位降级、truncated 只高亮不连线）。
  let connectorPainter = null;
  /**
   * 容器尺寸观察器（R8）。必须由 teardownConnectors() **无条件**断开：
   * 旧写法把 disconnect 挂在 connectorAC.signal 的 abort 事件上，而 connectorAC 在
   * 环境不支持 AbortController 时为 null（老运行时 / 测试桩件），此时观察器既进不了
   * teardown 的视野也没有 abort 钩子，随实例销毁而泄漏，并持续对已销毁的 painter 空转。
   * 两栏 / 三栏两条装配路径互斥（三栏分支内 return），共用这一个闭包变量即可。
   */
  let resizeObserver = null;
  const connectorAC =
    typeof AbortController === "function" ? new AbortController() : null;
  const acOpts = connectorAC
    ? { signal: connectorAC.signal, passive: true }
    : { passive: true };
  /**
   * 把调度器内部的视图对映射为连线绘制器可消费的图层描述。
   * fromLineKey/toLineKey 指明 MovePair 上取哪个 1-based 行号做锚点。
   * @returns {Array<{layer:string,fromView:EditorView,toView:EditorView,pairs:any[],fromLineKey:string,toLineKey:string,truncated:boolean,chunks:any[]}>}
   */
  function buildConnectorLayers() {
    if (!scheduler) return [];
    const out = [];
    for (const vp of scheduler.getPairs()) {
      out.push({
        layer: vp.layer || "ab",
        fromView: vp.a,
        toView: vp.b,
        pairs: vp.pairs || [],
        chunks: vp.chunks || [],
        fromLineKey: "srcStartLine",
        toLineKey: "dstStartLine",
        truncated: !!vp.truncated,
      });
      // 独属内容层：把「左侧独有 / 右侧独有」画成 C↔对侧插入点的同色楔形连线。
      // 与移动块层共用同一 SVG 覆盖层与坐标算法（见 move-connectors.js 顶部说明）。
      // 端点形态靠 pair 上的 srcCaret / dstCaret 声明，配色靠 variant（added/removed）。
      if (vp.diffPairs && vp.diffPairs.length) {
        out.push({
          layer: "diff",
          fromView: vp.a,
          toView: vp.b,
          pairs: vp.diffPairs,
          fromLineKey: "srcStartLine",
          toLineKey: "dstStartLine",
          truncated: false,
        });
      }
    }
    return out;
  }
  // 【已知取舍】无 AbortController 的环境下，本函数与 createScrollSync 注册的 scroll
  // 监听不会被显式解绑（createScrollSync.destroy 依赖 connectorAC 解绑；无 AC 时退化为 GC）。
  // 这些监听挂在随视图一起从 DOM 摘除的滚动盒（.cm-mergeView / 独立编辑器的 .cm-scroller）上，
  // 视图销毁后整棵子树不可达、可被 GC 连同监听一并回收，且不再产生 scroll 事件，故危害有限。
  // ResizeObserver 情况不同（观察器由浏览器强引用、会持续回调），见 R8。
  // 【必须绑在滚动盒上】scroll 事件不冒泡：MergeView 里派发 scroll 的是 .cm-mergeView，
  // 栏内 scrollDOM 永远收不到，连线在滚动时就不会重绘（端点全部停在旧位置）。
  // 两栏 A/B 会解析到同一个 .cm-mergeView，这里靠 bound 集合去重，避免同一元素挂两份
  // 回调、每次滚动重绘两次。
  const scrollBound = new Set();
  function bindConnectorScroll(view) {
    const box = scrollBoxOf(view);
    if (!box || scrollBound.has(box)) return;
    scrollBound.add(box);
    box.addEventListener(
      "scroll",
      () => {
        if (connectorPainter) connectorPainter.draw();
      },
      acOpts
    );
  }
  /**
   * 监听容器尺寸变化并重绘连线（R8：句柄提升到闭包，由 teardownConnectors 负责断开）。
   */
  function bindConnectorResize() {
    if (typeof ResizeObserver !== "function") return;
    // 幂等：重复装配时先清掉上一个观察器，避免叠加
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    resizeObserver = new ResizeObserver(
      () => connectorPainter && connectorPainter.draw()
    );
    resizeObserver.observe(parent);
  }
  // B↔C 滚动同步已迁移到共享 createScrollSync（见各分支视图就绪后的调用）。
  // 其「比例对齐 + 共享 lock 防回环 + 必须取真滚动盒」逻辑现由 scroll-sync.js 统一承载（§9 / D16）；
  // MergeView 仍负责 A↔B 行对齐，createScrollSync 补 B↔C（合并）或 B↔C / A↔C（对照三栏）。
  /** 统一销毁连线相关资源 */
  function teardownConnectors() {
    // R8：无条件断开，不依赖 connectorAC 是否存在
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (connectorAC) connectorAC.abort();
    if (connectorPainter) {
      connectorPainter.destroy();
      connectorPainter = null;
    }
  }

  if (layout === "three") {
    // ── 三栏：合并(merge) 或 对照三栏(compare) 共用结构 ──
    // merge   ：左 本地(Yours,可编辑) / 中 合并结果(Result,可编辑,无源) / 右 对方(Theirs,可编辑)。
    // compare ：a/b/c 为三个真实独立文件（b 在 MergeView 的 b 面板，c 为独立编辑器），无合并结果栏。
    // 三栏全部可编辑（§6 / D3、D6：合并本地栏推翻只读；对照各栏本就可编辑）。
    const isCompareThree = mode === "compare" && !!cFile;
    bIsDerivedResult = !isCompareThree; // merge（含旧版三栏调用）的 b=派生结果栏，无源
    // 栏位语义按 mode 归一（兼容旧调用：无 opts.c 的三栏视为 merge）：
    //   merge   → 结果 = opts.b(或 opts.result)，对方 = opts.c(或旧 opts.b-对方)
    //   compare → a=opts.a, b=opts.b(真实文件), c=opts.c(真实文件)
    const theirsInitial = isCompareThree
      ? cFile.content
      : (cFile && cFile.content) || bFile.content;
    const resultInitial = isCompareThree
      ? bFile.content
      : opts.result !== undefined
        ? opts.result || ""
        : (opts.b ? opts.b.content : "");

    // 右栏 Theirs/第三文件 默认可编辑（opts.theirsReadonly 显式为 true 时才锁定，D3/D6 全可编辑）。
    const theirsExtras =
      opts.theirsReadonly === true
        ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
        : [];

    const mv = new MergeView({
      a: {
        doc: aFile.content,
        extensions: [...baseExtensions, ...decoExtA],
      },
      b: {
        doc: resultInitial,
        extensions: [...baseExtensions, ...decoExtB],
      },
      parent,
      orientation: "a-b",
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: collapse,
      diffConfig,
      // 自定义中文接受按钮：revert a→b 即把当前块从 Yours 拷入 Result。
      // 冲突块会由 revertSync 追加「采纳右 ▶」（Theirs→Result），见下方 acceptRightAt。
      revertControls: "a-to-b",
      renderRevertControl: () => makeRevertGroup((i) => acceptRightAt(i)),
    });

    // 右侧 Theirs 编辑器（独立挂载到 parent，紧随 MergeView 之后）。
    // 第三期起挂 decoExtC：承载 B↔C（Result↔Theirs）第二层差异装饰与移动块。
    const theirsView = new EditorView({
      doc: theirsInitial,
      parent,
      extensions: [
        ...baseExtensions,
        ...theirsExtras,
        ...decoExtC,
        EditorView.editorAttributes.of({ class: "cm-compare-theirs" }),
      ],
    });
    parent.classList.add("compare-three-layout");

    // 视图全部就绪后回填两层视图对并首次调度（diff 异步落定，内部有 rAF 轮询兜底）。
    // A↔B 层走 MergeView 自带 chunks；B↔C 层两视图分属不同实例，必须 computeChunks 自算。
    if (scheduler) {
      const attachPairs = [
        {
          a: mv.a,
          b: mv.b,
          layer: "ab",
          sides: { aSide: "a", bSide: "b", writeA: true, writeB: true },
        },
      ];
      if (isCompareThree) {
        // 对照三栏：A-B / B-C / A-C 三组（a/b/c 均为真实独立文件，无合并结果栏）
        attachPairs.push({
          a: mv.b,
          b: theirsView,
          layer: "bc",
          sides: { aSide: null, bSide: "b", writeA: false, writeB: true, computeChunks: true },
        });
        attachPairs.push({
          a: mv.a,
          b: theirsView,
          layer: "ac",
          // M7：ac 层不得再向 C 栏（theirsView）写 setWordDiffEffect。runAll() 按 [ab,bc,ac]
          // 顺序执行，ac 在末尾后写会整体覆盖先写的 bc 层，导致 B↔C 行内字词高亮被静默顶替丢失。
          // 取舍：C 栏只画与其相邻中间栏的 B↔C 差异（bc 层），A↔C 关系仍由连线层/块模型表达，
          // 不再用内联高亮覆盖 C 栏。故 writeB 置 false（writeA 本就 false，ac 层不再写任何内联装饰）。
          sides: { aSide: null, bSide: "b", writeA: false, writeB: false, computeChunks: true },
        });
      } else {
        // 合并三栏：仅 A-B / B-C（结果作为中间栏）
        attachPairs.push({
          a: mv.b,
          b: theirsView,
          layer: "bc",
          sides: {
            aSide: null,
            bSide: "b",
            writeA: false, // 中栏装饰归 A↔B 层所有，本层不得覆写
            writeB: true,
            computeChunks: true,
          },
        });
      }
      scheduler.attach(attachPairs);
      scheduler.scheduleRefresh();
    }

    // ── 双层连线 + 三栏滚动联动 ──
    connectorPainter = createConnectorPainter({
      container: parent,
      getLayers: buildConnectorLayers,
    });
    bindConnectorScroll(mv.a);
    bindConnectorScroll(mv.b);
    bindConnectorScroll(theirsView);
    // 视图引用回填（供 getPanes / 滚动同步闭包捕获）
    aView = mv.a;
    bView = mv.b;
    cView = theirsView;
    // 滚动同步改用共享 createScrollSync（§9 / D16）：比例对齐 + 共享 lock 防回环，
    // 配对组按 mode 选择（对照三栏 A-B/B-C/A-C；合并三栏 A-B/B-C）。
    const scrollPairs = isCompareThree ? [[0, 1], [1, 2], [0, 2]] : [[0, 1], [1, 2]];
    scrollSync = createScrollSync({
      views: () => [aView, bView, cView].filter(Boolean),
      isEnabled: () => scrollSyncEnabled,
      setEnabled: (v) => {
        scrollSyncEnabled = v;
      },
      onMisalign,
      pairs: scrollPairs,
    });
    if (scheduler) scheduler.onRefresh(() => connectorPainter && connectorPainter.draw());
    bindConnectorResize();

    // ── B↔C 栏间逐块采纳列（替代原静态 bulk bcRevertCol）──
    // 夹在 MergeView 与 theirsView 之间，逐块渲染「采纳左/右」，垂直对齐到
    // 该块在 Result(b) 侧的起始行；随滚动与 diff 重算重定位。
    bcColCtl = mountBcRevertColumn({
      parent,
      mv,
      theirsView,
      scheduler,
      getChunkModel: buildChunkModel,
      acceptBcChunkAt,
    });

    // ── 差异块模型（供工具栏批量操作 / 状态计数 / 冲突判定共用）──
    //
    // 两层的坐标系必须显式归一，否则调用方极易把 A↔B 的偏移喂给 B↔C 的视图：
    //   layer 'ab'：src = Yours(mv.a) 侧 [fromA,toA)，dst = Result(mv.b) 侧 [fromB,toB)
    //   layer 'bc'：Chunk.build(Result, Theirs) 的 a 侧是 Result、b 侧是 Theirs，
    //               而我们要的方向是 Theirs→Result，故 src/dst 相对原始字段【互换】。
    // 归一后两层都满足 chunk-ops.js 的约定：src* 属 srcView，dst* 属 dstView。
    //
    // conflict 判定：同一段 Result 区域既被 Yours 提议改写、又被 Theirs 提议改写 ——
    // 即 ab 块的 dst 区间与 bc 块的 dst 区间（都在 Result 坐标系）相交。
    /** @returns {{ab:any[], bc:any[]}} */
    function buildChunkModel() {
      const abRaw = safeChunks(mv.a.state);
      let bcRaw = [];
      try {
        bcRaw = Chunk.build(mv.b.state.doc, theirsView.state.doc, diffConfig) || [];
      } catch (err) {
        console.error("[compare-merge] 计算 Result↔Theirs 差异块失败:", err);
      }
      const ab = abRaw.map((c, i) => ({
        id: `ab-${i}`,
        index: i,
        layer: "ab",
        conflict: false,
        srcFrom: c.fromA,
        srcTo: c.toA,
        dstFrom: c.fromB,
        dstTo: c.toB,
      }));
      const bc = bcRaw.map((c, i) => ({
        id: `bc-${i}`,
        index: i,
        layer: "bc",
        conflict: false,
        srcFrom: c.fromB, // Theirs 侧
        srcTo: c.toB,
        dstFrom: c.fromA, // Result 侧
        dstTo: c.toA,
      }));
      for (const x of ab) {
        for (const y of bc) {
          if (rangesOverlap(x.dstFrom, x.dstTo, y.dstFrom, y.dstTo)) {
            x.conflict = true;
            y.conflict = true;
          }
        }
      }
      return { ab, bc };
    }

    /**
     * ACCEPT RIGHT：把与第 i 个 A↔B 块相交的 Theirs 块写进 Result。
     * @param {number} i .cm-merge-revert 列上的 data-chunk（即 mv 的 chunk 下标）
     * @returns {boolean}
     */
    function acceptRightAt(i) {
      try {
        const model = buildChunkModel();
        const target = model.ab[i];
        if (!target) return false;
        const hit = model.bc.find((y) =>
          rangesOverlap(target.dstFrom, target.dstTo, y.dstFrom, y.dstTo)
        );
        if (!hit) return false;
        // dst 越界钳制：Result 尾部块的 toA 可能等于「文档长度+1」（含行尾换行），
        // 直接喂给 dispatch 会抛 RangeError。
        const len = mv.b.state.doc.length;
        acceptChunk({
          srcView: theirsView,
          dstView: mv.b,
          srcFrom: hit.srcFrom,
          srcTo: hit.srcTo,
          dstFrom: Math.min(hit.dstFrom, len),
          dstTo: Math.min(hit.dstTo, len),
        });
        return true;
      } catch (err) {
        console.error("[compare-merge] 采纳右侧块失败:", err);
        return false;
      }
    }

    /**
     * B↔C 逐块采纳：把第 i 个 B↔C 块按方向写入对侧。
     *   dir 'right'（◀ 采纳右）= c→b（Theirs→Result）
     *   dir 'left' （采纳左 ▶）= b→c（Result→Theirs）
     * 越界钳制对齐 acceptRightAt / chunk-ops.acceptChunk，避免尾部块 to 越界抛 RangeError。
     * @param {number} i B↔C 块下标（getChunkModel().bc 的下标）
     * @param {'left'|'right'} dir
     * @returns {boolean}
     */
    function acceptBcChunkAt(i, dir) {
      try {
        const model = buildChunkModel();
        const target = model.bc[i];
        if (!target) return false;
        const bLen = mv.b.state.doc.length;
        const cLen = theirsView.state.doc.length;
        // 方向映射 + 越界钳制委托给纯函数 computeBcAcceptRange（可被 node 单测锁定）；
        // srcSide='c' → 源取 Theirs(theirsView)、目标落 Result(mv.b)；否则反之。
        const r = computeBcAcceptRange(target, dir, bLen, cLen);
        acceptChunk({
          srcView: r.srcSide === "c" ? theirsView : mv.b,
          dstView: r.srcSide === "c" ? mv.b : theirsView,
          srcFrom: r.srcFrom,
          srcTo: r.srcTo,
          dstFrom: r.dstFrom,
          dstTo: r.dstTo,
        });
        if (scheduler) scheduler.scheduleRefresh();
        return true;
      } catch (err) {
        console.error("[compare-merge] B↔C 采纳块失败:", err);
        return false;
      }
    }

    // 冲突块才显示双向按钮；非冲突块保持单个「⇄ 接受此块」
    const revertSync = createRevertGroupSync(parent, () => {
      const set = new Set();
      for (const c of buildChunkModel().ab) if (c.conflict) set.add(c.index);
      return set;
    });
    if (scheduler) scheduler.onRefresh(() => revertSync.sync());

    /**
     * 把光标（或指定位置）所在块从 Theirs 拷入 Result（b 面板）。
     *
     * 三栏合并模型：左 Yours(a) / 中 Result(b, 可编辑, 逐步建成) / 右 Theirs(独立只读)。
     * 用户光标在 Result(b) 中；需要把「与光标对应的 Theirs 块」插入 Result。
     * 对齐策略：
     *   1) 用 a↔b(当前 Result) 的差异块，把光标在 b 中的位置反推回 Yours(a) 的对应位置 aPos；
     *   2) 用 a↔Theirs 的差异块，找到包含 aPos 的块，取其 Theirs 侧文本；
     *   3) 将 Theirs 文本【插入】Result 光标处（用 insert，避免空文档上替换区间越界 RangeError）。
     *
     * @param {number} [pos]
     * @returns {boolean}
     */
    function acceptTheirsAt(pos) {
      try {
        const resultState = mv.b.state;
        const cursor =
          typeof pos === "number" ? pos : resultState.selection.main.head;
        // 用实时 a 栏文档（三栏下 a = aView），避免用户编辑 a 栏后用构造时 aFile.content
        // 对齐导致插错块（L3）。
        const aText = aView.state.doc;
        const theirsDoc = theirsView.state.doc;

        // 1) 光标在 Result(b) 的位置 → 反推其在 Yours(a) 的对应位置
        const abChunks = Chunk.build(aText, resultState.doc, diffConfig);
        let aPos = cursor;
        for (const c of abChunks) {
          if (cursor >= c.fromB && cursor <= c.toB) {
            aPos = c.fromA;
            break;
          }
        }

        // 2) 找到 (Yours, Theirs) 差异块中包含 aPos 的块
        const atChunks = Chunk.build(aText, theirsDoc, diffConfig);
        let target = null;
        for (const c of atChunks) {
          if (aPos >= c.fromA && aPos <= c.toA) {
            target = c;
            break;
          }
        }
        // 命中不到光标块：选择离 aPos 最近的块
        if (!target) {
          let best = null;
          let bestDist = Infinity;
          for (const c of atChunks) {
            const d = Math.abs(aPos - c.fromA);
            if (d < bestDist) {
              bestDist = d;
              best = c;
            }
          }
          target = best;
        }
        if (!target) return false; // a 与 Theirs 完全相同，无内容可采纳

        // 3) 将 Theirs 对应块内容【插入】Result 光标处（插入而非替换，避免空文档越界）
        const insertText = theirsDoc.sliceString(target.fromB, target.toB);
        mv.b.dispatch({
          changes: { from: cursor, to: cursor, insert: insertText },
        });
        return true;
      } catch (err) {
        console.error("[compare-merge] acceptTheirsAt 失败:", err);
        return false;
      }
    }

    return {
      /** @type {MergeView} */
      mv,
      /** @type {EditorView} */
      a: mv.a,
      /** @type {EditorView} */
      b: mv.b,
      /** @type {EditorView} */
      theirsView,
      /** 块导航所用的活动视图（Yours 面板） */
      navView: mv.a,
      /** @returns {string} 合并结果（Result / b 面板文档） */
      getResult() {
        return mv.b.state.doc.toString();
      },
      /** 右栏 Theirs 原始内容 */
      getTheirs() {
        return theirsView.state.doc.toString();
      },
      /** 左栏 Yours 原始内容 */
      getYours() {
        return mv.a.state.doc.toString();
      },
      /** 展开/折叠未改区域（T2 增量 E） */
      setCollapse(collapsed) {
        const apply = () =>
          mv.reconfigure({
            collapseUnchanged: resolveCollapse(collapsed, collapse, mv.a),
          });
        apply();
        // diff 异步完成：构造后 / 同步调用时 chunks 尚未就绪，resolveCollapse 会回
        // undefined 而误关折叠。等待 diff 落定后按真实 chunks 校正一次（有差异→折叠
        // 生效；相同文件→保持不折叠）。仅当 collapsed 为真且当前无 chunks 时轮询，
        // 帧上限避免「相同文件 chunks 恒为 0」导致的无限轮询；视图销毁即停止。
        if (collapsed && safeChunks(mv.a.state).length === 0) {
          if (typeof requestAnimationFrame !== "function") return;
          let frames = 0;
          const MAX = 120; // ~2s 上限
          // B5：见 createDecorationScheduler 内同名判据的说明 —— view.dom 永不为 null，
          // 只能靠「曾挂进 document、现已断连」识别销毁。
          let wasConnected = false;
          const tick = () => {
            try {
              if (!mv.a || !mv.a.dom) return; // 视图不存在
              if (mv.a.dom.isConnected) wasConnected = true;
              else if (wasConnected) return; // 已销毁
              if (safeChunks(mv.a.state).length > 0) {
                apply(); // diff 完成：按真实 chunks 校正
                return;
              }
              if (++frames < MAX) requestAnimationFrame(tick);
            } catch (_) {
              /* 视图已销毁，忽略 */
            }
          };
          requestAnimationFrame(tick);
        }
      },
      acceptTheirsAt,
      /**
       * 归一化后的全部差异块（两层合并）。字段契约见 chunk-ops.js：
       * { id, index, layer:'ab'|'bc', conflict, srcFrom, srcTo, dstFrom, dstTo }
       * @returns {Array<Object>}
       */
      getChunks() {
        const m = buildChunkModel();
        return [...m.ab, ...m.bc];
      },
      /** 某层的写入端点（供调用方直接喂给 chunk-ops）：ab = Yours→Result，bc = Theirs→Result */
      getLayerViews(layer) {
        // L7：显式处理 'right'（对方 → 本地，与两栏分支 'right' 语义一致：src=对方, dst=本地）。
        // 其余：'bc' = Theirs→Result，默认 'ab' = Yours→Result。
        if (layer === "bc") return { srcView: theirsView, dstView: mv.b };
        if (layer === "right") return { srcView: theirsView, dstView: mv.a };
        return { srcView: mv.a, dstView: mv.b };
      },
      /** 切换行内字词高亮粒度：'off' | 'word' | 'char'，立即重算 */
      setWordDiffMode(m) {
        flags.wordMode = m === "off" || m === "char" ? m : "word";
        if (scheduler) scheduler.scheduleRefresh();
      },
      /** 手动同步块级按钮的单/双形态（外部改动文档后调用） */
      syncRevertControls() {
        revertSync.sync();
      },
      /** 手动触发一次差异装饰重算（供外部 / 自动化测试用） */
      refreshDecorations() {
        if (scheduler) scheduler.scheduleRefresh();
      },
      /** 供 Location Pane 读取双层移动/差异数据 */
      getConnectorLayers: buildConnectorLayers,
      /**
       * 订阅「差异装饰重算完成」事件，返回解绑函数。
       * Location Pane 靠它在 diff 落定后刷新概览条，避免自己另起轮询。
       * @param {() => void} fn
       * @returns {() => void}
       */
      onRefresh(fn) {
        return scheduler ? scheduler.onRefresh(fn) : () => {};
      },
      /** 强制重绘连线（窗口尺寸变化 / 外部布局调整后调用） */
      redrawConnectors() {
        if (connectorPainter) connectorPainter.draw();
      },
      /**
       * 暴露各栏引用与目标描述符，供保存轮询 / 返回主界面使用（与 C1 约定一致）。
       * content 实时取文档字符串；target 为文件目标描述符（merge 的 b=合并结果无源 → null）。
       * @returns {Array<{key:string, view:EditorView, target:object|null, content:string}>}
       */
      getPanes() {
        const panes = [
          { key: "a", view: aView, target: aTarget, content: aView.state.doc.toString() },
          {
            key: "b",
            view: bView,
            target: bIsDerivedResult ? null : bTarget,
            content: bView.state.doc.toString(),
          },
        ];
        if (cView)
          panes.push({ key: "c", view: cView, target: cTarget, content: cView.state.doc.toString() });
        return panes;
      },
      /** 共享滚动同步控制器（供「滚动」按钮 toggle，见 §9 / D16） */
      scrollSync,
      destroy() {
        if (scrollSync) scrollSync.destroy();
        if (scheduler) scheduler.dispose(); // 必须先停 rAF / debounce，再销毁视图
        if (bcColCtl) {
          bcColCtl.dispose();
          bcColCtl = null;
        }
        revertSync.dispose(); // MutationObserver 由浏览器强引用，必须显式断开
        teardownConnectors(); // 解绑滚动/ResizeObserver 并移除 SVG 覆盖层
        parent.classList.remove("compare-three-layout");
        theirsView.destroy();
        mv.destroy();
      },
    };
  }

  // ── 两栏对照：a=Yours、b=Theirs，均可编辑或 a 只读（按 opts 决定） ──
  const aExtras = opts.aReadonly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [];
  const bExtras = opts.bReadonly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [];

  /**
   * 两栏 ACCEPT RIGHT：把第 i 个块的 Theirs(b) 内容写回 Yours(a)。
   * （ACCEPT LEFT 方向 a→b 由库的 revertControls:'a-to-b' 直接承担，无需自定义。）
   * @param {number} i
   * @returns {boolean}
   */
  function acceptRightTwo(i) {
    try {
      const c = safeChunks(mv.a.state)[i];
      if (!c) return false;
      if (mv.a.state.readOnly) return false; // a 被 opts.aReadonly 锁定：静默忽略
      const len = mv.a.state.doc.length;
      acceptChunk({
        srcView: mv.b,
        dstView: mv.a,
        srcFrom: c.fromB,
        srcTo: c.toB,
        dstFrom: Math.min(c.fromA, len),
        dstTo: Math.min(c.toA, len),
      });
      return true;
    } catch (err) {
      console.error("[compare-merge] 两栏采纳右侧块失败:", err);
      return false;
    }
  }

  const mv = new MergeView({
    a: {
      doc: aFile.content,
      extensions: [...baseExtensions, ...aExtras, ...decoExtA],
    },
    b: {
      doc: bFile.content,
      extensions: [...baseExtensions, ...bExtras, ...decoExtB],
    },
    parent,
    orientation: "a-b",
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: collapse,
    diffConfig,
    // 两栏也提供块级操作：语义为 ACCEPT LEFT(a→b) / ACCEPT RIGHT(b→a)，
    // 故这里恒为双按钮形态（两栏没有三方冲突概念）。
    revertControls: "a-to-b",
    renderRevertControl: () => makeRevertGroup((i) => acceptRightTwo(i)),
  });

  // 两栏恒双向：把所有块下标都标成 dual
  const revertSyncTwo = createRevertGroupSync(parent, () => {
    const set = new Set();
    const n = safeChunks(mv.a.state).length;
    for (let i = 0; i < n; i++) set.add(i);
    return set;
  });
  if (scheduler) scheduler.onRefresh(() => revertSyncTwo.sync());

  // 视图就绪后回填引用并首次调度（diff 异步落定，内部有 rAF 轮询兜底）
  if (scheduler) {
    scheduler.attach([
      {
        a: mv.a,
        b: mv.b,
        layer: "ab",
        sides: { aSide: "a", bSide: "b", writeA: true, writeB: true },
      },
    ]);
    scheduler.scheduleRefresh();
  }

  // 两栏同样启用移动块连线（单层 A↔B）。滚动由 MergeView 自身联动，这里只负责重绘。
  connectorPainter = createConnectorPainter({
    container: parent,
    getLayers: buildConnectorLayers,
  });
  bindConnectorScroll(mv.a);
  bindConnectorScroll(mv.b);
  if (scheduler) scheduler.onRefresh(() => connectorPainter && connectorPainter.draw());
  bindConnectorResize();

  // 视图引用回填（供 getPanes / 滚动同步闭包捕获）
  aView = mv.a;
  bView = mv.b;
  // 滚动同步改用共享 createScrollSync（§9 / D16）。两栏 a↔b 同属一个 MergeView 滚动盒，
  // 配对 [[0,1]] 在该共享盒上自动 no-op；此处建立控制器以便「滚动」按钮统一 toggle。
  scrollSync = createScrollSync({
    views: () => [aView, bView, cView].filter(Boolean),
    isEnabled: () => scrollSyncEnabled,
    setEnabled: (v) => {
      scrollSyncEnabled = v;
    },
    onMisalign,
    pairs: [[0, 1]],
  });

  return {
    /** @type {MergeView} */
    mv,
    /** @type {EditorView} */
    a: mv.a,
    /** @type {EditorView} */
    b: mv.b,
    /** 两栏无独立 Theirs 面板 */
    theirsView: null,
    /** 块导航所用的活动视图（默认在 a 面板触发） */
    navView: mv.a,
    /** @returns {string} 当前右侧（Theirs）文档 */
    getResult() {
      return mv.b.state.doc.toString();
    },
    getYours() {
      return mv.a.state.doc.toString();
    },
    getTheirs() {
      return mv.b.state.doc.toString();
    },
    setCollapse(collapsed) {
      const apply = () =>
        mv.reconfigure({
          collapseUnchanged: resolveCollapse(collapsed, collapse, mv.a),
        });
      apply();
      // 与三栏一致：diff 异步落定后校正折叠（避免同步调用时 chunks 未就绪误关折叠）。
      if (collapsed && safeChunks(mv.a.state).length === 0) {
        if (typeof requestAnimationFrame !== "function") return;
        let frames = 0;
        const MAX = 120;
        // B5：同三栏分支，用「曾连接过、现已断连」替代恒假的 dom === null 判据。
        let wasConnected = false;
        const tick = () => {
          try {
            if (!mv.a || !mv.a.dom) return; // 视图不存在
            if (mv.a.dom.isConnected) wasConnected = true;
            else if (wasConnected) return; // 已销毁
            if (safeChunks(mv.a.state).length > 0) {
              apply();
              return;
            }
            if (++frames < MAX) requestAnimationFrame(tick);
          } catch (_) {
            /* 视图已销毁，忽略 */
          }
        };
        requestAnimationFrame(tick);
      }
    },
    acceptTheirsAt() {
      return false;
    },
    /**
     * 归一化差异块。两栏只有 A↔B 一层，且不存在三方冲突，conflict 恒为 false。
     * @returns {Array<Object>}
     */
    getChunks() {
      return safeChunks(mv.a.state).map((c, i) => ({
        id: `ab-${i}`,
        index: i,
        layer: "ab",
        conflict: false,
        srcFrom: c.fromA,
        srcTo: c.toA,
        dstFrom: c.fromB,
        dstTo: c.toB,
      }));
    },
    /**
     * 两栏的写入端点。'right' 表示反向（Theirs→Yours），此时 src/dst 字段需由
     * 调用方按 getChunks 的**反转**使用（srcFrom↔dstFrom），见 compare.js applyDirection。
     */
    getLayerViews(layer) {
      return layer === "right"
        ? { srcView: mv.b, dstView: mv.a }
        : { srcView: mv.a, dstView: mv.b };
    },
    setWordDiffMode(m) {
      flags.wordMode = m === "off" || m === "char" ? m : "word";
      if (scheduler) scheduler.scheduleRefresh();
    },
    syncRevertControls() {
      revertSyncTwo.sync();
    },
    /** 手动触发一次差异装饰重算（供外部 / 自动化测试用） */
    refreshDecorations() {
      if (scheduler) scheduler.scheduleRefresh();
    },
    /** 供 Location Pane 读取移动/差异数据 */
    getConnectorLayers: buildConnectorLayers,
    /** 订阅「差异装饰重算完成」事件，返回解绑函数 */
    onRefresh(fn) {
      return scheduler ? scheduler.onRefresh(fn) : () => {};
    },
    /** 强制重绘连线 */
    redrawConnectors() {
      if (connectorPainter) connectorPainter.draw();
    },
    /**
     * 暴露各栏引用与目标描述符，供保存轮询 / 返回主界面使用（与 C1 约定一致）。
     * @returns {Array<{key:string, view:EditorView, target:object|null, content:string}>}
     */
    getPanes() {
      return [
        { key: "a", view: aView, target: aTarget, content: aView.state.doc.toString() },
        { key: "b", view: bView, target: bTarget, content: bView.state.doc.toString() },
      ];
    },
    /** 共享滚动同步控制器（供「滚动」按钮 toggle，见 §9 / D16） */
    scrollSync,
    destroy() {
      if (scrollSync) scrollSync.destroy();
      if (scheduler) scheduler.dispose(); // 必须先停 rAF / debounce，再销毁视图
      revertSyncTwo.dispose();
      teardownConnectors();
      mv.destroy();
    },
  };
}

/**
 * 取某 MergeView 面板的差异块数（供调用方做状态展示 / 测试）。
 * @param {import('@codemirror/state').EditorState} state
 * @returns {number}
 */
export function countChunks(state) {
  return safeChunks(state).length;
}

/**
 * @typedef {Object} CompareMergeInstance
 * @property {MergeView} mv
 * @property {EditorView} a
 * @property {EditorView} b
 * @property {EditorView|null} theirsView
 * @property {EditorView} navView
 * @property {() => string} getResult
 * @property {() => string} getYours
 * @property {() => string} getTheirs
 * @property {(collapsed: boolean) => void} setCollapse
 * @property {(pos?: number) => boolean} acceptTheirsAt
 * @property {() => Array<Object>} getChunks 归一化差异块（含 layer / conflict / src 与 dst 偏移）
 * @property {(layer:string) => {srcView:EditorView,dstView:EditorView}} getLayerViews 某层的写入端点
 * @property {(mode:'off'|'word'|'char') => void} setWordDiffMode 切换行内字词高亮粒度
 * @property {() => void} syncRevertControls 同步块级按钮的单/双形态
 * @property {() => void} refreshDecorations 手动重算行内字词差异 / 块移动装饰
 * @property {() => Array<Object>} getConnectorLayers 双层连线图层数据（供 Location Pane）
 * @property {(fn:()=>void) => (()=>void)} onRefresh 订阅装饰重算完成事件，返回解绑函数
 * @property {() => void} redrawConnectors 强制重绘移动块连线
 * @property {() => Array<{key:string, view:EditorView, target:object|null, content:string}>} getPanes 暴露各栏引用/目标/内容（供保存轮询）
 * @property {object} scrollSync 共享滚动同步控制器（供「滚动」按钮 toggle）
 * @property {() => void} destroy
 */
