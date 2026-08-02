// 符号配对高亮纯逻辑（从 editor.js 抽取以便单元测试，行为不变）
// 选中单个配对符号时，用于高亮其对应的另一半。

// 开闭不同的符号（有序对：open → close）
export const PAIR_GROUPS = [
  ['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'],
  ['\u201c', '\u201d'], // 中文双引号（左→右）
  ['\u2018', '\u2019'], // 中文单引号（左→右）
  ['\uff08', '\uff09'], // 全角圆括号（左→右）
];

// 开闭相同的符号（英文单/双引号及反引号，自身配对，无法用方向栈区分，需就近匹配）
export const SELF_PAIRS = ["'", '"', '`'];

export const bracketMatchMap = {};
for (const [open, close] of PAIR_GROUPS) {
  bracketMatchMap[open] = { other: close, dir: 1, type: 'pair' };
  bracketMatchMap[close] = { other: open, dir: -1, type: 'pair' };
}
for (const ch of SELF_PAIRS) {
  bracketMatchMap[ch] = { other: ch, type: 'self' };
}

// 自身配对符号（如英文引号）的就近匹配：按出现序号确定开/闭，找最近的同字符配对
export function findSelfPair(docText, ch, from) {
  let count = 0;
  for (let i = 0; i < from; i++) if (docText[i] === ch) count++;
  if (count % 2 === 0) {
    // 开引号：向 from 之后找最近的同字符
    for (let i = from + 1; i < docText.length; i++) if (docText[i] === ch) return i;
  } else {
    // 闭引号：向 from 之前找最近的同字符
    for (let i = from - 1; i >= 0; i--) if (docText[i] === ch) return i;
  }
  return null;
}

// 括号栈匹配：从选中字符向对应方向扫描，返回配对字符位置
export function findPairedBracket(docText, ch, info, from) {
  if (info.type === 'self') return findSelfPair(docText, ch, from);
  const other = info.other;
  if (info.dir === 1) {
    let depth = 0;
    for (let i = from + 1; i < docText.length; i++) {
      const c = docText[i];
      if (c === ch) depth++;
      else if (c === other) {
        if (depth === 0) return i;
        depth--;
      }
    }
  } else {
    let depth = 0;
    for (let i = from - 1; i >= 0; i--) {
      const c = docText[i];
      if (c === ch) depth++;
      else if (c === other) {
        if (depth === 0) return i;
        depth--;
      }
    }
  }
  return null;
}
