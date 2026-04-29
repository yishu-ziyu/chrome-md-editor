import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePreviewLinkClickTarget,
  resolvePreviewLinkTarget,
} from '../src/link-support.js';

test('resolvePreviewLinkTarget keeps remote links clickable', () => {
  assert.equal(
    resolvePreviewLinkTarget('https://pmthinking.notion.site/example', {}),
    'https://pmthinking.notion.site/example'
  );
});

test('resolvePreviewLinkTarget resolves relative links against file url context', () => {
  assert.equal(
    resolvePreviewLinkTarget('../notes/next.md', {
      currentFileUrl: 'file:///Users/demo/docs/focus/current.md',
    }),
    'file:///Users/demo/docs/notes/next.md'
  );
});

test('resolvePreviewLinkTarget rejects unsafe and empty links', () => {
  assert.equal(resolvePreviewLinkTarget('javascript:alert(1)', {}), null);
  assert.equal(resolvePreviewLinkTarget('#local-heading', {}), null);
  assert.equal(resolvePreviewLinkTarget('', {}), null);
});

test('resolvePreviewLinkClickTarget finds links from clicked text nodes', () => {
  const link = {
    closest(selector) {
      return selector === 'a[href]' ? this : null;
    },
    getAttribute(name) {
      return name === 'href' ? 'https://example.com/article' : null;
    },
  };
  const textNode = { parentElement: link };
  const previewContainer = {
    contains(element) {
      return element === link;
    },
  };

  assert.equal(
    resolvePreviewLinkClickTarget(textNode, previewContainer, {}),
    'https://example.com/article'
  );
});
