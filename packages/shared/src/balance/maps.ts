import type { MapDef } from '../types.js';

// Los waypoints son [col, fila] de celdas; los enemigos caminan por sus centros.
// Los segmentos entre waypoints deben ser horizontales o verticales.

export const MAPS: MapDef[] = [
  {
    id: 'sendero',
    name: 'El Sendero',
    desc: 'Un camino en S, clásico para empezar.',
    gridW: 20,
    gridH: 12,
    theme: 'grass',
    paths: [
      [
        [0, 2],
        [16, 2],
        [16, 5],
        [3, 5],
        [3, 9],
        [19, 9],
      ],
    ],
    blocked: [
      [8, 0],
      [9, 0],
      [1, 11],
      [18, 0],
      [0, 7],
      [12, 11],
      [19, 4],
    ],
  },
  {
    id: 'tenazas',
    name: 'Las Tenazas',
    desc: 'Dos entradas que convergen: hay que defender ambos flancos.',
    gridW: 20,
    gridH: 12,
    theme: 'desert',
    paths: [
      [
        [0, 1],
        [8, 1],
        [8, 5],
        [13, 5],
        [13, 8],
        [19, 8],
      ],
      [
        [0, 10],
        [6, 10],
        [6, 8],
        [13, 8],
        [19, 8],
      ],
    ],
    blocked: [
      [18, 1],
      [19, 0],
      [0, 5],
      [10, 11],
      [16, 3],
      [3, 4],
    ],
  },
  {
    id: 'espiral',
    name: 'La Espiral',
    desc: 'Camino larguísimo hacia el centro. Ideal para morteros.',
    gridW: 20,
    gridH: 12,
    theme: 'snow',
    paths: [
      [
        [0, 0],
        [19, 0],
        [19, 11],
        [2, 11],
        [2, 3],
        [16, 3],
        [16, 8],
        [6, 8],
        [6, 5],
        [10, 5],
      ],
    ],
    blocked: [
      [0, 11],
      [0, 10],
      [12, 6],
    ],
  },
  {
    id: 'cruce',
    name: 'La Encrucijada',
    desc: 'Mapa grande con dos rutas que se cruzan dos veces. El caos está garantizado.',
    gridW: 24,
    gridH: 14,
    theme: 'grass',
    paths: [
      [
        [0, 4],
        [6, 4],
        [6, 9],
        [12, 9],
        [12, 4],
        [18, 4],
        [18, 9],
        [23, 9],
      ],
      [
        [15, 0],
        [15, 6],
        [9, 6],
        [9, 13],
      ],
    ],
    blocked: [
      [2, 1],
      [21, 2],
      [1, 12],
      [22, 12],
      [19, 0],
      [3, 7],
      [20, 6],
      [10, 11],
      [4, 11],
      [17, 12],
    ],
  },
  {
    id: 'volcan',
    name: 'El Volcán',
    desc: 'Serpentea entre ríos de lava en un mapa grande. Cuidado con el calor.',
    gridW: 26,
    gridH: 15,
    theme: 'volcano',
    paths: [
      [
        [0, 7],
        [4, 7],
        [4, 2],
        [12, 2],
        [12, 12],
        [20, 12],
        [20, 5],
        [25, 5],
      ],
    ],
    blocked: [
      [8, 7],
      [16, 7],
      [2, 13],
      [24, 13],
      [1, 0],
      [24, 0],
      [7, 10],
      [17, 3],
      [23, 9],
      [9, 4],
      [15, 14],
    ],
  },
  {
    id: 'laberinto',
    name: 'El Gran Laberinto',
    desc: 'El camino más largo jamás construido, en el mapa más gigante. Paciencia y morteros.',
    gridW: 28,
    gridH: 16,
    theme: 'desert',
    paths: [
      [
        [0, 1],
        [26, 1],
        [26, 4],
        [2, 4],
        [2, 7],
        [26, 7],
        [26, 10],
        [2, 10],
        [2, 13],
        [27, 13],
      ],
    ],
    blocked: [
      [0, 15],
      [27, 15],
      [0, 3],
      [13, 15],
      [5, 15],
      [22, 15],
      [27, 0],
      [12, 0],
      [0, 12],
      [27, 4],
    ],
  },
  {
    id: 'delta',
    name: 'El Delta',
    desc: 'Tres entradas convergen en una sola salida por la cueva de cristal.',
    gridW: 24,
    gridH: 14,
    theme: 'crystal',
    paths: [
      [
        [0, 2],
        [9, 2],
        [9, 7],
        [23, 7],
      ],
      [
        [0, 12],
        [9, 12],
        [9, 7],
        [23, 7],
      ],
      [
        [16, 0],
        [16, 7],
        [23, 7],
      ],
    ],
    blocked: [
      [3, 7],
      [6, 5],
      [20, 3],
      [20, 11],
      [2, 0],
      [12, 10],
      [13, 4],
      [4, 9],
      [21, 1],
      [12, 12],
    ],
  },
  {
    id: 'concilio',
    name: 'El Concilio',
    desc: 'Cinco huestes convergen desde los bordes hacia el trono central. Cada quien defiende su flanco; las vidas se pierden juntas.',
    gridW: 32,
    gridH: 20,
    theme: 'grass',
    // Mapa radial estilo Green TD: 5 entradas serpentean por su territorio y
    // TODAS confluyen en un tramo final compartido hasta el castillo en (16,10).
    paths: [
      // flanco noroeste
      [
        [0, 2],
        [10, 2],
        [10, 6],
        [4, 6],
        [4, 9],
        [13, 9],
        [13, 10],
        [16, 10],
      ],
      // flanco suroeste
      [
        [0, 17],
        [10, 17],
        [10, 13],
        [4, 13],
        [4, 10],
        [13, 10],
        [16, 10],
      ],
      // flanco noreste
      [
        [31, 2],
        [21, 2],
        [21, 6],
        [27, 6],
        [27, 9],
        [18, 9],
        [18, 10],
        [16, 10],
      ],
      // flanco sureste
      [
        [31, 17],
        [21, 17],
        [21, 13],
        [27, 13],
        [27, 10],
        [18, 10],
        [16, 10],
      ],
      // flanco norte (baja por el eje central)
      [
        [16, 0],
        [16, 3],
        [13, 3],
        [13, 6],
        [16, 6],
        [16, 10],
      ],
    ],
    blocked: [
      [0, 0],
      [31, 0],
      [0, 19],
      [31, 19],
      [16, 13],
      [15, 15],
      [17, 15],
      [16, 17],
      [7, 4],
      [24, 4],
      [7, 15],
      [24, 15],
      [1, 10],
      [30, 10],
      [0, 5],
      [31, 5],
      [19, 4],
      [12, 4],
      [19, 15],
      [12, 15],
    ],
  },
  {
    id: 'ochopuertas',
    name: 'Las Ocho Puertas',
    desc: 'Ocho huestes por ocho puertas convergen en la Ciudadela del noroeste. Cada color guarda su carril; todos suben la muralla oeste hasta el trono. Derrota compartida.',
    gridW: 56,
    gridH: 32,
    theme: 'grass',
    // Escala y estructura Green TD (§9 de GREENTD.md): OCHO carriles independientes
    // y separados, cada uno con su spawn en el perímetro, que CONVERGEN a un trono
    // «de fondo» en la esquina noroeste (la Ciudadela en (4,1)) subiendo por un
    // TRONCO compartido en la muralla oeste (col 4). Es exactamente el patrón de
    // Green TD: territorios propios que confluyen en una zona común antes del trono
    // (allí las vidas se pierden juntas). Cuatro puertas del ESTE (peines rectos
    // desde el borde derecho, filas 3/6/9/12) y cuatro del SUR (ganchos anidados
    // desde el borde inferior) — nunca se cruzan entre sí (nido concéntrico).
    // Longitudes equilibradas ±10% por construcción (verificado con pathLength:
    // 53..62, media ~57): los peines del este acortan tronco a más alcance de rib;
    // los ganchos del sur cambian rib por tronco a la inversa. La sim reparte los
    // spawns entre rutas (i % nºrutas) y todos fugan al mismo trono compartido.
    paths: [
      // ——— cuatro puertas del ESTE: peines rectos hacia la muralla oeste ———
      // Este-1 (fila 3): rib largo (borde derecho) + tronco corto (2)
      [
        [55, 3],
        [4, 3],
        [4, 1],
      ],
      // Este-2 (fila 6)
      [
        [55, 6],
        [4, 6],
        [4, 1],
      ],
      // Este-3 (fila 9)
      [
        [55, 9],
        [4, 9],
        [4, 1],
      ],
      // Este-4 (fila 12)
      [
        [55, 12],
        [4, 12],
        [4, 1],
      ],
      // ——— cuatro puertas del SUR: ganchos ANIDADOS (no se cruzan) ———
      // Sur-1 (el más exterior: col 34, sube pronto a la fila 16)
      [
        [34, 31],
        [34, 16],
        [4, 16],
        [4, 1],
      ],
      // Sur-2 (col 32, fila 19)
      [
        [32, 31],
        [32, 19],
        [4, 19],
        [4, 1],
      ],
      // Sur-3 (col 30, fila 22)
      [
        [30, 31],
        [30, 22],
        [4, 22],
        [4, 1],
      ],
      // Sur-4 (el más interior: col 28, fila 25)
      [
        [28, 31],
        [28, 25],
        [4, 25],
        [4, 1],
      ],
    ],
    // murallas/decoración: separan los ocho territorios y adornan el mapa. NINGUNA
    // pisa un carril (verificado por pathCells en tools/simtest). Filas de camino:
    // 3/6/9/12 (este) y 16/19/22/25 (sur); tronco en col 4; verticales sur en cols
    // 28/30/32/34. Todo lo demás es libre para construir o decorar.
    blocked: [
      // muros entre los peines del este (filas pares intermedias, cols altas)
      [20, 4],
      [38, 4],
      [50, 5],
      [14, 5],
      [28, 7],
      [44, 8],
      [18, 8],
      [52, 10],
      [34, 10],
      [10, 11],
      [46, 11],
      [24, 11],
      // corona sobre la Ciudadela (fila 0-2, lejos del trono)
      [20, 0],
      [40, 0],
      [30, 1],
      [50, 1],
      [46, 2],
      // campos del sureste, abiertos (los ganchos sur no llegan más allá de col 34)
      [44, 18],
      [50, 20],
      [40, 24],
      [48, 27],
      [42, 29],
      [52, 31],
      [38, 21],
      // huecos entre ganchos del sur (cols bajas, filas impares intermedias)
      [12, 20],
      [20, 24],
      [10, 28],
      [16, 30],
      [22, 18],
      [8, 27],
      // muralla oeste bajo el tronco (col 0-2, no pisa la col 4)
      [1, 29],
      [2, 30],
    ],
  },
  {
    id: 'calzada',
    name: 'La Calzada Real',
    desc: 'Dos calzadas imperiales, anchas y monumentales, que se cruzan camino del palacio. Organiza la defensa en dos frentes.',
    gridW: 48,
    gridH: 28,
    theme: 'desert',
    // Dos autopistas SEPARADAS con exactamente 2 puntos de cruce (en (8,14) y
    // (40,14)). La calzada A cruza el mapa de oeste a este con una plaza elevada
    // en el centro; la avenida B entra por el noroeste, baja por la ciudad y sale
    // por el noreste, cruzando A en sus dos «arcos». Layout monumental y legible.
    paths: [
      // A · calzada real oeste→este con plaza central elevada
      [
        [0, 14],
        [20, 14],
        [20, 10],
        [28, 10],
        [28, 14],
        [47, 14],
      ],
      // B · gran avenida en arco (noroeste → noreste), cruza A dos veces en
      // (8,14) y (40,14). El fondo del arco (fila 17) queda equilibrado con A
      // a ±10% (verificado con pathLength: 66 vs 55, media 60.5).
      [
        [8, 0],
        [8, 17],
        [40, 17],
        [40, 0],
      ],
    ],
    blocked: [
      // monumentos y estatuas a lo largo de las calzadas (ninguno pisa un carril)
      [24, 4],
      [14, 6],
      [34, 6],
      [4, 8],
      [44, 8],
      [24, 14],
      [12, 18],
      [36, 18],
      [24, 24],
      [4, 24],
      [44, 24],
      [2, 2],
      [46, 2],
      [2, 26],
      [46, 26],
    ],
  },
  {
    id: 'torre',
    name: 'La Torre',
    desc: 'Vertical, pensado para el móvil en retrato: una larga escalera helada que serpentea hasta el pie de la torre.',
    gridW: 14,
    gridH: 24,
    theme: 'snow',
    // Un único camino largo en serpentina vertical (entra arriba, sale abajo).
    paths: [
      [
        [2, 0],
        [2, 3],
        [11, 3],
        [11, 7],
        [2, 7],
        [2, 11],
        [11, 11],
        [11, 15],
        [2, 15],
        [2, 19],
        [11, 19],
        [11, 23],
      ],
    ],
    blocked: [
      [7, 0],
      [11, 0],
      [7, 1],
      [7, 5],
      [2, 5],
      [7, 9],
      [11, 9],
      [7, 13],
      [2, 13],
      [7, 17],
      [11, 17],
      [7, 21],
      [2, 21],
      [6, 23],
      [13, 0],
      [0, 23],
      [13, 12],
      [0, 11],
    ],
  },
];

export function getMap(id: string): MapDef {
  const m = MAPS.find((m) => m.id === id);
  if (!m) throw new Error(`Mapa desconocido: ${id}`);
  return m;
}
