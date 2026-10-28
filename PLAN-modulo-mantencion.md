# Plan · Módulo de mantención de equipos (preventiva y correctiva)

Rama: `feat/mantencion-equipos` · Inicio: 28-10-2026 · Especificación: prompt del 28-10-2026 +
prototipo `docs/mantencion/referencias/mantencion-chome-prototipo.html` + `seed-mantencion.json`.

## 1. Reconocimiento del repositorio (§3)

| # | Tema | Hallazgo | Ruta |
|---|---|---|---|
| 1 | Stack | Next.js 16.4 App Router (`proxy.ts`, no middleware), PostgreSQL + Drizzle 0.45 (`postgres-js`), NextAuth 5 beta (JWT), Tailwind v4, React 19.2, Zod 4, Vitest 4 (+PGlite), Playwright 1.62. Sin pnpm: npm. | `package.json`, `next.config.ts`, `db/index.ts` |
| 2 | Roles y permisos | RBAC en BD (`roles`, `permissions`, `role_permissions`, `user_roles`). Permisos declarados por manifest de módulo (`permissions`, `permissionMeta`, `defaultGrants`), derivados en `SYSTEM_PERMISSIONS`; roles en `SYSTEM_ROLES`. Backend: `requirePermission` / `guardPermission` / `can()` (incluye control de interruptor de módulo). El JWT recarga RBAC en cada request. | `modules/*/manifest.ts`, `modules/registry.ts`, `lib/auth/system-rbac.ts`, `lib/auth/can.ts`, `lib/auth/auth.ts`, `lib/auth/rbac.ts` |
| 3 | Navegación | Sidebar derivado del registry: `nav[].areaId` + `group` (encabezado) + `iconName` (mapa `NAV_ICONS`). Área `control-operacional` ya existe. Activo por segmento (`pathBelongsToHref`). | `components/layout/nav-items.ts`, `areas.ts`, `nav-icons.tsx` |
| 4 | Equipos | **Existe** catálogo de flota: `fuel_vehicles` (patente única, `code` interno, `equipment_type_id`, `brand` texto, `model`, `year`, `worksite_id`, `is_active`). Tipos en `fuel_equipment_types` con `default_meter_type` (`odometer`/`hour_meter`). Se **reutiliza y extiende** con `mant_equipment_profiles` (1:1). | `db/schema/fuel-vehicles.ts`, `db/schema/fuel-equipment-types.ts` |
| 5 | Faenas y personas | Faenas: `worksites` (+ `code` tipo `FN-001`). Asignación usuario↔faena: `worksite_users` (se reutiliza; no se crea `mant_usuario_faena`). Personal: `workers` (sin rol de conductor; nombres separados, RUT). Alta de faena: `app/(app)/admin/faenas/actions.ts` (crea `worksites` + `ensurePreventionProgramSlotsForWorksiteTx`). | `db/schema/worksites.ts`, `db/schema/users.ts` |
| 6 | Archivos | Disco local bajo `STORAGE_PATH` (`storage/` por defecto), prefijo por módulo, nombre validado (`isSafeStorageName`). Validación por *magic bytes* (`validateFileBuffer`, `MimeType.IMAGE`). Se sirven por route handler con verificación de alcance (patrón `app/api/ti/photos/[id]`). | `lib/storage/config.ts`, `lib/storage/helpers.ts`, `lib/file-validation.ts`, `lib/security/file-response.ts` |
| 7 | Auditoría | `audit_log` vía `recordAudit({ action, entityType, entityId, entityCode, oldState, newState, reason, worksiteId })` (IP resuelta sola). Acción `export` disponible. | `lib/audit.ts`, `db/schema/audit.ts` |
| 8 | PDF y Excel | Excel: `exceljs` + `buildXlsxBuffer` / `sanitizeCell` / hoja de metadatos (`addExportMetadataSheet`) / `EXCEL_DATETIME_FORMAT`; descarga con `ExportButton` (base64). PDF: página `app/(print)/…` impresa con Chromium (`renderPrintPage`, `browser-pool`). | `lib/reports/export-module/excel-builder.ts`, `lib/reports/excel-dates.ts`, `components/ui/export-button.tsx`, `lib/pdf/render-print-page.ts` |
| 9 | Pruebas | Unitarias: `npm run test:fast` (Vitest, jsdom). BD: `npm run test:pglite` (Postgres WASM con migraciones completas; los archivos se registran en `tests/pglite-files.ts`). E2E: `npm run test:e2e` (Playwright, servidor propio :3100, `e2e/setup-db.ts` recrea el esquema; **borra `.next`** → correr en worktree desechable). Helpers: `e2e/helpers.ts` (`login`, `textoVisible`, `listRecord`). | `vitest*.config.ts`, `tests/pglite-files.ts`, `playwright.config.ts`, `e2e/` |
| 10 | Mantención antigua | Módulo `mantenciones`: rutas `/mantenciones/*`, `/api/mantenciones/*`; tablas `maintenance_plans`, `maintenance_records`, `maintenance_tasks`, `maintenance_parts`, `maintenance_labor`, `maintenance_documents`, `maintenance_document_policies`; permisos `mantenciones:view|create|edit|approve_costs`; storage `storage/mantenciones/`. **No se toca.** | `modules/mantenciones/manifest.ts`, `db/schema/maintenance.ts`, `app/(app)/mantenciones/` |
| — | PWA existentes | TAE (`/tae`, pública, SW `public/tae-sw.js`, cola IndexedDB `lib/pwa/tae-offline-queue.ts`), PPA (`public/sw.js`), RE-20 (`public/re20-sw.js`, sólo shell sin datos). Compresión: `lib/pwa/image-compress.ts`. `fake-indexeddb` ya es devDependency. | `public/*.js`, `lib/pwa/` |
| — | Proxy | Exige sesión en todo lo no público, **incluido `/api`**, y verifica origen en mutaciones `/api`. Lo público se lista en `PUBLIC_PATHS` y se autentica dentro del handler. | `proxy.ts`, `lib/security/public-paths.ts`, `lib/security/same-origin.ts` |
| — | Interruptores de módulo | Rutas → módulo por navegación + `ROUTE_OWNER_ALIASES`; permiso → módulo por registry. Nombre visible en `MODULE_LABELS`. | `lib/services/module-toggles*.ts` |
| — | Límite de tasa | `consumeFixedWindowLimit(key, { maxAttempts, lockMs })` persistente. | `lib/services/rate-limit.ts` |

## 2. Decisiones de arquitectura

1. **Equipo = `fuel_vehicles` + `mant_equipment_profiles`.** Un equipo entra al módulo cuando tiene perfil.
   Código → `fuel_vehicles.code`; patente → `plate` (normalizada, regla 16); tipo → `equipment_type_id`
   (la unidad km/h se deriva de `fuel_equipment_types.default_meter_type`); faena → `worksite_id`;
   modelo/año → `model`/`year`; baja → `is_active = false` + `mant_equipment_profiles.retired_reason`.
   El perfil guarda marca (catálogo cerrado `mant_brands`, y se copia el nombre a `fuel_vehicles.brand`
   para que la flota lo siga mostrando), pauta, lectura inicial y «sin patente».
2. **Faena = `worksites` + `mant_worksite_settings`** (código de folio de 3 letras, único). «Nueva faena…»
   crea la faena con el mismo servicio que Administración (se extrae a `lib/services/worksite-create.ts`).
3. **Usuarios↔faenas = `worksite_users`** (mecanismo existente).
4. **Roles nuevos**: `mecanico` y `supervisor_mantencion` (no globales). La jefatura es el rol existente
   `jefe_mantencion` (global). `administrador` recibe todo; `jefa_chome` sólo lectura y exportación.
5. **Permisos** (`modules/mantencion-equipos/manifest.ts`, módulo `mantencion_equipos`):
   `mant:app:use`, `mant:records:view_own|view_worksite|view_all|observe|review|void`,
   `mant:equipment:manage`, `mant:schedules:manage`, `mant:devices:manage`, `mant:export`.
6. **Rutas**: app del mecánico `/m/mantencion` (grupo `app/(mecanico)`, pantalla completa, sin AppShell);
   jefatura `/mantencion/{panel,registros,registros/[id],equipos,equipos/[id],equipos/nuevo,equipos/importar,pautas,pautas/[id],dispositivos}`;
   APIs `/api/mantencion/*`. Ninguna choca con `/mantenciones`.
7. **Sincronización con credencial de dispositivo.** `POST /api/mantencion/dispositivo` (con sesión) emite
   un token de 30 días por (usuario, dispositivo); en BD sólo su SHA-256. Las rutas `/api/mantencion/sync/*`
   están en `PUBLIC_PATHS` y **autentican sólo con `Authorization: Bearer`** dentro del handler (recargan
   RBAC desde BD, verifican `mant:app:use`, usuario activo, interruptor del módulo y límite de tasa). Así la
   cola de una tablet compartida se envía con la credencial de su autor aunque la sesión sea de otro. Como
   no usan cookie, no son susceptibles a CSRF.
8. **Versiones de pauta**: `mant_schedule_versions` guarda el snapshot de cada versión. El borrador conserva
   su versión; el servidor revalida contra esa versión (no contra la vigente).
9. **Estado de mantención** se calcula por consulta (`lib/services/mantencion/fleet.ts`) con las reglas puras;
   no se cachea (ver desviación D4).
10. **Reglas de negocio puras** en `lib/mantencion/` (sin BD ni Node): las usa el teléfono sin señal y el
    servidor al recibir, con los mismos contratos Zod (`lib/mantencion/contracts.ts`).

## 3. Migración

Una sola migración aditiva: `db/migrations/0361_mantencion_equipos.sql` (generada con `drizzle-kit generate`,
checksum registrado). Crea 25 tablas `mant_*`; **no altera ninguna tabla existente**. Reversión: `DROP` de las
tablas `mant_*` (no hay datos previos que restaurar). Los permisos y roles nuevos no van en la migración: los
siembra `sync-rbac`/`db:seed` desde los manifests (regla del repo).

| Grupo | Tablas |
|---|---|
| Catálogos | `mant_worksite_settings`, `mant_brands`, `mant_workshops`, `mant_work_types`, `mant_oils`, `mant_drivers` |
| Equipos | `mant_equipment_profiles`, `mant_equipment_history` |
| Pautas | `mant_schedules`, `mant_schedule_intervals`, `mant_schedule_groups`, `mant_schedule_items`, `mant_schedule_item_intervals`, `mant_schedule_brand_rules`, `mant_schedule_versions` |
| Registros | `mant_records`, `mant_record_items`, `mant_record_correctives`, `mant_record_parts`, `mant_record_drivers`, `mant_record_photos`, `mant_workshop_updates`, `mant_record_voids`, `mant_record_observations`, `mant_folio_counters` |
| Dispositivos | `mant_device_credentials` |

Índices mínimos de §7 incluidos (`mant_records(vehicle_id, work_date desc)`, `(worksite_id, work_date)`,
`(registered_by)`, `(status)`, `mant_record_items(record_id)`), más `check` para cada invariante de §8 que el
motor puede garantizar (motivo de NR, horas 0,5–72 en pasos de 0,5, ejecutor coherente, fecha de ingreso si
sigue en taller, preventiva completa, nota/fecha de actualización de taller).

## 4. Mapeo de la especificación a archivos

| § | Archivos |
|---|---|
| §6 permisos | `modules/mantencion-equipos/manifest.ts`, `modules/registry.ts`, `lib/auth/system-rbac.ts`, `lib/services/mantencion/access.ts`, `lib/services/module-toggles*.ts`, `lib/security/public-paths.ts` |
| §7 datos | `db/schema/mantencion-{catalogs,schedules,records,devices}.ts`, `db/migrations/0361_mantencion_equipos.sql` |
| §8 reglas | `lib/mantencion/{types,normalize,readings,schedule,status,format,contracts}.ts` + `lib/mantencion/__tests__/` |
| §9 app | `app/(mecanico)/m/mantencion/`, `components/mantencion/app/`, `lib/mantencion/client/`, `public/mant-sw.js`, `public/mant-manifest.json`, `public/mant-icon-*.png` |
| §10 jefatura | `app/(app)/mantencion/{panel,registros,equipos,pautas,dispositivos}/`, `components/mantencion/` |
| §11 API | `app/api/mantencion/{dispositivo,sync/*,fotos/[id],registros/[id]/pdf,export/*}` + server actions por página |
| §12 exportaciones | `lib/services/mantencion/export-*.ts`, `app/(print)/mantencion/registros/[id]/page.tsx` |
| §13 carga inicial | `scripts/seed-mantencion.ts` (`npm run db:seed:mantencion`) |
| §15 seguridad | `lib/services/mantencion/{device-credentials,sync-auth}.ts`, auditoría en cada servicio de escritura |
| §16 pruebas | `lib/mantencion/__tests__/*.test.ts`, `lib/__tests__/mantencion-*-pglite.test.ts`, `e2e/mantencion-*.spec.ts` |

## 5. Contratos fijados en la fase 0 (no se cambian sin coordinar)

- `lib/mantencion/types.ts`, `normalize.ts`, `readings.ts`, `schedule.ts`, `status.ts`, `format.ts` — reglas puras.
- `lib/mantencion/contracts.ts` — payloads y respuestas de `/api/mantencion/sync/*` y del catálogo.
- `lib/services/mantencion/fleet.ts` — `loadFleet({ scope, includeRetired, vehicleIds })`: única fuente del estado de equipo.
- `lib/services/mantencion/access.ts` — `viewerFromSession`, `recordVisibility`, `recordVisibilitySql`, `canSeeRecord`, `equipmentScope`, `canObserveRecord`.
- `lib/services/mantencion/schedule-versions.ts` — `buildScheduleSnapshot`, `publishScheduleVersion` (toda edición de pauta termina aquí), `getScheduleSnapshot`, `getCurrentScheduleSnapshots`.
- `lib/storage/config.ts` — `resolveMantencionDir`, `createMantencionFilePath`, `resolveMantencionFile` (`storage/mantencion/`).

## 6. Líneas de trabajo (ejecución en paralelo, archivos sin cruces)

| Línea | Dueña de | Entrega |
|---|---|---|
| **L1 · Servidor y sincronización** | `lib/services/mantencion/{device-credentials,sync-auth,catalog,photos,records-create,folio,workshop-updates,record-lifecycle,worksites,catalogs}.ts`, `lib/services/worksite-create.ts` (+ uso en `admin/faenas/actions.ts`), `app/api/mantencion/{dispositivo,sync/**,fotos/[id]}`, `scripts/seed-mantencion.ts`, script npm | Emisión/revocación de credencial, catálogo con ETag, fotos (PUT idempotente, sha256, magic bytes, 10 MB), registro (idempotente, revalida §8, folio con bloqueo), taller, respuesta a observación, anular/observar/revisar (servicio), seed idempotente con conciliación por código. Pruebas PGlite: idempotencia ×3, 20 folios concurrentes, revalidación, sha256 distinto, matriz de permisos y alcance. |
| **L2 · App del mecánico** | `app/(mecanico)/**`, `components/mantencion/app/**`, `lib/mantencion/client/**`, `public/mant-sw.js`, `public/mant-manifest.json`, íconos | PWA offline (IndexedDB, cola, fotos Blob con sello y compresión, PIN local, cuentas por dispositivo, Background Sync, reintentos), todas las pantallas del §9. Pruebas unitarias de cola/PIN/sello con `fake-indexeddb`. |
| **L3 · Jefatura: panel, registros, detalle, PDF** | `app/(app)/mantencion/{page.tsx,panel,registros}/**`, `app/(print)/mantencion/**`, `app/api/mantencion/{registros,export/registros,export/panel}/**`, `lib/services/mantencion/{records-query,panel,export-records,export-panel,record-pdf}.ts`, `components/mantencion/jefatura/registros/**` | Panel con KPI clicables y gráficos, lista filtrable/paginada/ordenable, detalle con visor, observar/anular/revisar, Excel (5 hojas) y PDF archivado. |
| **L4 · Jefatura: equipos, pautas, dispositivos** | `app/(app)/mantencion/{equipos,pautas,dispositivos}/**`, `lib/services/mantencion/{equipment,equipment-import,schedules,schedule-assign,export-equipment,export-schedules,devices-admin}.ts`, `components/mantencion/jefatura/{equipos,pautas}/**` | Lista/ficha/alta/edición/baja/importación de equipos con historial; pautas (lista, nueva, editor con matriz, reglas por marca, deshacer, asignación agrupada); revocación de dispositivos; Excel. |
| **Cierre (sesión principal)** | `e2e/mantencion-*.spec.ts`, `docs/mantencion/README.md` | Integración, typecheck/lint, suites, E2E 1–8, verificación en navegador, accesibilidad, tamaño de archivos. |

Archivos compartidos que sólo toca **una** línea: `components/layout/top-bar.tsx` (L3 agrega
`/mantencion/registros` a `ROUTES_WITH_OWN_SEARCH`), `tests/pglite-files.ts` (cada línea agrega sólo sus
entradas, con `Edit` puntual), `package.json` (sólo L1: script `db:seed:mantencion`).

## 7. Desviaciones respecto del prompt

| # | Desviación | Motivo |
|---|---|---|
| D1 | Nombres de tablas `mant_*` con columnas en inglés (`work_date`, `registered_by`…) y no en español. | Convención del repositorio (todas las columnas en inglés); el prompt permite adaptar. |
| D2 | No se crean `mant_tipos_equipo` ni `mant_usuario_faena`; tampoco una tabla de faenas propia. | Ya existen `fuel_equipment_types` (con unidad por medidor), `worksite_users` y `worksites` (§3: reutilizar). |
| D3 | `codigo` de equipo único **validado en el servicio** (normalizado), sin índice único en BD. | `fuel_vehicles.code` es nulo y no único desde siempre; un índice único podría fallar en producción si hay códigos repetidos que no puedo verificar sin autorización. El seed reporta duplicados. |
| D4 | El estado de mantención se calcula por consulta, sin vista materializada. | ~120 equipos: tres consultas indexadas. Una caché quedaría desfasada justo después de recibir o anular un registro. |
| D5 | El EXIF se conserva como metadatos (JSON + `taken_at_exif`), no el archivo original. | La foto se comprime y sella en el teléfono (canvas), que descarta EXIF; se extrae antes de comprimir. Subir el original duplicaría datos móviles. |
| D6 | Permisos extra `mant:records:review` y `mant:devices:manage`. | El prompt pide que sólo jefatura marque «revisado» y revoque dispositivos, pero no les asigna permiso. |
| D7 | «Cambiar de cuenta» local exige PIN también con señal; «Entrar con otra cuenta» pasa por el login normal. | Un solo camino para cambiar de autor en la cola; con señal, agregar una cuenta nueva sí requiere contraseña. |
| D8 | La sincronización usa siempre la credencial de dispositivo (nunca la cookie). | Tablet compartida y sesión expirada (§9) + elimina CSRF en rutas públicas. |
| D9 | Jefatura usa los tokens de la plataforma (danger/warning/success de `DESIGN.md`) para los estados; la app del mecánico usa la paleta del prototipo (verde #1e6e3e seleccionado). Gráficos: #1e6e3e / #f39200. | §14: reutilizar tokens existentes; la app es una superficie propia, de pantalla completa, validada en el prototipo. Los estados siempre llevan texto. |
| D10 | Mecánicos del seed: no se crean cuentas sin correo. El script vincula cuentas existentes por nombre y, con `--correos <archivo>` (fuera del repo), crea invitaciones con rol y faena. | La tabla `users` exige correo y el prompt prohíbe contraseñas; la invitación es el flujo de alta de la plataforma. |
| D11 | Cada fase cierra con typecheck + pruebas del módulo; la suite completa y las E2E corren al cierre. | Preferencia registrada del usuario para trabajos largos; las E2E borran `.next` y se corren en worktree desechable. |
| D13 | El seed lee `db/seed/mantencion-seed.json` (copia byte a byte de `docs/mantencion/referencias/seed-mantencion.json`). | `/docs/**` es lista blanca de `.md`/`.svg` en `.gitignore` (evita versionar documentos con datos personales), así que la referencia no llegaría a la imagen de producción. Las planillas y PDF de referencia quedan locales, sin versionar. |
| D12 | Conductores en `mant_drivers` con vínculo opcional a `workers`. | La planilla trae «APELLIDO APELLIDO NOMBRE» sin RUT; vincular a ciegas con `workers` podría equivocar a la persona. |

## 8. Decisiones abiertas aplicadas (§19)

| # | Valor aplicado | Dónde |
|---|---|---|
| 1 | `*`/`**` se quitan del nombre; el ítem lleva `note = "Por confirmar"`, visible en el editor. | seed + editor de pautas |
| 2 | Mapeo `actividadPlanilla → claveItem` del seed; «Diagnóstico electrónico motor» queda sin ítem (`item_id` nulo). | seed |
| 3 | Los 37 ítems de maquinaria aplican en los 4 intervalos. | seed |
| 4 | Masisa, Rodantes, Mininco no se crean; jefatura puede crearlas desde la ficha de equipo. | seed |
| 5 | «Otro mecánico» permitido con «Registrado por X en nombre de Y». | app, detalle, PDF, Excel |
| 6 | Horas 0,5–72; aviso sin bloqueo sobre 12 h. | contratos + app |
| 7 | Tablet compartida con PIN local según §9. | app |
| 8 | «Orden de trabajo» opcional en la correctiva. | contratos + app |
| 9 | Mecánicos asignados a la faena del seed. | seed |
| 10 | El historial de Google Forms no se migra; queda preparado el importador de registros (`lib/services/mantencion/legacy-import.ts`, sin UI). | L1 |

## 9. Riesgos y seguimiento

- El menú de Control operacional mostrará «Mantenciones» (módulo antiguo) y el grupo «Mantención» (nuevo).
  Se recomienda apagar el antiguo con su interruptor cuando el nuevo esté en uso.
- El seed toca la flota compartida (`fuel_vehicles`): concilia por código y luego por patente, nunca duplica,
  y reporta diferencias sin sobrescribir datos de flota existentes (salvo marca nula).
- Las credenciales de dispositivo viven en IndexedDB del equipo: quien tenga el teléfono desbloqueado puede
  sincronizar como ese mecánico hasta revocarla. Por eso duran 30 días, se revocan desde jefatura y el PIN
  protege el cambio de cuenta.
