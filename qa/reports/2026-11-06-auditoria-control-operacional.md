# Auditoría del módulo Control operacional — 2026-11-06

**Alcance:** hub `/control-operacional` (panel, tiles de atención, tabla de activos, exportación), Flota (`/flota`, ficha, documentos, exportación), los cruces con Combustibles, TAE, Mantención/OT, Inspecciones y CAPA, y el Tablero (`/dashboard?vista=flota`).

**Método:** revisión estática de solo lectura del código actual de `main` (2026-11-06), re-verificación de los 42 hallazgos de `AUDITORIA_CONTROL_OPERACIONAL_2026-08-20.md` y trazado de los flujos escritura → cálculo → lectura derivada. No se ejecutó la aplicación, ni las suites, ni se consultaron datos de producción. Los hallazgos que dependen de datos reales se marcan como **sospecha fundada**.

---

## 1. Resumen ejecutivo

El módulo ya cerró la mayor parte de la auditoría de agosto: **35 de 42 hallazgos están resueltos**, 5 quedaron parciales, 1 persiste (CO-020) y 1 quedó obsoleto por el reemplazo del módulo de mantenciones. La seguridad por faena, la máquina de estados de anomalías, la reversa TAE, la idempotencia de sellos y la auditoría transaccional de las cargas están cerradas.

Lo que estaba roto al cierre del diagnóstico era de **cruce de información**, no de autorización (la sección 10 registra las correcciones implementadas):

1. **El costo de combustible del panel operacional sale de una serie distinta a la de Flota y el Tablero** (`fuel_loads`), que el código documenta como vacía en producción. En la base de desarrollo tiene 210 filas frente a 5.671 del libro del proveedor: la cifra queda subestimada y no es comparable; si se cumple el comentario de producción, el panel muestra $0 por equipo.
2. **«CAPA vencidas» y «Documentos vencidos» tienen definiciones distintas en cada pantalla**, así que la misma etiqueta da cifras distintas en el panel, el Tablero y Flota.
3. **El detector de consumo en equipos detenidos sólo mira cargas TAE**, no tarjeta/TCT ni la serie operacional: el cruce «equipo parado que sigue cargando» está incompleto.
4. **El hub calcula y descarta datos que ya tiene en la mano** (casos críticos, última carga, costo/km) y no cruza hallazgo ↔ OT ↔ CAPA aunque el vínculo existe en la base.
5. **Una fecha de trabajo inválida (`2026-02-31`) se guarda y tumba el panel de mantención** al castearla a `::date` (CO-020 sigue vigente en el módulo nuevo).

---

## 2. Estado de los hallazgos de la auditoría 2026-08-20

| IDs | Estado | Nota |
|---|---|---|
| CO-001 a CO-019 | **RESUELTOS** | Alcance por faena en anomalías, reversa TAE multi-faena, cuenta corriente global, `view_costs` en SQL, CAPA idempotente, `flota:manage_documents`, guard de módulos, vehículos/vasijas acotados, estados contables canónicos, sellos idempotentes y máquina de estados de anomalías. |
| CO-020 | **PERSISTENTE** | Ver CO-047. |
| CO-021 a CO-024 | **RESUELTOS** | Documentos versionados, faena derivada del vehículo, lectura cronológica y filtros canónicos. |
| CO-025 | **PARCIAL** | Ver CO-049. |
| CO-026, CO-028, CO-029 | **RESUELTOS** | Locks de importación, auditoría de bajas y cron versionado. |
| CO-027 | **PARCIAL** | Ver CO-050. |
| CO-030, CO-031, CO-033, CO-035 a CO-038, CO-040 a CO-042 | **RESUELTOS** | Paginación/export, deep link de equipo, enlaces con capacidad, filtros de mantención, metadatos validados, `settle` observable, ventanas rotuladas, allowlist de evidencia, día chileno y agregación de OT. |
| CO-032 | **PARCIAL** | Ver CO-048. |
| CO-034 | **PARCIAL (residual accesible)** | Persisten filtros con solo `aria-label`, sin rótulo visible persistente (`ot-list-filters.tsx:65-79`, `cargas-filters.tsx:76,102,119`). No es un fallo funcional. |
| CO-039 | **PARCIAL** | Ver CO-062. |
| CO-008 | **OBSOLETO** | `lib/services/maintenance.ts` desapareció con el módulo nuevo; no hay imputación a centros de costo. |

---

## 3. Hallazgos nuevos — P1

### CO-043 — El costo de combustible del panel sale de una serie distinta y no comparable

**Evidencia:**
- `lib/combustibles/control/queries/asset-fuel-summary.ts:110-124`: `billedAmount` se sumaba desde `fuelLoads` (serie facturada).
- `lib/services/fleet.ts:128-130`: el propio código documenta que **`fuel_loads` tiene 0 filas en producción** y que la serie canónica es `fuel_provider_transactions`.
- `lib/services/fleet.ts:148-158` y `:418-425`: Flota y su exportación suman desde `fuelProviderTransactions`.
- Medición de solo lectura en la base de desarrollo (2026-11-06): `fuel_loads` **210** filas, `fuel_provider_transactions` **5.671**, `fuel_equipment_loads` **3.298**. En dev la tabla no está vacía, pero la serie del panel sigue siendo otra y no comparable con Flota/Tablero.

**Impacto:** la columna «Costo combustible facturado» del panel y su Excel no cuadran con Flota/Tablero. En dev la cifra queda subestimada; si se cumple el comentario de producción, es **$0 por equipo**. No es un `null` visible: es un cero que se lee como «no gastó».

**Clasificación:** BUG confirmado por código y por la medición en dev (series distintas); el valor exacto en producción requiere un `count(*)` allí.

**Corrección mínima:** unificar la fuente de monto en `fuelProviderTransactions` (el mismo predicado `accountableProviderTransactionsWhere`) o, si se quiere mantener la serie facturada, no publicar un cero cuando la serie no tiene filas: devolver `null` y pintar «Sin datos».

### CO-044 — «CAPA vencidas» tiene dos definiciones

**Evidencia:**
- Panel: `lib/services/operational-control.ts` (bloque `capaAgg`) usa `preventionCapaActions.status NOT IN ('closed', 'cancelled')`, es decir **incluye `verified`**, y sólo CAPA ligada a hallazgos de inspección.
- Tablero y filtro «Vencidas» de CAPA: `lib/services/prevention-capa.ts:59-61` y `:1041` usan `NOT IN ('verified', 'closed', 'cancelled')`, sobre **todos** los orígenes de CAPA.

**Impacto:** una CAPA ya verificada pero no cerrada se cuenta como vencida en el panel y no en el Tablero. Además, el panel sólo ve un subconjunto (inspecciones) mientras el Tablero ve los 17 orígenes posibles. La misma etiqueta, dos números.

**Corrección mínima:** un único predicado exportado de `prevention-capa` para «vencida», usado por panel y Tablero; decidir explícitamente si `verified` cuenta o no.

### CO-045 — «Documentos vencidos / por vencer» tiene tres universos

**Evidencia:**
- Panel: `lib/operational-control/attention.ts:42` documenta «**Equipos** (no documentos) con algún vencimiento anterior a hoy»; el tile se rotula «Documentos vencidos» (`attention-tiles.ts:90`) y cuenta equipos.
- Tablero: `getExpiringFleetDocuments` (`lib/services/dashboard-domains-data.ts:129-148`) cuenta **filas de `fleet_vehicle_documents`**, sólo `status = current`, sólo PDFs, con ventana fija de 30 días (`fleet-section.tsx:87`). **No mira las columnas declaradas** del equipo.
- Flota: `app/(app)/flota/page.tsx:88-93` cuenta **equipos** con `resolveNextExpiryDate`, que sí incluye `soapExpiresAt`, `technicalReviewExpiresAt`, `circulationPermitExpiresAt` e `insuranceExpiresAt`, y usa la ventana configurable `warningDays`.

**Impacto:** un vehículo con revisión técnica vencida en la ficha y sin PDF subido aparece en el panel y en Flota, y no en el Tablero. El KPI del Tablero y el tile del panel no son comparables ni por unidad ni por fuente. El enlace del Tablero (`href="/flota"`) tampoco abre el subconjunto que cuenta.

**Corrección mínima:** una sola función de conteo por equipo (la de Flota/panel) y que el Tablero la consuma; si se quiere el conteo por documento, rotularlo como tal y no mezclarlo con «equipos».

### CO-046 — El detector de consumo en equipos detenidos sólo evalúa TAE

**Evidencia:** `lib/combustibles/anomaly-detector.ts:482-488` consulta únicamente `fuelTaeSubmissions`. No consulta `fuelProviderTransactions` (tarjeta/TCT) ni `fuelEquipmentLoads` (serie operacional).

**Impacto:** un equipo marcado `mantencion` o `fuera_servicio` que recibe cargas con tarjeta o desde la planilla operacional **no genera caso**. El hub tiene en la misma iteración el estado del equipo, sus litros del período y sus casos abiertos, pero no cruza «detenido + cargó». Es la señal de fraude/error de digitación más directa del módulo y hoy queda fuera.

**Corrección mínima:** ampliar el detector a las tres fuentes con el mismo criterio de estado vigente, o —más barato— calcular en el hub «litros cargados a equipos detenidos en el período» y enlazarlo a la bandeja.

### CO-047 — CO-020 persiste: una fecha de trabajo inválida tumba el panel de mantención

**Evidencia:**
- `db/schema/mantencion-records.ts:41`: `workDate: text("work_date").notNull()` (texto, no `date`).
- `lib/mantencion/contracts.ts:17`: la validación es sólo `regex(/^\d{4}-\d{2}-\d{2}$/)`.
- `lib/services/mantencion/records-create-validate.ts:33`: el único chequeo adicional es `input.workDate > todayInChile()`, una comparación lexicográfica que `2026-02-31` supera.
- `lib/services/mantencion/panel.ts:98`: el panel castea `mantRecords.workDate` a `::date`.

**Reproducción:** `POST /api/mantencion/sync/registros` con `workDate: "2026-02-31"` y una credencial de dispositivo válida. La fila se guarda; al abrir `/mantencion/panel`, Postgres responde `date/time field value out of range (22008)` y la pantalla cae. Cualquier consulta que use `::date` sobre esa columna falla igual.

**Corrección mínima:** usar `civilDate()` en el contrato y validar la fecha real; agregar `check (work_date ~ '^\d{4}-\d{2}-\d{2}$')` o migrar a `date`; sanear filas existentes.

### CO-048 — Dos pantallas de Combustibles quedaron sin buscador

**Evidencia:**
- `components/layout/top-bar.tsx:45` incluye `/combustibles` en `ROUTES_WITH_OWN_SEARCH`, así que la búsqueda de la shell se oculta en **todas** las subrutas del módulo.
- `app/(app)/combustibles/vehiculos/vehicle-table.tsx:184,200` y `app/(app)/combustibles/proveedores-combustible/supplier-table.tsx:24` usan `DataTable` sin `search` ni input propio. `DataTable` sólo filtra con `searchQuery` de la shell (`components/ui/data-table.tsx:90,195`).
- El comentario de `top-bar.tsx:23-25` reconoce el problema («sus tablas basadas en DataTable (vehículos, proveedores) quedaban sin buscador») pero la ruta sigue en la lista.

**Impacto:** con ~200 equipos o decenas de proveedores, no hay forma de filtrar por texto; sólo scroll o paginación. Es una regresión funcional del rediseño.

**Corrección mínima:** sacar `/combustibles` de la lista global y agregar las subrutas que sí construyen su propio buscador, o dar a esas dos tablas un `search` propio.

---

## 4. Hallazgos nuevos — P2

### CO-049 — Auditoría fuera de la transacción en dos rutas sensibles (CO-025 parcial)

- **Reversa de lote TCT:** `app/(app)/combustibles/actions-consumos.ts:383-386` cierra la transacción que borra los registros y marca el lote `revertido`; el `recordAudit` de `:388-396` corre después, con el cliente global. Si la auditoría falla, el lote queda revertido sin bitácora.
- **Vínculo manual patente → vehículo:** `actions-consumos.ts:514-521`, mismo patrón; además escribe `fuel_provider_mappings` y promueve transacciones del proveedor, así que es la ruta con más consecuencias de todo el módulo.

**Corrección:** pasar `tx` a `recordAudit` dentro de la misma transacción, como ya se hace en el alta de lote (`:340-347`).

### CO-050 — La importación TCT global declara «Filas rechazadas: 0»

**Evidencia:** `app/(app)/combustibles/actions-consumos.ts:307-309` fija `filasInvalidas: 0` cuando `meta.worksiteId === "all"`. Las patentes sin vehículo se devuelven en memoria (`:217-240`) y se muestran en el asistente, pero no se persisten. La ficha del lote publica ese cero (`fuentes/archivos/[tipo]/[id]/tarjeta-detail.tsx:67`).

**Impacto:** un lote con 3 patentes omitidas queda registrado como sin filas inválidas. Al día siguiente no hay forma de saber qué se omitió ni de reprocesarlo; la única copia es el Excel que alcanzó a descargar el operador. Es CO-027 parcial.

**Corrección:** persistir los rechazos con fila de origen y causa (el ledger `fuel_control_import_rejections` ya existe para operaciones), o al menos calcular `filasInvalidas` con las omisiones reales.

### CO-051 — El Excel del panel exporta una clave interna como «Contrato», una «Clase» constante y redondeos distintos a la pantalla

**Evidencia:**
- `lib/operational-control/export-columns.ts:26`: `{ header: "Contrato", key: "key" }`; `:99` exporta `asset.key`, que es `vehicle:<uuid>` o `service_equipment:<uuid>`.
- `app/(app)/control-operacional/actions.ts:26` filtra `kind === "vehicle"`, así que la columna «Clase» (`export-columns.ts:27`) vale siempre «Vehículo / equipo móvil» y los instrumentos de servicio que la página anuncia no están en el Excel.
- `actions.ts:42-43` escribe `availabilityPercent` y `stateCoveragePercent` sin redondear ni `numFmt`; la pantalla los pinta con 1 decimal (`performance-stats.ts:58,67`).
- `actions.ts:63` redondea «Horas en taller» a 1 decimal; la pantalla a 0 (`performance-stats.ts:80`).

**Impacto:** el reporte que se comparte no coincide con la pantalla que lo origina y contiene un UUID bajo una etiqueta de otro dominio. La columna «Clase» no aporta información.

### CO-052 — La columna de acciones se puede ocultar y aparece como `_action`

`app/(app)/control-operacional/operational-assets-table.tsx:78` declara `{ key: "_action", label: "" }` con `enableColumnToggle`. `DataTable` rotula cada casilla con `column.label || column.key`, así que el menú «Columnas» muestra literalmente `_action`. Si el usuario la desactiva, desaparecen «Ver» y «Combustible» —las dos únicas salidas de la fila— y la preferencia persiste en la URL. Debe excluirse del toggle o tener un rótulo humano.

### CO-053 — «Rendimiento promedio» mezcla km/L y L/h y ordena por el número crudo

`operational-assets-table.tsx:52` declara la columna `sortable` sin `sortValue`; `DataTable` ordena por `row[sortKey]` (`data-table.tsx:228-238`). Al ordenar ascendente, un equipo de 40 L/h queda antes que uno de 12 km/L: son magnitudes distintas. Además los `null` van primero en ascendente (`av == null ? -1`), así que los equipos sin rendimiento encabezan el «mejor rendimiento». La columna debe ordenar dentro de cada unidad o separarse en dos.

### CO-054 — El tile de documentos enlaza a «vencidos» aunque su cifra sea 0

`attention-tiles.ts:94-101` pinta «Ninguno · 5 equipos por vencer en 30 días» pero el `href` es siempre `/flota?vencimiento=vencidos` (`:30`). El clic muestra «No hay vehículos con vencimiento», justo cuando lo accionable son los próximos. Existe `?vencimiento=proximos`; el tile debe elegir el destino según el caso (o llevar a ambos).

### CO-055 — Dos cifras del hub no se derivan de su dato

- **Callout de discrepancias:** `page.tsx:196-201` cuenta `stateMismatchCount` y enlaza a `/flota` sin filtro; no hay `?estado=`/`?q=` que exprese esa condición. El operador ve «7 equipos» y abre los 240 del alcance.
- **Banner de degradación:** `page.tsx:168` pasa `total={4}` fijo, pero el hub degrada ~10 consultas (vehículos, instrumentos, inspecciones, hallazgos, CAPA, disponibilidad, documentos, ajustes, GPS, OT). Con 2 fallas dice «2 de 4 fuentes» cuando se perdió el 20 % del panel.

### CO-056 — El Tablero carga `getFleetOverview` completo y `kmDriven`/`hoursRun` no tienen consumidor

- `app/(app)/dashboard/sections/fleet-section.tsx:88` llama `getFleetOverview(session, worksiteId)` y `:104` usa únicamente `vehicle.isActive`. La función dispara vehículos con cuatro relaciones, agregado de `fuel_provider_transactions`, todas las lecturas de medidor de 12 meses, casos de anomalía abiertos, la regla de salto y los documentos vigentes (`lib/services/fleet.ts:142-242`). Es la consulta más cara de la sección y se descarta casi entera.
- `lib/services/fleet.ts:295-300,346-348` calcula `kmDriven`, `hoursRun` y `meterSeriesIncomplete`; un grep en `app/` no encuentra ningún consumidor. El comentario de `:291-294` dice que «se informa», pero no hay columna, ficha ni export que los pinte.
- Consecuencia de negocio: el costo por km/hora es calculable hoy con `totalFuelAmount ÷ kmDriven` (o `÷ hoursRun`) y no se calcula en ninguna pantalla, aunque `fleet.ts:86-89` llame a la ventana «costo por km/hora».

### CO-057 — «Última lectura» significa dos cosas distintas

- **Ficha del equipo:** `lib/services/fleet.ts:508-519` lee `fuelOperationRecords` (log operacional manual, sin ventana temporal) y `:568` muestra `recentOperations[0]`.
- **Lista y exportación:** `lib/services/fleet.ts:166-182` lee `fuelMeterReadings` de Copec con ventana de 12 meses; `:279-290` alimenta la columna «Km/Hr» y `fleet-last-reading.ts`.

**Impacto:** la ficha puede mostrar una lectura de 2023 y la lista del mismo día una de 2026. Misma etiqueta, dos cifras. Además la ficha ignora la ventana de 12 meses y trae 20 filas para usar sólo la primera (`:508-519,568`).

### CO-058 — «Al día» incluye equipos sin ninguna fecha

`lib/fleet-overview-filters.ts:51`: con `nextExpiryDate === null` la fila pasa el filtro `al-dia`. La tabla, en la misma fila, pinta «Sin fecha registrada» (`fleet-table.tsx:26-28`) y los banners de vencidos/próximos no la cuentan porque exigen fecha. El deep link que usa el panel para «al día» devuelve como al día lo que en realidad está sin documentar.

### CO-059 — El export de Flota no respeta la pantalla

`app/(app)/flota/actions.ts:259` exporta `row.operationalStatus` crudo (`mantencion`, `fuera_servicio`) mientras la tabla pinta la etiqueta humana (`fleet-table.tsx:108`). `actions.ts:261` exporta sólo la fecha de «Próximo vencimiento», sin el tipo documental que la tabla sí muestra (`fleet-table.tsx:29-35`). El archivo que se comparte no se lee igual que la pantalla y contradice el estado filtrado (un equipo inactivo aparece como `inactivo` aunque el filtro aplicado fuera `mantencion`).

### CO-060 — «Próximo vencimiento» puede apuntar a un documento que la ficha no muestra

`resolveExpiryCandidates` (`lib/validation/fleet-documents.ts:59-71`) incluye **cualquier** documento vigente, incluso tipos sin columna canónica («Padrón», «Otro», «Certificado de emisiones», `:104-137`). La tarjeta «Vencimientos» de la ficha sólo lista los cuatro campos canónicos (`app/(app)/flota/[id]/page.tsx:51`). Resultado: la cabecera dice «Próximo vencimiento 05-03-2026» y las cuatro filas de al lado dicen «Vigente» o «Sin fecha», sin explicar de dónde sale la fecha.

### CO-061 — Una falla de la consulta de combustible tumba el panel completo

El hub degrada por sección casi todas sus consultas con `settleAttention`, pero `getAssetFuelSummary` se ejecuta fuera de ese patrón (`lib/services/operational-control.ts`, después del `Promise.all`). Si esa consulta falla, `getOperationalControlHub` rechaza y la página cae al `error.tsx`; el usuario pierde también flota, OT e inspecciones, que sí habían cargado. Debe entrar en el mismo patrón y dejar los campos de combustible en `null`.

### CO-062 — El motor batch sigue sin cursor y convierte fallos por caso en «skipped»

- `lib/combustibles/anomaly-detector.ts:33,220,372,526,662,688,748`: el tope es fijo (`BATCH_SCAN_ROW_LIMIT`/`batchRowLimit`). Con más filas elegibles que el tope, las mismas quedan fuera en cada corrida; no hay checkpoint ni señal de truncamiento.
- `anomaly-detector.ts:251,300,344,437,504,540,565,588,675,701,720,795`: el patrón `catch { skipped++ }` hace que un fallo sistemático de `createAnomalyCase` (FK rota, timeout) se reporte como regla `completed` con `created: 0` y el cron responda éxito.
- La parte principal de CO-039 sí quedó cerrada: `status: failed` distinto de «no encontró nada», contrato `partial`/503 y lock durable.

---

## 5. Información que debería cruzarse y no se cruza

Estos puntos no son bugs de una pantalla: son datos que ya existen y nadie consume juntos.

### 5.1 Hallazgos ↔ OT ↔ CAPA

El vínculo está construido y se escribe (`db/schema/mantencion-work-orders.ts:92,105-106`; `lib/services/prevention-inspections/runs.ts:961-970`; `lib/services/mantencion/work-orders/query.ts:287-290`; `capa-link.ts`), pero **ningún agregado lo lee**. El panel pinta «Hallazgos abiertos», «OT abiertas» y «CAPA vencidas» como tres columnas independientes. No se puede responder «de los hallazgos críticos, cuántos tienen OT abierta y cuántos no», ni «cuántas OT se cerraron con la CAPA aún vencida». Todo está en la misma fila del activo.

### 5.2 Equipo detenido ↔ cargas del período

El hub tiene, en la misma iteración, `operationalStatus`, `fuelLiters` del período, `openAnomalyCases` e `inWorkshop` (`lib/services/operational-control.ts`, construcción de `vehicleAssets`). No deriva «litros cargados a equipos detenidos» ni «equipos con OT en taller y estado operativo». El detector sólo cubre TAE (CO-046).

### 5.3 Costo de mantención ↔ costo de combustible

**No existe el dato:** `lib/services/mantencion/work-orders/metrics.ts:11-13` lo dice explícitamente («Sin costos: la OT nueva no los lleva») y `db/schema/mantencion-work-orders.ts` no tiene columnas monetarias. `mant_record_parts` sólo guarda cantidad y descripción (`db/schema/mantencion-records.ts:175-183`). Por eso no se puede calcular costo total por equipo ni costo por km/hora completo; lo que sí se puede hoy es el costo de combustible por km/hora (CO-056). Es un GAP de modelo, no un cruce olvidado.

### 5.4 Licencias de conducir ↔ equipos y OT

`listDriverRoster` ya resuelve estado y ventana de aviso (`lib/services/driver-licenses.ts:300-327`) y la OT guarda `operatorDriverId` (`db/schema/mantencion-work-orders.ts:61`), que enlaza con `mant_drivers` y `workers`. Ninguna superficie operacional muestra «licencias vencidas» ni cruza «el operador que trabajó este equipo tenía la licencia vencida». Hoy sólo se ve entrando a `/flota/conductores` con `flota:manage_licenses`.

### 5.5 TAE/TCT/factura ↔ panel operacional

La conciliación por equipo y mes existe (`lib/combustibles/tae-copec-reconciliation.ts:27-48`: litros TAE, TCT diésel, TCT BlueMax y cobertura `both/tae_only/tct_only`) y la diferencia por mandante también (`lib/combustibles/control/queries/reconciliation-summary.ts:36-59`). Al hub sólo llegan cuatro contadores de `fuel_reconciliation_links` y rechazos, **sin litros, sin montos y sin período** (`lib/services/operational-control-sources.ts:62-86`). El panel dice «N sin resolver» pero no «N litros de diferencia». El read model está; falta el consumidor.

### 5.6 Períodos incompatibles

| Superficie | Ventana |
|---|---|
| Panel operacional (desempeño y tabla) | 90 días móviles por defecto |
| Panel — tiles de atención | hoy |
| Tablero | mes calendario en curso por defecto |
| Tablero flota — tendencia | 6 meses fijos |
| Tablero flota — documentos | 30 días fijos |
| `/flota` — costo y litros | 12 meses |
| `/mantencion/panel` | 30 días por defecto |
| `/combustibles/panel` | período de combustible + 5 períodos de historia |

Ninguna pantalla advierte que la cifra de al lado usa otra ventana. El caso más visible: en Finanzas convive «Costo de combustible · últimos 6 meses» con «Gasto en OC · mes en curso» (`dashboard/sections/finance-section.tsx:214-239`).

### 5.7 Métricas calculadas y descartadas

- `criticalOpenAnomalyCases`: se calcula por activo (`lib/services/operational-control.ts`, `vehicleAssets`) y no se pinta ni se exporta (`export-columns.ts:117-126` incluye «Casos abiertos», no los críticos).
- `fuelLoadCount` y `lastFuelLoadAt`: se calculan por activo y no tienen consumidor.
- `asset.capabilities`: se calcula y no lo usa la tabla.
- `getFleetOverview` en el Tablero: se cargan siete consultas para contar `isActive` (CO-056).
- Las tres series de litros (`fuelEquipmentLoads` operacional, `fuelProviderTransactions` proveedor, `fuelLoads` facturada) nunca se muestran juntas; el glosario del panel las declara, pero ninguna pantalla permite cuadrarlas.

---

## 6. Lo que revisé y está correcto

- **Autorización del hub:** `OPERATIONAL_CONTROL_VIEW_PERMISSIONS` es la única fuente para página y export; cada consulta se gatea por su subdominio (`canViewFuel`, `canViewFleet`, `canViewInspections`, `canViewCapa`, `canViewCosts`, `canViewWorkOrders`), y las columnas monetarias exigen `canViewFuel && canViewCosts`.
- **Alcance por faena:** vehículos, instrumentos, inspecciones, hallazgos, CAPA, disponibilidad, documentos, GPS, combustible y OT se consultan con `worksiteScopeSql`/`workOrderMetricsScope`.
- **Período del hub:** `resolveOperationalControlPeriod` usa `civilDate()` y `todayInChile()`; un rango invertido se informa en pantalla en vez de tumbar la página (`page.tsx:83-94`).
- **Tiles de atención:** `null` se pinta como «Sin dato», nunca como 0; los conteos de detenidos y vencidos usan el mismo `filterFleetOverviewRows` que la lista de destino (`lib/operational-control/attention.ts:8-10`).
- **Export del panel:** las columnas se condicionan por capacidad y el estado se exporta con etiqueta humana (`export-columns.ts:89-97`).
- **Flota — permisos:** el gate monetario `flota:view && combustibles:view_costs` es consistente en servicio, página, export y descarga de documentos; la descarga valida la faena y enmascara como 404 (`app/api/flota/documentos/[id]/route.ts:22,37-44`).
- **Flota — documentos:** el versionado `current/replaced/voided` y el índice único parcial están aplicados (`db/schema/fuel-vehicles.ts:88,100-104`); el próximo vencimiento usa la columna declarada antes que el documento (`fleet-documents.ts:41-44`).
- **Mantención:** la fecha y el alcance del registro se derivan del vehículo; la anulación bloquea OT cerradas; la auditoría de la OT es transaccional; el folio se incrementa dentro de la transacción.

---

## 7. Priorización sugerida

| Orden | Hallazgos | Por qué |
|---|---|---|
| 1 | CO-043, CO-044, CO-045, CO-046 | Cifras de control que hoy mienten o no cruzan; son la razón de ser del panel. |
| 2 | CO-047 | Una entrada inválida deja el panel de mantención inutilizable. |
| 3 | CO-048, CO-049, CO-050 | Regresiones funcionales y de trazabilidad con corrección acotada. |
| 4 | CO-051 a CO-061 | Consistencia de exportación, UI y consultas; no cambian decisiones de negocio pero erosionan la confianza en el reporte. |
| 5 | CO-062 y §5 | Cobertura del motor y cruces de información; requieren decisión de producto (qué se muestra y con qué ventana). |

---

## 8. Límites de esta auditoría

- Es una revisión **estática**. No se ejecutaron `typecheck`, `lint`, `test:fast`, `test:pglite`, E2E ni la aplicación.
- No se consultó la base de producción. La afirmación de que `fuel_loads` está vacía se apoya en el comentario del propio código (`lib/services/fleet.ts:128-130`); debe confirmarse con un `count(*)` antes de dimensionar CO-043.
- Los escenarios de concurrencia y de datos reales (COPEC, TAE, traslados de faena) no se reprodujeron; se describen a partir del código.
- No se revisó visualmente la interfaz en navegador; los defectos de presentación se limitan a lo que el código hace evidente.
- La auditoría de Combustibles del 2026-11-05 y la de Mantención del 2026-11-04 ya cubren en detalle sus módulos; este informe no repite esos hallazgos salvo los que siguen parciales o afectan un cruce.

---

## 9. Verificación de la re-auditoría

| Comprobación | Resultado |
|---|---|
| Hallazgos previos re-verificados | 42/42 |
| Resueltos | 35 |
| Parciales | 5 (CO-025, CO-027, CO-032, CO-034, CO-039) |
| Persistentes | 1 (CO-020 → CO-047) |
| Obsoletos por reemplazo | 1 (CO-008) |
| Hallazgos nuevos | 20 (CO-043 a CO-062) |
| Cruces de información faltantes | 7 (§5.1 a §5.7) |

El diagnóstico anterior es el estado inicial de la auditoría. La sección 10 registra las correcciones implementadas después.

---

## 10. Estado de corrección (2026-11-06)

Se implementaron los 20 hallazgos y todas las brechas de cruce, incluido el costo de mantención. Hay tres migraciones nuevas: `0375_peaceful_violations` (ledger de rechazos TCT), `0376_dizzy_zodiak` (cursor/truncamiento del motor batch) y `0377_youthful_matthew_murdock` (costo total de la OT).

| ID | Estado | Cambio y evidencia |
|---|---|---|
| CO-043 | **CORREGIDO** | `asset-fuel-summary` suma el monto desde `fuelProviderTransactions` con `accountableProviderTransactionsWhere`, no desde `fuel_loads`. PGlite: el panel devuelve 16.000 del proveedor y no los 15.000 de la serie antigua. |
| CO-044 | **CORREGIDO** | El panel excluye CAPA `verified`, igual que el filtro «Vencidas» de `/prevencion/capa`. PGlite con una CAPA verificada vencida que no suma. |
| CO-045 | **CORREGIDO** | El Tablero usa `getFleetDashboardSnapshot`: equipos activos con columna declarada + documento vigente, no filas de `fleet_vehicle_documents`. PGlite propia. |
| CO-046 | **CORREGIDO** | `consumo_durante_inactividad` consulta TAE, libro del proveedor y serie operacional. Integración: una carga TCT a un equipo detenido abre caso. |
| CO-047 | **CORREGIDO** | `lib/mantencion/contracts.ts` usa `civilDate()`: `2026-02-31` ya no pasa el contrato. Regresión en `contracts.test.ts`. |
| CO-048 | **CORREGIDO** | Vehículos y Proveedores de combustible tienen buscador propio (`search`/`onSearchChange`), porque la shell lo oculta en todo `/combustibles`. |
| CO-049 | **CORREGIDO** | La auditoría de la reversa de lote TCT y del vínculo patente→vehículo corre dentro de la misma transacción (`recordAudit(..., tx)`). |
| CO-050 | **CORREGIDO** | Tabla `fuel_consumption_import_rejections` (migración 0375), inserción en la misma transacción del lote, servicio `getConsumptionImportRejections` por `hashArchivo` y sección en la ficha del lote. Una importación multi-faena sólo muestra sus rechazos a rol global; la de una faena, a su dueño. PGlite: 3 pruebas de filtrado, orden y alcance. |
| CO-051 | **CORREGIDO** | Se eliminaron «Contrato» (UUID interno) y «Clase» (constante); disponibilidad/cobertura a 1 decimal y «Horas en taller» a 0. Regresiones en `operational-control-export-columns` y `fleet-service`. |
| CO-052 | **CORREGIDO** | `ColumnDef.toggleable` excluye la columna de acciones del menú «Columnas» y la mantiene visible. |
| CO-053 | **CORREGIDO** | «Rendimiento promedio» ya no es ordenable: mezclaba km/L y L/h. |
| CO-054 | **CORREGIDO** | El tile de documentos enlaza a `?vencimiento=proximos` cuando no hay vencidos y sí próximos, y a `al-dia` cuando no hay nada. Regresión en `attention-tiles.test.ts`. |
| CO-055 | **CORREGIDO** | `/flota?revision=estado` filtra equipos con discrepancia entre ficha e intervalo abierto; el callout del panel enlaza a ese subconjunto. Regresiones en `fleet-overview-filters` y `fleet-service`. |
| CO-056 | **CORREGIDO** | El Tablero dejó de cargar `getFleetOverview` completo para contar activos. Flota expone «Costo por km/h» y `meterSeriesIncomplete`; `/flota` reutiliza los vehículos/documentos que ya cargó el índice y acota lecturas, objeciones y documentos a la página. La ficha pide 1 lectura del log, no 20. |
| CO-057 | **CORREGIDO** | La ficha muestra la lectura del proveedor (Copec) y la del log de cargas, separadas y con su fecha. Prueba en `page.test.tsx`. |
| CO-058 | **CORREGIDO** | `?vencimiento=al-dia` exige una fecha: un equipo sin documentar ya no cuenta como vigente. Regresión en `fleet-overview-filters.test.ts`. |
| CO-059 | **CORREGIDO** | El Excel de Flota exporta la etiqueta humana del estado y el tipo documental junto a la fecha. |
| CO-060 | **CORREGIDO** | La ficha muestra «Tipo · fecha» del próximo vencimiento, incluidos los tipos sin columna canónica. |
| CO-061 | **CORREGIDO** | `getAssetFuelSummary` entra en `settleAttention`: si falla, las cifras quedan en `null` («—») y el resto del panel sigue. Tabla y Excel dejaron de convertir el fallo en 0. |
| CO-062 | **CORREGIDO** | `fuel_anomaly_rules.cursor` y `truncated`/`casesFailed` en las ejecuciones (migración 0376); el cron responde `partial` si se truncó o falló un caso. Cursor durable en rendimiento, variación, proveedor, evidencia duplicada/ilegible, lectura regresiva y salto de medidor. PGlite: 101 vehículos, página 100, cursor `veh-099`; 13 pruebas del contrato. |

### 10.1 Brechas de cruce cerradas

| Brecha | Estado | Cambio |
|---|---|---|
| §5.1 Hallazgo ↔ OT ↔ CAPA | **CORREGIDO** | El panel cuenta hallazgos abiertos con y sin OT vigente (`inspection_finding_id`) y los muestra/exporta; PGlite con una OT vinculada. |
| §5.2 Equipo detenido ↔ cargas | **CORREGIDO** | El detector de inactividad cubre TAE, proveedor y serie operacional; prueba de integración con carga TCT. |
| §5.3 Costo de mantención ↔ combustible | **CORREGIDO** | `mant_work_orders.total_cost` (migración 0377), campo opcional «Costo total (CLP)» en el alta, visible en la ficha de la OT y cruzado en el panel como «Costo mantención» y «Costo total» (combustible + mantención). PGlite: costo del período 150.000, febrero 30.000, abiertas/anuladas no suman. |
| §5.4 Licencias ↔ operación | **CORREGIDO** | Indicador «Licencias por regularizar» en el panel, con vencidas/por vencer y enlace a `/flota/conductores`; «Sin datos» si la nómina está vacía. |
| §5.5 TAE/TCT ↔ panel | **CORREGIDO** | Indicador «Equipos con un solo canal» (TAE/TCT) del período, con enlace a Cuadratura › Tarjeta y terreno; se omite si no hay datos. |
| §5.6 Períodos incompatibles | **CORREGIDO** | El panel advierte que mide el período seleccionado y el Tablero el mes/6 meses; Finanzas advierte que el combustible usa 6 meses fijos y la OC el período. |
| §5.7 Métricas calculadas y descartadas | **CORREGIDO** | Se pintan/exportan cargas del período, última carga, casos críticos, hallazgos con OT, costo por km/h, costo de mantención, costo total, licencias y cobertura TAE/TCT. |

### 10.2 Verificación ejecutada

| Comprobación | Resultado |
|---|---|
| `npm run typecheck` | 0 errores |
| `npm run lint` | 0 errores |
| `npm run check:secrets` | verde |
| `npm run db:verify-migrations` | 378 entradas verificadas hasta `0377_youthful_matthew_murdock` |
| `npm run build` | `build-exit=0`; compilado en 114 s y TypeScript en 10,6 s (Next.js 16.4.2) |
| `npm run test:fast -- …` (15 archivos focales) | **215 pruebas en verde, 15 archivos** |
| `npm run test:pglite -- …` (9 archivos focales) | **110 pruebas en verde, 9 archivos** |
| `git diff --check` | exit 0 |

### 10.3 Límites de la corrección

- No se ejecutó la aplicación ni E2E en navegador. Los cambios de UI se sostienen con pruebas de componente/unidad, tipos y build; la verificación visual queda pendiente.
- No se ejecutaron las suites completas `test:fast`/`test:pglite`; sí las suites focales descritas arriba y el build de producción.
- No se aplicó nada en producción. Las migraciones 0375/0376/0377 se probaron en PGlite; no se ejecutaron contra la base de producción.
- El costo de mantención es opcional: una OT sin costo no suma y la cifra se muestra como «—», no como 0. No se inventaron costos históricos.
- Los cambios se commitean en una rama de fix y se integran a `main`; no se despliegan a producción.
