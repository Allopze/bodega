# Actualización de Next y dependencias con avisos — 2026-11-17

Rama `chore/actualizar-next-dependencias` (worktree `bodega-wt/actualizar-deps`, con `node_modules`
propio instalado con `npm ci`), sobre `main` 8725e74a9.

## Por qué

- Con Next 16.4.2, `next build` abortaba con `SecurityFatalError`: el CLI de Next se niega a compilar
  una versión con vulnerabilidades conocidas. Bloqueaba `npm run test:e2e` y, por la misma razón,
  el build del CI y del deploy.
- `npm run check:security-audit` estaba en rojo con 15 hallazgos altos fuera del allowlist.

## Qué cambió

| Paquete | Antes | Ahora | Avisos que corrige |
|---|---|---|---|
| `next`, `@next/env`, `eslint-config-next` | 16.4.2 | 16.4.6 | GHSA-mfr8-8qww-v76h y GHSA-vc7v-qv4w-wrv8 (moderados, cachés de `'use cache'`, que la app no usa) |
| `vitest`, `@vitest/coverage-v8` | 4.1.11 | 4.1.12 | GHSA-qxg6-89mg-rqv8 y GHSA-xp26-3454-mjgp (`@vitest/mocker`) |
| `@sentry/nextjs` y familia | 11.2.0 | 11.14.0 | GHSA-3g3m-2fjr-6pw4 (`glob`) y GHSA-g3hv-75wg-m249 (`minimatch`) de sus herramientas de build |
| `typescript-eslint` y familia | 8.60.1 | 8.73.0 | GHSA-g3hv-75wg-m249 (`minimatch`) |
| `fast-xml-parser` | 5.10.1 | 5.12.1 | GHSA-474x-hrwr-fgx4 (bajo) |
| `vite` | 6.4.5 | 6.4.6 | Parche dentro del override `^6.4.5` |

En `package.json` sólo cambian los rangos de Next y de vitest. El resto se mueve en el lockfile, dentro
de los rangos que ya estaban declarados (`npm audit fix`, sin versiones mayores). React queda en
19.2.4: cumple lo que pide Next 16.4.6 y no tiene avisos.

## Lo que queda: GHSA-fc5q-39xc-vjpf (picomatch)

`picomatch` ≤ 4.0.7 tiene un ReDoS con extglobs repetidos de una sola rama (alto, CVSS 7.5). **No existe
versión corregida**: 4.0.7 es la última publicada (agosto de 2026) y el aviso la incluye. Los 22
hallazgos altos que quedan en `npm audit` son este mismo aviso arrastrado por la cadena (`vite`,
`vitest`, `typescript-eslint`, `eslint-config-next`, `@sentry/nextjs`…).

- El ReDoS exige que el atacante controle el patrón glob. Aquí los patrones salen de la configuración
  del repo: lint, pruebas y el build de Sentry. El código de la app no importa `picomatch`,
  `micromatch`, `minimatch` ni `glob`.
- En el árbol de producción (`npm ls --omit=dev`), `picomatch` entra sólo por `@sentry/nextjs`: por
  `@rollup/plugin-commonjs` (el loader de webpack con el que Sentry envuelve las rutas al compilar) y,
  desde Sentry 11.14, por `@sentry/cloudflare → vite`.
- El `.next/standalone` que corre la imagen de producción **no** incluye esa copia. Sí incluye
  `next/dist/compiled/picomatch`, una copia que Next trae compilada y que sólo usa su código de build
  (trazas, configuración del middleware). `npm audit` no la ve.

Agregar una excepción al allowlist de `scripts/check-security-audit.ts` (con fecha de revisión y una
verificación de que en producción sólo entra por `@sentry/nextjs`) quedó **pendiente de decisión del
usuario**: el clasificador de permisos lo bloqueó, con razón, porque dejar pasar un aviso alto no es
una decisión del agente. Hasta entonces la puerta sigue en rojo.

## Verificación

| Puerta | Resultado |
|---|---|
| `next build` (Next 16.4.6) | Compila en 3,2 min, sin el aviso de vulnerabilidad |
| `npm run check:bundle-budget` | OK: 306 rutas, peor caso 2,65 MB de 3,00 MB |
| `npm run check:secrets` | OK |
| `npm run check:security-audit` | **Rojo**: sólo GHSA-fc5q-39xc-vjpf (22 hallazgos, el mismo aviso) |
| `npm run typecheck` | OK |
| `npm run lint` (completo) | OK |
| `npm run test:fast` | 1378 archivos, 20 609 pruebas, en verde |
| `npm run test:env-dsn` | 1378 archivos, 20 609 pruebas, en verde |
| `npm run test:pglite` | 385 de 386 archivos; 1 fallo **previo** (abajo) |
| `npm run db:verify-migrations` | OK, 391 entradas |
| Hooks de husky al hacer commit | OK (secretos, alias de Drizzle, lint) |

Fallo previo, ajeno a esta rama: `lib/combustibles/control/queries/queries.test.ts` › «litros por mes
y medio, con «sin medio» como medio nulo» espera «Tarjeta Copec de abastecimiento» y recibe «Vasija
(carga Copec)». Falla igual en `main` 8725e74a9, con las dependencias de antes. Viene del rótulo nuevo de
`7728cdc8f` (ver E2E).

## E2E

`E2E_SKIP_BUILD=true npm run test:e2e` sobre la build de producción de Next 16.4.6 (servidor standalone
en :3100, base E2E de :55432), proyecto `chromium`: **1166 pasan, 1 falla y 5 se omiten por configuración,
en 48,9 min.**

El único fallo es `e2e/tae-public-flow.spec.ts:71` («activa QR, envía online y sincroniza una segunda carga
offline»). El formulario en terreno se queda en el paso 1 con «Elige con qué medio se cargó el combustible»,
porque no preseleccionó el medio. `suggestSupplyMedium` (`lib/combustibles/field-load-media.ts`) busca el
nombre del medio dentro del nombre del punto de carga («Surtidor TAE E2E»). El commit `7728cdc8f`
(2026-11-16, ya en `main`) renombró el medio TAE a «Vasija (carga Copec)» (`lib/combustibles/source-labels.ts`),
así que ya no hay coincidencia. Es la misma causa del fallo PGlite previo. **No viene de esta actualización**,
y es probable que también sea un defecto real: en terreno, la vasija ya no queda preseleccionada en los puntos
de carga que llevan «TAE» en el nombre.

## Riesgos y pendientes

- **Al fusionar** hay que correr `npm ci` en el checkout principal: los worktrees enlazan su
  `node_modules`, así que cambia Next para todas las sesiones a la vez.
- Este equipo corre Node 24 y el proyecto declara `>=22.13.0 <23` (aviso `EBADENGINE`). La imagen y el
  CI usan Node 22. No cambia con esta actualización.
- Hay 3 copias anidadas de `esbuild` 0.25.12 cuyo `postinstall` npm 12 bloquea porque `allowScripts`
  sólo aprueba la 0.28.1. Pasa igual en `main`.
- Las suites contra Postgres real del CI (concurrencia, alcance por faena, rendimiento de consultas)
  no se corrieron localmente.
