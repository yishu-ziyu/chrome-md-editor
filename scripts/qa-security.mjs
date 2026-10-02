// Real Chromium regression of the production preview sanitizer and Mermaid engine.
// Deliberately no extension CSP: sanitizer failures must not be masked by CSP.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const source = readFileSync(new URL('../src/editor.js', import.meta.url), 'utf8');
const start = source.indexOf('const PREVIEW_PURIFY_CONFIG =');
const end = source.indexOf('// Markdown-it 初始化', start);
assert.ok(start >= 0 && end > start, 'production sanitizer section found');
const sanitizer = source.slice(start, end);
const initStart = source.indexOf('mermaid.initialize({');
const initEnd = source.indexOf('});', initStart) + 3;
assert.ok(initStart >= 0 && initEnd > initStart, 'production Mermaid initialization found');
const mermaidInit = source.slice(initStart, initEnd);
assert.doesNotMatch(source, /securityLevel:\s*['"](?:loose|antiscript)['"]/, 'every production theme must keep strict Mermaid security');
const bundled = await build({
  stdin: {
    contents: `import DOMPurify from 'dompurify'; import MarkdownIt from 'markdown-it'; import mermaid from 'mermaid';\n${sanitizer}\n${mermaidInit}\nglobalThis.qa={sanitizePreviewHtml,sanitizeMermaidSvg,md:new MarkdownIt({html:true}),mermaid};`,
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="preview"></div>');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    globalThis.__xss = 0;
    const root = document.getElementById('preview');
    const samples = [
      '<img src="invalid" onerror="globalThis.__xss++">',
      '<script>globalThis.__xss++</script>',
      '<a href="javascript:globalThis.__xss++">unsafe</a>',
      '<a href="java&#x09;script:globalThis.__xss++">unsafe</a>',
      '<a href="data:text/html,<script>alert(1)</script>">unsafe</a>',
      '<iframe srcdoc="<script>parent.__xss++</script>"></iframe>',
      '<svg><a xlink:href="javascript:alert(1)">unsafe</a></svg>',
      '<form><input formaction="javascript:alert(1)"></form>',
    ];
    for (const sample of samples) {
      root.innerHTML = qa.sanitizePreviewHtml(qa.md.render(sample));
      await new Promise(resolve => setTimeout(resolve, 30));
      if (root.querySelector('script, iframe, object, embed, form, svg') ||
          [...root.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value.replace(/[\t\r\n]/g,''))))) || globalThis.__xss) {
        throw new Error('Unsafe HTML survived: ' + sample);
      }
    }
    root.innerHTML = qa.sanitizePreviewHtml(qa.md.render('# Safe heading\n\n**bold** [safe](https://example.com)\n\n<mark>highlight</mark>'));
    if (!root.querySelector('h1') || !root.querySelector('strong') || !root.querySelector('mark') || root.querySelector('a').getAttribute('href') !== 'https://example.com') throw new Error('Safe formatting regressed');
    root.innerHTML = qa.sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.__xss++"><script>globalThis.__xss++</script><a href="javascript:globalThis.__xss++"><text>x</text></a></svg>');
    if (root.querySelector('script,[onload],a[href^="javascript:"]')) throw new Error('Unsafe SVG survived');
    const {svg} = await qa.mermaid.render('qa-mermaid', 'graph TD\n A[Safe] --> B[Diagram]\n click A "javascript:globalThis.__xss++"');
    root.innerHTML = qa.sanitizeMermaidSvg(svg);
    if (!root.querySelector('svg') || root.querySelector('script,[onclick],a[href^="javascript:"]') || globalThis.__xss) throw new Error('Mermaid safety/diagram regression');
    return {maliciousHtmlCases:samples.length, safeFormatting:true, maliciousSvg:true, mermaidStrict:true, xssExecutions:globalThis.__xss};
  });
  console.log('SECURITY_PREVIEW_OK ' + JSON.stringify(result));
} finally { await browser.close(); }
