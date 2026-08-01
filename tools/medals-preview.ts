// Hoja de contacto de las MEDALLAS de rango (ladder de arena). Rasteriza el SVG
// que genera apps/client/src/medals.ts para poder revisar el arte sin abrir el
// juego ni llegar a Comandante ★★★★★ jugando.
//   pnpm medals            → tools/out/medals.png (+ .svg)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RANKS } from '@td/shared';
import { medalSvg } from '../apps/client/src/medals.js';

const CELL_W = 130;
const CELL_H = 190;

let inner = '';
// fila 1 · un ejemplar de cada rango (el más alto no lleva estrellas)
RANKS.forEach((r, i) => {
  const stars = i === RANKS.length - 1 ? 0 : 3;
  inner += `<g transform="translate(${i * CELL_W + 15}, 10)">${medalSvg(i, stars, 100, `a${i}`)}</g>`;
  inner += `<text x="${i * CELL_W + 65}" y="176" fill="#eaeef6" font-family="sans-serif" font-size="13" text-anchor="middle">${r.name}</text>`;
});
// fila 2 · la progresión de estrellas DENTRO de un rango
for (let s = 1; s <= 5; s++) {
  inner += `<g transform="translate(${(s - 1) * CELL_W + 15}, ${CELL_H + 10})">${medalSvg(4, s, 100, `b${s}`)}</g>`;
  inner += `<text x="${(s - 1) * CELL_W + 65}" y="${CELL_H + 176}" fill="#93a0ba" font-family="sans-serif" font-size="12" text-anchor="middle">${'★'.repeat(s)}</text>`;
}

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${RANKS.length * CELL_W}" height="${CELL_H * 2}" viewBox="0 0 ${RANKS.length * CELL_W} ${CELL_H * 2}">
<rect width="100%" height="100%" fill="#0c101a"/>
${inner}
</svg>`;

const dir = `${dirname(fileURLToPath(import.meta.url))}/out`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/medals.svg`, sheet);
// sin top-level await: tsx compila estas herramientas a CJS (el paquete raíz no es
// "type": "module") y ahí el await de primer nivel no existe.
void sharp(Buffer.from(sheet))
  .png()
  .toFile(`${dir}/medals.png`)
  .then(() => console.log(`ok → ${dir}/medals.png`));
