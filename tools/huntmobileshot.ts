// Captura de la Cacería en un móvil simulado (táctil): W=844 H=390 NAME=x.png npx tsx tools/huntmobileshot.ts <carpeta>
// Prueba del WASD en un navegador real (Chrome sin ventana) contra el worker local,
// con latencia artificial en el WebSocket (LAT=ms por sentido). Mantiene pulsadas
// teclas de verdad (CDP) y cuenta: fotogramas que tardas en arrancar, fotogramas
// en que el personaje se pinta yendo HACIA ATRÁS respecto a la tecla, y el salto
// al soltar. Guarda capturas en SHOTS (carpeta) si se indica.
//   pnpm cf:dev &  →  LAT=150 SHOTS=out npx tsx tools/huntwasdtest.ts
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PORT = '8787';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function browser() {
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p))!;
  const port = 9500 + Math.floor(Math.random() * 300);
  const proc = spawn(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mv-'))}`, '--window-size=1280,800', 'about:blank']);
  let target: any;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[]).find((t) => t.type === 'page'); } catch {}
  }
  const cdp = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => cdp.on('open', r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  cdp.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result); });
  const call = (method: string, params: object = {}): Promise<any> => new Promise((r) => { pending.set(++id, r); cdp.send(JSON.stringify({ id, method, params })); });
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W ?? 844), height: Number(process.env.H ?? 390), deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await call('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await call('Page.enable');
  // latencia artificial en el WebSocket: 120 ms por sentido ± 40 ms
  const LAT = Number(process.env.LAT ?? 120);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const L = ${'$'}{LAT}; const J = () => L + (Math.random() - 0.5) * 80;
    const WS = window.WebSocket;
    window.WebSocket = function (url, p) {
      const ws = new WS(url, p);
      const send = ws.send.bind(ws);
      ws.send = (d) => setTimeout(() => { try { send(d); } catch {} }, J());
      let last = 0;
      const wrap = (h) => (ev) => { const at = Math.max(performance.now() + J(), last + 1); last = at; setTimeout(() => h(ev), at - performance.now()); };
      const add = ws.addEventListener.bind(ws);
      ws.addEventListener = (t, h, o) => add(t, t === 'message' ? wrap(h) : h, o);
      Object.defineProperty(ws, 'onmessage', { set(h) { add('message', wrap(h)); } });
      return ws;
    };
    window.WebSocket.prototype = WS.prototype;
    Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  })()` });
  return { call, close: () => { cdp.close(); proc.kill(); } };
}



void (async () => {
  const OUT = process.argv[2];
  const host = new WebSocket(`ws://localhost:${PORT}/ws?create=1`);
  const code: string = await new Promise((res) => {
    host.on('open', () => host.send(JSON.stringify({ type: 'create_room', name: 'Ana', token: 'mb-' + Date.now(), settings: { mapId: 'sendero', mode: 'hunt', difficulty: 'normal' } })));
    host.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'room_joined') res(m.code); });
  });
  host.send(JSON.stringify({ type: 'hunt_side', side: 'hunter' }));
  const b = await browser();
  await b.call('Page.navigate', { url: `http://localhost:${PORT}/?n=Tester#${code}` });
  await sleep(6000);
  await b.call('Runtime.evaluate', { expression: `document.getElementById('btn-ready')?.click()` });
  await sleep(500);
  host.send(JSON.stringify({ type: 'start_game' }));
  await sleep(5000);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(OUT, process.env.NAME ?? 'movil.png'), Buffer.from((await b.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  b.close(); host.close(); process.exit(0);
})();
