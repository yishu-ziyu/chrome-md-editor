// 自绘中文查找/替换面板（改编自 typster 的 cm_search_panel.js，仅做中文 UI 与样式类适配）。
// 注入方式：editor.js 中 search({ createPanel: makeSearchPanel })。
// 保留官方搜索语义（命中高亮、正则、整词、大小写），新增 X/Y 实时命中计数与「全选匹配（多光标）」。
import {
  getSearchQuery, setSearchQuery, SearchQuery,
  findNext, findPrevious, replaceNext, replaceAll,
  selectMatches, closeSearchPanel,
} from '@codemirror/search';
import {
  runWorkspaceSearch,
  replaceInWorkspace,
  getWorkspaceFileHandle,
} from './workspace-search.js';
import { showConfirm } from './confirm-dialog.js';

// 轻量 DOM 构造器（typster 风格）。
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

const MATCH_CAP = 2000;
const WORKSPACE_DEBOUNCE_MS = 250;
// 结果列表最多渲染多少条：工作区可能有上万处命中，全量建 DOM 会把面板卡死。
const WORKSPACE_RESULT_CAP = 200;

export function makeSearchPanel(view) {
  const dom = el('div', { className: 'md-search-panel', role: 'search' });

  const findInput = el('input', { className: 'md-search-panel__input', type: 'text', placeholder: '查找', 'aria-label': '查找' });
  const replaceInput = el('input', { className: 'md-search-panel__input', type: 'text', placeholder: '替换', 'aria-label': '替换' });
  const countEl = el('span', { className: 'md-search-panel__count', 'aria-live': 'polite' });

  const tCase = el('button', { className: 'md-search-panel__btn', type: 'button', title: '区分大小写 (Alt+C)', 'aria-pressed': 'false' }, 'Aa');
  const tRegex = el('button', { className: 'md-search-panel__btn', type: 'button', title: '正则 (Alt+R)', 'aria-pressed': 'false' }, '.*');
  const tWord = el('button', { className: 'md-search-panel__btn', type: 'button', title: '整词 (Alt+W)', 'aria-pressed': 'false' }, '词');

  const btnPrev = el('button', { className: 'md-search-panel__btn', type: 'button', title: '上一个匹配 (Shift+Enter)' }, '↑');
  const btnNext = el('button', { className: 'md-search-panel__btn', type: 'button', title: '下一个匹配 (Enter)' }, '↓');
  const btnSelectAll = el('button', { className: 'md-search-panel__btn', type: 'button', title: '全选匹配（多光标）' }, '全选');
  const btnClose = el('button', { className: 'md-search-panel__btn', type: 'button', title: '关闭 (Esc)' }, '✕');

  const btnReplace = el('button', { className: 'md-search-panel__btn', type: 'button', title: '替换当前匹配' }, '替换');
  const btnReplaceAll = el('button', { className: 'md-search-panel__btn', type: 'button', title: '替换全部匹配（工作区搜索开启时会同时改写工作区其他文件）' }, '全部');

  // ── 工作区搜索子按钮（v1.8.9：原工具栏独立入口并入本面板）──
  const tWorkspace = el('button', {
    className: 'md-search-panel__btn',
    type: 'button',
    title: '工作区搜索：在当前文档与已打开文件夹的所有 Markdown 文件中查找 / 替换',
    'aria-pressed': 'false',
  }, '工作区搜索');

  const findRow = el('div', { className: 'md-search-panel__row' }, [findInput, countEl, tCase, tRegex, tWord, tWorkspace, btnPrev, btnNext, btnSelectAll, btnClose]);
  const replaceRow = el('div', { className: 'md-search-panel__row' }, [replaceInput, btnReplace, btnReplaceAll]);

  // 工作区搜索结果区：默认折叠，激活「工作区搜索」后展开
  const wsStatus = el('div', { className: 'md-search-panel__ws-status', 'aria-live': 'polite' });
  const wsResults = el('div', { className: 'md-search-panel__ws-results' });
  const wsBox = el('div', { className: 'md-search-panel__ws', hidden: true }, [wsStatus, wsResults]);

  dom.appendChild(findRow);
  dom.appendChild(replaceRow);
  dom.appendChild(wsBox);

  let timer = null;
  let wsTimer = null;
  let wsToken = 0;
  let wsBusy = false;

  function buildQuery() {
    return new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive: tCase.getAttribute('aria-pressed') === 'true',
      regexp: tRegex.getAttribute('aria-pressed') === 'true',
      wholeWord: tWord.getAttribute('aria-pressed') === 'true',
    });
  }

  function commit() {
    const q = buildQuery();
    if (!q.eq(getSearchQuery(view.state))) {
      view.dispatch({ effects: setSearchQuery.of(q) });
    }
  }

  function debouncedCommit() {
    clearTimeout(timer);
    timer = setTimeout(commit, 120);
  }

  function countMatches(query) {
    if (!query.search) return { total: 0, current: 0 };
    const cursor = query.getCursor(view.state);
    const head = view.state.selection.main.head;
    let total = 0;
    let current = 0;
    let step = cursor.next();
    while (!step.done) {
      total++;
      const { from, to } = step.value;
      if (current === 0) {
        if (head >= from && head <= to) current = total;
        else if (from > head) current = total;
      }
      if (total > MATCH_CAP) break;
      step = cursor.next();
    }
    if (current === 0 && total > 0) current = 1;
    return { total, current };
  }

  function renderCount() {
    const q = getSearchQuery(view.state);
    if (!q || !q.search) {
      countEl.textContent = '';
      countEl.classList.remove('is-error');
      return;
    }
    try {
      const { total, current } = countMatches(q);
      if (total > MATCH_CAP) countEl.textContent = `${MATCH_CAP}+ 匹配`;
      else if (total === 0) countEl.textContent = '无匹配';
      else countEl.textContent = `${current}/${total}`;
      countEl.classList.remove('is-error');
    } catch (e) {
      countEl.textContent = '正则无效';
      countEl.classList.add('is-error');
    }
  }

  function syncFromQuery() {
    const q = getSearchQuery(view.state);
    if (!q) return;
    findInput.value = q.search || '';
    replaceInput.value = q.replace || '';
    tCase.setAttribute('aria-pressed', q.caseSensitive ? 'true' : 'false');
    tRegex.setAttribute('aria-pressed', q.regexp ? 'true' : 'false');
    tWord.setAttribute('aria-pressed', q.wholeWord ? 'true' : 'false');
    tCase.classList.toggle('is-active', q.caseSensitive);
    tRegex.classList.toggle('is-active', q.regexp);
    tWord.classList.toggle('is-active', q.wholeWord);
  }

  function toggle(btn) {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    btn.classList.toggle('is-active', next);
    commit();
  }

  // ── 工作区搜索：跨已打开文件夹的所有 Markdown 文件 ──
  function wsActive() {
    return tWorkspace.getAttribute('aria-pressed') === 'true';
  }

  function renderWorkspaceResults(hits) {
    wsResults.replaceChildren();
    if (!hits.length) {
      wsStatus.textContent = '工作区内未找到匹配（未打开文件夹时本功能不可用）';
      return;
    }
    const fileCount = new Set(hits.map((h) => h.path)).size;
    const shown = hits.slice(0, WORKSPACE_RESULT_CAP);
    wsStatus.textContent =
      hits.length > WORKSPACE_RESULT_CAP
        ? `工作区共 ${hits.length} 处匹配（${fileCount} 个文件），仅列出前 ${WORKSPACE_RESULT_CAP} 处`
        : `工作区共 ${hits.length} 处匹配（${fileCount} 个文件）`;

    for (const hit of shown) {
      // 全部走 textContent：文件路径与正文片段都是不可信输入，禁止拼 innerHTML。
      const item = el('button', {
        className: 'md-search-panel__ws-item',
        type: 'button',
        title: `${hit.path}：第 ${hit.lineNumber} 行`,
      });
      const head = el('span', { className: 'md-search-panel__ws-item-path' });
      head.textContent = `${hit.path} : ${hit.lineNumber}`;
      const snip = el('span', { className: 'md-search-panel__ws-item-snippet' });
      snip.textContent = hit.snippet;
      item.append(head, snip);
      item.addEventListener('click', () => {
        // 交给 editor.js：它持有 openWithHandle，能把文件真正载入编辑器。
        document.dispatchEvent(new CustomEvent('cme:workspace-search-open', {
          detail: { path: hit.path, handle: getWorkspaceFileHandle(hit.path), line: hit.lineNumber },
        }));
      });
      wsResults.appendChild(item);
    }
  }

  async function runWs() {
    if (!wsActive()) return;
    const q = findInput.value;
    if (!q) {
      wsStatus.textContent = '输入查找内容后，将在工作区所有 Markdown 文件中检索';
      wsResults.replaceChildren();
      return;
    }
    const token = ++wsToken;
    wsStatus.textContent = '正在检索工作区…';
    try {
      const hits = await runWorkspaceSearch(q, null);
      if (token !== wsToken) return; // 已被更新的查询取代，丢弃过期结果
      renderWorkspaceResults(hits);
    } catch (err) {
      if (token !== wsToken) return;
      wsResults.replaceChildren();
      wsStatus.textContent = '工作区检索失败：' + (err && err.message ? err.message : String(err));
    }
  }

  function debouncedWs() {
    clearTimeout(wsTimer);
    wsTimer = setTimeout(runWs, WORKSPACE_DEBOUNCE_MS);
  }

  // 「全部」在工作区模式下的语义：当前文档走 CM6 replaceAll（尊重未保存修改），
  // 工作区其余文件走 replaceInWorkspace 直接落盘。后者不可撤销，必须二次确认。
  async function replaceAllWorkspace() {
    const q = findInput.value;
    if (!q) return;
    if (wsBusy) return;

    const caseSensitive = tCase.getAttribute('aria-pressed') === 'true';
    if (tRegex.getAttribute('aria-pressed') === 'true') {
      wsStatus.textContent = '工作区替换暂不支持正则模式，请关闭「.*」后重试（当前文档已按正则替换）';
      replaceAll(view);
      return;
    }

    const ok = await showConfirm(
      `即将把工作区所有 Markdown 文件中的「${q}」替换为「${replaceInput.value}」。\n` +
      '该操作会直接写入磁盘且无法撤销，是否继续？'
    );
    if (!ok) return;

    // 当前文档先走编辑器替换：它可能有未保存修改，以缓冲区为准。
    replaceAll(view);

    wsBusy = true;
    wsStatus.textContent = '正在替换工作区文件…';
    try {
      const r = await replaceInWorkspace(q, replaceInput.value, { caseSensitive });
      const failNote = r.failed.length ? `，${r.failed.length} 个文件写入失败` : '';
      wsStatus.textContent = `已替换 ${r.files} 个文件共 ${r.replacements} 处${failNote}`;
      await runWs();
    } catch (err) {
      wsStatus.textContent = '工作区替换失败：' + (err && err.message ? err.message : String(err));
    } finally {
      wsBusy = false;
    }
  }

  findInput.addEventListener('input', () => {
    debouncedCommit();
    if (wsActive()) debouncedWs();
  });
  replaceInput.addEventListener('input', debouncedCommit);
  tCase.addEventListener('click', () => { toggle(tCase); if (wsActive()) debouncedWs(); });
  tRegex.addEventListener('click', () => toggle(tRegex));
  tWord.addEventListener('click', () => toggle(tWord));
  tWorkspace.addEventListener('click', () => {
    const next = !wsActive();
    tWorkspace.setAttribute('aria-pressed', next ? 'true' : 'false');
    tWorkspace.classList.toggle('is-active', next);
    wsBox.hidden = !next;
    if (next) runWs();
    else { wsResults.replaceChildren(); wsStatus.textContent = ''; }
  });
  btnPrev.addEventListener('click', () => findPrevious(view));
  btnNext.addEventListener('click', () => findNext(view));
  btnSelectAll.addEventListener('click', () => selectMatches(view));
  btnClose.addEventListener('click', () => closeSearchPanel(view));
  btnReplace.addEventListener('click', () => replaceNext(view));
  btnReplaceAll.addEventListener('click', () => {
    if (wsActive()) replaceAllWorkspace();
    else replaceAll(view);
  });

  function onKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
    }
  }
  findInput.addEventListener('keydown', onKey);
  replaceInput.addEventListener('keydown', onKey);

  return {
    dom,
    top: true,
    mount() {
      syncFromQuery();
      renderCount();
      findInput.focus();
      findInput.select();
    },
    update(update) {
      if (update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) {
        syncFromQuery();
        // Bug #2 修复：查询变更后必须立即刷新 X/Y 命中计数。否则仅当文档/选区变化时才刷新，
        // 导致用户输入查找词后计数长期为空/陈旧，破坏「实时命中计数」功能。
        renderCount();
      }
      if (update.docChanged || update.selectionSet) {
        renderCount();
      }
    },
    destroy() {
      clearTimeout(timer);
      clearTimeout(wsTimer);
      wsToken++; // 作废在途的工作区检索，避免面板销毁后回调仍写已脱离文档的 DOM
    },
  };
}
