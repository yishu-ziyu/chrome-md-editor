/**
 * tasklist-panel.test.js — A-12 任务列表面板（M6 空任务正则修复）单测
 *
 * 覆盖 parseTaskLine 纯逻辑：
 *   - 普通 / 已勾选 / 有序 / 缩进任务解析
 *   - 空任务（[ ] / [x] 后无尾随文本，M6 放宽 \s* 后识别）
 *   - 非任务行 / 非字符串返回 null
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine } from '../src/tasklist-panel.js';

test('parseTaskLine: 普通任务', () => {
  assert.deepEqual(parseTaskLine('- [ ] 写文档'), {
    indent: 2,
    checked: false,
    text: '写文档',
  });
});

test('parseTaskLine: 空任务（M6 修复）', () => {
  assert.deepEqual(parseTaskLine('- [ ]'), { indent: 2, checked: false, text: '' });
  assert.deepEqual(parseTaskLine('- [x]'), { indent: 2, checked: true, text: '' });
});

test('parseTaskLine: 已勾选任务', () => {
  assert.deepEqual(parseTaskLine('- [x] 完成', ), {
    indent: 2,
    checked: true,
    text: '完成',
  });
});

test('parseTaskLine: 有序列表任务', () => {
  assert.deepEqual(parseTaskLine('1. [ ] 第一步'), {
    indent: 3,
    checked: false,
    text: '第一步',
  });
});

test('parseTaskLine: 缩进任务', () => {
  assert.deepEqual(parseTaskLine('  - [ ] 子任务'), {
    indent: 4,
    checked: false,
    text: '子任务',
  });
});

test('parseTaskLine: 星号列表任务', () => {
  assert.deepEqual(parseTaskLine('* [ ] 星号项'), {
    indent: 2,
    checked: false,
    text: '星号项',
  });
});

test('parseTaskLine: 非任务行返回 null', () => {
  assert.equal(parseTaskLine('普通文本'), null);
  assert.equal(parseTaskLine('# 标题'), null);
  assert.equal(parseTaskLine('- 无方框'), null);
  assert.equal(parseTaskLine('> [ ] 引用中的伪任务'), null);
});

test('parseTaskLine: 非字符串返回 null', () => {
  assert.equal(parseTaskLine(null), null);
  assert.equal(parseTaskLine(undefined), null);
  assert.equal(parseTaskLine(42), null);
});
