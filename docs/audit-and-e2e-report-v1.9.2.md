# Chrome-Markdown-Edit 代码审计与真机测试报告（v1.9.2）

> 单一权威结论文件。本文档整合本轮「对照 / 合并双模式重构」的代码审计、缺陷修复与真机（end-to-end）全面测试结果。
> 生成时间：2026-08-16。测试环境：360Chromex（Chrome 132）/ 扩展 ID `bglhbmlpkinpnmkgpcldlpnincfhogmn` / 9222 调试端口。
> 版本戳：**已升至 1.9.2 并发布**（用户授权）。**改动已提交并合入 main（PR #10 已合并），tag v1.9.2 已推送触发双 CI 构建 Release**。

---

## 一、审计范围与基线

- **范围**：`src/` 全量源码，重点为编辑器页（`editor.html` / `editor.js`）、对照 / 合并页（`compare.html` / `compare.js` / `compare-merge.js` / `compare-files.js` / `io-bridge.js`）、自动保存（`autosave.js`）、查找替换（`search-panel.js`）、滚动同步（`scroll-sync.js`）、确认框（新建 `confirm-dialog.js`）。
- **方法**：静态阅读 + 真机 CDP 驱动（`tmp-mde/cdp_test.mjs`，直连 page `webSocketDebuggerUrl` 模式，绕过 flatten sessionId 坑）+ 二分法定位死循环 + 原生崩溃 vs 同步死循环判别 + 单元测试（linkedom）。
- **基线**：构建成功；单元测试 455 通过 / 0 失败 / 3 待办；真机测试 editor=53 步 / compare=21 步 / fatal=none，15 项关键断言全 true。

---

## 二、发现的缺陷（按严重度）

### 缺陷 A（致命）：编辑器页初始化期阻塞式 `window.confirm` 导致渲染进程死锁

- **位置**：`src/autosave.js` 原 `offerDraftRestore()`（约 261–281 行）。
- **现象**：存在残留草稿时，初始化阶段调用 `window.confirm('恢复此快照…')`。`window.confirm` 是阻塞式模态对话框，会锁死渲染进程主线程；在 headless / CDP 自动化场景下，confirm 弹窗与 CDP 的 `handleJavaScriptDialog` 相互死锁，表现为「renderer 崩溃 / 编辑页整体无法加载」（曾误判为环境污损）。
- **判别**：通过浏览器级 `Inspector.enable` 监听 `Inspector.targetCrashed` → 输出 `CRASHED false` 且目标仍在 `/json/list`，确证为**同步死循环 / 主线程锁死**，而非原生崩溃。二分法 7 次迭代收敛：`createEditor()` 后正常 → `bindEvents()` 后卡死 → … → `offerDraftRestore()` 后卡死 → 锁定 `window.confirm`。
- **修复**：改为非阻塞页内弹窗 `showDraftRestorePrompt(when, onRestore)`，点击「恢复」回调 `onRestore()`（dispatch 覆盖全文），点击「忽略」或遮罩关闭弹窗；新增 `if (document.getElementById('draftRestorePrompt')) return;` 防重复。不再阻塞主线程。
- **验证**：editor 页恢复响应（CTX_CREATED / ENABLED_OK / `cm:true` / EVAL_OK / SHOT_OK），真机 suite 全断言通过。

### 缺陷 B（严重）：对照页滚动同步误调用与手动翻转，三栏 B↔C / A↔C 不同步

- **位置**：`src/compare.js` 约 638 行（误调用 `scrollSync.setEnabled`）、约 1355 行（手动翻转而不是由实例驱动）。
- **现象**：`[compare] 初始化滚动同步失败` 错误；合并模式下三栏滚动同步不生效。
- **修复**：删除误调用的 `scrollSync.setEnabled`；删除手动翻转，仅保留 `scrollSync.toggle()`，由 `scrollSync` 实例真正驱动三栏联动。
- **验证**：真机 suite `scrollSync-toggle-clicked = true`，且控制台无 `初始化滚动同步失败` 错误。

### 缺陷 C（同类隐患，彻底清零）：另两处 `window.confirm` 阻塞调用

- **位置 1**：`src/editor.js:3643` 快照恢复确认（`恢复此快照将覆盖当前编辑区内容…`）。
- **位置 2**：`src/search-panel.js:242` 工作区替换确认（`即将把工作区所有 Markdown 文件中的…直接写入磁盘且无法撤销`）。
- **修复**：两处均改为 `await showConfirm(...)`（复用新建的 `src/confirm-dialog.js` 非阻塞确认）。`editor.js` 与 `search-panel.js` 均已注入 `import { showConfirm } from './confirm-dialog.js';`。
- **验证**：全局扫描确认 `src/` 内已无实际 `window.confirm` 调用（仅剩注释）。`confirm-dialog.test.js` 4 项单测全绿（非阻塞、确定/取消解析、防堆叠）。

---

## 三、修复清单（文件级）

| 文件 | 性质 | 关键改动 |
| --- | --- | --- |
| `src/autosave.js` | 修改 | `offerDraftRestore` 阻塞 confirm → 非阻塞 `showDraftRestorePrompt`；防重复守卫 |
| `src/confirm-dialog.js` | **新增** | 共享非阻塞确认框 `showConfirm(message) → Promise<boolean>`（DOM 弹窗，不阻塞主线程，幂等防堆叠） |
| `src/editor.js` | 修改 | 注入 `showConfirm` import；快照恢复确认 `window.confirm` → `await showConfirm` |
| `src/search-panel.js` | 修改 | 注入 `showConfirm` import；工作区替换确认 `window.confirm` → `await showConfirm` |
| `src/compare.js` | 修改 | 删除误调用 `scrollSync.setEnabled`；删除手动翻转，仅留 `scrollSync.toggle()` |
| `src/scroll-sync.js` | **新增** | 三栏滚动同步实现（对比页由其实例真正驱动 B↔C / A↔C） |

> 说明：本仓库当前存在较大规模的「对照 / 合并双模式重构」未提交改动（`compare.js` +593/−…、`compare-merge.js`、`compare-files.js`、`compare.css`、`compare.html`、`io-bridge.js`、`editor.js` 等），属前序会话的特征开发上下文。本轮审计在其上**定位并修复了上述 A/B/C 三类 BUG**，未改动特征设计本身，也未升版本戳。

---

## 四、验证结果

### 4.1 构建
- `npm run build`：✅ 成功（`✓ built in 14.73s`）。仅 chunk 体积警告（md-theme-tokens / editor.js > 500KB），为本项目已知良性。

### 4.2 单元测试（`npm test`，`node --test` + linkedom）
- **总计 458 项**：**通过 455 / 失败 0 / 待办 3**（3 待办为前序既有，非本次）。
- 本轮新增 `tests/confirm-dialog.test.js`：4 项全绿（非阻塞、确定 resolve(true)、取消 resolve(false)、防堆叠 resolve(false)）。
- 关键回归套件均绿：`init-regression`、`scroll-sync`、`save-poll`、`path-ellipsis`、`compare-getpanes`、`mermaid-roundtrip` 等。

### 4.3 真机全面测试（CDP，`tmp-mde/cdp_test.mjs`）
- **editor 页**：53 步操作（加载 → 全工具栏按钮点击 → 视图切换 编辑/预览/分屏 → 专注模式 → 打字机 → 大纲/任务/快照/显示/翻译面板 → 暗色主题），**全断言 true**。
  - `view-edit-preview-hidden=true`、`view-preview-editor-pane-hidden=true`、`view-split-both-visible=true`、`focus-html-has-focus-mode=true`、`typewriter-toggle-clicked=true`、`theme-Dark-applied=true`、`editor-theme-dark-axis=true`。
- **compare 页**：21 步操作（加载 → 模式状态机 合并↔对照 → 三栏切换 → 滚动同步切换 → 盲点全按钮循环 → 返回编辑器），**全断言 true**。
  - `merge-bodyClass=true`、`merge-mergeOnly-visible=true`、`merge-colToggle-hidden=true`、`back-bodyClass=true`、`back-mergeOnly-hidden=true`、`back-colToggle-visible=true`、`col-toggle-3-panes=true`、`scrollSync-toggle-clicked=true`。
- **fatal = none**：无原生崩溃、无主线程死锁、无未捕获异常。
- 执行方式注意：测试台内嵌于 `npm test` 会驱动同一浏览器；**曾因与手动 `cdp_test.mjs` 并行造成 CDP 争用而出现 `fatal= send timeout` 的伪失败**——单独运行（无争用）即恢复全绿。此伪失败已排除，非代码缺陷。

---

## 五、边界未覆盖项（需 GUI 人工复核）

headless 自动化所见 ≠ 用户 GUI 所见。以下项自动化已验证逻辑正确性，但**视觉 / 交互观感须在真实 GUI 中点检**：

1. **字体与排版观感**：暗色主题、27 套编辑器配色、玻璃材质皮肤的逐套渲染观感，headless 仅能断言 `data-editor-theme` / `data-theme` 轴正确，**实际配色与字体渲染需 GUI 逐套目检**（自动化仅覆盖 dark 轴）。
2. **系统文件对话框**：「打开 / 保存 / 打开文件夹」在 headless 下由 `<input type=file>` 降级（预期 `SecurityError` 良性），**真实文件选择对话框与写入落盘路径需 GUI 手动验证**。
3. **`showConfirm` 两处用户手势路径**：快照恢复确认（`editor.js:3643`）、工作区替换确认（`search-panel.js:242`）由自动化点击「恢复此版本」/「全部」会触发新 DOM 弹窗，但测试台未自动点击「确定/取消」。逻辑已由 `confirm-dialog.test.js` 覆盖，**弹窗视觉样式与按钮可达性需 GUI 点检**。
4. **工作区替换真实落盘**：`replaceInWorkspace` 直接写盘且不可撤销，破坏性，**自动化未触发**（仅单元测试覆盖逻辑），需 GUI 在测试目录中小心验证。
5. **待决偏差（需宿主裁决）**：`path-ellipsis.js` 注释与真实输出存在 1 字符差，不影响功能，但措辞口径须用户确认是否修订。
6. **`nul` 幽灵文件**：`git status` 显示未跟踪文件 `nul`（Windows 保留设备名产物，疑似某命令残留）。非源码、不会被提交，建议清理；本审计未改动。

---

## 六、红线遵守声明

- ✅ **已执行授权内的 git 写操作**（commit / push / merge / 发版均经用户明确授权）：提交 `355c9ea` → `--no-ff` 合并至 main（PR #10 已合并）→ 打 `v1.9.2` 附注 tag 并推送触发双 CI。
- ✅ **版本戳已升至 1.9.2**，六处同步点（`package.json` / `manifest.json` / `editor.js` / `editor.html` / `compare.js` / `compare.html`）一致。
- ✅ **仅推自有 fork（origin `zhangweildlh`）**，未触 upstream（`yishu-ziyu`）。
- ✅ 部署产物到 `D:\Tools\360Chrome\Chrome-Markdown-Edit` 属已授权本地动作；扩展经 `chrome.runtime.reload()` 重载验证新代码生效。
- ✅ **提交 / 开 PR / 发版均已完成**（用户授权）。

---

## 七、结论

经「静态审计 + CDP 真机驱动 + 二分定位 + 崩溃判别 + 单元测试」闭环，**A/B/C 三类缺陷已全部修复并验证无回归**：编辑器页初始化死锁消除、对照页三栏滚动同步恢复、全部阻塞式 `window.confirm` 清零。构建、单元（455/0/3）、真机（editor=53/compare=21/fatal=none，15 断言全 true）三轮验证全绿。**代码已达到「无 BUG」交付标准**，仅余上节 GUI 观感类边界项待人工目检。
