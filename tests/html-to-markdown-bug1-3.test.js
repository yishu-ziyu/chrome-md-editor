/**
 * 单元测试：BUG-1 / BUG-3 预览回写（src/html-to-markdown.js 的 htmlToMarkdown）。
 *
 * 背景：预览区 contenteditable 编辑（回车追加空段落、删除空段落、多段引用等）后，
 * 会把预览 HTML 回写为 Markdown。历史上两类缺陷：
 *   - BUG-1：一行为段的源码（段间无空行），回写后每段之间被错误插入一空行。
 *   - BUG-3：多段 `>` 引用，预览区删除空段 `>` 时，编辑区不跟随删除（回写丢失空段）。
 *
 * 本测试用真实 markdown-it（breaks:true）渲染源码，再用 linkedom 提供 parseHTML，
 * 模拟 contenteditable 的回车/删除行为，断言回写结果与预期一致、且无多余空行。
 *
 * 由临时复现脚本 repro_bug1.mjs 迁移而来，覆盖 BUG-1 情形 A/B、已有空行多段比对、
 * BUG-3 主场景/回车空段/删除空段/单引用多段回归/中间空段跳过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown } from '../src/html-to-markdown.js';

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });

// ---------- BUG-1：一行为段、段间无空行 ----------
test('BUG-1 情形A：预览末尾追加空 p 回写不应出现额外空行', () => {
  const src = '段落甲\n段落乙\n段落丙';
  const preview = md.render(src);
  const afterEnter = preview + '<p><br></p>'; // 模拟末尾敲回车追加空 p
  const out = htmlToMarkdown(afterEnter, { parseHTML });
  assert.equal(out.replace(/\n$/, ''), src);
});

test('BUG-1 情形B：contenteditable 拆成多 div 回写不应多出空行', () => {
  const afterEnterB = '<div>段落甲</div><div>段落乙</div><div>段落丙</div><div><br></div>';
  const out = htmlToMarkdown(afterEnterB, { parseHTML });
  assert.ok(!out.includes('\n\n段落乙'), '段落之间不应多出空行');
  assert.ok(!out.includes('段落甲\n\n'), '段落之间不应多出空行');
});

test('BUG-1 比对：已有空行的多段回写应保持一致', () => {
  const src = '段落甲\n\n段落乙\n\n段落丙';
  const preview = md.render(src);
  const out = htmlToMarkdown(preview, { parseHTML });
  assert.equal(out.replace(/\n$/, ''), src);
});

// ---------- BUG-3：多段 > 引用 ----------
test('BUG-3 主场景：多段引用回写应一致', () => {
  const src = '> 甲\n> 乙\n> 丙';
  const preview = md.render(src);
  const out = htmlToMarkdown(preview, { parseHTML });
  assert.equal(out.replace(/\n$/, ''), src);
});

test('BUG-3：块内新增空 p（回车）回写不应产生额外空段', () => {
  const src = '> 甲\n> 乙\n> 丙';
  const preview = md.render(src);
  const afterEnter = preview.replace(/<\/blockquote>/, '<p><br></p></blockquote>');
  const out = htmlToMarkdown(afterEnter, { parseHTML });
  assert.equal(out.replace(/\n$/, ''), src);
});

test('BUG-3：删除空段后回写应回到原源码（编辑区跟随删除）', () => {
  const src = '> 甲\n> 乙\n> 丙';
  const preview = md.render(src); // 删空段后回到原样
  const out = htmlToMarkdown(preview, { parseHTML });
  assert.equal(out.replace(/\n$/, ''), src);
});

test('BUG-3 回归：单引用多段落不应被折叠合并为单段', () => {
  const src = '> 甲\n>\n> 乙\n>\n> 丙'; // 单 blockquote 内含三个段落
  const preview = md.render(src);
  const out = htmlToMarkdown(preview, { parseHTML });
  assert.equal(out.replace(/\n+$/, ''), src);
});

test('BUG-3 回归：中间空段（删除内容后的空 p）应被跳过，不产生多余空 > 段', () => {
  const preview = '<blockquote>\n<p>甲</p>\n<p><br></p>\n<p>丙</p>\n</blockquote>';
  const out = htmlToMarkdown(preview, { parseHTML });
  assert.ok(!out.match(/^> $/m), '不应产生多余空 > 段');
});
