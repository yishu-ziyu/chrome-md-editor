# Markdown Editor (Chrome Extension)

A clean, efficient, and locally-hosted Markdown editor extension for Google Chrome. / 这是一个简洁、高效的且支持本地部署的 Markdown 编辑器 Chrome 扩展。

[English](#english) | [中文说明](#%E4%B8%AD%E6%96%87%E8%AF%B4%E6%98%8E)

---

## English

### Features

- **Direct File Editing:** Drag and drop any `.md` file into Chrome to automatically open and edit it.
- **Project File Browser:** Built-in sidebar to browse your local project structures and quickly switch between Markdown files.
- **Mermaid Diagram Support:** Automatically renders ` ```mermaid ` code blocks into beautiful SVG diagrams.
- **WYSIWYG Preview:** Click and edit directly within the rendered preview pane – changes automatically sync back to the source code.
- **Real-time Preview:** Split-pane layout with independent scrolling and synchronized viewing for GitHub Flavored Markdown (GFM).
- **Themes & Layouts:** Supports Light and Dark modes. Choose between Split, Editor-only, or Preview-only layouts.
- **No Uploads Required:** Runs entirely locally using Chrome's File System Access API. Your files never leave your computer.

### Installation

1. Clone or download this repository.
2. Run `npm install` to install dependencies.
3. Run `npm run build` to build the extension into the `dist/` directory.
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable **Developer mode** in the top right corner.
6. Click **Load unpacked** and select the `dist/` directory inside this project.
7. **Important:** Click on the "Details" button of the extension and enable **"Allow access to file URLs"**. This is required for drag-and-drop file opening.
8. Click the extension icon in your toolbar to start, or simply drag a `.md` file into your browser.

### Development

- Built with **CodeMirror 6**, **markdown-it**, and **Vite**.
- `npm run dev` starts a local server for UI testing and development (Note: File system access won't work correctly outside of the extension context).
- Check `DEVLOG.md` for detailed implementation notes and history.

---

## 中文说明

### 核心功能

- **拖拽直开：** 直接将本地 `.md` 文件拖入 Chrome 浏览器，扩展将自动接管并在编辑器中无缝打开。
- **项目文件浏览器：** 内置侧边栏，轻松浏览本地文件夹结构，在多个 Markdown 文件间快速切换。
- **Mermaid 图表渲染：** 原生支持识别 ` ```mermaid ` 代码块，并直接在预览区渲染为 SVG 流程图。
- **预览区直接编辑 (WYSIWYG)：** 点击右侧渲染好的预览区即可直接修改文本，改动会自动同步回左侧的 Markdown 源码。
- **实时预览：** 左右分屏布局，支持 GitHub 风格 Markdown (GFM)，支持滚动条同步联动。
- **多主题与布局：** 内置深色/浅色主题；支持分屏、纯编辑、纯预览三种视图模式。
- **纯本地极客体验：** 基于 Chrome File System Access API 构建，无需启动后端服务，数据完全保留在本地。

### 安装步骤

1. 克隆或下载本项目源码。
2. 在项目根目录运行 `npm install` 安装依赖。
3. 运行 `npm run build` 进行打包，产物将生成在 `dist/` 目录下。
4. 打开 Chrome 浏览器，访问 `chrome://extensions/` 设置页面。
5. 开启右上角的 **“开发者模式”**。
6. 点击 **“加载已解压的扩展程序”**，然后选择本项目的 `dist/` 文件夹。
7. **⚠️ 重要：** 在扩展列表中找到 Markdown Editor，点击“详细信息”，并开启 **“允许访问文件网址”**（这是拖拽本地文件自动打开功能的前提）。
8. 点击浏览器工具栏的扩展图标即可启动，或者直接将本地 `.md` 文件拖入浏览器窗口。

### 本地开发

- 核心技术栈：**CodeMirror 6**, **markdown-it**, **Vite**。
- 运行 `npm run dev` 可启动本地开发服务器进行 UI 调试（注意：纯网页环境下无法使用 Chrome 扩展专属的文件访问 API）。
- 详细的开发历程与技术决策请参阅 `DEVLOG.md`。
