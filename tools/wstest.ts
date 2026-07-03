// Prueba end-to-end contra el servidor real: dos clientes WebSocket crean una
// sala, empiezan la partida, colocan una torre, llaman la oleada y verifican
// que los enemigos se mueven y el chat funciona.
// Requiere el servidor corriendo (PORT o 3000).
import WebSocket from 'ws';
import {
  getMap,
  makePlacementContext,
  placementError,
  type ClientMsg,
  type ServerMsg,
} from '@td/shared';

// Sirve tanto para el servidor Node (ignora el query) como para el Worker de
// Cloudflare (enruta por ?create=1 / ?code=XXXX al Durable Object de la sala).
const BASE = `ws://localhost:${process.env.PORT ?? 3000}/ws`;
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

  // 4. Empieza la partida
  ana.send({ type: 'start_game' });
  const initA = await ana.waitFor('game_started');
  const initB = await beto.waitFor('game_started');
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

  // 8. Con la partida en curso, un jugador NUEVO no puede entrar (ni con el código)
  const carla = new TestClient('Carla', wsUrl({ code: joined.code }));
  await carla.open();
  carla.send({ type: 'join_room', name: 'Carla', token: 'token-carla-test', code: joined.code });
  const rejected = await carla.waitFor('error');
  assert(rejected.msg.includes('ya comenzó'), 'un jugador nuevo no puede entrar con la partida empezada');
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

  if (failures.length > 0) {
    console.error(`\n💥 ${failures.length} fallos`);
    process.exit(1);
  }
  console.log('\n🎉 Test end-to-end OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('💥 Error en el test:', err);
  process.exit(1);
});
