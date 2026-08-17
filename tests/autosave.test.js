// tests/autosave.test.js
// A-5 自动保存 + 快照环的纯逻辑单元测试（mock chrome.storage.local，不依赖浏览器环境）
import test from 'node:test';
import assert from 'node:assert/strict';

// 内存版 chrome.storage.local 替身
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (obj) => {
        Object.assign(store, obj);
      },
    },
  },
};

// 动态导入（确保上面的 chrome 替身先就位）
const {
  initAutosave,
  doAutosave,
  getDraft,
  listSnapshots,
  pushSnapshot,
  restoreSnapshot,
  resolveFileKey,
  formatTimestamp,
  buildAutosaveFileName,
  normalizeIntervalSec,
  initDiskAutosave,
  runDiskAutosaveOnce,
  resetDiskAutosaveBaseline,
  autosaveToDisk,
  stopAutosaveToDisk,
  isAutosaveToDiskOn,
} = await import('../src/autosave.js');

test('resolveFileKey：优先句柄名，其次文件名，最后 unsaved（Bug #1 回归）', () => {
  assert.equal(resolveFileKey('a.md', 'b.md'), 'a.md', '优先用句柄名');
  // file:// 打开没有 FileHandle -> 必须回退到已加载文件名，不能为 'unsaved'
  assert.equal(resolveFileKey(undefined, '笔记.md'), '笔记.md', '无句柄时回退文件名');
  assert.equal(resolveFileKey(null, '笔记.md'), '笔记.md', 'null 句柄时回退文件名');
  assert.equal(resolveFileKey(undefined, undefined), 'unsaved', '两者皆无时回退 unsaved');
  assert.equal(resolveFileKey(null, ''), 'unsaved', '空文件名回退 unsaved');
});

test('resolveFileKey：不同 file:// 文件名得到不同键，不串档（Bug #1 回归）', () => {
  const k1 = resolveFileKey(undefined, 'a.md');
  const k2 = resolveFileKey(undefined, 'b.md');
  assert.notEqual(k1, k2, '两个不同 file:// 文件必须拥有不同键，否则草稿/快照会互相覆盖');
});

const fakeEditor = {
  state: { doc: { toString: () => 'hello world', length: 11 }, length: 11 },
  dispatch(changes) {
    // 模拟还原：用 insert 覆盖文档内容
    if (changes && changes.changes && changes.changes.insert != null) {
      this.state.doc = { toString: () => changes.changes.insert, length: changes.changes.insert.length };
    }
  },
};

initAutosave({ editor: fakeEditor, getFileId: () => 'test.md' });

test('草稿写入后可由 getDraft 读回', async () => {
  store['draft::test.md'] = undefined;
  await doAutosave();
  const d = await getDraft();
  assert.ok(d, '存在草稿');
  assert.equal(d.content, 'hello world');
  assert.ok(typeof d.savedAt === 'number');
});

test('快照环超过 30 份时截断到 30，且最新在最前', async () => {
  const recKey = 'snapshots::test.md';
  // 预置 35 份历史快照，按真实环顺序（最新在前、最旧在后）：c34 最新 ... c0 最旧
  const arr = [];
  for (let i = 34; i >= 0; i--) {
    arr.push({ id: 1000 - i, content: 'c' + i, timestamp: new Date().toISOString(), preview: 'c' + i });
  }
  store[recKey] = arr;

  await pushSnapshot('test.md', 'newest');
  const after = await listSnapshots();
  assert.equal(after.length, 30, '截断到 30 份');
  assert.equal(after[0].content, 'newest', '最新快照位于数组头部 (unshift)');
  // 预置 35 份 + unshift 1 份 = 36 份，截断到 30 丢弃尾部 6 份（c0..c5），最旧存活项为 c6
  assert.equal(after[29].content, 'c6', '最旧的 6 份被丢弃（c0..c5 移除）');
  // 额外确认 c0..c5 确实已从环中移除
  const remaining = after.map((s) => s.content);
  for (const c of ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']) {
    assert.ok(!remaining.includes(c), `${c} 应已被截断丢弃`);
  }
});

test('restoreSnapshot 用历史内容还原编辑区（不触碰磁盘）', async () => {
  const recKey = 'snapshots::test.md';
  store[recKey] = [
    { id: 100, content: '历史版本内容', timestamp: new Date().toISOString(), preview: '历史版本内容' },
    { id: 200, content: '另一版本', timestamp: new Date().toISOString(), preview: '另一版本' },
  ];

  const ok = await restoreSnapshot(100);
  assert.equal(ok, true);
  assert.equal(fakeEditor.state.doc.toString(), '历史版本内容', '编辑区被还原为目标快照内容');

  const miss = await restoreSnapshot(999);
  assert.equal(miss, false, '不存在的快照返回 false');
});

// ── 定时磁盘自动保存（落盘副本）─────────────────────────────────────────────

test('formatTimestamp 输出秒级时间戳 yyyyMMddHHmmss', () => {
  assert.equal(formatTimestamp(new Date(2026, 7, 4, 13, 30, 25)), '20260804133025');
  assert.equal(formatTimestamp(new Date(2026, 0, 9, 5, 6, 7)), '20260109050607');
});

test('buildAutosaveFileName：源文件主名 + 下划线 + 秒级时间戳 + .md', () => {
  const at = new Date(2026, 7, 4, 13, 30, 25);
  assert.equal(buildAutosaveFileName('这是测试文件.md', at), '这是测试文件_20260804133025.md');
  assert.equal(buildAutosaveFileName('notes.markdown', at), 'notes_20260804133025.md');
  // 无扩展名 / 空值 / 未打开文件均有确定回退，且绝不会等于源文件名
  assert.equal(buildAutosaveFileName('README', at), 'README_20260804133025.md');
  assert.equal(buildAutosaveFileName('', at), 'untitled_20260804133025.md');
  assert.equal(buildAutosaveFileName('未打开文件', at), 'untitled_20260804133025.md');
  // 副本名永远不等于源文件名，杜绝覆盖源文件
  assert.notEqual(buildAutosaveFileName('这是测试文件.md', at), '这是测试文件.md');
});

test('buildAutosaveFileName 过滤 Windows 非法文件名字符', () => {
  const at = new Date(2026, 7, 4, 13, 30, 25);
  assert.equal(buildAutosaveFileName('a:b*c?.md', at), 'a_b_c__20260804133025.md');
});

test('normalizeIntervalSec 夹取区间并回退默认 30 秒', () => {
  assert.equal(normalizeIntervalSec(30), 30);
  assert.equal(normalizeIntervalSec('45'), 45);
  assert.equal(normalizeIntervalSec(1), 5, '低于下限夹到 5 秒');
  assert.equal(normalizeIntervalSec(99999), 3600, '高于上限夹到 3600 秒');
  assert.equal(normalizeIntervalSec('abc'), 30, '非法值回退 30 秒');
  assert.equal(normalizeIntervalSec(0), 30, '0 回退 30 秒');
});

test('runDiskAutosaveOnce 调用注入的落盘函数，内容未变时跳过', async () => {
  const writes = [];
  let content = '第一版内容';
  initDiskAutosave({
    getContent: () => content,
    getSourceName: () => '这是测试文件.md',
    writeFile: async (name, body) => {
      writes.push({ name, body });
      return 'D:/System/Desktop/' + name;
    },
  });
  resetDiskAutosaveBaseline();

  const first = await runDiskAutosaveOnce();
  assert.equal(writes.length, 1, '首次落盘');
  assert.match(writes[0].name, /^这是测试文件_\d{14}\.md$/, '副本名带秒级时间戳');
  assert.equal(writes[0].body, '第一版内容');
  assert.match(first, /^D:\/System\/Desktop\/这是测试文件_\d{14}\.md$/);

  await runDiskAutosaveOnce();
  assert.equal(writes.length, 1, '内容未变化时跳过，不堆重复副本');

  content = '第二版内容';
  await runDiskAutosaveOnce();
  assert.equal(writes.length, 2, '内容变化后再次落盘');
  assert.equal(writes[1].body, '第二版内容');
});

test('落盘失败走 onError 回调，不抛出打断定时器', async () => {
  const errors = [];
  initDiskAutosave({
    getContent: () => '内容',
    getSourceName: () => 'x.md',
    writeFile: async () => {
      throw new Error('没有写入权限');
    },
    onError: (e) => errors.push(e.message),
  });
  resetDiskAutosaveBaseline();
  const r = await runDiskAutosaveOnce();
  assert.equal(r, null);
  assert.deepEqual(errors, ['没有写入权限']);
});

test('autosaveToDisk 开关状态可查询，stop 后不再运行', () => {
  assert.equal(isAutosaveToDiskOn(), false, '初始为关闭');
  const sec = autosaveToDisk(30);
  assert.equal(sec, 30);
  assert.equal(isAutosaveToDiskOn(), true);
  stopAutosaveToDisk();
  assert.equal(isAutosaveToDiskOn(), false);
});
