// ============================================================
// A-6 代码块语言名补全
// 在 ``` 围栏后的语言名位置，弹出语言候选（含简写展开 py→python）。
// 复用已安装的 @codemirror/language-data 的 languages 列表。
// 依赖：@codemirror/autocomplete、@codemirror/language-data
// ============================================================
// 说明：codeBlockLanguageCompletions 在运行期通过动态 import 懒加载
// @codemirror/language-data 的 languages，避免无 node_modules 环境下
// 静态 import 导致模块加载失败（测试可独立 import 纯逻辑 buildLanguageCompletions）。

// 常用简写 → 标准语言名
const ALIASES = {
  py: 'python', js: 'javascript', ts: 'typescript', yml: 'yaml',
  sh: 'bash', md: 'markdown', rs: 'rust', 'c++': 'cpp', 'c#': 'csharp',
  ht: 'html', kx: 'kotlin', kt: 'kotlin', go: 'go', rb: 'ruby', pl: 'perl',
};

// 子序列模糊匹配：query 的字符是否按顺序出现在 label 中
function fuzzyMatch(query, label) {
  let i = 0;
  for (let j = 0; j < label.length && i < query.length; j++) {
    if (label[j] === query[i]) i++;
  }
  return i === query.length;
}

// 由 query 构建候选（纯逻辑，不依赖 CM6 包）
// langs: @codemirror/language-data 的 LanguageDescription[]（可选，默认空数组，
//        便于在无 node_modules 环境下独立测试，此时仅由 ALIASES 提供常见语言）。
// 返回 CompletionOption[] 或 null（无候选时）。
export function buildLanguageCompletions(query, langs = []) {
  const q = (query || '').toLowerCase();

  // 1) 收集基础 label 集合：languages 的 name/alias + ALIASES 值
  const base = new Map(); // label -> detail
  for (const lang of langs) {
    if (lang && lang.name) base.set(lang.name, 'language');
    const alias = lang && lang.alias;
    if (alias) {
      const arr = Array.isArray(alias) ? alias : [alias];
      for (const a of arr) if (a) base.set(a, 'language');
    }
  }
  for (const key of Object.keys(ALIASES)) {
    const full = ALIASES[key];
    // 简写目标作为候选，detail 标记来源简写
    if (!base.has(full)) base.set(full, 'alias:' + key);
  }

  // 2) 空 query：返回全部候选
  if (q === '') {
    const options = [];
    for (const [label, detail] of base) {
      options.push({ label, type: 'text', detail });
    }
    return options.length ? options : null;
  }

  // 3) 非空 query：简写优先展开 + 模糊/前缀匹配
  const seen = new Set();
  const options = [];
  const add = (label, detail) => {
    if (seen.has(label)) return;
    seen.add(label);
    options.push({ label, type: 'text', detail });
  };

  // 简写直接展开（最高优先级，保证 py→python / js→javascript / go→go）
  if (ALIASES[q]) add(ALIASES[q], 'alias:' + q);

  // 基础集合内按前缀或模糊匹配
  for (const [label, detail] of base) {
    const l = label.toLowerCase();
    if (l.startsWith(q) || fuzzyMatch(q, l)) add(label, detail);
  }

  return options.length ? options : null;
}

// CodeMirror 6 自动补全源：在 ``` 围栏后的语言名位置弹出候选
// context: @codemirror/autocomplete 的 CompletionContext
export async function codeBlockLanguageCompletions(context) {
  // 光标是否紧接在 ``` 之后（围栏语言位）
  const match = context.matchBefore(/```(\w*)$/);
  if (!match) return null;

  const query = match.text.slice(3); // 跳过 ``` 三个反引号

  // 运行期懒加载 languages（无 node_modules 时降级为空数组）
  let langs = [];
  try {
    const mod = await import('@codemirror/language-data');
    if (mod && Array.isArray(mod.languages)) langs = mod.languages;
  } catch (_) {
    langs = [];
  }

  const options = buildLanguageCompletions(query, langs);
  if (!options || options.length === 0) return null;

  return {
    from: match.from + 3, // 跳过 ``` 三个反引号
    to: context.pos,
    options,
  };
}
