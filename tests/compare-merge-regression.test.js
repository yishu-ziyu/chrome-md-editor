/**
 * compare-merge-regression.test.js — rAF 轮询 NULL 安全回归断言（L3）
 *
 * 背景：assemble-core 装配的装饰调度器（createDecorationScheduler）在页面初次
 * 加载时用一个 requestAnimationFrame 轮询等待 MergeView 完成初始化。该窗口内
 * getChunks(state) 官方契约返回 null（"the editor doesn't have a merge extension
 * active or the merge view hasn't finished initializing yet"）。
 *
 * 若任何消费点写成裸链式 `getChunks(state).chunks`，首帧就会抛
 * TypeError: Cannot read properties of null (reading 'chunks')，被轮询的
 * catch(_){} 静默吞掉，导致轮询永久终止 —— 行内字词高亮与移动块高亮在初次加载时
 * 永远不出现（只有手动敲键触发 debounce 重启才偶然恢复）。
 *
 * 修复手段：所有消费点统一经由 null 安全的 safeChunks() 取 chunks。
 *
 * 本测试为静态源码断言，不依赖 CodeMirror/Tauri 运行时，稳定可靠：
 *   1) 断言 compare-merge.js 的非注释代码中不存在裸链式
 *      `getChunks(...)`.chunks`（正则 /getChunks\([^)]*\)\.chunks/）。
 *   2) 断言源码中确实存在 null 安全的 safeChunks 取值封装，防止后人删掉它又
 *      退回裸写法。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src', 'compare-merge.js');

const src = fs.readFileSync(SRC, 'utf8');

// 去掉块注释 /* ... */ 与行注释 // ...，避免 docstring 里的举例文本
// 「不要写 getChunks(state).chunks」被误判为真实代码调用点。
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（保留 http:// 之类的协议）
}

const codeOnly = stripComments(src);

// 裸链式写法：getChunks(...) 之后直接 .chunks
const BARE = /getChunks\([^)]*\)\.chunks/;

test('回归：compare-merge.js 非注释代码中不得出现裸链式 getChunks(state).chunks', () => {
  const m = codeOnly.match(BARE);
  assert.ok(
    !m,
    `发现裸链式 getChunks().chunks 调用（应为 null 安全写法），命中片段：` +
      (m ? m[0] : '')
  );
});

test('回归：compare-merge.js 必须存在 null 安全的 safeChunks 取值封装', () => {
  // 允许 function 声明或 const/let 赋值两种形态，只要名字是 safeChunks 且内部
  // 调用了 getChunks 即可。
  assert.match(
    src,
    /(?:function\s+safeChunks|(?:const|let|var)\s+safeChunks\s*=)/,
    '应存在 safeChunks 封装（function 声明 或 const/let 赋值）'
  );
  assert.match(
    src,
    /safeChunks[\s\S]*getChunks/,
    'safeChunks 内部应调用 getChunks 并做 null 兜底'
  );
});
