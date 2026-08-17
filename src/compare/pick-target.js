// pick-target.js — 「选择文件 / 拖拽文件」按活动栏路由到目标栏的纯函数（可独立运行时单测）
//
// 背景（BUG 3 / 5 / 6）：
//   原 onPickFiles / onPageDrop 固定把选中的文件落到最左栏(files.a)或固定顺序
//   (dropped[0]→a, dropped[1]→b, dropped[2]→c) ，无视用户实际激活的栏。修复后
//   按 getActivePane() 路由。本文件把「活动栏 → 目标栏键」的映射抽成纯函数，
//   便于自动化回归 —— CDP 无法驱动系统原生文件框（showOpenFilePicker /
//   <input type=file>），故用纯函数单测锁定全部组合，弥补真机手动测试的自动化盲区。
//
// 语义（与设计文档 §4 栏位标签一致）：
//   - 对照(compare)模式：直接落到活动栏 a/b/c。
//   - 合并(merge)模式：只有【本地(a)】与【对方(c→files.b)】可作为源文件目标；
//     中栏(b=合并结果)是输出区，不可载入源文件。
//     点击中栏(b)时按"从左到右找第一个空栏"路由（BUG 6）：
//       若 files.a 已载入 → 落到对方(c/files.b)；
//       若 files.a 未载入 → 落到本地(a)。
//   - 拖拽多文件：第一个落活动栏，其余按 a→b→c 顺序填入空栏（BUG 5）。
//
// 纯函数约束：不读 DOM、不碰 localStorage、无副作用，便于 node 直接 import 断言。
//
// @param {'a'|'b'|'c'} active 当前活动栏（getActivePane 取值）
// @param {'compare'|'merge'} mode 当前模式
// @param {{a?:any,b?:any,c?:any}} [files] 当前 files 状态（用于「找空栏」判定；
//   省略时退化为旧 6 组合行为）
// @returns {'a'|'b'|'c'} 应当写入 files 的目标键
export function resolvePickTarget(active, mode, files) {
  if (mode === "merge") {
    // 合并右栏(c)在 UI 上显示「对方」，对应 files.b
    if (active === "c") return "b";
    // active === 'a' → 本地
    if (active === "a") return "a";
    // active === 'b'（合并结果栏，不可作源）→「从左到右找第一个空栏」
    if (active === "b") {
      if (files && isLoaded(files.a)) return "b"; // 本地已载 → 落到对方
      return "a"; // 本地未载 → 落到本地
    }
    return "a"; // 兜底
  }
  // 对照模式：直接落到活动栏
  return active;
}

// resolveDropTargets — 拖拽多文件路由（BUG 5）。
//
// 第一个文件落活动栏（getActivePane）；其余按 a→b→c 顺序填入「除已占用外」的
// 空栏位。当活动栏被「找空栏」规则改写（如合并中栏→a/c）时，第一个文件仍落
// 改写后的目标栏；其余按 a→b→c 顺序继续填。
//
// @param {'a'|'b'|'c'} active 当前活动栏
// @param {'compare'|'merge'} mode 当前模式
// @param {{a?:any,b?:any,c?:any}} files 当前 files 状态
// @param {number} count 拖入文件数（>=1）
// @returns {Array<'a'|'b'|'c'>} 长度=count 的目标键数组
export function resolveDropTargets(active, mode, files, count) {
  const n = Math.max(0, count | 0);
  if (!n) return [];
  const firstTarget = resolvePickTarget(active, mode, files);
  const out = [firstTarget];
  // 顺序优先级：本地(a) → 对方(b=files.b) → 文件三(c=files.c)
  // 注意：在合并模式下 c 栏=对方(files.b)，b 栏=合并结果(不可作源)。
  // 对照三栏：a→b→c；对照两栏：a→b 后忽略 c。
  const order =
    mode === "merge"
      ? ["a", "b"] // 合并：只能 a 或 b(files.b=对方)
      : ["a", "b", "c"]; // 对照：a/b/c 都可
  for (let i = 1; i < n; i++) {
    let picked = null;
    for (const k of order) {
      if (out.includes(k)) continue;
      if (isLoaded(files && files[k])) continue; // 已载：跳过
      picked = k;
      break;
    }
    // 全部栏已占 → 兜底循环覆盖（拖入多于栏位的文件 → 覆盖前几个）
    if (!picked) picked = order[(i - 1) % order.length];
    out.push(picked);
  }
  return out;
}

// 内部：判定 files[k] 是否"已载入"。
// 约定：files[k] 形如 { target, name, ... } 或 undefined/null。
// 文件未载入：null/undefined 或 target 为空。
function isLoaded(file) {
  if (!file) return false;
  if (file.target) return true;
  if (file.name) return true;
  return false;
}

// flipBcChunk — 「B↔C 采纳」翻转 chunk 区间（BUG 7）。
//
// 背景：CodeMirror MergeView 自带 A↔B 缝的 cm-merge-revert 列（采纳左/右 inline），
// 三栏布局下 B↔C 间是独立 EditorView 缝，**无内置 revert 列**，由 compare-merge.js 的
// mountBcRevertColumn + acceptBcChunkAt 补这一组（逐块「采纳左/右」）。
// getLayerViews('bc') = { srcView: theirsView, dstView: mv.b } 默认语义是「取 c 写 b」；
// 反向采纳 b 入 c 需把 chunk 里 srcFrom/srcTo 与 dstFrom/dstTo 互换，其它字段保留。
//
// 纯函数约束：无副作用，单测可锁全部组合。
//
// @param {Object} chunk 标准化的 chunk 形态：{ srcFrom, srcTo, dstFrom, dstTo, layer, conflict, ...rest }
// @returns {Object} 翻转后的 chunk（srcFrom↔dstFrom、srcTo↔dstTo），其它字段（包括 layer/conflict）保持不变
export function flipBcChunk(chunk) {
  if (!chunk || typeof chunk !== "object") return chunk;
  return {
    ...chunk,
    srcFrom: chunk.dstFrom,
    srcTo: chunk.dstTo,
    dstFrom: chunk.srcFrom,
    dstTo: chunk.srcTo,
  };
}