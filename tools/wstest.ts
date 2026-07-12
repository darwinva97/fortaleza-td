// Prueba end-to-end contra el backend real: dos clientes WebSocket crean una
// sala, empiezan la partida, colocan una torre, llaman la oleada y verifican
// que los enemigos se mueven y el chat funciona.
// Requiere el WORKER de Cloudflare corriendo (pnpm cf:dev y PORT=8787).
import WebSocket from 'ws';
import {
  getMap,
  makePlacementContext,
  placementError,
  replayTo,
  sha256Hex,
  type ClientMsg,
  type ReplayData,
  type SaveData,
  type ServerMsg,
} from '@td/shared';

// Sirve tanto para el servidor Node (ignora el query) como para el Worker de
// Cloudflare (enruta por ?create=1 / ?code=XXXX al Durable Object de la sala).
const HOST = `localhost:${process.env.PORT ?? 8787}`;
const BASE = `ws://${HOST}/ws`;
const HTTP_BASE = `http://${HOST}`;
const wsUrl = (opts: { create: true } | { code: string }): string =>
  'create' in opts ? `${BASE}?create=1` : `${BASE}?code=${opts.code}`;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures.push(msg);
    console.error(`❌ FALLO: ${msg}`);
  } else {
    console.log(`✅ ${msg}`);
  }
}

class TestClient {
  ws: WebSocket;
  name: string;
  msgs: ServerMsg[] = [];
  ticks: Extract<ServerMsg, { type: 'tick' }>[] = [];

  constructor(name: string, url: string) {
    this.name = name;
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg;
      if (msg.type === 'tick') this.ticks.push(msg);
      else this.msgs.push(msg);
    });
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  async open(): Promise<void> {
    await new Promise<void>((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
    });
  }

  async waitFor<T extends ServerMsg['type']>(type: T, timeoutMs = 5000): Promise<Extract<ServerMsg, { type: T }>> {
    const start = Date.now();
    for (;;) {
      const found = this.msgs.find((m) => m.type === type);
      if (found) {
        this.msgs.splice(this.msgs.indexOf(found), 1);
        return found as Extract<ServerMsg, { type: T }>;
      }
      if (Date.now() - start > timeoutMs) throw new Error(`${this.name}: timeout esperando "${type}"`);
      await sleep(40);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // 1. Ana crea la sala
  const ana = new TestClient('Ana', wsUrl({ create: true }));
  await ana.open();
  ana.send({
    type: 'create_room',
    name: 'Ana',
    token: 'token-ana-test',
    settings: { mapId: 'sendero', mode: 'classic', difficulty: 'normal' },
  });
  const joined = await ana.waitFor('room_joined');
  assert(joined.code.length === 4, `sala creada con código ${joined.code}`);
  assert(joined.isHost, 'la creadora es anfitriona');
  await ana.waitFor('lobby_state');

  // 2. Beto se une con el código
  const beto = new TestClient('Beto', wsUrl({ code: joined.code }));
  await beto.open();
  beto.send({ type: 'join_room', name: 'Beto', token: 'token-beto-test', code: joined.code });
  const joined2 = await beto.waitFor('room_joined');
  assert(!joined2.isHost, 'el segundo jugador no es anfitrión');
  const lobby = await ana.waitFor('lobby_state');
  assert(lobby.players.length === 2, 'el lobby muestra 2 jugadores');

  // 3. Chat en el lobby
  beto.send({ type: 'chat', text: 'hola familia!' });
  const chat = await ana.waitFor('chat');
  assert(chat.text === 'hola familia!' && chat.from === 'Beto', 'el chat llega a los demás');

  // 3b. Beto marca «Listo» (la partida solo arranca con todos los no-anfitriones listos)
  ana.send({ type: 'start_game' }); // aún sin listos: debe rechazarse
  const notReady = await ana.waitFor('error');
  assert(/listo/i.test(notReady.msg), 'iniciar sin todos listos se rechaza');
  beto.send({ type: 'set_ready', ready: true });
  const readyLobby = await ana.waitFor('lobby_state');
  assert(readyLobby.players.find((p) => !p.isHost)?.ready === true, 'el jugador aparece como «listo»');

  // 3c. Desmarcar «Listo» durante la cuenta atrás la CANCELA (countdown con seconds=0)
  ana.send({ type: 'start_game' });
  const cdCancelable = await ana.waitFor('countdown');
  assert(cdCancelable.seconds === 3, 'la cuenta atrás arranca con 3s');
  beto.send({ type: 'set_ready', ready: false });
  const cdCancel = await ana.waitFor('countdown');
  assert(cdCancel.kind === 'start' && cdCancel.seconds === 0, 'desmarcar «Listo» cancela la cuenta atrás');
  // consumir el aviso de sistema (deja limpio el buffer de chat para los tests siguientes)
  const cancelMsg = await ana.waitFor('chat');
  assert(cancelMsg.from === '' && /cancelado/i.test(cancelMsg.text), 'todos ven el aviso de cancelación');
  beto.send({ type: 'set_ready', ready: true });
  // consumir lobby_state hasta VER a Beto listo (el del desmarcado llega antes)
  for (;;) {
    const lb = await ana.waitFor('lobby_state');
    if (lb.players.find((p) => !p.isHost)?.ready === true) break;
  }

  // 4. Empieza la partida (con cuenta regresiva de 3s antes de arrancar)
  ana.send({ type: 'start_game' });
  const cd = await ana.waitFor('countdown');
  assert(cd.kind === 'start' && cd.seconds === 3, 'el inicio lleva cuenta regresiva de 3s');
  const initA = await ana.waitFor('game_started', 6000);
  const initB = await beto.waitFor('game_started', 6000);
  assert(initA.init.players.length === 2, 'la partida arranca con 2 jugadores');
  assert(initA.init.youAre !== initB.init.youAre, 'cada cliente sabe quién es');

  // 5. Ana coloca una torre en una celda válida
  const map = getMap(initA.init.mapId);
  const ctx = makePlacementContext(map);
  let cell: [number, number] | null = null;
  outer: for (let cy = 0; cy < map.gridH; cy++) {
    for (let cx = 0; cx < map.gridW; cx++) {
      if (placementError(map, ctx, [], cx, cy) === null) {
        cell = [cx, cy];
        break outer;
      }
    }
  }
  assert(cell !== null, 'hay una celda construible');
  ana.send({ type: 'cmd', cmd: { kind: 'place', towerType: 'archer', cx: cell![0], cy: cell![1] } });

  // 6. Llamar la oleada ya
  await sleep(400);
  ana.send({ type: 'cmd', cmd: { kind: 'call_wave' } });

  // 7. Recibir ticks ~6 segundos y verificar
  await sleep(6000);
  assert(ana.ticks.length > 40, `Ana recibió ${ana.ticks.length} ticks (~15/s)`);
  assert(beto.ticks.length > 40, `Beto recibió ${beto.ticks.length} ticks`);

  const last = ana.ticks[ana.ticks.length - 1].snap;
  assert(last.towers.length === 1, 'la torre colocada aparece en el snapshot');
  assert(last.wave === 1, `la oleada 1 está activa (wave=${last.wave})`);

  const withEnemies = ana.ticks.filter((t) => t.snap.enemies.length > 0);
  assert(withEnemies.length > 20, `aparecen enemigos (${withEnemies.length} ticks con enemigos)`);

  // ¿se mueven? comparar la posición del mismo enemigo entre dos ticks
  let moved = false;
  for (let i = 0; i < withEnemies.length - 5 && !moved; i++) {
    const e0 = withEnemies[i].snap.enemies[0];
    const e1 = withEnemies[i + 5].snap.enemies.find((e) => e[0] === e0[0]);
    if (e1 && (Math.abs(e1[2] - e0[2]) > 0.01 || Math.abs(e1[3] - e0[3]) > 0.01)) moved = true;
  }
  assert(moved, 'los enemigos se mueven por el camino');

  const events = ana.ticks.flatMap((t) => t.events);
  assert(events.some((e) => e.e === 'wave_start'), 'llegó el evento de inicio de oleada');
  assert(events.some((e) => e.e === 'death' || e.e === 'hit'), 'la torre dispara (hay hits o bajas)');

  // 8. Con la partida en curso, un token NUEVO entra como ESPECTADOR (F1.4):
  //    ve la partida en vivo y puede guiar (chat con prefijo 👁, sugerir torres).
  const carla = new TestClient('Carla', wsUrl({ code: joined.code }));
  await carla.open();
  carla.send({ type: 'join_room', name: 'Carla', token: 'token-carla-test', code: joined.code });
  const carlaJoined = await carla.waitFor('room_joined');
  assert(carlaJoined.spectator === true, 'un token nuevo entra como espectador con la partida en curso');
  assert(!carlaJoined.isHost, 'el espectador no es anfitrión');
  // recibe el estado de la partida para renderizar + ticks en vivo
  const carlaInit = await carla.waitFor('game_started');
  assert(carlaInit.init.players.length === 2, 'el espectador recibe el init de la partida en curso');
  await sleep(1200);
  assert(carla.ticks.length > 10, `el espectador ve la partida (${carla.ticks.length} ticks)`);

  // su chat llega a los jugadores con el prefijo 👁
  carla.send({ type: 'chat', text: 'pongan un cañón ahí!' });
  const specChat = await ana.waitFor('chat');
  assert(specChat.from.startsWith('👁'), `el chat del espectador lleva prefijo 👁 (from="${specChat.from}")`);
  assert(specChat.text === 'pongan un cañón ahí!', 'el chat del espectador llega con su texto');

  // su sugerencia de torre (map_ping + towerType) se reenvía a los jugadores
  carla.send({ type: 'map_ping', x: 3, y: 3, towerType: 'cannon' });
  const suggestion = await ana.waitFor('map_ping');
  assert(suggestion.towerType === 'cannon', 'la sugerencia de torre del espectador llega con towerType');
  assert(suggestion.by.startsWith('👁'), 'la sugerencia se atribuye al espectador (prefijo 👁)');

  // un comando de juego del espectador se IGNORA (no puede colocar torres)
  const towersBefore = ana.ticks[ana.ticks.length - 1].snap.towers.length;
  carla.send({ type: 'cmd', cmd: { kind: 'place', towerType: 'archer', cx: 0, cy: 0 } });
  await sleep(600);
  const towersAfter = ana.ticks[ana.ticks.length - 1].snap.towers.length;
  assert(towersAfter === towersBefore, 'el cmd de un espectador se ignora (no coloca torres)');

  carla.ws.close();

  // 9. Reconexión: Beto se cae y vuelve con el mismo token
  beto.ws.close();
  await sleep(300);
  const beto2 = new TestClient('Beto2', wsUrl({ code: joined.code }));
  await beto2.open();
  beto2.send({ type: 'join_room', name: 'Beto', token: 'token-beto-test', code: joined.code });
  await beto2.waitFor('room_joined');
  const reInit = await beto2.waitFor('game_started');
  assert(reInit.init.players.length === 2, 'reconexión: recupera la partida en curso con su token');
  await sleep(500);
  assert(beto2.ticks.length > 3, 'reconexión: vuelve a recibir ticks');

  ana.ws.close();
  beto2.ws.close();

  // 9.5 · ABANDONO explícito: un jugador manda `leave` a mitad de partida.
  //   (a) el resto ve el aviso de sistema «💨 X abandonó la partida»
  //   (b) el que se fue NO puede reconectar con su token (entra de espectador)
  //   (c) la partida SIGUE para el resto (y sus torres quedan en el tablero)
  await abandonScenario();

  // 9.6 · ZONA DE ESPECTADORES: mover/traer del lobby, y la distinción
  //   expulsar (puede volver, solo de espectador) vs banear (no vuelve jamás)
  await spectatorZoneScenario();

  // 10. Repetición (replay): partida corta que TERMINA (sin defensa) e incluye la
  //     reconexión de Beto. Al recibir game_over con `replay`, reconstruimos con el
  //     motor puro y comparamos el estado final con el de la partida real (leído de
  //     los últimos snapshots). DEBEN SER IDÉNTICOS.
  await replayIdentityScenario();

  // 11. Guardar/Cargar (issue #12): jugar → pausar → pedir save_info → validar que el
  //     log del guardado reconstruye el estado congelado → crear sala from-save →
  //     reclamar slots por token → reanudar → verificar que continúa desde ahí.
  await saveLoadScenario();

  if (failures.length > 0) {
    console.error(`\n💥 ${failures.length} fallos`);
    process.exit(1);
  }
  console.log('\n🎉 Test end-to-end OK');
  process.exit(0);
}

// Escenario dedicado: ZONA DE ESPECTADORES del lobby (PR #15) + kick vs ban.
// (a) el anfitrión mueve a un jugador a espectadores y lo trae de vuelta;
// (b) EXPULSAR no banea: el expulsado vuelve con su token, pero SOLO de espectador;
// (c) BANEAR (a un espectador o a un jugador) bloquea la entrada por completo.
async function spectatorZoneScenario(): Promise<void> {
  console.log('\n— Zona de espectadores: mover/traer, expulsar vs banear —');
  const gia = new TestClient('Gia', wsUrl({ create: true }));
  await gia.open();
  gia.send({
    type: 'create_room',
    name: 'Gia',
    token: 'token-zone-gia',
    settings: { mapId: 'sendero', mode: 'classic', difficulty: 'normal' },
  });
  const gj = await gia.waitFor('room_joined');

  const hugo = new TestClient('Hugo', wsUrl({ code: gj.code }));
  await hugo.open();
  hugo.send({ type: 'join_room', name: 'Hugo', token: 'token-zone-hugo', code: gj.code });
  const hj = await hugo.waitFor('room_joined');
  const ivan = new TestClient('Ivan', wsUrl({ code: gj.code }));
  await ivan.open();
  ivan.send({ type: 'join_room', name: 'Ivan', token: 'token-zone-ivan', code: gj.code });
  const ij = await ivan.waitFor('room_joined');

  // (a) mover a Hugo a la zona de espectadores…
  gia.send({ type: 'move_to_spectator', playerId: hj.playerId });
  const hugoSpec = await hugo.waitFor('room_joined');
  assert(hugoSpec.spectator === true, 'el movido a la zona recibe room_joined como espectador');
  for (;;) {
    const lb = await gia.waitFor('lobby_state');
    if (lb.spectators.some((s) => s.id === hj.playerId) && !lb.players.some((p) => p.id === hj.playerId)) {
      assert(true, 'el lobby lo lista en spectators y ya no en players');
      break;
    }
  }
  // …y traerlo de vuelta como jugador (además lo perdona de cualquier kick)
  gia.send({ type: 'move_to_player', spectatorId: hj.playerId });
  const hugoBack = await hugo.waitFor('room_joined');
  assert(hugoBack.spectator === false, 'el restaurado recibe room_joined como jugador');
  for (;;) {
    const lb = await gia.waitFor('lobby_state');
    if (lb.players.some((p) => p.id === hj.playerId) && lb.spectators.length === 0) {
      assert(true, 'el lobby lo devuelve a players y la zona queda vacía');
      break;
    }
  }

  // (b) EXPULSAR a Iván: puede volver con su token, pero SOLO de espectador (pineado)
  gia.send({ type: 'kick_player', playerId: ij.playerId });
  await sleep(300);
  const ivan2 = new TestClient('Ivan2', wsUrl({ code: gj.code }));
  await ivan2.open();
  ivan2.send({ type: 'join_room', name: 'Ivan', token: 'token-zone-ivan', code: gj.code });
  const ivan2j = await ivan2.waitFor('room_joined');
  assert(ivan2j.spectator === true, 'el EXPULSADO vuelve a entrar, pero solo de espectador');
  for (;;) {
    const lb = await gia.waitFor('lobby_state');
    if (lb.spectators.some((s) => s.id === ivan2j.playerId)) {
      assert(true, 'el expulsado aparece en la zona de espectadores del lobby');
      break;
    }
  }

  // (c1) BANEAR al espectador Iván: se le echa y su token ya no entra jamás
  gia.send({ type: 'ban_player', playerId: ivan2j.playerId });
  await sleep(300);
  const ivan3 = new TestClient('Ivan3', wsUrl({ code: gj.code }));
  await ivan3.open();
  ivan3.send({ type: 'join_room', name: 'Ivan', token: 'token-zone-ivan', code: gj.code });
  const banErr = await ivan3.waitFor('error');
  assert(/bane/i.test(banErr.msg), `el BANEADO (desde espectadores) no puede volver a entrar ("${banErr.msg}")`);

  // (c2) BANEAR a un jugador directamente (Hugo): mismo bloqueo total
  gia.send({ type: 'ban_player', playerId: hj.playerId });
  await sleep(300);
  const hugo2 = new TestClient('Hugo2', wsUrl({ code: gj.code }));
  await hugo2.open();
  hugo2.send({ type: 'join_room', name: 'Hugo', token: 'token-zone-hugo', code: gj.code });
  const banErr2 = await hugo2.waitFor('error');
  assert(/bane/i.test(banErr2.msg), `el BANEADO (jugador) no puede volver a entrar ("${banErr2.msg}")`);

  gia.ws.close();
  hugo.ws.close();
  ivan.ws.close();
  ivan2.ws.close();
  ivan3.ws.close();
  hugo2.ws.close();
  await sleep(200);
}

// Escenario dedicado: ABANDONO explícito (mensaje `leave`) a mitad de partida.
// Verifica el aviso al resto, la invalidación del token (vuelve de espectador) y
// que la partida continúa con las torres del que se fue intactas.
async function abandonScenario(): Promise<void> {
  console.log('\n— Abandono explícito (leave) —');
  const dora = new TestClient('Dora', wsUrl({ create: true }));
  await dora.open();
  dora.send({
    type: 'create_room',
    name: 'Dora',
    token: 'token-abandon-dora',
    settings: { mapId: 'sendero', mode: 'classic', difficulty: 'normal' },
  });
  const dj = await dora.waitFor('room_joined');
  await dora.waitFor('lobby_state');

  const emo = new TestClient('Emo', wsUrl({ code: dj.code }));
  await emo.open();
  emo.send({ type: 'join_room', name: 'Emo', token: 'token-abandon-emo', code: dj.code });
  await emo.waitFor('room_joined');
  await dora.waitFor('lobby_state');

  emo.send({ type: 'set_ready', ready: true });
  for (;;) {
    const lb = await dora.waitFor('lobby_state');
    if (lb.players.find((p) => !p.isHost)?.ready === true) break;
  }

  dora.send({ type: 'start_game' });
  await dora.waitFor('countdown');
  const initD = await dora.waitFor('game_started', 6000);
  await emo.waitFor('game_started', 6000);

  // Emo coloca una torre: debe QUEDARSE en el tablero tras abandonar
  const map = getMap(initD.init.mapId);
  const ctx = makePlacementContext(map);
  let cell: [number, number] | null = null;
  outer: for (let cy = 0; cy < map.gridH; cy++) {
    for (let cx = 0; cx < map.gridW; cx++) {
      if (placementError(map, ctx, [], cx, cy) === null) {
        cell = [cx, cy];
        break outer;
      }
    }
  }
  emo.send({ type: 'cmd', cmd: { kind: 'place', towerType: 'archer', cx: cell![0], cy: cell![1] } });
  await sleep(500);
  const towersBefore = dora.ticks[dora.ticks.length - 1]?.snap.towers.length ?? 0;
  assert(towersBefore >= 1, `la torre del que se irá está en el tablero (${towersBefore})`);

  // Emo ABANDONA la partida
  emo.send({ type: 'leave' });

  // (a) el resto ve el aviso de sistema «💨 Emo abandonó la partida»
  const bye = await dora.waitFor('chat');
  assert(
    bye.from === '' && /abandon/i.test(bye.text) && bye.text.includes('Emo'),
    `todos ven el aviso «💨 Emo abandonó la partida» (text="${bye.text}")`,
  );

  // (c) la partida SIGUE para el resto: siguen llegando ticks…
  const ticksAtLeave = dora.ticks.length;
  await sleep(1500);
  assert(dora.ticks.length > ticksAtLeave + 5, `la partida sigue para el resto (+${dora.ticks.length - ticksAtLeave} ticks)`);
  // …y las torres del que abandonó QUEDAN en el tablero (no se retiran)
  const towersAfter = dora.ticks[dora.ticks.length - 1].snap.towers.length;
  assert(towersAfter >= towersBefore, `las torres del que abandonó quedan (${towersAfter} >= ${towersBefore})`);
  // el que abandonó cuenta como DESCONECTADO (el escalado por conectados se ajusta)
  const emoSnap = dora.ticks[dora.ticks.length - 1].snap.players.find((p) => p.id !== initD.init.youAre);
  assert(emoSnap?.connected === false, 'el que abandonó cuenta como desconectado permanente');

  // (b) Emo intenta volver con su MISMO token → entra de ESPECTADOR, no de jugador
  await sleep(200);
  const emo2 = new TestClient('Emo', wsUrl({ code: dj.code }));
  await emo2.open();
  emo2.send({ type: 'join_room', name: 'Emo', token: 'token-abandon-emo', code: dj.code });
  const emo2Joined = await emo2.waitFor('room_joined');
  assert(emo2Joined.spectator === true, 'el que abandonó NO reconecta como jugador: vuelve de espectador');

  dora.ws.close();
  emo.ws.close();
  emo2.ws.close();
  await sleep(200);
}

// Escenario dedicado: una partida clásica en difícil donde NADIE defiende, así los
// enemigos se fugan y las vidas llegan a 0 en pocas oleadas (partida corta). Incluye
// la desconexión + reconexión de Beto para ejercitar los eventos `conn` del replay.
async function replayIdentityScenario(): Promise<void> {
  console.log('\n— Repetición (replay): identidad del estado final —');
  const host = new TestClient('Host', wsUrl({ create: true }));
  await host.open();
  host.send({
    type: 'create_room',
    name: 'Host',
    token: 'token-replay-host',
    settings: { mapId: 'sendero', mode: 'classic', difficulty: 'hard' },
  });
  const rj = await host.waitFor('room_joined');
  await host.waitFor('lobby_state');

  const bob = new TestClient('Bob', wsUrl({ code: rj.code }));
  await bob.open();
  bob.send({ type: 'join_room', name: 'Bob', token: 'token-replay-bob', code: rj.code });
  await bob.waitFor('room_joined');
  await host.waitFor('lobby_state');

  // Bob marca «Listo» antes de que el anfitrión pueda iniciar
  bob.send({ type: 'set_ready', ready: true });
  await host.waitFor('lobby_state');

  host.send({ type: 'start_game' });
  await host.waitFor('countdown');
  await host.waitFor('game_started', 6000);
  await bob.waitFor('game_started', 6000);
  // x3 para que la partida (y el drenaje de vidas sin defensa) transcurra rápido en
  // tiempo de pared. La velocidad no altera el determinismo: solo mete varios
  // stepGame por tick de red (los comandos van en el primer paso).
  host.send({ type: 'set_speed', speed: 3 });

  // no se construye nada: los enemigos se fugan. Llamamos la oleada en cada
  // interludio para acelerar. A media partida, Bob se cae y vuelve (evento conn).
  let bobDropped = false;
  let bob2: TestClient | null = null;
  const start = Date.now();
  let over: Extract<ServerMsg, { type: 'game_over' }> | null = null;

  while (Date.now() - start < 90000) {
    // ¿ya terminó? el game_over llega por el canal normal de mensajes
    const found = host.msgs.find((m) => m.type === 'game_over');
    if (found) {
      over = found as Extract<ServerMsg, { type: 'game_over' }>;
      break;
    }
    // llamar la oleada cuando estemos en interludio con margen
    const last = host.ticks[host.ticks.length - 1];
    if (last && !last.snap.active && last.snap.interludeSec >= 2 && last.snap.over === 0) {
      host.send({ type: 'cmd', cmd: { kind: 'call_wave' } });
    }
    // a mitad (cuando queden pocas vidas) tirar a Bob y reconectarlo una vez
    if (!bobDropped && last && last.snap.lives <= 12) {
      bobDropped = true;
      bob.ws.close();
      await sleep(400);
      bob2 = new TestClient('Bob2', wsUrl({ code: rj.code }));
      await bob2.open();
      bob2.send({ type: 'join_room', name: 'Bob', token: 'token-replay-bob', code: rj.code });
      await bob2.waitFor('room_joined');
      await bob2.waitFor('game_started');
    }
    await sleep(120);
  }

  assert(over !== null, 'la partida sin defensa termina (llega game_over)');
  if (!over) {
    host.ws.close();
    bob2?.ws.close();
    return;
  }
  assert(over.replay !== undefined, 'game_over trae la repetición (replay)');
  const replay = over.replay!;
  assert(
    replay.log.some((e) => e.kind === 'conn' && e.connected === false) &&
      replay.log.some((e) => e.kind === 'conn' && e.connected === true),
    'el replay grabó la desconexión Y la reconexión de Bob (eventos conn)',
  );

  // estado real leído del ÚLTIMO snapshot recibido antes del game_over
  const realTicks = host.ticks;
  const lastSnap = realTicks[realTicks.length - 1].snap;
  const lastT = realTicks[realTicks.length - 1].t;

  // reconstrucción con el motor puro hasta el tick final del replay
  const rebuilt = replayTo(replay, replay.finalTick);
  const rebuiltGold: Record<string, number> = {};
  for (const p of rebuilt.players) rebuiltGold[p.id] = Math.floor(p.gold);
  const realGold: Record<string, number> = {};
  for (const p of lastSnap.players) realGold[p.id] = p.gold;

  // finalTick es el tick en que se fijó `over`; los snapshots de la ventana de
  // gracia (post game-over) siguen llegando con tick creciente, así que lastT puede
  // ser algo mayor (son incrementos vacíos, sin cambio de estado).
  assert(replay.finalTick <= lastT, `finalTick es el tick del fin de partida (final ${replay.finalTick} <= último visto ${lastT})`);
  assert(rebuilt.tick === replay.finalTick, `la reconstrucción alcanza el tick final (${rebuilt.tick})`);
  assert(rebuilt.over !== null, 'la reconstrucción termina en game-over (over != null)');
  assert(rebuilt.wave === replay.wave && replay.wave === over.stats.wave, `oleada idéntica (replay ${replay.wave} == stats ${over.stats.wave})`);
  assert(rebuilt.lives === lastSnap.lives, `vidas idénticas (real ${lastSnap.lives} == replay ${rebuilt.lives})`);
  assert(rebuilt.over !== null && rebuilt.over.victory === replay.victory, `resultado idéntico (victoria=${replay.victory})`);
  assert(
    JSON.stringify(realGold) === JSON.stringify(rebuiltGold),
    `oro de cada jugador idéntico (real ${JSON.stringify(realGold)} == replay ${JSON.stringify(rebuiltGold)})`,
  );

  // determinismo del propio motor: dos reconstrucciones dan el MISMO rng
  const rebuilt2 = replayTo(replay, replay.finalTick);
  assert(rebuilt.rng === rebuilt2.rng, `el motor de replay es determinista (rng ${rebuilt.rng})`);

  console.log(`   replay: ${replay.log.length} entradas, ${JSON.stringify(replay).length} bytes, ${replay.finalTick} ticks, oleada ${replay.wave}`);

  host.ws.close();
  bob2?.ws.close();
}

// Escenario dedicado: GUARDAR/CARGAR (issue #12). Juega una partida, la PAUSA para
// congelar el tick, pide el guardado (save_info), verifica que el token va hasheado
// (nunca en claro) y que el log del guardado reconstruye EXACTO el estado congelado.
// Luego crea una sala desde el guardado (POST /api/rooms/from-save), cada jugador
// recupera su slot por token, y al REANUDAR la partida continúa desde el guardado.
async function saveLoadScenario(): Promise<void> {
  console.log('\n— Guardar/Cargar (issue #12): guardar en pausa y reanudar —');
  const HOST_TOKEN = 'token-save-host';
  const BOB_TOKEN = 'token-save-bob';

  // --- partida ORIGINAL ---
  const host = new TestClient('SaveHost', wsUrl({ create: true }));
  await host.open();
  host.send({
    type: 'create_room',
    name: 'Sara',
    token: HOST_TOKEN,
    settings: { mapId: 'sendero', mode: 'classic', difficulty: 'normal' },
  });
  const rj = await host.waitFor('room_joined');
  await host.waitFor('lobby_state');

  const bob = new TestClient('SaveBob', wsUrl({ code: rj.code }));
  await bob.open();
  bob.send({ type: 'join_room', name: 'Bruno', token: BOB_TOKEN, code: rj.code });
  await bob.waitFor('room_joined');
  await host.waitFor('lobby_state');

  bob.send({ type: 'set_ready', ready: true });
  for (;;) {
    const lb = await host.waitFor('lobby_state');
    if (lb.players.find((p) => !p.isHost)?.ready === true) break;
  }

  host.send({ type: 'start_game' });
  await host.waitFor('countdown');
  const initH = await host.waitFor('game_started', 6000);
  await bob.waitFor('game_started', 6000);

  // colocar 2 torres y llamar la oleada para tener un estado no trivial
  const map = getMap(initH.init.mapId);
  const ctx = makePlacementContext(map);
  const cells: [number, number][] = [];
  outer: for (let cy = 0; cy < map.gridH; cy++) {
    for (let cx = 0; cx < map.gridW; cx++) {
      if (placementError(map, ctx, [], cx, cy) === null) {
        cells.push([cx, cy]);
        if (cells.length >= 2) break outer;
      }
    }
  }
  host.send({ type: 'cmd', cmd: { kind: 'place', towerType: 'archer', cx: cells[0][0], cy: cells[0][1] } });
  host.send({ type: 'cmd', cmd: { kind: 'place', towerType: 'cannon', cx: cells[1][0], cy: cells[1][1] } });
  await sleep(400);
  host.send({ type: 'cmd', cmd: { kind: 'call_wave' } });
  await sleep(2500);

  // PAUSAR: congela el tick para un guardado estable, y leer el snapshot congelado
  host.send({ type: 'pause' });
  await host.waitFor('paused');
  await sleep(400);
  const frozen = host.ticks[host.ticks.length - 1];
  assert(!!frozen, 'hay un snapshot congelado tras pausar');

  // pedir el guardado (save_request → save_info)
  const salt = 'a1b2c3d4e5f6a7b8';
  host.send({ type: 'save_request', salt });
  const info = await host.waitFor('save_info', 6000);
  const save: SaveData = info.save;
  assert(save.kind === 'fortaleza-save', 'save_info trae un SaveData con la marca de formato');
  assert(save.tick === frozen.t, `el guardado se tomó en el tick congelado (${save.tick} == ${frozen.t})`);
  assert(save.slots.length === 2, `el guardado tiene 2 slots (${save.slots.length})`);

  // los tokenHash son sha256(token + salt); el token NUNCA viaja en claro
  const hostHash = await sha256Hex(HOST_TOKEN + salt);
  assert(save.slots.some((s) => s.tokenHash === hostHash), 'el tokenHash del anfitrión = sha256(token+salt)');
  assert(!JSON.stringify(save).includes(HOST_TOKEN), 'el guardado NO contiene ningún token en claro');

  // el log del guardado reconstruye EXACTO el estado congelado (como hará el DO)
  const rdata: ReplayData = {
    v: save.v, seed: save.seed, mapId: save.mapId, mode: save.mode, difficulty: save.difficulty,
    players: save.players, log: save.log, finalTick: save.tick, victory: false, wave: save.wave,
  };
  const rebuilt = replayTo(rdata, save.tick);
  assert(rebuilt.wave === frozen.snap.wave, `reconstrucción: oleada idéntica al congelado (${rebuilt.wave} == ${frozen.snap.wave})`);
  assert(rebuilt.lives === frozen.snap.lives, `reconstrucción: vidas idénticas (${rebuilt.lives} == ${frozen.snap.lives})`);
  assert(
    rebuilt.towers.length === frozen.snap.towers.length,
    `reconstrucción: mismas torres (${rebuilt.towers.length} == ${frozen.snap.towers.length})`,
  );

  host.ws.close();
  bob.ws.close();
  await sleep(200);

  // --- CARGAR: crear la sala desde el guardado (POST /api/rooms/from-save) ---
  const res = await fetch(`${HTTP_BASE}/api/rooms/from-save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(save),
  });
  assert(res.ok, `POST /api/rooms/from-save responde OK (${res.status})`);
  if (!res.ok) return;
  const loadCode = ((await res.json()) as { code: string }).code;
  assert(/^[A-Z]{4}$/.test(loadCode), `la sala del guardado tiene código de 4 letras (${loadCode})`);

  // el anfitrión (mismo token) se une → recupera su slot por hash automáticamente
  const h2 = new TestClient('LoadHost', wsUrl({ code: loadCode }));
  await h2.open();
  h2.send({ type: 'join_room', name: 'Sara', token: HOST_TOKEN, code: loadCode });
  const h2j = await h2.waitFor('room_joined');

  // Bruno (mismo token) se une → recupera el otro slot
  const b2 = new TestClient('LoadBob', wsUrl({ code: loadCode }));
  await b2.open();
  b2.send({ type: 'join_room', name: 'Bruno', token: BOB_TOKEN, code: loadCode });
  const b2j = await b2.waitFor('room_joined');

  // dar tiempo a los auto-claims (sha256) y leer el último estado del lobby de carga
  await sleep(900);
  const lobbies = h2.msgs.filter((m): m is Extract<ServerMsg, { type: 'lobby_state' }> => m.type === 'lobby_state');
  const lastSaved = [...lobbies].reverse().find((m) => m.saved);
  assert(!!lastSaved?.saved, 'el lobby de carga trae la info del guardado (mapa/oleada/slots)');
  const slotsInfo = lastSaved?.saved?.slots ?? [];
  assert(slotsInfo.some((s) => s.claimedBy === h2j.playerId), 'el anfitrión recuperó su slot por token');
  assert(slotsInfo.some((s) => s.claimedBy === b2j.playerId), 'el segundo jugador recuperó su slot por token');

  // REANUDAR: cuenta atrás → reconstrucción (fast-forward) → partida en vivo
  h2.send({ type: 'start_game' });
  await h2.waitFor('countdown');
  const rInit = await h2.waitFor('game_started', 8000);
  assert(rInit.init.players.length === 2, 'la partida reanudada arranca con 2 defensores');
  await sleep(1500);
  const resumed = h2.ticks[h2.ticks.length - 1];
  assert(!!resumed && resumed.t >= save.tick, `la partida reanuda DESDE el tick guardado (${resumed?.t} >= ${save.tick})`);
  assert(resumed.snap.wave >= frozen.snap.wave, `reanuda en la oleada del guardado o más (${resumed.snap.wave} >= ${frozen.snap.wave})`);
  assert(
    resumed.snap.towers.length === frozen.snap.towers.length,
    `las torres del guardado están en la partida reanudada (${resumed.snap.towers.length} == ${frozen.snap.towers.length})`,
  );

  h2.ws.close();
  b2.ws.close();
  await sleep(200);
}

main().catch((err) => {
  console.error('💥 Error en el test:', err);
  process.exit(1);
});
