import { RoomDO, type Env } from './room-do.js';
import { loadScores } from './scores.js';

// El runtime necesita ver la clase del Durable Object exportada desde el módulo principal.
export { RoomDO };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I/O para evitar confusiones

function genCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

const json = (data: unknown): Response =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

// Reenvía un upgrade de WebSocket al Durable Object `stub`, con el código en la URL.
function forwardWs(stub: DurableObjectStub, request: Request, code: string): Promise<Response> {
  const url = new URL(request.url);
  url.searchParams.set('code', code);
  return stub.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/highscores') return json(await loadScores(env));
    if (url.pathname === '/api/health') return json({ ok: true });

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }

      // crear sala: buscar un código libre y reservar su Durable Object
      if (url.searchParams.get('create') === '1') {
        for (let i = 0; i < 15; i++) {
          const code = genCode();
          const stub = env.ROOM.get(env.ROOM.idFromName(code));
          const res = await stub.fetch(`https://do/reserve?code=${code}`, { method: 'POST' });
          if (res.ok) return forwardWs(stub, request, code);
        }
        return new Response('no free code', { status: 503 });
      }

      // unirse: enrutar al Durable Object determinista del código
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return new Response('bad code', { status: 400 });
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return forwardWs(stub, request, code);
    }

    // el resto lo sirven los assets estáticos (SPA)
    return env.ASSETS.fetch(request);
  },
};
