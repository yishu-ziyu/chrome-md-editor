# Chrome-Markdown-Edit (CME) 多场景 · 多边界全覆盖 E2E 测试方案

> 版本：v1.0　|　适用对象：CME 编辑器（Chrome MV3 扩展 + Tauri 2 桌面端）
> 编写定位：既可作为手工测试执行清单，也可作为后续 Playwright 自动化测试的蓝图。
> 所有用例的「实际结果」「缺陷编号」栏留空，由执行人填写。

---

## 1. 文档目的与范围

### 1.1 目的
对 CME 编辑器进行**功能正确性、边界健壮性、双端一致性、已知缺陷回归**四个维度的系统验证，确保：
- 编辑/预览/视图模式/主题/对比/搜索等核心链路在合法与非法输入下均行为可预期；
- 在 360Chrome 等国产 Chromium 与 Tauri 2 WebView2 下表现一致；
- 历史缺陷 BUG1/BUG2（视图模式恢复入口丢失）不二次回归。

### 1.2 范围
| 维度 | 覆盖 | 不覆盖 |
| --- | --- | --- |
| 功能 | 编辑器核心、视图模式、专注/打字机、主题四维度、对比模式、工区搜索、slash/拖拽/大纲/任务/Callout/Mermaid/图片/自动保存/新手指引 | 第三方库内部实现（CodeMirror 6 内核本身） |
| 端 | Chrome MV3 扩展、Tauri 2 桌面端 | Firefox / Safari / 移动端 |
| 类型 | 单元 + 集成 + E2E | 性能压测/安全渗透（另立专项） |

### 1.3 关键代码事实（编写依据）
- 视图模式外壳：`src/view-mode.js`，`VIEW_MODE_OPTIONS = ['daily','focus','immersive','full']`，循环顺序 `CYCLE` 同此；持久化键 `md-editor-chrome-mode`（默认 `daily`）。
- 编辑/预览分屏：`src/editor.js` `setViewMode()` 写 `#editorMain[data-mode] = split|edit|preview`（editor.js:1959）。
- 专注/打字机：`src/focus-mode.js`，键 `md-editor-focus-mode`、`md-editor-typewriter`、`md-editor-font-size`、`md-editor-preview-font-size`、`md-editor-density`。
- 侧栏：`src/editor.js` `toggleSidebar()` 仅 `classList.toggle('collapsed')`；`#sidebarToggle` 由 JS 注入到 `#editorMain`，点击调用 `toggleSidebar(false)`（editor.js:2823-2877）。侧栏折叠键 `md-sidebar-collapsed`。
- 视图隐藏机制：`.view-hidden { display:none !important }`（editor.css:865）。
- 主题四维度：`data-theme`（明/暗）、`data-editor-theme`（**27 套**配色预设，`src/theme-presets.js`）、`data-color-scheme`（语法高亮方案）、`data-skin`（玻璃材质，当前硬编码 `glass`，editor.js:1923）。
- BUG1 缓解：`#btnChromeMode.force-visible` 以 `position:fixed` 浮层常驻（editor.css:1203）。
- 桌面垫片：`src/desktop-shims.js` 在缺失 `chrome.storage` 时用 `localStorage`（前缀 `chrome-shim:`）补齐；缺失 File System Access 时垫片 `showOpenFilePicker/showSaveFilePicker/showDirectoryPicker`。

---

## 2. 测试环境

### 2.1 硬件/OS
| 项 | 规格 |
| --- | --- |
| OS | Windows 11 Pro（主）；macOS 14+ / Ubuntu 22.04（交叉） |
| CPU/内存 | ≥ 4 核 / ≥ 8 GB |
| 显示器 | 1920×1080（常规）、1366×768（小窗）、3840×2160（4K，验证 4K 缩放） |

### 2.2 浏览器 / 运行时
| 端 | 运行时 | 安装/启动方式 |
| --- | --- | --- |
| Chrome 扩展 | Chrome 120+ / **360Chrome 极速版**（验证 `chrome.storage` 垫片路径） | `chrome://extensions` → 开发者模式 → 加载已解压扩展 → 选 `dist/` |
| Tauri 桌面 | Tauri 2 + WebView2 | `npm run tauri:dev` 或双击 `.md` 关联启动 |

### 2.3 扩展加载路径与 ID
- 解压目录：`D:\Documents\AI_Work_Temp\Chrome-Markdown-Edit\dist`
- 扩展 ID：加载后在 `chrome://extensions` 详情页读取（形如 `aabbccddeeffgghhiijj...`），自动化脚本需动态获取。
- 测试页 URL：`chrome-extension://<EXT_ID>/editor.html`

### 2.4 测试数据
- 样例库：`tests/fixtures/`（空文档、超大文档 ≥ 5MB、超长单行 ≥ 10 万字符、含图片 base64、含表格/代码块/Mermaid/Callout/HTML 混排）。
- localStorage 损坏样本：注入非法 JSON 的 `md-editor-chrome-mode` 等键。

### 2.5 测试分层
| 层 | 工具 | 覆盖 | 现有资产 |
| --- | --- | --- | --- |
| 单元 | Vitest | 纯函数（主题解析、compare 算法、html↔md、bracket） | `tests/*.test.js`（30 个） |
| 集成 | Vitest + jsdom | DOM 行为（视图切换、自动保存、会话恢复、slash） | 同上部分用例 |
| E2E | Playwright + 360Chrome | 真实扩展/桌面端全链路 | 本方案驱动，新建 `tests/e2e/*.spec.js` |

---

## 3. 功能测试矩阵总表

优先级：**P0**=核心阻断，**P1**=重要，**P2**=一般。自动化列：**Y**=建议自动化，**N**=手工为主，**P**=部分可自动化。

| 功能 | 代表场景 | 优先级 | 自动化 |
| --- | --- | --- | --- |
| 编辑/预览分屏 | 三模式切换、实时预览 | P0 | Y |
| 样式工具栏 | 居中/加粗/高亮/颜色/字号写入标签 | P0 | Y |
| 块级语法 | 标题/列表/引用/代码块/链接/表格/HR/图片 | P0 | Y |
| 查找替换 | 命中高亮/替换/正则 | P1 | Y |
| 视图模式(外壳) | daily/focus/immersive/full 循环 + 恢复 | P0 | Y |
| 专注/打字机 | 淡化非当前行/光标居中 | P1 | Y |
| 显示设置 | 字号/密度/配色弹窗 | P1 | Y |
| 顶部工具栏 | 各按钮可见性与点击 | P1 | Y |
| 文件侧栏 | 打开文件夹/刷新/收起/恢复 | P0 | Y |
| 主题四维度 | 27×明暗×配色×皮肤排列 | P1 | P |
| 对比模式 | 两/三/单栏、块导航、接受、导出 | P1 | Y |
| 工区搜索 | 递归 .md、命中跳转 | P1 | Y |
| slash 菜单 | 触发/过滤/插入 | P2 | Y |
| 块拖拽 | 拖拽重排 | P2 | N |
| 大纲面板 | 生成/点击跳转 | P1 | Y |
| 任务列表面板 | 解析/勾选 | P1 | Y |
| Callout | 渲染/类型 | P2 | Y |
| Mermaid | 缩放/渲染 | P2 | Y |
| 图片 base64 折叠 | 折叠/展开 | P2 | Y |
| 自动保存/会话恢复 | 刷新后内容/光标/滚动恢复 | P0 | Y |
| 新手指引/反馈 | 首启引导/反馈提交 | P2 | N |
| 双端垫片 | chrome.storage / FSA 缺失降级 | P0 | Y |

---

## 4. 逐功能详细用例

> 用例字段：编号 / 场景 / 前置 / 步骤 / 预期 / 实际 / 缺陷。

### 4.1 编辑器核心与分屏

**TC-EDT-01 三视图模式切换**
- 场景：split / edit / preview 互切
- 前置：加载 `editor.html`，默认 split
- 步骤：①点 `data-mode=edit` 按钮；②点 `preview`；③点 `split`
- 预期：①仅编辑区可见，预览区隐藏；②反之；③两区并排，`#editorMain[data-mode]` 分别为 edit/preview/split
- 实际：____　缺陷：____

**TC-EDT-02 实时预览同步**
- 场景：编辑区输入即时反映到预览
- 步骤：编辑区输入 `# Hello`，观察预览区
- 预期：预览区渲染为 H1「Hello」，延迟 < 200ms
- 实际：____　缺陷：____

**TC-EDT-03 语法高亮（编辑区 + 预览区）**
- 步骤：输入 `**粗**`、`# 标题`、代码块
- 预期：编辑区与预览区均按 `data-color-scheme` 高亮对应 token
- 实际：____　缺陷：____

### 4.2 样式工具栏

**TC-STY-01 居中**
- 步骤：选中段落，点「居中」
- 预期：选区被 `<center>…</center>` 包裹，预览居中
- 实际：____　缺陷：____

**TC-STY-02 加粗/高亮/颜色/字号**
- 步骤：分别点对应按钮并设值
- 预期：分别写入 `<b>`/`<mark>`/`<font color>`/`<font size>`；预览正确渲染
- 实际：____　缺陷：____

**TC-STY-03 空选区点样式按钮**
- 步骤：光标无选区时点「加粗」
- 预期：不报错，行为可预期（插入空标签或忽略，需与产品定义一致）
- 实际：____　缺陷：____

### 4.3 块级语法

**TC-BLK-01 标题 H1–H3**：分别用 `#`/`##`/`###` 或工具栏生成，预览层级正确。
**TC-BLK-02 有序/无序列表**：Tab 缩进、回车续行、空行退出。
**TC-BLK-03 引用**：`>` 嵌套引用渲染。
**TC-BLK-04 代码块**：围栏代码块语法高亮、复制按钮可用。
**TC-BLK-05 链接**：`[text](url)` 渲染可点击，url 含中文/空格时转义正确。
**TC-BLK-06 表格**：管道表格对齐渲染、编辑区表格语法高亮。
**TC-BLK-07 HR**：`---` 渲染分隔线。
**TC-BLK-08 图片**：本地相对路径、base64、外链三种来源均渲染；外链失败有占位。
- 实际：____　缺陷：____

### 4.4 查找替换

**TC-FND-01 查找**：输入关键字，命中高亮、回车跳转下一处。
**TC-FND-02 替换**：单条替换 / 全部替换计数正确。
**TC-FND-03 正则**：开启正则，`\d+` 等命中；非法正则给出错误提示不崩溃。
- 实际：____　缺陷：____

### 4.5 视图模式（外壳）— 见第 5 章回归 + 第 6 章边界

**TC-VIEW-01 四模式循环**
- 步骤：连续点 `⊞ #btnChromeMode` 4 次
- 预期：daily→focus→immersive→full→daily；`localStorage['md-editor-chrome-mode']` 同步；各模式对应元素显隐符合 `PRESETS`
- 实际：____　缺陷：____

**TC-VIEW-02 持久化恢复**
- 步骤：切到 immersive → 刷新页面
- 预期：首屏仍为 immersive（applyViewMode 早于 initFileSidebar 也须保留恢复入口，见 BUG2）
- 实际：____　缺陷：____

### 4.6 专注 / 打字机

**TC-FOC-01 专注模式**：开启后 `documentElement.focus-mode`，非当前行淡化；关闭恢复。
**TC-FOC-02 打字机**：输入多行，光标行始终居中于视口；关闭后停止滚动。
**TC-FOC-03 与视图模式组合**：focus 视图 + 专注模式同时开启互不破坏。
- 实际：____　缺陷：____

### 4.7 显示设置弹窗

**TC-DSP-01 编辑/预览字号**：弹窗设 12/16/24px，CSS 变量 `--editor-font-size`/`--preview-font-size` 生效并持久化。
**TC-DSP-02 界面密度**：compact/standard/comfortable 切换 `--ui-gap` 变化。
**TC-DSP-03 配色方案**：切换 `data-color-scheme`，语法高亮配色随变（与 `data-theme` 正交）。
- 实际：____　缺陷：____

### 4.8 顶部工具栏与按钮

**TC-TLB-01 按钮完备**：`#toolbar` 内含分屏组、focus/typewriter/outline/tasks/snapshots/display、主题、⊞、工区搜索，均可见且可点击（非 immersive 时）。
**TC-TLB-02 工具栏响应式**：窗口收窄到 800/600/400px，按钮不溢出、可滚动或折叠（参照 `toolbar-responsive.test.js`）。
- 实际：____　缺陷：____

### 4.9 文件侧栏

**TC-SB-01 打开文件夹**：点「打开文件夹」→ 系统选择器 → 渲染 `.md` 树。
**TC-SB-02 刷新**：`btnRefreshTree` 重渲染；未打开文件夹时提示错误不崩溃。
**TC-SB-03 收起/恢复**：`btnCollapseSidebar` 加 `.collapsed` 并显 `#sidebarToggle`；点 `#sidebarToggle` 恢复。
**TC-SB-04 视图隐藏下恢复**：focus/immersive 下 `#fileSidebar` 有 `.view-hidden`，点 `#sidebarToggle` 须真正取消隐藏（见 BUG2 验收）。
- 实际：____　缺陷：____

### 4.10 主题四维度

**TC-THM-01 明/暗基底**：`data-theme=light|dark` 切换整体明暗。
**TC-THM-02 27 套配色**：遍历 `data-editor-theme` 27 个预设，编辑区配色正确、且与 `data-theme` 基底一致（防 BUG6 双轴错乱）。
**TC-THM-03 配色方案**：切换 `data-color-scheme` 不影响基底。
**TC-THM-04 皮肤**：当前仅 `glass`，`[data-skin=glass]` 玻璃材质生效。
- 实际：____　缺陷：____

### 4.11 对比模式（compare.html）

**TC-CMP-01 栏数切换**：两栏/三栏/单栏互切，布局正确。
**TC-CMP-02 块导航**：上/下块跳转，当前块高亮。
**TC-CMP-03 接受 Theirs**：点接受，目标文件对应块被替换。
**TC-CMP-04 导出**：导出合并结果，内容与预期一致（参照 `compare-*.test.js`）。
- 实际：____　缺陷：____

### 4.12 工区搜索

**TC-WS-01 递归搜索**：打开含多层 `.md` 的文件夹，搜关键字，返回全部命中及路径。
**TC-WS-02 跳转**：点结果跳转对应文件与行。
**TC-WS-03 FSA 缺失降级**：Tauri 垫片下仍可搜索（参照 `workspace-search.test.js`）。
- 实际：____　缺陷：____

### 4.13 slash / 拖拽 / 大纲 / 任务 / Callout / Mermaid / 图片

**TC-SL-01** slash 菜单：输入 `/` 触发，过滤关键字，回车插入对应块。
**TC-DR-01** 块拖拽：拖拽段落重排，顺序更新且可撤销。
**TC-OT-01** 大纲：根据标题生成大纲，点击跳转到对应行。
**TC-TK-01** 任务列表：`- [ ]`/`- [x]` 解析，勾选状态可切换并写回源码。
**TC-CL-01** Callout：多种类型渲染对应样式与图标。
**TC-MM-01** Mermaid：流程图渲染，缩放按钮放大/缩小不溢出。
**TC-IMG-01** 图片 base64 折叠：长 base64 折叠为占位，展开显示完整语法。
- 实际：____　缺陷：____

### 4.14 自动保存 / 会话恢复 / 滚动恢复

**TC-AUT-01 自动保存**：输入后停顿，localStorage/存储写入最新内容。
**TC-AUT-02 会话恢复**：刷新后内容、光标位置、滚动位置均恢复（参照 `autosave/session-restore/scroll-restore.test.js`）。
**TC-AUT-03 多文件**：切换文件后各自恢复，不串档。
- 实际：____　缺陷：____

### 4.15 新手指引 / 反馈

**TC-ONB-01** 首启展示新手指引，可跳过，二次进入不再强制。
**TC-FB-01** 反馈入口可提交，桌面端（chrome.storage 垫片）不报错。
- 实际：____　缺陷：____

### 4.16 双端垫片

**TC-SHIM-01 chrome.storage**：在 360Chrome（原生存在）与 Tauri（垫片）下，会话/翻译设置读写一致。
**TC-SHIM-02 FSA 垫片**：Tauri 下 `showOpenFilePicker` 可用，打开 `.md` 流程与扩展端一致。
- 实际：____　缺陷：____

---

## 5. 多边界条件覆盖

### 5.1 文档规模边界
| 编号 | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| BC-01 | 空文档 | 打开空白文件 | 不报错，预览区空白，工具栏可用 |
| BC-02 | 超大文档（≥5MB / 10万行） | 载入大文件 | 编辑/预览可滚动，输入无明显卡顿（>2s 需记录性能缺陷） |
| BC-03 | 超长单行（≥10万字符无换行） | 粘贴长行 | 渲染不崩，横向滚动可用，查找命中正确 |
| BC-04 | 仅含空白/仅换行 | 输入纯空白 | 预览不报错，自动保存正常 |

### 5.2 非法 / 异常输入
| 编号 | 场景 | 预期 |
| --- | --- | --- |
| BC-05 | 非法 Markdown（`[未闭合`、`*未闭合`） | 优雅降级，不抛未捕获异常 |
| BC-06 | 嵌套过深（`>>>>` 多级引用 / 表格错位） | 渲染容错 |
| BC-07 | 脚本注入（`<script>`/`<img onerror>`） | 预览做 HTML 转义/沙箱，不执行脚本 |
| BC-08 | 超大 base64 图片（≥20MB） | 折叠占位，不卡死主线程 |
| BC-09 | 查找正则非法 | 提示错误，不崩溃 |

### 5.3 存储 / 环境异常
| 编号 | 场景 | 预期 |
| --- | --- | --- |
| BC-10 | `localStorage` 缺失（隐私模式/被禁用） | 降级为内存态，核心编辑可用，不白屏 |
| BC-11 | `localStorage['md-editor-chrome-mode']` 为非法值（`"xxx"`/损坏 JSON） | `normalizeMode` 回退 `daily`，不崩溃 |
| BC-12 | `md-editor-font-size` 为非数字/负数 | `getEditorFontSize` 解析为 0，不写变量 |
| BC-13 | `chrome.storage` 缺失（360Chrome 异常/旧版） | 桌面垫片补齐，会话恢复静默可用 |
| BC-14 | 双端差异：扩展端有 FSA、桌面端走垫片 | 打开/保存/搜索行为一致 |

### 5.4 主题排列爆炸
| 编号 | 场景 | 预期 |
| --- | --- | --- |
| BC-15 | 27 套 `data-editor-theme` × 明/暗 × `data-color-scheme`(全部) × `glass` | 全排列下：①编辑区不出现「暗底亮字不可读」；②`data-theme` 基底与配色 `kind` 一致（防 BUG6）；③预览区配色协调 |
| BC-16 | 切换主题中途刷新 | 刷新后主题四维度完整恢复，无闪烁错配 |

### 5.5 窗口 / 视口极端
| 编号 | 场景 | 预期 |
| --- | --- | --- |
| BC-17 | 窗口极小（宽 320px） | 工具栏可滚动/折叠，编辑/预览不重叠溢出 |
| BC-18 | 窗口极大（4K 全屏） | 分屏比例合理，Mermaid/图片不溢出 |
| BC-19 | 分屏下拖动 resizer 到两端极值 | 另一栏不消失为负宽，可回拖 |

### 5.6 交互时序边界
| 编号 | 场景 | 预期 |
| --- | --- | --- |
| BC-20 | 连续快速点击 ⊞ 按钮（10 次/秒） | 模式按 CYCLE 顺序稳定推进，无错乱/丢状态 |
| BC-21 | 连续快速点击分屏三按钮 | `data-mode` 终态正确，无过渡态残留 |
| BC-22 | 刷新后状态恢复竞态 | applyViewMode 早于 initFileSidebar 时，持久化 focus/immersive 首屏仍保留恢复入口（BUG2 验收） |
| BC-23 | 自动保存与手动刷新并发 | 刷新拿到的内容为最近一次保存态，不丢不重 |
| BC-24 | 打开文件夹过程中关闭弹窗/取消 | 不残留半初始化侧栏，不报错 |

---

## 6. 回归测试（验收闸门）

> 本章为**发布验收闸门**：BUG1/BUG2 的对应用例必须 100% 通过方可发布。
> 复现步骤稳定可重复；「预期恢复行为」为正确构建**必须**满足的契约。

### 6.1 BUG1 — 沉浸/专注下工具栏被隐藏后无恢复入口

**根因（代码事实）**：`immersive` 预设将 `#toolbar` 加 `.view-hidden`（`display:none!important`，editor.css:865）。`#btnChromeMode`（⊞ 恢复按钮）是 `#toolbar` 子节点，随祖先一起隐藏 → 无任何入口切回 daily/full。
**缓解（当前代码）**：`applyViewMode` 在 `toolbar===false` 时给 `#btnChromeMode` 加 `.force-visible`（editor.css:1203，position:fixed 浮层），使其脱离隐藏容器常驻。

**回归用例 RG-BUG1**
- 编号：RG-BUG1
- 场景：进入 immersive 后恢复工具栏
- 前置：干净 localStorage（无持久化模式）
- 步骤：
  1. 打开 `editor.html`；
  2. 连续点 `⊞ #btnChromeMode` 直至进入 `immersive`（daily→focus→immersive，约 2 次）；
  3. 断言 `#toolbar` 含 `.view-hidden`（`display:none`）；
  4. 断言 `#btnChromeMode` 含 `.force-visible` 且**像素可见、可点击**（不随 toolbar 隐藏）；
  5. 点击 `#btnChromeMode` 一次，应回到 `full`；再点回到 `daily`；
  6. 校验 `localStorage['md-editor-chrome-mode']` 同步。
- **预期恢复行为（验收闸门）**：
  - immersive 下 `#btnChromeMode` 始终可见可点击；
  - 点击可循环切回 full→daily，工具栏恢复显示；
  - 提供「从沉浸态逃生」的确定路径。
- 实际：____　缺陷：____

**附加 RG-BUG1b（daily→focus→immersive 路径）**
- 步骤：分三步依次点击进入 immersive（非一步直达），重复 RG-BUG1 步骤 4–6。
- 预期：同上，路径不影响恢复入口存在性。
- 实际：____　缺陷：____

### 6.2 BUG2 — focus/immersive 下侧栏隐藏后无恢复入口

**根因（代码事实）**：`focus`/`immersive` 预设给 `#fileSidebar` 加 `.view-hidden`。`#sidebarToggle` 恢复按钮由 `initFileSidebar` 注入到 `#editorMain`，其点击仅调用 `toggleSidebar(false)` → 只 `classList.toggle('collapsed')`（editor.js:2823-2877），**永不移除 `.view-hidden`** → 点击「恢复」无效。且初始化顺序 `applyViewMode` 早于 `initFileSidebar`：若持久化为 focus/immersive，首屏即无恢复入口。

**缓解（当前代码）**：`applyViewMode` 在 `#fileSidebar` 含 `.view-hidden` 时给 `#sidebarToggle` 加 `.visible`（editor.js view-mode.js:121-127），使恢复按钮「可见」。

> ⚠ 当前代码备注：可见性缓解已加，但 `toggleSidebar(false)` 仍只去 `.collapsed` 不去 `.view-hidden`。若点击 `#sidebarToggle` 后侧栏仍未显示，则说明 BUG2 的恢复**功能**尚未完全闭环，本回归用例应判失败并登记缺陷。

**回归用例 RG-BUG2**
- 编号：RG-BUG2
- 场景：focus/immersive 下恢复文件侧栏
- 前置：干净 localStorage
- 步骤：
  1. 打开 `editor.html`；
  2. 点 `⊞` 进入 `focus`；
  3. 断言 `#fileSidebar` 含 `.view-hidden`；
  4. 断言 `#sidebarToggle` 含 `.visible` 且可见；
  5. **点击 `#sidebarToggle`**；
  6. 断言 `#fileSidebar` 的 `.view-hidden` 已被移除且侧栏重新可见（宽度 > 0、可交互）；
  7. 切到 immersive 重复 2–6。
- **预期恢复行为（验收闸门）**：
  - focus/immersive 下 `#sidebarToggle` 可见；
  - 点击后侧栏**真正恢复**（`.view-hidden` 移除，非仅 `.collapsed` 切换）；
  - 提供「从隐藏态逃生」的确定路径。
- 实际：____　缺陷：____

**附加 RG-BUG2b（持久化首屏）**
- 步骤：
  1. 进 immersive；
  2. 不点恢复，直接刷新页面；
  3. 首屏断言：页面处于 immersive（侧栏隐藏），且 `#sidebarToggle` 在首屏即带 `.visible`（因 `applyViewMode` 早于 `initFileSidebar`，恢复入口不得缺失）；
  4. 点击 `#sidebarToggle`，侧栏恢复。
- 预期：首屏即有恢复入口且可恢复（验证初始化顺序不再造成「首屏无入口」）。
- 实际：____　缺陷：____

---

## 7. 自动化测试执行方式建议（Playwright 驱动 360Chrome）

### 7.1 启动 360Chrome（或 Chrome）并加载扩展
```bash
# 以 360Chrome 极速版为例（路径按实际安装调整）
"/path/to/360chrome.exe" \
  --headless=new \
  --disable-extensions-except="D:/Documents/AI_Work_Temp/Chrome-Markdown-Edit/dist" \
  --load-extension="D:/Documents/AI_Work_Temp/Chrome-Markdown-Edit/dist" \
  --user-data-dir="D:/Documents/AI_Work_Temp/Chrome-Markdown-Edit/.pw-profile"
```
> 注：360Chrome 内核与 Chrome 同源，支持 `--load-extension`；若其阉割了 `chrome.storage`，验证桌面垫片逻辑（TC-SHIM-01）。

### 7.2 获取扩展 ID（动态）
```js
// 在 context 中打开 chrome://extensions 不便，推荐用 chrome.runtime 或固定路径探测：
const extId = await page.evaluate(() => chrome.runtime.id);
// 或直接读 manifest 的 key 推导；自动化建议把 EXT_ID 作为 env 注入。
```

### 7.3 Playwright 配置要点
```js
// tests/e2e/playwright.config.js
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    launchOptions: {
      executablePath: process.env.CHROME_BIN, // 360Chrome 路径
      args: [
        '--load-extension=' + process.env.EXT_PATH,
        '--disable-extensions-except=' + process.env.EXT_PATH,
      ],
    },
  },
});
```

### 7.4 chrome.storage 垫片在测试中的处理
- 扩展端：原生 `chrome.storage.local` 存在 → 直接读写验证持久化（TC-VIEW-01/02、TC-AUT-02）。
- 桌面端（Tauri）：垫片以 `localStorage['chrome-shim:*']` 存储 → 测试断言时同时校验 `localStorage` 前缀键，确保双端语义一致（TC-SHIM-01/02）。

### 7.5 关键断言点（selector / 状态）
| 断言对象 | 选择器 / 表达式 | 说明 |
| --- | --- | --- |
| 分屏模式 | `#editorMain[data-mode="split"]` | TC-EDT-01 |
| 视图模式 | `localStorage['md-editor-chrome-mode']` | TC-VIEW-01 |
| 工具栏隐藏 | `#toolbar.view-hidden` + `#btnChromeMode.force-visible` 可见 | RG-BUG1 |
| 侧栏恢复 | `#fileSidebar:not(.view-hidden)` 且宽度>0 | RG-BUG2 |
| 主题维度 | `document.documentElement[data-editor-theme]` / `[data-theme]` / `[data-color-scheme]` | TC-THM |
| 专注 | `document.documentElement.focus-mode` | TC-FOC-01 |
| 自动保存 | `localStorage` 中内容键变化 | TC-AUT-01 |
| 可见性探测 | `await el.isVisible()`（含 fixed 浮层判定） | 恢复入口 |

### 7.6 与现有单元/集成测试衔接
- 现有 `tests/*.test.js`（Vitest）覆盖纯逻辑与 jsdom 行为，E2E 不重复，只补「真实扩展/桌面端」链路。
- 建议映射：视图模式→`view-mode.test.js` 升格为 E2E；对比→`compare-*.test.js`；主题→`theme-presets.test.js`；搜索→`workspace-search.test.js`。

---

## 8. 通过 / 失败判定标准与缺陷记录模板

### 8.1 判定标准
- **P0 用例**：100% 通过方可发布；任一失败 = 发布阻断。
- **P1 用例**：通过率 ≥ 95%；失败项须有已登记缺陷与 workaround 说明。
- **P2 用例**：通过率 ≥ 85%；记录待办。
- **回归章节（RG-BUG1/BUG2）**：必须 100% 通过，否则视为缺陷二次回归，严禁发布。
- **边界章节（第 5 章）**：BC-07（XSS 不执行）、BC-10/11/13（降级不白屏）为硬性安全/健壮门槛，必须全部通过。
- 性能：BC-02 输入延迟 > 2s、BC-08 主线程卡死 > 3s 记为性能缺陷。

### 8.2 缺陷记录模板
```
缺陷编号：BUG-YYYYMMDD-NNN
标题：
所属模块：
严重程度：P0/P1/P2
触发用例：TC-xxx / RG-BUGx / BC-xx
环境：OS / 浏览器 / 端（扩展/桌面）
前置条件：
复现步骤：
预期结果：
实际结果：
是否回归：是（关联 RG-BUGx）/ 否
截图/日志：
状态：Open / Fixed / Verified / Won'tFix
```

### 8.3 执行记录表（每轮填充）
| 用例数 | 通过 | 失败 | 阻塞 | 本轮结论 | 执行人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| ____ | ____ | ____ | ____ | ____ | ____ | ____ |

---

*（本文档为活文档，随功能迭代与缺陷修复持续更新；新增功能须同步补充第 3/4 章与自动化断言。）*
