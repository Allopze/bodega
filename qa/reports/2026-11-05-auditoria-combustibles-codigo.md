# Auditoría de código · módulo de combustibles (rediseño `/combustibles`)

**Fecha:** 2026-11-05 · **Alcance:** revisión estática del módulo nuevo (`panel`, `cargas`, `revisar`, `cuadratura`, `consumo`, `pagos`, `fuentes`, `ajustes`), sus servicios de cálculo/proyección, importadores, sincronización Copec, TAE/ciclo, esquema y migraciones 0359–0371.

**Método:** lectura y trazado de código. **No se ejecutó la aplicación ni las suites** en esta pasada; los hallazgos son reproducibles por lectura, pero los que dependen de concurrencia real o de datos de producción conviene confirmarlos con una prueba PGlite o en el ambiente de QA. No se proponen funciones nuevas: se describe comportamiento actual que falla, se contradice o pierde datos.

---

## 1. Resumen ejecutivo

Los diez defectos ocultos de mayor impacto hoy:

1. **Lost update en la serie canónica**: `recomputeVehicleSeries` lee y reescribe la serie sin lock; sólo el alta en terreno toma el advisory lock. Una revisión o corrección simultánea puede dejar la serie calculada con una foto vieja (`projection-series.ts:52-111`).
2. **Un despacho de suministro puede moverse de faena**: la clave única de `fuel_supply_inputs` es `(medio, referencia)` y el upsert actualiza `worksite_id`. Un folio reutilizado entre faenas mueve los litros de una a otra (`imports/service.ts:309-320`).
3. **Cargas operacionales duplicadas**: `fuel_operation_records` no tiene clave natural única y el lock del importador es por hash de archivo; dos archivos que se solapan (mensual y trimestral) no se serializan (`actions-operaciones.ts:165`).
4. **Decisiones de revisión obsoletas**: sólo el alta en terreno usa `snapshotDecidedLoadsAfter`/`resetStaleDecisionsAfter`; validar, anular, corregir lectura, importar planilla o vincular una patente no reabre las decisiones posteriores (`review.ts:46-47`, `tae/actions.ts:196-197`).
5. **Un mes Copec con una sola fila inválida bloquea el barrido para siempre**: queda `failed` con `rowsReceived > 0`, no es terminal, no se puede confirmar vacío y no se puede saltar; el barrido lanza error en cada corrida (`copec-sync.ts:540-551, 1175-1185`).
6. **Una corrección del proveedor nunca converge**: `priorCopecEvents` incluye la fila `:correction-review` y la original, así que cada corrida vuelve a marcar la misma corrección y el mes queda `incomplete` (`copec-sync.ts:585-594`, `copec-events.ts:79-95`).
7. **El flag `offline` salta el permiso de carga pasada**: la ruta interna sólo exige `register_past_load` si viene `pastLoad`; `offline + capturedAt` fecha la carga hasta 30 días atrás sin motivo ni marca de carga pasada (`app/api/combustibles/cargas/route.ts:52-55`, `field-load-rules.ts:163-172`).
8. **Un vínculo manual de patente vale sólo para una cuenta**: el `inFleet` se construye con los mappings de `tct:diesel` o `tct:bluemax`, no del proveedor; una patente vinculada en Diésel se descarta en BlueMax como `not_in_fleet`, sin quedar pendiente (`plate-resolver.ts:50-56, 102-116`).
9. **La revisión TAE puede trabar equipos sin medidor**: la guarda OCR exige `meterReadingSource !== "manual"`, pero un equipo sin medidor guarda `null`; si el OCR sugiere una lectura con baja confianza, la carga no se puede validar (`review.ts:22-28`, `submit.ts:244`).
10. **Cambiar medidor/unidad no recalcula la serie**: se actualiza el equipo, pero `fuel_equipment_loads.performance_value` conserva el valor de la unidad vieja y las consultas lo etiquetan con la unidad nueva (`actions-module/vehicles.ts:206-208`, `queries/performance.ts:42,50-51`).

---

## 2. Concurrencia e integridad de datos

### 2.1 ALTA · `recomputeVehicleSeries` no se serializa por equipo: lost update

**Dónde:** `lib/combustibles/control/projection-series.ts:52-111` (lee todas las filas y escribe sólo las que cambiaron; `persistChunk` en `:114-140`) · `lib/services/fuel-tae/submit.ts:194` (único advisory lock) · `lib/combustibles/control/review.ts:46,86,252` · `lib/combustibles/control/projection.ts:27,40,59` · `app/(app)/combustibles/tae/importar/actions.ts:168` · `app/(app)/combustibles/ajustes/actions-thresholds.ts:128` · `scripts/backfill-fuel-equipment-loads.ts:73`.

**Escenario:** un revisor valida una carga del camión KA-63 mientras un operador registra otra carga del mismo equipo. El alta toma `pg_advisory_xact_lock(fuel_tae_vehicle:KA-63)`; la revisión no. Ambas transacciones leen la misma foto de la serie, calculan `anchor_load_id`, `meter_delta`, `accumulated_liters`, `performance_value`, `duplicate_of_id` y `flag_reasons`, y escriben con `UPDATE … FROM (VALUES …)` sin versión. La última en commitear impone su cálculo. Una carga regresiva puede quedar `performance_status='computed'` y la decisión de revisión se tomó contra una serie que ya no existe.

**Impacto:** promedios y marcas de revisión silenciosamente incorrectos; no hay columna de versión ni guarda de escritura que lo detecte. El backfill que corre en cada deploy y el recálculo global de umbrales compiten por la misma tabla.

**Corrección mínima:** tomar el mismo lock por equipo al inicio de `recomputeVehicleSeries` (o `SELECT … FOR UPDATE` sobre `fuel_vehicles`) y releer las filas después del lock.

### 2.2 ALTA · `fuel_supply_inputs`: el upsert mueve filas de una faena a otra

**Dónde:** `db/schema/fuel-control-imports.ts:68` (`uniqueIndex(supply_medium_id, reference)`) · `lib/combustibles/control/imports/service.ts:309-320` (`onConflictDoUpdate` con `worksiteId: excluded.worksite_id` y `vehicleId`, `liters`, `occurredAt`, `month`) · guarda en `:189-201`.

**Escenario:** un surtidor compartido por dos faenas numera folios que se reinician cada mes. El operador A importa la faena A: queda `(medio, "1") = 5.000 L / faena A`. El operador B importa la faena B, que también trae `"1"`: la fila existente se **actualiza** a faena B, con sus litros/fecha/equipo. Si el actor es global o tiene acceso a ambas faenas, `guardSupplyScope` no lo detiene. La faena A pierde el despacho sin error.

**Impacto:** litros atribuidos a la faena equivocada en conciliación, cobertura y ciclo físico; el lote A queda `imported` con contadores que ya no describen sus filas.

**Corrección mínima:** incluir `worksite_id` y `month` en la clave, o convertir la colisión en un rechazo explícito por fila.

### 2.3 ALTA · `fuel_operation_records` sin clave natural única; el lock es por hash de archivo

**Dónde:** `db/schema/fuel-operations.ts:41-75` (sin `uniqueIndex`) · `lib/combustibles/operations-import-shared.ts:93-125` (dedupe por lectura previa) · `app/(app)/combustibles/actions-operaciones.ts:165-186` (`lockKey = fuel_ops:${hashArchivo}`).

**Escenario:** `2026-03.xlsx` y el consolidado `2026-T1.xlsx` (que contiene marzo) se confirman en la misma ventana. Cada archivo tiene hash distinto y lock distinto; ambos calculan `existingOperationKeys` antes de que el otro commitee y ambos insertan las mismas filas de marzo. Cada carga queda duplicada en `fuel_equipment_loads`, con litros y acumulados dobles; el detector de duplicados no las marca porque sólo compara entre canales (`calc/duplicates.ts:9-14`).

**Impacto:** litros operacionales inflados; no hay constraint que lo detecte.

**Corrección mínima:** índice único por lote + identidad natural, o lock por período/faena en vez de por hash de archivo.

### 2.4 ALTA · Drift de FK en `fuel_seal_movements` y pérdida del historial al revertir un lote

**Dónde:** `db/migrations/0053_icy_nova.sql:76` (`ON DELETE no action`) · `db/migrations/meta/0371_snapshot.json` (`onDelete: cascade`) · `db/schema/fuel-tae.ts:263` (`onDelete: "cascade"`) · `app/(app)/combustibles/tae/importar/actions.ts:134-168`.

La base creada por migraciones tiene `NO ACTION`; el snapshot y el schema Drizzle dicen `cascade`. Como el snapshot ya tiene `cascade`, `drizzle-kit generate` no emitirá el `ALTER`: el drift es invisible y permanente. Para compensar, la reversa de lote **borra** los movimientos de sello antes de borrar las submissions (`actions.ts:157`), incluido `evidence_sha256`, que es el único registro del hash de la foto del sello.

**Impacto:** entornos distintos según se creen con `migrate` o `push`; cualquier borrado de submission fuera del workaround falla por FK; la reversa destruye el historial de sellos del lote.

**Corrección mínima:** migración que cambie la FK a `ON DELETE CASCADE` y retirar el borrado explícito; si el historial debe sobrevivir, no usar cascade y archivar el movimiento antes.

### 2.5 MEDIA · `fuel_reconciliation_links`: el único no puede cumplir su promesa con NULLs

**Dónde:** `db/schema/fuel-reconciliation.ts:42-43` (único sobre `provider_transaction_id, link_type, fuel_load_id, cycle_movement_id, dte_document_id`) · `lib/combustibles/fuel-reconciliation.ts:205-213` (`DELETE` + `INSERT` sin lock).

En `unmatched`/`ambiguous` las tres columnas de destino son `NULL`, y en PostgreSQL los `NULL` son distintos: el índice no impide duplicados. El código compensa con `DELETE`+`INSERT`, pero dos corridas concurrentes (cron y botón) pueden no ver la fila de la otra e insertar dos `unmatched`. En `matched` el duplicado sí choca contra el índice y aborta la corrida.

**Impacto:** `unmatched_reconciliation_links` del preflight crece para siempre; una carrera puede cerrar la corrida como `partial`.

**Corrección mínima:** índice único parcial sobre `(provider_transaction_id, link_type)` para las filas sin destino, y serializar la escritura.

### 2.6 MEDIA · Revertir un lote TAE deja marcas de revisión, anomalías y cadena de sellos huérfanas

**Dónde:** `app/(app)/combustibles/tae/importar/actions.ts:160-168` · `db/schema/fuel-review-marks.ts:22` (`entity_id` sin FK) · `fuel_anomaly_cases` · `reevaluateNextSubmissionSealChain` sólo se llama al insertar (`submit.ts:328-333`).

La reversa borra submissions, movimientos de sello y recalcula la serie, pero no cierra `fuel_review_marks` abiertos ni descarta los casos de anomalía de esas cargas. Peor: la carga siguiente conserva su `seal_chain_status` y `seal_chain_expected` calculados contra una carga que ya no existe.

**Impacto:** pedidos de revisión irresolubles, casos activos apuntando a ids inexistentes y cadena de sellos falsa; la reversa de operaciones sí descarta sus anomalías (`actions-operaciones-batch.ts:42-57`), la de TAE no.

### 2.7 MEDIA · Los movimientos de sello no se retractan al dejar de estar validada la carga

**Dónde:** `lib/services/fuel-tae/review.ts:50-82` inserta movimientos sólo con `status === "validated"` · `lib/validation/fuel-tae.ts:91-95` permite `validated → observed` y `validated → voided`.

No hay borrado/retractación. `getSealHistory` sigue mostrando el retiro/instalación de una carga anulada u observada, y `fuel_seal_movements` es write-only en producción (sólo lo leen la reversa y el seed).

### 2.8 MEDIA · Los movimientos manuales del ciclo físico no son idempotentes

**Dónde:** `app/(app)/combustibles/cuadratura/estanques/actions.ts:31-41` · `lib/combustibles/fuel-cycle.ts:43-72`.

El formulario envía `documentNumber` («Documento o guía»), pero no `sourceType`/`sourceId`, que son la única clave única (`fuel-cycle_movements_source_unique`). `createFuelCycleMovement` inserta sin `onConflict` y no valida fecha futura ni duplicados. Un doble submit o un refresh del POST duplica litros recibidos e infla el nivel del estanque y `receivedVsDelivered`.

### 2.9 MEDIA · Idempotencia TAE por guía sola contra un proveedor que reutiliza guías

**Dónde:** `lib/combustibles/tae-receipts.ts:103-120` · `db/schema/fuel-cycle.ts:62-64` (`(source_type, source_id)`) · el propio `docs/combustibles/COPEC.md` y `copec-events.ts:74-77` documentan la reutilización de guías; la migración 0363 corrigió lo mismo en `fuel_meter_readings`.

**Escenario:** la guía `660150998` se usa para dos vehículos/estanques. En el mismo archivo el parser la rechaza y, según el caso, aborta el mes; entre meses `onConflictDoNothing()` descarta la segunda en silencio y `duplicates` sube sin work item.

### 2.10 MEDIA · El lock del importador de consumos no cubre «todas las faenas» vs una faena

**Dónde:** `app/(app)/combustibles/actions-consumos.ts:263,272-291`.

El modo global usa `fuel_tct_all:<hash>` y el modo por faena `fuel_tct:<hash>:<worksiteId>`. Dos usuarios que suben el mismo archivo, uno global y otro acotado a una faena, toman locks distintos y pueden crear dos lotes `(faena, período, fuente)` con los mismos litros.

---

## 3. Cálculo, series y revisión

### 3.1 ALTA · Las decisiones humanas no se reabren cuando la serie cambia por otra vía

**Dónde:** `lib/combustibles/control/stale-decisions.ts:7-24` (invariante y uso obligatorio) · `lib/services/fuel-tae/submit.ts:324-327` (único uso) · `lib/services/fuel-tae/review.ts:46-47` · `app/(app)/combustibles/tae/actions.ts:196-197` · `app/(app)/combustibles/actions-operaciones.ts:296-297` · `app/(app)/combustibles/actions-operaciones-batch.ts:101-102,141-142`.

Sólo el alta en terreno llama a `snapshotDecidedLoadsAfter` antes de proyectar y a `resetStaleDecisionsAfter` después. Las otras cuatro vías sólo llaman a `auditResetDecisions`, que **audita** pero no reabre las decisiones de las cargas posteriores.

**Escenario:** C1 (1.000 km) → C2 (1.300) → C3 (1.500). Jefatura aprueba C3. Se corrige C1 a 1.250 km; la serie de C3 se recalcula (otro ancla, otro `meter_delta`), pero C3 sigue `approved` y no queda auditoría de que su decisión cambió de base. Lo mismo si la carga faltante del 15-mar entra por la planilla consolidada o si se anula una carga intermedia.

**Impacto:** promedios que incluyen decisiones tomadas sobre una serie que ya no existe; pérdida de trazabilidad.

**Sub-caso:** `snapshotDecidedLoadsAfter` usa `gt(occurredAt, after)` (`stale-decisions.ts:122`). Una carga con el mismo instante que una ya decidida (la planilla sin hora queda 00:00) puede cambiar el orden por `id` y no entrar en la foto.

### 3.2 ALTA/MEDIA · Cambiar medidor, unidad o capacidad no recalcula la serie

**Dónde:** `app/(app)/combustibles/actions-module/vehicles.ts:206-208` (persiste `meterType`, `performanceUnit`, `tankCapacityLiters` sin recalcular) · `lib/combustibles/control/projection-series.ts:90-104` (el valor se calcula con la unidad del momento) · `lib/combustibles/control/queries/performance.ts:42,50-51` (agrupa y etiqueta con `fuelVehicles.performanceUnit` actual).

**Escenario:** una excavadora se creó por error como odómetro/km-L; 40 cargas dieron 4,2 «km/L». Administración la corrige a horómetro/L-h. Las consultas siguen promediando 4,2 y lo imprimen como **L/h**; el detalle de cargas muestra «4,20 L/h»; `over_capacity` sigue evaluado con el estanque anterior. Sólo se arregla si alguien recuerda «recalcular series» en Ajustes › Umbrales.

### 3.3 MEDIA-ALTA · El mes del proveedor mezcla UTC y hora de Chile

**Dónde:** `lib/combustibles/control/queries/field-filters.ts:42-50` (`left(occurredAt, 10/7)` sobre texto UTC) · `control/queries/reconciliation.ts:135-136,144` (entradas por `fuelSupplyInputs.month`, proveedor por `left(t.occurredAt,7)`, entregas por `chileMonthSql`) · `control/queries/meter-rates.ts:59,77-78` · `lib/combustibles/meter-rate-series.ts:115,139`.

**Escenario:** una transacción Copec del 31-mar 22:10 Chile se guarda `2026-04-01T01:10Z`. Con período marzo, la entrada cae en abril; la entrega del 31-mar queda en marzo. La conciliación mensual marca diferencia en ambos meses aunque el total cuadre. En `getMeterRateSeries`, la lectura de cierre se atribuye al mes siguiente y `monthsWithReadings` deja de declarar el hueco de abril.

### 3.4 MEDIA · El orden de dos cargas del mismo instante lo decide un `nanoid`

**Dónde:** `lib/combustibles/control/projection-series.ts:86` (`orderBy(asc(occurredAt), asc(id))`) · `projection-upsert.ts:124` (`id = nanoid()`) · `projection-sources.ts:171-178` (si la planilla no trae hora, `"00:00"`).

**Escenario:** dos cargas del mismo equipo el 12-mar sin hora, lecturas 5.000 h y 5.200 h. Si el `nanoid` ordena primero la de 5.200, la otra sale `meter_regression` espuria y sus litros se arrastran; el ancla queda en la lectura equivocada.

### 3.5 MEDIA · «L/h desde cargas» es promedio de razones; la telemetría es razón de sumas

**Dónde:** `lib/combustibles/control/queries/idle-comparison.ts:43,61` (`avg(performance_value)`) frente a `lib/combustibles/control/calc/idle.ts:11-15` (`Σlitros / Σhoras`).

**Escenario:** 50 L/10 h (5 L/h) y 40 L/1 h (40 L/h): el promedio es 22,5, el agregado coherente 90/11 = 8,2. La telemetría de 9 L/h se pinta como «60 % fuera de banda» cuando en realidad coincide.

### 3.6 BAJA · Filtro `equipo`: «contiene» en casi todas las consultas y «es igual a» en la lista por equipo

**Dónde:** `lib/combustibles/control/filters.ts:136,144` (`ilike '%t%'`) frente a `control/queries/performance.ts:193-195` (`lower(code) = t or lower(plate) = t`).

Con `?equipo=KA-1`, la tabla por equipo muestra sólo KA-1 mientras «Por faena» y el detalle incluyen KA-10, KA-11. El detalle no es el de la cifra que dice explicar.

### 3.7 BAJA · La ficha del equipo marca «fuera de rango» con σ = 0

**Dónde:** `lib/combustibles/equipment/normal-range.ts:12-23` no exige `sd > 0`; `control/calc/performance-series.ts:173-177` sí. Cinco cargas en 10,0 exactos y una en 10,5: la ficha pinta un punto fuera de rango y `outOfRangeRun` anuncia una racha, mientras la carga queda `ok`.

### 3.8 BAJA · «Declarado en planilla» se rotula con la unidad del equipo

**Dónde:** `control/projection-sources.ts:241` guarda sólo `rendimiento`, descarta `tipoRendimiento` · `control/queries/performance-detail.ts:71` usa la unidad del equipo. Una fila `lt_hr` de un equipo km/L muestra «12 km/L».

### 3.9 BAJA · «Rinde peor» ignora el filtro de equipo y cuenta equipos sin muestra

**Dónde:** `control/queries/performance.ts:132` (el `base` descarta `equipment` a propósito) y `:292-354` (`getEquipmentWorseSummary` no aplica el predicado). Con `equipo=KA-2`, la tabla tiene 1 fila y la frase dice «5 de 37 equipos».

---

## 4. Sincronización Copec e ingesta

### 4.1 ALTA · Una sola fila inválida deja el mes no-terminal y aborta el barrido

**Dónde:** `lib/combustibles/copec-sync.ts:540-551` (TCT) y `:868-875` (TAE) · `lib/combustibles/copec-coverage.ts:62-65` · `copec-sync.ts:1175-1185` · `copec-sync.ts:378`.

Una fila con volumen negativo, patente vacía o monto faltante manda el producto a `errors`; se registra `recordCopecPeriodCoverage({status:"failed", sourceAvailability:"available", rowsReceived:N>0})` y se `continue` sin proyectar el resto del mes. `failed` no es terminal; `canConfirmCopecEmpty` exige `rowsReceived === 0`; `setCopecSyncStartDate` prohíbe saltar un mes sin cobertura terminal. El bloque `allDimensionsTerminal` lanza error y **detiene todo el barrido** en cada corrida.

**Impacto:** la integración queda en fallo permanente y ningún mes posterior se importa; en TAE el disparador es más probable porque el parser rechaza el archivo entero si falta la guía o se repite.

### 4.2 ALTA · La corrección del proveedor se re-marca en cada corrida

**Dónde:** `copec-sync.ts:585-594` y `:891-902` · `copec-events.ts:79-95` · `copec-sync.ts:281-286` · `fuel-provider-ledger.ts:162-189`.

`priorCopecEvents` devuelve **todas** las filas del mes, incluida la original aceptada y la propia `:correction-review`. `hasPossibleCopecCorrection` compara la firma nueva contra la original (distinta) y vuelve a marcar; la corrección nunca reemplaza la evidencia previa. `fuel_provider_rejections.status` se inserta `open` y nadie lo pasa a `resolved`/`dismissed`.

**Impacto:** mes `incomplete` para siempre, barrido detenido (4.1), rechazos abiertos que crecen sin techo.

### 4.3 ALTA/MEDIA · `inFleet` está acotado por cuenta: un vínculo manual de Diésel no cuenta en BlueMax

**Dónde:** `copec-sync.ts:601-610` · `lib/combustibles/plate-resolver.ts:50-56,102-116` · `app/(app)/combustibles/actions-consumos.ts:420-458`.

`loadVehicleResolver({ sourceAccount })` carga los mappings de esa cuenta; `createFleetPlateCheck` construye el set con las patentes de la flota + mappings de la cuenta. `linkConsumptionPlateAction` crea el mapping para la cuenta del lote (`tct:diesel` o `tct:bluemax`).

**Escenario:** se vincula `XYZ-99` desde el lote Diésel. En BlueMax del mismo mes, `resolveVehicle` no la resuelve e `inFleet` da `false` ⇒ `excluded not_in_fleet`: no cuenta y no queda pendiente; el mes puede cerrarse `complete` con litros faltantes.

### 4.4 MEDIA · `rowsPending` subcuenta cuando hay detalle TCT y la UI dice «sin pendientes»

**Dónde:** `copec-sync.ts:617-625` (`trackedRows = eventRows.length > 0 ? persistedEvents : persistedProjection`; `rowsPending += trackedRows.pending`) · `copec-sync.ts:94` (`latestRun.rowsPending > 0` para listar pendientes) · `sources-status.ts:310`.

La proyección mensual resuelve el mes completo y el detalle por día: un vehículo reasignado a mitad de mes deja la fila agregada pendiente y las transacciones aceptadas. `rowsPending` queda 0, la cobertura `incomplete`, y la UI no lista qué patrón arreglar.

### 4.5 MEDIA · `legitimate_empty` puede pisar un mes `incomplete` que tenía datos

**Dónde:** `copec-coverage-store.ts:69-75` (preserva sólo `complete`/`legitimate_empty`) · `copec-sync.ts:199-223` (`recordDisabledProductAsEmpty`).

Si un mes quedó `incomplete` por un mapeo pendiente y la corrida siguiente recibe `no_records` para un producto deshabilitado, se marca `legitimate_empty` (terminal) aunque existan lotes con litros de ese mes. La cobertura certifica «vacío» un mes con consumo.

### 4.6 MEDIA · El cron Copec reporta `success` con un barrido parcial

**Dónde:** `app/api/cron/fuel-copec-sync/route.ts:59-64` · `copec-sync.ts:1155-1159`.

`syncCopecReports` devuelve normalmente al cortar por presupuesto (150 s) o cuando un producto quedó `unavailable` (401/403, 429, timeout, 5xx). La ruta responde siempre `fuelCronContractFor({ failed: 0, total: 1 })` y descarta `outcome.unavailable`; el scheduler ve `healthy` aunque la corrida interna sea `partial`.

### 4.7 MEDIA · El timeout del cliente Copec puede superar `maxDuration` y dejar la corrida `running`

**Dónde:** `lib/combustibles/copec-ws.ts:52,335-368` (`REQUEST_TIMEOUT_MS = 60_000` por intento, con reintento) · `app/api/cron/fuel-copec-sync/route.ts:18` (`maxDuration = 300`) · `copec-sync.ts:1081-1099`.

Cuatro descargas por período (TCT+TAE × diésel+BlueMax) pueden llegar a 480 s. Si la plataforma mata el proceso, el `catch` no corre, la corrida queda `running` y la cobertura a medio escribir; no hay barrido de corridas colgadas de proveedor (`STUCK_RUN_MS` en `sources-status.ts:87` sólo cambia el rótulo).

### 4.8 MEDIA · Importación TAE: un `legacySourceId` repetido aborta el lote completo

**Dónde:** `lib/combustibles/tae-import-commit.ts:59,193,273` · `db/schema/fuel-tae.ts:139-141` (único `(import_batch_id, legacy_source_id)`) · `client_submission_id` único global.

Una planilla manual con dos filas con el mismo `ID` (copiar/pegar) hace que el segundo insert choque con 23505 dentro de la transacción y se pierda el lote entero, incluidos los mapeos manuales recién guardados. El usuario sólo ve el mensaje genérico.

### 4.9 MEDIA · Revertir un lote deja `seal_chain_status` de las cargas siguientes calculado contra una carga borrada

Ya descrito en 2.6: la reevaluación de la cadena sólo existe al insertar (`submit.ts:328-333`), no al borrar/revertir.

### 4.10 BAJA · Doble conteo de litros en `affectedQuantity/affectedAmount`

**Dónde:** `fuel-provider-ledger.ts:367-370` · `copec-sync.ts:958-977`.

Una tarjeta TAE sin estanque genera una fila `row:copec:tae:*` (`pending`) y otra `external:<guía>` (`pending`) con los mismos litros/monto; `finishFuelProviderSyncRun` suma todas las pendientes de la corrida y duplica el impacto que muestra la UI.

### 4.11 BAJA · Evidencia huérfana y archivo sin fila

`copec-sync.ts:513` / `copec-evidence.ts:25-56`: el `.enc` se escribe antes de `recordCopecFile`; si la inserción o el período falla, el archivo queda sin fila y no hay GC para la evidencia Copec.

---

## 5. TAE, ciclo y conciliación

### 5.1 ALTA/MEDIA · La guarda OCR de revisión TAE está invertida para equipos sin medidor

**Dónde:** `lib/services/fuel-tae/review.ts:22-28` · `lib/services/fuel-tae/submit.ts:244`.

`requiresMeterConfirmation` exige `ocrSuggestedReading != null`, `ocrConfidence < MIN_ACCEPTED_OCR_CONFIDENCE` y `meterReadingSource !== "manual"`. El formulario escribe `meterReadingSource: reading != null ? "manual" : null`. Un equipo sin medidor guarda `null`: si el OCR sugiere una lectura con baja confianza, la carga no se puede validar y el único camino es `updateTaeMeterReadingAction`, que obliga a inventar una lectura. En el caso previsto (lectura digitada con OCR dudoso) la guarda no se activa nunca porque `source` es `manual`.

### 5.2 MEDIA · El bypass `offline` de la carga pasada

**Dónde:** `app/api/combustibles/cargas/route.ts:52-55` · `lib/validation/fuel-tae.ts:34-35` · `lib/combustibles/field-load-rules.ts:163-172` · `lib/services/fuel-tae/submit.ts:186-190`.

La ruta sólo exige `combustibles:register_past_load` cuando llega `pastLoad`; el esquema interno también acepta `offline` + `capturedAt`, y `resolveLoadedAt` los usa para fechar hasta 30 días atrás. Un usuario con `register_load` pero sin `register_past_load` puede enviar `offline:true` y una carga pasada sin motivo (`backdateReason` nulo), sin marca `late_entry`, sin auditoría de motivo y sin la validación de duplicado/lectura siguiente que sí tiene `backdated` (`submit.ts:165,203-208`).

### 5.3 MEDIA · «Finalizar en este dispositivo» no cuenta las cargas rechazadas

**Dónde:** `app/(public)/tae/resultado/[token]/tae-result-actions.tsx:35-66` · `lib/pwa/tae-offline-queue.ts:195-199` · `app/(public)/tae/tae-form.tsx:159`.

`countPendingTaeSubmissions()` cuenta sólo `status === "pending"`, no `failed` ni `syncing`. El botón se habilita con 0 pendientes y borra `accessToken` + `accessConfig`. Al volver a `/tae`, si no hay config, el early return muestra «Escanea el QR TAE» y no renderiza `<TaeOutbox>`: la carga rechazada y sus fotos quedan en IndexedDB sin UI.

### 5.4 MEDIA · Anular una carga no reevalúa la cadena de sellos de la siguiente

**Dónde:** `lib/services/fuel-tae/review.ts:38-90`; `submit.ts:328-333` sí llama a `reevaluateNextSubmissionSealChain` al insertar.

A(instala S-1) → B(retira S-1) → se anula A. La carga anterior de B ahora es la de antes de A (con S-9): B debió quedar `mismatch` con `expected='S-9'`, pero queda `ok` para siempre. Lo inverso también: anular la carga que rompía la cadena deja un `mismatch` que ya no existe. Afecta `getSupervisorSealSummary.chainBreaks`, el detalle/export de sellos y la ficha del equipo.

### 5.5 MEDIA · La corrección de lectura no reevalúa anomalías y saca los sellos del historial

**Dónde:** `app/(app)/combustibles/tae/actions.ts:158-198`.

No llama a `detectTaeAnomaliesInTx`: un caso que la corrección debía cerrar/abrir no se toca. Si la carga estaba `validated`, la degrada a `observed`; `getSealHistory` sólo lee `validated`, así que sus sellos desaparecen del historial hasta que alguien la vuelva a validar, mientras `fuel_seal_movements` conserva las filas.

### 5.6 MEDIA · El historial de sellos cuenta sólo `validated`; las otras dos pestañas cuentan todo lo no anulado

**Dónde:** `lib/combustibles/seal-history.ts:80` (`status='validated'`) frente a `control/queries/seals.ts:53` (`ne(status,'voided')`). En la misma pantalla y período, «Por supervisor» y «Detalle por equipo» incluyen `submitted`/`observed`, y «Historial de sellos» no.

### 5.7 MEDIA · `unmappedTct` suma litros completos de registros parciales

**Dónde:** `lib/combustibles/tae-copec-reconciliation.ts:107-145` (mapeados sólo si `tctFullyContained`) y `:178-181` (`getUnmappedTct` usa solapamiento y `sum(cantidadUnidad)` completo).

Un agregado TCT con `periodoDesde=2026-01-25` y `periodoHasta=2026-02-05` con filtro enero aporta **0 L** a la tabla mapeada y **todos** sus litros al aviso «sin equipo asociado». El aviso sobreestima y la fila parcial desaparece del canal sin explicación.

### 5.8 MEDIA-BAJA · El ciclo físico muestra «Registrado» sólo desde la tabla legada

**Dónde:** `lib/combustibles/fuel-cycle.ts:116,133`: `received` sale de `fuel_cycle_movements`, `delivered` suma ledger + TAE, pero `registered` sale sólo de `fuel_loads` (facturas). Una faena que opera con PWA/planilla muestra «Recibido 20.000 L · Registrado 0 L · Entregado 20.000 L» y `receivedVsRegistered.percent = null`.

### 5.9 BAJA · `medidoPor` de la planilla se ignora al proyectar

**Dónde:** `lib/combustibles/control/projection-sources.ts:235-236` toma `meterType` del catálogo y `meterReading` del horómetro sin mirar `fuel_operation_records.medidoPor` (`km`/`hora`). Si el catálogo dice odómetro y la planilla dice hora, la lectura se compara contra la serie equivocada y alimenta `kilometraje_regresivo`/`salto_medidor_implausible` en la unidad incorrecta.

---

## 6. UI, permisos y exportaciones

### 6.1 MEDIA · Cargas puede ocultar filas que sí llegaron si falla el conteo

**Dónde:** `app/(app)/combustibles/cargas/page.tsx:97` (`track(getFuelLogTotal(...), 0, "total")`) · `cargas-workbench.tsx:107,113` (elige `EmptyState` por `pagination.totalItems === 0`).

Con el conteo caído, `total=0` y `offset=0`; las filas se piden y pueden llegar, pero el workbench pinta «Aún no hay cargas» / «Ninguna carga coincide con estos filtros» y descarta la tabla. El banner de datos degradados queda arriba de un vacío que afirma lo contrario.

### 6.2 MEDIA · El chequeo de duplicados de `/api/combustibles/import` no aplica alcance y publica datos de otra faena

**Dónde:** `app/api/combustibles/import/route.ts:150-165` (`existingLoads` sin `worksiteScopeSql`) y `:238` (`Carga duplicada (factura "…", fecha)`).

Un usuario no global que sube un Excel con una factura de otra faena recibe la factura/fecha de la carga existente, o «El vehículo pertenece a otra faena»; confirma la existencia de datos fuera de su alcance. El resto del handler sí aplica alcance.

### 6.3 BAJA · «Eliminar» se muestra a quien no tiene `combustibles:delete`

**Dónde:** `app/(app)/combustibles/[id]/edit-fuel-load-form.tsx:98,335` usa `isEditable = draft && showCosts && canWrite` (`create`), pero `deleteFuelLoadAction` exige `combustibles:delete`. `jefa_chome` tiene `create` + `view_costs` y no `delete`: ve el botón y recibe «Sin permisos».

### 6.4 BAJA · El desplegable de fuentes de Tarjetas no está acotado por faena

**Dónde:** `app/(app)/combustibles/cargas/tarjetas/page.tsx:96` (`selectDistinct fuente` sin `worksiteScopeSql`). Publica nombres de fuentes/proveedores que sólo existen en faenas fuera de alcance, mientras el resto de la pantalla sí está acotado.

### 6.5 BAJA · Exportar cargas con `tae_export` ignora el filtro «Cómo llegó»

**Dónde:** `app/(app)/combustibles/cargas/page.tsx:122-131` (`taeFilters` no mapea `filters.origins`) y `bitacora/export-button.tsx:32`. La lista puede estar filtrada a «Factura» y el Excel descargar todas las cargas TAE del período.

### 6.6 BAJA · Un valor malformado en la cookie de período rompe toda la sección

**Dónde:** `lib/combustibles/period/server.ts:18` (`decodeURIComponent(raw)` sin `try/catch`). Una cookie editada o vieja (`%E0%A4%A`) lanza `URIError` en todas las páginas que resuelven el período hasta que expire (12 h) o se borre.

### 6.7 BAJA · `exportFuelLogSelectionAction` rompe con un `source` no validado

**Dónde:** `app/(app)/combustibles/bitacora/actions.ts:156-166` · `lib/combustibles/fuel-log.ts:642`. `FuelLogSource` es sólo un tipo; un `source` distinto de `tae_pwa|invoiced|operation_manual` deja `idsBySource[item.source]` en `undefined` y el `.push` lanza `TypeError` (la acción no tiene `try/catch`).

---

## 7. Lo que revisé y sí está correcto

Para no volver a auditarlo:

- **Alta TAE en terreno:** lock advisory por equipo, doble `SELECT`/`onConflictDoNothing` por `clientSubmissionId`, evidencia escrita antes de la transacción y compensada en el `catch`/duplicado; retroceso de medidor y tope hacia adelante revalidados bajo lock; cadena de sellos y reset de decisiones al intercalar una carga (`submit.ts:190-344`, `submit-rules.ts`).
- **Revisión TAE:** `UPDATE … WHERE status = expectedStatus` con `returning` para doble clic; movimientos de sello idempotentes por índice único; auditoría y `recordStatusChange` en la misma transacción (`review.ts:32-83`).
- **Cálculo de la serie:** fórmulas km/L y L/h, unidad del equipo, ancla y arrastre de litros, `meter_reset`, `zero_delta`, `first_load`, exclusión de anuladas/duplicadas/relleno; σ muestral y mínimo de muestras; duplicados entre canales (`calc/performance-series.ts`, `calc/statistics.ts`, `calc/duplicates.ts`).
- **Copec:** hash de proyección estable, identidad por guía+patente+ocurrencia, clasificación de errores (SOAP Fault, 401/403, 429, 5xx), redirecciones seguras, redacción de credenciales, minimización de PII en `raw_row`, cobertura que distingue `no_records` de `no_results`, cursor con versión optimista y locks compartidos entre cron y botón.
- **Importadores de control:** vista previa y commit comparten `prepare()`, lock por hash + reverificación bajo lock, upsert por llave natural, rechazos persistidos, reversión transaccional acotada por faena y plantillas derivadas de los mismos alias.
- **Conciliación por mandante:** un solo predicado contable (`accountableProviderTransactionsWhere`) que evita el doble conteo agregado TCT/detalle, tolerancia por mandante y `percent: null` con base cero.
- **Rutas, período y permisos:** las páginas nuevas usan `resolveFuelPeriodForPage` (URL → legacy → cookie → rol), los `permission` del menú coinciden con los de página/action, los 30+ puentes legacy son `permanentRedirect` con query preservada y las consultas de listas intersectan `worksiteScopeSql`.
- **PII/costos:** `view_personal` para nombres/fotos y `view_costs` para montos, redactados en servidor; evidencia TAE con `tae_view` + `view_personal` y 404 fuera de alcance.

---

## 8. Límites de esta auditoría

- Es una revisión **estática**. No se ejecutaron `test:fast`, `test:pglite`, E2E ni la aplicación; los hallazgos de concurrencia (2.1, 2.2, 2.3, 2.5) y los que dependen de datos reales de Copec (4.1–4.5) conviene confirmarlos con una prueba dirigida o en el ambiente de QA.
- Las decisiones documentadas (`S-5` hora de la cola offline, `S-7` duplicados entre canales, `S-13` valores de relleno) se señalan sólo cuando su implementación contradice la intención declarada; no se proponen funciones nuevas.
- No se auditó el contenido de los archivos reales de Copec/planillas ni datos de producción; los escenarios de facturación y conciliación usan ejemplos construidos sobre el código.
- No se revisó visualmente la interfaz en navegador; los defectos de presentación quedan fuera de este informe.

---

## 9. Estado de la corrección (2026-11-05, tarde)

Se corrigieron en código los 45 hallazgos de este informe. El mes con un equipo
reasignado (§ 9.3) se resolvió repartiendo por día, como decidió el usuario. Queda
sólo la persistencia de las notas de la corrida (§ 9.4). La rama es `fix/combustibles-auditoria-2026-11-05`. Está
**sin commit** y salió de `main` en `f829807bf`. La trae dos migraciones nuevas:

- `0372_fuentes_integridad_claves`: índices únicos E1–E7. Cada uno aborta con
  diagnóstico si encuentra duplicados; no deduplica de forma automática.
- `0373_fuel_sellos_fk_set_null`: la FK de `fuel_seal_movements.submission_id` pasa a
  `ON DELETE SET NULL`.

### 9.1 Mapa hallazgo → corrección → prueba

| Hallazgos | Corrección principal | Prueba |
|---|---|---|
| 2.1, 3.1, 3.2, 3.4 | Candado por equipo en `recomputeVehicleSeries`; decisiones que cambian de base se reabren (`projectWithStaleDecisions`, `gte`); cambio de medidor/unidad/capacidad recalcula; orden por lectura en el mismo instante | `fuel-serie-concurrencia-pglite` |
| 2.2, 2.3, 2.5, 2.9, 4.1 (E6), E7 | Claves naturales e índices de la 0372 | `db/__tests__/fuel-integridad-constraints` |
| 2.4, 2.6, 2.7, 4.9, 5.4 | Movimientos de sello archivados (no borrados), reversa que cierra pedidos y casos, reevaluación de la cadena al anular/revertir | `fuel-tae-ciclo-sellos-pglite` (B3, B4), `tae/importar/actions.test` |
| 2.8, 5.6, 5.8 | Movimiento de estanque idempotente y sin fecha futura; tres pestañas de sellos con el mismo criterio; «Facturado» nulo sin facturas | `fuel-tae-ciclo-sellos-pglite` (B7, B8/B9) |
| 2.10 | Lock del importador de consumos por archivo, no por modo | — (lectura) |
| 3.3, 3.5–3.9 | Mes chileno sobre texto UTC; L/h como razón de sumas; filtro `equipo` exacto en todas las consultas; σ = 0 sin rango; unidad declarada por fila; «rinde peor» con filtro y muestra mínima | `fuel-consultas-periodo-pglite` (D1–D8) |
| 4.1, 4.2 | Mes con observaciones `closed_with_issues`; la revisión de corrección converge (`superseded` / `dismissed`) | `fuel-copec-ingesta-pglite` (C1, C2), `copec-sync.test` |
| 4.3 | `inFleet` por proveedor, asignación por cuenta | `fuel-copec-ingesta-pglite` (C3) |
| 4.4–4.7, 4.10, 4.11 | Pendientes de las dos granularidades; cobertura que no se certifica vacía con datos; contrato del cron con `partial`; presupuesto de tiempo por consulta y cierre de corridas colgadas; impacto sin doble conteo; evidencia huérfana se borra | `copec-coverage-store.test`, `copec-sync.test`, `affected-run-impact.test` |
| 4.8 | ID histórico repetido se rechaza por fila | `fuel-tae-ciclo-sellos-pglite` (B5) |
| 5.1, 5.3 | Guarda OCR sólo para lecturas no confirmadas; la cola cuenta pendientes, en vuelo y rechazadas | `fuel-tae-ciclo-sellos-pglite` (B1, B2), `tae-result-actions.test` |
| 5.2 | `offline`/`capturedAt` en la vía interna exige `register_past_load` y motivo | `api/combustibles/cargas/route.test` |
| 5.5, 5.7, 5.9 | Corrección de lectura reevalúa anomalías y conserva sellos; aviso TCT con el criterio de contención; `medidoPor` de la planilla | `fuel-control-projection.test` (5.9) |
| 6.1–6.7 | Tabla por filas y no por el total; duplicados de importación acotados al alcance; «Eliminar» con `combustibles:delete`; fuentes de Tarjetas por faena; export TAE con «Cómo llegó»; cookie de período tolerante; `source` validado | `cargas-workbench.test`, `api/combustibles/import/route.test`, `fuel-consultas-periodo-pglite` (D5) |

### 9.2 Defectos encontrados al verificar las correcciones

Una revisión independiente de los arreglos de Copec, más la revisión propia, encontró
siete problemas, y el recorrido en navegador un octavo; los ocho están corregidos:

1. **Salida de Copec sin interfaz.** El componente para cerrar un mes con observaciones
   y resolver correcciones (`fuentes/copec-period-review.tsx`) no estaba montado, así
   que nadie podía usar la salida de 4.1 y 4.2. Ahora está montado en Fuentes de datos
   para quien tiene `combustibles:sync_integrations`.
2. **«Aprobar» sobre una fila inválida.** Con esa acción, la fila quedaba `superseded`
   / `correction_approved` sin nada que la reemplazara. Ahora sólo se aprueba una
   corrección (`isCorrectionReviewCode`, tanto en el servicio como en la UI); el resto
   se marca como revisada.
3. **Decisiones de corrección fuera de la ventana.** La consulta comparaba
   `occurredAt <= "AAAA-MM-31"` como texto, así que dejaba fuera el último día y lo del
   31 después de las 21:00 de Chile. Esa corrección se volvía a marcar en cada corrida
   (4.2). Se corrigió con `copecDecisionWindow`.
4. **503 casi todos los días.** El mes en curso sin cargas todavía («no hay registros»
   con acceso confirmado) se contaba como fuente caída, y con el contrato nuevo del cron
   eso era un 503. Ahora es una nota; `no_results` (acceso sin confirmar) sigue siendo
   degradado.
5. **Corte por presupuesto informado como crítico.** Un mes cerrado que no alcanzó a
   consultarse terminaba en «Copec no entregó ningún archivo… revisa las credenciales».
   Ahora es `budgetExhausted` (parcial) y la corrida siguiente lo retoma.
6. **Contadores a cero (4.5).** Una observación sin datos (`unknown`, o `failed` sin
   archivo) dejaba los contadores en 0, y eso permitía certificar vacío un mes con
   consumo. Ahora conserva los contadores.
7. **Impacto TCT duplicado y cargas idénticas fusionadas (4.10).** El agregado mensual
   se sumaba encima de sus transacciones, y dos cargas idénticas de verdad se contaban
   como una. Se corrigió con `affectedRunImpact`.

8. **Datos crudos en la sección de revisión.** El recorrido en navegador mostró la
   cuenta como clave (`tct:diesel`), la fecha en ISO (`2026-10-15T12:00:00.000Z`) y
   un mes («enero de 2020») que no correspondía a las observaciones listadas. Ahora se
   rotulan con «Tarjetas de equipo · Diésel» y `formatDateTime`, y el mes aparece sólo
   en «Meses por cerrar».

Además, 5.9 sólo usaba `medidoPor` cuando el equipo no tenía medidor. Ahora, si la
planilla declara otro medidor que el del equipo, la lectura no alimenta la serie; el
registro original la conserva.

### 9.3 Mes Copec con un equipo reasignado a mitad de mes: repartir por día (resuelto)

**El problema.**

- El agregado mensual TCT de una patente que cruza una reasignación no se podía
  atribuir a una sola faena, así que el mes no quedaba nunca terminal.
- El barrido histórico se detenía en ese mes.

**Decisión del usuario (2026-11-05): repartir el total por día.**

- `lib/combustibles/copec-day-split.ts` (`splitAggregateByDay`) atribuye cada
  transacción del detalle a la faena y al vehículo que la patente tenía **ese día**.
- `copec-sync.ts` crea una fila de consumo por faena en el lote de esa faena, con
  `rawRow.repartoPorDia` (días, transacciones y total del mes). El agregado del ledger
  queda `excluded` con el código `split_by_day`.
- Los litros contables siguen saliendo de las transacciones, que ya se resolvían por
  día, así que no hay doble conteo.
- Fuentes de datos ya no rotula esas filas como «fuera de la flota».

**Cuándo no se reparte.** En estos casos la fila sigue pendiente y la corrida deja una
nota con el motivo:

- no hay detalle por transacción (prorratear por días de calendario inventaría el
  consumo de cada faena);
- algún día de carga no tiene faena asignada;
- el detalle no suma el total del mes. La tolerancia es de 0,5 L o 0,1 % en litros, y
  de $1 por transacción o 0,1 % en monto;
- el archivo trae correcciones o filas inválidas.

**Pruebas.**

- `copec-day-split.test.ts`: 6 casos.
- `copec-sync.test.ts`: «§ 9.3: reparte por día…». Comprueba los lotes W1 40 L y
  W2 60 L, que no quedan patentes pendientes y que el agregado queda `split_by_day`.

**Efecto.** Los meses ya atascados por esto se reparten solos en la próxima
sincronización de ese mes, porque siguen sin cobertura terminal.

### 9.4 Pendiente menor

Las notas de la corrida, como «faena con importación previa», no se persisten en
`fuel_provider_sync_runs`. Una corrida que saltó una faena por importación previa queda
`success` sin texto. No se cambió.

### 9.5 Verificación ejecutada

**PASS**

- `npm run typecheck`: 0 errores. Al empezar había uno de importación de tipo en
  `tae/actions.ts`, ya corregido.
- `eslint` sobre los archivos cambiados: 0 errores.
- `db:verify-migrations`: 374 entradas.
- `drizzle-kit generate`: «No schema changes».
- `check:secrets`: verde.
- `test:pglite` completo: 348 archivos y 4.422 pruebas en verde (1 omitida).
- Después de las últimas correcciones se volvieron a correr las suites dirigidas de
  Copec, cobertura, proyección e impacto: 253 rápidas y 49 PGlite, en verde.
- `test:fast` completo: 18.467 en verde y 4 fallidas, todas en
  `lib/__tests__/oc-pdf-route-engine.test.ts` con `PDF_ORIGIN_NOT_CONFIGURED`. La
  ruta exige un origen de impresión que este shell no define, y la rama no toca PDF ni
  compras: es una falla del ambiente, ajena a combustibles.
- Las migraciones 0372 y 0373 ya estaban aplicadas en `bodega_dev`, clon de
  producción del 2026-11-02, sin que saltara ninguna guarda de duplicados. La FK quedó
  `SET NULL`.

**PASS · navegador**

- E2E de combustibles en Chromium, en un worktree desechable: 46 pasaron, 1 omitida y
  0 fallaron. Specs: `combustibles`, `combustibles-control`, `combustibles-rediseno`,
  `control-operacional-combustible` y `tae-*`.
- Recorrido de «Revisión de Copec» en Fuentes de datos (dev server sobre la base E2E,
  con dos observaciones `QA_`):
  - la sección aparece;
  - una corrección ofrece «Aprobar corrección» y «Descartar»;
  - una tarjeta sin estanque ofrece sólo «Marcar revisada»;
  - el diálogo exige motivo y, al confirmar, la fila queda `dismissed` con el operador
    en la base, mientras la corrección sigue `open`;
  - en 390 px no hay desborde horizontal;
  - sin errores de consola ni respuestas 5xx.
  Las filas `QA_` se borraron al terminar.

**AUTOMATION WARNING**

- La primera corrida E2E murió por OOM en el chequeo de tipos de `next build`, con el
  heap de 5.120 MiB. Con 6.144 MiB pasó. Es el mismo techo registrado el 2026-10-20 y
  el CI compila con 5.120, así que **el job de build del CI podría caer** con esta
  rama. Hay que confirmarlo en el CI antes de mergear.
- El servidor de :3001 no sirve este checkout (es otro proceso, `/app`), así que no se
  usó para verificar.

**COVERAGE GAP**

- No se corrió la suite E2E completa ni los navegadores móviles reales.
- No hay prueba dedicada para 2.10 (lock por archivo), 4.6 (contrato del cron), 4.7
  (presupuesto por consulta y cierre de corridas colgadas), 4.11 (evidencia
  huérfana), 5.5, 5.7, 6.3, 6.4, 6.5 ni 6.7. Esos se verificaron por lectura.
- No se probó contra Copec real.
- No se aplicaron las migraciones en producción. Antes del deploy conviene correr allí
  las guardas de duplicados de la 0372, porque el clon tiene tres días.
