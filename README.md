# Chrome Markdown Editor

本地 Markdown 编辑器 Chrome 扩展。
不上传文件、不依赖后端；在浏览器里直接打开、编辑、预览本地 `.md`。

**当前版本：[v1.4.2](https://github.com/yishu-ziyu/chrome-md-editor/releases/tag/v1.4.2)**  
**下载：** [chrome-md-editor-v1.4.2.zip](https://github.com/yishu-ziyu/chrome-md-editor/releases/download/v1.4.2/chrome-md-editor-v1.4.2.zip)  
**许可：** [MIT](./LICENSE)

[English](#english)

---

## 预览

分屏编辑 + 实时预览（深色）：

![编辑器主界面](docs/images/screenshot-editor.png)

阅读翻译：预览区中英对照（不改源码）：

![双语阅读](docs/images/screenshot-bilingual.png)

翻译设置（选预设 + 粘贴 API Key）：

![翻译设置](docs/images/screenshot-translate-settings.png)

浅色主题：

![浅色主题](docs/images/screenshot-light.png)

动图（主界面 → 设置 → 双语）：

![演示 GIF](docs/images/demo.gif)

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 拖拽打开 | 将本地 `.md` 拖入 Chrome，扩展接管并打开编辑器 |
| 多实例 | 每次点扩展图标新开独立标签；多文件互不抢占 |
| 项目侧边栏 | 打开文件夹后浏览并切换同目录 Markdown |
| 分屏预览 | 左编辑 / 右预览；支持仅编辑、仅预览 |
| 预览区编辑 | 可在渲染结果上直接改字，再同步回源码 |
| 本地图片 | 相对路径图片可预览；支持粘贴截图（有权限时写入 `images/`） |
| Mermaid | ` ```mermaid ` 代码块渲染为图 |
| 主题 | 深色 / 浅色 |
| 会话恢复 | 再次打开扩展时尽量恢复上次内容与文件名 |
| 阅读翻译 | 预览区中英对照；**不修改** Markdown 源文件 |
| 大纲面板 | 侧边栏展示标题层级，点击跳转对应位置 |
| 任务列表 | 聚合 `- [ ]` 任务项，点击定位到源码 |
| 专注模式 | 淡化非当前行，减少干扰 |
| 打字机滚动 | 光标所在行自动保持在视图中央 |
| 查找替换 | 编辑器内 `Ctrl+F` 调用查找 / 替换面板 |
| 样式工具栏 | 居中 / 加粗 / 高亮 / 颜色 / 字号（图标化，不刺眼） |
| 代码补全 | 代码块语言提示与括号自动补全 |
| 自动配对 | 引号、括号自动配对与智能包裹 |
| Mermaid 增强 | 预览区图表支持缩放 / 平移 / 全屏 |
| Base64 折叠 | 内联 Base64 图片可折叠，长文档更清爽 |
| HTML 粘贴 | 粘贴网页内容自动转换为 Markdown |
| 滚动恢复 | 重新打开时恢复预览滚动位置 |
| Callout 卡片 | 支持 `> [!NOTE]` 等提示卡片渲染 |

技术栈：CodeMirror 6 · markdown-it · Vite · Manifest V3。

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
3. 确认左上角版本徽标与 Release 一致（当前应为 **v1.4.2**）。

---

## 使用

### 基本编辑

1. 拖入 `.md`，或点扩展图标后「打开文件 / 打开文件夹」。
2. 左侧写 Markdown，右侧实时预览。
3. 需要时可在预览区直接点选改字；失焦后写回源码。
4. `Ctrl/Cmd+S` 保存（首次可能弹出系统保存对话框）。

### 阅读翻译

用于读英文长文，不是用来改写源文件。

1. 点「译」旁的齿轮，选择服务预设。
2. 粘贴 API Key（默认预设为 MiniMax Token Plan · Anthropic，Key 形如 `sk-cp-...`）。
3. 点 **译**：预览区在英文段落下显示中文。
4. 再点一次关闭翻译，预览恢复原文排版。

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
- 开发过程：[DEVLOG.md](./DEVLOG.md)

---

## 目录说明

```
public/          # manifest、background、content-script、icons（构建时拷贝进 dist）
src/             # 编辑器页面与逻辑
tests/           # node:test 单元测试
scripts/         # 打包、图标、验收脚本
docs/images/     # README 截图与演示 GIF
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

![Editor](docs/images/screenshot-editor.png)

### Install

1. Download `chrome-md-editor-v*.zip` from [Releases](https://github.com/yishu-ziyu/chrome-md-editor/releases).
2. Unzip and load the inner **`dist/`** folder via `chrome://extensions` (Developer mode → Load unpacked).
3. Enable **Allow access to file URLs** in the extension details.
4. Click the toolbar icon, or drag a `.md` file into Chrome.

After upgrading: **Reload** the extension, close old editor tabs, open a new one.
The toolbar should show the release version (currently **v1.4.2**).

### Features (short)

- Drag-open local `.md`, multi-tab instances, folder sidebar
- Split / editor / preview layouts, light & dark themes
- Preview WYSIWYG sync, Mermaid, local images, paste screenshot
- Optional reading translation (bilingual preview; source file unchanged)
- Outline / task panels, focus mode, typewriter scroll
- In-editor find & replace (Ctrl+F)
- Style toolbar (center/bold/highlight/color/size), code completion, auto-pair
- Mermaid zoom/pan, Base64 image folding, HTML paste-to-Markdown, scroll restore, Callout cards

### Develop

```bash
npm install && npm test && npm run build
```

Load `dist/` as an unpacked extension.
`npm run dev` is UI-only and is not a substitute for extension testing.

### Privacy

Editing stays local unless you enable reading translation, which sends text to the API provider you configure.

### License

[MIT](./LICENSE)
