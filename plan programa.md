# Plan: Hacer funcional el módulo PDTP (Programa de Trabajo Preventivo SG-SST)

## Context

El submódulo `prevencion/pdtp` **digitaliza con altísima fidelidad** el
`PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST (87 actividades).xlsx` (fuente
canónica congelada desde 2026-07-22 en `PDTP_2026_PROGRAM_SOURCE`; antes
`PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx`): parsea el libro real
(`lib/services/prevention-pdtp-catalog.ts`), que valida la **estructura**
—numeración de actividades estrictamente creciente y única, hojas oficiales y
pares P/E—, mientras el contrato del adaptador (`PDTP_2026_INVARIANTS`) fija las
87 actividades / 8 objetivos; reconstruye las 8 hojas oficiales como vistas
filtradas, el cronograma semanal P/E (12 meses × 4 semanas), el KPI de
cumplimiento con meta 90 % y el flujo de firma Elaborado → JDPR → Legal → Activo. La base (P0–P3 de
`docs/auditoria/PLAN_PREVENCION.md`) está sólida y con RBAC completo.

El problema no es fidelidad: es que **se usa igual que el Excel**. La tabla
muestra siempre 87 filas × 12 meses; para registrar hoy el prevencionista busca
su fila entre 87 y elige mes+semana en un `<select>`; nada indica "esta semana"
ni "quedó pendiente"; la evidencia es un texto fijo (`"Registro desde tabla
PDTP"`); la aprobación son botones sueltos por fila; no hay recordatorios; y la
cantidad planeada es un número global aunque el propio Excel dice "según la
cantidad de equipos de la faena". Este plan lo convierte en una herramienta
operativa de terreno **reutilizando** los servicios, storage, notificaciones y
cron que ya existen.

Decisiones confirmadas con el usuario: alcance **completo** (Fases 1–3),
evidencia con **foto/archivo adjunto**, y **sí** abordar metas por faena
(incluye migración).

---

## Fase 0 — Lógica derivada compartida (fundación, hacer primero)

Un solo lugar del que dependen la vista semanal, los badges y el cron. Evita
duplicar el cálculo en 3 sitios (fix de raíz, no por-caller).

**Nuevo:** `lib/services/pdtp/period.ts` (funciones puras, sin DB):
- `currentPdtpPeriod(now = new Date()): { year; month; week }` — `month` = mes
  natural (1–12); `week` = `Math.min(4, Math.ceil(díaDelMes / 7))`. **Ojo:** el
  modelo del Excel es 4 semanas-por-mes (ver `extractSchedule` en
  `prevention-pdtp-catalog.ts:182`: `month = floor(seq/4)+1`, `week = seq%4+1`),
  **no** ISO week. Mantener esa semántica.
- `deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)` → por
  actividad: `'pending' | 'executed' | 'overdue' | 'not_scheduled'`.
  `overdue` = planeado > 0 en un período (mes/semana) ya pasado y sin ejecución.

**Test:** `lib/__tests__/pdtp-period.test.ts` con `assert` — casos borde de
semana (día 1, 7, 8, 28, 31) y matriz de estados. Es el "runnable check" de la
lógica no trivial.

---

## Fase 1 — Usabilidad en terreno

### 1.1 Vista "Mi semana" por defecto
- `pdtp/page.tsx`: leer `?vista=semana|anual` (default `semana`) y período actual
  vía `currentPdtpPeriod()`. Preseleccionar la faena del usuario ya se hace
  (`selectedWorksiteId`).
- Reusar `getPdtpSheetView` (ya trae `monthlyPlanned/monthlyExecuted` por
  actividad). Filtrar en la vista semanal a actividades con `plannedQuantity > 0`
  en el mes actual, marcando estado con `deriveActivityStatus`.
- `pdtp-sheet-table.tsx`: añadir modo compacto (columnas N°/Actividad/Responsable
  /Estado/Registrar) además del grid anual completo; toggle de vista arriba
  (junto a `PdtpSheetPicker`).

### 1.2 Badge "atrasado" / estado
- Chip de estado por fila en ambas vistas usando el resultado de
  `deriveActivityStatus` (`ejecutado` verde / `pendiente` neutro / `atrasado`
  rojo). Cálculo puro sobre datos ya cargados — sin queries nuevas.

### 1.3 Evidencia real (foto/archivo)
- **Nuevo route:** `app/api/prevencion/pdtp/evidence/route.ts` — `POST`
  multipart, guard `prevention:pdtp:manage`, calcado de
  `app/api/prevencion/documentacion/upload/route.ts`. Reusar
  `lib/storage/helpers.ts` (`mkdirp`/`writeBuffer`) + validación de magic-bytes
  y tamaño (mismo criterio que documentación). Devuelve la ruta guardada.
- `pdtp-execution-form.tsx`: reemplazar el `<input type="hidden"
  name="evidenceText" value="Registro desde tabla PDTP">` por un campo de texto
  real (opcional) + input de archivo que sube al route y adjunta la ruta a
  `evidencePhotos`/`evidenceUrl`.
- `markPdtpExecutionAction` (`pdtp/actions.ts:33`): pasar también `evidenceUrl` y
  `evidencePhotos` (el servicio `markPdtpExecution` y el schema
  `pdtpExecutionSchema` **ya los soportan** — hoy solo el action los omite).

---

## Fase 2 — Supervisión

### 2.1 Bandeja de aprobación
- **Nuevo servicio:** `listPendingPdtpExecutions(year, scope)` en
  `lib/services/pdtp/executions.ts` — ejecuciones `status = 'submitted'` dentro
  del scope, con join a actividad/faena. Respetar `assertWorksiteAccess`.
- **Nueva ruta:** `app/(app)/prevencion/pdtp/aprobaciones/page.tsx` (guard
  `prevention:pdtp:approve`) — lista unificada de pendientes con el patrón visual
  de `/aprobaciones`. Reusar `approvePdtpExecutionAction` (ya existe). Enlace
  desde el `PageHeader` de `pdtp/page.tsx`. Mantener los botones por fila como
  atajo, pero la bandeja es el flujo principal.

### 2.2 Tarjeta de cumplimiento en el dashboard
- `app/(app)/dashboard/page.tsx`: añadir, gated por `can(session,
  "prevention:pdtp:view")`, una tarjeta compacta con % de cumplimiento anual +
  Nº de pendientes de la semana. Reusar `getPdtpComplianceIndicators` (ya existe)
  y `listPendingPdtpExecutions` de 2.1. Enlaza a `/prevencion/pdtp`.
  (`/prevencion` es la lista de Evaluaciones SST, no un dashboard — por eso va en
  `/dashboard`.)

### 2.3 Motor de recordatorios (cron)
- **Nuevo servicio:** `findPdtpWeeklyPending()` — para el programa activo y el
  período actual + anterior, faenas con actividades planeadas sin ejecución;
  resolver destinatarios por permiso/rol responsable.
- **Nueva ruta cron:** `app/api/cron/pdtp-weekly-reminders/route.ts`, calcada de
  `app/api/cron/sst-weekly-alerts/route.ts`. Notificar con `createNotifications`
  + `getUserIdsWithPermissionForWorksite` (`lib/services/notifications.ts`).
  Registrar el schedule en la config de cron (junto a los cron existentes).

---

## Fase 3 — Metas planificadas por faena (migración)

- **Schema:** nueva tabla `pdtp_activity_schedule_overrides` en
  `db/schema/prevention/pdtp.ts`: `(activityId, worksiteId, year, month, week,
  plannedQuantity)` con unique `(activityId, worksiteId, year, month, week)`.
  Cuando existe override para la faena seleccionada, reemplaza la celda global.
- **Migración:** `npm run db:generate` (nunca editar journal/SQL a mano — regla
  de `AGENTS.md`); verificar que un segundo `db:generate` reporte "No schema
  changes".
- **Servicios:** en `loadProgramScheduleAndExecutions`
  (`lib/services/pdtp/helpers.ts:86`) — punto único que ya recibe `worksiteId` —
  hacer left-join de overrides y preferirlos. `getPdtpSheetView` y
  `getPdtpComplianceIndicators` heredan el cambio sin tocar su lógica.
- **UI + action:** formulario (perm `prevention:pdtp:manage`) para que la
  jefatura fije la cantidad por faena de una actividad; nuevo action + schema Zod
  (`lib/validation/prevention-module/pdtp.ts`).
- **Export:** `buildPdtpExport` (`sheets.ts:89`) usa `getPdtpSheetView`, así que
  el Excel ya refleja la meta por faena (regla Excel-only intacta).

---

## Archivos clave

**Nuevos**
- `lib/services/pdtp/period.ts` + `lib/__tests__/pdtp-period.test.ts`
- `app/api/prevencion/pdtp/evidence/route.ts`
- `app/(app)/prevencion/pdtp/aprobaciones/page.tsx`
- `app/api/cron/pdtp-weekly-reminders/route.ts`
- Tabla `pdtp_activity_schedule_overrides` (+ migración generada)

**Modificados**
- `app/(app)/prevencion/pdtp/page.tsx` (vista semanal, enlaces)
- `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx` (modo compacto + estados)
- `app/(app)/prevencion/pdtp/pdtp-execution-form.tsx` (evidencia real)
- `app/(app)/prevencion/pdtp/actions.ts` (evidenceUrl/photos)
- `lib/services/pdtp/executions.ts` (`listPendingPdtpExecutions`)
- `lib/services/pdtp/helpers.ts` + `sheets.ts` + `compliance.ts` (overrides)
- `app/(app)/dashboard/page.tsx` (tarjeta cumplimiento)
- `db/schema/prevention/pdtp.ts`, `lib/validation/prevention-module/pdtp.ts`

**Reutilizados (no reimplementar)**
- `getPdtpSheetView`, `getPdtpComplianceIndicators`, `loadProgramScheduleAndExecutions`
- `lib/storage/helpers.ts` + patrón de `documentacion/upload/route.ts`
- `createNotifications`, `getUserIdsWithPermissionForWorksite`, patrón `sst-weekly-alerts`
- `approvePdtpExecutionAction`, `resolveWorksiteScope`, `assertWorksiteAccess`

---

## Verificación

1. **Unit:** `npm test lib/__tests__/pdtp-period.test.ts` + tests de servicio
   nuevos (week view filtra por período; `listPendingPdtpExecutions` respeta
   scope; override por faena gana sobre global; cron arma destinatarios).
2. **Action/route:** test de `markPdtpExecutionAction` con evidencia (url+photos
   persistidos) y del route de upload (rechaza mime/tamaño inválido).
3. **Suite completa:** `npm test` verde, `npm run lint` limpio.
4. **Migración:** tras `npm run db:generate`, un segundo `db:generate` reporta
   "No schema changes".
5. **End-to-end (dev server / `/run`):** activar programa → entrar a
   `/prevencion/pdtp` (default "Mi semana", solo actividades de la semana con
   chip de estado) → registrar ejecución con foto → verla en la bandeja de
   `/prevencion/pdtp/aprobaciones` y aprobarla → confirmar tarjeta de
   cumplimiento en `/dashboard` → fijar meta por faena distinta y ver que el
   grid/cumplimiento la reflejan → disparar el cron y confirmar la notificación.

## Fuera de alcance (documentado en la auditoría)
IG/días perdidos, EPP stock FK, restricciones de salud PPA, equipos→mantención,
DIAT PDF, escalamiento alcotest — requieren decisiones de producto ya listadas
en `docs/auditoria/PLAN_PREVENCION.md` (§ "Estado final 2026-07-01").
