---

## 0.5 Resumen de constantes globales

| Constante | Valor | Fuente |
|---|---|---|
| Motor | Unity 2020.3.21f1 / IL2CPP | `globalgamemanagers`, `app.info` |
| Torres (tipos distintos) | **59** (`towerType` 0–58) | `Tower.towerType`, prefabs `Tower_N_*` |
| Especializaciones de torre | **118** (2 por torre con special) | `TowerSpecialDB.specialList` |
| Creeps (plantillas únicas) | **63** | `CreepDB.creepList` + `creepList_War` |
| Elementos base | **6**: Water, Fire, Nature, Earth, Light, Darkness | `Creep.baseEleType`, prefabs `Tower_*` |
| Oleadas atómicas (`SpawnWave`) | **2 390** (65 de jefe) | `SpawnWave` × mapas/modos |
| Misiones de campaña | **28** (4 capítulos) + coop + plantillas | `Game`, `SpawnManager` |
| Vida inicial | 50 → 250 (escala por capítulo) | `Game.life` / `startingLife_Challenge` |
| Oro inicial (normal) | **250** (constante) | `Game.gold` |
| Oro inicial (Challenge) | 150 → 6 000 (escala por misión) | `Game.startingGold_Challenge` |
| Multiplicador de velocidad máx. | 1.3 → 5.0 (por misión) | `Game.maxSpeedMultiplier` |
| Umbrales de estrella | 3 niveles por misión (200 → 250 000) | `Game.starThreshold1/2/3` |
| Buffs/debuffs distintos | **53** | `BuffDisplayDB` |
| Fixed-point determinista | valor real = `Raw / 256` | campos `{Raw:int}` (velocidades, mults) |

---

## 1. Sistema de torres (59 torres)

Element TD 2 **no cobra las torres en oro**: se construyen combinando **elementos** que ganas por
oleada. El `towerType` es la identidad; el `level` (1–4) es el nº de mejoras dentro de esa familia.
Las torres se agrupan por cuántos elementos las forman:

| Clase | `towerType` | Niveles | Torres |
|---|---|---|---|
| **Starter** (sin elemento) | 0–1 | 1 | Arrow, Cannon |
| **Elemento base** | 2–7 | **4** | Water, Fire, Nature, Earth, Light, Darkness |
| **2 elementos (mismo)** | 8–22 | **3** | Vapor, Well, Geyser, Ice, Poison, Solar, Blacksmith, Lightning, Infernal, Mushroom, Bloom, Disease, Atom, Howitzer, Trickery |
| **Dual (2 distintos)** | 23–42 | **2** | Impulse, Haste, Windstorm, Corrosion, Golem, Flow, Flooding, Polar, Muck, Astral, Quake, Nova, Jinx, Money, FlameThrower, Runic, Incantation, Root, Ethereal, Laser |
| **Definitivas (3+)** | 43–58 | **1** | Tsunami, Obelisk, Archdruid, Railgun, CrystalSpire, Singularity, GravityCannon, Plague, TeslaTree, PhantomZone, Rage, Doom, LifeAltar, Shredder, Nuclear, Periodic |

> Roster completo con `internalName`, clase y niveles en [`data/towers.json`](data/towers.json).
> El nombre sale del **GameObject** del prefab (`Tower_3_Water1`, `Tower_38_FlameThrower2`, …).

### 1.1 Especializaciones (los "poderes" de cada torre)

Cada torre elegible tiene **2 especializaciones excluyentes** (`idx` 0/1) con nombre y descripción
completos. Estas son el corazón del diseño de "poderes". Ejemplos textuales verificados
(`TowerSpecialDB.specialList`, `type` = `towerType`):

| Torre | Especialización A | Especialización B |
|---|---|---|
| **Water** (2) | *Splash* — si hay un creep a ≤500 de AoE, el ataque rebota (30 % daño) | *Hydro Power* — daño extra sube al 80 % |
| **Fire/Blaze** (3) | *Eternal Blaze* — se resetea tras 8 s sin atacar | *Quick Blaze* — el daño crece ×3 más rápido, tope a los 10 s |
| **Nature** (4) | *Hyper Burst* — +100 % de daño durante 3 s | *Inverse Burst* — +50 % daño, pero mitad los primeros 15 s |
| **Earth/Quake** (5) | *Ground Breaker* — onda +50 % daño, tope 750 AoE | *Distant Rumble* — −25 % daño, AoE máx. 1150 |
| **Light** (6) | *Omniscience* — rango a 1750 | *Acceleration* — bonus por daño consecutivo +200 % |

> Las **118** especializaciones (nombre + descripción íntegra en inglés) están en
> [`data/tower_specials.json`](data/tower_specials.json). Son la mejor fuente de las *mecánicas*
> numéricas (porcentajes, radios de AoE, duraciones), ya que el juego las expone como texto.

### 1.2 Stats de combate por torre (decompilados del binario)

Recuperados de `TowerDefinition.SetupTower` + `GetTowerAOE`. **`damage`** es por nivel (`/` separa
niveles); **`atkSpd`** = ataques/seg (más alto = más rápido); **`range`** en unidades del juego;
**`AoE`** = radio de splash (0 = monoobjetivo). Datos completos en [`data/towers.json`](data/towers.json).

| # | Torre | Elem | Clase | Daño por nivel | atkSpd | Rango | AoE |
|---|---|---|---|---|---|---|---|
| 0 | Arrow | Composite | starter | 60 | 1.5 | 900 | 0 |
| 1 | Cannon | Composite | starter | 77 | 0.66 | 750 | 300 |
| 2 | Water | Water | base | 90/540/3240/38880 | 1.5 | 900 | 200 |
| 3 | Fire | Fire | base | 30/180/1080/12960 | 3.0 | 750 | 300 |
| 4 | Nature | Nature | base | 85/510/3060/36720 | 3.0 | 750 | 0 |
| 5 | Earth | Earth | base | 125/750/4500/54000 | 0.66 | 900 | 300 |
| 6 | Light | Light | base | 130/780/4680/56160 | 1.5 | 1500 | 0 |
| 7 | Darkness | Darkness | base | 300/1800/10800/129600 | 0.66 | 1150 | 0 |
| 8 | Vapor | Water | 2-elem | 1150/4600/18400 | 0.66 | 900 | 0 |
| 9 | Well | Water | 2-elem | 450/1800/7200 | 1.5 | 900 | 0 |
| 10 | Geyser | Earth | 2-elem | 1050/4200/16800 | 1.0 | 750 | 0 |
| 11 | Ice | Water | 2-elem | 850/3400/13600 | 1.0 | 900 | 100 |
| 12 | Poison | Darkness | 2-elem | 130/520/2080 | 0.66 | 900 | 300 |
| 13 | Solar | Fire | 2-elem | 230/920/3680 | 1.0 | 750 | 0 |
| 14 | Blacksmith | Fire | 2-elem | — *(soporte: buff de cadencia)* | — | — | — |
| 15 | Lightning | Light | 2-elem | 180/720/2880 | 1.5 | 1150 | 0 |
| 16 | Infernal | Fire | 2-elem | 800/3200/12800 | 1.5 | 750 | 0 |
| 17 | Mushroom | Nature | 2-elem | 500/2000/8000 | 1.0 | 750 | 300 |
| 18 | Bloom | Nature | 2-elem | 355/1420/5680 | 1.5 | 750 | 200 |
| 19 | Disease | Darkness | 2-elem | 150/600/2400 | 3.0 | 900 | 0 |
| 20 | Atom | Light | 2-elem | 315/1260/5040 | 1.5 | 900 | 200 |
| 21 | Howitzer | Earth | 2-elem | 190/760/3040 | 1.0 | 1500 | 50 |
| 22 | Trickery | Light | 2-elem | — *(soporte: clona torres)* | — | — | — |
| 23 | Impulse | Nature | dual | 3000/12000 | 1.0 | 1500 | 0 |
| 24 | Haste | Fire | dual | 1000/4000 | 1.5 | 900 | 0 |
| 25 | Windstorm | Water | dual | 725/2900 | 0.2 | 1150 | 400 |
| 26 | Corrosion | Fire | dual | 140/560 | 1.0 | 900 | 300 |
| 27 | Golem | Nature | dual | 2700/10800 | 3.0 | 1150 | 0 |
| 28 | Wisp *(prefab: Flow)* | Water | dual | 750/3000 | 1.0 | 900 | 500 |
| 29 | Flooding | Water | dual | 470/1880 | 3.0 | 1150 | 300 |
| 30 | Polar | Water | dual | 1000/4000 | 1.5 | 900 | 300 |
| 31 | Muck | Earth | dual | — *(soporte: ralentiza)* | — | — | 300 |
| 32 | Astral | Light | dual | 2250/9000 | 1.0 | 1500 | 0 |
| 33 | Quake | Earth | dual | 2000/8000 | 1.5 | 750 | 100 |
| 34 | Nova | Light | dual | 750/3000 | 0.66 | 900 | 0 |
| 35 | Jinx | Darkness | dual | 1100/4400 | 1.5 | 900 | 200 |
| 36 | Money | Earth | dual | 3300/13200 | 1.0 | 1150 | 0 |
| 37 | FlameThrower | Fire | dual | 420/1680 | 1.5 | 750 | 200 |
| 38 | Runic | Darkness | dual | 1150/4600 | 1.0 | 1150 | 200 |
| 39 | Incantation | Nature | dual | 475/1900 | 3.0 | 900 | 200 |
| 40 | Root | Nature | dual | 100/400 | 1.5 | 900 | 200 |
| 41 | Ethereal | Darkness | dual | 900/3600 | 3.0 | 1500 | 100 |
| 42 | Laser | Light | dual | 6000/24000 | 1.0 | 900 | 0 |
| 43 | Tsunami | Water | ult | 7500 | 1.0 | 1150 | 0 |
| 44 | Obelisk | Fire | ult | 9000 | 1.0 | 900 | 0 |
| 45 | Archdruid | Nature | ult | 25000 | 0.33 | 900 | 300 |
| 46 | Railgun | Light | ult | 1000 | 1.0 | 750 | 0 |
| 47 | CrystalSpire | Water | ult | 35000 | 0.5 | 600 | 0 |
| 48 | Singularity | Light | ult | 13000 | 0.33 | 900 | 400 |
| 49 | GravityCannon | Earth | ult | 12400 | 1.0 | 1500 | 100 |
| 50 | Plague | Darkness | ult | 675 | 1.0 | 750 | 100 |
| 51 | TeslaTree | Nature | ult | 8000 | 1.5 | 900 | 0 |
| 52 | PhantomZone | Darkness | ult | 16000 | 0.33 | 900 | 0 |
| 53 | Rage | Fire | ult | 4200 | 1.0 | 900 | 0 |
| 54 | Doom | Darkness | ult | 2000 | 1.0 | 750 | 0 |
| 55 | LifeAltar | Nature | ult | 8500 | 1.0 | 900 | 200 |
| 56 | Shredder | Earth | ult | 13000 | 0.5 | 900 | 200 |
| 57 | Nuclear | Earth | ult | 10000 | 0.33 | 750 | 400 |
| 58 | Periodic | Earth | ult | 52000 | 1.0 | 1150 | 200 |

**Patrones de balance verificados:**
- **Escalado de daño de elementos base**: ×6 por nivel en niveles 1→2→3, y **×12** en el salto al nivel 4
  (ej. Water 90 → 540 → 3240 → 38880). Los combos de 2 elementos escalan **×4** por nivel; los duales
  también **×4**; las definitivas tienen un solo nivel.
- **Identidad por elemento** (nivel 1): Fire = rápido y barato (dmg 30, atkSpd 3.0); Earth = lento y
  fuerte (dmg 125, atkSpd 0.66); Light = alcance largo (1500); Darkness = pega-duro lento (dmg 300).
- **atkSpd** va de 0.2 (Windstorm, casi un aura) a 3.0 (Fire/Nature). **Rango** ∈ {600, 750, 900, 1150, 1500}.
- **AoE** ∈ {0, 50, 100, 200, 300, 400, 500}; 0 = monoobjetivo (mayoría de single-target de élite).
- **Torres de soporte** (Blacksmith, Trickery, Muck) no fijan daño de ataque: su valor es utilidad
  (buff de cadencia / clonado / slow).

### 1.3 Constantes de tuning de habilidad (del `.cctor` de `TowerDefinition`)

Valores concretos que gobiernan las mecánicas de habilidad, decompilados del constructor estático.
Completo en [`data/ability_constants.json`](data/ability_constants.json).

| Constante | Valor | Qué hace |
|---|---|---|
| `wellBuffCD` | 15 s | cooldown del buff del Well |
| `blacksmithBuffCD` | 15 s | cooldown del buff de cadencia del Blacksmith |
| `trickeryBuffCD` / `trickeryClonedCD` | 15 s / 60 s | cooldown de clonado del Trickery |
| `novaSlowDuration` | 3 s | duración del slow de Nova |
| `rootSlowDuration` | 5 s | duración del slow de Root |
| `hasteSpeedLossRate` | 0.5 | ritmo de pérdida de velocidad (Haste) |
| `atomDamageMultiplierResetTime` | 5 s | reset del multiplicador de daño del Atom |
| `runicAbilityCooldown` / `runicAbilityDuration` | 6 s / 3 s | habilidad Runic |
| `incantationDebuffDuration` | 5 s | debuff de Incantation |
| `hailAbilityCooldown` | 9 s | cooldown de Hail |
| `electricityBounceDelay` | 0.1 s | delay de rebote de Lightning |
| `earthShockwaveDelay` | 1 s | delay de onda de Earth |
| `tidalAOEDecrease` / `tidalAOEResetTime` | 10 / 6 s | decaimiento de AoE (Tidal) |
| **× scale (relativas al mapa)** | | |
| `impulseDistMultiplier` | 1000 × scale | empuje de Impulse |
| `darknessOverflowRange` | 750 × scale | alcance de overflow de Darkness |
| `earthShockwaveAOE` | 400 × scale | AoE de la onda de Earth |
| `jinxDebuffRange` / `incantationDebuffRange` | 200 × scale | rango de debuff (Jinx / Incantation) |

---

## 2. Elementos, oro, esencia e interés

- **Elementos** (`Game.eleWater/eleFire/eleNature/eleEarth/eleLight/eleDarkness`): son el "recurso de
  construcción". Combinándolos se desbloquean las torres de 2/dual/definitivas.
- **Oro** (`Game.gold`, inicio **250**): se gana por bajas (`Creep.goldValue`, base 3) y por **interés**.
- **Interés** (`Game._interestLevel`, `totalInterestGain`, `totalArbitrage`): economía de banca — guardar
  oro produce rendimiento. Mecánica (decompilada): `GetInterestRate()` devuelve
  `interestRate[_interestLevel]` (la tasa **sube con el nivel de interés**, que compras); el interés se
  cobra cada `GetInterestCooldown()`. El campo `totalArbitrage` confirma compra/venta de picks de elemento.
- **Coste de torre**: `GetBasicToElementTowerCost = ApplyTowerCostMul(100, type)` → base **100** (en
  esencia/elementos) modulado por un multiplicador **dependiente del modo de juego** (Chaos/Extreme/…).
  Los valores exactos por modo viven en lógica condicional encadenada (no en constantes planas).
- **Esencia** (`Game.essence`, `essenceSummoned`, `essenceSpent`): moneda premium para invocar/rerollear.
- **Vidas** (`Game.life`): 50 en capítulo 1 → 250 en 4-28.
- **Puntuación**: `starThreshold1/2/3` definen 1★/2★/3★; `expOnComplete` (100 → 5 000) da progresión meta.

Modificadores de partida (flags en `Game`): `extreme`, `freePick`, `fullSell`, `splitPath`.

---

## 3. Bestiario (63 creeps)

Los creeps son **plantillas por elemento+habilidad** con stats base uniformes; el HP real de cada
oleada lo fija `SpawnWave.hp` (§4), no el creep. Base (`Creep`): `hpFull=50`, `goldValue=3`,
`movementSpeed=3.0`, `lifeCost=1`, `hitRadius=0.25`.

### 3.1 Enum de elemento (`baseEleType`) — verificado por creep

Enum exacto `ElementType` (del dump IL2CPP): `0=Water, 1=Fire, 2=Nature, 3=Earth, 4=Light,
5=Darkness, 6=Composite, 7=Ronald` (jefe secreto), `8=Adaptive`.

Ejemplos: Gnarrlec Amphibian → Water; Blazing Dragon/Demon Lord → Fire; Ent Guard/Fairy Dragon →
Nature; Armored Troll/Cave Ogre → Earth; Hippogryph/Angelic Lich → Light; Ahriman/Ghost Mage → Darkness.

### 3.2 Habilidades de creep (enum `CreepAbility` 0–18, exacto)

`0=None, 1=Healing, 2=Fast, 3=Undead, 4=Mechanical, 5=Timelapse, 6=Avenger, 7=Bulky,
8=Regeneration, 9=SlingShot, 10=Mega, 11=Splitter, 12=Transference, 13=FrostAura, 14=Inferno,
15=Spawner, 16=Phasing, 17=HealingAura, 18=Portal`. Bestiario completo en
[`data/creeps.json`](data/creeps.json).

### 3.3 Jefes

`CreepDB` referencia jefes por elemento (`bossPrefabWater/Fire/Nature/Earth/Light/Darkness/Essence/Interest`)
más `bossRonaldPrefab` (jefe secreto) y `Doomguard` (aparece en todos los elementos como jefe de campaña).

---

## 4. Diseño de oleadas (2 390 `SpawnWave`)

Cada `SpawnWave` = una sub-oleada con: `count`, `spacing`, `startDelay`, `element`, `ability`,
`isBoss`, `hp`, `speed`, `bounty`, `score`, `lifeCost`, y `prefab`→creep. Agregados globales
([`data/wave_stats.json`](data/wave_stats.json)):

- **HP**: min 100 · mediana **14 000** · media 77 346 · **máx 10 000 000** (modos extreme/endless).
  Distribución logarítmica: la mayoría 4–5 dígitos (10³–10⁵), cola de 6–7 dígitos.
- **Bounty**: min 5 · mediana **20** · máx 1 000. Escala con el HP.
- **Jefes**: 65 de 2 390 (~1 cada 37 oleadas).
- **`count` por oleada**: dominan **20** (446), **30** (474), **10** (369), **40** (265), **15** (229).
- **Reparto de elementos**: base equilibrado (Water 287 / Fire 276 / Nature 284 / Earth 261 / Light 245 /
  Darkness 230) + **Composite 602** (oleadas mixtas, las más comunes) + Neutral 197.

### 4.1 Estructura por misión

`SpawnManager.waveList` da la secuencia real por mapa (nombre + `count`, `hp`, `bounty`, `element`,
`ability`, `isBoss`, `creepSpacing`, `waveSpacing`, `timeToNextWave`, `subWaveList` anidada). **30
misiones** con su curva de HP wave-a-wave en [`data/missions.json`](data/missions.json) (incluye
`hpMedianGrowthPerWave` y las oleadas de jefe).

---

## 5. Buffs y debuffs (53)

Catálogo completo en [`data/buffs.json`](data/buffs.json). Cubre efectos de torre (`buffFire`,
`buffPoison`, `buffJinx`, `buffCorrosion`, `buffRunic`, `buffQuake`, `buffSingularity`,
`buffGravityCannon`, `buffPlague`, `buffDoom`, `buffNuclear`…) y debuffs de control
(`buffMuck`, `buffRoot`, `buffWindstorm`, `buffPolar`, `buffIce`, `buffNova`, `debuffDiminish`
— rendimientos decrecientes de slows, clave anti-stack).

---

## 6. Economía de campaña (28 misiones, escalado)

Tabla completa en [`data/economy.json`](data/economy.json). Curva verificada:

| Cap. | Misiones | Vida | Oro Challenge | Vel. máx | EXP |
|---|---|---|---|---|---|
| **1** | 1-1 … 1-7 | 50 | 150 → 500 | 1.3 → 1.75 | 100 → 700 |
| **2** | 2-8 … 2-14 | 75 | 750 → 1 500 | 1.75 → 2.5 | 800 → 1 400 |
| **3** | 3-15 … 3-21 | 100–150 | 1 700 → 3 000 | 2.0 → 4.25 | 1 500 → 3 000 |
| **4** | 4-22 … 4-28 | 150–250 | 3 300 → 6 000 | 2.5 → 5.0 | 2 200 → 5 000 |

El oro inicial "normal" es siempre 250: la dificultad se sube con **vida menor relativa al HP de la
oleada**, **más velocidad** y umbrales de estrella más altos, no con menos oro base.

---

## 7. Modelo de daño y contraste con `fortaleza-td`

Element TD 2 **no** usa la matriz tipo-de-ataque × tipo-de-armadura de Warcraft 3 (que sí modela
`fortaleza-td` / GreenTD). Su profundidad viene de otro sitio:

| Eje | Element TD 2 | fortaleza-td (v17) |
|---|---|---|
| Coste de torre | **Elementos** combinados (no oro) | Oro + madera (specs/Rango II) |
| Identidad de rol | 59 torres, cada una un efecto único | 14 torres + matriz 4×4 ataque/armadura |
| Contrajuego | Elemento de la oleada ↔ torres que lo explotan; slows con `debuffDiminish` | `spellImmune`, invisibles (Sentry), colosal/blindado |
| Especializaciones | 2 por torre + variantes (idx 0/1) con texto de mecánica | 2 specs + Rango II por torre |
| Economía | Oro + **interés** + **esencia** + picks de elemento | Oro + **madera** + mercado + interés implícito |
| Escala de dificultad | HP de oleada (hasta 10 M), velocidad, vidas | `waveHpMult`, afijos élite, endless bounty |

**Ideas transferibles a `fortaleza-td`:**
1. **Especializaciones como texto-mecánica**: ETD2 define cada poder con un string preciso
   ("+100 % daño 3 s", "AoE máx 1150", "rebota 30 %"). Es un patrón limpio para tu `specs`/`rank2`.
2. **`debuffDiminish`** (rendimientos decrecientes de slow) — evita el stack infinito de ralentización;
   equivalente a tu tope de slow, pero como debuff explícito en el creep.
3. **Curva de HP por oleada como dato** (no fórmula): ETD2 hardcodea `SpawnWave.hp` por oleada/mapa.
   Da control fino de la curva; tú lo generas con `waveHpMult`. Ver la curva real en `data/missions.json`.
4. **Composite waves (602)**: la oleada más común es mixta de elementos → fuerza diversificar torres,
   igual que tus oleadas inmunes/aéreas fuerzan diversificar tipos de ataque.
5. **Vida escalando 50→250 con oro base constante**: sube dificultad por presión de HP/velocidad, no por
   pobreza — contrasta con tu `START_GOLD` por dificultad.

---

## 8. Números base de combate — RESUELTO 

Las 142 instancias de prefab `Tower` tienen `damage = speed = range = 1.0` (placeholders): los stats
base se asignan **por código** en `TowerDefinition.SetupTower(Tower)`, un `switch` gigante sobre
`towerType` con sub-`switch` por `level`. 

- Se localizó `SetupTower` (RVA `0x1990050`) y `GetTowerAOE` (RVA `0x198EA40`) en `dump.cs`.
- Se leyeron los offsets de campo de `Tower` (`damage@0xD0`, `speed@0xD4`, `range@0xD8`,
  `baseDamage@0x138`…) y se extrajeron las constantes `mov dword [rdi+off], <bits float>` de cada caso.
- Resultado: **stats de las 59 torres** (§1.2 y [`data/towers.json`](data/towers.json)). Auto-consistente
  (escalado ×6/×12, identidades por elemento), validado contra el diseño conocido de ETD2.

**(§1.3): las 22 constantes de tuning de habilidad del `.cctor` de `TowerDefinition`.

**Parcialmente trazado (mecanismo conocido, valores exactos por modo requieren seguir cadenas de
funciones):** el interés (`interestRate[_interestLevel]`, ver §2), el bounty por oleada
(`GetBounty(waveIndex)` — llama a un helper con la oleada y la constante 54) y el coste de torre
(`ApplyTowerCostMul`, base 100 × multiplicador por modo de juego). No son constantes planas: son
lógica condicional que ramifica por `_GameMode`.

---

## 9. Archivos de datos

| Archivo | Contenido |
|---|---|
| [`data/towers.json`](data/towers.json) | 59 torres: tipo, nombre, elemento, clase, **stats de combate por nivel** (daño/cadencia/rango/AoE), 2 especializaciones |
| [`data/tower_specials.json`](data/tower_specials.json) | 118 especializaciones con descripción íntegra |
| [`data/creeps.json`](data/creeps.json) | 63 creeps: elemento, habilidad, HP/oro/velocidad base, flags |
| [`data/spawnwaves.json`](data/spawnwaves.json) | 2 390 oleadas atómicas (HP, count, element, bounty, boss) |
| [`data/missions.json`](data/missions.json) | 30 misiones con secuencia de oleadas + curva de HP |
| [`data/economy.json`](data/economy.json) | 60 modos/mapas: oro/vida/umbrales/velocidad/EXP |
| [`data/buffs.json`](data/buffs.json) | 53 buffs/debuffs |
| [`data/wave_stats.json`](data/wave_stats.json) | Analítica global de oleadas |
| [`data/ability_constants.json`](data/ability_constants.json) | 22 constantes de tuning de habilidad (cooldowns, duraciones, rangos) |
| [`data/enums.json`](data/enums.json) | Enums exactos (IL2CPP): towerType, element, creepAbility, gameMode |
