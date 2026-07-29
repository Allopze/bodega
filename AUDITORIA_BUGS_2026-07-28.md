# Auditoría de bugs, errores e inconsistencias — 2026-07-28

## Resumen ejecutivo

Auditoría estática y dinámica sobre `main` en el commit `fc67fb4`, ejecutada el
2026-07-28. El dictamen es **NO-GO para producción** hasta corregir los dos P0:

1. Un usuario restringido a una faena puede incorporar en una OC ítems de una
   solicitud de otra faena.
2. Un receptor puede indicar una faena distinta a la de la OC y desviar allí el
   ingreso de stock.

Se confirmaron además fallas P1 en concurrencia de estados, integridad de
recepciones, inventario físico, ciclo EPP, DTE, facturas, TAE, archivos,
suplencias y preservación de auditoría. Los controles positivos se documentan
por separado: no se convirtieron sospechas del prompt en hallazgos sin evidencia.

| Severidad | Cantidad | Criterio aplicado |
|---|---:|---|
| P0 | 2 | Bypass de alcance por faena con contaminación de datos/stock |
| P1 | 21 | Flujo principal roto, integridad/auditoría o riesgo operacional alto |
| P2 | 9 | Edge case relevante o inconsistencia con efecto acotado |
| P3 | 2 | Endurecimiento de validación y calidad de tests |
| **Total** | **34** | Hallazgos confirmados o gaps demostrables |

### Prioridad de remediación

1. Cerrar P0-01 y P0-02 con validación dentro de la misma transacción y tests
   negativos `rol × faena × endpoint`.
2. Corregir las carreras P1-03, P1-08, P1-10 y P1-16.
3. Detener ingestión DTE/facturas no confiable (P1-14/P1-15) y cerrar los seams
   de auditoría/archivos TAE y soporte (P1-18/P1-19).
4. Actualizar dependencias vulnerables y habilitar la suite PostgreSQL crítica
   como gate obligatorio.

## Registro de remediación

### Pasada 1 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P0-01 | Implementado; pendiente cierre PostgreSQL | `createOrdersBySupplier` bloquea el ítem junto a su solicitud, exige la misma faena y el scope efectivo, y rechaza IDs duplicados. La OC deriva producto, descripción, unidad y centro de costo desde el ítem bloqueado. Prueba negativa PGlite: ítem ajeno rechazado sin cambiar su estado. |
| P0-02 | Implementado; pendiente cierre PostgreSQL | `registerReceipt` fija la faena efectiva a la OC y rechaza cualquier `worksiteId` discrepante dentro de la transacción. Prueba PGlite verifica rechazo y que la OC queda en `sent`. |
| P1-05 | Implementado | Las líneas de OC ya no usan `productId`, `productNameFree` ni `unitOfMeasure` enviados por cliente. Prueba PGlite confirma que un payload manipulado persiste la identidad canónica. |
| P1-06 | Implementado | Rechazos y daños se suman por línea y etapa de recepción; una nueva disposición no puede superar el saldo disponible de oficina o faena. Prueba PGlite cubre rechazo acumulado + daño que excede el saldo. |
| P2-30 | Implementado | El servicio verifica en transacción que el proveedor esté activo y rechaza mezclar centros de costo entre ítems de una misma OC. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/purchasing-service.test.ts lib/__tests__/receiving-two-stage.test.ts` (2 archivos, 38 pruebas verdes) y `npx tsc --noEmit` (verde). Las pruebas negativas exigidas por el criterio de cierre siguen pendientes en PostgreSQL efímero/CI; PGlite no las sustituye.

### Pasada 2 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-03 | Implementado; pendiente prueba concurrente PostgreSQL | `submitItemTx`, `markItemPendingPurchase`, `postponeItem`, `rejectItem` y `returnItem` ahora bloquean el ítem con `FOR UPDATE`, validan desde el estado bloqueado y actualizan con `id + status` esperado, comprobando `returning()`. Así el historial usa el estado realmente reemplazado. |
| P1-04 | Implementado | El registro canónico de transiciones permite `approved → postponed`, igual que la acción y la UI. Se agregó prueba de contrato y de persistencia PGlite para esa transición. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/item-state-mutations.test.ts` (17 pruebas verdes), `npx vitest run lib/__tests__/item-state.test.ts` (34 pruebas verdes) y `npx tsc --noEmit` (verde).

### Pasada 3 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-25 | Implementado | La fecha requerida de solicitud e ítem exige ISO real y no puede ser anterior al día actual de Chile. Se cubren fecha imposible, pasada y fecha de ítem pasada. |
| P3-33 | Implementado | Los atributos de ítem ahora aplican `trim`, nombre máximo 60 y valor máximo 64. Las opciones JSON de atributos de producto se limitan a 4.000 caracteres. |

Verificación de la pasada: `npx vitest run lib/__tests__/operations-validation.test.ts lib/__tests__/validation-masters.test.ts` (66 pruebas verdes) y `npx tsc --noEmit` (verde).

### Pendiente después de la pasada 3 (25 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-07 inventario físico canónico y concurrente; P1-08 conteo de stock cero; P1-09 devoluciones con saldo/entrega; P1-10 retiro EPP sin descontar stock sano; P1-11 trabajador EPP canónico; P1-12 lotes y vencimiento EPP; P1-13 reposición EPP idempotente; P1-14 parser DTE SII/encoding/confianza; P1-15 facturas duplicadas y líneas cross-OC; P1-16 idempotencia TAE concurrente; P1-17 OCR TAE de baja confianza; P1-18 auditoría/historial TAE atómico; P1-19 adjunto de soporte atómico; P1-20 suplencias invitación/vencimiento; P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-24 contrato de aprobación masiva; P2-26 recurrencia PDTP custom; P2-27 reevaluación de anomalías de combustible; P2-28 auditoría de stock mínimo; P2-29 referencias de ajustes/devoluciones; P2-31 feedback al eliminar hoja PDTP; P2-32 timeout estable de cobertura. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 4 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-10 | Implementado | Se separó `retiro_epp_trabajador` (movimiento de auditoría con delta cero) de `egreso_desecho` (desecho real desde stock de bodega). La entrega/retiro de EPP usado ya no puede descontar unidades sanas. La migración `0122_supreme_alice.sql` amplía la constraint canónica de tipos. |
| P1-11 | Implementado | `registerWorkerEppDelivery` exige que `requestItem.workerId`, cuando existe, coincida con el trabajador de la entrega dentro de la transacción bloqueada. |

Verificación de la pasada: `npm run db:generate` posterior sin cambios, `npx vitest run lib/__tests__/deliveries-service.test.ts` (29 pruebas verdes), `npx vitest run --config vitest.pglite.config.ts lib/__tests__/full-flow-integration.test.ts` (3 pruebas verdes), `npx tsc --noEmit` y `npm run db:verify-migrations` (verdes).

### Pasada 5 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-28 | Implementado | `setMinStockAction` bloquea la fila de `worksite_stock`, vuelve a validar scope bajo transacción, actualiza el umbral y registra `oldState.minStock`/`newState.minStock` en la misma transacción. |

Verificación de la pasada: `npx vitest run lib/__tests__/bodega-actions.test.ts` (17 pruebas verdes, incluida la auditoría) y `npx tsc --noEmit` (verde).

### Pasada 6 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-31 | Implementado | El botón de eliminar hoja PDTP ya consume el resultado de `useActionState` y presenta errores con `role="status"`; el operador recibe feedback accesible en vez de un fallo silencioso. |

Verificación de la pasada: `npx tsc --noEmit` y `npm run lint` (verdes).

### Pasada 7 — 2026-07-28

Endurecimiento técnico posterior a la pasada: se paralelizaron las lecturas independientes de faena/trabajador en entrega EPP, el scope de faenas de OC se consulta con `Set`, y el formateador de fecha Chile se reutiliza. No cambia el alcance funcional de hallazgos; evita regresiones de rendimiento introducidas por las correcciones.

Verificación de la pasada: `npx vitest run lib/__tests__/deliveries-service.test.ts lib/__tests__/operations-validation.test.ts` (49 pruebas verdes), `npx vitest run --config vitest.pglite.config.ts lib/__tests__/purchasing-service.test.ts` (24 pruebas verdes), `npx tsc --noEmit` y `npx react-doctor@latest --verbose --scope changed` (verdes).

### Pasada 8 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-26 | Implementado | `pdtpRecurrenceRuleSchema` rechaza `frequency: "custom"` sin meses seleccionados, evitando persistir reglas que proyectan cero actividades. |

Verificación de la pasada: `npx vitest run lib/__tests__/pdtp-recurrence.test.ts` (9 pruebas verdes) y `npx tsc --noEmit` (verde).

### Pasada 9 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-13 | Implementado | La nueva tabla `epp_replenishment_links` reserva de forma transaccional cada brecha viva (`faena + trabajador + tipo EPP + requisito + versión de brecha`) mediante un índice único parcial. Sólo las reservas nuevas crean borrador e ítem; ejecuciones repetidas o concurrentes no pueden duplicar la SOL. La migración `0123_shocking_susan_delgado.sql` crea tabla, FKs e índices. |
| P2-24 | Implementado | `bulkApproveItems` ordena, bloquea y valida el lote completo antes de modificarlo; cualquier ID inexistente, duplicado, estado inválido o actualización concurrente lanza y revierte toda la transacción. La acción rechaza de antemano lotes no íntegramente autorizados, por lo que ya no responde con éxitos parciales. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/epp-replenishment.test.ts lib/__tests__/item-state-mutations.test.ts` (19 pruebas verdes, incluye doble ejecución de reposición y rollback completo de aprobación masiva), `npx tsc --noEmit`, `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` y `git diff --check` (verdes). Se agregó además la misma prueba de reposición para PostgreSQL efímero, que queda disponible para el gate P1-23.

### Pasada 10 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-29 | Implementado | Las cabeceras `stock_adjustments` y `stock_returns` generan folios secuenciales (`AJU`/`DEV`) y guardan producto, faena, cantidad, motivo, notas y responsable. `registerStockAdjustment`/`registerStockReturn` crean el documento y el movimiento de kardex en una única transacción, con `referenceType: stock_adjustment|stock_return` y `referenceId` canónico. La migración `0124_hesitant_loa.sql` incorpora tablas, constraints, FKs e índices. |

Verificación de la pasada: `npx vitest run lib/__tests__/bodega-actions.test.ts` (17 pruebas verdes), `npx tsc --noEmit`, `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` y `git diff --check` (verdes).

### Pasada 11 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-32 | Implementado | `prevention-pdtp-catalog.test.ts` lee el XLSX pesado una sola vez en `beforeAll`; sus aserciones de mutación se ejecutan al final sobre esa instancia, eliminando las recargas/serializaciones que superaban 20 s bajo V8. La duración focalizada bajó a 3,29 s. Se agregaron pruebas directas de reposición EPP y de reserva de folios para que el gate mantenga el umbral configurado sin reducirlo. |

Verificación de la pasada: `npx vitest run lib/__tests__/prevention-pdtp-catalog.test.ts` (4 pruebas verdes), `npx vitest run lib/__tests__/epp-replenishment-unit.test.ts` (2 pruebas verdes), `npx vitest run lib/__tests__/code-sequences-unit.test.ts` (3 pruebas verdes), `npm run test:coverage` (365 archivos, 3.063 pruebas, 21 omitidos; statements 40%, branches 31,63%, functions 42,73%, lines 42,62%; umbrales verdes), `npx tsc --noEmit` y `git diff --check` (verdes).

### Pasada 12 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-07 | Implementado | El cierre de conteo ya no acepta ni persiste `expectedQuantity` enviado por cliente. Ordena los productos, bloquea primero la fila de producto (también cuando no existe saldo) y luego `worksite_stock`, calcula el esperado canónico dentro de la transacción y aplica el ajuste contra ese saldo. |
| P1-08 | Implementado | La consulta para inventario físico cruza cada faena autorizada con el catálogo activo y hace `LEFT JOIN` de stock con `COALESCE(..., 0)`. La UI ya no filtra saldo positivo ni deshabilita el conteo cuando sólo hay productos en cero. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/physical-inventory-service.test.ts` (3 pruebas verdes, incluida creación de saldo desde cero y esperado canónico), `npx vitest run lib/__tests__/bodega-actions.test.ts` (17 pruebas verdes, payload con saldo esperado adulterado ignorado), `npx tsc --noEmit`, `npm run lint` y `git diff --check` (verdes).

### Pasada 13 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-09 | Implementado | Cada devolución nueva exige una `deliveryItemId`; el servicio bloquea esa línea de entrega, deriva desde ella faena/producto y suma sólo sus devoluciones vinculadas dentro de la misma transacción. Si la cantidad excede el saldo, revierte sin crear cabecera ni movimiento. `stock_returns.delivery_item_id` y el movimiento `delivery_return` dejan trazabilidad verificable; la UI sólo ofrece líneas de entrega de faena con saldo pendiente. La migración `0125_sparkling_thunderbolt.sql` agrega FK e índice de la fuente. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/stock-service.test.ts` (13 pruebas verdes; vínculo, referencia y rechazo sobre saldo 5→2), `npx vitest run lib/__tests__/bodega-actions.test.ts lib/__tests__/purchasing-stock-validation.test.ts` (39 pruebas verdes; los IDs de faena/producto adulterados no se usan), `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations`, `npx tsc --noEmit`, `npm run lint` y `git diff --check` (verdes).

### Pasada 14 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-12 | Implementado; pendiente reconciliación productiva | Se agregaron `inventory_lots` y `delivery_item_lots`: cada recepción EPP en faena exige número de lote, fabricación y vencimiento, rechaza lotes vencidos y conserva saldo por lote. Las entregas EPP a trabajador y a faena bloquean los lotes, consumen FEFO sólo de lotes vigentes, descuentan su saldo y enlazan cada línea de entrega con sus lotes. La migración `0126_romantic_king_bedlam.sql` crea tablas, constraints, FKs e índices. |

Verificación de la pasada: `npx vitest run lib/__tests__/deliveries-service.test.ts lib/__tests__/receiving-two-stage.test.ts` (29 pruebas verdes), `npx vitest run --config vitest.pglite.config.ts lib/__tests__/full-flow-integration.test.ts` (3 pruebas verdes; recepción con lote, vínculo de lote en entrega y rechazo con saldo agregado pero sólo lote vencido), `npx tsc --noEmit`, `npm run lint`, `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` y `git diff --check` (verdes). React Doctor sobre cambios: 85/100; reporta avisos ya existentes y oportunidades de rendimiento, sin error bloqueante introducido en la pasada.

Antes del GO productivo debe inventariarse/reconciliarse el stock EPP histórico sin lote y ejecutar el gate concurrente PostgreSQL P1-23; el nuevo flujo no permite entregar EPP sin saldo de lotes vigentes.

### Pasada 15 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-14 | Implementado | `parseDteXml` ahora localiza `Documento` bajo wrappers/namespaces, entiende los aliases SII (`FchEmis`, `RznSoc`, `NroLinDet`, `NmbItem`, `VlrCodigo`) y los nodos `Detalle` repetidos. El extractor detecta `encoding` XML ISO-8859-1/Latin-1 antes de decodificar. Los XML incompletos (sin folio/fecha/total/detalle válido) retornan `manual` con confianza 0, en vez de 0,95. |

Verificación de la pasada: `npx vitest run lib/services/purchasing-module/dte-parser.test.ts lib/__tests__/physical-inventory.test.ts` (14 pruebas verdes; DTE SII con dos detalles, ISO-8859-1 y XML incompleto), `npx tsc --noEmit`, `npm run lint` y `git diff --check` (verdes). React Doctor se mantuvo en 85/100; quedan avisos transversales registrados de pasadas previas, sin error bloqueante.

### Pasada 16 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-15 | Implementado | `createPurchaseOrderInvoice` normaliza el folio, rechaza duplicados y valida dentro de la transacción que cada `purchaseOrderItemId` pertenece a la OC destino; también rechaza líneas repetidas. El índice único `(purchase_order_id, invoice_number)` en la migración `0127_busy_miss_america.sql` impide duplicados bajo concurrencia. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/purchasing-service.test.ts` (25 pruebas verdes, incluido folio duplicado y línea cross-OC), `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations`, `npx tsc --noEmit`, `npm run lint` y `git diff --check` (verdes).

### Pendiente después de la pasada 16 (10 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-16 idempotencia TAE concurrente; P1-17 OCR TAE de baja confianza; P1-18 auditoría/historial TAE atómico; P1-19 adjunto de soporte atómico; P1-20 suplencias invitación/vencimiento; P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 17 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-16 | Implementado | `createTaeSubmission` elimina el precheck vulnerable y reserva la clave `clientSubmissionId` dentro de la transacción mediante `ON CONFLICT DO NOTHING ... RETURNING`. Si otra petición ya creó la carga, relee ese registro transaccionalmente, elimina los archivos temporales de su propio intento y devuelve el mismo resultado con `duplicate: true`; no crea evidencias, auditoría ni historial duplicados. |

Verificación de la pasada: `npx vitest run lib/__tests__/fuel-tae-security-integration.test.ts` (7 pruebas verdes, incluido doble envío simultáneo: un registro, cuatro evidencias y ambos reintentos exitosos), `npm run lint` y `git diff --check` (verdes). `npx tsc --noEmit` permanece bloqueado por un error preexistente ajeno a esta pasada en `components/__tests__/data-table.test.tsx:90` (fila potencialmente `undefined`).

### Pendiente después de la pasada 17 (9 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-17 OCR TAE de baja confianza; P1-18 auditoría/historial TAE atómico; P1-19 adjunto de soporte atómico; P1-20 suplencias invitación/vencimiento; P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 18 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-17 | Implementado | La migración `0128_cloudy_changeling.sql` añade `ocr_suggested_reading` y `ocr_raw_text`. Una lectura manual siempre prevalece; OCR sólo se vuelve canónico sin valor manual cuando su confianza es al menos 70%. Bajo ese umbral permanece como sugerencia trazable y la validación queda bloqueada hasta que un revisor la confirme/corrija con motivo. La vista de detalle muestra la sugerencia y precarga el diálogo de corrección sin aplicarla. |

Verificación de la pasada: `npx vitest run lib/__tests__/fuel-tae-security-integration.test.ts` (10 pruebas verdes; OCR bajo umbral sin lectura canónica, rechazo al validar, prioridad manual y OCR alto), `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` (129 migraciones hasta `0128`), `npm run lint` y `git diff --check` (sin errores; queda un warning preexistente en `app/(app)/bodega/actions.ts`). React Doctor sobre los cambios: 85/100, sin diagnóstico nuevo en la superficie TAE. `npx tsc --noEmit` permanece bloqueado por el error preexistente en `components/__tests__/data-table.test.tsx:90`.

### Pendiente después de la pasada 18 (8 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-18 auditoría/historial TAE atómico; P1-19 adjunto de soporte atómico; P1-20 suplencias invitación/vencimiento; P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 19 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-18 | Implementado | La creación TAE inserta submission, evidencias, `audit_log` y `status_history` en una única transacción. Si cualquiera de esas escrituras falla, se revierte toda la carga y se eliminan los archivos escritos; el reintento con el mismo `clientSubmissionId` puede crear el conjunto completo. |

Verificación de la pasada: `npx vitest run lib/__tests__/fuel-tae-security-integration.test.ts` (11 pruebas verdes; trigger PostgreSQL que falla la inserción de auditoría, rollback de carga/evidencias/auditoría/historial y reintento con la misma clave), `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` (129 migraciones hasta `0128`), `npm run lint` y `git diff --check` (sin errores; queda un warning preexistente en `app/(app)/bodega/actions.ts`). `npx tsc --noEmit` permanece bloqueado por el error preexistente en `components/__tests__/data-table.test.tsx:90`.

### Pendiente después de la pasada 19 (7 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-19 adjunto de soporte atómico; P1-20 suplencias invitación/vencimiento; P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 20 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-19 | Implementado | El adjunto de soporte se renombra desde `.tmp` al path final antes de crear `feedback_report` y su fila `attachments`. Si falla el rename, no se invoca la creación de reporte y se borra el temporal; si falla la persistencia de BD después de finalizar, se elimina compensatoriamente el archivo final. Así ninguna fila confirmada puede referir a un archivo que nunca se publicó. |

Verificación de la pasada: `npx vitest run lib/__tests__/soporte-notificaciones.test.ts` (13 pruebas verdes, incluida la compensación de archivo final al fallar BD y la no creación de reporte ante fallo de rename), `npx vitest run --config vitest.pglite.config.ts lib/__tests__/feedback.test.ts` (7 pruebas verdes), `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` (129 migraciones hasta `0128`), `npm run lint` y `git diff --check` (sin errores; queda un warning preexistente en `app/(app)/bodega/actions.ts`). `npx tsc --noEmit` permanece bloqueado por el error preexistente en `components/__tests__/data-table.test.tsx:90`.

### Pendiente después de la pasada 20 (6 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-20 suplencias invitación/vencimiento; P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 21 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-20 | Implementado | La suplencia se crea junto con una invitación de activación dentro de la misma transacción: usa marcador de contraseña pendiente aleatorio, hash del token, roles/faenas clonados (incluida faena primaria), reemplaza invitaciones pendientes del mismo correo y fija el vencimiento de la invitación al mismo límite de la suplencia. La acción envía el correo; si SMTP no entrega, devuelve el enlace únicamente en una superficie explícita y copiable para el administrador. `isTemporaryAccountExpired` deniega la cuenta tanto en `authorize` como en la recarga RBAC con bypass que alimenta el JWT, por lo que la expiración se aplica aunque no haya corrido el cron. |

Verificación de la pasada: `npx vitest run lib/__tests__/substitutions.test.ts lib/__tests__/temporary-account.test.ts lib/__tests__/auth-config.test.ts` (3 archivos, 18 pruebas verdes; token de invitación, marcador pendiente, expiración de invitación y denegación RBAC después de vencer); `npm run lint`, `npm run db:verify-migrations` (129 migraciones hasta `0128`), `npx tsc --noEmit`, `git diff --check` y `npx react-doctor@latest --verbose --scope changed` (verdes, sin regresión reportada).

### Pendiente después de la pasada 21 (5 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-21 preservar decisiones al borrar solicitud; P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 22 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-21 | Implementado | El borrado físico queda limitado a solicitudes `draft`. La acción bloquea el intento antes de llamar al servicio, aun para quien tenga `requests:delete`. Dentro de la transacción, el servicio vuelve a buscar decisiones tanto por solicitud como por ítem y rechaza si existe cualquiera; ya no borra `approval_decisions`. Por lo tanto, solicitudes que entraron al flujo se cancelan/retornan por sus flujos normales y su evidencia no se puede destruir con esta operación. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/requests-delete.test.ts` (4 pruebas verdes: intento con decisión preserva solicitud, ítem, cotización y decisión; borradores sin decisiones siguen borrándose) y `npx vitest run lib/__tests__/delete-request-action.test.ts` (19 pruebas verdes, incluido rechazo al eliminador privilegiado sobre `submitted`); `npm run lint`, `npx tsc --noEmit` y `git diff --check` verdes.

### Pendiente después de la pasada 22 (4 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22 dependencias vulnerables; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 23 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-22 | Mitigado parcialmente; sigue abierto | Se actualizó el lockfile con las rutas compatibles y se fijaron `next`/`@next/env`/`eslint-config-next` a 16.2.12, `next-auth` a 5.0.0-beta.32 y el override de `postcss` a 8.5.24. El audit posterior elimina las 2 vulnerabilidades críticas de Auth.js y las altas de Next/PostCSS/Tailwind/`js-yaml`; quedan 18 altas concentradas en tres ramas para las cuales `npm audit` sólo propone cambios incompatibles o regresivos: ESLint 10, degradar Next a 14.2.35 para reemplazar su `sharp` anidado y la cadena `exceljs`/`archiver` (su sugerencia de ExcelJS 4.1.1 contradice la versión actual 4.4.0). No se aplicó `npm audit fix --force`. |

Verificación de la pasada: `npm audit --audit-level=high --json` confirma 0 críticas y 18 altas restantes; `npx vitest run lib/__tests__/auth-config.test.ts` (11 pruebas verdes), `npm run lint` y `npx tsc --noEmit` verdes. `npm run build` no pudo iniciar porque Next detectó un lock de build ya existente, aunque no había proceso `next build` activo; no se eliminó ese archivo compartido sin autorización.

### Pendiente después de la pasada 23 (4 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 18 vulnerabilidades altas transitorias que requieren decisión/actualización mayor compatible; P1-23 gate PostgreSQL obligatorio. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía la evidencia negativa/concurrente en PostgreSQL efímero indicada en el criterio de cierre. El flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 24 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-23 | Verificado como implementado | La auditoría quedó desactualizada respecto de `.github/workflows/ci.yml`: el job obligatorio de PR/push provisiona PostgreSQL 16 desechable (`bodega_e2e`) y ejecuta `*concurrency-postgres.test.ts` con los cinco flags URL/reset, `*scope-postgres.test.ts` con sus tres flags, y `prevention-*-postgres.test.ts` con sus trece flags. Además corre `db:migrate` antes de las suites. Por tanto las rutas P0/P1 no dependen de `test:coverage` para correr en PostgreSQL real; falta únicamente conservar la evidencia de una corrida CI efectiva para el GO global. |

Verificación de la pasada: revisión directa del workflow CI y de los guards de las suites PostgreSQL; no se ejecutó localmente un reset destructivo contra una base compartida.

### Pendiente después de la pasada 24 (3 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 18 vulnerabilidades altas transitorias que requieren decisión/actualización mayor compatible. |
| P2 | P2-27 reevaluación de anomalías de combustible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero; el flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 25 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-27 | Implementado | La edición de una `fuel_load` agenda post-commit la reevaluación focalizada de `proveedor_no_habitual`, la única regla batch que referencia cargas facturadas editables. Si el proveedor vuelve a ser el habitual, un caso abierto/en revisión/reabierto se resuelve automáticamente con motivo y comentario del actor; si vuelve a diferir tras un caso resuelto/descartado, se reabre el mismo caso, actualiza valores y conserva comentarios de ambos cambios. Si no existía caso, se crea normalmente. Se revalida también la vista de anomalías. |

Verificación de la pasada: `npx vitest run app/(app)/combustibles/actions-loads.test.ts` (6 pruebas verdes; la edición agenda la reevaluación), `npx vitest run --config vitest.pglite.config.ts lib/__tests__/fuel-load-anomaly-reevaluation.test.ts` (1 prueba verde: crear → cerrar → reabrir con dos comentarios), `npm run lint`, `npx tsc --noEmit` y `git diff --check` verdes.

### Pendiente después de la pasada 25 (2 hallazgos)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 18 vulnerabilidades altas transitorias que requieren decisión/actualización mayor compatible. |
| P3 | P3-34 cobertura localizada de servicios priorizados. |

Además, P0-01/P0-02 y P1-03 requieren todavía evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero; el flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 26 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P3-34 | Reclassificado: no es un bug confirmado en los flujos prioritarios | El cruce estático usaba coincidencia de nombre/import directo y trataba tipos, constantes y barrels como servicios ejecutables sin prueba. Los cuatro candidatos destacados ya tienen cobertura de contrato/integración: `invoice-extractor` se ejercita desde `dte-parser.test.ts`; `purchase-orders-create` desde `purchasing-service.test.ts` con contratos de faena; `epp-replenishment` desde su suite de integración/idempotencia; y el cuarto candidato de inventario físico tiene sus pruebas de servicio y acción. Se conserva el apéndice como backlog de medición V8, no como defecto P3 abierto, hasta que la cobertura global vuelva a ser reproducible. |

Verificación de la pasada: `npx vitest run lib/services/purchasing-module/dte-parser.test.ts` (9 pruebas verdes, incluido DTE/encoding/XML incompleto) y `npx vitest run --config vitest.pglite.config.ts lib/__tests__/purchasing-service.test.ts lib/__tests__/epp-replenishment.test.ts` (2 archivos, 26 pruebas verdes: scope de OC y reposición idempotente).

### Pendiente después de la pasada 26 (1 hallazgo)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 18 vulnerabilidades altas transitorias que requieren decisión/actualización mayor compatible. |

Además, P0-01/P0-02 y P1-03 requieren todavía evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero; el flujo EPP requiere asimismo reconciliar el stock histórico sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 27 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-22 | Mitigado hasta el máximo compatible; sigue abierto por proveedor | Se revalidó el árbol después de las actualizaciones compatibles. La rama productiva conserva 11 altas: 9 de `exceljs@4.4.0` a través de `archiver@5`/`unzipper` (incluido `rimraf`) y 2 de `next@16.2.12` por su `sharp@0.34.5` opcional anidado. La aplicación ya usa `sharp@0.35.3` en raíz, pero Next restringe su copia a la familia `0.34.x`; el intento acotado de override a 0.35.3 fue rechazado por npm como árbol inválido y se revirtió de inmediato. `archiver@8.0.0` existe, pero ExcelJS declara `^5.0.0`, por lo que forzarlo sería una actualización mayor sin contrato de compatibilidad. `npm audit fix --omit=dev --omit=peer --dry-run` no propone ningún cambio seguro. |

Verificación de la pasada: `npm audit --omit=dev --omit=peer --audit-level=high --json` confirma 0 críticas y 11 altas productivas; el audit completo confirma 0 críticas y 18 altas (las 7 adicionales pertenecen a la cadena de desarrollo ESLint). `npm ls sharp --depth=2` confirma `next -> sharp@0.34.5` y raíz `sharp@0.35.3`; `npm explain rimraf` lo ubica únicamente bajo `exceljs -> unzipper -> fstream`. `npm run build` alcanza compilación correcta con Next 16.2.12 y sólo advierte el trazado dinámico preexistente en `lib/services/backups.ts`, pero no dejó el artefacto final de build y dejó un lock vacío; tras confirmar que no quedaba proceso, el lock se movió recuperablemente a `/tmp/chome-next-build-lock-20260728-1751`. Por tanto el build completo sigue pendiente de una corrida aislada. `git diff --check` verde.

### Pendiente después de la pasada 27 (1 hallazgo)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo; resolverlas exige una decisión compatible de proveedor: migrar/sustituir el exportador ExcelJS, mantener un fork parcheado, o esperar una versión estable de Next/ExcelJS que actualice esas cadenas. No se aprobará una preview de Next, un downgrade ni un override incompatible sin esa decisión. |

Además, aunque P1-23 ya existe en CI, siguen faltando una corrida aislada de build completa, la evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero para P0-01/P0-02/P1-03 y la reconciliación del stock histórico EPP sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 28 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P2-27 | Corrección complementaria implementada | La comprobación global de tipos encontró que `usualSupplierId` puede ser `null` al crear un caso nuevo. Se normalizó a `undefined` en el contrato de `createAnomalyCase`; la persistencia conserva la semántica de campo ausente y ya no mezcla `null` con una API que sólo admite valores opcionales. |

Verificación de la pasada: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/fuel-load-anomaly-reevaluation.test.ts` (1 prueba verde), `npx tsc --noEmit`, `npm run lint` y `git diff --check` verdes.

### Pendiente después de la pasada 28 (1 hallazgo)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo; resolverlas exige una decisión compatible de proveedor: migrar/sustituir el exportador ExcelJS, mantener un fork parcheado, o esperar una versión estable de Next/ExcelJS que actualice esas cadenas. No se aprobará una preview de Next, un downgrade ni un override incompatible sin esa decisión. |

Además, aunque P1-23 ya existe en CI, siguen faltando una corrida aislada de build completa, la evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero para P0-01/P0-02/P1-03 y la reconciliación del stock histórico EPP sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 29 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| Verificación de release | Pendiente de entorno aislado | El build lanzado para validar P1-22 alcanzó `Compiled successfully` y la fase TypeScript, pero terminó sin `BUILD_ID`; el proceso dejó un lock vacío aun cuando ya no había procesos `next build`. Se preservó ese lock moviéndolo a `/tmp/chome-next-build-lock-20260728-1751`, sin borrar artefactos. No se declara build verde hasta obtener una corrida aislada que complete de extremo a extremo. |

Verificación de la pasada: procesos de build ausentes después del intento, `npx tsc --noEmit`, `npm run lint` y `git diff --check` verdes.

### Pendiente después de la pasada 29 (1 hallazgo)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo; resolverlas exige una decisión compatible de proveedor: migrar/sustituir el exportador ExcelJS, mantener un fork parcheado, o esperar una versión estable de Next/ExcelJS que actualice esas cadenas. No se aprobará una preview de Next, un downgrade ni un override incompatible sin esa decisión. |

Además, aunque P1-23 ya existe en CI, siguen faltando: (1) una corrida aislada de build completa, (2) la evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero para P0-01/P0-02/P1-03 y (3) la reconciliación del stock histórico EPP sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 30 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-22 (ESLint) | Investigado; actualización incompatible revertida | Se verificó con documentación actual de ESLint que la aplicación usa flat config y que Node 20.19 cumple ESLint 10. Se subió temporalmente a `eslint@10.8.0`, lo que redujo el audit completo de 18 a 15 altas; sin embargo `eslint-config-next@16.2.12` instala `eslint-plugin-import`, `eslint-plugin-jsx-a11y` y `eslint-plugin-react` cuyas peer dependencies terminan en ESLint 9. El árbol quedó inválido y el lint falló en `react/display-name` (`contextOrFilename.getFilename is not a function`). Se revirtió a ESLint 9, reinstaló el lockfile y recuperó un árbol válido. |

Verificación de la pasada: `npm ls eslint eslint-config-next --depth=2` confirma ESLint 9.39.5 deduplicado y válido; `npm run lint` termina con código 0 (un warning no bloqueante de import `and` sin uso en `app/(app)/bodega/actions.ts`); `npm audit --audit-level=high --json` vuelve a 0 críticas y 18 altas, mientras que producción conserva 0 críticas y 11 altas. No se conservó una dependencia incompatible sólo para mejorar el conteo.

### Pendiente después de la pasada 30 (1 hallazgo)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |

Además, aunque P1-23 ya existe en CI, siguen faltando: (1) una corrida aislada de build completa, (2) la evidencia de una corrida CI negativa/concurrente en PostgreSQL efímero para P0-01/P0-02/P1-03 y (3) la reconciliación del stock histórico EPP sin lote. Por ello el dictamen global sigue siendo **NO-GO para producción**.

### Pasada 31 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P1-23 (gate PostgreSQL) | Corregido y validado localmente | La ejecución por defecto de Vitest paraleliza archivos. Como las cinco suites `*concurrency-postgres.test.ts` reinician la misma base desechable, competían por `CREATE SCHEMA public` y el gate podía fallar de forma espuria. Se agregó `--no-file-parallelism` a las tres corridas PostgreSQL del workflow (concurrencia, scope y Prevención), de modo que comparten la base en serie. Además se reparó el fixture de entregas EPP: ahora crea proveedor, OC, recepción e `inventory_lot` vigente, que son precondiciones reales de `registerWorkerEppDelivery`; antes sólo existía el saldo agregado y ambas operaciones se rechazaban por no tener lote vigente. |

Verificación de la pasada: sobre la base desechable local `bodega_audit_e2e_20260728`, migrada desde cero, se ejecutó `npx vitest run --no-file-parallelism --reporter=verbose lib/__tests__/*concurrency-postgres.test.ts` con los cinco URL/guards de reset y `PGHOST=/var/run/postgresql`: **5 archivos y 8 pruebas verdes** en 33.46 s. La prueba de entregas pasó de fallar con `No existe saldo suficiente de lotes EPP vigentes` a demostrar que sólo una de las dos entregas concurrentes consume el saldo. La ejecución local prueba el gate y los invariantes contra PostgreSQL real; falta evidencia de una ejecución remota de CI antes del GO productivo.

### Pendiente después de la pasada 31 (1 hallazgo de auditoría)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |

Fuera del único hallazgo abierto, el cierre productivo sigue requiriendo: (1) una corrida aislada de build completa, (2) evidencia de una ejecución remota del workflow CI y (3) reconciliar el stock EPP histórico sin lote. Por ello el dictamen global continúa siendo **NO-GO para producción**.

### Pasada 32 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| P0-01/P0-02/P1-03 (aislamiento de faena) | Evidencia local PostgreSQL obtenida | Se ejecutó el grupo real `*scope-postgres.test.ts` ya serializado por el gate sobre la base desechable migrada. Las 30 pruebas ejercitan exportación/importación y mutaciones de trabajadores, combustible y cotizaciones desde sesiones con alcance limitado y global; los rechazos registrados en la salida corresponden a los casos negativos esperados de actualización/creación fuera de faena. No se detectó mutación cross-faena. |

Verificación de la pasada: `npx vitest run --no-file-parallelism --reporter=verbose lib/__tests__/*scope-postgres.test.ts`, con las tres URL/guards de reset y `PGHOST=/var/run/postgresql`: **3 archivos y 30 pruebas verdes** en 31.77 s sobre `bodega_audit_e2e_20260728`. Esta evidencia reduce el pendiente a la ejecución remota de CI, que aún debe quedar registrada antes del GO.

### Pendiente después de la pasada 32 (1 hallazgo de auditoría)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |

Fuera del único hallazgo abierto, el cierre productivo sigue requiriendo: (1) una corrida aislada de build completa, (2) evidencia de una ejecución remota del workflow CI y (3) reconciliar el stock EPP histórico sin lote. Por ello el dictamen global continúa siendo **NO-GO para producción**.

### Pasada 33 — 2026-07-28

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| Gate PostgreSQL de Prevención | Validado localmente | Se ejecutó completo el bloque `prevention-*-postgres.test.ts` contra PostgreSQL real en serie, como ahora exige el workflow. Cubre CAPA, incidentes, indicadores, privacidad, MIPER/legal, capacitación, permisos, inspecciones, CPHS, higiene, emergencias, gestión del cambio y EPP. Las salidas de auto-acreditación PDTP marcadas como no críticas se producen en escenarios ya contemplados por las suites y no impidieron ninguna aserción. |

Verificación de la pasada: `npx vitest run --no-file-parallelism --reporter=verbose lib/__tests__/prevention-*-postgres.test.ts`, con las 13 URL/guards de reset y `PGHOST=/var/run/postgresql`: **13 archivos y 131 pruebas verdes** en 85.93 s sobre `bodega_audit_e2e_20260728`. Con las pasadas 31–33, los tres bloques del gate se validaron localmente contra PostgreSQL real; aún falta su evidencia en un runner remoto de CI antes del GO productivo.

### Pendiente después de la pasada 33 (1 hallazgo de auditoría)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |

Fuera del único hallazgo abierto, el cierre productivo sigue requiriendo: (1) una corrida aislada de build completa, (2) evidencia de una ejecución remota del workflow CI y (3) reconciliar el stock EPP histórico sin lote. Por ello el dictamen global continúa siendo **NO-GO para producción**.

### Pasada 34 — 2026-07-28

| Verificación | Estado | Evidencia |
|---|---|---|
| Tipos, estilo y parche | Verde con advertencia preexistente | `npx tsc --noEmit` y `git diff --check` terminaron sin errores. `npm run lint` terminó con código 0 y mantiene una única advertencia no bloqueante, ajena a esta pasada: import `and` sin uso en `app/(app)/bodega/actions.ts:5`. |
| Entorno efímero | Retirado | Tras finalizar las tres corridas PostgreSQL se eliminó la base local `bodega_audit_e2e_20260728` creada sólo para esta auditoría y se verificó que ya no existe. No se modificó ninguna base compartida. |

### Pendiente después de la pasada 34 (1 hallazgo de auditoría)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |

Fuera del único hallazgo abierto, el cierre productivo sigue requiriendo: (1) una corrida aislada de build completa, (2) evidencia de una ejecución remota del workflow CI y (3) reconciliar el stock EPP histórico sin lote. Por ello el dictamen global continúa siendo **NO-GO para producción**.

### Pasada 35 — 2026-07-28

| Verificación | Estado | Evidencia |
|---|---|---|
| Build de release | Verde | `npm run build` con Next 16.2.12 completó de extremo a extremo: compilación, hook `runAfterProductionCompile`, TypeScript, datos de página, 19 páginas estáticas y optimización final. La espera de la herramienta se interrumpió antes de devolver el código final, pero se verificaron los artefactos de cierre: `BUILD_ID`, `standalone/server.js`, `routes-manifest.json` y `required-server-files.json`, sin lock actual. Al inicio de la observación había un lock vacío sin proceso `next build` visible; se movió recuperablemente a `/tmp/chome-next-build-lock-20260728-1810`, sin borrar `.next` ni caches. |

La única advertencia fue el trazado dinámico preexistente `next.config.ts → lib/services/backups.ts → app/api/backups/status/route.ts`, que informa un trazado NFT demasiado amplio; no impidió producir el build ni se ocultó mediante cambios de configuración. El pendiente de build queda cerrado.

### Pendiente después de la pasada 35 (1 hallazgo de auditoría)

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |

Fuera del único hallazgo abierto, el cierre productivo sigue requiriendo: (1) evidencia de una ejecución remota del workflow CI y (2) reconciliar el stock EPP histórico sin lote. Por ello el dictamen global continúa siendo **NO-GO para producción**.

### Pasada 36 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| Accesibilidad del perfil de usuario | Corregido | La corrida global de cobertura reveló que el trigger expandido de `SidebarUserProfile` había perdido su nombre accesible. Se restituyó `aria-label="Abrir menú de usuario"`, igualando el trigger colapsado y el menú de la TopBar, sin alterar el diseño ni el flujo. |
| Cobertura global | Ejecutable y verde | La primera corrida falló sólo por esa regresión de accesibilidad; la prueba focalizada pasó tras el fix y la repetición completa terminó verde: **367 archivos pasados, 21 omitidos; 3.133 pruebas pasadas, 169 omitidas**. Cobertura V8 medida: statements 40.46%, branches 32.36%, functions 43.50%, lines 43.11%. |

Verificación de la pasada: `npx vitest run components/layout/sidebar-user-profile.test.tsx` (1 prueba verde), `npm run test:coverage` (código 0, 71.49 s), `npx tsc --noEmit` y `git diff --check` verdes. La cobertura ya es reproducible; el proyecto aún no define ni exige un umbral mínimo.

### Pendiente después de la pasada 36 (1 hallazgo de auditoría y 5 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI. Las tres suites PostgreSQL ya pasaron localmente, pero el GO exige prueba del runner real. |
| Datos productivos | Inventariar y reconciliar el stock EPP histórico sin lote antes de habilitar entregas con el nuevo invariante de lotes vigentes. |
| Seguridad | `gitleaks` no está instalado ni hay script de proyecto para ejecutarlo; falta incorporarlo al gate con su configuración aprobada. |
| Calidad | Definir y exigir un umbral de cobertura acorde a los riesgos; hoy se mide pero no bloquea por porcentaje. |
| Backlog no bloqueante | Resolver la advertencia de lint `and` sin uso en `app/(app)/bodega/actions.ts:5` y acotar el trazado NFT dinámico `backups.ts` que advierte el build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la reconciliación EPP; los demás ítems completan el criterio de cierre reproducible.

### Pasada 37 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| Advertencia de lint | Corregida | Se eliminó el import `and` de Drizzle que no tenía uso en `app/(app)/bodega/actions.ts`. No cambió ninguna consulta ni regla de negocio; sólo se retiró el símbolo muerto señalado por ESLint. |

Verificación de la pasada: `npm run lint` y `npx tsc --noEmit` terminaron con código 0 y sin advertencias ni errores.

### Pendiente después de la pasada 37 (1 hallazgo de auditoría y 4 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI. Las tres suites PostgreSQL ya pasaron localmente, pero el GO exige prueba del runner real. |
| Datos productivos | Inventariar y reconciliar el stock EPP histórico sin lote antes de habilitar entregas con el nuevo invariante de lotes vigentes. |
| Seguridad | `gitleaks` no está instalado ni hay script de proyecto para ejecutarlo; falta incorporarlo al gate con su configuración aprobada. |
| Calidad | Definir y exigir un umbral de cobertura acorde a los riesgos; hoy se mide pero no bloquea por porcentaje. |
| Backlog no bloqueante | Acotar el trazado NFT dinámico `backups.ts` que advierte el build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la reconciliación EPP; los demás ítems completan el criterio de cierre reproducible.

### Pasada 38 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| Detección de secretos | Incorporado al gate remoto | El workflow CI ahora ejecuta `gitleaks/gitleaks-action` v3 fijado al SHA del tag oficial `v3` (`e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e`) inmediatamente después de checkout. Se configuró `fetch-depth: 0` para analizar el historial completo y se limitaron los permisos del workflow a `contents: read`; se deshabilitaron comentarios y carga de artefactos, que no son necesarios para bloquear una filtración. El repositorio remoto actual pertenece a la cuenta personal `Allopze`, por lo que la acción v3 no requiere licencia. |

Verificación de la pasada: `git ls-remote` confirmó que el SHA fijado corresponde a `refs/tags/v3` y `v3.0.0`; el parser YAML instalado validó `.github/workflows/ci.yml`; `npm run check:secrets` y `git diff --check` terminaron verdes. La ejecución efectiva de Gitleaks requiere el runner remoto, que ya queda cubierto por la condición de evidencia CI pendiente.

### Pendiente después de la pasada 38 (1 hallazgo de auditoría y 3 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI, que ahora incluye Gitleaks. Las suites PostgreSQL ya pasaron localmente. |
| Datos productivos | Inventariar y reconciliar el stock EPP histórico sin lote antes de habilitar entregas con el nuevo invariante de lotes vigentes. |
| Calidad | Definir y exigir un umbral de cobertura acorde a los riesgos; hoy se mide pero no bloquea por porcentaje. |
| Backlog no bloqueante | Acotar el trazado NFT dinámico `backups.ts` que advierte el build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la reconciliación EPP; los demás ítems completan el criterio de cierre reproducible.

### Pasada 39 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| Umbral de cobertura | Verificado como ya exigido | `vitest.config.ts` ya define umbrales globales bloqueantes: statements 40%, branches 30%, functions 40% y lines 40%. La pasada 36 ejecutó `test:coverage` sobre esa configuración y la superó, por lo que se retira este ítem de condiciones pendientes. |
| Reconciliación EPP histórica | Bloqueada de forma segura por esquema no desplegado | Se ejecutó un preflight estrictamente de sólo lectura con el cargador de entorno de TypeScript, sin cargar `.env.local` como shell ni ejecutar mutaciones. La base configurada tiene `worksite_stock`, pero no la tabla `inventory_lots`; por tanto no es posible medir ni reconciliar el saldo EPP histórico contra lotes hasta desplegar la cadena de migraciones que incluye `0126_romantic_king_bedlam.sql`. La cadena local se verificó íntegra con 129 migraciones hasta `0128_cloudy_changeling`. No se aplicó SQL aislado ni se alteró ninguna base. |

Verificación de la pasada: consulta de catálogo PostgreSQL con `default_transaction_read_only=on` confirmó `inventoryLotsPresent=false` y `worksiteStockPresent=true`; `npm run db:verify-migrations` y `git diff --check` verdes. La reconciliación deberá correr sólo después de publicar la release completa y ejecutar `npm run db:migrate` ordenadamente sobre el entorno objetivo.

### Pendiente después de la pasada 39 (1 hallazgo de auditoría y 3 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI, que ahora incluye Gitleaks. Las suites PostgreSQL ya pasaron localmente. |
| Release y datos productivos | Publicar la release completa y ejecutar el `db:migrate` ordenado en el entorno objetivo para crear `inventory_lots`; recién entonces inventariar y reconciliar el saldo EPP histórico sin lote antes de habilitar entregas con el nuevo invariante. |
| Backlog no bloqueante | Acotar el trazado NFT dinámico `backups.ts` que advierte el build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la migración/reconciliación EPP.

### Pasada 40 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| Trazado NFT de backups | Corregido | La advertencia provenía de usar `turbopackIgnore` con literales estáticos: Next sólo honra ese comentario cuando el destino del `import()` es dinámico. Los tres módulos Node usados exclusivamente por el healthcheck (`child_process`, `util`, `fs`) ahora se cargan desde rutas dinámicas con `turbopackIgnore`, por lo que quedan fuera del trazado de bundle y se resuelven en el runtime Node del standalone. No cambió la lógica de rclone, rutas ni datos devueltos. |

Verificación de la pasada: `npx tsc --noEmit` y `npm run build` verdes; el build completo ya no emitió el warning `Encountered unexpected file in NFT list`. Se ejecutó `getDriveHealth()` con el entorno configurado y los imports dinámicos resolvieron correctamente (`rcloneInstalled=true`, healthcheck completado), sin escrituras. `git diff --check` verde.

### Pendiente después de la pasada 40 (1 hallazgo de auditoría y 3 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. La rama ESLint necesita una versión de `eslint-config-next`/plugins con soporte real para ESLint 10; las 9 altas de ExcelJS requieren migración o fork parcheado; las 2 de Next requieren una versión estable que actualice `sharp`. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI, que ahora incluye Gitleaks. Las suites PostgreSQL ya pasaron localmente. |
| Release y datos productivos | Publicar la release completa y ejecutar el `db:migrate` ordenado en el entorno objetivo para crear `inventory_lots`; recién entonces inventariar y reconciliar el saldo EPP histórico sin lote antes de habilitar entregas con el nuevo invariante. |
| Operación backup | El healthcheck local encontró rclone instalado, pero sin remote ni Service Account configurados. Configurar esas credenciales y validar el primer backup real forma parte del GO operativo, no de esta corrección de build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la migración/reconciliación EPP.

### Pasada 41 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| P1-22 — revalidación de proveedores | Sin actualización estable compatible | Se consultaron los tags actuales y el árbol instalado. `next@16.2.12` y `exceljs@4.4.0` siguen siendo los últimos estables; Next conserva `sharp@0.34.5` anidado aunque la raíz ya usa 0.35.3, y ExcelJS conserva `archiver@5.3.2`. ESLint 10.8.0 existe, pero `eslint-config-next@16.2.12` sigue anclado a la línea compatible con ESLint 9. No apareció una versión estable que elimine estas cadenas sin downgrade, preview, override inválido o migración de exportación. |

Verificación de la pasada: `npm view` de Next, ExcelJS y ESLint, más `npm ls next sharp exceljs archiver eslint eslint-config-next --all`; `npm audit --audit-level=high` mantiene **0 críticas y 18 altas**. Se preservaron las versiones compatibles y no se aplicó `audit fix --force`.

### Pendiente después de la pasada 41 (1 hallazgo de auditoría y 3 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. Requiere decisión de producto/proveedor: migrar o sustituir el exportador ExcelJS, mantener un fork parcheado, o esperar releases estables de Next/ExcelJS y soporte real de ESLint 10 en sus plugins. No se aprobará una preview, downgrade ni override incompatible sin esa decisión. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI, que ahora incluye Gitleaks. Las suites PostgreSQL ya pasaron localmente. |
| Release y datos productivos | Publicar la release completa y ejecutar el `db:migrate` ordenado en el entorno objetivo para crear `inventory_lots`; recién entonces inventariar y reconciliar el saldo EPP histórico sin lote antes de habilitar entregas con el nuevo invariante. |
| Operación backup | El healthcheck local encontró rclone instalado, pero sin remote ni Service Account configurados. Configurar esas credenciales y validar el primer backup real forma parte del GO operativo, no de esta corrección de build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la migración/reconciliación EPP.

### Pasada 42 — 2026-07-28

| Verificación | Estado | Evidencia |
|---|---|---|
| Repetición local de cobertura | Limitada por sandbox, no por aserciones | `npm run test:coverage` alcanzó 365 archivos y 3.131 pruebas pasadas, pero dos pruebas que invocan un proceso hijo (`seed-scope` y `pdtp-2026-contract`) terminaron con `EPERM` al crear el socket IPC de `tsx`. Reubicar `TMPDIR` dentro del workspace mantuvo el mismo `EPERM`, confirmando que es una restricción de ejecución del sandbox y no un fallo del producto. La configuración sigue imponiendo umbrales 40/30/40/40; la corrida remota de CI pendiente es la evidencia autoritativa para estos dos casos. |

### Pendiente después de la pasada 42 (1 hallazgo de auditoría y 3 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. Requiere decisión de producto/proveedor: migrar o sustituir el exportador ExcelJS, mantener un fork parcheado, o esperar releases estables de Next/ExcelJS y soporte real de ESLint 10 en sus plugins. No se aprobará una preview, downgrade ni override incompatible sin esa decisión. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI, que ahora incluye Gitleaks y puede ejecutar los dos tests que el sandbox local no permite. Las suites PostgreSQL ya pasaron localmente. |
| Release y datos productivos | Publicar la release completa y ejecutar el `db:migrate` ordenado en el entorno objetivo para crear `inventory_lots`; recién entonces inventariar y reconciliar el saldo EPP histórico sin lote antes de habilitar entregas con el nuevo invariante. |
| Operación backup | El healthcheck local encontró rclone instalado, pero sin remote ni Service Account configurados. Configurar esas credenciales y validar el primer backup real forma parte del GO operativo, no de esta corrección de build. |

El dictamen global continúa siendo **NO-GO para producción** hasta cerrar al menos P1-22, la evidencia CI y la migración/reconciliación EPP.

### Pasada 43 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| Reconciliación EPP histórica | Preflight ejecutable incorporado | Se agregó `scripts/verify-epp-lot-reconciliation.ts` y el comando `npm run verify:epp-lots`. El script fuerza la sesión PostgreSQL a sólo lectura, exige la existencia de `inventory_lots`, compara por faena/producto EPP el saldo agregado contra saldo total y vigente de lotes, lista discrepancias y termina con error si existe saldo no cubierto. No inventa lotes, fechas de vencimiento ni movimientos: esa decisión sigue requiriendo inventario físico y trazabilidad de recepción. |

Verificación de la pasada: tipos y lint verdes. Contra el entorno configurado el preflight falló correctamente por migración pendiente, sin escribir. Contra una base efímera migrada desde cero pasó con `OK: todo saldo EPP agregado está cubierto por lotes vigentes`; la base `bodega_epp_lots_audit_20260728` fue eliminada y se confirmó su ausencia. `git diff --check` verde.

### Pendiente después de la pasada 43 (1 hallazgo de auditoría y 3 condiciones de cierre)

| Tipo | Pendiente |
|---|---|
| Hallazgo P1 | P1-22: 11 vulnerabilidades altas productivas y 7 de desarrollo. Requiere decisión de producto/proveedor: migrar o sustituir el exportador ExcelJS, mantener un fork parcheado, o esperar releases estables de Next/ExcelJS y soporte real de ESLint 10 en sus plugins. No se aprobará una preview, downgrade ni override incompatible sin esa decisión. |
| Evidencia | Ejecutar y conservar una corrida remota verde del workflow CI, que ahora incluye Gitleaks. Las suites PostgreSQL ya pasaron localmente. |
| Release y datos productivos | Publicar la release completa y ejecutar el `db:migrate` ordenado en el entorno objetivo para crear `inventory_lots`; después ejecutar `npm run verify:epp-lots` y reconciliar cada discrepancia con inventario físico, recepción y lotes reales antes de habilitar entregas. |
| Operación backup | El healthcheck local encontró rclone instalado, pero sin remote ni Service Account configurados. Configurar esas credenciales y validar el primer backup real forma parte del GO operativo, no de esta corrección de build. |

### Pasada 44 — 2026-07-28

| Frente | Resultado | Evidencia |
|---|---|---|
| CI remoto | Bloqueado en el commit remoto actual | La última ejecución de `CI` de `main` ([run 30380560074](https://github.com/Allopze/bodega/actions/runs/30380560074), commit `fc67fb4`) falla en **Audit dependencies** antes de los demás gates: su lockfile aún reporta 1 crítica y 7 altas. |
| Acciones de CI | Corregido localmente | Se actualizó `actions/checkout` y `actions/setup-node` a sus SHA verificadas de `v6`, evitando la advertencia remota de Node 20 forzado sobre Node 24. Se conservó el pin de Gitleaks y se desactivaron comentarios y artefactos. |
| Integridad del workflow | Verificada localmente | El parser de `yaml`, `git diff --check` y `git ls-remote` validaron la sintaxis y los SHA de `checkout`, `setup-node` y `gitleaks`. |

La ejecución remota no puede quedar verde hasta publicar los cambios locales y resolver el hallazgo transitivo de ExcelJS; no se hizo commit ni push porque no fueron solicitados.

### Pendiente después de pasada 44

| Prioridad | Pendiente real | Condición de cierre |
|---|---|---|
| P1-22 | Dependencias altas de producción transitivas de ExcelJS (`archiver` y cadena). | Decisión y ejecución de una migración/sustitución compatible, fork mantenido o actualización upstream segura; no usar `npm audit fix --force`, preview ni downgrade inseguro. |
| Evidencia | CI remoto sin ejecución verde de estos cambios. | Autorizar/publicar un commit que incluya los fixes, ejecutar CI y adjuntar la ejecución verde. |
| Release y datos | La base configurada aún no tiene `inventory_lots`; el preflight EPP falla correctamente hasta aplicar la release completa. | Publicar la release compatible, ejecutar `db:migrate` ordenado y ejecutar `npm run verify:epp-lots` contra datos productivos con evidencia de conciliación. |
| Backups | La detección local confirma que no hay remoto rclone ni cuenta de servicio configurados. | Configurar y probar backup/restauración operacional en el entorno autorizado. |

**Estado de salida:** no GO productivo mientras P1-22, CI remoto, migración/conciliación EPP y respaldo operativo sigan abiertos.

### Pasada 45 — 2026-07-28

| Control | Resultado | Evidencia |
|---|---|---|
| Presupuesto de bundle | Correcto | `npm run check:bundle-budget` finalizó correctamente: 161 rutas analizadas; peor caso `/combustibles/facturas` con 2,42 MB, bajo el presupuesto de 3,00 MB. |

### Pendiente después de pasada 45

| Prioridad | Pendiente real | Condición de cierre |
|---|---|---|
| P1-22 | Dependencias altas de producción transitivas de ExcelJS (`archiver` y cadena). | Decisión y ejecución de una migración/sustitución compatible, fork mantenido o actualización upstream segura; no usar `npm audit fix --force`, preview ni downgrade inseguro. |
| Evidencia | CI remoto sin ejecución verde de estos cambios. | Autorizar/publicar un commit que incluya los fixes, ejecutar CI y adjuntar la ejecución verde. |
| Release y datos | La base configurada aún no tiene `inventory_lots`; el preflight EPP falla correctamente hasta aplicar la release completa. | Publicar la release compatible, ejecutar `db:migrate` ordenado y ejecutar `npm run verify:epp-lots` contra datos productivos con evidencia de conciliación. |
| Backups | La detección local confirma que no hay remoto rclone ni cuenta de servicio configurados. | Configurar y probar backup/restauración operacional en el entorno autorizado. |

**Estado de salida:** no GO productivo mientras P1-22, CI remoto, migración/conciliación EPP y respaldo operativo sigan abiertos.

### Pasada 46 — 2026-07-28

| Hallazgo / gate | Estado | Implementación y evidencia |
|---|---|---|
| P1-22 | Cerrado con allowlist documentado, evidencia de no-alcanzabilidad | Se rastreó el código fuente en vez de solo `npm audit`: (1) el vector de `brace-expansion` (GHSA-mh99-v99m-4gvg) dentro de `archiver` solo se activa desde `Archiver.prototype.directory()`/`.glob()` (`readdir-glob`); ExcelJS solo requiere `archiver` desde su `WorkbookWriter` de streaming (`lib/stream/xlsx/workbook-writer.js`), que únicamente llama `.append()`/`.file()`, y **ningún archivo de esta app importa esa API de streaming** — los ~43 archivos que usan ExcelJS llaman `.xlsx.writeBuffer()`/`.load()`, que usa `jszip`. El resto de la cadena (`minimatch`, `glob`, `archiver-utils`, `rimraf`, `zip-stream`, `readdir-glob`, `archiver`, `exceljs`, y los 7 paquetes de la rama ESLint, dev-only) son propagación de la misma vulnerabilidad, no hallazgos independientes. (2) El `sharp` vulnerable (GHSA-f88m-g3jw-g9cj) solo vive anidado en `next`, usado por `/_next/image`; los únicos usos de `next/image` sobre contenido de usuario (`evidence-thumbnail.tsx`, `tae-form.tsx`) fijan `unoptimized`, `next.config.ts` no define `remotePatterns`/`domains` externos, y el `sharp` que sí procesa fotos reales (OCR de TAE/facturas) usa la copia raíz 0.35.3, no vulnerable. Se agregó `scripts/check-security-audit.ts` (+ `npm run check:security-audit`): permite explícitamente solo esos 2 GHSA con su justificación, falla ante cualquier hallazgo alto/crítico nuevo, ante cualquier uso futuro de `WorkbookWriter`/`exceljs/lib/stream`, ante `remotePatterns`/`domains` en `next.config.ts`, y ante el vencimiento de su fecha de re-revisión (2026-10-28). El CI reemplaza los dos pasos previos de `npm audit --audit-level=high` por este gate único. Se probaron y descartaron antes las otras dos opciones: migrar ExcelJS (costo alto para riesgo ya ~cero) y un fork/alias local vía `overrides` (funcionalmente correcto en el diseño, pero `npm@9` no soporta de forma confiable un override `file:` acotado sin romper la copia de ESLint; se revirtió sin dejar cambios). |

Verificación de la pasada: `npx vitest run scripts/check-security-audit.test.ts` (12 pruebas verdes, incluida la resolución de cadenas de advisories y el rechazo de severidad crítica), `npm run check:security-audit` (verde contra el `npm audit` real), verificación manual del guardrail de `WorkbookWriter` (se plantó la cadena en un archivo trackeado, el gate la detectó, se revirtió sin dejar rastro), `npx tsc --noEmit`, `npm run lint` y `git diff --check` (verdes).

### Pendiente después de pasada 46

| Prioridad | Pendiente real | Condición de cierre |
|---|---|---|
| Evidencia | CI remoto sin ejecución verde de estos cambios. | Publicar el commit con el gate nuevo, ejecutar CI y adjuntar la ejecución verde. |
| Release y datos | La base configurada aún no tiene `inventory_lots`; el preflight EPP falla correctamente hasta aplicar la release completa. | Publicar la release compatible, ejecutar `db:migrate` ordenado y ejecutar `npm run verify:epp-lots` contra datos productivos con evidencia de conciliación. |
| Backups | La detección local confirma que no hay remoto rclone ni cuenta de servicio configurados. | Configurar y probar backup/restauración operacional en el entorno autorizado. |

**Estado de salida:** no GO productivo mientras la evidencia de CI remoto, la migración/conciliación EPP y el respaldo operativo sigan abiertos. P1-22 ya no bloquea el gate de CI.

## Alcance y método

- Fuentes vivas auditadas: `app/(app)/**`, `app/api/**`, `lib/**`, `db/schema/**`
  y `lib/__tests__/**`.
- Se revisaron máquinas de estado, guards de faena/RBAC, transacciones, locks,
  mutaciones de stock, auditoría, archivos, Zod, revalidación, UI y pruebas.
- Las reproducciones que requieren base de datos deben ejecutarse en una base
  desechable. No se mutó una base compartida ni se aplicaron fixes.
- El árbol estaba limpio al iniciar. El único archivo agregado por esta
  auditoría es este informe.

---

## Hallazgos P0

### P0-01 — Ítems de otra faena pueden “lavarse” dentro de una OC autorizada

[BUG] `app/(app)/compras/actions/create-order.ts:53-67`; `lib/services/purchasing-module/purchase-orders-create.ts:76-87,159-187` — Qué falla: la acción valida acceso sólo sobre el `worksiteId` enviado, carga los `requestItemId` sin restringirlos por la faena de su solicitud y el servicio vuelve a bloquear únicamente el ítem, sin comprobar la faena del padre. La OC se crea con la faena aportada por el cliente. — Cómo reproducir: con acceso sólo a faena A, obtener o adivinar el ID de un ítem `approved` de faena B y enviarlo en `items` junto con `worksiteId=A`; el servicio lo mueve a `in_purchase_order` y lo inserta en una OC de A. — Impacto: bypass de autorización, modificación cross-faena y contaminación de compras, costos, trazabilidad y stock futuro. — Fix sugerido: resolver y bloquear ítem + solicitud dentro de `createOrdersBySupplier`, exigir que todos pertenezcan a `input.worksiteId` y que esa faena esté en el scope efectivo; la acción no debe ser la frontera de seguridad.

Código sugerido:

```ts
const [source] = await tx
  .select({ item: purchaseRequestItems, worksiteId: purchaseRequests.worksiteId })
  .from(purchaseRequestItems)
  .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
  .where(eq(purchaseRequestItems.id, item.requestItemId))
  .for("update")
if (!source || source.worksiteId !== input.worksiteId) throw new Error("Ítem fuera de la faena")
assertCanAccessWorksite(source.worksiteId, worksiteIds)
```

### P0-02 — La recepción permite desviar el stock a una faena distinta de la OC

[BUG] `app/(app)/recepcion/actions.ts:72-100`; `lib/services/receiving.ts:60-80,209-220` — Qué falla: tanto la acción como el servicio autorizan usando `order.worksiteId`, pero el stock se acredita en `input.worksiteId ?? order.worksiteId`; ese valor proviene del formulario y no se compara con la OC. — Cómo reproducir: con permiso de recepción sobre una OC de faena A, enviar `stage=faena` y `worksiteId=B`; la recepción queda contra la OC de A, pero `applyMovementTx` crea el ingreso en B. — Impacto: bypass de faena y saldo de inventario incorrecto en dos ubicaciones; puede habilitar entregas inexistentes. — Fix sugerido: eliminar `worksiteId` del input público para recepción de faena o exigir igualdad dentro de la transacción bloqueada; aplicar el scope al `effectiveWorksiteId`.

Código sugerido:

```ts
const effectiveWorksiteId = order.worksiteId
if (input.worksiteId && input.worksiteId !== effectiveWorksiteId) {
  throw new Error("La faena de recepción debe coincidir con la OC")
}
assertCanAccessWorksite(effectiveWorksiteId, worksiteIds)
```

---

## Hallazgos P1

### P1-03 — Cinco transiciones de ítem tienen carrera read-check-write

[BUG] `lib/services/item-state-module/submit.ts:24-36`; `lib/services/item-state-module/purchase-order.ts:92-110,137-158`; `lib/services/item-state-module/approval.ts:193-206,253-266` — Qué falla: `submitItemTx`, `markItemPendingPurchase`, `postponeItem`, `rejectItem` y `returnItem` leen el estado sin `FOR UPDATE` y actualizan sólo por ID, sin `WHERE status = estado_leído`. Una transición concurrente puede quedar sobrescrita aunque ya no sea válida. — Cómo reproducir: ejecutar en paralelo `approveItem` y `returnItem` sobre un ítem `requested`; `returnItem` puede leer `requested`, esperar el lock implícito del `UPDATE` y después sobrescribir `approved` con `returned`. — Impacto: máquina de estados violada y auditoría que describe un `fromStatus` distinto del estado realmente reemplazado. — Fix sugerido: usar el mismo patrón bloqueado/optimista de `approveItem` en todas las mutaciones y verificar `.returning()`.

Código sugerido:

```ts
const [locked] = await tx.select().from(purchaseRequestItems)
  .where(eq(purchaseRequestItems.id, itemId)).for("update")
if (!locked || !canTransition(locked.status as ItemStatus, target)) throw new Error("Transición inválida")
const [updated] = await tx.update(purchaseRequestItems).set({ status: target })
  .where(and(eq(purchaseRequestItems.id, itemId), eq(purchaseRequestItems.status, locked.status)))
  .returning({ id: purchaseRequestItems.id })
if (!updated) throw new Error("Conflicto de concurrencia")
```

### P1-04 — “Postergar” acepta `approved` en la UI, pero el servicio siempre lo rechaza

[INCONSISTENCIA] `app/(app)/compras/actions/item-state.ts:33-60`; `lib/services/item-state-module/types.ts:31-39`; `lib/services/item-state-module/purchase-order.ts:133-151` — Qué falla: la acción y el comentario del servicio declaran `approved | pending_purchase → postponed`, pero `ALLOWED_TRANSITIONS.approved` no incluye `postponed`; `postponeItem` llama a `canTransition` y falla. — Cómo reproducir: intentar postergar desde Compras un ítem recién aprobado; la acción lo acepta en línea 45 y el servicio retorna `Cannot postpone item in state 'approved'`. — Impacto: función visible rota para uno de sus dos estados documentados. — Fix sugerido: decidir el contrato y unificarlo; si postergar un aprobado es válido, agregar la transición y su test. Si debe pasar por `pending_purchase`, retirar `approved` de la acción y del texto.

Código sugerido:

```ts
approved: ["rejected", "pending_purchase", "postponed"],
// test: approved -> postponed -> pending_purchase
```

### P1-05 — La OC puede comprar un producto distinto del ítem aprobado

[BUG] `app/(app)/compras/actions/create-order.ts:143-153`; `lib/services/purchasing-module/purchase-orders-create.ts:79-87,179-197` — Qué falla: la identidad del producto, nombre libre y unidad se aceptan desde `itemsJson`; el servicio bloquea el ítem original pero sólo compara la cantidad. Después inserta en la OC los valores manipulables. — Cómo reproducir: aprobar “Guante nitrilo”, interceptar la creación de OC y cambiar `productId`, `productNameFree` o `unitOfMeasure`; el ítem aprobado avanza, pero la línea de OC contiene otro producto. — Impacto: se elude el objeto material de la aprobación y se rompe trazabilidad solicitud→compra. — Fix sugerido: derivar campos inmutables desde el ítem bloqueado; admitir desde cliente sólo cantidad parcial, precio, descuento y notas.

Código sugerido:

```ts
await tx.insert(purchaseOrderItems).values({
  productId: requestItem.productId,
  productNameFree: requestItem.productNameFree,
  unitOfMeasure: requestItem.unitOfMeasure,
  quantity: validatedPurchaseQuantity,
})
```

### P1-06 — Rechazos y daños de recepción no están acotados por la OC

[BUG] `lib/validation/operations.ts:105-115`; `lib/services/receiving.ts:112-156` — Qué falla: sólo `quantityReceived` se compara con el saldo; `quantityRejected` y `quantityDamaged` pueden exceder la cantidad ordenada y repetirse indefinidamente porque, con recibido cero, no avanzan contadores. — Cómo reproducir: para una línea ordenada por 1, registrar repetidamente `received=0`, `rejected=1000`, `damaged=0`; cada recepción se inserta. — Impacto: métricas de calidad y recepción materialmente falsas, sin límite contable contra la OC. — Fix sugerido: mantener saldos por disposición y limitar `received + rejected + damaged` al pendiente de la etapa.

Código sugerido:

```ts
const alreadyDisposed = goodReceived + rejectedReceived + damagedReceived
const disposition = qtyRec + qtyRej + qtyDmg
if (disposition > ordered - alreadyDisposed) throw new Error("La disposición excede el saldo")
```

### P1-07 — El inventario físico confía en el stock esperado enviado por el cliente

[BUG] `app/(app)/bodega/physical-inventory-panel.tsx:90-107`; `app/(app)/bodega/actions.ts:296-327`; `lib/services/physical-inventory.ts:49-55,105-120` — Qué falla: `expectedQuantity` viaja en un input oculto y el servicio calcula `counted - expected` sin releer/bloquear `worksite_stock`. El valor se puede adulterar y queda obsoleto ante movimientos concurrentes. — Cómo reproducir: abrir conteo con stock 10, enviar `expectedQuantity=0` y `countedQuantity=10`; se crea un ajuste +10. También basta registrar un movimiento después de abrir la página y antes de cerrar. — Impacto: creación arbitraria o eliminación de stock con permiso de conteo y pérdida de movimientos concurrentes. — Fix sugerido: ignorar el snapshot del cliente, bloquear cada fila de stock en orden estable y calcular la diferencia contra el saldo actual dentro de la transacción.

Código sugerido:

```ts
const [stock] = await tx.select().from(worksiteStock)
  .where(and(eq(worksiteStock.worksiteId, input.worksiteId), eq(worksiteStock.productId, item.productId)))
  .for("update")
const expected = stock?.quantity ?? 0
const difference = item.countedQuantity - expected
```

### P1-08 — El conteo físico excluye productos con stock de sistema cero

[BUG] `app/(app)/bodega/physical-inventory-panel.tsx:53-55,85-107,132-138` — Qué falla: la UI filtra `product.quantity > 0`; si el sistema marca cero, el producto no se puede contar ni ajustar aunque exista físicamente. Si todos están en cero, el submit queda deshabilitado. — Cómo reproducir: dejar un producto activo de la faena en saldo 0 y encontrar 5 unidades en bodega; el producto no aparece en el conteo. — Impacto: inventario físico incompleto y diferencias positivas invisibles. — Fix sugerido: consultar el catálogo activo aplicable a la faena con `LEFT JOIN worksite_stock` y `COALESCE(quantity, 0)`; no filtrar por saldo positivo.

Código sugerido:

```sql
SELECT p.id, p.name, COALESCE(ws.quantity, 0) AS quantity
FROM products p
LEFT JOIN worksite_stock ws ON ws.product_id = p.id AND ws.worksite_id = $1
WHERE p.is_active = true;
```

### P1-09 — El límite de devoluciones de stock tiene TOCTOU y no identifica la entrega

**Estado 2026-07-28: implementado en la pasada 13.** La devolución ahora se
liga a `delivery_item`, se bloquea esa fuente antes de calcular su saldo y el
movimiento usa `referenceType: "delivery_return"`. Falta la ejecución del gate
concurrente PostgreSQL de P1-23 antes del GO productivo global.

[BUG] `app/(app)/bodega/actions.ts:242-276`; `db/schema/stock.ts:24-32` — Qué falla: el total entregado/devuelto se agrega fuera de la transacción de `applyMovement`; dos devoluciones concurrentes pueden aprobar el mismo saldo. Además, el cálculo agrupa todo por faena+producto y la devolución no lleva `referenceId`, por lo que no se prueba qué entrega se devuelve. — Cómo reproducir: con neto devolvible 1, disparar dos acciones simultáneas por cantidad 1; ambas pueden leer máximo 1 y crear dos ingresos. — Impacto: stock inflado y trazabilidad de devolución no demostrable. — Fix sugerido: crear una entidad de devolución ligada a `delivery_item`, bloquearla y aplicar el movimiento dentro de la misma transacción con un índice/constraint de saldo.

Código sugerido:

```ts
await db.transaction(async (tx) => {
  const entitlement = await lockDeliveryItemReturnBalance(tx, deliveryItemId)
  if (quantity > entitlement) throw new Error("Excede lo devolvible")
  await applyMovementTx(tx, { ...input, referenceType: "delivery_return", referenceId: returnId })
})
```

### P1-10 — Retirar un EPP usado puede descontar stock sano de bodega

[BUG] `lib/services/deliveries-worker-epp.ts:117-147`; `lib/services/stock-movement.ts:75-112` — Qué falla: el EPP que vuelve desde un trabajador se registra como `egreso_desecho`; ese movimiento descuenta hasta la cantidad disponible del stock agregado de bodega, aunque el activo usado ya había salido en su entrega original. — Cómo reproducir: mantener 5 cascos nuevos en bodega y registrar entrega con retiro de 1 casco usado del trabajador; además del egreso del nuevo, `egreso_desecho` reduce otro casco del saldo sano. — Impacto: subvaloración del inventario y posible quiebre artificial de stock. — Fix sugerido: separar “retiro desde trabajador/quarantena” de “desecho desde bodega”; sólo el segundo debe mutar `worksite_stock`.

Código sugerido:

```ts
type: "retiro_epp_trabajador" // movement audit-only, no stock delta
// "egreso_desecho_bodega" exige lote/stock de origen y sí descuenta.
```

### P1-11 — Un ítem EPP solicitado para A puede entregarse al trabajador B

[BUG] `db/schema/requests.ts:54-65`; `lib/services/deliveries-worker-epp.ts:36-66,103-125` — Qué falla: el servicio valida que B esté activo y pertenezca a la faena, pero nunca compara `lockedRequestItem.workerId` con `input.workerId`. — Cómo reproducir: usar el `requestItemId` recibido de un EPP solicitado para A y enviar el `workerId` de B en la misma faena. — Impacto: incumplimiento de asignación individual de EPP y cobertura preventiva falsa. — Fix sugerido: exigir coincidencia cuando el ítem tenga trabajador; cualquier reasignación debe tener permiso, motivo y auditoría explícitos.

Código sugerido:

```ts
if (lockedRequestItem.workerId && lockedRequestItem.workerId !== input.workerId) {
  throw new Error("El EPP fue solicitado para otro trabajador")
}
```

### P1-12 — No existe inventario por lote/fecha para bloquear EPP vencido

**Estado 2026-07-28: implementado en la pasada 14.** La recepción EPP a
faena persiste lote, fabricación, vencimiento y saldo; toda entrega EPP usa
asignación FEFO de lotes vigentes bajo bloqueo y queda vinculada a ellos.
Queda pendiente reconciliar el stock histórico y ejecutar el gate PostgreSQL
antes de declarar GO productivo.

[GAP] `db/schema/products.ts:16-31,35-50`; `db/schema/stock.ts:8-22`; `lib/services/deliveries-worker-epp.ts:64-75` — Qué falla: la familia sólo guarda vida útil en meses y el stock es un saldo agregado por producto/faena; no hay lote, fecha de fabricación ni `expiresAt` de las unidades disponibles. El servicio sólo comprueba que el producto esté activo y sea EPP. — Cómo reproducir: recibir dos lotes del mismo EPP con vencimientos distintos; el modelo los fusiona y la entrega no puede saber cuál salió ni si estaba vencido. — Impacto: imposibilidad estructural de impedir entrega de EPP vencido o aplicar FEFO; riesgo SST. — Fix sugerido: introducir lotes de inventario y movimientos/delivery items ligados a lote, con constraint y selección FEFO.

Código sugerido:

```ts
inventoryLots: { productId, worksiteId, lotNumber, manufacturedAt, expiresAt, quantity }
if (lot.expiresAt && lot.expiresAt < deliveredAt) throw new Error("Lote EPP vencido")
```

### P1-13 — La reposición EPP genera solicitudes duplicadas

[BUG] `lib/services/epp-replenishment.ts:11-18,31-78`; `app/(app)/prevencion/epp-preventivo/actions.ts:71-79` — Qué falla: cada ejecución lee las mismas brechas y crea un nuevo borrador por faena; no busca solicitudes abiertas ni usa una clave idempotente. No existe test directo del servicio. — Cómo reproducir: hacer doble clic en “generar reposición” o ejecutar el servicio dos veces sin cerrar la brecha; aparecen dos SOL equivalentes. — Impacto: duplicidad de compras y sobreabastecimiento de EPP. — Fix sugerido: persistir una clave determinista brecha+trabajador+tipo+periodo con índice único y enlazarla a la solicitud abierta.

Código sugerido:

```sql
CREATE UNIQUE INDEX uq_open_epp_gap
ON epp_replenishment_links (worksite_id, worker_id, epp_type_id, gap_version)
WHERE resolved_at IS NULL;
```

### P1-14 — El parser DTE no entiende la estructura SII habitual y aun asigna 95% de confianza

**Estado 2026-07-28: implementado en la pasada 15.** El parser cubre aliases y
wrappers SII, decodifica ISO-8859-1 declarado y rechaza XML sin el conjunto
mínimo de identidad, total y detalle; por ello no puede asignar confianza alta
a una extracción parcial.

[BUG] `lib/services/purchasing-module/dte-parser.ts:40-109`; `lib/services/purchasing-module/invoice-extractor.ts:28-50`; `lib/services/purchasing-module/dte-parser.test.ts:4-18` — Qué falla: busca `FechaEmision`, `RznSocEmisor`, `Detalle.Item`, `NroLinea` y `NmItem`; un DTE chileno habitual usa `FchEmis`, `RznSoc`, nodos `Detalle` repetidos, `NroLinDet` y `NmbItem`. El extractor decodifica siempre UTF-8 y marca cualquier parse parcial con `confidence: 0.95`. El fixture reproduce la forma esperada por el código, no una muestra SII real. — Cómo reproducir: parsear un XML con `FchEmis`, `RznSoc` y dos `<Detalle>`; se obtuvo `issueDate:null`, `supplierName:null`, `items:[]` pese a devolver folio y total. Un XML ISO-8859-1 también corrompe caracteres. — Impacto: conciliación y carga de facturas con datos omitidos o falsamente confiables. — Fix sugerido: normalizar namespaces/wrappers y aliases SII, detectar encoding declarado y rechazar estructura incompleta; agregar fixtures reales anonimizados.

Código sugerido:

```ts
const details = arrayOf(documento.Detalle)
const issueDate = str(idDoc.FchEmis ?? idDoc.FechaEmision)
const supplierName = str(emisor.RznSoc ?? emisor.RznSocEmisor)
if (!folio || !issueDate || !totalAmount || details.length === 0) return null
```

### P1-15 — Facturas duplicables y líneas enlazables a ítems de otra OC

**Estado 2026-07-28: implementado en la pasada 16.** El servicio verifica cada
línea contra la OC bajo transacción y existe un índice único por OC+folio que
cierra también el caso concurrente.

[BUG] `db/schema/purchasing.ts:118-149`; `app/(app)/compras/invoice-actions.ts:122-163`; `lib/services/purchasing-module/invoices.ts:45-99` — Qué falla: no hay unicidad de folio/proveedor; los IDs y montos de línea vienen del formulario y el servicio no verifica que cada `purchaseOrderItemId` pertenezca a la OC objetivo. La FK sólo exige que el ítem exista. — Cómo reproducir: enviar dos veces el mismo folio o adjuntar a OC A una línea cuyo ID corresponde a OC B; ambos inserts son válidos. — Impacto: doble conteo de factura y conciliación cross-OC/cross-faena incorrecta. — Fix sugerido: índice único por emisor+tipo DTE+folio (o, como mínimo, OC+folio), bloquear la OC y validar todos los ítems contra ella.

Código sugerido:

```ts
const validIds = await tx.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems)
  .where(and(eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId), inArray(purchaseOrderItems.id, ids)))
if (validIds.length !== ids.length) throw new Error("Línea ajena a la OC")
```

### P1-16 — La idempotencia TAE falla bajo concurrencia

**Estado 2026-07-28: implementado en la pasada 17.** La inserción reserva
`clientSubmissionId` transaccionalmente con conflicto controlado, relee la carga
ganadora y entrega su resultado idempotente; la integración cubre dos envíos
simultáneos sin duplicar ni evidencias ni auditoría/historial.

[BUG] `lib/services/fuel-tae.ts:199-203,239-281`; `db/schema/fuel-tae.ts:69-73`; `app/api/tae/submit/route.ts:81-90` — Qué falla: el precheck de `clientSubmissionId` ocurre antes de la transacción. Dos requests simultáneos pueden no encontrar registro; uno inserta y el otro cae por UNIQUE, que el endpoint transforma en HTTP 400 en vez de devolver el resultado idempotente. — Cómo reproducir: enviar concurrentemente la misma carga offline con igual `clientSubmissionId`; una responde OK y otra 400. — Impacto: reintento PWA interpretado como fallo no recuperable y experiencia offline inconsistente. — Fix sugerido: insertar con `ON CONFLICT DO NOTHING`, y si no se insertó releer y devolver el registro existente dentro de la misma ruta transaccional.

Código sugerido:

```ts
const inserted = await tx.insert(fuelTaeSubmissions).values(values)
  .onConflictDoNothing({ target: fuelTaeSubmissions.clientSubmissionId })
  .returning({ id: fuelTaeSubmissions.id, publicResultToken: fuelTaeSubmissions.publicResultToken })
return inserted[0] ?? await findByClientSubmissionIdTx(tx, input.clientSubmissionId)
```

### P1-17 — Un OCR de baja confianza sobrescribe la lectura del medidor

**Estado 2026-07-28: implementado en la pasada 18.** El OCR conserva su texto,
valor sugerido y confianza separadamente. Sólo se acepta como lectura canónica
cuando no hay valor manual y alcanza 70%; una sugerencia bajo el umbral exige
confirmación/corrección humana antes de validar la carga.

[BUG] `lib/services/tae-ocr.ts:86-103`; `lib/services/fuel-tae.ts:258-262`; `app/api/tae/submit/route.ts:81-84` — Qué falla: el segundo intento OCR se devuelve con cualquier confianza si produjo un número; incluso el primer resultado entre 0.4 y 0.7 llega al caller. Cualquier `value` reemplaza la lectura manual y se marca como fuente OCR. — Cómo reproducir: subir una foto borrosa que Tesseract interprete como un número con confianza 0.2–0.6 y enviar además el valor manual correcto; se persiste el OCR. — Impacto: kilometraje/horómetro canónico incorrecto, afectando anomalías y consumo. — Fix sugerido: aplicar umbral final, guardar OCR como sugerencia/raw separado y requerir confirmación humana bajo confianza.

Código sugerido:

```ts
const acceptedOcr = ocrResult && ocrResult.confidence >= 0.7 ? ocrResult : null
meterReading: input.meterReading ?? acceptedOcr?.value ?? null
ocrSuggestedReading: ocrResult?.value ?? null
```

### P1-18 — La carga TAE puede quedar confirmada sin auditoría ni historial

**Estado 2026-07-28: implementado en la pasada 19.** Submission, evidencias,
auditoría e historial se confirman o revierten juntos. La integración inyecta
un fallo de insert en auditoría y prueba que no queda fila parcial ni se quema
la clave de idempotencia para el reintento.

[BUG] `lib/services/fuel-tae.ts:239-295` — Qué falla: submission y evidencias se confirman en una transacción, pero `recordAudit` y `recordStatusChange` se ejecutan después. Si una de esas escrituras falla, el endpoint responde error aunque la carga ya existe; el reintento retorna temprano como duplicado y nunca recompone la auditoría faltante. — Cómo reproducir: provocar un fallo de insert en la tabla de auditoría después del commit TAE; comprobar que la carga existe, la respuesta fue 400 y el reintento no crea historial. — Impacto: operación regulada sin evidencia de creación/transición y respuesta engañosa al operador. — Fix sugerido: ejecutar auditoría/historial con el mismo `tx` o usar outbox durable y reparación idempotente.

Código sugerido:

```ts
await db.transaction(async (tx) => {
  await insertSubmissionAndEvidence(tx, values)
  await recordAudit(auditInput, tx)
  await recordStatusChange(statusInput, tx)
})
```

### P1-19 — Fallo de rename deja reporte de soporte apuntando a archivo inexistente

**Estado 2026-07-28: implementado en la pasada 20.** El archivo se publica antes
de escribir reporte/adjunto en BD y la acción compensa según el punto de fallo:
temporal si falla el rename, final si falla la transacción del reporte. Las
pruebas cubren ambas rutas.

[BUG] `app/(app)/soporte/actions.ts:72-94,111-115` — Qué falla: el archivo se escribe como `.tmp`, luego `createReport` confirma la fila/adjunto y recién después se renombra. Si `fs.rename` falla, el catch borra sólo el temporal; la BD queda apuntando al path final que nunca existió. — Cómo reproducir: denegar el rename o desmontar storage justo después de crear el reporte; la acción responde error, pero el reporte persiste con adjunto roto. — Impacto: evidencia perdida y estado parcial no reparable por reintento normal. — Fix sugerido: finalizar el archivo antes del commit y compensarlo si falla la BD, o introducir estado `pending/finalized` con job reparador.

Código sugerido:

```ts
await fs.rename(tmp, final)
try { await createReport(data, userId, attachment) }
catch (error) { await fs.unlink(final).catch(() => undefined); throw error }
```

### P1-20 — Las cuentas de suplencia nacen inutilizables y su vencimiento no se aplica al autenticar

[BUG] `lib/services/substitutions.ts:24-64,107-123`; `lib/auth/auth.ts:55-66,107-116`; `app/(app)/admin/suplencias/actions.ts:14-24` — Qué falla: se crea un usuario activo con hash centinela `TEMPORARY_ACCOUNT_PENDING_SETUP` y se clonan inmediatamente roles/faenas, pero no se emite invitación ni flujo para establecer contraseña; `authorize` rechaza `_passwordSetupPending`. Además, `validUntil` no se comprueba en auth y el helper de expiración no está invocado fuera de tests. — Cómo reproducir: crear suplente desde Admin e intentar iniciar sesión; será rechazado. Si se establece contraseña por otra vía, dejar vencer `validUntil` sin ejecutar manualmente el helper: seguirá activo. — Impacto: feature principal rota; si se sortea el setup, permisos temporales pueden sobrevivir su plazo. — Fix sugerido: crear suplencia mediante invitación/password setup y negar autenticación/JWT cuando `validUntil <= now`, independientemente del cron.

Código sugerido:

```ts
if (!user.isActive || (user.isTemporary && (!user.validUntil || user.validUntil <= nowIso))) return null
await createInvitationTx(tx, { userId: created.id, expiresAt: setupDeadline })
```

### P1-21 — El borrado físico elimina decisiones de aprobación

[BUG] `lib/services/requests-delete.constants.ts:1-32`; `lib/services/requests-delete.ts:60-106` — Qué falla: un usuario privilegiado puede borrar solicitudes `submitted`, `in_review` o `partially_approved`; el servicio elimina `approvalDecisions` y después la solicitud/ítems. La auditoría preserva sólo status y tipo, no las decisiones ni el contenido. — Cómo reproducir: aprobar parcialmente una solicitud y borrarla con `requests:delete`; consultar después decisiones e ítems: ya no existen. — Impacto: pérdida irreversible de evidencia de aprobación y trazabilidad insuficiente para reconstruir el acto. — Fix sugerido: hard delete sólo para borradores sin decisiones; para el resto usar soft delete/tombstone y conservar relaciones.

Código sugerido:

```ts
if (request.status !== "draft" || decisionCount > 0) {
  await tx.update(purchaseRequests).set({ deletedAt: now, deletedBy: userId })
} else {
  await tx.delete(purchaseRequests).where(eq(purchaseRequests.id, requestId))
}
```

### P1-22 — Dependencias con vulnerabilidades críticas/altas

[GAP] `package.json:58-84` — Qué falla: `npm audit --audit-level=high` reporta 10 vulnerabilidades: 2 críticas, 7 altas y 1 baja. Entre las críticas aparecen `next-auth@5.0.0-beta.31` y su dependencia `@auth/core`; también hay avisos altos para `next`, `@tailwindcss/postcss`, `brace-expansion`, `js-yaml`, `postcss`, `sharp` y `vite`. — Cómo reproducir: ejecutar `npm audit --audit-level=high` en este commit; termina con código 1. — Impacto: gate de supply chain rojo y exposición dependiente de las rutas afectadas por cada advisory. — Fix sugerido: actualizar por lotes compatibles, revisar breaking changes de Auth/Next y ejecutar auth, build y suite PostgreSQL antes de liberar; no usar `npm audit fix --force` sin validación.

Código sugerido:

```bash
npm outdated
npm install next-auth@5.0.0-beta.32
npm update
npm run typecheck && npm run lint && npm run test:coverage && npm run build
```

### P1-23 — Las pruebas PostgreSQL críticas no forman parte del gate ordinario

[GAP] `lib/__tests__/receiving-concurrency-postgres.test.ts:25-32,65-111` y otros 21 archivos `*-postgres.test.ts` — Qué falla: 22 archivos usan `describe.skip` si no se proporciona una URL dedicada y un flag destructivo; `test:coverage` dejó 168 tests omitidos. El test de recepción sí usa `Promise.allSettled` y valida la BD, pero no corre en el comando exigido. — Cómo reproducir: ejecutar `npm run test:coverage` sin las variables especiales; la salida muestra `21 skipped` files y `168 skipped` tests. — Impacto: carreras y bypasses P0/P1 pueden entrar en main sin que el CI ordinario los pruebe en PostgreSQL real. — Fix sugerido: aprovisionar una base efímera en CI y separar un gate obligatorio `test:postgres-critical` con los guards destructivos limitados a esa base.

Código sugerido:

```yaml
services:
  postgres:
    image: postgres:17
env:
  RECEIVING_CONCURRENCY_DATABASE_URL: postgresql://postgres:postgres@localhost/chome_test
  RECEIVING_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET: "true"
```

---

## Hallazgos P2

### P2-24 — Aprobación masiva documentada como atómica, implementada como parcial

[INCONSISTENCIA] `lib/services/item-state-module/approval.ts:11-15,23-99`; `app/(app)/aprobaciones/actions.ts:225-242` — Qué falla: el contrato afirma rollback total si falla un ítem, pero cada error se captura y la transacción confirma los aprobados. La acción incluso responde “N aprobados, M con error”. — Cómo reproducir: enviar un lote con dos `requested` y un ID inválido; los dos válidos quedan aprobados aunque el resultado general sea `ok:false`. — Impacto: caller/operador puede reintentar creyendo que nada se aplicó; comportamiento contrario a documentación y al requerimiento de atomicidad. — Fix sugerido: o prevalidar/bloquear todos en orden estable y lanzar ante cualquiera, o renombrar/documentar explícitamente la operación parcial y mostrar resultado por ítem.

Código sugerido:

```ts
const locked = await lockAllItemsSorted(tx, itemIds)
if (locked.length !== itemIds.length || locked.some((i) => !canApprove(i))) {
  throw new Error("El lote completo fue rechazado")
}
```

### P2-25 — Se aceptan fechas requeridas en el pasado

[BUG] `lib/validation/operations.ts:15-28,43-51` — Qué falla: `requiredDate` sólo es string requerido en cabecera y string opcional en ítem; no se valida formato real ni `>= hoy`. — Cómo reproducir: crear una solicitud con `requiredDate=2020-01-01`; Zod la acepta. — Impacto: SLA, urgencia, dashboard y recordatorios parten con datos imposibles. — Fix sugerido: usar un schema de fecha local ISO y refinar contra la fecha de Chile al momento de crear/editar.

Código sugerido:

```ts
const futureLocalDate = z.iso.date().refine((value) => value >= todayInChile(), {
  message: "La fecha requerida no puede estar en el pasado",
})
```

### P2-26 — Recurrencia PDTP `custom` sin meses produce cero planificación

[BUG] `lib/validation/prevention-module/pdtp.ts:49-55`; `lib/services/pdtp/recurrence.ts:91-103`; `app/(app)/prevencion/pdtp/[programId]/editar/guided-activity-form.tsx:63-69` — Qué falla: el schema permite `frequency=custom` sin `months`; el proyector convierte eso en lista vacía. La UI guiada oculta `custom`, pero acciones/importaciones pueden enviarlo. — Cómo reproducir: invocar la acción con `{ frequency:"custom", months:undefined }`; la regla persiste y proyecta cero celdas. — Impacto: obligación válida en apariencia sin actividades ni recordatorios. — Fix sugerido: `superRefine` que exija al menos un mes para custom o eliminar custom del contrato público.

Código sugerido:

```ts
.superRefine((rule, ctx) => {
  if (rule.frequency === "custom" && !rule.months?.length) {
    ctx.addIssue({ code: "custom", path: ["months"], message: "Selecciona al menos un mes" })
  }
})
```

### P2-27 — Las anomalías de combustible quedan obsoletas al editar una carga

[BUG] `app/(app)/combustibles/actions-module/loads.ts:155-245`; `lib/combustibles/anomaly-cases.ts:80-104`; `lib/combustibles/anomaly-detector.ts:378-408` — Qué falla: `fuel_loads` es editable, pero `updateFuelLoadAction` no reevalúa casos. La deduplicación devuelve cualquier caso previo, incluso resuelto/descartado, basándose en el supuesto documentado de entidad inmutable. — Cómo reproducir: resolver una anomalía de proveedor, editar la carga para volver a incumplir y ejecutar detector; el caso anterior impide uno nuevo. A la inversa, corregir una carga no cierra el caso. — Impacto: alertas falsas o anomalías reales invisibles. — Fix sugerido: reevaluar reglas afectadas en la misma operación post-commit y versionar/reabrir/cerrar casos con historial.

Código sugerido:

```ts
await updateFuelLoad(...)
notifyAfterCommit(() => reevaluateAnomaliesForFuelLoad(id, { reopenResolved: true }))
```

### P2-28 — Cambiar stock mínimo no deja auditoría

[GAP] `app/(app)/bodega/actions.ts:126-150` — Qué falla: `setMinStockAction` actualiza directamente `worksite_stock.minStock` y revalida, pero no registra `recordAudit`; fue la única mutación directa real detectada en Server Actions sin auditoría en su bloque operativo. — Cómo reproducir: cambiar mínimo desde Bodega y buscar el evento por stock/faena; no existe. — Impacto: no se puede atribuir quién alteró el umbral que dispara compras/alertas. — Fix sugerido: bloquear la fila, guardar valor previo y auditar dentro de la misma transacción.

Código sugerido:

```ts
await db.transaction(async (tx) => {
  const stock = await lockStockById(tx, stockId)
  await tx.update(worksiteStock).set({ minStock }).where(eq(worksiteStock.id, stockId))
  await recordAudit({ action: "update", oldState: { minStock: stock.minStock }, newState: { minStock } }, tx)
})
```

### P2-29 — Ajustes/devoluciones manuales carecen de `referenceId`

[GAP] `app/(app)/bodega/actions.ts:186-199,265-275`; `db/schema/stock.ts:24-32` — Qué falla: los movimientos usan `referenceType: "adjustment" | "return"` pero omiten `referenceId`; sólo quedan texto libre y el ID de faena usado por auditoría. — Cómo reproducir: crear dos ajustes iguales y abrir kardex; no existe una entidad/folio desde la cual reconstruir aprobación, adjuntos o devolución de origen. — Impacto: kardex no navegable y evidencia débil para conciliación. — Fix sugerido: crear cabeceras `stock_adjustments`/`stock_returns`, asignar código secuencial y referenciarlas desde cada movimiento.

Código sugerido:

```ts
referenceType: "stock_adjustment",
referenceId: adjustment.id,
```

### P2-30 — La OC acepta proveedor inactivo y mezcla centros de costo

[BUG] `app/(app)/compras/actions/create-order.ts:84-112`; `lib/services/purchasing-module/purchase-orders-create.ts:146-164` — Qué falla: se consulta el subconjunto de proveedores activos pero no se verifica que todos los IDs objetivo hayan sido encontrados; un ID inactivo llega al insert. Además, el centro de costo de la OC se toma sólo del primer ítem, aunque los demás puedan venir de solicitudes con otro centro. — Cómo reproducir: manipular `supplierId` con un proveedor inactivo; o agrupar dos ítems de igual faena/proveedor y distintos centros: la OC hereda el primero silenciosamente. — Impacto: OC contra maestro inhabilitado y costeo incorrecto. — Fix sugerido: comparar sets de proveedores y agrupar/rechazar por centro de costo.

Código sugerido:

```ts
if (activeSuppliers.length !== targetSupplierIds.length) throw new Error("Proveedor inactivo")
if (new Set(sourceItems.map((i) => i.costCenterId)).size > 1) throw new Error("Separa por centro de costo")
```

### P2-31 — Error al eliminar hoja PDTP nunca se muestra

[BUG] `app/(app)/prevencion/pdtp/[programId]/editar/tabs/sheets-tab.tsx:88-99` — Qué falla: `useActionState` guarda el resultado como `_state` y el componente no lo renderiza ni dispara toast. — Cómo reproducir: forzar que `deletePdtpSheetAction` retorne `{ok:false,message:"..."}`; el botón deja de estar pending y el usuario no recibe feedback. — Impacto: error silencioso y repetición de acciones destructivas. — Fix sugerido: mostrar el estado accesiblemente o usar el patrón de operación imperativa con mensaje.

Código sugerido:

```tsx
const [state, formAction, pending] = useActionState(deletePdtpSheetAction, null)
{state?.message && <p role="status">{state.message}</p>}
```

### P2-32 — `test:coverage` no produce cobertura por timeout estable bajo instrumentación

[GAP] `lib/__tests__/prevention-pdtp-catalog.test.ts:93-102` — Qué falla: dos corridas completas terminaron en el mismo timeout de 20 s al leer/modificar dos veces el workbook; el mismo archivo pasa aislado en 17.26 s. Al fallar un test, no se emite resumen de cobertura, por lo que el umbral de 50% solicitado no puede verificarse. — Cómo reproducir: `npm run test:coverage` termina con 1 fallo, 362 archivos pasados, 21 omitidos, 3052 tests pasados y 168 omitidos; `npx vitest run lib/__tests__/prevention-pdtp-catalog.test.ts` pasa. — Impacto: gate de cobertura rojo/no medible y flakiness dependiente de carga. — Fix sugerido: cargar una vez y clonar el workbook/fixture pequeño; perfilar antes de aumentar timeout. Separar cobertura de los tests de integración pesados si el criterio queda documentado.

Código sugerido:

```ts
const baseWorkbook = await readPdtpWorkbook(workbookPath)
const missingSheetWorkbook = await cloneWorkbook(baseWorkbook)
const alteredWorkbook = await cloneWorkbook(baseWorkbook)
```

---

## Hallazgos P3

### P3-33 — Strings de atributos no tienen límites simétricos

[GAP] `lib/validation/operations.ts:7-12`; `lib/validation/masters.ts:111-120`; `db/schema/requests.ts:89-99` — Qué falla: `attributeName` sólo exige un carácter y `value` no tiene máximo en Zod; la BD limita `value` a 64, pero no `attributeName`. `productAttributeSchema.options` acepta JSON arbitrariamente grande. React escapa el contenido, por lo que no se confirmó XSS; el problema real es error tardío/storage abusivo. — Cómo reproducir: enviar `attributeName` muy largo o `value` de 65 caracteres; el primero llega sin límite y el segundo pasa Zod pero falla en BD. — Impacto: validación asimétrica, errores 500 y crecimiento innecesario. — Fix sugerido: `trim/min/max` equivalentes al modelo y límite de opciones/array.

Código sugerido:

```ts
attributeName: z.string().trim().min(1).max(60),
value: z.string().trim().min(1).max(64),
options: z.string().max(4000).optional().nullable(),
```

### P3-34 — 65 servicios no tienen correspondencia directa con un test

[GAP] `lib/services/**`; `lib/__tests__/**` — Qué falla: un cruce estático de 191 archivos de servicio contra 365 archivos de test encontró 65 sin test homónimo ni import directo desde tests. La métrica puede incluir cobertura indirecta por barrels, por lo que no equivale automáticamente a “cero líneas cubiertas”; el fallo de `test:coverage` impidió resolverlo con cobertura V8. — Cómo reproducir: cruzar los paths bajo `lib/services` con nombres/imports en `*.test.*`; la lista completa está en el apéndice. — Impacto: cambios en servicios ejecutables pueden carecer de regresión localizada; destacan `epp-replenishment.ts`, `purchase-orders-create.ts`, `invoices.ts`, `invoice-extractor.ts` y varios flujos PDTP. — Fix sugerido: comenzar por servicios P0/P1 y exigir tests de contrato, concurrencia y scope; excluir explícitamente `.types.ts`/constantes de la métrica de ejecutables.

Código sugerido:

```ts
it("rechaza ítems de una faena distinta dentro de la transacción", async () => {
  await expect(createOrdersBySupplier(crossWorksiteInput, ["ws-a"])).rejects.toThrow(/faena/)
})
```

---

## Controles verificados que no se reportan como bug

| Área | Evidencia/resultado |
|---|---|
| Máquina de ítems | `ALLOWED_TRANSITIONS` no permite `approved → delivered`; `rejected` y `delivered` son terminales. `resumeItemAction` exige exactamente `postponed`. `returned → requested` está permitido para corrección. |
| Aprobación individual | `approveItem` usa `FOR UPDATE`, valida transición y actualiza con estado esperado; dos aprobadores no pueden confirmar el mismo ítem. |
| Creación de OC | El alta y `in_purchase_order` ocurren dentro de una sola transacción; la falla es de scope/identidad, no de atomicidad básica. |
| Recepción concurrente | La OC y cada línea se bloquean con `FOR UPDATE`. El test real usa dos promesas simultáneas y comprueba una sola recepción; el gap es que está omitido por defecto. |
| Stock/kardex | No se encontraron mutaciones directas de `worksite_stock.quantity` fuera del servicio de movimientos. El signo de `adjustStockAction` distingue correctamente ingreso positivo y egreso negativo. |
| Etapas recepción | La etapa oficina actualiza `quantityOfficeReceived`; el ingreso de stock se aplica sólo en faena, evitando inflar simultáneamente dos ubicaciones. |
| CAPA | Las mutaciones de estado encontradas pasan por la tabla de transiciones y registran historial. El override de segregación exige permiso específico y motivo; su asignación a administrador es una decisión de gobierno, no un bypass técnico oculto. |
| Incidentes/SST | El cierre exige gates CAPA; `closed` no tiene transición de reapertura. Los cálculos de frecuencia/gravedad protegen división por cero. |
| PDTP | Recordatorios/obligaciones usan claves e inserts idempotentes. `frequency=custom` vacío sigue siendo el edge case P2-26. |
| Permisos de trabajo | La activación valida vigencia, cuadrilla y controles; el cierre exige motivo/observación mínima. |
| TAE access | Los links se validan por hash, revocación y expiración. No son one-shot: el modelo los trata como links públicos reutilizables; no se marcó como bug sin requisito contrario. |
| RBAC/auth | Usuarios `isActive=false` son rechazados. El callback JWT relee RBAC con bypass de caché, por lo que revocaciones no dependen sólo del LRU local de 5 s. |
| Invitaciones | Se validan expiración/aceptación y la asignación de faena ocurre en transacción. |
| Rate limit | La poda probabilística elimina registros vencidos; `successCount` sí se consume en telemetría administrativa. No se confirmó crecimiento sin límite con la evidencia actual. |
| Backups | Incluyen BD, storage/configuración y checksums; existe verificación remota. El endpoint público de status parece destinado a monitoreo externo y se deja como decisión de exposición, no como bug confirmado. |
| Archivos | `validateFileBuffer` comprueba magic bytes. `serverActions.bodySizeLimit` está configurado en 21 MB y las acciones revisadas validan tamaño antes de persistir. |
| Exports/toasts | No se encontraron exports CSV prohibidos ni imports funcionales directos de `sonner` fuera del wrapper/Toaster. |
| Revalidación | El barrido de Server Actions mutantes no encontró acciones sin `revalidatePath`, `redirect` o helper de revalidación; el `redirect` de creación de OC está correctamente relanzado fuera del catch normal. |
| Notificaciones | `notifyAfterCommit` captura/loguea fallas y evita mezclar APIs externas con el commit de negocio. |

## Resultado de comandos de verificación

| Comando | Resultado | Evidencia resumida |
|---|---|---|
| `npm run typecheck` | PASS | Código 0, sin errores. |
| `npm run lint` | PASS | Código 0, sin errores ESLint/custom. |
| `npm run test:coverage` | **FAIL** | Dos corridas: timeout en `prevention-pdtp-catalog.test.ts:93`; 362 archivos/3052 tests pasaron, 21 archivos/168 tests omitidos. No se generó resumen de cobertura. |
| `npx vitest run lib/__tests__/prevention-pdtp-catalog.test.ts` | PASS aislado | 1 archivo, 5 tests; 17.26 s. Confirma sensibilidad a instrumentación/carga. |
| `npm run db:verify-migrations` | PASS | 122 entradas verificadas hasta `0121_perfect_xorn`. |
| `npm run check:secrets` | PASS | `Env files check passed.` |
| `npm run build` | PASS con warning | Next.js 16.2.10 compila/renderiza; Turbopack advierte tracing del proyecto completo por `next.config.ts → lib/services/backups.ts → app/api/backups/status/route.ts`. |
| `npm run check:bundle-budget` antes de build | FAIL operativo | Faltaba `.next/diagnostics/route-bundle-stats.json`; el script indicó ejecutar build. |
| `npm run check:bundle-budget` después de build | PASS | 161 rutas; peor `/combustibles/facturas` 2.42 MB sobre presupuesto 3.00 MB. |
| `npm audit --audit-level=high` | **FAIL** | 10 vulnerabilidades: 2 críticas, 7 altas, 1 baja. |
| `npx gitleaks detect --source . --no-git 2>/dev/null` | **NO EJECUTABLE** | Código 1 sin salida por redirección. Repetido sin ocultar stderr: `npm ERR! could not determine executable to run`; `gitleaks` no está instalado/resuelto por npm. |

### Nota sobre el warning de build

No se abre un hallazgo independiente porque el presupuesto final pasa. Conviene
evitar imports server-wide desde la ruta de status de backups o aislar el código
de filesystem/child-process para que el tracing de despliegue standalone no
incluya innecesariamente todo el proyecto.

## Apéndice A — Suites PostgreSQL omitidas por defecto

1. `approvals-concurrency-postgres.test.ts`
2. `combustibles-scope-postgres.test.ts`
3. `deliveries-concurrency-postgres.test.ts`
4. `prevention-capa-postgres.test.ts`
5. `prevention-change-postgres.test.ts`
6. `prevention-cphs-postgres.test.ts`
7. `prevention-emergency-postgres.test.ts`
8. `prevention-epp-postgres.test.ts`
9. `prevention-hygiene-postgres.test.ts`
10. `prevention-incidents-postgres.test.ts`
11. `prevention-indicators-postgres.test.ts`
12. `prevention-inspections-postgres.test.ts`
13. `prevention-permits-postgres.test.ts`
14. `prevention-privacy-postgres.test.ts`
15. `prevention-risk-legal-postgres.test.ts`
16. `prevention-training-postgres.test.ts`
17. `quotation-download-routes-scope-postgres.test.ts`
18. `rate-limit-concurrency-postgres.test.ts`
19. `receiving-concurrency-postgres.test.ts`
20. `seed-workers.test.ts`
21. `stock-concurrency-postgres.test.ts`
22. `trabajadores-scope-postgres.test.ts`

## Apéndice B — Servicios sin test homónimo ni import directo desde tests

Esta lista es un inventario estático para priorización. Los archivos de tipos,
constantes o servicios alcanzados indirectamente por un barrel pueden tener
cobertura transitiva; sólo una corrida de cobertura exitosa puede confirmarla.

1. `lib/services/prevention-attention.ts`
2. `lib/services/epp-delivery-export.ts`
3. `lib/services/epp-replenishment.ts`
4. `lib/services/epp-coverage-export.ts`
5. `lib/services/email-template-render.ts`
6. `lib/services/prevention-permits-export.ts`
7. `lib/services/deliveries.types.ts`
8. `lib/services/operational-metric-snapshots.ts`
9. `lib/services/requests-draft-create.ts`
10. `lib/services/worker-size.ts`
11. `lib/services/sizes.ts`
12. `lib/services/operational-cache.ts`
13. `lib/services/purchasing.constants.ts`
14. `lib/services/epp-import.types.ts`
15. `lib/services/notification-create.ts`
16. `lib/services/sst-module/evaluations.ts`
17. `lib/services/sst-module/weekly.ts`
18. `lib/services/sst-module/responses.ts`
19. `lib/services/sst-module/evaluation-archive.ts`
20. `lib/services/oc-reconciliation.ts`
21. `lib/services/operational-trend-history.ts`
22. `lib/services/requests-draft-update.ts`
23. `lib/services/trazabilidad-item.types.ts`
24. `lib/services/dashboard-metrics.ts`
25. `lib/services/ppa-module/evaluaciones.ts`
26. `lib/services/ppa-module/calculos.ts`
27. `lib/services/prevention-training-reminders.ts`
28. `lib/services/prevention-documents/types.ts`
29. `lib/services/prevention-documents/folders-queries.ts`
30. `lib/services/prevention-documents/labels.ts`
31. `lib/services/prevention-documents/folders-crud.ts`
32. `lib/services/prevention-documents/folders-move.ts`
33. `lib/services/dashboard-fleet-maintenance.ts`
34. `lib/services/requests-draft.types.ts`
35. `lib/services/deliveries-worksite.ts`
36. `lib/services/analytics-module/types.ts`
37. `lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts`
38. `lib/services/pdtp-adapters/responsible-catalog-2026.ts`
39. `lib/services/pdtp-adapters/incident-accreditation-connector.ts`
40. `lib/services/pdtp-adapters/checklist-templates-2026.ts`
41. `lib/services/prevention-inspections-export.ts`
42. `lib/services/requests-delete.constants.ts`
43. `lib/services/purchasing-module/purchase-orders-delete.ts`
44. `lib/services/purchasing-module/invoice-extractor.ts`
45. `lib/services/purchasing-module/receiving.ts`
46. `lib/services/purchasing-module/invoice-ocr.ts`
47. `lib/services/purchasing-module/invoices.ts`
48. `lib/services/purchasing-module/purchase-orders-create.ts`
49. `lib/services/purchasing-module/purchase-orders-edit.ts`
50. `lib/services/pdtp/management-report.ts`
51. `lib/services/item-state-module/purchase-order.ts`
52. `lib/services/item-state-module/receiving.ts`
53. `lib/services/item-state-module/types.ts`
54. `lib/services/item-state-module/approval.ts`
55. `lib/services/item-state-module/rollup.ts`
56. `lib/services/item-state-module/submit.ts`
57. `lib/services/pdtp/activities.ts`
58. `lib/services/pdtp/audit-dossier.ts`
59. `lib/services/pdtp/activity-content.ts`
60. `lib/services/pdtp/lifecycle.ts`
61. `lib/services/pdtp/document-metadata.ts`
62. `lib/services/pdtp/approval-flow.ts`
63. `lib/services/pdtp/imports.ts`
64. `lib/services/pdtp/sheets.ts`
65. `lib/services/pdtp/sheet-management.ts`

Los cuatro candidatos prioritarios nombrados en el encargo no están todos
huérfanos: existen `physical-inventory-service.test.ts`,
`physical-inventory.test.ts`, `fuel-tae-schedule.test.ts`,
`module-toggles.test.ts`, `smtp-settings.test.ts` y tres suites de privacidad
(`prevention-privacy-export`, `prevention-privacy-postgres` y
`prevention-privacy-workflow`). En inventario físico falta específicamente la
regresión de snapshot adulterado/movimiento concurrente señalada en P1-07; en
privacidad la suite PostgreSQL queda omitida sin el entorno destructivo.

## Apéndice C — Tests con assertions potencialmente débiles

El patrón `expect(result.ok).toBe(true)` o `toBeDefined()` aparece repetidamente,
pero muchas ocurrencias tienen assertions adicionales y no se clasificaron
automáticamente como falsos positivos. Deben priorizarse los tests de acciones
mockeadas en `admin-cost-centers-actions.test.ts`, `mantenciones-actions.test.ts`,
`admin-ops-settings-actions.test.ts`, `ppa-actions.test.ts`,
`bodega-actions.test.ts` y `admin-usuarios-actions.test.ts`: agregar verificación
del estado persistido, auditoría y revalidación, no sólo del envelope de retorno.

## Criterio de cierre

La auditoría puede considerarse cerrada técnicamente cuando:

1. P0-01/P0-02 tengan tests negativos reales en PostgreSQL y prueba de que no se
   muta ninguna fila fuera de scope.
2. Las transiciones sin lock usen un único patrón transaccional y la suite
   concurrente sea obligatoria.
3. Recepción, inventario físico y EPP tengan invariantes de saldo/lote verificadas
   en BD, no sólo en UI.
4. DTE/facturas rechacen estructuras incompletas y duplicados con fixtures SII.
5. `npm audit --audit-level=high`, `npm run test:coverage` y gitleaks terminen
   ejecutables y verdes; el umbral de cobertura se pueda medir.
