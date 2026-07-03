import {
  buildSnap,
  createGame,
  getMap,
  makePlacementContext,
  makeSimContext,
  sanitizeSettings,
  stepGame,
  GAME_SPEEDS,
  MAX_PLAYERS,
  PLAYER_COLORS,
  TICK_MS,
  type ClientMsg,
  type EndStats,
  type GameState,
  type LobbyPlayer,
  type PlayerCommand,
  type RoomSettings,
  type ServerMsg,
  type SimContext,
} from '@td/shared';
import { saveScore } from './scores.js';

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  SCORES?: KVNamespace;
}

interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  color: string;
  ws: WebSocket | null;
  isHost: boolean;
}

const CHAT_MAX = 200;

// Una sala = un Durable Object. Reutiliza toda la simulación de @td/shared;
// solo el transporte (WebSocket) y la orquestación son específicos de Cloudflare.
// Mientras haya un WebSocket abierto, el DO permanece en memoria (sin hibernar),
// así el estado de la partida vive en RAM igual que en el servidor Node.
export class RoomDO {
  private env: Env;
  private code = '';
  private initialized = false;
  private reserved = false;

  private players: RoomPlayer[] = [];
  private settings: RoomSettings = sanitizeSettings(undefined);
  private game: GameState | null = null;
  private simCtx: SimContext | null = null;
  private pendingCmds: PlayerCommand[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private speed = 1;
  private lastPingAt = new Map<string, number>();
  private nextPlayerNum = 1;

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env;
  }

  // ---------- entrada HTTP (reserva de código + upgrade a WebSocket) ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // reserva atómica de un código libre (la usa el Worker al crear una sala)
    if (url.pathname === '/reserve') {
      if (this.initialized || this.reserved) return new Response('taken', { status: 409 });
      this.reserved = true;
      this.code = (url.searchParams.get('code') ?? '').toUpperCase();
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (!this.code) this.code = (url.searchParams.get('code') ?? '').toUpperCase();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.acceptSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptSocket(ws: WebSocket): void {
    ws.accept();
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(ev.data as string) as ClientMsg;
      } catch {
        return;
      }
      try {
        this.handleMessage(ws, msg);
      } catch (err) {
        console.error('[room] error procesando mensaje', (msg as { type?: string })?.type, err);
        this.sendTo(ws, { type: 'error', msg: 'Mensaje inválido' });
      }
    });
    const drop = () => this.dropSocket(ws);
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
  }

  // ---------- utilidades de socket ----------

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private send(player: RoomPlayer, msg: ServerMsg): void {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
  }

  private systemMsg(text: string): void {
    this.broadcast({ type: 'chat', from: '', color: '#9e9e9e', text });
  }

  private connectedCount(): number {
    return this.players.filter((p) => p.ws).length;
  }

  // ---------- gestión de jugadores ----------

  private addPlayer(name: string, token: string, ws: WebSocket): RoomPlayer | string {
    const existing = this.players.find((p) => p.token === token);
    if (existing) {
      existing.ws?.close();
      existing.ws = ws;
      existing.name = (name || existing.name).slice(0, 16);
      this.markConnected(existing.id, true);
      this.reviveLoop();
      return existing;
    }
    // con la partida en curso no entra nadie nuevo, aunque tenga el código
    // (la reconexión de los que ya jugaban sí funciona, por token, arriba)
    if (this.game && !this.game.over) return 'La partida ya comenzó, espera a que termine';
    if (this.connectedCount() >= MAX_PLAYERS) return 'La sala está llena';
    const player: RoomPlayer = {
      id: `p${this.nextPlayerNum++}`,
      token,
      name: (name || 'Jugador').slice(0, 16),
      color: PLAYER_COLORS[(this.nextPlayerNum - 2) % PLAYER_COLORS.length],
      ws,
      isHost: this.players.length === 0,
    };
    this.players.push(player);
    return player;
  }

  private sendGameStateTo(player: RoomPlayer): void {
    if (this.game && !this.game.over) {
      this.send(player, { type: 'game_started', init: this.gameInit(player.id) });
      if (this.speed !== 1) this.send(player, { type: 'speed', speed: this.speed, by: '' });
      if (this.paused) this.send(player, { type: 'paused', by: '' });
    }
  }

  private dropSocket(ws: WebSocket): void {
    const player = this.players.find((p) => p.ws === ws);
    if (!player) return;
    player.ws = null;
    this.markConnected(player.id, false);

    if (!this.game) {
      this.players = this.players.filter((p) => p !== player);
    }
    if (player.isHost) {
      const next = this.players.find((p) => p.ws);
      if (next) {
        player.isHost = false;
        next.isHost = true;
        this.systemMsg(`${next.name} ahora es el anfitrión`);
      }
    }
    this.broadcastLobby();

    // sin nadie conectado, paramos el loop para que el DO pueda liberarse
    // (si alguien reconecta antes de que se evacúe, reviveLoop lo reanuda)
    if (this.connectedCount() === 0 && this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  private markConnected(playerId: string, connected: boolean): void {
    const gp = this.game?.players.find((p) => p.id === playerId);
    if (gp) gp.connected = connected;
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.isHost,
      connected: p.ws !== null,
    }));
  }

  private broadcastLobby(): void {
    this.broadcast({
      type: 'lobby_state',
      players: this.lobbyPlayers(),
      settings: this.settings,
      inGame: this.game !== null && !this.game.over,
    });
  }

  private gameInit(forPlayerId: string) {
    return {
      mapId: this.game!.mapId,
      mode: this.game!.mode,
      difficulty: this.game!.difficulty,
      players: this.game!.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      youAre: forPlayerId,
    };
  }

  // ---------- partida ----------

  private startGame(): void {
    const map = getMap(this.settings.mapId);
    const seed = (Math.random() * 0xffffffff) | 0;
    this.game = createGame(
      map.id,
      this.settings.mode,
      this.settings.difficulty,
      seed,
      this.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    );
    this.simCtx = makeSimContext(map, makePlacementContext(map));
    this.pendingCmds = [];
    this.paused = false;
    this.speed = 1;

    for (const p of this.players) {
      this.send(p, { type: 'game_started', init: this.gameInit(p.id) });
    }
    this.reviveLoop(true);
  }

  // arranca (o reanuda) el bucle de simulación si hay partida activa y jugadores
  private reviveLoop(force = false): void {
    if (!this.game || this.game.over) return;
    if (this.loop && !force) return;
    if (this.loop) clearInterval(this.loop);
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    if (!this.game || !this.simCtx || this.paused) return;
    const cmds = this.pendingCmds;
    this.pendingCmds = [];
    const wasOver = this.game.over !== null;
    const events = stepGame(this.game, this.simCtx, cmds);
    for (let i = 1; i < this.speed && !this.game.over; i++) {
      events.push(...stepGame(this.game, this.simCtx, []));
    }
    this.broadcast({ type: 'tick', t: this.game.tick, snap: buildSnap(this.game), events });

    if (this.game.over && !wasOver) this.endGame();
  }

  private endGame(): void {
    if (!this.game) return;
    const g = this.game;
    const stats: EndStats = {
      victory: g.over?.victory ?? false,
      wave: g.wave,
      totalWaves: g.totalWaves,
      mapId: g.mapId,
      mode: g.mode,
      difficulty: g.difficulty,
      players: g.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        kills: p.stats.kills,
        damage: Math.round(p.stats.damage),
        goldEarned: Math.round(p.stats.goldEarned),
        goldSpent: Math.round(p.stats.goldSpent),
        towersBuilt: p.stats.towersBuilt,
      })),
    };
    if (g.mode === 'endless') {
      void saveScore(this.env, {
        names: g.players.map((p) => p.name),
        wave: g.wave,
        mapId: g.mapId,
        difficulty: g.difficulty,
        date: new Date().toISOString(),
      });
    }
    setTimeout(() => {
      if (this.game !== g) return; // ya se reinició
      if (this.loop) clearInterval(this.loop);
      this.loop = null;
      this.game = null;
      this.simCtx = null;
      this.broadcast({ type: 'game_over', stats });
      this.broadcastLobby();
    }, 1200);
  }

  // ---------- entrada de mensajes ----------

  private handleMessage(ws: WebSocket, msg: ClientMsg): void {
    // crear / unirse crean el vínculo socket↔jugador; el resto exige jugador ya ligado
    if (msg.type === 'create_room') {
      if (this.initialized) {
        this.sendTo(ws, { type: 'error', msg: 'Ese código ya está en uso, intenta de nuevo' });
        return;
      }
      this.initialized = true;
      this.settings = sanitizeSettings(msg.settings);
      const player = this.addPlayer(msg.name, msg.token, ws);
      if (typeof player === 'string') {
        this.sendTo(ws, { type: 'error', msg: player });
        return;
      }
      this.sendTo(ws, { type: 'room_joined', code: this.code, playerId: player.id, isHost: player.isHost });
      this.broadcastLobby();
      return;
    }

    if (msg.type === 'join_room') {
      if (!this.initialized) {
        this.sendTo(ws, { type: 'error', msg: `No existe la sala "${this.code}"` });
        return;
      }
      const player = this.addPlayer(msg.name, msg.token, ws);
      if (typeof player === 'string') {
        this.sendTo(ws, { type: 'error', msg: player });
        return;
      }
      this.sendTo(ws, { type: 'room_joined', code: this.code, playerId: player.id, isHost: player.isHost });
      this.broadcastLobby();
      this.sendGameStateTo(player);
      return;
    }

    const player = this.players.find((p) => p.ws === ws);
    if (!player) return;

    switch (msg.type) {
      case 'set_settings':
        if (!player.isHost || this.game) break;
        this.settings = sanitizeSettings(msg.settings);
        this.broadcastLobby();
        break;

      case 'start_game':
        if (!player.isHost) {
          this.send(player, { type: 'error', msg: 'Solo el anfitrión puede iniciar' });
          break;
        }
        if (this.game && !this.game.over) break;
        this.startGame();
        break;

      case 'chat': {
        const text = String(msg.text ?? '').slice(0, CHAT_MAX).trim();
        if (!text) break;
        this.broadcast({ type: 'chat', from: player.name, color: player.color, text });
        break;
      }

      case 'cmd':
        if (!this.game || this.game.over) break;
        this.pendingCmds.push({ playerId: player.id, cmd: msg.cmd });
        break;

      case 'pause':
        if (!player.isHost || !this.game) break;
        this.paused = true;
        this.broadcast({ type: 'paused', by: player.name });
        break;

      case 'resume':
        if (!player.isHost || !this.game) break;
        this.paused = false;
        this.broadcast({ type: 'resumed' });
        break;

      case 'set_speed': {
        if (!player.isHost || !this.game) break;
        const speed = Number(msg.speed);
        if (!(GAME_SPEEDS as readonly number[]).includes(speed) || speed === this.speed) break;
        this.speed = speed;
        this.broadcast({ type: 'speed', speed, by: player.name });
        break;
      }

      case 'map_ping': {
        if (!this.game) break;
        const now = Date.now();
        if (now - (this.lastPingAt.get(player.id) ?? 0) < 600) break;
        const map = getMap(this.game.mapId);
        const x = Number(msg.x);
        const y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        this.lastPingAt.set(player.id, now);
        this.broadcast({
          type: 'map_ping',
          x: Math.max(0, Math.min(map.gridW, x)),
          y: Math.max(0, Math.min(map.gridH, y)),
          by: player.name,
          color: player.color,
        });
        break;
      }

      case 'leave_room':
        ws.close();
        break;

      case 'ping':
        this.send(player, { type: 'pong', t: msg.t });
        break;
    }
  }
}
