# TI › Apps del teléfono — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que TI › Apps muestre las tres apps instalables (PPA Digital, Mantención y
Control TAE) con indicadores de funcionamiento y de uso alimentados por un aviso de cada
teléfono. La salud de las integraciones pasa a TI › Integraciones. Se arreglan además
la versión del build y el borrado silencioso de PPA sin enviar.

**Architecture:**
- Cada PWA manda un aviso (`POST /api/pwa/aviso`, público, con cuotas) con el estado de
  su cola local.
- El servidor guarda el último estado por teléfono (`pwa_devices`) y la presencia
  diaria (`pwa_device_days`).
- Un servicio de lectura combina eso con datos que ya existen (`mant_records`,
  `ppa_submissions`, `fuel_tae_submissions`, credenciales y enlaces).
- Las páginas de `/ti/apps` lo pintan con los primitivos de siempre.
- La salud de cron se muda tal cual a `/ti/integraciones`.

**Tech Stack:** Next.js 16 (App Router), React 19, Drizzle + Postgres (PGlite en tests),
zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-apps-de-terreno-ti-design.md` (leerlo
entero antes de empezar cualquier tarea).

**Worktree:** `/home/allopze/dev/chome/bodega-wt/ti-apps-terreno`, rama
`feat/ti-apps-terreno` (`node_modules` enlazado al checkout principal).

## Global Constraints

- **Reglas de `AGENTS.md`:**
  - `PageHeader` + `PageContainer`, nunca un `<h1>` propio.
  - Tarjetas flotantes `bg-white border border-slate-200/70 rounded-2xl p-6 shadow-xs`.
  - `SummaryBar` con máximo 4 cifras, cada una con `href` a su filtro.
  - Sin input de búsqueda propio: `DataTable` usa la búsqueda de la TopBar.
  - Filtros por URL con `<Link replace scroll={false}>` o `router.replace(url, { scroll: false })`.
  - Texto de estado con tokens `-ink`.
  - `formatDate`/`formatDateTime`/`formatDateRelative` de `@/lib/utils`.
  - `EmptyState` con CTA real.
- **Migraciones:**
  - Sólo con `npm run db:generate`, nunca a mano.
  - Después, `node scripts/verify-migration-chain.mjs --update-checksums`, y
    `npm run db:generate` debe responder «No schema changes».
- **Prohibido dentro de cada tarea:**
  - `npm run typecheck` / `tsc` completo: se queda sin memoria y toma el lock del guardián.
  - `npm run test:e2e`: borra `.next` y pisa corridas ajenas.
  - `git stash`, `git checkout` y `git restore`: el worktree es compartido por las líneas.
- **Permitido dentro de cada tarea:** `npx vitest run <archivo>` (con
  `--config vitest.pglite.config.ts` para `*-pglite.test.ts`) y
  `npx eslint <archivos>`.
- **Fechas:**
  - Día de hoy con `todayInChile()`.
  - Semanas en zona `America/Santiago`, como `chileWeek` en
    `lib/services/apps-overview.ts:34`.
- **Privacidad del aviso:**
  - Nunca viajan nombre, RUT o empresa del trabajador.
  - Nunca viaja el token de TAE en claro, sólo su SHA-256 hex.
  - No se guarda la IP.
- **Umbrales** (spec §5.4 y §6), como constantes con nombre en `lib/apps/device-state.ts`:
  - atascado: 1 h;
  - aviso fresco: 24 h;
  - sin aviso: 7 días;
  - activo: 7 días;
  - olvido: 90 días;
  - «dejó de enviar»: hubo envíos en `[now-37d, now-7d)` y ninguno en `[now-7d, now]`;
  - acceso por vencer: 7 días;
  - acceso sin uso: 14 días.
- **Cuotas del aviso:** 600 por 5 min por IP y 20 por 5 min por `(app, deviceId)`.
- **Freno en el cliente:**
  - al abrir, se manda siempre;
  - después de un intento de envío, sólo si pasaron 5 min o cambió `pending` o `failed`;
  - nunca sin `navigator.onLine`;
  - `fetch` con `keepalive`, los errores se tragan y no hay reintento.
- **Textos de UI exactos:**
  - título «Apps», descripción «Las apps que se instalan en el teléfono: si funcionan y quién las usa.»;
  - título «Integraciones», descripción «Sincronizaciones y tareas programadas: si corrieron bien y a tiempo.»;
  - enlace del lanzador «Apps del teléfono».

## Review Focus

1. **Payload viejo, editado o malicioso** (campos extra, cadenas enormes, conteos negativos
   o > 10 000, cuerpo > 4 KB): 400 sin cuerpo y nada escrito. Prueba en la Tarea 3.
2. **Reloj del teléfono corrido:** un `oldestPendingAt`, `lastAttemptAt` o `builtAt` en
   el futuro se recorta a la hora de recepción. Un estado nunca sale «atascado» por un
   reloj adelantado. Prueba en la Tarea 3.
3. **Credencial del mecánico revocada o vencida en el Bearer:** el aviso se guarda igual
   y **no borra** el `user_id` que ya tenía el teléfono. Una credencial válida sí lo
   reemplaza. Prueba en la Tarea 3.
4. **Motor del mecánico que intenta cada 60 s:** con la cola sin cambios sale a lo más
   un aviso cada 5 min. Si cambia el conteo, sale de inmediato. Prueba en la Tarea 4.
5. **Rol con alcance por faena:** no ve teléfonos de otras faenas ni teléfonos sin faena.
   Un rol global ve todo. Prueba en la Tarea 5.

---

## Orden de ejecución

- **Fase 0, en la sesión principal y en secuencia:** Tareas 1 y 2. Fijan los contratos
  que usan las demás.
- **Fase 1, en paralelo:** Tareas 3, 4, 5, 6 y 7, una línea Sonnet cada una. Cada
  línea es dueña **exclusiva** de los archivos que lista y no hace commit: la sesión
  principal commitea por rutas al recibir cada informe.
- **Fase 2, en la sesión principal:** Tarea 8. Una sola pasada de puertas, E2E aislada,
  recorrido en navegador e informe QA.

---

### Task 1: Identificador de build único (arregla la versión en prod)

**Files:**
- Create: `lib/build-info.ts`
- Create: `lib/__tests__/build-info.test.ts`
- Modify: `next.config.ts` (agregar `env`)
- Modify: `Dockerfile` (`ARG BODEGA_BUILD_SHA=` justo antes de la línea 56, `RUN … npm run build`)
- Modify: `scripts/deploy-prod.sh:399-402` (agregar `--build-arg BODEGA_BUILD_SHA="$(git rev-parse --short=12 HEAD)"`)
- Modify: `app/(mecanico)/m/mantencion/page.tsx:34`
- Modify: `app/(app)/admin/backups/actions.ts` (líneas 84, 127, 157, 170, 190)
- Modify: `app/api/cron/backup-report/route.ts:65`

**Interfaces:**
- Produces:
  - `BUILD_SHA: string`, `BUILD_TIME: string` (ISO) y `BUILD_ID: string`
    (`BUILD_SHA || BUILD_TIME || "dev"`);
  - `buildLabel(builtAt: string | null, version: string): string`, que devuelve
    «22-11-2026 14:05 · 3f9c2a1b7d0e», sólo la fecha si `version` es la misma
    fecha, o «Desconocida».
  - Todo en `lib/build-info.ts`, que se puede importar desde el cliente.

- [ ] **Step 1: Write the failing test** `lib/__tests__/build-info.test.ts`, con
  `vi.stubEnv` + `vi.resetModules()` + import dinámico en cada caso:
  - `"usa el sha cuando el deploy lo pasa"`: con `NEXT_PUBLIC_BUILD_SHA="3f9c2a1b7d0e"`
    y `NEXT_PUBLIC_BUILD_TIME="2026-11-22T17:05:00.000Z"`, entonces
    `BUILD_ID === "3f9c2a1b7d0e"`;
  - `"cae a la hora del build sin sha"`: con `NEXT_PUBLIC_BUILD_SHA=""`, entonces
    `BUILD_ID === "2026-11-22T17:05:00.000Z"`;
  - `"dev sin ninguna"`: con ambas vacías, entonces `BUILD_ID === "dev"`;
  - `"rótulo legible"`: `buildLabel("2026-11-22T17:05:00.000Z", "3f9c2a1b7d0e")`
    contiene `"22-11-2026"` y `"3f9c2a1b7d0e"`, y `buildLabel(null, "x") === "Desconocida"`.
- [ ] **Step 2:** `npx vitest run lib/__tests__/build-info.test.ts`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement.**
  - `lib/build-info.ts` lee `process.env.NEXT_PUBLIC_BUILD_SHA` y
    `process.env.NEXT_PUBLIC_BUILD_TIME` **sin desestructurar**, porque Next los
    reemplaza literalmente.
  - En `next.config.ts`:
    `env: { NEXT_PUBLIC_BUILD_SHA: process.env.BODEGA_BUILD_SHA ?? "", NEXT_PUBLIC_BUILD_TIME: new Date().toISOString() }`.
    Ver `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/env.md`.
  - Reemplazar las lecturas de `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` en la página del
    mecánico (`appVersion={BUILD_ID.slice(0, 40)}`) y en respaldos (`BUILD_ID`). No
    tocar `docker-compose.yml`, `lib/services/backup-run.ts` ni
    `scripts/backup-orchestrator.sh`.
- [ ] **Step 4:** `npx vitest run lib/__tests__/build-info.test.ts` → PASS.
  `npx eslint lib/build-info.ts next.config.ts 'app/(mecanico)/m/mantencion/page.tsx' 'app/(app)/admin/backups/actions.ts' app/api/cron/backup-report/route.ts` → sin errores.
  `bash -n scripts/deploy-prod.sh` → sin salida.
- [ ] **Step 5: Commit**

```bash
git add lib/build-info.ts lib/__tests__/build-info.test.ts next.config.ts Dockerfile scripts/deploy-prod.sh 'app/(mecanico)/m/mantencion/page.tsx' 'app/(app)/admin/backups/actions.ts' app/api/cron/backup-report/route.ts
git commit -m "fix(build): un identificador de build fijado al compilar para apps y respaldos"
```

### Task 2: Contratos compartidos (catálogo, esquema, payload, estado)

**Files:**
- Create: `lib/apps/field-apps.ts`
- Create: `db/schema/pwa-devices.ts`, más `export * from "./pwa-devices"` en `db/schema/index.ts`
- Create: la migración generada en `db/migrations/0400_*.sql` + journal + snapshot + checksum
- Create: `lib/pwa/heartbeat-contract.ts`
- Create: `lib/apps/device-state.ts`
- Create: `lib/services/field-apps/types.ts`
- Test: `lib/apps/__tests__/field-apps.test.ts`, `lib/apps/__tests__/device-state.test.ts`, `lib/pwa/__tests__/heartbeat-contract.test.ts`

**Interfaces (Produces; las usan las Tareas 3 a 7):**

```ts
// lib/apps/field-apps.ts
export type FieldAppId = "ppa" | "mantencion" | "tae"
export const FIELD_APP_IDS: readonly FieldAppId[]            // ["ppa", "mantencion", "tae"]
export interface FieldAppDef {
  id: FieldAppId; label: string; description: string; entryHref: string; iconSrc: string
  moduleId: string; toggleRoute: string; manageHref: string | null; manageLabel: string | null
}
export const FIELD_APPS: readonly FieldAppDef[]
export function findFieldApp(id: string): FieldAppDef | undefined
export function isFieldAppId(value: unknown): value is FieldAppId
```

Valores:

| id | label | description | entryHref | iconSrc | moduleId | toggleRoute | manageHref | manageLabel |
|---|---|---|---|---|---|---|---|---|
| `ppa` | «PPA Digital» | «Evaluación preventiva antes de iniciar el trabajo» | `/ppa` | `/ppa-icon-192.png` | `ppa` | `/prevencion/ppa` | null | null |
| `mantencion` | «Mantención» | «Registro de mantención preventiva y correctiva de equipos, con o sin señal» | `/m/mantencion` | `/mant-icon-192.png` | `mantencion_equipos` | `/mantencion/registros` | `/mantencion/dispositivos` | «Administrar dispositivos» |
| `tae` | «Control TAE» | «Registro operativo de cargas TAE de Copec» | `/tae` | `/tae-icon-192.png` | `combustibles` | `/combustibles/cargas` | `/combustibles/ajustes/puntos-de-carga` | «Administrar enlaces» |

```ts
// db/schema/pwa-devices.ts — columnas exactas
pwa_devices: app text, device_id text, PK(app, device_id), first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null, version text not null, built_at timestamptz null, installed boolean not null,
  platform text not null, pending_count int not null default 0, failed_count int not null default 0,
  oldest_pending_at timestamptz null, last_attempt_at timestamptz null, last_error text null, last_error_at timestamptz null,
  user_id text null FK users set null, worksite_id text null FK worksites set null,
  tae_link_id text null FK fuel_tae_public_links set null
  CHECK app IN ('ppa','mantencion','tae'); CHECK pending_count >= 0 AND failed_count >= 0
  index (app, last_seen_at)
pwa_device_days: app text, device_id text, day date, reports int not null default 1, PK(app, device_id, day), index (app, day)
```
Todas las columnas timestamp van con `{ withTimezone: true, mode: "string" }`.
Exportar `pwaDevices` y `pwaDeviceDays`.

```ts
// lib/pwa/heartbeat-contract.ts
export const HEARTBEAT_LIMITS = { maxCount: 10_000, errorChars: 200, versionChars: 40, platformChars: 60, maxBodyBytes: 4096 } as const
export const pwaHeartbeatSchema: z.ZodType  // z.object({...}).strict()
//   app: enum FIELD_APP_IDS; deviceId: z.string().uuid(); version: string 1..40; builtAt: ISO datetime | null;
//   installed: boolean; platform: string 1..60; pending, failed: int 0..10_000;
//   oldestPendingAt, lastAttemptAt: ISO datetime | null; lastError: string ≤200 | null;
//   worksiteId: string 1..64 optional; linkHash: /^[0-9a-f]{64}$/ optional
export type PwaHeartbeat = z.infer<typeof pwaHeartbeatSchema>
```

```ts
// lib/apps/device-state.ts
export const STUCK_AFTER_MS = 3_600_000, FRESH_REPORT_MS = 86_400_000, SILENT_AFTER_MS = 7 * 86_400_000
export const ACTIVE_WINDOW_MS = 7 * 86_400_000, FORGET_AFTER_MS = 90 * 86_400_000
export const STOPPED_RECENT_DAYS = 7, STOPPED_PRIOR_DAYS = 30, ACCESS_EXPIRING_DAYS = 7, ACCESS_UNUSED_DAYS = 14
export type DeviceState = "error" | "stuck" | "silent" | "ok"
export interface DeviceSnapshot { lastSeenAt: string; pendingCount: number; failedCount: number; oldestPendingAt: string | null }
export function deviceState(device: DeviceSnapshot, now: Date): DeviceState
export function isVersionBehind(version: string, current: string): boolean   // version !== current
export const DEVICE_STATE_META: Record<DeviceState, { label: string; variant: "danger" | "warning" | "neutral" | "success"; hint: string }>
//   error «Con error» danger · stuck «Atascado» warning · silent «Sin señal / sin abrir» neutral · ok «Al día» success
```
Regla de `deviceState`, en este orden:
1. `failedCount > 0` → `error`.
2. `pendingCount > 0`, `lastSeen - oldestPending > STUCK_AFTER_MS` y
   `now - lastSeen ≤ FRESH_REPORT_MS` → `stuck`.
3. `pendingCount > 0` y `now - lastSeen > FRESH_REPORT_MS`, **o**
   `now - lastSeen > SILENT_AFTER_MS` → `silent`.
4. Si no, `ok`.

```ts
// lib/services/field-apps/types.ts — lo que devuelve la Tarea 5 y pinta la Tarea 6
export interface FieldAppSummary { app: FieldAppId; enabled: boolean; firstReportAt: string | null; lastReportAt: string | null;
  activeDevices: number; seenDevices: number; byState: Record<DeviceState, number>; versionBehind: number;
  accessesNeedingAttention: number; lastSubmissionAt: string | null }
export interface FieldDeviceRow { app: FieldAppId; deviceId: string; platform: string; installed: boolean; version: string; builtAt: string | null;
  versionBehind: boolean; state: DeviceState; pendingCount: number; failedCount: number; oldestPendingAt: string | null;
  lastAttemptAt: string | null; lastError: string | null; lastErrorAt: string | null; firstSeenAt: string; lastSeenAt: string;
  userName: string | null; worksiteName: string | null; linkLabel: string | null; linkStatus: "active" | "revoked" | "expired" | null }
export interface LatencyWeek { weekStart: string; count: number; p50Minutes: number | null; p90Minutes: number | null; offlineShare: number | null }
export interface UsageRow { key: string; label: string; activeDevices: number; lastSubmissionAt: string | null; submissions30d: number; stopped: boolean }
export interface AccessSummary { kind: "credentials" | "links"; active: number; expiringSoon: number; unused: number; revokedOrExpired30d: number;
  links: Array<{ id: string; label: string; worksiteName: string; status: "active" | "revoked" | "expired"; lastUsedAt: string | null; activeDevices: number }> }
export interface CaptureQuality { manualIdentity: Array<{ worksiteId: string; worksiteName: string; total: number; manual: number }>;
  ocrWeeks: Array<{ weekStart: string; readings: number; ocr: number; manual: number; avgConfidence: number | null }> | null }
```

- [ ] **Step 1: Write the failing tests.**
  - `device-state.test.ts`, con `now = 2026-11-22T12:00:00Z`:
    - `"un rechazo manda aunque esté al día"`: `failed=1`, aviso hace 1 min → `"error"`;
    - `"atascado: avisó con señal y tiene pendientes viejos"`: aviso hace 10 min, pendiente desde 3 h antes del aviso → `"stuck"`;
    - `"enviando: pendientes recientes no es atascado"`: pendiente desde 20 min antes del aviso → `"ok"`;
    - `"sin señal con pendientes tras 24 h"`: aviso hace 30 h con pendientes → `"silent"`;
    - `"sin abrir tras 7 días"`: aviso hace 8 días sin pendientes → `"silent"`;
    - `"6 días sin pendientes sigue al día"` → `"ok"`;
    - `"versión atrasada"`: `isVersionBehind("a", "b") === true`, `isVersionBehind("b", "b") === false`.
  - `heartbeat-contract.test.ts`:
    - acepta un payload mínimo válido;
    - rechaza un campo extra (`rut`);
    - rechaza `pending: -1` y `10_001`;
    - rechaza `lastError` de 201 caracteres;
    - rechaza `linkHash` que no sea hex de 64;
    - rechaza `app: "bodega"`.
  - `field-apps.test.ts`:
    - los tres ids en orden;
    - cada `moduleId` existe en `modules/registry.ts`;
    - cada `iconSrc` existe en `public/`;
    - `isFieldAppId("x") === false`.
- [ ] **Step 2:** `npx vitest run lib/apps/__tests__/device-state.test.ts lib/apps/__tests__/field-apps.test.ts lib/pwa/__tests__/heartbeat-contract.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** los cinco archivos con las firmas de arriba. Después,
  `npm run db:generate` (genera `0400_*`), `node scripts/verify-migration-chain.mjs --update-checksums`,
  y `npm run db:generate` otra vez. Expected: «No schema changes».
- [ ] **Step 4:** los mismos tests → PASS; `npm run db:verify-migrations` → OK;
  `npx eslint` sobre los archivos nuevos → limpio.
- [ ] **Step 5: Commit** — `feat(apps): contratos de las apps del teléfono (catálogo, avisos, estado)`.

### Task 3: Ruta y servicio del aviso (línea A)

**Files (exclusivos):**
- Create: `lib/services/pwa-heartbeat.ts`
- Create: `app/api/pwa/aviso/route.ts`
- Modify: `lib/security/public-paths.ts` (agregar `"/api/pwa/aviso"` con comentario, como las demás)
- Modify: `lib/__tests__/module-toggles.test.ts:412` (sumar `"/pwa"` y `"/apps"` a
  `apiAllowPrefixes`. `/apps` es la deuda ya conocida de las rutas del lanzador; agregar
  un comentario que diga por qué cada una)
- Test: `lib/__tests__/pwa-heartbeat-pglite.test.ts`

**Interfaces:**
- Consumes:
  - `pwaHeartbeatSchema`, `HEARTBEAT_LIMITS` y `PwaHeartbeat` (Tarea 2);
  - `findFieldApp` (Tarea 2);
  - `pwaDevices` y `pwaDeviceDays` (Tarea 2);
  - `consumeFixedWindowLimit(key, { maxAttempts, lockMs })` (`lib/services/rate-limit.ts:25`);
  - `resolveTrustedClientIp(headers)`;
  - `isRouteOperational(pathname)`;
  - `authenticateDeviceToken(token)` → `{ userId, deviceId, … } | null`;
  - el `hashToken` existente no se usa: se compara `linkHash` directo con `fuel_tae_public_links.token_hash`.
- Produces:
  - `recordPwaHeartbeat(input: PwaHeartbeat, ctx: { bearer: string | null; now?: Date }): Promise<"recorded" | "module_off">`;
  - `POST /api/pwa/aviso`, que responde 204 / 400 / 413 / 429, siempre sin cuerpo.

- [ ] **Step 1: Write the failing test** `pwa-heartbeat-pglite.test.ts`, con el patrón de
  `lib/__tests__/app-visits-pglite.test.ts`: PGlite, `migratePGlite`, mock de `@/db` y
  semillas de usuario, faena, enlace TAE (activo y revocado) y credencial del mecánico.
  - `"primer aviso crea el teléfono y suma el día"`: una fila en `pwa_devices` y una en
    `pwa_device_days` con `reports=1`; el segundo aviso el mismo día deja `reports=2`;
  - `"el último error se conserva cuando el siguiente llega sin error"`: con
    `last_error` y `last_error_at` del primero;
  - `"fechas del futuro se recortan a la recepción"` (Review Focus 2):
    `oldestPendingAt` en `now + 2 h` queda guardado como `now`;
  - `"credencial válida asocia la persona; una revocada no la borra"` (Review Focus 3);
  - `"un enlace revocado igual se asocia"`: `linkHash` del enlace revocado → `tae_link_id` seteado;
  - `"worksiteId inexistente se ignora"`: `worksite_id` null, sin error;
  - `"módulo apagado: no se escribe"`: con `isRouteOperational` mockeado a false →
    `"module_off"` y cero filas;
  - **ruta** (importar `POST` y llamarlo con `new Request`), Review Focus 1:
    - campo extra → 400 sin escribir;
    - cuerpo de 5000 bytes → 413;
    - 21 avisos del mismo teléfono en 5 min → el 21.º 429;
    - payload válido → 204 con cuerpo vacío.
- [ ] **Step 2:** `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pwa-heartbeat-pglite.test.ts` → FAIL.
- [ ] **Step 3: Implement.** La ruta sigue este orden:
  1. cuota por IP (`pwa-aviso-ip:${ip}`, 600 / 300 000 ms);
  2. leer el texto del cuerpo y responder 413 si supera `maxBodyBytes`;
  3. `JSON.parse` + `safeParse`, y 400 si falla;
  4. cuota por dispositivo (`pwa-aviso-dev:${app}:${deviceId}`, 20 / 300 000 ms);
  5. `recordPwaHeartbeat` con `bearer` de `Authorization: Bearer …` (sólo para `app === "mantencion"`);
  6. 204.

  El servicio hace el upsert `ON CONFLICT (app, device_id)`:
  - `user_id = COALESCE(excluded.user_id, pwa_devices.user_id)`;
  - lo mismo para `worksite_id` y `tae_link_id`;
  - `last_error` y `last_error_at` sólo cambian cuando llega error;
  - `pwa_device_days` con el día de `todayInChile(now)` y `reports = reports + 1`.
- [ ] **Step 4:** el test → PASS. `npx vitest run --config vitest.pglite.config.ts lib/__tests__/module-toggles.test.ts` → PASS (antes fallaba por `/api/apps`). eslint sobre los archivos de la tarea → limpio.
- [ ] **Step 5:** informar archivos y resultados. La sesión principal commitea:
  `feat(apps): ruta pública del aviso de las apps del teléfono`.

### Task 4: El aviso en las tres apps y el arreglo de PPA (línea B)

**Files (exclusivos):**
- Create: `lib/pwa/environment.ts` (mover `isStandalone` desde
  `lib/mantencion/client/install.ts:90` y `deviceLabel` desde
  `lib/mantencion/client/accounts.ts:52`; ambos archivos los reexportan)
- Create: `lib/pwa/heartbeat.ts`
- Modify: `lib/mantencion/client/install.ts`, `lib/mantencion/client/accounts.ts` (sólo reexportes)
- Modify: `components/mantencion/app/use-mant-runtime.ts`
- Modify: `lib/pwa/offline-queue.ts` (`failureKind` en `QueuedPpa`; `purgeExpiredPpas` sólo borra `synced`)
- Modify: `lib/pwa/hooks.ts` (marcar `failureKind`; aviso tras cada intento)
- Modify: `components/pwa/pwa-register.tsx` (aviso de apertura de PPA)
- Modify: `app/(public)/ppa/ppa-form.hooks.ts` (guardar la faena del último envío en `localStorage["chome:pwa-worksite:ppa"]`)
- Modify: `components/pwa/tae-pwa-register.tsx` (aviso de apertura de TAE)
- Modify: `app/(public)/tae/tae-submitter.ts` (aviso no forzado al final de `sendQueued`, en éxito y en error)
- Test: `lib/pwa/__tests__/heartbeat.test.ts`, `lib/pwa/offline-queue.test.ts`, y ajustar
  `lib/mantencion/client/__tests__/install.test.ts` y
  `app/(public)/tae/access/[accessToken]/access-activation.test.tsx` si se rompen

**Interfaces:**
- Consumes:
  - `PwaHeartbeat` (sólo `import type`) y `FieldAppId` (Tarea 2);
  - `BUILD_ID` y `BUILD_TIME` (Tarea 1);
  - `queueStats` y `listQueue` (Mantención);
  - `getDeviceId` (`lib/mantencion/client/meta.ts:25`);
  - `getActiveAccountId` + `getAccount` (`accounts.ts`), por el `token`;
  - `countTaeQueue`, la lectura del token de TAE de `tae-offline-queue.ts:73-79` y
    `getAllPpas` de PPA.
- Produces:

```ts
// lib/pwa/heartbeat.ts
export interface QueueSnapshot { pending: number; failed: number; oldestPendingAt: string | null; lastAttemptAt: string | null; lastError: string | null }
export interface HeartbeatContext { bearer?: string; worksiteId?: string; linkToken?: string }   // linkToken en claro: se hashea adentro
export const HEARTBEAT_MIN_INTERVAL_MS = 300_000
export function getOrCreateDeviceId(app: "ppa" | "tae"): string     // localStorage["chome:pwa-device:" + app]; UUID por sesión si falla
export async function sendHeartbeat(app: FieldAppId, deviceId: string, snapshot: QueueSnapshot,
  ctx?: HeartbeatContext, opts?: { force?: boolean; now?: number }): Promise<boolean>   // true si salió el fetch
export function __resetHeartbeatThrottle(): void   // sólo tests
```

- [ ] **Step 1: Write the failing tests.**
  - `heartbeat.test.ts` (jsdom, `fetch` mockeado):
    - `"al abrir sale siempre"`;
    - `"sin red no sale"`: `navigator.onLine=false` → `false` y sin fetch;
    - `"tras un intento, igual estado y menos de 5 min no sale"` (Review Focus 4: tres
      llamadas no forzadas a 60 s → 1 fetch);
    - `"cambia el conteo y sale de inmediato"`;
    - `"pasados 5 min sale"`;
    - `"el token de TAE viaja hasheado"`: el body trae `linkHash` igual al SHA-256 hex
      de `"tok-1"` y no contiene `"tok-1"`;
    - `"un fetch que falla no lanza"`;
    - `"el cuerpo no lleva datos del trabajador"`: las claves del body son exactamente
      las de `pwaHeartbeatSchema`.
  - `offline-queue.test.ts`:
    - `"un PPA sin enviar de 40 días no se borra"`;
    - `"uno enviado de 40 días sí"`;
    - `failureKind` queda en `"rejected"` cuando el servidor responde `ok:false`, y en
      `"network"` cuando se agotan los reintentos (probarlo en el test de hooks existente
      si lo hay; si no, en `heartbeat.test.ts` vía `syncOne`).
- [ ] **Step 2:** `npx vitest run lib/pwa/__tests__/heartbeat.test.ts lib/pwa/offline-queue.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - **Instantánea por app:**
    - Mantención: `pending` y `failed` salen de `queueStats` (`failed = rejected`);
      `lastError` es el del ítem no enviado más reciente; `bearer` es el `token` de la
      cuenta activa.
    - PPA: `pending` = pending + syncing + failed con `failureKind !== "rejected"`;
      `failed` = failed con `failureKind === "rejected"`. Un ítem viejo sin
      `failureKind` cuenta como `"rejected"` si su `lastError !== "Sin conexión"`.
    - TAE: `pending` = pending + syncing; `failed` = failed.
  - **Aviso de apertura (`force: true`):**
    - Mantención: en el primer `useEffect` de `useMantRuntime`, tras `pruneSent`.
    - PPA: en `pwa-register.tsx`.
    - TAE: en `tae-pwa-register.tsx`.
  - **Aviso tras intento (no forzado):**
    - Mantención: en el `onReport` de `startSyncLoop`, salvo `report.busy`.
    - PPA: al final de `syncOne` y de `syncAllPending`.
    - TAE: al final de `sendQueued`.
  - `platform` sale de `deviceLabel()`, `installed` de `isStandalone()`, y `version` y
    `builtAt` de `BUILD_ID` y `BUILD_TIME`. `builtAt` es null si `BUILD_TIME` está vacío.
  - **Service worker de PPA:** revisar si `public/sw.js` sirve la navegación de `/ppa`
    desde caché antes que desde la red. Si es así, subir `CACHE_NAME` (`"ppa-v4"` →
    `"ppa-v5"`) para que los teléfonos con señal tomen el JS con el aviso. TAE ya es
    network-first (`public/tae-sw.js:49-54`).
- [ ] **Step 4:** esos tests → PASS. `npx vitest run lib/mantencion/client/__tests__ components/mantencion/app/__tests__ 'app/(public)/tae' lib/pwa` → PASS. eslint sobre los archivos tocados → limpio.
- [ ] **Step 5:** informar. La sesión principal commitea:
  `feat(apps): las apps del teléfono avisan su estado; PPA ya no borra evaluaciones sin enviar`.

### Task 5: Lecturas para TI (línea D)

**Files (exclusivos):**
- Create: `lib/services/field-apps/overview.ts`
- Test: `lib/__tests__/field-apps-overview-pglite.test.ts`

**Interfaces:**
- Consumes:
  - los tipos de `lib/services/field-apps/types.ts`;
  - `deviceState`, `isVersionBehind` y las constantes de `device-state.ts`;
  - `FIELD_APPS`;
  - `BUILD_ID`;
  - `isRouteOperational`;
  - tablas `pwaDevices`, `pwaDeviceDays`, `mantRecords`, `ppaSubmissions`,
    `fuelTaeSubmissions`, `fuelTaePublicLinks`, `mantDeviceCredentials`, `users`
    y `worksites`.
- Produces (todas con `scope: string[] | "all"` de `serviceWorksiteScope` y `now: Date = new Date()`):
  - `getFieldAppSummaries(scope, now): Promise<FieldAppSummary[]>`, en el orden de `FIELD_APPS`;
  - `getFieldAppDevices(app, scope, now): Promise<FieldDeviceRow[]>`, que excluye
    `last_seen_at` de más de 90 días y ordena por estado (error, stuck, silent, ok) y
    luego por `last_seen_at desc`;
  - `getFieldAppLatency(app, scope, now): Promise<LatencyWeek[]>`, con 12 semanas
    terminando en la actual y las semanas sin datos con `count: 0` y nulls;
  - `getFieldAppUsage(app, scope, now): Promise<UsageRow[]>`: PPA y TAE por faena,
    Mantención por persona (`registered_by`);
  - `getFieldAppAccess(app: "mantencion" | "tae", scope, now): Promise<AccessSummary | null>`:
    `null` para Mantención con alcance acotado; `links` vacío para Mantención;
  - `getFieldAppCaptureQuality(app: "ppa" | "tae", scope, now): Promise<CaptureQuality>`:
    `ocrWeeks` null en PPA.

Definiciones exactas (spec §5.6):

- **Demora:**
  - Mantención: `received_at - signed_at`, offline si `offline_since IS NOT NULL`.
  - TAE: `created_at - loaded_at` con `source='public_pwa'`, offline si
    `loaded_at_source='device_offline'`.
  - PPA: `created_at - COALESCE(filled_at, created_at)`, offline si `filled_at IS NOT NULL`.
  - p50 y p90 con `percentile_cont`, en minutos.
- **Identificación manual:** `ppa_submissions.manual_identificacion` y
  `fuel_tae_submissions.manual_identity` (`source='public_pwa'`), últimos 30 días.
- **OCR por semana (TAE `public_pwa`):** `readings` = filas con `meter_reading_source`
  no nulo; `ocr` = `'ocr'`; `manual` = `'manual'`; `avgConfidence` = promedio de
  `ocr_confidence` donde `'ocr'`.
- **Accesos:**
  - Credenciales vigentes: `revoked_at IS NULL` y `expires_at > now`.
  - Por vencer: vence en ≤ 7 días.
  - Sin uso: `COALESCE(last_used_at, created_at) < now-14d`.
  - Revocadas o vencidas en los últimos 30 días.
  - Los enlaces TAE se cuentan igual (`expires_at` nulo = no vence).
  - `accessesNeedingAttention` = por vencer + sin uso.
- **Alcance** (Review Focus 5):
  - con `scope !== "all"`, sólo filas con faena en el alcance;
  - los teléfonos sin `worksite_id` y los de Mantención, sólo con `"all"`;
  - Mantención por persona se acota por `mant_records.worksite_id`.

- [ ] **Step 1: Write the failing test** con semillas en PGlite:
  - teléfonos de las tres apps en los cuatro estados;
  - registros de Mantención con y sin `offline_since`;
  - PPA con y sin `filled_at`;
  - cargas TAE OCR y manual;
  - una faena con envíos sólo entre 8 y 30 días atrás.

  Casos:
  - `"resumen cuenta activos, estados y versión atrasada"`: incluye un teléfono con
    `version !== BUILD_ID`;
  - `"sin avisos: firstReportAt null"`;
  - `"la lista excluye teléfonos de más de 90 días"`;
  - `"demora: mediana y p90 en minutos por semana, y porcentaje sin señal"`, con valores
    exactos de las semillas;
  - `"uso marca «dejó de enviar»"`;
  - `"accesos: por vencer y sin uso"`;
  - `"alcance acotado no ve otras faenas ni teléfonos sin faena; global ve todo"`;
  - `"OCR por semana"`.
- [ ] **Step 2:** `npx vitest run --config vitest.pglite.config.ts lib/__tests__/field-apps-overview-pglite.test.ts` → FAIL.
- [ ] **Step 3: Implement** `overview.ts`, reutilizando la expresión de semana chilena de
  `lib/services/apps-overview.ts:34`, copiada (ese archivo lo borra la Tarea 7).
- [ ] **Step 4:** → PASS; eslint limpio.
- [ ] **Step 5:** informar. Commit: `feat(apps): lecturas de TI para las apps del teléfono`.

### Task 6: Pantallas `/ti/apps` y `/ti/apps/[appId]` (línea E)

**Files (exclusivos):**
- Rewrite: `app/(app)/ti/apps/page.tsx`
- Rewrite: `app/(app)/ti/apps/[appId]/page.tsx`
- Rewrite: `app/(app)/ti/apps/status.ts` (filtros `?estado=`: `atencion` = error+stuck, `version`, `sin-senal`, `activos`)
- Create: `app/(app)/ti/apps/field-app-card.tsx`
- Create: `app/(app)/ti/apps/[appId]/devices-table.tsx`
- Create: `app/(app)/ti/apps/[appId]/latency-chart.tsx` (+ `latency-chart-lazy.tsx` con `lazyChart`)
- Delete: `app/(app)/ti/apps/apps-table.tsx`
- Modify: `app/(app)/ti/apps/loading.tsx` si hace falta
- Create: `e2e/ti-apps.spec.ts`

**Interfaces:**
- Consumes:
  - las funciones de la Tarea 5;
  - `FIELD_APPS`, `findFieldApp` e `isFieldAppId`;
  - `DEVICE_STATE_META`;
  - `buildLabel`, `BUILD_ID` y `BUILD_TIME`;
  - `requirePermission("ti:view")`, `serviceWorksiteScope`;
  - `SummaryBar`, `DataTable`, `EmptyState`, `MetaBadge`, `Button`;
  - `MechanicAppInstallDialog`
    (`components/mantencion/jefatura/shared/mechanic-app-install-dialog`);
  - `lazyChart` y el gráfico de líneas existente que mejor calce (ver
    `components/charts/`). Si no hay uno de dos series, uno nuevo dentro de
    `latency-chart.tsx` con recharts, como los demás.
- Produces:
  - las rutas `/ti/apps` y `/ti/apps/{ppa|mantencion|tae}`, que hacen `notFound()`
    con otro id;
  - el `?estado=` de arriba.

- [ ] **Step 1: Write the E2E** `e2e/ti-apps.spec.ts`. Usa `login(page)` del admin
  (patrón `e2e/ti-modulo.spec.ts`) y siembra avisos con
  `page.request.post("/api/pwa/aviso", { data })`: dos teléfonos PPA (uno con
  `failed: 1`) y ninguno de TAE. Casos:
  - `"la lista muestra las tres apps"`: los headings o enlaces «PPA Digital»,
    «Mantención» y «Control TAE»; TAE dice «Sin avisos aún»;
  - `"el detalle de PPA filtra por atención"`: clic en PPA, después en la cifra
    «Atascados o con error» → la URL trae `estado=atencion` y la tabla (con
    `getByRole("row")`) tiene 1 fila de teléfono con «Con error»;
  - `"un id desconocido da 404"`: `/ti/apps/bodega` muestra el `h1` de no encontrado
    (mirar el `h1`, no el estado HTTP).

  Este spec no se corre en esta tarea; se corre en la Tarea 8.
- [ ] **Step 2: Implement las páginas** según el spec §5.5 y §5.6:
  - **Lista:** tres `FieldAppCard` (enlace a la tarjeta completa) con la insignia de
    precedencia Desactivada > Sin avisos aún > Requiere atención > Al día, y la nota
    al pie.
  - **Detalle:** las secciones 1 a 6 en orden. Las secciones 5 y 6 sólo para las apps
    que corresponden. Cada sección vacía usa `EmptyState`.
  - **Tabla:** `DataTable` con `searchKeys` (`platform`, `userName`, `worksiteName`,
    `linkLabel`, `version`). Columnas según §5.6.2. La versión con `buildLabel` y la
    insignia «Atrasada». El chip «Mostrando: …» + «Ver todos», como la página actual.
- [ ] **Step 3:** `npx eslint 'app/(app)/ti/apps' e2e/ti-apps.spec.ts` → limpio. Sin `tsc` completo.
- [ ] **Step 4:** informar. Commit: `feat(ti): Apps muestra las apps del teléfono con su estado`.

### Task 7: `/ti/integraciones`, menú, lanzador y limpieza (línea F)

**Files (exclusivos):**
- Create: `lib/integrations/health-catalog.ts` (mover `AppCronJob` → `IntegrationJob`
  con `moduleId` en vez de `appId`, `APP_CRON_JOBS` → `INTEGRATION_JOBS` y
  `PREVENTION_JOB_LABELS`, desde `lib/apps/catalog.ts:239-304`)
- Create: `lib/integrations/health.ts` (mover `CronJobRow`, `IntegrationStatus`,
  `IntegrationHealth`, `integrationStatus` y `worstStatus` desde `lib/apps/metrics.ts`)
- Create: `lib/services/integrations-health.ts` (mover `readCronRows` y `getAppCronRuns`
  desde `lib/services/apps-overview.ts`)
- Create: `app/(app)/ti/integraciones/page.tsx`, `loading.tsx` y `status.ts` (mover
  `INTEGRATION_STATUS_META` y `RUN_OUTCOME_LABEL` desde `app/(app)/ti/apps/status.ts`;
  filtros `?estado=ok|failing|stale|never`)
- Create: `lib/integrations/__tests__/health.test.ts` (mover las pruebas «estado de una
  integración» de `lib/apps/__tests__/apps-metrics.test.ts:40-62` y «no repite un job»)
- Delete: `lib/apps/metrics.ts`, `lib/services/apps-overview.ts`, `lib/apps/__tests__/apps-metrics.test.ts`
- Modify: `lib/apps/catalog.ts` (quitar `activityNote`, `ENTITY_EXACT`,
  `ENTITY_PREFIXES`, `appForEntityType`, `appIdsReferencedByEntityMap`, `APP_CRON_JOBS`
  y `cronJobsForApp`; queda `APPS`/`findApp`/`modulesWithoutApp` para el lanzador)
- Modify: `lib/apps/__tests__/apps-catalog.test.ts` (quitar los casos del mapeo y de los jobs)
- Modify: `modules/ti/manifest.ts:43` (ítem «Integraciones», `/ti/integraciones`, ícono
  `PlugsConnected` si existe en el mapa de íconos de navegación, si no `ArrowsClockwise`;
  `ti:view`, grupo «Seguimiento», después de «Apps»; actualizar el comentario de «Apps»)
- Modify: `components/layout/app-launcher.tsx:122` («Apps del teléfono»)
- Modify: `db/schema/app-visits.ts` (sólo el comentario: ahora alimenta las recientes del lanzador)
- Create: `e2e/ti-integraciones.spec.ts`

**Interfaces:**
- Produces:
  - `getIntegrationsHealth(now?: Date): Promise<Array<{ moduleId: string; moduleLabel: string; jobs: IntegrationHealth[] }>>`,
    con grupos en el orden de las áreas del menú (como el `areaOrder` actual) y
    `moduleLabel` de `getModuleLabel`;
  - `getIntegrationRuns(jobName: string, limit = 10): Promise<IntegrationRun[]>`;
  - la ruta `/ti/integraciones`.

- [ ] **Step 1: Write the failing tests:**
  - `health.test.ts`, con las pruebas movidas y verdes contra los nuevos imports;
  - `e2e/ti-integraciones.spec.ts`:
    - `"el menú de TI lleva a Integraciones"`: `getByRole("link", { name: "Integraciones", exact: true })`;
    - `"el filtro por estado viaja en la URL"`: clic en la cifra «Sin corridas» → `estado=never`;
    - `"un rol sin ti:view termina en /forbidden"`: el patrón del último test de `e2e/ti-modulo.spec.ts`.
- [ ] **Step 2: Implement:** página con `PageHeader` y el texto exacto, `SummaryBar`
  de 4 con `href`, lista por módulo en tarjeta flotante y `<details>` «Últimas corridas»
  por job con la tabla que hoy está en `app/(app)/ti/apps/[appId]/page.tsx:131-160`.
- [ ] **Step 3:**
  - `npx vitest run lib/integrations/__tests__/health.test.ts lib/apps/__tests__ lib/__tests__/navigation.test.ts` → PASS;
  - `rg -n "apps-overview|lib/apps/metrics|appForEntityType|APP_CRON_JOBS" app lib components` → sin resultados;
  - eslint limpio.
- [ ] **Step 4:** informar. Commit: `feat(ti): Integraciones en su propia pantalla; fuera el uso por módulo`.

### Task 8: Integración y verificación final (sesión principal)

- [ ] **Step 1:** commitear por rutas lo de cada línea, al recibir su informe. Después,
  `git status --short` y `git stash list` → sin restos.
- [ ] **Step 2: Puertas en una sola espera:**
  `bash scripts/run-resource-guard.sh bash -c 'npm run typecheck && npm run lint && npm run test:fast && npm run db:verify-migrations'`.
  Expected: todo verde. Arreglar y repetir lo que falle.
- [ ] **Step 3: PGlite dirigidos:** `pwa-heartbeat-pglite`, `field-apps-overview-pglite`,
  `module-toggles`, `app-visits-pglite` y `mantencion-sync-pglite` → PASS. Después,
  `npm run test:pglite` completo una vez.
- [ ] **Step 4: E2E aislada.**
  - Commit y `git worktree add /home/allopze/dev/chome/bodega-wt/e2e-<sha> HEAD`.
  - Base propia `bodega_e2e_tiapps` en :55432 y puerto propio. Revisar antes
    `ss -ltnp | grep :3100` y `pgrep -af "playwright test"`.
  - Specs: `ti-apps`, `ti-integraciones`, `ti-modulo`, `ppa-offline`, `ppa-flow`,
    `tae-public-flow` y `tae-ppa-coexistence`. Expected: PASS.
  - Borrar el worktree desechable.
- [ ] **Step 5: Navegador.**
  - Dev propio `npx next dev --webpack -p 3003` desde el worktree, contra `bodega_dev`
    migrada a 0400, con las variables de :3003.
  - Sembrar avisos `QA_` por la ruta: los cuatro estados en las tres apps, uno con
    versión vieja y uno con enlace revocado.
  - Abrir `/ppa` y `/tae` y ver que sale el aviso.
  - Recorrer `/ti/apps`, los tres detalles con sus filtros y `/ti/integraciones` en
    escritorio y móvil. Consola y red limpias.
- [ ] **Step 6:** informe en `qa/reports/2026-11-22-ti-apps-terreno.md` (alcance
  recorrido, hallazgos, brechas). Commit.
- [ ] **Step 7:** revisión final de la rama, actualizar la memoria e informar al usuario.
  No mergear a main sin su OK.
