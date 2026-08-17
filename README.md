# Chrome Markdown Editor

本地 Markdown 编辑器 Chrome 扩展。
不上传文件、不依赖后端；在浏览器里直接打开、编辑、预览本地 `.md`。

**当前版本：[v1.9.5](https://github.com/zhangweildlh/chrome-md-editor/releases/tag/v1.9.5)**  
**下载（Chrome 扩展）：** [chrome-md-editor-v1.9.5.zip](https://github.com/zhangweildlh/chrome-md-editor/releases/download/v1.9.5/chrome-md-editor-v1.9.5.zip)  
**下载（Windows 独立 EXE）：** [Markdown.Editor_1.9.5_portable.exe](https://github.com/zhangweildlh/chrome-md-editor/releases/download/v1.9.5/Markdown.Editor_1.9.5_portable.exe)  
**许可：** [MIT](./LICENSE)

[English](#english)

---

## 预览

分屏编辑 + 实时预览（深色）：


阅读翻译：预览区中英对照（不改源码）：


翻译设置（选预设 + 粘贴 API Key）：


浅色主题：


动图（主界面 → 设置 → 双语）：


---

## 功能

| 能力 | 说明 |
| --- | --- |
| 拖拽打开 | 将本地 `.md` 拖入 Chrome，扩展接管并打开编辑器 |
| 多实例 | 每次点扩展图标新开独立标签；多文件互不抢占 |
| 项目侧边栏 | 打开文件夹后浏览并切换同目录 Markdown |
| 分屏预览 | 左编辑 / 右预览；支持仅编辑、仅预览 |
| 预览区编辑 | 可在渲染结果上直接改字，再同步回源码（回车新增/删除空段、多段 `>` 引用、滚动位置均正确保持，不会插入多余空行或跳回文件头） |
| 本地图片 | 相对路径图片可预览；支持粘贴截图（有权限时写入 `images/`） |
| 查找 / 替换 | 自绘中文查找替换面板；显示命中位置 `X/Y`、支持全选匹配、替换下一个/全部（替代 CodeMirror 默认英文面板） |
| 粘贴为 Markdown | 从网页/富文本复制内容粘贴时自动转换为 Markdown（保留原有图片粘贴；纯文本与无结构内容原样放行） |
| 自动保存 / 快照 | 编辑停顿自动保存草稿（仅存 `chrome.storage.local`，不碰磁盘 `.md`）；每 2 分钟或累计 50 次改动生成一份历史快照，快照环最多保留 30 份、可一键回滚任一版本；重启发现更新草稿时弹窗提示恢复 |
| 磁盘自动保存 | 工具栏「自动保存」开关 + 间隔秒数（默认 30，5–3600）；开启后每 N 秒在**源文件同目录**生成「主文件名_秒级时间戳.md」副本（例：`这是测试文件.md` → `这是测试文件_20260804133025.md`），绝不覆盖源文件。Web 首次需授权目录句柄；Tauri EXE 直接写同目录 |
| 高亮（编辑区 + 预览区联动） | 选中编辑区或预览区文字，点「高亮」按钮即把源码外包 `<mark>…</mark>` 并同步重渲染预览；再点一次取消。编辑区与预览区行为统一，不再出现「编辑区改了预览不渲染」或反之 |
| Mermaid | ` ```mermaid ` 代码块渲染为图 |
| 主题 | 23 套主题（默认豆沙绿护眼）/ 深色 / 浅色 |
| 语法高亮 | 编辑区与预览区 Markdown 语法彩色字体 + 标题/引用/代码块行底色；经典 / 护眼（米黄）/ 高对比三套配色方案，与深/浅主题正交独立、可切换并持久化 |
| 斜杠菜单 | 行尾输入 `/` 或中文顿号 `、` 唤起命令面板，快速插入标题 / 列表 / 代码块等（↑↓ 选择、Enter 执行、Esc 关闭） |
| 块拖拽 | 每个块首行左侧出现拖拽手柄，按住拖动调整块顺序；手柄旁「+」可在当前块下方插入新块 |
| 视图模式 | 日常 / 专注 / 沉浸 / 全显 四种布局，点工具栏「⊞」循环切换；专注隐藏侧栏 / 大纲 / 状态栏，沉浸进一步隐藏工具栏 |
| 工具栏溢出滚动 | 按钮总宽超出可视宽度时，工具栏左 / 右侧自动出现 `‹` / `›` 滚动按钮，窄窗口 / 全屏下所有按钮仍可达 |
| 工作区搜索 | 点工具栏「🔍」打开搜索面板，检索当前已打开文件夹内所有 Markdown 文件的命中片段 |
| 行内 == 高亮 == | 用 `==文字==` 语法在预览中高亮；GitHub 风格提示框 `> [!NOTE]` / `> [!WARNING]` 等继续支持 |
| 会话恢复 | 再次打开扩展时尽量恢复上次内容与文件名 |
| 阅读翻译 | 预览区中英对照；**不修改** Markdown 源文件 |
| 文件对照 / 合并 | 两个本地 Markdown 并排对照、逐块合并。差异高亮到「词」的粒度（删除的词带删除线）；整段搬家识别为「移动」并标蓝，不再显示成一删一加；默认展开全文，`Ctrl+S` 把当前活动栏存回其源文件 |

> 工具栏所有按钮均带鼠标悬停提示（tooltip）：悬停即显示功能说明与对应快捷键。

技术栈：CodeMirror 6 · markdown-it · Vite · Manifest V3。  
桌面端额外使用 Rust + Tauri v2 打包为独立 Windows EXE。

## 编辑器增强功能（源自 markra 移植）

本版从开源项目 markra 移植并本地化了一批编辑增强，下面逐条说明「在哪点、怎么用」。

### 1. 编辑器主题（23 套）
新增「豆沙绿(亮) / 豆沙绿(暗)」护眼主题，**默认豆沙绿(亮)**。  
点工具栏「主题」下拉，即可在 23 套主题之间切换（与既有的深 / 浅主题、语法高亮配色方案正交独立）。

### 2. 斜杠菜单
在编辑区**行尾**输入 `/` 或中文顿号 `、` 唤起命令面板，可选「标题 / 粗体 / 列表 / 代码块 / 引用 / 表格 / 分割线 / 图片 / 链接」等。  
`↑` / `↓` 选择、`Enter` 执行、`Esc` 关闭。

### 3. 块拖拽
每个块首行左侧出现**拖拽手柄**，按住拖动即可调整块顺序；手柄旁的「+」可在当前块下方插入新块。

### 4. 视图模式（日常 / 专注 / 沉浸 / 全显）
点工具栏「⊞」按钮循环切换。  
- **日常模式**：常规分屏编辑 + 预览。
- **专注模式**：隐藏侧栏 / 大纲 / 任务 / 状态栏，聚焦写作。
- **沉浸模式**：进一步隐藏工具栏，适合纯写作。
- **全显模式**：最大化利用屏幕，显示所有面板。

### 5. 工作区搜索
点工具栏「🔍」打开搜索面板，输入关键词后检索**当前已打开文件夹内所有 Markdown 文件**的命中片段，点击即可跳转定位。

### 6. 行内 == 高亮 == 与提示框
在 `==两个等号之间==` 写文字，即可在预览中高亮。  
GitHub 风格提示框 `> [!NOTE]` / `> [!WARNING]` / `> [!TIP]` / `> [!CAUTION]` 等继续支持。

> 工具栏「?」可随时重新打开内置示例说明（onboarding），内含上述功能速览与可直接改写的示例文档。


---

## 桌面端独立 EXE（Tauri）

除了 Chrome 扩展，本项目还提供一个**独立 Windows 程序**：用 [Tauri](https://tauri.app/) v2 把同一套 Web 编辑器（CodeMirror 6 + markdown-it + Mermaid）打包成绿色免安装的 EXE，**无需浏览器、无需安装、本地零依赖**（仅依赖系统 WebView2 运行时）。

- **下载**：Release `v1.9.1` 中的 `Markdown.Editor_1.9.1_portable.exe`（便携版，直接拷到任意目录双击运行）。
- **双击打开**：把 `.md` 设为默认打开程序后，双击任意 `.md` 文件即由 EXE 直接打开并编辑。
- **拖入打开**：启动 EXE 后，把 `.md` 文件拖进窗口也能打开。
- **多实例**：每次双击 / 拖入都启动一个独立 EXE 实例，各自打开对应文件，互不干扰。
- **保存写回原文件**：底层用 Rust `std::fs` 命令读写（无路径作用域限制），`Ctrl/Cmd+S` 可直接覆盖原文件。
- **未签名提示**：未签名版本首次运行可能被 Windows SmartScreen 拦截，点「仍要运行」即可；本机需已安装 WebView2 运行时（Win10/11 通常已自带，否则按提示安装）。
- **本地零安装构建**：EXE 完全在 GitHub 云端（`windows-latest`）用 Rust + Tauri 构建；一次打 `v1.9.1` 标签即**同时产出扩展 zip 与 EXE 两个资产**，开发者本地无需安装 Rust / Tauri / WebView2。

> 桌面端与 Chrome 扩展共用 `src/editor.html/.js/.css`；仅在检测到 Tauri 环境时由 `src/desktop-shims.js` 注入 `chrome` 与 File System Access API 垫片，对扩展零影响。
---

## 文件对照 / 多栏合并（compare 模块）

把两个本地 Markdown / 纯文本文件并排对照、逐块合并，无需 Git 目录、纯前端 diff/merge。行与块的对齐由 `@codemirror/merge` 的 `MergeView` 负责；在此之上本项目又补了两层更细的识别能力：**行内字词级差异**与**移动块检测**（见下文）。

### 如何打开

- **Chrome 扩展**：在任意页面或扩展图标上点右键，选择「打开对比合并」（由 `public/background.js` 的 `chrome.contextMenus` 注册），会新开一个 `src/compare.html` 独立实例（沿用 `newInstanceId()`，不复用编辑器状态）。
- **桌面端（Tauri EXE）**：同源入口——EXE 内同样通过右键菜单打开 compare 页，复用同一套 `src/compare.html`。

### 两种视图

- **两栏对照**：左 `Yours` / 右 `Theirs`，差异块红绿高亮 + 行号差异标记（`−` / `+` gutter）。两栏默认可编辑；亦可将 `Yours` 侧设为只读。
- **三栏合并**：左 `Yours`（只读）/ 中 `Result`（可编辑合并结果）/ 右 `Theirs`（只读参考）。每块提供中文「⇄ 接受此块」按钮，把 `Yours` 当前块并入 `Result`；另有「接受 Theirs 块」把 `Theirs` 对应块拷入 `Result`，逐步合并出最终结果。

> 工具栏可随时切换「两栏 / 三栏」，两种视图统一从已选的两个文件渲染。

### 差异看得更细：行内字词级高亮

一般的 diff 只告诉你「这一整行变了」，整行涂成红或绿——可如果这行其实只改了两个字，你还得自己一个字一个字找。

本项目在整行标记之上又加了一层**词级比对**：

- 同一行里**只有真正改动的那几个词**才上色：新增的词绿底，删除的词红底并带**删除线**，没动过的字保持原色。
- 中英文都按词切分；必要时可切到粒度更细的「按字符」比对模式。
- 词级底色比整行底色更实一些，两层叠在一起时能同时看清「这行动过」和「具体动了哪里」。

底层用 [`diff`](https://github.com/kpdecker/jsdiff) 库（BSD-3-Clause）做词序列比对，装饰层实现思路参考了 [udamir/api-diff-viewer](https://github.com/udamir/api-diff-viewer)（MIT）。模块：`src/compare/inline-word-diff.js`。

### 内容搬家不算「删了又加」：移动块检测

把一整段内容从文档前面挪到后面，普通 diff 会显示成「这边删掉一大段、那边新增一大段」——两片红绿看着吓人，其实一个字都没改。

本项目会识别这种情况：

- 当一段连续内容在两边**内容一致、只是位置变了**，就判定为「移动」，两侧都用**蓝色背景**标出，而不是一红一绿。
- 于是有了三种独立语义：蓝 = 只挪了位置，绿 = 真的新增，红 = 真的删除。
- 判定思路参考 Git 的 `--color-moved=blocks`：只有达到一定长度的连续块才算移动，避免把零散空行、短行误判成搬家。

> 本期只做**颜色标识**，不画跨栏连线。源块与目标块之间的连线属于后续版本。

模块：`src/compare/move-detection.js`（检测）、`src/compare/move-decorations.js`（着色）。

### 文件选择与拖拽

- 点「选择文件」按钮或拖拽区，多选本地 `.md` / `.markdown` / `.mdown` / `.mkd` / `.mkdn` / `.txt`（不限于 Git 仓库目录）。
- 选中的**第 1 个**文件作为 `Yours`、**第 2 个**作为 `Theirs`（更多文件当前版本未纳入对照）。
- 也可将文件直接拖入页面拖拽区读取。

### 块导航与逐块接受

- **块导航**：「上一块 / 下一块」按钮跳转差异块（底层 `goToNextChunk` / `goToPreviousChunk`）。
- **块导航快捷键**：在对比页按 `B` / `]` 跳到下一块，`Shift+B` / `[` 跳到上一块；在可编辑区域（CodeMirror / input / textarea）内为不吞掉正常输入，改用 `Alt+B` / `Alt+Shift+B` 在编辑区内也生效。快捷键与按钮复用同一组函数，行为完全一致。
- **逐块接受**（三栏）：每块「⇄ 接受此块」把 `Yours` 当前块并入 `Result`；工具栏「接受 Theirs 块」把 `Theirs` 对应块拷入 `Result`。

### 活动栏与保存（Ctrl+S）

「**活动栏**」＝你最后点进去的那一栏。当前活动栏会有一圈主题色描边，方便确认操作对象。

- 按 `Ctrl+S`（或点工具栏「保存」），把**当前活动栏**的内容写回它自己的源文件——改哪栏存哪栏，不会串到另一个文件上。
- 三栏模式的中间「合并结果」栏是新拼出来的内容，本身没有源文件，因此保存时会弹出「另存为」让你选存到哪儿。
- 两种运行形态走各自的原生通道：**桌面版（Tauri EXE）**调 Rust 侧文件命令直接写盘；**浏览器扩展**走 File System Access API 的文件句柄写回。这层差异由 `src/compare/io-bridge.js` 统一封装，上层逻辑无需区分。

### 图片插入

- 点「图片」按钮或拖拽图片到图片区：图片转为内嵌 `data URL`，插入到当前活动栏的光标处，生成 Markdown 语法 `![name](data:image/...)`；复用 `src/image-support.js` 的纯函数。

### 导出

- **导出合并结果**：把 `Result` 内容另存为一个新文件。优先 `showSaveFilePicker` **句柄留存**写回，失败降级为浏览器下载（`<a download>`），再失败降级到剪贴板。
- **导出 diff 报告**：生成 git 风格可读 diff 文本（`@@` 行 + `+/-` 标记，底层 `presentableDiff` 渲染层），同样走「句柄留存 / 下载 / 剪贴板」三级降级。

### 折叠未改 / 主题

- **默认展开全文**：进入对比页时未改动的区域是**展开**的，直接就能通篇往下读。嫌太长时点工具栏「折叠未改」把未改区域收起来（底层为 `@codemirror/merge` 的 `collapseUnchanged`），再点一次恢复展开。
- 明暗主题：布局与控件配色复用编辑器既有 `--bg` / `--fg` / `--accent` / `--border` 等 CSS 变量。差异配色（新增绿 / 删除红 / 移动蓝）在 `src/compare.css` 里集中定义为一组 `--diff-*` 语义变量，亮色 / 暗色各给一套值，随 `data-theme` 自动切换——改配色只需改这一处。其中删除 / 变更的红已从 `@codemirror/merge` 的默认深红**调浅**，避免整屏刺眼。
- **对比页主题与主 UI 完全一致**：对比页通过复用主编辑器的权威主题应用函数（`applyEditorThemePreset` / `getColorScheme`），使其 `data-theme`（由主题预设的明暗 kind 决定，含 23 套主题中的暗色预设）、`data-editor-theme`（配色预设）、`data-color-scheme`（语法配色方案）与 `data-skin`（玻璃皮肤）实时跟随主编辑器——默认配置与任意暗色预设下均对齐；主编辑器切换主题/预设时经同源 `localStorage` 变更事件实时同步对比页。

### 桌面端（Tauri 同源）

compare 页在 EXE 内复用同一套 `src/compare.html`。文件读取与结果保存复用桌面端既有的 Tauri 文件访问能力（`showOpenFilePicker` / `showSaveFilePicker` 垫片 → `read_text_file` / `write_text_file`）。Rust 侧另已实现并注册 `read_multiple_text_files` / `save_compare_result` 命令（`desktop/src/lib.rs`），作为对比批处理读写的专用通道；对应桥接模块 `src/compare-shims.js` 提供浏览器 / 桌面统一的文件读写签名。

> 模块文件：`src/compare.js`（页面控制器）、`src/compare-merge.js`、`src/compare-nav.js`、`src/compare-line-markers.js`、`src/compare-files.js`、`src/compare-images.js`、`src/compare-export.js`、`src/compare-diff-export.js`、`src/compare-shims.js`；`src/compare/` 下为差异算法与读写子模块：`inline-word-diff.js`（字词级差异）、`move-detection.js` + `move-decorations.js`（移动块检测与着色）、`chunk-ops.js`（块操作）、`save.js`（活动栏保存）、`io-bridge.js`（浏览器 / 桌面读写分流）。页面与样式为 `src/compare.html` / `src/compare.css`，另有 `vite.config.js` 多入口 `compare`、manifest `web_accessible_resources` + `contextMenus` 权限。

---

## 安装（用户）

1. 打开 [Releases](https://github.com/yishu-ziyu/chrome-md-editor/releases)，下载最新 `chrome-md-editor-v*.zip`。
2. 解压，得到内层 **`dist/`** 目录（不要加载 zip 根目录，也不要加载本仓库源码根目录）。
3. Chrome 打开 `chrome://extensions/`，打开右上角 **开发者模式**。
4. **加载已解压的扩展程序**，选择上一步的 `dist/`。
5. 进入扩展 **详细信息**，开启 **允许访问文件网址**（拖拽本地 `.md` 必需）。
6. 点工具栏扩展图标启动，或把 `.md` 拖进浏览器。

### 从旧版升级

1. 在 `chrome://extensions/` 对该扩展点 **重新加载**。
2. 关掉所有旧的编辑器标签，再新开一页。
3. 确认左上角版本徽标与 Release 一致（当前应为 **v1.9.5**）。
4. 桌面 EXE 用户：重新下载 `Markdown.Editor_1.9.5_portable.exe` 覆盖旧文件即可，无需卸载。

---

## 使用

### 基本编辑

1. 拖入 `.md`，或点扩展图标后「打开文件 / 打开文件夹」。
2. 左侧写 Markdown，右侧实时预览。
3. 需要时可在预览区直接点选改字；失焦后写回源码。
4. `Ctrl/Cmd+S` 保存（首次可能弹出系统保存对话框）。

### 阅读翻译

用于读英文长文，不是用来改写源文件。

1. **左键**点「译」开关双语对照：预览区在英文段落下显示中文；再点一次关闭，恢复原文排版。
2. **右键**点「译」打开翻译设置：选择服务预设、粘贴 API Key（默认预设为 MiniMax Token Plan · Anthropic，Key 形如 `sk-cp-...`）、可改 Base URL 与模型名。

预设覆盖常见官方接口、国内模型、Token Plan（MiniMax / 阶跃）、聚合与 DeepL。
高级设置可改 Base URL 与模型名。

开启翻译后，文档正文会发往你配置的 API 服务商。
未开启翻译时，编辑与预览均在本地完成。

---

## 开发

需要 Node.js 18+（建议 20+）。

```bash
npm install
npm test          # 单元测试
npm run build     # 输出到 dist/
npm run pack      # build + 打 zip：chrome-md-editor-v<version>.zip
```

加载方式与用户安装相同：在 `chrome://extensions/` 加载本仓库的 **`dist/`**。

```bash
npm run dev       # 仅 UI 调试用；无 chrome.* / 文件 API，不能代替扩展验收
```

改代码后：`npm run build` → 扩展卡片 **重新加载** → 关掉旧标签再测。

相关文档：

- 变更记录：[CHANGELOG.md](./CHANGELOG.md)

---

## 目录说明

```
public/          # manifest、background、content-script、icons（构建时拷贝进 dist）
src/             # 编辑器页面与逻辑（扩展与桌面端共用）
desktop/         # Tauri v2 桌面壳（Rust + 配置），打包为独立 Windows EXE
tests/           # node:test 单元测试
scripts/         # 打包、图标、验收脚本
dist/            # 构建产物（gitignore；Chrome 只加载这里）
```

---

## 隐私

- 默认：文件读写在本地完成，不经过本项目服务器（本项目无后端）。
- 阅读翻译：仅在你主动开启并配置 Key 后，将预览中的待译文本发送到你选择的第三方 API。
- API Key 保存在浏览器扩展本地存储中。

---

## License

[MIT](./LICENSE) © 2026 [yishu-ziyu](https://github.com/yishu-ziyu)

---

## English

**Chrome Markdown Editor** is a Manifest V3 extension for editing local Markdown files in the browser.
No backend.
No upload for normal editing.


### Install

1. Download `chrome-md-editor-v*.zip` from [Releases](https://github.com/yishu-ziyu/chrome-md-editor/releases).
2. Unzip and load the inner **`dist/`** folder via `chrome://extensions` (Developer mode → Load unpacked).
3. Enable **Allow access to file URLs** in the extension details.
4. Click the toolbar icon, or drag a `.md` file into Chrome.

After upgrading: **Reload** the extension, close old editor tabs, open a new one.
The toolbar should show the release version (currently **v1.9.5**).

### Features (short)

- Drag-open local `.md`, multi-tab instances, folder sidebar
- Split / editor / preview layouts, light & dark themes
- Preview WYSIWYG sync, Mermaid, local images, paste screenshot
- Optional reading translation (bilingual preview; source file unchanged)

### Editor enhancements (from markra port)

- 23 editor themes (default: Dou Sha Lü eye-care green); slash (`/` or `、`) command menu; block drag-and-drop with insert handle; view modes (Daily / Focus / Immersive / Full) toggled by the `⊞` button; workspace search across the opened folder; inline `==highlight==` and GitHub-style admonitions (`> [!NOTE]` etc.).

### Develop

```bash
npm install && npm test && npm run build
```

Load `dist/` as an unpacked extension.
`npm run dev` is UI-only and is not a substitute for extension testing.

### Privacy

Editing stays local unless you enable reading translation, which sends text to the API provider you configure.

### Standalone Windows EXE (Tauri)

A portable Windows build is also provided: the same web editor packaged with Tauri v2 into a green, install-free `Markdown.Editor_1.9.1_portable.exe`. Double-clicking a `.md` (after setting it as the default opener) or dragging a `.md` into the window opens it directly; each open runs as an independent instance. Saves write back to the original file. The EXE relies on the system WebView2 runtime and is built entirely in GitHub Actions (no local Rust/Tauri toolchain needed). Download from the `v1.9.1` release.

### License

[MIT](./LICENSE)
