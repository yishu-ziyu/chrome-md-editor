// ============================================================
// 块拖拽（Block Drag）
// 翻译自 markra_block-drag.ts（纯 CM6 + 原生 DOM + 内联 theme）。
// 在每个块首行行首插入拖拽工具栏（拖拽手柄 + 插入块按钮），支持
// HTML5 drag 与 pointer 事件兜底，源块标记 / 落点虚线指示 / 拖拽残影。
// 全部样式走内联 EditorView.theme + 少量全局类（见 editor.css）。
// ============================================================
import { syntaxTree } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

export function readCodeMirrorFrontmatter(docText) {
  if (typeof docText !== "string" || !docText.startsWith("---")) return null;
  const lines = docText.split("\n");
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || trimmed === "...") {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) return null;
  let to = 0;
  for (let i = 0; i < endLine; i += 1) to += lines[i].length + 1;
  return { from: 0, to, kind: "yaml" };
}

export function readCodeMirrorBlockRanges(state) {
  const ranges = [];
  const frontmatter = readCodeMirrorFrontmatter(state.doc.toString());
  if (frontmatter) {
    ranges.push({
      from: state.doc.lineAt(frontmatter.from).from,
      name: `Frontmatter:${frontmatter.kind}`,
      to: state.doc.lineAt(frontmatter.to).to,
    });
  }

  const appendListItems = (list, depth) => {
    let child = list.firstChild;
    while (child) {
      if (child.name === "ListItem") {
        const line = state.doc.lineAt(child.from);
        ranges.push({
          depth,
          from: line.from,
          name: child.name,
          to: state.doc.lineAt(child.to).to,
        });
        let nested = child.firstChild;
        while (nested) {
          if (nested.name === "BulletList" || nested.name === "OrderedList") {
            appendListItems(nested, depth + 1);
          }
          nested = nested.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  };

  let node = syntaxTree(state).topNode.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (!frontmatter || node.from >= frontmatter.to) {
      if (node.name === "BulletList" || node.name === "OrderedList") {
        appendListItems(node, 0);
      } else {
        const from = state.doc.lineAt(node.from).from;
        const to = state.doc.lineAt(node.to).to;
        if (to > from) ranges.push({ from, name: node.name, to });
      }
    }
    node = next;
  }
  let runStart = 0;
  while (runStart < state.doc.lines) {
    const first = state.doc.line(runStart + 1);
    if (first.length > 0) {
      runStart += 1;
      continue;
    }
    let runEnd = runStart;
    while (
      runEnd + 1 < state.doc.lines &&
      state.doc.line(runEnd + 2).length === 0
    ) {
      runEnd += 1;
    }
    for (let index = runStart + 1; index < runEnd; index += 1) {
      const line = state.doc.line(index + 1);
      ranges.push({ from: line.from, name: "EmptyLine", to: line.to });
    }
    runStart = runEnd + 1;
  }

  // 末块延展至文档末尾：吸收文档尾随的纯空白/换行，使「末块覆盖到文档末尾」
  // 成立（拖拽语义上，尾随换行归属于最后一个真实块，不单独成块）。
  if (ranges.length > 0 && ranges[ranges.length - 1].to < state.doc.length) {
    ranges[ranges.length - 1].to = state.doc.length;
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

// 不依赖 CM6 的纯函数：判断某偏移是否落在某个块的首行（isBlockStart）。
export function isBlockStart(blocks, from) {
  if (!Array.isArray(blocks) || typeof from !== "number") return false;
  return blocks.some((block) => block && block.from === from);
}

function blockByFrom(state, from) {
  return readCodeMirrorBlockRanges(state).find((range) => range.from === from) ?? null;
}

function minimalDocumentChange(current, next) {
  let from = 0;
  while (
    from < current.length &&
    from < next.length &&
    current[from] === next[from]
  ) {
    from += 1;
  }

  let currentTo = current.length;
  let nextTo = next.length;
  while (
    currentTo > from &&
    nextTo > from &&
    current[currentTo - 1] === next[nextTo - 1]
  ) {
    currentTo -= 1;
    nextTo -= 1;
  }

  return {
    from,
    insert: next.slice(from, nextTo),
    to: currentTo,
  };
}

function listMarkerMatch(state, block) {
  return /^(\s*)([-+*]|\d+[.)])(\s+)/u.exec(
    state.doc.lineAt(block.from).text,
  );
}

function markdownColumnWidth(value) {
  let column = 0;
  for (const character of value) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}

function findLastListBlockAtDepth(blocks, depth) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block && block.name === "ListItem" && block.depth === depth) return block;
  }
  return undefined;
}

function normalizedListDrop(state, blocks, source, target, side, requestedDepth) {
  const stationary = blocks.filter(
    (block) => block.from < source.from || block.from >= source.to,
  );
  const targetIndex = stationary.findIndex((block) => block.from === target.from);
  const previous = side === "after"
    ? target
    : stationary[targetIndex - 1] ?? null;
  // Horizontal pointer movement can request a level whose parent does not
  // exist. Clamp it here so the moved `-` remains a parsed list marker.
  const maximumDepth = previous && previous.name === "ListItem"
    ? (previous.depth ?? 0) + 1
    : target.name === "ListItem"
      ? target.depth ?? 0
      : 0;
  const depth = Math.min(Math.max(0, requestedDepth), maximumDepth);

  const sameLevel = [target, previous].find(
    (block) => block && block.name === "ListItem" && block.depth === depth,
  );
  if (sameLevel) {
    return {
      depth,
      indentation: (listMarkerMatch(state, sameLevel) || [])[1] ?? "",
    };
  }

  const contextEnd = side === "after" ? targetIndex : targetIndex - 1;
  const preceding = stationary.slice(0, contextEnd + 1);
  const parent = findLastListBlockAtDepth(preceding, depth - 1);
  const parentMarker = parent ? listMarkerMatch(state, parent) : null;
  if (parentMarker) {
    return {
      depth,
      // Ordered markers need wider child indentation than `- `, so align to
      // the parent's actual content column instead of assuming two spaces.
      indentation: " ".repeat(markdownColumnWidth(parentMarker[0])),
    };
  }

  const reference = findLastListBlockAtDepth(preceding, depth);
  return {
    depth,
    indentation: reference
      ? (listMarkerMatch(state, reference) || [])[1] ?? "  ".repeat(depth)
      : "  ".repeat(depth),
  };
}

export function moveCodeMirrorBlock(view, sourceFrom, targetFrom, side, targetDepth) {
  if (view.state.facet(EditorState.readOnly)) return false;
  const blocks = readCodeMirrorBlockRanges(view.state);
  const source = blocks.find((block) => block.from === sourceFrom);
  const target = blocks.find((block) => block.from === targetFrom);
  if (!source || !target) return false;
  if (
    source.from === target.from ||
    (target.from > source.from && target.from < source.to)
  ) {
    return false;
  }

  const document = view.state.doc.toString();
  const movingIntoList = source.name !== "ListItem" && target.name === "ListItem";
  const drop = targetDepth !== undefined &&
      (source.name === "ListItem" || movingIntoList)
    ? normalizedListDrop(
        view.state,
        blocks,
        source,
        target,
        side,
        targetDepth,
      )
    : null;
  let sourceMarkdown = document.slice(source.from, source.to);
  if (source.name === "ListItem" && drop) {
    const sourceIndentation = /^[\t ]*/u.exec(sourceMarkdown)?.[0] ?? "";
    const indentationDelta = markdownColumnWidth(drop.indentation) -
      markdownColumnWidth(sourceIndentation);
    if (indentationDelta !== 0) {
      sourceMarkdown = sourceMarkdown
        .split("\n")
        .map((line) => {
          const indentation = /^[\t ]*/u.exec(line)?.[0] ?? "";
          const nextIndentation = Math.max(
            0,
            markdownColumnWidth(indentation) + indentationDelta,
          );
          return `${" ".repeat(nextIndentation)}${line.slice(indentation.length)}`;
        })
        .join("\n");
    }
  }
  if (movingIntoList) {
    const targetLine = view.state.doc.lineAt(target.from).text;
    const marker = /^(\s*)([-+*]|\d+[.)])\s+/u.exec(targetLine);
    if (marker) {
      const indentation = drop ? drop.indentation : marker[1] ?? "";
      const sourceMarker = marker[2] ?? "-";
      const prefix = `${indentation}${sourceMarker} `;
      const continuation = `${indentation}${" ".repeat(sourceMarker.length + 1)}`;
      sourceMarkdown = sourceMarkdown
        .split("\n")
        .map((line, index) => index === 0 ? `${prefix}${line}` : `${continuation}${line}`)
        .join("\n");
    }
  }

  const tight = (source.name === "ListItem" || movingIntoList) &&
    target.name === "ListItem";
  return relocateRange(view, {
    insertedBeforeTarget: side === "before",
    requiredBreaks: tight ? 1 : 2,
    sourceFrom: source.from,
    sourceMarkdown,
    sourceTo: source.to,
    targetPosition: side === "before" ? target.from : target.to,
  });
}

// 把 [sourceFrom, sourceTo) 的文本整体搬到 targetPosition，并规范化前后空行。
// 从 moveCodeMirrorBlock 抽出，供「语法块拖拽」与「选区临时块拖拽」共用。
function relocateRange(view, options) {
  const {
    insertedBeforeTarget = false,
    requiredBreaks,
    selectMoved = false,
    sourceFrom,
    sourceMarkdown,
    sourceTo,
    targetPosition,
  } = options;
  const document = view.state.doc.toString();

  let deletionFrom = sourceFrom;
  let deletionTo = sourceTo;
  if (deletionTo < document.length) {
    while (document[deletionTo] === "\n") deletionTo += 1;
  } else {
    while (deletionFrom > 0 && document[deletionFrom - 1] === "\n") {
      deletionFrom -= 1;
    }
  }
  if (targetPosition > deletionFrom && targetPosition < deletionTo) return false;

  // 上面的删除会把紧邻源块的整段换行一并吞掉（无上限）。这段空白是「跟着块走」
  // 的分隔符：不把它带到目标端，插入侧就只按 requiredBreaks 补（=1 个空行），
  // 于是「3 个连续空行」被压成 1 个。记录吞掉的换行数，供插入侧兜底。
  const carriedBreaks = deletionTo - sourceTo > 0
    ? deletionTo - sourceTo
    : sourceFrom - deletionFrom;

  const withoutSource = document.slice(0, deletionFrom) + document.slice(deletionTo);
  const mappedTarget = targetPosition <= deletionFrom
    ? targetPosition
    : targetPosition - (deletionTo - deletionFrom);
  let leftBreaks = 0;
  for (
    let index = mappedTarget - 1;
    index >= 0 && withoutSource[index] === "\n";
    index -= 1
  ) {
    leftBreaks += 1;
  }
  let rightBreaks = 0;
  for (
    let index = mappedTarget;
    index < withoutSource.length && withoutSource[index] === "\n";
    index += 1
  ) {
    rightBreaks += 1;
  }
  // 携带的空白只还原到**一侧**——落点新造出来的那条边界，也就是朝向目标块的一侧：
  //   side='before' → 块插在目标前，新边界是「块|目标」，落在后缀；
  //   side='after'  → 块插在目标后，新边界是「目标|块」，落在前缀。
  // 另一侧沿用原地已有的换行（照旧按 requiredBreaks 规范化），因此空行总量守恒，
  // 不会两边都被撑开。落点已在文末（无后缀可写）时，后缀那份改还到前缀。
  // carriedBreaks <= requiredBreaks 时两侧都退化成 requiredBreaks，与原行为
  // 逐字节一致——本改动只在「块紧邻 ≥2 个连续空行」时才生效。
  const hasRoomAfter = mappedTarget < withoutSource.length;
  const carried = Math.max(requiredBreaks, carriedBreaks);
  const prefixBreaks = insertedBeforeTarget && hasRoomAfter ? requiredBreaks : carried;
  const suffixBreaks = insertedBeforeTarget ? carried : requiredBreaks;
  const prefix = mappedTarget > 0
    ? "\n".repeat(Math.max(0, prefixBreaks - leftBreaks))
    : "";
  const suffix = hasRoomAfter
    ? "\n".repeat(Math.max(0, suffixBreaks - rightBreaks))
    : "";
  const inserted = `${prefix}${sourceMarkdown}${suffix}`;
  const nextDocument = withoutSource.slice(0, mappedTarget) +
    inserted +
    withoutSource.slice(mappedTarget);
  if (nextDocument === document) return false;
  const insertedFrom = mappedTarget + prefix.length;
  // A single transaction keeps whitespace normalization and the move in one
  // undo step, including when a paragraph becomes a list item.
  view.dispatch({
    changes: minimalDocumentChange(document, nextDocument),
    scrollIntoView: true,
    // 选区拖拽后保持选中，方便用户连续调整顺序；块拖拽只落光标。
    selection: selectMoved
      ? EditorSelection.range(insertedFrom, insertedFrom + sourceMarkdown.length)
      : EditorSelection.cursor(insertedFrom),
    userEvent: "move",
  });
  view.focus();
  return true;
}

// 选区起点向外吸附：取包含 position 的块里 from 最大者（最内层，扩张最小）；
// 若 position 落在块间空白（无块包含），取右侧最近块的 from。
function snapStartToBlock(blocks, position) {
  let best = null;
  for (const block of blocks) {
    if (block.from <= position && position <= block.to) {
      if (!best || block.from > best.from) best = block;
    }
  }
  if (best) return Math.min(best.from, position);
  let nearestRight = null;
  for (const block of blocks) {
    if (block.from >= position && (!nearestRight || block.from < nearestRight.from)) {
      nearestRight = block;
    }
  }
  return nearestRight ? nearestRight.from : position;
}

// 选区终点向外吸附：取包含 position 的块里 to 最小者（最内层，扩张最小）；
// 若 position 落在块间空白，取左侧最近块的 to。
function snapEndToBlock(blocks, position) {
  let best = null;
  for (const block of blocks) {
    if (block.from <= position && position <= block.to) {
      if (!best || block.to < best.to) best = block;
    }
  }
  if (best) return Math.max(best.to, position);
  let nearestLeft = null;
  for (const block of blocks) {
    if (block.to <= position && (!nearestLeft || block.to > nearestLeft.to)) {
      nearestLeft = block;
    }
  }
  return nearestLeft ? nearestLeft.to : position;
}

// 把当前非空选区对齐成一个临时块范围（选区可跨多个语法块）。
// 先按「整行」对齐，再把两端**向外吸附到所属块的边界**——只做行对齐会把围栏
// 代码块、表格、列表项从中间切断：只搬走半个块，剩下的半个成为孤立的
// ``` / | --- | --- | / 悬空列表项，Markdown 结构随即失配。吸附的块边界直接复用
// readCodeMirrorBlockRanges（与块拖拽同一事实源），列表按 ListItem 逐项吸附，
// 所以「选中列表中间两项」仍然只搬这两项，不会被撑成整个列表。
export function readSelectionBlockRange(state) {
  if (!state || state.selection.ranges.length !== 1) return null;
  const selection = state.selection.main;
  if (selection.empty) return null;
  const startLine = state.doc.lineAt(selection.from);
  // 选区右端停在行首是「整行选中」的常见形态（含末尾换行），
  // 回退一格避免把下一行也吞进临时块。
  const endPosition =
    selection.to > selection.from &&
    selection.to === state.doc.lineAt(selection.to).from
      ? selection.to - 1
      : selection.to;
  const endLine = state.doc.lineAt(endPosition);
  if (endLine.to <= startLine.from) return null;

  const blocks = readCodeMirrorBlockRanges(state);
  if (blocks.length === 0) return { from: startLine.from, to: endLine.to };
  const from = snapStartToBlock(blocks, startLine.from);
  const to = snapEndToBlock(blocks, endLine.to);
  // 纯空白选区两端可能反向交叉，退回行对齐范围，避免手柄凭空消失。
  if (to <= from) return { from: startLine.from, to: endLine.to };
  return { from, to };
}

// 把选区临时块整体移动到目标块之前/之后。
export function moveCodeMirrorSelection(view, sourceFrom, sourceTo, targetFrom, side) {
  if (view.state.facet(EditorState.readOnly)) return false;
  const document = view.state.doc.toString();
  if (
    !Number.isInteger(sourceFrom) ||
    !Number.isInteger(sourceTo) ||
    sourceFrom < 0 ||
    sourceTo <= sourceFrom ||
    sourceTo > document.length
  ) {
    return false;
  }
  const target = readCodeMirrorBlockRanges(view.state).find(
    (block) => block.from === targetFrom,
  );
  if (!target) return false;
  // 落点仍在选区内部 → 自我移动，无意义
  if (targetFrom >= sourceFrom && targetFrom < sourceTo) return false;

  return relocateRange(view, {
    insertedBeforeTarget: side === "before",
    requiredBreaks: 2,
    selectMoved: true,
    sourceFrom,
    sourceMarkdown: document.slice(sourceFrom, sourceTo),
    sourceTo,
    targetPosition: side === "before" ? target.from : target.to,
  });
}

export function addCodeMirrorBlockBelow(view, blockFrom) {
  if (view.state.facet(EditorState.readOnly)) return false;
  const block = blockByFrom(view.state, blockFrom);
  if (!block) return false;
  view.dispatch({
    changes: { from: block.to, insert: "\n\n" },
    selection: EditorSelection.cursor(block.to + 1),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

function blockControl(document, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.ariaLabel = label;
  button.title = label;
  button.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  return button;
}

const blockDragMime = "application/x-markra-codemirror-block";
const pointerDragThreshold = 4;
const defaultLabels = {
  addBlock: "在下方插入块",
  dragBlock: "拖拽块",
  dragSelection: "拖拽选中区域以调整顺序",
};

class BlockToolbarWidget extends WidgetType {
  constructor(blockFrom, labels) {
    super();
    this.labelsKey = JSON.stringify(labels);
    this.runtime = { blockFrom, toolbar: null };
    this.labels = labels;
  }

  get blockFrom() {
    return this.runtime.blockFrom;
  }

  eq(other) {
    if (this.labelsKey !== other.labelsKey) return false;

    const nextBlockFrom = other.blockFrom;
    other.runtime = this.runtime;
    this.runtime.blockFrom = nextBlockFrom;
    if (this.runtime.toolbar) {
      this.runtime.toolbar.dataset.blockFrom = String(nextBlockFrom);
    }
    return true;
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const toolbar = document.createElement("span");
    const add = blockControl(
      document,
      this.labels.addBlock,
      "markra-block-tool-button markra-block-add-button",
    );
    const drag = blockControl(
      document,
      this.labels.dragBlock,
      "markra-block-tool-button markra-block-drag-handle",
    );
    toolbar.className = "cm-markra-block-toolbar markra-block-toolbar";
    toolbar.dataset.blockFrom = String(this.blockFrom);
    this.runtime.toolbar = toolbar;
    for (let index = 0; index < 6; index += 1) {
      const dot = document.createElement("span");
      dot.className = "markra-block-drag-dot";
      drag.append(dot);
    }
    drag.draggable = true;
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      addCodeMirrorBlockBelow(view, this.blockFrom);
    });
    drag.addEventListener("dragstart", (event) => {
      if (event.dataTransfer) {
        event.dataTransfer.setData(blockDragMime, String(this.blockFrom));
        event.dataTransfer.effectAllowed = "move";
      }
      drag.dataset.dragging = "true";
      startBlockDragUi(view, this.blockFrom, event);
    });
    drag.addEventListener("dragend", () => {
      delete drag.dataset.dragging;
      clearBlockDragUi(view);
    });
    // Button drags do not reliably emit the HTML5 drag lifecycle in every
    // WebView, so pointer events provide the primary cross-platform path.
    drag.addEventListener("pointerdown", (event) => {
      startPointerBlockDrag(view, this.blockFrom, drag, event);
    });
    toolbar.append(add, drag);
    return toolbar;
  }
}

// 选区临时拖拽手柄：仅在存在非空选区时出现在选区首行左侧，
// 拖动它可把整个选区（按整行对齐）搬到别处。
class SelectionDragWidget extends WidgetType {
  constructor(from, to, label) {
    super();
    this.from = from;
    this.to = to;
    this.label = label;
  }

  eq(other) {
    return other.from === this.from &&
      other.to === this.to &&
      other.label === this.label;
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("span");
    const handle = blockControl(
      document,
      this.label,
      "markra-block-tool-button markra-selection-drag-handle",
    );
    for (let index = 0; index < 6; index += 1) {
      const dot = document.createElement("span");
      dot.className = "markra-block-drag-dot";
      handle.append(dot);
    }
    handle.dataset.selectionFrom = String(this.from);
    handle.dataset.selectionTo = String(this.to);
    handle.addEventListener("pointerdown", (event) => {
      startPointerSelectionDrag(view, this.from, this.to, handle, event);
    });
    wrapper.className = "cm-markra-selection-toolbar markra-selection-toolbar";
    wrapper.append(handle);
    return wrapper;
  }
}

function selectionDecorationsFromState(state, labels) {
  if (state.facet(EditorState.readOnly)) return Decoration.none;
  const range = readSelectionBlockRange(state);
  if (!range) return Decoration.none;
  // 高亮必须覆盖**吸附后的完整范围**：吸附会把选区向外扩到块边界，
  // 只标首行的话用户看不到「实际会被搬走的是整块」，拖完才发现多搬了内容。
  const decorations = [
    Decoration.widget({
      // 排在块工具栏（side -2）之前，占据同一处左侧槽位。
      side: -3,
      widget: new SelectionDragWidget(range.from, range.to, labels.dragSelection),
    }).range(range.from),
  ];
  const lastLine = state.doc.lineAt(range.to);
  for (
    let lineNumber = state.doc.lineAt(range.from).number;
    lineNumber <= lastLine.number;
    lineNumber += 1
  ) {
    decorations.push(
      Decoration.line({ class: "markra-selection-drag-line" })
        .range(state.doc.line(lineNumber).from),
    );
  }
  return Decoration.set(decorations, true);
}

class SelectionDragViewPlugin {
  constructor(view, labels) {
    this.labels = labels;
    this.decorations = selectionDecorationsFromState(view.state, labels);
  }

  update(update) {
    // 选区手柄依赖 selection，必须监听 selectionSet（块手柄那套只看 docChanged）。
    if (
      update.docChanged ||
      update.selectionSet ||
      update.startState.facet(EditorState.readOnly) !==
        update.state.facet(EditorState.readOnly)
    ) {
      this.decorations = selectionDecorationsFromState(update.state, this.labels);
    }
  }
}

function blockDecorationsFromRanges(blocks, labels) {
  const decorations = blocks.flatMap((block) => {
    const attributes = { "data-markra-block-from": String(block.from) };
    if (block.depth !== undefined) attributes["data-list-depth"] = String(block.depth);
    return [
      // Decoration.line 的 spec 只识别 class / attributes 两个键。
      // 早先把 data-* 平铺在 spec 顶层，CM6 会静默忽略，导致 .cm-line 上
      // 根本没有 data-markra-block-from：dropTarget 的首选分支永远落空，
      // 退化到 posAtCoords 兜底（side 恒为 "after"），于是「向上拖」被当成
      // 「拖到目标块之后」= 放回原位，落点指示器也从不显示。
      Decoration.line({ attributes }).range(block.from),
      Decoration.widget({
        // Block tools must be the outermost start-of-line widget. Heading-level
        // controls also use side -1, and their negative gutter margin would
        // otherwise pull the drag handle back over the H1-H6 button.
        side: -2,
        widget: new BlockToolbarWidget(block.from, labels),
      }).range(block.from),
    ];
  });
  return Decoration.set(decorations, true);
}

function updateOnlyInsertsPlainText(update) {
  if (!update.docChanged) return false;
  let onlyInsert = true;
  update.changes.iterChanges((fromA, toA) => {
    if (toA > fromA) onlyInsert = false; // any deletion disqualifies
  });
  return onlyInsert;
}

function plainTextInputStaysInsideBlocks(update, blocks) {
  if (!updateOnlyInsertsPlainText(update)) return false;

  let insideExistingBlock = true;
  update.changes.iterChanges((fromA, toA) => {
    insideExistingBlock = insideExistingBlock &&
      fromA === toA &&
      blocks.some((block) =>
        block.name === "Paragraph" &&
        fromA >= block.from &&
        fromA <= block.to,
      );
  });
  return insideExistingBlock;
}

function mapBlockRanges(blocks, update) {
  return blocks.map((block) => ({
    ...block,
    from: update.changes.mapPos(block.from, -1),
    to: update.changes.mapPos(block.to, 1),
  }));
}

function syntaxTreeChanged(startState, endState) {
  return syntaxTree(startState) !== syntaxTree(endState);
}

function eventElement(event) {
  return event.target instanceof Element
    ? event.target
    : event.target instanceof Node
      ? event.target.parentElement
      : null;
}

function dropTarget(event, view) {
  const element = eventElement(event) &&
    eventElement(event).closest("[data-markra-block-from], [data-block-from]");
  // 必须先判 element 存在：element 为 null 时 Number(null) === 0 且
  // Number.isInteger(0) 为真，会直接走进下面的分支对 null 调
  // getBoundingClientRect 抛 TypeError；该异常发生在 pointermove/pointerup
  // 监听器内，导致 pointerup 里的 moveCodeMirrorBlock 永远执行不到——
  // 表现为「拖得动、松手却不排序」。
  const from = element
    ? Number(element.dataset.markraBlockFrom ?? element.dataset.blockFrom)
    : Number.NaN;
  if (element && Number.isInteger(from)) {
    const rect = element.getBoundingClientRect();
    const side = rect && event.clientY < rect.top + rect.height / 2
      ? "before"
      : "after";
    const currentDepth = Number(element.dataset.listDepth);
    const pointerDepth = rect && Number.isInteger(currentDepth)
      ? Math.max(0, Math.round((event.clientX - rect.left - 22) / 22))
      : undefined;
    return {
      depth: pointerDepth,
      element: element,
      from,
      side,
    };
  }
  try {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) return null;
    const block = readCodeMirrorBlockRanges(view.state).find(
      (candidate) => position >= candidate.from && position <= candidate.to,
    );
    return block
      ? { depth: block.depth, element: null, from: block.from, side: "after" }
      : null;
  } catch {
    return null;
  }
}

const blockDragUi = new WeakMap();

function clearBlockDragUi(view) {
  const ui = blockDragUi.get(view);
  if (!ui) return;
  if (ui.source) ui.source.classList.remove("markra-block-drag-source");
  ui.indicator.remove();
  ui.ghost.remove();
  view.dom.removeAttribute("data-dragging");
  view.dom.ownerDocument.documentElement.removeAttribute(
    "data-markra-block-dragging",
  );
  blockDragUi.delete(view);
}

function startBlockDragUi(view, sourceFrom, event, ghostLabel) {
  clearBlockDragUi(view);
  const source = view.dom.querySelector(
    `.cm-line[data-markra-block-from="${sourceFrom}"]`,
  );
  const indicator = view.dom.ownerDocument.createElement("span");
  const ghost = view.dom.ownerDocument.createElement("span");
  indicator.className = "markra-block-drop-indicator";
  indicator.dataset.show = "false";
  ghost.className = "markra-block-drag-ghost";
  ghost.dataset.show = "true";
  ghost.textContent = ghostLabel ||
    (source && source.textContent && source.textContent.trim()) ||
    "Markdown 块";
  ghost.style.left = `${event.clientX + 12}px`;
  ghost.style.top = `${event.clientY + 12}px`;
  ghost.style.transform = "translate(0, 0)";
  view.dom.append(indicator, ghost);
  if (source) source.classList.add("markra-block-drag-source");
  view.dom.dataset.dragging = "true";
  view.dom.ownerDocument.documentElement.dataset.markraBlockDragging = "true";
  if ("dataTransfer" in event && event.dataTransfer && event.dataTransfer.setDragImage) {
    event.dataTransfer.setDragImage(ghost, 12, 12);
  }
  blockDragUi.set(view, { ghost, indicator, source });
}

function updateBlockDragUi(view, target, event) {
  const ui = blockDragUi.get(view);
  if (!ui || !target.element) return;
  const rect = target.element.getBoundingClientRect();
  ui.indicator.style.left = `${rect.left}px`;
  ui.indicator.style.top = `${target.side === "before" ? rect.top : rect.bottom}px`;
  ui.indicator.style.width = `${rect.width}px`;
  ui.indicator.dataset.show = "true";
  ui.ghost.style.left = `${event.clientX + 12}px`;
  ui.ghost.style.top = `${event.clientY + 12}px`;

  const scroll = view.dom.closest(".paper-scroll");
  if (!scroll) return;
  const scrollRect = scroll.getBoundingClientRect();
  if (event.clientY < scrollRect.top + 48) scroll.scrollTop -= 18;
  if (event.clientY > scrollRect.bottom - 48) scroll.scrollTop += 18;
}

// 通用指针拖拽会话（语法块手柄 / 选区临时手柄共用）。
// options: { ghostFrom, ghostLabel, onDrop(target) }
function startPointerDragSession(view, handle, event, options) {
  if (event.button !== 0 || view.state.facet(EditorState.readOnly)) return;
  event.preventDefault();
  event.stopPropagation();

  const document = view.dom.ownerDocument;
  const pointerId = event.pointerId;
  const originX = event.clientX;
  const originY = event.clientY;
  let dragging = false;

  const cleanup = () => {
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    document.removeEventListener("pointercancel", handlePointerCancel, true);
    delete handle.dataset.dragging;
  };
  const handlePointerMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (!dragging) {
      const distance = Math.hypot(
        moveEvent.clientX - originX,
        moveEvent.clientY - originY,
      );
      if (distance < pointerDragThreshold) return;
      dragging = true;
      handle.dataset.dragging = "true";
      startBlockDragUi(view, options.ghostFrom, moveEvent, options.ghostLabel);
    }

    const target = dropTarget(moveEvent, view);
    if (target) updateBlockDragUi(view, target, moveEvent);
    moveEvent.preventDefault();
  };
  const handlePointerUp = (upEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    cleanup();
    if (!dragging) return;

    const target = dropTarget(upEvent, view);
    if (target) options.onDrop(target);
    clearBlockDragUi(view);
    upEvent.preventDefault();
    upEvent.stopPropagation();
  };
  const handlePointerCancel = (cancelEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    cleanup();
    clearBlockDragUi(view);
  };

  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerup", handlePointerUp, true);
  document.addEventListener("pointercancel", handlePointerCancel, true);
}

function startPointerBlockDrag(view, sourceFrom, handle, event) {
  startPointerDragSession(view, handle, event, {
    ghostFrom: sourceFrom,
    onDrop: (target) =>
      moveCodeMirrorBlock(view, sourceFrom, target.from, target.side, target.depth),
  });
}

function startPointerSelectionDrag(view, sourceFrom, sourceTo, handle, event) {
  const text = view.state.doc.sliceString(sourceFrom, sourceTo).trim();
  startPointerDragSession(view, handle, event, {
    ghostFrom: sourceFrom,
    ghostLabel: text || "选中区域",
    onDrop: (target) =>
      moveCodeMirrorSelection(view, sourceFrom, sourceTo, target.from, target.side),
  });
}

function draggedBlockFrom(event) {
  const value = (event.dataTransfer && event.dataTransfer.getData(blockDragMime)) || "";
  const from = Number(value);
  return Number.isInteger(from) ? from : null;
}

class BlockDragViewPlugin {
  constructor(view, labels) {
    this.labels = labels;
    this.blocks = view.state.facet(EditorState.readOnly)
      ? []
      : readCodeMirrorBlockRanges(view.state);
    this.decorations = blockDecorationsFromRanges(this.blocks, labels);
  }

  update(update) {
    const readOnlyChanged =
      update.startState.facet(EditorState.readOnly) !==
      update.state.facet(EditorState.readOnly);
    if (
      !readOnlyChanged &&
      plainTextInputStaysInsideBlocks(update, this.blocks)
    ) {
      this.blocks = mapBlockRanges(this.blocks, update);
      this.decorations = blockDecorationsFromRanges(this.blocks, this.labels);
      return;
    }

    if (
      update.docChanged ||
      readOnlyChanged ||
      syntaxTreeChanged(update.startState, update.state)
    ) {
      this.blocks = update.state.facet(EditorState.readOnly)
        ? []
        : readCodeMirrorBlockRanges(update.state);
      this.decorations = blockDecorationsFromRanges(this.blocks, this.labels);
    }
  }
}

const blockDragTheme = EditorView.theme({
  ".cm-markra-block-toolbar": {
    display: "inline-flex",
    gap: "0.15em",
    marginInlineStart: "-1.4em",
    marginInlineEnd: "0.45em",
    opacity: "0.15",
    verticalAlign: "middle",
  },
  ".cm-line:hover > .cm-markra-block-toolbar, .cm-markra-block-toolbar:focus-within": {
    opacity: "1",
  },
  ".cm-markra-block-toolbar > button": {
    background: "transparent",
    border: "0",
    color: "inherit",
    cursor: "pointer",
    padding: "0 0.15em",
  },
  ".cm-markra-block-toolbar > .markra-block-drag-handle": {
    cursor: "grab",
  },
  ".markra-block-drag-dot": {
    display: "inline-block",
    width: "0.18em",
    height: "0.18em",
    borderRadius: "50%",
    background: "currentColor",
    opacity: "0.7",
    margin: "0 0.04em",
  },
  // 选区手柄用 width:0 的 relative 外壳 + absolute 按钮，完全不占 inline 宽度，
  // 出现/消失时正文不会左右跳动。
  ".cm-markra-selection-toolbar": {
    position: "relative",
    display: "inline-block",
    width: "0",
    height: "0",
    verticalAlign: "baseline",
  },
  ".cm-markra-selection-toolbar > .markra-selection-drag-handle": {
    position: "absolute",
    left: "-3.05em",
    top: "0",
    display: "inline-flex",
    alignItems: "center",
    background: "var(--markra-selection-handle-bg, rgba(120,140,220,0.18))",
    border: "0",
    borderRadius: "4px",
    color: "var(--markra-selection-handle-fg, #4a63c8)",
    cursor: "grab",
    padding: "0.1em 0.2em",
  },
  ".cm-markra-selection-toolbar > .markra-selection-drag-handle:hover": {
    background: "var(--markra-selection-handle-bg-hover, rgba(120,140,220,0.34))",
  },
  ".cm-markra-selection-toolbar > .markra-selection-drag-handle[data-dragging='true']": {
    cursor: "grabbing",
  },
  // 吸附后的完整范围底色：选区会向外吸附到块边界，浏览器原生选区只染到
  // 用户框选的那几个字符，用户看不到「实际会被搬走的是整块」。这条底色把
  // 吸附扩出来的行也染上，拖之前就能看清搬运范围。
  ".markra-selection-drag-line": {
    background: "var(--markra-selection-range-bg, rgba(120,140,220,0.13))",
  },
  // 选区激活时让位给临时手柄；用 visibility 保留占位，避免正文横向跳动。
  ".markra-selection-drag-line > .cm-markra-block-toolbar": {
    visibility: "hidden",
  },
  ".markra-block-drag-ghost": {
    position: "fixed",
    zIndex: "1000",
    pointerEvents: "none",
    background: "var(--markra-block-ghost-bg, rgba(120,120,140,0.92))",
    color: "var(--markra-block-ghost-fg, #fff)",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "0.85em",
    maxWidth: "40vw",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    opacity: "0.9",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  },
});

// 返回扩展数组（CME 无 markra defineMarkraPlugin 包装器，直接返回扩展）。
export function codeMirrorBlockDragPlugin(options = {}) {
  const labels = { ...defaultLabels, ...(options.labels || {}) };
  return [
    ViewPlugin.define(
      (view) => new BlockDragViewPlugin(view, labels),
      { decorations: (plugin) => plugin.decorations },
    ),
    ViewPlugin.define(
      (view) => new SelectionDragViewPlugin(view, labels),
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.domEventHandlers({
      dragover(event, view) {
        const target = dropTarget(event, view);
        if (draggedBlockFrom(event) === null || !target) {
          return false;
        }
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        updateBlockDragUi(view, target, event);
        return true;
      },
      drop(event, view) {
        const sourceFrom = draggedBlockFrom(event);
        const target = dropTarget(event, view);
        if (sourceFrom === null || !target) return false;
        const handled = moveCodeMirrorBlock(
          view,
          sourceFrom,
          target.from,
          target.side,
          target.depth,
        );
        clearBlockDragUi(view);
        if (!handled) return false;
        event.preventDefault();
        return true;
      },
    }),
    blockDragTheme,
  ];
}

// 便于其它模块复用：直接导出 markdown 语言扩展构造（保持单一 EditorView 一致性）。
export { markdown };
