# Auditoría de trazabilidad — 5 de septiembre de 2026

**Resultado:** el submódulo está en plena transición a la vista consolidada por solicitud/OC (plan `docs/superpowers/plans/2026-09-05-trazabilidad-por-solicitud-oc.md`, Tasks 1–2 completas, 3–5 pendientes). Los defectos P1 de autorización y cantidades detectados el 04-09 **siguen presentes**, y la capa agregada nueva replica dos defectos de estados (pendientes de líneas cerradas y OCs en borrador) en los KPIs.

**Base revisada:** commit `885afc69`, con WIP ajeno de prevención intacto. Auditoría de lectura; no se modificó lógica.

**Balance:** 6 P1, 8 P2, 7 oportunidades de mejora. Los IDs de la auditoría del 04-09 (`qa/reports/trazabilidad-2026-09-04.md`) se conservan.

## Alcance y método

- Inspección de `app/(app)/bodega/trazabilidad` (página, filtros, KPIs, tabla, tarjetas, acordeón, integridad, búsqueda documental, detalle de ítem, hoja de vida del trabajador), servicios `trazabilidad-*`, `traceability-integrity*`, `document-chain`, esquema, transacción de compra parcial, rutas de export y rutas legacy.
- Verificación automatizada: **61/61** tests fast, **46/46** tests PGlite, typecheck global y ESLint dirigido al submódulo **sin errores**.
- Contraste con las reproducciones determinísticas de `qa/evidence/trazabilidad-2026-09-04/reproduce.log` y lectura línea a línea del código actual de cada ubicación citada por ese informe.

Lo que sí mejoró desde el 04-09: agregación por solicitud/OC con dedup de OCs compartidas, timelines perezosos (sólo se construyen en la página mostrada), paginación por solicitud, urgencia agregada, KPI "Esperando proveedor" corregido para recepción directo-faena (`max(receivedOffice, receivedFaena)`) y orden estable de aprobaciones.

## Hallazgos P1

### TR-09 — El historial del trabajador sigue exponiendo entregas de otra faena

**Tipo:** PRODUCT BUG — autorización/privacidad. **Sin cambios desde el 04-09.**

`app/(app)/bodega/trazabilidad/trabajador/[workerId]/page.tsx` filtra al trabajador con `worksiteScopeSql`, pero consulta sus entregas sólo por `eq(deliveries.workerId, workerId)` + `destinationType`. Un usuario acotado a una faena ve códigos, productos, fechas, cantidades y estado de firma de entregas hechas en una faena ajena, y el comprobante enlazado sí le será denegado (doble fuga: datos + enlace roto).

- **Ubicación:** `trabajador/[workerId]/page.tsx` (consulta de `deliveryRows`).
- **Corrección propuesta:** aplicar el alcance de faena también sobre `deliveries.worksiteId` (`worksiteScopeSql(session, deliveries.worksiteId)`), coherente con el comprobante. La reproducción determinística existente sigue describiendo el defecto.

### TR-10 — La compra parcial sigue duplicando parte de la cantidad aprobada

**Tipo:** PRODUCT BUG — integridad de cantidades. **Sin cambios desde el 04-09.**

El split en `purchase-orders-create.ts` crea el ítem hermano y reduce el original, pero las `approvalDecisions` (con su `modifiedQty`) permanecen sobre el ítem original. `buildConsolidatedRows` toma `modifiedQty` de la última aprobación como `approved` del original ya reducido y suma el remanente del hermano: aprobación ajustada a 10, compra parcial de 6 → solicitado total 10, aprobado 14, pendiente 14.

- **Ubicación:** `lib/services/trazabilidad-consolidated-builder.ts:73-84`; split en `lib/services/purchasing-module/purchase-orders-create.ts:215-259`.
- **Nota:** la capa agregada nueva suma estos totales por UOM (`summarizeRows`), así que el defecto también infla los resúmenes por solicitud y el Excel futuro del Task 3.
- **Corrección propuesta:** distinguir la aprobación histórica del compromiso vigente de cada línea tras dividirla (el hermano debería heredar el saldo de la decisión, o el cálculo debe usar la cantidad vigente del ítem y no `modifiedQty` histórico). Regresión: conservación del total antes/después del split y tras entregar ambas partes.

### TR-02 — El detector de integridad sigue contando entregas anuladas

**Tipo:** PRODUCT BUG — falsos positivos persistidos. **Sin cambios desde el 04-09.**

`scanTraceabilityIntegrity` consulta `deliveryItems`/`deliveries` sin filtrar `voidedAt`. El consolidado sí la descarta (`builder.ts:100`); el detector no. La misma entrega aporta cero al consolidado y su cantidad completa al detector, y la excepción falsa se persiste en `traceability_integrity_cases`.

- **Ubicación:** `lib/services/traceability-integrity-cases.ts:97-108`.
- **Corrección propuesta:** excluir anuladas del balance y de la cronología del detector, manteniéndolas visibles como documentos anulados; revisar casos falsos ya registrados.

### TR-06 — Una recepción posterior sigue ocultando un déficit intermedio

**Tipo:** PRODUCT BUG — falso negativo de integridad. **Sin cambios desde el 04-09.**

`detectTraceabilityIntegrity` compara totales históricos y sólo pregunta si hubo entregas anteriores a la **primera** recepción; no verifica el saldo recibido en el momento de cada entrega.

- **Ubicación:** `lib/services/traceability-integrity.ts:99-119`.
- **Corrección propuesta:** recorrer eventos por fecha, comprobar saldo acumulado en cada salida y conservar la excepción aunque luego se equilibre; definir desempate estable para eventos simultáneos.

### UI-02 — Contraste insuficiente en las tarjetas móviles

**Tipo:** PRODUCT BUG — accesibilidad. **Sin cambios desde el 04-09.**

`consolidated-card.tsx` sigue usando `text-slate-400` para información legible: "Solicitud:" (≈línea 102) y las fechas del timeline (≈línea 178), con contraste ~2,6:1 sobre blanco, por debajo del mínimo 4,5:1 (WCAG 1.4.3).

- **Corrección propuesta:** usar tokens de texto validados (`--color-text-subtle`/`-muted`) para información, reservando `slate-400` para decoración. Revisar el mismo patrón en el acordeón de escritorio (`consolidated-table-accordion.tsx` usa `text-slate-400` en etiquetas y fechas).

### UI-03 — El flujo de cantidades del detalle desborda en móvil y la tabla compartida sigue sin foco de teclado

**Tipo:** PRODUCT BUG — responsive/accesibilidad. **Sin cambios desde el 04-09.**

El flujo "Solicitado → En OC → Recibido → Entregado" de `[itemId]/page.tsx` sigue siendo un `flex items-center gap-3` sin adaptación (contenido ~485 px contra 390 px disponibles). `TableRoot` (`components/ui/table.tsx:18`) sigue siendo una región desplazable (`overflow-x-auto`) sin `tabIndex`, por lo que no es operable por teclado cuando no contiene enlaces.

- **Corrección propuesta:** grilla/columna vertical en móvil para el flujo; `tabIndex={0}` + `role="region"` + `aria-label` en `TableRoot` (cambio en el componente compartido, beneficia a todas las páginas).

## Hallazgos P2

### TR-03 (extendido) — Líneas rechazadas/canceladas siguen pendientes, ahora también en los KPIs agregados

**Tipo:** PRODUCT BUG — indicadores y filtros.

`computePendingBreakdown` no recibe el estado: una línea rechazada o cancelada conserva `pendingTotal` y `notYetOrdered` completos. La capa de líneas lo mitigaba sólo en la alerta (`CLOSED_STATUSES` en `builder.ts:146-149`), pero la capa agregada nueva no lo hace:

- `computeAggregateKPIs` (`builder.ts:408-452`) cuenta `pendingPurchase`, `inOffice` e `inFaena` con `pendingBreakdown.* > 0` **sin consultar el estado** de la línea ni de la solicitud.
- El filtro agregado "Solo con pendientes" (`applyAggregateFilters`, `builder.ts:373`) usa `line.pendingTotal <= 0`, que nunca es 0 en líneas cerradas sin entrega.
- `hasPending` de la solicitud (`aggregate.ts:232`) suma los pendientes de todas las líneas, incluidas las cerradas.

Resultado: solicitudes rechazadas/canceladas aportan al KPI de compra y pasan el filtro de pendientes para siempre. La capa nueva replicó el defecto que la capa de líneas ya conocía.

- **Ubicación:** `lib/services/trazabilidad-consolidated-builder.ts:408-452`; `lib/services/trazabilidad-consolidated-calc.ts:149-191`.
- **Corrección propuesta:** separar cantidades históricas de obligaciones pendientes también en el agregado (excluir `computedStatus` en `CLOSED_STATUSES` de los KPIs accionables y del filtro de pendientes).

### TR-04 (extendido) — La OC en borrador sigue contando como "Pedido a proveedor", ahora también en "Esperando proveedor"

**Tipo:** PRODUCT BUG — estado operacional.

`fetchLinkedTraceabilityData` admite toda OC no cancelada (incluye `draft`), y `computeItemStatus` produce `pedido_proveedor` con cualquier `inOc > 0`. El KPI agregado nuevo lo replica: `awaitingSupplier` cuenta toda OC con `max(receivedOffice, receivedFaena) < inOc`, sin excluir `draft` (ni validar `closed`). Una OC recién creada —todavía editable, sin compromiso con el proveedor— aparece como "Esperando proveedor".

- **Ubicación:** `lib/services/trazabilidad-consolidated-queries.ts:184-187`; `lib/services/trazabilidad-consolidated-builder.ts:428-441`.
- **Corrección propuesta:** distinguir la preparación en OC (draft) del compromiso con el proveedor (sent+), coherente con la transición `draft → sent` de `issueAndSendOrderAction`. Evaluar si `closed` con saldos parciales debe seguir contando como "esperando proveedor".

### TR-05 — Los filtros de fecha siguen usando días UTC mientras la interfaz muestra días chilenos

**Tipo:** PRODUCT BUG — selección temporal y exportación. **Sin cambios desde el 04-09.**

`fetchRawItemRows` compara `createdAt` con literales de fecha sin zona (`filterDesde` y `filterHasta + "T23:59:59"`), truncando además las fracciones del último segundo. Una solicitud de las 22:00 de Chile cae fuera del día que el usuario seleccionó.

- **Ubicación:** `lib/services/trazabilidad-consolidated-queries.ts:93-94`.
- **Corrección propuesta:** convertir los límites del día civil chileno a instantes explícitos (`America/Santiago`) y usar intervalo `[inicio, inicio del día siguiente)`.

### TR-01 — Una entrega válida sin solicitud sigue desapareciendo de "Buscar por código"

**Tipo:** PRODUCT BUG — búsqueda documental. **Sin cambios desde el 04-09.**

`seedFromAnchor` con ancla `delivery` devuelve sólo los `requestItemId` no nulos; si todos son nulos, la cadena queda vacía y `getDocumentChainByCode` responde "no encontrado" aunque la entrega exista y el usuario tenga permiso.

- **Ubicación:** `lib/services/document-chain.ts:171-181` y `:433`.
- **Corrección propuesta:** conservar la entrega ancla como documento de la cadena (con su control de permisos y faena) aunque no tenga eslabones anteriores.

### TR-08 — La búsqueda documental sigue sin informar que una entrega está anulada

**Tipo:** PRODUCT BUG — inconsistencia de evidencia. **Sin cambios desde el 04-09.**

La consulta de entregas de `getDocumentChain` no selecciona `voidedAt` ni el motivo; `status` sigue siendo `destinationType`. El usuario no puede distinguir una entrega vigente de una anulada en la tira documental.

- **Ubicación:** `lib/services/document-chain.ts:272-287` y `:408-418`.
- **Corrección propuesta:** exponer `voided` en `ChainDocument` y presentarlo en las dos superficies (tira y resultados).

### TR-13 — La tabla y el Excel usan universos distintos cuando hay filtros agregados

**Tipo:** PRODUCT BUG — consistencia entre pantalla y exportación (transitorio de la migración).

La tabla y las tarjetas consumen `rows` (líneas completas de las solicitudes filtradas agregadas): una solicitud con dos líneas, una de la categoría filtrada y otra no, muestra **ambas** sin indicar cuál coincidió (`matchingLineCount` se calcula pero ningún componente lo usa). El export (`itemRows` vía `applySecondaryFilters`) filtra por línea: descarga sólo la coincidente. Misma URL de filtros, dos universos.

- **Ubicación:** `page.tsx` (consumo de `rows`), `trazabilidad-export.ts:107-116`, `builder.ts:362-391`.
- **Corrección propuesta:** completar Task 3 y Task 5 del plan (export sobre el agregado; tabla/tarjetas sobre `requests`), marcando las líneas no coincidentes con `matchingLineCount`. Mientras tanto, alinear el export con la vista visible o advertir la diferencia.

### TR-14 — La paginación cuenta solicitudes y la tabla muestra ítems

**Tipo:** INCONSISTENCIA — contrato de paginación (transitorio de la migración).

`totalFiltered`/`ServerPagination` miden solicitudes (25 por página) mientras la tabla y las tarjetas muestran filas de ítems. Con varias líneas por solicitud, el paginador anuncia 25 pero se ven más filas, y el "1 de N" no corresponde a lo visible.

- **Ubicación:** `trazabilidad-consolidated.ts:316-325`; `page.tsx`.
- **Corrección propuesta:** lo resuelve Task 5 (tabla por solicitud con líneas expandibles). No parchear la vista intermedia salvo que la migración se pause.

## Oportunidades de mejora

### OP-01 — Siete KPIs sin acción siguen desplazando el trabajo fuera de la primera pantalla

`consolidated-kpis.tsx` mantiene 7 tarjetas no accionables (sin enlace ni clic que filtre), violando A1 (máx. 4) y el test de los 5 segundos. Con la capa agregada ya disponible, cada KPI podría filtrar por su estado (`?estado=`) para volverse accionable, o bajar los secundarios a una fila compacta.

### OP-02 — Exportación sin feedback ni advertencia de truncamiento

Sigue como `<a download>` dentro de los filtros (fuera de `PageHeader.actions`, sin `ExportButton`). `X-Row-Limit-Applied` no se lee del lado cliente y el libro no incluye alcance/filtros/corte ni advertencia de truncamiento. Task 3 del plan es la oportunidad natural de corregirlo.

### OP-03 — Integridad: casos sin paginar y ajustes con límite global

`listTraceabilityIntegrityCases` carga todos los casos del alcance (resueltos incluidos) sin paginación y con un formulario por caso abierto encima de la lista. `listTraceabilityIntegrityAdjustmentOptions` aplica `limit(250)` global antes de filtrar por faena en el cliente; una faena con ajustes antiguos puede quedarse sin opciones aunque tenga ajustes válidos.

### OP-04 — Regularización con ajuste que no valida producto ni cantidad (TR-07 del 04-09, pendiente de política)

`resolveTraceabilityIntegrityCase` valida faena y tipo `ajuste`, no producto/cantidad/sentido. Decidir si el ajuste debe compensar materialmente (validar relación) o sólo aportar contexto (renombrar la opción y el rótulo "compensatorio").

### OP-05 — Código muerto de la capa anterior

`computeFaenaKPIs` (`builder.ts:225-259`) ya no tiene consumidores fuera de tests; el fallback de proveedor por nombre en `applyAggregateFilters` (`builder.ts:367-369`) compara un nombre contra un id y nunca matchea (`ocsByItem` siempre se pasa en producción); `matchingLineCount` no tiene consumidor hasta Task 5. Limpiar al cerrar la migración.

### OP-06 — Cambiar de pestaña pierde los filtros de seguimiento

`tabHref` conserva sólo `faena`; al ir a "Buscar por código" y volver se pierden `q`, estado, fechas y demás. Conservar los filtros de seguimiento en la URL de la pestaña (o en el historial del navegador).

### OP-07 — Defensa en `document-chain` para documentos sin faena

`inScope` trata `worksiteId === null` como visible para cualquiera con el permiso del libro. Si `deliveries.worksiteId` es nulo en la práctica, exigir la resolución de la faena antes de mostrarla (hoy el comprobante sí la exige, repitiendo el desajuste de TR-09).

## Qué sí se verificó

- **61 + 46 tests** de trazabilidad en verde (fast + PGlite), typecheck global limpio y ESLint dirigido al submódulo sin hallazgos.
- La agregación por solicitud/OC está bien cubierta: dedup de OCs compartidas, UOM separadas, urgencia independiente del orden, líneas sin OC, estados agregados con líneas canceladas.
- Los timelines perezosos y la paginación por solicitud son mejoras reales de rendimiento respecto a la vista anterior.
- Las rutas legacy (`/trazabilidad`, `/trazabilidad/[itemId]`, `/trazabilidad/trabajador/[workerId]`, `/api/trazabilidad/export`) redirigen correctamente.
- Permisos: `warehouse:view_traceability` y `warehouse:reconcile_integrity` siguen separados en navegación y acciones; el alcance por faena del consolidado, export y detalle de ítem sigue cubierto por pruebas negativas.

## Priorización

1. **Autorización y cantidades:** TR-09, TR-10 (los dos defectos P1 de datos).
2. **Detector y anulaciones:** TR-02, TR-06.
3. **Estados y fechas en la capa agregada:** TR-03/TR-04 extendidos, TR-05 — idealmente dentro del propio plan, antes de que el Excel del Task 3 herede los KPIs contaminados.
4. **Accesibilidad:** UI-02, UI-03.
5. **Cierre de la migración:** completar Tasks 3–5 del plan para eliminar TR-13, TR-14 y OP-05 de raíz, en lugar de parchear la vista intermedia.
6. **Resto:** TR-01, TR-08, OP-01 a OP-07.

Convertir las reproducciones del 04-09 en regresiones con resultados correctos al implementar cada arreglo, y repetir la auditoría dirigida tras cerrar la migración.
