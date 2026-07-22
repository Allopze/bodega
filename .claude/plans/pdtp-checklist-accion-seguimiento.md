# Plan integral: Checklist → Observaciones → Plan de Acción → Seguimiento → % Cumplimiento en PDTP

Estado: **PROPUESTA** — pendiente aprobación antes de implementar.
Módulo: `app/(app)/prevencion/pdtp/` · Schema: `db/schema/prevention/pdtp.ts`
Fecha: 2026-07-14

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
estado             text NOT NULL DEFAULT 'pendiente'  -- ver §3.1 enum
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
- Nueva ruta `prevencion/pdtp/acciones/page.tsx` — DataTable con todas las acciones del programa/faena/período, filtros (estado, prioridad, responsable, vencidas), export Excel (regla `export-rule`: **Excel no CSV**, reusar el builder de `buildPdtpExport`).

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

### Fase 0 — Cimientos de datos (1–2 días)
- [ ] Añadir 5 tablas + relaciones + tipos a `db/schema/prevention/pdtp.ts`.
- [ ] `npm run db:generate` → migración. Verificar "No schema changes" tras generar.
- [ ] Re-exportar tipos en `lib/services/pdtp/index.ts`.
- [ ] Helpers de ID (`generateId`), enums TS (`PdtpActionEstado`, `PdtpChecklistStatus`).
- **Riesgo**: bajo (tablas aditivas, sin tocar existentes).

### Fase 1 — Plantillas de checklist (2–3 días)
- [ ] Servicio `lib/services/pdtp/checklists.ts`: CRUD plantillas, get active por actividad.
- [ ] Server actions en `app/(app)/prevencion/pdtp/actions.ts` (o nuevo `actions/checklists.ts`).
- [ ] Tab "Checklist" en el builder del programa (`builder-tabs.tsx`).
- [ ] Editor de definición reutilizando componentes de SST.
- [ ] Tests: `lib/__tests__/pdtp-checklists.test.ts`.

### Fase 2 — Llenado de checklist en ejecución (3–4 días)
- [ ] Servicio `lib/services/pdtp/execution-checklists.ts`: crear instancia, upsert respuestas, calcular %.
- [ ] Hook `usePdtpExecutionChecklist` (espejo de `use-checklist-responses.ts` con auto-save).
- [ ] `PdtpExecutionWizard` que reemplaza `PdtpExecutionForm` (cantidad + checklist).
- [ ] `pdtp_execution_checklists` se crea al primer guardado.
- [ ] Marcar `pdtpExecutions.status` a `submitted` al "Enviar revisión" desde el wizard.

### Fase 3 — Plan de acción (2–3 días)
- [ ] Servicio `lib/services/pdtp/action-plan.ts`: `generateActionPlanFromChecklist`, CRUD manual, transiciones de estado, cálculo de vencidos.
- [ ] Server actions `app/(app)/prevencion/pdtp/actions/action-plan.ts`.
- [ ] Panel `PdtpActionPlanPanel` (reutiliza UX de `action-plan-panel.tsx`).
- [ ] Auto-generación al completar el checklist.

### Fase 4 — Seguimiento (2 días)
- [ ] Servicio `lib/services/pdtp/followups.ts`: agregar bitácora, adjuntar evidencia (reutilizar `/api/prevencion/pdtp/evidence`).
- [ ] Componente `SeguimientoTimeline` (historial cronológico con avatares).
- [ ] Notificaciones: extender `lib/services/pdtp/reminders.ts` para alertar acciones vencidas (cron semanal).

### Fase 5 — Cumplimiento integral (1–2 días)
- [ ] `getPdtpIntegralCompliance` en `lib/services/pdtp/compliance.ts`.
- [ ] Columnas de pesos en `pdtpPrograms` (migración).
- [ ] UI en `pdtp-indicators-panel.tsx` (3 barras + ponderado).
- [ ] Actualizar `loadPdtpComplianceSummary` del dashboard.

### Fase 6 — Cierre (1–2 días)
- [ ] Ruta transversal `prevencion/pdtp/acciones` con DataTable + filtros.
- [ ] Export Excel ampliado (hoja extra "Plan de acción" + "Seguimiento").
- [ ] Seed de permisos + verificación de parity en `modules/permissions.ts`.
- [ ] Tests E2E del flujo completo (crear actividad → checklist → no_cumple → acción → seguimiento → cierre → % sube).

**Esfuerzo total estimado: 11–18 días-persona** (un dev), dependiendo de cuánto se reaproveche el editor de definiciones de SST.

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
- Export Excel trae hojas separadas de ejecución, checklist, plan de acción y seguimiento.
