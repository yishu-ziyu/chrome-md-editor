// 路径省略工具：保留文件名完整，中间段用 '...' 省略，使总长 <= maxLen（按字符计，中文算 1）
// 处理函数可能含 '/' 或 '\' 两种分隔符。
// 设计文档：.workbuddy/memory/对比合并重构设计文档.md §7
export function ellipsizePath(fullPath, maxLen = 32) {
  // 容错：maxLen 过小（<6）无法塞入 '...' + 至少 3 字符文件名，直接返回原路径，
  // 避免 file.slice(file.length-(maxLen-3)) 在 maxLen<3 时返回空串或产出比 maxLen 还长的 '...'。
  if (maxLen < 6) return fullPath;
  // sep 必须与「真正命中的分隔符」一致：混合分隔符路径（如 'C:\\a/b.md'）下，
  // 边界由 Math.max(lastIndexOf('/'), lastIndexOf('\\')) 决定，sep 应跟随该分隔符而非仅看是否含 '/'，
  // 否则会出现 dir 用 '\'、拼接用 '/' 的不一致重建。
  const slashIdx = fullPath.lastIndexOf('/');
  const backIdx = fullPath.lastIndexOf('\\');
  const idx = Math.max(slashIdx, backIdx);
  const sep = backIdx > slashIdx ? '\\' : '/';
  const dir = idx >= 0 ? fullPath.slice(0, idx) : '';
  const file = idx >= 0 ? fullPath.slice(idx + 1) : fullPath;
  if (fullPath.length <= maxLen) return fullPath;
  if (file.length >= maxLen - 3) return '...' + file.slice(file.length - (maxLen - 3)); // 文件名本身就超长
  const headLen = Math.ceil((maxLen - 3 - file.length) / 2);
  const tailLen = maxLen - 3 - file.length - headLen;
  return dir.slice(0, headLen) + '...' + dir.slice(dir.length - tailLen) + sep + file;
}

// 三用例（验收）：
// 1. 短路径原样返回：ellipsizePath('C:/a/b.md')                      -> 'C:/a/b.md'
// 2. 文件名超长保尾：ellipsizePath('C:/a/verylongfilename-that-exceeds.md', 20) -> '...hat-exceeds.md'
// 3. 多段路径中间省略：ellipsizePath('C:/a/very/long/path/to/myfile.md', 20) -> 'C:/a...th/to/myfile.md'
