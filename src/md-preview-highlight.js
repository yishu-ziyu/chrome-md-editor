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
