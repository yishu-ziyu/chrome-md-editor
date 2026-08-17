// delta-align.js — 行内元素级差异：token 对齐 + 同源行配对
//
// ============================================================================
// 【移植来源】dandavison/delta —— MIT License
//   https://github.com/dandavison/delta  (branch: main)
//   - src/align.rs  → Alignment（Needleman-Wunsch / Wagner-Fischer 编辑距离表 +
//                     回溯出编辑操作序列 + run-length 合并）
//   - src/edits.rs  → tokenize / annotate / infer_edits / compute_distance
//   Copyright (c) Dan Davison，原始许可证见上游仓库 LICENSE（MIT）。
//
// 【为什么需要这个文件 —— 它解决的具体问题】
//   本项目原有的 src/compare/inline-word-diff.js 只能处理「左右行数相等」的差异块：
//   compare-merge.js 里有一句 `if (aLines.length !== bLines.length) continue;`，
//   一旦某个块是 3 行 ↔ 5 行，整块直接放弃行内高亮，退化成大片纯色。
//   原因是它按**下标**配对（beforeLines[i] ↔ afterLines[i]），行数不等时下标配对没有意义。
//
//   delta 解决同一问题的办法就是本文件移植的 infer_edits：不按下标配对，而是
//   **按内容相似度贪心配对**。对每个 minus 行，向后扫描尚未消费的 plus 行，
//   算一次 token 级编辑距离；距离 <= 阈值就认定二者「同源」（homologous），
//   配成一对并做 token 级高亮；扫完都没有同源行，该 minus 行就是**独属内容**
//   （只存在于左侧）。被跳过的那些 plus 行同理是右侧的独属内容。
//   于是 N↔M 行的块也能得到精确的元素级高亮，且**顺带产出了独属行清单**——
//   这正是「独属内容连线到对侧插入点」所需要的输入。
//
// 【相对上游的改动】
//   1. Rust → ESM JavaScript；&str 切片语义在 JS 中用 {from,to} 偏移对表达
//      （JS 没有零拷贝切片，返回偏移比返回子串更省内存，也更贴合 CodeMirror
//       的 Decoration.mark(from,to) 接口）。
//   2. 上游 annotate() 返回 Vec<(Annotation, &str)>「全量分段」（含 NoOp 段），
//      本文件只返回**改动段**的偏移区间（deletion / insertion），因为 CodeMirror
//      装饰只需要标出改动处，未改动处不需要任何 mark。分段总长仍可无损拼回原行
//      （见单测 delta-align.test.js 的「偏移无损」用例）。
//   3. 上游用 unicode_width::UnicodeWidthStr::width() 计算距离贡献（终端列宽，
//      CJK 全角字符记 2）。本文件改用「码点数」（[...s].length）：
//      浏览器里字符宽度由字体决定而非终端列宽，且 delta 用它只是为了给
//      「改动量占比」一个与视觉体量相关的权重，码点数在此用途上等价且无需引入
//      unicode-width 依赖。**注意这会让 CJK 文本的距离值与 delta 原版略有出入**
//      （CJK 段的权重从 2 降到 1），但因为分子分母同时受影响，比值偏差很小。
//   4. 上游 tokenize() 在词之间把分隔文本拆成**逐字素簇**的单字符 token。
//      本文件保留该策略（用 Intl.Segmenter 分字素簇，不可用时退化为码点），
//      因为它是 delta 高亮粒度「贴着词边界又能精确到标点」的关键：
//      整段分隔符当成一个 token 会让「a, b」→「a; b」高亮整个「, 」。
//   5. 上游 infer_edits 的 `max_line_distance_for_naively_paired_lines` 默认取 0.0
//      （见 config.rs:194-199，环境变量未设时为 0.0），即「行数恰好相等」时
//      **只有完全相同的行**才走该快速通道。本文件保留该参数与默认值 0.0。
//   6. 上游 annotate() 有一段「把空白段并入前一个改动段」（coalesce_space_with_previous）
//      的逻辑，目的是让终端里相邻的两个高亮块之间不出现一道未着色的窄缝。
//      本文件**保留**该行为，因为 CSS 背景色同样会露缝，视觉问题一致。
//   7. 新增 MAX_TOKENS 防爆保护：Needleman-Wunsch 是 O(m*n) 时间与空间，
//      上游是一次性 CLI 进程、可以放任；本项目跑在浏览器主线程且每 200ms
//      debounce 重算一次，超长行（如压缩后的单行 JSON）必须短路，否则会卡死页面。
//      上游没有这个保护，这是本项目的必要增强。
//
// 【纯函数约定】
//   本文件不 import 任何 CodeMirror 运行时，可被 node:test 直接单测。
//   渲染层（Decoration / SVG）一律在调用方，本文件只产出数据。
// ============================================================================

/** Needleman-Wunsch 代价参数：与 delta src/align.rs 顶部三个常量逐一对应，勿随意改动。 */
const DELETION_COST = 2;
const INSERTION_COST = 2;
/** 开启一段新的「改动 token 群」的额外代价，作用是让改动聚成块而非撒成点。 */
const INITIAL_MISMATCH_PENALTY = 1;

/** 编辑操作枚举（对应 delta align::Operation）。 */
const NOOP = 0;
const DELETION = 1;
const INSERTION = 2;

/**
 * 单行参与对齐的最大 token 数。超出即放弃精确对齐（见文件头改动说明第 7 条）。
 *
 * 取值依据：对齐表大小为 (m+1)*(n+1) 个格子，600×600 ≈ 36 万格，
 * 单次填表实测 < 10ms，而 refreshDecorations 是 200ms debounce 的，留有充足余量。
 * 一行超过 600 个 token（约 300+ 个词）在 Markdown 文档里已属异常（多半是压缩数据），
 * 这类行做精确到词的高亮本就没有阅读价值。
 */
const MAX_TOKENS = 600;

/** delta 的默认同源判定阈值（cli.rs: --max-line-distance，default 0.6）。 */
export const DEFAULT_MAX_LINE_DISTANCE = 0.6;

/**
 * 「行数恰好相等」时启用的更严格阈值（delta config.rs 默认 0.0）。
 * 0.0 意味着此快速通道只接受**零距离**（即完全相同）的行对；
 * 其余行对照常走 DEFAULT_MAX_LINE_DISTANCE 判定。
 */
export const DEFAULT_MAX_LINE_DISTANCE_NAIVE = 0.0;

/**
 * 每个块最多做多少次「行对」对齐尝试。
 *
 * infer_edits 最坏是 O(minus * plus) 次对齐（每个 minus 行都扫完所有 plus 行都不匹配），
 * 单次对齐本身又是 O(token²)。一个 200 行 ↔ 200 行的整体重写块会退化成 4 万次对齐，
 * 足以让页面卡死数秒。超过预算即停止配对、剩余行全部按独属内容处理 ——
 * 这与「整段重写本就没有可靠行对应关系」的语义判断一致（见 compare-merge.js 里
 * 原注释对该场景的论述），降级结果依然正确，只是少了行内高亮。
 */
const MAX_PAIR_ATTEMPTS = 4000;

// ---------------------------------------------------------------------------
// 分词（对应 delta src/edits.rs::tokenize）
// ---------------------------------------------------------------------------

/**
 * 词的定义。对应 delta 的 --word-diff-regex，默认 `\w+`。
 * 加 u 标志并用 \p{L}\p{N}_ 取代 \w，使 CJK / 带音标的拉丁字母也能成词 ——
 * 上游 Rust regex 的 \w 在开启 unicode 特性时本就等价于此，JS 的 \w 却只认 ASCII，
 * 不替换的话中文会被逐字拆开，高亮粒度碎得没法看。
 */
const WORD_RE = /[\p{L}\p{N}_]+/gu;

/**
 * 字素簇分割器（emoji、组合音标、CJK 变体选择符等应作为一个整体，不能拆）。
 * Intl.Segmenter 在 Chrome 87+ / Node 16+ 可用；不可用时退化为按码点分割
 * （[...str] 已能正确处理代理对，只是会把「基字符 + 组合符」拆成两个 token —— 
 * 后果仅是高亮粒度更碎，不会产生错误偏移）。
 */
const graphemeSegmenter = (() => {
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      return new Intl.Segmenter(undefined, { granularity: "grapheme" });
    }
  } catch (_) {
    /* 环境不支持：退化 */
  }
  return null;
})();

/**
 * 把一段文本按字素簇切成单字符 token，逐个 push 进 out。
 * @param {string} text
 * @param {string[]} out
 */
function pushGraphemes(text, out) {
  if (!text) return;
  if (graphemeSegmenter) {
    for (const seg of graphemeSegmenter.segment(text)) out.push(seg.segment);
    return;
  }
  for (const ch of text) out.push(ch);
}

/**
 * 把一行切成对齐算法所用的 token 序列。
 *
 * 规则（与 delta 一致）：词（WORD_RE 匹配段）整体作为一个 token；
 * 词与词之间的分隔文本**逐字素簇**拆成单字符 token。
 *
 * 首元素恒为空串 ""：这是 delta align.rs 里明确要求的哨兵
 * （"Something downstream of the alignment algorithm requires that the first
 *   token in both x and y is ''"），移植时必须保留，否则回溯出的操作序列
 * 与 token 下标会错开一位。
 *
 * @param {string} line
 * @returns {string[]} token 序列，各元素拼接后 === line（首个空串不影响拼接）
 */
export function tokenize(line) {
  const tokens = [""];
  if (!line) return tokens;

  let offset = 0;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(line)) !== null) {
    // 上游在「行首就有非词字符」时额外插一个空串哨兵，保持两侧 token 序列的
    // 起始结构一致（否则一侧以 "" 开头、另一侧以实字符开头，会让对齐多算一步）。
    if (offset === 0 && m.index > 0) tokens.push("");
    pushGraphemes(line.slice(offset, m.index), tokens);
    tokens.push(m[0]);
    offset = m.index + m[0].length;
    // 零宽匹配保护：WORD_RE 有 + 量词不可能匹配空串，但正则被后人改动后
    // （例如误写成 \w*）会造成 lastIndex 不前进的死循环，这里强制推进。
    if (m[0].length === 0) WORD_RE.lastIndex++;
  }
  if (offset < line.length) {
    if (offset === 0) tokens.push("");
    pushGraphemes(line.slice(offset), tokens);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// 对齐表（对应 delta src/align.rs::Alignment）
// ---------------------------------------------------------------------------

/**
 * 计算 token 序列 x（minus 侧）与 y（plus 侧）的最优对齐，返回 run-length 合并后的
 * 操作序列 [[op, n], ...]，其中 op ∈ {NOOP, DELETION, INSERTION}，n 为连续个数。
 *
 * 【与上游的等价性】表的填充顺序、候选项顺序、代价公式与 align.rs::fill 完全一致。
 * 候选项顺序（Insertion → Deletion → NoOp）**不可调换**：三者代价相同时取第一个，
 * 上游注释明确说明这是为了「把改动聚成群」且「让移动的 token 呈现为先删后插」。
 *
 * 【与上游的实现差异】上游每个格子存 {parent, operation, cost} 结构体；此处拆成
 * 三个扁平 TypedArray（parent/op/cost 各一条），避免为几十万个格子各建一个 JS 对象 ——
 * 那会产生巨量短命对象、拖垮 GC。语义完全一致。
 *
 * @param {string[]} x minus 侧 token 序列（tokenize 的输出）
 * @param {string[]} y plus  侧 token 序列
 * @returns {Array<[number, number]>} run-length 编码的操作序列
 */
function alignOperations(x, y) {
  const nx = x.length;
  const ny = y.length;
  // dim[1] = 列数 = nx+1（x 沿表头横向展开），dim[0] = 行数 = ny+1
  const cols = nx + 1;
  const rows = ny + 1;
  const size = cols * rows;

  // cost 用 Int32Array：代价上界约 (nx+ny)*2+penalty，远小于 2^31。
  // 用 Int32Array 而非 Float64Array 是为了内存与缓存局部性（大表下差别明显）。
  const cost = new Int32Array(size);
  const parent = new Int32Array(size);
  const op = new Uint8Array(size); // 默认 0 === NOOP，与上游初始值一致

  // 第一行：全部由删除 x 得到
  for (let i = 1; i < cols; i++) {
    parent[i] = 0;
    op[i] = DELETION;
    cost[i] = i * DELETION_COST + INITIAL_MISMATCH_PENALTY;
  }
  // 第一列：全部由插入 y 得到
  for (let j = 1; j < rows; j++) {
    const idx = j * cols;
    parent[idx] = 0;
    op[idx] = INSERTION;
    cost[idx] = j * INSERTION_COST + INITIAL_MISMATCH_PENALTY;
  }

  // mismatch_cost：在父格代价上加基础代价；父格若是 NoOp，说明这里**开启**了
  // 一段新的改动群，额外罚 INITIAL_MISMATCH_PENALTY。
  const mismatchCost = (p, basic) =>
    cost[p] + basic + (op[p] === NOOP ? INITIAL_MISMATCH_PENALTY : 0);

  for (let i = 0; i < nx; i++) {
    const xi = x[i];
    for (let j = 0; j < ny; j++) {
      const left = (j + 1) * cols + i; // index(i, j+1)
      const diag = j * cols + i; // index(i, j)
      const up = j * cols + (i + 1); // index(i+1, j)
      const idx = (j + 1) * cols + (i + 1);

      // 候选 1：Insertion（消费一个 y token）
      let bestCost = mismatchCost(up, INSERTION_COST);
      let bestParent = up;
      let bestOp = INSERTION;

      // 候选 2：Deletion（消费一个 x token）
      const delCost = mismatchCost(left, DELETION_COST);
      if (delCost < bestCost) {
        bestCost = delCost;
        bestParent = left;
        bestOp = DELETION;
      }

      // 候选 3：NoOp（两侧 token 相同才可行）。严格 < 保证「同代价取先者」，
      // 与上游 min_by_key 的稳定选择行为一致。
      if (xi === y[j] && cost[diag] < bestCost) {
        bestCost = cost[diag];
        bestParent = diag;
        bestOp = NOOP;
      }

      cost[idx] = bestCost;
      parent[idx] = bestParent;
      op[idx] = bestOp;
    }
  }

  // 从右下角回溯到 (0,0)，得到正序操作序列
  /** @type {number[]} */
  const ops = [];
  let cell = ny * cols + nx;
  for (;;) {
    ops.push(op[cell]);
    if (parent[cell] === 0) break;
    cell = parent[cell];
  }
  ops.reverse();

  // run-length 合并（对应 align.rs::run_length_encode）
  /** @type {Array<[number, number]>} */
  const encoded = [];
  if (!ops.length) return encoded;
  let cur = ops[0];
  let run = 1;
  for (let k = 1; k < ops.length; k++) {
    if (ops[k] === cur) {
      run++;
    } else {
      encoded.push([cur, run]);
      cur = ops[k];
      run = 1;
    }
  }
  encoded.push([cur, run]);
  return encoded;
}

// ---------------------------------------------------------------------------
// 标注（对应 delta src/edits.rs::annotate + compute_distance）
// ---------------------------------------------------------------------------

/**
 * 一段改动区间。偏移相对**所在行的行首**，与 inline-word-diff.js 的
 * WordDiffRange 结构保持一致，可直接互换使用。
 * @typedef {Object} DiffRange
 * @property {number} from 起始偏移（含）
 * @property {number} to   结束偏移（不含）
 * @property {'added'|'removed'} type
 */

/** 距离贡献：段内非空白内容的码点数（对应上游 distance_contribution）。 */
function distanceWeight(section) {
  const trimmed = section.trim();
  if (!trimmed) return 0;
  // 码点数而非 UTF-16 长度：避免 emoji / 罕用字被记成 2。
  let n = 0;
  for (const _ of trimmed) n++;
  return n;
}

/**
 * 对一组已配对的行做 token 级标注，返回两侧的改动区间与「距离」。
 *
 * 距离 = 改动段权重和 / 总权重和（NoOp 段按双侧计入，故权重 ×2）。
 * 取值 0（完全相同）~ 1（毫无共同内容）。这与上游 compute_distance 一致。
 *
 * @param {string} minusLine 左侧 / 变更前的一行
 * @param {string} plusLine  右侧 / 变更后的一行
 * @returns {{minusRanges: DiffRange[], plusRanges: DiffRange[], distance: number}}
 */
export function annotatePair(minusLine, plusLine) {
  const before = typeof minusLine === "string" ? minusLine : "";
  const after = typeof plusLine === "string" ? plusLine : "";
  if (before === after) {
    return { minusRanges: [], plusRanges: [], distance: 0 };
  }

  const x = tokenize(before);
  const y = tokenize(after);

  // 防爆短路（见 MAX_TOKENS 说明）：超长行不做精确对齐，整行判为改动。
  // 距离给 1（最大值）意味着它不会被误判成「同源行」——超长行的相似度无从判断时，
  // 保守地当成两个独立的行更安全。
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) {
    return {
      minusRanges: before ? [{ from: 0, to: before.length, type: "removed" }] : [],
      plusRanges: after ? [{ from: 0, to: after.length, type: "added" }] : [],
      distance: 1,
    };
  }

  const operations = alignOperations(x, y);

  /** @type {DiffRange[]} */
  const minusRanges = [];
  /** @type {DiffRange[]} */
  const plusRanges = [];

  let xTok = 0; // 已消费的 x token 数
  let yTok = 0; // 已消费的 y token 数
  let minusOffset = 0; // 已消费的 before 字符数
  let plusOffset = 0; // 已消费的 after 字符数
  let numer = 0;
  let denom = 0;
  // 上一段的操作类型，用于「空白段并入前一改动段」的判定（上游 coalesce_space_with_previous）
  let minusPrevChanged = false;
  let plusPrevChanged = false;

  /** 取 x 的接下来 n 个 token 在 before 中对应的子串区间，并推进偏移。 */
  const takeMinus = (n) => {
    let len = 0;
    for (let k = 0; k < n; k++) len += x[xTok + k].length;
    const from = minusOffset;
    minusOffset += len;
    xTok += n;
    return { from, to: minusOffset };
  };
  const takePlus = (n) => {
    let len = 0;
    for (let k = 0; k < n; k++) len += y[yTok + k].length;
    const from = plusOffset;
    plusOffset += len;
    yTok += n;
    return { from, to: plusOffset };
  };

  /** 追加区间；与上一段紧邻且同型时合并，避免产出大量碎片区间。 */
  const push = (list, seg, type) => {
    if (seg.to <= seg.from) return;
    const last = list[list.length - 1];
    if (last && last.type === type && last.to === seg.from) {
      last.to = seg.to;
      return;
    }
    list.push({ from: seg.from, to: seg.to, type });
  };

  for (const [operation, n] of operations) {
    if (operation === DELETION) {
      const seg = takeMinus(n);
      const w = distanceWeight(before.slice(seg.from, seg.to));
      denom += w;
      numer += w;
      push(minusRanges, seg, "removed");
      minusPrevChanged = true;
    } else if (operation === INSERTION) {
      const seg = takePlus(n);
      const w = distanceWeight(after.slice(seg.from, seg.to));
      denom += w;
      numer += w;
      push(plusRanges, seg, "added");
      plusPrevChanged = true;
    } else {
      // NoOp：两侧同时消费 n 个 token
      const mSeg = takeMinus(n);
      const pSeg = takePlus(n);
      const w = distanceWeight(before.slice(mSeg.from, mSeg.to));
      denom += 2 * w;
      // 纯空白的 NoOp 段夹在两段改动之间时并入改动（上游 coalesce_space_with_previous）：
      // 否则 "foo bar" → "baz bar" 这类改动会在两个高亮块之间露出一道未着色窄缝。
      // 判定条件比上游简化：上游还要求「不是最后一段」，此处用「本段之后仍有操作」
      // 等价表达 —— 但我们无法预知后续，故改为只在**两侧都刚发生过改动**时并入，
      // 行尾空白因此不会被误染（行尾之后不可能再有改动段跟上）。
      const isSpace = before.slice(mSeg.from, mSeg.to).trim() === "";
      if (isSpace && minusPrevChanged && plusPrevChanged) {
        push(minusRanges, mSeg, "removed");
        push(plusRanges, pSeg, "added");
        // 保持 prevChanged 为真：连续多个空白段应一并并入
      } else {
        minusPrevChanged = false;
        plusPrevChanged = false;
      }
    }
  }

  return {
    minusRanges,
    plusRanges,
    distance: denom > 0 ? numer / denom : 0,
  };
}

// ---------------------------------------------------------------------------
// 同源行配对（对应 delta src/edits.rs::infer_edits）
// ---------------------------------------------------------------------------

/**
 * 一对被判定为「同源」的行（内容有改动但仍是同一行的两个版本）。
 * @typedef {Object} HomologousPair
 * @property {number} minusIndex 在 minusLines 中的下标（0-based）
 * @property {number} plusIndex  在 plusLines 中的下标（0-based）
 * @property {DiffRange[]} minusRanges 左侧行内被删除的区间
 * @property {DiffRange[]} plusRanges  右侧行内被新增的区间
 * @property {number} distance 归一化编辑距离，0=完全相同
 */

/**
 * infer_edits 的输出。
 * @typedef {Object} InferredEdits
 * @property {HomologousPair[]} pairs 同源行对（可做 token 级高亮）
 * @property {number[]} unpairedMinus 只存在于左侧的行下标（**独属内容**）
 * @property {number[]} unpairedPlus  只存在于右侧的行下标（**独属内容**）
 * @property {Array<[number|null, number|null]>} alignment 完整对齐规格，
 *   元素形如 [minusIndex, plusIndex]，未配对的一侧为 null。顺序即渲染顺序。
 * @property {boolean} degraded 是否因超出 MAX_PAIR_ATTEMPTS 预算而提前降级
 *   （true 表示后半段行未做同源判定、一律按独属内容处理）
 */

/**
 * 推断一组 minus 行与 plus 行之间的编辑操作。
 *
 * 【算法（贪心，与 delta 完全一致）】
 *   对每个 minus 行，从「尚未被消费的第一个 plus 行」开始向后扫描：
 *     · 算一次 annotatePair，得到距离 d；
 *     · d 满足阈值 → 判定同源：把扫描途中跳过的那些 plus 行全部登记为
 *       「右侧独属」，然后把这一对登记为同源，plus 游标推进到该行之后，
 *       **立刻处理下一个 minus 行**（贪心，不再回头找更优配对）；
 *     · 扫完仍无匹配 → 该 minus 行登记为「左侧独属」，plus 游标**不动**
 *       （这些 plus 行还要留给后面的 minus 行去匹配）。
 *   全部 minus 行处理完后，剩余未消费的 plus 行全部是「右侧独属」。
 *
 * 【为什么贪心而不是全局最优】全局最优（对 minus×plus 做二次对齐）代价是
 * O(m*n) 次行对齐，每次又是 O(token²)，在编辑器里每 200ms 跑一次不可承受。
 * delta 亦采用贪心。代价是极端交错的改动可能配对不理想，但因为
 * @codemirror/merge 已先做过行级 diff、送进来的本就是一个较小的块，实际影响很小。
 *
 * @param {string[]} minusLines 左侧行数组
 * @param {string[]} plusLines  右侧行数组
 * @param {Object} [opts]
 * @param {number} [opts.maxLineDistance] 同源阈值，默认 0.6（delta 默认值）
 * @param {number} [opts.maxLineDistanceNaive] 两侧行数相等时的更严阈值，默认 0
 * @returns {InferredEdits}
 */
export function inferEdits(minusLines, plusLines, opts) {
  const minus = Array.isArray(minusLines) ? minusLines : [];
  const plus = Array.isArray(plusLines) ? plusLines : [];
  const maxDist = Number.isFinite(opts?.maxLineDistance)
    ? opts.maxLineDistance
    : DEFAULT_MAX_LINE_DISTANCE;
  const maxDistNaive = Number.isFinite(opts?.maxLineDistanceNaive)
    ? opts.maxLineDistanceNaive
    : DEFAULT_MAX_LINE_DISTANCE_NAIVE;
  const naivelyPaired = minus.length === plus.length;

  /** @type {HomologousPair[]} */
  const pairs = [];
  /** @type {number[]} */
  const unpairedMinus = [];
  /** @type {number[]} */
  const unpairedPlus = [];
  /** @type {Array<[number|null, number|null]>} */
  const alignment = [];

  let plusIndex = 0; // 已消费（已登记进 alignment）的 plus 行数
  let attempts = 0;
  let degraded = false;

  for (let minusIndex = 0; minusIndex < minus.length; minusIndex++) {
    const minusLine = minus[minusIndex];
    let matched = false;

    if (!degraded) {
      // considered：本轮向后扫描时「看过但判定不同源」的 plus 行数
      let considered = 0;
      for (let p = plusIndex; p < plus.length; p++) {
        if (++attempts > MAX_PAIR_ATTEMPTS) {
          degraded = true;
          break;
        }
        const res = annotatePair(minusLine, plus[p]);
        const ok =
          (naivelyPaired && res.distance <= maxDistNaive) || res.distance <= maxDist;
        if (!ok) {
          considered++;
          continue;
        }
        // 命中同源：先把途中跳过的 plus 行登记为右侧独属，保持渲染顺序正确
        for (let k = 0; k < considered; k++) {
          unpairedPlus.push(plusIndex);
          alignment.push([null, plusIndex]);
          plusIndex++;
        }
        pairs.push({
          minusIndex,
          plusIndex,
          minusRanges: res.minusRanges,
          plusRanges: res.plusRanges,
          distance: res.distance,
        });
        alignment.push([minusIndex, plusIndex]);
        plusIndex++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // 无同源行：本行只存在于左侧
      unpairedMinus.push(minusIndex);
      alignment.push([minusIndex, null]);
    }
  }

  // 尾部剩余的 plus 行全部是右侧独属
  for (; plusIndex < plus.length; plusIndex++) {
    unpairedPlus.push(plusIndex);
    alignment.push([null, plusIndex]);
  }

  return { pairs, unpairedMinus, unpairedPlus, alignment, degraded };
}

/**
 * 便捷封装：把 inferEdits 的结果直接转成 inline-word-diff.js 可消费的
 * WordDiffData[]（`{ lineNumber, ranges }`，lineNumber 为 1-based 文档行号）。
 *
 * 与 inline-word-diff.js 的 buildWordDiffData 是**平行**关系：
 *   · buildWordDiffData 按下标配对，只适用于两侧行数相等的块；
 *   · 本函数按同源度配对，适用于任意 N↔M 块，是前者的超集。
 * 保留前者是因为「行数相等」是最常见情形，下标配对开销为零且结果与本函数一致。
 *
 * @param {string[]} minusLines
 * @param {string[]} plusLines
 * @param {'before'|'after'} side 生成哪一侧的数据
 * @param {number} startLineNumber 这批行在目标文档中的起始行号（1-based）
 * @param {Object} [opts] 透传给 inferEdits
 * @returns {Array<{lineNumber:number, ranges:DiffRange[]}>}
 */
export function buildAlignedWordDiffData(
  minusLines,
  plusLines,
  side,
  startLineNumber,
  opts
) {
  const { pairs } = inferEdits(minusLines, plusLines, opts);
  const base = Number.isFinite(startLineNumber) ? startLineNumber : 1;
  const out = [];
  for (const pair of pairs) {
    const ranges = side === "before" ? pair.minusRanges : pair.plusRanges;
    if (!ranges.length) continue;
    const idx = side === "before" ? pair.minusIndex : pair.plusIndex;
    out.push({ lineNumber: base + idx, ranges });
  }
  return out;
}

/**
 * 把下标数组压成连续区间（如 [0,1,2,5,6] → [[0,2],[5,6]]）。
 *
 * 独属内容连线**必须按块画**而不是按行画：一段连续 12 行的新增若逐行画 12 条连线，
 * 会在两栏之间糊成一片彩色噪声，反而看不出「这里整段是新增的」。合并成一条覆盖
 * 整段跨度的连接带才是 GitHub / Meld 的做法。
 *
 * @param {number[]} indexes 升序下标数组（inferEdits 的输出天然升序）
 * @returns {Array<[number, number]>} [起, 止] 闭区间数组
 */
export function toRuns(indexes) {
  /** @type {Array<[number, number]>} */
  const runs = [];
  if (!indexes || !indexes.length) return runs;
  let start = indexes[0];
  let prev = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const v = indexes[i];
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    runs.push([start, prev]);
    start = v;
    prev = v;
  }
  runs.push([start, prev]);
  return runs;
}

/**
 * 由 inferEdits 的结果构造「独属内容 → 对侧插入点」的同色楔形连接带对。
 *
 * 【纯函数 · 不依赖 CodeMirror · 可被 node:test 直接单测】
 * 这是 compare-merge.js refreshDecorations 里「N↔M 块独属内容连线」逻辑的提炼，
 * 抽出来单独测试，避免为了验证几个偏移就把整个 MergeView 拉进测试环境。
 *
 * 端点形态（与 move-connectors.js 的 ConnectorPair 约定一致）：
 *   · 左侧独有（removed）：span 落在 A 侧 [aStart+r0, aStart+r1]，尖端（dstCaret）指向
 *     B 侧块尾之后的插入点（bStart + bLines.length）——「这段被删的内容原本该插在哪」。
 *   · 右侧独有（added）：span 落在 B 侧 [bStart+r0, bStart+r1]，尖端（srcCaret）指向
 *     A 侧块尾之后的插入点（aStart + aLines.length）。
 * 两种对都塞进同一个 A↔B 方向层（fromView=A, toView=B）：removed 的 span 在一端、
 * added 的 span 在另一端，端点形态由 *Caret 布尔字段声明，move-connectors 据此
 * 把连接带退化成楔形。
 *
 * @param {string[]} aLines 左侧块行数组（0-based）
 * @param {string[]} bLines 右侧块行数组（0-based）
 * @param {number} aStart 左侧块在文档中的起始行号（1-based，闭区间）
 * @param {number} bStart 右侧块在文档中的起始行号（1-based，闭区间）
 * @param {InferredEdits} [precomputed] 已算好的 inferEdits 结果，传入可省一次对齐计算
 *   （浏览器主线程每 200ms 重算一次，少算一次 Worth）。缺省会自动算。
 * @returns {Array<{srcStartLine:number,srcEndLine:number,dstStartLine:number,dstEndLine:number,srcCaret:boolean,dstCaret:boolean,variant:'added'|'removed'}>}
 */
export function buildExclusiveConnectorPairs(aLines, bLines, aStart, bStart, precomputed) {
  const ie =
    precomputed && Array.isArray(precomputed.unpairedMinus)
      ? precomputed
      : inferEdits(aLines, bLines, { maxLineDistance: DEFAULT_MAX_LINE_DISTANCE });
  /** @type {Array<{srcStartLine:number,srcEndLine:number,dstStartLine:number,dstEndLine:number,srcCaret:boolean,dstCaret:boolean,variant:'added'|'removed'}>} */
  const pairs = [];
  // 配对表按 minusIndex / plusIndex 升序（greedy 保证），用于推算精确插入点。
  // 【关键】独属内容（未配对行）的「插入位置」不是所在块的块尾，而是它在同源序列中
  // 紧邻的**前一条已配对行之后**——否则「块中间插入 / 块中间删除」场景，连线会画到块尾，
  // 明显偏掉（team-lead 真机验收明确点名此场景）。
  const aligned = ie.pairs;
  // 紧邻 p 之前、且已配对的 plus 行对应的配对（按 plusIndex 升序取最后一个 < p）。
  const prevAlignedPlus = (p) => {
    let best = null;
    for (const pr of aligned) {
      if (pr.plusIndex < p) best = pr;
      else break;
    }
    return best;
  };
  // 同理取紧邻 m 之前已配对的 minus 行对应的配对。
  const prevAlignedMinus = (m) => {
    let best = null;
    for (const pr of aligned) {
      if (pr.minusIndex < m) best = pr;
      else break;
    }
    return best;
  };
  for (const [r0, r1] of toRuns(ie.unpairedMinus)) {
    // 左侧独有（removed）：span 在 A 侧 [aStart+r0, aStart+r1]，尖端指向 B 侧插入点——
    // 即紧邻前一条已配对 minus 行所对应的 plus 行之后；若块首之前（无前驱）则指向 B 侧块首。
    const prev = prevAlignedMinus(r0);
    const dstLine = prev ? bStart + prev.plusIndex + 1 : bStart;
    pairs.push({
      srcStartLine: aStart + r0,
      srcEndLine: aStart + r1,
      dstStartLine: dstLine,
      dstEndLine: dstLine,
      srcCaret: false,
      dstCaret: true,
      variant: "removed",
    });
  }
  for (const [r0, r1] of toRuns(ie.unpairedPlus)) {
    // 右侧独有（added）：span 在 B 侧 [bStart+r0, bStart+r1]，尖端指向 A 侧插入点——
    // 即紧邻前一条已配对 plus 行所对应的 minus 行之后；若块首之前则指向 A 侧块首。
    const prev = prevAlignedPlus(r0);
    const srcLine = prev ? aStart + prev.minusIndex + 1 : aStart;
    pairs.push({
      srcStartLine: srcLine,
      srcEndLine: srcLine,
      dstStartLine: bStart + r0,
      dstEndLine: bStart + r1,
      srcCaret: true,
      dstCaret: false,
      variant: "added",
    });
  }
  return pairs;
}
