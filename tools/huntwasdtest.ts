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


const KEYS: Record<string, [string, string, number]> = { W: ['KeyW', 'w', 87], A: ['KeyA', 'a', 65], S: ['KeyS', 's', 83], D: ['KeyD', 'd', 68] };

void (async () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const host = new WebSocket(`ws://localhost:${PORT}/ws?create=1`);
    const code: string = await new Promise((res) => {
      host.on('open', () => host.send(JSON.stringify({ type: 'create_room', name: 'Host', token: 'wasd-' + Date.now(), settings: { mapId: 'sendero', mode: 'hunt', difficulty: 'normal' } })));
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
    if (!me || (me.form !== 'elf' && me.form !== 'hunter')) { console.log('soy', me?.form, '→ repito'); b.close(); host.close(); continue; }
    console.log('soy', me.form);
    if (me.form === 'hunter') await sleep(36000); // el cazador espera a que acabe la ventaja
    await b.call('Runtime.evaluate', { expression: `window.__hunt.zoom(1.5)` });
    // registro fotograma a fotograma de dónde se pinta tu personaje y qué teclas hay
    await b.call('Runtime.evaluate', { expression: `(() => { const H = window.__hunt; window.__log = []; const t0 = performance.now(); const loop = () => { const p = H.pos(); const s = H.me(); if (p) window.__log.push([performance.now() - t0, p.x, p.y, s ? s.x : 0, s ? s.y : 0, (window.__keys || '')]); requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()` });
    const key = async (k: string, down: boolean) => {
      const [c, kk, vk] = KEYS[k];
      await b.call('Runtime.evaluate', { expression: `window.__keys = ${JSON.stringify('')} + (window.__keysSet = (window.__keysSet || new Set()), ${down ? `window.__keysSet.add('${k}')` : `window.__keysSet.delete('${k}')`}, [...window.__keysSet].sort().join(''))` });
      await b.call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code: c, key: kk, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    };
    const shots = process.env.SHOTS;
    const shot = async (name: string) => {
      if (!shots) return;
      const r = await b.call('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(shots, { recursive: true });
      writeFileSync(join(shots, name + '.png'), Buffer.from(r.data, 'base64'));
    };
    const plan: [string[], number][] = [[['D'], 1200], [[], 600], [['W'], 1000], [['W', 'A'], 900], [[], 600], [['S'], 1100], [['S', 'D'], 700], [[], 900]];
    let held: string[] = [];
    let n = 0;
    for (const [ks, ms] of plan) {
      for (const k of held) if (!ks.includes(k)) await key(k, false);
      for (const k of ks) if (!held.includes(k)) await key(k, true);
      held = ks;
      await sleep(ms / 2);
      await shot(`wasd-${n++}-${ks.join('') || 'quieto'}`);
      await sleep(ms / 2);
    }
    const res = await b.call('Runtime.evaluate', { expression: `JSON.stringify(window.__log)`, returnByValue: true });
    const rows: [number, number, number, number, number, string][] = JSON.parse(res.result.value);
    const dirOf = (ks: string) => [(ks.includes('D') ? 1 : 0) - (ks.includes('A') ? 1 : 0), (ks.includes('S') ? 1 : 0) - (ks.includes('W') ? 1 : 0)];
    let back = 0, worst = 0, frames = 0, jumps = 0, maxJump = 0;
    const starts: number[] = [];
    let pressT = -1;
    for (let i = 1; i < rows.length; i++) {
      const [t, x, y, , , ks] = rows[i];
      const [, px, py, , , pks] = rows[i - 1];
      const step = Math.hypot(x - px, y - py);
      if (ks !== pks) pressT = ks ? t : -1;
      const [dx, dy] = dirOf(ks);
      if (dx || dy) {
        frames++;
        const along = ((x - px) * dx + (y - py) * dy) / Math.hypot(dx, dy);
        if (along < -0.005) { back++; worst = Math.max(worst, -along); }
        if (pressT >= 0 && step > 0.004) { starts.push(t - pressT); pressT = -1; }
      } else if (step > 0.25) { jumps++; maxJump = Math.max(maxJump, step); }
    }
    if (process.env.DEBUG) for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const st = Math.hypot(r[1] - rows[i - 1][1], r[2] - rows[i - 1][2]);
      if (i % 6 === 0 || st > 0.2) console.log(r[0].toFixed(0).padStart(6), (r[5] || '-').padEnd(3), 'pant', r[1].toFixed(2), r[2].toFixed(2), 'serv', r[3].toFixed(2), r[4].toFixed(2), 'paso', st.toFixed(3));
    }
    // retroceso al soltar: lo que se mueve contra la última dirección tras soltar
    let pull = 0, worstPull = 0, lastDir = [0, 0], acc = 0;
    for (let i = 1; i < rows.length; i++) {
      const [, x, y, , , ks] = rows[i];
      const [, px, py] = rows[i - 1];
      const d = dirOf(ks);
      if (d[0] || d[1]) { lastDir = d; if (acc > 0.15) pull++; worstPull = Math.max(worstPull, acc); acc = 0; continue; }
      const along = ((x - px) * lastDir[0] + (y - py) * lastDir[1]) / (Math.hypot(lastDir[0], lastDir[1]) || 1);
      if (along < 0) acc -= along;
    }
    if (acc > 0.15) pull++;
    worstPull = Math.max(worstPull, acc);
    console.log(`retroceso al soltar: ${pull} veces (peor ${worstPull.toFixed(2)} casillas)`);
    const last = rows[rows.length - 1];
    const gap = Math.hypot(last[1] - last[3], last[2] - last[4]);
    console.log(`fotogramas con tecla ${frames} · hacia atrás: ${back} (peor ${worst.toFixed(3)} casillas)`);
    console.log(`arranque tras pulsar: ${starts.map((s) => Math.round(s) + ' ms').join(', ')}`);
    console.log(`saltos bruscos con las teclas sueltas: ${jumps} (mayor ${maxJump.toFixed(2)}) · distancia final pantalla↔servidor ${gap.toFixed(3)}`);
    b.close(); host.close();
    process.exit(back > 0 || gap > 0.1 || pull > 0 ? 2 : 0);
  }
  process.exit(1);
})();
