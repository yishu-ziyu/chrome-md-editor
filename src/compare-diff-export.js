// compare-diff-export.js
// 导出 diff 报告（T6b / 增量 F）。
//
// 关键事实：导出的是「行级统一 diff」。使用 @codemirror/merge 的 Chunk.build(a, b)
// 在【行】粒度对齐两侧差异块（fromA/toA/fromB/toB 均为行对齐位置），输出 git 风格
// 统一 diff（约 50 行），每一删除/新增行为【完整原始整行】，不再出现 presentableDiff
// 的字符级截断（见 BUG-C4-01）。
//
// 渲染为 git 风格统一 diff（约 50 行），最后复用 compare-export.js 的 exportResult 写出。

import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { exportResult } from "./compare-export.js";

/**
 * 根据两侧文档生成 git 风格统一 diff 文本（行级）。
 * @param {string} a 原始文档（左侧 Yours）
 * @param {string} b 新文档（右侧 Theirs / 合并结果）
 * @param {object} [config] DiffConfig（scanLimit / timeout 等），默认 { scanLimit: 500, timeout: 1500 }
 * @returns {string} 统一 diff 文本（含 @@ 行与 +/- 标记）；无差异时返回空串。
 */
export function buildDiffText(a, b, config) {
  const ta = Text.of(a.split("\n"));
  const tb = Text.of(b.split("\n"));
  const chunks = Chunk.build(ta, tb, config || { scanLimit: 500, timeout: 1500 });
  if (!chunks.length) return "";

  const out = [];
  for (const c of chunks) {
    const oldStart = ta.lineAt(c.fromA).number;
    const newStart = tb.lineAt(c.fromB).number;
    const oldLines = [];
    const newLines = [];
    // 收集 [fromA, toA) 范围内的【完整整行】（Chunk.build 已行对齐）
    for (let pos = c.fromA; pos < c.toA; ) {
      const line = ta.lineAt(pos);
      oldLines.push(line.text);
      pos = line.to + 1;
    }
    for (let pos = c.fromB; pos < c.toB; ) {
      const line = tb.lineAt(pos);
      newLines.push(line.text);
      pos = line.to + 1;
    }
    out.push(`@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`);
    for (const l of oldLines) out.push(`- ${l}`);
    for (const l of newLines) out.push(`+ ${l}`);
  }
  return out.join("\n") + "\n";
}

/**
 * 导出 diff 报告：生成可读 diff 文本并写出。
 * @param {string} a 原始文档
 * @param {string} b 新文档
 * @param {string} [filename="diff.diff"] 建议文件名
 * @returns {Promise<void>}
 */
export async function exportDiffReport(a, b, filename = "diff.diff") {
  const text = buildDiffText(a, b);
  await exportResult(text, filename);
}
