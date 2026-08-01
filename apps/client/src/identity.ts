// IDENTIDAD del ladder (rango de arena), sin cuentas, sin Discord y sin email.
//
// El navegador genera un par de claves ECDSA P-256 y guarda la PRIVADA en
// IndexedDB. La clave se crea con `extractable: false`, así que ni el propio
// dueño puede leerla: el navegador solo deja FIRMAR con ella. Esa es la
// diferencia con guardar un identificador suelto en localStorage — no hay ningún
// secreto que se pueda copiar desde la consola ni robar con un XSS.
//
// Para demostrar quién eres se firma un reto que manda el servidor y se recibe a
// cambio un TICKET de una hora, que es lo que viaja luego en create_room /
// join_room. La identidad es DE ESTE DISPOSITIVO a propósito: si cambias de
// navegador, empiezas de cero (decisión tomada al diseñar el ladder).
//
// TODO falla en silencio: sin IndexedDB, sin WebCrypto o sin ladder desplegado,
// `pid`/`ticket` se quedan vacíos y se juega exactamente igual, solo que esa
// partida no puntúa. Un ladder caído jamás puede impedir jugar.
import type { RankBadge } from '@td/shared';

const DB_NAME = 'td-ladder';
const STORE = 'identity';
const KEY = 'me';
// Los tickets duran una hora en el servidor; se renuevan bastante antes para que
// una partida larga no se quede con uno caducado a mitad.
const REFRESH_MS = 30 * 60_000;

interface Guardado {
  pid: string;
  priv: CryptoKey;
  pub: JsonWebKey;
}

let pid = '';
let ticket = '';
let badge: (RankBadge & { label: string }) | null = null;
let rating = 0;

export const ladderPid = (): string => pid;
export const ladderTicket = (): string => ticket;
export const ladderBadge = (): (RankBadge & { label: string }) | null => badge;
export const ladderRating = (): number => rating;

// Los mensajes de entrada a sala llevan la identidad SOLO si está lista. Se
// devuelve un objeto para poder esparcirlo (`...ladderFields()`) sin ensuciar el
// mensaje con campos vacíos cuando no hay ladder.
export function ladderFields(): { pid?: string; ticket?: string } {
  return pid && ticket ? { pid, ticket } : {};
}

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function leer(db: IDBDatabase): Promise<Guardado | undefined> {
  return new Promise((res, rej) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => res(req.result as Guardado | undefined);
    req.onerror = () => rej(req.error);
  });
}

function escribir(db: IDBDatabase, valor: Guardado): Promise<void> {
  return new Promise((res, rej) => {
    // El CryptoKey se guarda TAL CUAL: IndexedDB lo clona con structured clone y
    // conserva su carácter no exportable. No hay que (ni se puede) serializarlo.
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(valor, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

const b64u = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

// Da de alta una identidad nueva: genera el par, manda la PÚBLICA y guarda la
// privada. Solo ocurre la primera vez en este navegador.
async function crear(db: IDBDatabase): Promise<Guardado | null> {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const pub = (await crypto.subtle.exportKey('jwk', par.publicKey)) as JsonWebKey;
  const res = await fetch('/api/ladder/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: pub }),
  });
  if (!res.ok) return null;
  const { pid: nuevo } = (await res.json()) as { pid: string };
  const guardado: Guardado = { pid: nuevo, priv: par.privateKey, pub };
  await escribir(db, guardado);
  return guardado;
}

// Reto → firma → ticket. Es la única operación cara (una firma ECDSA) y se hace
// una vez por sesión, no en cada partida.
async function pedirTicket(id: Guardado, nombre: string): Promise<boolean> {
  const ch = await fetch(`/api/ladder/challenge?pid=${encodeURIComponent(id.pid)}`);
  if (!ch.ok) return false;
  const { nonce } = (await ch.json()) as { nonce: string };
  const firma = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    id.priv,
    new TextEncoder().encode(nonce),
  );
  const res = await fetch('/api/ladder/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid: id.pid, nonce, signature: b64u(firma), name: nombre }),
  });
  if (!res.ok) return false;
  const out = (await res.json()) as { ticket: string; rating: number; badge: RankBadge & { label: string } };
  pid = id.pid;
  ticket = out.ticket;
  rating = out.rating;
  badge = out.badge;
  return true;
}

// Arranque: recupera (o crea) la identidad y consigue un ticket. Se llama sin
// await desde main: nadie espera a esto para poder jugar.
export async function initIdentity(nombre: string): Promise<void> {
  try {
    if (!('indexedDB' in globalThis) || !crypto?.subtle) return;
    const db = await idb();
    const id = (await leer(db)) ?? (await crear(db));
    if (!id) return;
    await pedirTicket(id, nombre);
    // renovación en segundo plano: un ticket caducado a mitad de partida haría
    // que esa arena no puntuara para este jugador, y sin aviso ninguno.
    setInterval(() => {
      void (async () => {
        try {
          const actual = await leer(db);
          if (actual) await pedirTicket(actual, nombre);
        } catch {
          /* se reintenta al siguiente ciclo */
        }
      })();
    }, REFRESH_MS);
  } catch (err) {
    console.warn('[ladder] identidad no disponible; se juega sin rango', err);
  }
}

// Refresca la medalla propia (tras una partida puntuada, para que el lobby y la
// portada enseñen el rango nuevo sin recargar).
export async function refreshBadge(): Promise<void> {
  if (!pid) return;
  try {
    const res = await fetch(`/api/ladder/me?pid=${encodeURIComponent(pid)}`);
    if (!res.ok) return;
    const out = (await res.json()) as { rating: number; badge: RankBadge & { label: string } };
    rating = out.rating;
    badge = out.badge;
  } catch {
    /* da igual: se verá en el siguiente arranque */
  }
}
