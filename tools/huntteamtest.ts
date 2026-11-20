// Prueba de la Cacería en la sala (worker local en :8787): elegir bando en el
// lobby (varios trolls) y chat de equipo. `PORT=8787 npx tsx tools/huntteamtest.ts`
import WebSocket from 'ws';
const PORT = process.env.PORT ?? '8787';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c: boolean, m: string) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
interface C { ws: WebSocket; id: string; msgs: any[]; send: (m: object) => void }
async function client(name: string, url: string, first: object): Promise<C> {
  const ws = new WebSocket(url);
  const c: C = { ws, id: '', msgs: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); c.msgs.push(m); if (m.type === 'room_joined') c.id = m.playerId ?? m.you ?? c.id; });
  await new Promise((r) => ws.on('open', r));
  c.send(first);
  for (let i = 0; i < 50 && !c.msgs.some((m) => m.type === 'room_joined'); i++) await sleep(100);
  return c;
}
void (async () => {
  const host = await client('A', `ws://localhost:${PORT}/ws?create=1`, { type: 'create_room', name: 'Ana', token: 'tA' + Date.now(), settings: { mapId: 'sendero', mode: 'hunt', difficulty: 'normal' } });
  const code = host.msgs.find((m) => m.type === 'room_joined').code;
  const b = await client("B", `ws://localhost:${PORT}/ws?code=${code}`, { type: 'join_room', code, name: 'Beto', token: 'tB' + Date.now() });
  const c = await client("C", `ws://localhost:${PORT}/ws?code=${code}`, { type: 'join_room', code, name: 'Caro', token: 'tC' + Date.now() });
  host.send({ type: 'hunt_side', side: 'hunter' });
  b.send({ type: 'hunt_side', side: 'hunter' });
  c.send({ type: 'hunt_side', side: 'elf' });
  for (const x of [b, c]) x.send({ type: 'set_ready', ready: true });
  await sleep(600);
  const lobby = [...host.msgs].reverse().find((m) => m.type === 'lobby_state');
  ok(lobby?.players?.filter((p: any) => p.huntSide === 'hunter').length === 2, 'el lobby muestra 2 trolls elegidos');
  host.send({ type: 'start_game' });
  for (let i = 0; i < 80 && !c.msgs.some((m) => m.type === 'hunt_started'); i++) await sleep(100);
  const init = c.msgs.find((m) => m.type === 'hunt_started')?.init;
  ok(!!init, 'empieza la Cacería');
  ok(init?.players.filter((p: any) => p.role === 'hunter').length === 2, `hay 2 cazadores (${init?.players.map((p: any) => p.name + ':' + p.role).join(', ')})`);
  ok(typeof init?.gameId === 'number', 'la partida lleva su identificador');
  await sleep(500);
  const before = [host, b, c].map((x) => x.msgs.length);
  host.send({ type: 'chat', text: 'vamos a la base del norte', team: true });
  await sleep(600);
  const got = (x: C, i: number) => x.msgs.slice(before[i]).some((m) => m.type === 'chat' && m.text === 'vamos a la base del norte');
  ok(got(host, 0) && got(b, 1), 'el chat de equipo llega a los dos trolls');
  ok(!got(c, 2), 'el elfo NO lee el chat de los trolls');
  c.send({ type: 'chat', text: 'hola a todos' });
  await sleep(600);
  ok([host, b].every((x) => x.msgs.some((m) => m.type === 'chat' && m.text === 'hola a todos')), 'el chat general llega a todos');
  // solo el anfitrión puede terminar la partida
  b.send({ type: 'end_hunt' });
  await sleep(500);
  ok(!host.msgs.some((m) => m.type === 'hunt_over'), 'un jugador que no es anfitrión no puede terminarla');
  host.send({ type: 'end_hunt' });
  for (let i = 0; i < 30 && !c.msgs.some((m) => m.type === 'hunt_over'); i++) await sleep(100);
  ok(c.msgs.find((m) => m.type === 'hunt_over')?.result?.reason === 'ended', 'el anfitrión termina la partida y todos vuelven a la sala');
  for (const x of [host, b, c]) x.ws.close();
  console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK');
  process.exit(failed ? 1 : 0);
})();
