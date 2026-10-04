// 生成托盘图标：纯 Node 内置模块（zlib + 手写 PNG 编码），不依赖外部库。
// 画一个橙色圆形作为占位托盘图标，后续可替换为正式图标。
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  if (!crc32.table) {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    crc32.table = t;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32.table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const W = 32, H = 32;
const raw = Buffer.alloc((W * 4 + 1) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const dx = x - 16 + 0.5, dy = y - 16 + 0.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = d <= 15 ? 255 : 0;
    raw[p++] = 255; raw[p++] = 165; raw[p++] = 0; raw[p++] = a; // 橙色 RGBA
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
const idat = zlib.deflateSync(raw);
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const out = path.join(__dirname, '..', 'assets', 'icons', 'tray-icon.png');
fs.writeFileSync(out, png);
console.log('tray-icon.png written:', out, png.length, 'bytes');
