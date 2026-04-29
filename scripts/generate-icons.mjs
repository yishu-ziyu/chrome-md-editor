import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ICON_SIZES = [16, 48, 128];
const SUPERSAMPLE = 4;

const COLORS = {
  transparent: [0, 0, 0, 0],
  background: [15, 23, 42, 255],
  backgroundLift: [30, 41, 59, 255],
  teal: [20, 184, 166, 255],
  blue: [37, 99, 235, 255],
  paper: [248, 250, 252, 255],
  paperFold: [219, 234, 254, 255],
  paperEdge: [148, 163, 184, 255],
  ink: [15, 23, 42, 255],
};

function createCanvas(size) {
  const width = size * SUPERSAMPLE;
  const height = size * SUPERSAMPLE;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels.set(COLORS.transparent, i);
  }
  return { width, height, pixels, factor: (size / 128) * SUPERSAMPLE };
}

function blendPixel(canvas, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;

  const index = (py * canvas.width + px) * 4;
  const sourceAlpha = color[3] / 255;
  const targetAlpha = canvas.pixels[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

  if (outAlpha === 0) return;

  for (let channel = 0; channel < 3; channel += 1) {
    const source = color[channel] * sourceAlpha;
    const target = canvas.pixels[index + channel] * targetAlpha * (1 - sourceAlpha);
    canvas.pixels[index + channel] = Math.round((source + target) / outAlpha);
  }
  canvas.pixels[index + 3] = Math.round(outAlpha * 255);
}

function scaled(canvas, value) {
  return value * canvas.factor;
}

function fillRect(canvas, x, y, width, height, color) {
  const left = Math.floor(scaled(canvas, x));
  const top = Math.floor(scaled(canvas, y));
  const right = Math.ceil(scaled(canvas, x + width));
  const bottom = Math.ceil(scaled(canvas, y + height));

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      blendPixel(canvas, px, py, color);
    }
  }
}

function fillCircle(canvas, cx, cy, radius, color) {
  const scx = scaled(canvas, cx);
  const scy = scaled(canvas, cy);
  const sr = scaled(canvas, radius);
  const left = Math.floor(scx - sr);
  const top = Math.floor(scy - sr);
  const right = Math.ceil(scx + sr);
  const bottom = Math.ceil(scy + sr);

  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = px - scx;
      const dy = py - scy;
      if (dx * dx + dy * dy <= sr * sr) {
        blendPixel(canvas, px, py, color);
      }
    }
  }
}

function fillRoundedRect(canvas, x, y, width, height, radius, color) {
  fillRect(canvas, x + radius, y, width - radius * 2, height, color);
  fillRect(canvas, x, y + radius, width, height - radius * 2, color);
  fillCircle(canvas, x + radius, y + radius, radius, color);
  fillCircle(canvas, x + width - radius, y + radius, radius, color);
  fillCircle(canvas, x + radius, y + height - radius, radius, color);
  fillCircle(canvas, x + width - radius, y + height - radius, radius, color);
}

function fillPolygon(canvas, points, color) {
  const scaledPoints = points.map(([x, y]) => [scaled(canvas, x), scaled(canvas, y)]);
  const minY = Math.floor(Math.min(...scaledPoints.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...scaledPoints.map((point) => point[1])));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < scaledPoints.length; i += 1) {
      const [x1, y1] = scaledPoints[i];
      const [x2, y2] = scaledPoints[(i + 1) % scaledPoints.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }

    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const start = Math.ceil(intersections[i]);
      const end = Math.floor(intersections[i + 1]);
      for (let x = start; x <= end; x += 1) {
        blendPixel(canvas, x, y, color);
      }
    }
  }
}

function drawLine(canvas, x1, y1, x2, y2, width, color) {
  const sx1 = scaled(canvas, x1);
  const sy1 = scaled(canvas, y1);
  const sx2 = scaled(canvas, x2);
  const sy2 = scaled(canvas, y2);
  const radius = scaled(canvas, width / 2);
  const minX = Math.floor(Math.min(sx1, sx2) - radius);
  const maxX = Math.ceil(Math.max(sx1, sx2) + radius);
  const minY = Math.floor(Math.min(sy1, sy2) - radius);
  const maxY = Math.ceil(Math.max(sy1, sy2) + radius);
  const dx = sx2 - sx1;
  const dy = sy2 - sy1;
  const lengthSquared = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - sx1) * dx + (y - sy1) * dy) / lengthSquared));
      const closestX = sx1 + t * dx;
      const closestY = sy1 + t * dy;
      const distanceX = x - closestX;
      const distanceY = y - closestY;
      if (distanceX * distanceX + distanceY * distanceY <= radius * radius) {
        blendPixel(canvas, x, y, color);
      }
    }
  }
}

function drawIcon(size) {
  const canvas = createCanvas(size);

  fillRoundedRect(canvas, 8, 8, 112, 112, 26, COLORS.background);
  fillPolygon(canvas, [[8, 8], [54, 8], [8, 54]], COLORS.backgroundLift);
  fillPolygon(canvas, [[8, 120], [48, 120], [8, 80]], COLORS.teal);

  fillPolygon(canvas, [[33, 23], [78, 23], [97, 42], [97, 105], [33, 105]], COLORS.paper);
  fillPolygon(canvas, [[78, 23], [97, 42], [78, 42]], COLORS.paperFold);
  drawLine(canvas, 78, 42, 96, 42, 2, COLORS.paperEdge);

  drawLine(canvas, 46, 59, 46, 83, 8, COLORS.ink);
  drawLine(canvas, 46, 59, 58, 73, 8, COLORS.ink);
  drawLine(canvas, 58, 73, 70, 59, 8, COLORS.ink);
  drawLine(canvas, 70, 59, 70, 83, 8, COLORS.ink);

  fillRoundedRect(canvas, 80, 58, 8, 21, 3, COLORS.blue);
  fillPolygon(canvas, [[72, 76], [96, 76], [84, 91]], COLORS.blue);
  fillRoundedRect(canvas, 47, 94, 31, 5, 2.5, COLORS.paperEdge);

  return downsample(canvas, size);
}

function downsample(canvas, targetSize) {
  const output = new Uint8ClampedArray(targetSize * targetSize * 4);

  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const sourceIndex = ((y * SUPERSAMPLE + sy) * canvas.width + (x * SUPERSAMPLE + sx)) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            totals[channel] += canvas.pixels[sourceIndex + channel];
          }
        }
      }
      const targetIndex = (y * targetSize + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetIndex + channel] = Math.round(totals[channel] / (SUPERSAMPLE * SUPERSAMPLE));
      }
    }
  }

  return { width: targetSize, height: targetSize, pixels: output };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng({ width, height, pixels }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      const targetIndex = rowStart + 1 + x * 4;
      raw[targetIndex] = pixels[sourceIndex];
      raw[targetIndex + 1] = pixels[sourceIndex + 1];
      raw[targetIndex + 2] = pixels[sourceIndex + 2];
      raw[targetIndex + 3] = pixels[sourceIndex + 3];
    }
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND'),
  ]);
}

for (const size of ICON_SIZES) {
  const icon = drawIcon(size);
  writeFileSync(`public/icons/icon${size}.png`, encodePng(icon));
  console.log(`generated public/icons/icon${size}.png`);
}
