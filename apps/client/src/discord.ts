// Integración de «Fortaleza» como Activity de Discord (Embedded App). Se importa
// PEREZOSAMENTE desde main.ts, solo cuando la página viene embebida en Discord
// (?frame_id=…), para no sumar el SDK al bundle de los jugadores web. Todo aquí es
// transporte/UI: reusa `net` y los mensajes create_room/join_room de siempre.
//
// Filosofía a prueba de pantallazos negros: CUALQUIER fallo (SDK, OAuth, red) cae
// al home normal con el error en consola — la Activity nunca se queda en negro.
import type { ClientMsg } from '@td/shared';
import { net, wsPathJoin } from './net.js';
import { roomPrevToken, saveName, store } from './store.js';
import { homeError } from './screens.js';

// Texto de estado en la portada. Reusa el hueco de error del home: es el patrón
// existente para «decirle algo al usuario en la pantalla de inicio» (no invento UI).
function status(msg: string): void {
  homeError(msg);
}

// ~20 s de margen para la carrera invitado-antes-que-host: el invitado llega y la
// sala aún no fue creada por el host, así que se reintenta con backoff hasta esto.
const JOIN_DEADLINE_MS = 20_000;

export async function initDiscord(): Promise<void> {
  try {
    // 1) Client ID desde el Worker (fuente única; configurarlo no exige recompilar).
    //    Sin clientId ⇒ integración apagada: seguir con el home normal en silencio.
    const cfg = (await (await fetch('/api/discord/config')).json()) as { clientId?: string };
    const clientId = cfg.clientId ?? '';
    if (!clientId) return;

    status('Conectando con Discord…');

    // 2) SDK embebido (import dinámico dentro del módulo ya perezoso).
    const { DiscordSDK } = await import('@discord/embedded-app-sdk');
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();

    // 3) OAuth: autorizar (code) → canjearlo server-side (access_token) → autenticar.
    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });
    const tokenRes = await fetch('/api/discord/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!tokenRes.ok) throw new Error(`intercambio de token falló (${tokenRes.status})`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const auth = await sdk.commands.authenticate({ access_token });

    // 4) nombre del jugador: global_name (nombre visible) o, en su defecto, username.
    //    Recorta a 16 igual que el server (que además lo sanea) para el store local.
    const dName = String(auth?.user?.global_name ?? auth?.user?.username ?? 'Jugador').slice(0, 16);
    saveName(dName);

    // 5) sala determinista de esta instancia de Activity: el Worker resuelve de forma
    //    atómica quién es host (crea la sala) y quién invitado (se une).
    status('Entrando a la sala…');
    const roomRes = await fetch('/api/discord/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: sdk.instanceId }),
    });
    if (!roomRes.ok) throw new Error(`no se pudo resolver la sala (${roomRes.status})`);
    const { code: roomCode, host } = (await roomRes.json()) as { code: string; host: boolean };

    if (host) {
      // HOST: crea la sala. OJO: se conecta al código DETERMINISTA con wsPathJoin y
      // manda create_room como PRIMER mensaje — NO wsPathCreate(), que le asignaría
      // un código ALEATORIO y rompería el encuentro con el invitado. La ruta ?code=
      // solo enruta al Durable Object; el primer mensaje decide crear vs unirse.
      // Visibilidad PRIVADA: las salas de Discord no deben salir en el directorio
      // público de la portada web.
      net.connect(wsPathJoin(roomCode), {
        type: 'create_room',
        name: dName,
        token: store.token,
        settings: { mapId: 'sendero', mode: 'classic', difficulty: 'normal', public: false },
      });
    } else {
      // INVITADO: se une, con reintentos por si el host aún no creó la sala.
      joinAsGuest(roomCode, dName);
    }
  } catch (err) {
    console.error('[discord] flujo abortado; se sigue con el home normal', err);
    status('');
  }
}

// Unión del invitado con reintentos (carrera invitado-antes-que-host). El manejador
// de errores normal (main.ts) ya hace net.disconnect() al ver «No existe la sala»;
// aquí reabrimos con backoff y pisamos ese texto con nuestro estado, hasta unirnos
// (room_joined) o agotar el plazo. Nuestros manejadores se registran DESPUÉS que los
// de wireNet(), así que corren tras ellos (y pueden sobrescribir su homeError).
function joinAsGuest(code: string, name: string): void {
  const joinMsg: ClientMsg = {
    type: 'join_room',
    name,
    token: store.token,
    code,
    prevToken: roomPrevToken(code),
  };
  const deadline = Date.now() + JOIN_DEADLINE_MS;
  let attempt = 0;
  let joined = false;

  net.on('room_joined', () => {
    joined = true;
  });
  net.on('error', (m) => {
    if (joined) return;
    // solo nos interesa la carrera «la sala aún no existe»; el resto de errores los
    // gestiona el flujo normal (toast/home) y no debemos reintentar sobre ellos.
    if (!/no existe la sala/i.test(m.msg)) return;
    if (Date.now() >= deadline) {
      status('No se pudo entrar a la sala de Discord. Recarga la Activity para reintentar.');
      return;
    }
    status('Entrando a la sala…');
    const delay = Math.min(400 * 1.6 ** attempt++, 3000);
    setTimeout(() => {
      if (!joined) net.connect(wsPathJoin(code), joinMsg);
    }, delay);
  });

  net.connect(wsPathJoin(code), joinMsg);
}
