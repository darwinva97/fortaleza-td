# 🏰 Fortaleza — Tower Defense Cooperativo

Tower defense multijugador en tiempo real para jugar en familia. Servidor autoritativo,
render en Canvas (cero React en el juego), salas con código de 4 letras, chat,
reconexión automática y estadísticas de fin de partida.

## Cómo funciona (arquitectura)

- **`packages/shared`** — el corazón: tipos, protocolo, balance (torres/enemigos/oleadas/mapas)
  y la **simulación completa**. Es TypeScript puro sin I/O: recibe estado + comandos y avanza un tick.
- **`apps/server`** — Node + `ws`. Corre la simulación autoritativa a **15 ticks/s** por sala,
  valida cada comando (nadie puede hacer trampa desde el cliente) y difunde snapshots compactos.
  Ideal para un VPS.
- **`apps/worker`** — el mismo juego para **Cloudflare Workers + Durable Objects**: cada sala es
  un Durable Object que reutiliza *exactamente* la simulación de `packages/shared`. El Worker sirve
  el cliente estático y enruta cada WebSocket a la sala por su código. Sin servidor que administrar.
- **`apps/client`** — Vite + TypeScript vanilla. El juego se dibuja en un `<canvas>` interpolando
  entre snapshots (el HUD es DOM normal). Partículas, audio procedural WebAudio y soporte táctil.

El cliente **nunca** envía estado, solo intenciones (`colocar torre en (x,y)`). Por eso no puede
pasar lo del juego anterior: aunque haya 300 monstruos, el cliente solo pinta un canvas y el
servidor solo manda ~15 mensajes/s. El cliente es agnóstico del backend: crea la sala conectándose
a `/ws?create=1` (el backend asigna un código libre) y se une con `/ws?code=XXXX`.

## Contenido

- **8 torres** con 3 niveles y **2 especializaciones al máximo nivel** (16 ramas): p. ej. el Arquero
  se vuelve *Ballesta Repetidora* (triple disparo) o *Arco Largo*; el Hielo, *Glaciar* o *Escarcha
  Eterna* (aura que ralentiza sin disparar); el Francotirador, *Cañón de Riel* (remata malheridos);
  la Mina, *Tesorería* o *Casa de Moneda* (reparte oro a todo el equipo). Las especializaciones se
  ven claramente más poderosas (corona, brillo y efectos propios).
- **12 enemigos**: goblins, corredores, brutos, murciélagos (¡voladores!), blindados, chamanes
  que curan, larvas en enjambre, troles que regeneran, babosos que se dividen, espectros que
  esquivan y el **Gólem Ancestral** (jefe cada 10 oleadas).
- **Enemigos élite con afijos** (desde la oleada 4): más vida y recompensa, con 1-2 modificadores
  visibles — veloz, coraza, regenerador, vampírico (cura a los cercanos), escurridizo, gélido
  (resiste el hielo) y explosivo (suelta crías al morir). Cada oleada se juega distinta.
- **7 mapas** en 5 temas (bosque, desierto, nieve, volcán y cueva de cristal): El Sendero,
  Las Tenazas (¡dos caminos!), La Espiral, La Encrucijada (24×14, rutas que se cruzan),
  El Volcán (26×15), El Gran Laberinto (28×16, gigante) y El Delta (¡tres entradas!).
- Modos **Clásico** (20 oleadas) e **Infinito** (con tabla de récords), 3 dificultades,
  y **velocidad x1/x2/x3** controlada por el anfitrión.
- Co-op de hasta 8: vidas compartidas, oro individual, bonus por llamar la oleada antes,
  pausa del anfitrión, chat y pantalla final con podio y MVP. Con la partida en curso
  nadie nuevo puede entrar (la reconexión de los que ya jugaban sí funciona).
- **Gráficos vectoriales procedurales** en canvas: torres con torretas que rotan y retroceden,
  12 enemigos animados, partículas ambientales por tema (nieve, brasas…), estelas y screen shake.
- **Pensado para el celular**: cámara con zoom (pellizco/rueda) y paneo (arrastrar), doble toque
  para reencuadrar, colocación de torres en dos toques con confirmación, HUD adaptativo.
- **Ping cooperativo**: mantén pulsado el mapa (o usa el botón 📍) para marcar un punto a tu equipo,
  con el color de cada jugador — para coordinar sin escribir.

## Desarrollo

```bash
pnpm install
pnpm dev          # servidor en :3000 + Vite en :5173 (abre http://localhost:5173)
```

## Pruebas

```bash
pnpm check        # typecheck de los 4 paquetes (shared, server, client, worker)
pnpm simtest      # simula una partida completa con bots + verifica determinismo
pnpm build && pnpm start &
pnpm wstest       # test end-to-end real: 2 clientes WS, sala, torre, oleada, reconexión
# el wstest sirve para ambos backends:
#   Node:  pnpm build && pnpm start &  ;  pnpm wstest
#   Worker: pnpm cf:dev &  ;  PORT=8787 pnpm wstest
```

## Producción (Node)

```bash
pnpm build        # cliente → apps/client/dist, servidor → apps/server/dist/server.js
pnpm start        # todo en http://localhost:3000 (sirve el cliente y el WebSocket)
```

Variables: `PORT` (default 3000), `TD_DATA_DIR` (récords, default `./data`).

## Deploy en Cloudflare (Workers + Durable Objects)

Sin servidor que administrar; corre en el edge global. Cada sala es un Durable Object.

```bash
# una vez: iniciar sesión en Cloudflare
npx wrangler login

# probar en local (arranca el Worker con Durable Objects reales en http://localhost:8787)
pnpm cf:dev

# desplegar (compila el cliente y sube el Worker)
pnpm cf:deploy
```

La configuración está en [`apps/worker/wrangler.jsonc`](apps/worker/wrangler.jsonc). El Worker sirve el
cliente (`apps/client/dist`) como SPA y maneja `/ws` y `/api/*`.

**Récords (opcional).** El leaderboard usa KV; si no lo configuras, el juego funciona igual pero sin
tabla de récords. Para activarlo:

```bash
npx wrangler kv namespace create SCORES   # copia el id que imprime
```

y descomenta el bloque `kv_namespaces` en `wrangler.jsonc` pegando ese id.

**Notas / límites.** Mientras hay jugadores conectados a una sala, su Durable Object se mantiene en
memoria (se factura por tiempo activo, no por hibernación); para partidas en familia es baratísimo.
Si **todos** los jugadores se desconectan a la vez, la sala se libera (como si el servidor se
reiniciara) — mientras quede al menos uno conectado, la reconexión de los demás funciona.

## Deploy en Hetzner (Ubuntu/Debian)

```bash
# en el VPS (una vez): Node 22+ y pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
corepack enable

# subir el proyecto (o git clone) y compilar
cd /opt && sudo git clone <tu-repo> fortaleza-td && cd fortaleza-td
pnpm install && pnpm build
```

**systemd** — `/etc/systemd/system/fortaleza.service`:

```ini
[Unit]
Description=Fortaleza TD
After=network.target

[Service]
WorkingDirectory=/opt/fortaleza-td
ExecStart=/usr/bin/node apps/server/dist/server.js
Environment=PORT=3000
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now fortaleza
```

**Caddy** (TLS automático + WebSocket sin config extra) — `/etc/caddy/Caddyfile`:

```
fortaleza.tudominio.com {
    reverse_proxy localhost:3000
}
```

Con Nginx: recuerda `proxy_set_header Upgrade $http_upgrade;` y `Connection "upgrade";` en `/ws`.

## Balancear el juego

Todo el balance vive en `packages/shared/src/balance/` (torres, enemigos, oleadas, mapas).
Cambiar números ahí no toca ninguna lógica. Después de tocar balance: `pnpm simtest` te dice
si el juego sigue siendo ganable con bots tontos.

## Añadir un mapa

Agrega una entrada en `packages/shared/src/balance/maps.ts`: grilla, waypoints del camino
(segmentos horizontales/verticales entre esquinas) y celdas decorativas. Aparece solo en los
selectores.
