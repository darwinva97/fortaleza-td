// Captcha de Cloudflare (Turnstile) para crear salas.
//
// Se pide el token SOLO al pulsar «Crear sala», no al cargar la página: así la
// portada no arrastra un script de terceros para quien solo viene a mirar salas
// públicas o el ranking.
//
// El widget se monta en modo `interaction-only`: la mayoría de las veces no se
// ve nada y resuelve solo; únicamente aparece un reto si Cloudflare sospecha.

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let sitekey: string | null = null;
let widgetId: string | null = null;
let cargando: Promise<void> | null = null;
let pendiente: { ok: (t: string | null) => void } | null = null;

async function leerSitekey(): Promise<string | null> {
  if (sitekey !== null) return sitekey || null;
  try {
    const res = await fetch('/api/turnstile');
    sitekey = ((await res.json()) as { sitekey?: string }).sitekey ?? '';
  } catch {
    sitekey = '';
  }
  return sitekey || null;
}

function cargarScript(): Promise<void> {
  if (cargando) return cargando;
  cargando = new Promise((resolver, rechazar) => {
    if (window.turnstile) return resolver();
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => rechazar(new Error('no se pudo cargar Turnstile'));
    document.head.appendChild(s);
  });
  return cargando;
}

/**
 * Devuelve un token de un solo uso, o null si el captcha está apagado o falla.
 *
 * Null significa «sigue adelante»: el servidor decide. Si hay secreto
 * configurado rechazará la creación; si no lo hay, la dejará pasar. Nunca se
 * bloquea al jugador aquí por un fallo de red con un tercero.
 */
export async function tokenParaCrearSala(): Promise<string | null> {
  const key = await leerSitekey();
  if (!key) return null;

  try {
    await cargarScript();
  } catch {
    return null;
  }
  const api = window.turnstile;
  if (!api) return null;

  let caja = document.getElementById('turnstile-caja');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'turnstile-caja';
    document.body.appendChild(caja);
  }

  if (widgetId === null) {
    widgetId = api.render(caja, {
      sitekey: key,
      execution: 'execute',
      appearance: 'interaction-only',
      callback: (t: string) => {
        pendiente?.ok(t);
        pendiente = null;
      },
      'error-callback': () => {
        pendiente?.ok(null);
        pendiente = null;
      },
      'timeout-callback': () => {
        pendiente?.ok(null);
        pendiente = null;
      },
    });
  } else {
    api.reset(widgetId);
  }

  return new Promise<string | null>((resolver) => {
    pendiente = { ok: resolver };
    // Red a la deriva o reto que nadie resuelve: no dejar el botón colgado.
    setTimeout(() => {
      if (pendiente) {
        pendiente.ok(null);
        pendiente = null;
      }
    }, 30_000);
    api.execute(widgetId!);
  });
}
