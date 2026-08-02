# Changelog

All notable changes to this project are documented in this file.

Format based on Keep a Changelog.
Project uses Semantic Versioning.

## [Unreleased]

### Added

- 大纲面板：侧边栏展示标题层级结构，点击跳转（工具栏大纲按钮展开）
- 任务列表面板：聚合文档内 `- [ ]` 任务项，点击定位源码
- 专注模式：淡化非当前行，降低干扰
- 打字机滚动：光标行自动居中
- 查找 / 替换：`Ctrl+F` 在编辑器内调用自绘查找替换面板
- 样式工具栏（重新设计，图标化、不刺眼）：居中 / 加粗 / 高亮 / 颜色 / 字号，可组合嵌套
- 代码补全：代码块语言提示与括号自动补全
- 自动配对：引号、括号自动配对与智能包裹
- Mermaid 增强：预览区图表支持缩放 / 平移 / 全屏
- Base64 折叠：内联 Base64 图片可折叠，长文档更清爽
- HTML 粘贴转 Markdown：粘贴网页内容自动转换为 Markdown 源
- 滚动恢复：重新打开时恢复预览滚动位置
- Callout 卡片：支持 `> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!CAUTION]` 提示卡片渲染
- 预览区回写缺陷修复（BUG-1/2/3）：中文符号配对、弹窗溢出、三类回写修正
- 预览安全加固：渲染输出经 DOMPurify 清洗，降低 XSS 风险

### Notes

- 以上为来自 fork（zhangweildlh/chrome-md-editor）的 Chrome 侧功能贡献，已剥离 Tauri 桌面壳相关代码，纯扩展侧可独立构建运行

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
