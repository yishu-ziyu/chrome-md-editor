// 自绘中文查找/替换面板（改编自 typster 的 cm_search_panel.js，仅做中文 UI 与样式类适配）。
// 注入方式：editor.js 中 search({ createPanel: makeSearchPanel })。
// 保留官方搜索语义（命中高亮、正则、整词、大小写），新增 X/Y 实时命中计数与「全选匹配（多光标）」。
import {
  getSearchQuery, setSearchQuery, SearchQuery,
  findNext, findPrevious, replaceNext, replaceAll,
  selectMatches, closeSearchPanel,
} from '@codemirror/search';

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
  const btnReplaceAll = el('button', { className: 'md-search-panel__btn', type: 'button', title: '替换全部匹配' }, '全部');

  const findRow = el('div', { className: 'md-search-panel__row' }, [findInput, countEl, tCase, tRegex, tWord, btnPrev, btnNext, btnSelectAll, btnClose]);
  const replaceRow = el('div', { className: 'md-search-panel__row' }, [replaceInput, btnReplace, btnReplaceAll]);
  dom.appendChild(findRow);
  dom.appendChild(replaceRow);

  let timer = null;

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

  findInput.addEventListener('input', debouncedCommit);
  replaceInput.addEventListener('input', debouncedCommit);
  tCase.addEventListener('click', () => toggle(tCase));
  tRegex.addEventListener('click', () => toggle(tRegex));
  tWord.addEventListener('click', () => toggle(tWord));
  btnPrev.addEventListener('click', () => findPrevious(view));
  btnNext.addEventListener('click', () => findNext(view));
  btnSelectAll.addEventListener('click', () => selectMatches(view));
  btnClose.addEventListener('click', () => closeSearchPanel(view));
  btnReplace.addEventListener('click', () => replaceNext(view));
  btnReplaceAll.addEventListener('click', () => replaceAll(view));

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
      }
      if (update.docChanged || update.selectionSet) {
        renderCount();
      }
    },
    destroy() {
      clearTimeout(timer);
    },
  };
}
