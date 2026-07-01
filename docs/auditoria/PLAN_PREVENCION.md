# Plan de implementación — hallazgos pendientes de `AUDITORIA_PREVENCION.md`

> Generado: 2026-06-30. Este plan cubre **solo lo que sigue pendiente** después
> de contrastar la auditoría contra el código actual. Lo ya corregido se
> documenta en `AUDITORIA_PREVENCION.md` (sección "Verificación" se actualiza
> al cerrar el plan).
>
> Reglas del proyecto que aplican:
> - Lógica de negocio en `lib/` + `app/`, no en `modules/` (source-of-truth).
> - Cambios de schema → `npm run db:generate` (nunca editar `meta/_journal.json`).
> - Suite de tests e2e: `PGHOST=/var/run/postgresql`.
> - Exports XLSX-only (`buildXlsxBuffer`).

## Resumen del contraste

Los **5 bugs P0** (B1 cierre con acción cancelada, B2 EPP worksite, B3 salud no-op, B4
inspección default ok, B5 catch vacío) y gran parte de P1 (Zod de 4 módulos, FKs,
unique `(doc,version)`, year floor, guardPermission/safeParse/fieldErrors en 4
actions) y P2 (export-button, permisos/ submodule) **ya están aplicados**. Los
5 fixes tienen tests de regresión en `lib/__tests__/prevention-{incidents,ola2,ola34,iper,pdtp}.test.ts`.

Este plan solo cubre lo que **sigue abierto**.

## Fases

### P1 — Cierre de trust boundary (4 cambios)

#### P1.1 — Guard de estado de programa en `markPdtpExecution`
- **Archivo:** `lib/services/prevention-pdtp.ts:322`
- **Cambio:** `pdtpExecutionSchema` ya incluye `programId`; cargar el `pdtpProgram`
  y exigir `status === "active"` (mismo patrón que ya se aplica en edición/
  agregación de actividades, líneas 763, 875). Throw claro si no.
- **Test:** extender `lib/__tests__/prevention-pdtp.test.ts` con
  "markPdtpExecution: rejects execution against a draft program".
- **Riesgo:** bajo.

#### P1.2 — Race fix en `addDocumentVersion`
- **Archivo:** `lib/services/prevention-legal-docs.ts:35-58`
- **Bug latente:** el unique index `legal_document_versions_doc_version_unique`
  evita duplicados, pero el read-then-insert lanza `23505` bajo concurrencia
  y no es transaccional con la verificación.
- **Cambio:** reemplazar por UPSERT con `coalesce` o `onConflictDoNothing` + retry,
  o usar un único `INSERT … SELECT coalesce(max(version)+1, 1)` en una sola
  statement.
- **Test:** versión concurrente (insertar 2 versiones a la vez) produce
  `version=1` y `version=2` consecutivos sin error.

#### P1.3 — `pgEnum` para status/severity/result/risk-band
- **Archivo:** `db/schema/prevention.ts` (líneas 42, 47, 65-67, 751, y otros
  `status/severity/type/result` como texto).
- **Cambio:** introducir `pgEnum` para los siguientes dominios y referenciarlos:
  - `preventionIncidentType` (accidente, incidente, cuasi_accidente, …
    — revisar valores reales primero).
  - `preventionIncidentStatus` (open, in_progress, closed, …).
  - `preventionIncidentSeverity` (leve, moderado, grave, fatal).
  - `healthExamResult` (apto, apto_con_restricciones, no_apto).
  - `initialRiskLevel` / `residualRiskLevel` (bajo, medio, alto, crítico).
- **Pasos:**
  1. Inspeccionar valores distintos en la DB antes de migrar (riesgo de
     data huérfana si ya hay valores fuera del nuevo dominio).
  2. Crear `pgEnum` en el schema.
  3. Reemplazar las columnas `text(…).notNull()` por `tipoEnum(…).notNull()`.
  4. `npm run db:generate` (no editar `meta/_journal.json`).
  5. Aplicar con `db:migrate` (no `db:push`).
  6. Verificar `npm run db:generate` reporta "No schema changes" tras aplicar.
- **Test:** insertar un valor fuera del enum debe fallar en el servicio.
- **Riesgo:** medio — requiere validación previa de datos existentes.

#### P1.4 — Documentar gate de confidencialidad de salud
- **Contexto:** `prevention-health.ts:26-31` ya valida scope por worker→faena.
  Mientras las acciones de `salud/` no existan (P3), no hay superficie de
  ataque; documentar en `AUDITORIA_PREVENCION.md` que el service-level fix
  sigue siendo suficiente hasta que se cree la primera action, que **deberá
  usar `guardPermission("prevention:health:view")` o equivalente y pasar
  `scope`**.

### P2 — Consistencia UI-UX

#### P2.5 — Migrar 7 páginas de `<table>` crudo a `Table`/`TableRoot`
- **Páginas:** `equipos/checklists/page.tsx`, `kpis/page.tsx`,
  `epp/stock/page.tsx`, `epp/matriz/page.tsx`, `emergencias/page.tsx`,
  `pdtp/pdtp-indicators-panel.tsx`, `salud/protocolos/page.tsx`.
- **Patrón:** revisar el componente `Table`/`TableRoot`/`DataTable` existente
  (usado en `incident-list`, `iper-list`, `ppa-list`, `pdtp-sheet-table`).
- **Criterio:** scroll horizontal funcional, CSS vars del design system
  (`var(--color-surface-2)`), `EmptyState` reutilizable.

#### P2.6 — Reemplazar UUIDs crudos por nombres legibles
- **Hallazgos:**
  - `epp/stock/page.tsx:53` — `eppProductId` → nombre de producto
    (join a `eppLifecyclePolicies`).
  - `alcotest/page.tsx:48-49` — `worksiteId`/`testedWorkerId` → nombres
    (join a `worksites`/`workers`).
  - `inspection-list.tsx:56-57` — `run.id`/`worksiteId`.
  - emergencias/equipos (revisar y unificar).
- **Criterio:** las queries de página deben hacer join y exponer el nombre,
  no el id. Si se conserva el id para acciones, va como `<span className="font-mono text-xs text-muted-foreground">` para acciones, nunca como texto principal.

#### P2.7 — `loading.tsx` skeletons en ~23 rutas
- **Patrón:** copiar `app/(app)/prevencion/loading.tsx` a las rutas que faltan:
  ppa, incidentes, iper, inspecciones, alcotest, emergencias, epp (matriz y stock),
  salud (panel y protocolos), equipos (reportes y checklists), comites, kpis, pdtp
  (incluyendo subrutas), capacitaciones, contratistas, documentacion, permisos.
- **Criterio:** skeleton visible sin CLS, sin spinner global que tape la UI.

#### P2.8 — Errores inline por campo en formularios
- **Archivos:** `iper-form.tsx`, `incident-form.tsx`, `training-form.tsx`.
- **Patrón:** `nueva-evaluacion-form` (form SST) ya usa `Field` con prop `error`
  y `aria-invalid`; replicar. Las actions ya devuelven `fieldErrors` desde
  `safeParse` — solo falta conectarlos.
- **Cambio:** pasar `fieldErrors` (state de `useActionState`) a los inputs;
  reemplazar `toast.error("Completa faena, código y título.")` por errores
  inline que apunten al campo concreto.

#### P2.9 — Estandarizar fechas y centralizar badges
- **Fechas:** consolidar en `formatDateDisplay` (revistar `lib/utils/format-date*`).
  Buscar todas las ocurrencias de `.slice(0,10)` sobre ISO, `toLocaleString("es-CL")`,
  `formatDateTime` en `app/(app)/prevencion/`, `app/(app)/prevencion/api/` y
  reemplazar.
- **Badges:** crear `lib/prevention/badges.ts` replicando el patrón de
  `@/lib/ppa/badges`. Centralizar `INCIDENT_STATUS_LABEL/VARIANT`,
  `IPER_STATUS_LABEL/VARIANT`, `INSPECTION_STATUS_LABEL/VARIANT`, etc.
  Consumir en todas las listas.

#### P2.10 — Feedback/pending en `pdtp-sheet-table`
- **Archivo:** `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx:162` (`ExecutionForm`)
  y `226-239` (`ApprovalButtons`).
- **Cambio:** convertir a `useActionState` con `isPending` para deshabilitar
  el botón durante el submit; mostrar toast de éxito/error con la respuesta de
  la action.

#### P2.11 — Paginación real en `inspection-list`
- **Archivo:** `app/(app)/prevencion/inspecciones/inspection-list.tsx:49,78`.
- **Bug:** `.slice(0,10)` silencioso oculta filas sin aviso.
- **Cambio:** usar `TableRoot` paginada o, si se mantiene la lista plana,
  mostrar mensaje explícito "+N inspecciones no mostradas" con un link a
  `/prevencion/inspecciones` filtrado.

### P3 — Completar submódulos de solo lectura / stubs

Cada ticket requiere su propio `actions.ts` + `*-form.tsx` + `*Permission`
(check `modules/<area>/manifest.ts` para el nombre) + tests + `validation`
consistente. Se priorizan por valor de negocio y por riesgo legal. Los
permisos `prevention:<área>:*` ya están declarados en el manifest y otorgados
a roles — **no se necesita tocar RBAC** salvo añadir el `:manage` cuando
falte.

> **Actualización 2026-07-01**: Ver estado real de cada ticket a continuación
> (✅ hecho en esta iteración, ⚠️ ya estaba hecho de una sesión previa sin
> comitear, ❌ pendiente). Detalle completo en la sección "Actualización
> 2026-07-01" de `AUDITORIA_PREVENCION.md`.

#### P3.12 — `salud/` (Salud ocupacional) ⚠️ ya implementado

Encontrado ya completo al retomar: `actions.ts`, `salud-panel.tsx` y los 3
forms (exam/aptitud/restricción) ya existían y estaban conectados. Esta
iteración conectó la pieza que faltaba de P3.22 (`describeActiveRestrictions`
visible en capacitaciones/equipos/incidentes).

- **Servicio (`lib/services/prevention-health.ts`):** ya existe con Zod y
  scope real (B3 fixeado). Funciones disponibles:
  `registerHealthExam`, `setHealthAptitude`, `addHealthRestriction`,
  `getWorkerHealthExams`, `isRestricted`, `getDueProtocols`.
- **Lo que falta:**
  1. `app/(app)/prevencion/salud/actions.ts` con:
     - `registerHealthExamAction(input)` →
       `guardPermission("prevention:health:manage")` + `scope`.
     - `setHealthAptitudeAction(input)`.
     - `addHealthRestrictionAction(input)`.
     - `deliverProtocolAction(input)`.
     - `acknowledgeProtocolAction(protocolApplicationId)`.
  2. Forms cliente con `Field error` + `aria-invalid` (P2.8 patrón).
  3. Filtro por faena + búsqueda por RUT.
  4. **Restricciones visibles en otros módulos** (audit §5): exponer
     `isRestricted(workerId, scope)` desde `capacitaciones/`,
     `equipos/reportes/`, `ppa/`, `incidentes/` para que el form rechace
     asignaciones que contradigan una restricción médica activa.
  5. Alert de vencimiento de examen (P4.21 lo generaliza; aquí solo el
     mensaje contextual en `salud-panel`).
- **Permisos:** ya existe `prevention:health:view`; añadir `:manage` si
  falta.
- **Test:** `lib/__tests__/prevention-ola34.test.ts` ya cubre denegación
  cross-faena. Agregar tests de los forms: `lib/__tests__/prevention-health-form.test.ts`.
- **Riesgo:** medio (datos médicos → exige `guardPermission` + scope en
  cada action; ver P1.4).
- **Criterio de cierre:** `salud/` sin error TS; crear un examen de prueba
  vía UI lo refleja en la tabla; denegar lectura cross-faena devuelve 403.

#### P3.13 — `emergencias/` (Planes, simulacros, brigadas, equipos) ⚠️ ya implementado

Encontrado ya completo: `createEmergencyPlanAction`/`approveEmergencyPlanAction`
separados (plan nace en `borrador`, fix del auto-approve aplicado), drill
schedule/execution/equipment forms, todo conectado en `emergencias/page.tsx`.
`emergencias/[tipo]/` seguía vacío y sin referencias — se eliminó (ver P3.23).

- **Servicio (`lib/services/prevention-emergency.ts`):** ya existe. Falta
  el fix de `createEmergencyPlan` que hoy asigna `approvedAt=now` /
  `approvedBy=userId` al crear (audit §2.3). La acción debe insertar
  `status: "borrador"` y exponer `approveEmergencyPlanAction` separada.
- **Lo que falta:**
  1. `app/(app)/prevencion/emergencias/actions.ts`:
     - `createEmergencyPlanAction` (borrador, NO auto-aprobado).
     - `approveEmergencyPlanAction(planId)` separado, con
       `guardPermission("prevention:emergency:approve")`.
     - `scheduleDrillAction`, `recordDrillExecutionAction`,
       `addEquipmentAction`, `addInspectionAction`.
  2. Forms para cada uno.
  3. Poblar `emergencias/[tipo]/page.tsx` (directorio vacío) para drill,
     brigada, equipo.
  4. Alert de inspección de equipo vencida (la consulta
     `getOverdueEquipmentInspections` ya existe; falta la UI que la use).
- **Test:** extender `lib/__tests__/prevention-emergency.test.ts` con
  "createEmergencyPlan: born as draft, requires separate approval".
- **Criterio de cierre:** planes nacen en `borrador`; `approve` requiere
  permiso separado; simulacros se pueden programar y ejecutar; equipos
  vencidos aparecen en la lista con badge de warning.

#### P3.14 — `comites/` (CPHS, bipartito, reuniones, acuerdos) ⚠️ ya implementado

`member-form.tsx`, `meeting-form.tsx`, `agreement-form.tsx`,
`committee-form.tsx` y `comites-panel.tsx` ya existían y compilaban sin
error. Se corrigió 1 error de lint real (`react-hooks/purity`: `Date.now()`
directo en `useState` inicial de `agreement-form.tsx`) reemplazándolo por
`new Date().getTime()`, consistente con el resto del área.

- **Servicio (`lib/services/prevention-committees.ts`):** existe.
- **Bloqueante actual:** `committee-detail.tsx` importa `./member-form`,
  `./meeting-form`, `./agreement-form` que no existen en el repo (4
  errores TS preexistentes). Estos forms existen en el branch pero no
  están commiteados.
- **Lo que falta:**
  1. Confirmar que `member-form.tsx`, `meeting-form.tsx`,
     `agreement-form.tsx` existen (están en untracked — verificar y
     `git add` o crearlos).
  2. `app/(app)/prevencion/comites/actions.ts`:
     - `addCommitteeMemberAction` (ya implementado en service).
     - `scheduleMeetingAction` (agenda + asistentes).
     - `recordAgreementAction` (responsable + dueDate).
  3. `committee-form.tsx` (crear comité) — falta.
  4. `comites-panel.tsx` (overview del comité) — falta.
  5. Carga de acta y seguimiento de acuerdos (audit §5).
- **Test:** `prevention-rbac.test.ts` ya cubre permisos. Agregar
  `prevention-committees.test.ts` para flujo crear→reunión→acuerdo.
- **Criterio de cierre:** 0 errores TS en `comites/`; crear comité +
  agendar reunión + registrar acuerdo desde UI funciona.

#### P3.15 — `documentacion/` (RIOHS, ODI, IRL) ⚠️ ya implementado

`actions.ts` (create/addVersion/deliver/acknowledge), `document-form.tsx` y
`documentacion-panel.tsx` ya existían y conectados. `documentacion/[id]/`
seguía vacío y sin referencias — se eliminó (ver P3.23); el diseño real
usa un panel de una sola página, no una ruta de detalle.

- **Servicio (`lib/services/prevention-legal-docs.ts`):** existe con
  `addDocumentVersion` ya race-safe (P1.2 aplicado). Falta:
  1. `app/(app)/prevencion/documentacion/actions.ts`:
     - `addDocumentVersionAction` (ya en service).
     - `deliverDocumentAction` (acuse de recibo ODI/RIOHS).
     - `acknowledgeDeliveryAction` (firma del trabajador).
  2. **Flujo entrega + acuse de recibo ODI/RIOHS** (audit §5): cuando se
     entrega un documento, se crea un `documentDelivery` y un link/token
     para que el trabajador firme digitalmente. La firma se registra
     como `documentSignature` con timestamp + IP.
  3. Forms y tabla de versiones con diff (audit §5).
  4. Poblar `documentacion/[id]/page.tsx` (directorio vacío) → detalle
     del documento + historial de versiones + entregas + firmas.
  5. Alert de revisión periódica (P4.21 lo generaliza).
- **Test:** ya existe `prevention-legal-docs.test.ts`. Ampliar con
  flujo: crear doc → agregar v1 → entregar a worker → firmar → verificar
  `acknowledgedAt`.
- **Criterio de cierre:** documento entregable a un worker; el worker
  puede firmar; la firma queda registrada con timestamp.

#### P3.16 — `alcotest/` (Control DO-48) ⚠️ ya implementado

`alcotest-panel.tsx`, `actions.ts` y el registro de tests ya existían
(el "1 error TS preexistente" del ticket original ya no existe: `tsc
--noEmit` da 0 errores). El "escalamiento" ante resultado positivo hoy es
solo un toast ("Escalar al prevencionista para suspender el turno") —
no crea ninguna notificación real ni registro de suspensión. Tablero de
tasas y programación de tests aleatorios no se revisaron — quedan
pendientes (ver lista final).

- **Bloqueante actual:** `alcotest/page.tsx` importa `./alcotest-panel`
  que no existe en el repo (1 error TS preexistente). La página actual
  solo pasa datos crudos al panel faltante.
- **Lo que falta:**
  1. Crear `app/(app)/prevencion/alcotest/alcotest-panel.tsx` (no
     existe).
  2. `app/(app)/prevencion/alcotest/actions.ts`:
     - `registerAlcoholTestAction` (audit §5: `alcoholTestSchema` ya
       existe en Zod).
     - `escalatePositiveResultAction(testId)` (audit §5: escalamiento
       ante resultado positivo — workflow con notificación al
       prevencionista + suspensión del turno).
  3. Form de registro.
  4. Tablero de tasas por faena (audit §5).
  5. Programación de tests aleatorios.
- **UUIDs en la página (P2.6):** una vez creado el panel, los IDs
  `worksiteId`/`testedWorkerId` deben ser nombres legibles (mismo
  patrón que `inspection-list`).
- **Criterio de cierre:** `alcotest/` sin error TS; registrar test;
  resultado positivo dispara escalamiento (verificable con test).

#### P3.17 — `epp/` (Matriz + stock + recambio con acta) ✅ hecho esta iteración

`epp-matrix-list.tsx`/`epp-matrix-form.tsx` existían pero no estaban
importados en `matriz/page.tsx` (código muerto, página seguía de solo
lectura); `stock/page.tsx` no tenía ningún form. Se conectaron ambos +
`EppStockPanel`/`StockThresholdForm` nuevo. Se agregó la acta firmada:
migración `0015_striped_maverick.sql` (`evidence_url`/`acknowledged_at` en
`epp_recambio_log`), `logEppDelivery` ahora exige `evidenceUrl` y valida
scope real (antes sin `assertWorkerAccess`), `acknowledgeEppDelivery`,
`EppDeliveryForm`/`EppDeliveriesList`. `getCriticalStock` **no se pudo
conectar a un badge real**: compara el umbral consigo mismo
(`criticalStock = 0`), no existe stock actual en el schema — pendiente de
decisión de producto (link a `products`/bodega). Tests ampliados en
`prevention-ola2.test.ts`.

- **Servicio (`lib/services/prevention-epp-matrix.ts`):** ya con
  fix de scope (B2). Falta:
  1. `app/(app)/prevencion/epp/matriz/actions.ts` (existe) +
     `app/(app)/prevencion/epp/stock/actions.ts` (existe) — confirmar
     que cubren `setEppStockThreshold` y `setEppPositionEntry`.
  2. `app/(app)/prevencion/epp/recambio/actions.ts` (nuevo):
     - `logEppDeliveryAction` (entrega/recambio con **acta firmada**,
       requisito legal en Chile, audit §5).
     - `acknowledgeEppDeliveryAction`.
  3. Tabla `eppRecambioLog` ya tiene FK a `workers` (B2 fixeado vía
     join). La acta es un archivo uploadable → `evidenceUrl`.
  4. Alert de stock bajo (`getCriticalStock` ya existe) — UI lo muestra
     con badge danger.
  5. Conectar `epp/stock` y `salud/protocolos` al nav (audit §1, hoy
     huérfanos).
- **Test:** `prevention-ola2.test.ts` ya cubre `getExpiredEpp`.
  Ampliar con `recambioLog` + acta.
- **Criterio de cierre:** registrar entrega de EPP con acta; stock
  bajo aparece en rojo; `epp/stock` aparece en el nav.

#### P3.18 — `equipos/` (Reportes diarios + checklists + anomalías) ⚠️ ya implementado

`actions.ts` (createDailyReport/reviewDailyReport/createChecklist) y los
forms ya existían; el error de `Checkbox`/`onCheckedChange` ya no existe
(usa `onChange` nativo, `tsc --noEmit` da 0 errores). Se conectó el aviso
de restricción de salud del operador (P3.22). Anomalía→ticket de
mantención **no se conectó**: `lib/services/maintenance.ts` es
estrictamente de flota (`maintenanceRecords.vehicleId → fuelVehicles`), sin
soporte para equipos genéricos — requiere una decisión de diseño previa
(polimorfismo del activo o tabla separada), no es una integración de una
línea.

- **Servicio (`lib/services/prevention-equipment.ts`):** existe.
- **Bloqueante actual:** `equipos/checklists/checklist-form.tsx` tiene
  un error TS preexistente (prop `onCheckedChange` no existe en el
  componente `Checkbox`).
- **Lo que falta:**
  1. Arreglar `checklist-form.tsx` (verificar API del `Checkbox` del
     design system; ajustar prop).
  2. `app/(app)/prevencion/equipos/actions.ts` (existe) — confirmar
     cobertura: `createDailyReport`, `reviewDailyReport`,
     `createChecklist`.
  3. Anomalía → ticket de mantención (audit §5): cuando
     `reviewDailyReport.status = "requiere_cierre"` o
     `createChecklist.closeRequired`, generar evento/registro en el
     módulo de mantenimiento (cross-feature, requiere decisión
     arquitectónica previa — ver nota al final).
  4. Evidencia fotográfica por ítem (audit §5) — `evidenceUrl` por
     checklist.
- **Test:** crear reportes + checklists; cierre requerido dispara
  ticket. Verificar `evidenceUrl` por foto.
- **Criterio de cierre:** `equipos/` sin error TS; reporte con
  hallazgo "requiere cierre" genera ticket.

#### P3.19 — `contratistas/` (Padrón Ley 20.123) ✅ hecho esta iteración

Seguía siendo el stub "próximamente". El servicio y los 3 schemas Zod ya
existían (los "2 errores TS" del ticket original ya no existían). Se
construyó desde cero: `actions.ts`, 3 forms, `contratistas-list.tsx`
(expandible, patrón comités) + `contratista-detail.tsx` +
`contratistas-panel.tsx`, `page.tsx` reescrito, `loading.tsx`, export XLSX
(la ruta `app/api/prevencion/contratistas/export` existía vacía),
`getExpiringContractorDocuments` para la alerta de vencimiento. No se
construyó `contratistas/[id]/page.tsx`: se siguió el patrón ya establecido
en el resto del área (panel de una sola página con expansión inline, no
rutas de detalle por item — ver comités/documentación/emergencias). Tests
nuevos: `prevention-contractors.test.ts`. Control de acceso a faena por
contratista (condicionar `resolveWorksiteScope`) sigue sin implementar —
ver pendientes.

- **Estado actual:** stub "próximamente". Schema tiene las tablas
  pero faltan 3 Zod schemas (`contractorCreateSchema`,
  `contractorWorkerAddSchema`, `contractorDocumentAddSchema`) — están
  referenciados en `prevention-contractors.ts` pero **no existen en
  `lib/validation/prevention.ts`** (2 errores TS preexistentes).
- **Lo que falta:**
  1. Agregar los 3 Zod schemas faltantes.
  2. `app/(app)/prevencion/contratistas/actions.ts`:
     - `createContractorAction` (datos de la empresa: RUT, razón
       social, representante legal).
     - `addContractorWorkerAction` (asociar trabajador a contratista).
     - `addContractorDocumentAction` (subir documento Ley 20.123:
       certificado de antecedentes, contrato, EPP entregado, etc.).
  3. Forms.
  4. Poblar `contratistas/[id]/page.tsx` (directorio vacío).
  5. Alertas de vencimiento documental (P4.21).
  6. Control de acceso a faena — el registro de un contratista debe
     condicionar el `resolveWorksiteScope` para incluir sus workers
     solo donde estén autorizados.
- **Test:** crear padrón, agregar 2 workers, agregar 3 documentos, ver
  alerta de vencimiento.
- **Criterio de cierre:** 0 errores TS; padrón completo editable;
  alertas funcionales.

#### P3.20 — `kpis/` (Indicadores preventivos) ✅ hecho esta iteración

Seguía siendo exactamente el stub original: año 2026 fijo en código, sin
selector, sin drill-down, sin gráfico, y `labor_hours`/`kpi_snapshots` sin
ningún caller en el repo. Se agregó `lib/services/prevention-kpis.ts`
(`setLaborHours`, `listLaborHours`, `getIncidentFrequencyRate` — IF real
desde `prevention_incidents.type = 'accidente'` y `labor_hours`), permiso
nuevo `prevention:kpis:manage`, `KpisFilters` (año + faena por query
params), `KpisTrendChart` (recharts, reutiliza patrón de
`fuel-charts.tsx`), `LaborHoursForm`. **Índice de gravedad (IG) no se
calculó**: la fórmula exige "días perdidos" por accidente y
`prevention_incidents` no tiene esa columna — se muestra explícitamente
como no disponible en vez de inventar el número; agregar la columna +
flujo de captura es un ticket propio. Tests nuevos:
`prevention-kpis.test.ts`.

- **Estado actual:** solo export XLSX; tabla mensual con cumplimiento
  anual. Falta:
  1. Selector de rango de fecha configurable (audit §5).
  2. Drill-down por faena (audit §5) — `?faena=ID` query param.
  3. Gráficos de tendencia (audit §5) — usar el componente de gráficos
     ya disponible (verificar cuál; el más simple: Recharts o un
     componente custom).
  4. Conectar **tasas de frecuencia/gravedad a incidentes reales**
     (audit §5) — fórmula chilena: `IF = (N accidentes × 10⁶) / HHT`;
     `IG = (Días perdidos × 10³) / HHT`. Requiere `labor_hours` por
     faena-periodo (la tabla existe en el schema).
- **Test:** lectura de KPIs con filtros; cálculo de tasas con datos
  sintéticos.
- **Criterio de cierre:** selector de rango funcional; drill-down
  navega a la faena; tasas se calculan con datos reales.

#### P3.21 — `permisos/` (AST — permisos de trabajo) ✅ hecho esta iteración

`actions.ts` y `permit-form.tsx` existían pero sin página ni entrada de
nav — permiso huérfano cerrado a medias. Se construyó `page.tsx` +
`permisos-panel.tsx` + `permisos-list.tsx` (expandible) + `permiso-detail.tsx`
(firmas requeridas vs. firmadas, botón aprobar) + `permit-template-form.tsx`
(sin el cual no había forma de crear plantillas para el dropdown de
solicitud) + `permit-signoff-form.tsx`. Se agregó `listSignoffsForPermits`
y `buildPermitsExport` al servicio (no existían), la ruta de export, y la
entrada de nav "Permisos de trabajo". El servicio no tenía **ningún test**
— se agregó `prevention-permits.test.ts` (ciclo completo
plantilla→solicitud→aprobación→firma + denegación cross-faena).

- **Estado actual:** `actions.ts` y `permit-form.tsx` existen;
  faltan la página `/prevencion/permisos` y el detalle. El permiso
  `prevention:permits:*` ya está en el manifest.
- **Lo que falta:**
  1. `app/(app)/prevencion/permisos/page.tsx` (lista de templates +
     permits activos) con `Table`/`TableRoot` (P2.5).
  2. `app/(app)/prevencion/permisos/[id]/page.tsx` (detalle del permit
     + flujo de signoffs).
  3. `permit-approval-form.tsx` para roles que firman (jefa de
     terreno, prevencionista, admin_contrato).
  4. El servicio `prevention-permits.ts` ya tiene
     `createPermitTemplate`, `listPermitTemplates`, `createPermitRequest`,
     `listPermitRequests`, `approvePermitRequest`, `signPermit` —
     conectar todo.
- **Test:** crear template → crear request → aprobar → firmar; verificar
  que cada rol solo ve lo que le toca.
- **Criterio de cierre:** `permisos/` navegable; ciclo completo
  request → approvals → signoffs → cierre.

### P3.22 — Tickets transversales de la auditoría original (no stubs)

Estos no son submódulos sino integraciones que cruzan varios:

- **Restricciones de salud visibles en otros módulos** (audit §5). ✅
  parcialmente hecho esta iteración. Se agregó `describeActiveRestrictions`
  (advertencia no bloqueante, no lanza) y se conectó en:
  - `capacitaciones/actions.ts` (`assignTrainingAction` — advierte tras
    asignar).
  - `equipos/actions.ts` (`createEquipmentReportAction` — advierte tras
    crear el reporte).
  - `incidentes/actions.ts` (`createIncidentAction` — advierte tras crear
    el incidente si el trabajador tiene restricción activa).
  - **`ppa/actions.ts` — no se conectó.** El flujo real de PPA
    (`reviewPpa`/`closePpa`) no tiene un concepto de "trabajador firmante
    con una tarea específica" — es revisión/cierre por un rol de oficina,
    no una firma de campo por tarea. El ejemplo original de la auditoría
    ("bloquear firma de PPA con tarea en altura") no corresponde a ningún
    campo existente en el schema de PPA hoy. Conectar esto de verdad
    requiere: (a) una taxonomía de tipo de tarea en PPA (¿por línea de
    servicio? ¿por item?), y (b) decidir si el resultado es un bloqueo
    duro o una advertencia — eso es una decisión de producto, no una
    integración mecánica como las otras tres.
  - **Nota de diseño:** las 3 integraciones hechas son **advertencias**,
    no bloqueos duros. Un bloqueo duro (ej. "no permitir asignar el curso
    X si hay restricción Y") requeriría un mapeo curso↔tipo de
    restricción que no existe en el schema — bloquear sin ese mapeo
    produciría falsos positivos (bloquear cualquier asignación para un
    trabajador con cualquier restricción, incluso una no relacionada).

- **`emergencyPlans` borrador → aprobación** (audit §2.3). Detallado
  en P3.13.

- **Funcionalidades §5 que sí son transversales** (no en los
  tickets individuales) — **❌ ninguna se hizo esta iteración, siguen
  pendientes**:
  - **DIAT automática desde incidente**: generar el PDF DIAT (formato
    legal específico) y subirlo a `incident_statements`. No se intentó —
    requiere el formato exacto de la Dirección del Trabajo, es un ticket
    de diseño de documento, no una integración de datos.
  - **Matriz de capacitación por cargo**: campo
    `trainingCourses.requiredForCargo: string[]` ya existe; falta una
    vista cruzada `capacitaciones/matriz/page.tsx` (cargo × cursos
    requeridos vs asignados por worker). No se construyó.
  - **SLA de notificación de incidente**: regla de tiempo desde
    `occurredAt` hasta creación; badge si se excede. No se construyó.

### P3.23 — Directorios de ruta vacíos (menor, agrupable)

- `emergencias/[tipo]/` — **eliminado** (no resuelto con una ruta de
  detalle): el diseño real de `emergencias/` es un panel de una sola
  página, sin subrutas por tipo. Directorio vacío y sin referencias,
  confirmado antes de borrar.
- `documentacion/[id]/` — **eliminado**, mismo motivo (panel de una sola
  página con historial de versiones/entregas inline).
- `contratistas/[id]/` — **no se creó**. Se construyó `contratistas/`
  siguiendo el mismo patrón de panel-de-una-página + expansión inline que
  el resto del área (ver P3.19), en vez de una ruta de detalle. El
  directorio nunca llegó a existir, así que no había nada que eliminar.

### P4 — Funcionalidades transversales (sugeridas en §5)

Tickets futuros, **post-P3**:

- **Motor de recordatorios/vencimientos** transversal (P4.21).
- **Dashboard de prevención** (P4.22): home del área con pendientes y
  vencimientos consolidados.
- **Bitácora/change-log reutilizable** (P4.23): extraer patrón PDTP a helper
  genérico.

## Orden de ejecución recomendado

1. **P1.1 → P1.2 → P1.3 → P1.4** (1–2 días, sin migraciones riesgosas
   salvo P1.3). ✅ Hecho en una iteración previa.
2. **P2.5 → P2.6 → P2.7 → P2.8 → P2.9 → P2.10 → P2.11** (2–3 días). ✅
   Hecho en una iteración previa.
3. **P3 por submódulo** — **✅ hecho 2026-07-01** (salvo lo anotado en
   cada ticket arriba). La mayoría de los submódulos ya estaban
   implementados (sin comitear) al empezar esta iteración; lo que
   realmente faltaba y se cerró ahora fue **P3.17 (epp)**,
   **P3.19 (contratistas)**, **P3.20 (kpis)** y **P3.21 (permisos)**,
   más el fix de permission-parity y P3.22 (restricciones de salud,
   parcial — ver arriba).
4. **P3.22 (transversales): restricciones de salud visibles** ✅ parcial
   (capacitaciones/equipos/incidentes; PPA queda fuera, ver arriba) —
   **DIAT automática → matriz de capacitación por cargo → SLA de
   notificación** ❌ no se tocaron, siguen pendientes.
5. **P4 después de P3**: motor de recordatorios (21), dashboard (22),
   bitácora reutilizable (23). ❌ No se tocaron esta iteración.

## Estado final 2026-07-01 — lo que queda pendiente

Con todo lo de arriba cerrado, esto es lo que sigue **genuinamente
abierto** después de esta iteración:

1. **Índice de gravedad (IG) en KPIs** — requiere agregar una columna de
   "días perdidos" a `prevention_incidents` (o tabla relacionada) +
   flujo de captura; sin eso la fórmula chilena no es calculable.
2. **`getCriticalStock` / badge de stock bajo en EPP** — bloqueado en
   una decisión de producto: `eppProductId` es texto libre sin FK a
   `products`/bodega, así que no hay ningún dato de stock actual con el
   que comparar el umbral configurado.
3. **Restricciones de salud en PPA** — el flujo real de PPA no tiene
   noción de "trabajador firmante con tarea específica"; requiere
   diseñar una taxonomía de tareas en PPA antes de poder bloquear o
   advertir por restricción médica ahí.
4. **Anomalía de equipos → ticket de mantención** — `lib/services/
   maintenance.ts` es estrictamente de flota vehicular
   (`maintenanceRecords.vehicleId`), sin soporte para equipos genéricos;
   requiere decisión de diseño (polimorfismo del activo o tabla
   separada) antes de conectar.
5. **DIAT automática desde incidente** (PDF con formato legal) — no
   intentado, requiere el formato exacto de la Dirección del Trabajo.
6. **Matriz de capacitación por cargo** (`capacitaciones/matriz/page.tsx`)
   — vista cruzada cargo × curso, no construida (el campo
   `requiredForCargo` ya existe).
7. **SLA de notificación de incidente** (badge por tiempo excedido desde
   `occurredAt`) — no construido.
8. **Alcotest**: escalamiento de resultado positivo es solo un toast, sin
   notificación real ni registro de suspensión de turno; tablero de tasas
   y programación de tests aleatorios no se construyeron.
9. **Contratistas: control de acceso a faena** — el registro de un
   contratista todavía no condiciona `resolveWorksiteScope` para limitar
   sus workers a las faenas donde estén autorizados.
10. **P4 completo** (motor de recordatorios/vencimientos transversal,
    dashboard de prevención, bitácora/change-log reutilizable) — ningún
    ítem se tocó.
11. **2 fallos de test preexistentes, sin relación con prevención**
    (confirmado con `git diff --stat`, cero archivos tocados en ambos
    casos): `scripts/capture-all-routes.test.ts` (el inventario de
    capturas de pantalla nunca incluyó ninguna ruta P3 — agregar ~20 con
    su seed data es un esfuerzo aparte) y
    `request-type-actions-rejection.test.ts` (módulo de
    solicitudes/servicios, no prevención).

## Criterio de cierre

Cada ítem de P1/P2 va con:
- test que falle antes del cambio,
- fix,
- test que pase después,
- `npm test` completo verde,
- `npm run lint` limpio,
- `npm run db:generate` reporta "No schema changes" tras cada migración.

Cada ticket P3 cierra con:
- 0 errores TS en la subcarpeta del submódulo (requisito: el módulo
  compila y carga).
- Permisos: `guardPermission("prevention:<área>:<verbo>")` en cada
  action (no `guardAuth` plano).
- Validación Zod en cada action; `safeParse` con `fieldErrors` por
  campo.
- Scope real: cada función que toca datos por worker/worksite debe
  pasar por `assertWorksiteAccess` o `assertWorkerAccess`.
- 1+ tests de servicio + 1+ tests de action cubriendo happy path y
  denegación.
- Sin CSV en exports (regla XLSX-only del proyecto).
- Sin errores preexistentes del submódulo propagados al cierre (los
  archivos rotos se resuelven como parte del ticket; ej.
  `checklist-form.tsx`, `committee-detail.tsx`, `alcotest-panel.tsx`,
  `prevention-contractors.ts`).
