// ============================================================
// A-7 Callout 提示框（Obsidian / GitHub 风格）
// 语法：以 `> [!TYPE]` 开头的引用块渲染为带标题与图标的提示块。
//   TYPE 支持 NOTE / TIP / IMPORTANT / WARNING / CAUTION 等。
// 通过 markdown-it 的 core ruler，在 block 解析后改写 blockquote token：
//   - 给 blockquote_open 加 class `callout callout-<type>` 与 data-callout 属性；
//   - 删除首行 `[!TYPE]` 标记并重解析剩余 inline；
//   - 在 blockquote 内最前插入 callout 标题（图标 + 名称，由 CSS 按 type 着色）。
// data-callout 属性用于「预览区失焦回写 Markdown」时还原 `[!TYPE]` 语法，
// 避免 WYSIWYG 把 callout 退化成普通引用（html-to-markdown.js 对应分支处理）。
// ============================================================

// 各类型中文显示名（标题文本）。未知类型回退为类型本身（大写）。
const TYPE_NAMES = {
  NOTE: '备注',
  TIP: '提示',
  IMPORTANT: '重要',
  WARNING: '警告',
  CAUTION: '注意',
  INFO: '信息',
  QUESTION: '提问',
  SUCCESS: '成功',
  FAILURE: '失败',
  DANGER: '危险',
  BUG: '缺陷',
  EXAMPLE: '示例',
  QUOTE: '引用',
  ABSTRACT: '摘要',
  SUMMARY: '总结',
  TLDR: '太长不看',
};

const CALLOUT_RE = /^\[!([A-Za-z0-9_-]+)\]\s*(?:\n+)?/;

function calloutPlugin(md) {
  md.core.ruler.after('block', 'callout', function calloutRule(state) {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;

      
      // 定位「本层」 blockquote 紧随其后的 paragraph_open + inline。
      // 用 depth 计数跳过内层子引用（blockquote_open/close），否则会误命中
      // 内层段落而导致外层 [!TYPE] 漏检（M4）。
      let k = i + 1;
      let depth = 0;
      while (k < tokens.length) {
        const t = tokens[k].type;
        if (t === 'blockquote_open') {
          depth++;
        } else if (t === 'blockquote_close') {
          if (depth === 0) break; // 本层 blockquote 已结束，未找到直接子段落
          depth--;
        } else if (t === 'paragraph_open' && depth === 0) {
          break; // 命中本层直接子段落
        }
        k++;
      }
      if (
        k >= tokens.length ||
        tokens[k].type !== 'paragraph_open' ||
        !tokens[k + 1] ||
        tokens[k + 1].type !== 'inline'
      ) {
        continue;
      }

      const inlineTok = tokens[k + 1];
      const content = inlineTok.content || '';
      const m = content.match(CALLOUT_RE);
      if (!m) continue;

      const rawType = m[1].toUpperCase();
      const name = TYPE_NAMES[rawType] || rawType;

      // 1) 改写 blockquote_open：加 class + data-callout
      const existingClass = tokens[i].attrGet('class');
      tokens[i].attrSet('class', (existingClass ? existingClass + ' ' : '') + `callout callout-${rawType.toLowerCase()}`);
      tokens[i].attrSet('data-callout', rawType);

      // 2) 删除首行 [!TYPE] 标记，重解析剩余 inline 内容
      const rest = content.replace(CALLOUT_RE, '');
      const newChildren = [];
      try {
        md.inline.parse(rest, md, state.env, newChildren);
      } catch (err) {
                // 失败时退回：保留原样（移除标记行，避免把 [!TYPE] 当作正文）
        newChildren.length = 0;
      }
      inlineTok.content = rest;
      inlineTok.children = newChildren;

      // 3) 在 blockquote_open 后、paragraph_open 前插入 callout 标题（raw html block）
      const titleHtml =
        `<div class="callout-title"><span class="callout-name">${escapeHtml(name)}</span></div>`;
      const titleToken = new state.Token('html_block', '', 0);
      titleToken.content = titleHtml;
      titleToken.block = true;
      tokens.splice(k, 0, titleToken);

          }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { calloutPlugin, TYPE_NAMES };
