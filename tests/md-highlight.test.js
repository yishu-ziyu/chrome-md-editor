// ============================================================
// Markdown 语法高亮单元测试（Phase 5）
// ------------------------------------------------------------
// 覆盖：
//   1. 编辑区行底色纯函数 buildLineBgDecorations：标题分级(1-6)、
//      引用行、围栏代码块（起/止/内部）行分类正确性；
//   2. 编辑区 StateField（lineBgDecorations）集成：经 EditorState
//      构造后装饰随文档正确生成；
//   3. 预览区 createMarkdownHighlight：hljs 11 新 API 产出
//      <span class="hljs-*">，未识别语言/抛错时回退转义（保持 XSS 防护）；
//   4. 模块导出结构：markdownHighlightStyle / mdEditorHighlightExtensions
//      与 createMarkdownHighlight / mdEscape 完整可用。
//
// 设计依据：Markdown 语法高亮（Phase 2 / Phase 3 / Phase 5）。
// 颜色由 CSS 变量定义，本测试只断言「分类（class）」正确，不绑定具体色值。
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  buildLineBgDecorations,
  lineBgDecorations,
  markdownHighlightStyle,
  mdEditorHighlightExtensions,
} from '../src/md-editor-highlight.js';
import { createMarkdownHighlight, mdEscape } from '../src/md-preview-highlight.js';

// —— 工具：构造 doc 并收集「行装饰」→ { 行号: [class...] } ——
// buildLineBgDecorations 为纯函数，接受 CM6 Text 文档（含 .lines / .line(i)）。
// 采用 RangeSet.between(from, to, f) 回调迭代（该版本 RangeSet.iter() 返回的
// HeapCursor 不暴露 done 属性，用 between 更稳健；回调签名 (from, to, value)）。
function collectLineClasses(docText) {
  const doc = EditorState.create({ doc: docText }).doc;
  const decoSet = buildLineBgDecorations(doc);
  return collectLineClassesFromSet(decoSet, doc);
}

// —— 工具：从已有 RangeSet 收集「行装饰」（用于 StateField 集成测试）——
function collectLineClassesFromSet(decoSet, doc) {
  const map = new Map();
  decoSet.between(0, doc.length, (from, to, value) => {
    // 仅取零长度装饰（Decoration.line 行底色），排除潜在的 mark 装饰。
    if (from === to && value && value.spec && value.spec.class) {
      const lineNo = doc.lineAt(from).number;
      const cls = value.spec.class;
      if (!map.has(lineNo)) map.set(lineNo, []);
      map.get(lineNo).push(cls);
    }
  });
  return map;
}

// 辅助：围栏代码块文档（避免模板字符串内反引号转义噪音）
function fenceDoc(...lines) {
  return lines.join('\n');
}

// ============================================================
// 一、编辑区行底色：标题分级
// ============================================================
test('编辑区行底色：标题 1~6 分级正确', () => {
  const doc = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n正文无装饰';
  const map = collectLineClasses(doc);
  assert.deepEqual(classAt(map, 1), ['cm-md-heading-1']);
  assert.deepEqual(classAt(map, 2), ['cm-md-heading-2']);
  assert.deepEqual(classAt(map, 3), ['cm-md-heading-3']);
  assert.deepEqual(classAt(map, 4), ['cm-md-heading-4']);
  assert.deepEqual(classAt(map, 5), ['cm-md-heading-5']);
  assert.deepEqual(classAt(map, 6), ['cm-md-heading-6']);
  // 第 7 行（普通正文）不应有任何行底色装饰
  assert.equal(map.has(7), false, '普通行不应有行底色');
});

test('编辑区行底色：标题后必须跟空格才识别（#后无空格不是标题）', () => {
  const doc = '#这不是标题\n# 这是标题';
  const map = collectLineClasses(doc);
  assert.equal(map.has(1), false, '#后无空格不应识别为标题行');
  assert.deepEqual(classAt(map, 2), ['cm-md-heading-1']);
});

// ============================================================
// 二、编辑区行底色：引用行
// ============================================================
test('编辑区行底色：引用行（行首 >，允许前导空白）分类正确', () => {
  const doc = '> 引用一行\n普通文本\n  > 缩进引用';
  const map = collectLineClasses(doc);
  assert.deepEqual(classAt(map, 1), ['cm-md-quote-line']);
  assert.equal(map.has(2), false, '普通行不应有引用行底色');
  assert.deepEqual(classAt(map, 3), ['cm-md-quote-line']);
});

// ============================================================
// 三、编辑区行底色：围栏代码块（起/止/内部）
// ============================================================
test('编辑区行底色：围栏代码块起止行与内部行均标记 cm-md-fence-line', () => {
  const doc = fenceDoc('```js', 'const a = 1;', '```', '正文');
  const map = collectLineClasses(doc);
  // 第 1 行：开 fence；第 2 行：块内；第 3 行：闭 fence；均应标记
  assert.deepEqual(classAt(map, 1), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 2), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 3), ['cm-md-fence-line']);
  assert.equal(map.has(4), false, '围栏外的普通行不应有 fence 行底色');
});

test('编辑区行底色：多段围栏代码块状态机正确翻转', () => {
  // 第一段 ```js ... ```，中间普通文本，第二段 ```python ... ```
  const doc = fenceDoc(
    '```js',
    'const a = 1;',
    '```',
    '普通段落',
    '```python',
    'print(2)',
    '```',
    '结尾'
  );
  const map = collectLineClasses(doc);
  // 第一段：1,2,3 为 fence
  assert.deepEqual(classAt(map, 1), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 2), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 3), ['cm-md-fence-line']);
  // 第 4 行普通段落不在围栏内
  assert.equal(map.has(4), false);
  // 第二段：5,6,7 为 fence（状态机已重新进入）
  assert.deepEqual(classAt(map, 5), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 6), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 7), ['cm-md-fence-line']);
  assert.equal(map.has(8), false);
});

// ============================================================
// 四、编辑区行底色：组合样本
// ============================================================
test('编辑区行底色：标题+引用+代码块组合样本分类正确', () => {
  const doc = fenceDoc(
    '# 标题',
    '> 引用',
    '```js',
    'const a = 1;',
    '```',
    '正文'
  );
  const map = collectLineClasses(doc);
  assert.deepEqual(classAt(map, 1), ['cm-md-heading-1']);
  assert.deepEqual(classAt(map, 2), ['cm-md-quote-line']);
  assert.deepEqual(classAt(map, 3), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 4), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 5), ['cm-md-fence-line']);
  assert.equal(map.has(6), false);
});

// ============================================================
// 五、StateField 集成：经 EditorState 构造后装饰正确生成
// ============================================================
test('StateField 集成：lineBgDecorations 随文档生成标题/引用/围栏装饰', () => {
  const docText = fenceDoc('# 标题', '> 引用', '```js', 'const a = 1;', '```', '正文');
  const state = EditorState.create({ doc: docText, extensions: [lineBgDecorations] });
  const decoSet = state.field(lineBgDecorations);
  assert.ok(decoSet, '应能从 state 读取 lineBgDecorations 字段');
  const map = collectLineClassesFromSet(decoSet, state.doc);
  assert.deepEqual(classAt(map, 1), ['cm-md-heading-1']);
  assert.deepEqual(classAt(map, 2), ['cm-md-quote-line']);
  assert.deepEqual(classAt(map, 3), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 4), ['cm-md-fence-line']);
  assert.deepEqual(classAt(map, 5), ['cm-md-fence-line']);
  assert.equal(map.has(6), false);
});

// ============================================================
// 六、模块导出结构
// ============================================================
test('编辑器高亮模块导出结构完整', () => {
  assert.ok(markdownHighlightStyle, 'markdownHighlightStyle 应已定义（HighlightStyle 实例）');
  assert.ok(Array.isArray(mdEditorHighlightExtensions), 'mdEditorHighlightExtensions 应为数组');
  assert.equal(mdEditorHighlightExtensions.length, 3, '应为 [syntaxHighlighting, lineBgDecorations, markdownMarkerDecorations]');
});

// ============================================================
// 七、预览区：createMarkdownHighlight + mdEscape
// ============================================================
test('预览高亮：createMarkdownHighlight 返回函数', () => {
  const hl = createMarkdownHighlight((x) => x);
  assert.equal(typeof hl, 'function', '工厂应返回 highlight 回调');
});

test('预览高亮：识别语言时产出 hljs token（class="hljs-*"）', () => {
  const identity = (x) => x; // 测试中不真正净化，仅验证 hljs 输出结构
  const hl = createMarkdownHighlight(identity);
  const out = hl('const x = 1;', 'js');
  // <code> 必须带 language-* class：mermaid 等下游渲染器靠 code.language-xxx
  // 选择器定位目标块，缺失会导致 Mermaid 图永不渲染（已确认的真实产品 BUG）。
  assert.ok(
    out.startsWith('<pre class="hljs"><code class="language-js">'),
    '外层应为 <pre class="hljs"><code class="language-js">'
  );
  assert.ok(out.endsWith('</code></pre>'), '应以 </code></pre> 结尾');
  assert.ok(out.includes('hljs-keyword'), 'js 关键字 const 应被 hljs 标记为 hljs-keyword');
});

test('预览高亮：mermaid 等 hljs 未收录语言仍须保留 language-* class', () => {
  const hl = createMarkdownHighlight((x) => x);
  const out = hl('graph TD\n A-->B', 'mermaid');
  assert.ok(
    out.includes('<code class="language-mermaid">'),
    'Mermaid 渲染依赖 code.language-mermaid 选择器，该 class 不可丢失'
  );
});

test('预览高亮：非法语言标识不得拼进 class 属性（属性注入防护）', () => {
  const hl = createMarkdownHighlight((x) => x);
  // fence info 完全由文档作者控制，可构造成闭合属性再注入事件处理器
  const payloads = [
    'js" onload="alert(1)',
    'js><script>alert(1)</script>',
    "js' onmouseover='x",
    'a'.repeat(64), // 超长标识
    'js x',         // 含空格
  ];
  for (const lang of payloads) {
    const out = hl('const x = 1;', lang);
    assert.ok(!out.includes('onload'), `不得注入事件处理器: ${lang}`);
    assert.ok(!out.includes('onmouseover'), `不得注入事件处理器: ${lang}`);
    assert.ok(!out.includes('<script'), `不得注入脚本标签: ${lang}`);
    assert.ok(
      out.startsWith('<pre class="hljs"><code>'),
      `非法标识应整体丢弃 class 属性: ${lang}`
    );
  }
});

test('预览高亮：合法语言标识（含 c++ / c# / f-sharp 风格）正常放行', () => {
  const hl = createMarkdownHighlight((x) => x);
  for (const lang of ['c++', 'c#', 'objective-c', 'asp.net', 'vue_sfc']) {
    const out = hl('x', lang);
    assert.ok(
      out.includes(`<code class="language-${lang}">`),
      `常规语言标识不应被误杀: ${lang}`
    );
  }
});

test('预览高亮：未识别语言/抛错时回退为转义原文（保持 XSS 防护）', () => {
  const identity = (x) => x;
  const hl = createMarkdownHighlight(identity);
  const out = hl('a < b & c > d', 'no-such-lang-xyz');
  // 回退路径必须经 mdEscape：尖括号与 & 被转义
  assert.ok(out.includes('&lt;'), '应转义 <');
  assert.ok(out.includes('&amp;'), '应转义 &');
  assert.ok(out.includes('&gt;'), '应转义 >');
  // 未识别语言不应出现 hljs token 包裹
  assert.ok(!out.includes('class="hljs-keyword"'), '未识别语言不应产生 hljs 关键字 span');
});

test('预览高亮：净化函数被调用（sanitize 外包不可回退）', () => {
  let called = false;
  const spy = (html) => { called = true; return html; };
  const hl = createMarkdownHighlight(spy);
  hl('const x = 1;', 'js');
  assert.equal(called, true, 'highlight 回调产出必须外包给 sanitize（XSS 防护链不回退）');
});

test('预览高亮：mdEscape 转义 & < >', () => {
  assert.equal(mdEscape('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(mdEscape(''), '');
});

// —— 小工具：取某行 class 列表（缺省空数组）——
function classAt(map, lineNo) {
  return map.get(lineNo) || [];
}
