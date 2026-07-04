/**
 * Genera un HTML autocontenido (sprites incrustados como data-URI) para revisar el
 * resultado del recorte en un Artifact. Uso: pnpm exec tsx tools/gen-sprite-preview.ts
 */
import sharp from 'sharp';
import { writeFileSync, existsSync } from 'node:fs';

const DIR = 'apps/client/public/sprites';
const OUT = 'C:/Users/vicen/AppData/Local/Temp/claude/C--Users-vicen-Desktop-Projects-fortaleza-td/9dece161-cbac-4e89-90af-6f7d871f1d49/scratchpad/sprite-preview.html';

async function b64(file: string, w = 220): Promise<string> {
  const p = `${DIR}/${file}`;
  if (!existsSync(p)) return '';
  const buf = await sharp(p).resize({ width: w, withoutEnlargement: true }).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

const BOARD = ['archer', 'cannon', 'frost', 'poison', 'tesla', 'sniper', 'mortar'];
const STAGES: [string, string][] = [
  ['l1', 'L1'],
  ['l2', 'L2'],
  ['l3', 'L3'],
  ['specA', 'Spec A'],
  ['specB', 'Spec B'],
];

async function main() {
  const board = await Promise.all(BOARD.map(async (t) => ({ t, src: await b64(`tower_${t}_l3.png`, 200) })));
  const cannon = await Promise.all(STAGES.map(async ([s, l]) => ({ l, src: await b64(`tower_cannon_${s}.png`, 180) })));
  const archer = await Promise.all(STAGES.map(async ([s, l]) => ({ l, src: await b64(`tower_archer_${s}.png`, 180) })));

  // CELL = tamaño de celda; base del sprite = CELL * factor
  const CELL = 64;
  // tablero-rejilla: coloca las torres limpias en celdas concretas [col,row]
  const clean = board.filter((b) => b.t !== 'archer' && b.t !== 'sniper');
  const spots: [number, number][] = [
    [1, 1],
    [4, 1],
    [7, 1],
    [2, 3],
    [5, 3],
  ];
  const boardCells = clean
    .slice(0, spots.length)
    .map((b, i) => {
      const [cx, cy] = spots[i];
      const w = Math.round(CELL * 1.15);
      return `<div class="cell" style="left:${cx * CELL}px;top:${cy * CELL}px;"><img style="width:${w}px" src="${b.src}"/></div>`;
    })
    .join('');

  const cannonL3 = cannon.find((c) => c.l === 'L3')!.src;
  const sizeOpts = [
    ['1.0×', 'justo en la celda', 1.0],
    ['1.15×', 'recomendado (leve saliente)', 1.15],
    ['1.35×', 'grande', 1.35],
  ] as const;
  const sizeCells = sizeOpts
    .map(
      ([f, lbl, k]) =>
        `<div class="opt"><div class="ocell"><img style="width:${Math.round(CELL * k)}px" src="${cannonL3}"/></div><b>${f}</b><small>${lbl}</small></div>`,
    )
    .join('');

  const strip = (items: { l: string; src: string }[]) =>
    items.map((it) => `<div class="s"><img src="${it.src}"/><small>${it.l}</small></div>`).join('');

  const html = `<title>Sprites de torres — tamaño</title>
<style>
  :root{--dim:#8fa0b8;--cell:${CELL}px;}
  body{margin:0;background:radial-gradient(120% 90% at 50% 0%,#152136,#0b1120 70%);color:#e8eef7;font-family:ui-sans-serif,system-ui,sans-serif;}
  .wrap{max-width:820px;margin:0 auto;padding:22px 16px 44px;}
  h1{font-size:1.4rem;margin:0 0 4px;} .sub{color:var(--dim);margin:0 0 18px;font-size:.92rem;}
  h2{font-size:.95rem;color:var(--dim);margin:24px 4px 8px;font-weight:700;}
  /* tablero con REJILLA visible para ver el encaje en la celda */
  .board{position:relative;height:${CELL * 5}px;border-radius:12px;overflow:hidden;border:1px solid #24314c;
    background:
      linear-gradient(#2b3f63 1px,transparent 1px) 0 0/var(--cell) var(--cell),
      linear-gradient(90deg,#2b3f63 1px,transparent 1px) 0 0/var(--cell) var(--cell),
      #1a2a46;}
  .cell{position:absolute;width:var(--cell);height:var(--cell);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);}
  .cell img{position:absolute;left:50%;bottom:0;transform:translateX(-50%);filter:drop-shadow(0 5px 5px rgba(0,0,0,.5));}
  .opts{display:flex;gap:18px;flex-wrap:wrap;}
  .opt{display:flex;flex-direction:column;align-items:center;gap:4px;}
  .opt b{font-size:.9rem;} .opt small{color:var(--dim);font-size:.72rem;}
  .ocell{position:relative;width:var(--cell);height:calc(var(--cell)*2.2);display:flex;align-items:flex-end;justify-content:center;}
  .ocell::after{content:"";position:absolute;left:0;bottom:0;width:var(--cell);height:var(--cell);box-shadow:inset 0 0 0 2px rgba(255,213,79,.5);border-radius:3px;}
  .ocell img{position:relative;z-index:1;}
  .strip{display:flex;gap:10px;flex-wrap:wrap;background:#101a2e;border:1px solid #22314e;border-radius:12px;padding:14px;}
  .s{display:flex;flex-direction:column;align-items:center;gap:5px;width:104px;}
  .s img{width:92px;height:92px;object-fit:contain;object-position:bottom;background:#0c1626;border-radius:9px;}
  .s small{color:var(--dim);font-size:.72rem;}
  .note{color:var(--dim);font-size:.86rem;line-height:1.5;background:#101a2e;border:1px solid #22314e;border-radius:12px;padding:12px 14px;margin-top:14px;}
  .ok{color:#8bd68f;font-weight:700;} .bad{color:#ff8a80;font-weight:700;}
</style>
<div class="wrap">
  <h1>Tamaño de las torres en la celda</h1>
  <p class="sub">Antes la torre medía 1.55× la celda (se desbordaba). Ahora la base ≈ 1.15 celdas; la estructura sube. La rejilla muestra el encaje real.</p>
  <div class="board">${boardCells}</div>

  <h2>Opciones de tamaño (el recuadro dorado = 1 celda)</h2>
  <div class="opts">${sizeCells}</div>
  <div class="note">Puse <b>1.15×</b> por defecto (la base cubre la celda con un saliente mínimo y la torre se ve con presencia). Dime si la quieres <b>1.0× (justo)</b> o algún valor intermedio y lo ajusto en una línea.</div>

  <div class="note">
    <span class="ok">Recorte limpio</span> (fondo blanco): Cañón, Hielo, Veneno, Tesla, Mortero.
    <span class="bad">Pendiente</span>: Arquero (halo verde) y Francotirador (incompleto) → regenerar con fondo transparente.
  </div>

  <h2>Progresión del CAÑÓN (limpio): L1 · L2 · L3 · Metralla · Napalm</h2>
  <div class="strip">${strip(cannon)}</div>
</div>`;

  writeFileSync(OUT, html);
  console.log('escrito ' + OUT + ' (' + (html.length / 1024).toFixed(0) + ' KB)');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
