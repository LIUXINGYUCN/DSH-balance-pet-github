/*
 * Measure the character's head in the delivered expression sheet.
 *
 * The pot has to sit on her head, so its resting height comes from the artwork
 * rather than from a guess: this prints, for each row of the top of the sprite,
 * the left and right edge of the opaque silhouette. The pot's rim is then placed
 * where the head is at its widest just below the crown.
 *
 *   <DSH Desktop.exe> tools/measure-head.cjs
 */
const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const PACKAGE = dirname(__dirname);
const SOURCE = join(PACKAGE, 'assets', 'expression_happy.png');

/* Minimal PNG reader: enough for a non-interlaced 8-bit RGBA image, which is
   what the delivered sheets are. */
function decodePng(buffer) {
  let offset = 8;
  const chunks = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
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
  return { width, height, channels, pixels };
}

const image = decodePng(readFileSync(SOURCE));
const alphaAt = (x, y) =>
  image.channels === 4 ? image.pixels[(y * image.width + x) * image.channels + 3] : 255;

console.log(`source ${SOURCE}`);
console.log(`size ${image.width}x${image.height} channels=${image.channels}`);

/* Row extents, in sprite coordinates scaled to 1024 so they can be compared with
   the client's constants directly. */
const scale = 1024 / image.width;
console.log('\n  y    left  right  width  (sprite px, 1024 basis)');
for (let y = 0; y < image.height; y += Math.round(12 / scale)) {
  let left = -1;
  let right = -1;
  for (let x = 0; x < image.width; x += 1) {
    if (alphaAt(x, y) > 24) {
      if (left < 0) left = x;
      right = x;
    }
  }
  if (left < 0) continue;
  const spriteY = Math.round(y * scale);
  if (spriteY > 470) break;
  console.log(
    `${String(spriteY).padStart(4)}  ${String(Math.round(left * scale)).padStart(5)}  ${String(Math.round(right * scale)).padStart(5)}  ${String(Math.round((right - left) * scale)).padStart(5)}`,
  );
}

/* The crown: the first row with any opaque pixel, and the head's centre line. */
let crownY = -1;
let crownLeft = 0;
let crownRight = 0;
for (let y = 0; y < image.height && crownY < 0; y += 1) {
  let left = -1;
  let right = -1;
  for (let x = 0; x < image.width; x += 1) {
    if (alphaAt(x, y) > 24) {
      if (left < 0) left = x;
      right = x;
    }
  }
  if (left >= 0) {
    crownY = Math.round(y * scale);
    crownLeft = Math.round(left * scale);
    crownRight = Math.round(right * scale);
  }
}
console.log(`\ncrown at y=${crownY}, spanning x ${crownLeft}..${crownRight} (centre ${Math.round((crownLeft + crownRight) / 2)})`);
