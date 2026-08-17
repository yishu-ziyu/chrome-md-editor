// tauri-env.js
// ---------------------------------------------------------------------------
// 共享的 Tauri 运行环境判定工具。
//
// 背景：src/desktop-shims.js（IIFE，编辑器垫片）与 src/compare-shims.js
// （ESM，对比合并垫片）此前各自写了一套 isTauri 判定，口径不一致：
//   - desktop-shims：仅 `"__TAURI_INTERNALS__" in window`
//   - compare-shims：window.__TAURI_INTERNALS__ || window.isTauri || window.__TAURI__
// 统一到此处，双端共用同一逻辑，避免「某端判定为 Tauri 另一端未判定」的
// 行为分歧（例如桌面端窗口接管生效、但对比/合并文件读写却走了浏览器分支）。
//
// 本模块不依赖任何其他模块，避免循环依赖。同时被两垫片 import。
// ---------------------------------------------------------------------------

/**
 * 是否运行在 Tauri 桌面壳内。
 * 兼容三种常见注入写法：
 *   - window.__TAURI_INTERNALS__（Tauri v2 标准注入）
 *   - window.isTauri（部分封装壳显式标记）
 *   - window.__TAURI__（旧版 / 自定义注入）
 * 在非浏览器（SSR / Node）环境返回 false。
 *
 * @returns {boolean}
 */
export function isTauriEnv() {
  if (typeof window === 'undefined') return false;
  return !!(window.__TAURI_INTERNALS__ || window.isTauri || window.__TAURI__);
}
