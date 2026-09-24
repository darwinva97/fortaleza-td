// Turnstile: el captcha de Cloudflare, para que un bot no pueda abrir salas en
// bucle. Cada sala es un Durable Object que se queda vivo hasta media hora, así
// que crearlas en masa agota la cuota diaria de la cuenta — que es justo lo que
// pasó el 2026-09-24: 246 salas en un día, la mayoría con un solo mensaje.
//
// Se verifica SOLO al crear sala. Unirse a una existente no pasa por aquí: el
// coste está en abrir objetos nuevos, no en entrar a los que ya existen.

const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface ResultadoTurnstile {
  ok: boolean;
  motivo?: string;
}

/**
 * Comprueba un token contra la API de Cloudflare.
 *
 * Los tokens son de UN SOLO USO: reenviar el mismo da `timeout-or-duplicate`.
 * Eso nos da protección contra repetición sin guardar nada por nuestra parte.
 *
 * Si no hay secreto configurado, se deja pasar: apagar la integración no puede
 * dejar el juego inservible (y en desarrollo local no hay secreto).
 */
export async function verificarTurnstile(
  token: string | null,
  secreto: string | undefined,
  ip: string | null,
): Promise<ResultadoTurnstile> {
  if (!secreto) return { ok: true };
  if (!token) return { ok: false, motivo: 'falta-token' };

  const cuerpo = new FormData();
  cuerpo.append('secret', secreto);
  cuerpo.append('response', token);
  if (ip) cuerpo.append('remoteip', ip);

  let datos: { success?: boolean; 'error-codes'?: string[] };
  try {
    const res = await fetch(VERIFY, { method: 'POST', body: cuerpo });
    datos = (await res.json()) as typeof datos;
  } catch (err) {
    // Cloudflare caído o red rara: NO bloquear a jugadores de verdad por esto.
    console.error('[turnstile] verificación no disponible', err);
    return { ok: true };
  }

  if (datos.success) return { ok: true };
  return { ok: false, motivo: (datos['error-codes'] ?? []).join(',') || 'rechazado' };
}
