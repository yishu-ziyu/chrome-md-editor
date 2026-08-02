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
} = await import('../src/autosave.js');

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
