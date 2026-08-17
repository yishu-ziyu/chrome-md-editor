// 视图模式（需求 6：P2 S2 视图扩展）
// 把 markra 的 15 元素视图矩阵裁剪映射成 CME 实际拥有的外壳元素，
// 仅做 DOM classList 切换，不引入 CM6 扩展（单一 EditorView 内纯 DOM 控制）。
//
// 设计要点：
// - 设置存 localStorage（键 md-editor-chrome-mode，默认 'daily'）。
// - 只对 CME 真实存在的元素操作，缺失则跳过（不报错）。
// - applyViewMode 只切 DOM，不碰 editor；requestMeasure 由主 Agent 在 INIT 接线时处理。

export const VIEW_MODE_OPTIONS = ['daily', 'focus', 'immersive', 'full'];

const STORAGE_KEY = 'md-editor-chrome-mode';

// CME 实际拥有的外壳元素：视图矩阵 key → DOM id
// 注意：底部状态栏真实 id 为 statusbar（全小写），字数元素为 statusWords。
const ELEMENT_IDS = {
  editorPanel: 'editorPanel',
  previewPanel: 'previewPanel',
  resizer: 'resizer',
  toolbar: 'toolbar',
  outlinePanel: 'outlinePanel',
  taskListPanel: 'taskListPanel',
  fileSidebar: 'fileSidebar',
  statusBar: 'statusbar',
  wordCount: 'statusWords',
};

// 预设矩阵（元素 → 是否显示）。daily/full 全显。
const PRESETS = {
  daily: {
    editorPanel: true,
    previewPanel: true,
    resizer: true,
    toolbar: true,
    outlinePanel: true,
    taskListPanel: true,
    fileSidebar: true,
    statusBar: true,
    wordCount: true,
  },
  full: {
    editorPanel: true,
    previewPanel: true,
    resizer: true,
    toolbar: true,
    outlinePanel: true,
    taskListPanel: true,
    fileSidebar: true,
    statusBar: true,
    wordCount: true,
  },
  // 专注：隐文件树 / 大纲 / 任务 / 状态栏；保留编辑-预览分隔条与工具栏。
  focus: {
    editorPanel: true,
    previewPanel: true,
    resizer: true,
    toolbar: true,
    outlinePanel: false,
    taskListPanel: false,
    fileSidebar: false,
    statusBar: false,
    wordCount: true,
  },
  // 沉浸：在专注基础上再隐工具栏。
  immersive: {
    editorPanel: true,
    previewPanel: true,
    resizer: true,
    toolbar: false,
    outlinePanel: false,
    taskListPanel: false,
    fileSidebar: false,
    statusBar: false,
    wordCount: true,
  },
};

// 循环顺序
const CYCLE = ['daily', 'focus', 'immersive', 'full'];

function isViewMode(value) {
  return VIEW_MODE_OPTIONS.includes(value);
}

function normalizeMode(value) {
  return isViewMode(value) ? value : 'daily';
}

// 返回元素 key → 布尔（是否显示）矩阵。未知 mode 回退 daily。
export function resolveViewModeChrome(mode) {
  const m = normalizeMode(mode);
  return { ...PRESETS[m] };
}

// 对各外壳元素 classList add/remove 'view-hidden'，只对 CME 实际存在元素操作。
export function applyViewMode(mode) {
  const matrix = resolveViewModeChrome(mode);
  for (const key of Object.keys(matrix)) {
    const id = ELEMENT_IDS[key];
    if (!id) continue;
    const el = document.getElementById(id);
    if (!el) continue; // 元素缺失则跳过
    if (matrix[key]) {
      el.classList.remove('view-hidden');
    } else {
      el.classList.add('view-hidden');
    }
  }

  // 修复 BUG1/BUG4：工具栏被视图模式隐藏时，#btnChromeMode(⊞) 是其后代，
  // 会随祖先 display:none!important 一起不可见，导致无法切回日常/全显。
  // 故在工具栏隐藏时把该按钮「脱离 #toolbar」挂到 body 成为固定浮层（position:fixed 不再被祖先隐藏）；
  // 工具栏恢复时再挂回原容器。这样无论祖先是否隐藏，按钮都真实可见、可点击。
  placeChromeModeButton(matrix.toolbar === false);

  // 侧栏恢复条：文件栏被视图隐藏(.view-hidden)或手动收起(.collapsed)时点亮（实际恢复逻辑在 editor.js toggleSidebar）
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    const fileSidebar = document.getElementById('fileSidebar');
    const hidden = fileSidebar ? (fileSidebar.classList.contains('view-hidden') || fileSidebar.classList.contains('collapsed')) : false;
    sidebarToggle.classList.toggle('visible', hidden);
  }
}

// 把 #btnChromeMode 在「#toolbar 内」与「body 浮层」之间迁移，避免被祖先 display:none 隐藏。
// 记录首次脱离时的原父节点与相邻兄弟，恢复时精确插回原位（不破坏工具栏按钮顺序）。
let chromeBtnOrigParent = null;
let chromeBtnOrigNext = null;
function placeChromeModeButton(toolbarHidden) {
  const btn = document.getElementById('btnChromeMode');
  if (!btn) return;
  if (toolbarHidden) {
    if (!chromeBtnOrigParent) {
      chromeBtnOrigParent = btn.parentElement;
      chromeBtnOrigNext = btn.nextElementSibling;
    }
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    btn.classList.add('force-visible');
  } else {
    if (chromeBtnOrigParent && btn.parentElement === document.body) {
      // 防御（审计 F-02）：若记录的原始父节点已被移除（如响应式工具栏重渲染导致引用游离），
      // 回退挂到 #toolbar，避免插入到已脱离文档的节点而丢失按钮。
      if (document.contains(chromeBtnOrigParent)) {
        chromeBtnOrigParent.insertBefore(
          btn,
          chromeBtnOrigNext && document.contains(chromeBtnOrigNext) ? chromeBtnOrigNext : null
        );
      } else {
        const tb = document.getElementById('toolbar');
        if (tb) tb.appendChild(btn);
      }
    }
    btn.classList.remove('force-visible');
  }
}

// daily → focus → immersive → full → daily 循环
export function nextViewMode(mode) {
  if (!isViewMode(mode)) return 'daily';
  const idx = CYCLE.indexOf(mode);
  if (idx < 0) return 'daily';
  return CYCLE[(idx + 1) % CYCLE.length];
}

export function getStoredViewMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeMode(raw);
  } catch {
    return 'daily';
  }
}

export function setStoredViewMode(mode) {
  const m = normalizeMode(mode);
  try {
    localStorage.setItem(STORAGE_KEY, m);
  } catch {
    // localStorage 不可用时静默忽略（不影响本次会话 DOM 切换）
  }
  return m;
}

// 绑定工具栏 ⊞ 按钮：点击循环切换并持久化（applyViewMode 只切 DOM）。
export function initChromeModeButton() {
  const btn = document.getElementById('btnChromeMode');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const m = nextViewMode(getStoredViewMode());
    setStoredViewMode(m);
    applyViewMode(m);
  });
}
