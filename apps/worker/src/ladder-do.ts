// LADDER de ARENA · un ÚNICO Durable Object (idFromName 'v1') con almacenamiento
// SQLite: identidades, ratings e historial de partidas.
//
// POR QUÉ UN DO Y NO D1: además de que la cuenta está al tope de bases D1, un DO
// resuelve gratis el problema que D1 obligaba a tratar a mano — dos partidas que
// terminan a la vez y tocan al mismo jugador. Un Durable Object SERIALIZA los
// requests por construcción, así que el ciclo leer-rating → calcular → escribir no
// puede intercalarse con otro. Sin transacciones ni bloqueos.
//
// IDENTIDAD (sin cuentas, sin Discord, sin email): el navegador genera un par de
// claves ECDSA P-256 NO EXPORTABLE y guarda la privada en IndexedDB; aquí solo vive
// la pública. Para demostrar quién eres firmas un reto (challenge-response), y a
// cambio recibes un TICKET de corta vida. La firma —cara— se verifica una vez al
// entrar; lo que viaja luego es el ticket, que se valida con un HMAC barato.
//
// El secreto del HMAC se genera solo en el primer arranque y vive en el storage de
// este DO: no hay ningún secreto que configurar ni que se pueda olvidar rotar.
import {
  arenaPlaces,
  immortalPositions,
  isRankedArena,
  PROVISIONAL_GAMES,
  rankLabel,
  rankOf,
  rateMatch,
  RATING_START,
  type GameMode,
  type RatedEntry,
} from '@td/shared';

// Un ticket vale una hora: lo suficiente para una partida larga de arena, lo
// bastante poco para que robar uno de un log no sirva de nada al día siguiente.
const TICKET_TTL_MS = 60 * 60_000;
// Un reto caduca en 2 minutos: solo tiene que sobrevivir al viaje de ida y vuelta.
const CHALLENGE_TTL_MS = 2 * 60_000;
// Tope de la tabla pública (la portada no necesita más).
const TOP_LIMIT = 50;

interface Env {
  LADDER: DurableObjectNamespace;
}

interface ResultPlayer {
  pid: string;
  ticket: string;
  name: string;
  waveReached: number;
  eliminatedTick: number;
  eliminated: boolean;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export class LadderDO {
  private state: DurableObjectState;
  private sql: SqlStorage;
  private hmac: CryptoKey | null = null;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.sql = state.storage.sql;
    // El esquema y la clave se preparan ANTES de atender ningún request: sin esto,
    // el primer fetch podría encontrarse las tablas a medio crear.
    state.blockConcurrencyWhile(async () => {
      this.migrate();
      await this.ensureKey();
    });
  }

  // Esquema. `IF NOT EXISTS` en todo: el constructor corre en CADA reconstrucción
  // del DO, no solo la primera vez.
  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        pid        TEXT PRIMARY KEY,
        name       TEXT NOT NULL DEFAULT '',
        rating     INTEGER NOT NULL,
        games      INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        immortal_since INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS credentials (
        pid        TEXT NOT NULL,
        kind       TEXT NOT NULL,
        public_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS credentials_pid ON credentials(pid);
      CREATE TABLE IF NOT EXISTS challenges (
        nonce TEXT PRIMARY KEY,
        pid   TEXT NOT NULL,
        exp   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id          TEXT PRIMARY KEY,
        mode        TEXT NOT NULL,
        map_id      TEXT NOT NULL,
        difficulty  TEXT NOT NULL,
        finished_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id       TEXT NOT NULL,
        pid            TEXT NOT NULL,
        place          INTEGER NOT NULL,
        wave_reached   INTEGER NOT NULL,
        eliminated_tick INTEGER NOT NULL,
        rating_before  INTEGER NOT NULL,
        rating_after   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS match_players_pid ON match_players(pid);
      CREATE INDEX IF NOT EXISTS players_rating ON players(rating DESC);
    `);
  }

  // Clave del HMAC de los tickets: se crea sola la primera vez y se queda. Va en
  // el storage clave-valor (no en SQL) porque no es un dato del dominio.
  private async ensureKey(): Promise<void> {
    let raw = (await this.state.storage.get<ArrayBuffer>('ticket-key')) ?? null;
    if (!raw) {
      raw = crypto.getRandomValues(new Uint8Array(32)).buffer;
      await this.state.storage.put('ticket-key', raw);
    }
    this.hmac = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
  }

  // ---------- tickets ----------

  private async issueTicket(pid: string): Promise<string> {
    const exp = Date.now() + TICKET_TTL_MS;
    const cuerpo = `${pid}.${exp}`;
    const sig = await crypto.subtle.sign('HMAC', this.hmac!, new TextEncoder().encode(cuerpo));
    return `${cuerpo}.${b64url(sig)}`;
  }

  // Devuelve el pid si el ticket es auténtico y no ha caducado; null si no. Un
  // ticket inválido NO es un error ruidoso: simplemente esa partida no puntúa para
  // quien lo presentó (puede ser alguien con la pestaña abierta desde ayer).
  private async readTicket(ticket: string): Promise<string | null> {
    const partes = (ticket ?? '').split('.');
    if (partes.length !== 3) return null;
    const [pid, expRaw, sig] = partes;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp < Date.now()) return null;
    const esperado = await crypto.subtle.sign('HMAC', this.hmac!, new TextEncoder().encode(`${pid}.${exp}`));
    // comparación en tiempo constante sobre el base64url (longitudes fijas)
    const a = b64url(esperado);
    if (a.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0 ? pid : null;
  }

  // ---------- consultas ----------

  private player(pid: string): { pid: string; name: string; rating: number; games: number; immortal_since: number } | null {
    const filas = this.sql
      .exec<{ pid: string; name: string; rating: number; games: number; immortal_since: number }>(
        'SELECT pid, name, rating, games, immortal_since FROM players WHERE pid = ?',
        pid,
      )
      .toArray();
    return filas[0] ?? null;
  }

  // Puestos de inmortal, que son RELATIVOS: hay que mirar a todos los que pasan del
  // corte, no solo al jugador que pregunta.
  private immortals(): Map<string, number> {
    const filas = this.sql
      .exec<{ pid: string; rating: number; immortal_since: number }>(
        'SELECT pid, rating, immortal_since FROM players ORDER BY rating DESC LIMIT 200',
      )
      .toArray();
    return immortalPositions(filas.map((f) => ({ pid: f.pid, rating: f.rating, since: f.immortal_since })));
  }

  private badgeOf(pid: string, rating: number, games: number, pos: Map<string, number>) {
    const badge = rankOf(rating, games, pos.get(pid) ?? null);
    return { ...badge, label: rankLabel(badge) };
  }

  // ---------- entrada HTTP (solo la llama el Worker) ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ALTA de una identidad de dispositivo: llega la clave PÚBLICA (la privada se
    // queda en el navegador y no es exportable ni por su dueño).
    if (url.pathname === '/register' && request.method === 'POST') {
      const { publicKey } = (await request.json()) as { publicKey?: unknown };
      if (!publicKey || typeof publicKey !== 'object') return json({ error: 'falta la clave' }, 400);
      // se importa aquí para RECHAZAR de entrada una clave que no sirva: si no,
      // el fallo aparecería mucho después, al intentar verificar una firma.
      try {
        await crypto.subtle.importKey('jwk', publicKey as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      } catch {
        return json({ error: 'la clave no es una ECDSA P-256 válida' }, 400);
      }
      const pid = crypto.randomUUID();
      const now = Date.now();
      this.sql.exec(
        'INSERT INTO players (pid, name, rating, games, created_at, last_seen) VALUES (?, ?, ?, 0, ?, ?)',
        pid,
        '',
        RATING_START,
        now,
        now,
      );
      this.sql.exec(
        'INSERT INTO credentials (pid, kind, public_key, created_at) VALUES (?, ?, ?, ?)',
        pid,
        'device',
        JSON.stringify(publicKey),
        now,
      );
      return json({ pid });
    }

    // RETO para demostrar la identidad.
    if (url.pathname === '/challenge') {
      const pid = url.searchParams.get('pid') ?? '';
      if (!this.player(pid)) return json({ error: 'identidad desconocida' }, 404);
      const nonce = crypto.randomUUID();
      this.sql.exec('DELETE FROM challenges WHERE exp < ?', Date.now()); // barrido barato
      this.sql.exec('INSERT INTO challenges (nonce, pid, exp) VALUES (?, ?, ?)', nonce, pid, Date.now() + CHALLENGE_TTL_MS);
      return json({ nonce });
    }

    // FIRMA del reto → ticket. Aquí es donde se paga la criptografía asimétrica,
    // una sola vez por sesión.
    if (url.pathname === '/verify' && request.method === 'POST') {
      const { pid, nonce, signature, name } = (await request.json()) as {
        pid?: string;
        nonce?: string;
        signature?: string;
        name?: string;
      };
      const reto = this.sql
        .exec<{ pid: string; exp: number }>('SELECT pid, exp FROM challenges WHERE nonce = ?', nonce ?? '')
        .toArray()[0];
      // el reto se consume SIEMPRE, valga o no: un nonce no se reutiliza jamás
      if (nonce) this.sql.exec('DELETE FROM challenges WHERE nonce = ?', nonce);
      if (!reto || reto.pid !== pid || reto.exp < Date.now()) return json({ error: 'reto inválido o caducado' }, 401);

      const cred = this.sql
        .exec<{ public_key: string }>('SELECT public_key FROM credentials WHERE pid = ?', pid!)
        .toArray()[0];
      if (!cred) return json({ error: 'identidad sin credencial' }, 401);

      let ok = false;
      try {
        const key = await crypto.subtle.importKey(
          'jwk',
          JSON.parse(cred.public_key) as JsonWebKey,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
        const sig = Uint8Array.from(atob((signature ?? '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        ok = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          sig,
          new TextEncoder().encode(nonce!),
        );
      } catch {
        ok = false;
      }
      if (!ok) return json({ error: 'firma inválida' }, 401);

      const limpio = String(name ?? '').slice(0, 16).trim();
      this.sql.exec(
        'UPDATE players SET last_seen = ?, name = CASE WHEN ? <> \'\' THEN ? ELSE name END WHERE pid = ?',
        Date.now(),
        limpio,
        limpio,
        pid!,
      );
      const p = this.player(pid!)!;
      const pos = this.immortals();
      return json({ ticket: await this.issueTicket(pid!), rating: p.rating, games: p.games, badge: this.badgeOf(p.pid, p.rating, p.games, pos) });
    }

    // RESULTADO de una partida. Lo manda el RoomDO al terminar.
    if (url.pathname === '/result' && request.method === 'POST') {
      const body = (await request.json()) as {
        matchId: string;
        mode: GameMode;
        mapId: string;
        difficulty: string;
        turbo: boolean;
        publicRoom: boolean;
        players: ResultPlayer[];
      };

      // 1) quedarse SOLO con quien presenta un ticket auténtico. Los invitados sin
      //    identidad juegan igual, pero no puntúan ni cuentan para el mínimo.
      const validos: (ResultPlayer & { pid: string })[] = [];
      for (const p of body.players ?? []) {
        const pid = await this.readTicket(p.ticket ?? '');
        if (pid && pid === p.pid && this.player(pid)) validos.push({ ...p, pid });
      }
      const pids = validos.map((p) => p.pid);
      if (!isRankedArena({ mode: body.mode, turbo: body.turbo, publicRoom: body.publicRoom, pids })) {
        return json({ ranked: false, reason: 'la partida no cumple las condiciones para puntuar', results: [] });
      }
      // ya rankeada: que no se pueda enviar dos veces la misma
      const repetida = this.sql.exec('SELECT id FROM matches WHERE id = ?', body.matchId).toArray().length > 0;
      if (repetida) return json({ ranked: false, reason: 'ese resultado ya estaba registrado', results: [] });

      // 2) podio y cálculo (mismo criterio que la pantalla de fin)
      const places = arenaPlaces(
        validos.map((p) => ({
          pid: p.pid,
          eliminated: p.eliminated,
          waveReached: p.waveReached,
          eliminatedTick: p.eliminatedTick,
        })),
      );
      const entries: RatedEntry[] = validos.map((p) => {
        const row = this.player(p.pid)!;
        return { pid: p.pid, rating: row.rating, games: row.games, place: places.get(p.pid) ?? validos.length };
      });
      const deltas = rateMatch(entries);

      // 3) escritura. El DO serializa los requests, así que este bloque no puede
      //    intercalarse con el de otra partida que toque a la misma gente.
      const now = Date.now();
      this.sql.exec(
        'INSERT INTO matches (id, mode, map_id, difficulty, finished_at) VALUES (?, ?, ?, ?, ?)',
        body.matchId,
        body.mode,
        body.mapId,
        body.difficulty ?? '',
        now,
      );
      const corteInmortal = rankOf(99999, 99).tier;
      for (const d of deltas) {
        const p = validos.find((v) => v.pid === d.pid)!;
        const antes = this.player(d.pid)!;
        // marca de cuándo se llegó a inmortal: sirve para desempatar puestos y solo
        // se pone la PRIMERA vez que se cruza el corte (si bajas y vuelves, cuenta
        // la vez original — el desempate premia la permanencia, no el rebote).
        const eraInmortal = rankOf(antes.rating, antes.games).tier === corteInmortal;
        const esInmortal = rankOf(d.after, antes.games + 1).tier === corteInmortal;
        this.sql.exec(
          `UPDATE players SET rating = ?, games = games + 1, last_seen = ?,
             name = CASE WHEN ? <> '' THEN ? ELSE name END,
             immortal_since = CASE WHEN ? = 0 AND ? = 1 THEN ? ELSE immortal_since END
           WHERE pid = ?`,
          d.after,
          now,
          p.name.slice(0, 16),
          p.name.slice(0, 16),
          antes.immortal_since,
          esInmortal && !eraInmortal ? 1 : 0,
          now,
          d.pid,
        );
        this.sql.exec(
          'INSERT INTO match_players (match_id, pid, place, wave_reached, eliminated_tick, rating_before, rating_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
          body.matchId,
          d.pid,
          places.get(d.pid) ?? 0,
          p.waveReached,
          p.eliminatedTick,
          d.before,
          d.after,
        );
      }

      // 4) devolver qué le pasó a cada uno, ya con su medalla nueva
      const pos = this.immortals();
      const results = deltas.map((d) => {
        const row = this.player(d.pid)!;
        return {
          pid: d.pid,
          before: d.before,
          after: d.after,
          delta: d.delta,
          place: places.get(d.pid) ?? 0,
          badge: this.badgeOf(d.pid, row.rating, row.games, pos),
        };
      });
      return json({ ranked: true, results });
    }

    // TABLA pública para la portada.
    if (url.pathname === '/top') {
      const limit = Math.max(1, Math.min(TOP_LIMIT, Number(url.searchParams.get('limit') ?? 20)));
      const pos = this.immortals();
      const filas = this.sql
        .exec<{ pid: string; name: string; rating: number; games: number }>(
          // los que aún calibran NO salen: su número todavía no significa nada
          'SELECT pid, name, rating, games FROM players WHERE games >= ? ORDER BY rating DESC, last_seen ASC LIMIT ?',
          PROVISIONAL_GAMES,
          limit,
        )
        .toArray();
      return json(
        filas.map((f, i) => ({
          rank: i + 1,
          name: f.name,
          games: f.games,
          badge: this.badgeOf(f.pid, f.rating, f.games, pos),
        })),
      );
    }

    // FICHA de un jugador (su propia medalla, para el lobby).
    if (url.pathname === '/me') {
      const p = this.player(url.searchParams.get('pid') ?? '');
      if (!p) return json({ error: 'identidad desconocida' }, 404);
      const pos = this.immortals();
      return json({ name: p.name, rating: p.rating, games: p.games, badge: this.badgeOf(p.pid, p.rating, p.games, pos) });
    }

    return new Response('not found', { status: 404 });
  }
}
