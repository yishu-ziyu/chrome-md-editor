// ============================================================
// A-12 任务列表面板
//  - 解析编辑器源码中所有 `- [ ]` / `- [x]` 任务项（含 * / + / 有序列表）；
//  - 生成可勾选的列表；勾选状态回写到源码对应行（仅替换 [ ] / [x] 标记）；
//  - 与预览区已有的任务列表 checkbox 互不冲突（都基于同一份源码）。
// 纯前端。
// ============================================================

const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]\s*(.*)$/;

let taskView = null;

// 纯逻辑解析单行任务；返回 null 表示非任务行。
// m[1] 为「缩进+列表符号+空格+[」前缀长度；[ ]/[x] 标记从 line.from + indent 起，长 3。
// 末段放宽为 \s* 以识别无尾随文本的空任务（M6）。
export function parseTaskLine(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(TASK_LINE_RE);
  if (!m) return null;
  return {
    indent: m[1].length,
    checked: m[2].toLowerCase() === 'x',
    text: m[3],
  };
}

export function setTaskEditor(view) {
  taskView = view;
}

export function getTaskItems(view) {
  const v = view || taskView;
  const items = [];
  if (!v) return items;
  const doc = v.state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const parsed = parseTaskLine(line.text);
    if (parsed) {
      items.push({
        lineNumber: i,
        checked: parsed.checked,
        text: parsed.text,
        indent: parsed.indent,
      });
    }
  }
    return items;
}

export function renderTaskList(items) {
  const list = document.getElementById('taskList');
  if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="panel-empty">暂无任务</div>';
    return;
  }
  for (const it of items) {
    const el = document.createElement('label');
    el.className = 'task-item' + (it.checked ? ' checked' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = it.checked;
    cb.addEventListener('change', () => {
      toggleTaskAtLine(it.lineNumber, cb.checked);
    });

    const span = document.createElement('span');
    span.className = 'task-text';
    span.textContent = it.text || '(空任务)';

    el.appendChild(cb);
    el.appendChild(span);
    list.appendChild(el);
  }
}

export function toggleTaskAtLine(lineNumber, checked) {
  if (!taskView) return;
  const doc = taskView.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return;
  const line = doc.line(lineNumber);
  const parsed = parseTaskLine(line.text);
  if (!parsed) return;
  // parsed.indent 即「缩进+列表符号+空格+[」前缀长度；标记 [ ]/[x] 从该处起，长 3
  const from = line.from + parsed.indent;
  const to = from + 3;
  const newMark = checked ? '[x]' : '[ ]';
  taskView.dispatch({ changes: { from, to, insert: newMark } });
  }
