# Flujo OC → recepción: corrección del estado bloqueante y del siguiente paso

**Fecha:** 2026-07-30
**Módulo:** Adquisiciones (compras + recepción)

## Problema

El flujo real del negocio es:

```
Solicitud (prevencionista de faena)
  → Aprobación (secretaria) ─── define vía: por oficina | directo a faena
  → Generar OC → Emitir orden → Marcar como enviada   (el correo al proveedor se manda a mano)
  → [Factura: se adjunta cuando llega. No bloquea nada.]
  → Recepción ─ por oficina:   oficina (parcial → total) → faena (parcial → total)
              └ directo faena: faena (parcial → total)
  → Recibida → Cerrar orden (con advertencias de conciliación)
```

El código ya modela ese flujo, con dos defectos que lo hacen impracticable:

1. **`supplier_confirmed` es un callejón sin salida.** `registerReceipt` sólo acepta
   `sent`, `partially_office_received`, `office_received`, `partially_received`
   (`lib/services/receiving.ts:72`), y `RECEIVABLE_ORDER_STATUSES` repite ese conjunto.
   Al pulsar "Confirmada por proveedor" la OC sale de `sent` y ya no se puede recibir
   nunca: desaparece de `/recepcion` y sólo queda cerrarla a mano. La cola de pendientes
   agrava el engaño mostrando "Registra la recepción cuando lleguen los ítems" para ese
   mismo estado (`lib/work-queue-builders.ts`).
2. **El siguiente paso no está a la vista donde se decide.** El texto existe
   (`ocNextAction`) y se muestra en el panel de seguimiento, pero para `sent` dice
   "Confirma la recepción del proveedor o registra la llegada a oficina" — empuja al
   camino roto — y nunca ofrece el enlace a registrar la recepción.

## Decisiones

- La factura **empuja, no bloquea**: no es requisito para recepcionar ni para cerrar.
  Sigue siendo carril paralelo que alimenta las advertencias de conciliación al cierre.
- `supplier_confirmed` **se elimina del flujo**.
- Emitir y enviar se mantienen como dos pasos manuales (así opera hoy el negocio).
- El monto de una factura con líneas **se guarda como la suma neta de las líneas**
  (comportamiento actual del servicio). La UI debe mostrar ese mismo número, no el total
  con IVA del documento, para que formulario y base coincidan.

## Alcance

### 1. Monto de factura coherente con lo que se persiste

La auditoría de la factura registra el monto persistido, no el enviado por el cliente.

`createPurchaseOrderInvoice` recalcula `amount` como la suma de subtotales cuando la
factura trae líneas. El formulario debe mostrar exactamente eso: cuando hay líneas, el
campo "Monto total" es la suma derivada y queda de sólo lectura; el total extraído del
documento se usa **sólo** cuando la extracción no produjo líneas.

### 2. Eliminar `supplier_confirmed`

Se retira de todo camino ejecutable:

- `confirmOrder` (servicio) y `confirmOrderAction` (server action).
- El botón "Confirmada por proveedor" y su estado en `oc-actions.tsx`.
- Conjuntos de estados: ítems editables (`EDITABLE_ITEM_ORDER_STATUSES` queda en
  `["sent"]`), facturación permitida, acciones visibles en la página de la OC, filtro de
  reportes, conjuntos de "OC en curso" de analítica y snapshots.
- Cerrables pasa a ser el conjunto de etapas de recepción
  (`partially_office_received`, `office_received`, `partially_received`, `received`):
  antes `office_received` no era cerrable y su única salida era el estado retirado, así
  que una entrega incompleta en oficina quedaba sin cierre posible. Desde `sent`, sin
  nada recibido, la salida sigue siendo anular.
- Textos de `ocNextAction` / `ocCurrentStage`.

Se estrecha además el CHECK `purchase_orders_status_valid` para que ninguna escritura
futura pueda producir el estado.

Se conserva a propósito:

- La etiqueta en `state-badge.tsx`: el historial de estados guarda transiciones
  `supplier_confirmed` de OCs pasadas y debe seguir renderizando un nombre legible.

### 3. Migración de datos

Las OCs que hoy estén en `supplier_confirmed` pasan a `sent` y quedan recibibles otra
vez. Cada fila corregida deja un registro en `status_history`
(`from_status = 'supplier_confirmed'`, `to_status = 'sent'`, `changed_by = NULL`,
`reason` explicando la corrección de flujo). Idempotente: si no hay filas, no hace nada.

### 4. Siguiente paso accionable

Se corrigen los textos de `ocNextAction` (sin mención a confirmar) y `OcReceptionCta`
—hasta ahora sólo para faena— pasa a cubrir las dos etapas, con enlace a
`/recepcion/nueva?oc=<id>`:

| Estado | Texto | CTA |
|---|---|---|
| Borrador | Emite la orden para poder enviarla al proveedor. | — |
| Emitida | Marca la orden como enviada al proveedor. | — |
| Enviada (por oficina) | Registra la llegada a oficina cuando lleguen los ítems. | Registrar llegada a oficina |
| Enviada (directo faena) | Registra la recepción en faena cuando lleguen los ítems. | Recepcionar en faena |
| Oficina parcial | Completa la llegada a oficina del saldo pendiente. | Registrar llegada a oficina |
| Oficina total | Despacha los ítems a faena para completar la recepción. | Recepcionar en faena |
| Faena parcial | Registra la recepción del saldo pendiente en faena. | Recepcionar en faena |
| Recibida | Orden recibida completamente. Ciérrala para archivarla. | — |

El saldo pendiente de faena se mide contra la cantidad pedida en las OC
`directo_faena` (antes se medía contra lo recibido en oficina, que en esa vía es siempre
0, así que el CTA nunca aparecía).

El CTA sólo aparece con el permiso de recepción correspondiente
(`receiving:register_office` / `receiving:register_faena`) y respetando el
`deliveryMode` de la OC; sin permiso queda el texto solo, para que quien compra sepa qué
falta aunque lo ejecute la faena.

### 5. Fuera de alcance

Aprobación, elección de vía de entrega, permisos por rol (el prevencionista de faena
sigue sin acceso a compras y recepciona desde `/recepcion`), y el envío automático de
correo al proveedor.

## Verificación

- E2E camino completo: enviada → oficina parcial → oficina total → faena parcial →
  faena total → recibida → cerrada, comprobando el estado y el siguiente paso en cada
  tramo.
- E2E de regresión: la OC no ofrece "Confirmada por proveedor".
- Unit: `isOrderItemsEditable` rechaza el estado eliminado; la extracción de factura con
  líneas deja el monto en la suma neta.
- Gates del repo: `tsc --noEmit`, eslint focal, vitest de los módulos tocados,
  `db:verify-migrations`.
