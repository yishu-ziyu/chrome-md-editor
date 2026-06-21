// ==========================================
// 新用户引导面板
// ==========================================
// 当用户没有打开任何文件时，在编辑区显示引导面板。
// 不依赖任何第三方库，纯 DOM 操作。

// 引导面板的 DOM 容器
let onboardingOverlay = null;

/**
 * 渲染引导面板，覆盖在编辑区上方
 */
export function showOnboarding() {
  // 避免重复渲染
  if (onboardingOverlay) return;

  const container = document.createElement('div');
  container.className = 'onboarding-overlay';
  container.id = 'onboardingOverlay';

  container.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-logo">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      </div>
      <h2 class="onboarding-title">开始使用 Markdown Editor</h2>
      <p class="onboarding-subtitle">选择一种方式打开你的第一个文件</p>

      <div class="onboarding-actions">
        <button class="onboarding-action" data-action="drag">
          <span class="onboarding-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </span>
          <span class="onboarding-action-text">
            <strong>拖入 .md 文件</strong>
            <small>将 Markdown 文件直接拖到编辑器窗口</small>
          </span>
        </button>

        <button class="onboarding-action" data-action="folder">
          <span class="onboarding-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
          </span>
          <span class="onboarding-action-text">
            <strong>打开文件夹</strong>
            <small>以项目文件夹方式打开，支持文件树浏览</small>
          </span>
        </button>

        <button class="onboarding-action" data-action="example">
          <span class="onboarding-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </span>
          <span class="onboarding-action-text">
            <strong>打开示例文件</strong>
            <small>加载一份示例 Markdown，快速了解功能</small>
          </span>
        </button>
      </div>

      <div class="onboarding-tips">
        <span>快捷键：</span>
        <kbd>Ctrl+O</kbd> 打开 &nbsp;·&nbsp;
        <kbd>Ctrl+S</kbd> 保存 &nbsp;·&nbsp;
        <kbd>Ctrl+B</kbd> 加粗
      </div>
    </div>
  `;

  onboardingOverlay = container;

  // 绑定操作按钮
  container.querySelectorAll('.onboarding-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'drag') {
        hideOnboarding();
      } else if (action === 'folder') {
        hideOnboarding();
        // 延迟一点让面板先消失，再触发文件夹打开
        setTimeout(() => {
          const event = new CustomEvent('onboarding:open-folder');
          document.dispatchEvent(event);
        }, 150);
      } else if (action === 'example') {
        loadExampleFile();
      }
    });
  });

  // 挂载到编辑器主区域
  const editorMain = document.getElementById('editorMain');
  if (editorMain) {
    editorMain.appendChild(container);
  }
}

/**
 * 隐藏引导面板
 */
export function hideOnboarding() {
  if (!onboardingOverlay) return;
  onboardingOverlay.remove();
  onboardingOverlay = null;
}

/**
 * 加载内置示例 Markdown 文件
 */
function loadExampleFile() {
  // 示例内容：包含标题、列表、代码块、Mermaid 图表示例
  const exampleContent = `# Markdown Editor 示例

> 这是一份示例文档，展示了编辑器的核心功能。

## 文本格式

**粗体文本**、_斜体文本_、~~删除线~~、\`行内代码\`

## 列表

### 无序列表

- Markdown 编辑器
  - 实时预览
  - 语法高亮
  - 主题切换

### 有序列表

1. 打开一个 .md 文件
2. 在左侧编辑 Markdown
3. 右侧实时预览渲染效果

### 任务列表

- [x] 支持基础 Markdown 语法
- [x] 支持 Mermaid 图表
- [x] 支持代码高亮
- [ ] 支持 LaTeX 公式
- [ ] 支持图片拖入

## 代码块

\`\`\`javascript
// 一个简单的 Markdown 解析示例
function parseMarkdown(text) {
  const tokens = tokenize(text);
  return tokens.map(renderToken).join('');
}
\`\`\`

\`\`\`python
# Python 风格的伪代码
class MarkdownEditor:
    def __init__(self, theme='dark'):
        self.theme = theme
        self.content = ''

    def open(self, path):
        with open(path) as f:
            self.content = f.read()
\`\`\`

## 引用

> Markdown 是一种轻量级标记语言，它允许人们使用易读易写的纯文本格式编写文档。
>
> —— John Gruber, Markdown 创造者

## 表格

| 功能 | 状态 | 说明 |
|------|------|------|
| 实时预览 | 已支持 | 编辑区输入，预览区即时渲染 |
| Mermaid 图表 | 已支持 | 代码块标记 \`\`\`mermaid 即可 |
| 代码高亮 | 已支持 | 自动识别语言并着色 |
| 主题切换 | 已支持 | 深色 / 浅色一键切换 |

## Mermaid 图表示例

\`\`\`mermaid
graph LR
    A[编辑 Markdown] --> B[实时预览]
    B --> C{满意吗?}
    C -->|是| D[保存文件]
    C -->|否| A
\`\`\`

\`\`\`mermaid
pie title 编辑器功能分布
    "文本编辑" : 40
    "代码支持" : 25
    "图表渲染" : 20
    "其他" : 15
\`\`\`

---

*以上内容即为示例，关闭此面板后你可以在编辑器中自由编辑。*
`;

  // 通知外部模块加载内容
  const event = new CustomEvent('onboarding:load-example', {
    detail: { content: exampleContent },
  });
  document.dispatchEvent(event);

  hideOnboarding();
}

// 导出模块
export default { showOnboarding, hideOnboarding, loadExampleFile };
