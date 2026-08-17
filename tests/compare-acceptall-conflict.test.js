/**
 * compare-acceptall-conflict.test.js — 三栏「全部」冲突块重叠回归断言（H1）
 *
 * 背景（H1）：acceptAllDir('all') 三栏分支曾把 ab 层与 bc 层的【冲突块】都压入同一
 * allChanges 数组。冲突块在 ab 层与 bc 层映射到【同一个 Result 区域】，于是两者区间
 * 重叠，触发下方重叠守卫整轮 return，dispatch 永不执行 —— 冲突文档点「全部」完全无反应，
 * 合并核心功能在冲突文档上失效。
 *
 * 修复：ab 层只压【非冲突】块（chunks.filter(c => c.layer === 'ab' && !c.conflict)），
 * 冲突块由 bc 层（右/Theirs）压入并覆盖，对齐 tooltip「右侧覆盖冲突处」语义。
 *
 * 本测试为静态源码断言（与 compare-merge-regression.test.js 同范式）：断言三栏「全部」
 * 分支的 ab 层推送确实排除了冲突块，防止后人退回「两层都压冲突块」写法重引 H1。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src', 'compare.js');

const src = fs.readFileSync(SRC, 'utf8');

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const codeOnly = stripComments(src);

// 三栏「全部」分支：ab 层推送必须排除冲突块（!c.conflict），否则冲突文档会触发
// 重叠守卫整轮中止（H1）。
test('回归：三栏「全部」ab 层推送必须排除冲突块（!c.conflict）', () => {
  // 匹配：chunks.filter((c) => c.layer === "ab" && !c.conflict)（兼容有无外层括号）
  const re = /chunks\.filter\(\s*\(?\s*c\s*\)?\s*=>\s*c\.layer\s*===\s*["']ab["']\s*&&\s*!c\.conflict\s*\)/;
  const m = codeOnly.match(re);
  assert.ok(
    m,
    '未找到「ab 层且非冲突」的过滤写法；三栏「全部」可能重引 H1（冲突块重叠中止）'
  );
});

test('回归：三栏「全部」分支不得对 ab+bc 冲突块做无差别合并', () => {
  // 反向断言：同一 pushAll 调用里，ab 层过滤不应「仅按 layer 过滤且含冲突」。
  // 即不应存在 chunks.filter(c => c.layer === "ab") 出现在三栏 all 分支内
  // （应已带 !c.conflict）。用更宽松的匹配确认 ab 层过滤带 !c.conflict。
  const abBare = /pushAll\(\s*abViews\.srcView[\s\S]{0,200}?chunks\.filter\(\s*\(?\s*c\s*\)?\s*=>\s*c\.layer\s*===\s*["']ab["']\s*\)\s*\)/;
  const bad = codeOnly.match(abBare);
  assert.ok(
    !bad,
    '三栏「全部」ab 层推送仍是无差别 layer 过滤（未排除冲突块），H1 可能复发'
  );
});
