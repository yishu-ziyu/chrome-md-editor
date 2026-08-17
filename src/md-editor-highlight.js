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
