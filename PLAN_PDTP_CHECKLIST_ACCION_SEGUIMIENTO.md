# Plan integral: Checklist → Observaciones → Plan de Acción → Seguimiento → % Cumplimiento en PDTP

Estado: **IMPLEMENTADO (Fases 0-6 completas)** — ver §11 para brechas conocidas y follow-ups.
Módulo: `app/(app)/prevencion/pdtp/` · Schema: `db/schema/prevention/pdtp.ts`
Fecha: 2026-07-14 · Última actualización: 2026-07-14 (sesión de implementación completa)

---

## 0. Diagnóstico del estado actual

El PDTP (Programa de Trabajo Preventivo SG-SST) hoy tiene:

| Entidad | Rol actual | Limitación |
|---|---|---|
| `pdtpActivities` | Actividad con N°, objetivo, texto, responsables | **No tiene checklist** — solo texto libre |
| `pdtpExecutions` | Registro por actividad/faena/período con `executedQuantity` + evidencia | **No verifica calidad**, solo cantidad |
| `getPdtpComplianceIndicators` | `% = ejecutado / planificado` (conteo de actividades con qty>0) | **No mide cumplimiento real** ni cierre de hallazgos |
| — | **No existe** observaciones estructuradas | No hay |
| — | **No existe** plan de acción ligado a PDTP | No hay |
| — | **No existe** seguimiento de acciones | No hay |

**Brecha clave**: hoy se "ejecuta" tipeando un número y subiendo una foto. No hay verificación de criterios, ni generación de hallazgos, ni cierre de brechas. El % de cumplimiento es cosmético.

**Patrón reutilizable**: el módulo de Evaluaciones SST (`sstEvaluations → sstResponses → sstActionPlan → sstScheduledFollowups`) **ya resuelve** checklist → observación → acción → seguimiento. Se reutiliza su modelo de datos y la librería `lib/sst/checklist.ts` + `lib/sst/types.ts` (`ChecklistDefinition`, `StatusValue`, `FieldKind`, `getSectionAccess`, `getApplicableItems`, `calculateCompliance`).

---

## 1. Modelo de datos objetivo

Flujo:

```
pdtpActivities (actividad del programa)
  └─ pdtpActivityChecklists (plantilla de checklist por actividad)
       └─ pdtpExecutions (ejecución del período, existe hoy)
            └─ pdtpExecutionChecklists (instancia llenada del checklist)
                 └─ pdtpExecutionChecklistResponses (1 fila por ítem: estado + observación)
                      │  (los ítems "no_cumple" generan)
                      └─ pdtpActionPlan (acciones correctivas con responsable/plazo/estado)
                           └─ pdtpActionPlanFollowups (bitácora de seguimiento)
```

### 1.1 Tablas nuevas (en `db/schema/prevention/pdtp.ts`)

Todas usan `text("id")` PK, `timestamp` con timezone y FKs con `onDelete: "cascade"` hacia sus padres.

#### a) `pdtp_activity_checklists` — Plantilla de checklist por actividad
```
id                  text PK
activityId          text NOT NULL  FK → pdtp_activities.id  (cascade)
programId           text NOT NULL  FK → pdtp_programs.id    (cascade)
version             text NOT NULL  -- '01', para versionado
label               text NOT NULL
definitionJson      jsonb NOT NULL -- ChecklistDefinition (lib/sst/types.ts)
isActive            boolean NOT NULL DEFAULT true
createdAt, updatedAt timestamp
UNIQUE (activityId, isActive) WHERE isActive   -- una plantilla activa por actividad
INDEX (programId)
```
- `definitionJson` **reutiliza el tipo `ChecklistDefinition`** de `lib/sst/types.ts` → mismos `FieldKind` (`cumple_nocumple_obs`, `cumple_nocumple_na_obs`, etc.), secciones con `appliesWhen` (para que ciertas secciones apliquen solo a `prevencionista_faena` o `admin_contrato`) y `countsForCompliance`.

#### b) `pdtp_execution_checklists` — Instancia llenada (1 por ejecución)
```
id                    text PK
executionId           text NOT NULL  FK → pdtp_executions.id  (cascade)  UNIQUE
checklistId           text           FK → pdtp_activity_checklists.id     (set null on delete)
definitionSnapshotJson jsonb NOT NULL -- snapshot de la definición al momento de llenar
overallStatus         text NOT NULL DEFAULT 'pendiente'   -- pendiente|en_proceso|completado
porcentajeCumplimiento real          -- 0-100, recalculado al guardar
completedByUserId     text           FK → users.id
completedAt           timestamp
createdAt, updatedAt  timestamp
CHECK overallStatus IN ('pendiente','en_proceso','completado')
```
- `UNIQUE(executionId)` garantiza una sola instancia por ejecución.

#### c) `pdtp_execution_checklist_responses` — Respuestas por ítem (espejo de `sstResponses`)
```
id                      text PK
checklistInstanceId     text NOT NULL  FK → pdtp_execution_checklists.id (cascade)
seccionId               text NOT NULL
itemId                  text NOT NULL
estado                  text           -- StatusValue: 'cumple'|'no_cumple'|'no_aplica'
observacion             text
accionCorrectiva        text
respondedByUserId       text           FK → users.id
respondedAt             timestamp
UNIQUE (checklistInstanceId, seccionId, itemId)
```

#### d) `pdtp_action_plan` — Plan de acción correctivo
```
id                 text PK
executionId        text NOT NULL  FK → pdtp_executions.id (cascade)
n                  integer NOT NULL
origen             text NOT NULL DEFAULT 'manual'   -- 'checklist_item' | 'manual'
seccionId          text           -- si origen = checklist_item
itemId             text           -- si origen = checklist_item
hallazgo           text NOT NULL
accion             text NOT NULL
responsableRole    text NOT NULL   -- 'prevencionista_faena'|'admin_contrato'|'jefe_faena'
responsable        text NOT NULL   -- nombre/display del responsable (o userId)
responsableUserId  text            FK → users.id   -- si es usuario del sistema
plazo              text NOT NULL   -- ISO date 'YYYY-MM-DD'
prioridad          text NOT NULL DEFAULT 'media'   -- 'alta'|'media'|'baja'
estado             text NOT NULL DEFAULT 'pendiente'  -- ver §2.4 enum
createdByUserId    text NOT NULL   FK → users.id
closedAt           timestamp
verifiedByUserId   text            FK → users.id
verifiedAt         timestamp
rejectionReason    text
createdAt, updatedAt timestamp
UNIQUE (executionId, n)
INDEX (executionId), INDEX (estado), INDEX (plazo)
CHECK prioridad IN ('alta','media','baja')
```

#### e) `pdtp_action_plan_followups` — Bitácora de seguimiento
```
id                  text PK
actionPlanItemId    text NOT NULL  FK → pdtp_action_plan.id (cascade)
fecha               text NOT NULL  -- ISO date
estadoAnterior      text
estadoNuevo         text NOT NULL
observacion         text
evidenciaUrl        text
evidenciaPhotos     jsonb NOT NULL DEFAULT '[]'
updatedByUserId     text NOT NULL  FK → users.id
createdAt           timestamp
INDEX (actionPlanItemId, fecha)
```

### 1.2 Migración

- `npm run db:generate` produce la migración — **no editar a mano** el `_journal.json` (regla de AGENTS.md).
- Las tablas son **aditivas**: no tocan `pdtpExecutions` ni `pdtpActivities`. Cero riesgo de romper el flujo actual.
- Seed inicial: **opcional** — si se quiere migrar actividades existentes con un checklist por defecto, se crea un script `db/seed/pdtp-default-checklist.ts` que genere una `definitionJson` mínima de un ítem ("Actividad ejecutada conforme a procedimiento" → `cumple_nocumple_obs`).

---

## 2. Reglas de negocio y flujo

### 2.1 Roles que intervienen (reutilizar `evaluatorRole` de SST)

| Rol | Permiso | Qué hace en el checklist | Qué hace en el plan de acción |
|---|---|---|---|
| `prevencionista_faena` | `prevention:pdtp:execute` | Llena secciones de verificación técnica | Crea hallazgos, ejecuta acciones asignadas, registra seguimiento |
| `admin_contrato` / `jefe_faena` | `prevention:pdtp:approve` | Llena secciones de verificación operacional | Aprueba/cierra acciones, valida evidencia |
| `prevencionista_jefe` / admin | `prevention:pdtp:manage` | Edita plantillas de checklist | Verifica cierre, reabre si procede |

- El **acceso por sección** se calcula con `getSectionAccess(definition, permissions, {canCreate, canViewFull})` de `lib/sst/checklist.ts`, usando `sec.appliesWhen = ['prevencionista_faena']` o `['admin_contrato']`.
- El **scope de faena** se resuelve con `resolveWorksiteScope(session)` ya usado en `app/(app)/prevencion/actions/`.

### 2.2 Ciclo de vida de una ejecución con checklist

```
1. Prevencionista abre la actividad del período → "Iniciar verificación"
   → se crea pdtp_execution_checklists (overallStatus='en_proceso') con snapshot de la definición.
2. Llena ítems (auto-save tipo useChecklistResponses). Cada no_cumple → observación obligatoria.
3. Al completar ítems aplicables → "Enviar revisión"
   → overallStatus='completado', se calcula porcentajeCumplimiento.
4. Automático: cada ítem 'no_cumple' genera 1 fila en pdtp_action_plan (origen='checklist_item',
   hallazgo=observación, estado='pendiente'). El prevencionista puede editar/agregar manuales.
5. Admin contrato / jefe faena revisa → aprueba/rechaza la ejecución (extender pdtpExecutions.status).
6. Responsables ejecutan acciones → registran followups (cambio de estado + evidencia).
7. Al cerrar todas las acciones → la ejecución queda "al día"; si vence plazo → estado 'vencido'.
```

### 2.3 Generación automática del plan de acción

- Al pasar `overallStatus` a `completado`, un servicio `generateActionPlanFromChecklist(instanceId)` recorre las respuestas `estado='no_cumple'` y hace upsert en `pdtp_action_plan` con:
  - `hallazgo` = `observacion` del ítem (o label del ítem si no hay observación),
  - `accion` = `accionCorrectiva` si vino en la respuesta, sino placeholder `"Por definir"`,
  - `responsableRole` = derivado del `appliesWhen` de la sección,
  - `plazo` = fecha de ejecución + 7 días (configurable por `prioridad`: alta=2, media=7, baja=15).
- Ítems manuales: el admin puede agregar filas extra desde el panel de plan de acción.

### 2.4 Estados del plan de acción (enum `PdtpActionEstado`)

```
pendiente → en_proceso → completado → verificado   (cierre)
                  ↘ vencido (plazo < hoy y no completado)
verificado puede volver a → reabierto (si se encuentra que la acción fue ineficaz)
```
- `vencido` es **derivado** en lectura (no persistente): `estado NOT IN ('completado','verificado') AND plazo < today`. Se calcula en el query para reportes; también un cron/job diario puede promoverlo a estado persistente si se prefiere.

---

## 3. Cálculo del % de cumplimiento integral

Reemplazar/complementar `getPdtpComplianceIndicators` con un **cumplimiento ponderado de 3 ejes**:

| Eje | Qué mide | Fórmula | Peso por defecto |
|---|---|---|---|
| **Ejecución** | Se hizo la actividad (cantidad) | `Σ ejecutado / Σ planificado` (existente) | 50% |
| **Verificación** | El checklist salió conforme | `Σ items cumple / Σ items aplicables` (promediado por instancia) | 30% |
| **Cierre** | Los hallazgos se cerraron a tiempo | `Σ acciones (completado+verificado) / Σ acciones` | 20% |

```
cumplimientoIntegral = 0.5*ejec + 0.3*verif + 0.2*cierre   (0–1)
```

- Los **pesos** se guardan en `pdtpPrograms` (nuevas columnas `pesoEjecucion`, `pesoVerificacion`, `pesoCierre`, default 0.5/0.3/0.2) para que cada programa los calibre.
- Nueva función `getPdtpIntegralCompliance(programId|year, worksiteId)` que devuelve los 3 ejes + el ponderado, por mes/trimestre/año (misma forma que la función actual).
- El panel `pdtp-indicators-panel.tsx` muestra los 3 ejes como barras separadas + el ponderado como número grande.

---

## 4. UI / UX (siguiendo reglas de AGENTS.md `page-layout` y `search-architecture`)

Todas las pantallas nuevas viven bajo `app/(app)/prevencion/pdtp/` y reusan `PageHeader`, `PageContainer`, DataTable con `searchKeys` (sin input propio — el TopBar ya filtra).

### 4.1 Editor de plantilla de checklist (por actividad)
- En `pdtp/[programId]/editar/builder-tabs.tsx` → nueva tab **"Checklist"** junto a "Actividades".
- Componente `PdtpChecklistEditor` que envuelve el editor de definición ya existente en SST (reutilizar el builder de `ChecklistDefinition` — buscar el componente de admin de definiciones).
- Por cada actividad de la lista, un acordeón: "Definir checklist" / "Editar checklist (N ítems)".
- Permite seleccionar desde un **catálogo de plantillas** (`pdtp_checklist_library`, análogo a las definiciones SST) para no partir de cero.

### 4.2 Vista de ejecución del período (hoja actual)
- En `pdtp/pdtp-sheet-table.tsx`, la celda de ejecución hojeada muestra:
  - Cantidad ejecutada (hoy) + **badge de estado del checklist** (pendiente/en progreso/completado × color) + **badge de plan de acción** (N pendientes / N vencidas, color signal si hay vencidas).
- El botón "Registrar" abre un **nuevo flujo en 2 pasos**: (1) checklist, (2) resumen + plan generado. Reemplaza el `PdtpExecutionForm` actual por `PdtpExecutionWizard`.

### 4.3 Detalle de ejecución con checklist + plan de acción
- Nueva ruta `pdtp/[programId]/ejecucion/[executionId]/page.tsx` (o pestañas dentro del sheet).
- Secciones: `ChecklistSection` (reutiliza patrón de `prevencion/[id]/checklist-section.tsx`), `ObservacionesSection` (lista no_cumple), `PlanAccionPanel` (reutiliza patrón de `action-plan-panel.tsx`), `SeguimientoTimeline` (nuevo, lista `pdtp_action_plan_followups`).
- `actions` del `PageHeader`: "Enviar revisión" / "Aprobar" / "Rechazar" según rol.

### 4.4 Panel de indicadores
- `pdtp-indicators-panel.tsx` se extiende: además de la barra anual mensual/trimestral, agrega 3 mini-barras (Ejecución/Verificación/Cierre) por mes y el ponderado.

### 4.5 Vista global de planes de acción (transversal)
- Nueva ruta `prevencion/pdtp/acciones/page.tsx` — DataTable con todas las acciones del programa/faena/período, filtros (estado, prioridad, responsable, vencidas), export XLSX (regla `export-rule`: **XLSX no CSV**, reusar el builder de `buildPdtpExport`).

---

## 5. Permisos (tabla `modules/permissions.ts` + seed)

Nuevos permisos a añadir al catálogo RBAC:

| Permission key | Descripción | Roles por defecto |
|---|---|---|
| `prevention:pdtp:checklist:manage` | Crear/editar plantillas de checklist | prevencionista_jefe, admin |
| `prevention:pdtp:checklist:fill` | Llenar checklist en una ejecución | prevencionista_faena, admin_contrato |
| `prevention:pdtp:action:manage` | Crear/editar acciones y seguimiento | prevencionista_faena, admin_contrato, jefe_faena |
| `prevention:pdtp:action:verify` | Verificar cierre de acciones | prevencionista_jefe, admin |

- Se añaden a `modules/permissions.ts` y se siembran vía `db:seed`.
- Los `guardPermission` en server actions reflejan estas claves.

---

## 6. Fases de implementación (entrega incremental)

Cada fase es **deployable** y no rompe lo existente.

### Fase 0 — Cimientos de datos (1–2 días) ✅ COMPLETA

- [x] Añadir 5 tablas + relaciones + tipos a `db/schema/prevention/pdtp.ts`.
- [x] `npm run db:generate` → migración. Verificar "No schema changes" tras generar.
  - Se encontró y reparó una cadena de migraciones rota (0055 referenciada en el journal
    sin su `.sql`, 0054 con `.sql` pero sin snapshot). Nada de eso llegó a aplicarse a
    ninguna BD real (verificado contra `__drizzle_migrations`, tope en 0053). Se truncó
    el journal a 0053 y se regeneró limpio en una sola migración nueva
    (`0054_tan_lady_ursula.sql`), verificada con "No schema changes" tras generar y
    aplicada exitosamente a la BD local (`npm run db:migrate`).
- [x] Re-exportar tipos en `lib/services/pdtp/index.ts`.
- [x] Helpers de ID (`generateId`), enums TS (`PdtpActionEstado`, `PdtpChecklistStatus`).
- [x] Restaurada la unique parcial `pdtp_activity_checklists_activity_active_unique`
      (activityId) WHERE isActive — una auditoría previa había detectado que se había
      eliminado en una migración de seguimiento (0056), quedando como regla solo de
      aplicación (no de BD). Ahora está de vuelta en el schema y migrada.
- **Riesgo**: bajo (tablas aditivas, sin tocar existentes). Confirmado sin impacto en flujo de cantidad existente.

### Fase 1 — Plantillas de checklist (2–3 días) ✅ COMPLETA

- [x] Servicio `lib/services/pdtp/checklists.ts`: CRUD plantillas, get active por actividad.
- [x] Server actions en `app/(app)/prevencion/pdtp/actions/checklist-actions.ts`.
- [x] Tab "Checklist" en el builder del programa (`builder-tabs.tsx` + `checklist-tab.tsx`).
- [x] Editor de definición — **MVP JSON-asistido** (ver §7.6): no existe en el repo (ni
      en SST) un editor visual de `ChecklistDefinition` — las definiciones SST son
      archivos TS estáticos, no hay builder que reutilizar. Se implementó edición de
      la definición como JSON validado en el servidor (zod) + botón "Usar plantilla
      por defecto" para el caso simple. Un editor visual queda como mejora futura.
- [x] Tests: `lib/__tests__/pdtp-checklist-action-plan.test.ts` (cubre plantillas,
      constraint de unicidad a nivel de DB, y el resto de fases 2-5).

### Fase 2 — Llenado de checklist en ejecución (3–4 días) ✅ COMPLETA (con simplificación)

- [x] Servicio `lib/services/pdtp/execution-checklists.ts`: crear instancia, upsert respuestas, calcular %.
- [x] Llenado de checklist en la ejecución — **simplificación deliberada**: en vez de
      un hook `usePdtpExecutionChecklist` + `PdtpExecutionWizard` de 2 pasos que
      reemplaza `PdtpExecutionForm`, se construyó una única página de detalle de
      ejecución (`pdtp/[programId]/ejecucion/[executionId]/page.tsx`) con el checklist,
      el plan de acción y el seguimiento en una sola vista — cubre el mismo flujo
      (iniciar → llenar → enviar revisión) con menos piezas nuevas. `PdtpExecutionForm`
      (cantidad) queda intacto; la hoja del sheet ahora enlaza "Ver verificación →" a
      esta página nueva.
- [x] `pdtp_execution_checklists` se crea al primer "Iniciar verificación" (botón en la página de detalle).
- [x] Marcar el checklist como `completado` al "Enviar revisión" — nueva función
      `submitExecutionChecklist` (orquesta `completeExecutionChecklist` +
      `generateActionPlanFromChecklist`, que antes existían pero nunca se invocaban
      juntas — bug de handoff corregido).

### Fase 3 — Plan de acción (2–3 días) ✅ COMPLETA

- [x] Servicio `lib/services/pdtp/action-plan.ts`: `generateActionPlanFromChecklist`, CRUD manual, transiciones de estado, cálculo de vencidos.
- [x] Server actions en `app/(app)/prevencion/pdtp/actions/checklist-actions.ts`.
- [x] Panel `ExecutionActionPlanPanel` (lista expandible con seguimiento inline por acción).
- [x] Auto-generación al completar el checklist — conectada vía `submitExecutionChecklist` (ver Fase 2).
- Nota: `generateActionPlanFromChecklist` sigue usando `prioridad: "media"` fija para
  ítems auto-generados (no deriva severidad desde el checklist); las acciones manuales
  sí permiten elegir prioridad. Aceptado como límite conocido, no bloqueante.

### Fase 4 — Seguimiento (2 días) ✅ COMPLETA

- [x] Servicio `lib/services/pdtp/followups.ts`: agregar bitácora. Corregido bug real:
      `listVencidas` ignoraba el filtro `programId` (condición tautológica sin aplicar)
      y solo consultaba `estado='pendiente'`, dejando fuera acciones `en_proceso`
      vencidas. Ahora filtra correctamente por programa (join a `pdtp_activities`) y
      por cualquier estado no cerrado.
- [x] Timeline de seguimiento — integrado directamente en `ExecutionActionPlanPanel`
      (expandir una acción muestra su bitácora + formulario de nuevo seguimiento) en
      vez de un componente `SeguimientoTimeline` aparte; evidencia como URL de texto
      (sin selector de archivos todavía — la subida de fotos vía
      `/api/prevencion/pdtp/evidence` queda para una iteración futura).
- [x] Notificaciones: `runPdtpActionPlanVencidasReminders` (nuevo) notifica al
      responsable directo o, si no tiene `responsableUserId`, a quienes tengan
      `prevention:pdtp:action:manage` en la faena. Conectado al cron semanal existente
      (`/api/cron/pdtp-weekly-reminders`).

### Fase 5 — Cumplimiento integral (1–2 días) ✅ COMPLETA

- [x] `getPdtpIntegralCompliance` en `lib/services/pdtp/compliance.ts` (limpiado código muerto).
- [x] Columnas de pesos en `pdtpPrograms` (migradas en Fase 0).
- [x] UI en `pdtp-indicators-panel.tsx` (3 barras + ponderado, componente `IntegralComplianceRow`).
- [x] Actualizado `loadPdtpComplianceSummary` del dashboard (agrega `integralPercent`).
- Nota: los 3 ejes solo se calculan cuando se pasa `worksiteId` explícito — mismo
  contrato que `getPdtpComplianceIndicators` (`loadProgramScheduleAndExecutions` no
  agrega ejecuciones sin faena). No es una regresión introducida aquí; documentado en
  el test de compliance integral.

### Fase 6 — Cierre (1–2 días) ✅ COMPLETA

- [x] Ruta transversal `prevencion/pdtp/acciones` con DataTable + filtros (estado,
      prioridad, faena, solo vencidas) + entrada en el nav de Prevención.
- [x] Export XLSX ampliado: `buildPdtpExport` ahora agrega hojas "Plan de acción" y
      "Seguimiento" (vía `report.sheets`, soporte multi-hoja ya existente en
      `excel-builder.ts` — XLSX, no CSV, según regla del proyecto).
- [x] 4 permisos nuevos añadidos a `modules/prevention/manifest.ts`
      (`prevention:pdtp:checklist:manage/fill`, `prevention:pdtp:action:manage/verify`)
      + grants por rol + sincronizados a la BD local vía `npm run db:sync-rbac`.
      Tests de parity RBAC/manifest (`prevention-rbac.test.ts`,
      `auth-bootstrap-permissions.test.ts`) pasan sin cambios.
- [~] Tests E2E del flujo completo — no se agregó un test Playwright E2E dedicado
      (fuera de alcance de esta sesión); en su lugar, `pdtp-checklist-action-plan.test.ts`
      cubre el flujo completo a nivel de servicio (crear actividad → checklist →
      no_cumple → acción generada → verificar → reabrir → seguimiento →
      cumplimiento integral sube), con PGlite + migraciones reales. Ver §11.

**Esfuerzo estimado original: 11–18 días-persona.** Gran parte del trabajo de
servicios (Fases 0-5) ya existía sin commitear al iniciar esta sesión; esta sesión
completó: reparación de migraciones, corrección de bugs de negocio reales,
permisos RBAC, la capa completa de server actions, y toda la UI de las 6 fases
(tab de checklist, página de detalle de ejecución, panel de plan de acción con
seguimiento, página global de acciones, indicadores de 3 ejes, export XLSX
ampliado) más tests de servicio.

---

## 7. Decisiones de diseño a confirmar

1. **¿Checklist por actividad o por programa?** Propuesta: por actividad (más granular), con **catálogo de plantillas reutilizables** para no redactar desde cero. Si la mayoría de actividades comparte el mismo checklist, se puede clonar.
2. **¿Reemplazar o convivir cantidad + checklist?** Propuesta: **convivir**. La cantidad sigue siendo el indicador operativo; el checklist valida la calidad. Ambos alimentan el %.
3. **¿Pesos del cumplimiento integral editables por programa?** Propuesta: sí, columnas en `pdtpPrograms` con defaults 0.5/0.3/0.2.
4. **¿Estado `vencido` persistente o derivado?** Propuesta: derivado en lectura + job diario que lo materialice para reportes/exports.
5. **¿Reabrir acciones verificadas?** Propuesta: sí, con permiso `prevention:pdtp:action:verify` y motivo obligatorio.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper el flujo de ejecución actual (cantidad) | Fase 0 solo añade tablas; el wizard reemplaza el form solo al final (Fase 2) y el form viejo queda como fallback de cantidad. |
| Performance del cálculo de cumplimiento | Pre-agregar por instancia al guardar (`porcentajeCumplimiento`) y sumar en queries; no recalcular desde cero cada render. |
| Sobrecarga de permisos | Reutilizar el catálogo RBAC existente; solo 4 claves nuevas. |
| Editor de checklist complejo | Reutilizar al máximo el builder de `ChecklistDefinition` de SST; si no existe editor visual, MVP = editar JSON asistido. |

---

## 9. Archivos que se tocarán (resumen)

**Nuevos:**
- `db/schema/prevention/pdtp.ts` (extender)
- `lib/services/pdtp/checklists.ts`, `execution-checklists.ts`, `action-plan.ts`, `followups.ts`, `compliance.ts` (extender)
- `app/(app)/prevencion/pdtp/[programId]/editar/checklist-tab.tsx`
- `app/(app)/prevencion/pdtp/pdtp-execution-wizard.tsx`
- `app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/page.tsx`
- `app/(app)/prevencion/pdtp/acciones/page.tsx`
- `app/(app)/prevencion/pdtp/actions/checklists.ts`, `actions/action-plan.ts`, `actions/followups.ts`

**Modificados:**
- `app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx` (nueva tab)
- `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx` (badges en celda)
- `app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx` (3 ejes)
- `lib/services/pdtp/index.ts` (re-exports)
- `modules/permissions.ts` (4 permisos)
- `db/schema/prevention/pdtp.ts` → `pdtpPrograms` (pesos) + 5 tablas
- `manual/prevencion/pdtp.md` (documentación de usuario)

---

## 10. Cómo validar el éxito

- Un prevencionista puede, en una ejecución, abrir un checklist, marcar ítems, generar observaciones y que **automáticamente** se cree un plan de acción.
- El jefe de faena ve las acciones asignadas, registra seguimiento con evidencia, y al cerrarlas el **% de cumplimiento integral sube**.
- El dashboard muestra el % ponderado y permite drill-down al detalle.
- Export XLSX trae hojas separadas de ejecución, checklist, plan de acción y seguimiento.

---

## 11. Estado final y brechas conocidas (post-implementación, 2026-07-14)

Las 6 fases quedaron implementadas y verificadas (typecheck limpio, 85/85 tests PDTP
existentes en verde + 8 tests nuevos, migración aplicada a la BD local). Rutas reales
respecto al plan original de §9:

- Archivos nuevos reales: `checklist-tab.tsx`, `pdtp/[programId]/ejecucion/[executionId]/{page,execution-checklist-panel,execution-action-plan-panel}.tsx`,
  `pdtp/acciones/{page,acciones-table}.tsx`, `actions/checklist-actions.ts` (un solo
  archivo para checklist+plan de acción+seguimiento, no 3 separados) — consolidación
  deliberada, no un archivo por servicio.
- No se creó `pdtp-execution-wizard.tsx`: reemplazado por la página de detalle de
  ejecución consolidada (ver Fase 2). `PdtpExecutionForm` (cantidad) sigue intacto.
- Los permisos viven en `modules/prevention/manifest.ts` (el catálogo real), no en
  `modules/permissions.ts` (que solo deriva un tipo TS desde el registry).

**Brechas conocidas / follow-ups sugeridos para una próxima sesión:**

1. **Editor visual de checklist**: sigue siendo JSON-asistido (§7 ítem "Editor de
   checklist complejo" de §8 se cumplió con el MVP, pero no con un builder visual).
   Si el volumen de plantillas crece, vale la pena invertir en un editor de
   secciones/ítems con formularios en vez de JSON crudo.
2. **Evidencia fotográfica en seguimiento**: `addFollowup` acepta `evidenciaUrl` /
   `evidenciaPhotos` en el servicio, pero la UI de seguimiento (`ExecutionActionPlanPanel`)
   solo expone observación + cambio de estado, no un selector de archivos conectado a
   `/api/prevencion/pdtp/evidence`. Wire pendiente.
3. **Badges de estado de checklist/plan de acción en la hoja del sheet**: `pdtp-sheet-table.tsx`
   ahora enlaza "Ver verificación →" por ejecución, pero no muestra un badge con el
   conteo de ítems no_cumple / acciones pendientes-vencidas directamente en la celda
   (lo que pedía §4.2 originalmente) — requeriría extender `PdtpSheetView` para incluir
   esos conteos por ejecución. Se dejó fuera para no ampliar el radio de cambio de un
   tipo ya consumido en varios lugares (`sheets.ts`, tests de sheet-table) sin una
   sesión dedicada a esa migración de tipo.
4. **Prioridad de acciones auto-generadas**: siempre `"media"` (plazo +7 días); no
   deriva severidad desde el ítem del checklist. Aceptable como default razonable,
   pero si se necesita priorización automática real habría que definir el criterio
   (¿por sección? ¿por campo adicional en el ítem?) antes de implementarlo.
5. **Tests E2E Playwright**: no se agregó un spec E2E de navegador para el flujo
   completo; la cobertura actual es a nivel de servicio (PGlite). Si se quiere
   cobertura de UI real, sería un buen siguiente paso usando el patrón de
   `e2e/negative-flows.spec.ts` como referencia.
6. **`manual/prevencion/pdtp.md`**: no se actualizó la documentación de usuario final
   (fuera de alcance de esta sesión de implementación técnica).

Nada de lo anterior bloquea el uso de la funcionalidad: el flujo completo
(plantilla → iniciar verificación → llenar → enviar revisión → acción autogenerada →
verificar/reabrir → seguimiento → % integral) funciona de punta a punta hoy.
