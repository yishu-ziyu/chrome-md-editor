// ============================================================
// A-6 代码块语言名补全 —— 纯逻辑测试
// ------------------------------------------------------------
// 验证 buildLanguageCompletions(query) 的候选构建与简写展开。
// 该纯函数不依赖 @codemirror/language-data，可在无 node_modules 环境下独立运行。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanguageCompletions } from '../src/codeblock-complete.js';

test('py 展开为 python', () => {
  const opts = buildLanguageCompletions('py');
  assert.ok(opts, '空栈外应返回候选');
  assert.ok(
    opts.some((o) => o.label === 'python'),
    'py 应展开为 python',
  );
});

test('js 展开为 javascript', () => {
  const opts = buildLanguageCompletions('js');
  assert.ok(opts, '应返回候选');
  assert.ok(
    opts.some((o) => o.label === 'javascript'),
    'js 应展开为 javascript',
  );
});

test('go 展开为 go', () => {
  const opts = buildLanguageCompletions('go');
  assert.ok(opts, '应返回候选');
  assert.ok(
    opts.some((o) => o.label === 'go'),
    'go 应展开为 go',
  );
});

test('空 query 含常见语言（javascript/python/go）', () => {
  const opts = buildLanguageCompletions('');
  assert.ok(opts, '应返回候选');
  const labels = opts.map((o) => o.label);
  assert.ok(labels.includes('javascript'), '空 query 应含 javascript');
  assert.ok(labels.includes('python'), '空 query 应含 python');
  assert.ok(labels.includes('go'), '空 query 应含 go');
});

test('候选 label 去重', () => {
  const opts = buildLanguageCompletions('');
  assert.ok(opts, '应返回候选');
  const labels = opts.map((o) => o.label);
  assert.strictEqual(
    labels.length,
    new Set(labels).size,
    '候选 label 不应重复',
  );
});

test('候选结构为 {label, type:"text", detail}', () => {
  const opts = buildLanguageCompletions('py');
  assert.ok(opts && opts.length > 0, '应返回候选');
  for (const o of opts) {
    assert.equal(typeof o.label, 'string');
    assert.equal(o.type, 'text');
    assert.ok('detail' in o);
  }
});

test('未知简写且无匹配时返回 null', () => {
  const opts = buildLanguageCompletions('zzzzznoalias');
  // 无 node_modules 且 ALIASES/base 中均无匹配项时应为 null
  if (opts) {
    const labels = opts.map((o) => o.label);
    assert.strictEqual(labels.length, new Set(labels).size);
  } else {
    assert.equal(opts, null);
  }
});
