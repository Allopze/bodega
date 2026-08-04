# Plan: Snapshot de datos de EPP en solicitudes y OC

**Fecha:** 2026-08-02
**Motivación:** hoy no existe función de borrado de EPPs en `admin/epps` (es de solo lectura). Antes de construir esa función, se necesita blindar las solicitudes/OC/entregas **ya aceptadas** para que un futuro borrado (hard-delete o soft-delete) no les haga perder el nombre/marca/certificación del EPP que llevan.

---

## 1. Diagnóstico

### 1.1 Qué protege hoy a las OC de un borrado, y qué no

- `purchase_request_items.productId` y `purchase_order_items.productId` referencian `products.id` **sin `onDelete` explícito** → Postgres aplica `RESTRICT` por defecto. Un `DELETE FROM products` fallaría con error de FK mientras exista cualquier ítem de solicitud/OC que lo use. **Esto ya impide el hard-delete directo del producto**, no haría falta nada adicional para ese caso puntual.
- `products.familyId → epp_product_families.id` sí tiene `onDelete: "set null"` (`db/schema/products.ts:41`). Es decir, **hoy mismo**, borrar una familia EPP (marca/modelo/certificación) deja el producto vivo pero con `familyId = null`, perdiendo brand/model/certification en cualquier vista que los muestre. Esto ya es un problema latente, independiente de que se implemente o no un borrado de producto.
- Ningún ítem de solicitud/OC guarda una copia de `name`/`sku`/`brand`/`certification` del EPP al momento de crearse. Todo se resuelve con `JOIN`/`findMany` en vivo contra `products` (y nunca contra `epp_product_families`) en el momento de mostrar/exportar/imprimir.
- El único campo de respaldo hoy es `productNameFree` (texto libre), pero solo se llena para ítems **no catalogados** (cuando el usuario escribe un nombre libre en vez de elegir del catálogo). Los ítems catalogados no tienen ningún respaldo textual.

**Conclusión:** el riesgo real no es "el DELETE se ejecuta y rompe la FK" — eso ya está bloqueado por RESTRICT. El riesgo es (a) que el futuro borrado se implemente como *soft-delete* o *desactivación* (`isActive=false`) en vez de hard-delete —lo más probable, dado que hay RESTRICT— y las vistas dejen de mostrar el producto por estar filtrado/oculto, o (b) que se decida forzar el borrado con cascada, o (c) que simplemente se borre la *familia* (ya posible hoy sin ningún código nuevo) y se pierda brand/certification en todo lado.

### 1.2 Puntos de escritura de ítems catalogados (`productId` no nulo)

| Archivo | Línea | Función | Origen del `productId` | ¿Ya tiene el producto cargado? |
|---|---|---|---|---|
| `lib/services/requests-draft-create.ts` | 58-73 (`insertAllItems`) | Crear solicitud nueva | `item.productId` crudo del form (`RequestItemFormData`) | No — hay que agregar query |
| `lib/services/requests-draft-update.ts` | 74-93 (update), 95-112 (insert) | Editar solicitud existente | `item.productId` crudo del form | No — hay que agregar query |
| `app/(app)/solicitudes/actions-module/duplicate.ts` | 68-83 | Duplicar solicitud | `item.productId` de los ítems originales, cargados vía `with: { items: { with: { attributes: true } } }` (línea 26) sin `product` | No, pero se puede ampliar el `with` existente en vez de agregar una query nueva |
| `lib/services/epp-replenishment.ts` | 84-98 | Generación automática de reposición EPP | `matchedProduct?.id`, ya resuelto en línea 80-82 vía `tx.query.products.findFirst({ where: eq(p.name, gap.eppTypeLabel) })` | Casi — el producto ya se consulta, solo falta `with: { family: true }` en esa misma query |
| `lib/services/purchasing-module/purchase-orders-create.ts` | 106-115 (select del `requestItem` con lock), 219-240 (insert real) | Crear OC desde ítems de solicitud aprobados | Copia `requestItem.productId`/`productNameFree` — nunca lee `products` | No — hay que agregar `leftJoin(products).leftJoin(eppProductFamilies)` al select de 106-115 |
| `lib/services/purchasing-module/purchase-orders-edit.ts` | 111-125 (update), 126-143 (insert) | Editar ítems de una OC ya creada | `EditableOrderItemInput.productId` viene del input de UI, **sin re-resolución alguna** — permite cambiar el producto de un ítem de OC existente o crear un ítem de OC sin `requestItemId` | No — necesita query nueva por `item.productId` en cada rama |

Descartados (no escriben `productId`, solo status/otras columnas): `submit-request.ts`, `select-quotation.ts`, `resubmit.ts`, `aprobaciones/actions.ts`, `bodega/actions.ts`, `operational-assignments.ts`, `persist-draft.ts` (este último **siempre** inserta `productId: null`, es solo para ítems de texto libre tipo repuestos/servicios — no aplica a EPP).

`app/(app)/compras/actions/create-order.ts` es la entrada de UI para crear OC, pero no construye el snapshot: delega a `purchase-orders-create.ts`, que además **re-resuelve `productId` server-side ignorando lo que venga del payload del cliente** (comentario explícito en el código: *"client data may choose an item, never its worksite, product, unit or cost centre"*). Esto confirma que toda la lógica de snapshot para OC debe vivir en `purchase-orders-create.ts` y `purchase-orders-edit.ts`, no en la capa de acciones.

### 1.3 Puntos de lectura afectados (vistas históricas / de solicitudes ya aceptadas)

Confirmados con JOIN/findMany en vivo contra `products`, sin leer nunca `epp_product_families` (o sea, ninguno muestra brand/certification hoy, ni siquiera con el producto intacto):

| Archivo | Qué muestra | Fallback actual |
|---|---|---|
| `app/(app)/solicitudes/[id]/page.tsx:114-223` | Detalle de solicitud (cualquier estado, incluidas aceptadas) | `coalesce(products.name, productNameFree, 'Ítem solicitado')` |
| `app/(app)/compras/[id]/page.tsx:61-320` | Detalle de OC | `productMap` + fallback a `productNameFree` |
| `app/(app)/recepcion/[id]/page.tsx:55-142` | Recepción de OC | igual patrón |
| `app/(print)/entregas/[id]/print/page.tsx:31-140` | Comprobante de entrega EPP a trabajador | igual patrón |
| `app/(print)/compras/[id]/print/oc-print-data.ts:54-61` | **PDF de OC** | fallback a `productNameFree`; **ya hoy solo trae `id, sku, name`, nunca brand/certification** — bug preexistente independiente de este plan |
| `lib/services/trazabilidad-item.ts:32-53,219` | Detalle histórico de trazabilidad de un ítem | `productName ?? productNameFree ?? "—"` |
| `lib/services/trazabilidad-export.ts:96-100,192-194` | Export Excel de trazabilidad | igual patrón |
| `lib/services/trazabilidad-matrix.ts:95-110,204-205` | Listado en pantalla de trazabilidad | igual patrón |
| `lib/reports/export-module/items-sin-oc.ts:51,71-72` | Reporte de ítems aprobados sin OC (zona gris: operativo activo, no estrictamente terminal) | igual patrón |
| `lib/services/epp-delivery-export.ts:39-59,91-92` | Export de entregas de EPP a trabajadores | **sin fallback** — `r.productName ?? ""`, no usa `productNameFree` aunque la columna existe en `deliveryItems`. **El caso más frágil de todos.** |
| `lib/services/analytics-module/dashboard.ts:55-57,78-80` | Dashboard analítico: `stockRisks` (INNER JOIN), `productRotation` (INNER JOIN, histórico), `eppDeliveries` (LEFT JOIN, fallback genérico `"EPP sin catálogo"`) | `productRotation` con INNER JOIN **excluiría filas completas** del histórico de rotación si el producto se borra — pérdida silenciosa de datos agregados, no solo de nombre |

Descartados por no tocar `products`/no ser vistas históricas: `dashboard-metrics.ts`, `reports/export-module/solicitudes.ts`, `reports/export-module/compras.ts`, `deliveries-worker-epp.ts` y `deliveries-worksite.ts` (lectura de producto vivo intencional, es lógica de validación en el camino de *escritura* de una entrega nueva, no de visualización histórica), `operational-work-queue.ts` (cola de trabajo pendiente, excluye explícitamente estados terminales — leer el producto vivo ahí es correcto).

No existe ningún endpoint público (`app/(public)/**`, incluido el portal TAE) que exponga datos de producto de una solicitud/OC — todas las rutas de export relevantes exigen `auth()`.

### 1.4 Schema relevante

```ts
// db/schema/products.ts
export const eppProductFamilies = pgTable("epp_product_families", {
  id, categoryId, canonicalName, identityKey,
  eppType,        // @deprecated, texto libre
  eppTypeId,      // FK -> epp_types, nullable
  brand, model, certification, lifespanMonths, pictogramUrl,
  createdAt, updatedAt,
})

export const products = pgTable("products", {
  id, sku, name, description, categoryId,
  familyId,       // FK -> epp_product_families, onDelete: "set null"
  unitOfMeasure, isEpp, requiresPrevencion, referencePrice, isActive, notes,
  createdAt, updatedAt,
})
```

`purchase_request_items` (`db/schema/requests.ts:55-88`) y `purchase_order_items` (`db/schema/purchasing.ts:63-99`) no tienen columnas de snapshot hoy — solo `productId` (FK, RESTRICT implícito) y `productNameFree` (texto libre, solo para no-catálogo).

Migraciones: Drizzle Kit, carpeta `db/migrations/` (132 migraciones al día de hoy, `0000_vengeful_hulk.sql` → `0132_retire_supplier_confirmed.sql`), config en `drizzle.config.ts`. Flujo: editar `db/schema/*.ts` → `npm run db:generate` (genera el `.sql`) → `npm run db:migrate` (aplica; encadena un preflight de PDTP antes de invocar `drizzle-kit migrate`, no relacionado con este cambio). Prod ya tiene datos reales — cualquier columna nueva debe ser **nullable, sin default obligatorio**, para no requerir backfill síncrono en el `ALTER TABLE`.

---

## 2. Alcance propuesto

### 2.1 Columnas de snapshot

Agregar a **ambas** tablas (`purchase_request_items` y `purchase_order_items`), todas `text` nullable:

- `productNameSnapshot`
- `productSkuSnapshot`
- `productBrandSnapshot`
- `productCertificationSnapshot`

Se snapshotea también en `purchase_request_items` (no solo en la OC) porque el detalle de solicitud, trazabilidad y reportes de "ítems sin OC" leen de esa tabla directamente, antes de que exista una OC.

Se excluyen `description`/`notes`/`model` de `products`/`family` del snapshot por bajo valor documental para el caso de uso (ver hallazgos §1.4) — se puede ampliar después si se necesita.

### 2.2 Por qué snapshot y no solo blindar la FK

Blindar la FK (mantener RESTRICT, o pasar a soft-delete con columna `isActive`) evita el error de integridad, pero no resuelve que las vistas dejen de mostrar brand/certification si la *familia* se borra (ya posible hoy) ni da un plan para cuando alguien decida "desactivar" un EPP y las vistas empiecen a filtrar productos inactivos del JOIN. El snapshot desacopla completamente la visualización histórica del estado actual del catálogo, sin importar qué estrategia de borrado se elija después.

---

## 3. Plan de implementación

### Fase 0 — Migración de schema
1. Editar `db/schema/requests.ts` (tabla `purchaseRequestItems`) y `db/schema/purchasing.ts` (tabla `purchaseOrderItems`): agregar las 4 columnas nullable.
2. `npm run db:generate` → revisar el `.sql` generado (debe ser solo `ADD COLUMN`, sin default, sin `NOT NULL`).
3. `npm run db:migrate` en dev; validar contra una copia de prod antes de aplicar en prod real.

### Fase 1 — Helper de resolución de snapshot
Crear un helper único (p. ej. `lib/services/product-snapshot.ts`) con una función `resolveProductSnapshot(tx, productId)` que haga `leftJoin(products, eppProductFamilies)` (reutilizando el patrón ya existente en `lib/services/prevention-epp.ts:242-244`) y devuelva `{ name, sku, brand, certification } | null`. Esto evita duplicar la query en los 6 puntos de escritura.

### Fase 2 — Puntos de escritura de `purchase_request_items`
1. `requests-draft-create.ts:58-73` — llamar al helper antes del insert cuando `item.productId` no es null.
2. `requests-draft-update.ts:74-93 / 95-112` — mismo tratamiento en ambas ramas (update e insert).
3. `duplicate.ts:68-83` — ampliar el `with` de la query original (línea 26) a `items: { with: { attributes: true, product: { with: { family: true } } } }` y copiar el snapshot directo del ítem original en vez de volver a resolverlo (más barato, y preserva el snapshot histórico del ítem duplicado tal cual estaba, no el estado actual del catálogo).
4. `epp-replenishment.ts:80-82` — ampliar el `findFirst` existente a `with: { family: true }` y poblar el snapshot en el insert de línea 84-98 (no agrega ninguna query nueva, el round-trip ya se paga).

### Fase 3 — Puntos de escritura de `purchase_order_items`
1. `purchase-orders-create.ts:106-115` — agregar `leftJoin(products).leftJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))` al select con lock; en el insert de 219-240, **copiar el snapshot ya existente en `requestItem`** si está poblado (preferido, preserva el snapshot tomado al crear la solicitud), y si no lo está (solicitudes creadas antes de esta migración), resolverlo ahí mismo con el helper de la Fase 1.
2. `purchase-orders-edit.ts:111-143` — en ambas ramas (update de ítem existente, insert de ítem nuevo sin `requestItemId`), resolver el snapshot con el helper cuando cambie/se asigne un `productId`.

### Fase 4 — Backfill de datos existentes
Script one-off (`scripts/backfill-product-snapshot.ts`, patrón ya usado en el repo para scripts de mantenimiento) que:
1. Recorra todos los `purchase_request_items` y `purchase_order_items` con `productId` no nulo y snapshot aún null.
2. Resuelva `products`/`epp_product_families` **tal como existen hoy** y complete las 4 columnas.
3. Correr una sola vez en prod inmediatamente después de aplicar la migración — es la única ventana para capturar el estado histórico real antes de cualquier cambio futuro al catálogo.

### Fase 5 — Puntos de lectura (usar snapshot con fallback a JOIN en vivo)
Orden sugerido por severidad/impacto (más frágil primero):
1. `epp-delivery-export.ts` (sin fallback hoy — el más urgente). Nota: `deliveryItems` es una tabla distinta a `purchase_order_items`; si se decide cubrir este caso, requiere su propio análisis de si conviene agregar snapshot también a `delivery_items` (fuera del alcance estricto de "solicitudes ya aceptadas", pero mismo problema de fondo — dejarlo documentado como extensión futura, no bloquea este plan).
2. `oc-print-data.ts` (el PDF que motivó la pregunta original).
3. `solicitudes/[id]/page.tsx`, `compras/[id]/page.tsx`, `recepcion/[id]/page.tsx`, `entregas/[id]/print/page.tsx`.
4. `trazabilidad-item.ts`, `trazabilidad-export.ts`, `trazabilidad-matrix.ts`.
5. `items-sin-oc.ts`.
6. `analytics-module/dashboard.ts` (`productRotation` en particular — cambiar el `INNER JOIN` a uno que no descarte filas históricas, o agregar el snapshot al resultado agregado).

En cada uno: preferir `item.productNameSnapshot ?? products.name ?? item.productNameFree ?? "—"` (mismo patrón `COALESCE` ya usado en el código, solo con un nivel adicional al frente). Mantener el JOIN en vivo como fallback cubre los ítems creados antes del backfill si por algún motivo el backfill no alcanzó a correr sobre alguna fila.

### Fuera de alcance de este plan
- Implementar la función de borrado de EPPs en sí (`admin/epps`) — este plan es un prerrequisito, no lo incluye.
- Snapshot en `delivery_items` (entregas) — mismo problema, tabla distinta, documentado como extensión futura en Fase 5.1.
- Decidir la estrategia final de borrado (hard-delete vs soft-delete/`isActive`) — este plan es agnóstico a esa decisión; funciona igual en ambos casos porque protege por snapshot, no por la FK.

---

## 4. Resumen de archivos a tocar

**Schema (Fase 0):** `db/schema/requests.ts`, `db/schema/purchasing.ts`, migración generada en `db/migrations/`.

**Nuevo (Fase 1):** `lib/services/product-snapshot.ts`.

**Escritura (Fases 2-3):** `lib/services/requests-draft-create.ts`, `lib/services/requests-draft-update.ts`, `app/(app)/solicitudes/actions-module/duplicate.ts`, `lib/services/epp-replenishment.ts`, `lib/services/purchasing-module/purchase-orders-create.ts`, `lib/services/purchasing-module/purchase-orders-edit.ts`.

**Backfill (Fase 4):** `scripts/backfill-product-snapshot.ts` (nuevo).

**Lectura (Fase 5):** `app/(print)/compras/[id]/print/oc-print-data.ts`, `app/(app)/solicitudes/[id]/page.tsx`, `app/(app)/compras/[id]/page.tsx`, `app/(app)/recepcion/[id]/page.tsx`, `app/(print)/entregas/[id]/print/page.tsx`, `lib/services/trazabilidad-item.ts`, `lib/services/trazabilidad-export.ts`, `lib/services/trazabilidad-matrix.ts`, `lib/reports/export-module/items-sin-oc.ts`, `lib/services/analytics-module/dashboard.ts`, `lib/services/epp-delivery-export.ts` (parcial, ver nota Fase 5.1).

**Total: 4 archivos de schema/migración, 1 helper nuevo, 6 puntos de escritura, ~10 puntos de lectura, 1 script de backfill.**
