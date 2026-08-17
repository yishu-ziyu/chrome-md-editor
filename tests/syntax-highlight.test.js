/**
 * 单元测试：A-8 高亮语法（==高亮==）渲染 + 回写闭环。
 *
 * 覆盖：
 *  1) markdown-it + highlightPlugin 渲染 `==重点==` → 含 <mark>重点</mark>；
 *  2) htmlToMarkdown('<mark>重点</mark>') → 还原为 ==重点==（WYSIWYG 回写闭环）；
 *  3) editor.js 的 sanitizePreviewHtml 的 ADD_TAGS 含 'mark'（DOMPurify 放行，
 *     否则 <mark> 被静默剥除）。
 *
 * 与 html-to-markdown-bug1-3.test.js 一致：用真实 markdown-it + linkedom 提供 parseHTML。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseHTML } from 'linkedom';
import { highlightPlugin } from '../src/highlight-plugin.js';
import { htmlToMarkdown } from '../src/html-to-markdown.js';

// 与 editor.js 配置对齐（html:true 以支持既有 font/center 标记，breaks:true）
const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
md.use(highlightPlugin);

test('A-8 渲染：==重点== 产出 <mark>重点</mark>', () => {
  const html = md.render('这是 ==重点== 内容');
  assert.ok(html.includes('<mark>重点</mark>'), `渲染结果应包含 <mark>重点</mark>，实际：${html}`);
});

test('A-8 渲染：独立行 ==高亮== 仍被识别', () => {
  const html = md.render('==高亮==');
  assert.ok(html.includes('<mark>高亮</mark>'), `渲染结果应包含 <mark>高亮</mark>，实际：${html}`);
});

test('A-8 回写：<mark>重点</mark> 还原为 ==重点==', () => {
  const out = htmlToMarkdown('<mark>重点</mark>', { parseHTML });
  // htmlToMarkdown 约定末尾补一个 \n（与 BUG-1/3 测试一致），此处按套件约定去尾换行校验。
  assert.equal(out.replace(/\n$/, ''), '==重点==', `回写结果应为 ==重点==，实际：${JSON.stringify(out)}`);
});

test('A-8 回写：渲染后回写应保证一致性（round-trip）', () => {
  const src = '这是 ==重点== 内容';
  const html = md.render(src);
  const out = htmlToMarkdown(html, { parseHTML });
  assert.ok(out.includes('==重点=='), `回写应保留 ==重点==，实际：${JSON.stringify(out)}`);
});

test('A-8 白名单：editor.js sanitizePreviewHtml 的 ADD_TAGS 含 mark', () => {
  const editorSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/editor.js'),
    'utf8'
  );
  // 精确匹配 ADD_TAGS: ['font', 'center', 'mark']（顺序容忍，但必须含 'mark'）
  const m = editorSrc.match(/ADD_TAGS:\s*\[([^\]]*)\]/);
  assert.ok(m, 'editor.js 应包含 ADD_TAGS 配置');
  const tags = m[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  assert.ok(tags.includes('mark'), `ADD_TAGS 应含 'mark'，实际：${tags.join(', ')}`);
});
