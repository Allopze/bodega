# Auditoría de código — Módulo Prevención

**Fecha**: 2026-07-27
**Alcance**: `app/(app)/prevencion/**` (≈300 archivos), `lib/services/pdtp/**`, `lib/services/prevention-*.ts`, `lib/prevention/**`, `modules/prevention/manifest.ts`
**Enfoque**: corrección, integridad de datos, alcance/permisos, coherencia con las reglas del proyecto. Complementa `auditoria-pdtp-2026-07-27.md`, que cubrió densidad visual y navegación.
**Estado del árbol**: hay trabajo sin commitear (los fixes de la auditoría UX del mismo día). La mayoría de los hallazgos están **en ese código nuevo**, que nunca fue auditado.

> **Estado: plan implementado.** Ver [Registro de implementación](#registro-de-implementación)
> al final del documento para el detalle por hallazgo, las correcciones a esta
> auditoría y lo que queda pendiente.

## Verificaciones ejecutadas

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpio (exit 0) |
| `npm run lint` | **falla (exit 1)** — 1 error + 3 warnings, todos en `pdtp/page.tsx` |
| `npm run test:fast` | **4 fallos** (1 de Prevención por el WIP, 3 preexistentes de `main`) — corregido: la primera lectura de esta fila decía "verde" porque el `\| tail` de la tubería enmascaraba el exit code |
| `npx vitest --config vitest.pglite.config.ts lib/__tests__/prevention-pdtp.test.ts` | 58/58 |
| Cobertura de guards en 47 server actions del módulo | 100% |

---

## BLOQUEANTE

### B1 — `npm run lint` falla, y el pre-commit hook lo ejecuta

`.husky/pre-commit` corre `npm run lint`. **El WIP actual no se puede commitear.**

```
app/(app)/prevencion/pdtp/page.tsx
   9:3  warning  'getPdtpIntegralCompliance' is defined but never used
  12:3  warning  'listPdtpProgramSheets' is defined but never used
  83:7  error    'integral' is never reassigned. Use 'const' instead     ← prefer-const
  83:7  warning  'integral' is assigned a value but never used
```

No es solo cosmético: los cuatro apuntan al mismo hecho, que es el hallazgo M1 (el cumplimiento integral desapareció del tablero).

---

## CRÍTICOS — datos falsos en pantalla

### C1 — El dashboard PDTP muestra 0% de cumplimiento a casi todos los usuarios

Regresión de un bug que ya estaba resuelto y con test propio (UX-01).

Cadena completa:

1. [`page.tsx:75`](app/(app)/prevencion/pdtp/page.tsx#L75) — `resolveSelectedWorksiteId(requestedWorksite, scopedWorksites)`
2. [`pdtp-context.ts:29`](app/(app)/prevencion/pdtp/pdtp-context.ts#L29) — devuelve `undefined` si el usuario tiene **≥2 faenas** y no eligió ninguna (`worksites.length === 1 ? ... : undefined`). Es el caso normal de un prevencionista o de un usuario con scope `all`.
3. [`page.tsx:96`](app/(app)/prevencion/pdtp/page.tsx#L96) — `getPdtpComplianceIndicators(activeProgram.id, undefined)`
4. [`helpers.ts:168-170`](lib/services/pdtp/helpers.ts#L168-L170) — sin `worksiteId`, `executionRows` se resuelve a `[]`; el schedule sí se carga completo.

Resultado: `planned > 0`, `executed = 0`, **`percent = 0`**.

Lo que ve el usuario al entrar al módulo:

- KPI "Cumplimiento Anual": **0%**
- KPI "Avance Mes Vigente": **0%**
- Gráfico de tendencia mensual: ejecutado en 0 los 12 meses
- Desglose por categoría: 0% en todas (ver C4)
- …y al lado, el gráfico "cumplimiento por faena" ([`page.tsx:155-169`](app/(app)/prevencion/pdtp/page.tsx#L155-L169)) **sí** pasa un `worksiteId` real por faena, así que muestra porcentajes correctos. El tablero se contradice a sí mismo en la misma pantalla.

La función correcta ya existe y fue escrita exactamente para esto:

```
lib/services/pdtp/compliance.ts:161-167
 * Agrega el indicador de cumplimiento sobre varias faenas autorizadas [...]
 * en vez de omitir `worksiteId` — omitirlo deja `executed` en 0 aunque
 * exista avance real (UX-01). Falla cerrado: sin faenas explícitas no hay agregado.
```

Tiene test dedicado: `lib/__tests__/prevention-pdtp.test.ts:737` — *"aggregates approved executions across authorized worksites instead of returning 0 without a faena (UX-01)"*. El refactor dejó de usarla; el único consumidor que queda es `pdtp/programas/page.tsx:37`.

**Fix**: cuando `selectedWorksiteId` es `undefined`, usar `getPdtpComplianceIndicatorsForScope(activeProgram.id, scopedWorksites.map(w => w.id))`.

### C2 — El gráfico SST rotula casos provisionales como "accidentes sin tiempo perdido"

[`page.tsx:120-126`](app/(app)/prevencion/pdtp/page.tsx#L120-L126):

```ts
accConTiempoPerdido: m.confirmed.accidents ?? 0,
accSinTiempoPerdido: m.provisional.accidents ?? 0,
```

`confirmed` / `provisional` no es un eje de tiempo perdido, es un eje de **certeza de clasificación**. En [`safety-indicators-calc.ts:213-219`](lib/prevention/safety-indicators-calc.ts#L213-L219):

```ts
const periodCases = deduplicateCases(args.cases.filter((item) => (
  ... && item.eventType === "work_accident"
  && item.absenceAtLeastNormalShift          // ← TODOS son con tiempo perdido
)))
const confirmedCases   = periodCases.filter((i) => i.inclusionStatus === "included")
const pendingCases     = periodCases.filter((i) => i.inclusionStatus === "pending")
const provisionalCases = [...confirmedCases, ...pendingCases]   // ← superconjunto
```

Dos consecuencias:

- Todos los casos del cálculo **tienen** tiempo perdido (`absenceAtLeastNormalShift`). No hay ningún "sin tiempo perdido" ahí.
- `provisional` **contiene** a `confirmed`, así que la serie "sin TP" es siempre ≥ la de "con TP" y cuenta la misma población.

Y el síntoma visible: el docstring del mismo archivo fija la invariante *"un snapshot aprobado exige que confirmed === provisional"*. Cuando el período se cierra correctamente, el gráfico dibuja **dos series idénticas** rotuladas "con tiempo perdido" y "sin tiempo perdido".

Contexto: tasa de frecuencia, tasa de gravedad y accidentes con/sin tiempo perdido son cifras reportables (DS 44 / SUSESO). Un gráfico materialmente falso en el tablero de cumplimiento es el peor lugar para este error.

**Fix**: eliminar la serie o alimentarla del dato real. `actualSeverity` ya distingue `minor` / `medical_treatment` / `lost_time` y se agrega en `getIncidentAnalyticsData`.

### C3 — El KPI "Acciones Pendientes" cuenta el 100% de las acciones, siempre

[`page.tsx:202`](app/(app)/prevencion/pdtp/page.tsx#L202):

```ts
const openActionsCount = actions.filter((a) => a.estado !== "verificada").length
```

`"verificada"` **no es un valor válido** de `pdtpActionPlan.estado`. Los valores del dominio son `pendiente | en_proceso | completado | verificado | cancelado`, y la constante canónica es:

```ts
// lib/services/pdtp/checklist-domain.ts:22
export const PDTP_ESTADOS_CERRADOS = new Set(["completado", "verificado", "cancelado"])
```

`"verificada"` es vocabulario de PPA / evaluaciones (`ppa/[id]/page.tsx:225`), copiado al dominio equivocado. Doble error:

1. El género no coincide (`verificada` vs `verificado`) → el filtro **nunca excluye nada**.
2. Aun corregido, seguiría contando `completado` y `cancelado` como pendientes.

Incoherencia dentro del mismo tile: `overdueActionsCount` usa `a.vencida`, que sí respeta `PDTP_ESTADOS_CERRADOS` vía `checklist-domain.ts:114`. El tile muestra un total inflado junto a un vencido correcto.

**Fix**: `actions.filter((a) => !PDTP_ESTADOS_CERRADOS.has(a.estado))`.

### C4 — El "desglose por categoría" inventa el ejecutado

[`page.tsx:179-189`](app/(app)/prevencion/pdtp/page.tsx#L179-L189):

```ts
const executedEst = Math.round(
  (total * (indicators?.annual.executed ?? 0)) / Math.max(indicators?.annual.planned ?? 1, 1),
)
```

Reparte el ratio global de ejecución entre categorías como si fuera una medición por categoría. Además mezcla unidades: `total` es un **conteo de actividades**, mientras `annual.executed / annual.planned` son **cantidades**. Ni `scheduled` ni `executed` del gráfico son lo que su etiqueta dice.

Con C1 activo, `annual.executed = 0` → todas las categorías en 0%.

En un tablero de cumplimiento SG-SST auditable, un estimado presentado como medición es un problema de integridad, no de precisión.

**Fix**: calcular ejecutado real por categoría (agrupando ejecuciones por `program`/hoja) o quitar el gráfico. No hay término medio aceptable acá.

---

## ALTOS

### A1 — El botón "Mostrar las N actividades" no hace nada

[`pdtp-sheet-table.tsx:146-157`](app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx#L146-L157): el `useMemo` lee `displayActivities` pero declara `[filteredActivities]` como dependencia.

En vista anual con filtro "all", `filteredActivities === view.activities` — una referencia de prop **estable**. Al hacer click:

1. `showAll = true` → re-render
2. `needsPagination` pasa a `false` → `displayActivities` es la lista completa
3. pero la dep del memo no cambió → **devuelve los 30 grupos cacheados**
4. el botón desaparece (su condición ya no se cumple) y la tabla sigue mostrando 30 filas, sin forma de reintentar

Solo se "arregla" si el usuario toca el filtro de estado, porque eso sí crea un array nuevo. En vista semanal no se manifiesta (`weeklyActivities` es un array nuevo cada render, que además anula el memo).

**Fix**: agregar `displayActivities` a las deps — o borrar el memo, que no aporta nada acá.

### A2 — El contador de la paginación usa el total sin filtrar

[`pdtp-sheet-table.tsx:117-118`](app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx#L117-L118): `needsPagination` se calcula sobre `sourceActivities.length`, pero el corte se aplica a `filteredActivities`. Con 40 actividades y un filtro que deja 5, se muestran 5 filas bajo un botón que dice *"Mostrar las 40 actividades (10 más)"*.

**Fix**: basar `needsPagination` y el texto en `filteredActivities.length`.

### A3 — Cuatro rutas quedaron inalcanzables

| Ruta | Estado | Evidencia |
|---|---|---|
| `/prevencion/pdtp/cobertura` | **huérfana desde hoy** | Nav removida en `manifest.ts`. No queda ningún `<Link>`. Únicas referencias: `revalidatePath()` en `miper/actions.ts:38` y `requisitos-legales/actions.ts:30` (invalidación de caché, no navegación) + `e2e/accessibility.spec.ts:31` |
| `/prevencion/pdtp/aplicabilidad` | **huérfana de antes** | 0 links, 0 nav. Solo `e2e/pdtp-applicability-matrix.spec.ts:18` la abre con `page.goto` |
| `/prevencion/pdtp/obligaciones` | degradada | Perdió la nav ("Trabajo por eventos"). Se llega solo reactivamente: `operational-work-queue.ts:608` y `reminders.ts:229`. Sin entrada proactiva |
| `/prevencion/documentacion/nuevo` | ruta muerta | 0 referencias. El flujo pasó a modal: *"Subir archivo ya no es un link a /nuevo, es un botón que abre el modal"* (`documentacion-header-actions.test.tsx:47`) |

Las dos primeras importan más de lo que parece: `cobertura` es la vista de trazabilidad MIPER↔requisitos legales (*"Demuestra de dónde nace cada medida del programa"*), y `aplicabilidad` es la UI de exclusiones por faena de la regla R4 — que **sí afecta el cómputo de cumplimiento** ([`helpers.ts:179-188`](lib/services/pdtp/helpers.ts#L179-L188)). Hoy no hay forma de administrar esas exclusiones desde la aplicación.

### A4 — El selector de faena de la importación Excel ofrece faenas que el servidor rechazará

El WIP cambió el `<Select>` de `visibleWorksites` (con scope) a `allWorksites` (todas las activas) en [`import-excel-section.tsx:217`](app/(app)/prevencion/pdtp/[programId]/editar/import-excel-section.tsx#L217), y quitó la palabra "autorizada" del placeholder.

El servidor sí valida — pero tarde:

```ts
// lib/services/pdtp/imports.ts:391-393  (dentro de applyPdtpImportBatch)
if (!input.worksiteId) throw new Error("Selecciona la faena ...")
assertWorksiteAccess(input.worksiteId, input.scope)
```

`assertWorksiteAccess` está solo en el **confirm**, no en el preview. Flujo real: el usuario sube el archivo, revisa el preview, elige una faena fuera de su alcance, confirma → *"Actividad PDTP no encontrada o sin acceso a la faena."* ([`helpers.ts:28`](lib/services/pdtp/helpers.ts#L28)) — un mensaje que no dice que el problema es de alcance.

No es un agujero de seguridad (el servidor cierra), pero sí:

- un callejón sin salida de captura de datos, después de todo el trabajo
- fuga menor: manda al cliente el listado completo de faenas activas (nombre + código) a usuarios con scope acotado
- `visibleWorksites` quedó como **prop muerta** (`visibleWorksites: _visibleWorksites`), todavía calculada y atravesando 3 componentes, más una query nueva en 2 páginas

Sospecha de causa raíz: si el síntoma original era un selector vacío, el problema estaba en `listScopedWorksites` devolviendo nada (scope `none`), y este cambio lo tapa en vez de resolverlo.

---

## MEDIOS

### M1 — Se perdió el "Cumplimiento integral" del tablero

`getPdtpIntegralCompliance` está importado y no se llama; `integral` se declara y nunca se asigna ni se usa (de ahí B1). El eje ponderado **0.5·ejecución + 0.3·verificación + 0.2·cierre** ([`compliance.ts:222`](lib/services/pdtp/compliance.ts#L222)) desapareció de la pantalla que se titula "Dashboard de Cumplimiento SG-SST". Es el único indicador que incorpora verificación de checklist y cierre de acciones.

### M2 — Hidratación: dos hooks leen `localStorage` en el initializer de `useState`

- `usePdtpMonthWindow` — [`pdtp-sheet-table-ui.tsx:633-636`](app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx#L633-L636) (nuevo)
- `usePdtpDensity` — [`pdtp-sheet-table-ui.tsx:310-313`](app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx#L310-L313) (preexistente)

El servidor renderiza el default; el cliente renderiza la preferencia guardada en su **primer** render → mismatch de hidratación. Los dos commits más recientes (`e5ed59a`, `1792d71`) fueron específicamente para cerrar warnings de hidratación; esto los reabre.

El patrón correcto ya está en el repo: `PersistedDetails` ([`persisted-details.tsx:19-28`](app/(app)/prevencion/pdtp/persisted-details.tsx#L19-L28)) arranca en `false` y lee `localStorage` en `useEffect`.

### M3 — Waterfall + N×M queries en la portada del módulo

[`page.tsx:155`](app/(app)/prevencion/pdtp/page.tsx#L155) corre un `Promise.all` sobre `scopedWorksites` **después** del primer `Promise.all` → round-trip serial evitable. Y cada `getPdtpComplianceIndicators` hace ~5-6 queries (programa, actividades, schedule+ejecuciones+overrides+exclusiones, params por faena, dotación activa).

Con 10 faenas: ~55 queries extra en el render de la portada, releyendo 10 veces el mismo programa.

Al arreglar C1 esto se resuelve casi solo: `getPdtpComplianceIndicatorsForScope` ya hace el fan-out por faena, así que puede alimentar el KPI agregado **y** el gráfico comparativo con un solo recorrido.

### M4 — `getIncidentAnalyticsData` no filtra por estado

La función nueva en `prevention-indicadores.ts` tiene un WHERE de solo `año + scope`. Cuenta todo incidente registrado, sin distinguir triage ni cierre, y sin el eje `confirmed`/`provisional` que usa el resto del archivo. Consecuencia: los gráficos "Accidentes comunes", "Incidentes por faena" y "Severidad potencial" **no reconcilian** con "Siniestralidad" en el mismo tablero.

Aparte: agrupa `serious` + `fatal` bajo una sola etiqueta "Graves / Fatales". Defendible como agregación, pero una fatalidad no debería quedar diluida en un tablero SG-SST.

### M5 — `/prevencion/pdtp` duplicado en el manifest

El item padre ([`manifest.ts:232`](modules/prevention/manifest.ts#L232)) y su primer hijo "Dashboard" ([`:238`](modules/prevention/manifest.ts#L238)) apuntan a la misma href. En [`nav-rows.tsx:79-80`](components/layout/nav-rows.tsx#L79-L80), `selfActive` y `childActive` se cumplen simultáneamente → fila padre e hija resaltadas a la vez, más una fila redundante que no lleva a ningún lado nuevo.

### M6 — El dashboard elige programa en silencio

[`page.tsx:78-80`](app/(app)/prevencion/pdtp/page.tsx#L78-L80):

```ts
const activeProgram = (await getActivePdtpProgram(year))
  ?? (await listPdtpPrograms({ year }))[0]
  ?? null
```

El código anterior tenía la invariante explícita y comentada: *"Un único programa anual es contexto predeterminado. Con varios programas nunca elegimos silenciosamente una versión: se muestra el selector."*

Con varios borradores y ninguno activo, el tablero muestra los números de un programa arbitrario (el orden de `listPdtpPrograms` no está garantizado) sin decir cuál. Peor: la etiqueta dice literalmente `Programa activo: {título}` incluso cuando ese programa **no está activo**.

### M7 — Cero tests en el código nuevo

- `pdtp/page.tsx` — 323 líneas, casi todas de transformación de datos: **sin test**
- `pdtp-dashboard-charts.tsx` — 396 líneas: **sin test**
- `pdtp-sheet-table.test.tsx` — **no se actualizó**: 0 referencias a paginación o ventana de meses

El módulo tiene ~30 archivos de test y una suite de servicios sólida (58/58 en `prevention-pdtp.test.ts`). Este delta no aportó ninguno. Un test que hiciera click en "Mostrar las N actividades" habría cazado A1; una aserción sobre el conteo de acciones habría cazado C3.

---

## BAJOS

| # | Hallazgo | Ubicación |
|---|---|---|
| L1 | `"use me"` antes de `"use server"`. Funciona porque ambos caen en el *directive prologue*, pero es basura y algunos bundlers inspeccionan solo la primera directiva | `campanas/actions.ts:1` |
| L2 | Variable muerta renombrada con `_` para silenciar el linter en vez de borrarla | `pdtp-sheet-table.tsx:92` (`_hasHiddenMonths`) |
| L3 | No sigue el contrato del módulo: devuelve `{success, error}` en vez de `ActionState` (`{ok, message}`), y expone `err.message` crudo al cliente en vez de `unexpectedActionError` (que sanea y reporta a Sentry) | `campanas/actions.ts:42-79` |
| L4 | Campañas se autorizan con un permiso de PDTP: `requireAccess(access, "prevention:pdtp:program:manage")` | `prevention-campaigns.ts:43` |
| L5 | Cancelar una obligación comparte permiso con reportarla (`prevention:pdtp:execute`); cancelar es acción de gestión | `pdtp/obligaciones/actions.ts:27` |
| L6 | Server action sin guard. Solo invalida caché, impacto bajo, pero es invocable por cualquiera que conozca el action id | `documentacion/actions/revalidate.ts` |
| L7 | Inconsistencia pendiente de la auditoría anterior: 5 archivos con `useActionState` vs 21 con `useOperation` | módulo completo |

---

## Lo que está bien (no romperlo)

Vale registrarlo, porque acota dónde hay riesgo real:

- **Guards completos**: las 47 server actions del módulo tienen `guardPermission` / `guardAuth`. El split de `actions.ts` en cuatro archivos preservó cada guard, cada schema Zod y cada `revalidatePath` — verificado uno por uno. El barrel de re-exports es correcto.
- **Alcance por faena**: `assertWorksiteAccess` aplicado en la capa de servicios; `getPdtpComplianceIndicatorsForScope` documenta y cumple "falla cerrado".
- **Convenciones de AGENTS.md**: 0 exports CSV, 0 `toLocaleDateString` en `.tsx`, 0 `<h1>` propios, 0 `toast` importado de `sonner`, `PageContainer`/`PageHeader` en todas las páginas reales. `datetime-local` se usa como la propia guía lo permite (con `toLocalInputValue`).
- **Los stubs de redirect** `/documentacion/{revisiones,vencimientos}` son intencionales y están fijados por test (`prevention-documentation-canonical.test.ts:29-58`).
- **Motor de cálculo canónico** (`safety-indicators-calc.ts`): el modelo `confirmed`/`provisional` con invariante de snapshot es correcto y está bien testeado. El problema de C2 es del consumidor, no del motor.

---

# Plan de acción

## Fase 0 — Desbloquear el commit (~30 min)

1. **Resolver B1**: decidir M1 primero (ver punto 6). Si el integral vuelve al tablero, se usan los imports; si no, se borran las tres declaraciones muertas.
2. **Borrar** `_hasHiddenMonths` (`pdtp-sheet-table.tsx:92`) — L2.
3. **Borrar** `"use me"` (`campanas/actions.ts:1`) — L1.
4. Verificar: `npm run lint` en exit 0.

## Fase 1 — Integridad de datos (~4 h) · hacer antes de mostrar el tablero a nadie

Todo en `app/(app)/prevencion/pdtp/page.tsx`.

5. **C1** — Cuando `selectedWorksiteId` sea `undefined`, usar `getPdtpComplianceIndicatorsForScope(activeProgram.id, scopedWorksites.map(w => w.id))`. Reusar su salida para el KPI agregado, la tendencia mensual y el gráfico por faena en un solo recorrido — esto también cierra **M3**.
6. **M1** — Decidir: reponer el cumplimiento integral en el tablero (recomendado: es el único indicador que incorpora verificación y cierre) o quitar los restos. Aplica el mismo criterio de scope que C1.
7. **C3** — `actions.filter((a) => !PDTP_ESTADOS_CERRADOS.has(a.estado))`, importando la constante de `lib/services/pdtp/checklist-domain`.
8. **C2** — Quitar la serie `accSinTiempoPerdido` del gráfico SST, o alimentarla del dato real (`actualSeverity` en `minor` / `medical_treatment`, ya agregado por `getIncidentAnalyticsData`). No dejar `provisional` rotulado como "sin tiempo perdido" bajo ninguna variante.
9. **C4** — Calcular el ejecutado por categoría agrupando ejecuciones reales por hoja/`program`, o eliminar el gráfico. Si se elimina, decirlo en el commit para que no vuelva por copia.
10. **M4** — Alinear `getIncidentAnalyticsData` con el criterio de los demás indicadores del archivo (filtrar por estado y respetar el eje confirmed/provisional), o rotular los tres gráficos explícitamente como "registrados, sin conciliar" para que no se lean como cifras conciliadas.
11. **M6** — Restaurar la invariante: si no hay programa activo y hay más de uno, mostrar el selector en vez de elegir `[0]`. Y no rotular "Programa activo" a un programa que no lo está.

## Fase 2 — Funcionalidad rota (~2 h)

12. **A1** — Agregar `displayActivities` a las deps del `useMemo`, o borrar el memo (`pdtp-sheet-table.tsx:146-157`).
13. **A2** — Basar `needsPagination` y el texto del botón en `filteredActivities.length`.
14. **M2** — Migrar `usePdtpMonthWindow` y `usePdtpDensity` al patrón de `PersistedDetails`: estado inicial determinista + `useEffect` para leer `localStorage`.
15. **A4** — Volver el `<Select>` de importación a `visibleWorksites`, restaurar el placeholder "faena autorizada", y borrar `allWorksites` y sus dos queries. Si el síntoma original era un selector vacío, investigar por qué `listScopedWorksites` devolvía nada — ese es el bug de verdad. Aparte: mover `assertWorksiteAccess` también al paso de preview, para que el rechazo llegue antes de que el usuario invierta el trabajo.

## Fase 3 — Rutas y navegación (~2 h)

16. **A3 / `cobertura`** — Reponer la entrada de nav, o enlazarla desde el detalle de programa. Decidir explícitamente: si la trazabilidad MIPER↔legal debe quedar accesible, tiene que tener una puerta.
17. **A3 / `aplicabilidad`** — Darle una entrada (idealmente como tab del detalle de programa, no como ítem de sidebar). Hoy no hay forma de administrar exclusiones por faena desde la aplicación, y esas exclusiones cambian el cumplimiento calculado.
18. **A3 / `obligaciones`** — Reponer una entrada proactiva; llegar solo desde la cola de trabajo obliga a esperar que algo esté pendiente.
19. **A3 / `documentacion/nuevo`** — Borrar la ruta.
20. **M5** — Quitar el hijo "Dashboard" duplicado del manifest; el item padre ya apunta ahí.

## Fase 4 — Red de contención (~3 h)

21. **M7** — Tests para el delta nuevo, priorizando lo que ya falló:
    - `pdtp-sheet-table.test.tsx`: click en "Mostrar las N actividades" expande la tabla (A1); el contador respeta el filtro activo (A2)
    - `pdtp/page.tsx`: con ≥2 faenas y ninguna seleccionada, `annualPercent` refleja el avance agregado y no 0 (C1) — es el análogo de UI del test UX-01 que ya existe en servicios
    - conteo de acciones abiertas contra `PDTP_ESTADOS_CERRADOS` (C3)
22. Correr `npm run test:pglite` completo antes de commitear (la suite de servicios tarda ~4 min por archivo; conviene lanzarla temprano).

## Fase 5 — Deuda menor (backlog, sin urgencia)

23. **L3** — Migrar `campanas/actions.ts` al contrato `ActionState` + `unexpectedActionError`.
24. **L4** — Permiso propio para campañas en vez de reusar `prevention:pdtp:program:manage`.
25. **L5** — Permiso propio para cancelar obligaciones.
26. **L6** — Guard en `revalidateBiblioteca`.
27. **L7** — Unificar `useActionState` → `useOperation` (5 archivos).

---

## Orden recomendado y por qué

**Fase 0 y 1 son inseparables en la práctica**: el error de lint que bloquea el commit es el residuo del indicador que se perdió, así que se arreglan juntos.

La Fase 1 es la que importa. Cuatro de los hallazgos críticos producen **números falsos en un tablero de cumplimiento SG-SST**: cumplimiento en 0% cuando hay avance real, accidentes provisionales rotulados como sin tiempo perdido, acciones cerradas contadas como pendientes, y ejecución por categoría inventada por regla de tres. En un módulo cuyo propósito es sostener evidencia ante fiscalización, un tablero que miente es peor que un tablero ausente. Mientras C1–C4 estén abiertos, el dashboard nuevo no debería ser la portada del módulo.

La Fase 2 arregla cosas que el usuario nota pero que no corrompen datos. La Fase 3 recupera dos funcionalidades que existen, están testeadas, y que nadie puede alcanzar — `aplicabilidad` en particular, porque sus exclusiones sí afectan el cumplimiento calculado. La Fase 4 evita que este mismo delta vuelva a pasar sin red.

Nota sobre el patrón de fondo: los cuatro críticos comparten una causa. El código nuevo **reimplementó** cálculos que ya existían y estaban correctos en la capa de servicios (`getPdtpComplianceIndicatorsForScope`, `PDTP_ESTADOS_CERRADOS`, el eje `confirmed`/`provisional`) en vez de consumirlos. Los servicios están bien y bien testeados; el problema es una capa de presentación que rehízo el dominio a mano. La regla que evita la repetición: **la página no calcula cumplimiento — lo pide.**

---

# Registro de implementación

**Fecha**: 2026-07-27 · **Alcance**: plan completo, fases 0 a 5.

## Correcciones a esta auditoría

Al implementar aparecieron cuatro cosas que la auditoría reportó mal o de más.
Se dejan escritas porque cambian la lectura de los hallazgos originales.

### C2 estaba sobreestimado

Reporté que el gráfico SST mostraba una serie falsa. Al abrir
`pdtp-dashboard-charts.tsx` resultó que **el chart solo grafica `tasaFrecuencia`
y `tasaGravedad`**: `sstConfig` no declara las otras dos series y no hay ningún
`<Line>`/`<Bar>` para ellas. Los campos `accConTiempoPerdido` y
`accSinTiempoPerdido` se calculaban en `page.tsx`, viajaban al cliente y se
descartaban.

El defecto es real (una derivación semánticamente falsa, lista para renderizarse
mal en cuanto alguien agregara la serie) pero **nunca llegó a pantalla**. No era
un gráfico falso en producción. Corresponde ALTO, no CRÍTICO.

### A3 — `/prevencion/documentacion/nuevo` era un falso positivo

No es código muerto: es un **redirect stub intencional**, igual que
`/documentacion/revisiones` y `/documentacion/vencimientos`, y está fijado por
`lib/__tests__/prevention-documentation-canonical.test.ts:56`, que exige que el
archivo contenga `redirect("/prevencion/documentacion")`.

Mi script de huérfanos buscaba entradas de nav y `<Link>`, y un redirect de
compatibilidad por diseño no tiene ninguna de las dos. **No se borró.** El plan
pedía eliminarlo; ese punto queda anulado.

### M4 estaba mal diagnosticado

Reporté que faltaba filtrar por estado. Al revisar el enum
(`lib/prevention/incidents.ts:3`) no existe ningún estado de descarte: es una
escalera de flujo (`reported → triage → … → closed`). Contar todos los eventos
registrados es defendible y no hay nada que filtrar.

El problema real era otro y sí se corrigió: `getIncidentAnalyticsData`
**duplicaba** los mapas de etiquetas en vez de usar los canónicos, con redacción
distinta — `"Incidente peligroso"` vs `"Incidente o suceso peligroso"`,
`"Bajo"` vs `"Baja"`, `"Sospecha enf. profesional"` vs
`"Presunta enfermedad profesional"`. El mismo tipo de evento se leía distinto
según la pantalla (regla A6).

### Hallazgo nuevo — un pipeline de datos calculado y tirado

`potentialSeverity` se agregaba en la base, se propagaba por `page.tsx` y llegaba
al componente como `potentialSeverity: _potentialSeverity = []`: renombrado con
guion bajo para callar al linter y descartado. Una agregación por request pagada
en cada carga para no mostrar nada.

## Cambios por hallazgo

### Fase 0 — Desbloquear el commit

| # | Hallazgo | Estado | Cambio |
|---|---|---|---|
| 1-2 | **B1** lint falla | Hecho | Resuelto vía M1: los imports ya no están muertos porque el integral volvió al tablero |
| 2 | **L2** var muerta | Hecho | Eliminado `_hasHiddenMonths` (`pdtp-sheet-table.tsx`) |
| 3 | **L1** `"use me"` | Hecho | Eliminada la directiva basura (`campanas/actions.ts:1`) |
| 4 | Verificación | Hecho | `npx eslint .` → **exit 0**, sin errores ni warnings |

### Fase 1 — Integridad de datos

| # | Hallazgo | Estado | Cambio |
|---|---|---|---|
| 5 | **C1** 0 % de cumplimiento | Hecho | `page.tsx` usa `getPdtpComplianceIndicatorsForScope(programId, scopedWorksites)`. Con faena elegida toma su desglose de `perWorksite`; sin faena, el agregado del alcance |
| 5 | **M3** waterfall + N×M | Hecho | `getPdtpComplianceIndicatorsForScope` ahora expone `perWorksite`, así que **un solo fan-out** alimenta el KPI agregado y la comparativa por faena. Se eliminó el segundo `Promise.all` sobre `scopedWorksites` (con 10 faenas: ~55 queries y un round-trip serial menos) |
| 6 | **M1** integral perdido | Hecho | Vuelve como tile, reemplazando "Faenas Autorizadas" —un conteo que no cambiaba ninguna decisión (regla A1)—. Muestra el ponderado y el desglose ejec./verif./cierre |
| 7 | **C3** acciones pendientes | Hecho | Nueva función de dominio `isPdtpActionOpen()` en `checklist-domain.ts`, usada por el tablero. Sustituye el filtro por `"verificada"`, que no existe en el enum |
| 8 | **C2** serie SST falsa | Hecho | Eliminados `accConTiempoPerdido`/`accSinTiempoPerdido` del tipo `SstPoint` y del mapeo. Comentario en el sitio explicando por qué el eje confirmed/provisional no es un eje de tiempo perdido |
| 9 | **C4** categorías inventadas | Hecho | El gráfico pasa a ser **distribución real**: nº de actividades por eje, sin prorratear ejecutado. Retitulado "Actividades por Eje…" y la bajada aclara que es distribución, no avance |
| 10 | **M4** analytics de incidentes | Hecho (rediagnosticado) | Usa `INCIDENT_EVENT_LABELS` / `INCIDENT_SEVERITY_LABELS` canónicos; se borraron los mapas duplicados |
| 11 | **M6** programa silencioso | Hecho | Con varios programas y ninguno activo se muestra un **selector** en vez de elegir `[0]`. El rótulo dice "Programa en borrador" cuando no está activo, en vez de mentir con "Programa activo" |
| — | Extra | Hecho | Se renderiza el gráfico de **severidad potencial**, cuyos datos ya se calculaban y se descartaban |
| — | Extra | Hecho | Estado vacío propio para usuarios sin faenas asignadas, en vez de mostrar 0 % sin explicación |

### Fase 2 — Funcionalidad rota

| # | Hallazgo | Estado | Cambio |
|---|---|---|---|
| 12 | **A1** botón inerte | Hecho | Eliminado el `useMemo` de agrupación. `displayActivities` cambia de identidad en cada render con paginación activa, así que memoizar no ahorraba nada y sí servía grupos obsoletos |
| 13 | **A2** contador equivocado | Hecho | `needsPagination` y el texto del botón se miden sobre `filteredActivities`, no sobre el total sin filtrar |
| 14 | **M2** hidratación | Hecho | `usePdtpMonthWindow` y `usePdtpDensity` leen `localStorage` en `useEffect`, siguiendo el patrón de `PersistedDetails`. Ambos toggles pasaron a updater funcional, de paso |
| 15 | **A4** selector de importación | Hecho | El `<Select>` vuelve a `visibleWorksites` y recupera el placeholder "faena autorizada". Se eliminó `allWorksites` de 3 componentes y **2 queries**. `applyPdtpImportBatch` da ahora un mensaje que explica que el problema es de alcance |

Sobre A4: adelantar `assertWorksiteAccess` al preview **no aplica** — el staging
no recibe `worksiteId`, la faena solo se elige al confirmar. Ofrecer únicamente
faenas autorizadas cierra el hueco por completo.

### Fase 3 — Rutas y navegación

| # | Hallazgo | Estado | Cambio |
|---|---|---|---|
| 16 | `cobertura` huérfana | Hecho | Repuesta en el sidebar |
| 17 | `aplicabilidad` huérfana | Hecho | Enlazada desde el menú del detalle de programa (es configuración por programa, no merece fila de sidebar) |
| 18 | `obligaciones` degradada | Hecho | Repuesta en el sidebar |
| 19 | `documentacion/nuevo` | **Anulado** | Falso positivo: redirect intencional fijado por test (ver correcciones) |
| 20 | **M5** href duplicada | Hecho | Eliminado el hijo "Dashboard", que repetía la href del padre |

El sidebar PDTP queda con 5 hijos (Programas, Aprobaciones, Acciones y
seguimiento, Trabajo por eventos, Cobertura MIPER y legal): dentro del rango
4-6 de la regla A2 y sin páginas inalcanzables.

### Fase 4 — Red de contención

| # | Hallazgo | Estado | Cambio |
|---|---|---|---|
| 21 | **M7** sin tests | Hecho | 3 tests de paginación en `pdtp-sheet-table.test.tsx`; 4 tests de `isPdtpActionOpen` en `lib/__tests__/pdtp-action-open.test.ts`; assert de `perWorksite` sumado al test UX-01 existente |
| 21 | Control positivo | Hecho | Reintroduje ambos bugs (memo con dep equivocada + `needsPagination` sin filtrar) y **los 2 tests fallaron**; restaurado el arreglo, los 12 vuelven a pasar. Los tests cazan el bug, no solo acompañan al arreglo |
| 22 | Suite completa | Hecho | Ver más abajo |

### Fase 5 — Deuda menor

| # | Hallazgo | Estado | Cambio |
|---|---|---|---|
| 23 | **L3** contrato de campañas | Parcial | Nueva clase `CampaignDomainError`; el helper `campaignFailure()` **loguea** todo fallo y solo devuelve al navegador el mensaje si es de dominio —antes cualquier error de driver o SQL viajaba al cliente sin registrarse—. La migración del shape `{success,error}` a `ActionState` queda pendiente |
| 24 | **L4** permiso de campañas | **No hecho** | Ver pendientes |
| 25 | **L5** permiso de cancelar | **No hecho** | Ver pendientes |
| 26 | **L6** guard en revalidate | Hecho | `revalidateBiblioteca` exige `prevention:docs:view` |
| 27 | **L7** useActionState | **No hecho** | Ver pendientes |

## Verificación final

| Comando | Antes | Después |
|---|---|---|
| `npx tsc --noEmit` | limpio | **limpio** |
| `npx eslint .` | **exit 1** (1 error, 3 warnings) | **exit 0**, sin warnings |
| `npm run test:fast` | 3 fallos preexistentes de `main` | 3027 pasan · los mismos 3 fallos ajenos |
| `vitest pglite prevention-pdtp.test.ts` | 58/58 | **58/58** |
| `pdtp-sheet-table.test.tsx` | 9/9 | **12/12** (3 nuevos) |
| `pdtp-action-open.test.ts` | — | **4/4** (nuevo) |

Cobertura de los servicios modificados: `prevention-campaigns.test.ts`,
`prevention-indicators-postgres.test.ts`, `pdtp-checklist-action-plan.test.ts` y
`prevention-material-environmental.test.ts` están en la suite **non-pglite**, que
corrió entera después del último cambio. `compliance.ts` e `imports.ts` los cubre
`prevention-pdtp.test.ts`, ejecutado aparte (58/58). No quedó ningún servicio
tocado sin su test ejecutado.

La suite pglite completa corrió una vez (**43/44 archivos, 368/369 tests**) con
un único fallo, `operational-assignments.test.ts`, verificado después como
preexistente. Ese run quedó parcialmente invalidado porque el `git stash` y el
`git checkout 1792d71` con que verifiqué la atribución de los otros fallos se
solaparon con él, intercambiándole archivos por debajo; por eso el fallo que
reportó se volvió a comprobar aisladamente en vez de darlo por bueno.

### Tests que ya estaban rotos

Al verificar aparecieron **4 tests rojos que no son de este trabajo**:

- `lib/__tests__/navigation.test.ts` — roto por el WIP de hoy, que renombró
  "Programa preventivo SG-SST" → "Programa de trabajo (PDTP)" y reestructuró los
  hijos sin actualizar el test. **Corregido** y reforzado: ahora también verifica
  que ningún hijo repita la href del padre y que `obligaciones` y `cobertura`
  tengan entrada.
- `e2e/pdtp-lifecycle-approvals.spec.ts:24` — mismo rename, mismo olvido: el spec
  buscaba el breadcrumb "Programa preventivo SG-SST". **Corregido.** (Los e2e no
  se ejecutaron en esta sesión; requieren servidor y `PGHOST`.)
- `lib/__tests__/submit-request-action.test.ts` (2) y
  `lib/__tests__/aprobaciones-actions.test.ts` (1) — **fallan sin mis cambios**,
  verificado dos veces con `git stash`: contra HEAD y contra `1792d71`, el commit
  anterior a todo el WIP de hoy. Son de Adquisiciones, fuera del alcance de esta
  auditoría; **quedan rojos**.
- `lib/__tests__/operational-assignments.test.ts` (1, pglite) — *"returns only
  permitted activity before limiting and keeps the actor snapshot"*: espera
  `actorName: "Responsable histórico"` y recibe `"Coordinadora"`. También
  **falla sin mis cambios** (verificado con `git stash`). Es del snapshot de
  actor en la cola operacional, ajeno a Prevención; **queda rojo**.

> Nota de contexto: durante esta sesión el WIP que motivó la auditoría fue
> commiteado (HEAD pasó de `1792d71` a `15da83d`, tres commits). Por eso los
> hallazgos hablan de "código sin commitear" pero hoy ya está en `main`. Los
> arreglos de este registro quedan sin commitear, sobre esos commits.

También se actualizaron dos asserts de `prevention-pdtp.test.ts` que fijaban el
texto `/sin acceso/i` del mensaje de importación que este trabajo mejoró
deliberadamente.

---

# Segunda ronda — los 7 pendientes (2026-07-27)

Plan en `.claude/plans/crea-una-plan-de-federated-starfish.md`. Los ocho items
quedaron implementados y verificados. Tres decisiones de producto las tomó el
usuario antes de empezar: umbral todo-o-nada para R2, crear los permisos
dedicados, y migrar solo el uso imperativo en L7.

## Correcciones adicionales a esta auditoría

Al implementar aparecieron dos supuestos del plan que no se sostuvieron:

**El riesgo de deploy de L4/L5 no existía.** El plan advertía que crear permisos
nuevos dejaría a los roles sin ellos hasta re-sembrar RBAC. Al abrir
`scripts/deploy-prod.sh` resultó que **ya corre `sync-rbac` justo después de
migrar** (línea 60, servicio `sync-rbac` en `docker-compose.yml:136`). No hubo que
agregar nada al despliegue: el flujo normal cubre el caso.

**H4c no estaba bloqueado por los tests.** La auditoría del 27-07 lo difirió
porque "los tests dependen del barrel `./builder-tabs`". Dejando `builder-tabs.tsx`
como barrel de re-exports, **los 7 archivos de test pasaron sin tocar un solo
import** (29/29). La razón para diferirlo nunca fue real.

## Cambios por item

| Item | Estado | Cambio |
|---|---|---|
| **1a** `submit-request-action` | Hecho | `requiredDate` en los fixtures. La validación de fecha (`submit.ts:46-49`) corre antes del chequeo de propiedad, así que dos tests recibían el mensaje equivocado. **+2 tests** que cubren la regla nueva, que no tenía ninguno |
| **1b** `aprobaciones-actions` | Hecho | Mock de `db.transaction` con una cadena thenable que sirve para `.where().for("update")` y `.where()`. La acción se reescribió con `SELECT … FOR UPDATE` y el mock se quedó atrás. **+2 tests**: ítems ya en OC y faena fuera de alcance, ninguna cubierta |
| **1c** `operational-assignments` | Hecho | Test bomba de tiempo: `recordOperationalActivity` no setea `occurredAt` (lo pone el default = hora real), los tests hermanos dejaban eventos de hoy y este ordenaba `desc` con `limit 1` sobre fixtures de fecha fija. Se parte de la tabla vacía |
| **L7** | Hecho | `revoke-token-button.tsx` → `useOperation`. Descartaba el resultado (`const [, action]`), así que un fallo al revocar era silencioso; ahora se muestra. Los otros 3 archivos quedan en `useActionState` porque son `<form action>`. Regla precisada en `AGENTS.md` con tabla de decisión |
| **L3** | Hecho | Las 3 acciones devuelven `ActionState`; `campaignFailure` delega en `unexpectedActionError`. Los 3 call sites de `campanas-client.tsx` migrados |
| **7b** R2 | Hecho | `targetCoveragePercent` mueve el umbral de acreditación sin tocar el denominador. Sin meta configurada el comportamiento es idéntico al histórico. **+4 tests** |
| **3** integral agregado | Hecho | `getPdtpIntegralComplianceForScope`. Los ejes 2 y 3 se extrajeron a `computeVerificacionYCierre(approvedExecutionIds)` para que ambas versiones agreguen **sobre las filas crudas**. **+2 tests** |
| **2** avance por eje | Hecho | `getPdtpComplianceByCategoryForScope`: agrupa por `pdtpActivities.program` con ejecuciones aprobadas reales. Excluye las de cobertura (se puntúan contra un padrón; mezclarlas cambiaría de unidad). El gráfico vuelve a dos barras. **+3 tests** |
| **L4/L5** | Hecho | 3 permisos nuevos: `prevention:campaign:view`, `prevention:campaign:manage`, `prevention:pdtp:obligation:cancel`. El wrapper `run()` de obligaciones pasa a recibir el permiso; el botón Cancelar gana su propio `canCancel`. **+1 test** de paridad RBAC |
| **H4c** | Hecho | 1514 → **138 líneas** en el orquestador, con 6 tabs en `editar/tabs/` y `tabs/types.ts` para los tipos compartidos. 268+17 imports sobrantes podados con la salida JSON de eslint |

Dos primitivas nuevas evitan duplicar lógica entre los items 2 y 3:
`loadApprovedExecutionsForWorksites` (`helpers.ts`) y `computeVerificacionYCierre`
(`compliance.ts`).

## Controles positivos

Los tres cambios de cálculo se verificaron rompiéndolos a propósito antes de
darlos por buenos. En todos los casos el test nuevo falló y volvió a pasar al
restaurar:

| Bug inyectado | Test que lo detectó |
|---|---|
| `threshold = target` (ignorar la meta R2) | "acredita el padrón completo al alcanzar la meta configurada" |
| Promediar los integrales por faena | "agrega verificación y cierre sobre las filas, no promediando por faena" |
| No excluir las actividades de cobertura | "excluye las actividades de cobertura del desglose" |
| Contar ejecuciones sin aprobar | "agrupa por eje contando solo ejecuciones aprobadas" |

## Verificación

| Comando | Antes de esta ronda | Después |
|---|---|---|
| `npx tsc --noEmit` | limpio | **limpio** |
| `npx eslint .` | exit 0 | **exit 0**, sin warnings |
| `npm run test:fast` | 3 fallos preexistentes | **362 archivos, 3033 tests, 0 fallos** |
| `npm run test:pglite` | 1 fallo preexistente | **45 archivos, 380 tests, 0 fallos** |
| Tests del editor (7 archivos) | 29/29 | **29/29**, sin tocar imports |

**Las dos suites quedaron completamente verdes**: 3413 tests, 0 fallos. Se
cerraron los 4 rojos heredados de `main` (Adquisiciones ×3 + cola operacional ×1).
La corrida de pglite fue limpia esta vez —sin `git stash` ni `checkout` en
paralelo—, así que su resultado sí es válido, a diferencia del de la ronda
anterior.

Se agregaron **14 tests** en total y se registró `pdtp-coverage-r2.test.ts` en
`tests/pglite-files.ts` — usaba PGlite pero corría en el proyecto paralelo, que
es justo lo que ese archivo advierte no hacer.

## Lo que sigue pendiente

Nada de la auditoría ni del plan. Queda una sola cosa, y no es de código:

**Verificación en navegador.** Todo está verificado por typecheck, lint, tests y
control positivo, pero no ejercité la aplicación. Conviene abrir
`/prevencion/pdtp` con un usuario de 2+ faenas y confirmar los cuatro síntomas
que originaron los críticos: que el cumplimiento anual ya no sale en 0 %, que el
tile de acciones pendientes no cuenta las cerradas, que el gráfico por eje
muestra ejecutado real, y que el tile de integral trae número sin elegir faena.

Y una nota de operación: los permisos nuevos requieren `sync-rbac` en el deploy.
El script ya lo hace, pero si se despliega a mano hay que correrlo o campañas y
cancelación de obligaciones quedarán inaccesibles.
