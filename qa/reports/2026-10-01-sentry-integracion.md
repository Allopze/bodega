# Integración de Sentry — verificación (2026-10-01)

Proyecto Sentry: `plataforma-chome-produccion` (id `4511758501609552`).
Alcance: reintegración de Sentry retirada el 2026-09-15 (`3e731f42c`), sólo runtime
(sin `withSentryConfig`) y sólo errores (sin tracing ni Session Replay).

## Qué se verificó y cómo

### PASS — build de producción con el tope de heap de CI (4 GB)

Worktree aislado de `HEAD` + sólo este cambio, `next build --webpack`,
`BODEGA_BUILD_SKIP_TYPECHECK=1`, heap 4096 MiB (resource-guard):

| Build | Resultado |
|---|---|
| `HEAD` sin cambios, caché fría | ✓ compilado en 87 s |
| `HEAD` sin cambios, caché caliente | ✓ 64 s |
| `HEAD` + Sentry | ✓ 56–71 s (4 corridas) |

### PASS — el SDK no entra al first-load JS

El SDK de navegador quedó en chunks diferidos de ~90 KB sin comprimir que sólo se
descargan si el build trae `NEXT_PUBLIC_SENTRY_DSN`. En `main`/`main-app` aparece sólo el
string del DSN (es público). En servidor `@sentry/nextjs` queda externo
(`require("@sentry/nextjs")` en `instrumentation.js`) y el trazado standalone lo copia.

### PASS — eventos reales contra un ingest falso local

Server standalone del build anterior en `127.0.0.1:3105`, con DSN apuntando a un
servidor HTTP local que guardaba los sobres. Rutas de prueba temporales, sólo en el
worktree: un Server Component que lanza y una página cliente que lanza al hacer clic.
Los mensajes llevaban RUT, correo y `password=`, y la URL `?rut=…&token=…`. La
petición de servidor llevaba también una cookie de sesión falsa.

| Camino | SDK | Resultado |
|---|---|---|
| Servidor (`onRequestError`) | `sentry.javascript.nextjs/11.2.0` | 1 evento (sin duplicado por el sink del logger), mensaje `trabajador [rut] [email] password=[redacted]`, URL sin query, sólo `user-agent` entre las cabeceras, tag `digest`, sin variables locales en frames |
| Navegador (`global-error.tsx`) | `sentry.javascript.browser/11.2.0` | 1 evento, `mechanism: auto.react.error_boundary`, mensaje `rut [rut] [email]` |
| CSP | — | `connect-src 'self' http://127.0.0.1:9999`; el navegador envió el sobre sin bloqueos ni requests fallidos |

Búsqueda de cada valor sensible en el **sobre completo**: ninguno presente.

### PRODUCT BUG encontrado y corregido durante la verificación

Las migas de **navegación** del navegador guardan la URL en `data.from`/`data.to`, no en
`data.url`: la query (`?rut=44444444-4`) salía intacta. Corregido en
`lib/security/telemetry-scrub.ts` (`CLAVES_DE_MIGA_CON_URL`), con test de regresión, y
re-verificado contra el ingest.

### Hallazgo de la v11 del SDK

`sendDefaultPii` ya no existe. `dataCollection` recolecta todo por defecto, incluidas
las variables locales de cada frame y los datos de las queries a la base. Se fija
`RECOLECCION_MINIMA` y además `beforeSend` borra `frames[].vars`.
`enhanceFetchErrorMessages` queda en `report-only` para no reescribir mensajes en
runtime.

## Puertas deterministas

- `npm run typecheck`: 0 errores propios. Los únicos errores del árbol son del archivo
  sin trackear `scripts/apply-epp-catalog-decisions-2026-10.ts`, ajeno a este cambio.
- `eslint` sobre los archivos tocados: limpio.
- `npm run test:fast`: 820 archivos / 10 549 tests OK.
- `npm run test:env-dsn` (job `unit-env-dsn` del CI, roto desde el 15-09 porque el
  script no existía): 820 / 10 549 OK.
- `npm run check:security-audit`, `npm run check:secrets`: OK.

## Coverage gaps

- **Sentry real no verificado**: no se tiene el DSN. El primer evento de producción
  confirmará la ingesta y la cuota.
- No se ejecutó `npm run test:e2e`.
- No se construyó la imagen Docker (`--target prod`) ni se probó el `--build-arg` de
  `scripts/deploy-prod.sh` en un deploy real.
- Un build sin DSN no se recorrió en navegador. Que no descargue el SDK lo cubren los
  tests unitarios (`lib/__tests__/sentry-client.test.ts`).
- En el checkout principal (caché `.next/cache` de 2,5 GB y cambios locales sin commitear)
  el build con heap de 4 GB terminó en OOM. En el worktree limpio no. No se aisló cuál de
  las dos diferencias lo causa.

## Observación fuera de alcance

Next imprime por su cuenta en stdout el error de render **sin enmascarar**
(`⨯ Error: … 11.111.111-1 …`), además de la línea redactada de `logger`. Ya pasaba
antes de este cambio, pero significa que los logs del contenedor sí contienen esos datos.
