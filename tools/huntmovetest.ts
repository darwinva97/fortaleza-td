// Prueba de movimiento en un navegador real (Chrome sin ventana) contra el worker local:
// ráfaga de clics derechos con latencia artificial en el WebSocket (LAT=ms por sentido).
// Cuenta los fotogramas en que tu personaje se pinta ALEJÁNDOSE del destino del clic.
//   pnpm cf:dev &  →  LAT=150 npx tsx tools/huntmovetest.ts
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
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
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
  for (let attempt = 0; attempt < 6; attempt++) {
    const host = new WebSocket(`ws://localhost:${PORT}/ws?create=1`);
    const code: string = await new Promise((res) => {
      host.on('open', () => host.send(JSON.stringify({ type: 'create_room', name: 'Host', token: 'mv-' + Date.now(), settings: { mapId: 'sendero', mode: 'hunt', difficulty: 'normal' } })));
      host.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'room_joined') res(m.code); });
    });
    const b = await browser();
    await b.call('Page.navigate', { url: `http://localhost:${PORT}/?n=Tester#${code}` });
    await sleep(3500);
    await b.call('Runtime.evaluate', { expression: `document.getElementById('btn-ready')?.click()` });
    await sleep(500);
    host.send(JSON.stringify({ type: 'start_game' }));
    await sleep(4500);
    const role = await b.call('Runtime.evaluate', { expression: `JSON.stringify(window.__hunt && window.__hunt.me())`, returnByValue: true });
    const me = JSON.parse(role.result.value ?? 'null');
    if (!me || me.form !== 'elf') { console.log('soy', me?.form, '→ repito'); b.close(); host.close(); continue; }
    // ráfaga de clics derechos como en el Dota y registro de lo que se pinta
    const res = await b.call('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((done) => {
        const H = window.__hunt; const out = []; let target = null; let clickT = 0; const t0 = performance.now(); let n = 0;
        const click = () => { const m = H.me(); if (!m) return; const a = (n++ * 2.3) % 6.28; target = { x: m.x + Math.cos(a) * 4, y: m.y + Math.sin(a) * 4 }; clickT = performance.now(); H.rclick(target.x, target.y); };
        click();
        const iv = setInterval(click, 700);
        const loop = () => { const p = H.pos(); if (p && target) out.push([performance.now() - t0, p.x, p.y, target.x, target.y, performance.now() - clickT]); if (performance.now() - t0 < 14000) requestAnimationFrame(loop); else { clearInterval(iv); done(JSON.stringify(out)); } };
        requestAnimationFrame(loop);
      })`,
    });
    const rows: number[][] = JSON.parse(res.result.value);
    let backEarly = 0, backLate = 0, worst = 0, frames = 0;
    for (let i = 1; i < rows.length; i++) {
      const [, x, y, tx, ty, since] = rows[i];
      const [, px, py, ptx, pty] = rows[i - 1];
      if (tx !== ptx || ty !== pty) continue;
      frames++;
      const prog = Math.hypot(px - tx, py - ty) - Math.hypot(x - tx, y - ty);
      if (prog < -0.01) { if (since < 600) backEarly++; else backLate++; worst = Math.max(worst, -prog); }
    }
    console.log(`fotogramas ${frames} · alejándose del destino: ${backEarly} justo tras el clic, ${backLate} después · peor salto ${worst.toFixed(3)} casillas`);
    b.close(); host.close();
    process.exit(0);
  }
  process.exit(1);
})();
