# Catálogo de repuestos (fase 2) — Plan de implementación

> Al aprobarse, copiar a `docs/superpowers/plans/2026-11-09-catalogo-repuestos.md` y ejecutar con superpowers:subagent-driven-development (Opus planifica, Sonnet en paralelo, pruebas al final — ver memoria «ritmo-planes-largos»). Trabajar en worktree desechable (la E2E borra `.next`).

## Context

La fase 1 («Repuestos vinculados», desplegada 2026-11-08) ató el ítem de repuesto al vehículo y a la OT, pero el repuesto sigue siendo **texto libre**: `persist-draft.ts:137-155` guarda `productId: null`, el N° de parte vive como fila suelta de `request_item_attributes` y se reescribe cada vez. Consecuencias: sin historial de precio por proveedor (`setProductSupplierPriceTx` y la conciliación de facturas exigen `productId`), la conciliación de facturas empareja por nombre (frágil), y nadie puede responder «¿cuánto pagamos la última vez por este filtro y a quién?».

Objetivo: un catálogo de repuestos que crece con el uso, sin frenar al que pide.

### Decisiones del usuario (2026-11-09)
1. **Consumo directo:** el repuesto de catálogo NO entra a stock ni kárdex; al recibirse en faena pasa a «entregado» como hoy. El catálogo sirve para identidad, precios y conciliación.
2. **Opcional, se cataloga al comprar:** quien pide busca en el catálogo o escribe texto libre. Compras, al armar la OC, vincula la línea a un repuesto existente o lo crea.
3. **Compatibilidad derivada del historial:** sin tabla de compatibilidad. El repuesto muestra para qué vehículos (marca/modelo) se compró y el buscador prioriza lo ya comprado para el vehículo elegido. Marca del fabricante del repuesto como texto.
4. **Permiso nuevo `repuestos:catalog`** para administrador, secretaria, jefa_chome y jefe_mantencion; pantalla propia «Catálogo de repuestos».

### Decisiones mías (revisables)
- Un repuesto es una fila de `products` (no tabla nueva): reutiliza `product_suppliers`, `product_supplier_price_history`, alias de proveedor y la OC tal cual. Se distingue con `products.is_spare_part` (boolean) en la categoría sembrada «Repuestos» (slug `repuestos`).
- Columnas nuevas en `products`: `part_number` (text, nullable) y `part_brand` (text, nullable, marca del fabricante del repuesto). Índice único parcial `(lower(part_number), lower(coalesce(part_brand,'')))` WHERE `is_spare_part` y `part_number` no nulo — evita duplicados del mismo N° de parte.
- Consumo directo = `is_spare_part`. No se agrega un segundo flag: la regla «sin stock» se ancla al mismo booleano (si algún día se guardan repuestos en bodega, se separa).
- SKU con prefijo `RPT-NNN` (no `REP-`, que ya es el código de solicitud).
- **Precio al emitir la OC:** al pasar la OC a `sent`, cada línea con repuesto de catálogo registra el precio unitario con el proveedor vía `setProductSupplierPriceTx`, fuente nueva `purchase_order`. La conciliación de facturas sigue pudiendo corregirlo (`invoice_reconciliation`, `rejectOlderThanCurrent`). Hoy emitir una OC no escribe precios; esto sólo aplica a repuestos.
- **Conciliación por N° de parte:** el matcher compara además el código de la factura contra `products.part_number` (los proveedores facturan con su código, no con nuestro SKU).
- Sin backfill automático de ítems históricos (prod tiene muy pocos); el catálogo nace vacío y se llena desde la OC y la pantalla.
- La app del mecánico y `mant_record_parts` no cambian (decisión 8 de la fase 1 sigue vigente).

## Global constraints
Los de la fase 1 siguen rigiendo (ver `docs/superpowers/plans/2026-11-07-repuestos-vinculados.md` § Global Constraints): migraciones sólo con `npm run db:generate` + `node scripts/verify-migration-chain.mjs --update-checksums`; RBAC en manifest + `GRANT_ADDITIONS` (`lib/auth/bootstrap.ts`) + `db:sync-rbac`; suites PGlite registradas en `tests/pglite-files.ts` y corridas de a una; `Field`, `EmptyState`, `PageHeader`/`PageContainer`; textos en español; locators con `textoVisible()`/`exact: true`.

---

## Fase A — Modelo

### T1. Schema y migración
- `db/schema/products.ts`: `isSparePart` (bool, default false, not null), `partNumber`, `partBrand`; índice único parcial descrito arriba; CHECK `NOT (is_spare_part AND (is_epp OR is_service))`.
- Agregar fuente `purchase_order` a la unión de `lib/services/product-supplier-prices.ts:6-11`.
- Custom SQL idempotente al final de la migración: categoría `repuestos` («Repuestos», `isEpp=false`) con `INSERT … ON CONFLICT (slug) DO NOTHING`.
- `npm run db:generate` → checksums → `db:generate` dice «No schema changes».

### T2. Servicio de catálogo `lib/services/spare-parts-catalog.ts`
- `listSpareParts({ query?, vehicleId?, includeInactive? })`: lee `products` con `is_spare_part`, búsqueda por nombre/SKU/N° de parte (accent-fold como `product-picker.helpers.ts`). Con `vehicleId`, ordena primero los comprados para ese vehículo (join `purchase_request_items.vehicle_id` + estado no cancelado), luego los comprados para vehículos de la misma marca/modelo (`fuel_vehicles.brand/model`), luego el resto.
- `getSparePartDetail(id)`: ficha + proveedores/precios (`product_suppliers`) + historial (`product_supplier_price_history`) + «Comprado para» (vehículos/marca-modelo agrupados desde `purchase_request_items` → `purchase_order_items`) + últimas OC.
- `createSparePartTx(tx, input)` / `updateSparePart`: valida nombre, unidad activa (`resolveActiveUnitCode`), N° de parte duplicado → error en español «Ya existe el repuesto RPT-012 con ese N° de parte». SKU con `generateUniqueSkus` (`app/(app)/admin/productos/actions/helpers.ts:57`) extendido con prefijo `RPT`.
- `findSparePartByPartNumber(partNumber, brand?)` para sugerir coincidencia al catalogar.
- Suite PGlite `spare-parts-catalog.pglite.test.ts`: orden por vehículo, duplicado, inactivo excluido.

### T3. RBAC, navegación y parity
- `modules/repuestos/manifest.ts`: permiso `repuestos:catalog` («Gestionar catálogo de repuestos»), grants a administrador, secretaria, jefa_chome, jefe_mantencion; espejo en `GRANT_ADDITIONS`.
- Nav: ítem «Catálogo de repuestos», `/mantencion/repuestos`, área `control-operacional`, grupo «Mantención», ícono `Package`, permisos `["repuestos:catalog"]` (patrón de `modules/mantencion-equipos/manifest.ts:57`).
- Revisar `lib/services/module-toggles-routes.ts` (ruta bajo el módulo correspondiente) y los tests de parity de permisos/nav.
- Lectura del catálogo (buscador en la solicitud) permitida a quien tenga `repuestos:create` o `purchasing:create_order`; escritura sólo `repuestos:catalog`, salvo «crear desde la OC» (ver T7).

## Fase B — Pantalla del catálogo

### T4. `/mantencion/repuestos` (lista)
- `PageContainer` + `PageHeader` (título «Catálogo de repuestos», acción «Nuevo repuesto» → `Sheet`). `ROUTES_WITH_OWN_SEARCH` lista rutas puntuales de mantención (no el prefijo `/mantencion`), así que esta ruta **no** se agrega: usar `DataTable` con `searchKeys` (nombre, SKU, N° de parte, marca) alimentado por la TopBar.
- Columnas: Repuesto (nombre + N° de parte/marca en segunda línea), Proveedor preferido, Último precio (`font-mono`), Última compra (`formatDate`), Comprado para (n° equipos). Filtro estructurado: Activos/Inactivos (`SegmentedControl`).
- Estado vacío (A4): «Todavía no hay repuestos en el catálogo. Se agregan al armar una OC de repuestos o desde aquí.» + CTA «Nuevo repuesto».
- Exportar Excel con `ExportButton` en las acciones del header.

### T5. Ficha `/mantencion/repuestos/[id]`
- `width="workbench"`: datos editables (Sheet de edición), proveedores y precio vigente, historial de precio (tabla compacta; sin gráfico salvo que haya ≥3 puntos — evitar ruido), «Comprado para» (marca/modelo → equipos con enlace a `/flota/[id]`), últimas solicitudes/OC con enlaces. Activar/desactivar con `ConfirmDialog`.
- Antes de tocar UI, leer `reference/craft-floor.md` de impeccable y `DESIGN.md`; reutilizar `KpiCard`/`MetricBar` sólo si aporta (A1).

## Fase C — Pedir con catálogo

### T6. Editor de ítem de repuestos
- `app/(app)/solicitudes/item-editor.tsx:225-284`: para `repuestos` (no servicios) el campo descripción pasa a un buscador: reutilizar `ProductPicker` (`product-picker.tsx`) con la lista de repuestos (no la lista completa) y un prop opcional `rankFor(vehicleId)` / lista ya ordenada desde el servidor; conserva la opción «usar texto libre». Al elegir: nombre, N° de parte y marca se muestran como lectura (se ocultan sus inputs) y el precio estimado se precarga con el precio preferido/último si está vacío.
- Las páginas `solicitudes/nueva/page.tsx` y `solicitudes/[id]/page.tsx` cargan `listSpareParts()` sólo si el usuario puede crear repuestos, más un mapa `productId → vehicleIds[]` comprados (pequeño) para ordenar en cliente según el vehículo del ítem.
- `lib/validation/operations.ts` ya acepta `productId`; `persist-draft.ts` deja de forzar `productId: null` para repuestos: valida que el producto exista, esté activo y sea `is_spare_part`; si viene producto, no guarda el atributo «N° de Parte» (sale del producto) ni exige descripción libre (ajustar `lib/validation/repuestos.ts:19-34`).
- `request-form.helpers.ts` / detalle de solicitud: mostrar SKU y N° de parte del producto cuando existe.
- Tests: `item-editor.test.tsx` (elegir repuesto, volver a texto libre, precarga de precio), PGlite de `persist-draft` (rechaza producto no-repuesto o inactivo).

## Fase D — Catalogar al comprar

### T7. Vincular/crear desde el formulario de OC
- `app/(app)/compras/oc-form*`: cada línea de repuesto sin `productId` muestra «Catalogar»; abre un `Sheet` con dos caminos: buscar un repuesto existente (sugerencia automática por N° de parte con `findSparePartByPartNumber`) o crear uno nuevo prellenado desde la descripción y los atributos (N° de parte, marca). Quien tiene `purchasing:create_order` puede **vincular**; **crear** exige `repuestos:catalog` (secretaria y administrador ya tienen ambos).
- `purchase-orders-create.ts:340-356`: al crear la OC, si la línea trae `productId` de repuesto, escribirlo en `purchase_order_items` **y** en el `purchase_request_item` de origen (y en el hermano de compra parcial, `:218-240`), en la misma transacción. Validar `is_spare_part`.
- Precio sugerido: el orden de `oc-form.helpers.ts:33-45` gana un último escalón con el precio del catálogo para el proveedor elegido (ya existe vía `supplierPriceMap` cuando hay `productId`; asegurar que `compras/nueva/page.tsx:163,214` incluya repuestos vinculados en el momento).
- Tests: helpers de OC, PGlite de creación de OC (propaga `productId` a la solicitud; rechaza producto no-repuesto).

### T8. Precio al emitir
- `purchase-orders-status.ts` (`issueAndSendOrder`): dentro de la transacción de `draft → sent`, para cada línea con producto `is_spare_part`, `setProductSupplierPriceTx(tx, { productId, supplierId, unitPrice, source: "purchase_order", sourceId: orderId, rejectOlderThanCurrent: true })`. Sin efecto en EPP ni otros tipos.
- PGlite: emitir dos OC con precios distintos deja dos filas de historial; emitir una OC de EPP no escribe nada.

## Fase E — Recepción y conciliación

### T9. Consumo directo en recepción
- `lib/services/item-state-module/receiving.ts:50`: `!item.productId || product?.isService || product?.isSparePart` → `delivered`.
- `lib/services/receiving.ts:402-422`: no llamar `applyMovementTx` para productos `isSparePart`. El aviso a mantención por `workOrderId` (`:383-386`, `:484`) no cambia.
- PGlite: recepción completa de un repuesto de catálogo → ítem `delivered`, sin filas en `worksite_stock`/`inventory_movements`; la OT deja de «esperar repuesto».

### T10. Conciliación por N° de parte
- `invoices.ts:756-772` expone `partNumber` en la línea de OC; `invoice-item-matching.ts:117`: el paso de código compara el código de factura normalizado contra SKU **o** N° de parte.
- Test unitario del matcher: factura con código del proveedor = N° de parte enlaza la línea correcta; sin N° de parte cae al match por nombre como hoy.

## Fase F — Superficies derivadas
### T11. Historial por equipo y OT
- `vehicle-purchase-history.ts` y `vehicle-purchases-card.tsx`: cuando el ítem tiene producto, mostrar SKU/N° de parte y enlazar a la ficha del repuesto (si el usuario tiene `repuestos:catalog`).
- `OtPartsRequestsSection` (`components/mantencion/jefatura/ot/ot-sections.tsx:144-240`): idem en la columna Repuesto.

---

## Verificación
- Puertas: `npm run typecheck`, `npm run lint`, `npm run test:fast`, `npm run test:pglite -- <suite>` de a una (contra el contenedor :55432), `npm run db:verify-migrations`, `npm run check:secrets`.
- E2E nuevo `e2e/repuestos-catalogo.spec.ts`:
  1. jefe_mantencion crea «QA_Filtro de aceite» (N° de parte QA-123) en `/mantencion/repuestos`; un duplicado de N° de parte se rechaza con mensaje.
  2. Desde una OT, «Pedir repuestos», elige el repuesto del buscador (aparece primero para ese vehículo tras una compra previa), precio precargado, envía bajo umbral.
  3. Aprobación sin cotización → secretaria arma la OC; otra línea en texto libre se «Cataloga» creando un repuesto nuevo → la solicitud queda con `productId`.
  4. Emitir la OC → la ficha muestra el precio y la línea de historial.
  5. Recepción en faena → ítem «Entregado», sin movimiento en Bodega; la OT deja de esperar.
  6. Un rol sin `repuestos:catalog` no ve el ítem de nav y recibe 403/redirect en `/mantencion/repuestos` (autorización en servidor, no sólo nav).
- Correr también `e2e/repuestos-servicios-oc-flow.spec.ts`, `e2e/ot-repuestos.spec.ts` y `e2e/repuestos-servicios-flow.spec.ts` (regresión del texto libre).
- Recorrido en navegador sobre `bodega_dev` (migrar + `db:sync-rbac`, reiniciar `next dev`), escritorio y móvil, consola y red limpias; informe en `qa/reports/catalogo-repuestos-2026-11-XX.md` con alcance y huecos.

## Riesgos
- Cambiar la regla de recepción afecta a cualquier producto `is_spare_part`: el CHECK impide que un EPP o servicio lo sea.
- `ProductPicker` carga la lista en cliente; si el catálogo pasa de ~2.000 repuestos, migrar a búsqueda en servidor (anotar como seguimiento).
- Despliegue: migración nueva + `sync-rbac` (GRANT_ADDITIONS) en prod, lo corre el usuario.
