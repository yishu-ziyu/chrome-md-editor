# Chrome-Markdown-Edit「对照/合并」代码级实现方案与技术路线

> 版本：v1.0（实施蓝图）
> 日期：2026-08-08
> 前置文档：`docs/compare-merge-spec.md`（功能规格书，单一事实源）
> 调研基础：GitHub 全仓搜索（`udamir/api-diff-viewer`、`@replit/codemirror-minimap`、`wikEdDiff`、Git `--color-moved` 算法）
> 状态：方案已就绪，**待用户下达修改代码指令后**按本方案实施

---

## 0. 双端统一架构（关键前提）

| 运行环境 | 技术栈 | 文件读写通道 |
|---|---|---|
| 浏览器侧 | WXT + MV3 + CodeMirror 6（`@codemirror/merge` 6.12） | `showOpenFilePicker` / `showSaveFilePicker`（File System Access API）+ `chrome.storage` 回退；现有 `src/compare-files.js` 已封装 |
| EXE 侧 | Tauri 2（`desktop/` 已确认 `tauri-plugin-fs`） | webview 加载**同一份** `compare.html` + `src/compare*.js`；文件读写经 `invoke('save_file' / 'read_file')` 调用 Rust 命令 |

**核心原则**：所有对照/合并的 UI 与差异算法是**同一份前端代码**，双端复用。仅「文件读写」与「运行环境探测」分流。

**环境探测守卫**（沿用项目既有约定）：
```js
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```
所有涉及真实文件落盘的调用，统一走 `ioBridge.read(path)` / `ioBridge.write(path, content)`，内部按 `isTauri` 分流到 Tauri 命令或浏览器 API。

---

## 1. 文件结构（新增 / 修改）

### 1.1 新增目录 `src/compare/`（模块化拆分，避免 `compare.js` 继续膨胀）

| 新文件 | 职责 | 移植/自研 |
|---|---|---|
| `src/compare/inline-word-diff.js` | 行内字词级差异装饰（两侧面板） | **移植** `api-diff-viewer` 的 `inline-word-diff.ts` + `word-diff.ts`，适配 MergeView |
| `src/compare/move-detection.js` | 移动块检测纯函数（删除块↔新增块指纹匹配） | **自研**（Git `--color-moved=blocks` 思路 + `wikEdDiff` 阈值参考） |
| `src/compare/move-decorations.js` | 移动块蓝色装饰 + 主体侧边连接线 | **自研** |
| `src/compare/location-pane.js` | Location Pane（差异色块 + 移动块连线 SVG 层） | **移植基底** `@replit/codemirror-minimap` + **自研** SVG 叠加 |
| `src/compare/toolbar.js` | 完整工具栏（与主编辑器一致） | **自研**（复用 `editor.html` 按钮定义） |
| `src/compare/chunk-ops.js` | 差异块接受/拒绝、应用非冲突变更 | **自研** |
| `src/compare/save.js` | 活动栏保存 / 另存为 / 导出 diff（双端分流） | **自研** |
| `src/compare/io-bridge.js` | 文件读写环境分流（Tauri / 浏览器） | **自研** |

### 1.2 修改既有文件

| 文件 | 修改点 |
|---|---|
| `src/compare.js` | 重构控制器：装配新模块、维护活动栏状态、两栏/三栏切换、默认展开 |
| `src/compare-merge.js` | 接入 `inline-word-diff` 与 `move-detection`，替换旧 `getChunks` 步进 |
| `src/compare.html` | 布局重排：顶部信息/工具栏区 → 三栏主体 → Location Pane → 底部操作栏 |
| `src/compare.css`（或并入现有 css） | 浅红色/绿色/蓝色语义色变量、移动块连线样式、Location Pane 布局 |
| `src/compare-files.js` | 扩展：支持三栏分别选文件、返回 `filePath` 供保存使用 |
| `README.md` | 修订过时描述（单栏 unified 视图、`presentableDiff` 等） |
| `package.json` | 新增依赖 `@replit/codemirror-minimap`、`diff`（若未间接引入） |

---

## 2. 模块代码级设计

### 2.1 `inline-word-diff.js`（行内字词差异）

**移植来源**：`udamir/api-diff-viewer` 的 `inline-word-diff.ts`（StateField + ViewPlugin + Decoration，基于 `diff` 包的 `diffWords`/`diffChars`）。

**适配要点**：`MergeView` 的每个面板是独立 `EditorView`。需要对「修改行」注入其对应侧的旧/新内容：

```js
import { diffWords, diffChars } from 'diff';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

// 注入数据：每行修改行的 before/after
export const setWordDiffEffect = StateEffect.define(); // payload: {line, before, after}[]

export const wordDiffField = StateField.define({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setWordDiffEffect)) return e.value;
    return value;
  },
});

// 核心：对一对字符串做字词 diff，返回 ranges
export function computeWordDiff(before, after, mode = 'word') {
  const fn = mode === 'word' ? diffWords : diffChars;
  const changes = fn(before, after);
  // 同 api-diff-viewer：累积 beforeRanges / afterRanges（详见其 word-diff.ts）
  // 返回 { beforeRanges: [{from,to,type}], afterRanges: [...] }
}

// 装饰构建 + ViewPlugin（直接复用 api-diff-viewer 的 buildWordDiffDecorations）
// 主题：.cm-diff-word-added / .cm-diff-word-removed 走 CSS 变量
```

**装配时机**：在 `MergeView` 初始化后，以及任一面板 `docChanged` 后，由控制器（`compare.js`）计算相邻栏修改行的 before/after 映射，分发给各面板的 `wordDiffField`。

### 2.2 `move-detection.js`（移动块检测）

**算法**（Git `--color-moved=blocks` 思路，纯函数，可单测）：

```js
export function detectMoves(aLines, bLines, chunks, opts = {}) {
  const minLines = opts.minLines ?? 2;        // 规格书 12.2：≥2 行
  const minChars = opts.minChars ?? 20;       // 规格书 12.2：≥20 字符
  const maxPairs = opts.maxPairs ?? 200;      // 大文件降级上限
  const ignoreWs = opts.ignoreWhitespace ?? true;

  // 1. 从行级 diff chunks 收集：
  //    - deletedBlocks：a 中「纯删除」连续行区间
  //    - addedBlocks：b 中「纯新增」连续行区间
  //    （modified 行不计入，避免与行内 diff 重复）
  // 2. 指纹：fingerprint(line) = hash(ignoreWs ? line.trim().replace(/\s+/g,'') : line.trim())
  // 3. 匹配：deletedBlocks 与 addedBlocks 中指纹相同的区间配对
  //    - 贪心合并连续匹配成移动块对
  // 4. 过滤：块内行数 ≥ minLines 且 非空字符数 ≥ minChars
  // 5. 截断：配对数量 > maxPairs 时只保留前 maxPairs（渲染层据 truncated 标志仅高亮不连线）
  // 返回：{ pairs: [{srcFrom, srcTo, dstFrom, dstTo, text}], truncated: boolean }
}
```

**指纹函数**：
```js
function fingerprint(line, ignoreWs) {
  let s = line.trim();
  if (ignoreWs) s = s.replace(/\s+/g, '');
  return cyrb53(s); // 或 djb2，无需加密级，碰撞率低即可
}
```

**性能**：最坏 O(N·M)（N/M 为删/增块数）。大文件（>5000 行）启用 `maxPairs` 上限与「仅高亮不连线」降级，避免卡顿。

### 2.3 `move-decorations.js`（移动块装饰 + 主体侧边连线）

```js
// 蓝色背景装饰：遍历 movePairs，对 src/dst 区间加 line decoration（class cm-move-block）
// 主体侧边连接线：在每个面板 DOM 的 gutter 旁挂一个绝对定位 <svg>，
//   按 (lineFrom, lineTo) 映射到 y 坐标，画贝塞尔曲线连接 src 顶部与 dst 顶部
export function moveDecorationsExtension(pairs) {
  return [moveField, movePlugin, moveTheme, sideConnectorLayer];
}
```

### 2.4 `location-pane.js`（Location Pane）

**基底**：`@replit/codemirror-minimap` v0.5.2（MIT）。

```js
import { showMinimap } from '@replit/codemirror-minimap';

// 差异行 → 颜色映射：{ [lineNo]: '#浅红' | '#绿' | '#蓝' }
const gutters = buildDiffGutters(diffState);

const minimapExt = showMinimap.compute(['doc'], () => ({
  displayText: 'blocks',
  showOverlay: 'always',
  gutters: [gutters],
}));

// 叠加 SVG 连线层：在 minimap 的 create 容器上挂 <svg>，
//   按 lineNo 比例映射 y，绘制移动块 src→dst 连线（同 2.3 的坐标算法）
```

**注意**：移动块连线在两个位置都画——主体侧边（`move-decorations.js`）+ Location Pane 内（`location-pane.js`），坐标算法共用一个 `lineToY(view, lineNo)` 工具。

### 2.5 `toolbar.js`（完整工具栏）

复用 `editor.html` 的格式化按钮定义（加粗/斜体/高亮/颜色/字号，**不得隐藏**，呼应项目铁律）。新增对照专属按钮：

- 打开文件（左/中/右独立 selector）
- 保存 / 另存为（作用于活动栏）
- 撤销 / 重做
- 查找 / 替换
- 上一差异 / 下一差异（`B` / `]`）
- 上一移动块 / 下一移动块（`Alt+[` / `Alt+]`）
- 展开 / 折叠所有差异（**默认展开**）
- 显示 / 隐藏行内差异高亮
- 显示 / 隐藏空白差异
- 切换两栏 / 三栏
- 块移动检测开关
- 应用非冲突变更（**默认关闭**，显式触发）

### 2.6 `chunk-ops.js`（差异块操作）

```js
// 接受：把 src 区间文本覆盖写入 dst 面板对应位置
export function acceptChunk(dstView, srcFrom, srcTo, dstFrom, dstTo) {
  const text = srcView.state.doc.sliceString(srcFrom, srcTo);
  dstView.dispatch({ changes: { from: dstFrom, to: dstTo, insert: text } });
}
// 拒绝/忽略：从待处理列表移除（标记已处理，不改内容）
// 应用非冲突变更：对所有 non-conflicting chunk 批量 acceptChunk
```

### 2.7 `save.js` + `io-bridge.js`（双端保存）

```js
// io-bridge.js
export const ioBridge = isTauri
  ? { read: (p) => invoke('read_file', { path: p }),
      write: (p, c) => invoke('save_file', { path: p, content: c }) }
  : { read: (p) => fsAccessRead(p),
      write: (p, c) => fsAccessWrite(p, c) };

// save.js
let activePane = 'a'; // 用户最后聚焦的栏
export function saveActivePane(panes) {
  const { view, filePath } = panes[activePane];
  return ioBridge.write(filePath, view.state.doc.toString());
}
export function exportDiff(panes) { /* 生成 .diff 文本，复用现有 compare-diff-export.js */ }
```

---

## 3. 实施步骤顺序（建议提交粒度）

1. **脚手架**：建 `src/compare/` 子目录；`package.json` 加 `@replit/codemirror-minimap` + `diff`；`io-bridge.js` 环境分流。
2. **行内字词差异**：移植 `inline-word-diff.js`，接入 `compare.js` 控制器，验证两栏修改行高亮。
3. **移动块检测**：实现 `move-detection.js`（纯函数 + `node --test` 单测）。
4. **移动块渲染**：`move-decorations.js`（蓝色装饰 + 主体侧边连线）。
5. **Location Pane**：接入 `@replit/codemirror-minimap` + SVG 连线层。
6. **工具栏对齐**：`toolbar.js` 补齐主编辑器一致按钮 + 对照专属按钮。
7. **块操作 + 保存**：`chunk-ops.js` + `save.js`（活动栏 + 双端分流）。
8. **布局重排**：`compare.html` 改为顶部栏 / 三栏 / Location Pane / 底部栏四区。
9. **默认值收口**：默认展开、浅红色（CSS 变量）、应用非冲突默认关闭、三栏平级 A/B/C。
10. **README 修订**：删除「单栏 unified 视图」「presentableDiff」等过时描述，对齐 v1.8.6+ 实际架构。
11. **验证**：`node --test`（检测/IO 逻辑）、Playwright 真机点检（两栏/三栏/移动块/保存）、双端（浏览器扩展 + Tauri EXE）各跑一遍。

---

## 4. 性能阈值（规格书 12.2 已确认）

| 参数 | 值 | 说明 |
|---|---|---|
| 移动块最小行数 | `minLines = 2` | 连续 ≥ 2 行才判为块 |
| 移动块最小字符 | `minChars = 20` | 对齐 Git `--color-moved=blocks` |
| 大文件降级行数 | `> 5000` 行 | 触发候选上限 |
| 移动块候选上限 | `maxPairs = 200` | 超出则 `truncated=true`，仅高亮不连线 |
| 空白处理 | 默认忽略首尾空白 | 与「显示/隐藏空白差异」开关联动 |

---

## 5. 验收映射（对应规格书第 11 节）

- 两栏完整不折叠可编辑 + 行内高亮 → 步骤 2
- 三栏平级 A/B/C 独立可编辑、相邻栏差异 → 步骤 8 + 1
- 工具栏一致 + 格式化按钮保留 → 步骤 6
- 移动块检测 + 蓝色 + 连线 + Location Pane → 步骤 3/4/5
- 块接受/拒绝 + 活动栏保存 → 步骤 7
- 导出 diff 保留独立 → 步骤 7（`exportDiff`）
- 浅红/绿/蓝在暗色/亮色/豆沙绿可读 → 步骤 9（CSS 变量）

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| `@replit/codemirror-minimap` 的 `gutters` 为「行号→颜色」单值映射，移动块连线需自研 SVG 叠加 | 在 `create` 容器挂绝对定位 `<svg>`，与主体侧边连线共用坐标算法 |
| MergeView 内部 chunk 信息访问受限 | 不依赖其内部，自行对两栏文档做行级 diff 得到 chunks（与现有 `compare-merge.js` 一致） |
| 大文件移动检测 O(N²) 卡顿 | `maxPairs` 上限 + 仅高亮不连线降级 |
| 双端文件 IO 行为不一致 | 统一经 `ioBridge`，Tauri/浏览器分流，单测覆盖 |
| 移植 `api-diff-viewer` 代码许可 | 其 LICENSE 需确认（MIT 可能性高），落地前核对并注明出处 |
