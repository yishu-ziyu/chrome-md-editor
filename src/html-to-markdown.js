// Pure HTML → Markdown helpers (preview WYSIWYG round-trip).
// Extracted so Issue #1 / #3 regressions can be unit-tested without a browser.

export function normalizeMarkdown(md) {
  return String(md || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const RAW_TAG_ALLOWLIST = new Set(['mark', 'center', 'font', 'span', 'sup', 'sub']);
const RAW_ATTR_ALLOWLIST = new Set(['class', 'color', 'face', 'size']);

function escapeAttrValue(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isDangerousAttrValue(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^(?:javascript|vbscript|data\s*:?\s*text\/html)\s*:/.test(v);
}

export function reconstructRawTag(node, convertNodeFn) {
  const convert = convertNodeFn || convertNode;
  const tag = String(node.tagName || '').toLowerCase();
  const childText = Array.from(node.childNodes).map(convert).join('');
  if (!RAW_TAG_ALLOWLIST.has(tag)) return childText;

  const attrs = Array.from(node.attributes || [])
    .filter((a) => {
      const name = String(a.name || '').toLowerCase();
      if (name.startsWith('on')) return false;
      if (name === 'style' || name === 'href') return false;
      if (!RAW_ATTR_ALLOWLIST.has(name)) return false;
      if (isDangerousAttrValue(a.value)) return false;
      return true;
    })
    .map((a) => ` ${String(a.name).toLowerCase()}="${escapeAttrValue(a.value)}"`)
    .join('');
  return `<${tag}${attrs}>${childText}</${tag}>`;
}

// Use numeric nodeType constants so this runs in Node tests (no global Node)
// and in the browser (DOM Node.TEXT_NODE === 3, ELEMENT_NODE === 1).
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

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
    case 'p':
      return `${childText.trim()}\n\n`;
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
    case 'blockquote':
      return (
        childText
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n') + '\n\n'
      );
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
      return childText;
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
    return normalizeMarkdown(convertNode(document.body)) + '\n';
  }

  const Parser = DOMParserImpl || globalThis.DOMParser;
  if (!Parser) {
    throw new Error('DOMParser or parseHTML is required for htmlToMarkdown');
  }
  const doc = new Parser().parseFromString(html, 'text/html');
  return normalizeMarkdown(convertNode(doc.body)) + '\n';
}
