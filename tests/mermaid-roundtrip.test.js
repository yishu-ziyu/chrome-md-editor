/**
 * 回归测试：C-01 —— 预览区失焦回写会永久删除 Mermaid 代码块（Critical 数据丢失）。
 *
 * 缺陷链路：
 *   1. doUpdatePreview 把 ```mermaid 渲染出的 <pre><code class="language-mermaid">
 *      整块 replaceWith 成 <div class="mermaid-diagram">SVG</div>；
 *   2. 预览区是 contenteditable，失焦触发 syncPreviewToEditor；
 *   3. htmlToMarkdown 遇到 .mermaid-diagram 返回空串（无法逆向 SVG）；
 *   4. setEditorContent 用回写结果整体覆盖编辑器全文
 *      → 用户只是点了一下预览区又移开焦点，Mermaid 源码就被静默删光。
 *
 * 修复方式：渲染侧把原始 fence 写入 data-md-source，回写侧优先还原该属性。
 * 本测试用 linkedom 真实构造 DOM 后取 innerHTML（模拟浏览器属性序列化：
 * 属性值内的换行会被转义为 &#10;），再喂给 htmlToMarkdown，覆盖完整往返链路。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown } from '../src/html-to-markdown.js';

const FENCE = '```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```';

/**
 * 模拟 doUpdatePreview 渲染 Mermaid 后的预览区 HTML。
 * @param {object} opts
 * @param {string} [opts.fence] 原始 fence 源码；传 null 表示模拟「未写入 data-md-source 的历史节点」
 * @param {boolean} [opts.error] 是否模拟渲染失败分支（.mermaid-error）
 * @param {boolean} [opts.withZoomButton] 是否附加 mermaid-zoom.js 追加的全屏按钮
 * @param {string} [opts.before] 图表前的其他块级内容 HTML
 * @param {string} [opts.after] 图表后的其他块级内容 HTML
 * @returns {string} 预览容器的 innerHTML
 */
function buildPreviewHtml({
  fence = FENCE,
  error = false,
  withZoomButton = true,
  before = '',
  after = '',
} = {}) {
  const { document } = parseHTML(
    '<!DOCTYPE html><html><body><div id="preview"></div></body></html>'
  );
  const host = document.getElementById('preview');
  host.innerHTML = before;

  const div = document.createElement('div');
  div.className = error ? 'mermaid-error' : 'mermaid-diagram';
  if (fence !== null) div.setAttribute('data-md-source', fence);
  div.setAttribute('contenteditable', 'false');
  if (error) {
    div.textContent = 'Mermaid 渲染错误: Parse error on line 2';
  } else {
    div.innerHTML = '<svg id="mermaid-1"><g><text>开始</text><text>结束</text></g></svg>';
  }
  if (withZoomButton) {
    const btn = document.createElement('button');
    btn.className = 'mermaid-zoom-btn';
    btn.textContent = '⛶';
    div.appendChild(btn);
  }
  host.appendChild(div);

  if (after) host.insertAdjacentHTML('beforeend', after);
  return host.innerHTML;
}

test('C-01：渲染后的 Mermaid 图回写应还原原始 fence，源码不丢失', () => {
  const html = buildPreviewHtml();
  const out = htmlToMarkdown(html, { parseHTML });
  assert.ok(out.includes('```mermaid'), '必须还原 ```mermaid 起始围栏');
  assert.ok(out.includes('graph TD'), '必须还原图表源码正文');
  assert.ok(out.includes('A[开始] --> B[结束]'), '必须还原节点定义');
  assert.equal(out.trim(), FENCE, '回写结果应与原始 fence 完全一致');
});

test('C-01：图表前后的正文不应被吞掉，且图表位置保持不变', () => {
  const html = buildPreviewHtml({
    before: '<h1>标题</h1><p>图前说明</p>',
    after: '<p>图后说明</p>',
  });
  const out = htmlToMarkdown(html, { parseHTML });
  assert.ok(out.includes('# 标题'), '标题应保留');
  assert.ok(out.includes('图前说明'), '图前正文应保留');
  assert.ok(out.includes('图后说明'), '图后正文应保留');
  assert.ok(out.includes('```mermaid'), 'Mermaid 源码应保留');
  assert.ok(
    out.indexOf('图前说明') < out.indexOf('```mermaid') &&
      out.indexOf('```mermaid') < out.indexOf('图后说明'),
    '三者相对顺序应保持不变'
  );
});

test('C-01：渲染后的 SVG 文本与全屏按钮不得污染回写结果', () => {
  const html = buildPreviewHtml();
  const out = htmlToMarkdown(html, { parseHTML });
  assert.ok(!out.includes('⛶'), '缩放按钮字符不得进入 Markdown 源码');
  assert.ok(!out.includes('<svg'), 'SVG 标签不得进入 Markdown 源码');
});

test('C-01：Mermaid 渲染失败时也应还原源码，错误提示不得写进正文', () => {
  const html = buildPreviewHtml({ error: true });
  const out = htmlToMarkdown(html, { parseHTML });
  assert.equal(out.trim(), FENCE, '渲染失败分支同样要还原源码');
  assert.ok(
    !out.includes('Mermaid 渲染错误'),
    '错误提示属于 UI 文本，绝不能被回写进 Markdown 源码'
  );
});

test('C-01 兜底：缺失 data-md-source 的历史节点返回空串而非 SVG/错误文本', () => {
  const diagram = htmlToMarkdown(buildPreviewHtml({ fence: null }), { parseHTML });
  assert.ok(!diagram.includes('<svg'), '无源码可还原时也不得混入 SVG 文本');
  assert.ok(!diagram.includes('⛶'), '无源码可还原时也不得混入按钮文本');

  const errored = htmlToMarkdown(buildPreviewHtml({ fence: null, error: true }), { parseHTML });
  assert.ok(
    !errored.includes('Mermaid 渲染错误'),
    'mermaid-error 此前走 default 分支把错误提示写进正文，属同一根因的污染路径'
  );
});

test('C-01：data-md-source 还原对任意标签生效（不依赖 div）', () => {
  const { document } = parseHTML(
    '<!DOCTYPE html><html><body><div id="preview"></div></body></html>'
  );
  const host = document.getElementById('preview');
  const section = document.createElement('section');
  section.setAttribute('data-md-source', '```mermaid\npie title 占比\n```');
  section.textContent = '不可逆渲染产物';
  host.appendChild(section);

  const out = htmlToMarkdown(host.innerHTML, { parseHTML });
  assert.ok(out.includes('pie title 占比'), '还原逻辑应位于通用元素分支，不绑定标签名');
  assert.ok(!out.includes('不可逆渲染产物'), '有源码可还原时应忽略渲染产物文本');
});
