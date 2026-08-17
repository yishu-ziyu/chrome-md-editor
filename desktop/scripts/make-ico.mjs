// make-ico.mjs
// 由 public/icons/icon128.png 生成 Tauri 所需的 Windows 图标：
//   - icons/icon.png   （直接复用 128px）
//   - icons/icon.ico   （把 PNG 直接嵌进 ICO 容器，无需 imagemagick）
// 运行：node desktop/scripts/make-ico.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = resolve(root, "icons");
mkdirSync(iconsDir, { recursive: true });

const pngPath = resolve(root, "../public/icons/icon128.png");
const png = readFileSync(pngPath);

// 复制为 icon.png（Tauri 配置里引用）
copyFileSync(pngPath, resolve(iconsDir, "icon.png"));

// 构造 ICO：ICONDIR(6) + ICONDIRENTRY(16) + PNG 数据
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // image type = icon
header.writeUInt16LE(1, 4); // image count = 1

const entry = Buffer.alloc(16);
entry.writeUInt8(128, 0); // width  (0 表示 256，这里用 128)
entry.writeUInt8(128, 1); // height
entry.writeUInt8(0, 2); // colors in palette (0 = no palette)
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // size of image data
entry.writeUInt32LE(6 + 16, 12); // offset to image data

const ico = Buffer.concat([header, entry, png]);
writeFileSync(resolve(iconsDir, "icon.ico"), ico);
console.log("Generated icons/icon.ico (" + ico.length + " bytes) and icons/icon.png");
