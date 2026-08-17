// ==========================================
// 斜杠菜单 - 纯逻辑核心（零依赖，可单测）
// ------------------------------------------
// 本模块只放「不依赖 CodeMirror / DOM」的纯数据与纯函数：
//   - 命令表（纯数据：插入片段 + 占位符，由 slash-menu.js 负责真正 dispatch）
//   - 触发正则与匹配函数
//   - 查询过滤函数
//   - 代码块节点判定（接受任意 { name, parent } 形状，便于单测）
//   - 浮层视口约束计算
// 移植自 markra 的 slash-menu.ts / CodeMirrorEditorFloatingMenus.tsx。
// ==========================================

// 触发正则（BUG4 定稿，2026-08-08 用户拍板）：唯一触发符是半角 `/`，
// 后跟「非空白/非 `/`」查询词。中文顿号 `、` 已取消触发资格（此前顿号无前置
// 限制，导致「苹果、」+ Enter 被空查询面板吞掉并误插入 `# `，实测 FAIL）。
// 触发符前可跟任意文本（不限于行首缩进），前置放行由 isSlashPrecedingAllowed 判定。
// 代码块内不触发由 isInsideCodeBlock 负责。与 markra 保持一致（`u` 标志）。
export const SLASH_TRIGGER_RE = /^(.*)\/([^\s/]*)$/u;

// 虚拟触发（由外部命令唤起，无 `/` 前缀）时，查询词中不允许出现的字符。
// `、` 不再是触发符，故也不再是查询词非法字符（仅当普通字符参与过滤）。
export const SLASH_QUERY_INVALID_RE = /\s|\//u;

// syntaxTree 中代表代码块的节点名（Markdown 语言包）。
export const CODE_BLOCK_NODE_NAMES = ['FencedCode', 'CodeBlock'];

/**
 * 判定 `/` 紧邻前一字符是否允许触发斜杠菜单（BUG4 定稿规则）。
 *
 * 用户拍板的验收口径（行首 / 行中 / 行尾任意位置均适用）：
 *   激活：行首直接 `/`；中文 + `/`；英文单词 + 空格 + `/`；数字 + 空格 + `/`；
 *        http 或 https + 空格 + `/`
 *   不激活：数字 + `/`（如 2026/08）；http + `/`；https + `/`；https:// 等 URL 片段
 *
 * 归一后的唯一判据 = 「`/` 前紧邻字符」：
 *   放行 → 无前字符（行首）| 空白 | 非 ASCII 码点（中文及中文标点、全角符号）
 *   拦截 → 任何 ASCII 可见字符（字母 / 数字 / 半角标点，天然含 `:` 与 `/`）
 * 用「非 ASCII 放行」而非枚举 CJK 区段，可一并覆盖中文标点、日文假名等，
 * 且不需要 lookbehind（360Chrome 兼容）。
 *
 * @param {string} before 触发符 `/` 之前的全部行内文本
 * @returns {boolean}
 */
export function isSlashPrecedingAllowed(before) {
  if (typeof before !== 'string' || before.length === 0) return true; // 行首
  // Array.from 按码点切分，避免把 emoji 等代理对拆成半个字符后误判。
  const codePoints = Array.from(before);
  const last = codePoints[codePoints.length - 1];
  if (/\s/u.test(last)) return true; // 单词 / 数字 / http(s) + 空格 + `/`
  return (last.codePointAt(0) ?? 0) > 0x7f; // 中文等非 ASCII 直接接 `/`
}

/**
 * 匹配光标前文本是否构成斜杠菜单触发。
 * @param {string} textBeforeCursor 当前行行首到光标处的文本
 * @returns {{ before: string, query: string } | null}
 *   before：触发符 `/` 前的全部文本（行首缩进放松为任意文本，含列表前缀等）
 *   query ：`/` 后到行尾间、非空白非 `/` 的过滤词
 * 前置放行规则见 isSlashPrecedingAllowed。
 */
export function matchSlashTrigger(textBeforeCursor) {
  if (typeof textBeforeCursor !== 'string') return null;
  const match = SLASH_TRIGGER_RE.exec(textBeforeCursor);
  if (!match) return null;
  const before = match[1] ?? '';
  if (!isSlashPrecedingAllowed(before)) return null;
  return { before, query: match[2] ?? '' };
}

/**
 * 沿 parent 链判断某语法节点是否位于代码块内部。
 * 接受任意 { name, parent } 形状的对象，因此可脱离 CodeMirror 单测。
 * @param {{ name: string, parent: any } | null} node
 */
export function nodeChainHasCodeBlock(node) {
  let current = node;
  while (current) {
    if (CODE_BLOCK_NODE_NAMES.includes(current.name)) return true;
    current = current.parent ?? null;
  }
  return false;
}

// ------------------------------------------
// 命令表（纯数据）
// ------------------------------------------
// insert:      要插入的 Markdown 片段（`/query` 会在插入前被删除）
// placeholder: 插入后需要被选中的占位文本（取首次出现位置）；不填则用 cursor
// cursor:      插入后光标相对片段起点的偏移；不填且无 placeholder 时落在片段末尾
// keywords:    过滤用的别名（英文 / 拼音 / 符号）
export const SLASH_COMMANDS = [
  {
    command: 'heading1',
    label: '标题 1',
    keywords: ['h1', 'heading1', 'title', 'biaoti', '#'],
    insert: '# ',
  },
  {
    command: 'heading2',
    label: '标题 2',
    keywords: ['h2', 'heading2', 'biaoti', '##'],
    insert: '## ',
  },
  {
    command: 'heading3',
    label: '标题 3',
    keywords: ['h3', 'heading3', 'biaoti', '###'],
    insert: '### ',
  },
  {
    command: 'bold',
    label: '粗体',
    keywords: ['bold', 'strong', 'cuti', 'jiacu', '加粗', '**'],
    insert: '**加粗文本**',
    placeholder: '加粗文本',
  },
  {
    command: 'italic',
    label: '斜体',
    keywords: ['italic', 'em', 'xieti', '*'],
    insert: '*斜体文本*',
    placeholder: '斜体文本',
  },
  {
    command: 'inline-code',
    label: '行内代码',
    keywords: ['code', 'inlinecode', 'daima', '`'],
    insert: '`code`',
    placeholder: 'code',
  },
  {
    command: 'code-block',
    label: '代码块',
    keywords: ['codeblock', 'fence', 'daimakuai', '```'],
    insert: '```\n\n```',
    cursor: 4,
  },
  {
    command: 'bullet-list',
    label: '无序列表',
    keywords: ['ul', 'list', 'bullet', 'liebiao', '-'],
    insert: '- ',
  },
  {
    command: 'ordered-list',
    label: '有序列表',
    keywords: ['ol', 'list', 'ordered', 'number', 'liebiao', '1.'],
    insert: '1. ',
  },
  {
    command: 'quote',
    label: '引用',
    keywords: ['quote', 'blockquote', 'yinyong', '>'],
    insert: '> ',
  },
  {
    command: 'table',
    label: '表格',
    keywords: ['table', 'biaoge', '|'],
    insert: '| 列1 | 列2 |\n| --- | --- |\n|  |  |',
    placeholder: '列1',
  },
  {
    command: 'divider',
    label: '分割线',
    keywords: ['hr', 'divider', 'rule', 'fengexian', '---'],
    insert: '---\n',
  },
  {
    command: 'image',
    label: '图片',
    keywords: ['image', 'img', 'picture', 'tupian', '!'],
    insert: '![描述](url)',
    placeholder: 'url',
  },
  {
    command: 'link',
    label: '链接',
    keywords: ['link', 'url', 'lianjie', '['],
    insert: '[文本](url)',
    placeholder: 'url',
  },
];

/**
 * 按查询词过滤命令表（大小写不敏感，匹配 label / keywords / command id）。
 * 空查询返回全部命令，顺序保持定义顺序。
 * @param {string} query
 * @param {Array<object>} [commands]
 * @returns {Array<object>}
 */
export function filterSlashCommands(query, commands = SLASH_COMMANDS) {
  const normalized = String(query ?? '').trim().toLowerCase();
  if (!normalized) return commands.slice();
  return commands.filter((item) => {
    if (item.command.toLowerCase().includes(normalized)) return true;
    if (item.label.toLowerCase().includes(normalized)) return true;
    return (item.keywords ?? []).some((keyword) =>
      String(keyword).toLowerCase().includes(normalized)
    );
  });
}

/**
 * 计算插入片段后的选区偏移（相对片段起点）。
 * @param {object} command
 * @returns {{ anchor: number, head: number }}
 */
export function selectionOffsetsFor(command) {
  const text = command.insert ?? '';
  if (command.placeholder) {
    const index = text.indexOf(command.placeholder);
    if (index >= 0) {
      return { anchor: index, head: index + command.placeholder.length };
    }
  }
  if (typeof command.cursor === 'number') {
    return { anchor: command.cursor, head: command.cursor };
  }
  return { anchor: text.length, head: text.length };
}

// ------------------------------------------
// 浮层定位（移植自 markra fitCodeMirrorFloatingMenu）
// ------------------------------------------
export const FLOATING_MENU_MARGIN = 12;
export const SLASH_MENU_MAX_HEIGHT = 320;
export const SLASH_MENU_WIDTH = 240;

/**
 * 把浮层约束在视口内。
 * @param {{ left: number, top: number }} anchor
 * @param {{ width: number, height: number }} menu
 * @param {{ width: number, height: number }} viewport
 * @returns {{ left: number, top: number }}
 */
export function fitFloatingMenu(anchor, menu, viewport) {
  return {
    left: Math.max(
      FLOATING_MENU_MARGIN,
      Math.min(anchor.left, viewport.width - menu.width - FLOATING_MENU_MARGIN)
    ),
    top: Math.max(
      FLOATING_MENU_MARGIN,
      Math.min(anchor.top, viewport.height - menu.height - FLOATING_MENU_MARGIN)
    ),
  };
}
