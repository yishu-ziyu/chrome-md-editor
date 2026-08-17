// 复用自 orchidsoftware/platform (MIT)，经改造适配本项目。
// 来源：orchidsoftware/platform → resources/js/controllers/markdown_controller.js
// 改造点：
//   1. 标题行底色从 #1-5 扩展到 #1-6（与 Lezer tags.heading1~6 对齐）；
//   2. 新增引用行 / 围栏代码块行的行底色（正则法 Decoration.line）；
//   3. 围栏代码块用 inFence 状态追踪，起止 fence 行与内部所有行均加 cm-md-fence-line；
//   4. 导出 buildLineBgDecorations（纯函数，供单测），并导出 markdownMarkerDecorations。
// 颜色全部交给 CSS 变量（class 驱动），本模块不写死任何颜色。

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { StateField, RangeSetBuilder } from '@codemirror/state';

// —— ① markdown 语法 tag → CSS 类（class 驱动，颜色交给 CSS 变量）——
export const markdownHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, class: 'cm-md-token-heading-1' },
    { tag: tags.heading2, class: 'cm-md-token-heading-2' },
    { tag: tags.heading3, class: 'cm-md-token-heading-3' },
    { tag: tags.heading4, class: 'cm-md-token-heading-4' },
    { tag: tags.heading5, class: 'cm-md-token-heading-5' },
    { tag: tags.heading6, class: 'cm-md-token-heading-6' },
    { tag: tags.strong, class: 'cm-md-token-strong' },
    { tag: tags.emphasis, class: 'cm-md-token-emphasis' },
    { tag: tags.link, class: 'cm-md-token-link' },
    { tag: tags.url, class: 'cm-md-token-url' },
    { tag: tags.quote, class: 'cm-md-token-quote' },
    { tag: tags.monospace, class: 'cm-md-token-code' },
    { tag: tags.contentSeparator, class: 'cm-md-token-separator' },
    { tag: tags.processingInstruction, class: 'cm-md-token-markup' },
]);

// —— ② 标题行 / 引用行 / 围栏代码块行底色（正则法，纯函数）——
// 复用 2.1 的 buildHeadingLineDecorations 思路，扩展到引用行与代码块行。
// 该函数为纯函数（仅依赖传入的 doc），供单测用 EditorState 构造 doc 直接调用。
export function buildLineBgDecorations(doc) {
    const builder = new RangeSetBuilder();
    let inFence = false; // 追踪 ``` 围栏的起止范围
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;

        // 标题行：#1~6 后必须跟空格
        if (/^#{1,6}\s/.test(text)) {
            const level = text.match(/^#+/)[0].length; // 1~6
            builder.add(line.from, line.from,
                Decoration.line({ class: `cm-md-heading-${level}` }));
            continue;
        }

        // 引用行：行首允许空白后跟 >
        if (/^\s*>/.test(text)) {
            builder.add(line.from, line.from,
                Decoration.line({ class: 'cm-md-quote-line' }));
            continue;
        }

        // 围栏代码块行：以 ``` （3+ 反引号）开头；起止 fence 行与内部行均加 cm-md-fence-line
        const fence = text.match(/^```/);
        if (fence) {
            inFence = !inFence; // 切换围栏内外状态（开/闭）
            builder.add(line.from, line.from,
                Decoration.line({ class: 'cm-md-fence-line' }));
            continue;
        }
        if (inFence) {
            builder.add(line.from, line.from,
                Decoration.line({ class: 'cm-md-fence-line' }));
        }
    }
    return builder.finish();
}

// —— ②' 标题/引用/代码块行底色 StateField，随 docChanged 重建并 provide 装饰 ——
export const lineBgDecorations = StateField.define({
    create(state) { return buildLineBgDecorations(state.doc); },
    update(decorations, transaction) {
        return transaction.docChanged
            ? buildLineBgDecorations(transaction.newDoc)
            : decorations;
    },
    provide(field) { return EditorView.decorations.from(field); },
});

// —— ③ 标记 / 代码栅栏装饰：ViewPlugin + Decoration.mark ——
// #、>、* 等标记符加 cm-md-marker；``` 围栏行整行加 cm-md-code-fence。
// 在 visibleRanges 内构建，随 docChanged / viewportChanged 重建。
export const markdownMarkerDecorations = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = buildMarkdownMarkerDecorations(view); }
    update(update) {
        if (update.docChanged || update.viewportChanged)
            this.decorations = buildMarkdownMarkerDecorations(update.view);
    }
}, { decorations: v => v.decorations });

function buildMarkdownMarkerDecorations(view) {
    const builder = new RangeSetBuilder();
    const marker = Decoration.mark({ class: 'cm-md-marker' });
    const codeFence = Decoration.mark({ class: 'cm-md-code-fence' });
    for (const { from, to } of view.visibleRanges) {
        let position = from;
        while (position <= to) {
            const line = view.state.doc.lineAt(position);
            const text = line.text;
            // 标记符：标题 #、引用 >、列表项 -/*/+
            [/^(#{1,6})(?=\s)/, /^(\s*>)(?=\s|$)/, /^(\s*[-*+])(?=\s|$)/]
                .forEach(p => {
                    const m = text.match(p);
                    if (m) builder.add(line.from, line.from + m[1].length, marker);
                });
            // 代码栅栏行：整行加 cm-md-code-fence
            const fence = text.match(/^(```+)(.*)$/);
            if (fence !== null) builder.add(line.from, line.from + fence[0].length, codeFence);
            if (line.to >= to) break;
            position = line.to + 1;
        }
    }
    return builder.finish();
}

// —— ④ 组合导出（供 editor.js 直接 spread 进 extensions）——
export const mdEditorHighlightExtensions = [
    syntaxHighlighting(markdownHighlightStyle),
    lineBgDecorations,
    markdownMarkerDecorations,
];

// =====================================================================
// ⑤ 编辑区语法高亮「命名调色板」集合（需求 1）
// ---------------------------------------------------------------------
// 上方 markdownHighlightStyle / lineBgDecorations / markdownMarkerDecorations
// 只把 token 映射为 class（cm-md-*），真实颜色完全由 editor.css 中
// `.cm-content .cm-md-*` 的 CSS 变量驱动（零硬编码颜色）。本节固化 8 套
// 命名语法方案，每套 = 一组可枚举的 CSS 变量取值。
//
// 变量清单（与 editor.css:3429-3456 一一对应，受本调色板控制的 13 个）：
//   文本色：--md-h1-color --md-h2-color --md-h3-color
//           --md-strong-color --md-em-color --md-link-color --md-quote-color
//   行底色：--md-h1-bg --md-h2-bg --md-h3-bg
//           --md-quote-bg --md-code-bg --md-fence-bg
// （--text-primary / --text-secondary 为「主题」驱动，不纳入方案，保持方案
//  与主题配色正交；预览区 --code-* 系列不在此处，见 md-preview-highlight.js。）
//
// 方案名与主界面「高亮方案选择」按钮约定一致，一字不差：
//   default / sepia / mono / contrast / pastel / solarized / github / nord
// 主界面 Agent 把这些名写入编辑区 DOM 的 data-md-syntax-scheme 属性，本模块
// 据此作用域化变量（见 injectEditorSyntaxSchemeStyles）。
// =====================================================================
export const EDITOR_SYNTAX_SCHEMES = {
    // default：经典浅色 Markdown 配色（与编辑器浅色主题默认值对齐）
    default: {
        '--md-h1-color': '#000000', '--md-h2-color': '#0000cc', '--md-h3-color': '#006600',
        '--md-strong-color': '#cc6600', '--md-em-color': '#cc0099', '--md-link-color': '#0000cc',
        '--md-quote-color': '#333333',
        '--md-h1-bg': 'rgba(0,0,0,.10)', '--md-h2-bg': 'rgba(0,0,204,.08)', '--md-h3-bg': 'rgba(0,102,0,.08)',
        '--md-quote-bg': 'rgba(0,0,0,.08)', '--md-code-bg': 'rgba(0,0,0,.10)', '--md-fence-bg': 'rgba(0,0,0,.08)',
    },
    // sepia：暖棕/羊皮纸色调（深色墨水 + 低饱和暖底色）
    sepia: {
        '--md-h1-color': '#9a6b1f', '--md-h2-color': '#8a5a2b', '--md-h3-color': '#6f7a2b',
        '--md-strong-color': '#a85a1f', '--md-em-color': '#a53d6b', '--md-link-color': '#8a5a2b',
        '--md-quote-color': '#7a6f5a',
        '--md-h1-bg': 'rgba(154,107,31,.08)', '--md-h2-bg': 'rgba(138,90,43,.07)', '--md-h3-bg': 'rgba(111,122,43,.07)',
        '--md-quote-bg': 'rgba(122,111,90,.10)', '--md-code-bg': 'rgba(122,111,90,.12)', '--md-fence-bg': 'rgba(122,111,90,.08)',
    },
    // mono：纯灰度（所有标题/链接均为不同明度的灰黑，无彩色）
    mono: {
        '--md-h1-color': '#111111', '--md-h2-color': '#333333', '--md-h3-color': '#555555',
        '--md-strong-color': '#000000', '--md-em-color': '#444444', '--md-link-color': '#1a1a1a',
        '--md-quote-color': '#555555',
        '--md-h1-bg': 'rgba(0,0,0,.14)', '--md-h2-bg': 'rgba(0,0,0,.10)', '--md-h3-bg': 'rgba(0,0,0,.07)',
        '--md-quote-bg': 'rgba(0,0,0,.10)', '--md-code-bg': 'rgba(0,0,0,.12)', '--md-fence-bg': 'rgba(0,0,0,.08)',
    },
    // contrast：暗底高对比霓虹（白/青/绿/橙/品红，强发光感）
    contrast: {
        '--md-h1-color': '#ffffff', '--md-h2-color': '#00ffff', '--md-h3-color': '#00ff00',
        '--md-strong-color': '#ffaa00', '--md-em-color': '#ff55ff', '--md-link-color': '#00bfff',
        '--md-quote-color': '#dddddd',
        '--md-h1-bg': 'rgba(255,255,255,.18)', '--md-h2-bg': 'rgba(0,255,255,.12)', '--md-h3-bg': 'rgba(0,255,0,.10)',
        '--md-quote-bg': 'rgba(255,255,255,.12)', '--md-code-bg': 'rgba(255,255,255,.14)', '--md-fence-bg': 'rgba(255,255,255,.12)',
    },
    // pastel：柔彩（低饱和粉彩，适合护眼浅底）
    pastel: {
        '--md-h1-color': '#c792ea', '--md-h2-color': '#82aaff', '--md-h3-color': '#c3e88a',
        '--md-strong-color': '#f78c6c', '--md-em-color': '#ff9ccd', '--md-link-color': '#82aaff',
        '--md-quote-color': '#9aa3ad',
        '--md-h1-bg': 'rgba(199,146,234,.14)', '--md-h2-bg': 'rgba(130,170,255,.14)', '--md-h3-bg': 'rgba(195,232,138,.14)',
        '--md-quote-bg': 'rgba(154,163,173,.14)', '--md-code-bg': 'rgba(154,163,173,.16)', '--md-fence-bg': 'rgba(154,163,173,.12)',
    },
    // solarized：Solarized Light 调色板（蓝/青/绿/橙/品红/蓝灰）
    solarized: {
        '--md-h1-color': '#268bd2', '--md-h2-color': '#2aa198', '--md-h3-color': '#859900',
        '--md-strong-color': '#cb4b16', '--md-em-color': '#d33682', '--md-link-color': '#268bd2',
        '--md-quote-color': '#657b83',
        '--md-h1-bg': 'rgba(38,139,210,.10)', '--md-h2-bg': 'rgba(42,161,152,.10)', '--md-h3-bg': 'rgba(133,153,0,.10)',
        '--md-quote-bg': 'rgba(101,123,131,.12)', '--md-code-bg': 'rgba(101,123,131,.14)', '--md-fence-bg': 'rgba(101,123,131,.12)',
    },
    // github：GitHub Light 语法配色（紫/蓝/青绿/橙/品红）
    github: {
        '--md-h1-color': '#8250df', '--md-h2-color': '#0969da', '--md-h3-color': '#0a7d6b',
        '--md-strong-color': '#bc4c00', '--md-em-color': '#bf3989', '--md-link-color': '#0969da',
        '--md-quote-color': '#57606a',
        '--md-h1-bg': 'rgba(130,80,223,.08)', '--md-h2-bg': 'rgba(9,105,218,.07)', '--md-h3-bg': 'rgba(10,125,107,.07)',
        '--md-quote-bg': 'rgba(87,96,106,.10)', '--md-code-bg': 'rgba(135,131,120,.12)', '--md-fence-bg': 'rgba(135,131,120,.10)',
    },
    // nord：Nord 调色板（极光/霜色，适配浅或中明度背景）
    nord: {
        '--md-h1-color': '#5e81ac', '--md-h2-color': '#88c0d0', '--md-h3-color': '#a3be8c',
        '--md-strong-color': '#d08770', '--md-em-color': '#b48ead', '--md-link-color': '#5e81ac',
        '--md-quote-color': '#4c566a',
        '--md-h1-bg': 'rgba(94,129,172,.12)', '--md-h2-bg': 'rgba(136,192,208,.12)', '--md-h3-bg': 'rgba(163,190,140,.12)',
        '--md-quote-bg': 'rgba(76,86,106,.12)', '--md-code-bg': 'rgba(76,86,106,.14)', '--md-fence-bg': 'rgba(76,86,106,.12)',
    },
};

// 枚举所有方案名（与主界面约定顺序一致），供选择器 UI 直接消费。
export const EDITOR_SYNTAX_SCHEME_NAMES = Object.keys(EDITOR_SYNTAX_SCHEMES);

/**
 * 由命名调色板生成「按方案作用域」的 CSS 文本（纯函数，无 DOM 依赖）。
 * 每个方案输出形如：
 *   [data-md-syntax-scheme="nord"] { --md-h1-color: ...; ... }
 * 由于 CSS 自定义属性可继承，只要 data-md-syntax-scheme 挂在该变量消费方
 * （.cm-content 子树）的任意祖先上，即可真正生效——切换属性即切换调色板。
 * @returns {string}
 */
export function buildEditorSyntaxSchemeCss() {
    return Object.entries(EDITOR_SYNTAX_SCHEMES).map(([name, vars]) => {
        const decls = Object.entries(vars)
            .map(([k, v]) => `  ${k}: ${v};`)
            .join('\n');
        return `[data-md-syntax-scheme="${name}"] {\n${decls}\n}`;
    }).join('\n\n');
}

const EDITOR_SCHEME_STYLE_ID = 'md-editor-syntax-schemes';

/**
 * 将命名调色板注入文档 <head>（浏览器环境，幂等）。仅在 document 存在时执行，
 * 保证在 node --test 等无 DOM 环境安全跳过。注入后即使 data 属性后续才挂上，
 * 规则也会在元素出现时自动生效。
 */
export function injectEditorSyntaxSchemeStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(EDITOR_SCHEME_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = EDITOR_SCHEME_STYLE_ID;
    style.textContent = buildEditorSyntaxSchemeCss();
    document.head.appendChild(style);
}

// 模块加载即注入（浏览器扩展环境），无需调用方显式触发。
injectEditorSyntaxSchemeStyles();
