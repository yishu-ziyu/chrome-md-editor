// ============================================================
// A-6 代码块语言名补全
// 在 ``` 围栏后的语言名位置，弹出语言候选（含简写展开 py→python）。
// 复用已安装的 @codemirror/language-data 的 languages 列表。
// 依赖：@codemirror/autocomplete、@codemirror/language-data
// ============================================================
import { languages } from '@codemirror/language-data';

// 常用简写 → 标准语言名
const ALIASES = {
  py: 'python', js: 'javascript', ts: 'typescript', yml: 'yaml',
  sh: 'bash', md: 'markdown', rs: 'rust', 'c++': 'cpp', 'c#': 'csharp',
  ht: 'html', kx: 'kotlin', kt: 'kotlin', go: 'go', rb: 'ruby', pl: 'perl',
};

// 候选补全源：仅当光标紧接在 ``` 之后（围栏语言位）时触发
export function codeBlockLanguageCompletions(context) {
  }
