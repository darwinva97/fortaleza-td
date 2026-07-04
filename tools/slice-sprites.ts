/**
 * Recorta las HOJAS de sprites (torres = 5 etapas, proyectiles = 7) en imágenes
 * individuales con FONDO TRANSPARENTE, y las escribe en apps/client/public/sprites.
 *
 * - Quita el fondo con un relleno (flood-fill) desde los bordes: se siembra solo en
 *   píxeles del BORDE parecidos al color de las esquinas (así una torre cortada por
 *   el borde no se come), y crece siguiendo gradientes suaves (blanco o verde).
 * - Detecta cada sub-sprite por columnas con contenido (separadas por huecos vacíos).
 *
 * Uso: pnpm exec tsx tools/slice-sprites.ts
 */
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const SRC = 'apps/client/assets/sprites';
const OUT = 'apps/client/public/sprites';
mkdirSync(OUT, { recursive: true });

// Hojas de torre y el nombre de cada una de sus 5 etapas (izq→der).
const TOWER_SHEETS = ['archer', 'cannon', 'frost', 'poison', 'tesla', 'sniper', 'mortar', 'banner'];
const TOWER_STAGES = ['l1', 'l2', 'l3', 'specA', 'specB'];
// Hoja de proyectiles (7, en el orden del prompt).
const PROJ_NAMES = ['arrow', 'iceshard', 'poison', 'cannonball', 'bomb', 'teslabolt', 'sniper'];

interface RGBA {
  data: Buffer;
  W: number;
  H: number;
}

async function load(file: string): Promise<RGBA> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

// Quita el fondo: pone alpha=0 en la región de fondo conectada a los bordes.
function removeBackground({ data, W, H }: RGBA): void {
  const idx = (x: number, y: number) => y * W + x;
  const rgb = (i: number): [number, number, number] => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const d = (a: [number, number, number], b: [number, number, number]) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  // color de fondo = promedio de las 4 esquinas
  const corners: [number, number, number][] = [
    rgb(idx(0, 0)),
    rgb(idx(W - 1, 0)),
    rgb(idx(0, H - 1)),
    rgb(idx(W - 1, H - 1)),
  ];
  const bgCol: [number, number, number] = [
    Math.round(corners.reduce((s, c) => s + c[0], 0) / 4),
    Math.round(corners.reduce((s, c) => s + c[1], 0) / 4),
    Math.round(corners.reduce((s, c) => s + c[2], 0) / 4),
  ];

  const SEED_TOL = 60; // qué tan parecido al color de esquina para sembrar en el borde
  const GROW_TOL = 32; // tolerancia local al crecer (sigue gradientes suaves)

  const bg = new Uint8Array(W * H);
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    const i = idx(x, y);
    if (bg[i]) return;
    if (d(rgb(i), bgCol) <= SEED_TOL) {
      bg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }

  // BFS: un vecino se une al fondo si su color se parece al del píxel actual
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const ci = rgb(i);
    const x = i % W;
    const y = (i / W) | 0;
    const tryN = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
      const ni = idx(nx, ny);
      if (bg[ni]) return;
      if (d(rgb(ni), ci) <= GROW_TOL) {
        bg[ni] = 1;
        queue.push(ni);
      }
    };
    tryN(x - 1, y);
    tryN(x + 1, y);
    tryN(x, y - 1);
    tryN(x, y + 1);
  }

  // aplica transparencia
  for (let i = 0; i < W * H; i++) if (bg[i]) data[i * 4 + 3] = 0;
}

// Detecta los sub-sprites por columnas con contenido (alpha>umbral), separados por
// huecos vacíos de al menos MIN_GAP px. Devuelve rangos [x0,x1] inclusivos.
function findColumns({ data, W, H }: RGBA, expected: number): [number, number][] {
  const ALPHA_MIN = 40;
  // una columna "cuenta" si tiene bastante ALTURA de contenido: así las SOMBRAS
  // bajas entre torres (que quedaron opacas) se tratan como hueco y no las fusionan.
  const COL_MIN = Math.max(2, Math.floor(H * 0.07));
  const MIN_GAP = 14; // huecos menores se puentean (no parten una torre)
  const colHas: boolean[] = new Array(W);
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3] > ALPHA_MIN) c++;
    colHas[x] = c >= COL_MIN;
  }
  const runs: [number, number][] = [];
  let x = 0;
  while (x < W) {
    if (!colHas[x]) {
      x++;
      continue;
    }
    let end = x;
    let gap = 0;
    let j = x;
    while (j < W) {
      if (colHas[j]) {
        end = j;
        gap = 0;
      } else if (++gap > MIN_GAP) {
        break;
      }
      j++;
    }
    runs.push([x, end]);
    x = j;
  }
  if (runs.length !== expected) {
    console.warn(`   ⚠️  detecté ${runs.length} sub-sprites (esperaba ${expected})`);
  }
  return runs;
}

async function sliceSheet(name: string, srcFile: string, stageNames: string[], prefix: string) {
  if (!existsSync(srcFile)) {
    console.log(`   (falta ${srcFile}, salto)`);
    return;
  }
  const img = await load(srcFile);
  removeBackground(img);
  const runs = findColumns(img, stageNames.length);

  // por cada run: caja delimitadora REAL del contenido (sin trim, que revienta con
  // recortes vacíos), + un pequeño padding transparente.
  const P = 8;
  let saved = 0;
  for (let k = 0; k < runs.length; k++) {
    const [rx0, rx1] = runs[k];
    let y0 = img.H,
      y1 = -1,
      bx0 = rx1 + 1,
      bx1 = rx0 - 1;
    for (let y = 0; y < img.H; y++) {
      for (let x = rx0; x <= rx1; x++) {
        if (img.data[(y * img.W + x) * 4 + 3] > 24) {
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
        }
      }
    }
    if (y1 < 0 || bx1 < bx0) continue; // run vacío
    const left = Math.max(0, bx0 - P);
    const top = Math.max(0, y0 - P);
    const width = Math.min(img.W - left, bx1 - bx0 + 1 + 2 * P);
    const height = Math.min(img.H - top, y1 - y0 + 1 + 2 * P);
    const stage = stageNames[saved] ?? `x${saved}`;
    const out = path.join(OUT, `${prefix}${name ? name + '_' : ''}${stage}.png`);
    await sharp(img.data, { raw: { width: img.W, height: img.H, channels: 4 } })
      .extract({ left, top, width, height })
      .png()
      .toFile(out);
    saved++;
  }
  console.log(`✅ ${name || prefix}: ${saved} sprites  (runs x: ${runs.map((r) => r.join('-')).join(', ')})`);
}

async function main() {
  console.log('— Recortando hojas de torres —');
  for (const t of TOWER_SHEETS) {
    await sliceSheet(t, path.join(SRC, `tower_${t}.png`), TOWER_STAGES, 'tower_');
  }
  // Trampa de púas: objeto ÚNICO (sin mejoras) → una sola imagen.
  console.log('— Recortando la Trampa (única) —');
  await sliceSheet('trap', path.join(SRC, 'tower_trap.png'), ['l1'], 'tower_');

  console.log('— Recortando proyectiles —');
  await sliceSheet('', path.join(SRC, 'projectiles.png'), PROJ_NAMES, 'proj_');
  console.log(`\nListo. Salida en ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
