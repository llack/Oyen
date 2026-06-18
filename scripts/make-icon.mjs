// build/icon.svg → build/icon.png (512x512). Generates the PNG used for the app/window icon.
// electron-builder turns this single PNG into the win (.ico) / mac (.icns) / linux icons automatically.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'build', 'icon.svg'));
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } });
writeFileSync(join(root, 'build', 'icon.png'), resvg.render().asPng());
console.log('[make-icon] build/icon.png (512x512) created');
