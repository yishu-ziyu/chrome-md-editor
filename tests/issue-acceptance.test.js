/**
 * Strict acceptance tests mapped to GitHub Issues #1 #2 #3.
 * These are the contracts we owe reporters — fail closed, not wishful.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

import { resolvePreviewImageSource } from '../src/image-support.js';
import { htmlToMarkdown, normalizeMarkdown } from '../src/html-to-markdown.js';
import {
  buildLastFileRecord,
  isLastFileUsable,
  rememberLastFile,
  loadLastFile,
  clearLastFile,
  LAST_FILE_KEY,
} from '../src/session-restore.js';
import {
  newInstanceId,
  pendingFileStorageKey,
  editorUrlWithInstance,
} from '../src/instance-id.js';

function toMd(html) {
  return htmlToMarkdown(html, { parseHTML });
}

// ─── Issue #1 Q1: local image preview path resolution ───────────────────────

test('Issue #1 Q1: relative local image resolves under file:// markdown context', () => {
  const mdUrl = 'file:///Users/demo/project/notes/readme.md';
  const src = './images/photo.png';
  const resolved = resolvePreviewImageSource(src, { currentFileUrl: mdUrl });
  assert.equal(resolved, 'file:///Users/demo/project/notes/images/photo.png');
});

test('Issue #1 Q1: sibling folder image resolves with directory context (open folder)', () => {
  const resolved = resolvePreviewImageSource('images/a.png', {
    currentDirectoryPath: 'docs',
  });
  assert.equal(resolved, 'docs/images/a.png');
});

test('Issue #1 Q1: without context, relative local image stays unresolved (honest failure)', () => {
  assert.equal(resolvePreviewImageSource('images/a.png', {}), null);
});

test('Issue #1 Q1: real fixture path pattern matches file URL layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-issue1-'));
  const imgDir = join(dir, 'images');
  mkdirSync(imgDir);
  const imgPath = join(imgDir, 'dot.png');
  // 1x1 PNG
  writeFileSync(
    imgPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  const mdPath = join(dir, 'note.md');
  writeFileSync(mdPath, '![dot](images/dot.png)\n');
  const fileUrl = pathToFileURL(mdPath).href;
  const resolved = resolvePreviewImageSource('images/dot.png', {
    currentFileUrl: fileUrl,
  });
  assert.ok(resolved.startsWith('file://'));
  assert.ok(resolved.includes('images/dot.png') || resolved.endsWith('images/dot.png'));
  // file should exist at decoded path（用标准 API 还原文件系统路径，避免 Windows 双盘符）
  const decoded = fileURLToPath(resolved);
  assert.equal(readFileSync(decoded).length > 0, true);
});

// ─── Issue #1 Q2: WYSIWYG must not corrupt image path to blob/object URL ────

test('Issue #1 Q2: html→md prefers data-md-original-src over blob src', () => {
  const html = `<p><img src="blob:https://example/abc-123" data-md-original-src="images/photo.png" alt="photo"></p>`;
  const md = toMd(html);
  assert.match(md, /!\[photo\]\(images\/photo\.png\)/);
  assert.doesNotMatch(md, /blob:/);
});

test('Issue #1 Q2: without original attr, falls back to src (no silent empty)', () => {
  const html = `<p><img src="images/fallback.png" alt="x"></p>`;
  const md = toMd(html);
  assert.match(md, /!\[x\]\(images\/fallback\.png\)/);
});

test('Issue #1 Q2: normalizeMarkdown collapses runaway blank lines from preview edit', () => {
  const messy = 'hello\n\n\n\n\nworld\n';
  assert.equal(normalizeMarkdown(messy), 'hello\n\nworld');
});

// ─── Issue #2: restore last document ────────────────────────────────────────

test('Issue #2: last-file record shape is restorable', () => {
  const record = buildLastFileRecord({
    content: '# 上次的内容\n\n本地图 ![a](images/a.png)\n',
    filename: '工作笔记.md',
    sourceUrl: 'file:///tmp/工作笔记.md',
  });
  assert.equal(isLastFileUsable(record), true);
  assert.equal(record.filename, '工作笔记.md');
  assert.ok(record.content.includes('images/a.png'));
});

test('Issue #2: chrome.storage mock remember → load round-trip', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async set(obj) {
          Object.assign(store, obj);
        },
        async get(key) {
          if (typeof key === 'string') return { [key]: store[key] };
          return {};
        },
        async remove(key) {
          delete store[key];
        },
      },
    },
  };

  await clearLastFile();
  await rememberLastFile({
    content: 'restored body',
    filename: 'last.md',
    sourceUrl: null,
  });
  assert.ok(store[LAST_FILE_KEY]);
  const loaded = await loadLastFile();
  assert.equal(loaded.content, 'restored body');
  assert.equal(loaded.filename, 'last.md');
  await clearLastFile();
  assert.equal(await loadLastFile(), null);

  delete globalThis.chrome;
});

// ─── Issue #3: multi-instance + style HTML round-trip + toolbar tags ─────────

test('Issue #3: instance ids are unique enough for concurrent tabs', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newInstanceId()));
  assert.equal(ids.size, 50);
});

test('Issue #3: pending storage keys do not collide across instances', () => {
  const a = pendingFileStorageKey('aaa');
  const b = pendingFileStorageKey('bbb');
  assert.equal(a, 'pendingFile_aaa');
  assert.equal(b, 'pendingFile_bbb');
  assert.notEqual(a, b);
  assert.equal(pendingFileStorageKey(null), 'pendingFile');
});

test('Issue #3: editor URL carries instance id', () => {
  const url = editorUrlWithInstance('chrome-extension://id/src/editor.html', 'uuid-1');
  assert.equal(url, 'chrome-extension://id/src/editor.html?i=uuid-1');
});

test('Issue #3: mark / center / font / sup / sub survive html→md round-trip', () => {
  const samples = [
    // 高亮语法新增可逆 DOM：<mark>x</mark> → ==x==（不再保留 <mark> 标签）
    ['<p><mark>important</mark></p>', ['==important==']],
    // <b> may become **bold** markdown — center tag itself must remain
    ['<p><center><b>title</b></center></p>', ['<center>', 'title', '</center>']],
    ['<p><font color="red">红</font></p>', ['<font color="red">红</font>']],
    ['<p>X<sup>2</sup></p>', ['<sup>2</sup>']],
    ['<p>H<sub>2</sub>O</p>', ['<sub>2</sub>']],
  ];
  for (const [html, expectedSnippets] of samples) {
    const md = toMd(html);
    for (const expectedSnippet of expectedSnippets) {
      assert.ok(
        md.includes(expectedSnippet),
        `expected ${expectedSnippet} in:\n${md}`
      );
    }
  }
});

test('Issue #3: jarring style-preset banned, but clean style toolbar restored', () => {
  const html = readFileSync(new URL('../src/editor.html', import.meta.url), 'utf8');
  // Explicitly removed: 居粗/居红/仿宋字号等违和预设
  for (const id of [
    'btnCenterBold',
    'btnCenterBoldRed',
    'styleGroup',
  ]) {
    assert.equal(html.includes(`id="${id}"`), false, `style control should be gone: ${id}`);
  }
  // v1.4.4 以规范图标按钮重建样式工具栏；v1.8.2 合并入格式化组消除重复加粗
  // btnStyleBold 已由格式化组的 btnBold 统一替代（单一事实源）
  // style-toolbar-group 独立容器已合并入 toolbar-group 格式化组
  for (const id of ['btnStyleCenter','btnStyleHighlight','btnColor','btnFontSize']) {
    assert.ok(html.includes('id="' + id + '"'), 'clean style toolbar button: ' + id);
  }
  // v1.8.2 新增：上传图片按钮 + 侧栏拖拽条
  assert.ok(html.includes('id="btnImage"'), 'image upload button required');
  assert.ok(html.includes('id="resizerSidebar"'), 'sidebar resizer required');
  // v1.8.3 新增：多栏/对比合并入口按钮（问题 1 修复）
  assert.ok(html.includes('id="btnCompare"'), 'compare/multi-column entry button required');
  // 对比按钮须位于视图切换组（view-switch-group），与 Chrome 模式 / 工作区搜索并列
  const viewGroupIdx = html.indexOf('view-switch-group');
  const compareIdx = html.indexOf('id="btnCompare"');
  assert.ok(
    viewGroupIdx !== -1 && compareIdx !== -1 && compareIdx > viewGroupIdx,
    'btnCompare must live inside the view-switch-group'
  );
  // v1.5.1：高亮按钮合并为一个（原格式化组的 btnHighlight 已并入样式组 btnStyleHighlight），
  // 编辑区 / 预览区选中都走同一入口：源码包 <mark> + 预览同步渲染
  assert.equal(
    html.includes('id="btnHighlight"'),
    false,
    'duplicated highlight button must be merged into btnStyleHighlight'
  );
  assert.ok(html.includes('id="btnHelp"'), 'help button required for 说明书');
});

test('Issue #3: background opens multi-instance URLs (source contract)', () => {
  const bg = readFileSync(new URL('../public/background.js', import.meta.url), 'utf8');
  assert.match(bg, /newInstanceId/);
  assert.match(bg, /\?i=/);
  assert.match(bg, /pendingFile_/);
  // must NOT reuse single tab only
  assert.doesNotMatch(bg, /tabs\.query\(\s*\{\s*url:\s*chrome\.runtime\.getURL\('src\/editor\.html'\)/);
});

test('Issue #3: onboarding is a real user manual, not tip crumbs', () => {
  const ob = readFileSync(new URL('../src/onboarding.js', import.meta.url), 'utf8');
  assert.match(ob, /使用说明/);
  assert.match(ob, /本地图片/);
  assert.match(ob, /多标签|多窗口/);
  assert.match(ob, /允许访问文件网址/);
  assert.match(ob, /loadExampleFile/);
});

// ─── Issue #4 (v1.8.3): 预览区实时 Markdown 渲染 → 编辑器同步往返 ────────────
// 核心契约：用户在预览区输入含语法的字符串（如 **粗体**，显示），
// 预览区渲染为富文本（<strong>），编辑器须同步回含语法的源码（**粗体**，显示）。
// 本测试锁定「渲染产物 → htmlToMarkdown → 编辑器源码」这一回写链路的正确性。

test('Issue #4: 渲染后的 <strong> 回写为 **语法**，且保留后续纯文本', () => {
  const rendered = '<p><strong>这是测试文字</strong>，显示</p>';
  const md = toMd(rendered);
  assert.ok(md.includes('**这是测试文字**'), `应含 **这是测试文字**，实际: ${md}`);
  assert.ok(md.includes('，显示'), `应保留「，显示」，实际: ${md}`);
});

test('Issue #4: 行内代码 `code` 渲染产物回写为 `code` 源码', () => {
  const rendered = '<p>命令 <code>git status</code> 查看状态</p>';
  const md = toMd(rendered);
  assert.ok(md.includes('`git status`'), `应含 \`git status\`，实际: ${md}`);
  assert.ok(md.includes('查看状态'), `应保留「查看状态」，实际: ${md}`);
});

test('Issue #4: 标题渲染产物回写为 # 标题源码', () => {
  const rendered = '<h1>同步测试标题</h1>';
  const md = toMd(rendered);
  assert.match(md, /#\s+同步测试标题/);
});
