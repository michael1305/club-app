// Generates simple solid-color PWA icons (no native deps, pure Node zlib).
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeIcon(size, outPath) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type RGB
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    // Background #6c5ce7, with a white rounded "ticket" square in the center for visual identity.
    const bg = [0x6c, 0x5c, 0xe7];
    const fg = [0xff, 0xff, 0xff];
    const margin = Math.round(size * 0.28);

    const rowBytes = size * 3;
    const raw = Buffer.alloc((rowBytes + 1) * size);
    for (let y = 0; y < size; y++) {
        let offset = y * (rowBytes + 1);
        raw[offset] = 0; // filter type none
        for (let x = 0; x < size; x++) {
            const inner = x >= margin && x < size - margin && y >= margin && y < size - margin;
            const c = inner ? fg : bg;
            const px = offset + 1 + x * 3;
            raw[px] = c[0]; raw[px + 1] = c[1]; raw[px + 2] = c[2];
        }
    }

    const idat = zlib.deflateSync(raw);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.concat([
        signature,
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0))
    ]);
    fs.writeFileSync(outPath, png);
    console.log('wrote', outPath, png.length, 'bytes');
}

const root = path.join(__dirname, '..');
makeIcon(192, path.join(root, 'icon-192.png'));
makeIcon(512, path.join(root, 'icon-512.png'));
