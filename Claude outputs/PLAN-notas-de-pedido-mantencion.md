# Notas de pedido de repuestos (app de mantención → OT → stock en faena → consumo) — Plan

**Objetivo:** que el mecánico cree desde la app de mantención una **nota de pedido (NP)** de repuestos atada a una **OT**; que lo pedido, al llegar a la faena, quede como **stock** reservado para esa OT; que ese stock se **descuente** cuando el mecánico declare el repuesto usado en su registro; y que toda la cadena sea **trazable** (NP → solicitud → OC → recepción → kárdex → registro → OT).

**Base:** repositorio `bodega` (Next.js 16, Drizzle/Postgres, PWA del mecánico en `/m/mantencion`). Revisión hecha en solo lectura el 2026-11-25 sobre `HEAD 9569ed485`.

---

## 1. Qué existe hoy (evidencia)

| Pieza | Estado | Evidencia |
|---|---|---|
| Solicitud de repuestos vinculada a vehículo y OT | ✅ Existe. `purchase_request_items.vehicle_id`, `work_order_id`, `estimated_unit_price`; CHECK «OT exige vehículo». | `db/migrations/0378_repuestos_vehiculo_ot.sql:1-9`, `db/schema/requests.ts:155` |
| Quién crea solicitudes de repuestos | Jefe/supervisor de mantención, admin. de contrato (web). **El mecánico no.** | `docs/superpowers/plans/2026-11-07-repuestos-vinculados.md:23`; `modules/repuestos/manifest.ts` (sin grants a `mecanico`) |
| «Repuestos pedidos» y «esperando repuesto» en la OT | ✅ Lectura derivada de solicitudes/OC. La OT no guarda repuestos. | `lib/services/mantencion/work-orders/parts-requests.ts:9-23, 34-37, 57-65, 90-156` |
| Aviso a mantención cuando llega a faena | ✅ Por OT, sólo recepción completa en faena. | `lib/services/receiving.ts:384-400` |
| Catálogo de repuestos | ✅ `products.is_spare_part`, `part_number`, `part_brand`; Compras cataloga al armar la OC (opcional). | `docs/superpowers/plans/2026-11-09-catalogo-repuestos.md:13-35`; `lib/services/purchasing-module/spare-part-item-link.ts:112` |
| **Ingreso a stock al recibir repuestos** | ❌ **Decisión 2026-11-09: «consumo directo»**. Repuesto de catálogo y texto libre **no** entran a stock; el ítem pasa directo a `delivered`. | `lib/services/receiving.ts:416-427`; `lib/services/item-state-module/receiving.ts:46-54`; `lib/services/receiving-void.ts:152` |
| Declaración de repuestos usados | ⚠️ El mecánico los declara por trabajo en la correctiva, **texto libre** (`quantity`, `description`), sin producto ni movimiento de stock. | `db/schema/mantencion-records.ts:174-186`; `lib/mantencion/contracts.ts:124-135`; `lib/services/mantencion/records-create.ts:286-290`; `components/mantencion/app/trabajo-jobs.tsx:98-118` |
| Egreso de stock por mantención | ❌ Existió (`egreso_mantencion`, MNT-002) y **se eliminó** con la tabla legada `maintenance_parts`. El CHECK vigente no lo admite. | `db/migrations/0277_mnt002_maintenance_part_stock.sql`; `db/migrations/0368_drop_legacy_maintenance.sql:21-29`; `db/schema/stock.ts:45-47` |
| Motor único de stock | ✅ `applyMovementTx` bloquea fila (`FOR UPDATE`) y no permite negativos. | `lib/services/stock-movement.ts:1-4, 261-456`; `db/schema/stock.ts:23, 48-51` |
| Sincronización idempotente desde el teléfono | ✅ Patrón `client_op_id` + Bearer de dispositivo, reintentos seguros, rechazos legibles 409/422. | `lib/services/mantencion/work-orders/sync-ops.ts:14-27`; `lib/services/mantencion/sync-auth.ts:9-17`; `app/api/mantencion/sync/observaciones/route.ts` (plantilla mínima) |
| Permisos del mecánico | `mant:app:use`, `mant:records:view_own`, `mant:ot:execute`. | `modules/mantencion-equipos/manifest.ts:123-124, 169` |
| Registro ↔ OT | ✅ `mant_records.work_order_id` (FK). Además queda una columna legada de texto `mant_record_correctives.work_order`. | `db/schema/mantencion-records.ts:63, 146` |

## 2. Brechas frente a lo pedido

1. **No hay nota de pedido del mecánico.** Nada en la app ni en el modelo; el mecánico no tiene permisos de repuestos (decisión 5 del 2026-11-07).
2. **Lo recibido no queda como stock** (decisión 2026-11-09). Contradice el requisito; hay que revertirla de forma explícita.
3. **El consumo no descuenta**: `mant_record_parts` es texto libre y no existe tipo de movimiento de egreso por mantención.
4. **La trazabilidad está cortada** en dos puntos: no hay origen «NP del mecánico» antes de la solicitud, y no hay vínculo línea de registro ↔ producto ↔ movimiento de kárdex después de la recepción.
5. **Texto libre en la OC**: un ítem sin `product_id` nunca puede ser stock (`item-state-module/receiving.ts:52`).

## 3. Decisiones (a confirmar; marco mi recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Revertir «consumo directo» del 2026-11-09 | **Sí, para todo repuesto de catálogo recibido en faena** (con o sin OT). Una sola regla; lo comprado sin OT queda como stock libre y se consume contra una OT al usarlo. Servicios siguen sin stock. |
| D2 | ¿La NP es una solicitud de compra o un documento propio? | **Documento propio (`NP-NNNN`) revisado por jefatura.** Razones: (a) el mecánico no puede cumplir la regla de cotizaciones/umbral de la solicitud; (b) una línea puede resolverse **desde stock existente** sin comprar; (c) no toca estados ni colas de `purchase_requests`. |
| D3 | Quién revisa la NP | `jefe_mantencion`, `supervisor_mantencion`, `admin_contrato`, `administrador` (los mismos que hoy crean solicitudes de repuestos), con alcance de faena. |
| D4 | Catalogación | **Obligatoria antes de emitir la OC** para toda línea de repuestos que venga de una NP o tenga `work_order_id`. Si no, no hay producto y no hay stock. |
| D5 | Reserva por OT | **Sí, automática**: al recibir en faena una línea con OT, ese stock queda reservado para esa OT. Al cerrar/anular la OT, lo no usado se libera a stock libre con evento. |
| D6 | Stock insuficiente al sincronizar un registro hecho offline | **Nunca rechazar el registro.** La línea queda «Pendiente de conciliar», se avisa a bodega/jefatura y se resuelve con ajuste trazable. |
| D7 | Preventivas (filtros, aceites de pauta) | **Fuera de esta fase.** Se diseña el modelo para admitirlas (mismo egreso) en una fase 2. |
| D8 | Entrega de repuestos a trabajadores desde Bodega | **Bloquear** `egreso_entrega` para `is_spare_part`: el único egreso operativo de un repuesto es el consumo en una OT (o desecho/ajuste con motivo). |

## 4. Flujo objetivo

```
Mecánico (app, offline OK)                Jefatura (web)                    Compras / Bodega faena
──────────────────────────               ─────────────────                ────────────────────────
OT asignada → «Pedir repuestos»
  NP-0123 (líneas, cant., foto opc.) ──▶ Bandeja «Notas de pedido»
                                          por línea:
                                          • Desde stock de la faena ───────▶ Reserva OT (sin compra)
                                          • Comprar ─▶ Solicitud REP (precargada, origen NP)
                                                        → cotización/umbral/aprobación (flujo actual)
                                                        → OC (repuesto catalogado, D4) ─────▶ Recepción en faena
                                                                                              ingreso_oc + Reserva OT
                                          • Rechazar (motivo) ─▶ aviso al mecánico
App: «Llegó · 2 disponibles para esta OT»
Registro correctiva → trabajo → toca el repuesto reservado (cant.)
  sync ─▶ egreso_mantencion (kárdex, ref. línea del registro) ─▶ consumo visible en OT, NP, bodega
OT cerrada/anulada ─▶ saldo reservado liberado (evento + auditoría)
```

**Estados de la NP** (cabecera, derivados de sus líneas): `enviada` → `en_gestion` → `cerrada` | `anulada`.
**Estados de la línea NP:** `pendiente` → `desde_stock` | `en_compra` | `rechazada`; avance visible: pedido → aprobado → en OC → llegó a faena (n/m) → usado (n/m).
Los estados de la solicitud/OC no cambian; para repuestos, `received` pasa a significar «en stock de la faena» y `partially_delivered`/`delivered` «consumido parcial/total» (hoy esos estados existen y no se usan para repuestos).

## 5. Modelo de datos

Todas las tablas nuevas en un archivo de esquema nuevo `db/schema/mantencion-parts.ts` (≤300 líneas).

### 5.1 `mant_parts_notes` (nueva)
`id`, `code` (`NP-NNNN` con `nextCodeTx`, verificar que el prefijo no choque en `lib/code-sequences.ts`), `work_order_id` NOT NULL FK `mant_work_orders` (restrict), `vehicle_id` NOT NULL, `worksite_id` NOT NULL (copia de la OT), `requested_by_user_id` NOT NULL, `device_id`, `client_op_id` UNIQUE (idempotencia), `equipment_stopped` boolean, `notes`, `status`, `reviewed_by_user_id`, `reviewed_at`, `voided_*`, `created_at`, `updated_at`.
CHECKs: estado canónico; anulación completa o nula (como `mant_work_orders_void_valid`). Índices: `(work_order_id)`, `(worksite_id, status)`.

### 5.2 `mant_parts_note_items` (nueva)
`id`, `note_id` FK cascade, `description` (≥3), `quantity` > 0, `unit_of_measure`, `part_number` nullable, `product_id` nullable FK `products` (si el mecánico o jefatura lo eligió del catálogo), `photo_id` nullable (reutilizar el almacenamiento de fotos de mantención), `resolution` (`pendiente|desde_stock|en_compra|rechazada`), `resolution_reason`, `resolved_by_user_id`, `resolved_at`, `sort_order`.
CHECK: `rechazada` exige motivo; `desde_stock` exige `product_id`.

### 5.3 `purchase_request_items.parts_note_item_id` (columna nueva)
FK nullable a `mant_parts_note_items` (set null), índice. **Se copia en el split parcial** de `lib/services/purchasing-module/purchase-orders-create.ts` igual que `vehicle_id`/`work_order_id`. CHECK: `parts_note_item_id IS NULL OR work_order_id IS NOT NULL`.

### 5.4 `mant_parts_allocations` (nueva) — reserva por OT
`id`, `work_order_id`, `worksite_id`, `product_id`, `quantity` > 0, `source` (`recepcion|stock_existente|traslado`), `note_item_id` nullable, `request_item_id` nullable, `receipt_id` nullable, `status` (`activa|liberada`), `released_quantity`, `released_by_user_id`, `released_at`, `release_reason`, `created_by_user_id`, `created_at`.
- **Disponible para la OT** = Σ `quantity − released_quantity` − Σ consumos `stock` de esa OT/producto/faena.
- **Stock libre de la faena** = `worksite_stock.quantity` − Σ disponible reservado de OT abiertas.
- Sin columna de «reservado» en `worksite_stock`: se calcula, así no hay dos verdades.

### 5.5 `mant_record_parts` (columnas nuevas)
`product_id` nullable FK, `source` (`stock|externo|texto`) default `texto` para filas previas, `allocation_id` nullable, `inventory_movement_id` nullable UNIQUE, `stock_status` (`descontado|pendiente_conciliar|no_aplica`).
CHECK: `source = 'stock'` exige `product_id`; `descontado` exige `inventory_movement_id`.

### 5.6 Kárdex y eventos
- `inventory_movements_type_valid` + `MovementType` (`lib/services/stock-movement.ts:14-24`): volver a agregar **`egreso_mantencion`** (`referenceType: 'mant_record_part'`). Reverso con `ingreso_anulacion` (`referenceType: 'mant_record_part_reversal'`).
- `mant_work_order_events_type_valid` (`db/schema/mantencion-work-orders.ts:235`): `parts_note_created`, `parts_note_resolved`, `parts_allocated`, `parts_consumed`, `parts_released`.
- Etiquetas en `app/(app)/bodega/movement-labels.ts` y `lib/work-queue-labels.ts` (nunca enum crudo).
- **Migración:** cambiar un CHECK obliga a `DROP CONSTRAINT IF EXISTS` + `ADD` (patrón de `0368_drop_legacy_maintenance.sql:25-29`). Generar con `npm run db:generate`, ajustar sólo la migración nueva antes de publicarla, `node scripts/verify-migration-chain.mjs --update-checksums`, y confirmar «No schema changes».

## 6. Fases y tareas

Cada tarea: test primero → falla → implementar → pasa → commit. Suites PGlite nuevas registradas en `tests/pglite-files.ts`. RBAC por manifiesto + `GRANT_ADDITIONS` (`lib/auth/bootstrap.ts`) + `npm run db:sync-rbac`; nada de RBAC en migraciones.

### Fase 0 — Cierre de decisiones
- T0.1 Confirmar D1–D8. Registrar ADR en `docs/mantencion/` que **revierte** la decisión 1 de `2026-11-09-catalogo-repuestos.md` y la 8 de `2026-11-07-repuestos-vinculados.md`, y actualizar los comentarios que las citan (`receiving.ts:421-426`, `item-state-module/receiving.ts:46-51`, `parts-requests.ts:11-15`).
- T0.2 Inventario de arranque: listar con jefatura los repuestos que **hoy están físicamente en bodegas de faena** (fueron recibidos como `delivered` y no tienen stock). Se cargan con ajuste trazable o inventario físico (`lib/services/physical-inventory.ts`) el día del corte. Sin backfill automático.

### Fase 1 — Modelo
- T1.1 Esquema y migración de §5 (tablas, columnas, CHECKs, índices, relaciones).
- T1.2 `npm run test:pglite -- schema-consistency`, `db:verify-migrations`.
- Tests PGlite: `rechaza línea desde_stock sin producto`, `rechaza parts_note_item_id sin work_order_id`, `split parcial conserva parts_note_item_id`, `source=stock exige producto`.

### Fase 2 — Servicio NP + API de sincronización + permisos
- T2.1 `lib/services/mantencion/parts-notes/` (nuevo, archivos ≤300 líneas): `create.ts`, `resolve.ts`, `query.ts`, `access.ts`.
  - `createPartsNoteFromDevice(ctx, payload)`: bajo bloqueo de la OT; exige OT en `asignada|en_ejecucion`, asignada al autor (o `mant:ot:manage`), faena dentro del alcance; idempotente por `client_op_id` con la misma regla de `sync-ops.ts:51-60` (mismo autor + misma OT → duplicado; si no → 409); evento `parts_note_created`; `recordAudit`.
- T2.2 Contrato zod en `lib/mantencion/contracts.ts` (`partsNoteSchema`: ≤20 líneas, cantidad > 0, descripción 3–300, foto opcional).
- T2.3 `POST /api/mantencion/sync/notas-pedido` (nuevo, calcado de `app/api/mantencion/sync/observaciones/route.ts`): sólo Bearer, rate limit, interruptor de módulo.
- T2.4 Permisos nuevos en `modules/mantencion-equipos/manifest.ts`: `mant:np:create` (mecánico, jefe y supervisor de mantención), `mant:np:manage` (D3), `mant:np:view_worksite`. Espejo en `GRANT_ADDITIONS`.
- Tests: `una NP repetida con el mismo client_op_id deja una sola NP`, `rechaza NP de una OT cerrada/reasignada con mensaje legible`, `rechaza fuera de faena`, `sin mant:np:create → 403`.

### Fase 3 — App del mecánico: pedir y seguir
- T3.1 Cola offline: tipo de ítem «nota de pedido» en `lib/mantencion/client/queue.ts` (como `newReplyItem`), orden de envío en `queue-order.ts` (la NP antes que el registro que la consume).
- T3.2 `components/mantencion/app/parts-note-sheet.tsx` (nuevo): líneas (cantidad con +/−, descripción, N° de parte opcional, foto opcional con `photo-slot.tsx`), interruptor «Equipo detenido esperando esto», un solo botón «Enviar pedido». Diseño para baja alfabetización digital y conectividad intermitente: guarda en el teléfono primero, avisa «Pedido guardado. Se envía al tener señal».
- T3.3 En `components/mantencion/app/ot-sheet.tsx`: sección «Repuestos» con estado legible por línea («Pedido», «En compra», «Llegó · 2 disponibles», «Usado 1 de 2», «Rechazado: motivo») y acción «Pedir repuestos».
- T3.4 Catálogo sincronizado: agregar a `lib/services/mantencion/catalog.ts` y `lib/mantencion/client/catalog-sync.ts` las NP y las **reservas disponibles** de las OT asignadas al usuario (sólo esas: menos datos, sin fuga de otras faenas).
- Tests de componente y de `flow`: `NP offline queda en cola y se envía al volver la señal`, `muestra «Llegó · n disponibles»`.

### Fase 4 — Jefatura: revisar y resolver
- T4.1 Bandeja «Notas de pedido» bajo Control operacional › Mantención (filtro por faena/estado; «pendientes» por defecto). Sin tile nuevo (regla A1 de máx. 4): conteo dentro del detalle del tile de OT.
- T4.2 Resolver por línea:
  - **Desde stock:** muestra stock libre del producto en la faena de la OT; crea `mant_parts_allocations` (`source=stock_existente`) si alcanza; si no, no deja.
  - **Comprar:** «Crear solicitud» abre `/solicitudes/nueva?tipo=repuestos&np=<id>` precargando faena, vehículo, OT, urgencia (`critical` si equipo detenido) y líneas, extendiendo el prellenado existente de `?ot=` (`app/(app)/solicitudes/nueva/prefill.ts`). Al guardar, cada ítem lleva `parts_note_item_id`. Desde ahí rige el flujo actual (umbral, cotizaciones, aprobación `repuestos:approve`).
  - **Rechazar:** motivo obligatorio; aviso al mecánico vía catálogo de la app.
- T4.3 Sección de la OT (web) unificada: NP + solicitudes/OC (lo que ya lee `parts-requests.ts`) + reservas + consumos, en `components/mantencion/jefatura/ot/ot-sections.tsx`.
- Tests PGlite: `desde_stock no reserva más que el stock libre`, `la solicitud creada desde NP vincula cada ítem a su línea`, `rechazo exige motivo`.

### Fase 5 — Compras y recepción: entra a stock y se reserva
- T5.1 **Catalogación obligatoria (D4):** al emitir la OC (`lib/services/purchasing-module/purchase-orders-status.ts`), una línea de repuestos con `work_order_id` o `parts_note_item_id` sin `product_id` bloquea con «Cataloga el repuesto antes de emitir la OC» (reusar `spare-part-item-link.ts`).
- T5.2 **Revertir consumo directo (D1):**
  - `lib/services/receiving.ts:427`: sólo `isService` se salta; el repuesto emite `ingreso_oc`.
  - `lib/services/item-state-module/receiving.ts:52`: repuesto de catálogo → `received`.
  - `lib/services/receiving-void.ts:152`: el reverso de la recepción emite `egreso_anulacion` también para repuestos.
- T5.3 **Reserva automática:** en la misma transacción de la recepción en faena (y del `ingreso_traslado` en `via_oficina`), por cada línea con `work_order_id` y OT abierta crear `mant_parts_allocations` (`source=recepcion`) por la cantidad recibida. Si la OT ya está cerrada/anulada, queda stock libre (sin reserva).
- T5.4 Ampliar `notifyWorkOrderPartsReceived` (`lib/services/mantencion/work-orders/notifications.ts`) para incluir al autor de la NP; mensaje: «Llegó a faena: {repuesto} · NP-0123 · OT {folio}».
- T5.5 **D8:** en `lib/services/delivery-eligibility.ts`, rechazar entrega a trabajador de productos `is_spare_part`.
- T5.6 Anulación de recepción con stock ya consumido: hoy `applyMovementTx` impide el negativo; el mensaje debe decir qué registro y OT consumieron el repuesto.
- Tests PGlite: `recepción completa en faena de un repuesto con OT crea ingreso_oc y reserva`, `recepción parcial reserva lo recibido`, `OT cerrada → sin reserva`, `anular recepción revierte stock y reserva`, `servicio sigue sin stock`, `no se entrega un repuesto a un trabajador`.

### Fase 6 — Consumo: el registro descuenta
- T6.1 Contrato: `correctiveJobSchema.parts[]` (`lib/mantencion/contracts.ts:130-133`) agrega opcionales `productId`, `allocationId`, `source` (`stock|externo`). Compatibilidad: teléfonos con versión anterior siguen mandando sólo texto (`source=texto`, `no_aplica`).
- T6.2 `lib/services/mantencion/records-create.ts:286-290` (y la validación en `records-create-validate-corrective.ts`): por cada línea `source=stock`, en la misma transacción del registro:
  1. Validar que el producto es repuesto activo y que la reserva (si viene) es de la **misma OT** del registro y del mismo producto.
  2. Descontar de la **faena de la reserva** (no de la faena actual del vehículo; el equipo pudo trasladarse). Sin reserva: faena de la OT.
  3. `applyMovementTx` con `egreso_mantencion`, `referenceType: 'mant_record_part'`; guardar `inventory_movement_id`, `stock_status=descontado`.
  4. Si el stock no alcanza (D6): no se lanza error; la línea queda `pendiente_conciliar`, sin movimiento, y se notifica a quien tenga `mant:np:manage` y a bodega de la faena.
  5. Evento `parts_consumed` en la OT.
- T6.3 Mismo camino para el registro web: `lib/services/mantencion/web-record.ts` y `components/mantencion/jefatura/ot/record/record-step-trabajo.tsx`.
- T6.4 App: en `components/mantencion/app/trabajo-jobs.tsx`, sobre «+ Agregar repuesto», chips «Disponibles para esta OT» (de las reservas sincronizadas). Un toque agrega la línea con producto y cantidad 1 (editable, tope = disponible). «Otro repuesto» mantiene el texto libre con la pregunta «¿Salió de bodega?» (Sí → busca en repuestos de la faena; No → `externo`).
- T6.5 Corrección y anulación del registro (`lib/services/mantencion/record-lifecycle.ts`): anular → `ingreso_anulacion` por cada `descontado`; corregir → reverso de lo quitado + egreso de lo agregado, en una transacción.
- T6.6 Conciliación: acción «Conciliar» sobre una línea `pendiente_conciliar` (cuando ya hay stock, aplica el egreso; o registra un ajuste con motivo vía `registerStockDocumentTx`), con auditoría.
- Tests PGlite: `el registro con repuesto reservado descuenta y enlaza el movimiento`, `dos registros concurrentes sobre el último repuesto: uno descuenta y otro queda pendiente_conciliar`, `registro duplicado (mismo id) no descuenta dos veces`, `reserva de otra OT → 422`, `anular registro repone stock`, `teléfono antiguo sin productId sigue funcionando`.

### Fase 7 — Cierre de OT y liberación
- T7.1 En `lib/services/mantencion/work-orders/transitions.ts`, al pasar a `cerrada` o `anulada`: liberar el saldo de reservas activas (`parts_released`, auditoría). En los diálogos de conformar/anular (`components/mantencion/jefatura/ot/ot-action-dialogs.tsx`) advertir: «Quedan 2 repuestos reservados sin usar; pasarán a stock libre de {faena}».
- T7.2 Liberación manual de una reserva (con motivo) para `mant:np:manage`.
- Tests: `cerrar OT libera el saldo`, `reabrir OT no vuelve a reservar automáticamente`.

### Fase 8 — Trazabilidad y vistas
- T8.1 Cadena navegable en ambos sentidos:
  - Línea NP → ítems de solicitud → línea OC → recepciones → movimientos `ingreso_oc` → reserva → líneas de registro → movimientos `egreso_mantencion`.
  - Desde el kárdex (`app/(app)/bodega/kardex-table.tsx`, `movement-href.ts`): `egreso_mantencion` enlaza al registro y a la OT.
  - Ficha de trazabilidad por producto (`app/(app)/bodega/trazabilidad/[itemId]/page.tsx`) muestra OT/NP de cada egreso.
- T8.2 Stock en Bodega (`app/(app)/bodega/stock-table.tsx`): columnas «Reservado OT» y «Libre» para repuestos.
- T8.3 Exportación de la OT y del kárdex con columnas NP/OT/registro.
- T8.4 Pantalla de «Pendientes de conciliar» (filtro en la bandeja de NP) para que nada quede invisible.

### Fase 9 — E2E y despliegue
- E2E secuencial con estado (Playwright), un solo flujo de punta a punta:
  1. jefatura crea y asigna OT → 2. mecánico (app) crea NP offline y sincroniza → 3. jefatura resuelve una línea «desde stock» y otra «comprar» → 4. solicitud bajo umbral, aprobación → 5. OC con repuesto catalogado (y bloqueo si no lo está) → 6. recepción parcial y luego completa en faena (stock + reserva + aviso) → 7. mecánico registra correctiva usando la reserva → 8. kárdex muestra `egreso_mantencion` enlazado → 9. anular el registro repone stock → 10. cerrar OT libera saldo.
- Correr la **suite completa** (`npm run typecheck`, unitarias, cada PGlite registrada, E2E completa), sin filtrar por nombre.
- Despliegue: migración → `db:sync-rbac` → inventario de arranque (T0.2) → publicar nueva versión de la PWA (el contrato nuevo es opcional, así que teléfonos sin actualizar no fallan).

## 7. Seguridad, autorización y auditoría

- Todo control en backend: crear NP (autor asignado o `manage`), resolver (`mant:np:manage` + faena), consumir (autor del registro + OT del registro = OT de la reserva). La UI sólo oculta, nunca autoriza.
- Las rutas `/api/mantencion/sync/*` mantienen Bearer de dispositivo, nunca cookie (`sync-auth.ts:9-17`).
- `recordAudit` en: creación/anulación de NP, resolución de línea, creación/liberación de reserva, egreso y reverso por mantención, conciliación.
- El kárdex es la fuente única de stock (`applyMovementTx`); ninguna pantalla escribe `worksite_stock` directo.
- La foto opcional de la NP usa el mismo pipeline validado (sha256, MIME) de las fotos del registro.

## 8. Casos borde que el plan cubre

| Caso | Comportamiento |
|---|---|
| NP enviada tres veces por mala señal | Una NP (idempotencia por `client_op_id`). |
| OT reasignada o cerrada mientras la NP estaba en cola | 409 con mensaje legible; queda visible en la app como rechazada. |
| Equipo trasladado a otra faena antes de usar el repuesto | Se descuenta de la faena donde está la reserva; si el repuesto se movió físicamente, va con guía de traslado (`egreso_traslado`/`ingreso_traslado`) y la reserva se traslada (`source=traslado`). |
| Dos mecánicos usan el último repuesto libre | `FOR UPDATE` serializa; el segundo queda `pendiente_conciliar`, el registro no se pierde. |
| Recepción anulada con parte ya usada | Se bloquea con mensaje que nombra el registro/OT. |
| Compra parcial (split de OC) | `parts_note_item_id` se copia al ítem remanente. |
| Cantidades decimales | Se respeta `requiresWholeQuantity` de la unidad del producto. |
| Repuestos recibidos antes del corte | Quedan `delivered` sin stock; sólo se cargan por inventario de arranque (T0.2). |

## 9. Fuera de alcance (seguimientos)

- Consumo en preventivas (filtros/aceites de la pauta) y kits por pauta (D7).
- Centro de costo (ya pendiente desde el plan del 2026-11-07).
- Stock mínimo de repuestos críticos por faena (`worksite_stock.min_stock` está retirado, `db/schema/stock.ts:15-18`).
- Retirar la columna legada `mant_record_correctives.work_order` (texto) cuando ya no tenga lecturas.

## 10. Orden sugerido

F0 → F1 → (F2 ∥ F5.1–F5.2) → F3 ∥ F4 → F5.3–F5.6 → F6 → F7 → F8 → F9.
F5.2 (revertir consumo directo) no debe llegar a producción sin F6 (consumo) y F0.2 (inventario de arranque): si no, el stock de repuestos sólo crecería.
