// src/autosave.js
// A-5：自动保存草稿 + 周期快照环（最多 30 份）
//
// 设计原则（与现有 lastFile 快照哲学一致）：
//   - 仅写入 chrome.storage.local，绝不触碰磁盘文件；
//     真实的 .md 文件只在用户主动 Ctrl+S（handleSave）时写入。
//   - 这规避了"自动保存把用户正在试验的废稿覆盖原文件"的风险。
//
// 双端兼容：浏览器侧走 chrome.storage.local；Tauri 桌面端由注入的 storage 垫片兼容
// （session-restore.js 已验证 chrome.storage.local 在 EXE 侧可用），无需额外适配。

const AUTOSAVE_DELAY = 800; // 编辑停顿防抖（毫秒）
const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000; // 至少每 2 分钟一快照
const MAX_SNAPSHOTS = 30;

let editorRef = null;
let fileIdResolver = () => 'unsaved';
let debouncedSave = null;
let lastSnapshotAt = 0;
let changesSinceSnap = 0;

// 由 editor.js 在编辑器创建后注入：editor 实例 + 当前文件唯一键解析器
export function initAutosave({ editor, getFileId } = {}) {
  if (editor) editorRef = editor;
  if (typeof getFileId === 'function') fileIdResolver = getFileId;
  debouncedSave = debounce(() => doAutosave(), AUTOSAVE_DELAY);
}

// 通用防抖（带 .cancel()），改编自 michaelcuneo autoSavePlugin 范式
export function debounce(fn, delay) {
  let t = null;
  const wrapped = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, delay);
  };
  wrapped.cancel = () => {
    if (t) {
      clearTimeout(t);
      t = null;
    }
  };
  return wrapped;
}

// 解析文件唯一键：优先用文件系统句柄名（FileHandle.name），其次用已加载文件名，
// 最后回退 'unsaved'。
// 关键修复（Bug #1）：file:// 打开的文件没有 FileHandle（currentFileHandle 为 null），
// 必须回退到「已加载文件名」，否则所有 file:// 文件会共用 'unsaved' 键，导致不同文件的
// 草稿（draft::）与历史快照（snapshots::）互相覆盖、互相串档。
// 关键修复（BUG4）：'未打开文件' / 'untitled.md' / 'unsaved' / 空 等「未保存」显示标签
// 一律归并到稳定键 'unsaved'。否则 handleNew 会把键变成 draft::未打开文件，
// 而全新会话的 currentFileName 为 'unsaved'（draft::unsaved），两者不一致导致
// 新建后输入的草稿在重载时被孤儿化、无法恢复（数据丢失）。真实文件各有文件名，不受影响。
export function resolveFileKey(handleName, fileName) {
  const key = handleName || fileName || 'unsaved';
  if (key === '未打开文件' || key === 'untitled.md' || key === 'unsaved' || key.trim() === '') {
    return 'unsaved';
  }
  return key;
}

// 文件唯一键：优先用句柄名（含扩展名与文件名，区分不同文件），均无则 'unsaved'
function fileKey() {
  const id = fileIdResolver ? fileIdResolver() : 'unsaved';
  return id || 'unsaved';
}

// 由 editor.js 的 updateListener(docChanged) 调用——编辑停顿后写草稿 + 条件压入快照
export function scheduleAutosave() {
  if (debouncedSave) debouncedSave();
}

export async function doAutosave() {
  if (!editorRef) return;
  const content = editorRef.state.doc.toString();
  const key = fileKey();
  try {
    await chrome.storage.local.set({ [`draft::${key}`]: { content, savedAt: Date.now() } });
  } catch (e) {
    console.error('[autosave] 草稿写入失败', e);
    return;
  }
  // 快照环：按时间或变更次数周期性压入
  changesSinceSnap++;
  const now = Date.now();
  const trigger = now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS || changesSinceSnap >= 50;
  if (trigger) {
    await pushSnapshot(key, content);
    lastSnapshotAt = now;
    changesSinceSnap = 0;
  }
}

export async function pushSnapshot(key, content) {
  const recKey = `snapshots::${key}`;
  try {
    const { [recKey]: arr = [] } = await chrome.storage.local.get(recKey);
    // 去重（M3）：若最新快照（arr[0]）内容与本次相同则跳过压栈，避免长时间无实质变化
    // 或反复撤销回同一内容时迅速占满 30 槽、挤出有效版本。不改变 MAX_SNAPSHOTS 上限语义。
    if (arr.length > 0 && arr[0].content === content) return;
    // aurorae-haven 范式：unshift 到头部 + 截断到 MAX_SNAPSHOTS
    arr.unshift({
      id: Date.now(),
      content,
      timestamp: new Date().toISOString(),
      preview: content.replace(/\s+/g, ' ').slice(0, 120),
    });
    if (arr.length > MAX_SNAPSHOTS) arr.length = MAX_SNAPSHOTS;
    await chrome.storage.local.set({ [recKey]: arr });
  } catch (e) {
    console.error('[autosave] 快照写入失败', e);
  }
}

export async function listSnapshots() {
  const key = fileKey();
  try {
    const { [`snapshots::${key}`]: arr = [] } = await chrome.storage.local.get(`snapshots::${key}`);
    return arr;
  } catch {
    return [];
  }
}

export async function restoreSnapshot(id) {
  if (!editorRef) return false;
  const arr = await listSnapshots();
  const v = arr.find((x) => x.id === id);
  if (!v) return false;
  editorRef.dispatch({
    changes: { from: 0, to: editorRef.state.doc.length, insert: v.content },
  });
  return true;
}

export async function getDraft() {
  const key = fileKey();
  try {
    const { [`draft::${key}`]: d } = await chrome.storage.local.get(`draft::${key}`);
    return d || null;
  } catch {
    return null;
  }
}

// 启动时若发现比当前文档新的草稿，提示恢复（不静默覆盖磁盘文件）
// ===========================================================================
// 定时磁盘自动保存（与上面的「草稿 / 快照环」互相独立）
//
// 上面的自动保存只写 chrome.storage.local；这里是用户显式开启的「落盘副本」：
// 每 N 秒把当前内容写成 <源文件主名>_<秒级时间戳>.md，放在源文件同目录。
// 永远只新建带时间戳的副本，绝不覆盖源文件。
//
// 本模块不直接碰 File System Access API / Tauri，具体写入由 editor.js 通过
// initDiskAutosave({ writeFile }) 注入，保证这里可在 node 下单测。
// ===========================================================================

const DEFAULT_DISK_INTERVAL_SEC = 30;
const MIN_DISK_INTERVAL_SEC = 5;
const MAX_DISK_INTERVAL_SEC = 3600;

let diskTimer = null;
let diskIntervalSec = DEFAULT_DISK_INTERVAL_SEC;
let diskGetContent = null;
let diskGetSourceName = null;
let diskWriteFile = null;
let diskOnSaved = null;
let diskOnError = null;
let lastDiskContent = null;

// 把间隔秒数夹到合法区间；非法输入回退默认 30 秒
export function normalizeIntervalSec(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DISK_INTERVAL_SEC;
  return Math.min(MAX_DISK_INTERVAL_SEC, Math.max(MIN_DISK_INTERVAL_SEC, n));
}

// 秒级时间戳：yyyyMMddHHmmss（本地时间，与用户看到的文件时间一致）
export function formatTimestamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    p(date.getFullYear(), 4) +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds())
  );
}

// 由源文件名生成落盘副本名：<主名>_<秒级时间戳>.md
// 例：这是测试文件.md + 20260804133025 → 这是测试文件_20260804133025.md
export function buildAutosaveFileName(sourceName, date = new Date()) {
  const raw = (sourceName || '').trim();
  const fallback = 'untitled';
  const base = raw && raw !== '未打开文件' ? raw.replace(/\.[^./\\]+$/, '') : fallback;
  const safeBase = (base || fallback).replace(/[\\/:*?"<>|]/g, '_');
  return `${safeBase}_${formatTimestamp(date)}.md`;
}

// 注入落盘自动保存所需的上下文（由 editor.js 在初始化时调用一次）
//   getContent()    -> string   当前编辑区内容
//   getSourceName() -> string   当前文件名（含扩展名）
//   writeFile(name, content) -> Promise<string> 实际落盘，返回可展示的路径/文件名
export function initDiskAutosave({ getContent, getSourceName, writeFile, onSaved, onError } = {}) {
  if (typeof getContent === 'function') diskGetContent = getContent;
  if (typeof getSourceName === 'function') diskGetSourceName = getSourceName;
  if (typeof writeFile === 'function') diskWriteFile = writeFile;
  diskOnSaved = typeof onSaved === 'function' ? onSaved : null;
  diskOnError = typeof onError === 'function' ? onError : null;
}

// 立即执行一次落盘。内容与上次落盘完全相同时跳过，避免堆出一串一模一样的副本。
export async function runDiskAutosaveOnce({ force = false } = {}) {
  if (!diskGetContent || !diskWriteFile) return null;
  const content = diskGetContent();
  if (!force && content === lastDiskContent) return null;
  const name = buildAutosaveFileName(diskGetSourceName ? diskGetSourceName() : '');
  try {
    const target = await diskWriteFile(name, content);
    lastDiskContent = content;
    if (diskOnSaved) diskOnSaved(target || name);
    return target || name;
  } catch (e) {
    if (diskOnError) diskOnError(e);
    else console.error('[autosave] 落盘失败', e);
    return null;
  }
}

// 开启定时落盘：每 intervalSec 秒写一份带时间戳的副本。重复调用即按新间隔重启。
export function autosaveToDisk(intervalSec = DEFAULT_DISK_INTERVAL_SEC) {
  stopAutosaveToDisk();
  diskIntervalSec = normalizeIntervalSec(intervalSec);
  diskTimer = setInterval(() => {
    runDiskAutosaveOnce();
  }, diskIntervalSec * 1000);
  return diskIntervalSec;
}

export function stopAutosaveToDisk() {
  if (diskTimer) {
    clearInterval(diskTimer);
    diskTimer = null;
  }
}

export function isAutosaveToDiskOn() {
  return diskTimer !== null;
}

export function getDiskAutosaveIntervalSec() {
  return diskIntervalSec;
}

// 切换文件后重置「内容去重」基准，保证新文件第一次到点必定落盘
export function resetDiskAutosaveBaseline() {
  lastDiskContent = null;
}

export async function offerDraftRestore() {
  if (!editorRef) return;
  const key = fileKey();
  const draft = await getDraft();
  if (!draft) {
    return;
  }
  if (draft.content === editorRef.state.doc.toString()) {
    return;
  }
  const when = new Date(draft.savedAt).toLocaleString();
  // 非阻塞确认：改用页内弹窗替代 window.confirm。
  // 原因：window.confirm 是阻塞式模态对话框，在初始化阶段调用会锁死渲染进程主线程
  // （headless 下 CDP handleJavaScriptDialog 与此相互死锁，表现为「renderer 卡死/崩溃」误判；
  // 真实 GUI 下也会在启动即强弹对话框、阻塞首屏）。非阻塞弹窗不卡主线程，两种环境均安全。
  showDraftRestorePrompt(when, () => {
    editorRef.dispatch({
      changes: { from: 0, to: editorRef.state.doc.length, insert: draft.content },
    });
  });
}

// 非阻塞的草稿恢复确认弹窗（替代 window.confirm，避免初始化阶段阻塞渲染进程主线程）。
// 返回即用，不依赖额外 CSS；点击「恢复」回调 onRestore，点击「忽略」或遮罩外区域关闭。
function showDraftRestorePrompt(when, onRestore) {
  if (document.getElementById('draftRestorePrompt')) return; // 防重复
  const overlay = document.createElement('div');
  overlay.id = 'draftRestorePrompt';
  overlay.setAttribute('role', 'dialog');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4)';
  const box = document.createElement('div');
  box.style.cssText =
    'background:#fff;color:#1f2328;border-radius:8px;padding:20px;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,0.2);font-family:sans-serif';
  box.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:8px;">发现未保存草稿</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:16px;">自动保存于 ${when}，是否恢复上次编辑内容？<br>（仅恢复编辑区，不覆盖磁盘文件）</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="draftIgnore" style="padding:6px 14px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;cursor:pointer;">忽略</button>
      <button id="draftRestore" style="padding:6px 14px;border:none;border-radius:6px;background:#0969da;color:#fff;cursor:pointer;">恢复</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const ignore = document.getElementById('draftIgnore');
  const restore = document.getElementById('draftRestore');
  if (ignore) ignore.addEventListener('click', close);
  if (restore)
    restore.addEventListener('click', () => {
      onRestore();
      close();
    });
}
