# Revisión del flujo de OC con foco en repuestos y su cruce con Control operacional

**Fecha:** 2026-11-07 · **Alcance:** lectura de código (solicitudes, aprobaciones, compras, recepción, mantención/OT, control operacional) y consultas de sólo lectura a `bodega_dev` (clon de producción del 2026-11-02 con datos `mock-*`). No se tocó producción. No es una auditoría de navegador: no se recorrió la app.

## 1. Diagnóstico en una frase

El flujo de repuestos está construido como «solicitud con cotizaciones» (igual que servicios) y vive aislado del activo y de la orden de trabajo: la solicitud no sabe a qué vehículo va, la OC tampoco, la OT no sabe que se compró algo, y Control operacional mide el costo de mantención con un número que el jefe escribe a mano en la OT. En datos, el flujo nunca se ha usado: las 5 solicitudes de repuestos que existen son de demostración.

## 2. Cómo funciona hoy (fuente de verdad)

| Paso | Dónde | Qué hace |
|---|---|---|
| Borrador | `lib/requests/request-service-module/persist-draft.ts`, `app/(app)/solicitudes/item-editor-equipment.tsx` | Ítems siempre de texto libre (`productNameFree`). «Equipo, Patente, Marca, Modelo, N° de parte» se guardan como `request_item_attributes` (`lib/validation/repuestos.ts`, `REPUESTO_ATTRIBUTE_NAMES`). `deliveryMode` nace `via_oficina`. |
| Cotizaciones | `repuesto_quotations` (`db/schema/repuestos.ts`) | PDF/imagen + total + proveedor (catálogo o libre). |
| Envío | `submit-request.ts` | Exige ≥1 cotización; con menos de 3, justificación en notas. |
| Aprobación | `select-quotation.ts` (`repuestos:approve`) | Elegir la oferta ganadora aprueba **todos** los ítems `requested` con ese proveedor y guarda `awardedQuotationId/Total` (COT-001). Justificación obligatoria si no es la más barata (COT-002). Excluida de la cola por ítem de `/aprobaciones` (UX-5). |
| OC | `purchasing-module/purchase-orders-create.ts`, `app/(app)/compras/oc-form.helpers.ts` | Precio prefijado sólo si la oferta cubría una línea; con varias, «reparte el precio tú». La OC hereda `costCenterId` y `deliveryMode` de la solicitud. |
| Emisión | `purchase-orders-status.ts` (`issueAndSendOrder`) | `draft → sent`. La plataforma no envía nada: registra contacto del proveedor y constancia declarada (OC-002). No hay PDF de OC. |
| Recepción | `lib/services/receiving.ts:391`, `item-state-module/receiving.ts:50` | Sin `productId` no hay stock ni kardex; el ítem pasa directo a `delivered`. Se avisa al solicitante (F-7). |

Del lado de mantención:

- `mant_work_orders.total_cost` es un campo manual y opcional de «Nueva OT» («Mano de obra y repuestos de la OT. Se usa para el costo total por equipo», `components/mantencion/jefatura/ot/new-ot-sheet.tsx:247`).
- `mant_record_parts` (lo que el mecánico declara haber usado) es cantidad + descripción libre, sin producto, stock ni compra.
- No existe ninguna referencia a `purchase_*` en `lib/services/mantencion` ni en `db/schema/mantencion-*.ts`.
- Control operacional (`lib/services/operational-control.ts`) calcula `maintenanceCost` por activo como `SUM(total_cost)` de OT cerradas en el período (`work-orders/metrics.ts:148`) y `totalCost = combustible facturado + maintenanceCost`.

## 3. Hallazgos

### A. Vínculo con el activo y con la OT (lo que no cruza con Control operacional)

1. **El ítem de repuesto no apunta al vehículo.** `purchase_request_items.equipment_id` referencia `service_equipment` (monogás, alcotest), no `fuel_vehicles`. Para repuestos, patente/equipo son texto libre sin lookup (ninguna referencia a `fuelVehicles` en `app/(app)/solicitudes`). Nadie puede responder «qué repuestos se compraron para la KA-63». El patrón para hacerlo ya existe para instrumentos (`lib/services/service-equipment-history.ts`).
2. **La OC tampoco lleva vehículo ni OT.** `purchase_orders` sólo conoce faena, proveedor y centro de costo.
3. **El costo de mantención por equipo es un número tipeado.** Las OC de repuestos no alimentan `maintenanceCost`. Si el jefe copia el monto de la OC en la OT, la misma plata aparece en Finanzas (OC) y en Control operacional (OT) sin relación; si no la copia, el costo por equipo queda en cero. La OT no muestra el costo salvo a quien puede descargar el PDF (`ot-aside.tsx:129`).
4. **La OT no sabe que hay un repuesto en camino.** No hay estado «esperando repuesto», ni cruce entre `purchase_orders.estimated_delivery` y `mant_work_orders.estimated_delivery_date`. «Requiere atención» cuenta detenidos, documentos y OT abiertas, pero no «detenido esperando repuesto» ni «OC de repuesto atrasada».
5. **Lo declarado no se cruza con lo comprado.** `mant_record_parts` y el motivo «Falta repuesto» de la pauta preventiva (`components/mantencion/app/step-pauta.tsx:14`, guardado en `mant_record_items.reason`) no generan ninguna solicitud ni señal.
6. **La ficha del equipo no tiene compras.** `lib/services/mantencion/equipment-history.ts` y `/mantencion/equipos/[id]` no consultan `purchase_*`.

### B. El flujo de compra en sí

7. **Nunca se ha usado.** En `bodega_dev`: 5 solicitudes de repuestos, todas «de demostración»; OC activas: 50 de EPP y 3 de «otro», ninguna de repuestos. Los repuestos reales se compran fuera del sistema o entran como costo manual en la OT.
8. **Quien necesita el repuesto no puede pedirlo.** `repuestos:create` sólo lo tienen administrador, secretaria, prevencionista, solicitante_faena y prevencionista_faena (`modules/repuestos/manifest.ts`). Ningún rol de mantención (jefe_mantencion, supervisor_mantencion, mecanico, admin_contrato) puede crear ni aprobar.
9. **Cotizar antes de enviar, sin umbral.** Un filtro de $20.000 y un motor de $8.000.000 exigen lo mismo. La urgencia «crítica» sólo ordena la cola (`pending-purchase-queue.ts`), no abre una vía rápida.
10. **Aprobación todo-o-nada.** `selectQuotation` aprueba todos los ítems con el proveedor ganador; no se puede rechazar un ítem, ajustar cantidad ni separar proveedores.
11. **La OC no enlaza la cotización.** `app/(app)/compras/[id]` no muestra ni enlaza el archivo adjudicado; no hay alerta si el total de la OC supera el total adjudicado.
12. **Centro de costo muerto (todos los tipos).** Ningún código asigna `purchase_requests.cost_center_id` (sólo facturación usa centros de costo). En `bodega_dev`: 0 de 73 solicitudes y 0 de 57 OC lo tienen. Cualquier reporte de compras por centro de costo está vacío.
13. **Sin catálogo ni historial de precios.** Los repuestos no entran a `products`, por lo que no tienen `product_supplier_prices` ni `product_price_history`; el N° de parte se reescribe cada vez. La conciliación de facturas matchea por nombre normalizado (`invoice-item-matching.ts`), frágil con texto libre.
14. **Recepción sin custodia.** Sin stock ni entrega, nadie registra que el repuesto llegó al mecánico ni que se instaló. Se notifica al solicitante, no a mantención.
15. **Despacho por oficina por defecto.** `via_oficina` agrega la etapa oficina→faena a un repuesto que debería ir al taller; para repuestos la jefatura no confirma despacho al aprobar (sólo EPP, `canSetDispatch`).
16. **Fecha requerida sin seguimiento.** `requiredDate` no dispara recordatorios (`deadline-reminders.ts` no la mira) y nada alerta por `estimated_delivery` vencida.
17. **Tabla huérfana.** `quotations` en `db/schema/purchasing.ts:144` (cotizaciones a nivel de OC) no tiene lecturas ni escrituras; convive con `repuesto_quotations` y `service_quotations`.

## 4. Recomendaciones, en orden

1. **Decidir de dónde nace la solicitud de repuesto.** Propuesta: desde la OT (botón «Pedir repuestos» que precarga vehículo, faena y OT) y desde la correctiva de la app cuando se marca «Falta repuesto». Es donde está el contexto y quien sabe qué pedir.
2. **Modelo:** agregar `vehicle_id` (FK `fuel_vehicles`) y `work_order_id` (FK `mant_work_orders`) al ítem de solicitud, con selector de equipo de flota en lugar de patente libre; dar `repuestos:create` a jefe_mantencion/supervisor_mantencion/mecanico y `repuestos:approve` a jefe_mantencion bajo un umbral de monto (la jefa aprueba sobre el umbral).
3. **Control operacional:** sumar `purchase_order_items.subtotal` de OC no anuladas por vehículo en el período (misma ventana que `maintenanceCostInPeriod`); la OT muestra «Repuestos pedidos: OC-2026-0012, llega el 12-11». Reinterpretar `total_cost` como mano de obra/taller externo para no duplicar, o retirarlo.
4. **Umbral de cotizaciones por monto** y vía rápida para urgencia crítica con equipo detenido (proveedor habitual + justificación).
5. **Catálogo mínimo de repuestos** (producto con N° de parte, marca/modelo aplicable), creable desde el ítem al armar la OC, para historial de precio y conciliación.
6. **Centro de costo:** asignarlo (por faena/contrato) o retirarlo del esquema de compras.
7. **Recepción:** repuestos `directo_faena` por defecto y cierre con «entregado al mecánico / instalado» firmado en la app.
8. **Seguimiento:** tile en «Requiere atención» para OC de repuesto atrasada y recordatorio por `requiredDate`.

## 5. Límites de esta revisión

- `bodega_dev` está atrasada en migraciones (no tiene `mant_work_orders.total_cost`), así que no se pudo medir cuántas OT llevan costo cargado. Producción no se consultó.
- No se ejecutó recorrido de navegador ni pruebas; es análisis de código y de datos.
