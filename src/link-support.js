const SAFE_PREVIEW_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'file:']);

export function resolvePreviewLinkTarget(href, context = {}) {
  const rawHref = String(href || '').trim();
  if (!rawHref || rawHref.startsWith('#')) {
    return null;
  }

  try {
    const baseUrl = context.currentFileUrl || undefined;
    const url = baseUrl ? new URL(rawHref, baseUrl) : new URL(rawHref);

    if (!SAFE_PREVIEW_LINK_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function resolvePreviewLinkClickTarget(eventTarget, previewContainer, context = {}) {
  const targetElement = eventTarget?.closest
    ? eventTarget
    : eventTarget?.parentElement;
  const link = targetElement?.closest?.('a[href]');

  if (!link || !previewContainer?.contains?.(link)) {
    return null;
  }

  return resolvePreviewLinkTarget(link.getAttribute('href'), context);
}
