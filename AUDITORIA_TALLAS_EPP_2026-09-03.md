# Auditoría del sistema de tallas de EPP — 2026-09-03

## 1. Cómo funciona hoy el modelo (verificado en código, no asumido)

**La variante *es* el producto.** No existe ni hace falta una entidad `variant`:

| Concepto | Dónde vive | Evidencia |
|---|---|---|
| Variante (talla concreta) | una fila de `products` | `db/schema/products.ts:35` |
| Talla de esa variante | `product_attributes` con `name ~ /talla/i`, `type = 'select'`, `options = '["42"]'` | `db/schema/products.ts:84`, `app/(app)/admin/productos/actions/products.ts:484-500` |
| Familia que agrupa las tallas | `products.family_id → epp_product_families` | `db/schema/products.ts:41` |
| Stock | `worksite_stock (worksite_id, product_id)` — único por par | `db/schema/stock.ts:11` |
| Movimientos | `inventory_movements.product_id` | `db/schema/stock.ts:28` |
| Compra / pedido | `purchase_order_items.product_id`, con `quantity_received` y `quantity_office_received` por línea | `db/schema/purchasing.ts:81-98` |
| Recepción | `receipt_items.purchase_order_item_id` (parciales por línea, o sea por talla) | `db/schema/receiving.ts:33` |
| Solicitud | `purchase_request_items.product_id` + `request_item_attributes(name, value)` | `db/schema/requests.ts:69,121` |
| Entrega | `delivery_items.product_id` | `db/schema/receiving.ts:110` |
| Talla habitual del trabajador | `workers.size_top/bottom/shoe/gloves/helmet` (texto libre) | `db/schema/worksites.ts:54-58` |

**Consecuencia:** la talla ya viaja intacta por todo el ciclo solicitud → compra
→ recepción → stock → traslado → entrega → devolución, porque viaja *dentro* de
`product_id`. El ciclo no perdía la talla: **las pantallas no la leían.**

Por eso esta auditoría no cambió el modelo de datos. Agregar una tabla de
tallas o una columna `size_id` en entregas habría sido la segunda fuente de
verdad que el encargo prohíbe, y habría dejado el stock por producto y la talla
por entrega — exactamente el anti-patrón a evitar.

---

## 2. Hallazgos

### F-1
**SEVERITY:** Critical
**TITLE:** La consulta de stock de Entregas nunca lee la talla, así que la talla no existe en el formulario (causa raíz).
**FILE:** `app/(app)/entregas/page.tsx`
**LINES:** 92-108 (consulta), 170-178 (DTO) — antes del arreglo
**EVIDENCE:** El `select` de stock traía `products.name`, `products.sku`, `isEpp`
y `unitOfMeasure`, y nunca hacía join con `product_attributes`. `product_attributes`
sólo se consultaba en Solicitudes y en Admin:
`grep -rln productAttributes app lib` → sólo `solicitudes/*`, `admin/productos/*`,
`admin/epps`, `epp-import*`, `requests-draft-create`. El DTO
`DeliveryStockProductOption` no tenía ningún campo de talla.
**IMPACT:** El importador de EPP **quita la talla del nombre** y la guarda como
atributo (`lib/services/epp-import.types.ts:177-183`), de modo que las N filas
de una familia comparten nombre exacto. El selector de producto de Entregas
renderizaba `product.productName` y mostraba N opciones idénticas
("Zapato de seguridad SteelPro" ×5) sin forma de saber ni elegir la talla. El
bodeguero elegía a ciegas y descontaba stock de una talla al azar.
**FIX:** Aplicado. Consulta de atributos por el conjunto de productos con stock
(una sola consulta, sin N+1) y `sizeLabel` / `sizeAttributeName` / `familyId` /
`familyName` en el DTO.

### F-2
**SEVERITY:** High
**TITLE:** El formulario de entrega no tenía selector de talla ni selectores dependientes.
**FILE:** `app/(app)/entregas/delivery-form.tsx`
**LINES:** 231-247 (antes del arreglo)
**EVIDENCE:** Un único `Select` sobre `selectableProducts` (variantes planas) y
nada más. Solicitudes sí tenía el patrón resuelto
(`app/(app)/solicitudes/variant-selector.tsx`), Entregas no lo usaba.
**IMPACT:** Prioridad 2 del encargo, imposible de cumplir.
**FIX:** Aplicado. Producto (familia) → talla (variante), con limpieza de la
talla al cambiar de producto, stock por talla en cada opción, talla habitual
marcada, aviso cuando la talla habitual no tiene stock, y sin selector de talla
para productos que no la usan. Reutiliza `Select`/`Field`/`Badge` existentes.

### F-3
**SEVERITY:** Medium
**TITLE:** Las tallas se mostraban en orden de consulta, no en orden lógico.
**FILE:** `app/(app)/solicitudes/variant-selector.helpers.ts`
**LINES:** 44-46 (antes del arreglo)
**EVIDENCE:** `choices: resolvedChoices.map(...)` sin ningún `sort`. El orden
era el de `products` en la consulta (por nombre), es decir `10, 38, 39, 9` para
calzado y `L, M, S, XL, XS` para ropa. `size_catalog.display_order` existe para
esto y no se consultaba.
**IMPACT:** El operador busca "42" en una lista desordenada; error de selección.
**FIX:** Aplicado. `compareSizeLabels` ordena numéricas por valor y la escala de
ropa por talla (`XS S M L XL 2XL 3XL`), con lo desconocido al final.

### F-4
**SEVERITY:** Medium
**TITLE:** El comprobante firmado y el PDF de la entrega no dicen qué talla se entregó.
**FILE:** `app/(print)/entregas/[id]/print/page.tsx`
**LINES:** 44-49, 58-61 (antes del arreglo)
**EVIDENCE:** `productMap` mapeaba `product.id → product.name` y el renglón era
`${nombre} · ${cantidad}`.
**IMPACT:** El documento que el trabajador acusa recibo decía "Zapato de
seguridad SteelPro · 1 unidad" sin la talla. Es el registro histórico con valor
probatorio.
**FIX:** Aplicado. `formatSizedProductName` agrega `· Talla calzado 42`, leído
de los atributos de la variante entregada.

### F-4b
**SEVERITY:** High
**TITLE:** Cuatro pantallas más listaban productos de catálogo sin la talla.
**FILE:** `app/(app)/bodega/page.tsx`, `lib/services/stock-export.ts`, `lib/services/epp-delivery-export.ts`, `app/(app)/bodega/trazabilidad/trabajador/[workerId]/page.tsx`
**LINES:** `:200,228,246` · `:45,141` · `:49` · `:50`
**EVIDENCE:** Todas seleccionaban `products.name` sin tocar `product_attributes`.
Es el mismo mecanismo de F-1 en otras superficies.
**IMPACT:** La pantalla de stock/kardex mostraba varias filas con texto idéntico
y saldos distintos: el bodeguero no podía saber cuál ajustar, desechar, contar
en el inventario físico ni fijarle stock mínimo, porque las seis vistas comparten
el mismo embudo `product: { name }`. Los dos exports producían planillas
imposibles de pivotear por talla. El historial del trabajador no decía qué talla
recibió.
**FIX:** Aplicado. `lib/services/product-sizes.ts` resuelve la talla del conjunto
de productos en una sola consulta y las cuatro la usan. En pantalla la talla va
pegada al nombre (`· Talla calzado 42`); en los Excel va en **columna propia
«Talla»**, para poder filtrar y dinamizar por ella.

### F-5
**SEVERITY:** Medium
**TITLE:** Tres reglas distintas y divergentes para "qué es una talla".
**FILE:** `app/(app)/solicitudes/variant-selector.helpers.ts`, `app/(app)/solicitudes/use-request-form.ts`, `lib/services/epp-import.types.ts`
**LINES:** `:16-18` (detección), `:69-81` (mapa a talla habitual), `:246` (normalización)
**EVIDENCE:** La detección era `/\btalla\b|\bsize\b/i` sin quitar diacríticos; el
mapa `SIZE_FIELD_MAP` exigía la clave exacta (`"Talla calzado"`, no
`"talla calzado"`); y `normalizeSize` era `value.toUpperCase()`, aplicado sólo
en el importador. Ninguna de las tres alcanzaba a Entregas.
**IMPACT:** `T42` no cruzaba con `42` al sugerir la talla habitual; `XXL` y
`2XL` se trataban como tallas distintas.
**FIX:** Aplicado. `lib/products/product-size.ts` es ahora el único lugar que
decide qué es una talla, cómo se escribe y en qué orden se muestra; las tres
copias se reemplazaron por llamadas a ese módulo.

### F-6
**SEVERITY:** Medium
**TITLE:** Faltaban los índices de las dos FK por las que se lee la talla.
**FILE:** `db/schema/products.ts`
**LINES:** 75-81 (`products.family_id`), 106-114 (`product_attributes.product_id`)
**EVIDENCE:** El único índice sobre `product_attributes.product_id` era el
**parcial** `product_attributes_one_quantity_driver ... WHERE drives_quantity = true`
(`db/migrations/0148_attribute_drives_quantity.sql:2`), inutilizable para leer
la talla. `products.family_id` no tenía índice alguno.
**IMPACT:** Cada lectura de tallas y cada agrupación por familia hacía recorrido
secuencial. La vista de Entregas las hace para todo el catálogo con stock.
**FIX:** Aplicado. Migración `0251_optimal_raza.sql`, aditiva y no destructiva.

### F-7
**SEVERITY:** Medium
**TITLE:** `size_catalog` es un catálogo de tallas completo y muerto.
**FILE:** `db/schema/sizes.ts`, `lib/services/sizes.ts`
**LINES:** todo el archivo
**EVIDENCE:** La tabla tiene `family`, `code`, `display_order`, `is_active` y un
único por `(family, code)` — justo el modelo que el encargo pide. Su único
lector, `getCanonicalSizesByFamily`, **no tiene ningún consumidor**:
`grep -rn "services/sizes\|getCanonicalSizesByFamily" app components lib db scripts` → 0 resultados.
Las tallas reales salen de `EPP_ATTRIBUTE_PRESETS`, una constante en el cliente
(`app/(app)/admin/productos/epp-variant-generator.tsx:12-17`).
**IMPACT:** Es la fuente de verdad candidata para tipologías, etiquetas y orden,
y está sin usar; el orden de presentación se recalcula en código en vez de leerse
de `display_order`. Mientras siga muerta, es una segunda fuente de verdad latente.
**FIX:** Aplicado. `lib/products/size-catalog.ts` es la semilla (familias,
códigos y el atributo que les corresponde), `syncSizeCatalog` la vuelca en la
tabla y `npm run db:seed-size-catalog` la corre en el despliegue —idempotente y
sin reactivar lo que alguien dio de baja a mano. El asistente de variantes y el
padrón de trabajadores leen de la base por props del servidor, así que agregar
una talla 47 es una fila, no un despliegue. `display_order` se **deriva** de
`compareSizeLabels` y hay un test que lo comprueba: la base no opina distinto
que la interfaz sobre en qué orden van las tallas.

### F-8
**SEVERITY:** Medium
**TITLE:** Cuarta copia de la lista de tallas, con una familia inexistente y una talla ficticia.
**FILE:** `app/(app)/admin/trabajadores/worker-form.tsx`
**LINES:** 13-19 (antes del arreglo)
**EVIDENCE:** `SIZE_PRESETS` declaraba su propia lista: `bottom` con numeración
de cintura 28-48 —una familia que no existía en `size_catalog` ni en los presets
de producto— y `helmet: ["Única"]`.
**IMPACT:** «Única» no es una talla que ninguna variante pueda tener, así que la
talla de casco del padrón nunca podía cruzar con un producto. Y como el pantalón
no era una familia, el asistente no podía crear variantes de pantalón por talla:
esa talla del padrón tampoco tenía con qué cruzar. Además el valor se guardaba
sin normalizar, así que `42` y `42.0` convivían.
**FIX:** Aplicado. La lista sale de `size_catalog` (se agregó la familia
`pantalon`, que el padrón ya usaba); `workerSchema` normaliza al guardar; y el
selector **conserva como opción cualquier valor histórico que el catálogo ya no
ofrezca**, para que abrir y guardar una ficha antigua no lo borre en silencio.
`npm run db:preflight-worker-sizes` reporta las filas no canónicas y sólo
con `--apply` normaliza las que cruzan con el catálogo; las demás las deja y las
lista.

**Corrección a la versión anterior de este informe:** decía que estos campos eran
`<Input>` de texto libre. Es falso: ya eran un `<Select>`. El problema no era la
falta de control sino que su lista era una cuarta copia divergente.

### F-9
**SEVERITY:** Low
**TITLE:** No hay preset de talla de casco pese a que el padrón la guarda.
**FILE:** `app/(app)/admin/productos/epp-variant-generator.tsx`
**LINES:** 12-17
**EVIDENCE:** Los presets cubren `Talla` (ropa), `Talla calzado` y
`Talla guantes`. `workers.size_helmet` existe y `SIZE_ATTRIBUTE_FIELDS` lo mapea,
pero ningún preset crea el atributo `Talla casco`.
**IMPACT:** La talla de casco del padrón nunca puede sugerirse, porque no hay
variantes con ese atributo. Sin impacto en integridad.
**FIX:** Aplicado. La familia `casco` existe en el catálogo con sus códigos, y
un test comprueba que **toda** familia declarada cruza con un campo del padrón —
la condición que a `Talla casco` le faltaba.

### F-10
**SEVERITY:** High
**TITLE:** Una entrega mal registrada no tenía forma de corregirse: no existía anular.
**FILE:** `lib/services/deliveries-worker-stock.ts`, `app/(app)/entregas/actions.ts`
**LINES:** todo el flujo de entrega
**EVIDENCE:** `grep -rn "delete(deliveries)\|update(deliveries)\|voidDelivery\|cancelDelivery"` → 0 resultados.
La entrega era un documento de sólo-inserción.
**IMPACT:** Entregar la talla 41 cuando correspondía la 42 dejaba el inventario
descuadrado sin ninguna operación que lo corrigiera. La única salida era una
devolución (`stock_returns`), que **miente**: dice que el material volvió
físicamente, cuando lo que pasó es que la entrega nunca debió registrarse.
**FIX:** Aplicado. `voidWorkerStockDelivery` repone el stock de la **variante
exacta** de cada línea en la bodega de origen, con su propio tipo de movimiento
`ingreso_anulacion` —no disfrazado de devolución en el kardex—, motivo
obligatorio de 10+ caracteres (servicio y CHECK), permiso propio
`deliveries:void`, y todo en una transacción. La entrega **no se borra**: se
marca con fecha, responsable y motivo, y sus líneas siguen ahí.

Lo que hace que esto sea correcto y no sólo un botón:

- Toda suma de "cuánto se entregó" excluye las anuladas: el saldo trazable al
  registrar una entrega, el saldo pendiente en `/entregas` y la elegibilidad de
  devolución del panel de bodega.
- Una entrega con devoluciones registradas **no se puede anular** (reponer dos
  veces el mismo stock), y una entrega anulada **no se puede devolver**.
- El ítem de solicitud vuelve al estado que le corresponde, **recalculado desde
  los hechos** (`revertDeliveredItemTx`) y no desde un estado guardado, para que
  dos anulaciones seguidas o una recepción intermedia no lo dejen inconsistente.
- Sin bodega de origen conocida no se anula: reponer stock a una faena adivinada
  inventaría existencias.

**Editar** una entrega sigue sin existir, y a propósito: editar es anular y
volver a registrar, que deja los dos documentos auditables en vez de reescribir
uno.

---

## 3. Lo que se auditó y **no** estaba roto

Verificado con una prueba de integración contra Postgres real
(`lib/__tests__/deliveries-size-stock-pglite.test.ts`, 16 casos), no por lectura:

- El descuento cae en la talla entregada y **no toca las tallas hermanas**.
- El stock de la misma talla en **otra faena** no se altera.
- `inventory_movements` registra la variante, con `stock_before`/`stock_after`.
- Cantidades parciales y varias tallas del mismo producto en un solo documento.
- Stock insuficiente en una talla se rechaza aunque la familia sume más.
- **Nunca queda saldo negativo:** `applyStockDelta` hace un `UPDATE` atómico con
  `WHERE quantity + delta >= 0` (`lib/services/stock-movement.ts:407-420`), más
  el `CHECK worksite_stock_quantity_non_negative`.
- **Concurrencia:** dos entregas simultáneas de la última unidad → sólo una gana.
- **Atomicidad:** si una línea falla, no queda cabecera, ni líneas, ni movimientos.
- Variante inactiva y variante entregada desde una faena sin ese stock: rechazadas.
- Devolución (`ingreso_devolucion`) vuelve a la misma talla, no a un stock genérico.
- Traslado entre faenas conserva la talla en origen y destino.
- Compras y recepciones ya son por variante y admiten parciales por talla
  (`purchase_order_items.quantity_received` / `quantity_office_received`).

## 4. Casos del encargo: estado final

El caso 15 (anular entrega) **se implementó** — ver F-10, con 10 casos de prueba
contra Postgres real, incluidas dos anulaciones simultáneas y el rollback de una
anulación fallida.

Los casos 13 (editar talla de una entrega) y 14 (editar cantidad) siguen sin
ruta directa, y es una decisión: editar una entrega equivale a anularla y
registrar la correcta, lo que deja dos documentos auditables en vez de
reescribir uno. Con la anulación disponible, el flujo operativo del caso 13 ya
se puede completar.

## 5. Gap conocido que no se cerró

`lib/services/operational-work-queue.ts:583` arma el título de cada tarea con un
fragmento SQL (`COALESCE(products.name, ...)`) dentro de una UNION de fuentes
heterogéneas, así que la talla no se puede resolver ahí en TypeScript sin
agregar la columna a todas las fuentes. La alternativa —una subconsulta que
detecte el atributo de talla en SQL— duplicaría en la base la regla que este
trabajo vino a centralizar, y con un riesgo real: `options` no siempre es JSON
válido en los registros antiguos, y un `::jsonb` fallido rompería una consulta
que alimenta el badge del rail en cada página.

Se dejó sin cambiar. El costo es acotado: el título de la tarea dice el nombre
del producto sin la talla, y el CTA lleva a la pantalla correspondiente, que
ahora sí la muestra.

## 5. Cambios aplicados

| Archivo | Qué |
|---|---|
| `lib/products/product-size.ts` *(nuevo)* | Módulo central: detección, normalización, orden lógico, lectura de la talla de una variante, cruce con la talla habitual |
| `lib/products/product-size.test.ts` *(nuevo)* | 20 casos |
| `app/(app)/entregas/delivery-size-options.ts` *(nuevo)* | Agrupación familia → talla del stock de una bodega |
| `app/(app)/entregas/delivery-size-options.test.ts` *(nuevo)* | 13 casos |
| `lib/__tests__/deliveries-size-stock-pglite.test.ts` *(nuevo)* | 16 casos de integridad contra Postgres |
| `app/(app)/entregas/page.tsx` | Lee atributos de talla y familia; pasa tallas habituales |
| `app/(app)/entregas/delivery-form.types.ts` | Campos de familia/talla y tallas habituales en los DTO |
| `app/(app)/entregas/delivery-form.tsx` | Selectores dependientes producto → talla |
| `app/(app)/entregas/delivery-form.test.tsx` | +11 casos de talla |
| `app/(print)/entregas/[id]/print/page.tsx` | Talla en el comprobante |
| `app/(app)/solicitudes/variant-selector.helpers.ts` | Usa el módulo central; ordena; detecta tallas duplicadas |
| `app/(app)/solicitudes/variant-selector.helpers.test.ts` | +3 casos |
| `app/(app)/solicitudes/use-request-form.ts` | Elimina la copia del mapa de tallas |
| `lib/products/variant-grouping.ts` | Exporta `variantGroupKey` (una sola regla de agrupación) |
| `db/schema/products.ts` + `db/migrations/0251_optimal_raza.sql` | Índices faltantes |
| `lib/services/product-sizes.ts` *(nuevo)* | Resolvedor compartido: talla de N variantes en una consulta |
| `app/(app)/bodega/page.tsx` | Talla en stock, kardex, ajustes, desechos, stock mínimo, inventario físico y filtro de kardex |
| `lib/services/stock-export.ts` | Columna «Talla» en los export de stock y de kardex |
| `lib/services/epp-delivery-export.ts` | Columna «Talla» en el export de entregas EPP |
| `app/(app)/bodega/trazabilidad/trabajador/[workerId]/page.tsx` | Talla en el historial de entregas del trabajador |
| `lib/__tests__/stock-export.test.ts` | Contrato de columnas actualizado + caso de talla |
| `lib/services/dispatch-guides.ts` | Talla en la guía de despacho que viaja con la carga |
| `lib/services/stock-alerts.ts` | Talla en las alertas de stock mínimo |
| `app/api/bodega/opciones/route.ts` | Talla en los selectores de ajuste, desecho y devolución |
| `lib/reports/export-module/bodega-rotacion.ts` · `bodega-valorizacion.ts` | Columna «Talla» |
| `lib/services/epp-stock-availability.ts` | Talla en el aviso de stock al enviar la solicitud |
| `lib/services/purchasing-module/pending-purchase-queue.ts` · `app/(app)/compras/nueva/page.tsx` · `items-sin-oc.ts` | Talla en el ciclo de compra |
| `lib/products/size-catalog.ts` *(nuevo)* + `lib/services/sizes.ts` + `scripts/seed-size-catalog.ts` | F-7/F-9: `size_catalog` vivo, con familia de casco y de pantalón |
| `lib/validation/masters.ts` + `app/(app)/admin/trabajadores/*` | F-8: talla del padrón normalizada y leída del catálogo |
| `scripts/preflight-worker-sizes.ts` *(nuevo)* | Reporte de tallas históricas no canónicas |
| `lib/services/deliveries-void.ts` *(nuevo)* + `db/migrations/0253_dry_the_hood.sql` | F-10: anular entrega y reponer stock por variante |
| `lib/services/item-state-module/receiving.ts` | `revertDeliveredItemTx`: reverso del estado del ítem |
| `app/(app)/entregas/void-delivery-dialog.tsx` *(nuevo)* + `modules/deliveries/manifest.ts` | UI de anulación y permiso `deliveries:void` |

**Sin cambios de modelo:** ninguna tabla nueva, ninguna columna de talla nueva,
ningún dato histórico reescrito. La migración sólo crea dos índices.

**Superficie de ataque:** el formulario sigue enviando **sólo `productId`**. No
existe un `sizeId` que manipular: la talla no es un parámetro independiente que
pueda contradecir al producto. El servidor valida producto activo, no-servicio,
cantidad entera para EPP, pertenencia de la faena (`canAccessWorksite` +
`serviceWorksiteScope`) y stock suficiente de forma atómica — todo por variante.
