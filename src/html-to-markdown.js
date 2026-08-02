// Pure HTML → Markdown helpers (preview WYSIWYG round-trip).
// Extracted so Issue #1 / #3 regressions can be unit-tested without a browser.

export function normalizeMarkdown(md) {
  const raw = String(md || '');
  const afterCRLF = raw.replace(/\r\n/g, '\n');
  const afterTab = afterCRLF.replace(/[ \t]+\n/g, '\n');
  const newlinesBefore = (afterTab.match(/\n/g) || []).length;
  const compressed = afterTab.replace(/\n{3,}/g, '\n\n');
  const newlinesAfter = (compressed.match(/\n/g) || []).length;
  const result = compressed.trim();
  
  return result;
}

export function reconstructRawTag(node, convertNodeFn) {
  const convert = convertNodeFn || convertNode;
  const tag = node.tagName.toLowerCase();
  const attrs = Array.from(node.attributes || [])
    .map((a) => ` ${a.name}="${a.value}"`)
    .join('');
  const childText = Array.from(node.childNodes).map(convert).join('');
  return `<${tag}${attrs}>${childText}</${tag}>`;
}

// Use numeric nodeType constants so this runs in Node tests (no global Node)
// and in the browser (DOM Node.TEXT_NODE === 3, ELEMENT_NODE === 1).
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// 折叠 <br> 紧随字面换行造成的多余换行（<br>\n → 单个 \n）。
// markdown-it 渲染软换行为 `<br>\n`，若直接把 <br> 转成 \n 再保留其后字面 \n，
// 会变成 \n\n（段间空行），导致预览回写时软换行被误判为段间空行。
// 这是 BUG-1（每行间被插入空行）与 BUG-3（blockquote 多出空 `>` 段）的共同根因。
function collapseSoftBreaks(s) {
  return String(s == null ? '' : s).replace(/\n{2,}/g, '\n');
}

export function convertNode(node) {
  if (node.nodeType === TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== ELEMENT_NODE) return '';

  // Skip bilingual reading translations injected into the preview
  if (
    node.classList?.contains('md-translation') ||
    node.getAttribute?.('data-md-translation') === '1'
  ) {
    return '';
  }

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map(convertNode).join('');
  const childText = children();

  switch (tag) {
    case 'h1':
      return `# ${childText.trim()}\n\n`;
    case 'h2':
      return `## ${childText.trim()}\n\n`;
    case 'h3':
      return `### ${childText.trim()}\n\n`;
    case 'h4':
      return `#### ${childText.trim()}\n\n`;
    case 'h5':
      return `##### ${childText.trim()}\n\n`;
    case 'h6':
      return `###### ${childText.trim()}\n\n`;
    case 'p': {
      // 折叠 <br> 后紧随的字面换行产生的多余空行（<br>\n → 单个软换行），
      // 避免预览回写把软换行误升级为段间空行（BUG-1 / BUG-3）。
      const collapsed = collapseSoftBreaks(childText);
      const out = `${collapsed.trim()}\n\n`;
      
      return out;
    }
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return `**${childText}**`;
    case 'em':
    case 'i':
      return `*${childText}*`;
    case 'del':
    case 's':
      return `~~${childText}~~`;
    case 'code':
      if (node.parentElement && node.parentElement.tagName === 'PRE') {
        return childText;
      }
      return `\`${childText}\``;
    case 'pre': {
      const codeEl = node.querySelector('code');
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
      const code = codeEl ? codeEl.textContent : childText;
      return `\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n\n`;
    }
    case 'blockquote': {
      // Callout：优先还原 [!TYPE] 语法，避免预览回写退化成普通引用
      if (node.classList && node.classList.contains('callout')) {
        const type = (node.getAttribute('data-callout') || 'NOTE').toUpperCase();
        // 收集 body：跳过 .callout-title 标题元素，其余 childNodes 正常转换
        let body = '';
        for (const child of node.childNodes) {
          if (child.nodeType === ELEMENT_NODE) {
            if (child.classList && child.classList.contains('callout-title')) continue;
            body += convertNode(child);
          } else if (child.nodeType === TEXT_NODE) {
            body += child.textContent;
          }
        }
        const lines = body.split('\n').map((l) => l.replace(/\s+$/, ''));
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        let out;
        if (lines.length === 0) {
          out = `> [!${type}]\n\n`;
        } else {
          out = lines.map((l, idx) => `> ${idx === 0 ? `[!${type}]` : l}`).join('\n') + '\n\n';
        }
        
        return out;
      }
      // BUG-3 修复：逐子块转换，软换行由 p/li 分支折叠，段间空行（多 <p> 引用的
      // 段落分隔）在此保留；空段（用户删除内容后的空 <p>）直接跳过，避免产生多余的空 `>` 段。
      // 注意：不可用 collapseSoftBreaks 整体塌陷 childText，否则会把段间空行误删，
      // 造成「多段落引用被合并成一段」的回归。
      const blocks = [];
      for (const child of node.childNodes) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        const txt = convertNode(child).replace(/\n+$/, '');
        if (txt.trim().length === 0) continue;
        blocks.push(txt);
      }
      // BUG-3 修复（统一方案）：逐块转换，块间插入一个空 > 行作为段落分隔，
      // 空块（用户删除内容后的空 <p>）直接跳过，避免产生多余的空 > 段；
      // 单 <p> 内含 <br> 软换行由块内逐行加 > 处理（lazy continuation）。
      const result = [];
      blocks.forEach((block, idx) => {
        if (idx > 0) result.push('>');
        for (const line of block.split('\n')) {
          const trimmed = line.replace(/\s+$/, '');
          if (trimmed.length === 0) continue;
          result.push(`> ${trimmed}`);
        }
      });
      const out = result.join('\n') + '\n\n';
      
      return out;
    }
    case 'ul': {
      let result = '';
      for (const li of node.children) {
        if (li.tagName === 'LI') {
          const checkbox = li.querySelector('input[type="checkbox"]');
          const prefix = checkbox
            ? checkbox.checked
              ? '- [x] '
              : '- [ ] '
            : '- ';
          const text = Array.from(li.childNodes)
            .filter((n) => n.tagName !== 'INPUT')
            .map(convertNode)
            .join('')
            .trim();
          result += `${prefix}${text}\n`;
        }
      }
      return result + '\n';
    }
    case 'ol': {
      let result = '';
      let i = 1;
      for (const li of node.children) {
        if (li.tagName === 'LI') {
          result += `${i}. ${convertNode(li).trim()}\n`;
          i++;
        }
      }
      return result + '\n';
    }
    case 'li':
      return collapseSoftBreaks(childText);
    case 'a': {
      const href = node.getAttribute('href') || '';
      return `[${childText}](${href})`;
    }
    case 'img': {
      // Prefer original markdown src after preview rewrites blob/object URLs
      const src =
        node.getAttribute('data-md-original-src') ||
        node.getAttribute('src') ||
        '';
      const alt = node.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }
    case 'hr':
      return '---\n\n';
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return childText;
      let result = '';
      rows.forEach((row, idx) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        result += '| ' + cells.map((c) => c.textContent.trim()).join(' | ') + ' |\n';
        if (idx === 0) {
          result += '| ' + cells.map(() => '------').join(' | ') + ' |\n';
        }
      });
      return result + '\n';
    }
    case 'input':
      return '';
    case 'div': {
      if (node.classList.contains('mermaid-diagram')) {
        return '';
      }
      return childText;
    }
    case 'mark':
    case 'center':
    case 'font':
    case 'span':
    case 'sup':
    case 'sub':
      return reconstructRawTag(node, convertNode);
    default:
      return childText;
  }
}

/**
 * Convert preview HTML back to Markdown source.
 * Browser: uses DOMParser.
 * Node tests: pass `parseHTML` from linkedom, which reliably builds a body tree.
 */
export function htmlToMarkdown(html, { DOMParserImpl, parseHTML } = {}) {
  if (typeof parseHTML === 'function') {
    const wrapped = `<!DOCTYPE html><html><body>${html}</body></html>`;
    const { document } = parseHTML(wrapped);
    const converted = convertNode(document.body);
    const result = normalizeMarkdown(converted) + '\n';
    
    return result;
  }

  const Parser = DOMParserImpl || globalThis.DOMParser;
  if (!Parser) {
    throw new Error('DOMParser or parseHTML is required for htmlToMarkdown');
  }
  const doc = new Parser().parseFromString(html, 'text/html');
  const converted = convertNode(doc.body);
  const result = normalizeMarkdown(converted) + '\n';
  
  return result;
}
