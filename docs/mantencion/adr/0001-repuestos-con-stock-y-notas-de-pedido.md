# ADR 0001 · Repuestos con stock por faena y notas de pedido del mecánico

- **Estado:** aceptada (2026-11-26).
- **Revierte:**
  - la decisión 1 («consumo directo») de `docs/superpowers/plans/2026-11-09-catalogo-repuestos.md`;
  - las decisiones 5 y 8 de `docs/superpowers/plans/2026-11-07-repuestos-vinculados.md`, en lo que dicen sobre quién pide y sobre dónde se declara lo usado.
- **Planes:**
  - el original, `docs/mantencion/plan-notas-de-pedido-mantencion.md`;
  - el de ejecución, que corrige al original y reparte el trabajo en líneas paralelas.

## Contexto

Hasta ahora un repuesto de catálogo pasaba directo de la recepción al estado `delivered` y nunca entraba a stock. Lo usado se declaraba en el registro como texto libre. Por eso no había forma de saber qué repuesto estaba en la bodega de una faena, para qué OT se había comprado ni si se usó.

## Decisión

1. **D1.** Todo repuesto de catálogo recibido entra al stock de la faena (`ingreso_oc`), con o sin OT. Los servicios siguen sin stock.
2. **D2.** El mecánico pide con una **nota de pedido** (`NP-AAAA-NNNN`) atada a su OT, y jefatura resuelve cada línea:
   - desde el stock de la faena;
   - comprando, con una solicitud de repuestos que apunta a la línea por `purchase_request_items.parts_note_item_id`;
   - o rechazando, con motivo.
3. **D3.** Revisan las NP `jefe_mantencion`, `supervisor_mantencion`, `admin_contrato` y `administrador`, en sus faenas (`mant:np:manage`).
4. **D4.** Una línea de solicitud con OT o con NP debe estar catalogada antes de emitir la OC.
5. **D5.** Lo que llega a la faena para una OT queda **reservado** para ella (`mant_parts_allocations`). Al cerrar o anular la OT, lo no usado pasa a stock libre.
6. **D6.** El registro del mecánico **nunca se rechaza por falta de stock**. La línea queda `pendiente_conciliar` y se concilia después.
7. **D7.** Las preventivas (filtros y aceites de la pauta) quedan fuera de esta fase.
8. **D8.** Un repuesto no se entrega, devuelve ni retira a un trabajador. Su única salida operativa es el consumo en una OT (`egreso_mantencion`). Lo impone el motor de stock.
9. **D9.** La foto por línea de NP queda para una fase siguiente.
10. **D10.** El ítem de solicitud pasa a `delivered` al llegar a faena, como hasta ahora: para Compras el ciclo termina ahí. El consumo se sigue en la reserva y el kárdex.
11. **D11.** Por la vía oficina, el repuesto entra al stock de oficina y viaja en guía. La reserva nace al despachar la guía.
12. **D12.** Una línea `source=stock` exige que el registro esté enlazado a una OT.
13. **D13** (2026-11-26, hallazgo NP4-7). Al cerrar (conformidad) o anular una OT, las líneas `pendiente` de sus NP abiertas se **rechazan solas**, en la misma transacción, con el motivo:
    - al cerrar: «La orden de trabajo se cerró antes de resolver esta línea.»;
    - al anular: «La orden de trabajo se anuló: <motivo de la anulación>».

    Lo ya resuelto (`desde_stock`, `en_compra`, `rechazada`) no cambia y no se avisa al mecánico: el cierre o la anulación ya lo avisan. Reabrir la OT no revive esas líneas; el mecánico pide con una nota nueva. Una línea `en_compra` cuya compra se cancela con la OT ya terminada también se rechaza, en vez de volver a `pendiente`. La auditoría marca estos rechazos con `automatic: true` y su causa (`ot_cerrada` u `ot_anulada`).

## Reglas de integridad

Viven en el código; ver la cabecera de `lib/services/mantencion/parts/allocations.ts` y `lib/services/stock-reservations.ts`.

- **Una reserva activa por (OT, faena, producto).** Sus aportes y rebajas quedan en `mant_parts_allocation_sources`.
- **Cálculos:**
  - consumido = Σ de las líneas `descontado` de la reserva;
  - restante = `activa` ? max(0, cantidad − consumido) : 0;
  - libre = stock − Σ restante.
  - No hay columna de «reservado» en `worksite_stock`.
- **Mutex:** la fila (faena, producto) de `worksite_stock`.
- **Orden global de bloqueo:** equipo → OT → faena → filas de stock por `product_id` → reservas.
- **NP y su OT:** toda escritura sobre las líneas de una NP toma antes la OT `FOR SHARE` (`lockWorkOrdersShare`); la transición que cierra o anula la OT la toma `FOR UPDATE` y después las NP y sus líneas (`FOR NO KEY UPDATE`, por id). Así el rechazo automático de D13 no se cruza con un rechazo, una anulación de nota o una solicitud de repuestos en curso. `voidPartsNote` (nota → líneas) y `rejectNoteItem` (línea → nota) siguen bloqueando la nota y la línea en orden inverso: si chocan, Postgres aborta una y el usuario reintenta.
- **Salidas que no son consumo** (desecho, traslado, anulaciones): no se comen lo reservado. El ajuste sí puede, y rebaja reservas. Esa rebaja queda en `mant_parts_allocation_sources` (origen `ajuste`, con el motivo y el folio del ajuste) y en la auditoría, pero **no** escribe evento en la OT ni avisa: tomaría un bloqueo sobre la OT después del de stock y rompería el orden global. La sección «Repuestos» de la OT la muestra desde los orígenes.
- **Cantidades** en centésimas, porque el stock es `real` (float4).
- **Bloqueos entre productos de una misma bodega:** la recepción bloquea primero las filas de los repuestos y después las de los demás productos en el orden de los ítems; el despacho de una guía, en el orden de sus ítems. Dos transacciones cruzadas pueden chocar: Postgres aborta una (no hay corrupción) y el usuario reintenta. El riesgo ya existía entre productos comunes.
- **Kárdex:** el consumo apunta al registro (`referenceType: mant_record`) y su reverso también (`mant_record_void`). La línea se enlaza por `inventory_movement_id`.

## Consecuencias

- El despliegue exige un **inventario de arranque**: los repuestos que hoy están físicamente en las faenas nunca entraron a stock. Se cargan con ajuste o conteo físico el día del corte. No hay backfill automático.
- La recepción con stock no puede llegar a producción sin el consumo desde el registro: si llega sola, el stock de repuestos sólo crece.
- Hay que desplegar el servidor antes que la nueva versión de la PWA: un servidor viejo descarta en silencio los campos nuevos del registro.
