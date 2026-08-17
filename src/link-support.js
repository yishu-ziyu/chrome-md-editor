const SAFE_PREVIEW_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// 是否处于 Tauri 桌面壳内（与 io-bridge 判定一致，不引入额外依赖）。
function isTauriContext() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// 当前预览是否来自本地文件（currentFileUrl 为 file://）。本地 markdown 的相对链接
// 经 new URL('./x.md', 'file:///...') 解析后协议为 file:，此类相对链接解析需放行。
function isLocalFileContext(context) {
  return Boolean(context && typeof context.currentFileUrl === 'string' && context.currentFileUrl.startsWith('file:'));
}

export function resolvePreviewLinkTarget(href, context = {}) {
  const rawHref = String(href || '').trim();
  if (!rawHref || rawHref.startsWith('#')) {
    return null;
  }

  try {
    const baseUrl = context.currentFileUrl || undefined;
    const url = baseUrl ? new URL(rawHref, baseUrl) : new URL(rawHref);

    // file: 仅在以下情形放行（L8）：
    //   1) 调用方显式允许（如点击后改为弹窗提示用户的流程）；
    //   2) 本地文件上下文（相对链接解析为 file://，属用户自己的本地文件，合法）；
    //   3) 桌面端（Tauri）本地文件访问本就是预期能力。
    // 其余（扩展/远程预览页直接点击绝对 file: 链接）存在信息泄露/意外导航风险，故拒绝。
    if (url.protocol === 'file:') {
      const allowFile =
        context.allowFileLinks === true || isLocalFileContext(context) || isTauriContext();
      return allowFile ? url.href : null;
    }

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
