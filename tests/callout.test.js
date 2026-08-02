/**
 * callout.test.js — A-7 Callout 提示框（M4 嵌套 blockquote 检测修复）单测
 *
 * 覆盖：
 *   - 普通 callout 渲染为 callout-<type> class + data-callout 属性
 *   - 嵌套 blockquote（marker 在前）正常识别
 *   - 回归：marker 位于嵌套引用之后（M4 旧逻辑会命中内层 paragraph 漏检外层）
 *   - 非 callout 普通引用块不误加 class
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { calloutPlugin } from '../src/callout.js';

function render(mdText) {
  const md = new MarkdownIt();
  md.use(calloutPlugin);
  return md.render(mdText);
}

test('callout: 普通 callout 被识别', () => {
  const html = render('> [!NOTE]\n> 备注内容\n');
  assert.ok(html.includes('callout callout-note'), '应加 callout-note class');
  assert.ok(html.includes('data-callout="NOTE"'), '应带 data-callout 属性');
});

test('callout: 嵌套 blockquote（marker 在前）正常识别', () => {
  const html = render('> [!TIP]\n> > 内层引用\n> 外层正文\n');
  assert.ok(html.includes('callout callout-tip'), '外层 callout-tip 应识别');
});

test('callout: marker 位于嵌套引用之后（M4 回归）', () => {
  // 外层 blockquote 首个直接子节点是嵌套 blockquote（首 paragraph_open 属内层），
  // [!NOTE] 在其后的外层段落。旧逻辑遇首个 paragraph_open（内层）即停 → 漏检外层；
  // 新逻辑（depth 计数跳过内层）应正确识别外层 callout。
  // 注意：空 ">" 行用于分隔内层 blockquote 与外层段落（避免 markdown-it 惰性合并）。
  const html = render('> > inner\n>\n> [!NOTE]\n> body\n');
  assert.ok(html.includes('callout callout-note'), '外层 callout-note 应被识别（M4 修复）');
  assert.ok(html.includes('data-callout="NOTE"'), '外层应带 data-callout=NOTE');
});

test('callout: 非 callout 普通引用块不加 class', () => {
  const html = render('> 普通引用\n');
  assert.ok(!html.includes('callout callout-'), '普通引用不应加 callout class');
});

test('callout: 未知类型回退为类型名本身', () => {
  const html = render('> [!CUSTOM]\n> 自定义\n');
  assert.ok(html.includes('callout callout-custom'), '未知类型应生成 callout-custom');
  assert.ok(html.includes('data-callout="CUSTOM"'), '应保留原始类型');
});
