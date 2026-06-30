// Generates PWA icons from the club logo using Jimp (pure JS, no native deps).
const path = require('path');
const { Jimp } = require('jimp');

const root = path.join(__dirname, '..');
const sizes = [192, 512];

async function run() {
    const logo = await Jimp.read(path.join(root, 'LOGO.jpg'));
    // Pad to square on a white background, then resize.
    const side = Math.max(logo.bitmap.width, logo.bitmap.height);
    const square = new Jimp({ width: side, height: side, color: 0xffffffff });
    square.composite(logo, (side - logo.bitmap.width) / 2, (side - logo.bitmap.height) / 2);

    for (const size of sizes) {
        const out = square.clone().resize({ w: size, h: size });
        const outPath = path.join(root, `icon-${size}.png`);
        await out.write(outPath);
        console.log('wrote', outPath, size + 'x' + size);
    }
}

run().catch(err => { console.error(err); process.exit(1); });
