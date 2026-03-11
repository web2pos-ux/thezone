/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function main() {
  const root = path.resolve(__dirname, '..');
  const srcPng = path.join(root, 'icon-square.png');
  const outIco = path.join(root, 'icon.ico');
  const tmpDir = path.join(root, 'assets', '.tmp-ico');

  if (!fs.existsSync(srcPng)) {
    throw new Error(`Source PNG not found: ${srcPng}`);
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const img = await loadImage(srcPng);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngPaths = [];

  for (const size of sizes) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const outPng = path.join(tmpDir, `icon-${size}.png`);
    fs.writeFileSync(outPng, canvas.toBuffer('image/png'));
    pngPaths.push(outPng);
  }

  const mod = await import('png-to-ico');
  const pngToIco = mod && (mod.default || mod);
  if (typeof pngToIco !== 'function') {
    throw new Error('png-to-ico export not a function');
  }

  const buf = await pngToIco(pngPaths);
  fs.writeFileSync(outIco, buf);

  console.log(`Generated ICO: ${outIco}`);
}

main().catch((err) => {
  console.error('[generate-icon-ico] failed:', err);
  process.exit(1);
});

