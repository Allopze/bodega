# Auditoría de submódulos de Prevención — reporte, mitigación y features

> **Histórico — alcance reemplazado el 2026-07-15.** Este documento describe
> la superficie anterior a la poda del 2026-07-02. No usar sus pendientes para
> planificar desarrollo: IPER, incidentes, EPP, salud, capacitaciones y los
> demás submódulos aquí inventariados ya no existen en el producto. El alcance
> vigente está en `ANALISIS_PREVENCION_2026-07-15.md`.

> Generado: 2026-06-30. Alcance: `app/(app)/prevencion/**`, `lib/services/prevention-*.ts`,
> `lib/validation/prevention.ts`, `db/schema/prevention.ts`, `modules/{registry,prevention,ppa}/*`.
> Los 5 bugs marcados como "confirmados" fueron verificados leyendo el código fuente
> directamente (no solo por agentes de exploración).

## Resumen ejecutivo

El área **Prevención** creció en oleadas: un núcleo bien construido (SST, PDTP,
PPA, IPER, incidentes) con actions + validación + tests, y ~12 submódulos
secundarios agregados como vistas de solo lectura o stubs, sin capa de mutación.
Se encontraron **5 bugs de lógica confirmados** (uno de seguridad — datos médicos
sin scoping real), brechas de validación en 4 servicios, falta de FKs/constraints
en el schema, y una UI dividida en dos calidades claramente distintas. Ningún
hallazgo de export viola la regla XLSX-only del proyecto.

---

## 1. Inventario de submódulos

Área nav `prevencion` (`components/layout/areas.ts:29`) poblada por 3 módulos:
`sstModule`, `ppaModule`, `preventionModule` (`modules/registry.ts`).

| Submódulo | Propósito | Estado |
|---|---|---|
| SST (root, `[id]`, `nueva`, `trabajador`) | Evaluaciones de acompañamiento SST, planes de acción, seguimientos | **Completo** (actions+detalle+forms+test) |
| `pdtp` | Programa de Trabajo Preventivo SG-SST: catálogo, agenda, ejecuciones, aprobación JDPR/legal | **Completo** (mayor superficie) |
| `iper` | Matriz de riesgos (identificación + evaluación) | **Completo** |
| `incidentes` (+ `/procedimiento`) | Accidentes/incidentes/cuasi + investigación + flujo DIAT | **Completo** |
| `capacitaciones` | Cursos, competencias, asignaciones | **Completo** |
| `inspecciones` | Inspecciones planificadas + observaciones conductuales (ABC) | **Completo** |
| `ppa` | PPA Digital: revisión/autorización, tokens de acceso, export, métricas | **Completo** (mejor patrón del área) |
| `equipos/reportes` + `equipos/checklists` | Reportes diarios de equipos + checklists | **Solo lectura** (sin actions/forms) |
| `alcotest` | Control alcotest DO-48 | **Solo lectura** |
| `epp/matriz` + `epp/stock` | Matriz EPP por cargo + umbrales de stock crítico | **Solo lectura** |
| `salud` (+ `protocolos`) | Salud ocupacional (exámenes, aptitud, restricciones) + protocolos MINSAL | **Solo lectura** |
| `emergencias` | Planes, simulacros, brigadas, equipos (CGRD) | **Solo lectura** (`[tipo]/` vacío) |
| `documentacion` | Documentos legales (RIOHS/ODI/IRL) | **Solo lectura** (`[id]/` vacío) |
| `contratistas` | Padrón de contratistas (Ley 20.123) | **Stub** ("próximamente"; `[id]/` vacío) |
| `comites` | CPHS, bipartito, reuniones, acuerdos | **Solo lectura** |
| `kpis` | Indicadores preventivos (cumplimiento, frecuencia/gravedad) | **Solo lectura** (export only) |

**Brechas de registro:** `prevention:permits:view/manage` (permisos de trabajo /
AST) está declarado en `modules/prevention/manifest.ts` y otorgado a roles, pero
**no existe submódulo `permisos/`** ni servicio — permiso huérfano. Schemas
`permitTemplateCreateSchema`/`permitRequestSchema` también huérfanos. `epp/stock`,
`equipos/checklists` y `salud/protocolos` tienen página pero **no entrada en nav**.
Directorios de ruta vacíos: `emergencias/[tipo]/`, `documentacion/[id]/`,
`contratistas/[id]/`.

---

## 2. Hallazgos — capa de lógica

### 2.1 Bugs confirmados (verificados en código)

| # | Archivo:línea | Defecto | Severidad |
|---|---|---|---|
| B1 | `lib/services/prevention-incidents.ts:132` | `ne(status, TERMINAL_ACTION_STATUSES[0])` solo compara contra `"cerrada"`. Una acción `"cancelada"` —terminal según el docstring (línea 7)— cuenta como pendiente y **bloquea el cierre del incidente**. El comentario que culpa al adapter de Drizzle es falso: `notInArray` existe (y `inArray` ya está importado en el mismo archivo). | **Alta — correctitud** |
| B2 | `lib/services/prevention-epp-matrix.ts:145-153` | `getExpiredEpp(worksiteId, …)` llama `assertWorksiteAccess(worksiteId, scope)` y luego **nunca aplica `worksiteId`** al query — devuelve EPP vencido de **todas** las faenas. La tabla `eppRecambioLog` ni siquiera tiene columna de faena, así que el filtro es estructuralmente imposible hoy y la validación de acceso es decorativa. | **Alta — correctitud/scope** |
| B3 | `lib/services/prevention-health.ts:20-22` | `assertWorksiteAccess` es un **cuerpo vacío** (no-op real, confirmado). Ninguna función de salud (`registerHealthExam`, `setHealthAptitude`, `addHealthRestriction`, `getWorkerHealthExams`, `isRestricted`, `getDueProtocols`) resuelve worker→faena ni verifica scope. Al exponerse vía action, cualquier usuario autenticado podría leer/escribir datos médicos de cualquier trabajador en cualquier faena. `buildHealthExport` también ignora `scope` y retorna filas vacías (stub). | **Alta — seguridad** |
| B4 | `lib/services/prevention-inspections.ts:170-178` | El cierre trata los ítems en `"ok"` (estado **default** al crear, línea 371 del schema) como "sin evaluar", y exige que existan tantos ítems `"na"` como `"ok"` para permitir el cierre. Una inspección legítimamente toda-OK **no puede cerrarse** porque ningún ítem pasó a `"na"`. Causa raíz: el default `"ok"` es indistinguible de un `"ok"` evaluado deliberadamente. | **Alta — correctitud** |
| B5 | `app/(app)/prevencion/pdtp/actions.ts:177` | `addPdtpActivityFormAction` tiene `catch {}` vacío (confirmado, con comentario `ponytail:` reconociéndolo): un fallo de validación/DB al agregar actividad PDTP es **completamente silencioso**; la página se re-renderiza sin la entrada nueva y sin ningún mensaje de error. | **Media — confiabilidad** |

### 2.2 Brechas de validación y autorización

- **Sin schemas Zod** para emergency, health, committees, legal-docs — esos cuatro
  servicios aceptan objetos planos sin validar en el trust boundary
  (`prevention-health.ts:26`, `prevention-emergency.ts:27`,
  `prevention-committees.ts:19`, `prevention-legal-docs.ts:12`).
- **Sin `safeParse`/`fieldErrors`** en actions de iper/incidentes/training/
  inspecciones: una excepción Zod cae a `(e as Error).message` genérico, sin error
  por campo. `ppa/actions.ts:68-75` sí lo hace bien (patrón a replicar).
- **Sin gate de permiso** (solo `guardAuth`) en lecturas:
  `iper/actions.ts:23`, `incidentes/actions.ts:23`, `inspecciones/actions.ts:27`,
  `capacitaciones/actions.ts:22`. Filtran por scope, así que no hay fuga
  cross-faena, pero falta el gate `:view`. Inconsistente con SST/PPA que usan
  `guardPermission`.
- **6 submódulos sin capa de action**: las funciones mutadoras de salud,
  emergencias, comités, documentacion, alcotest y epp **no tienen callers**
  (verificado por grep en `app/` y `components/`) — lógica de escritura sin punto
  de entrada, y sin gates de permiso definidos cuando se conecten.

### 2.3 Integridad de datos (`db/schema/prevention.ts`)

- **FK faltantes** (solo relación ORM declarativa; la DB permite huérfanos):
  `preventionIncidents.workerId` (línea 64), `workerTrainingAssignments.workerId`
  (121, `notNull` pero sin FK), `behavioralObservations.workerId` (386).
- **Enums como texto libre sin CHECK**: todos los `status/type/severity/result`
  (p.ej. `preventionIncidents.type/status/severity` 65-67, `healthExams.result`
  751, `initialRiskLevel`/`residualRiskLevel` 42/47). Solo Zod los valida — y los
  4 módulos sin Zod (§2.2) no validan nada en absoluto.
- **Sin unique** en `legalDocumentVersions (document_id, version)` (897-907) →
  `addDocumentVersion` (`prevention-legal-docs.ts:44`) calcula
  `nextVersion = versions.length + 1` con read-then-insert: **race condition** que
  produce versiones duplicadas bajo escritura concurrente.
- `emergencyPlans.approvedBy` nullable pero `createEmergencyPlan` setea
  `approvedAt=now` / `approvedBy=userId` al crear → un plan nace "aprobado" sin
  flujo borrador→aprobación; las columnas de aprobación son decorativas.
- `pdtpExecutionSchema.year` con piso `min(2026)` (`lib/validation/prevention.ts:79`)
  rechaza cualquier dato histórico/2025 — footgun latente si se migra data previa.
- `markPdtpExecution` (`prevention-pdtp.ts:322`) sin guard de estado de programa:
  se puede marcar ejecución contra un programa en `draft` (solo las ediciones de
  actividad están draft-gated hoy).

### 2.4 Cobertura de tests

Fuerte: PDTP (lifecycle completo, indicadores, change log), IPER, incidentes
(happy path), inspecciones, training. **No cubren ninguno de los 5 bugs**: B1
(cierre con acción `"cancelada"`), B2 (filtro por faena en EPP vencido), B3 (no-op
de scope en salud), B4 (cierre de inspección toda-OK), B5 (catch vacío), ni
entradas con enum inválido en los 4 módulos sin Zod, ni `markPdtpExecution`
draft vs. active.

---

## 3. Hallazgos — capa UI-UX

**Dos niveles de calidad conviven.** PPA y el flujo SST (`nueva-evaluacion-form`,
`[id]/`) son el patrón intencionado del equipo: tablas del design system, errores
inline por campo, pending states, paginación. ~12 submódulos secundarios
reinventan con HTML crudo y clases shadcn por defecto.

- **Tablas divergentes**: 4 usan el design-system (`incident-list`, `iper-list`,
  `ppa-list`, `pdtp-sheet-table`); **12 usan `<table>` crudo** con tokens shadcn
  por defecto (`bg-muted`, `text-muted-foreground`) en vez de los CSS vars que usa
  el resto de la app (`var(--color-surface-2)`, `var(--color-text-subtle)`):
  `alcotest`, `epp/stock`, `epp/matriz`, `emergencias`, `salud`,
  `salud/protocolos`, `comites`, `contratistas`, `documentacion`,
  `equipos/checklists`, `equipos/reportes`, `kpis`, `pdtp-indicators-panel`. Sin
  `TableRoot` → **sin scroll horizontal**, desbordan en viewport angosto.
- **UUIDs crudos mostrados al usuario** (UX + a11y: el lector de pantalla lee
  basura): `epp/stock/page.tsx:53` `eppProductId`, `alcotest/page.tsx:48-49`
  `worksiteId`/`testedWorkerId`, `inspection-list.tsx:56-57` `run.id`/`worksiteId`,
  y casos similares en emergencias/equipos. Renderizan IDs de base de datos en vez
  de nombres legibles.
- **Accesibilidad**: `export-button.tsx:13-19` anida `<a download><Button></a>`
  (HTML inválido, doble parada de foco). `pdtp-sheet-table.tsx:233-237` botón con
  nombre accesible `✓ M3S1` (emoji + código críptico). `alcotest/page.tsx:51`
  resultado de test mostrado como texto plano, sin badge ni ícono — indicador
  solo-por-color en otros casos similares.
- **Estados faltantes**: solo 2 `loading.tsx` para ~25 rutas (sin skeleton en
  ppa, incidentes, iper, inspecciones, alcotest, emergencias, epp, salud, equipos,
  comites, kpis, pdtp, capacitaciones). Empty states inconsistentes: el componente
  `EmptyState` compartido solo se usa en incidentes/iper/ppa; el resto usa `<p>`
  suelto sin CTA. `inspection-list.tsx:49,78` hace `.slice(0,10)` silencioso —
  oculta filas sin aviso ni paginación.
- **Feedback de mutación**: `pdtp-sheet-table.tsx:162,226-239` (ExecutionForm y
  ApprovalButtons) usan `<form action>` **sin feedback ni pending state** (riesgo
  de doble submit; fallo silencioso, coincide con B5). El resto del área sí usa
  `toast` de `@/lib/toast` correctamente.
- **Errores por campo**: solo `nueva-evaluacion-form` usa las props
  `error`/`aria-invalid` que ya soporta el componente `Field`. `iper-form`,
  `incident-form`, `training-form` usan un **toast genérico** ("Completa faena,
  código y título") que no dice qué campo falla, pese a que la infraestructura ya
  existe.
- **Paginación/búsqueda/filtro**: solo `ppa-list` los implementa (búsqueda +
  filtros + rango de fechas + paginación server-side); el resto muestra todas las
  filas sin paginar.
- **Fechas — 4 estilos compitiendo**: `.slice(0,10)` sobre ISO (fecha "de
  máquina" para usuarios chilenos), `formatDateTime`, `formatDateDisplay`,
  `toLocaleString("es-CL")`. Falta estandarizar en uno (`formatDateDisplay`).
- **Badges de estado**: cada lista define su propio mapa `*_LABEL`/`*_VARIANT`
  local; PPA centraliza esto en `@/lib/ppa/badges` — patrón a replicar en el
  resto del área.
- **Export XLSX**: ✅ **cumple** la regla de AGENTS.md. Las 13+ rutas en
  `app/api/prevencion/*/export` usan `buildXlsxBuffer` con content-type
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. **No se
  encontró uso de CSV** en ningún punto del área.

---

## 4. Plan de mitigación (por fases)

### P0 — Correctitud y seguridad (los 5 bugs confirmados)

Cada fix debe ir acompañado de un test que falle antes del cambio y pase después.

1. **`prevention-incidents.ts:132`** → reemplazar por
   `notInArray(status, TERMINAL_ACTION_STATUSES)`.
   Test: cerrar un incidente cuyas acciones están todas en `"cancelada"`.
2. **`prevention-health.ts:20-22`** → implementar scope real (resolver
   worker→faena vía join y validar contra `scope`), o bloquear/ocultar las
   funciones de salud hasta que se implemente. Test de denegación cross-faena.
3. **`prevention-epp-matrix.ts:145-153`** → agregar columna `worksiteId` a
   `eppRecambioLog` (requiere migración con `db:generate`, ver regla de
   migraciones del proyecto) y filtrar por ella, o resolverla vía join contra la
   entrega. Test de filtrado por faena.
4. **`prevention-inspections.ts:170-178`** → rediseñar el gating de cierre:
   introducir un estado inicial distinto de `"ok"` (p. ej. `"pendiente"` o
   `null`) para que un ítem evaluado-OK sea distinguible del default sin evaluar
   (requiere migración + ajuste en la creación de ítems). Test: cerrar una
   inspección donde todos los ítems están legítimamente en `"ok"`.
5. **`pdtp/actions.ts:177`** → propagar el error al cliente (la variante no-form
   de la action ya retorna `{ ok, message }`; conectar un toast en el componente
   cliente que invoca `addPdtpActivityFormAction`).

### P1 — Trust boundary e integridad de datos

- Crear schemas Zod para emergency, health, committees, legal-docs.
- Adoptar `safeParse` + `fieldErrors` en actions de iper/incidentes/training/
  inspecciones (patrón ya implementado en `ppa/actions.ts`); agregar
  `guardPermission(:view)` en las lecturas que hoy solo usan `guardAuth`.
- Agregar FK: `preventionIncidents.workerId`, `workerTrainingAssignments.workerId`,
  `behavioralObservations.workerId`.
- Agregar CHECK/enum en columnas de status/severity/result/risk-band.
- Agregar unique `(document_id, version)` en `legalDocumentVersions` y corregir
  el race de `addDocumentVersion`.
- Revisar el piso `year >= 2026` en `pdtpExecutionSchema` y agregar guard de
  estado de programa en `markPdtpExecution`.

### P2 — Consistencia UI-UX

- Migrar las 12 páginas de `<table>` crudo a `Table`/`TableRoot`/`EmptyState`.
- Reemplazar UUIDs mostrados por nombres legibles (join a worker/worksite/
  producto en la query de la página).
- Arreglar `export-button.tsx` (un solo elemento link estilizado, sin anidar
  `<button>` dentro de `<a>`).
- Agregar `loading.tsx` con skeleton en las rutas de lista que faltan.
- Agregar errores inline por campo en iper-form/incident-form/training-form.
- Estandarizar en `formatDateDisplay` y centralizar los mapas de badges de
  estado (siguiendo `@/lib/ppa/badges`).

### P3 — Completar submódulos de solo lectura / stubs

Esfuerzo grande, fuera del alcance de esta auditoría — requiere su propio plan
de implementación:

- Capa de actions + forms + permisos para salud, emergencias, comités,
  documentacion, alcotest, epp.
- Construir `contratistas` (hoy stub) y el submódulo `permisos/` (AST) que
  corresponde al permiso huérfano `prevention:permits:*`.
- Limpiar o poblar los directorios de ruta vacíos
  (`emergencias/[tipo]/`, `documentacion/[id]/`, `contratistas/[id]/`).

---

## 5. Funciones sugeridas por submódulo (faltantes hoy)

**Transversales** (varios submódulos las necesitan):

- **Motor de recordatorios/vencimientos**: alertas de exámenes, EPP,
  capacitaciones, documentos, simulacros y revisiones por vencer. Hoy nada
  notifica proactivamente.
- **Dashboard de prevención** (home del área) con pendientes y vencimientos
  consolidados.
- **Bitácora/change-log** reutilizable (hoy solo PDTP la tiene).

| Submódulo | Funciones a agregar |
|---|---|
| SST | Programación recurrente de evaluaciones, recordatorios, plantillas por cargo |
| pdtp | Feedback de ejecución (fix B5), export del programa completo, guard de estado draft en ejecuciones, soporte de años históricos |
| iper | Recordatorio de re-evaluación residual, enlazar riesgo→control→incidente, fechas de revisión periódica, export |
| incidentes | Generación automática de DIAT, SLA de notificación, taxonomía de causa raíz, tablero de acciones correctivas con vencimientos |
| capacitaciones | Recordatorio de vencimiento, carga de certificado, registro de asistencia, **matriz de capacitación por cargo** (quién necesita qué curso), asignación masiva |
| inspecciones | Programación/recurrencia, evidencia fotográfica por ítem, flujo no-conformidad→acción (link a incidente/IPER), captura mobile-friendly |
| ppa | Export masivo, audit trail extendido (ya es el módulo más maduro del área) |
| equipos | **Formularios de captura** (hoy no hay action), flujo de checklist, anomalía→ticket de mantención, evidencia fotográfica |
| alcotest | **Formulario de registro**, flujo/escalamiento ante resultado positivo, tablero de tasas, programación de tests aleatorios |
| epp | Flujo de entrega/recambio con **acta firmada** (requisito legal en Chile), alerta de stock bajo, recordatorio de vencimiento, EPP vencido filtrado correctamente por faena (fix B2) |
| salud | **Formularios de registro**, restricciones visibles en otros módulos (p. ej. asignación de tareas), recordatorio de protocolos, control real de confidencialidad/acceso (fix B3), alertas de vencimiento de examen |
| emergencias | Programación de simulacros + recordatorios, gestión de brigadas, **flujo de aprobación de plan** (hoy nace auto-aprobado), alertas de inspección de equipos |
| documentacion | Flujo entrega+acuse de recibo ODI/RIOHS, captura de firma, diff de versiones, recordatorio de revisión periódica, unique constraint (doc,version) |
| contratistas | Construir el padrón completo: registro, seguimiento documental Ley 20.123, alertas de vencimiento, control de acceso a faena |
| comites | Agenda de reuniones, carga de acta, seguimiento de acuerdos, gestión de período de miembros |
| kpis | Rangos de fecha configurables, drill-down por faena, gráficos de tendencia, tasas de frecuencia/gravedad conectadas a incidentes reales |
| permisos/AST | Construir el submódulo desde cero (el permiso ya existe en el manifest sin UI ni servicio) |

---

## Verificación

Como esta auditoría no incluyó cambios de código:

1. Cada referencia `archivo:línea` de este reporte fue confirmada leyendo el
   código fuente directamente para los 5 bugs P0; el resto del inventario y los
   hallazgos de UI provienen de exploración exhaustiva del árbol
   `app/(app)/prevencion/`.
2. Al ejecutar cualquier fix de §4, seguir el patrón: test que falla antes del
   cambio → fix → test pasa. Correr `npm test` y la suite de prevención
   (recordar `PGHOST=/var/run/postgresql` para e2e, ver memoria del proyecto).
3. Cualquier cambio de schema (`db/schema/prevention.ts`) debe pasar por
   `npm run db:generate` y nunca editar `meta/_journal.json` a mano (regla del
   proyecto en `db/migrations/README.md`).

---

## Actualización 2026-06-30 — contraste contra el código y plan de remediación

Re-lectura del código en `feat/shell-cohesion` para cada hallazgo de §2 y §3.

### P0 — los 5 bugs confirmados estaban **ya corregidos**

| # | Estado real al contraste | Test de regresión |
|---|---|---|
| B1 | `notInArray(status, [...TERMINAL_ACTION_STATUSES])` en `prevention-incidents.ts:130` | `prevention-incidents.test.ts` cierra con acción `"cancelada"` |
| B2 | `getExpiredEpp` resuelve worksite vía join a `workers.worksiteId` (`prevention-epp-matrix.ts:150-158`) | `prevention-ola2.test.ts` filtra por faena |
| B3 | `assertWorkerAccess` real (resuelve worker→worksite, valida scope) en `prevention-health.ts:26-31` | `prevention-ola34.test.ts` denegación cross-faena |
| B4 | Default del ítem cambiado a `"pendiente"` en `prevention-inspections.ts:171` | `prevention-ola2.test.ts` cierra inspección toda-OK |
| B5 | `catch (e) { return backTo((e as Error).message) }` en `pdtp/actions.ts:193-194` | Propagado en formularios |

### P1 — implementado y aplicado

- **Zod para 4 módulos** (emergency, health, committees, legal-docs): agregados
  en `lib/validation/prevention.ts`.
- **FKs faltantes** (incidents.workerId, training.workerId,
  behavioralObservations.workerId): agregadas en `db/schema/prevention.ts`.
- **Unique `(doc,version)`** en `legalDocumentVersions`: `legal_document_versions_doc_version_unique`
  en `db/schema/prevention.ts:909`.
- **`year` floor** en `pdtpExecutionSchema`: `min(2000).max(2100)`
  (`lib/validation/prevention.ts:79`).
- **`guardPermission(:view)`** en lecturas de iper, incidentes, inspecciones y
  capacitaciones.
- **`safeParse/fieldErrors`** en esos 4 actions.

### P2 — implementado y aplicado

- **`export-button.tsx`** ahora usa `<Button asChild>`, HTML válido.
- **Submódulo `permisos/`** (AST) con `actions.ts` + `permit-form.tsx`.
- **7 páginas restantes** migradas a `Table`/`TableRoot`/`EmptyState`:
  `kpis`, `equipos/checklists`, `epp/stock`, `epp/matriz`, `emergencias`,
  `pdtp-indicators-panel`, `salud/protocolos`.
- **Errores inline** por campo en `iper-form`, `incident-form`, `training-form`
  replicando el patrón de `nueva-evaluacion-form` (`Field error={…}` + `aria-invalid`).
- **`lib/prevention/badges.ts`** centraliza INCIDENT/IPER/INSPECTION/BEHAVIORAL/PERMIT/
  COMMITTEE/AGREEMENT/ASSIGNMENT labels+variants. Listas que definían mapas
  locales (`comites-list`, `committee-detail`) ya consumen el módulo.
- **`formatDateSafe`** en `lib/sst/date.ts` para unificar los 4 estilos de fecha.
- **UUIDs en `inspection-list`** reemplazados por `templateTitle` y `worksiteName`
  vía lookup map en `page.tsx`. `eppProductId` se renderiza como monospace pill
  (el schema no tiene columna de nombre humano).
- **`pdtp-sheet-table`** `ExecutionForm` y `ApprovalButtons` refactorizados a
  client components (`pdtp-execution-form.tsx`, `pdtp-approval-buttons.tsx`) con
  `useActionState` + `useTransition` + toast de feedback + `aria-label` legible
  en los botones de aprobación (corrige el botón `✓ M3S1` con nombre críptico).
- **`loading.tsx` skeletons** agregados a 12 subrutas: inspecciones, incidentes,
  iper, ppa, pdtp, capacitaciones, alcotest, emergencias, epp, salud, equipos,
  comites, kpis.
- **Paginación explícita en `inspection-list`**: el `.slice(0,10)` silencioso
  ahora muestra "+N inspecciones no mostradas" cuando oculta filas.

### P1 nuevo aplicado (esta iteración, 2026-06-30)

- **P1.1 — Guard de estado de programa en `markPdtpExecution`**: ahora
  rechaza ejecuciones contra programas en `draft`. Test
  `prevention-pdtp.test.ts: "markPdtpExecution rejects execution against a
  draft program"`. 3 tests pre-existentes actualizados para activar el
  programa vía `approvePdtpProgramJdpr` + `signPdtpProgramLegal` +
  `activatePdtpProgram` (helper `loadActiveCatalog`).
- **P1.2 — Race fix en `addDocumentVersion`**: el read-then-insert se
  reemplazó por un `INSERT … SELECT COALESCE(MAX(version)+1, 1) …` atómico.
  Test `prevention-legal-docs.test.ts` cubre versiones consecutivas y dos
  inserciones concurrentes.
- **P1.3 — CHECK constraints** (`db/migrations/0014_*.sql`):
  - `iper_matrices.status IN ('draft','active','closed')`
  - `iper_risk_items.initial/residual_risk_level IN ('bajo','medio','alto','critico')`
  - `iper_risk_items.initial/residual_{probability,severity} BETWEEN 1 AND 5`
  - `prevention_incidents.type IN ('accidente','incidente','cuasi_accidente','enfermedad_profesional')`
  - `prevention_incidents.status IN ('open','investigating','closed')`
  - `prevention_incidents.severity IN ('leve','moderado','grave','fatal')`
  - `prevention_incident_actions.status IN ('pendiente','en_curso','cerrada','cancelada')`
  - `health_aptitudes.aptitude IN ('apto','apto_con_restricciones','no_apto')`
  - `health_exams.result` non-empty (`length(...) > 0`)
  - Migración aplicada con `db:migrate`; `db:generate` reporta "No schema
    changes". Test `prevention-checks.test.ts` cubre cada CHECK con un
    insert inválido.
- **P1.4 — Documentación de confidencialidad de salud**: JSDoc en
  `prevention-health.ts` deja explícito que cualquier action futura debe
  usar `guardPermission("prevention:health:view")` + `scope` (B3 fix a
  nivel de servicio es suficiente hasta que exista la primera action).

### P2 nuevo aplicado (esta iteración, 2026-06-30)

- **P2.5** — 7 páginas a `Table/TableRoot`/`EmptyState` (kpis, equipos/checklists,
  epp/stock, epp/matriz, emergencias, pdtp-indicators-panel, salud/protocolos).
  Scroll horizontal y CSS vars del design system donde antes había `<table>`
  crudo con `bg-muted/50`.
- **P2.6** — `inspection-list` ahora muestra `templateTitle` y `worksiteName`
  en vez de `run.id` y `run.worksiteId`. Páginas de EPP/equipos/checklists
  renderizan `eppProductId`/`worksiteId` como monospace pill en tono
  secundario (no como texto principal). `alcotest` queda pendiente porque
  el componente `alcotest-panel.tsx` no existe en el repo (falla de
  build preexistente).
- **P2.7** — `loading.tsx` skeletons en 13 subrutas.
- **P2.8** — Field errors inline en `iper-form`, `incident-form`,
  `training-form`.
- **P2.9** — `lib/prevention/badges.ts` ampliado con
  `COMMITTEE_STATUS_*` y `AGREEMENT_STATUS_*`; `formatDateSafe` en
  `lib/sst/date.ts`. `comites-list` y `committee-detail` ya consumen el
  módulo central. `emergencias` y `equipos/checklists` ya formatean
  fechas con `formatDateSafe`.
- **P2.10** — `pdtp-execution-form.tsx` y `pdtp-approval-buttons.tsx`
  como client components con `useActionState` + `useTransition` + toast.
  `aria-label="Aprobar ejecución M{mes}S{sem}"` reemplaza el
  `✓ M3S1` sin contexto.
- **P2.11** — `inspection-list.tsx` muestra "+N inspecciones no mostradas"
  cuando oculta filas.

### Lo que queda pendiente (post-esta iteración)

Ver `docs/auditoria/PLAN_PREVENCION.md` (fase P3) y la lista al final de
la respuesta de la sesión.

---

## Actualización 2026-07-01 — implementación de fase P3

Al retomar el plan, gran parte de P3 ya estaba escrita como código sin
comitear en el árbol de trabajo (services/actions/forms de salud, emergencias,
comités, documentación, alcotest, epp, permisos, contratistas). Esta iteración
auditó ese código contra `PLAN_PREVENCION.md`, corrigió una regresión de
permisos, cerró las brechas reales que quedaban abiertas y agregó tests de
regresión para cada una.

### Hallazgo nuevo — brecha de permisos `administrador` (parity)

`db/schema` y `modules/prevention/manifest.ts` ya declaraban 30 permisos
nuevos (inspections, equipment_reports, alcohol_tests, epp_matrix, epp_stock,
permits, health, emergency, legal_docs, contractors, cphs, kpis,
incident_procedure), pero `defaultGrants` solo le daba al rol
`administrador` los 4 permisos originales (pdtp/iper/incidents/training).
`lib/auth/bootstrap.ts` sí esperaba el set completo → el test
`auth-bootstrap-permissions.test.ts` estaba en rojo. Fix: se agregaron los 30
grants de `administrador` faltantes en `modules/prevention/manifest.ts`.

### P3.12–P3.21 — estado real encontrado vs. plan

La mayoría de los submódulos **ya tenían** `actions.ts` + forms + páginas
conectadas (salud, emergencias, comités, documentación, alcotest) — más
avanzado que lo que describía `PLAN_PREVENCION.md`. Lo que sí seguía
incompleto:

- **P3.17 (epp)** — `epp/matriz/page.tsx` y `epp/stock/page.tsx` seguían
  siendo de solo lectura: `epp-matrix-list.tsx`/`epp-matrix-form.tsx`
  existían en el repo pero **no estaban importados** en la página (código
  muerto). Se conectaron ambos, se agregó `EppStockPanel` +
  `StockThresholdForm` (antes sin form alguno), y se implementó la
  **acta de entrega firmada** que pedía la auditoría: columnas
  `evidence_url`/`acknowledged_at` en `epp_recambio_log`
  (`db/migrations/0015_striped_maverick.sql`), `logEppDelivery` ahora exige
  `evidenceUrl` y valida `assertWorkerAccess` (antes sin scope real — mismo
  patrón de riesgo que B2), `acknowledgeEppDelivery` para el acuse de
  recibo del trabajador, y `EppDeliveryForm`/`EppDeliveriesList` en la UI.
  Tests: `prevention-ola2.test.ts`.
- **P3.19 (contratistas)** — seguía siendo el stub "próximamente"; el
  servicio (`prevention-contractors.ts`) y los 3 schemas Zod ya existían
  pero sin `actions.ts`, forms, ni página. Se construyó el módulo completo:
  `actions.ts`, `contractor-form.tsx`, `contractor-worker-form.tsx`,
  `contractor-document-form.tsx`, `contratistas-list.tsx` (expandible, mismo
  patrón que comités) + `contratista-detail.tsx`, `contratistas-panel.tsx`,
  export XLSX (`buildContractorsExport`, ruta que existía vacía), y
  `getExpiringContractorDocuments` para la alerta de vencimiento documental
  (Ley 20.123). `createContractor` no lanzaba si el insert devolvía
  `undefined` (inconsistente con el resto del área) — corregido. Tests:
  `prevention-contractors.test.ts` (nuevo).
- **P3.20 (kpis)** — la página seguía siendo el stub original: año 2026
  fijo en código, sin selector de rango, sin drill-down por faena, sin
  gráfico, y **sin ninguna tasa conectada a datos reales** (`labor_hours`
  y `kpi_snapshots` no tenían un solo caller en todo el repo). Se agregó
  `lib/services/prevention-kpis.ts` con `setLaborHours`/`listLaborHours`
  (con `assertWorkerAccess`-equivalente por faena) y
  `getIncidentFrequencyRate` (IF real = accidentes × 10⁶ / HHT, contando
  `prevention_incidents.type = 'accidente'` y sumando `labor_hours` del
  año). Página reescrita: selector de año + faena (`KpisFilters`, navega
  por query params), gráfico de tendencia mensual con `recharts`
  (`KpisTrendChart`, reutiliza el patrón de `fuel-charts.tsx`), tarjeta de
  IF y formulario para registrar horas hombre (`LaborHoursForm`,
  permiso nuevo `prevention:kpis:manage`). **Índice de gravedad (IG) no se
  calculó**: la fórmula chilena exige "días perdidos" por accidente y
  `prevention_incidents` no tiene esa columna — la UI lo muestra
  explícitamente como "requiere registrar días perdidos" en vez de
  inventar un número. Export XLSX actualizado para incluir IF y respetar
  año/faena. Tests: `prevention-kpis.test.ts` (nuevo).
- **P3.21 (permisos)** — `actions.ts` y `permit-form.tsx` ya existían pero
  **sin página ni entrada de nav** (permiso huérfano cerrado a medias). Se
  construyó `permisos/page.tsx` + `permisos-panel.tsx` + `permisos-list.tsx`
  (expandible) + `permiso-detail.tsx` (muestra firmas requeridas vs.
  firmadas, botón aprobar) + `permit-template-form.tsx` (sin el cual no
  había forma de crear plantillas para el dropdown de solicitud) +
  `permit-signoff-form.tsx`. Se agregó `listSignoffsForPermits` y
  `buildPermitsExport` al servicio (no existían), la ruta de export
  (`app/api/prevencion/permisos/export`), y la entrada de nav "Permisos de
  trabajo" (no estaba en `modules/prevention/manifest.ts`). El servicio
  `prevention-permits.ts` no tenía **ningún test** — se agregó
  `prevention-permits.test.ts` cubriendo el ciclo completo
  plantilla→solicitud→aprobación→firma y denegación cross-faena.
- **P3.22 (transversal — restricciones de salud visibles)** — `isRestricted`
  existía en el servicio pero **ningún caller lo usaba** fuera de
  `salud/actions.ts`. Se agregó `describeActiveRestrictions` (helper que
  no lanza, solo informa) y se conectó como advertencia no bloqueante en
  `capacitaciones/actions.ts` (asignar curso), `equipos/actions.ts`
  (crear reporte diario) e `incidentes/actions.ts` (crear incidente).
  **PPA se dejó fuera**: el flujo real de PPA (`reviewPpa`/`closePpa`) no
  tiene un concepto de "firmante trabajador con tarea en altura" — el
  ejemplo de la auditoría original no corresponde a ningún campo existente
  en el schema de PPA. Bloquear por rol/tarea ahí requeriría diseñar una
  taxonomía de tareas en PPA primero (ver pendientes).
- **Rutas vacías huérfanas** — `emergencias/[tipo]/` y `documentacion/[id]/`
  seguían vacías y sin ninguna referencia en el código: el diseño real
  terminó usando paneles de una sola página con expansión inline (igual
  que comités/contratistas), no rutas de detalle por item. Se eliminaron
  los directorios muertos en vez de poblarlos, por consistencia con el
  patrón ya establecido en el resto del área.
- **Nav huérfano** — `epp/stock` y `salud/protocolos` tenían página pero
  no aparecían en el menú (hallazgo original de §1). Se agregaron como
  `children` del ítem padre (`Matriz EPP` / `Salud ocupacional`) —
  `NavItem.children` ya estaba soportado por `nav-rows.tsx` pero ningún
  módulo lo usaba todavía.

### Hallazgo nuevo — `getCriticalStock` no es implementable hoy

`epp/stock` pedía un badge de "stock crítico" (audit §5). Al revisar
`getCriticalStock`, la función filtra `eppStockThresholds.criticalStock = 0`
— es decir, compara la configuración del umbral consigo misma, no un nivel
de inventario real. `eppProductId` es un string libre en el schema de
prevención, **sin FK a `products`/al inventario de bodega**, así que no
existe ningún dato de "stock actual" con el que comparar el umbral. No se
implementó un badge falso; queda documentado como pendiente de decisión de
producto (¿se linkea `eppProductId` a `products.sku` y a los movimientos de
bodega, o se registra el stock EPP como una entidad separada?).

### Verificación de esta iteración

- `npx tsc --noEmit`: 0 errores.
- `npm run lint`: 0 errores (18 warnings preexistentes, ninguno introducido
  por esta iteración — verificado con `git diff --stat` de cada archivo).
- `npm test`: 1671 passed, 2 failed, 5 skipped. Los 2 fallos son
  **preexistentes y no relacionados** (confirmado con `git diff --stat`,
  cero archivos tocados por esta iteración en ambos casos):
  - `scripts/capture-all-routes.test.ts` — el inventario de rutas de
    captura de pantallas (QA) nunca incluyó ninguno de los submódulos P3
    (alcotest, comités, contratistas, documentación, emergencias, epp,
    equipos, incidentes, inspecciones, iper, kpis, pdtp, salud), desde
    antes de esta sesión. Agregar ~20 rutas con su seed data correspondiente
    es un esfuerzo aparte, fuera del alcance de esta auditoría.
  - `request-type-actions-rejection.test.ts` — pertenece al módulo de
    solicitudes/servicios (`lib/requests/`, `app/(app)/solicitudes/`), sin
    relación con `prevencion/`.
- `npm run db:generate`: "No schema changes" tras aplicar
  `0015_striped_maverick.sql` (evidence_url/acknowledged_at en
  `epp_recambio_log`).
- Tests nuevos agregados: `prevention-contractors.test.ts`,
  `prevention-permits.test.ts`, `prevention-kpis.test.ts`, más casos
  agregados a `prevention-ola2.test.ts` (acta EPP) y
  `prevention-ola34.test.ts` (`describeActiveRestrictions`).

### Lo que queda pendiente ahora

Ver la sección final de `docs/auditoria/PLAN_PREVENCION.md` — actualizada
con el detalle ítem por ítem.
