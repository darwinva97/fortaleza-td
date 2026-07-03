import type { WebSocket } from 'ws';
import {
  buildSnap,
  createGame,
  getMap,
  makePlacementContext,
  makeSimContext,
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
import { sanitizeSettings } from '@td/shared';
import { saveHighscore } from './highscores.js';

export interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  color: string;
  ws: WebSocket | null;
  isHost: boolean;
}

const CHAT_MAX = 200;

export class Room {
  readonly code: string;
  players: RoomPlayer[] = [];
  settings: RoomSettings;
  game: GameState | null = null;
  simCtx: SimContext | null = null;
  private pendingCmds: PlayerCommand[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private speed = 1; // steps de simulación por tick de red (x1/x2/x3)
  private lastPingAt = new Map<string, number>(); // rate-limit de pings por jugador
  private nextPlayerNum = 1;
  emptySince: number | null = Date.now();
  private onEmpty: (room: Room) => void;

  constructor(code: string, settings: RoomSettings, onEmpty: (room: Room) => void) {
    this.code = code;
    this.settings = sanitizeSettings(settings);
    this.onEmpty = onEmpty;
  }

  // ---------- gestión de jugadores ----------

  addPlayer(name: string, token: string, ws: WebSocket): RoomPlayer | string {
    const existing = this.players.find((p) => p.token === token);
    if (existing) {
      // reconexión
      existing.ws?.close();
      existing.ws = ws;
      existing.name = (name || existing.name).slice(0, 16);
      this.markConnected(existing.id, true);
      return existing;
    }
    // con la partida en curso no entra nadie nuevo, aunque tenga el código
    // (la reconexión de los que ya jugaban sí funciona, por token, arriba)
    if (this.game && !this.game.over) return 'La partida ya comenzó, espera a que termine';
    if (this.players.filter((p) => p.ws).length >= MAX_PLAYERS) return 'La sala está llena';
    const player: RoomPlayer = {
      id: `p${this.nextPlayerNum++}`,
      token,
      name: (name || 'Jugador').slice(0, 16),
      color: PLAYER_COLORS[(this.nextPlayerNum - 2) % PLAYER_COLORS.length],
      ws,
      isHost: this.players.length === 0,
    };
    this.players.push(player);
    this.emptySince = null;
    return player;
  }

  // Tras el room_joined: si hay partida en curso, reenviar el estado inicial
  // (cubre tanto a los que entran a mitad de partida como a los que reconectan).
  sendGameStateTo(player: RoomPlayer): void {
    if (this.game && !this.game.over) {
      this.send(player, { type: 'game_started', init: this.gameInit(player.id) });
      if (this.speed !== 1) this.send(player, { type: 'speed', speed: this.speed, by: '' });
      if (this.paused) this.send(player, { type: 'paused', by: '' });
    }
  }

  dropSocket(ws: WebSocket): void {
    const player = this.players.find((p) => p.ws === ws);
    if (!player) return;
    player.ws = null;
    this.markConnected(player.id, false);

    if (!this.game) {
      // en el lobby los desconectados se eliminan de la sala
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
    if (this.players.every((p) => !p.ws)) {
      this.emptySince = Date.now();
    }
    this.broadcastLobby();
  }

  private markConnected(playerId: string, connected: boolean) {
    const gp = this.game?.players.find((p) => p.id === playerId);
    if (gp) gp.connected = connected;
  }

  // ---------- mensajería ----------

  send(player: RoomPlayer, msg: ServerMsg): void {
    if (player.ws && player.ws.readyState === player.ws.OPEN) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
    }
  }

  systemMsg(text: string): void {
    this.broadcast({ type: 'chat', from: '', color: '#9e9e9e', text });
  }

  lobbyPlayers(): LobbyPlayer[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.isHost,
      connected: p.ws !== null,
    }));
  }

  broadcastLobby(): void {
    this.broadcast({
      type: 'lobby_state',
      players: this.lobbyPlayers(),
      settings: this.settings,
      inGame: this.game !== null && !this.game.over,
    });
  }

  gameInit(forPlayerId: string) {
    return {
      mapId: this.game!.mapId,
      mode: this.game!.mode,
      difficulty: this.game!.difficulty,
      players: this.game!.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      youAre: forPlayerId,
    };
  }

  // ---------- partida ----------

  startGame(): void {
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
    // por si se reinicia dentro de la ventana de gracia de endGame()
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    if (!this.game || !this.simCtx || this.paused) return;
    const cmds = this.pendingCmds;
    this.pendingCmds = [];
    const wasOver = this.game.over !== null;
    // a velocidad x2/x3 se simulan varios pasos por tick de red (un solo snapshot)
    const events = stepGame(this.game, this.simCtx, cmds);
    for (let i = 1; i < this.speed && !this.game.over; i++) {
      events.push(...stepGame(this.game, this.simCtx, []));
    }
    this.broadcast({ type: 'tick', t: this.game.tick, snap: buildSnap(this.game), events });

    if (this.game.over && !wasOver) {
      this.endGame();
    }
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
      saveHighscore({
        names: g.players.map((p) => p.name),
        wave: g.wave,
        mapId: g.mapId,
        difficulty: g.difficulty,
        date: new Date().toISOString(),
      });
    }
    // dejar correr unos ticks más para que el cliente vea la explosión final
    setTimeout(() => {
      // si el anfitrión ya reinició en esta ventana, no destruir la partida nueva
      if (this.game !== g) return;
      if (this.interval) clearInterval(this.interval);
      this.interval = null;
      this.game = null;
      this.simCtx = null;
      this.broadcast({ type: 'game_over', stats });
      this.broadcastLobby();
    }, 1200);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const p of this.players) p.ws?.close();
  }

  // ---------- entrada de mensajes ----------

  handleMessage(ws: WebSocket, msg: ClientMsg): void {
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
        if (now - (this.lastPingAt.get(player.id) ?? 0) < 600) break; // máx ~1.6/s
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

  maybeCleanup(maxIdleMs: number): void {
    if (this.emptySince !== null && Date.now() - this.emptySince > maxIdleMs) {
      this.stop();
      this.onEmpty(this);
    }
  }
}
