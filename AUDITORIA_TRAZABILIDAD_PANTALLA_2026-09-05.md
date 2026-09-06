# Auditoría de la pantalla de trazabilidad — post-cambios (2026-09-05)

**Alcance:** cambios aplicados en los commits `e721b0b1`→`f5e8c75a` sobre `app/(app)/bodega/trazabilidad` y servicios `trazabilidad-*`/`traceability-*`/`document-chain`.

**Método:** lectura línea a línea del diff y del estado actual; verificación de tipos/lint/tests (67 fast + 58 PGlite en verde). Sin navegador en este entorno: la verificación visual queda como brecha de cobertura, no como éxito.

**Balance:** 2 bugs de datos, 4 inconsistencias/UX, 3 funciones faltantes que deberían existir, 2 oportunidades de mejora.

---

## Bugs de datos

### TR-B1 — La hoja "Órdenes de compra" del Excel trunca las solicitudes vinculadas de una OC compartida

`buildTrazabilidadConsolidada` recorre `request.orders` y hace `orders.set(order.orderId, order)`. Pero `request.orders` se construye con `buildOrder(group, rowsById)` donde `rowsById` sólo contiene las líneas de **esa** solicitud. El `requestIds` de una OC compartida queda limitado a la solicitud en curso, y al recorrer la siguiente solicitud que comparte la OC, el `set` **sobrescribe** la entrada anterior con un `requestIds` incompleto.

Resultado: en el Excel, la hoja de OCs muestra una sola solicitud vinculada aunque la OC mezcle ítems de varias solicitudes, y la "Solicitudes vinculadas" pierde datos de forma no determinista (gana la última recorrida).

- **Ubicación:** `lib/services/trazabilidad-export.ts:178-186`; contraste con `aggregateConsolidatedRows` que sí deduplica globalmente (`trazabilidad-consolidated-aggregate.ts:187-200`).
- **Corrección:** usar el agregado global (`aggregateConsolidatedRows(...).orders`) para la hoja de OCs, no `request.orders`, o fusionar `requestIds` en el `set` en vez de sobrescribir.

### TR-B2 — "Esperando proveedor" enlaza a `?estado=pedido_proveedor`, que no muestra esas OCs

El KPI "Esperando proveedor" cuenta OCs emitidas con saldo por recibir (`awaitingSupplier`), pero su enlace apunta a `?estado=pedido_proveedor`, que filtra por **estado de ítem** ("Pedido a proveedor"). Un ítem con OC parcialmente recibida ya no está en "pedido_proveedor" (está en "parcialmente recibido"), aunque su OC siga esperando proveedor. El clic en el KPI lleva a un subconjunto distinto al que cuenta el número.

- **Ubicación:** `consolidated-kpis.tsx:70-76`; cálculo en `trazabilidad-consolidated-builder.ts:415-428`.
- **Corrección:** el KPI de OC no tiene un filtro por estado de ítem que lo represente; o se añade un filtro por "OC con saldo", o el enlace debe abrir la vista de OCs (que hoy no existe como filtro).

---

## Inconsistencias y UX

### TR-I1 — Doble presentación: resumen por solicitud + tabla por ítem con paginación por solicitud

La página ahora muestra `ConsolidatedRequestsSummary` (por solicitud) **encima de** `ConsolidatedTable` (por ítem), pero `totalFiltered`/paginación cuentan **solicitudes**. Con varias líneas por solicitud, la tabla muestra más filas de las que anuncia el paginador ("1–25 de N" mientras se ven 40 filas). La migración quedó a medias: se añadió la vista de solicitud sin retirar/transformar la de ítem.

- **Ubicación:** `page.tsx:219-241`; `paginateAggregateRequests` cuenta `requests.length`.
- **Corrección:** completar Task 4/5 — la tabla/accordion debe iterar solicitudes con líneas expandibles, o retirar el resumen duplicado hasta que la tabla sea por solicitud.

### TR-I2 — El `loading.tsx` sigue dibujando 7 skeletons, ya no 4

La migración redujo a 4 KPIs accionables, pero el skeleton de carga mantiene `grid-cols-7` con 7 bloques (`Array.from({length: 7})`). Al llegar los datos la grilla salta de 7 a 4, causando reacomodo visible.

- **Ubicación:** `loading.tsx:20-24`.
- **Corrección:** alinear a 4 bloques y `sm:grid-cols-4`.

### TR-I3 — Estado de OC crudo en el Excel ("sent", "partially_received")

La hoja de OCs exporta `order.orderStatus` crudo (sólo traduce "draft" → "Borrador"). El resto de la app usa `OC_STATE_META` (`components/states/state-badge.tsx`) para etiquetas en español. Un Excel con "partially_office_received" contradice el vocabulario del producto.

- **Ubicación:** `trazabilidad-export-format.ts:199`.
- **Corrección:** mapear con `OC_STATE_META` a label español.

### TR-I4 — El enlace "Buscar por código" no es un input de búsqueda en la pestaña activa

`tabHref("documento")` conserva `codigo` si está en la URL, pero al hacer clic en la pestaña "Buscar por código" desde seguimiento (sin `codigo`), el usuario aterriza en un estado vacío y debe escribir. No es un bug, pero la pestaña no deja claro que es una búsqueda; la ausencia de foco automático en el input obliga a un clic extra.

- **Corrección opcional:** autofocus del input de búsqueda al entrar a la pestaña documento.

---

## Funciones faltantes (deberían existir)

### TR-F1 — Filtro/indicador por "OC con saldo por recibir" (estado de OC, no de ítem)

Los KPIs distinguen "Esperando proveedor" por OC, pero la vista no permite filtrar por ese eje. El usuario no puede responder "¿qué OCs están pendientes de recibir?" desde la pantalla, pese a que el dato ya se calcula (`awaitingSupplier`).

### TR-F2 — Columna de cantidad **recibida en faena vs. entregada** en el resumen por solicitud

`ConsolidatedRequestsSummary` muestra códigos, estado, solicitante y conteos, pero no el avance de cantidades (solicitado → en OC → recibido → entregado → pendiente). Sin eso, el "seguimiento" por solicitud no permite ver de un vistazo qué le falta a cada una; hay que bajar a la tabla de ítems. El DTO ya tiene `quantitiesByUom` listo.

### TR-F3 — Export no incluye el alcance/filtros/fecha de corte en el libro (solo la hoja de advertencias cuando truncado)

`meta` lleva `desde`/`hasta`/`faena`, pero `buildTrazabilidadConsolidadaReportData` **ignora** esos campos salvo `truncado`. Un Excel descargado no dice a qué faena/período corresponde salvo por el contenido. OP-02 lo pedía explícitamente ("añadir al libro el alcance, filtros, fecha de corte").

---

## Oportunidades de mejora

### TR-O1 — `requestIds` y `orders` del resultado de página no se usan en la UI

`getConsolidatedTraceability` devuelve `orders` (página) y cada `ConsolidatedRequest` ya trae `orders`, pero la página no consume `consolidatedData.orders` en ninguna parte. Es código muerto en el contrato público.

### TR-O2 — El resumen por solicitud repite información sin `aria` de conteo

Las tarjetas del resumen no exponen el avance ni el pendiente de forma estructurada para lectores de pantalla (sólo texto corrido). Un `aria-label` o `<dl>` con cantidades mejoraría accesibilidad, alineado con la tabla que sí tiene caption.

---

## Lo que sí está bien

- Los 8 bugs de la auditoría previa están corregidos y con regresión (TR-09/10, TR-02/06, TR-03/04/05, TR-01/08, UI-02/03, OP-04).
- Permisos y alcance por faena coherentes en consolidado, export, detalle e historial.
- KPIs reducidos a 4 accionables (A1) con secundarios en fila compacta.
- Filtros persistentes entre pestañas (OP-06).
- Export multi-hoja con deduplicación parcial de OCs (pendiente el fix TR-B1 para la hoja compartida).

**Prioridad:** TR-B1 y TR-B2 (datos), luego TR-I1/TR-I2 (consistencia visible), luego TR-F1/TR-F2/TR-F3 (funciones faltantes), y finalmente las oportunidades.
