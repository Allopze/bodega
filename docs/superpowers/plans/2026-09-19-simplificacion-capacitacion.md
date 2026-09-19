# Simplificación de capacitación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar un único modelo de cumplimiento de capacitación —se hizo / no se
hizo + evidencia, a nivel de actividad y faena— retirando por completo el
seguimiento por persona.

**Architecture:** Cuatro fases. Primero se reemplaza cada consumidor externo
mientras el modelo viejo sigue en pie, lo que permite afirmar equivalencia en un
test. Después se borran pantallas, servicios y esquema. El orden importa porque
la lógica que se pierde acá no falla en el compilador.

**Tech Stack:** Next.js 15 (App Router, RSC), Drizzle ORM + Postgres, Vitest
(unitarios + pglite), Playwright (E2E), TypeScript estricto.

**Spec:** `docs/superpowers/specs/2026-09-19-simplificacion-capacitacion-design.md`

## Global Constraints

- Rama de trabajo: `refactor/simplificacion-capacitacion-2026-09-19`.
- Tras cada tarea: `npm run typecheck` en verde antes de commitear.
- Comandos de test: `npm run test:fast` (unitarios), `npm run test:pglite`
  (los que tocan base), `npm run test` (todo).
- Permisos sobrevivientes, exactos: `prevention:training:view`,
  `prevention:training:record`, `prevention:training:export`.
- Permisos a retirar, exactos: `prevention:training:manage`,
  `prevention:training:approve`, `prevention:training:deliver`,
  `prevention:training:ack`, `prevention:training:convalidate`,
  `prevention:training:revoke`.
- Constante de catálogo vigente: `PREDEFINED_TRAINING_CATALOG_VERSION`
  = `"programa-capacitacion-2026-v1"` (`lib/prevention/training-occurrences-catalog.ts`).
- Las siete tablas a eliminar, en orden de drop: `prevention_training_history`,
  `prevention_competency_requirements`, `prevention_worker_competencies`,
  `prevention_training_attendance`, `prevention_training_sessions`,
  `prevention_training_course_versions`, `prevention_training_courses`.
- Ningún commit intermedio puede dejar el repo sin compilar.

---

## FASE 1 — Reemplazo de consumidores (nada se borra)

### Task 1: Instrumento PDTP desde el catálogo anual

**Files:**
- Modify: `lib/services/pdtp/instruments.ts`
- Modify: `lib/services/pdtp/instrument-gap.ts`
- Test: `lib/__tests__/pdtp-coverage-instrument-identity.test.ts`

**Interfaces:**
- Produces: variante `{ kind: "training_catalog_item", id, code, title,
  catalogVersion, isActive, blocker: "catalog_item_inactive" }` en
  `PdtpCoverageInstrument` y en `PdtpInstrumentRecord`.
- Consumes: `preventionTrainingCatalogItems.pdtpActivityNumbers` (jsonb
  `number[]`, `notNull().default([])`).

- [ ] **Step 1: Test de equivalencia (falla)**

Mientras ambos modelos coexisten, el conjunto de números de actividad habilitados
por ítems de catálogo debe coincidir con el habilitado por cursos con versión
publicada. Agregar a `pdtp-coverage-instrument-identity.test.ts` un caso que
siembre un curso con versión `published` y un ítem de catálogo activo con el
mismo `pdtpActivityNumbers`, y afirme que `loadPdtpInstrumentIndex` marca el
número como `usable` por el ítem.

- [ ] **Step 2: Correr y verificar que falla**

`npm run test:pglite -- pdtp-coverage-instrument-identity`
Esperado: FAIL, el índice no conoce `training_catalog_item`.

- [ ] **Step 3: Agregar el kind al índice**

En `loadPdtpInstrumentIndex`, reemplazar las dos consultas de `courses` y
`courseVersions` por una sola sobre `preventionTrainingCatalogItems` filtrando
`catalogVersion = PREDEFINED_TRAINING_CATALOG_VERSION`. `usable = isActive`.
Eliminar el mapa `versionsByCourseId` y la constante `VERSION_PROGRESS`.

- [ ] **Step 4: Ajustar el tipo y el mensaje**

En `instrument-gap.ts`, reemplazar la variante `training_course` y sus tres
blockers por `training_catalog_item` con blocker `catalog_item_inactive`.

- [ ] **Step 5: Tests en verde**

`npm run test:pglite -- pdtp-coverage-instrument-identity pdtp-fulfillment pdtp-lifecycle-instrument-gate`

- [ ] **Step 6: Commit**

### Task 2: Enlace de resolución PDTP

**Files:**
- Modify: `lib/prevention/pdtp-readiness-links.ts`
- Test: `lib/prevention/__tests__/pdtp-readiness-links.test.ts`

El destino `/prevencion/capacitacion` sólo lee `faena` y `year`
(`training-occurrence-list.tsx`). El enlace NO puede llevar `q` ni `tab`: el test
de ese archivo existe para impedir enlaces que lleguen a la pantalla correcta y
no hagan nada.

- [ ] **Step 1:** Cambiar el caso de `/prevencion/capacitacion/catalogo?tab=versions&q=CODE` a `/prevencion/capacitacion?year=YYYY` en el test, y actualizar el mapa de parámetros leídos por ruta.
- [ ] **Step 2:** Correr, verificar que falla.
- [ ] **Step 3:** Renombrar `trainingCourseLink` → `trainingCatalogItemLink` y devolver `/prevencion/capacitacion?year=${year}` con label `"Abrir el control anual"`. Actualizar el comentario de verificación de destinos con fecha 2026-09-19.
- [ ] **Step 4:** `npm run test:fast -- pdtp-readiness-links` en verde.
- [ ] **Step 5:** Commit.

### Task 3: Obligación N°57 desde la ocurrencia vencida

**Files:**
- Create: `lib/services/pdtp-adapters/occurrence-gap-connector.ts`
- Delete: `lib/services/pdtp-adapters/competency-gap-connector.ts`
- Modify: el registro de conectores que lo invoca
- Test: `lib/__tests__/pdtp-occurrence-gap-obligation.test.ts` (reemplaza `pdtp-competency-gap-obligation.test.ts`)

**Interfaces:**
- Produces: `occurrenceSubjectKey(occurrenceId: string): string` → `occurrence:<id>`
- Produces: `sweepOccurrenceObligations(...)` con la misma firma que la función
  de barrido que exporta hoy el conector de competencias.

- [ ] **Step 1:** Escribir el test: una ocurrencia cuyo slot ya pasó y sigue `pending` genera obligación; una `completed` la cierra; una `not_completed` la mantiene abierta.
- [ ] **Step 2:** Correr, verificar que falla.
- [ ] **Step 3:** Implementar el conector sobre `preventionTrainingOccurrences`, resolviendo actividades vía `preventionTrainingCatalogItems.pdtpActivityNumbers`. Conserva la propiedad de no escribir el número 57 en el código.
- [ ] **Step 4:** Tests en verde.
- [ ] **Step 5:** Commit.

### Task 4: Permisos de trabajo sin verificación de competencia

**Files:**
- Modify: `lib/services/prevention-permits.ts` (`resolveCrewEligibility`, ~412-458)
- Modify: la UI que muestra el motivo bloqueante
- Test: `lib/__tests__/prevention-permits-postgres.test.ts`

- [ ] **Step 1:** Borrar del test los casos de competencia faltante; dejar el resto.
- [ ] **Step 2:** Quitar de `resolveCrewEligibility` la rama que lee `preventionCompetencyRequirements` y `preventionWorkerCompetencies`, y el motivo bloqueante asociado. Conservar los demás criterios y la forma de retorno.
- [ ] **Step 3:** Ajustar la UI que renderiza ese motivo.
- [ ] **Step 4:** `npm run test:pglite -- prevention-permits` en verde.
- [ ] **Step 5:** Commit.

### Task 5: CPHS sin criterio de curso

**Files:**
- Modify: `lib/services/prevention-cphs-certification.ts` (~308-321)
- Test: los tests de certificación CPHS existentes

- [ ] **Step 1:** Ajustar el test al criterio retirado.
- [ ] **Step 2:** Quitar la consulta de competencias y el criterio de madurez que alimentaba.
- [ ] **Step 3:** Tests en verde.
- [ ] **Step 4:** Commit.

### Task 6: CAPA, dashboard y recordatorios

**Files:**
- Modify: `lib/prevention/capa.ts:66`
- Modify: `app/(app)/dashboard/sections/governance-section.tsx:55`
- Modify: el invocador de `prevention-training-reminders.ts`

- [ ] **Step 1:** CAPA de origen `training` → `/prevencion/capacitacion`.
- [ ] **Step 2:** Retirar la tarjeta "brechas bloqueantes" del dashboard.
- [ ] **Step 3:** Desenganchar los recordatorios de capacitación de su invocador (el archivo se borra en Task 10).
- [ ] **Step 4:** `npm run typecheck` y commit.

### Task 7: Fuentes de evidencia de riesgo

**Files:**
- Modify: `lib/services/prevention-risk-legal.ts` (~1431, ~1473, ~1549)

- [ ] **Step 1:** Cambiar `trainingSources` de sesiones a ocurrencias, con label `${code} · ${title}` del ítem de catálogo y `worksiteId` de la ocurrencia.
- [ ] **Step 2:** `npm run typecheck`, tests de risk-legal en verde.
- [ ] **Step 3:** Commit.

### Task 8: Vínculo documental

**Files:**
- Modify: `lib/services/prevention-documents/links.ts` (~101, ~195)

- [ ] **Step 1:** Retirar el kind de vínculo documento → sesión de capacitación y su resolución de faena.
- [ ] **Step 2:** `npm run typecheck`, tests de documentos en verde.
- [ ] **Step 3:** Commit.

---

## FASE 2 — Borrado de superficie

### Task 9: Pantallas, navegación y acuse público

**Files:**
- Delete: `app/(app)/prevencion/capacitacion/{catalogo,competencias,brechas,[sessionId]}/`
- Delete: `app/(app)/prevencion/capacitacion/training-session-list.tsx`
- Modify: `modules/prevention/manifest.ts` (hijo "Catálogo de cursos")
- Modify: `components/layout/top-bar.tsx:33` (`ROUTES_WITH_OWN_SEARCH`)
- Modify: `app/(public)/acuse/[kind]/[targetId]/[token]/page.tsx` y `ack-form.tsx`
- Modify: `app/(public)/acuse/actions.ts`
- Modify: `scripts/capture-all-routes.ts:771-773`
- Modify: `e2e/pdtp-habilitacion.spec.ts`, `e2e/prevencion-odi-capacitacion.spec.ts`

- [ ] **Step 1:** Borrar las cuatro carpetas y el componente huérfano.
- [ ] **Step 2:** Quitar la entrada de nav y la de `ROUTES_WITH_OWN_SEARCH`.
- [ ] **Step 3:** En `/acuse`, dejar sólo `kind === "permiso"`: la ruta rechaza `capacitacion` con `notFound()`.
- [ ] **Step 4:** Quitar las tres rutas de `capture-all-routes.ts` y ajustar los dos E2E.
- [ ] **Step 5:** `npm run typecheck` y commit.

### Task 10: Servicios, validación y scripts

**Files:**
- Delete: `lib/services/prevention-training.ts`, `prevention-training-gaps.ts`, `prevention-training-reminders.ts`, `prevention-ack-public.ts` (parte de capacitación)
- Delete: `lib/prevention/training.ts`, `lib/validation/prevention-module/training.ts`
- Delete: `scripts/seed-pdtp-2026-course-versions.ts`, `reclassify-pdtp-2026-specific-courses.ts`, `seed-prevention-cphs-orientation-course.ts`, `seed-demo-gaps.ts`
- Modify: `lib/services/prevention-training-export.ts`, `app/(app)/prevencion/capacitacion/actions.ts`, `db/seed.ts`, `scripts/apply-pdtp-2026-program-data.ts`, `scripts/preflight-pdtp-accreditation-wiring.ts`, `scripts/backfill-pdtp-catalog-activities.ts`
- Modify: `package.json` (script `db:seed-cphs-orientation-course`)
- Delete: `lib/__tests__/prevention-training-postgres.test.ts`, `prevention-training-calc.test.ts`, `prevention-acuse-sin-cuenta.test.ts`

- [ ] **Step 1:** Borrar servicios, validación y sus tests.
- [ ] **Step 2:** Podar la mitad legacy de `-export.ts` y de `actions.ts`, conservando el export de ocurrencias.
- [ ] **Step 3:** Borrar los cuatro scripts y quitar `db:seed-cphs-orientation-course` de `package.json`.
- [ ] **Step 4:** Podar `db/seed.ts` y los tres scripts PDTP.
- [ ] **Step 5:** `npm run typecheck` y commit.

---

## FASE 3 — Esquema

### Task 11: Migración y permisos

**Files:**
- Create: `db/migrations/0XXX_drop_training_person_model.sql`
- Delete: `db/schema/prevention/training.ts`
- Modify: `db/schema/prevention/index.ts`
- Modify: `db/schema/prevention/permits.ts` (columna `competencyTaskKey`)
- Modify: `modules/prevention/manifest.ts` (permisos y roles)
- Test: `lib/__tests__/prevention-rbac.test.ts`, `db/schema-consistency.test.ts`

- [ ] **Step 1:** Quitar los seis permisos retirados del manifiesto, de la lista de `permissions` y de los roles que los llevan.
- [ ] **Step 2:** Ajustar `prevention-rbac.test.ts` a los tres permisos sobrevivientes.
- [ ] **Step 3:** Quitar `competencyTaskKey` de `preventionPermitTypes` y `training.ts` de `index.ts`; borrar `training.ts`.
- [ ] **Step 4:** Generar la migración con `npm run db:generate` y revisar que dropee las siete tablas en orden de FK más la columna.
- [ ] **Step 5:** `npm run db:verify-migrations`, `npm run typecheck`, commit.

### Task 12: Verificación final

- [ ] **Step 1:** `npm run typecheck`
- [ ] **Step 2:** `npm run test`
- [ ] **Step 3:** `npm run lint`
- [ ] **Step 4:** Verificar que no queden referencias a los siete símbolos de tabla eliminados fuera de `db/migrations/`.
- [ ] **Step 5:** Commit final.
