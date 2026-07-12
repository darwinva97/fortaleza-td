# ELEMENTTD.md — Estudio de Element TD 2 (¿qué robamos para Fortaleza TD?)

Fuente: `elementd/ELEMENT-TD-2.md` (análisis del binario Unity/IL2CPP) + `elementd/data/*.json`
(~822 KB de datos reales decompilados del juego). Todos los agregados de este documento fueron
**recalculados con scripts sobre los JSON** (no copiados de memoria). Donde el material solo trae el
*nombre* de una mecánica pero no su comportamiento, se dice explícitamente.

Hermano de `GREENTD.md` (Green TD / WC3). Cruce contra Fortaleza TD v18
(`packages/shared/src/constants.ts`, `balance/*`, `sim/*`).

---

## 0. Resumen de constantes globales (verificadas en los JSON)

| Constante | Valor | Fuente |
|---|---|---|
| Torres distintas | **59** (`towerType` 0–58) | `towers.json`, `enums.json` |
| Especializaciones | **118** (2 excluyentes por torre; texto íntegro) | `tower_specials.json` |
| Creeps (plantillas) | **63** | `creeps.json` |
| Habilidades de creep | **19** (enum 0–18) | `enums.json` |
| Buffs/debuffs | **53** | `buffs.json` |
| Oleadas atómicas | **2 390** (65 de jefe) | `spawnwaves.json`, `wave_stats.json` |
| Misiones campaña | **28** (4 capítulos) + 20 mapas libres + 12 co-op | `economy.json` (60 entradas) |
| Oro inicial | **250 constante en TODAS las misiones** | `economy.json` |
| Vidas iniciales | **50 → 250** (crecen por capítulo) | `economy.json` |
| HP de oleada | min 100 · mediana **14 000** · máx **10 000 000** | `wave_stats.json` |
| Botín por creep | min 5 · mediana **20** · máx 1 000 | `wave_stats.json` |
| Coste de vidas por fuga | **1** normal · **10** "Mega" · **25** jefe | `spawnwaves.json` (2094/239/57) |
| Velocidad de creep | **6.0** normal · **3.0** jefe/Mega · **1.5** jefe secreto | `spawnwaves.json` (2086/295/8; 1 caso a 2.0) |
| Modos de juego | Normal, Chaos, Extreme, Short, ExtraShort, AllRandom, SameRandom, God | `enums.json` |
| Determinismo | fixed-point `Raw/256` en velocidades/multiplicadores | `ELEMENT-TD-2.md` §0.5 |

> Dato de contexto: ETD2 valida nuestra apuesta técnica — usa **fixed-point determinista** para la
> sim, igual que nuestra sim entera con snapshots compactos.

---

## 1. El sistema elemental: torres como árbol de composición

La seña de identidad de ETD2: **las torres no se compran con oro de combate, se componen con
ELEMENTOS** que el jugador gana con calendario (picks por oleada). La progresión ES la elección:
con 6 elementos base nadie puede tenerlo todo, y cada partida define una "mano".

| Clase | towerType | Niveles | Cantidad | Escalado de daño/nivel |
|---|---|---|---|---|
| Starter (sin elemento) | 0–1 | 1 | 2 (Arrow, Cannon) | — |
| Elemento base | 2–7 | 4 | 6 | **×6, ×6, ×12** |
| 2 elementos (mismo) | 8–22 | 3 | 15 | **×4** |
| Dual (2 distintos) | 23–42 | 2 | 20 | **×4** |
| Definitiva (3+) | 43–58 | 1 | 16 | — |

Verificado en `towers.json`: Water 90 → 540 → 3 240 → **38 880**; Darkness 300 → … → **129 600**;
Vapor 1 150 → 4 600 → 18 400 (×4). El poder de una torre crece **exponencialmente** con la
inversión — dato clave para leer su curva de HP (§4.3).

**Identidad por elemento (nivel 1, `towers.json`):** Fire = rápido/barato (30 dmg, 3.0 atk/s);
Earth = lento/AoE (125, 0.66, AoE 300); Light = francotirador (130, rango 1500); Darkness =
pega-duro (300, 0.66, rango 1150) con **overflow del daño sobrante al matar** (specs "Overkill/
Shadowkill", `tower_specials.json`).

**`damageMultiplier` por torre** (`towers.json`, 0.6–3.0): las AoE llevan <1 (Cannon/Fire 0.6,
Earth 0.7) y las single-target de élite >1 (Light 1.3, Disease 1.5, Haste/Astral 2.0, CrystalSpire
3.0). Es un **normalizador de identidad AoE↔mono-objetivo** aplicado como factor plano — la
semántica exacta (¿botín?, ¿vs armadura?) no está en el material; el patrón sí.

**Torres de soporte sin daño** (`towers.json`: Blacksmith, Trickery, Muck sin stats de combate):
buff de daño, clonado de torres y slow puro. Equivalen a nuestro Estandarte/Sentry.

### Cruce con Fortaleza
- **(a) Ya lo tenemos editado:** nuestras 14 torres × (3 niveles + 2 specs + Rango II) + 11
  fusiones curadas son la versión "curada" del árbol elemental — mismas capas (base → spec →
  combinación) sin la explosión combinatoria de 59 torres.
- **(c) NO tenemos su pieza central: la progresión por ELECCIÓN programada.** En ETD2 eliges
  elementos con calendario y renuncias al resto; en Fortaleza la madera permite, con tiempo,
  comprarlo todo. Ver idea §9.5.
- **(no robar) El escalado ×6/×12:** solo funciona porque su curva de HP también es exponencial
  (§4.3). Con nuestro escalado aditivo sería un muro o un paseo.

---

## 2. Especializaciones: 118 poderes como texto-mecánica

`tower_specials.json` trae las 2 specs excluyentes de cada torre con su descripción numérica
completa (las 16 definitivas las tienen vacías — límite del material). Taxonomía de patrones, con
ejemplos textuales verificados:

| Patrón | Ejemplo (torre · spec) | Números |
|---|---|---|
| Alcance ↔ potencia | Light · *Omniscience* / Howitzer · *Longshot* | rango 1750 |
| Modo AURA (torre se convierte en buff) | Well · *Speed Aura* / Blacksmith · *Power Aura* | rango→250, +15/30/**150%** por 75 s |
| Ritmo garantizado cada N ataques | Geyser · *Unstable*/*Mega Burst* | cada 3.º → AoE 300 · cada 5.º → AoE 750 |
| Ramp POR OBJETIVO | Atom · *Quick Charge* | +30% daño/impacto, **se pierde al cambiar de objetivo**, tope 6 |
| Ramp de cadencia (calentamiento) | Haste · *Exhaust*/*Rain of Fire* | 6.0 atk/s −10%/ataque ↔ +5%/ataque hasta 8.0 |
| Condicional de contexto | Incantation · *Total Isolation* | objetivo aislado +40/80% · rodeado −40/80% |
| Condicional de VIDAS del equipo | Bloom · *Lifepower* | **si vidas ≥ 50 → +30% daño** |
| Anti-stunlock por objetivo | Ice · *Permafrost* | stun 0.2/0.4/0.6 s, mismo objetivo inmune 2 s |
| HP "prestado" | Polar · *Shatter* | quema 20/40% HP, **lo devuelve a los 5 s** |
| Bomba de relojería | Jinx · *Cursed of Death* | tras 30 s el objetivo recibe +25/50% daño |
| DoT denso ↔ largo | Poison · *Pestilence*/*Eternal Blight* | 80 dps ×10 s ↔ 30 dps ×30 s |
| Economía | Money · *Tall Contract* | botín extra +40/60% |

Constantes de tuning en `ability_constants.json`: cooldowns de auras 15 s, clon del Trickery 60 s,
slows de 3–5 s, y radios **× scale(mapa)** (los AoE escalan con el tamaño del mapa).

### Cruce con Fortaleza
- **(a)** Specs excluyentes con texto-mecánica: lo tenemos (2 specs + Rango II). Aura-torre: Estandarte
  (regla MAX). Botín extra: Alquimista ×1.3. DoT denso/largo: veneno + Corrosión ★★.
- **(c)** No tenemos: ramp por objetivo (§9.4), condicional de vidas del equipo (§9.3), ritmo
  garantizado cada-N, condicionales de contexto (aislado/rodeado), bomba de relojería. Los dos
  primeros son los que más encajan; el resto es catálogo para futuras fusiones.

---

## 3. Economía: botín PLANO + interés comprable

El hallazgo más contraintuitivo del material (`spawnwaves.json`, recalculado):

| HP del creep | Botín mediano | Oro TOTAL por oleada (botín×count, mediana) |
|---|---|---|
| 10² | 5 | 100 |
| 10³ | 15 | 240 |
| 10⁴ | 20 | 480 |
| 10⁵ | 75 | 600 |
| 10⁶ | 150 | 585 |

**El oro por oleada es prácticamente PLANO (mediana global 400, p10–p90 = 120–900) mientras el HP
crece ×10 000.** El botín escala ≈ raíz cúbica del HP (~HP^0.35), no lineal. ¿De dónde sale la economía entonces?
Del **interés comprable por niveles**: `Game._interestLevel`, `GetInterestRate() =
interestRate[_interestLevel]`, cobrado cada `GetInterestCooldown()` (+ `totalArbitrage` de
compra/venta de picks). Las tasas exactas no están en el material (lógica por modo de juego), pero
el mecanismo sí. El diseño resultante: **matar paga poco; invertir y aguantar sin gastar paga** —
banca clásica de TD competitivo.

Otras palancas (`economy.json`):
- **Oro inicial 250 constante en las 28 misiones**: la dificultad sube por presión de HP, velocidad
  del fast-forward y umbrales de puntuación, nunca por pobreza inicial.
- **Vidas 50 → 250** por capítulo, con fuga de 1/10/25 según clase del creep (§4.2): en el capítulo 4
  fugar un jefe = 25 de 250 (10%).
- Modificadores de partida (flags `Game`): `extreme`, `freePick`, `fullSell` (venta al 100%),
  `splitPath`.
- Meta-progresión: `expOnComplete` 100 → 5 000, esencia (moneda premium), `starThreshold1/2/3`.

### Cruce con Fortaleza
- **(a) Nuestro modelo es opuesto y a propósito:** botín creciente (`1+0.03(w−1)`, endless ×1.02
  compuesto desde o30 con tope ×3), bono de oleada creciente (20+4×oleada), y **llamar-antes paga
  2 🪙/s** — incentivamos gastar y acelerar, no acaparar. El interés % de ETD2 invertiría ese
  incentivo (ver descarte §9.D1).
- **(b) Dato que sí sugiere ajuste:** su venta al 100% es un *flag de sala* (`fullSell`), no una
  regla fija. Nuestro `SELL_REFUND = 0.7` fijo podría ser un mutador de sala barato (§9.6-bis).
- **(c) Esencia/EXP/estrellas persistentes:** meta-progresión entre partidas — requiere cuentas;
  descartado (§9.D2), salvo la versión por-partida (§9.6).

---

## 4. Oleadas: 2 390 átomos de diseño

### 4.1 Anatomía (recalculado de `spawnwaves.json`)

- **count** dominante: 30 (474), 20 (446), 10 (369), 40 (265), 15 (229). Enjambres de 50–200
  existen pero son raros (161 en total).
- **Elementos**: reparto base equilibrado (Water 287 … Darkness 230) + **Composite 602** (la clase
  más común: oleadas mixtas) + **Adaptive 197** + Ronald 8.
- **spacing** entre creeps: 0.33–1.0 s domina; **startDelay** de sub-oleadas: 10–60 s (oleadas
  compuestas de tandas temporizadas).
- **score** por oleada: 1–50 lo normal (máx no-jefe = 50), jefes 300–500 típico, Ronald 2 000–5 000
  — alimenta los umbrales de estrellas (§7).

### 4.2 Tres velocidades y tres costes de vida — legibilidad por ROL

| Clase | n | count | HP mediana | Botín | Velocidad | lifeCost |
|---|---|---|---|---|---|---|
| Normal | 2 086 | 10–40 | 14 000 | 20 | **6.0** | **1** |
| **"Mega" (mini-jefes)** | 239 | **3–6** | **140 000 (×10)** | **100–150** | **3.0 (mitad)** | **10** |
| Jefe (`isBoss`) | 57 | **1** | 400 000 (máx 10 M) | 500 (máx 1 000) | 3.0 | **25** |
| Ronald (jefe secreto) | 8 | 1 | 4 M (final 10 M) | 1 000 | **1.5** | **1** |

Todo creep normal corre EXACTAMENTE igual (6.0); lo gordo va a la mitad. La "velocidad" como
amenaza es una *habilidad* (Fast), no un stat. Y la fuga escala por **clase de creep**, no por
número de oleada.

El patrón **"Mega"** es un arquetipo de oleada completo que no tenemos: pelotón de 3–6 mini-jefes
con ×10 HP, mitad de velocidad, botín ×5–7 y fuga ×10. Un 10% de todas las oleadas del juego.

**Ronald** (element 7, `enums.json`): jefe-huevo-de-pascua que aparece **por temporizador**
(startDelay 0–420 s, no por oleada), con `lifeCost = 1` (fugarlo casi no castiga) y botín/score
máximos (1 000 🪙 / 2 000–5 000 pts) — un evento opcional de riesgo cero y recompensa alta.

### 4.3 La curva de HP — comparación numérica honesta

⚠️ **Límite del material:** `missions.json` trae la estructura por misión (n.º de oleadas,
`timeToNextWave` 3→15 s, spacing) pero con HP placeholder (0/100/225 en TODAS las entradas;
`hpFirst/hpLast/hpMedianGrowthPerWave` = null), y `spawnwaves.json` es una **bolsa desordenada**
(verificado: 0 tramos monótonos crecientes de ≥8 oleadas). La curva oleada-a-oleada exacta de cada
misión NO es reconstruible del material — lo que afirme lo contrario (§4.1 del MD previo) está
sobrevendido. Lo que SÍ se puede acotar:

| Recorrido observado | Oleadas | Factor geométrico implícito |
|---|---|---|
| 800 → 400 000 (típico campaña, `spawnwaves.json`) | ~35 | **×1.19/oleada** |
| 2 800 → 400 000 (misión corta, 25 oleadas) | ~25 | ×1.22/oleada |
| 100 → 10 000 000 (extremo/endless) | ~40 | ×1.33/oleada |

Contra Fortaleza (`balance/waves.ts`): lineal `1+0.11(w−1)` + ×1.13 compuesto desde o20 + ×1.10
extra desde o40 →

| Oleada | Fortaleza (mult. vs o1) | ETD2 (×1.19 geom.) |
|---|---|---|
| 10 | ×2.0 | ×4.8 |
| 20 | ×3.1 | ×27 |
| 36 | ×34 | **×440** |
| 60 | ×580 | ×28 700 |

**Su curva es un orden de magnitud más agresiva porque su poder de torre escala ×4–×12 por nivel
(§1) y su economía escala por interés compuesto (§3).** La lección no es "sube la curva": es que
curva de HP, curva de DPS y curva de economía deben ser la MISMA familia de función. Las nuestras
son las tres cuasi-lineales con rodilla geométrica tardía — coherentes entre sí. **(a) no robar.**

### Cruce con Fortaleza (oleadas)
- **(a)** Oleadas temáticas telegrafiadas, inmunes cada 5, jefes con cadencia, composición mixta,
  fuga cara de jefes (livesCost 1–6 + fuga escalonada `floor(oleada/10)`): lo tenemos igual o mejor.
- **(c)** Oleada de campeones "Mega" (§9.2), jefe-evento tipo Ronald (mención en §9.D5).

---

## 5. Habilidades de creep: 19, y las raras son AFIJOS DE JEFE

Distribución real (`wave_stats.json` + recalculado por clase):

| Habilidad | n oleadas | Perfil (mediana) | ¿La tenemos? |
|---|---|---|---|
| None | 721 | HP 6 000, count 30 | — |
| Avenger | 250 | HP 12 500 | ✗ (nombre solo; mecánica no está en el material) |
| Fast | 234 | HP 11 000 (−21% vs mediana global) | ✓ runner/berserker + afijo Veloz |
| **Mega** | 239 | **count 3, HP 140 000, botín 100, lifeCost 10** | ✗ → idea §9.2 |
| Healing | 196 | HP 12 250 | ✓ chamán (healAura) + afijo Vampírico |
| Undead | 154 | HP 13 750 | ✗ (nombre solo) |
| Timelapse | 143 | HP 15 000 | ✗ (nombre solo) |
| Mechanical | 135 | HP 18 000 (+29%: tanque) | ✗ (nombre solo; cf. afijo Gélido nuestro) |
| Regeneration | 119 | HP 18 000 | ✓ trol + afijo Regenerador |
| Spawner | 91 | HP 86 000, count 10, botín 60 | ✓ a medias (slime/golem paren AL MORIR, no en vida) |
| Transference | 43 | HP 16 000 | ✗ (nombre solo) |
| **SlingShot** | 19 | **count 1, HP 360 000, botín 500** | — solo en jefes |
| **Splitter** | 11 | count 1, HP 140 000 | — solo en jefes |
| **Phasing** | 11 | count 1, HP 400 000 | — solo en jefes |
| **FrostAura** | 10 | count 1, HP 525 000 | — solo en jefes |
| **Portal** | 8 | count 1, HP 4 M (= Ronald) | — solo en jefes |
| **HealingAura** | 4 | count 1, HP 2.25 M | — solo en jefes |
| **Inferno** | 2 | count 1, HP 2.45 M | — solo en jefes |

**El hallazgo estructural:** las 7 habilidades raras viven casi exclusivamente en entradas
`count = 1` con HP de jefe (0.4–4 M). ETD2 usa su sistema de habilidades de creep como **catálogo
de afijos de JEFE** — cada jefe llega con un modificador con nombre. Nosotros tenemos exactamente
esa tubería para las élites (1–2 afijos de 7, `balance/affixes.ts`, máscara de bits en snapshot)…
pero **nuestros jefes son vainilla**: golem/quimera/behemot siempre idénticos. Idea §9.1.

**Adaptive** (element 8, 197 oleadas, ninguna de jefe, HP mediana 14 500): oleadas "adaptativas"
anti-mono-build. El material solo da el nombre y la distribución; la mecánica concreta (resistencia
al daño recibido) no está en los JSON — pero como *concepto de afijo* es robable sin copiar nada.

---

## 6. Buffs, debuffs y las reglas anti-abuso

`buffs.json` (53): un buff con nombre por CADA efecto de torre (buffFire, buffPoison, buffJinx…),
más control (buffMuck, buffRoot, buffPolar, buffIce, buffNova) y dos piezas de diseño destacables:

- **`debuffDiminish`** — rendimientos decrecientes explícitos al apilar slows. Nuestra solución al
  mismo problema es más simple y ya está en la sim: los slows **no apilan** (gana el factor más
  fuerte, `sim/step.ts`: `if (factor < enemy.slowFactor)`) + `slowResist 0.7` del afijo Gélido.
  **(a) tenemos equivalente.**
- **Stun con inmunidad por objetivo** (Ice *Permafrost*: 0.2/0.4/0.6 s de stun, mismo objetivo
  inmune 2 s) — el patrón correcto si algún día añadimos stun de torre: hard-CC con cooldown POR
  OBJETIVO, no global. **(c) anotar para el futuro; hoy no tenemos stuns de torre.**
- `buffTowerDisabled` existe también en ETD2 (creeps que apagan torres) — nuestro Zapador ya lo hace
  al revés (enemigo que aturde torre). **(a).**

---

## 7. Misiones, puntuación y modos

- **28 misiones** en 4 capítulos (`economy.json`): vidas 50→250, oro Challenge 150→6 000, EXP
  100→5 000, y **fast-forward máximo creciente 1.3×→5.0×** (la velocidad de reproducción es una
  recompensa de progresión — nosotros ya damos ×1/×2/×3 al anfitrión, `GAME_SPEEDS`).
- **Estrellas por puntuación**: `starThreshold1/2/3` por misión (200 → 250 000) contra un score
  acumulado por oleada (campo `score` de `spawnwaves.json`: 1–50 normal; jefes hasta 5 000). Tres
  niveles de logro POR PARTIDA, sin ranking online. **(c) robable sin cuentas** (§9.6).
- **Modos** (`enums.json`): Chaos, Extreme, Short, ExtraShort, **AllRandom / SameRandom** (mano de
  elementos aleatoria — el "draft caótico"), God. Más flags de sala `fullSell`, `freePick`,
  `splitPath`. El coste de torre se modula **por modo** (`ApplyTowerCostMul`, base 100). Nosotros:
  3 modos × 3 dificultades; los *mutadores de sala* baratos (venta 100%, todo-aleatorio) son la
  parte robable. **(b).**
- **Co-op**: 12 mapas dedicados (6 con variante `_Boss`), mismos parámetros que campaña
  (`economy.json`). Su co-op es de mapas dedicados; el nuestro es transversal (cualquier mapa/modo).

---

## 8. Cruce honesto sistema a sistema

| Sistema ETD2 | Dato clave | Veredicto Fortaleza |
|---|---|---|
| Progresión por elección (elementos) | 59 torres compuestas; picks con calendario | **(c)** la elección programada nos falta → §9.5 |
| Escalado exponencial de torre | ×6/×6/×12 base, ×4 combos | (a) incompatible con nuestro escalado aditivo — no robar |
| Specs excluyentes con texto-mecánica | 118 en `tower_specials.json` | (a) tenemos; **(c)** faltan 4–5 *patrones* concretos → §9.3/9.4 |
| Botín plano + interés por niveles | oro/oleada mediana 400 PLANA; `interestRate[nivel]` | (a) nuestro modelo (botín creciente + llamar-antes) es opuesto a propósito → descarte §9.D1 |
| Curva HP geométrica | ×1.19–1.33/oleada (acotado) | (a) la nuestra es coherente con nuestro DPS/economía — no robar números |
| Velocidad por rol (6/3/1.5) | 87% de oleadas a 6.0 exacto | (a) la nuestra por-enemigo es más rica; lección de legibilidad ya aplicada |
| Fuga por clase (1/10/25) | `lifeCost` en `spawnwaves.json` | (a) livesCost 1–6 + fuga escalonada por oleada |
| Oleadas mixtas (Composite 602) | la clase más común | (a) nuestro generador por presupuesto mezcla siempre |
| **Oleada "Mega"** | 239 oleadas: 3–6 creeps, ×10 HP, ×10 fuga | **(c)** arquetipo completo que nos falta → §9.2 |
| **Afijos de jefe** (habilidades raras) | FrostAura/Phasing/Splitter/HealingAura solo en count=1 | **(c)** tubería ya existe (afijos de élite) → §9.1 |
| Adaptive (197 oleadas) | anti-mono-build con nombre | **(c)** como afijo de jefe → dentro de §9.1 |
| Slows con rendimiento decreciente | `debuffDiminish` | (a) no-stack + slowResist ya en sim |
| Jefe secreto por temporizador | Ronald: lifeCost 1, botín 1 000 | (b) simpático; mención §9.D5 |
| Estrellas por partida | thresholds 200→250 000 + score/oleada | **(c)** versión sin cuentas → §9.6 |
| Mutadores de sala | fullSell, AllRandom, Short | (b) baratos; anexar a §9.6 |
| EXP/esencia/meta | 100→5 000 EXP, moneda premium | descartado — exige cuentas → §9.D2 |

---

## 9. Ideas concretas para robar (ordenadas por impacto ÷ esfuerzo)

### 9.1 Afijos de JEFE — las "habilidades raras" como catálogo
**Qué:** desde cierta oleada (p. ej. o20, y siempre en endless), el jefe llega con **1 afijo de
jefe** con nombre, telegrafiado en el anuncio de oleada ("☠ Gólem **Gélido**").
**Respaldo ETD2:** las 7 habilidades raras (FrostAura n=10, Phasing n=11, Splitter n=11,
HealingAura n=4, SlingShot n=19, Inferno n=2, Portal n=8) viven solo en entradas count=1 con HP
0.4–4 M (`spawnwaves.json`) — ETD2 individualiza CADA jefe con un modificador.
**Por qué:** nuestros jefes del endless (o40+) son esponjas idénticas; el afijo convierte cada
jefe en un puzzle nuevo y da tema de conversación al co-op.
**Encaje:** la tubería existe entera — `AFFIX_ORDER`, máscara de bits en snapshot, makeElite.
Catálogo inicial sin tocar protocolo: reutilizar los 7 afijos de élite + 2 nuevos inspirados:
*Gélido inverso* (aura que baja cadencia de torres cercanas, cf. FrostAura) y *Adaptativo* (tras N
impactos del mismo attackType gana resistencia contra él, cf. element Adaptive) — este último
además hace brillar nuestra matriz 4×4. Determinista: el afijo sale del RNG de generateWave.
**Esfuerzo:** bajo. **Impacto:** alto en endless/horda.

### 9.2 Oleada de CAMPEONES (el patrón "Mega")
**Qué:** nuevo tema de oleada telegrafiado (👑): 3–6 mini-jefes con ×8–10 HP del presupuesto,
velocidad ×0.5, botín ×5, fuga tipo jefe (4–6 vidas c/u). Sin escolta.
**Respaldo ETD2:** 239 de 2 390 oleadas (10%) siguen EXACTAMENTE este molde: count mediana 3, HP
140 000 (×10 la mediana global), botín 100–150 (×5–7), lifeCost 10, velocidad 3.0
(`spawnwaves.json`).
**Por qué:** hoy nuestra textura es enjambre↔tanques↔jefe único; el pelotón de campeones es la
cuarta textura — pocas dianas gordas y lentas donde el foco de fuego co-op (y el oro de asistencia,
`ASSIST_SHARE 0.25`) brilla, y donde el perforante anti-colosal tiene su oleada estrella.
**Encaje:** un caso más en `generateWave` (como enjambre/aérea); armorType colosal o blindada;
cadencia sugerida: oleadas ≡ 3 (mód 10) desde la 13, sin chocar con inmunes (5), aéreas (7) ni
jefes (10). Determinista, cero cambios de protocolo.
**Esfuerzo:** bajo. **Impacto:** medio-alto (variedad + escaparate del rol perforante).

### 9.3 Spec ligada a las VIDAS COMPARTIDAS (Bloom "Lifepower")
**Qué:** una especialización (candidata: rama del Estandarte o del Arquero) con "+X% de daño
mientras el equipo conserve ≥ N vidas" (p. ej. ≥ 25 de 30).
**Respaldo ETD2:** Bloom *Lifepower*: "If you have 50 lives or more, damage is increased by 30%"
(texto íntegro en `tower_specials.json`).
**Por qué:** en un juego de **vidas compartidas** es la spec con más identidad co-op posible:
convierte "no fugar" en un buff colectivo tangible y crea el drama de "defended la racha". Riesgo
de bola de nieve inversa (vas mal → pegas menos) acotado con umbral bajo y bonus moderado (+20%).
**Encaje:** una condición determinista (`state.lives >= N`) en el cálculo de daño; el estado ya
está en el snapshot. UI: icono encendido/apagado en la torre.
**Esfuerzo:** trivial. **Impacto:** medio, muy memorable.

### 9.4 Ramp POR OBJETIVO (Atom "Quick Charge")
**Qué:** proc de Rango II o fusión: +X% de daño por impacto consecutivo **al mismo objetivo**
(tope 5–6 stacks); al cambiar de objetivo se pierde todo.
**Respaldo ETD2:** Atom *Quick Charge* ("+30% per hit, loses all stacks on target change, caps at
6") y Light *Acceleration* ("consecutive damage bonus +200%") — `tower_specials.json`.
**Por qué:** es el "fundidor de jefes" de identidad opuesta a nuestro crecimiento permanente
(Arco Largo: +8/disparo, tope 400) y a las ejecuciones por % de vida: no crece entre oleadas ni
remata — se ceba. Sinergia natural con §9.2 (campeones = pocas dianas persistentes). Contrapeso
automático: los enjambres lo anulan.
**Encaje:** en la torre, `lastTargetId` + `rampStacks` (2 enteros, solo estado de sim; ni siquiera
necesitan viajar en el snapshot si la UI lo infiere del daño). Candidato: Francotirador ★★ alt o
una fusión nueva.
**Esfuerzo:** bajo. **Impacto:** medio.

### 9.5 PICK de equipo programado (la esencia del sistema elemental, destilada)
**Qué:** cada 10 oleadas (o al matar cada jefe) el EQUIPO elige **1 de 3 mejoras globales**
sorteadas por el RNG de la sim: p. ej. +25% bono de oleada, +0.2 🪵/s de tala para todos, −15%
precio del mercado, +1 uso de Sentry gratis, +5 vidas… El anfitrión confirma (o voto simple).
**Respaldo ETD2:** es SU seña de identidad: la torre cuesta elementos que eliges con calendario y
**renuncias** al resto (`Game.eleWater…eleDarkness`, `freePick`, modos AllRandom/SameRandom que
existen solo para aleatorizar esa elección — `enums.json`); el interés también se compra por
niveles (`_interestLevel`). Todo su meta-juego es "qué elijo esta vez".
**Por qué:** nuestra madera compra TODO con tiempo — no hay renuncia, así que dos partidas buenas
se parecen. Un pick exclusivo programado crea identidad de partida y conversación de equipo
("¿eco o defensa?") sin tocar el roster de torres.
**Encaje:** las 3 opciones salen del RNG determinista (replay-safe); la elección es un input más
del protocolo (como comprar); el efecto es un modificador global en GameState (snapshot: 1 byte por
pick tomado). Es la idea con más superficie de UI (panel de voto) — por eso baja al 5.º puesto pese
al impacto.
**Esfuerzo:** medio. **Impacto:** alto (rejugabilidad).

### 9.6 Medallas por partida (estrellas sin cuentas)
**Qué:** puntuación acumulada por oleada (base por enemigo + multiplicador por vidas intactas) y
**3 umbrales por modo×dificultad** mostrados al final (🥉🥈🥇), guardados en localStorage.
**Respaldo ETD2:** `starThreshold1/2/3` por misión (200 → 250 000, `economy.json`) contra el campo
`score` de cada oleada (1–50 normal; jefes 300–500, Ronald 2 000–5 000; `spawnwaves.json`).
**Por qué:** da un objetivo de re-juego ("nos faltó el oro para la 3.ª estrella") sin ranking
online ni cuentas — compatible con nuestro co-op anónimo; el replay ya existente sirve de prueba.
**Bis (gratis casi):** mutadores de sala estilo ETD2 (`fullSell` = venta al 100%, "todo aleatorio")
como flags del lobby — 1 booleano en la config de sala cada uno.
**Esfuerzo:** medio (diseñar la fórmula de score es lo delicado). **Impacto:** medio (retención).

### Descartes razonados
- **D1 · Interés % comprable:** su botín es plano (mediana 400/oleada, §3) y el interés ES su
  economía; el nuestro crece con la oleada y **llamar-antes** paga por acelerar. Importar interés
  premiaría acaparar y jugar lento — exactamente el anti-patrón que nuestro diseño combate.
- **D2 · EXP/esencia/meta-progresión (100→5 000 EXP, moneda premium):** exige identidad persistente
  entre partidas; nuestro co-op es sin cuentas. La versión local (§9.6) captura el 20% útil.
- **D3 · Árbol de 59 torres por combinación:** sin el sistema de picks completo es solo inflación
  de roster; nuestras 11 fusiones curadas ya dan el "descubre combinaciones" con presupuesto de UI
  acotado.
- **D4 · Curva geométrica ×1.19–1.33:** requiere DPS ×4–×12 por nivel e interés compuesto (§4.3).
  Robar la curva sin robar las otras dos patas = muro.
- **D5 · Jefe secreto por temporizador (Ronald, lifeCost 1, botín 1 000):** encantador y barato de
  simular, pero en co-op tiempo real un jefe fuera-de-oleada complica la telegrafía (nuestro pilar)
  y el pacing del interludio. Rescatable algún día como evento de HORDA, donde el bucle ya tolera
  caos.
- **D6 · Clonado de torres (Trickery, clon 60 s de CD):** determinista viable, pero ¿clonar la
  torre de OTRO jugador con specs ajenas? Coste de UI/predicción alto y legibilidad dudosa — no
  paga su complejidad.

---

### Notas de fiabilidad
- Stats de torre, specs (texto íntegro), constantes de habilidad, economía de misiones, y los
  2 390 spawnwaves: **extraídos del binario y recalculados aquí con scripts** — alta confianza.
- Curva de HP por misión: **NO reconstruible** del material (`missions.json` trae placeholders;
  `spawnwaves.json` no conserva orden) — los factores ×1.19–1.33 son cotas geométricas derivadas de
  los recorridos min→máx, no medidas oleada a oleada.
- Mecánicas de habilidades de creep (Undead, Timelapse, Avenger, Mechanical, Adaptive…): el
  material solo trae **nombres y distribución estadística**, no su comportamiento — todo lo dicho
  aquí sobre ellas se limita a eso.
- Tasas de interés, bounty por oleada (`GetBounty`, constante 54) y coste por modo
  (`ApplyTowerCostMul`, base 100): **mecanismo verificado, valores exactos no presentes** (lógica
  condicional por modo de juego).
- Las 16 torres definitivas (3+ elementos) tienen sus 2 specs **vacías** en `tower_specials.json`.
