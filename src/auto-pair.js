// ============================================================
// 预览区符号自动配对（与 CodeMirror closeBrackets 行为对齐）
// ------------------------------------------------------------
// 【背景】编辑器侧使用 CodeMirror 的 closeBrackets 扩展，输入 `(` 自动补 `)` 并把
//   光标移回中间。预览区（contentEditable HTML）无此能力，导致两侧输入体验不一致。
//   本模块提供「输入开符号 → 自动补闭符号 → 光标回中间」的纯逻辑，可被预览编辑路径复用。
//   行为对齐 CM6 默认：nextChar 为字母/数字时不补（避免中间输入 "foo|" 变 "foo()|"）。
// ============================================================

// 唯一事实源：(open, close) 成对列出。中文开/闭为不同字符（U+201C/D、U+2018/9）。
const AUTO_PAIR_PAIRS = [
  ['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'],
  ["'", "'"], ['"', '"'], ['`', '`'],
  ['\u201c', '\u201d'], // " " 中文双引号（左/右）
  ['\u2018', '\u2019'], // ' ' 中文单引号（左/右）
  ['\uff08', '\uff09'], // （ ） 全角括号（左/右）
];

const AUTO_PAIR_MAP = new Map(AUTO_PAIR_PAIRS);

/**
 * 给定刚插入的字符与光标后一字符，返回应自动补的闭符号。
 * - `insertedChar` 不是任何开符号 → 返回 null
 * - `nextChar` 与将要插入的闭符号相同 → 返回 null（CM6 风格：已是闭符号则跳过，光标后移即可）
 * - `nextChar` 是字母/数字（\w）→ 返回 null（避免破坏中间输入："foo|" 不应变 "foo()|"）
 * - 其他情况 → 返回对应的闭符号
 *
 * @param {string} insertedChar 用户刚键入的字符
 * @param {string} nextChar     光标后一字符（无则为 ''）
 * @returns {string|null}       闭符号；不需要补时返回 null
 */
export function getAutoPairClose(insertedChar, nextChar) {
  if (typeof insertedChar !== 'string' || insertedChar.length !== 1) return null;
  const close = AUTO_PAIR_MAP.get(insertedChar);
  if (!close) return null;
  if (nextChar && typeof nextChar === 'string') {
    // 已是闭符号：跳过（调用方应只移动光标，不重复插入）
    if (nextChar === close) return null;
    // 后跟字母/数字：跳过（避免破坏中间输入）
    if (/[\w]/.test(nextChar)) return null;
  }
  return close;
}

/** 导出开闭配对表，便于其他模块复用与测试 */
export const AUTO_PAIR_TABLE = AUTO_PAIR_PAIRS;