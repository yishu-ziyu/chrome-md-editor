const ALLOWED_IMAGE_SCHEMES = new Set([
  'https',
  'http',
  'data',
  'blob',
  'chrome-extension',
  'file',
]);
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function schemeOf(value) {
  const m = String(value || '').match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
  return m ? m[1].toLowerCase() : '';
}

function normalizeRelativePath(path) {
  const parts = normalizeSlashes(path).split('/');
  const resolved = [];

  for (const part of parts) {
    if (!part || part === '.') continue;

    if (part === '..') {
      if (resolved.length === 0) {
        resolved.push('..');
      } else if (resolved[resolved.length - 1] === '..') {
        resolved.push('..');
      } else {
        resolved.pop();
      }
      continue;
    }

    resolved.push(part);
  }

  return resolved.join('/');
}

function resolveDirectoryRelativePath(baseDir, relativePath) {
  const base = normalizeRelativePath(baseDir);
  const joined = [base, normalizeSlashes(relativePath)].filter(Boolean).join('/');
  const normalized = normalizeRelativePath(joined);

  if (!normalized || normalized === '..' || normalized.startsWith('../')) {
    return null;
  }

  return normalized;
}

function toFileUrl(path) {
  const normalized = normalizeSlashes(path);
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }

  return `file://${encodeURI(normalized)}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function resolvePreviewImageSource(src, context = {}) {
  const trimmed = String(src || '').trim();
  if (!trimmed) return null;

  const normalized = normalizeSlashes(trimmed);
  const scheme = schemeOf(normalized);

  if (scheme) {
    if (!ALLOWED_IMAGE_SCHEMES.has(scheme)) {
      return null;
    }
    return normalized;
  }

  if (normalized.startsWith('/')) {
    return toFileUrl(normalized);
  }

  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized)) {
    return toFileUrl(normalized);
  }

  if (context.currentFileUrl) {
    try {
      return new URL(normalized, context.currentFileUrl).href;
    } catch {
      return null;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(context, 'currentDirectoryPath') &&
    context.currentDirectoryPath !== null &&
    context.currentDirectoryPath !== undefined
  ) {
    return resolveDirectoryRelativePath(context.currentDirectoryPath, normalized);
  }

  return null;
}

export function dirnameFromRelativePath(filePath = '') {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized.includes('/')) return '';
  return normalized.slice(0, normalized.lastIndexOf('/'));
}

export function splitRelativePath(path = '') {
  const normalized = normalizeRelativePath(path);
  if (!normalized) return [];
  return normalized.split('/').filter(Boolean);
}

export function mimeTypeToExtension(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/svg+xml') return 'svg';
  return 'png';
}

export function createPastedImageFilename({
  timestamp = new Date(),
  extension = 'png',
  randomSuffix,
} = {}) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const safeExtension = String(extension || 'png').replace(/^\./, '').toLowerCase();
  const suffix = (randomSuffix || Math.random().toString(36).slice(2, 6)).toLowerCase();
  const stamp = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('') + '-' + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');

  return `pasted-${stamp}-${suffix}.${safeExtension}`;
}

export function buildPastedImageMarkdown({
  alt = 'pasted-image',
  imagePath,
} = {}) {
  return `![${alt}](${imagePath})`;
}

export function buildImagesRelativePath(filename, directoryName = 'images') {
  return `${directoryName}/${filename}`;
}
