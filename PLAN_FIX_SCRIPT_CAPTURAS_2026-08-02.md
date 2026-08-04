# PLAN — Fix script de capturas (`scripts/capture-all-routes.ts`)

Fecha: 2026-08-02 · Rama: `fix/capture-script-resilience`

## Contexto

El script de auditoría visual (`npm run ss`) se ejecutó dos veces en esta sesión:

1. **Corrida completa** (`npm run ss`, desktop 1920×1080 + mobile 390×844, 173 rutas declaradas, 358 resultados).
2. **Corrida de verificación** (`npm run ss soporte desktop`, 1 viewport, 1 servidor).

El entorno de ejecución ya estaba preparado: `CAPTURE_DATABASE_URL=postgres:///bodega_capture` y `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true` en `.env.local`, BD `bodega_capture` existente, Postgres local respondiendo.

## Evidencia de la corrida completa (2026-08-03T03:10Z)

| Métrica | Valor |
|---|---|
| Rutas declaradas | 173 |
| Resultados totales | 358 (346 `view` + 12 `modal`) |
| `capture-ok` | 36 |
| `expected-redirect` | 14 |
| `expected-404` | 4 |
| **`capture-invalid` (HTTP 500)** | **304** |
| `clientErrors` | 22 |
| `orphanFiles` | **777** |
| `missingFiles` / `duplicateReferences` / `duplicateHashes` | 0 |
| Salida del proceso | exit code 0 (las fallas sólo se reportan en el manifest) |

### Síntoma dominante

**Todas las rutas autenticadas devolvieron HTTP 500.** Sólo las públicas funcionaron (`login`, `registro`, `recuperar`, `ppa`, `tae`, `root` → redirect). En el navegador se registraron:

```
Refused to execute script from 'http://127.0.0.1:312X/_next/static/chunks/...'
  because its MIME type ('text/plain') is not executable, and strict MIME type checking is enabled.
ChunkLoadError: Failed to load chunk /_next/static/chunks/... from module 964893
```

El manifest quedó en `audit/screenshots/2026-08-03-playwright/manifest.json` (verificado con `node`).

### Verificación de control: corrida de 1 viewport / 1 servidor

`npm run ss soporte desktop` (1 servidor, 1 viewport) terminó **completamente limpia**:

```
Sin errores de cliente en ninguna ruta ✓
Sin scroll horizontal en ninguna ruta ✓
Integridad de capturas: sin URL inválida, huérfano, referencia o hash duplicado ✓
```

## Causas raíz

### C1 — Dos `next dev` paralelos comparten el mismo `.next` (500s + ChunkLoadError)

En `main()` (líneas 758–765), cuando hay 2 viewports se lanzan **dos servidores** en puertos `3127`/`3128` con `Promise.all`. `startServer()` (línea 3706) decide el comando así (líneas 3731–3746):

```ts
const hasProductionBuild = fs.existsSync(path.join(root, ".next", "BUILD_ID"))   // 3731
const useStandalone = fs.existsSync(standaloneServer)                            // 3732
...
: hasProductionBuild
  ? ["start", "--hostname", "127.0.0.1", "--port", String(port)]                // 3745
  : ["dev",  "--hostname", "127.0.0.1", "--port", String(serverPort)]           // 3746
```

**Como no existe build de producción** (`no BUILD_ID`, `no standalone`), ambos servidores caen en la rama `next dev`. Dos procesos Turbopack escribiendo y leyendo el **mismo** `.next` se pisan entre sí: los chunks terminan servidos como `text/plain`, el navegador los rechaza, la hidratación/ejecución del cliente falla (`ChunkLoadError`) y las páginas autenticadas (AppShell + datos) revientan en 500. La prueba de control lo confirma: **1 servidor = todo verde**.

### C2 — Bug de puerto en la rama `next start` (latente, estalla al existir build)

En la rama `hasProductionBuild` (línea 3745) se usa `String(port)` (base, 3127) en vez de `String(serverPort)` (3127/3128). La rama `next dev` sí usa `serverPort`. Consecuencia: apenas exista un build de producción, el **segundo** servidor intentaría ligarse al mismo puerto 3127 y la corrida fallaría. Es un bug latente que hoy queda oculto porque corremos en dev.

### C3 — El directorio con fecha no se limpia en corridas completas (777 huérfanos)

La limpieza del output sólo ocurre cuando hay `moduleFilter` (líneas 737–741). En corridas completas el directorio es `audit/screenshots/{fecha}-playwright/` y **nunca se limpia**: una corrida anterior del mismo día (22:13, con captures interactivas `--full` que producen `*-dropdown-*`, `*-select-*`, `*-modal-auto-*`) dejó PNGs en `2026-08-03-playwright/` que la corrida de las 23:10 no referencia → `reconcileCaptureArtifacts` los marca como huérfanos → gate de integridad en rojo (777 orphans, verificado: 299 archivos con timestamp `22:2x` en ese directorio).

## Plan de implementación

### Fase 1 — Garantizar un build de producción antes de correr servidores paralelos (C1)

Objetivo: que los viewports paralelos sirvan desde un build estático, no desde dos `next dev` que pelean por `.next`.

1. En `main()`, antes de `Promise.all(... startServer ...)`, agregar un paso `ensureProductionBuild(captureDbUrl)` que:
   - Si `hasProductionBuild` (existe `.next/BUILD_ID`) y hay standalone, no hace nada (fast path).
   - Si no hay build: ejecutar `next build` (spawn `node_modules/.bin/next build`) con el entorno de captura (`DATABASE_URL=captureDbUrl`, `AUTH_SECRET`, etc.), con spinner, y fallar con mensaje claro si el build falla.
   - Alternativa mínima aceptable: **serializar los viewports** cuando no hay build (1 servidor, 2 contexts consecutivos) y paralelizar sólo cuando hay build. Decidir con el usuario si prefiere build-on-demand (más rápido de usar, ~1–2 min de build) vs. serialización (sin build, ~2× tiempo de captura).
2. Actualizar el header de documentación del script y `.env.example` si se agrega una variable (p. ej. `CAPTURE_SKIP_BUILD=true` para fuerzas de dev).

### Fase 2 — Corregir el puerto en la rama `next start` (C2)

1. Línea 3745: cambiar `String(port)` → `String(serverPort)`.
2. Agregar un test unitario que cubra la decisión de comando/args de `startServer` (extraer la lógica de selección de comando a una función exportable pura, p. ej. `resolveServerCommand({ useStandalone, hasProductionBuild, serverPort, port })`), o al menos un assertion de que ambos puertos distintos se propagan a `--port`.

### Fase 3 — Limpiar el directorio de salida también en corridas completas (C3)

1. Extraer la limpieza actual (líneas 737–741) a una función `cleanOutputDir(dir, { onlyPngAndManifest: true })`.
2. Invocarla **siempre** que el directorio exista (con o sin `moduleFilter`), antes de `mkdirSync`. Documentar en el header del script que la corrida completa ahora sobrescribe su carpeta con fecha (semántica "nueva cada vez", que ya declara el header).
3. Alternativa a evaluar (mencionar como decisión): incluir `hora` en el nombre de la carpeta (`{fecha}-{HHmm}-playwright`) para conservar corridas del mismo día sin borrar. Si se adopta, el test de inventario y el README del módulo se actualizan.

### Fase 4 — Robustez de la integridad (evita falsos positivos del gate)

1. Que `reconcileCaptureArtifacts` distinga **huérfanos de corridas previas** de archivos del run actual: registrar en el manifest el `runId`/timestamp y, en la reconciliación, ignorar (o marcar como `stale`) archivos con timestamp anterior al inicio del run. Con Fase 3 esto es redundante, pero protege contra directorios heredados.
2. Mantener el gate duro (`process.exitCode = 1`) — no aflojarlo.

### Fase 5 — Verificación y cierre

1. `npx vitest run scripts/capture-all-routes.test.ts` (8 pruebas existentes + nuevas de Fase 2/4) en verde.
2. `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts` sin warnings.
3. `npm run typecheck` limpio.
4. **Corrida completa**: `npm run ss` → expectativa: 0 invalid, 0 orphans, 0 clientErrors, sin scroll horizontal, exit 0 y mensajes `✓` en las tres secciones finales.
5. **Regresión de verificación**: `npm run ss soporte desktop` sigue en verde.
6. Comparar counts del manifest vs. corrida base (173 rutas, 358 resultados) y verificar que las capturas autenticadas existen y no son vacías.

## Criterios de aceptación

- [x] Corrida completa con 0 `capture-invalid` (o únicamente las `expected-redirect`/`expected-404` declaradas).
- [x] `clientErrors` vacío en el manifest.
- [x] `artifactReconciliation` sin invalidResults, sin orphanFiles (o cero), sin missing/duplicate.
- [x] El gate de integridad no setea `exitCode = 1`.
- [x] `scripts/capture-all-routes.test.ts` + typecheck + eslint verdes.

## Estado: IMPLEMENTADO (2026-08-03)

### Cambios aplicados

- **Fase 1 (C1)** — Build on-demand: nueva `ensureProductionBuild(captureDbUrl)` que corre `next build` antes de los servidores paralelos (fast path si `.next/BUILD_ID` + standalone ya existen). Se invoca en `main()` sólo cuando `needsParallel` (más de un viewport). Añade: detección de staleness del build (si `source` cambia, se regenera), timeout `CAPTURE_BUILD_TIMEOUT_MS` (15 min, mata el proceso y falla con mensaje claro) y `CAPTURE_SKIP_BUILD=true`/`CAPTURE_FORCE_BUILD=true` para fuerzas de dev.
- **Fase 2 (C2)** — Puerto corregido: `resolveServerLaunch({ useStandalone, hasProductionBuild, standaloneServer, nextBin, nodeExecPath, serverPort })` extraído como función pura exportada; la rama `next start` usa `String(serverPort)` (antes `String(port)`).
- **Fase 3 (C3)** — `cleanOutputDir()` extraída y ahora se invoca **siempre** (con y sin `moduleFilter`), antes del `mkdirSync`. La corrida completa sobrescribe su carpeta con fecha (semántica declarada en el header).
- **Fase 4** — `reconcileCaptureArtifacts` ahora recibe `runStartedAt` (capturado al inicio del run) y clasifica PNGs anteriores a ese instante como `staleFiles` (reportados aparte, no cuentan como huérfanos del run).
- **Review (code-reviewer-deepseek-flash)** — 3 mejoras incorporadas: staleness del build, helper compartido `buildCaptureEnv(captureDbUrl, serverBaseUrl?)` (evita divergencia de env entre build y servers, tipado `NodeJS.Dict<string>` con cast a `ProcessEnv` en los dos `spawn`) y timeout de build.
- **Docs** — Header del script, `.env.example` y `doc.env` actualizados con `CAPTURE_SKIP_BUILD`/`CAPTURE_FORCE_BUILD`/`CAPTURE_BUILD_TIMEOUT_MS`.
- **Tests** — 13/13 en verde (5 nuevas: `resolveServerLaunch` con standalone+dev+start, `buildCaptureEnv`, y reconciliación de stale files).

### Verificación final

| Paso | Resultado |
|---|---|
| `npx vitest run scripts/capture-all-routes.test.ts` | 13/13 ✓ |
| `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts` | sin warnings ✓ |
| `npm run typecheck` | limpio ✓ |
| Corrida completa `npm run ss` | 686 resultados: `capture-ok` 642, `expected-redirect` 40, `expected-404` 4 · **invalid 0 · orphan 0 · stale 0 · clientErrors 0** · sin scroll horizontal · build on-demand ejecutado ✓ |
| Regresión `npm run ss soporte desktop` | integrity limpia ✓ |

Nota: en el seed aparece el NOTICE benigno `42622 identifier ...fk will be truncated` (Postgres trunca identificadores >63 chars); es esperado y no afecta el gate.

## Notas operativas

- La salida `identifier "...fk" will be truncated` durante migraciones es un NOTICE benigno de Postgres (índice de identificadores largos), no un error.
- El seed de capturas inserta datos 2026-06-09 de propósito (fecha congelada para comparabilidad entre auditorías).
- `authSecret` hardcodeado (`"route-screenshot-audit-secret"`) ya está documentado en `AUDITORIA_HARDCODEADOS.md` (ítem 25); queda fuera de alcance salvo pedido explícito.
