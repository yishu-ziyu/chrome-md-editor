# Chrome-Markdown-Edit「对照/合并」实现难度与成本评估

> 日期：2026-08-08
> 依据：`docs/compare-merge-spec.md`（规格书）+ `docs/compare-merge-impl-plan.md`（实现方案）+ 现状代码度量
> 目的：在实施前量化难度、成本与风险，辅助排期与分期决策

---

## 0. 评估方法

- 代码规模：统计 `src/compare*.js|html|css` 共 **11 文件 / 2150 行**；`tests/` 含 4 个 compare 测试。
- 依赖许可：经 `gh api` 核实 `udamir/api-diff-viewer` = **MIT**，`@replit/codemirror-minimap` v0.5.2 = **MIT**。
- 架构对接：通读 `src/compare-merge.js`，确认现状 diff 引擎已封装 `@codemirror/merge` 的 `MergeView` 与 `getChunks` / `Chunk`。
- 难度分四级：低 / 中 / 中高 / 高。成本按「有 CodeMirror 6 经验的开发者」估算人日（1 人日 = 8 小时专注开发，含联调但不含多轮返工）。

---

## 1. 总体结论

| 维度 | 评级 |
|---|---|
| **综合实现难度** | **中等偏高（Medium-High）** |
| **综合实现成本** | **新增 ~1100–1300 行 + 重构 ~500–700 行 + 测试 ~200 行；约 10–14 人日**（熟悉 CM6）／15–21 人日（不熟悉 CM6） |
| **最大瓶颈** | 三栏架构重构 + 移动块/位置概览的双层连线渲染 |
| **许可风险** | 低（两个核心移植源均为 MIT） |

**判定理由**：行内字词 diff 有 MIT 成熟代码可直接移植（低风险低耗时）；移动块检测算法中等但可复用现有 `getChunks`；**真正抬高难度与成本的是三处**——①现状三栏并非真实三文档 MergeView 需重构；②移动块主体侧边连线 + Location Pane 连线需自研 SVG 并随滚动同步坐标；③双端（Tauri/浏览器）IO 分流虽架构清晰但需逐一验证。

---

## 2. 现状关键发现（客观事实，影响成本）

| 发现 | 对成本的影响 |
|---|---|
| 现状三栏 = `MergeView(a+b)` + 独立**只读**右栏(Theirs)，非规格要求的「三份平级独立可编辑」 | **需重构为真实 a/b/c 三文档 MergeView**，是方案里最大的结构性改动，拉高 compare-merge 专项成本 |
| `getChunks` / `Chunk` 已在用，且 `makeRevertButton` / `acceptTheirsAt` 块操作逻辑已存在 | 移动块检测可复用 chunk 流；块接受/拒绝有基础可改造，**降低** chunk-ops 成本 |
| 默认折叠逻辑（`resolveCollapse` + 异步 diff 校正轮询）已存在 | 「默认展开」只需反转默认值，成本低 |
| 现有 4 个 compare 测试覆盖 accept/diff/io/line-markers | 回归测试基础好，但需为移动块检测新增纯函数单测 |
| 依赖 `diff` 包当前未直接声明（api-diff-viewer 依赖它） | 需在 `package.json` 显式新增 `@replit/codemirror-minimap` + `diff` |

---

## 3. 分模块难度 / 成本矩阵

| 模块 | 来源 | 难度 | 代码量 | 关键风险 / 说明 |
|---|---|---|---|---|
| `inline-word-diff.js` | 移植(MIT) | **低** | ~150 行 | 直接移植 api-diff-viewer，适配 MergeView 三面板 before/after 分发 |
| `move-detection.js` | 自研 | **中** | ~120 行 + 单测 | 算法正确性、大文件 `maxPairs` 降级；可复用 `getChunks` |
| `move-decorations.js` | 自研 | **中高** | ~150 行 | Decoration 坐标映射 + SVG 连线随滚动重绘（**技术难点之一**） |
| `location-pane.js` | 移植基底 + 自研 | **中高** | ~180 行 | `@replit/codemirror-minimap` 的 `gutters` 为单值映射，连线需自研 SVG 叠加 |
| `toolbar.js` | 自研 | **低** | ~120 行 | 复用 `editor.html` 按钮定义，保格式化按钮不隐藏 |
| `chunk-ops.js` | 自研（有基础） | **中** | ~100 行 | 三栏接受逻辑重构（现状 MergeView a/b + 独立右 → 真实三文档） |
| `save.js` + `io-bridge.js` | 自研 | **中** | ~120 行 | 双端 IO 分流（Tauri 命令 / 浏览器 API）+ 活动栏状态 |
| `compare.html` 重排 | 改 | **中** | ~150 行 | 四区布局（顶部/三栏/Location Pane/底部） |
| **三栏 MergeView 重构**（在 compare-merge.js） | 改（核心） | **中高** | ~200 行 | 现状非真实三文档，需改为 a/b/c 三可编辑文档并校准同步滚动 |
| `README.md` 修订 | 改 | **低** | ~30 行 | 删除「单栏 unified」「presentableDiff」等过时描述 |
| **合计** | — | 中等偏高 | **~1100–1300 新增 + ~500–700 重构 + ~200 测试** | — |

---

## 4. 依赖与许可风险（已核实）

| 依赖 | 许可 | 风险 |
|---|---|---|
| `udamir/api-diff-viewer`（行内 diff 代码） | MIT | 低，可移植并注明出处 |
| `@replit/codemirror-minimap` v0.5.2 | MIT | 低，peer deps 与本项目 `@codemirror/*` 6.x 兼容 |
| `diff`（diffWords/diffChars） | BSD-3-Clause | 低，需显式加入 `package.json` |

> 落地前动作：在移植文件头注明 api-diff-viewer 的 MIT 出处与作者，遵守署名要求。

---

## 5. 最大风险 TOP 3

1. **三栏架构重构**：现状「MergeView(a+b)+独立只读右」与规格「三份平级可编辑」冲突，重构涉及 `compare-merge.js` 核心装配与同步滚动校准，改动面最大。
2. **双层连线渲染**：移动块主体侧边连线 + Location Pane 连线均为自研 SVG，需随编辑器滚动/缩放实时重算坐标，是最易出视觉 bug 的环节。
3. **双端行为一致性**：Tauri EXE 与浏览器扩展虽复用同一前端，但文件 IO（读/写/另存/导出）路径不同，需逐一真机验证避免一端正常一端失效。

---

## 6. 成本优化建议（分期交付）

按「低风险先交付、高风险后置」降低单次改动面：

- **第一期（低难度，约 3–4 人日）**：行内字词 diff 移植 + 默认展开 + 浅红色修正 + README 修订 + 工具栏对齐。可见收益高、风险低。
- **第二期（中难度，约 3–4 人日）**：移动块检测纯函数 + 蓝色装饰（先不连线）+ 块接受/拒绝 + 活动栏保存（双端分流）。
- **第三期（中高难度，约 4–6 人日）**：三栏 MergeView 重构 + 移动块/位置概览双层连线 + Location Pane 接入 + Playwright 双端真机点检。

> 若排期紧张，可先交付第一期 + 第二期（无连线版移动块），第三期连线作为增强迭代。

---

## 7. 结论

本功能**综合难度中等偏高、成本中等**，主要成本集中在「三栏架构重构」与「双层连线渲染」两项，而非算法本身。由于两个核心移植源（`api-diff-viewer`、`@replit/codemirror-minimap`）均为 **MIT**，且现有 `getChunks` 与块操作逻辑可复用，**许可与基础风险低**。建议按第六期分期交付，先吃低风险红利，再攻坚高难连线。
