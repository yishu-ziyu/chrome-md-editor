/**
 * autosave-snapshot-dedup.test.js — M3 快照环去重回归
 *   pushSnapshot 压栈前与最新快照（arr[0]）内容比较，相同则跳过，避免相同内容占满 30 槽。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

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

const { pushSnapshot, listSnapshots } = await import('../src/autosave.js');

test('M3: 连续压入相同内容只保留一份', async () => {
  store['snapshots::dedup.md'] = [];
  await pushSnapshot('dedup.md', 'same');
  await pushSnapshot('dedup.md', 'same');
  await pushSnapshot('dedup.md', 'same');
  const arr = store['snapshots::dedup.md'] || [];
  assert.equal(arr.length, 1, '三次相同内容只产生一份快照');
  assert.equal(arr[0].content, 'same');
});

test('M3: 去重不破坏 30 槽上限（不同内容仍照常截断）', async () => {
  store['snapshots::rolling.md'] = [];
  // 压入 35 份互不相同内容，验证上限语义未被去重破坏
  for (let i = 0; i < 35; i++) {
    await pushSnapshot('rolling.md', 'v' + i);
  }
  const arr = store['snapshots::rolling.md'] || [];
  assert.equal(arr.length, 30, '互不相同内容仍截断到 30 份');
  const uniq = new Set(arr.map((s) => s.content));
  assert.equal(uniq.size, arr.length, '去重逻辑不影响互不相同内容');
});
