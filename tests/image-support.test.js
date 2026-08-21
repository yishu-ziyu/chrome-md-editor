import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPastedImageMarkdown,
  createPastedImageFilename,
  resolvePreviewImageSource,
} from '../src/image-support.js';

test('resolvePreviewImageSource keeps remote and data urls unchanged', () => {
  assert.equal(
    resolvePreviewImageSource('https://example.com/a.png', {}),
    'https://example.com/a.png'
  );
  assert.equal(
    resolvePreviewImageSource('data:image/png;base64,abc', {}),
    'data:image/png;base64,abc'
  );
});

test('resolvePreviewImageSource rejects javascript/vbscript/chrome schemes', () => {
  assert.equal(resolvePreviewImageSource('javascript:alert(1)', {}), null);
  assert.equal(resolvePreviewImageSource('vbscript:msgbox(1)', {}), null);
  assert.equal(resolvePreviewImageSource('chrome://settings', {}), null);
  assert.equal(
    resolvePreviewImageSource('chrome-extension://abc/icon.png', {}),
    'chrome-extension://abc/icon.png'
  );
});

test('resolvePreviewImageSource resolves relative path against file url context', () => {
  assert.equal(
    resolvePreviewImageSource('../assets/demo.png', {
      currentFileUrl: 'file:///Users/demo/docs/guide/readme.md',
    }),
    'file:///Users/demo/docs/assets/demo.png'
  );
});

test('resolvePreviewImageSource resolves relative path against directory context', () => {
  assert.equal(
    resolvePreviewImageSource('./images/demo.png', {
      currentDirectoryPath: 'notes/project',
    }),
    'notes/project/images/demo.png'
  );
});

test('resolvePreviewImageSource keeps unsupported relative paths unresolved when no context exists', () => {
  assert.equal(resolvePreviewImageSource('./images/demo.png', {}), null);
});

test('createPastedImageFilename uses a stable prefix and extension', () => {
  assert.match(
    createPastedImageFilename({
      timestamp: new Date('2026-04-19T10:11:12.000Z'),
      extension: 'png',
      randomSuffix: 'ab12',
    }),
    /^pasted-20260419-101112-ab12\.png$/
  );
});

test('buildPastedImageMarkdown inserts a relative image reference', () => {
  assert.equal(
    buildPastedImageMarkdown({
      alt: 'pasted-image',
      imagePath: 'images/pasted-20260419-101112.png',
    }),
    '![pasted-image](images/pasted-20260419-101112.png)'
  );
});

test('buildPastedImageMarkdown supports base64 image sources', () => {
  assert.equal(
    buildPastedImageMarkdown({
      alt: 'pasted-image',
      imagePath: 'data:image/png;base64,abc',
    }),
    '![pasted-image](data:image/png;base64,abc)'
  );
});
