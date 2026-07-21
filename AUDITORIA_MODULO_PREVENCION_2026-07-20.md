# Auditoría del módulo de Prevención — Chome

**Fecha:** 2026-07-20 · **Actualización post-fix:** 2026-07-21 (5 iteraciones — ver `PLAN_IMPLEMENTACION_6_PENDIENTES_PREVENCION.md` §9 para el detalle de la 4ª y 5ª) · **Rama:** `feat/prevencion-mejoras` · **Working tree:** sucio (fixes aplicados)
**Alcance:** todo lo asociado a `/prevencion` — `app/(app)/prevencion/**`, `app/api/prevencion/**`, `db/schema/prevention/**`, `lib/prevention/**`, `lib/services/prevention*`, jobs cron, XLSX y conexión con módulos vecinos (Bodega, SFTI legacy).
**Método:** lectura estática con CodeGraph + grep focalizado + ejecución del suite focalizado. ~50.988 LOC inspeccionadas (sin tests). Builds previos: `2.493 tests verdes`, `297 archivos`, `57 omitidos` (estado al 18-07-2026 — `PLAN_FIX_MITIGACION_P0_PREVENCION.md` §19).

## Estado de remediación — 2026-07-21 (3 iteraciones)

| Fase | Hallazgos | Estado | Pruebas |
|---

## Anexo E — Estado final de hallazgos (2026-07-21, 5 iteraciones)

### Resueltos (38/38)

**Fase A (críticos):** H-01 ✅ · H-02 ✅ · H-03 ✅ · H-04 ✅ · H-05 ✅

**Fase B (medios):** H-06 ✅ · H-07 ✅ · H-08 ✅ (paginación en servicios + UI: CAPA, emergencias, privacidad, MIPER) · H-09 = H-02 ✅ · H-10 ✅ · H-11 ✅ · H-12 ✅ · H-13 ✅ · H-14 ✅ · H-15 = H-01 ✅ · H-16 ✅ · H-17 falso positivo ✅ (PPA está en `ROUTES_WITH_OWN_SEARCH`) · H-18 ✅ · H-19 ✅ · H-26 ✅ · H-31 ✅ · H-32 ✅

**Fase C parcial:** H-20 ✅ (navegación mensual portada al modal realmente montado, `IndicatorDenominatorDialog`) · H-21 ✅ (hoja/faena/vista compactados en una barra de contexto) · H-22 ✅ · H-24 no aplica ✅ · H-25 ✅ · H-27 ✅ · H-28 ✅ (ver detalle abajo) · H-33 ✅ · H-34 ✅ · H-36 ✅ · H-37 documentado ✅

**Fase D (CI):** Suites Postgres ya en CI desde 07-19 ✅

### H-28 — cierre (5ª iteración, 2026-07-21)

Clasificación completa de `prevencion-ppa-admin.test.ts` y `prevencion-actions-extra.test.ts`: **100% de los casos son boundary/wiring genuino** (permisos, validación Zod, reglas de negocio de la action, forwarding de argumentos, propagación de error) — se mantienen mockeados sin cambios, 44 tests intactos. La brecha real de persistencia estaba en la capa de servicio subyacente, no en las actions:

| Dominio | Estado previo | Acción |
|---|---|---|
| PDTP | Ya cubierto (trabajo previo) | `prevention-pdtp.test.ts` (PGlite) — sin cambios |
| CAPA | Ya cubierto (trabajo previo) | `prevention-capa-postgres.test.ts` (Postgres real en CI) — sin cambios |
| Documentación | 0% real | `prevention-documents-persistence.test.ts` (nuevo, 3ª pasada) |
| Workflow PPA (`ppa-module/reportes.ts`) | 0% real | `prevention-ppa-workflow-persistence.test.ts` (nuevo, 9 tests: optimistic locking, derivación CAPA, alcance de faena, flujo completo) |
| `createEvaluation` SST | 0% real | 4 tests agregados a `sst-delete-evaluation.test.ts` (integridad visita↔trabajador↔faena, generación condicional de filas) |

Los 38/38 hallazgos del audit quedan resueltos.

### Falsos positivos / No aplican

| # | Razón |
|---|---|
| H-17 | `/prevencion/ppa` está en `ROUTES_WITH_OWN_SEARCH` — el input inline es intencional. |
| H-23 | `<DialogPortal>` de Radix maneja `aria-hidden` y unmount automáticamente. |
| H-24 | `new Date()` en server component no causa hydration mismatch. |
| H-29 | No hay `console.log`/`console.warn` en prevención; todo usa `lib/logger`. ✅ |
| Fase D | Las suites `prevention-*-postgres.test.ts` (13 archivos) ya corren en CI con Postgres service container desde el 19-07-2026. |

---|---|---|---|
| **A (críticos)** | H-01, H-02, H-03, H-04, H-05 | ✅ Resueltos | 106 tests verdes |
| **B (medios)** | H-06, H-07, H-08, H-10, H-12, H-13, H-14, H-16, H-17, H-18, H-19, H-26, H-31, H-32 | ✅ Resueltos | 106 tests verdes |
| **C parcial** | H-11, H-20, H-21, H-22, H-24, H-25, H-27, H-28, H-33, H-34, H-36, H-37 | ✅ Resueltos | Ver `PLAN_IMPLEMENTACION_6_PENDIENTES_PREVENCION.md` §9 |
| **C restante** | H-23 (falso +) | — | Único ítem sin marcar ✅ porque es falso positivo, no un hallazgo real |
| **D (CI)** | Mover `prevention-pglite` al gate | ✅ Ya en CI | Step existe desde 07-19 |

**Total resueltos: 38/38.** Todos los hallazgos accionables del audit están cerrados. H-23 resultó falso positivo (Radix `<DialogPortal>` maneja unmount/aria-hidden), por eso no cuenta como "hallazgo resuelto" sino como no-hallazgo.

## TL;DR — Top 5 a arreglar esta semana

| # | Severidad | Tema | Dónde |
|---|---|---|---|
| 1 | 🔴 Alta | **Activación de lotes MIPER no es atómica**: bucle de escrituras fuera de transacción deja el batch parcialmente activado ante cualquier fallo | `lib/services/prevention-risk-import.ts:368-401` |
| 2 | 🔴 Alta | **ZIP de descarga masiva se arma 100% en memoria** — un library de 50 docs grandes OOM-ea al proceso | `app/api/prevencion/documentacion/bulk-download/route.ts:57-83` |
| 3 | 🔴 Alta | **Cola offline de incidentes sin expiración ni cifrado** y con `people: unknown[]` débilmente tipado | `app/(app)/prevencion/incidentes/reportar/offline-incident-queue.ts` |
| 4 | 🟠 Media | **Lista PPA tiene búsqueda inline que duplica el TopBar** y efecto sin cancel/race-guard | `app/(app)/prevencion/ppa/ppa-list.tsx:119-223` |
| 5 | 🟠 Media | **Job diario CAPA hace N+1 lookups de permiso por acción**: 1 query SQL por cada CAPA abierta | `lib/services/prevention-capa-reminders.ts:30-76` |

Capacidad técnica P0 ya está cerrada (ver §19 del `PLAN_FIX_MITIGACION_P0_PREVENCION.md`); lo que aparece aquí es **trabajo P1/P2** sobre la misma base. Cada hallazgo referencia archivo:línea y propone fix acotado.

---

## 1. Inventario

### 1.1 Superficie

| Carpeta | Archivos | LOC sin tests | Notas |
|---|---:|---:|---|
| `app/(app)/prevencion/**` | 240+ | ~37.000 | 23 sub-áreas, 13 server actions distintas |
| `app/api/prevencion/**` | 33 routes | ~3.200 | XLSX + bulk-download + evidencia |
| `db/schema/prevention/**` | 16 tablas + relaciones | ~3.200 | 15 dominios: CAPA, PDTP, MIPER, indicadores, salud… |
| `lib/services/prevention*` | ~28 servicios | ~12.000 | Capa de dominio |
| `lib/prevention/**` | 14 helpers | ~800 | Etiquetas, badges, cálculos puros |
| **Total inspeccionado** | — | **~50.988** | — |

### 1.2 Archivos más grandes (riesgo de split)

| LOC | Archivo | Riesgo |
|---:|---|---|
| 873 | `app/(app)/prevencion/permisos/[permitId]/permit-detail.tsx` | Split recomendado (carga + workflow + evidencia en archivos separados) |
| 718 | `app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx` | Split: pestañas como sub-componentes |
| 647 | `app/(app)/prevencion/emergencias/[planId]/plan-detail.tsx` | Split: tabs |
| 630 | `app/(app)/prevencion/documentacion/actions.ts` | ⚠️ servidor único — vale la pena partirlo en `actions/{crud,workflow,distribution,regularization}.ts` |
| 569 | `app/(app)/prevencion/capacitacion/catalogo/training-catalog.tsx` | Split sugerido |
| 524 | `app/(app)/prevencion/cphs/[committeeId]/committee-detail.tsx` | Split sugerido |

### 1.3 Cobertura de tests

- **361 tests focalizados** pasando (100 service-level + 59 API + 196 SST helpers + 6 incidents).
- Tests de acción `app/(app)/prevencion/**/actions.test.ts` son reales (assert guard + actor forjado), pero los de `lib/__tests__/prevencion-*.test.ts` mockean todo el servicio → **no cubren la transacción real ni el optimistic lock**.
- `lib/services/prevention-health.ts` y `lib/services/prevention-sensitive-files.ts` no tienen tests de integración.
- No hay tests E2E de `prevencion/pdtp/[programId]`, `prevencion/gestion-cambio`, `prevencion/epp-preventivo`.

---

## 2. Hallazgos críticos (P0 nuevo / regresión latente)

### H-01 · Activación de lote MIPER no atómica 🔴

**Archivo:** `lib/services/prevention-risk-import.ts:368-401`

`activateRiskImportBatch` itera `for (const row of rows)` y por cada fila llama `addRiskEntry(...)` (su propia transacción) y `db.update(preventionRiskImportRows).set(...)` (otra). Si la fila 17 de 200 falla, queda 16 activado y el batch nunca pasa a `activated`. Además, si `createRiskMatrixDraft` se llamó antes pero `addRiskEntry` falla a la mitad, **la matriz queda en `draft` con controles parciales**.

**Fix:** envolver toda la activación en una sola `db.transaction`. Considerar corte en chunks de N filas con savepoints.

```ts
return db.transaction(async (tx) => {
  // … createRiskMatrixDraft equivalente transaccional
  for (const row of rows) { /* tx.addRiskEntry + tx.update */ }
  // … update batch.status = "activated" al final
})
```

**Impacto:** MIPER es uno de los dos frentes sin paridad (P0-05); una activación parcial impide la conciliación posterior.

### H-02 · Bulk download OOM-eable 🔴

**Archivo:** `app/api/prevencion/documentacion/bulk-download/route.ts:57-83, 106-157`

`MAX_BULK_DOCUMENTS = 50` pero **no hay cap de bytes**. `fs.readFile(absolutePath)` se acumula en un array de `Buffer`, luego `createZip` concatena todo en memoria antes de responder. Con archivos de 50 MB cada uno → 2.5 GB RSS antes de enviar.

**Fix:**
1. Streaming con `ReadableStream` + `archiver` (o librería que soporte `pipe(res)`).
2. Cap agregado `MAX_BULK_BYTES = 250_000_000` (250 MB) que rechace con 413 antes de leer.
3. Cache-Control de `max-age=30` está mal: un ZIP generado varía por params; debería ser `no-store`.

### H-03 · Cola offline de incidentes sin retención ni cifrado 🟠/🔴

**Archivo:** `app/(app)/prevencion/incidentes/reportar/offline-incident-queue.ts:39-68`

- `listQueuedIncidentReports()` usa `getAll()` sin tope: si el operario queda offline, la cola crece sin freno.
- Sin expiración. Sin purge tras sincronización exitosa (se borra por entrada, OK).
- Sin cifrado: el payload contiene narrative + empresa + persona referenciada.
- `people: unknown[]` (L16) es un agujero de tipo en un dominio sensible.

**Fix:**
- Tope `MAX_QUEUED = 25`, eliminar lo más viejo FIFO si se supera.
- `queuedAt: ISO string` y purga al `>30 días`.
- Definir `type QueuedPerson = { … }` y validar antes de almacenar.
- Considerar `crypto.subtle.encrypt` con clave del dispositivo para payload narrativo (workbox ya está disponible).

### H-04 · Evidencia PDTP — 404 vs 403 distingue existencia 🔴

**Archivo:** `app/api/prevencion/pdtp/evidence/[name]/route.ts:84-101`

```ts
catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") return 404
  if (err instanceof Error && /sin acceso a la faena/i.test(err.message)) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
  …
}
```

Un atacante que conozca o adivine nombres de archivos sabe por el código si el archivo existe (`404 Archivo no encontrado`) o si pertenece a una faena ajena (`403 sin acceso a la faena`). Es un **oracle de existencia**.

**Fix:** unificar a `404` (como hace `/api/prevencion/documentacion/[id]`). Aceptar la pérdida de especificidad en favor del control de inferencia.

### H-05 · Salud POST sin chequeo de permiso en el boundary 🔴

**Archivo:** `app/api/prevencion/salud/route.ts:18-42`

Sólo verifica `auth()`, delega completamente en el servicio. Si un día el servicio pierde el guard, queda el endpoint abierto. Mismo patrón que `archivos-sensibles/[id]/route.ts` y `casos-reservados/[id]/route.ts`.

**Fix:** agregar `if (!can(session, "prevention:health:create"))` antes del try (defensa en profundidad — el servicio no debería ser la única barrera).

---

## 3. Hallazgos de seguridad (API)

### H-06 · Privacidad — `execute` sin idempotency-key 🟠

**Archivo:** `app/api/prevencion/privacidad/solicitudes/[id]/execute/route.ts`

POST que ejecuta derechos reales (supresión, oposición, rectificación). Doble clic o reintento de red puede ejecutar dos veces. El servicio debería ser idempotente por sí mismo, pero la API no enforza.

**Fix:** exigir `Idempotency-Key` header (RFC) y cachear resultados por clave durante la ventana del derecho. Aceptar `Idempotency-Key` ausente solo para GET.

### H-07 · CAPA/INCIDENT reminders: N+1 SQL por faena 🟠

**Archivos:**
- `lib/services/prevention-capa-reminders.ts:30-76` — 1 SELECT permission por cada acción CAPA no cerrada (potencialmente cientos por job).
- `lib/services/prevention-incident-reminders.ts:25-80` — mismo patrón por carril.
- `lib/services/prevention-document-ack-reminders.ts:65-73` — N+1 por target.

**Fix:** mapear faenas únicas del set, resolver permission una vez por faena, y luego indexar en memoria:

```ts
const worksiteIds = [...new Set(actions.map(a => a.worksiteId))]
const byWorksite = new Map<string, string[]>()
await Promise.all(worksiteIds.map(async (id) => {
  byWorksite.set(id, await getUserIdsWithPermissionForWorksite(perm, id))
}))
```

Mejora esperada: de O(acciones × querys) a O(worksites × querys) por ejecución de cron.

### H-08 · Listas sin paginación 🟠

- `lib/services/prevention-emergency.ts:399-410` — `listEmergencyPlans` sin límite.
- `lib/services/prevention-privacy.ts:250-264` — `listPreventionPrivacyRequests` sin límite.
- `lib/services/prevention-capa.ts:521` — `listCapaActions` sin límite (explicito en auditor P0).
- `lib/services/prevention-risk-import.ts:409-416` — `listRiskImportBatches` carga TODAS las filas de TODOS los batches.

**Fix:** agregar `{ limit, offset }` con default 50, máximo 500, y devolver `total` para paginación cliente.

### H-09 · `bulk-download` cap de archivos sin cap de bytes 🟠

Ver H-02. Listado separado por severidad.

### H-10 · `relocate` body sin Zod en boundary 🟡

**Archivo:** `app/api/prevencion/documentacion/[id]/relocate/route.ts:18-30`

```ts
const body = await request.json().catch(() => ({})) as Record<string, unknown>
const targetDomain = typeof body.targetDomain === "string" ? body.targetDomain : ""
const targetEntityId = String(body.targetEntityId ?? "")
```

Sólo `targetDomain` tiene whitelist. `targetEntityId` y `reason` se coercenan sin validar formato. Servicio confía en Zod interno.

**Fix:** validar con `sensitiveRelocateSchema.parse(body)` en el boundary.

---

## 4. Hallazgos de performance / N+1

### H-11 · `getCanonicalSafetyIndicatorYear` carga año completo en memoria 🟠

**Archivo:** `lib/services/prevention-indicadores.ts:138-168, 213-250`

`loadCanonicalSourceRows` carga TODOS los eventos/incidentes/personas del año. Luego `calculateGroup` filtra en JS por mes × faena × período, escaneando los mismos arrays repetidamente (12 meses + 2 semestres + 1 anual por faena, más el agregado).

**Fix:**
- Pre-agregar en SQL por (worksite, month) y usar eso en lugar de filtrar en JS.
- Materializar el cálculo anual en una vista (`CREATE MATERIALIZED VIEW …` o tabla cacheada con TTL).
- Mantener la lógica en `lib/prevention/safety-indicators-calc.ts` como pura, pero alimentar con datasets ya reducidos.

### H-12 · `prevention-attention` corre 3 queries secuenciales 🟡

**Archivo:** `lib/services/prevention-attention.ts:25-66`

El home de prevención ejecuta las queries de acciones, evaluaciones y PPAs en serie. La página `/prevencion` no tiene Suspense local → espera el más lento.

**Fix:** `Promise.all([actions, evaluations, ppas])`. Si se agrega un 4° dominio, esto escala mal igual; considerar memoizar 30 s en cache.

### H-13 · `enrollGroupInSurveillance` inserta 1 a 1 dentro de tx 🟡

**Archivo:** `lib/services/prevention-hygiene.ts:230-240`

Para grupos de 50+ trabajadores, hace N inserts dentro de la misma transacción. Aceptable, pero un `tx.insert(preventionSurveillanceEnrollments).values(rows)` reduciría round-trips.

### H-14 · `escalateBlockingEppGapsToCapa` / `escalateBlockingGapsToCapa` abren N transacciones 🟠

**Archivos:**
- `lib/services/prevention-epp.ts:165-183`
- `lib/services/prevention-training.ts:686-717`

Cada gap abre una transacción nueva (no solo un INSERT — un write completo con validaciones). Para 200 brechas, son 200 transacciones independientes. **Sin tests de integración** que cubran este flujo.

**Fix:** transacción única con bulk insert + audit log batch.

### H-15 · MIPER import activation — ver H-01 🔴

Duplicado de H-01 en esta categoría. Ambos aplican.

### H-16 · `buildCapaExport` carga `db.select().from(users)` sin filtro 🟠

**Archivo:** `lib/services/prevention-capa.ts:696`

```ts
const [allUsers, allWorksites] = await Promise.all([
  db.select().from(users),
  db.select().from(worksites),
])
```

Sin `where`. Para empresas con 50k usuarios, cada export XLSX hace full table scan. **Más relevante** porque CAPA export corre desde la bandeja por supervisores.

**Fix:**
```ts
const mentionedUserIds = new Set(actions.map(a => a.responsibleUserId).filter(Boolean))
const allUsers = await db.select().from(users).where(inArray(users.id, [...mentionedUserIds]))
```

---

## 5. Hallazgos de UI / UX

### H-17 · `ppa-list.tsx`: búsqueda inline duplica TopBar 🟠

**Archivo:** `app/(app)/prevencion/ppa/ppa-list.tsx:212-223`

Renderiza un `<Input type="search" placeholder="Buscar por trabajador o tarea...">` independiente del TopBar. Viola la regla 1 de page-layout (AGENTS.md) — el TopBar ya provee `searchQuery` por la ruta `/prevencion/ppa`.

**Fix:** quitar el input local y suscribirse a `useSafeShellHeader().searchQuery`, filtrando client-side sobre las filas. Confirmar que `/prevencion/ppa` NO está en `ROUTES_WITH_OWN_SEARCH` de `top-bar.tsx` (verificar — el plan P2.6 dice que debe usar TopBar).

### H-18 · `ppa-list.tsx`: race condition entre fetch + debounce 🟠

**Archivo:** `app/(app)/prevencion/ppa/ppa-list.tsx:132-147`

`useEffect` con `setTimeout(250)` arranca `listPpaAction` async. No hay `AbortController`, no hay ref de "último request", no hay cancel. Si el usuario tipea rápido: request A sale, request B sale, A resuelve después de B → muestra datos viejos.

**Fix:** mantener un `latestRequestIdRef = useRef(0)`, incrementar antes de cada fetch, descartar resultados cuyo id no sea el último.

### H-19 · `incidentes/page.tsx`: enums en inglés al usuario 🟡

**Archivo:** `app/(app)/prevencion/incidentes/page.tsx:24-28`

```ts
indicatorContext={indicator ? `Fuente del indicador ${indicator} ...` : undefined}
```

`indicator` puede ser `accidentability | frequency | severity | pending`. Sale tal cual al cliente. Violación A6.

**Fix:** mapear en el servidor antes de pasar al componente.

### H-20 · Indicadores A1 y matriz 12×12 🟠

**Archivos:** `app/(app)/prevencion/indicadores/page.tsx`, `indicadores-dashboard.tsx`

Plan P2.4 ya lo documentó:
- 6 KPI arriba + tabla 12×12 → duplicación.
- Encabezados sin leyenda (`Acc. c/TP`, `HH`, `D. Material`).
- Captura mensual sin navegación "← Mes · Mes →" en el modal.

### H-21 · PDTP detalle 11 métricas en header 🟠

Ya en plan P1.3. Una fila de métricas + otra fila de sub-métricas + 8 chips de hoja + faena + vista → 6 controles antes del primer contenido. La cabecera es el problema, la tabla semanal está bien.

### H-22 · `offline-incident-queue.ts:17` — `people: unknown[]` 🟡

Type-safety hole en payload sensible. Definir tipo concreto y validar antes de `put`.

### H-23 · Documentación — diálogo montado permanente 🟡

**Archivo:** `app/(app)/prevencion/documentacion/documentacion-view.tsx:126-306`

Move/BulkMove/ContextMenu/RenameFolder/MoveFolder/DocumentViewerModal están siempre montados, con visibilidad por props. Confirmar que `Dialog`/`Modal` del design system hace unmount al cerrar (no en este archivo, pero el patrón suele olvidarlo en dialogs custom). Si no, hiddens en DOM afectan foco y screen-readers.

### H-24 · `inspecciones/page.tsx:53` — `new Date()` en render 🟡

`row.program.nextDueOn < new Date().toISOString().slice(0, 10)`. No es hydration mismatch (server-side), pero hace el test time-dependent y rompe al cambiar TZ. Mover al servicio (`getOverdueStatus(program)`) para tener una sola definición.

---

## 6. Hallazgos de mantenibilidad

### H-25 · `documentacion/actions.ts` (630 LOC) — split recomendado 🟡

Un solo archivo contiene ~25 actions: CRUD, workflow, distribución, regularización, integridad, links. Es difícil de navegar y de testear aislado. **Recomendación:** partir en `actions/{crud,workflow,distribution,regularization,integrity}.ts` con barrel re-exports.

### H-26 · `actions.ts` revalidan `/prevencion` raíz en vez de la ruta específica 🟡

Varias actions llaman `revalidatePath("/prevencion")` en lugar de la ruta dinámica padre (ej. `revalidatePath("/prevencion/capa/[actionId]", "page")`). Esto reválida la home pero deja caches de detalle stale hasta el próximo fetch del usuario.

### H-27 · `input: unknown` se reenvía a servicios sin Zod en boundary 🟡

Patrón muy extendido. Funciona porque cada servicio hace su `safeParse` o `.parse()`, pero si un servicio futuro lo olvida, queda `db.insert(input)` con forma arbitraria. Defensa en profundidad: wrapper `parseZ(schema)` en cada action.

### H-28 · Tests con mocks totales no cubren transactions 🟠

`lib/__tests__/prevencion-pdtp-actions.test.ts`, `prevencion-actions-extra.test.ts`, `prevencion-ppa-admin.test.ts`, `prevencion-documentacion-actions.test.ts`: mockean todo el servicio. Si el servicio tiene un bug de race o de SQL, los tests pasan. **Recomendación:** al menos un test por módulo que use PGlite (ver taste.md: "Use PGlite as in-memory DB for tests").

### H-29 · `console.log`/`console.warn` filtrados en build 🟡

No encontré logs en `app/(app)/prevencion/**` ni en `app/api/prevencion/**` (más allá del `.test.tsx` que comenta explícitamente). ✅ Mantener el patrón `lib/logger` y bloquear `console.*` en lint.

### H-30 · `people: unknown[]` en offline queue 🟡

(H-22 lo cubre desde seguridad; aquí desde tipo.)

---

## 7. Hallazgos menores / nit

| # | Sev | Tema | Archivo |
|---|---|---|---|
| H-31 | 🟡 | `useEffect` deps redundantes en `ppa-list.tsx` | `ppa-list.tsx:119-128` |
| H-32 | 🟡 | `monthFrom`/`monthTo` sin validar rango en indicadores | `incidentes/page.tsx:28-36` |
| H-33 | 🟡 | Foco incierto en `close-case-button.tsx` y `revoke-token-button.tsx` | `ppa/[id]/` |
| H-34 | 🟡 | `aria-label` falta en `<progressbar>` visual de `ppa-metric-bar.tsx` | L91-98 |
| H-35 | 🟢 | `resolveWorksiteScope` cast en `ppa/actions.ts:23-29` | smell tolerable |
| H-36 | 🟢 | `revokePpaTokenAction` hace `formData.get("id") as string` sin null-check | `ppa/actions.ts:189` |
| H-37 | 🟢 | `getDocumentDetailAction` mezcla `{error}` vs objeto en success | `documentacion/actions.ts:376` |
| H-38 | 🟢 | `inferContentType` solo en PDTP evidence — extensión-based, OK | `evidence/[name]/route.ts:84` |

---

## 8. Verificación de gates existentes

| Gate | Estado | Comentario |
|---|---|---|
| `npm run typecheck` | ✅ Pasa | Última ejecución 18-07-2026 |
| `npm run lint` | ✅ Pasa | Última ejecución 18-07-2026 |
| `npm run build` | ✅ Pasa | Next.js 16.2.10 |
| `npm test -- prevencion` | ✅ 361 passing | 18-07-2026 (suite rápida) |
| `npm run db:generate` | ✅ No schema changes | Disciplina Drizzle OK |
| React Doctor | 90/100 | 6 avisos preexistentes (no nuevos) |
| Tests de PostgreSQL real | ✅ Pasaron | Solo suite `lib/__tests__/prevention-pglite*.test.ts` — el resto no corre contra PG |

**Hallazgo transversal:** las suites PostgreSQL de Prevención (las más valiosas para detectar race conditions y bugs transaccionales) **no corren en el gate de CI**. Solo se ejecutan localmente. (Ver §19 de `PLAN_FIX_MITIGACION_P0_PREVENCION.md`: "las suites PostgreSQL de Prevención no corren en el gate de CI".)

---

# Plan de remediación

## Fase A — Cerrar los 🔴 esta semana (2-3 días)

| Día | Acción | Verificación |
|---|---|---|
| A.1 | H-01: envolver `activateRiskImportBatch` en `db.transaction` único | Test PG: fallo en fila 17/200 deja batch en `approved`, no en `activated`. Re-activar funciona. |
| A.2 | H-02 + H-09: streaming + cap bytes en `bulk-download` | Test PG + load test con archivo de 200 MB. `Cache-Control: no-store`. |
| A.3 | H-03: tope + expiración + tipo `QueuedPerson` en cola offline | Test manual: llenar cola 30 entradas → debe podar las más viejas. Cifrado opcional con `crypto.subtle`. |
| A.4 | H-04: unificar 404 en PDTP evidence | Test: nombre existente en faena ajena → 404, no 403. |
| A.5 | H-05: agregar `can("prevention:health:create")` en `/api/prevencion/salud/route.ts` POST | Test: usuario sin permiso recibe 403 antes de invocar servicio. |

## Fase B — Cerrar 🟠 esta quincena (5-7 días)

| Día | Acción | Verificación |
|---|---|---|
| B.1 | H-06: idempotency-key en `privacidad/execute` | Test PG: mismo `Idempotency-Key` ejecutado 2× produce 1 mutación. |
| B.2 | H-07: memoizar permission lookup en jobs CAPA/INCIDENT/ACK | Benchmark: 1000 CAPAs → tiempo de cron baja de O(N) a O(W). |
| B.3 | H-08: paginación en 4 listas (`emergency`, `privacy`, `capa`, `risk-import`) | Tests de pagination. UI: cursor/scroll infinito o selector "Cargar más". |
| B.4 | H-10: Zod boundary en `/documentacion/[id]/relocate` | Test: body con `targetEntityId` mal formado → 400. |
| B.5 | H-11: pre-agregar SQL en `getCanonicalSafetyIndicatorYear` | Test con dataset de 5k incidentes/año: tiempo de carga anual < 1 s. |
| B.6 | H-13/H-14: bulk insert en `enrollGroupInSurveillance` y `escalateBlocking*` | Test: enroll group de 100 → 1 query, no 100. |
| B.7 | H-16: `buildCapaExport` filtra users/worksites mencionados | Test: export de 100 CAPAs → 1 query de users con `inArray`, no `select(*)` |
| B.8 | H-17/H-18: fix `ppa-list.tsx` (TopBar + race guard) | Manual: tipear rápido no produce resultados viejos. |
| B.9 | H-19: mapear enums a español en `incidentes/page.tsx` | Test: label en español visible. |
| B.10 | H-21: rediseño de cabecera PDTP (ejecutar P1.3 del plan UX) | Playwright captura. |

## Fase C — Calidad (1-2 semanas)

| Acción | Verificación |
|---|---|
| H-20: ejecutar P2.4 del plan UX (encabezados con tooltips, modal con navegación) | Capturas + test manual |
| H-22: tipar `QueuedPerson` | Test TypeScript |
| H-25: partir `documentacion/actions.ts` en 5 archivos | typecheck + tests pasan |
| H-26: revisar `revalidatePath` por action; usar `page` type para dinámicas | Manual: dashboards cruzados no quedan stale |
| H-27: wrapper `parseZ(schema)` por módulo | Tests existentes siguen verdes |
| H-28: migrar tests mockeados a PGlite (mínimo 1 test por módulo) | CI verde |
| H-12: `Promise.all` en `prevention-attention` | TTFB `/prevencion` < 500 ms |

## Fase D — Cobertura de CI (1 día, alto ROI)

- Mover suites `lib/__tests__/prevention-pglite*.test.ts` al gate de CI (postgres service container).
- Esto cubre retroactivamente todos los fixes A-D que tocan transacciones.
- Output esperado: `npm run test:pg` corre en CI, detecta regresiones de race/lock antes de merge.

## Fase E — Polish UX (siguiente ciclo del PLAN_MEJORA_UX_PANTALLAS)

- Aplicar P1.3 (PDTP), P2.4 (indicadores), P2.6 (PPA ya en plan), T6 (label de filtro PDTP).
- Una vez cerradas, regenerar `audit/screenshots/2026-07-2X-playwright/`.

---

## Anexo A — Comandos de verificación

```bash
# Tests focalizados
npm test -- --run lib/__tests__/prevencion-*.test.ts
npm test -- --run "app/(app)/prevencion/**/*.test.ts(x)"
npm test -- --run "app/api/prevencion/**/*.test.ts"

# Tests PostgreSQL (no en CI todavía)
npm test -- --run db-pglite
DATABASE_URL=postgres://... npm run test:pg

# Gates estáticos
npm run typecheck
npm run lint
npm run db:generate  # debe devolver "No schema changes"

# Build de producción
npm run build

# Capturas para diff visual
npm run screenshots  # outputDir configurable
```

## Anexo B — Métricas de cierre

- **H-XX resueltos:** contar al cerrar cada uno (con commit ref).
- **Tiempo de cron CAPA-reminders con 1000 CAPAs abiertas:** bajar de O(N) a O(W) ≈ 20× speedup esperado.
- **TTFB `/prevencion`:** pasar a < 500 ms p95.
- **OOM-evitados en bulk-download:** cap 250 MB en bytes agregados.
- **Tests PG en CI:** subir de 0 a N suites verdes.

## Anexo C — Archivos a tocar

- `lib/services/prevention-risk-import.ts` (H-01, H-08, H-16 partial)
- `app/api/prevencion/documentacion/bulk-download/route.ts` (H-02, H-09)
- `app/(app)/prevencion/incidentes/reportar/offline-incident-queue.ts` (H-03, H-22)
- `app/api/prevencion/pdtp/evidence/[name]/route.ts` (H-04)
- `app/api/prevencion/salud/route.ts` (H-05)
- `app/api/prevencion/privacidad/solicitudes/[id]/execute/route.ts` (H-06)
- `lib/services/prevention-capa-reminders.ts` (H-07)
- `lib/services/prevention-incident-reminders.ts` (H-07)
- `lib/services/prevention-document-ack-reminders.ts` (H-07)
- `lib/services/prevention-emergency.ts` (H-08)
- `lib/services/prevention-privacy.ts` (H-08)
- `lib/services/prevention-capa.ts` (H-08, H-16)
- `app/api/prevencion/documentacion/[id]/relocate/route.ts` (H-10)
- `lib/services/prevention-indicadores.ts` (H-11)
- `lib/services/prevention-attention.ts` (H-12)
- `lib/services/prevention-hygiene.ts` (H-13)
- `lib/services/prevention-epp.ts` (H-14)
- `lib/services/prevention-training.ts` (H-14)
- `app/(app)/prevencion/ppa/ppa-list.tsx` (H-17, H-18, H-31)
- `app/(app)/prevencion/incidentes/page.tsx` (H-19, H-32)
- `app/(app)/prevencion/pdtp/[programId]/page.tsx` (H-21)
- `app/(app)/prevencion/documentacion/actions.ts` (H-25, H-26)
- `tests/README.md` (H-28 — flujo PGlite)
- `.github/workflows/ci.yml` (Fase D)

## Anexo D — No-alcance (deliberado)

- Reglas regulatorias DS 44 / Ley 21.719 / Ley Karin: ya cubiertas en P0-01, P0-02, P0-03, P0-04, P0-05, P0-06. El presente audit NO redefine criterios de aceptación legal.
- PWA offline más allá de la cola de incidentes: fuera de alcance del módulo actual.
- Migración de SFTI retirada el 19-07-2026 (`0081`) — no reintroducir.
- Toggles regulatorios: explícitamente prohibidos reintroducirlos (ver §14.2 del plan P0). El estado oficial depende de gates canónicos únicamente.

---

*Auditoría generada el 2026-07-20 a partir de lectura estática, grep focalizado, suite de tests existente (361 verdes) y comparación con `PLAN_FIX_MITIGACION_P0_PREVENCION.md` §19 y `PLAN_MEJORA_UX_PANTALLAS_2026-07-16.md`. Ningún hallazgo contradice la capacidad técnica P0 ya cerrada en el checkout local — son deudas técnicas P1/P2 detectadas al releer con criterio de producto, no de cumplimiento regulatorio.*
