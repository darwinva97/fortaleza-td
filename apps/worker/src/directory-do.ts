// F5 · Directorio de salas públicas: UN solo Durable Object (idFromName 'v1')
// con la lista en MEMORIA. Las salas se reportan al cambiar de estado y como
// latido periódico (~10 s, a caballo de los pings de keepalive de sus
// clientes); las entradas sin latido reciente se PODAN al listar, así el
// directorio se auto-repara solo si el DO se recicla (sin storage, sin costes).
//
// Desde el aviso de despliegue, TODAS las salas activas (también las privadas)
// laten aquí: `listed` distingue las que salen en la lista pública (/list) de
// las que solo existen para poder difundirles anuncios (/codes).
import type { PublicRoomInfo } from '@td/shared';

// sin latido en este tiempo, la entrada se considera muerta (los latidos llegan
// cada ~10 s; 45 s tolera un par de fallos sin dejar salas fantasma)
const STALE_MS = 45_000;

interface Entry {
  info: PublicRoomInfo;
  seen: number;
  listed: boolean;
}

export class DirectoryDO {
  private rooms = new Map<string, Entry>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/report') {
      const info = (await request.json()) as PublicRoomInfo & { listed?: boolean };
      if (info && typeof info.code === 'string' && /^[A-Z]{4}$/.test(info.code)) {
        this.rooms.set(info.code, { info, seen: Date.now(), listed: info.listed !== false });
      }
      return new Response('ok');
    }

    if (request.method === 'POST' && url.pathname === '/remove') {
      const { code } = (await request.json()) as { code?: string };
      if (typeof code === 'string') this.rooms.delete(code.toUpperCase());
      return new Response('ok');
    }

    // todas las salas activas (públicas Y privadas), para difundir anuncios
    if (url.pathname === '/codes') {
      const now = Date.now();
      const out: string[] = [];
      for (const [code, e] of this.rooms) {
        if (now - e.seen > STALE_MS) {
          this.rooms.delete(code);
          continue;
        }
        out.push(code);
      }
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    }

    // INVENTARIO administrativo: como /list pero SIN filtrar por `listed`, es decir
    // también las salas privadas, que existen aquí solo para recibir los anuncios y
    // no asoman por ninguna ruta pública. Cada entrada lleva `listed` (si sale en la
    // portada) y `seenMs` (edad de su último latido: cuanto más cerca de STALE_MS,
    // más sospechosa de estar agonizando).
    if (url.pathname === '/all') {
      const now = Date.now();
      const out: (PublicRoomInfo & { listed: boolean; seenMs: number })[] = [];
      for (const [code, e] of this.rooms) {
        if (now - e.seen > STALE_MS) {
          this.rooms.delete(code);
          continue;
        }
        out.push({ ...e.info, listed: e.listed, seenMs: now - e.seen });
      }
      out.sort((a, b) => a.code.localeCompare(b.code));
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/list') {
      const now = Date.now();
      const out: PublicRoomInfo[] = [];
      for (const [code, e] of this.rooms) {
        if (now - e.seen > STALE_MS) {
          this.rooms.delete(code);
          continue;
        }
        if (e.listed) out.push(e.info);
      }
      // lobbies primero (se puede JUGAR), luego las partidas en curso (se mira)
      out.sort((a, b) => Number(a.inGame) - Number(b.inGame) || a.code.localeCompare(b.code));
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    }

    return new Response('not found', { status: 404 });
  }
}
