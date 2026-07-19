import type { EnemyTypeId } from '../types.js';

// ---------- F9a (v19) · CALENDARIO CLÁSICO DE 36 (estilo Green TD) ----------
//
// En modo CLÁSICO cada oleada es UNA especie temática con contrajuego claro, en un
// calendario FIJO y PÚBLICO (GREENTD.md §3 y §10.2: la telegrafía sin sorpresas es
// lo que da sensación de dominio). Patrones prometidos al jugador:
//   · AÉREAS en niveles fijos: 7, 17, 23, 27 y 35 (la 35 es la Quimera, jefa voladora)
//   · INMUNES a magia cada 5 desde la 10 (10/20/30; las de Quimera quedan exentas
//     — triple castigo aire+jefe+inmune sería injusto, ver isImmuneWave)
//   · CAMPEONES 👑 en 16, 22 y 31 (pelotón de mini-jefes sin escolta, item F9a-3)
//   · INVISIBLES 👁 en 12, 18 y 24 (isInvisibleWave; la 30 es inmune y la 36 jefe)
//   · BLOQUE ÉLITE 28-34: armadura dura y velocidad (caballeros, mamuts, sombras)
//   · JEFES en su cadencia de siempre (10/15/20/25/30/35) y JEFE-MURO en la 36
//
// La curva de vida sigue siendo LA NUESTRA (waveHpMult): el calendario solo pone
// especie, cantidad y un `hpTune` de afinado fino. ELEMENTTD.md §4.3 explica por
// qué NO copiar tablas de HP ajenas: la curva de vida, la de DPS y la de economía
// deben ser la misma familia de función — y las nuestras ya lo son.
//
// `count` es la cantidad BASE para 1 jugador; generateWave la escala ×(1+0.3·(n−1))
// como el presupuesto del generador (la vida ya escala aparte con waveHpMult).
// El INFINITO y la HORDA conservan su generador por presupuesto de siempre.

export interface CalendarWave {
  wave: number;
  type: EnemyTypeId; // especie temática (en oleadas de jefe: la ESCOLTA)
  count: number; // cantidad base (1 jugador)
  boss?: EnemyTypeId; // jefe de la oleada (la especie pasa a ser su escolta)
  champion?: boolean; // oleada de CAMPEONES 👑: count campeones, sin escolta
  championHp?: number; // override del ×CHAMPION_HP_MULT (el Mamut ya es gordo de base)
  hpTune?: number; // afinado a mano: multiplica el hp de TODA la oleada (antes de élite)
  // Espaciado FIJO entre spawns (segundos): las especies con auras (sanadores,
  // portaestandartes) marchan separadas para que sus burbujas no se apilen en un
  // tren imparable. Ausente = el espaciado por oleada de siempre.
  gap?: number;
  theme: string; // nombre corto del tema (Guía + telegrafía)
}

export const CLASSIC_CALENDAR: CalendarWave[] = [
  // Calibración: count×cost ≈ presupuesto del generador (waveBudget) con factor
  // <1 cuando la especie trae defensa extra (curas, esquiva, invisible, división).
  // El slime "cuesta" ~16 efectivo (pare 2 babosines al morir).
  { wave: 1, type: 'goblin', count: 7, theme: 'La avanzadilla goblin' },
  { wave: 2, type: 'runner', count: 8, theme: 'Estampida de corredores' },
  { wave: 3, type: 'larva', count: 30, theme: 'Marabunta de larvas' },
  // Las oleadas 4-9 son LECCIONES (división, tanques, ladrones, aire, zapadores,
  // sanadores): van deliberadamente por debajo del presupuesto — cada una enseña
  // UN contrajuego. El primer examen de verdad es el Gólem de la 10.
  { wave: 4, type: 'slime', count: 3, hpTune: 0.9, theme: 'Gelatina que se divide' },
  { wave: 5, type: 'brute', count: 3, hpTune: 0.85, theme: 'Los primeros tanques' },
  { wave: 6, type: 'thief', count: 8, theme: 'Banda de ladrones' },
  { wave: 7, type: 'bat', count: 11, theme: 'AÉREA · nube de murciélagos' },
  // Zapadores: MUY pocos a propósito — su amenaza es el bloqueo (aturden torres),
  // no sus stats; con 4+ a la vez la oleada era un mazazo injugable, no una lección.
  { wave: 8, type: 'sapper', count: 3, theme: 'Cuadrilla de zapadores' },
  // Sanadores: pocos Y espaciados — en tren compacto sus auras se apilaban en una
  // muralla de curación imposible para el early game (visto en simtest: 8 fugas).
  { wave: 9, type: 'shaman', count: 5, gap: 1.6, theme: 'Círculo de sanadores' },
  // Escolta de BRUTOS (armadura 2), no de blindados: la oleada ya es inmune a
  // magia — inmune + armadura 8 apilaba dos resistencias en el primer jefe. El
  // hpTune 0.9 hace del primer Gólem un examen aprobable, no una ejecución.
  { wave: 10, type: 'brute', count: 2, boss: 'golem', hpTune: 0.85, theme: 'EL GÓLEM (inmune)' },
  { wave: 11, type: 'armored', count: 9, theme: 'La falange blindada' },
  { wave: 12, type: 'runner', count: 22, theme: 'INVISIBLE · corredores fantasma' },
  // Los primeros CAMPEONES llegan en la 16, no en la 13: a la 13 el equipo aún no
  // tiene Rango II y una fuga de campeón (6 vidas) era una condena, no una lección.
  { wave: 13, type: 'troll', count: 6, theme: 'Muro regenerante' },
  { wave: 14, type: 'berserker', count: 8, theme: 'Frenesí berserker' },
  { wave: 15, type: 'bat', count: 10, boss: 'chimera', theme: 'LA QUIMERA (voladora)' },
  { wave: 16, type: 'brute', count: 3, champion: true, theme: 'CAMPEONES 👑 · brutos colosales' },
  { wave: 17, type: 'harpy', count: 10, theme: 'AÉREA · arpías sanadoras' },
  { wave: 18, type: 'stalker', count: 14, theme: 'INVISIBLE · acechadores' },
  { wave: 19, type: 'runebrat', count: 26, theme: 'Plaga de duendes rúnicos' },
  // Escolta de DUENDES RÚNICOS: ya son inmunes de serie — tema redondo y cuerpo
  // ligero (la oleada inmune castiga por RESISTENCIA, no por doble muro de placas).
  { wave: 20, type: 'runebrat', count: 14, boss: 'golem', theme: 'EL GÓLEM (inmune) con duendes' },
  // Portaestandartes espaciados: si marchan pegados, sus auras de celeridad se
  // solapan en un río imparable; separados, cada uno es un objetivo prioritario.
  { wave: 21, type: 'bannerman', count: 10, gap: 1.2, theme: 'La procesión acelerada' },
  { wave: 22, type: 'mammoth', count: 3, champion: true, championHp: 3, theme: 'CAMPEONES 👑 · mamuts de guerra' },
  { wave: 23, type: 'gargoyle', count: 12, theme: 'AÉREA · gárgolas blindadas' },
  { wave: 24, type: 'brute', count: 15, theme: 'INVISIBLE · brutos fantasma' },
  { wave: 25, type: 'harpy', count: 6, boss: 'chimera', theme: 'LA QUIMERA con arpías' },
  { wave: 26, type: 'wraith', count: 17, theme: 'Legión de espectros mayores' },
  { wave: 27, type: 'skywhale', count: 7, theme: 'AÉREA · colosos alados' },
  { wave: 28, type: 'knight', count: 13, theme: 'ÉLITE · caballería corrupta' },
  { wave: 29, type: 'berserker', count: 13, hpTune: 1.25, theme: 'ÉLITE · frenesí desatado' },
  // Escolta de BLINDADOS (hp bajo), no de caballeros (5k c/u): inmune + placas 10
  // + jefe era EL muro donde morían la mayoría de barridos del simtest.
  { wave: 30, type: 'armored', count: 8, boss: 'golem', theme: 'EL GÓLEM (inmune) acorazado' },
  { wave: 31, type: 'knight', count: 4, champion: true, theme: 'CAMPEONES 👑 · caballeros colosales' },
  { wave: 32, type: 'mammoth', count: 7, theme: 'ÉLITE · manada de mamuts' },
  { wave: 33, type: 'stalker', count: 17, hpTune: 1.3, theme: 'ÉLITE · sombras veloces' },
  { wave: 34, type: 'armored', count: 20, hpTune: 2.2, theme: 'ÉLITE · la falange final' },
  { wave: 35, type: 'gargoyle', count: 8, boss: 'chimera', theme: 'LA QUIMERA con gárgolas' },
  { wave: 36, type: 'armored', count: 8, boss: 'behemoth', hpTune: 1.15, theme: 'EL JEFE-MURO · Behemot' },
];

// Entrada del calendario clásico para una oleada (null fuera de rango).
export function classicWave(wave: number): CalendarWave | null {
  return wave >= 1 && wave <= CLASSIC_CALENDAR.length ? CLASSIC_CALENDAR[wave - 1] : null;
}
