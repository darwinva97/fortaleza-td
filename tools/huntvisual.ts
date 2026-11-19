// Prueba VISUAL de la Cacería: monta una partida con bots contra el worker local
// (pnpm cf:dev en :8787), deja que jueguen unos segundos y saca capturas del
// cliente real con Chrome sin ventana, una como colono y otra como cazador.
//
//   npx tsx tools/huntvisual.ts [carpeta-de-salida]
//
// Truco para entrar «como» un bot: el bot se desconecta y el navegador entra con
// su mismo nombre; la sala le devuelve ese puesto (rescate por nombre).
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getHuntMap, type HuntInit, type HuntSnap } from '@td/shared';

const PORT = process.env.PORT ?? '8787';
const OUT = resolve(process.argv[2] ?? join(tmpdir(), 'fortaleza-huntshots'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const map = getHuntMap();

class Bot {
  ws!: WebSocket;
  init: HuntInit | null = null;
  snap: HuntSnap | null = null;
  code = '';
  constructor(public name: string) {}
  open(path: string, first: object): Promise<void> {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}${path}`);
      this.ws.on('open', () => this.ws.send(JSON.stringify(first)));
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === 'room_joined') {
          this.code = m.code;
          res();
        }
        if (m.type === 'hunt_started') this.init = m.init;
        if (m.type === 'hunt_tick') this.snap = m.snap;
        if (m.type === 'error') console.log(`[${this.name}] error:`, m.msg);
      });
    });
  }
  send(o: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }
  cmd(cmd: object): void {
    this.send({ type: 'hunt_cmd', cmd });
  }
  get role(): string {
    return this.init?.players.find((p) => p.id === this.init!.youAre)?.role ?? '';
  }
}

async function shot(url: string, file: string, waitMs: number): Promise<void> {
  const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(
    (p) => p && existsSync(p),
  );
  if (!chrome) throw new Error('No encuentro Chrome/Edge (define CHROME)');
  const port = 9300 + Math.floor(Math.random() * 400);
  const proc = spawn(chrome, [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'hunt-'))}`,
    '--window-size=1440,900',
    'about:blank',
  ]);
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        target = list.find((t) => t.type === 'page');
      } catch {
        /* aún arrancando */
      }
    }
    if (!target) throw new Error('Chrome no abrió el puerto de depuración');
    const cdp = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => cdp.on('open', r));
    let id = 0;
    const pending = new Map<number, (v: any) => void>();
    const logs: string[] = [];
    cdp.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result);
      if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPCIÓN: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a: any) => a.value ?? a.description).join(' '));
    });
    const call = (method: string, params: object = {}): Promise<any> =>
      new Promise((r) => {
        pending.set(++id, r);
        cdp.send(JSON.stringify({ id, method, params }));
      });
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url });
    await sleep(waitMs);
    const res = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(res.data, 'base64'));
    console.log('captura:', file, logs.length ? `\n  ${logs.join('\n  ')}` : '(sin errores de consola)');
    cdp.close();
  } finally {
    proc.kill();
  }
}

async function partida(view: 'colonist' | 'hunter'): Promise<void> {
  const names = ['Vicen', 'Ana', 'Beto', 'Caro'];
  const bots = names.map((n) => new Bot(n));
  await bots[0].open('/ws?create=1', {
    type: 'create_room',
    name: names[0],
    token: `hv-${names[0]}-${Date.now()}`,
    settings: { mapId: 'sendero', mode: 'hunt', difficulty: 'normal' },
  });
  const code = bots[0].code;
  for (const b of bots.slice(1)) {
    await b.open(`/ws?code=${code}`, { type: 'join_room', name: b.name, token: `hv-${b.name}-${Date.now()}`, code });
    b.send({ type: 'set_ready', ready: true });
  }
  await sleep(400);
  bots[0].send({ type: 'start_game' });
  for (let i = 0; i < 80 && !bots.every((b) => b.snap); i++) await sleep(100);
  if (!bots.every((b) => b.init)) throw new Error('la cacería no arrancó');
  const hunter = bots.find((b) => b.role === 'hunter')!;
  const colonists = bots.filter((b) => b.role === 'colonist');
  console.log(`sala ${code} · cazador ${hunter.name} · colonos ${colonists.map((c) => c.name).join(', ')}`);

  // cada colono a una base distinta: muralla en la puerta, tesorería, torres y taller
  colonists.forEach((c, i) => {
    const b = map.bases[[1, 4, 0, 2][i]];
    const top = b.door.y > b.y;
    const iy = top ? b.door.y - 2 : b.door.y + 2;
    c.cmd({ k: 'move', x: b.door.x + 0.5, y: iy + 0.5 });
    setTimeout(() => {
      c.cmd({ k: 'build', type: 'wall', cx: b.door.x, cy: b.door.y });
      c.cmd({ k: 'build', type: 'treasury', cx: b.x + 2, cy: b.y + 3 });
      c.cmd({ k: 'build', type: 'tower', cx: b.door.x - 1, cy: top ? b.door.y - 1 : b.door.y + 1 });
      c.cmd({ k: 'build', type: 'tower', cx: b.door.x + 1, cy: top ? b.door.y - 1 : b.door.y + 1 });
      c.cmd({ k: 'build', type: 'workshop', cx: b.x + 6, cy: b.y + 3 });
    }, 9000);
    // con el oro que va entrando, sube la muralla y las torres
    setInterval(() => {
      const mine = c.snap?.buildings.filter((o) => o[2] === c.init!.players.findIndex((p) => p.id === c.init!.youAre)) ?? [];
      for (const o of mine) if (o[1] === 1 || o[1] === 2) c.cmd({ k: 'upgrade', id: o[0] });
    }, 4000);
  });
  // el cazador va a por la muralla del primer colono en cuanto lo sueltan
  const prey = map.bases[1];
  setInterval(() => {
    if (!hunter.snap || hunter.snap.releaseIn > 0) return;
    const wall = hunter.snap.buildings.find((o) => o[1] === 1);
    if (wall) hunter.cmd({ k: 'attack', target: wall[0] });
    else hunter.cmd({ k: 'move', x: prey.door.x + 0.5, y: prey.door.y + 3.5 });
  }, 1500);

  const who = view === 'hunter' ? hunter : colonists[0];
  if (view === 'colonist') {
    // captura 1: durante la cuenta atrás, ya con la base montada
    await sleep(14000);
    who.ws.close();
    await sleep(300);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'colono-1-preparacion.png'), 5000);
    // captura 2: con el cazador ya suelto y pegando a la muralla
    await sleep(26000);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'colono-2-asedio.png'), 5000);
  } else {
    // el bot lleva al cazador hasta la muralla; la orden de ataque sigue viva al soltarlo
    await sleep(43000);
    who.ws.close();
    await sleep(300);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'cazador-1-asedio.png'), 5000);
    await sleep(8000);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'cazador-2-asedio.png'), 5000);
  }
  for (const b of bots) b.ws.close();
}

const only = process.env.VIEW as 'colonist' | 'hunter' | undefined;
void (async () => {
  for (const v of only ? [only] : (['colonist', 'hunter'] as const)) await partida(v);
  process.exit(0);
})();
