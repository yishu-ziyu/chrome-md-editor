// ==========================================
// 新用户引导 + 使用说明
// ==========================================
// 空白编辑器时展示；也可从工具栏「？」随时打开。

let onboardingOverlay = null;

/**
 * @param {{ force?: boolean, mode?: 'start' | 'guide' }} [options]
 */
export function showOnboarding(options = {}) {
  const force = Boolean(options.force);
  const mode = options.mode === 'guide' ? 'guide' : 'start';

  if (onboardingOverlay) {
    if (!force) return;
    hideOnboarding();
  }

  const container = document.createElement('div');
  container.className = 'onboarding-overlay';
  container.id = 'onboardingOverlay';

  const isGuide = mode === 'guide';
  const title = isGuide ? '使用说明' : '开始使用 Markdown 编辑器';
  const subtitle = isGuide
    ? '本地编辑 · 无需上传 · 数据只留在你的电脑'
    : '先打开一个文件，或先看一遍说明';

  container.innerHTML = `
    <div class="onboarding-card onboarding-card--wide">
      <div class="onboarding-logo" aria-hidden="true">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      </div>
      <h2 class="onboarding-title">${title}</h2>
      <p class="onboarding-subtitle">${subtitle}</p>

      ${
        isGuide
          ? ''
          : `
      <div class="onboarding-actions">
        <button class="onboarding-action" type="button" data-action="drag">
          <span class="onboarding-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </span>
          <span class="onboarding-action-text">
            <strong>拖入 .md 文件</strong>
            <small>直接拖到窗口（需开启「允许访问文件网址」）</small>
          </span>
        </button>

        <button class="onboarding-action" type="button" data-action="folder">
          <span class="onboarding-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span class="onboarding-action-text">
            <strong>打开文件夹</strong>
            <small>侧边栏浏览项目；本地图片预览最稳</small>
          </span>
        </button>

        <button class="onboarding-action" type="button" data-action="example">
          <span class="onboarding-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </span>
          <span class="onboarding-action-text">
            <strong>打开示例说明书</strong>
            <small>用一份可编辑的 Markdown 演示全部能力</small>
          </span>
        </button>
      </div>
      `
      }

      <div class="onboarding-manual" id="onboardingManual">
        <section class="onboarding-section">
          <h3>1. 打开与保存</h3>
          <ul>
            <li>工具栏打开 / 保存，或 <kbd>Ctrl/⌘+O</kbd> · <kbd>Ctrl/⌘+S</kbd></li>
            <li>拖入本地 <code>.md</code> 到浏览器（扩展详情里打开「允许访问文件网址」）</li>
            <li>再次打开扩展会尽量恢复上次编辑的<strong>正文</strong>（Chrome 不能记住文件句柄，保存时可能要重选路径）</li>
          </ul>
        </section>
        <section class="onboarding-section">
          <h3>2. 编辑与预览</h3>
          <ul>
            <li>左源码 · 右预览；可切「仅编辑 / 仅预览 / 分屏」</li>
            <li>预览区也可直接点改（WYSIWYG），改完会同步回左侧 Markdown</li>
            <li>常用语法：<code>**粗**</code> <code>*斜*</code> <code>~~删~~</code> <code>\`代码\`</code> <code># 标题</code></li>
          </ul>
        </section>
        <section class="onboarding-section">
          <h3>3. 本地图片</h3>
          <ul>
            <li>优先用「打开文件夹」再点开 md，相对路径图片（如 <code>images/a.png</code>）才能稳定预览</li>
            <li>在编辑区粘贴截图：有文件夹权限时写入 <code>images/</code>，否则嵌入 data URL</li>
          </ul>
        </section>
        <section class="onboarding-section">
          <h3>4. 多窗口</h3>
          <ul>
            <li>每点一次扩展图标 = 一个新的编辑器标签，可同时改多个文件</li>
          </ul>
        </section>
        <section class="onboarding-section">
          <h3>5. 进阶（可选）</h3>
          <ul>
            <li>Mermaid：用 <code>\`\`\`mermaid</code> 代码块画流程图</li>
            <li>高亮：在<strong>左侧编辑区或右侧预览</strong>选中文字 → 点样式工具栏的高亮按钮（<code>A</code>），或在预览区右键「高亮」；两者都会在源码写入 <code>&lt;mark&gt;</code> 并同步预览，再点一次取消</li>
            <li>自动保存：点工具栏时钟按钮开启，按旁边的秒数（默认 30 秒）在源文件同目录生成「文件名_时间戳.md」副本，不会覆盖源文件</li>
          </ul>
        </section>
      </div>

      <div class="onboarding-footer">
        ${
          isGuide
            ? `<p class="onboarding-hint">新增功能（主题 / 斜杠菜单 / 块拖拽 / 视图模式 / 工作区搜索 / 高亮）的用法，点「打开示例说明书」查看详情。</p>
               <button type="button" class="onboarding-primary" data-action="close">关闭说明</button>
               <button type="button" class="onboarding-secondary" data-action="example">打开示例说明书</button>`
            : `<button type="button" class="onboarding-secondary" data-action="guide">只看说明</button>
               <button type="button" class="onboarding-primary" data-action="close-empty">先空白开始</button>`
        }
      </div>
    </div>
  `;

  onboardingOverlay = container;

  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'drag') {
        hideOnboarding();
      } else if (action === 'folder') {
        hideOnboarding();
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent('onboarding:open-folder'));
        }, 150);
      } else if (action === 'example') {
        loadExampleFile();
      } else if (action === 'guide') {
        hideOnboarding();
        showOnboarding({ force: true, mode: 'guide' });
      } else if (action === 'close' || action === 'close-empty') {
        hideOnboarding();
      }
    });
  });

  const editorMain = document.getElementById('editorMain');
  if (editorMain) {
    editorMain.appendChild(container);
  }
}

export function hideOnboarding() {
  if (!onboardingOverlay) return;
  onboardingOverlay.remove();
  onboardingOverlay = null;
}

/**
 * 内置「说明书」示例：可直接当教程读，也可当 md 编辑。
 */
function loadExampleFile() {
  const exampleContent = `# Markdown Editor 使用说明书

> 本地编辑 · 文件不上传 · 适合边改边预览。

## 一分钟上手

1. **打开文件**：工具栏「打开」，或把 \`.md\` 拖进 Chrome（需开启扩展的「允许访问文件网址」）。
2. **打开文件夹**：侧边栏可浏览项目；**本地相对路径图片**在此模式下最稳。
3. **保存**：\`Ctrl/⌘ + S\`。若是拖入打开且没有文件句柄，会走「另存为」。

## 日常编辑

| 你想做 | 怎么做 |
|--------|--------|
| 加粗 / 斜体 | \`**粗**\` / \`*斜*\`，或工具栏 B / I |
| 标题 | 行首 \`# \` \`## \` \`### \` |
| 列表 | \`- 项目\` 或 \`1. 项目\` |
| 链接 | \`[文字](https://example.com)\` |
| 代码 | 行内 \\\`code\\\` 或围栏代码块 |

左右分屏：左写 Markdown，右看渲染。也可以切到「仅编辑 / 仅预览」。

预览区可以直接点文字改（WYSIWYG），失焦后会写回左侧源码。

## 本地图片（重要）

相对路径示例：

\`\`\`md
![示意图](images/demo.png)
\`\`\`

**推荐流程**：先「打开文件夹」→ 在侧边栏点开 md → 图片才能按相对路径加载。

在编辑区 **粘贴截图**：

- 已打开文件夹：写入同级 \`images/\` 并插入相对路径
- 仅打开单个文件：退化为 data URL 嵌入

## 多标签

每点一次浏览器工具栏上的扩展图标，会打开一个**新的**编辑器标签，可同时改多个文件。

## 再次打开时

扩展会尽量恢复你**上次编辑的正文和文件名**。  
受 Chrome 安全限制，无法永久记住磁盘文件句柄，所以恢复后保存时，有时需要重新选一次保存位置。

## Mermaid 图

\`\`\`mermaid
graph LR
  A[打开 md] --> B[编辑]
  B --> C[预览]
  C --> D[保存到本地]
\`\`\`

## 快捷键

- \`Ctrl/⌘ + O\` 打开
- \`Ctrl/⌘ + S\` 保存
- \`Ctrl/⌘ + B\` 加粗
- \`Ctrl/⌘ + I\` 斜体

---

随时点工具栏右侧 **?** 可重新打开本说明。  
*这份示例本身就是 Markdown，你可以随意改。*

## 新增功能速览

本版完善了若干编辑增强，下面逐条说明「在哪点、怎么用」。

### 1. 编辑器主题（23 套）
新增「豆沙绿(亮) / 豆沙绿(暗)」，**默认豆沙绿(亮)**。  
点工具栏「主题」下拉，即可在 23 套主题间切换。

### 2. 斜杠菜单
在编辑区**行尾**输入 \`/\` 或中文顿号 \`、\` 唤起命令面板，可选「标题 / 粗体 / 列表 / 代码块 / 引用 / 表格 / 分割线 / 图片 / 链接」等。  
\`↑\`\`↓\` 选择、\`Enter\` 执行、\`Esc\` 关闭。

### 3. 块拖拽
每个块首行左侧出现**拖拽手柄**，按住拖动即可调整块顺序；手柄旁的「+」可在当前块下方插入新块。

### 4. 视图模式（日常 / 专注 / 沉浸 / 全显）
点工具栏「⊞」按钮循环切换。  
- **专注模式**：隐藏侧栏 / 大纲 / 任务 / 状态栏  
- **沉浸模式**：进一步隐藏工具栏，适合纯写作

### 5. 工作区搜索
点工具栏「🔍」打开搜索面板，输入关键词后检索**当前已打开文件夹内所有 Markdown 文件**的命中片段。

### 6. 行内 == 高亮 == 与提示框
在 \`==两个等号之间==\` 写文字，即可在预览中高亮。  
GitHub 风格提示框 \`> [!NOTE]\` / \`> [!WARNING]\` 等继续支持。
`;

  document.dispatchEvent(
    new CustomEvent('onboarding:load-example', {
      detail: { content: exampleContent },
    })
  );

  hideOnboarding();
}

export default { showOnboarding, hideOnboarding, loadExampleFile };
