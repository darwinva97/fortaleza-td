# Notas del proyecto

Este archivo vive en los DOS repos (el auto-sync del fork lo propaga): léelo
según dónde estés trabajando.

## Los dos repos

- **Padre (upstream)**: `EijunnN/fortaleza-td` — el repo canónico del juego.
- **Fork de deploy**: `darwinva97/fortaleza-td` — espejo que se auto-sincroniza
  y despliega a producción.

## Flujo de trabajo (solo si trabajas EN EL FORK)

- Todo cambio de producto hecho en el fork debe emitirse/actualizarse como PR
  al padre: https://github.com/EijunnN/fortaleza-td/pull/1 (head
  `darwinva97:main` → base `main`). Tras push a `main` del fork, actualiza
  título y descripción del PR para reflejar el cambio concreto.
- **CI/CD del fork**: `.github/workflows/deploy.yml` sincroniza el fork con el
  padre cada 15 min (merge `upstream/main`), compila el cliente y despliega el
  Worker a Cloudflare (dominio `fortaleza-td.bezenti.com`). El deploy ocurre en
  push a `main`, manual, o cuando llegó algo nuevo del padre. En el padre ese
  workflow es inerte en el cron (el self-merge nunca trae cambios) y el job de
  deploy solo funciona si existen los secrets de Cloudflare.

## Verificación

- Typecheck: `npx tsc -b packages/shared apps/server apps/client apps/worker`
  (en el padre también vale `pnpm run check`).
- Build cliente: `pnpm --filter @td/client build`; si `pnpm install` falla con
  `ERR_PNPM_IGNORED_BUILDS` (entornos con pnpm ≥ 11 sin builds aprobados), usa
  los binarios de `node_modules/.bin` y `npx` directamente.
- Test end-to-end: `pnpm wstest` con el servidor levantado
  (`pnpm --filter @td/server dev`, puerto 3000).
