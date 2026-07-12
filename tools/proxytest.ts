// Verifica un despliegue vivo: página HTTP + handshake WS + crear sala.
// Uso: tsx tools/proxytest.ts <puertoHttp> [rutaWs]
import WebSocket from 'ws';

const port = process.argv[2] ?? '8787';
const base = `http://localhost:${port}`;

async function main(): Promise<void> {
  // 1. ¿la página carga?
  const res = await fetch(base + '/');
  const html = await res.text();
  console.log(`GET / → ${res.status}, ${html.length} bytes, ¿es el juego?: ${html.includes('Fortaleza')}`);

  // 2. ¿el bundle JS referenciado existe?
  const jsMatch = html.match(/src="(\/[^"]+\.[jt]s)"/);
  if (jsMatch) {
    const js = await fetch(base + jsMatch[1]);
    console.log(`GET ${jsMatch[1]} → ${js.status}`);
  }

  // 3. ¿el WebSocket conecta y responde?
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise<void>((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout abriendo WS')), 4000);
    ws.on('open', () => {
      clearTimeout(to);
      res();
    });
    ws.on('error', (e) => {
      clearTimeout(to);
      rej(e);
    });
  });
  console.log('WS abierto ✔');

  ws.send(
    JSON.stringify({
      type: 'create_room',
      name: 'Prueba',
      token: 'token-proxy-test',
      settings: { mapId: 'sendero', mode: 'classic', difficulty: 'normal' },
    }),
  );
  const reply = await new Promise<string>((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout esperando room_joined')), 4000);
    ws.on('message', (raw) => {
      clearTimeout(to);
      res(String(raw));
    });
  });
  const msg = JSON.parse(reply);
  console.log(`respuesta del servidor: ${msg.type} ${msg.code ?? ''} ✔`);
  ws.close();
  console.log('🎉 Todo OK en el puerto ' + port);
  process.exit(0);
}

main().catch((err) => {
  console.error('💥 FALLO:', err.message ?? err);
  process.exit(1);
});
