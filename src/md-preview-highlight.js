// ==========================================
// 预览区代码高亮：markdown-it 14 + highlight.js 11
// ==========================================
// 复用自 markdown-it 官方 JSDoc 高亮回调范式 + tensorflow/tfjs-website /
// BaileyJM02/markdown-to-pdf（MIT / 类 MIT），经改造适配本项目。
//
// 关键改造点：
//  1. 使用 hljs 11 新 API：hljs.highlight(str, { language, ignoreIllegals })
//     —— 非旧版 hljs.highlight(lang, str, true)。
//  2. 把 sanitize 外包给调用方传入的 sanitizePreviewHtml（DOMPurify 净化），
//     保持 editor.js (L117-122) 的 XSS 防护链不可回退；本模块不自行实现净化，
//     也不移除 sanitize 调用。
//  3. 未识别语言 / hljs 抛错时，用模块内 mdEscape 转义（不依赖 markdown-it
//     实例的 utils.escapeHtml，实例在 editor.js 中）。
//
// 该模块只产出 <pre class="hljs"><code>...</code></pre>，其中 token 形如
// <span class="hljs-*">，真实颜色由 editor.css 中 .preview-container .hljs-*
// 变量绑定提供（本模块不写 CSS）。

// 采用 highlight.js 常用语言子集（/lib/common），覆盖 js/ts/py/rust/go/json/
// yaml 等常见代码块语言，体积远小于完整包（完整包约 190 种语言会显著膨胀扩展
// 打包体积）。API 与完整包一致（hljs.highlight / hljs.getLanguage 均可用）；
// 未注册的语言会走模块内 mdEscape 转义回退，行为不变。
import hljs from 'highlight.js/lib/common';

/**
 * 模块内最小 HTML 转义工具。
 * 仅用于「语言未识别」或「hljs 抛错」的回退路径；已高亮成功的 token 由 hljs
 * 自身负责尖括号转义，无需再经此函数。不依赖 markdown-it 实例。
 * @param {string} str 原始代码文本
 * @returns {string} 转义后的安全 HTML 文本
 */
function mdEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 语言标识白名单。
 * markdown-it 会把 fence info 的首段原样传给 highlight 回调，内容完全由文档
 * 作者控制（例如 ```js" onload="alert(1)）。该值被拼进 class="language-${lang}"
 * 属性字符串，未经校验会形成 HTML 属性注入面。虽然产物最终仍过 DOMPurify，
 * 但不应把安全性押在单点防护上——此处按白名单在源头拦截。
 * 放行常规语言标识字符：字母、数字、下划线、加号、井号、点、连字符，长度 ≤ 32。
 */
const LANG_TOKEN_RE = /^[A-Za-z0-9_+#.-]{1,32}$/;

/**
 * 构造安全的 language-* class 属性片段。
 * @param {string} lang fence info 首段
 * @returns {string} 形如 ` class="language-js"`；非法标识返回空串
 */
function langClassAttr(lang) {
  return lang && LANG_TOKEN_RE.test(lang) ? ` class="language-${lang}"` : '';
}

/**
 * 构造 markdown-it 的 highlight 回调工厂。
 *
 * @param {(dirtyHtml: string) => string} sanitize
 *   由 editor.js 传入的净化函数（即现有 sanitizePreviewHtml / DOMPurify）。
 *   该回调产出的整段 <pre class="hljs">...</pre> 都会先经它净化再交还给
 *   markdown-it，从而保持 XSS 防护链不回退。
 * @returns {(str: string, lang: string) => string}
 *   可直接作为 markdown-it 配置的 highlight 选项：
 *   new MarkdownIt({ ..., highlight: createMarkdownHighlight(sanitizePreviewHtml) })
 */
export function createMarkdownHighlight(sanitize) {
  return function (str, lang) {
    let body;
    let langClass = '';
    if (lang && hljs.getLanguage(lang)) {
      try {
        body = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        langClass = langClassAttr(lang);
      } catch (e) {
        // hljs 对个别输入抛错时回退为转义原文，避免破坏整页渲染。
        body = mdEscape(str);
        langClass = langClassAttr(lang);
      }
    } else {
      // 未提供语言或 hljs 不支持该语言：转义原文，至少保证安全且不丢失内容。
      // 注意 mermaid 走的正是本分支（hljs 不识别 mermaid），其 language-mermaid
      // class 必须保留，否则 Mermaid 图永不渲染。
      body = mdEscape(str);
      langClass = langClassAttr(lang);
    }
    // 保留 language-${lang} class：mermaid 等下游渲染器依赖 code.language-mermaid
    // 选择器定位目标块，缺失该 class 会导致 Mermaid 图永不渲染（已确认 BUG）。
    return sanitize(`<pre class="hljs"><code${langClass}>` + body + '</code></pre>');
  };
}

export { mdEscape };

// =====================================================================
// 预览区代码着色「命名调色板」集合（需求 1）
// ---------------------------------------------------------------------
// 上方 createMarkdownHighlight 产出 <span class="hljs-*">，真实颜色由
// editor.css 中 `.preview-container .hljs-*` 的 CSS 变量驱动（零硬编码颜色），
// 代码块底色由 `.preview-container pre.hljs { background: var(--md-fence-bg) }`
// 驱动。本节固化 8 套命名代码着色方案，每套 = 一组可枚举的 CSS 变量取值。
//
// 变量清单（与 editor.css:3460-3493 对应，受本调色板控制）：
//   --code-keyword --code-string --code-comment --code-number
//   --code-function --code-tag   （hljs token 文本色）
//   --md-fence-bg                （代码块底色，预览区自身语境；与编辑区
//                                  --md-fence-bg 作用域互不相干）
// （--text-primary 等为基础文本色，由主题驱动，不纳入方案，保持与主题正交。）
//
// 方案名与主界面「高亮方案选择」按钮约定一致，一字不差：
//   github / github-dark / atom-one-dark / solarized-light / monokai /
//   vs2015 / stackoverflow-light / xcode
// 主界面 Agent 把这些名写入预览区 DOM 的 data-code-scheme 属性，本模块据此
// 作用域化变量（见 injectPreviewCodeSchemeStyles）。
// =====================================================================
export const PREVIEW_CODE_SCHEMES = {
    // github：GitHub Light（红关键字 / 深蓝字符串 / 灰注释 / 蓝数字 / 紫函数 / 绿标签）
    github: {
        '--code-keyword': '#d73a49', '--code-string': '#032f62', '--code-comment': '#6a737d',
        '--code-number': '#005cc5', '--code-function': '#6f42c1', '--code-tag': '#22863a',
        '--md-fence-bg': '#f6f8fa',
    },
    // github-dark：GitHub Dark（亮红/天蓝/灰/亮蓝/浅紫/亮绿）
    'github-dark': {
        '--code-keyword': '#ff7b72', '--code-string': '#a5d6ff', '--code-comment': '#8b949e',
        '--code-number': '#79c0ff', '--code-function': '#d2a8ff', '--code-tag': '#7ee787',
        '--md-fence-bg': '#0d1117',
    },
    // atom-one-dark：Atom One Dark（紫关键字 / 绿字符串 / 灰注释 / 橙数字 / 蓝函数 / 红标签）
    'atom-one-dark': {
        '--code-keyword': '#c678dd', '--code-string': '#98c379', '--code-comment': '#5c6370',
        '--code-number': '#d19a66', '--code-function': '#61afef', '--code-tag': '#e06c75',
        '--md-fence-bg': '#282c34',
    },
    // solarized-light：Solarized Light（绿/青/蓝灰/蓝/紫/蓝）
    'solarized-light': {
        '--code-keyword': '#859900', '--code-string': '#2aa198', '--code-comment': '#93a1a1',
        '--code-number': '#268bd2', '--code-function': '#6c71c4', '--code-tag': '#268bd2',
        '--md-fence-bg': '#fdf6e3',
    },
    // monokai：经典 Monokai（粉红/黄绿/棕灰/紫/亮绿/粉红）
    monokai: {
        '--code-keyword': '#f92672', '--code-string': '#e6db74', '--code-comment': '#75715e',
        '--code-number': '#ae81ff', '--code-function': '#a6e22e', '--code-tag': '#f92672',
        '--md-fence-bg': '#272822',
    },
    // vs2015：Visual Studio 2015 Dark（蓝/棕橙/绿/浅绿/黄/蓝）
    vs2015: {
        '--code-keyword': '#569cd6', '--code-string': '#ce9178', '--code-comment': '#6a9955',
        '--code-number': '#b5cea8', '--code-function': '#dcdcaa', '--code-tag': '#569cd6',
        '--md-fence-bg': '#1e1e1e',
    },
    // stackoverflow-light：StackOverflow Light（青/红/灰/青绿/玫红/青）
    'stackoverflow-light': {
        '--code-keyword': '#0077aa', '--code-string': '#a31515', '--code-comment': '#999988',
        '--code-number': '#009999', '--code-function': '#dd4a68', '--code-tag': '#0077aa',
        '--md-fence-bg': '#f6f6f6',
    },
    // xcode：Xcode Default（Light，品红/红/绿/蓝/紫/品红）
    xcode: {
        '--code-keyword': '#aa0d91', '--code-string': '#c41a16', '--code-comment': '#008400',
        '--code-number': '#1c00cf', '--code-function': '#ad3da4', '--code-tag': '#aa0d91',
        '--md-fence-bg': '#f5f5f5',
    },
};

// 枚举所有方案名（与主界面约定顺序一致），供选择器 UI 直接消费。
export const PREVIEW_CODE_SCHEME_NAMES = Object.keys(PREVIEW_CODE_SCHEMES);

/**
 * 由命名调色板生成「按方案作用域」的 CSS 文本（纯函数，无 DOM 依赖）。
 * 每个方案输出形如：
 *   [data-code-scheme="monokai"] { --code-keyword: ...; ... }
 * 由于 CSS 自定义属性可继承，只要 data-code-scheme 挂在 .preview-container
 * 子树的任意祖先上即可真正生效——切换属性即切换调色板。
 * @returns {string}
 */
export function buildPreviewCodeSchemeCss() {
    return Object.entries(PREVIEW_CODE_SCHEMES).map(([name, vars]) => {
        const decls = Object.entries(vars)
            .map(([k, v]) => `  ${k}: ${v};`)
            .join('\n');
        return `[data-code-scheme="${name}"] {\n${decls}\n}`;
    }).join('\n\n');
}

const PREVIEW_SCHEME_STYLE_ID = 'md-preview-code-schemes';

/**
 * 将命名调色板注入文档 <head>（浏览器环境，幂等）。仅在 document 存在时执行，
 * 保证在 node --test 等无 DOM 环境安全跳过。注入后即使 data 属性后续才挂上，
 * 规则也会在元素出现时自动生效。
 */
export function injectPreviewCodeSchemeStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(PREVIEW_SCHEME_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PREVIEW_SCHEME_STYLE_ID;
    style.textContent = buildPreviewCodeSchemeCss();
    document.head.appendChild(style);
}

// 模块加载即注入（浏览器扩展环境），无需调用方显式触发。
injectPreviewCodeSchemeStyles();
