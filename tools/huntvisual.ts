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
import { BUILDING_ORDER, getHuntMap, type HuntInit, type HuntSnap } from '@td/shared';
void 0;

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

async function shot(url: string, file: string, waitMs: number, js?: string): Promise<void> {
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
    if (js) {
      await call('Runtime.evaluate', { expression: js });
      await sleep(700);
    }
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

  // cada colono a una parcela distinta cerca del centro: muralla en la puerta,
  // casa, taller, árbol y torres
  const center = { x: map.w / 2, y: map.h / 2 };
  const plots = map.plots
    .filter((p) => p.doors.length === 1 && p.shape === 'rect')
    .sort((a, b) => Math.hypot(a.x + a.w / 2 - center.x, a.y + a.h / 2 - center.y) - Math.hypot(b.x + b.w / 2 - center.x, b.y + b.h / 2 - center.y));
  colonists.forEach((c, i) => {
    const p = plots[i];
    const d = p.doors[0];
    const free = (x: number, y: number, s: number) => {
      for (let j = 0; j < s; j++) for (let k = 0; k < s; k++) if (map.tiles[(y + j) * map.w + x + k] !== 0 || map.plotOf[(y + j) * map.w + x + k] !== p.id) return false;
      return true;
    };
    const spots: [number, number][] = [];
    for (let y = p.y + 2; y < p.y + p.h - 3; y++) for (let x = p.x + 2; x < p.x + p.w - 3; x++) if (free(x, y, 2) && Math.hypot(x - d.x, y - d.y) > 3) spots.push([x, y]);
    const pick = (n: number) => spots[Math.min(spots.length - 1, Math.floor((spots.length * n) / 4))];
    c.cmd({ k: 'build', type: 'wall', cx: d.x, cy: d.y });
    setTimeout(() => c.cmd({ k: 'build', type: 'house', cx: pick(1)[0], cy: pick(1)[1] }), 13000);
    setTimeout(() => c.cmd({ k: 'build', type: 'workshop', cx: pick(3)[0], cy: pick(3)[1] }), 17000);
    // oro de prueba (solo en local, TD_TEST_HOOKS) para que se vean leñadores y minas
    if (i === 0) setTimeout(() => void fetch(`http://localhost:${PORT}/api/__huntgold?code=${code}&gold=3000`), 18000);
    if (i === 0) setTimeout(() => c.cmd({ k: 'build', type: 'elftree', cx: pick(2)[0], cy: pick(2)[1] }), 18500);
    const inside = (dx: number, dy: number): [number, number] => {
      const x = d.x + dx;
      const y = d.y + dy;
      return [x, y];
    };
    const inward = d.y === p.y ? [0, 1] : d.y === p.y + p.h - 1 ? [0, -1] : d.x === p.x ? [1, 0] : [-1, 0];
    setTimeout(() => {
      const [x1, y1] = inside(inward[0] * 2 + inward[1], inward[1] * 2 + inward[0]);
      const [x2, y2] = inside(inward[0] * 2 - inward[1], inward[1] * 2 - inward[0]);
      c.cmd({ k: 'build', type: 'tower', cx: x1, cy: y1 });
      setTimeout(() => c.cmd({ k: 'build', type: 'tower', cx: x2, cy: y2 }), 1500);
    }, 21000);
    // con el oro que va entrando, mejora lo que tenga
    setInterval(() => {
      const idx = c.init!.players.findIndex((q) => q.id === c.init!.youAre);
      for (const o of c.snap?.buildings.filter((b) => b[2] === idx) ?? []) c.cmd({ k: 'upgrade', id: o[0], branch: 'elf' });
      const shop = c.snap?.buildings.find((b) => b[2] === idx && b[1] === 3);
      if (shop) c.cmd({ k: 'train', id: shop[0], unit: 'repairer', tier: 0 });
      const etree = c.snap?.buildings.find((b) => b[2] === idx && b[1] === BUILDING_ORDER.indexOf('elftree'));
      if (etree) c.cmd({ k: 'train', id: etree[0], unit: 'lumberjack', tier: 0 });
    }, 3000);
  });
  // el cazador compra al salir y va a por la muralla del primer colono
  setTimeout(() => {
    hunter.cmd({ k: 'buy', line: 'weapon', tier: 0 });
    hunter.cmd({ k: 'buy', line: 'life', tier: 0 });
  }, 2000);
  const prey = plots[0];
  setInterval(() => {
    if (!hunter.snap || hunter.snap.releaseIn > 0) return;
    const wall = hunter.snap.buildings.find((o) => o[1] === 1);
    if (wall) hunter.cmd({ k: 'attack', target: wall[0] });
    else hunter.cmd({ k: 'move', x: prey.doors[0].x + 0.5, y: prey.doors[0].y + 0.5 });
  }, 1500);

  const who = view === 'hunter' ? hunter : colonists[0];
  if (view === 'colonist') {
    await sleep(22000);
    who.ws.close();
    await sleep(300);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'colono-1-base.png'), 5000);
    await sleep(22000);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'colono-2-asedio.png'), 5000,
      `(() => { const b = window.__hunt.mine().find((x) => x.type === 'wall') || window.__hunt.mine()[0]; if (b) window.__hunt.select(b.id); })()`);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'colono-3-libro.png'), 4000, 'window.__hunt.book()');
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'colono-4-lenadores.png'), 9000, 'window.__hunt.zoom(1.5)');
  } else {
    await sleep(46000);
    who.ws.close();
    await sleep(300);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'cazador-1-asedio.png'), 5000);
    await shot(`http://localhost:${PORT}/?n=${who.name}#${code}`, join(OUT, 'cazador-2-tienda.png'), 4000, 'window.__hunt.shop()');
  }
  for (const b of bots) b.ws.close();
}

const only = process.env.VIEW as 'colonist' | 'hunter' | undefined;
void (async () => {
  for (const v of only ? [only] : (['colonist', 'hunter'] as const)) await partida(v);
  process.exit(0);
})();
