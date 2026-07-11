// Guardar / cargar partida (issue #12) en el cliente.
//
// GUARDAR: el cliente NO tiene la semilla ni el registro de comandos (los graba el
// servidor, que también conoce los tokens de los demás). Así que pide al servidor
// construir el guardado con `save_request` (mandando una sal aleatoria para hashear
// los tokens server-side) y, al recibir `save_info`, descarga el .json. El archivo
// es COMPARTIBLE: nunca lleva tokens en claro, solo sha256(token + sal).
//
// CARGAR: valida el archivo localmente (mismo validador que el servidor), crea la
// sala desde el guardado (POST /api/rooms/from-save) y se une por WS al código
// devuelto, entrando al lobby de reanudación.

import { validateSaveData, type SaveData } from '@td/shared';
import { net, wsPathJoin } from './net.js';
import { homeError } from './screens.js';
import { roomPrevToken, store } from './store.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// sal aleatoria en hex (16 bytes) para el hash de tokens del guardado (no secreta).
function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// Pide al servidor construir el guardado. Solo jugadores: el espectador no tiene
// identidad en la partida (y el botón se le oculta); el servidor lo verifica igual.
export function requestSaveGame(): void {
  if (store.spectator) return;
  net.send({ type: 'save_request', salt: randomSalt() });
}

// Descarga el guardado como .json con un nombre legible.
export function downloadSave(save: SaveData): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const code = store.roomCode || 'partida';
  a.download = `fortaleza-guardado-${code}-oleada${save.wave}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Carga un archivo de guardado: valida localmente, crea la sala desde el guardado
// y se une por WS al código devuelto (lobby de reanudación).
async function loadSaveFile(file: File): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    homeError('No se pudo leer el archivo.');
    return;
  }
  const v = validateSaveData(data);
  if (!v.ok) {
    homeError(v.msg);
    return;
  }
  if (!store.name) {
    homeError('Ponte un nombre primero 🙂');
    $<HTMLInputElement>('home-name').focus();
    return;
  }
  homeError('');
  let code: string;
  try {
    const res = await fetch('/api/rooms/from-save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(v.save),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      homeError(err.error ?? 'No se pudo continuar la partida (el servidor no lo soporta).');
      return;
    }
    code = ((await res.json()) as { code: string }).code;
  } catch {
    homeError('No se pudo contactar al servidor.');
    return;
  }
  net.connect(wsPathJoin(code), {
    type: 'join_room',
    name: store.name,
    token: store.token,
    code,
    prevToken: roomPrevToken(code),
  });
}

let wired = false;

export function initLoadSaveHome(): void {
  if (wired) return;
  wired = true;
  const fileInput = $<HTMLInputElement>('save-file');
  $('btn-load-save').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // permitir recargar el mismo archivo
    if (file) void loadSaveFile(file);
  });
}
