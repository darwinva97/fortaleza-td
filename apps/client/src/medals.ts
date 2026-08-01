// MEDALLAS DE RANGO del ladder de arena, dibujadas por código (SVG inline).
//
// Nada de imágenes: el arte se GENERA. Así una medalla pesa lo que un párrafo de
// texto, se ve nítida a cualquier tamaño (16 px en el marcador, 160 px en la
// pantalla de fin), se recolorea sola por rango y no hay que servir ni cachear
// ficheros. Es el mismo criterio con el que el renderer dibuja las torres cuando
// no hay sprite: vector primero.
//
// La forma cuenta la progresión sin necesidad de leer el nombre: la fortaleza del
// emblema CRECE con el rango (una torre → dos → tres → la fortaleza coronada) y el
// metal sube de madera a oro. Las estrellas son las divisiones dentro del rango;
// el rango más alto no lleva (ahí ya no hay divisiones, solo la clasificación).
import { IMMORTAL_TIER, RANK_STARS, RANKS } from '@td/shared';

// Metales por rango: [oscuro, claro, brillo]. Pensados sobre el fondo oscuro del
// juego (--bg #0c101a): el tono claro es el que da la lectura a tamaño pequeño.
const METALS: [string, string, string][] = [
  ['#5d4037', '#a1887f', '#d7ccc8'], // Heraldo · madera y cuero
  ['#8d5524', '#cd7f32', '#ffcc80'], // Guardián · bronce
  ['#455a64', '#90a4ae', '#cfd8dc'], // Arconte · hierro
  ['#78909c', '#e3eaf0', '#ffffff'], // Leyenda · plata
  ['#00695c', '#4db6ac', '#b2dfdb'], // Ancestral · esmeralda
  ['#4527a0', '#9575cd', '#e1bee7'], // Divino · violeta
  ['#c98a00', '#ffd54f', '#fff8e1'], // Inmortal · oro encendido
];

// Estrella de 5 puntas centrada en (cx, cy). Se calcula en vez de escribirse a
// mano para poder cambiar el tamaño sin retocar diez números.
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}"`;
}

// Una torre almenada: el ladrillo del emblema. `merlons` (almenas) sube con el
// rango, así que la silueta se vuelve más imponente sin cambiar de dibujo.
function tower(x: number, y: number, w: number, h: number, merlons: number, fill: string, stroke: string): string {
  const paso = w / (merlons * 2 - 1);
  let d = `M${x},${y + h} L${x},${y + paso * 1.6}`;
  for (let i = 0; i < merlons; i++) {
    const ix = x + i * paso * 2;
    d += ` L${ix},${y} L${ix + paso},${y} L${ix + paso},${y + paso * 1.6}`;
    if (i < merlons - 1) d += ` L${ix + paso * 2},${y + paso * 1.6}`;
  }
  d += ` L${x + w},${y + h} Z`;
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"/>`;
}

// El emblema del centro, que crece con el rango.
function emblem(tier: number, claro: string, oscuro: string, brillo: string): string {
  const torres = tier <= 1 ? 1 : tier <= 3 ? 2 : 3;
  let out = '';
  if (torres === 1) {
    out += tower(35, 30, 30, 34, 3, claro, oscuro);
  } else if (torres === 2) {
    out += tower(26, 38, 20, 26, 3, claro, oscuro);
    out += tower(54, 38, 20, 26, 3, claro, oscuro);
    out += `<rect x="44" y="48" width="12" height="16" fill="${oscuro}" stroke="${oscuro}" stroke-width="1"/>`;
  } else {
    out += tower(22, 42, 17, 22, 3, claro, oscuro);
    out += tower(61, 42, 17, 22, 3, claro, oscuro);
    out += tower(38, 30, 24, 34, 4, claro, oscuro);
    out += `<rect x="37" y="52" width="26" height="12" fill="${oscuro}"/>`;
  }
  // puerta: el hueco que hace de "cara" del emblema y lo hace legible en pequeño
  out += `<path d="M46,64 L46,54 A4,4 0 0,1 54,54 L54,64 Z" fill="${oscuro}"/>`;
  // INMORTAL: corona sobre la fortaleza. Es el único que la lleva — la medalla
  // tiene que distinguirse de un vistazo incluso sin leer el puesto.
  if (tier === IMMORTAL_TIER) {
    out += `<path d="M50,20 L54,28 L61,24 L58,33 L42,33 L39,24 L46,28 Z" fill="${brillo}" stroke="${brillo}" stroke-width="1" stroke-linejoin="round"/>`;
  }
  return out;
}

// Medalla completa. `stars` a 0 = sin divisiones (rango más alto).
// `id` desambigua los gradientes: en una tabla hay varias medallas en la MISMA
// página y los ids de <defs> son globales al documento.
export function medalSvg(tier: number, stars: number, size = 96, id = `m${tier}`): string {
  const t = Math.max(0, Math.min(METALS.length - 1, tier));
  const [oscuro, claro, brillo] = METALS[t];
  const alto = stars > 0 ? 128 : 104;

  let estrellas = '';
  if (stars > 0) {
    // en arco BAJO el escudo (que acaba en y=101): si se solapan, la punta del
    // escudo y las estrellas se comen entre sí y no se lee ni una cosa ni la otra.
    for (let i = 0; i < RANK_STARS; i++) {
      const frac = i / (RANK_STARS - 1);
      const x = 20 + frac * 60;
      const y = 118 - Math.sin(frac * Math.PI) * 6;
      const on = i < stars;
      estrellas += `${star(x, y, on ? 7.5 : 6)} fill="${on ? brillo : '#0c101a'}" stroke="${on ? claro : oscuro}" stroke-width="1.4" stroke-linejoin="round" opacity="${on ? 1 : 0.65}"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${alto}" width="${size}" height="${(size * alto) / 100}" role="img" aria-label="${RANKS[t].name}${stars > 0 ? ` ${stars} estrellas` : ''}">
  <defs>
    <linearGradient id="${id}-metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${claro}"/>
      <stop offset="0.55" stop-color="${oscuro}"/>
      <stop offset="1" stop-color="${claro}"/>
    </linearGradient>
    <linearGradient id="${id}-campo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2436"/>
      <stop offset="1" stop-color="#0c101a"/>
    </linearGradient>
  </defs>
  <path d="M50,3 L89,17 L89,55 C89,78 72,92 50,101 C28,92 11,78 11,55 L11,17 Z" fill="url(#${id}-metal)"/>
  <path d="M50,9 L84,21 L84,55 C84,74 69,87 50,95 C31,87 16,74 16,55 L16,21 Z" fill="url(#${id}-campo)" stroke="${oscuro}" stroke-width="1.5"/>
  ${emblem(t, claro, oscuro, brillo)}
  <path d="M50,9 L84,21 L84,55 C84,74 69,87 50,95" fill="none" stroke="${brillo}" stroke-width="1.6" opacity="0.5"/>
  ${estrellas}
</svg>`;
}
