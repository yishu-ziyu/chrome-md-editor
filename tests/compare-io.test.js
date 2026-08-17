/**
 * compare-io.test.js — 桥接层命令名一致性 + 降级 / 容错逻辑静态断言（L3）
 *
 * 用 fs.readFileSync 静态读取 compare 桥接层（JS）与 Rust 后端源码，断言：
 *   1) 命令名一致性：JS 调用的 Tauri 命令 read_multiple_text_files / save_compare_result
 *      在 desktop/src/lib.rs 以 #[tauri::command] 注册且进入 generate_handler! 列表。
 *   2) H2：compare-shims.js 的 saveFile 桌面分支使用 dialog.save(...) 弹保存对话框
 *      （而非直接 invoke save_compare_result 带默认路径）—— 验证桌面保存对话框修复落地点。
 *   3) M4：compare-files.js 浏览器 pickFiles 分支包含 oncancel 处理 —— 验证取消修复落地点。
 *   4) M5：desktop/src/lib.rs 的 read_multiple_text_files 采用逐文件容错结构
 *      （FileReadResult 含 content / error 字段），不再以整批 Result<Vec, Err> 聚合失败。
 *
 * 全部为静态文本断言，不依赖 Tauri 运行时，稳定可靠。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src');
const LIB = path.join(root, 'desktop', 'src', 'lib.rs');

const shims = fs.readFileSync(path.join(SRC, 'compare-shims.js'), 'utf8');
const files = fs.readFileSync(path.join(SRC, 'compare-files.js'), 'utf8');
const lib = fs.readFileSync(LIB, 'utf8');

// 提取 generate_handler! [ ... ] 列表中的命令名
function handlerCommands(text) {
  const m = text.match(/generate_handler!\s*[\[\(]([\s\S]*?)[\]\)]/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

test('命令名一致性：read_multiple_text_files 在 lib.rs 注册并进入 generate_handler!', () => {
  assert.match(
    lib,
    /#\[tauri::command\]\s*\n\s*(pub\s+)?fn\s+read_multiple_text_files\b/,
    'lib.rs 应以 #[tauri::command] 注册 read_multiple_text_files'
  );
  const cmds = handlerCommands(lib);
  assert.ok(
    cmds.includes('read_multiple_text_files'),
    'read_multiple_text_files 应出现在 generate_handler! 列表'
  );
});

test('命令名一致性：save_compare_result 在 lib.rs 注册并进入 generate_handler!', () => {
  assert.match(
    lib,
    /#\[tauri::command\]\s*\n\s*(pub\s+)?fn\s+save_compare_result\b/,
    'lib.rs 应以 #[tauri::command] 注册 save_compare_result'
  );
  const cmds = handlerCommands(lib);
  assert.ok(
    cmds.includes('save_compare_result'),
    'save_compare_result 应出现在 generate_handler! 列表'
  );
});

test('JS 桥接层确实 invoke 这两个命令（命令名拼写一致，无漂移）', () => {
  assert.ok(
    shims.includes('"read_multiple_text_files"'),
    'compare-shims.js 应 invoke("read_multiple_text_files", ...)'
  );
  assert.ok(
    shims.includes('"save_compare_result"'),
    'compare-shims.js 应 invoke("save_compare_result", ...)'
  );
});

test('H2: saveFile 桌面分支使用 dialog.save( 弹保存对话框', () => {
  const m = shims.match(/export async function saveFile[\s\S]*?\n}\s*/);
  assert.ok(m, '应能定位 saveFile 函数体');
  const body = m[0];
  assert.ok(
    body.includes('dialog.save('),
    'saveFile 桌面分支应包含 dialog.save( 调用（H2 修复落地点，先弹框取路径）'
  );
  assert.ok(
    body.includes('save_compare_result'),
    '确认最终仍 invoke save_compare_result 写盘'
  );
});

test('M4: compare-files.js 浏览器 pickFiles 分支包含 oncancel 处理', () => {
  const m = files.match(/export async function pickFiles[\s\S]*?\n}\s*/);
  assert.ok(m, '应能定位 pickFiles 函数体');
  const body = m[0];
  assert.ok(
    body.includes('oncancel'),
    'pickFiles 浏览器分支应包含 oncancel 处理（M4 修复落地点，避免 Promise 永不 settle）'
  );
});

test('M5: read_multiple_text_files 采用逐文件容错结构（FileReadResult 含 content/error）', () => {
  assert.ok(/struct\s+FileReadResult/.test(lib), '应定义 FileReadResult 结构');
  assert.ok(
    /content\s*:\s*Option<String>/.test(lib),
    'FileReadResult 应有 content: Option<String>（成功项）'
  );
  assert.ok(
    /error\s*:\s*Option<String>/.test(lib),
    'FileReadResult 应有 error: Option<String>（失败项）'
  );
  // 返回类型为逐文件 Vec<FileReadResult>，而非整批 Result<Vec<...>, Err>
  assert.ok(
    /fn\s+read_multiple_text_files\s*\([^)]*\)\s*->\s*Vec<FileReadResult>/.test(lib),
    'read_multiple_text_files 应返回 Vec<FileReadResult>（逐文件容错）'
  );
  assert.ok(
    !/fn\s+read_multiple_text_files\s*\([^)]*\)\s*->\s*Result<Vec<FileReadResult>/.test(lib),
    'read_multiple_text_files 不应以 Result<Vec<...>, _> 整批失败聚合（M5 修复落地点）'
  );
});
