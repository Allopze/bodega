# Trazabilidad por Solicitud y Orden de Compra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cambiar la vista consolidada de trazabilidad para que solicitudes y órdenes de compra sean la unidad visible, navegable y exportable, dejando los ítems como evidencia secundaria.

**Architecture:** El pipeline seguirá calculando cada línea para conservar cantidades y documentos, y después agrupará las líneas en agregados por solicitud con órdenes de compra anidadas. La paginación y los KPIs operarán sobre esos agregados, mientras que la tabla desktop, las tarjetas mobile y el Excel consumirán el mismo DTO.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, Vitest/PGlite, Playwright, ExcelJS y los componentes compartidos de `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-05-trazabilidad-por-solicitud-oc-design.md`

## Global Constraints

- La unidad principal de la vista de seguimiento será una **solicitud**; cada solicitud mostrará sus OCs asociadas.
- Una OC compartida puede aparecer dentro de más de una solicitud por sus líneas atribuibles, pero no aumentará dos veces los KPIs globales de OCs.
- Las cantidades no se sumarán entre unidades de medida diferentes; se mostrarán por UOM o en el detalle de líneas.
- La expansión será un control separado del enlace de navegación de la tarjeta/fila.
- El endpoint de exportación seguirá generando Excel y usará el mismo pipeline agregado que la pantalla.
- Se mantienen `/bodega/trazabilidad`, la búsqueda por código y `/bodega/trazabilidad/[itemId]` como evidencia secundaria.
- No se cambia el modelo de datos ni se modifica el historial documental.
- Todo cambio de negocio vive en `lib/` + `app/`; no se recrean servicios bajo `modules/` ni `core/`.
- Las páginas usan `PageHeader` y `PageContainer`; no se agrega un buscador de texto dentro del contenido si TopBar/DataTable ya lo provee.
- Todo texto de estado visible usa etiquetas en español y tokens de contraste `-ink` cuando corresponda.
- No se deben modificar ni incluir en commits los artefactos QA preexistentes; sólo se agregará evidencia generada por esta implementación y sin credenciales.

---

### Task 1: Definir agregados de solicitud/OC y regresiones de dominio

**Files:**
- Create: `lib/services/trazabilidad-consolidated-aggregate.ts`
- Modify: `lib/services/trazabilidad-consolidated.types.ts`
- Modify: `lib/services/trazabilidad-consolidated.ts`
- Test: `lib/services/trazabilidad-consolidated-aggregate.test.ts`
- Modify: `lib/services/trazabilidad-consolidated.test.ts`

**Interfaces:**
- Consumes: `ConsolidatedRow[]` producidas por `buildConsolidatedRows`, los `OcRow` de `LinkedMaps` y `ComputedStatus`/`COMPUTED_STATUS_METAS` existentes.
- Produces: `ConsolidatedRequest`, `ConsolidatedOrder`, `aggregateConsolidatedRows(rows, maps)` y `computeAggregateStatus(rows)` para las tareas de servicio, UI y exportación.

- [ ] **Step 1: Escribir los tests que describen la agregación visible.**

  En `lib/services/trazabilidad-consolidated-aggregate.test.ts`, construir dos
  `ConsolidatedRow` con el mismo `requestId` y comprobar que
  `aggregateConsolidatedRows` devuelve una sola solicitud con `lineCount: 2`,
  dos líneas y el resumen de avance combinado. Añadir casos para varias OCs,
  una OC compartida entre dos solicitudes, una línea sin OC y UOM distintas.

  El contrato mínimo que los tests deben fijar es:

  ```ts
  const result = aggregateConsolidatedRows(rows, maps)

  expect(result.requests).toHaveLength(1)
  expect(result.requests[0]).toMatchObject({
    requestId: "req-1",
    lineCount: 2,
    orderCount: 1,
  })
  expect(result.orders[0]).toMatchObject({
    orderId: "po-1",
    requestIds: ["req-1"],
  })
  expect(result.requests[0]?.quantitiesByUom).toEqual([
    { uom: "par", requested: 10, delivered: 4 },
  ])
  ```

  Verificar que `quantitiesByUom` conserva entradas separadas para `par` y
  `unidad`, y que un `orderId` compartido sólo aparece una vez en
  `result.orders`.

- [ ] **Step 2: Ejecutar sólo los tests nuevos para confirmar el fallo.**

  Run: `npm run test:pglite -- lib/services/trazabilidad-consolidated-aggregate.test.ts`

  Expected: FAIL porque las interfaces y la función de agregación aún no
  existen.

- [ ] **Step 3: Implementar el contrato de agregados.**

  En `trazabilidad-consolidated.types.ts`, añadir tipos explícitos:

  ```ts
  export interface ConsolidatedQuantitySummary {
    uom: string
    requested: number
    approved: number | null
    inOc: number
    receivedOffice: number
    receivedFaena: number
    delivered: number
    pendingTotal: number
  }

  export interface ConsolidatedOrder {
    orderId: string
    code: string
    supplierName: string
    orderStatus: string
    requestIds: string[]
    lineIds: string[]
    lineCount: number
    quantitiesByUom: ConsolidatedQuantitySummary[]
    lastUpdated: string
  }

  export interface ConsolidatedRequest {
    requestId: string
    requestCode: string
    requestDate: string
    requesterId: string
    requesterName: string
    worksiteId: string
    worksiteName: string
    deliveryMode: string
    urgency: string | null
    lineCount: number
    orderCount: number
    orders: ConsolidatedOrder[]
    lines: ConsolidatedRow[]
    quantitiesByUom: ConsolidatedQuantitySummary[]
    status: ComputedStatus
    statusLabel: string
    statusColor: StatusMeta["color"]
    statusCounts: Partial<Record<ComputedStatus, number>>
    pendingTotal: number
    alert: boolean
    lastUpdated: string
  }

  export interface ConsolidatedAggregateResult {
    requests: ConsolidatedRequest[]
    orders: ConsolidatedOrder[]
  }
  ```

  `ConsolidatedRequest.lines` contiene las filas de evidencia sin cambiar sus
  cálculos actuales; nunca se suman cantidades de UOM diferentes en el
  resumen.

- [ ] **Step 4: Implementar agrupación y estado agregado.**

  En `trazabilidad-consolidated-aggregate.ts`, implementar:

  ```ts
  export function aggregateConsolidatedRows(
    rows: ConsolidatedRow[],
    maps: LinkedMaps,
  ): ConsolidatedAggregateResult

  export function computeAggregateStatus(
    rows: ConsolidatedRow[],
  ): Pick<ConsolidatedRequest, "status" | "statusLabel" | "statusColor" | "statusCounts">
  ```

  Agrupar solicitudes por `requestId` y OCs por `purchaseOrderId`. Deduplificar
  `requestIds` y `lineIds`, sumar sólo dentro de la misma UOM, usar la fecha más
  reciente como `lastUpdated` y conservar líneas sin OC en la solicitud sin
  inventar una orden.

  El estado agregado será `entregado` si todas las líneas aplicables están
  entregadas, `parcialmente_entregado` si hay avance y saldo, y en los demás
  casos el estado más bloqueante según el orden ya usado por
  `computeItemStatus`. `statusCounts` conservará el desglose para estados
  mixtos.

  Reexportar los tipos y helpers desde `trazabilidad-consolidated.ts` junto a
  los exports actuales, para que el servicio, la página y el export consuman
  una sola superficie pública:

  ```ts
  export {
    aggregateConsolidatedRows,
    computeAggregateStatus,
  } from "./trazabilidad-consolidated-aggregate"
  export type {
    ConsolidatedRequest,
    ConsolidatedOrder,
    ConsolidatedAggregateResult,
  } from "./trazabilidad-consolidated.types"
  ```

- [ ] **Step 5: Ejecutar la suite de agregación y las regresiones existentes.**

  Run: `npm run test:pglite -- lib/services/trazabilidad-consolidated-aggregate.test.ts lib/services/trazabilidad-consolidated.test.ts`

  Expected: PASS, sin cambiar las expectativas de cálculo de las filas por
  ítem.

- [ ] **Step 6: Commit del contrato de dominio.**

  ```bash
  git add lib/services/trazabilidad-consolidated.types.ts \
    lib/services/trazabilidad-consolidated-aggregate.ts \
    lib/services/trazabilidad-consolidated-aggregate.test.ts \
    lib/services/trazabilidad-consolidated.test.ts
  git commit -m "feat(trazabilidad): agregar solicitudes y ordenes de compra"
  ```

### Task 2: Cambiar el pipeline, filtros, paginación y KPIs al agregado

**Files:**
- Modify: `lib/services/trazabilidad-consolidated.ts`
- Modify: `lib/services/trazabilidad-consolidated-builder.ts`
- Modify: `lib/services/trazabilidad-consolidated.types.ts`
- Modify: `lib/services/trazabilidad-consolidated.test.ts`

**Interfaces:**
- Consumes: `aggregateConsolidatedRows`, `ConsolidatedRequest`, `ConsolidatedOrder` y `CollectedConsolidatedRows` de Task 1.
- Produces: `ConsolidatedTraceabilityResult.requests`, `ConsolidatedTraceabilityResult.orders`, `totalFiltered` por solicitud y KPIs contados en IDs únicos.

- [ ] **Step 1: Añadir regresiones para filtros y KPIs a nivel de solicitud.**

  Extender `lib/services/trazabilidad-consolidated.test.ts` con una solicitud
  de dos líneas donde sólo una coincide con categoría/proveedor/pendientes.
  Comprobar que la solicitud aparece una sola vez, que sus KPIs no cuentan dos
  veces la OC compartida y que la paginación cuenta solicitudes, no líneas:

  ```ts
  const filtered = applyAggregateFilters(aggregated.requests, {
    filterCategoria: "cat-2",
    filterEstado: "",
    filterProveedor: "",
    filterPendientes: false,
    filterQ: "",
  })

  expect(filtered.map((request) => request.requestId)).toEqual(["req-1"])
  expect(computeAggregateKPIs(filtered).openRequests).toBe(1)
  expect(computeAggregateKPIs(filtered).pendingPurchase).toBe(1)
  ```

- [ ] **Step 2: Ejecutar el test de regresión para confirmar el fallo.**

  Run: `npm run test:pglite -- lib/services/trazabilidad-consolidated.test.ts`

  Expected: FAIL porque el resultado actual sólo expone `rows` por ítem.

- [ ] **Step 3: Cambiar el contrato del resultado y del recolector.**

  `CollectedConsolidatedRows` conservará `itemRows` y `maps` para cálculos y
  evidencia, pero añadirá `requests` y `orders` agregados. Después de
  `buildConsolidatedRows` y de los filtros de línea necesarios para el alcance,
  llamar a `aggregateConsolidatedRows` antes de paginar.

  `ConsolidatedTraceabilityResult` pasará a exponer:

  ```ts
  interface ConsolidatedTraceabilityResult {
    requests: ConsolidatedRequest[]
    orders: ConsolidatedOrder[]
    /** Compatibilidad interna: se elimina al conectar la página en Task 5. */
    rows: ConsolidatedRow[]
    totalFiltered: number
    totalPages: number
    safePage: number
    // catálogos, faena, filtros y truncamiento existentes
  }
  ```

  `rows` seguirá conteniendo las líneas sólo durante la migración para que las
  tareas intermedias compilen; ningún componente nuevo lo consumirá. Task 5 lo
  retirará del resultado y de todos los consumidores, evitando que quede una
  segunda representación visible que pueda divergir.

- [ ] **Step 4: Trasladar filtros y KPIs al agregado sin perder búsqueda.**

  Implementar `applyAggregateFilters(requests, filters)` en el módulo de
  agregación. El filtro de estado usará el estado agregado; categoría,
  proveedor, pendientes y texto buscarán en la solicitud, sus OCs y sus líneas.
  Una tarjeta puede conservar todas sus líneas, pero deberá exponer el conteo
  de líneas coincidentes cuando el filtro no abarque la solicitud completa.

  Implementar `computeAggregateKPIs(requests, orders)` con conjuntos de IDs:

  ```ts
  const uniqueOpenRequests = new Set<string>()
  const uniqueOrders = new Set<string>()
  for (const request of requests) {
    if (!["entregado", "cancelado", "rechazado"].includes(request.status)) {
      uniqueOpenRequests.add(request.requestId)
    }
    for (const order of request.orders) uniqueOrders.add(order.orderId)
  }
  ```

  Mantener las mismas métricas de negocio, cambiando su unidad de conteo a
  solicitudes u órdenes únicas según corresponda.

- [ ] **Step 5: Mover la paginación y el timeline al límite agregado.**

  Calcular `totalFiltered`, `totalPages`, `safePage` y `offset` sobre
  `requests`. Aplicar `attachTimelines` sólo a las líneas dentro de las
  solicitudes de la página actual. No construir timelines para todas las
  líneas de la faena.

  Cambiar el aviso de truncamiento para que explique que se cargaron las
  solicitudes más recientes alcanzadas por el límite de líneas, sin afirmar que
  todas las métricas cubren la faena completa.

- [ ] **Step 6: Ejecutar servicio, PGlite y typecheck dirigido.**

  Run: `npm run test:pglite -- lib/services/trazabilidad-consolidated.test.ts lib/__tests__/trazabilidad-export-scope.test.ts`

  Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -- --pretty false`

  Expected: PASS; cualquier error debe investigarse antes de continuar a la UI.

- [ ] **Step 7: Commit del pipeline agregado.**

  ```bash
  git add lib/services/trazabilidad-consolidated.ts \
    lib/services/trazabilidad-consolidated-builder.ts \
    lib/services/trazabilidad-consolidated.types.ts \
    lib/services/trazabilidad-consolidated.test.ts
  git commit -m "feat(trazabilidad): paginar y medir por solicitud"
  ```

### Task 3: Actualizar el Excel al nivel de solicitud y OC

**Files:**
- Modify: `lib/services/trazabilidad-export-format.ts`
- Modify: `lib/services/trazabilidad-export.ts`
- Modify: `lib/__tests__/trazabilidad-export.test.ts`
- Modify: `lib/__tests__/trazabilidad-export-scope.test.ts`
- Modify: `app/api/bodega/trazabilidad/export/route.test.ts`

**Interfaces:**
- Consumes: `ConsolidatedAggregateResult` y filtros normalizados de Task 2.
- Produces: `ReportData` con hoja `Solicitudes`, hoja `Órdenes de compra` y, si se conserva para auditoría, hoja `Detalle de líneas` explícitamente secundaria.

- [ ] **Step 1: Escribir tests de contrato del libro agregado.**

  Cambiar `lib/__tests__/trazabilidad-export.test.ts` para cargar el workbook
  y comprobar que `workbook.worksheets.map((sheet) => sheet.name)` contiene
  `Solicitudes` y `Órdenes de compra`. Dos líneas de una solicitud deben generar
  una fila en `Solicitudes`; una OC compartida debe generar una sola fila en la
  hoja de OCs. Comprobar que las columnas de cantidades por UOM no mezclan
  `par` con `unidad`.

  ```ts
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Solicitudes",
    "Órdenes de compra",
    "Detalle de líneas",
  ])
  expect(workbook.getWorksheet("Solicitudes")?.rowCount).toBe(2)
  expect(workbook.getWorksheet("Órdenes de compra")?.rowCount).toBe(2)
  ```

- [ ] **Step 2: Ejecutar el test de exportación para confirmar el fallo.**

  Run: `npm run test:pglite -- lib/__tests__/trazabilidad-export.test.ts lib/__tests__/trazabilidad-export-scope.test.ts`

  Expected: FAIL porque el formato actual sólo crea `Trazabilidad por Faena`
  con una fila por ítem.

- [ ] **Step 3: Implementar filas de resumen y detalle.**

  En `trazabilidad-export-format.ts`, reemplazar el contrato de fila principal
  por funciones puras que reciban los agregados:

  ```ts
  export function buildTrazabilidadReportData(
    aggregates: ConsolidatedAggregateResult,
    options?: { includeLineDetails?: boolean },
  ): ReportData
  ```

  Generar columnas de solicitud, estado agregado, número de líneas, número de
  OCs, proveedores, pendientes, alertas y cantidades agrupadas por UOM. La
  hoja de OCs tendrá una fila por `orderId`, con solicitudes relacionadas y
  avance de recepción. La hoja de líneas mantendrá los campos actuales sólo
  como evidencia y no será la primera hoja.

- [ ] **Step 4: Hacer que el servicio de exportación use el mismo agregado.**

  En `trazabilidad-export.ts`, para cada faena visible, convertir las filas
  recolectadas a `aggregateConsolidatedRows` y acumular solicitudes/OCs hasta
  `TRAZABILIDAD_EXPORT_MAX_ROWS`. Deduplificar OCs por `orderId` al recorrer
  varias faenas y conservar `truncated` cuando se alcance el límite.

  `getTrazabilidadXlsx` seguirá llamando `buildXlsxBuffer` y mantendrá el
  filename y el alcance de autorización actuales.

- [ ] **Step 5: Verificar filtros, autorización y endpoint.**

  Ejecutar:

  ```bash
  npm run test:pglite -- lib/__tests__/trazabilidad-export.test.ts lib/__tests__/trazabilidad-export-scope.test.ts
  npm run test:pglite -- app/api/bodega/trazabilidad/export/route.test.ts
  ```

  Expected: PASS; una faena fuera de alcance no aparece en ninguna hoja y los
  filtros de fecha/faena se reflejan igual que en pantalla.

- [ ] **Step 6: Commit de la exportación.**

  ```bash
  git add lib/services/trazabilidad-export-format.ts \
    lib/services/trazabilidad-export.ts \
    lib/__tests__/trazabilidad-export.test.ts \
    lib/__tests__/trazabilidad-export-scope.test.ts \
    app/api/bodega/trazabilidad/export/route.test.ts
  git commit -m "feat(trazabilidad): exportar resumen por solicitud y oc"
  ```

### Task 4: Reemplazar la tabla y las tarjetas por solicitudes navegables

**Files:**
- Modify: `app/(app)/bodega/trazabilidad/_components/consolidated-card.tsx`
- Modify: `app/(app)/bodega/trazabilidad/_components/consolidated-table.tsx`
- Modify: `app/(app)/bodega/trazabilidad/_components/consolidated-table-accordion.tsx`
- Create: `app/(app)/bodega/trazabilidad/_components/consolidated-request-details.tsx`
- Test: `app/(app)/bodega/trazabilidad/_components/consolidated-card.test.tsx`
- Test: `app/(app)/bodega/trazabilidad/_components/consolidated-table.test.tsx`

**Interfaces:**
- Consumes: `ConsolidatedRequest`/`ConsolidatedOrder` de Task 2 y las utilidades de fecha/cantidad existentes.
- Produces: `ConsolidatedCard({ request })`, `ConsolidatedTable({ requests })` y un panel común de detalle que enlaza solicitudes, OCs y líneas.

- [ ] **Step 1: Añadir tests de navegación y de estructura accesible.**

  En los tests de componentes, renderizar una solicitud con una OC y comprobar:

  ```ts
  expect(screen.getByRole("link", { name: /SOL-0001/i })).toHaveAttribute(
    "href",
    "/solicitudes/req-1",
  )
  expect(screen.getByRole("link", { name: /OC-2026-0001/i })).toHaveAttribute(
    "href",
    "/compras/po-1",
  )
  expect(screen.getByRole("button", { name: /expandir detalle/i })).toBeVisible()
  ```

  Verificar que activar el botón de expansión no navega y que activar el
  enlace de solicitud sí navega. No habrá un `<button>` que contenga enlaces.

- [ ] **Step 2: Ejecutar los tests para confirmar el fallo actual.**

  Run: `npm run test:fast -- 'app/(app)/bodega/trazabilidad/_components/consolidated-card.test.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-table.test.tsx'`

  Expected: FAIL porque los componentes reciben `ConsolidatedRow` por ítem y
  el click principal sólo cambia el estado de expansión.

- [ ] **Step 3: Implementar la tarjeta mobile por solicitud.**

  Cambiar `ConsolidatedCard` para recibir `{ request: ConsolidatedRequest }`.
  Hacer que el encabezado sea un `Link` a `/solicitudes/${request.requestId}`;
  mostrar código, solicitante, conteo de líneas, conteo de OCs, resumen por UOM,
  pendientes y estado agregado. Renderizar cada OC como `Link` a
  `/compras/${order.orderId}`.

  Mantener el historial de líneas en un botón separado con
  `aria-expanded`/`aria-controls`, y construir el detalle con el nuevo
  `ConsolidatedRequestDetails` para reutilizarlo en mobile y desktop.

- [ ] **Step 4: Implementar la tabla desktop por solicitud.**

  Cambiar `ConsolidatedTable` para iterar `requests`, usar `request.requestId`
  como clave y reemplazar la columna “Ítem / Producto” por Solicitud, líneas,
  OCs, avance y pendientes. El código de solicitud será el enlace principal.
  Las OCs se mostrarán como enlaces compactos dentro de la misma fila.

  La primera celda será un botón de expansión independiente. La fila completa
  no tendrá `onClick` de expansión, porque la navegación debe ocurrir mediante
  los enlaces visibles.

- [ ] **Step 5: Reutilizar el detalle de evidencia sin cambiar sus enlaces.**

  Extraer a `ConsolidatedRequestDetails` el desglose de líneas, timelines y
  enlaces existentes a recepciones, guías, entregas y
  `/bodega/trazabilidad/[itemId]`. Cada línea conservará su `itemId` para abrir
  el expediente puntual sin volver a convertirla en la unidad principal.

- [ ] **Step 6: Ejecutar tests de componentes y lint dirigido.**

  Run: `npm run test:fast -- 'app/(app)/bodega/trazabilidad/_components/consolidated-card.test.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-table.test.tsx'`

  Run: `./node_modules/.bin/eslint 'app/(app)/bodega/trazabilidad/_components/consolidated-card.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-table.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-request-details.tsx'`

  Expected: PASS, sin errores de accesibilidad por controles anidados ni
  enlaces con texto ambiguo.

- [ ] **Step 7: Commit de la UI consolidada.**

  ```bash
  git add 'app/(app)/bodega/trazabilidad/_components/consolidated-card.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-table.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-table-accordion.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-request-details.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-card.test.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-table.test.tsx'
  git commit -m "feat(trazabilidad): navegar por solicitud y orden de compra"
  ```

### Task 5: Conectar la página, KPIs y estados vacíos al nuevo resultado

**Files:**
- Modify: `app/(app)/bodega/trazabilidad/page.tsx`
- Modify: `app/(app)/bodega/trazabilidad/_components/consolidated-kpis.tsx`
- Modify: `app/(app)/bodega/trazabilidad/_components/consolidated-filters.tsx`
- Modify: `e2e/trazabilidad-activos.spec.ts`

**Interfaces:**
- Consumes: `consolidatedData.requests`, `consolidatedData.orders`, `totalFiltered` y KPIs de Task 2.
- Produces: página que no renderiza filas por ítem, mantiene la búsqueda por código y ofrece CTA/enlaces coherentes con la unidad agregada.

- [ ] **Step 1: Añadir la regresión E2E de navegación.**

  En `e2e/trazabilidad-activos.spec.ts`, cargar la vista con el fixture de
  trazabilidad existente, localizar una tarjeta o fila por código de solicitud,
  hacer click en el enlace de solicitud y comprobar `/solicitudes/<id>`. Volver
  a la vista, hacer click en el enlace de OC y comprobar `/compras/<id>`.

  ```ts
  await page.getByRole("link", { name: /SOL-AUDIT-1/i }).click()
  await expect(page).toHaveURL(/\/solicitudes\/req-audit-1/)
  ```

- [ ] **Step 2: Ejecutar la regresión E2E para confirmar el fallo.**

  Run: `npm run test:e2e -- e2e/trazabilidad-activos.spec.ts`

  Expected: FAIL hasta que la página deje de pasar `rows` por ítem y los
  enlaces de los agregados estén renderizados.

- [ ] **Step 3: Cambiar el wiring de la página.**

  En `page.tsx`, iterar `consolidatedData.requests`, usar `request.requestId`
  como clave y pasar `{ requests }` a la tabla y `{ request }` a la tarjeta.
  Cambiar el estado vacío a “No hay solicitudes registradas para esta faena” y
  actualizar el aviso de truncamiento para hablar de solicitudes agregadas.
  Mantener la pestaña Documento, selector de faena y filtros URL-sincronizados.

- [ ] **Step 4: Ajustar KPIs y densidad de la pantalla.**

  Reducir las tarjetas superiores a un máximo de cuatro accionables, agrupando
  las métricas secundarias en texto compacto si siguen siendo necesarias.
  Cada KPI debe enlazar a la vista filtrada por solicitudes/OC correspondiente
  o ser un elemento informativo claramente no interactivo, sin duplicar una
  misma dimensión en tarjeta y filtro.

- [ ] **Step 5: Revisar exportación y filtros de la cabecera.**

  Mantener el botón de exportación en la acción existente de la página/filtros,
  asegurando que la URL conserva todos los filtros normalizados. No agregar un
  segundo input de texto; DataTable/TopBar seguirá siendo la búsqueda global.

- [ ] **Step 6: Ejecutar E2E, lint y typecheck dirigido.**

  Run: `npm run test:e2e -- e2e/trazabilidad-activos.spec.ts`

  Run: `./node_modules/.bin/eslint 'app/(app)/bodega/trazabilidad/page.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-kpis.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-filters.tsx'`

  Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -- --pretty false`

  Expected: PASS; si el navegador no está disponible, registrar la brecha sin
  convertirla en bug confirmado.

- [ ] **Step 7: Commit de integración de página.**

  ```bash
  git add 'app/(app)/bodega/trazabilidad/page.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-kpis.tsx' \
    'app/(app)/bodega/trazabilidad/_components/consolidated-filters.tsx' \
    e2e/trazabilidad-activos.spec.ts
  git commit -m "feat(trazabilidad): mostrar seguimiento por solicitud"
  ```

### Task 6: Auditoría final y verificación de regresiones

**Files:**
- Modify: `qa/reports/latest.md` only if generated by the canonical audit command
- Create: `qa/reports/trazabilidad-por-solicitud-oc-2026-09-05.md` only when the audit produces this report
- Create: `qa/evidence/trazabilidad-por-solicitud-oc-2026-09-05/` only when browser evidence is generated

**Interfaces:**
- Consumes: la vista completa de Task 5, exportación y tests de las tareas anteriores.
- Produces: evidencia verificable de tests, rutas, navegación, consola, red y brechas de cobertura.

- [ ] **Step 1: Ejecutar las suites deterministas enfocadas.**

  Run sequentially through the resource guard:

  ```bash
  npm run test:pglite -- lib/services/trazabilidad-consolidated-aggregate.test.ts lib/services/trazabilidad-consolidated.test.ts lib/__tests__/trazabilidad-export.test.ts lib/__tests__/trazabilidad-export-scope.test.ts
  npm run test:e2e -- e2e/trazabilidad-activos.spec.ts
  ./node_modules/.bin/eslint lib/services/trazabilidad-consolidated-aggregate.ts lib/services/trazabilidad-consolidated.ts lib/services/trazabilidad-export.ts 'app/(app)/bodega/trazabilidad/page.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-card.tsx' 'app/(app)/bodega/trazabilidad/_components/consolidated-table.tsx'
  NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -- --pretty false
  ```

  Expected: PASS; repetir sólo el comando que falle después de corregir su
  causa.

- [ ] **Step 2: Ejecutar `npm run audit` en el entorno QA/local disponible.**

  Leer `qa/reports/latest.md` y revisar individualmente los pasos de tarjetas,
  navegación a solicitud, navegación a OC, filtros, exportación, consola y red.
  Distinguir `PRODUCT BUG`, `FUNCTIONAL FINDING`, `UX FINDING`,
  `AUTOMATION WARNING` y `COVERAGE GAP`; no tomar el estado agregado del flujo
  como prueba de que todos sus pasos fueron verificados.

- [ ] **Step 3: Completar la revisión de calidad.**

  Comprobar manualmente que no hay controles anidados, que el click principal
  de cada tarjeta navega, que el botón de expansión conserva foco visible, que
  las OCs compartidas no duplican KPIs y que el layout mobile no desborda.
  Registrar cualquier brecha de sesión, base de datos o Chromium en el informe.

- [ ] **Step 4: Revisar el diff y dejar el árbol limpio respecto de este cambio.**

  Run: `git diff --check`

  Run: `git status --short`

  Expected: no cambios sin commit introducidos por esta implementación. Los
  artefactos QA previos deben seguir identificables y no ser incluidos por
  error.

- [ ] **Step 5: Commit de la evidencia sólo si corresponde.**

  ```bash
  git add qa/reports/latest.md qa/reports/trazabilidad-por-solicitud-oc-2026-09-05.md qa/evidence/trazabilidad-por-solicitud-oc-2026-09-05
  git commit -m "test(trazabilidad): verificar vista por solicitud y oc"
  ```

  Ejecutar este commit únicamente cuando esos archivos hayan sido producidos
  por la auditoría de esta implementación y no contengan credenciales.
