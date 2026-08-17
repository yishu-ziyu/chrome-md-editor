/**
 * 单元测试：本次新功能的纯逻辑部分（对应 code-review 复审指出的 M1 修复）。
 *
 * 覆盖范围：
 *   - bracketMatchMap 构建正确性（无 undefined 污染、各符号 type/dir 正确）
 *   - findPairedBracket 括号栈匹配（含嵌套、中文引号）
 *   - findSelfPair 自身配对符号就近匹配（英文引号/反引号）
 *
 * 说明：H1（closeBrackets 经 languageData 配置）、L1（selectedBracketHighlight
 * 的 ViewPlugin 缓存）与查找/替换面板均依赖 CodeMirror + DOM 运行时，无法在
 * node 纯环境单测；其正确性已由构建（npm run build）通过 + 浏览器/EXE 侧
 * 探针日志（src/probe.js）运行时验证。本文件覆盖可纯逻辑验证的 M1 部分。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIR_GROUPS,
  SELF_PAIRS,
  bracketMatchMap,
  findSelfPair,
  findPairedBracket,
} from '../src/bracket-utils.js';

// ─── M1: bracketMatchMap 构建正确性 ────────────────────────────────────────

test('M1: bracketMatchMap 无 undefined 键污染', () => {
  assert.equal('undefined' in bracketMatchMap, false);
});

test('M1: 英文单/双引号与反引号为 self 类型且 other 指向自身', () => {
  assert.deepEqual(bracketMatchMap["'"], { other: "'", type: 'self' });
  assert.deepEqual(bracketMatchMap['"'], { other: '"', type: 'self' });
  assert.deepEqual(bracketMatchMap['`'], { other: '`', type: 'self' });
});

test('M1: 中文双引号开/闭 dir 正确 (pair)', () => {
  assert.deepEqual(bracketMatchMap['“'], { other: '”', dir: 1, type: 'pair' });
  assert.deepEqual(bracketMatchMap['”'], { other: '“', dir: -1, type: 'pair' });
});

test('M1: 中文单引号与全角圆括号 dir 正确 (pair)', () => {
  assert.equal(bracketMatchMap['‘'].dir, 1);
  assert.equal(bracketMatchMap['’'].dir, -1);
  assert.equal(bracketMatchMap['（'].dir, 1);
  assert.equal(bracketMatchMap['）'].dir, -1);
});

test('M1: PAIR_GROUPS/SELF_PAIRS 覆盖全部需求符号', () => {
  const flat = PAIR_GROUPS.flat();
  // 中文双引号 / 单引号 / 全角括号
  assert.ok(flat.includes('“') && flat.includes('”'));
  assert.ok(flat.includes('‘') && flat.includes('’'));
  assert.ok(flat.includes('（') && flat.includes('）'));
  // 英文 ()[]{}<>
  for (const c of ['(', ')', '[', ']', '{', '}', '<', '>']) {
    assert.ok(flat.includes(c), `PAIR_GROUPS 应包含 ${c}`);
  }
  // 英文引号 / 反引号（自身配对）
  for (const c of ["'", '"', '`']) {
    assert.ok(SELF_PAIRS.includes(c), `SELF_PAIRS 应包含 ${c}`);
  }
});

// ─── findPairedBracket: 括号栈匹配 ──────────────────────────────────────────

test('findPairedBracket: 简单括号配对', () => {
  const doc = 'a(b)c';
  const info = bracketMatchMap['('];
  assert.equal(findPairedBracket(doc, '(', info, 1), 3);
});

test('findPairedBracket: 嵌套括号跳过内层', () => {
  const doc = 'a(b[c]d)e';
  const info = bracketMatchMap['('];
  // 最外 ')' 在索引 8（a( b[ c] d ) e → 索引: 0a 1( 2b 3[ 4c 5] 6d 7) 8e）
  assert.equal(findPairedBracket(doc, '(', info, 1), 7);
});

test('findPairedBracket: 中文双引号配对', () => {
  const doc = '说“你好”结束';
  // 索引: 0说 1“ 2你 3好 4” 5结 6束
  const info = bracketMatchMap['“'];
  assert.equal(findPairedBracket(doc, '“', info, 1), 4);
});

test('findPairedBracket: 全角圆括号配对', () => {
  const doc = '甲（乙）丙';
  // 0甲 1（ 2乙 3） 4丙
  const info = bracketMatchMap['（'];
  assert.equal(findPairedBracket(doc, '（', info, 1), 3);
});

test('findPairedBracket: 无配对返回 null', () => {
  const doc = 'a(b';
  const info = bracketMatchMap['('];
  assert.equal(findPairedBracket(doc, '(', info, 1), null);
});

// ─── findSelfPair: 自身配对就近匹配 ─────────────────────────────────────────

test('findSelfPair: 闭引号向前就近找开引号', () => {
  const doc = "he said 'hello' then 'world'";
  // 索引: 0h1e2 3s4a5i6d7 8'9h10e11l12l13o14'15 16t17h18e19n20 21'22w23o24r25l26d27'
  const secondClose = doc.indexOf("'", 11); // 第二个 ' 的索引 = 14（闭引号，前有奇数个 '）
  assert.equal(findSelfPair(doc, "'", secondClose), 8); // 向前就近找开引号，在索引 8
});

test('findSelfPair: 开引号向后就近找闭引号', () => {
  const doc = "he said 'hello' then";
  // 索引: 0h1e2 3s4a5i6d7 8'9h10e11l12l13o14'15 16t17h18e19n
  const open = doc.indexOf("'"); // 第一个 ' 的索引 = 8（开引号，前有偶数个 '）
  assert.equal(findSelfPair(doc, "'", open), 14); // 向后就近找闭引号，在索引 14
});

test('findSelfPair: 反引号就近匹配', () => {
  const doc = 'a `code` b';
  const open = doc.indexOf('`');
  assert.equal(findSelfPair(doc, '`', open), 7); // 闭 ` 在 7
});

test('findSelfPair: 无配对返回 null', () => {
  const doc = "only one ' quote";
  const open = doc.indexOf("'");
  assert.equal(findSelfPair(doc, "'", open), null);
});

// ─── BUG5-2 回归：选中「闭符号」时装饰数组天然逆序，Decoration.set 必须传 sort ──
// 现场堆栈（360Chrome，assets/editor.js:551 → RangeSet.of）：
//   Error: Ranges must be added sorted by `from` position and `startSide`
//     at zt.addInner → zt.add → L.of → q.set(Decoration.set)
//     at Vr.fromClass.decorations.build   ← selectedBracketHighlight.build
// 触发路径是鼠标框选（MouseSelection.move → select → dispatch）时选区恰好为
// 一个闭符号，整个 ViewPlugin 被 CM6 卸载。

test('findPairedBracket: 选中闭符号时配对位置在选区之前（装饰数组必然逆序）', () => {
  const doc = '(alpha) "beta" `gamma`';
  for (const ch of [')', '"', '`']) {
    const from = doc.lastIndexOf(ch);
    const matchPos = findPairedBracket(doc, ch, bracketMatchMap[ch], from);
    assert.ok(Number.isInteger(matchPos), `${ch} 应能找到配对位置`);
    assert.ok(
      matchPos < from,
      `${ch} 的配对位置应在选区之前（matchPos=${matchPos} < from=${from}）`,
    );
  }
});

// 注意（脆弱点评估，按 team-lead 选项 a 保留反向断言）：
// 以下 `assert.throws(() => Decoration.set(ranges))` 是【反向断言】——它断言的是
// 第三方库 @codemirror/view（^6.36.4，caret 范围）在「不排序」的误用下会抛异常。
// 该断言依赖 CM6 内部行为（RangeSet.of 当前为未排序抛错；若上游未来改为静默自动
// 排序，则本断言会在源码完全正确的情况下失败）。因此：若某天此断言因上游变更而失败，
// 【应先改这条断言，而非删掉源码里的 sort=true】——删 sort 会让真实场景（选中闭符号）
// 重新崩溃。下方正向断言 `Decoration.set(ranges, true).size === 2` 不依赖该内部行为，
// 作为主证据；反向断言仅作「防手贱」护栏，失败信号应指向测试而非源码。
test('Decoration.set: 逆序数组必须显式排序，否则抛 RangeSet 未排序错误', async () => {
  const { Decoration } = await import('@codemirror/view');
  const deco = Decoration.mark({ class: 'cm-bracket-match-active' });
  // selectedBracketHighlight.build 的固定书写顺序：先选区、后配对位置。
  // 选中闭符号时 matchPos < sel.from，数组即为逆序。
  const selFrom = 20;
  const matchPos = 3;
  const ranges = [deco.range(selFrom, selFrom + 1), deco.range(matchPos, matchPos + 1)];
  assert.throws(
    () => Decoration.set(ranges),
    /Ranges must be added sorted/,
    '不传 sort 时必须复现线上崩溃，证明该参数不可省略',
  );
  assert.equal(Decoration.set(ranges, true).size, 2, '传 sort=true 后应正常构建');
});

// ─── BUG5-2 调用点回归锁（补测试盲区）──────────────────────────────────────
// 盲区说明：上面那条锁的是 @codemirror/view 这个【库函数】的契约（不传 sort 会抛），
// 它压根没读业务源码 —— 即便有人把 src/editor.js 里的 sort=true 删掉，上面的测试
// 依然全绿。第三轮迭代中确实发生过「审计声称 editor.js 的 Decoration.set 缺 sort」
// 的争议，而整套 node --test 无法证伪任何一方，根因正是这个盲区。
// 因此本测试直接扫描 src/ 下【全部】 Decoration.set 调用点，强制每一处显式传
// sort=true。相比只钉死 editor.js 单行，通配扫描能让任何【新增】的装饰构建漏传
// 立刻变红（与 .gitignore 用 dist_*/ 通配替代逐个打补丁是同一条教训）。
test('src/ 内所有 Decoration.set 调用点必须显式传 sort=true', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const srcDir = path.join(import.meta.dirname, '..', 'src');

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(srcDir);

  // 从左括号起做括号配平，取出完整实参文本（跨行安全）
  const extractArgs = (text, openIdx) => {
    let depth = 0;
    for (let i = openIdx; i < text.length; i += 1) {
      const c = text[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(openIdx + 1, i);
      }
    }
    return null;
  };

  // 仅按【顶层】逗号切分，数组/对象字面量内部的逗号不算分隔符
  const topLevelArgs = (args) => {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < args.length; i += 1) {
      const c = args[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) {
        out.push(args.slice(start, i));
        start = i + 1;
      }
    }
    out.push(args.slice(start));
    return out.map((s) => s.trim()).filter((s) => s.length > 0);
  };

  const NEEDLE = 'Decoration.set(';
  const offenders = [];
  let callCount = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let idx = text.indexOf(NEEDLE);
    while (idx !== -1) {
      callCount += 1;
      const args = extractArgs(text, idx + NEEDLE.length - 1);
      const parts = args == null ? [] : topLevelArgs(args);
      if (parts.length < 2 || parts[1] !== 'true') {
        const line = text.slice(0, idx).split('\n').length;
        offenders.push(`${path.basename(file)}:${line} → 实参 ${JSON.stringify(parts)}`);
      }
      idx = text.indexOf(NEEDLE, idx + NEEDLE.length);
    }
  }

  // 元防御：若扫描逻辑本身失效（路径写错、一个文件都没读到），callCount 会是 0，
  // offenders 也是空 —— 测试将「因为什么都没查」而假绿。这条断言堵住该失效模式。
  assert.ok(
    callCount >= 3,
    `应至少扫到 3 处 Decoration.set 调用（editor.js×1 + block-drag.js×2），` +
      `实际只扫到 ${callCount} 处，说明扫描逻辑或路径已失效`,
  );
  assert.deepEqual(
    offenders,
    [],
    `以下调用点缺少 sort=true —— 逆序装饰会让 RangeSet.of 抛错、ViewPlugin 被 CM6 ` +
      `整个卸载（连带选区拖拽等交互失效）：\n  ${offenders.join('\n  ')}`,
  );
});
