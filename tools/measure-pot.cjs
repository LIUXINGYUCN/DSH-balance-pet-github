/*
 * Measure the pot's own image, so its rim can be laid on the character's crown.
 *
 * The pot ships as WebP and the PNG reader in measure-head.cjs cannot read it,
 * so the image is decoded and re-encoded to PNG by the Electron runtime's own
 * image codec, then measured the same way: the opaque rows of the pot say where
 * its rim is inside its own bounding box, which is what the client needs to
 * place it on the head instead of guessing a fraction of the box height.
 *
 *   <DSH Desktop.exe> tools/measure-pot.cjs
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { nativeImage } = require('electron');

const PACKAGE = dirname(__dirname);
const SOURCE = join(PACKAGE, 'assets', 'iron_bowl.webp');
const TEMP = join(PACKAGE, 'tools', 'iron_bowl.png');

const image = nativeImage.createFromBuffer(readFileSync(SOURCE));
if (image.isEmpty()) throw new Error(`could not decode ${SOURCE}`);
const size = image.getSize();
const png = image.toPNG();
writeFileSync(TEMP, png);
console.log(`decoded ${SOURCE} -> ${TEMP} (${size.width}x${size.height})`);

let offset = 8;
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idat = [];
while (offset < png.length) {
  const length = png.readUInt32BE(offset);
  const type = png.toString('ascii', offset + 4, offset + 8);
  const data = png.subarray(offset + 8, offset + 8 + length);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') break;
  offset += 12 + length;
}
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
  throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType}`);
}
const channels = colorType === 6 ? 4 : 3;
const raw = require('node:zlib').inflateSync(Buffer.concat(idat));
const stride = width * channels;
const pixels = Buffer.alloc(height * stride);
let position = 0;
for (let y = 0; y < height; y += 1) {
  const filter = raw[position];
  position += 1;
  const line = raw.subarray(position, position + stride);
  position += stride;
  const out = y * stride;
  const prev = out - stride;
  for (let x = 0; x < stride; x += 1) {
    const rawByte = line[x];
    const left = x >= channels ? pixels[out + x - channels] : 0;
    const up = y > 0 ? pixels[prev + x] : 0;
    const upLeft = y > 0 && x >= channels ? pixels[prev + x - channels] : 0;
    let value;
    if (filter === 0) value = rawByte;
    else if (filter === 1) value = rawByte + left;
    else if (filter === 2) value = rawByte + up;
    else if (filter === 3) value = rawByte + ((left + up) >> 1);
    else {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      value = rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
    }
    pixels[out + x] = value & 0xff;
  }
}

/* The pot is drawn on an opaque white background, so the silhouette is what is
   NOT white (and is not transparent). */
const isPot = (x, y) => {
  const base = (y * width + x) * channels;
  if (channels === 4 && pixels[base + 3] < 24) return false;
  return !(pixels[base] > 238 && pixels[base + 1] > 238 && pixels[base + 2] > 238);
};

console.log('\n   y    left  right  width   y/height');
let firstRow = -1;
let lastRow = -1;
let minLeft = width;
let maxRight = -1;
const step = Math.max(1, Math.round(height / 16));
for (let y = 0; y < height; y += 1) {
  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x += 1) {
    if (isPot(x, y)) {
      if (left < 0) left = x;
      right = x;
    }
  }
  if (left < 0) continue;
  if (firstRow < 0) firstRow = y;
  lastRow = y;
  if (left < minLeft) minLeft = left;
  if (right > maxRight) maxRight = right;
  if (y % step === 0) {
    console.log(
      `${String(y).padStart(4)}  ${String(left).padStart(5)}  ${String(right).padStart(5)}  ${String(right - left).padStart(5)}   ${(y / height).toFixed(3)}`,
    );
  }
}
console.log(`\ncontent rows ${firstRow}..${lastRow} of ${height} (top ${(firstRow / height).toFixed(3)}, bottom ${(lastRow / height).toFixed(3)})`);
console.log(`content cols ${minLeft}..${maxRight} of ${width} (centre ${((minLeft + maxRight) / 2 / width).toFixed(3)})`);
