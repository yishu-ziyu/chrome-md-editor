/**
 * compare-acceptance.test.js — compare 模块禁用类名闸门（T8 / 验收闸门 §4）
 *
 * 既有 tests/issue-acceptance.test.js 只扫描 src/editor.html / src/onboarding.js /
 * public/background.js。本测试把同一套禁用类名闸门显式覆盖到全部 compare 模块源文件
 * （src/compare*.js / src/compare*.css / src/compare.html），用 fs 读取源文件 grep。
 *
 * 注意：compare 模块的实现文件中包含「禁止使用 btnCenterBold ...」之类的文档性注释，
 * 这些不应误判为实际用法。因此先剥离 JS 行注释 / 块注释 / HTML 注释，再对「实际代码/CSS」
 * 中的禁用类名做整词匹配。
 *
 * 禁用类名清单：
 *   - btnCenterBold
 *   - btnCenterBoldRed
 *   - styleGroup
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');

const BANNED = ['btnCenterBold', 'btnCenterBoldRed', 'styleGroup'];

/**
 * 去掉注释，避免文档性注释误报。
 *  - JS 块注释 /* ... *​/
 *  - JS 行注释 // ...
 *  - HTML 注释 <!-- ... -->
 * （URL 中的 // 亦会被一并去掉，但 compare 模块文件无含禁用名的 URL，不会造成误判。）
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** 列出所有 compare 模块源文件（js / css / html） */
function listCompareSources() {
  return readdirSync(SRC_DIR)
    .filter((f) => /^compare.*\.(js|css|html)$/.test(f))
    .map((f) => join(SRC_DIR, f));
}

const files = listCompareSources();

for (const banned of BANNED) {
  test(`compare 模块不得在实际代码/CSS 中出现禁用类名：${banned}`, () => {
    const re = new RegExp('\\b' + banned + '\\b');
    for (const file of files) {
      const cleaned = stripComments(readFileSync(file, 'utf8'));
      assert.equal(
        re.test(cleaned),
        false,
        `${file} 含有禁用类名实际用法：${banned}`
      );
    }
  });
}

test('compare 模块源文件集合非空（确保扫描确实覆盖到 compare 模块）', () => {
  assert.ok(files.length >= 10, `应扫描到 >=10 个 compare 源文件，实际 ${files.length}`);
});
