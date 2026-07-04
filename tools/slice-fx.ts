/**
 * Recorta la hoja de PROYECTILES (chroma magenta → transparente, fila de 7) y el
 * ATLAS de PARTÍCULAS (fondo negro → alpha por luminancia, rejilla 4×3 → 12).
 * Salida a apps/client/public/sprites. Uso: pnpm exec tsx tools/slice-fx.ts
 */
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const SRC = 'apps/client/assets/sprites';
const OUT = 'apps/client/public/sprites';
mkdirSync(OUT, { recursive: true });

interface RGBA { data: Buffer; W: number; H: number; }
async function load(file: string): Promise<RGBA> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}
const ALPHA_MIN = 20;

// magenta (255,0,255) → transparente. Además quita el tinte rosa de los bordes.
function magentaKey({ data, W, H }: RGBA): void {
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const dist = Math.abs(r - 255) + g + Math.abs(b - 255);
    if (dist < 100) data[i * 4 + 3] = 0;
    else if (g < r && g < b && r > 120 && b > 120) {
      // borde con halo magenta: baja R/B hacia G para matar el rosa
      data[i * 4] = Math.min(r, g + 40);
      data[i * 4 + 2] = Math.min(b, g + 40);
    }
  }
}

// negro → transparente por luminancia; RGB a blanco puro (para tintar por código).
function luminanceAlpha({ data, W, H }: RGBA): void {
  for (let i = 0; i < W * H; i++) {
    const lum = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255;
    data[i * 4 + 3] = lum;
  }
}

// runs de índices "con contenido" separados por >minGap vacíos.
function runs(has: boolean[], minGap: number): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < has.length) {
    if (!has[i]) { i++; continue; }
    let end = i, gap = 0, j = i;
    while (j < has.length) {
      if (has[j]) { end = j; gap = 0; } else if (++gap > minGap) break;
      j++;
    }
    out.push([i, end]);
    i = j;
  }
  return out;
}

async function extractBox(img: RGBA, x0: number, y0: number, x1: number, y1: number, out: string) {
  // bbox real dentro de la caja + padding
  let by0 = y1 + 1, by1 = y0 - 1, bx0 = x1 + 1, bx1 = x0 - 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (img.data[(y * img.W + x) * 4 + 3] > ALPHA_MIN) {
        if (y < by0) by0 = y; if (y > by1) by1 = y;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      }
  if (by1 < by0) return false;
  const P = 6;
  const left = Math.max(0, bx0 - P), top = Math.max(0, by0 - P);
  const width = Math.min(img.W - left, bx1 - bx0 + 1 + 2 * P);
  const height = Math.min(img.H - top, by1 - by0 + 1 + 2 * P);
  await sharp(img.data, { raw: { width: img.W, height: img.H, channels: 4 } })
    .extract({ left, top, width, height }).png().toFile(out);
  return true;
}

async function projectiles() {
  const file = path.join(SRC, 'projectiles.png');
  if (!existsSync(file)) return console.log('   (falta projectiles.png)');
  const img = await load(file);
  magentaKey(img);
  const names = ['arrow', 'iceshard', 'poison', 'cannonball', 'bomb', 'teslabolt', 'sniper'];
  const colHas: boolean[] = [];
  for (let x = 0; x < img.W; x++) {
    let c = 0;
    for (let y = 0; y < img.H; y++) if (img.data[(y * img.W + x) * 4 + 3] > ALPHA_MIN) c++;
    colHas[x] = c >= 4;
  }
  const cols = runs(colHas, 30);
  let n = 0;
  for (const [x0, x1] of cols) if (await extractBox(img, x0, 0, x1, img.H - 1, path.join(OUT, `proj_${names[n] ?? n}.png`))) n++;
  console.log(`✅ proyectiles: ${n} sprites (cols: ${cols.length})`);
}

async function particles() {
  const file = path.join(SRC, 'particles.png');
  if (!existsSync(file)) return console.log('   (falta particles.png)');
  const img = await load(file);
  luminanceAlpha(img);
  // nombres en orden fila-por-fila (4×3)
  const names = ['glow', 'dot', 'sparkle', 'smoke', 'flame', 'spark', 'bolt', 'ring', 'bubble', 'snow', 'star', 'dust'];
  // bandas de filas
  const rowHas: boolean[] = [];
  for (let y = 0; y < img.H; y++) {
    let c = 0;
    for (let x = 0; x < img.W; x++) if (img.data[(y * img.W + x) * 4 + 3] > ALPHA_MIN) c++;
    rowHas[y] = c >= 6;
  }
  const rows = runs(rowHas, 40);
  let n = 0;
  for (const [ry0, ry1] of rows) {
    const colHas: boolean[] = [];
    for (let x = 0; x < img.W; x++) {
      let c = 0;
      for (let y = ry0; y <= ry1; y++) if (img.data[(y * img.W + x) * 4 + 3] > ALPHA_MIN) c++;
      colHas[x] = c >= 4;
    }
    const cols = runs(colHas, 40);
    for (const [cx0, cx1] of cols)
      if (await extractBox(img, cx0, ry0, cx1, ry1, path.join(OUT, `part_${names[n] ?? n}.png`))) n++;
  }
  console.log(`✅ partículas: ${n} sprites (filas: ${rows.length})`);
}

async function main() {
  await projectiles();
  await particles();
  console.log('listo → ' + OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
