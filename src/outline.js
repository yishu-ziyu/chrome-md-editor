// ============================================================
// A-3 大纲面板
//  - 用 CodeMirror 6 的 syntaxTree 遍历 ATXHeading1..6 节点；
//  - 生成可点击的大纲列表（按层级缩进）；
//  - 点击标题跳转到编辑器对应位置并滚动到视图。
// 纯前端，不改 Markdown 源码。
// ============================================================
import { syntaxTree } from '@codemirror/language';

const HEADING_RE = /^ATXHeading(\d)$/;

let outlineView = null;

export function setOutlineEditor(view) {
  outlineView = view;
}

export function getOutlineItems(view) {
  const v = view || outlineView;
  const items = [];
  if (!v) return items;
  const tree = syntaxTree(v.state);
  const doc = v.state.doc;
  // 递归遍历语法树，收集标题节点
  const cursor = tree.cursor();
  (function walk() {
    do {
      const m = HEADING_RE.exec(cursor.node.name);
      if (m) {
        const level = parseInt(m[1], 10);
        const text = doc.sliceString(cursor.from, cursor.to).replace(/^#{1,6}\s*/, '').replace(/\s+$/, '');
        items.push({ level, text, pos: cursor.from });
      }
    } while (cursor.next());
  })();
    return items;
}

export function renderOutline(items) {
  const list = document.getElementById('outlineList');
  if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="panel-empty">暂无标题</div>';
    return;
  }
  for (const it of items) {
    const el = document.createElement('div');
    el.className = `outline-item outline-level-${it.level}`;
    el.textContent = it.text || '(空标题)';
    el.title = `${'#'.repeat(it.level)} ${it.text}`;
    el.addEventListener('click', () => scrollToHeading(it.pos));
    list.appendChild(el);
  }
}

export function scrollToHeading(pos) {
  if (!outlineView) return;
  outlineView.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });
  outlineView.focus();
  }
