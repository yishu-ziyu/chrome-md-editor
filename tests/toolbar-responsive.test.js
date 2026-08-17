// 弱测试：仅校验 editor.css 在 TOOLBAR_RESPONSIVE 标记之后追加了响应式修复，
// 即含 flex-wrap 或 overflow-x（不依赖任何外部依赖，node --test 内置运行）。
// 本功能为纯 CSS，无逻辑可执行，故仅做字符串断言。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "editor.css"),
  "utf8"
);

const MARKER = "MARKRA_CSS: TOOLBAR_RESPONSIVE";

test("editor.css 含 TOOLBAR_RESPONSIVE 集成标记", () => {
  assert.ok(
    CSS.includes(MARKER),
    "缺少 MARKRA_CSS: TOOLBAR_RESPONSIVE 标记"
  );
});

test("TOOLBAR_RESPONSIVE 标记后追加了响应式修复（flex-wrap 或 overflow-x）", () => {
  const idx = CSS.indexOf(MARKER);
  const after = CSS.slice(idx);
  assert.ok(
    /flex-wrap/.test(after) || /overflow-x/.test(after),
    "标记后未找到 flex-wrap 或 overflow-x，响应式修复缺失"
  );
});

// 提取首个 .toolbar { ... } 规则块（含其中所有声明，直到匹配的 }）
function extractToolbarBlock(css) {
  const start = css.indexOf(".toolbar {");
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return css.slice(open + 1, i);
}

test("问题2/3 修复：.toolbar 为单行固定高度 + 横向滚动（不再换行溢出）", () => {
  const block = extractToolbarBlock(CSS);
  assert.ok(block, "未找到 .toolbar 规则块");
  // 单行：不换行
  assert.ok(/flex-wrap:\s*nowrap/.test(block), ".toolbar 必须 flex-wrap: nowrap（单行）");
  // 固定高度，避免全屏时按钮高低错落 / 非全屏时换行
  assert.ok(/height:\s*var\(--toolbar-height\)/.test(block), ".toolbar 必须固定高度");
  // 溢出时横向滚动而非纵向换行堆叠
  assert.ok(/overflow-x:\s*auto/.test(block), ".toolbar 必须 overflow-x: auto（横向滚动）");
});
