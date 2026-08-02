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
  if (
    window.confirm(
      `发现未保存草稿（自动保存于 ${when}），是否恢复上次编辑内容？\n（仅恢复编辑区内容，不会覆盖磁盘文件）`
    )
  ) {
    editorRef.dispatch({
      changes: { from: 0, to: editorRef.state.doc.length, insert: draft.content },
    });
  }
}
