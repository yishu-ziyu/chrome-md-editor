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
    ['<p><mark>important</mark></p>', ['<mark>important</mark>']],
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
  // v1.4.4 以规范图标按钮重建样式工具栏（非原始碎片）
  for (const id of ['btnStyleCenter','btnStyleBold','btnStyleHighlight','btnColor','btnFontSize']) {
    assert.ok(html.includes('id="' + id + '"'), 'clean style toolbar button: ' + id);
  }
  assert.ok(html.includes('style-toolbar-group'), 'style toolbar group container');
  // Clean highlighter lives with B/I format tools (preview selection, not HTML chip wall)
  assert.ok(html.includes('id="btnHighlight"'), 'preview highlight control');
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
