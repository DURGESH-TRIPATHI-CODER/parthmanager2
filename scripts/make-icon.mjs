/**
 * Generates build/icon.ico (256x256, required by electron-builder for Windows)
 * from the project's LOGO.ico.
 *
 * Electron-builder errors with "image ... must be at least 256x256" when the
 * source icon only contains small frames, so we decode the original frame and
 * upscale it with a high-quality filter, then re-encode as a PNG-frame ICO.
 *
 * Usage: node scripts/make-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "LOGO.ico");
const OUT_DIR = path.join(root, "build");
const OUT = path.join(OUT_DIR, "icon.ico");
const TARGET = 256;

/** Decode the largest frame of an ICO into raw RGBA pixels. */
function decodeIco(buffer) {
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  if (type !== 1 || count < 1) throw new Error("Not a valid .ico file");

  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const w = buffer.readUInt8(e) || 256;
    const h = buffer.readUInt8(e + 1) || 256;
    const size = buffer.readUInt32LE(e + 8);
    const offset = buffer.readUInt32LE(e + 12);
    if (!best || w * h > best.w * best.h) best = { w, h, size, offset };
  }

  const frame = buffer.subarray(best.offset, best.offset + best.size);

  // PNG-compressed frame: hand straight to sharp.
  if (frame[0] === 0x89 && frame[1] === 0x50) return { png: Buffer.from(frame) };

  // Uncompressed 32bpp BMP/DIB frame.
  const headerSize = frame.readUInt32LE(0);
  const width = frame.readInt32LE(4);
  const height = frame.readInt32LE(8) / 2; // XOR + AND
  const bitcount = frame.readUInt16LE(14);
  const compression = frame.readUInt32LE(16);
  if (bitcount !== 32 || compression !== 0) {
    throw new Error(`Unsupported ICO frame: ${bitcount}bpp compression=${compression}`);
  }

  const px = width * height * 4;
  const xor = frame.subarray(headerSize, headerSize + px);
  const maskOffset = headerSize + px;
  const maskStride = Math.floor((width + 31) / 32) * 4;
  const mask = frame.subarray(maskOffset, maskOffset + maskStride * height);

  const rgba = Buffer.alloc(px);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // DIB rows are bottom-up
    const maskRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = srcRow * width * 4 + x * 4;
      const d = (y * width + x) * 4;
      const a = xor[s + 3];
      if (a !== 0) anyAlpha = true;
      const bit = (mask[maskRow * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1;
      rgba[d] = xor[s + 2]; // B -> R
      rgba[d + 1] = xor[s + 1]; // G
      rgba[d + 2] = xor[s]; // R -> B
      rgba[d + 3] = anyAlpha ? a : bit === 0 ? 255 : 0;
    }
  }
  return { raw: rgba, width, height };
}

const decoded = decodeIco(fs.readFileSync(SRC));

const png = decoded.png
  ? await sharp(decoded.png).resize(TARGET, TARGET, { fit: "fill" }).png().toBuffer()
  : await sharp(decoded.raw, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
      .resize(TARGET, TARGET, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();

// PNG-frame ICO: ICONDIR + one ICONDIRENTRY (0x00 width/height means 256) + PNG.
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
header.writeUInt8(0, 6); // width: 256
header.writeUInt8(0, 7); // height: 256
header.writeUInt8(0, 8); // palette colors
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // color planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14); // image data size
header.writeUInt32LE(6 + 16, 18); // offset

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, png]));

// Sanity: verify header + readable image size.
const check = fs.readFileSync(OUT);
const sig = check.subarray(0, 4).toString("hex");
const frameCount = check.readUInt16LE(4);
if (sig !== "00000100" || frameCount < 1) {
  throw new Error("Generated icon failed validation");
}
console.log(
  `OK ${OUT} (${check.length} bytes, ${frameCount} frame(s), ${TARGET}x${TARGET} PNG frame)`,
);
