# Changelog

All notable changes to this project are documented in this file.

Format based on Keep a Changelog.
Project uses Semantic Versioning.

## [1.9.5] - 2026-08-16（对比视图玻璃皮肤 + 审计 6 项修复）

> 补全对比视图玻璃皮肤（glass）并对齐主视图玻璃体系；修复玻璃皮肤审计发现的 6 项问题（窄窗工具栏裁切 / 明暗对偶 / 性能 / 测试缺口）。

### 特性
- 对比视图玻璃皮肤（data-skin="glass"）：为对比工具栏、对比页脚、定位面板、滚动箭头、主区域新增半透明玻璃材质，复用主视图 [data-skin="glass"] 选择器派生兜底（21 套标准主题自动 color-mix 适配，10 套玻璃主题显式定义 --ambient/--accent-glow/--btn-top/--btn-bot/--edge）；data-editor-theme 33 套配色与玻璃材质正交叠加，由 pplyEditorThemePreset() 默认挂载。

### 缺陷修复
- 玻璃皮肤审计 6 项修复：
  - **H1 窄窗工具栏裁切**：对比工具栏经 	oolbar-scroll.js 包入 .toolbar-wrap（作为 ody flex 子项 lign-items:stretch 占满视口宽），新增 .toolbar-wrap .compare-toolbar{flex:1 1 auto;flex-shrink:1;min-width:0} 允许收缩并触发自身 overflow-x:auto 横向滚动，修复窄窗按钮被 ody{overflow:hidden} 裁切不可达。
  - **M1 明暗对偶**：为 6 套玻璃主题补齐 THEME_COUNTERPARTS 对偶（github-glass-light↔github-glass-dark、dou-sha-lv-glass↔nord-glass、aurora-glass↔glacier、mac-glass↔macos，含双向），测试断言全 33 主题「对偶必为已知预设且 kind 相反」全绿。
  - **M2 定位面板性能**：.compare-location-pane 移除 ackdrop-filter: blur(12px) saturate(150%)，ackground 改 color-mix(in srgb, var(--lp-bg) 90%, transparent)，降低合成开销。
  - **M3 测试缺口**：新增 2 条 compare.css 静态断言（MergeView 禁区 .compare-panes/.cm-mergeView/.compare-view* 严禁 ackdrop-filter/transform/filter/will-change/contain；H1 滚动修复规则存活）；玻璃材质键断言由 4 套扩至全部 10 套；新增「全部 33 主题含 THEME_VARS_KEYS 全部键」。
  - **L1 玻璃模糊强度**：对比工具栏 ackdrop-filter: blur(20px) → lur(16px) 收敛。
  - **L2 WebKit 前缀**：滚动箭头 .toolbar-scroll-btn 补 -webkit-backdrop-filter，与主视图对齐。

### 测试
- 玻璃皮肤审计回归：	ests/theme-presets.test.js 新增 2 条 compare.css 静态断言 + 玻璃材质键（10 套）/ 主题键（THEME_VARS_KEYS）全覆盖断言。

## [1.9.4] - 2026-08-16（对比页三栏 B↔C 逐块采纳列修复）

> 修复对比/合并页三栏模式下 B↔C 栏间「逐块采纳列」挂载缺陷（此前该列根本无法挂载、三栏视图构造失败），并补充对比页调试钩子与对应单测。

### 缺陷修复
- 修复 src/compare-merge.js 三栏 B↔C 逐块采纳列挂载失败：原 parent.insertBefore(col, theirsView) 传入的是 CodeMirror EditorView 实例而非真实 DOM 节点 	heirsView.dom，导致 insertBefore 抛 TypeError、整个三栏构造被 ender() 的 catch 吞掉、视图空白；改为 	heirsView.dom 后三栏逐块采纳功能恢复正常。该缺陷仅 CDP 真机复验可暴露（node 单测无法实例化 EditorView）。
- 修复逐块采纳越界钳制（BUG7 关联），避免采纳索引越界导致的异常。

### 增强
- 对比页调试钩子（window.__cmp，仅 localStorage.cmp-debug=1 暴露）新增 pplyFiles / setColCount，便于自动化注入三栏有差异文件并切换栏数验证。

### 测试
- 新增 	ests/compare-bc-accept.test.js（三栏 B↔C 逐块采纳）、	ests/compare-pick-target.test.js（采纳目标选择）；新增 src/compare/pick-target.js 模块。
## [1.9.3] - 2026-08-16（审计报告 23 项缺陷修复 + 对比/合并页 UI 调整）

> 修复 v1.9.3 三份审计报告共 23 项唯一缺陷（2 HIGH / 11 MEDIUM / 10 LOW），并调整对比/合并页视觉。

### 缺陷修复
- H1 compare.js acceptAllDir 三栏仅压非冲突块（避免误删未解决冲突）
- H2 translate.js / background.js 引入 withTimeout + AbortController 超时保护（避免翻译请求挂死）
- M1–M11 编辑器/对比合并/横切模块多项修复：滚动同步按钮高亮与守卫、SN 去重、scrollSync 控制器唯一性、焦点跟随、SVG DOMPurify 净化、URL 延迟释放、统一 isTauriEnv、全文哈希替换首尾采样等
- L1/L3–L9 多项 LOW 修复：分隔符跟随、c 栏兜底、utf-8/gbk 回退、deepl 源语言映射、轻量混淆存储、LRU 缓存、file: 协议收敛、密度对齐

### UI 调整
- 对比/合并页隐藏文件名标签栏「本地文件/对方文件」（保留 #compareFiles 拖拽容器）
- 三栏右侧栏由硬编码白改为随主题色（var(--bg-primary)）
- 三栏标题改为「文件一/二/三」

## [1.9.2] - 2026-08-16（对照合并双模式重构 + 初始化期 confirm 死锁修复）

> 对照/合并双模式重构，并修复初始化期阻塞式 confirm 导致的编辑器页死锁与对照页滚动同步失效。

### 修复与重构
- 修复编辑器页初始化期 `window.confirm` 阻塞主线程导致渲染进程死锁（误判 renderer 崩溃）→ 非阻塞页内弹窗
- 修复对照页滚动同步误调用（compare.js 误调 `scrollSync.setEnabled` + 手动翻转 → 仅 `scrollSync.toggle()`）
- 清除全部阻塞式 `window.confirm`：editor.js 快照恢复 / search-panel.js 工作区替换 → 非阻塞 `showConfirm`（新增 `confirm-dialog.js`）
- 对照/合并双模式重构：compare.js / compare-merge.js / compare-files.js / io-bridge.js / compare.css / compare.html
- 新增编辑器模块：scroll-sync / bracket-highlight / editor-extensions / editor-theme-base / path-ellipsis / save-poll
- 测试：新增 confirm-dialog 等 5 个单测；`npm test` 455 通过 / 0 失败
- 真机回归（CDP）：editor=53 / compare=21 / fatal=none，15 项断言全 true

## [1.9.1] - 2026-08-14（7 项 BUG 修复：预览实时渲染 / 栏宽收窄 / 跳转弹窗 / 返回按钮 / 激活栏选文件 / 采纳栏收窄 / 默认展开）

> 维护性修补版本，不引入新功能，仅修复 v1.9.0 实测发现的 7 项交互缺陷。

### 修复
- 预览区所见即所得（#10）：预览栏输入 Markdown 语法（`**粗体**`、`[链接](url)` 等）实时渲染为富文本；采用「往返渲染」（`htmlToMarkdown(oldHtml)` → `md.render`）保证已渲染格式在继续输入时不退化；并同步回写编辑器对应位置。
- 主界面行号栏收窄约 20%、拖拽栏 `content` `padding-left` 减半并同步块拖拽手柄负偏移（#11）。
- 点击「对比/合并」打开 compare.html 时消除「是否离开网站？」弹窗（新增 `intentionalLeave` 标志）（#12）。
- 对比/合并界面新增「返回主界面」按钮（#13）。
- 对比/合并「选择文件」按当前激活栏打开，新增 `pickSingleFile` 单选（#14）。
- 对比/合并中间采纳栏收窄 20%（84px→67px）（#15）。
- 核对对比/合并默认已展开，无需改动（#16）。

### 验证情况
- 六处 web 版本戳同步至 1.9.1（package/manifest/editor.js/editor.html/compare.js/compare.html）。
- CI 双端构建（扩展 zip + 便携 EXE）全绿。

## [1.9.0] - 2026-08-14（粘贴分治 + 打开/保存降级 + Ctrl+G 跳转行号）

> 编辑器输入与文件操作健壮性增强：① 粘贴改为「默认纯文本 + 显式富文本」分治，新增编辑区右键菜单「粘贴为文本 / 粘贴为富文本」，彻底消除从 AI 助手等复制的「伪富文本」（样式 `<span>` 包裹）污染正文；② 打开/保存补齐 File System Access API → `<input type=file>`/下载 降级（新增 `src/file-picker.js`），与 compare 模块对齐，非 Chromium 环境不再静默失败；③ 补 `Ctrl+G` 跳转行号（专业编辑器标配）。

### 新增
- 粘贴分治（#1）：`Ctrl+V` / 系统右键粘贴恒为纯文本（与记事本一致，零污染）；仅当用户在编辑区右键菜单显式选择「粘贴为富文本」时才将剪贴板 HTML 经「剥样式标签 + 去 style 属性」清洗后转为 Markdown 插入；图片粘贴（`image/`）保持默认自动插入，不受纯/富文本选择影响。
- 编辑区右键菜单：复用预览区右键菜单样式与定位范式，新增「粘贴为文本」「粘贴为富文本」两项（已删除与「粘贴为文本」重叠的原「右键粘贴」项）。
- 打开/保存降级（#3）：新增 `src/file-picker.js`，`openFileViaPicker()` / `saveViaPickerOrDownload()` 优先走 File System Access API，不可用时分别降级到 `<input type=file>` 与 Blob 下载，与 `compare-files.js` 同一检测条件、同一降级手段。
- `Ctrl+G` 跳转行号（#4）：从 `@codemirror/commands` 引入 `gotoLine` 并绑定 `Mod-g`。

### 修复
- 粘贴污染根因（#1）：移除默认粘贴对 `text/html` 的自动拦截与 `FORMATTING_SELECTOR` 富文本判定守卫，避免 WorkBuddy 等「纯文本穿 `<span style>` 外衣 + 个别 `<strong>`」被转成「`**…**<span style="…">…</span>`」半 Markdown 半 HTML 的污染文本。
- 打开/保存内部不一致（#3）：`handleOpen` / `handleSaveAs` 改调统一选择器封装，非 Chromium 环境（如 Firefox）`Ctrl+O`/`Ctrl+S` 由静默失败改为可用；降级打开后 `Ctrl+S` 自动回退「另存为（下载）」，不崩溃。

### 验证情况
- 六处 web 版本戳同步至 1.9.0（package/manifest/editor.js/editor.html/compare.js/compare.html）。
- 预览区→源码回写（`html-to-markdown.js`）未改动，工具栏裸 HTML（`<font>`/`<center>`/`<mark>`，维持现状）往返不受影响。
- 须由 CI 全量单测 + 360Chrome/EXE 真机复验：粘贴纯/富文本分治、打开/保存降级、Ctrl+G。

## [1.8.8] - 2026-08-08（缺陷修复：编辑器明暗跟随/字体属性白名单 + 对比页 scanLimit 分块/图片拖拽区）

> 对比/合并三期功能的收尾修复闭环：修复编辑器主题明暗切换对 CSS 变量层失效、`<font>` 属性注入无白名单、大文档差异分块退化（scanLimit），以及图片拖拽插入区未挂载等缺陷；并补齐 compare 页 E2E 回归（80 条），确认零遗留真 BUG。

### 修复
- 编辑器主题：明暗切换改为切到同族对偶预设（`dou-sha-lv-light`↔`dou-sha-lv-dark`、`github`↔`github-dark`…），`data-theme`/`data-editor-theme`/下拉/CM6 四处一同翻转（THM-01）。
- 字体样式：`applyFontStyle()` 增加 `isValidFontAttrValue` 白名单（size `/^[1-7]$/`、color `#hex3/6` 或 3–20 字母），非法值拦截+提示，杜绝坏标签污染源码（STY-10）。
- 对比/合并：`@codemirror/merge` 的 `scanLimit` 由 500 提到 2000，3000 行/50 处分散差异恢复精确分块（逐字符不变，BND-05b）。
- 对比/合并：图片拖拽插入区 `#compareImageDrop` 占位补挂 `createImageUploadArea` 真实拖拽区，可向活动编辑器拖入/选择图片（CMPX-08）。

### 验证情况
- 单测 370/367/0/3；编辑器复测 `fix-verify` 12/12；编辑器全量 E2E 57/0/1 阻塞(环境)/0 BUG；compare 边界 16/17 + 1 警告(已修)；compare 全量 E2E 80 条（75/5，4 测试工件 + 1 真缺陷 CMPX-08 已修）。
- 构建通过，已部署 360Chrome 真机复验 CMPX-08 拖图插入生效。
- 六处 web 版本戳同步至 1.8.8（package/manifest/editor.js/editor.html/compare.js/compare.html）。

## [1.8.7] - 2026-08-07（EXE 侧 window.open 接管：对比/合并入口 + 外链恢复可用）

> 全量逐一审查 v1.8.6 在 EXE（Tauri）侧失效的按钮/功能：定位唯一根因——`window.open` 未被垫片接管，导致「对比/合并」入口与外链点击在 EXE 静默无反应。补全 Tauri 兼容层并加回 shell 插件与窗口创建能力。

### 修复
- EXE 侧 `window.open` 接管（`src/desktop-shims.js`，仅 Tauri 分支执行，浏览器侧零影响）：
  - 站内相对路径（如 `compare.html`）→ 经 `@tauri-apps/api/window` 的 `WebviewWindow` 开受管子窗口（最接近扩展「新标签」语义）；子窗口不可用时退化为同窗 `location.assign` 导航，保证功能可达。
  - 外部协议（http/https/mailto/tel/ftp）→ 经 `tauri-plugin-shell` 调系统默认程序打开。
  - 返回 truthy 对象，兼容 `openPreviewLink` 中 `if (!opened) throw` 判空。
- Tauri 后端：`desktop/Cargo.toml` 新增 `tauri-plugin-shell = "2"`；`desktop/capabilities/default.json` 新增 `shell:allow-open` 与 `core:webview:allow-create-webview-window`；EXE 版本 1.4.14 → 1.4.15。
- 前端依赖：`package.json` 新增 `@tauri-apps/plugin-shell`。
- 六处 web 版本戳同步至 1.8.7（package/manifest/editor.js/editor.html/compare.js/compare.html）。

### 验证情况
- 浏览器侧（360chrome）改动被 `isTauri` 守卫隔离，构建+单测+真机冒烟不受影响。
- EXE 侧行为须由 CI 产出的 EXE 真机回归确认（360chrome 无法复现 Tauri 路径）。

## [1.8.6] - 2026-08-06（对比/合并 功能 6 步循环：clobber 回归修复 + 导航/折叠 + 单栏 unified 移除）

> 站在用户视角编写对比/合并全覆盖测试方案（两栏/三栏，全部对比/编辑/合并，无预览栏），多场景+多边界；4+1 轮子 Agent 用 Playwright(360Chrome) 真机实测（先假设全功能有 BUG、用事实证伪/证真），经 code-review-combo 全量审计迭代，重测收敛至「无 BUG」。

### 修复
- **clobber 关键回归（compare.js）**：`render()` 顶部 `saveCurrentEdit` 用陈旧/空 doc 覆盖刚载入的文件内容，导致所有编辑器恒空、差异/导航/折叠/三栏全部失效；引入 `skipSaveOnNextRender` 标志（仅 `onPickFiles`/拖拽置位）跳过当次回写。
- **导航环绕（compare-nav.js F1）**：`move()` 末块之后跳到第 1 块而非环绕第 0 块，重写为严格边界 `from>head`(next)/`to<=head`(prev)+环绕。
- **顺序步进卡死（compare-nav.js）**：光标精确落在块 `from` 边界时连续「下一块」卡同一块，改用严格边界+环绕，复测 `23→44→65` 循环正确。
- **折叠时机（compare-merge.js F2）**：`render()` 同步调 `setCollapse` 时 diff 未完成导致折叠永久关闭；改为 rAF 轮询（120 帧上限、视图销毁即停）待 diff 落定按真实 chunks 校正折叠，同时保留「相同文件全可见」。
- **三栏/接受块/保留结果/行级 diff（#103-#108）**：三栏导航基于 `getChunks`；`acceptTheirsAt` 用 `Chunk.build` 反推插入（修复空文档 RangeError）；`resultInitial` 保留上次结果；`compare-diff-export.js` 行级 diff 整行输出 `@@ ... @@` 不再字符截断。
- **移除单栏 unified 视图**：删除 `compare-unified.js` 并清理连带注释/CSS（`.compare-view-single`/`.cm-compare-chunk-btn`），审计「单栏移除」判误报排除；grep 确认无残留引用。

## [1.8.5] - 2026-08-06（工具栏横向溢出滚动 + 侧栏收起 + 隔断符间距收敛）

> 经全场景 Playwright(360Chrome) E2E 实测（先假设全功能有 BUG、用事实证伪/证真）坐实 3 类已知问题 + 对比页同源缺陷，定位根因并修复，构建后回归验证全绿。

### 修复
- **已知问题1 · 工具栏隔断符/按钮间距过大（BUG-A）**：`.toolbar-left/.toolbar-center/.toolbar-right` 段 `gap` 由 4px 收敛至 2px；`.toolbar-group` 横向 `padding` 由 `2px 4px` 收敛至 `2px 0`，消除三层间距（段 gap + 组 padding + 隔断符 margin）叠加导致的 11–15px 过大间隙。
- **已知问题2 · 文件树/工区收起后未真正隐藏（BUG-B）**：`.file-sidebar.collapsed` 原 `width:0` 被 `.file-sidebar` 的 `min-width:180px` 压制，收起后实际仍占 180px。新增 `min-width:0` 压制，收起后真正脱离布局、不占空间。
- **已知问题3 · 工具栏按钮超出可视边界且用户不可达（BUG-C/D）**：新增 `src/toolbar-scroll.js` 共享模块，用 `.toolbar-wrap` 包裹 `#toolbar`/`#compareToolbar` 滚动容器，在最左/最右按需显示 `‹`/`›` chevron（`scrollLeft` 实时显隐、点击平滑滚动），保证 320px 极端窄宽下全部按钮可达；主编辑器与对比页同源接入。

## [1.8.4] - 2026-08-06（code-review-combo 审计收敛：对比页主题同步 + 工具栏隔断符间距）

> 经 code-review-combo 全量审计 → 修复 High 级主题同步缺陷 → 真机 Playwright(360Chrome) E2E 36/36 全绿 + 单测 253 pass。
> 覆盖：对比页主题/配色预设/皮肤与主 UI 真正一致（含暗色预设场景）；工具栏隔断符/按钮间距收紧至紧凑布局。

### 修复
- **审计 F1 · 对比页主题同步源错误（已知问题4 真修复）**：`compare.js applyCompareTheme` 原用 light/dark 开关键推导
  `data-theme` 且暗色写成空串，导致暗色预设下对比页仍亮色、默认配置下缺配色预设。改为复用主编辑器权威函数
  `applyEditorThemePreset(getStoredEditorTheme())` + `getColorScheme()`，对比页 `data-theme`/`data-editor-theme`/`data-color-scheme`
  与主 UI 完全一致（含暗色预设与默认配置）。
- **审计 F3 · 主题一致性测试补强**：T6.15 改断言三属性齐全；新增 T6.15b（暗色预设回归）；L7.7 补断言；新增 L7.7b（storage 实时同步）。
- **已知问题2 · 工具栏隔断符间距过大**：`.toolbar` 三段由 `space-between`/`flex:1 1 auto`/`margin-left:auto`
  改为 `flex-start` + `flex:0 0 auto`，并收紧段 `gap`(6→4)、组 `padding`(6→4)、隔断符 `margin`(8→3)，间距收敛至约 11–22px。

## [1.8.3] - 2026-08-06（针对 v1.8.2 用户反馈的 5 项缺陷修复）

> 经真机 Playwright(360Chrome) E2E 验证 11/11 全绿 + 单测 253 pass。
> 覆盖工具栏对比入口 / 全屏对齐 / 响应式单行 / 预览区实时渲染同步 / 编辑器→预览防闪烁。

### 修复
- **问题1 · 对比/合并入口**：工具栏「视图切换组」新增 `#btnCompare` 按钮，
  点击在独立标签页打开 `compare.html`（多栏/差异对比视图）。
- **问题2 · 全屏对齐**：`.toolbar` 统一为固定高度 48px + `align-items: center` + 三段
  `align-self: center`，消除全屏时按钮高低错落（之前中段因内部 overflow 滚动槽被撑高 6px）。
- **问题3 · 响应式单行**：放弃 `flex-wrap: wrap` 换行模式，改为整条工具栏 `flex-wrap: nowrap`
  + `overflow-x: auto` 横向滚动；窄窗不再纵向堆叠/裁切按钮，所有窗口尺寸保持单行对齐。
- **问题4 · 预览区实时 Markdown 渲染**：新增 `renderLivePreviewMarkdown()`——
  预览区(contenteditable)输入 `**粗体**`、`\`代码\``、`# 标题` 等语法时，经「htmlToMarkdown→
  markdown-it」往返渲染为富文本并实时同步回编辑器（编辑器得到含 `**` 语法的源码）。
  纯净文本不触发渲染以保留原生光标；已渲染块经往返保真不被破坏。
- **问题5 · 编辑器→预览防闪烁**：`doUpdatePreview()` 增加内容哈希跳过（相同内容不替换 DOM）
  + `opacity` 淡入过渡，消除每次按键整段重渲染导致的视觉闪烁。

## [1.8.2] - 2026-08-06 (UI 五项改进：所见即所得 / 响应式布局 / 原设计对齐 / 侧栏可调 / 工具栏重排)

> 本轮经 4 Agent 并行开发 + 真机 Playwright 验证，完成用户要求的 5 项 UI/功能改进。
> 所有改动经单测(249 pass) + E2E(harness 13/13 + harness2 11/11) + 真机 verify-ui 全绿。

### 新增
- **上传图片按钮**（`#btnImage`）：工具栏「插入元素」组末尾新增图片上传入口
- **侧栏宽度可拖拽调整**：文件树左侧新增 `#resizerSidebar` 拖拽条，宽度范围 180–500px，
  localStorage 键 `md-editor-sidebar-width` 持久化，页面加载自动恢复
- **预览一致性检测**：新增 `checkPreviewConsistency()` 函数，编辑↔预览双向同步后
  自动校验内容一致性（console.warn 输出差异，不阻断操作）
- **预览区块保护**：`protectPreviewBlocks()` 对非 mermaid 代码块和表格设
  `contenteditable="false"`，防止 contenteditable 下误改导致数据损坏

### 改进
- **所见即所得双向同步增强**：
  - 编辑→预览：防抖渲染保持实时（80ms）
  - 预览→编辑：`releasePreviewEditing()` 智能释放替代固定 120ms 延迟
  - `html-to-markdown.js` 保真度提升：空段落不再累积空行（防数据漂移）；
    表格单元格用 `convertNode` 还原内联格式（粗体/代码/链接），避免往返丢失
- **工具栏归类重排**（与原设计对齐）：
  - toolbar-center: 文件操作 | 格式化(B/I/S/代码/居中/高亮/颜色/字号) | 标题(H1-H3) | 插入元素
  - toolbar-right: 搜索/帮助 | 视图模式 | 视图增强 | 翻译 | 外观 | 视图切换
  - 删除重复加粗按钮（原 style-toolbar-group 的 btnStyleBold 合并入格式化组 btnBold）
- **响应式布局优化**：
  - ≥1400px: 工具栏强制单行（nowrap）；1000–1399px: 允许两行；<900px: 侧栏覆盖层模式
  - 三面板弹性化：sidebar min/max 180–500px, editor min 300px, preview min 250px
- **CSS/JS 单一事实源对齐**：`.file-sidebar` width clamp [180,500] 与 JS `SIDEBAR_MIN/MAX_WIDTH` 完全一致

### Fixed
- **侧栏拖拽持久化值失真**：`onMouseUp` 存 `offsetWidth` 改为存 `style.width`（目标值），
  避免 CSS transition 动画期间 offsetWidth 返回中间帧导致持久化值错误

---

## [1.8.1] - 2026-08-06 (视图恢复 / 工具栏布局 / 会话恢复 回归修复)

> 本轮经 360Chrome 真机 + Playwright 自动化全功能测试，复现并修复 4 项真实缺陷。
> 其中"视图沉浸模式工具栏恢复"在 1.8.0 的 `force-visible`+`position:fixed` 修法**实测无效**
> （`position:fixed` 无法逃逸 `display:none!important` 祖先），本轮以"脱离隐藏容器"方案根治。

### Fixed
- **BUG1 视图沉浸/专注模式隐藏工具栏后无法恢复（1.8.0 修法无效，本轮根治）**：
  `#btnChromeMode`（⊞）位于 `#toolbar` 内，工具栏被 `view-hidden`(`display:none!important`) 隐藏时按钮随之不可见，无恢复入口。修复：`view-mode.js` 在工具栏隐藏时把该按钮**脱离 `#toolbar` 挂到 `body`**（`placeChromeModeButton`，记录原父/兄弟以便恢复时精确插回），成为 `position:fixed` 浮层，无论祖先是否隐藏均真实可见可点；工具栏恢复时挂回原位。
- **BUG2 专注/沉浸模式隐藏文件侧栏后无法恢复**：`toggleSidebar` 仅切换 `.collapsed`，永不移除视图模式加的 `.view-hidden`，导致点击恢复条无效。修复：`toggleSidebar` 恢复时同时清除 `.collapsed` 与 `.view-hidden`；并修复初始化顺序（持久化为 focus/immersive 时首屏即点亮恢复条 `#sidebarToggle`），避免首屏无恢复入口。
- **BUG3 中等宽度下工具栏右侧按钮被裁掉不可见**：两条同级 `.toolbar` 规则中后定义的 base 规则把 `height` 钉死为 `var(--toolbar-height)`(48px)，覆盖了响应式块的 `height:auto`；配合 `overflow-y:hidden`，换行后的右段（⊞/主题/搜索）被裁剪。修复：base 规则改 `min-height`+`height:auto`，响应式块 `overflow:visible`，换行多行工具栏完整可见。
- **BUG4 新建文件后输入、重载/崩溃导致内容丢失（会话恢复数据丢失）**：`handleNew` 把内部文件名改为 UI 标签 `'未打开文件'`，而自动保存草稿键由 `resolveFileKey(文件名)` 生成 → 草稿存到 `draft::未打开文件`；重载后新会话 `currentFileName` 为 `'unsaved'`(`draft::unsaved`)，键不一致使草稿孤儿化、输入丢失。修复：`autosave.js` 的 `resolveFileKey` 将 `'未打开文件'/'untitled.md'/'unsaved'/空` 等未保存标签统一归并到稳定键 `'unsaved'`，草稿键跨会话一致（真实文件各有文件名不受影响）。

### Tests
- 新增 Playwright + 360Chrome 自动化测试骨架 `.test-run/harness.mjs`（核心回归 13 项：工具栏/侧栏恢复、视图循环、分屏、主题、对比页）与 `.test-run/harness2.mjs`（扩展 10 项：专注/打字机/大纲/任务/显示设置/新建/会话恢复/主题预设/Mermaid/快照）。两轮全绿。
- 既有 `node --test` 单元测试 254/0 通过（无回归）。
- 测试方案 `tests/E2E_TEST_PLAN.md` 已就绪（多场景 + 多边界全覆盖）。

## [1.8.0] - 2026-08-05 (主题玻璃材质皮肤 + BUG 修复)

### Added
- **主题玻璃材质层 + 4 套新皮肤并入 27 主题体系**：玻璃材质（厚度面板 / 立体按钮 / 环境光晕）+ 4 套皮肤（glacier / aurora / fluent / macos）+ 豆沙绿暗重做深墨绿 + 21 旧套补 `--accent-glow`；替换 2 个占位图标（⊞→网格 SVG、🔍→放大镜 SVG）。由 PR #7（`feat/theme-glass-skin`）通过 `--no-ff` 合并入 `main`。

### Fixed
- **BUG1 折叠符号过小**：编辑区最左侧折叠 gutter 符号字号偏低（与 gutter 同为 12px），新增 `.cm-foldGutter span` 专属放大（`font-size:14px`），提升可点性与可读性。
- **BUG4 视图沉浸模式隐藏工具栏后无法恢复**：`#btnChromeMode`（⊞）随 `#toolbar` 被 `view-hidden` 一起 `display:none`，无恢复入口。修复：`view-mode.js` 进入隐藏工具栏模式时给 `#btnChromeMode` 加 `force-visible`，`editor.css` 用 `position:fixed` 浮层常驻右上角；并防御性让 `#sidebarToggle` 在侧栏被 `view-hidden` 时同样显示，避免侧栏隐藏后无恢复。
- **BUG6 编辑区背景不随主题变化（双轴错乱）**：`.cm-editor` 背景硬编码白底（CodeMirror `lightTheme` 内联 `backgroundColor:'#fff'`），未接 23 套预设 `--bg-primary`。修复：`theme-presets.js` 的 `applyEditorThemePreset` 据预设 `kind` 自动对齐 `data-theme` 明暗基底，根除双轴错乱；`editor.css` 让 `.cm-editor` 背景由 `var(--bg-primary)` 驱动（覆盖 CM 内联硬编码），切换主题即时跟随。

### Notes
- BUG1/4/6 修复先于主题玻璃皮肤合并提交，确保两边对 `editor.css` / `theme-presets.js` 的改动均保留。
- 测试方案：`tests/E2E_TEST_PLAN.md` 多场景全覆盖 + 多边界条件全覆盖（14 组功能矩阵）。

## [1.7.0] - 2026-08-04 (编辑器增强：markra 移植 — 23 主题 / 斜杠菜单 / 块拖拽 / 视图模式 / 工作区搜索 / == 高亮 ==)

### Added
- **编辑器主题扩充到 23 套（默认豆沙绿护眼）**：新增「豆沙绿(亮) / 豆沙绿(暗)」护眼主题，**默认豆沙绿(亮)**；工具栏「主题」下拉可在 23 套主题间切换，与深/浅主题、语法高亮配色方案正交独立。模块 `src/theme-presets.js`（`editor.js` 主题装配 + `editor.css` 主题变量），`src/onboarding.js` 速览同步。
- **斜杠菜单（slash menu）**：编辑区行尾输入 `/` 或中文顿号 `、` 唤起命令面板，可选标题 / 粗体 / 列表 / 代码块 / 引用 / 表格 / 分割线 / 图片 / 链接等；↑↓ 选择、Enter 执行、Esc 关闭。新增 `src/slash-menu.js` + `src/slash-menu-core.js`（命令表 `slashMenuCommands` 14 项）+ CodeMirror 扩展，配套测试 `tests/slash-menu.test.js`。
- **块拖拽（block drag）**：每个块首行左侧出现拖拽手柄，按住拖动调整块顺序；手柄旁「+」在当前块下方插入新块。新增 `src/block-drag.js`（`parseBlocks` / `blockDragField` / `blockInsertField`），末块延展至文档末尾；配套测试 `tests/block-drag.test.js`（循环 ensure 加固解析）。
- **视图模式（日常 / 专注 / 沉浸 / 全显）**：工具栏「⊞」循环切换四种布局；专注隐藏侧栏 / 大纲 / 任务 / 状态栏，沉浸进一步隐藏工具栏，全显最大化面板。新增 `src/view-mode.js`（视图状态机 + 持久化）。
- **工作区搜索**：工具栏「🔍」打开搜索面板，检索当前已打开文件夹内所有 Markdown 文件的命中片段并点击跳转。新增 `src/workspace-search.js`（`initWorkspaceSearchPanel` / `runWorkspaceSearch` + 设值器 `setGlobalDirectoryHandle` 解除与 `editor.js` 的循环依赖）。
- **行内 `==高亮==` 与 GitHub 风格提示框**：`==文字==` 在预览中高亮（替代旧 `<mark>` 包裹写法，`htmlToMarkdown` 回写约定末尾补 `\n`）；`> [!NOTE]` / `> [!WARNING]` / `> [!TIP]` / `> [!CAUTION]` 等提示框继续支持。

### Changed
- `src/editor.html`：新增 `editorThemeSelect`(主题下拉) / `btnChromeMode` ⊞(视图模式) / `btnWorkspaceSearch` 🔍(工作区搜索) / `workspaceSearchModal`(搜索弹窗)；`onboarding` 示例文档「新增功能速览」覆盖 6 大功能。
- `src/editor.js`：`editorThemeSelect` 绑定并持久化 23 主题；接入斜杠菜单 / 块拖拽 / 视图模式 / 工作区搜索模块；`handleOpenFolder` 与初始化处用 `setGlobalDirectoryHandle` 向工作区搜索注入目录句柄；`==` 高亮解析接入 `htmlToMarkdown`。
- `src/editor.css`：新增 23 套主题变量、`workspaceSearchModal` 弹窗样式、视图模式相关类。
- 循环依赖治理：`src/workspace-search.js` 不再反向 import `editor.js`（其顶层 `localStorage.getItem` 在 node 环境崩溃），改用本地变量 + 设值器范式。

### Notes
- 版本戳：package.json 与 public/manifest.json 同步升至 1.7.0（语义化 minor：向后兼容的新功能集合）。
- 分支整合：`feat/markra-features` 通过 `--no-ff` 合并入 `main`，其下 9 条并行 feat 分支（a6stub / blockdrag / onboarding / slash / syntax / themes / toolbar-fix / viewmode / workspace-search）均已并入。
- 测试门禁：`npm test` 全绿、`npm run test:issues` 16/16、`npm run build` 成功。

## [1.6.0] - 2026-08-04 (编辑器 UI 增强：磁盘自动保存 / 高亮合并 / 翻译合并 / 全按钮提示 / 块导航快捷键)

### Added
- **磁盘自动保存（工具栏开关 + 间隔秒数）**：工具栏新增「自动保存」开关按钮（`btnAutosaveDisk`）与间隔输入框（5–3600 秒，默认 30；`localStorage` 键 `md-editor-autosave-interval` 持久化）。开启后每 N 秒在**源文件同目录**生成「主文件名_秒级时间戳.md」副本（如 `这是测试文件.md` → `这是测试文件_20260804133025.md`），时间戳格式 `yyyyMMddHHmmss`（本地时间），过滤 Windows 非法字符 `\ / : * ? " < > |`，**永不覆盖源文件**（`filename !== currentFileName` 守卫）。Web 侧首次需授权目录句柄（`showDirectoryPicker` / `getCurrentMarkdownDirectoryHandle`）；Tauri EXE 侧直接写 `currentFileHandle.path` 同级目录，复用既有 `write_text_file` 命令（`.md` 在白名单，不动 `lib.rs`、无 Rust/CI 风险）。新增 `src/autosave.js` 磁盘自动保存 API（`initDiskAutosave` / `autosaveToDisk` / `runDiskAutosaveOnce` / `buildAutosaveFileName` / `formatTimestamp` / `normalizeIntervalSec` 等），配套测试 `tests/autosave.test.js`（文件名/时间戳/间隔夹取/单次落盘/定时器系列）。
- **高亮按钮合并（编辑区 + 预览区联动）**：原「格式化组 `btnHighlight`」与「样式组 `btnStyleHighlight`」合并为单一「高亮」按钮（`btnStyleHighlight`）。在**编辑区或预览区**选中文字后点击，源码统一外包 `<mark>…</mark>` 并同步重渲染预览；再点一次取消。杜绝「编辑区改了预览不渲染」或「预览渲染了编辑区不外包源码」的分裂行为（`rememberPreviewSelection` 记忆预览选区、`applyPreviewHighlight` 同步重渲染）。
- **翻译按钮合并**：原独立「翻译设置」按钮（`btnTranslateSettings`）删除；改为**左键**点「译」开关双语对照、**右键**点「译」打开翻译设置（API Key / 模型 / 目标语言）。
- **所有工具栏按钮鼠标悬停提示**：补齐全部按钮 `title`（含弹窗按钮 `translateSettingsCancel/Save`、`snapshotsClose` 等），悬停即显示功能说明与快捷键。
- **字号选项 title**：5 个 `fs-option`（小 / 中 / 大 / 特大 / 极大）补齐 `title`，说明插入 `<font size=…>…</font>` 及再点取消。

### Added (compare 模块)
- **块导航键盘快捷键（修复 Q2 表「快捷键无效」）**：对比页新增 `bindChunkNavigationKeys`，键位 `B` / `]` → 下一块，`Shift+B` / `[` → 上一块；在可编辑区域（CodeMirror / input / textarea）内为不吞掉正常输入，改用 `Alt+B` / `Alt+Shift+B` 在编辑区内也生效（捕获阶段监听 + `isEditableTarget` 守卫）。快捷键与「上一块 / 下一块」按钮复用同一组 `navNext` / `navPrev` 函数，行为一致。新增 `resolveChunkNavAction`（纯函数，可单测）与 `isEditableTarget`；配套测试 `tests/compare-diff.test.js`「E. 块导航快捷键」分组 7 用例。

### Changed
- `src/editor.html`：新增 `btnAutosaveDisk` + `autosaveIntervalInput`；删除 `btnHighlight`（并入 `btnStyleHighlight`）、删除 `btnTranslateSettings`；为所有缺 `title` 按钮补 `title`；5 个 `fs-option` 补 `title`。
- `src/editor.css`：新增 `.autosave-interval` 样式。
- `src/editor.js`：注入 `writeFile` 落盘封装；`resolveAutosaveTarget` / `writeAutosaveCopy`（Tauri 走 `currentFileHandle.path` 同级目录，Web 走目录句柄，守卫不覆盖源文件）；`initAutosaveDiskUI`（开关 + interval 持久化）；高亮合并绑定（`mousedown preventDefault` + `rememberPreviewSelection` + `applyPreviewHighlight`）；翻译合并（右键开设置）。
- `src/compare.html`：修正上一块 / 下一块按钮 `title` 歧义（原两个都写 "(B)"）。
- `src/compare.js`：紧邻按钮绑定加 `bindChunkNavigationKeys({ next: navNext, prev: navPrev })`。
- `src/onboarding.js`：文档一致性（合并高亮说明 + 自动保存说明）。
- `tests/issue-acceptance.test.js`：断言 `btnHighlight` 已不存在（合并入 `btnStyleHighlight`）。

### Notes
- 严格保留样式工具栏功能（`applyFontStyle` 等）未触碰。
- 分支：`feat/editor-ui-enhancements`（基于 `main` @ `466bc8e`）。
- 验收闸门：`tests/issue-acceptance.test.js` 仍封禁 v1.3.0 的「刺眼 style-preset」原始碎片按钮（`btnCenterBold` / `btnCenterBoldRed` / `styleGroup`）。

## [1.5.0] - 2026-08-02 (Markdown 语法高亮 + compare 多栏对照模块)

### Added
- **Markdown 语法高亮（A+B 两区各自彩色字体 + 行底色 + 多套配色）**：编辑区与预览区各自获得 Markdown 语法彩色字体与块/行底色，两区独立、不强制同色对齐。
  - **编辑区（CodeMirror 6，正则法）**：新增 `src/md-editor-highlight.js`——`markdownHighlightStyle` 以 class 驱动把语法 tag（标题 1-6 / 粗体 / 斜体 / 链接 / 引用 / 行内代码 / 分隔符 / 标记）映射到 `.cm-md-token-*` CSS 类；`lineBgDecorations`（StateField）为正则法识别的标题行 / 引用行 / 围栏代码块行加 `cm-md-heading-N` / `cm-md-quote-line` / `cm-md-fence-line` 行底色（`inFence` 状态机追踪围栏起止与内部）；`markdownMarkerDecorations`（ViewPlugin）为 `#`/`>`/列表标记与 ```` ``` ```` 围栏行加标记装饰；三者经 `mdEditorHighlightExtensions` 由 `src/editor.js` 在默认高亮之后叠加。
  - **预览区（markdown-it 14 + highlight.js 11）**：新增 `src/md-preview-highlight.js`——`createMarkdownHighlight(sanitize)` 工厂以 hljs 11 新 API（`hljs.highlight(str, { language, ignoreIllegals })`）产出 `<pre class="hljs">` token，并**外包 `sanitizePreviewHtml`（DOMPurify）保持 XSS 防护链不回退**；未识别语言 / hljs 抛错时回退 `mdEscape` 转义，杜绝注入；`src/editor.js` 在 MarkdownIt 配置注入 `highlight` 回调。
  - **多套配色 + 与主题正交**：新增 `src/md-theme-tokens.js`（`COLOR_SCHEMES` / `getColorScheme` / `setColorScheme` / `applyStoredColorScheme`，薄封装 localStorage + `<html data-color-scheme>`）；`src/editor.css` 以 `[data-color-scheme]` × `[data-theme]` 变量层定义 classic / sepia / high-contrast 三套配色，切换仅改文档属性、编辑区与预览区瞬时跟随，无需 `reconfigure` 高亮；`src/editor.html` 显示设置弹窗新增「配色方案」下拉，`src/editor.js` 绑定并持久化、启动时 `applyStoredColorScheme()` 防刷新丢失。
  - 新增运行时依赖 `highlight.js ^11`（预览区代码高亮；采用 `highlight.js/lib/common` 常用语言子集以控制打包体积，未注册语言走 `mdEscape` 转义回退）。
  - 新增配套测试 `tests/md-highlight.test.js`（13 项：编辑区行底色标题/引用/围栏分类、StateField 集成、预览 hljs token 与回退转义、模块导出结构）；`node --test` 全量 140 项通过。

### Added
- **compare 多栏对照模块（本地文件对照 + 逐块合并）**：新增基于 `@codemirror/merge` 的 `MergeView` / `unifiedMergeView` 对照合并能力（零自研 diff），不依赖 Git 目录，纯前端 diff/merge 本地 Markdown / 纯文本。
  - **三种视图**：两栏 diff（Yours / Theirs，差异块红绿高亮 + 行号 `−`/`+` 标记，a 侧可只读）、三栏合并（Yours 只读 / Result 可编辑 / Theirs 只读参考，中文「⇄ 接受此块」逐块并入、支持「接受 Theirs 块」）、单栏 unified（行内对照 + 删除行语法高亮 + 中文「接受 / 拒绝」块按钮）。
  - **文件多选与拖拽**（T3）：`<input multiple>` + `File.text()` 及拖拽区读取 `.md` / `.txt`（不限于 Git 目录）；第 1 个文件为 Yours、第 2 个为 Theirs。
  - **块导航**（增量 B）：「上一块 / 下一块」绑定 `goToNextChunk` / `goToPreviousChunk`（现成 `StateCommand`）。
  - **折叠未改**（增量 E）：`uncollapseUnchanged` 折叠 / 展开大片未改区域（单栏展开当前光标处）。
  - **图片插入**（T5）：拖拽 / 点选图片转 data URL 插入当前光标，复用 `src/image-support.js` 纯函数。
  - **导出合并结果**（T6）：`showSaveFilePicker` 句柄留存写回 + `<a download>` 降级 + 剪贴板降级三级策略（按文件名留存句柄，避免误写回）。
  - **导出 diff 报告**（增量 F）：`presentableDiff` → 自写文本渲染层生成 git 风格可读 diff（`.diff`，`@` 行 + `+/-` 标记）。
  - **单栏行内 diff**（C）与删除行语法高亮（D）；**中文自定义按钮**（G，类名 `cm-compare-revert` / `cm-compare-chunk-btn`，避开验收闸门禁用类名）。
  - **入口**：Chrome 扩展右键菜单「打开对比合并」（`public/background.js` 的 `chrome.contextMenus`）+ 新开 `src/compare.html` 独立实例；桌面端（Tauri EXE）同源入口。
  - **桌面同源**（T7）：`desktop/src/lib.rs` 新增 `read_multiple_text_files` / `save_compare_result` 命令；`src/compare-shims.js` 提供浏览器 / 桌面统一文件读写垫片。
  - 新增运行时依赖 `@codemirror/merge ^6.12.1`（对照合并核心）；新增配套测试 `tests/compare-*.test.js`（约 16 项：unified side 标记、桥接层命令名/容错、行标记装饰、IO 对话框/容错）；`node --test` 全量 156 项通过。

### Changed
- `src/editor.js`：在默认高亮（`syntaxHighlighting(defaultHighlightStyle)`）之后叠加 `...mdEditorHighlightExtensions`；MarkdownIt 配置加 `highlight` 回调（含 sanitize）；导入三个新模块；启动时 `applyStoredColorScheme()`；`toggleTheme` 末尾防御性同步 `data-color-scheme`；显示设置绑定 `dsColorScheme`。
- `src/editor.css`：新增三套 `[data-color-scheme]` 变量块（dark/light 两态）与 `.cm-content .cm-md-*`、`.preview-container .hljs-*`、预览区语义块底色绑定（class 驱动，色值全部交给 CSS 变量）。
- `src/editor.html`：显示设置弹窗 `#displaySettingsPopover` 内 `#dsDensity` 之后新增「配色方案」`<select id="dsColorScheme">`。

### Notes
- **复用来源（MIT / 类 MIT，已保留来源注释）**：`orchidsoftware/platform`（编辑区 class 驱动高亮 + 正则法行底色 + 标记装饰，第 2.1 章）；`markdown-it` 官方 + `tensorflow/tfjs-website` / `BaileyJM02/markdown-to-pdf`（hljs 回调范式，第 2.3 章）；hljs 主题 CSS 模板来自社区通用模式（第 2.6 章）。`heyman/heynote`（Nord 配色参考）、`wxmvv/MokoEditor`（Compartment 范式参考）仅作设计参考。
- 严格遵循最高优先级约定：**样式工具栏功能（`applyFontStyle` 等）完全保留、未被触碰**。
- 分支：`feat/md-syntax-highlight`（基于 `main` @ `d66536f5`，即 v1.4.15 线）。
- 已于 2026-08-02 经 `--no-ff` 普通合并合入 `main`（合并提交 `eb26bc5`；保留功能分支提交 `886edae` 为独立谱系，中间提交全保留、历史零改写）；如需整段回滚：`git revert -m 1 eb26bc5`。
- compare 多栏对照模块经 `--no-ff` 普通合并合入 `main`（合并提交 `0ea56e5`；保留功能分支 `feature/compare-merge-ag` 提交 `e348d9b`…`e65b9a0` 为独立谱系，中间提交全保留、历史零改写）；如需整段回滚：`git revert -m 1 0ea56e5`。
- 验收闸门：compare 页自定义按钮统一使用 `cm-compare-revert` / `cm-compare-chunk-btn` / `compare-toolbar-btn` 等新类名，未触碰禁用类名 `btnCenterBold` / `btnCenterBoldRed` / `styleGroup`。

## [1.4.15] - 2026-08-01 (方案 A：自绘中文查/替面板 + A-4：粘贴为 Markdown + A-5：自动保存与快照环)

### Added
- **自绘中文查找/替换面板（方案 A）**：新增 `src/search-panel.js`，替代 CodeMirror 6 默认英文 `search` 面板，注入官方 `search({ createPanel })` 钩子实现中文查/替界面——保持官方搜索语义（增量搜索、正则、大小写、全词），新增命中位置计数 `X/Y`、全选匹配（`selectMatches`）、替换下一个（`replaceNext`）/替换全部（`replaceAll`）；`src/editor.js` 第 384 行 `search()` 改为 `search({ createPanel: makeSearchPanel })`，`src/editor.css` 新增 `.md-search-panel` 系列样式（复用明暗主题变量）。
- **粘贴为 Markdown（A-4）**：改造 `src/editor.js` 的 `initPasteImageSupport`，采用三分支逻辑——① 图片优先（保留原有截图粘贴并写入 `images/` 或内嵌 data URL）；② 富文本 HTML→Markdown（复用 `src/html-to-markdown.js` 的 `htmlToMarkdown` + `FORMATTING_SELECTOR` 启发式判定，仅当转换结果确实比纯文本多了结构化内容时才拦截，避免破坏纯文本粘贴手感）；③ 其余（纯文本等）放行默认粘贴。
- **自动保存与历史快照环（A-5）**：新增 `src/autosave.js`——编辑停顿（防抖 800ms）将草稿写入 `chrome.storage.local`（`draft::<文件键>`），绝不触碰磁盘 `.md`（真实文件仅在用户 `Ctrl+S` 时写入，规避自动保存覆盖废稿风险）；每 2 分钟或累计 50 次改动压入一份快照，快照环（`snapshots::<文件键>`）最多保留 30 份（`unshift` 头部 + 截断尾部，最新在前）；启动发现比当前文档更新的草稿时弹窗提示恢复（不静默覆盖磁盘）；工具栏新增「快照」按钮（`btnSnapshots`）打开历史版本对话框（`#snapshotsDialog`），可查看并一键回滚任一历史快照（仅还原编辑区，不写磁盘）。`src/editor.js` 在 `docChanged` 触发 `scheduleAutosave()` 并注入 `initAutosave`/`offerDraftRestore`；`src/editor.html` 新增按钮与对话框，`src/editor.css` 新增 `.snapshots-*` 样式（复用明暗主题变量）；新增 `tests/autosave.test.js`（草稿读回、快照环截断到 30、还原编辑区）。

### Changed
- `package.json` / `package-lock.json`：将 `@tauri-apps/api` / `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-fs` 由 `^2` 精确化为 `^2.11.1` / `^2.7.2` / `^2.5.1`，与桌面版 `main` 既有 Tauri 依赖状态对齐（浏览器侧动态 `import()` 仍受 `__TAURI_INTERNALS__` 守卫，不受影响）。

### Fixed
- **A-5 自动保存键串档（Bug #1，高）**：`initAutosave` 的 `getFileId` 原仅取 `currentFileHandle?.name || 'unsaved'`；而通过 `file://` 打开的 `.md` 文件（内容脚本重定向的主入口）`currentFileHandle` 恒为 `null`，导致所有 `file://` 文件共用 `'unsaved'` 键，不同文件的草稿（`draft::`）与历史快照（`snapshots::`）互相覆盖、互相串档，且启动恢复草稿弹窗会对新打开的文件误报。修复：新增纯函数 `resolveFileKey(handleName, fileName)`（已加回归测试），优先句柄名、回退「已加载文件名」（`updateFilename` 现同步记录 `currentFileName`）、最后 `'unsaved'`；`getFileId` 改用 `resolveFileKey(currentFileHandle?.name, currentFileName)`。
- **方案 A 实时命中计数不刷新（Bug #2，中）**：自绘查/替面板的 `update()` 仅在 `docChanged || selectionSet` 时调用 `renderCount()`，而提交查询（`setSearchQuery`）既不改文档也不改选区，导致用户输入查找词后 `X/Y` 计数长期为空/陈旧，破坏「实时命中计数」功能。修复：`update()` 在检测到 `setSearchQuery` 副作用后立即补调 `renderCount()`。

### Notes
- 功能开发与验证沿用双端兼容临时探针（浏览器侧写 `chrome.storage.local`、EXE 侧写 `probe-<scope>.log`，均追加不覆盖）；每完成一项功能即部署探针、验证、彻底全量回收，本提交**不含任何探针残留**（`node --test` 全量 124 项通过，`vite build` 成功重新生成无探针 `dist/`）。
- `src/editor.js` 同步清理了 `updateListener` 内 Task 1 遗留的空注释诊断死代码（`matched`/`inserted`/`occ` 计算后未使用、整段 `try/catch` 包裹），并移除因此死代码衍生的孤立回归测试 C3（`tests/init-regression.test.js`），代码恢复干净。
- 严格遵循最高优先级约定：**样式工具栏功能（`applyFontStyle` 等）完全保留、未被触碰**。
- 分支：`feat/plan-a-a4`（基于 `main` @ `v1.4.14-desktop`，即 `6404b6a`）。

## [1.4.15] - 2026-08-02 (重新发布：修复编辑器版本戳错报 + Vite 注入根治)

### Fixed
- **编辑器版本戳错报（高）**：`src/editor.html` 第 37 行静态兜底值、`src/editor.js` 的 `APP_VERSION` 原硬编码为 `1.4.8`，导致 v1.4.15 发布后编辑器标题栏/关于信息仍显示 `v1.4.8`，与真实版本（`package.json` / `manifest.json` 的 `1.4.15`）严重不符，误导用户对已装版本的判断。修复：三文件协同根治——① `vite.config.js` 新增 `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`，构建时从 `package.json` 单一事实源注入；② `src/editor.js` 改为 `export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.4.15"`，读取注入值并保留运行时兜底；③ `src/editor.html` 静态兜底值由 `1.4.8` 更正为 `1.4.15`。版本戳自此由 `package.json` 单一事实源驱动，杜绝手动硬编码漂移。

### Changed
- `vite.config.js`：引入 `fs.readFileSync` + `import.meta.url` 读取 `package.json` 的 `version`，通过 Vite `define` 注入 `__APP_VERSION__` 编译期常量（构建产物中该常量被静态替换为字符串字面量，无需运行时读取 JSON）。

### Notes
- 本次为 v1.4.15 的**补发/重新发布**（同一版本号，仅修复版本戳一致性缺陷），不改动任何功能行为。
- 发布一致性闭环：提交 `b69e2ab` → 推送 `main` → 移动 tag `v1.4.15`（删远端标签 + 重推，合规非强推）→ 重建 `dist/` → 重建 GitHub Release（保留旧桌面 EXE 备份）。产物经核对与源码一致。
- 关联提交：`b69e2ab` fix: 注入 __APP_VERSION__ 修复版本号错报(1.4.8→1.4.15)。
- 回归验证：浏览器侧多场景 + 多边界测试 23/23 用例通过。

## [1.4.12] - 2026-08-01 (第一批 A 级可吸纳功能：大纲/代码补全/Callout/专注模式/Base64折叠/Mermaid缩放/任务面板)

### Added
- **文档大纲面板（A-3）**：新增 `src/outline.js`，基于 CodeMirror 6 `syntaxTree` 遍历 ATX 标题节点生成层级大纲；工具栏新增「大纲」按钮（`btnOutline`）打开侧边抽屉（`#outlinePanel` / `#outlineList`），点击条目滚动跳转至对应标题。
- **代码块语言自动补全（A-6）**：新增 `src/codeblock-complete.js`，在 Markdown 代码围栏起始行注入 CodeMirror 补全源，输入 ```` ``` ```` 后提示常用语言（js/ts/py/json/rust/html/css/sql/bash 等），降低代码块语言标注成本；含临时探针 A6_COMPLETE_TRIGGER / A6_COMPLETE_NO_MATCH / A6_COMPLETE_ERR。
- **Callout 标注渲染（A-7）**：新增 `src/callout.js` 作为 markdown-it 插件（`calloutPlugin`），识别 `> [!NOTE]` / `[!TIP]` / `[!WARNING]` 等 GitHub 风格标注语法，转译为带类型配色与图标的 `.callout` 块；`src/html-to-markdown.js` 反向还原时保留 `[!TYPE]` 语法，避免预览回写退化。
- **专注模式 / 打字机模式（A-8）**：新增 `src/focus-mode.js`，提供两种沉浸式编辑体验——专注模式淡出非活动行（`.focus-mode .cm-line`）、打字机模式使当前行垂直居中；工具栏新增「专注」（`btnFocusMode`）、「打字机」（`btnTypewriter`）按钮及状态同步。
- **Base64 内联图片代码折叠（A-9）**：新增 `src/base64-fold.js`，对源码中超长 `![...](data:image/...;base64,...)` 行以 `⛶` 代码折叠装饰隐藏，避免长 base64 撑爆编辑器视图，点击展开/收起。
- **Mermaid 图缩放与全屏（A-10）**：新增 `src/mermaid-zoom.js`，为每个渲染后的 Mermaid 图注入「⛶」按钮，支持 Ctrl/Cmd+滚轮以光标为锚点缩放、重置视图、点击打开全屏浮层（`#mermaid-zoom-overlay`）细看复杂图。
- **任务列表面板（A-12）**：新增 `src/tasklist-panel.js`，扫描源码中 `- [ ]` / `- [x]` 任务项，工具栏「任务」按钮（`btnTasks`）打开侧边抽屉（`#taskListPanel` / `#taskList`），点击复选框直接回写源码切换完成状态。

### Changed
- `src/editor.js`：集成上述 7 模块——导入区补充新模块与 `registerProbeEnvProvider`；Markdown 配置注入代码块语言补全源；扩展数组加入 Base64 折叠；`updateListener` 的 `docChanged` 触发大纲/任务面板防抖刷新（150ms）、`selectionSet` 触发专注模式当前行居中；注册 `calloutPlugin`；预览更新在 Mermaid 渲染后注入缩放增强；`createEditor` 绑定大纲/任务编辑器实例与初始渲染；`init` 注册探针环境快照与显示设置初始化；`bindEvents` 接入专注/打字机/大纲/任务/显示设置（编辑器字号、预览字号、密度）按钮与弹层。
- `src/editor.html`：工具栏新增 `view-tools-group`（专注/打字机/大纲/任务/显示设置按钮 + `#displaySettingsPopover` 弹层），`</main>` 后新增 `#outlinePanel` / `#taskListPanel` 侧边抽屉。
- `src/editor.css`：新增 CSS 变量（`--editor-font-size` / `--preview-font-size` / `--ui-gap`）、专注模式淡化、Base64 折叠、Callout 配色与图标、侧边面板/大纲/任务项、Mermaid 缩放按钮与全屏浮层样式。
- `desktop/src/lib.rs`：新增 `probe_log` Tauri 命令，将探针日志写入 `%TEMP%/md-editor-probe.log`（供 EXE 侧落盘）。

### Fixed
- **预览区编辑三类回写缺陷（BUG-1/2/3）修复**（同源 `src/`，Chrome 扩展与 Tauri EXE 共用）：
  - **BUG-1（多余空行）**：源码为一行一段（段间无空行）时，预览区任一段尾敲回车后，编辑区与预览区不再每段间被插入一空行；多段无空行比对回归通过。`src/html-to-markdown.js` 新增 `collapseSoftBreaks` 折叠连续空行。
  - **BUG-2（跳转文件头）**：预览区任一位置修改字符串后，编辑区与预览区不再自动跳转到文件头部。`src/editor.js` 的 `doUpdatePreview` 与 `setEditorContent` 在预览重建 / 编辑器全量替换后改用 `src/scroll-restore.js` 的 `restoreScroll` 显式恢复重建前滚动位置（含 `requestAnimationFrame` 兜底）；滚动恢复纯逻辑已抽取为可单测模块。
  - **BUG-3（引用空段不同步）**：多段 `>` 引用场景下，预览区删除空段 `>` 时，编辑区现已跟随删除。`src/html-to-markdown.js` 的 blockquote 分支改为按块逐行还原，空块跳过、多段引用不再被折叠合并。
- **配套自动化测试**：新增 `tests/html-to-markdown-bug1-3.test.js`（BUG-1/3 共 8 项，用 markdown-it + linkedom 复现回写机制）与 `tests/scroll-restore.test.js`（BUG-2 滚动恢复 5 项）；`node --test` 全量 110 项通过。

### Notes
- **临时调试探针（覆盖 7 模块 A-3/A-6/A-7/A-8/A-9/A-10/A-12）**：在 `src/probe.js`（增强版）基础上为本次 7 个功能部署遍布式临时探针，满足：① 经 `// ===== PROBE START/END =====` 标记可彻底回收；② 自动捕获 `window.error` / `unhandledrejection` 并采集环境快照（版本/主题/视图模式/是否 Tauri/文档长度/行数/选区/预览滚动/UA）；③ 经「导出探针日志」按钮或 Tauri `probe_log` 命令独立写出 `.log` 文件，内容足以支撑 BUG 定位、分析排查与修复。该探针为临时调试代码，**验证稳定后将随 `src/probe.js` 及 editor.js / html-to-markdown.js / editor.html 中的探针调用整体删除，不计入正式发布**。
- 严格遵循最高优先级约定：**样式工具栏功能（`applyFontStyle` 等）完全保留、未被触碰**。
- 分支：`feat/batch-a-features`（基于 `feat/editor-find-replace-bracket` 尖端 @ `33991ce`，即 `main` @ `5f06e90` 的下游）。

## [1.4.14] - 2026-08-01 (彻底回收临时调试探针，发布干净稳定版)

### Removed
- **完整彻底回收全部临时调试探针**：删除 `src/probe.js` 核心探针模块；移除 `src/editor.js`、`src/editor.html`、`src/html-to-markdown.js`、`src/outline.js`、`src/tasklist-panel.js`、`src/mermaid-zoom.js`、`src/focus-mode.js`、`src/codeblock-complete.js`、`src/callout.js`、`src/base64-fold.js` 中全部 `// ===== PROBE START/END =====` 标记块、裸 `probe()` 调用、`registerProbeEnvProvider` 调用与 `import { ... } from './probe.js'` 引用；移除 `src/editor.html` 的「导出探针日志」按钮及导出脚本；移除 `desktop/src/lib.rs` 的孤儿 `probe_log` Tauri 命令及其注册。代码恢复干净，无任何探针残留（`node --test` 全量 125 项通过，`vite build` 成功重新生成无探针 `dist/`）。

### Notes
- 本次为将 `feat/batch-a-features` 合并入 `main` 前的清理发布。探针系统原为 A 级功能开发与 BUG 定位（BUG-1/2/3/4）的临时调试设施，定位修复后按计划整体回收，不计入正式发布。
- 严格遵循最高优先级约定：**样式工具栏功能（`applyFontStyle` 等）完全保留、未被触碰**。

## [1.4.13] - 2026-08-02 (第二轮修复：预览区体验对齐 + 符号配对 + UI 溢出)

### Fixed
- **中文单/双引号错配对（BUG-4）**：CodeMirror 6 的 `closeBrackets` 把 `brackets` 视为「连续成对字符串」，原配置是普通数组且按相邻两位强行配对，导致 `(` 闭合到 `[`、`“` 闭合到 `` ` ``、`‘` 闭合到 `（` 等完全错乱——表现为输入 `“` 出现 `“`+`` ` `` 而非 `“”`、重复输入出三个字符。改为唯一事实源 `src/close-brackets-config.js` 的 `BRACKET_PAIRS`（开闭显式成对）派生成 `BRACKETS_STR`，由 `editor.js` 仅消费：`()[]{}<> '' "" \`\` “” ‘’ （）`，ASCII 自配对引号以「同字符连续两次」表达。
- **「导出探针日志」按钮无文件落地（BUG-1）**：EXE 端旧实现走 `probe_log` 直接写 `%TEMP%/md-editor-probe.log`，但按钮提示说「下载文件」让用户在下载文件夹找不到文件、误以为未导出。改为「Save 对话框 + write_text_file」流程：用户在系统保存对话框自选位置，回调中把实际保存路径附在成功提示里。`src/probe.js` 在 Tauri 路径走 `import('@tauri-apps/plugin-dialog').save()` + `invoke('write_text_file', { path, content })`，失败回退到扩展端的 Blob 下载。`src/editor.html` 按钮处理改为 `async`，正确展示「已保存到 X / 用户取消 / 失败原因」。
- **显示设置弹窗溢出屏幕（BUG-2）**：`.style-popover` 旧用 `left:0` 锚定到按钮左侧，「显示设置」按钮位于工具栏最右侧时弹窗向左溢出屏幕（截图见 `ScreenShot_2026-08-02_075128_975.jpg`）。CSS 改为 `right:0` 锚到按钮右侧，并加 `max-width: min(280px, calc(100vw - 24px))` 限制最大宽度，同时覆盖颜色/字号/显示设置三个弹层。

### Added
- **预览区符号自动配对（BUG-3）**：编辑器侧有 CodeMirror `closeBrackets`，预览侧（contentEditable HTML）原无此能力，两侧输入体验不一致。新增 `src/auto-pair.js` 提供 `getAutoPairClose(insertedChar, nextChar)` 纯逻辑——输入开符号时返回对应闭符号、nextChar 是字母/数字则跳过（避免中间输入 `foo|` 变 `foo()|`）、nextChar 已是闭符号则跳过（避免重复插入）。`initPreviewEditing` 在 `input` 事件中调用该函数，在光标位置插入闭符号并把光标移回中间。覆盖 ASCII `()[]{}<>` 与中文 `“”‘’（）`。
- **配套自动化测试**：新增 `tests/auto-pair.test.js`（7 项，验证各开符号 + 边界场景）与 `tests/close-brackets-config.test.js`（7 项，验证 BRACKETS_STR 满足 CM6 相邻成对解析约束且旧 BUG-4 错配对不再出现）；`node --test` 全量 125 项通过。

### Notes
- 严格遵循最高优先级约定：**样式工具栏功能（`applyFontStyle` 等）完全保留、未被触碰**。
- BUG-1 修复仍依赖 `tauri_plugin_dialog::init()`（`desktop/src/lib.rs:92` 已注册）与 capability `dialog:allow-save`、`fs:allow-write-text-file`（`desktop/capabilities/default.json` 已含）。`write_text_file` 为项目自定义 Tauri 命令（`desktop/src/lib.rs:66`），未走 `fs:` 权限范围。

## [1.4.11] - 2026-08-01 (测试与调试探针)

### Added
- **单元测试覆盖符号配对纯逻辑**：将 `findPairedBracket` / `findSelfPair` / `bracketMatchMap` 等符号配对纯逻辑抽取至 `src/bracket-utils.js`（行为不变），新增 `tests/bracket-utils.test.js` 覆盖 M1 map 构建、`findPairedBracket` 栈匹配、`findSelfPair` 就近匹配，共 14 项用例全部通过（`node --test`），解耦 CodeMirror 依赖以便纯逻辑验证。

### Fixed
- **`selectedBracketHighlight()` 误调用导致初始化崩溃（critical，预先存在，与探针无关）**：`src/editor.js` 扩展数组中错误地以 `selectedBracketHighlight()`（带括号）方式引用 `ViewPlugin.fromClass(...)` 的返回值。`ViewPlugin.fromClass()` 返回的是扩展实例本身（不可被 `()` 调用），调用它触发 `TypeError: Xet is not a function`，使 `new EditorView(...)` 构造期即崩溃、`init()` 中断。该 bug 自 v1.4.9 引入（`selectedBracketHighlight` 插件加入时即误用），与本次部署的探针毫无关系——即便移除全部探针，应用仍会因该误调用而无法启动。修复：改为 `selectedBracketHighlight`（去掉括号，直接作为扩展使用）。
- **`languageData.of` 配置格式错误导致初始化崩溃（critical，v1.4.10 引入，与探针无关）**：v1.4.10 为修复中文符号自动配对，写入 `EditorState.languageData.of({ closeBrackets: { brackets: [...] } })`，但该格式错误——`languageData` facet 的每个 provider **必须是返回可迭代对象（数组）的函数**（`languageDataAt` 内部对 `provider(state,pos,side)` 的返回值做 `for...of`）。传入普通对象会使 CM 在读取 `closeBrackets` 配置时（`closeBrackets()` 调用 `state.languageDataAt("closeBrackets", pos)`）抛 `TypeError: s is not a function or its return value is not iterable`，同样在 `new EditorView` 构造/首更新期崩溃。该 bug 亦与探针无关。修复：`EditorState.languageData.of((state, pos) => [{ closeBrackets: { brackets: [...] } }])`。
- **探针引发的初始化崩溃（critical，探针代码副作用）**：`src/editor.js` 的 `createEditor` 内 `updateListener` 探针代码中错误地使用**全局变量 `editor`** 读取 `editor.scrollDOM`，而 `editor` 在 `new EditorView(...)` 构造完成后才赋值；CodeMirror 在构造期会**同步触发首次 update**，此时全局 `editor` 仍为 `null`，导致 `editor.scrollDOM` 抛 `TypeError`。修复：探针改用回调参数 `update.view.scrollDOM`；并为整个探针区块包裹 `try/catch`，确保今后探针异常不再中断编辑器初始化。
- **预览 DOM-XSS 风险（medium，预先存在，审计 M1）**：`markdown-it` 以 `html:true` 渲染用户 `.md` 内容后直接 `previewContainer.innerHTML = html`，攻击者可构造含 `<script>`、`onerror=` 等恶意标记的文档触发 DOM-XSS（在 Chrome 扩展 / EXE 中可窃取页面上下文或发起本地文件越权读取）。修复：保留 `html:true`（以维持样式工具栏写入的 `<font>`/`<center>` 标记正常渲染），新增 `sanitizePreviewHtml()` 经 `DOMPurify` 净化后再注入 DOM，并显式放行应用依赖的 `font`/`center` 标记与 `color`/`face`/`size`/`align` 属性；`class`/`id`/`style`/`data-*` 由 DOMPurify 默认策略保留并净化。新增运行时依赖 `dompurify`。

> **根因结论（回应「是否由探针引发」）**：本次构建产物的严重 BUG **并非探针导致**。真正的根因是两个预先存在的 CodeMirror API 误用——`selectedBracketHighlight()` 误调用（v1.4.9）与 `languageData.of` 格式错误（v1.4.10），二者都会在 `new EditorView` 构造期独立致崩，使编辑器实例从未创建，表现为「按键全失效 / 双击 .md 无内容 / 主题切换失效 / 探针无 log」。探针代码仅在 `updateListener` 中额外引入了一处同类崩溃（`editor.scrollDOM`），已一并修复。三者任一存在都会让应用完全不可用；移除探针也无法让应用恢复，必须先修上述两个 API 误用。

### Notes
- **临时调试探针（S1~S4）**：为「查找 / 替换 / 符号配对 / 相同字符串高亮」四个功能在 `src/probe.js` 基础上部署 7 个运行时针点（S1-A/B 查找、S2-A 替换、S3-A/B/C 符号配对、S4-A 相同字符串高亮），经浏览器/EXE 侧复现后由「导出探针日志」按钮下载 `.log` 分析。该探针为临时调试代码，**修复相关 BUG 后将随 `src/probe.js` 及 editor.js / html-to-markdown.js / editor.html 中的探针调用整体删除，不计入正式发布**。
- 样式工具栏最高优先级约定未被触碰。
- 分支：`feat/editor-find-replace-bracket`。

## [1.4.10] - 2026-07-31 (缺陷修复)

### Fixed

- **H1 中文符号自动配对配置无效（核心缺陷）**：v1.4.9 的 `closeBrackets({ brackets })` 传入的配置被忽略（`closeBrackets` 为无参函数，配置经 `EditorState.languageDataAt('closeBrackets')` 读取）。改为通过 `EditorState.languageData.of({ closeBrackets: { brackets: [...] } })` 提供配置，中文引号/全角括号依赖 `closing()` 的「非 ASCII 字符 ch+1」回退（Unicode 连续码点）正确推导闭符号，英文 `()[]{}'"` 与中文符号、反引号均生效。
- **M1 `bracketMatchMap` 构建缺陷**：原 `SELECTED_BRACKET_PAIRS` 奇数长字符串导致末尾反引号 `other=undefined` 且污染 `undefined` 键；英文引号同字符覆盖使 `dir` 仅剩 -1。改为 `PAIR_GROUPS`（开闭不同、中文按左右字符分组）+ `SELF_PAIRS`（英文引号/反引号自身配对，就近匹配），消除污染。
- **反引号选中高亮补全**：将反引号纳入 `SELF_PAIRS`，支持选中单个反引号高亮其就近配对的另一个反引号，满足原始需求。
- **L1 性能优化**：`selectedBracketHighlight` 缓存 `doc.toString()` 结果（`cachedDoc`），`docChanged` 时失效，避免每次光标移动全量重建 O(n)。

### Notes

- 复审报告：`.workbuddy/review-combo-2026-07-31-reaudit-fixed.md`（H1/M1/L1 已修复验证）。
- 样式工具栏最高优先级约定未被触碰。

## [1.4.9] - 2026-07-31

### Added

- **查找 / 替换面板**：显式注册 `@codemirror/search` 的 `search()` 扩展；工具栏新增「查找」按钮（`btnFind`），点击打开 CodeMirror 原生查找/替换面板（查找输入框、上一个/下一个、区分大小写、正则、整词匹配，覆盖 Notepad4 截图全部查找选项）。
- **中文与全角符号自动配对（配置在 v1.4.9 实际无效，已于 v1.4.10 修正）**：原方案通过 `closeBrackets({ brackets })` 传入配置，但 `closeBrackets` 为无参函数、配置经 `languageDataAt` 读取，该调用被忽略，中文符号自动配对在 v1.4.9 并未实际生效（仅英文 `()[]{}'"` 为 CodeMirror 默认配对）。正确实现见 v1.4.10。
- **选中符号高亮配对另一半**：新增 `selectedBracketHighlight` 自定义 `ViewPlugin`（`@codemirror/view` 的 `ViewPlugin.fromClass` + `Decoration.mark`）。当选区恰好落在单个配对符号（含中英文引号/括号/花括号/反引号）上时，自动高亮其对应的另一半，样式为 `.cm-bracket-match-active`（绿色下划 + 半透明背景）。

### Changed

- `src/editor.js` 导入补充 `ViewPlugin`、`Decoration`（来自 `@codemirror/view`）与 `search`、`openSearchPanel`（来自 `@codemirror/search`）；同字符串高亮由内置 `highlightSelectionMatches()` 提供，本次未改动其实现。

### Notes

- 严格遵循最高优先级约定：**样式工具栏功能（`applyFontStyle` 等）完全保留、未被触碰**。
- 分支：`feat/editor-find-replace-bracket`（基于 `main` @ `5f06e90`）。

## [1.4.8] - 2026-07-26 (修复发布，已移除全部探针)

### Fixed

- **双击 .md 无法打开（根因修复）**：`src/desktop-shims.js` 的 FS 垫片守卫原本是
  `if (isTauri && typeof window.showOpenFilePicker === "undefined")`。但 Tauri v2 的
  WebView2 里 `window.showOpenFilePicker` 是**原生函数**（即便在沙箱中不可用），
  导致守卫为 false、整个 FS 垫片（含关键的 `window.__tauriFileHandle` 工厂）从未
  安装，于是 `openFileByPath` 命中 `factory=undefined` 静默 return —— 这正是
  「双击只显示初始界面、无任何提示」的真实根因（v1.4.7 的探针日志已确证：
  `shim:done :: __tauriFileHandle=undefined enteredFsShim=false`）。
  现改为 `if (isTauri)`：在 Tauri 下**无条件**安装 FS 垫片。
- **拖入 .md 无法打开（根因修复）**：原实现用 `listen('tauri://drop')` 监听
  Tauri 原生拖放；该事件在 WebView2 下不可靠、实测从不触发。改为使用稳定的
  `getCurrentWebview().onDragDropEvent()`（Tauri v2 推荐 API），在 `drop` 类型事件
  里取 `payload.paths` 并打开首个 `.md/.markdown/.txt`。
- **移除全部诊断探针**：按约定，BUG 修复后删除 `src/probe.js`、Rust 命令
  `probe_log` 及其注册、以及 `src/editor.js` / `src/desktop-shims.js` 内所有
  `// ===== PROBE START/END =====` 标记块。代码恢复干净。
- **防御性提示**：`openFileByPath` 在 `window.__tauriFileHandle` 仍非函数时改为
  弹出可见错误 toast（不再静默 return），便于日后排查。
- 四个版本字段统一升到 1.4.8；`src/editor.js` 内 `APP_VERSION` 同步到 1.4.8。

### 对 Chrome 扩展的影响

- 零功能影响：`desktop-shims.js` 在扩展环境 `isTauri=false` 仍整体跳过；`__tauriFileHandle`
  仅在 Tauri 下定义；`onDragDropEvent` 仅在 `__TAURI_INTERNALS__` 存在时注册。

## [1.4.7] - 2026-07-26 (诊断构建，含探针，已被 1.4.8 取代)

### Added (诊断用，已在 1.4.8 删除)

- **EXE 运行期诊断探针**：为定位「双击 .md 打不开」「拖入 .md 打不开」根因，临时新增一套全程监测探针（见 `src/probe.js`、`probe_log` 命令、各 `PROBE` 块）。**本版本仅为采集日志，请勿长期使用；所有探针已在 1.4.8 彻底删除。**

### Fixed

- **版本号一致性修复（元数据，不影响功能）**：v1.4.5 把 `package.json` / `desktop/package.json` 升到 1.4.5，但漏改 `public/manifest.json`（扩展 manifest 模板）与 `desktop/tauri.conf.json`（EXE 资源版本），导致扩展 zip 内 manifest 版本停在 1.4.4、EXE 文件属性版本停在 1.4.4。现四个 version 字段统一为 1.4.6/1.4.7。
- 本次修改（`src/editor.js` 顶部 `import './desktop-shims.js'` + 移除 `src/editor.html` 外置 `<script>`）**对 Chrome 扩展零功能影响**：`desktop-shims.js` 在扩展环境里 `window.chrome` 存在（跳过 chrome 垫片）、`isTauri` 为 false（跳过 FS Access 垫片），整模块零副作用；扩展的 `window.showOpenFilePicker` 仍是原生实现。

## [1.4.6] - 2026-07-26 (版本元数据一致性修复)

### Fixed

- **版本号一致性（元数据，不影响功能）**：v1.4.5 把 `package.json` / `desktop/package.json` 升到 1.4.5，但漏改 `public/manifest.json`（扩展 manifest 模板）与 `desktop/tauri.conf.json`（EXE 资源版本），导致扩展 zip 内 manifest 版本停在 1.4.4、EXE 文件属性版本停在 1.4.4。本次把四个 version 字段统一升到 1.4.6。

## [1.4.5] - 2026-07-26

### Fixed

- **根因修复：把 `desktop-shims.js` 真正打进 vite bundle**。上一版修了 `withGlobalTauri` 之后 EXE 仍只显示初始界面、且无任何 toast。定位发现：`src/editor.html` 里 `<script type="module" src="./desktop-shims.js">` 在 vite 构建时被**静默删除**（HTML 中未列入 rollup entry 的外部脚本会被丢弃），导致 `dist/assets/editor.js` 里**完全没有 TFileHandle / showOpenFilePicker 垫片**；`openFileByPath` 内 `window.__tauriFileHandle` 始终为 `undefined`，命中 `if (typeof factory !== 'function') return;` 静默退出 → 双击打开路径整条全静默失败。修复：
  - `src/editor.js` 顶部 `import './desktop-shims.js';`（vite 会把它视为编辑器依赖打包进 bundle）
  - `src/editor.html` 同步移除外置 `<script>` 标签，避免重复执行
  - `src/desktop-shims.js` 自身未改

## [1.4.4] - 2026-07-25

### Added

- 样式工具栏 v1.4.4：重选替换 / 智能取消 / 记忆上次选择（领先代码 c39e3be）
- **桌面端独立 EXE 支持（Tauri）**：
  - 新增 `desktop/` 桌面壳，用 Rust + Tauri 把同一套 Web 源码（`src/`）打包为独立 Windows EXE（nsis `setup.exe` + `.msi`）
  - 新增 `src/desktop-shims.js`：桌面端提供 `chrome` 垫片（会话恢复 / 翻译设置持久化）+ File System Access API polyfill（映射原生文件对话框）；在 Chrome 扩展内自动跳过，对扩展零影响
  - Tauri 窗口入口直接指向 `src/editor.html`（此前经 `src/index.html` 重定向，现已改为直连）
  - `vite.config.js` 增加 index 构建入口；根 `package.json` 增加依赖 `@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-fs`
  - 桌面端支持「双击 .md 文件用 EXE 打开」：把 .md 设为默认程序后，双击文件会以 `EXE "路径.md"` 启动；桌面壳读取该命令行参数，前端初始化时通过 `invoke('get_initial_file')` 取路径并打开，文件读写由 Rust 命令（`read_text_file`/`write_text_file`，`std::fs`，无作用域限制）完成，保存可写回原文件；采用多实例，每次双击启动独立 EXE 实例打开各自文件
- 远端编译：`desktop-build.yml` 在 GitHub `windows-latest` 用 Rust + Tauri 构建 EXE

### Changed

- 将桌面壳合并进 `main`，与领先代码 v1.4.4 同仓同 CI

### CI / 自动化

- 打 `v*` 标签（如 `v1.4.5`、`v1.5.0`）会**同时触发** `ci.yml`（扩展 zip）与 `desktop-build.yml`（EXE），一次打标签自动同时产出扩展和 EXE；构建 100% 在 GitHub 云端，**本地零安装**
- `v1.4.4` 的 EXE 交付物见 Release `v1.4.4-desktop`

### Notes

- EXE 体积约 2.5–3 MB，依赖系统 WebView2 运行时（未打包运行时）
- 未签名版本首次运行会被 Windows SmartScreen 拦截，需手动允许
- 已清理无用分支 `feat/tauri-desktop`（已合入 main）

### Fixed

- **修复双击 .md 用 EXE 打开无效**：原实现依赖前端→Rust 的 `frontend-ready` 事件握手 + Rust→前端的 `open-file` 事件转发，事件未能稳定触发，导致 EXE 只显示初始界面、不打开文件。
  - 改为命令式：前端初始化时直接 `invoke('get_initial_file')` 取启动命令行里的 .md 路径，再用 `openFileByPath` 打开；时序更简单稳定。
  - 文件读写从「Tauri fs 插件（受作用域限制）」改为 **Rust 命令 `read_text_file` / `write_text_file`（`std::fs`，无作用域限制）**，彻底绕开 fs 插件对绝对路径的限制，保存可写回原文件。
  - **移除单实例插件**，改为多实例：每次双击 .md 启动独立 EXE 实例并打开对应文件，避免“已运行时再双击被转发/被拦”的复杂性。
- **双击打开诊断与加固（排查中）**：`openInitialCliFile` 现在把 `invoke` 异常与「未检测到参数时的原始 argv」用 toast 显示出来，便于定位「Windows 文件关联到底有没有把路径传给 EXE」；Rust 侧 `normalize_arg` 兼容外层引号与 `file://` 形式，`get_initial_file` 在解析前先归一化。
- **根因修复：开启 `app.withGlobalTauri`**：`tauri.conf.json` 此前未设置 `withGlobalTauri`，Tauri 不会把 `window.__TAURI_INTERNALS__` 注入 webview。而桌面端全部守卫（`desktop-shims.js` 的 `isTauri` 判定、`editor.js` 的 `openInitialCliFile` 守卫）以及 `@tauri-apps/api` 的 `invoke` 都依赖该全局 → 整个桌面代码路径被静默短路（双击 .md 只显示初始界面、**且连诊断 toast 都不弹**）。现已开启 `withGlobalTauri: true`，并把窗口入口从 `src/index.html`（重定向）直接指向 `src/editor.html`，消除 `location.replace` 跨文档导航可能带来的全局丢失风险。

## [1.4.3] - 2026-07

### Fixed

- 修复打印多页只输出可视区一屏的 BUG（commit 2d9e5b9）

## [1.4.2] - 2026-07-14

### Added

- Reading-time bilingual translation in the preview pane (does not modify Markdown source)
- Toolbar toggle + settings: pick a service preset, paste API Key only
- Default preset: MiniMax Token Plan · Anthropic (`sk-cp-` key, `/anthropic/v1/messages`)
- Dual protocol for MiniMax / StepFun Token Plans (Anthropic Messages + OpenAI-compatible)
- Built-in presets: OpenAI / DeepSeek / Gemini / Groq / Mistral, Kimi / Qwen / 智谱 / 豆包, MiniMax · StepFun, OpenRouter · 硅基流动 · AiHubMix · 302.AI · API2D · CloseAI · Together · Fireworks · OneAPI, DeepL Free/Pro, custom endpoints
- Preset base URLs and model IDs verified via Context7 against official docs (2026-07-13)
- Background service-worker proxy for translation fetch (avoids CORS on `x-api-key` / Anthropic headers)
- Per-segment translation cache and progress status
- Visible build stamp (`v1.4.2`) in the toolbar and page title

### Fixed

- Do not call `chrome.permissions.request` on the translate path (false "未授权" after async gaps)
- MiniMax Anthropic Token Plan calls go through the SW proxy with correct headers

### Notes

- Translation sends document text to the provider you configure; keep that in mind for private docs
- After upgrade, reload the extension at `chrome://extensions` and close old editor tabs

## [1.3.1] - 2026-07-13

### Changed

- Removed the jarring HTML style-preset toolbar (居粗 / 居红 / 字号等); keep the editor chrome calm
- Startup + toolbar **?** open a real short user manual; example file is a full 说明书

### Kept

- Multi-instance tabs, session restore, local images, preview HTML round-trip for people who type tags in Markdown

## [1.3.0] - 2026-07-13

### Added

- Multi-instance editors: each toolbar click / each local `.md` open gets its own tab (`?i=` + per-instance storage keys) — thanks [@zhangweildlh](https://github.com/zhangweildlh) (PR #4 / Issue #3)
- Style toolbar: center/bold/color, highlight, font face/size presets; superscript and subscript
- Session restore: reopen the extension restores last edited content and filename (Issue #2; FileSystemHandle cannot persist, so Save may ask for a path again)
- Richer first-run help tips for common Markdown / HTML snippets

### Fixed

- Preview WYSIWYG round-trip: normalize extra blank lines and preserve `<mark>/<center>/<font>/<span>/<sup>/<sub>` when syncing back to source (helps Issue #1 path/style corruption)
- Local image preview and original `src` preservation remain in place from 1.2.0 (Issue #1)

### Changed

- Extension and package version aligned to **1.3.0**

## [1.2.0] - 2026-07-13

### Added

- Local image preview for relative paths when a folder or `file://` context is available
- Paste image into the editor: writes to sibling `images/` when folder write access exists, otherwise embeds a data URL
- First-run onboarding overlay (drag file / open folder / open example)
- Feedback entry in the status bar linking to GitHub Issues
- Reproducible icon pipeline (`npm run icons`) and Markdown-recognizable toolbar icons
- Unit tests for image path resolution and preview link safety (`npm test`)
- Pack script: `npm run pack` builds and produces `chrome-md-editor-v*.zip` with a nested `dist/` folder

### Fixed

- Preview-pane links open reliably while the preview stays contenteditable for WYSIWYG
- Preserve original Markdown image sources when syncing WYSIWYG preview back to source (avoids writing blob URLs into the document)
- Addresses user report of local images not rendering and path corruption after preview edit (see GitHub Issue #1; please re-test on 1.2.0 before closing)

### Changed

- README quick start and installation guidance oriented around GitHub Releases
- Aligned `package.json` version with `manifest.json` at **1.2.0**

### Notes

- GitHub previously only published **v1.0.0** while `main` already contained the above work. This release closes that distribution gap.
- There was no separate public **v1.1.0** tag. DEVLOG mentions 1.1.0 during content-script work; that stream is included here under 1.2.0.

## [1.0.0] - 2026-02-28

### Added

- Initial Chrome extension (Manifest V3) Markdown editor
- CodeMirror 6 source editing, markdown-it preview, Mermaid diagrams
- WYSIWYG editing in the preview pane
- File System Access open/save and project folder sidebar
- `file://` content script intercept for local `.md` files
- Light/dark themes and split / editor / preview layouts
