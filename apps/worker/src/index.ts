import { RoomDO, type Env } from './room-do.js';
import { DirectoryDO } from './directory-do.js';
import { loadScores } from './scores.js';
import { validateSaveData } from '@td/shared';

// El runtime necesita ver las clases de los Durable Objects exportadas desde el módulo principal.
export { RoomDO, DirectoryDO };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I/O para evitar confusiones

function genCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// Deriva un código de sala de 4 letras (mismo alfabeto CODE_CHARS y regex
// ^[A-Z]{4}$ que valida /ws) de forma DETERMINISTA del instanceId de una Activity
// de Discord: hash FNV-1a de 32 bits y luego 4 dígitos en base 24. Así dos
// jugadores que abren la MISMA Activity derivan el MISMO código sin coordinarse
// (quién es host lo decide `discord-claim`, atómico). El espacio es 24^4 = 331 776
// códigos: dos instancias distintas casi nunca colisionan.
function codeFromInstance(instanceId: string): string {
  let h = 0x811c9dc5; // offset basis de FNV-1a 32 bits
  for (let i = 0; i < instanceId.length; i++) {
    h ^= instanceId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // × primo 16777619, acotado a 32 bits sin signo
  }
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[h % CODE_CHARS.length];
    h = Math.floor(h / CODE_CHARS.length);
  }
  return code;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

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

    // ---------- Discord Activity (Embedded App) ----------

    // Client ID: ÚNICA fuente de verdad (el cliente lo lee de aquí, así configurarlo
    // NO exige recompilar el cliente). Vacío = la integración de Discord está apagada.
    if (url.pathname === '/api/discord/config') {
      return json({ clientId: env.DISCORD_CLIENT_ID ?? '' });
    }

    // Intercambio OAuth: el cliente manda el `code` de sdk.commands.authorize y aquí
    // se canjea por un access_token usando el Client Secret (secreto wrangler, nunca
    // en el cliente). Se devuelve SOLO el access_token (jamás el refresh ni el secret).
    if (url.pathname === '/api/discord/token' && request.method === 'POST') {
      const clientId = env.DISCORD_CLIENT_ID ?? '';
      const clientSecret = env.DISCORD_CLIENT_SECRET ?? '';
      // sin config no hay integración posible: 503 claro (no es culpa del cliente)
      if (!clientId || !clientSecret) {
        return json({ error: 'Discord no está configurado en el servidor' }, 503);
      }
      let code = '';
      try {
        const body = (await request.json()) as { code?: unknown };
        code = typeof body.code === 'string' ? body.code : '';
      } catch {
        /* cuerpo inválido → code vacío */
      }
      // el code de OAuth es corto (~30 chars); acotarlo evita mandar basura a Discord
      if (!code || code.length > 512) return json({ error: 'falta code' }, 400);
      let discordRes: Response;
      try {
        discordRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
          }),
        });
      } catch {
        return json({ error: 'No se pudo contactar con Discord' }, 502);
      }
      if (!discordRes.ok) return json({ error: 'Discord rechazó el code' }, 502);
      const data = (await discordRes.json()) as { access_token?: string };
      if (!data.access_token) return json({ error: 'Respuesta inesperada de Discord' }, 502);
      return json({ access_token: data.access_token });
    }

    // Sala determinista por instancia de Activity: deriva el código del instanceId y
    // resuelve de forma ATÓMICA quién crea la sala (host) vs quién se une (invitado).
    // La atomicidad la garantiza el Durable Object (serializa requests): su handler
    // interno `discord-claim` RESERVA en la primera llamada (host:true) y responde
    // host:false a las siguientes (invitado, incl. una segunda llamada de la misma
    // instancia). Devuelve { code, host }.
    if (url.pathname === '/api/discord/room' && request.method === 'POST') {
      let instanceId = '';
      try {
        const body = (await request.json()) as { instanceId?: unknown };
        instanceId = typeof body.instanceId === 'string' ? body.instanceId : '';
      } catch {
        /* cuerpo inválido → instanceId vacío */
      }
      // instanceId de Discord: cadena acotada y de charset razonable (letras,
      // dígitos y separadores típicos de ids). Fuera de eso → 400.
      if (!instanceId || instanceId.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(instanceId)) {
        return json({ error: 'instanceId inválido' }, 400);
      }
      const code = codeFromInstance(instanceId);
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      const res = await stub.fetch(`https://do/discord-claim?code=${code}`, { method: 'POST' });
      const { host } = (await res.json()) as { host: boolean };
      return json({ code, host });
    }

    // Aviso administrativo a TODOS los conectados (lo usa el workflow de deploy
    // para anunciar «Se desplegará en 1 minuto»). Protegido por el secreto
    // ADMIN_TOKEN (wrangler secret); sin secreto configurado, la ruta no existe.
    if (url.pathname === '/api/admin/announce' && request.method === 'POST') {
      const token = env.ADMIN_TOKEN;
      const auth = request.headers.get('authorization') ?? '';
      if (!token || auth !== `Bearer ${token}`) return json({ error: 'no autorizado' }, 401);
      let text = '';
      try {
        const body = (await request.json()) as { text?: string };
        text = String(body.text ?? '').slice(0, 200).trim();
      } catch {
        /* sin cuerpo válido */
      }
      if (!text) return json({ error: 'falta text' }, 400);
      const ns = env.DIRECTORY;
      if (!ns) return json({ rooms: 0, delivered: 0 });
      const res = await ns.get(ns.idFromName('v1')).fetch('https://do/codes');
      const codes = (await res.json()) as string[];
      let delivered = 0;
      await Promise.all(
        codes.map(async (code) => {
          try {
            const stub = env.ROOM.get(env.ROOM.idFromName(code));
            const r = await stub.fetch('https://do/announce', {
              method: 'POST',
              body: JSON.stringify({ text }),
            });
            if (r.ok) delivered += ((await r.json()) as { delivered: number }).delivered;
          } catch {
            /* una sala caída no frena el anuncio al resto */
          }
        }),
      );
      return json({ rooms: codes.length, delivered });
    }

    // F5 · lista de salas públicas (para la portada). Sin binding → lista vacía.
    if (url.pathname === '/api/rooms') {
      const ns = env.DIRECTORY;
      if (!ns) return json([]);
      const res = await ns.get(ns.idFromName('v1')).fetch('https://do/list');
      return new Response(res.body, { headers: { 'content-type': 'application/json' } });
    }

    // issue #12 · CARGAR partida guardada: valida el SaveData en el borde, reserva
    // una sala libre y le entrega el guardado. Devuelve el código para unirse por WS.
    if (url.pathname === '/api/rooms/from-save' && request.method === 'POST') {
      let save: unknown;
      try {
        save = await request.json();
      } catch {
        return json({ error: 'El archivo no es un JSON válido.' }, 400);
      }
      const v = validateSaveData(save);
      if (!v.ok) return json({ error: v.msg }, 400);
      const body = JSON.stringify(v.save);
      for (let i = 0; i < 15; i++) {
        const code = genCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.fetch(`https://do/loadsave?code=${code}`, { method: 'POST', body });
        if (res.ok) return json({ code });
        // 409 = colisión de código (DO ya en uso): probar otro
      }
      return json({ error: 'No hay códigos de sala libres, intenta de nuevo.' }, 503);
    }

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
