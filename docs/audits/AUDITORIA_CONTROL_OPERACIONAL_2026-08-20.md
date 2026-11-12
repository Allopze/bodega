# Auditoría del módulo de Control operacional

**Fecha:** 20 de agosto de 2026

**Alcance:** Combustibles, TAE, anomalías, ciclo físico, Flota, Mantenciones y su integración con el Dashboard operacional.

**Resultado:** **requiere remediación prioritaria** antes de considerar el módulo maduro para control operacional y evidencia auditable.

## 1. Resumen ejecutivo

La base funcional es amplia: hay control por faena en varias consultas, importaciones Excel, TAE, anomalías, flota, mantenciones, vencimientos, costos, auditoría y un dashboard gerencial. Sin embargo, la auditoría encontró defectos que afectan cuatro invariantes esenciales:

1. **Autorización:** existen mutaciones cross-faena y exposición de costos por fuera de los permisos declarados.
2. **Integridad:** algunos estados, reversas y documentos pueden dejar cifras o evidencia regulatoria falsas.
3. **Trazabilidad:** varias operaciones sensibles no son atómicas con su auditoría, y ciertas bajas o transiciones no dejan historia suficiente.
4. **Continuidad operacional:** hay procesos automáticos implementados sin un scheduler versionado completo ni una señal durable de ejecución.

### Distribución de hallazgos

| Prioridad | Cantidad | Criterio |
|---|---:|---|
| P0 — crítico | 5 | Puede alterar datos de otra faena, exponer/mutar finanzas fuera de autorización o dejar evidencia CAPA falsa. |
| P1 — alto | 24 | Afecta integridad, exactitud, trazabilidad o continuidad del flujo operacional. |
| P2 — medio | 13 | Genera errores funcionales, UX engañosa, problemas de escalabilidad o controles incompletos. |

**Recomendación:** no iniciar primero las funciones nuevas. La secuencia correcta es cerrar P0, estabilizar los ciclos de vida y la semántica contable, y luego ampliar el producto.

### Clasificación usada

- **BUG:** el comportamiento actual viola un permiso, alcance, estado o resultado que el propio código declara. Corresponde a CO-001–006, CO-008–021, CO-023–028, CO-031–032 y CO-035–041.
- **INCONSISTENCIA:** dos superficies o conceptos aplican contratos distintos. Corresponde a CO-007, CO-022, CO-033 y CO-034.
- **GAP:** falta un control operativo necesario para que una función existente sea confiable. Corresponde a CO-029 y CO-030, además de la sección 6.
- **OPORTUNIDAD DE MEJORA:** optimización sin evidencia de falla actual. Corresponde a CO-042 y a parte de la Fase 4.

## 2. Alcance real auditado

El área `control-operacional` registrada en navegación está compuesta por:

- **Combustibles:** consumo, cargas, facturas, importaciones TCT/log operacional, bitácora, ciclo físico, cuenta corriente, reportes y anomalías.
- **TAE:** recepción pública, revisión, conciliación, configuración, histórico e importaciones.
- **Flota:** catálogo operacional, costos, lecturas, vencimientos y documentos.
- **Mantenciones:** registro, programación, costos, lecturas y vínculo con hallazgos/CAPA.
- **Integraciones transversales:** dominio Flota del Dashboard, centros de costo, faenas, proveedores, auditoría, archivos y cron.

La revisión siguió los caminos activos de `app/`, `lib/` y `db/`; los manifiestos se usaron sólo para permisos y navegación. Se revisaron esquema, servicios, Server Actions, páginas, componentes, jobs, pruebas unitarias/PGlite y E2E existentes.

## 3. Hallazgos P0 — críticos

### CO-001 — Mutaciones de anomalías sin control de faena

**Impacto:** un revisor acotado a una faena que conozca el ID de un caso ajeno puede cambiar su estado, resolverlo, descartarlo, asignarlo o comentarlo. Esto permite alterar u ocultar investigaciones por pérdidas de combustible fuera de su alcance.

**Evidencia:**

- Las acciones verifican sólo permisos: `app/(app)/combustibles/anomalias/actions.ts:15-60`.
- Los servicios actualizan o insertan por `caseId` sin intersectar el `worksiteId` con la sesión: `lib/combustibles/anomaly-cases.ts:170-217`.

**Corrección requerida:** cargar y bloquear el caso dentro de una transacción; validar `canAccessWorksite` o aplicar un predicado de alcance en cada mutación; comprobar que el `UPDATE` afectó una fila; registrar transición/auditoría dentro de la misma transacción. Agregar pruebas negativas rol × faena × acción.

### CO-002 — Reversa TAE destruye un lote multi-faena sin validar cobertura

**Impacto:** un rol scoped con permisos personalizados puede revertir un lote histórico que contenga cargas de otras faenas. La acción elimina cargas y movimientos de sellos del lote completo.

**Evidencia:**

- `revertTaeImportBatchAction` valida `tae_import` y `revert`, pero no las faenas contenidas: `app/(app)/combustibles/tae/importar/actions.ts:109-165`.
- El lote no posee una faena única que permita un gate simple: `db/schema/fuel-tae.ts:10-24`.

**Corrección requerida:** permitir la reversa multi-faena sólo a roles globales o demostrar, bajo bloqueo transaccional, que la sesión cubre todas las faenas presentes. Mantener auditoría atómica y agregar pruebas con un lote de al menos dos faenas.

### CO-003 — Cuenta corriente global protegida en páginas, pero no en acciones

**Impacto:** las páginas requieren acceso global y permiso de costos, pero las acciones aceptan `combustibles:create`. Un llamador directo puede crear un estado de cuenta que incorpora cargas globales o pagar un resumen conocido sin la autorización financiera esperada.

**Evidencia:**

- Gate de página: `app/(app)/combustibles/cuenta-corriente/page.tsx:12-25` y `app/(app)/combustibles/cuenta-corriente/[id]/page.tsx:15-27`.
- Gate más débil en creación y pago: `app/(app)/combustibles/actions-module/statements.ts:18-24` y `:91-97`.
- La creación agrega cargas por proveedor/mes sin dimensión de faena: `app/(app)/combustibles/actions-module/statements.ts:37-79`.

**Corrección requerida:** repetir en cada acción el contrato `combustibles:view_costs` más rol global, o rediseñar estados de cuenta con dimensión explícita de faena. La UI nunca debe ser la barrera de autorización.

### CO-004 — `combustibles:view_costs` no protege realmente los montos

**Impacto:** usuarios con permisos de lectura operacional, pero sin permiso de costos, pueden ver montos, precios, gasto y costo por km/hora en Combustibles, Flota y Dashboard.

**Evidencia:**

- El manifiesto declara que `combustibles:view_costs` protege montos: `modules/combustibles/manifest.ts:24` y `:46`.
- `/combustibles` calcula `canViewCosts`, pero renderiza KPI, precio, gráficos y detalle monetario sin aplicarlo: `app/(app)/combustibles/page.tsx:75-130`, `:281-315` y `:578-584`; `app/(app)/combustibles/consumption-kpis.tsx:26-35`; `app/(app)/combustibles/consumption-detail-table.tsx:75-111`.
- `/flota` exige sólo `flota:view` y muestra costos: `app/(app)/flota/page.tsx:26-33`, `:72-93`; `app/(app)/flota/fleet-table.tsx:28-31`, `:63-71`.
- El Dashboard habilita el dominio con cualquiera de tres permisos y consulta los tres subdominios: `app/(app)/dashboard/dashboard-domains.ts:77-83`; `app/(app)/dashboard/sections/fleet-section.tsx:35-61`, `:63-80`, `:122-133`.

**Corrección requerida:** definir una matriz de capacidades por dato (`canViewFuel`, `canViewFleet`, `canViewMaintenance`, `canViewCosts`), evitar incluso consultar datasets no autorizados y devolver proyecciones redactadas desde servicios. Añadir pruebas negativas por permiso individual y rol custom.

### CO-005 — Mantenciones puede dejar evidencia CAPA falsa o duplicada

**Impacto:** una mantención derivada de inspección puede marcarse completada, generar evidencia CAPA y luego volver a “En curso”, “Programada” o “Cancelada”. La evidencia permanece afirmando que fue completada; una nueva finalización crea otra evidencia.

**Evidencia:**

- El formulario admite todos los estados sin considerar el origen: `app/(app)/mantenciones/maintenance-form.tsx:140-149`.
- La actualización permite cualquier transición y crea evidencia al entrar en `completed`: `lib/services/maintenance.ts:296-351`.
- Se puede cancelar cualquier registro no cancelado, incluso completado: `app/(app)/mantenciones/maintenance-row-actions.tsx:75-93`; `lib/services/maintenance.ts:388-407`.
- La evidencia no tiene unicidad por referencia: `db/schema/prevention/capa.ts:133-146`.

**Corrección requerida:** implementar una máquina de estados explícita; separar `complete`, `cancel` y `reopen` con motivo; hacer la evidencia idempotente por `(actionId, reference)`; invalidarla o supersederla cuando deja de estar completada; usar el estado nuevo en su descripción. Probar el ciclo completar → cancelar/reabrir → completar en PostgreSQL.

## 4. Hallazgos P1 — altos

### Seguridad, alcance y autorización

| ID | Hallazgo | Evidencia principal | Acción requerida |
|---|---|---|---|
| CO-006 | `flota:view`, descrito como lectura, permite subir y eliminar documentos. | `modules/flota/manifest.ts:5-11`; `app/(app)/flota/actions.ts:15-21`, `:78-84`; `app/(app)/flota/[id]/fleet-documents-panel.tsx:91-168`. | Crear `flota:manage_documents`, ocultar controles y repetir el gate en acción y servicio; pruebas negativas y cross-faena. |
| CO-007 | Los toggles ocultan navegación, pero las URLs y Server Actions continúan activas. Contradice el contrato “módulo inactivo”. | `lib/services/module-toggles.ts:5-12`; `app/(app)/layout.tsx:109-138`; `components/layout/nav-items.ts:139-160`. | Guard central de módulo/submódulo para páginas, endpoints y mutaciones. |
| CO-008 | Mantenciones entrega todos los centros de costo y acepta cualquiera, aunque éstos tienen faena. | `lib/services/maintenance.ts:66-90`; `db/schema/cost-centers.ts:6-17`; `lib/services/maintenance.ts:248-264`, `:319-335`. | Filtrar opciones por alcance/actividad y revalidar server-side contra la faena efectiva. |
| CO-009 | El alta manual de cargas carga vehículos activos de todas las faenas. | `app/(app)/combustibles/nueva/page.tsx:20-35`. | Usar el predicado canónico scoped de vehículos; mantener el guard del servidor. |
| CO-010 | Crear un punto TAE permite asociar una vasija de otra faena. | `app/(app)/combustibles/tae/actions.ts:51-64`; contraste con validación posterior en `:71-79`; `lib/combustibles/fuel-cycle.ts:147-166`. | Validar vasija activa, misma faena y producto dentro de la transacción; reforzar el modelo. |
| CO-011 | Un movimiento del ciclo físico puede referenciar un vehículo de otra faena. | `lib/combustibles/fuel-cycle.ts:41-75`; `app/(app)/combustibles/ciclo/actions.ts:24-43`. | Validar vehículo activo, faena y compatibilidad de producto en la transacción. |
| CO-012 | Mantenciones legacy con `worksite_id = NULL` quedan ocultas al listado scoped, pero pueden cancelarse por ID sin validar la faena del vehículo. | `db/schema/maintenance.ts:14`; `lib/services/maintenance.ts:46-72`, `:388-399`. | Backfill desde vehículo, `NOT NULL` y resolución de alcance a través del vehículo durante la transición. |
| CO-013 | El historial/detalle de importación TAE expone metadatos y rechazos de lotes multi-faena. | `app/(app)/combustibles/tae/importar/historial/page.tsx:19-55`; `app/(app)/combustibles/tae/importar/[id]/page.tsx:20-55`, `:100-149`. | Hacerlo global-only o modelar y aplicar visibilidad del lote por faena a totales, rechazos y metadatos. |

### Integridad, estados y exactitud

| ID | Hallazgo | Evidencia principal | Acción requerida |
|---|---|---|---|
| CO-014 | Cargas `cancelled` y/o `draft` se incluyen en reportes, ciclo, estados de cuenta y parte de Flota. | `lib/combustibles/queries.ts:24-49`; `lib/combustibles/reports.ts:19-58`; `lib/combustibles/fuel-cycle.ts:83-104`; `app/(app)/combustibles/actions-module/statements.ts:47-59`; `lib/services/fleet.ts:105-121`. La tendencia correcta sí excluye anuladas en `lib/services/dashboard-fleet-maintenance.ts:118-124`. | Definir un predicado canónico de estados contabilizables y reutilizarlo en todos los agregados. |
| CO-015 | Cargas `registered` o `cancelled` se pueden editar/eliminar por Server Action directa; sólo `reconciled` está bloqueado. | `app/(app)/combustibles/actions-module/loads.ts:195-214`, `:351-368`; el registro sí exige `draft` en `:406-429`. | Máquina de estados server-side y `UPDATE/DELETE ... WHERE id AND status AND statement_id`; pruebas de concurrencia. |
| CO-016 | Revalidar una carga TAE duplica el movimiento de sello retirado. | `lib/validation/fuel-tae.ts:40-53`; `app/(app)/combustibles/tae/actions.ts:121-151`; `lib/services/fuel-tae.ts:580-622`; `db/schema/fuel-tae.ts:237-259`. | Dedupe simétrico e índice único por envío, tipo de movimiento y sello. |
| CO-017 | El workflow de anomalías no tiene máquina de estados ni auditoría transaccional. | `app/(app)/combustibles/anomalias/actions.ts:9-25`; `lib/combustibles/anomaly-cases.ts:167-217`. | Matriz de transición, `expectedStatus`, control optimista y evento/auditoría atómico. |
| CO-018 | La severidad configurable de reglas no gobierna los casos; los detectores usan literales. | `app/(app)/combustibles/anomalias/reglas/rule-form.tsx:58-79`; `lib/combustibles/anomaly-detector.ts:210-248`; `lib/services/fuel-tae.ts:400-430`. | Consumir `rule.severity` en cada detector o retirar el ajuste engañoso. |
| CO-019 | La regla activa `carga_duplicada` se siembra, pero no existe en catálogo/motor. | `lib/combustibles/anomaly-cases.ts:287-316`; `lib/combustibles/validation.ts:201-218`; `lib/combustibles/anomaly-detector.ts:513-527`. | Implementarla o retirarla; prueba de paridad seed ↔ catálogo ↔ detectores. |
| CO-020 | Fecha civil inválida de mantención pasa la regex y luego puede romper consultas con `::date`. | `lib/validation/maintenance.ts:21-25`; `db/schema/maintenance.ts:16`; `lib/services/fleet.ts:263-268`. | Validar fecha real, sanear datos y migrar idealmente a tipo `date`. |
| CO-021 | Versiones antiguas de documentos siguen determinando el “próximo vencimiento”. | `db/schema/fuel-vehicles.ts:51-65`; `lib/services/fleet.ts:140-147`, `:187-193`; `lib/services/dashboard-domains-data.ts:119-136`. | Fuente canónica y versionado `current/replaced`; preservar historia sin contaminar vigencia. |
| CO-022 | Mantención puede imputarse a una faena distinta de la del vehículo; los agregados después se dividen por semánticas distintas. | `lib/services/maintenance.ts:279-317`; `lib/services/fleet.ts:122-135`. | Exigir igualdad por defecto o modelar separadamente faena propietaria, lugar de ejecución e imputación. |
| CO-023 | “Última lectura” se obtiene con `MAX`, no con la última fila cronológica. | `lib/services/fleet.ts:111-114`, `:238-242`; `lib/services/maintenance.ts:171-194`. | Ordenar por fecha, hora y `createdAt`; modelar resets/correcciones de odómetro u horómetro. |
| CO-024 | Los filtros “inactivos” de Bitácora usan valores que no existen en el enum canónico. | `app/(app)/combustibles/bitacora/page.tsx:217-234`; `lib/combustibles/fuel-log.ts:346-360`; `lib/combustibles/validation.ts:130-139`. | Usar valores canónicos; definir si “revisión” es un estado real; pruebas por opción. |

### Trazabilidad, atomicidad y continuidad

| ID | Hallazgo | Evidencia principal | Acción requerida |
|---|---|---|---|
| CO-025 | Escritura, archivo y auditoría no siempre forman una unidad. Puede quedar una fila sin auditoría, un archivo huérfano o una fila apuntando a un archivo borrado tras un error tardío. | `lib/services/fleet.ts:316-396`; `app/(app)/flota/actions.ts:54-74`; `lib/services/maintenance.ts:241-294`, `:388-407`; `app/(app)/combustibles/actions-module/loads.ts:156-180`, `:316-390`. | Auditoría dentro de la misma transacción; staging/outbox y compensación verificable para archivos; borrado lógico de evidencia. |
| CO-026 | Importaciones TCT y operacionales hacen dedupe antes de transacción; los hashes no son únicos. Dos confirmaciones concurrentes pueden duplicar lotes. | `app/(app)/combustibles/actions-consumos.ts:185-230`; `app/(app)/combustibles/actions-operaciones.ts:245-278`; `db/schema/fuel-consumption.ts:33-47`; `db/schema/fuel-operations.ts:31-45`. | Advisory lock por hash, recheck transaccional e índices/claves naturales apropiados; reutilizar el patrón TAE. |
| CO-027 | La importación global TCT omite patentes sin vehículo sin un ledger durable de rechazos. | `app/(app)/combustibles/actions-consumos.ts:213-255`, `:293-303`. | Persistir rechazo, causa, fila de origen y estado de reproceso; exigir confirmación de omisiones. |
| CO-028 | Baja/reactivación individual y masiva de vehículos carece de auditoría. | `app/(app)/combustibles/actions-module/vehicles.ts:209-260`; contraste con alta/edición en `:124-132`, `:192-200`. | Transacción, motivo y evento por lote o por vehículo con estado previo/nuevo. |
| CO-029 | Hay endpoints cron de anomalías, Copec y notificaciones sin scheduler versionado visible; el health de snapshots tampoco está programado en el workflow. | `app/api/cron/fuel-anomaly-detection/route.ts:1-40`; `app/api/cron/fuel-copec-sync/route.ts:1-12`; `app/api/cron/fuel-statement-notifications/route.ts:1-44`; `scripts/cron-runner.mjs:12-33`; `docker-compose.yml:194-243`; `.github/workflows/operational-metric-snapshots.yml:3-38`. | Incorporar jobs, locks, idempotencia, última ejecución durable y alertas. Verificar aparte si producción tiene scheduler externo. |

## 5. Hallazgos P2 — medios

| ID | Hallazgo | Recomendación |
|---|---|---|
| CO-030 | `/mantenciones` sólo permite acceder a los primeros 100 resultados y no tiene paginación/exportación completa (`lib/services/maintenance.ts:19-20`, `:66-72`). | Paginación server-side con total y exportación Excel filtrada. |
| CO-031 | El enlace “Combustible” de una ficha usa `?vehicle=<id>`, pero la página consume `patente` (`app/(app)/flota/[id]/page.tsx:44-50`; `app/(app)/combustibles/page.tsx:50-70`). | Usar `patente` o definir un filtro contractual `vehicleId`. |
| CO-032 | La búsqueda TopBar se muestra en `/combustibles`, pero esa página no consume `searchQuery` y ya posee búsqueda server-side por patente (`components/layout/top-bar.tsx:23-26`; `app/(app)/combustibles/consumption-filters.tsx:162-177`). | Ocultar TopBar sólo en la ruta raíz o conectarla al filtro canónico sin romper subrutas con `DataTable`. |
| CO-033 | Enlaces de Flota/Dashboard se muestran aunque falte permiso del destino. | Condicionar cada enlace y consulta a su capacidad, no sólo el dominio completo. |
| CO-034 | Acciones, filtros y tablas tienen gaps móviles/a11y: acción de gestión en `headerActions`, selects de 32 px, filtros sin label persistente y tablas sin `renderMobileCard`. | Usar `PageHeader.actions`, objetivos táctiles ≥44 px, `Field`/labels y tarjetas móviles. |
| CO-035 | Las alertas de Mantenciones no respetan los filtros de vehículo/faena activos (`app/(app)/mantenciones/page.tsx:49-57`, `:110-162`). | Propagar filtros o rotular/separar claramente el resumen global. |
| CO-036 | Los metadatos de documentos de flota aceptan tipo y fecha crudos (`app/(app)/flota/actions.ts:23-30`; `lib/services/fleet.ts:316-344`). | Zod compartido, taxonomía, longitud y fecha civil real. |
| CO-037 | `settle` convierte fallas de consultas en ceros/listas vacías sin avisar al usuario (`lib/async-settle.ts:21-27`; `app/(app)/combustibles/page.tsx:77-158`; `app/(app)/dashboard/sections/fleet-section.tsx:48-60`). | Devolver `degradedSources`, banner con correlación y telemetría; “desconocido” no debe verse como cero. |
| CO-038 | El Dashboard mezcla período seleccionado, últimos 6 meses y últimos 12 meses dentro de una vista (`app/(app)/dashboard/sections/fleet-section.tsx:40-80`, `:95-130`). | Unificar período o rotular cada ventana de forma inequívoca. |
| CO-039 | El motor batch de anomalías usa límite sin cursor/orden determinista y transforma fallas por regla en cero, mientras el cron responde éxito. | Cursor durable, lock, `partial_failure` y alerta observable. |
| CO-040 | Evidencia histórica TAE puede redirigir a cualquier host HTTP(S). | Lista permitida/proxy de descarga; evitar open redirect/phishing desde dominio confiable. |
| CO-041 | El rango TAE por defecto usa día UTC, no Chile. | Usar `todayInChile()` y pruebas en el borde 20:00–00:00 de Chile. |
| CO-042 | `getFleetVehicleDetail` ejecuta hasta 10 consultas adicionales para impacto de consumo. | Reemplazar por una agregación SQL/lateral única cuando se implemente el nuevo historial. |

## 6. Capacidades faltantes necesarias

Estos puntos son **brechas funcionales**, no bugs demostrados.

### Imprescindibles para un control operacional completo

1. **Plan preventivo configurable:** intervalos por vehículo/tipo de equipo, fecha, km, horas o combinación; hoy existen sólo umbrales globales fijos (`lib/services/maintenance.ts:143-145`).
2. **Orden de trabajo durable:** prioridad, responsable/taller, SLA, tareas, repuestos, mano de obra, aprobación de costos, indisponibilidad, causa raíz, garantía, inicio/cierre real y motivo de cancelación.
3. **Adjuntos reales de mantención:** carga, descarga, versionado, retención y permisos. El esquema posee `documentPath`/`documentMimeType`, pero no existe flujo completo.
4. **Política documental por clase de activo:** documentos obligatorios, completitud, versión vigente y alertas programadas.
5. **Notificaciones y escalamiento:** mantención próxima/vencida, documentos, anomalías sin responsable/SLA, fallas de sync y estados de cuenta.
6. **Reconciliación persistente TAE ↔ TCT/factura ↔ log operacional:** diferencias explicadas, resolución, excepción aceptada y evidencia.
7. **Ledger y reproceso de importaciones:** rechazos de TCT/log, corrección de mapeos y reproceso del lote vigente; no sólo futuras importaciones.
8. **Observabilidad operacional:** última ejecución, duración, filas procesadas, errores, reintentos, checkpoint y estado visible para el usuario responsable.

### Necesarias para operación y gestión

- Exportación **Excel** de Flota, Mantenciones, cumplimiento, atrasos y costo total, respetando filtros y permisos de datos sensibles.
- Reportes de disponibilidad, MTBF/MTTR, costo por activo/unidad de uso, cumplimiento preventivo, downtime y backlog.
- Sincronización explícita entre OT y estado del vehículo (`operativo`, `mantencion`, `fuera_servicio`).
- Bandeja unificada de activos o contrato claro entre vehículos y `service_equipment`, sin borrar sus diferencias de dominio.
- Hub real de “Control operacional” con salud de fuentes, trabajo pendiente y enlaces sólo a superficies autorizadas.
- Vistas guardadas, responsables y SLA para investigaciones de anomalías.

## 7. Controles positivos encontrados

- Flota aplica alcance por faena en overview y detalle: `lib/services/fleet.ts:92-135`, `:211-256`.
- Upload/delete de documentos vuelve a validar la faena en el servicio: `lib/services/fleet.ts:316-376`.
- La descarga documental valida ruta física y enmascara el acceso cross-faena como 404: `app/api/flota/documentos/[id]/route.ts:17-57`.
- Creación/edición de mantenciones valida tanto la faena actual como el vehículo destino: `lib/services/maintenance.ts:279-317`.
- TAE ya posee un buen patrón de advisory lock y recheck transaccional que puede reutilizarse en las demás importaciones: `lib/combustibles/tae-import-service.ts:273-316`.
- Varias operaciones críticas ya registran auditoría dentro de transacciones; existe un patrón local que conviene normalizar.
- La arquitectura visual base usa `PageHeader`, `PageContainer`, filtros estructurados y tokens del sistema.

## 8. Plan de implementación

### Fase 0 — Contención P0 y pruebas negativas

**Objetivo:** cerrar autorización cross-faena, costos y evidencia regulatoria antes de ampliar el módulo.

1. Crear una matriz de capacidades por superficie/dato y helpers server-side reutilizables.
2. Corregir alcance transaccional de anomalías y reversa TAE.
3. Endurecer cuenta corriente con `view_costs + global` en acciones.
4. Redactar costos en servicios y UI de Combustibles, Flota y Dashboard.
5. Crear `flota:manage_documents` y migrar grants controladamente.
6. Implementar máquina de estados Mantención/CAPA con evidencia idempotente/revocable.
7. Agregar una matriz de pruebas negativas con dos faenas, rol global, rol scoped y rol custom.

**Criterio de salida:** ningún ID ajeno puede mutarse; ningún monto se consulta o renderiza sin permiso; completar/reabrir/cancelar nunca deja evidencia CAPA contradictoria.

### Fase 1 — Integridad de estados, contabilidad y transacciones

1. Definir una única política de estados contabilizables de cargas.
2. Implementar máquinas de estados para cargas y anomalías, con transición optimista.
3. Hacer idempotentes los movimientos de sellos y las importaciones por hash.
4. Llevar mutación + auditoría a la misma transacción; introducir staging/outbox para archivos.
5. Crear ledger de rechazos y reproceso de TCT/log operacional.
6. Auditar bajas/reactivaciones y requerir motivo.
7. Incorporar los cron faltantes al scheduler versionado y registrar salud/última ejecución.

**Criterio de salida:** mismas cifras en reportes, ciclo, cuenta corriente, Flota y Dashboard; reintentos seguros; toda mutación sensible deja auditoría consistente.

### Fase 2 — Modelo de activos, faena y vigencia

1. Decidir y documentar la semántica de faena del vehículo, ejecución e imputación.
2. Scope y validación server-side de centros de costo, vehículos, vasijas y puntos TAE.
3. Backfill de mantenciones sin faena y migración a `NOT NULL`.
4. Fecha real de mantención y metadatos documentales validados; generar migración nueva desde esquema, sin editar journal ni SQL existente.
5. Versionar documentos (`current/replaced`) y definir fuente canónica por tipo.
6. Calcular lecturas cronológicas y tratar resets/correcciones.

**Criterio de salida:** no hay asociaciones cross-faena ambiguas, fechas corruptas ni vencimientos perpetuos por historia antigua.

### Fase 3 — Madurez funcional

1. Planes preventivos configurables y generación de OT.
2. OT completa, adjuntos, aprobación, downtime y cierre.
3. Notificaciones, responsables, SLA y escalamiento.
4. Reconciliación persistente TAE/TCT/factura/log y reproceso por mapping.
5. Exportaciones Excel y reportes de disponibilidad/costo/cumplimiento.
6. Hub de Control operacional y sincronización OT ↔ estado del activo.

### Fase 4 — UX, escala y observabilidad

1. Paginación server-side, cursores y consultas agregadas sin N+1.
2. Corregir búsqueda, deep links, filtros, permisos de enlaces y semántica de períodos.
3. Adaptación móvil y accesibilidad de tablas/filtros.
4. Estados degradados visibles, correlation IDs, métricas, alertas y runbook.

## 9. Estrategia de pruebas y release gates

### Pruebas mínimas por cambio

- Unitarias de validación y máquinas de estados.
- PGlite para contratos SQL y migraciones.
- PostgreSQL real, secuencial y en bases desechables para locks, carreras, rollback e idempotencia.
- Matriz RBAC/faena con pruebas negativas, no sólo admin/camino feliz.
- Playwright con dos usuarios y dos faenas para los P0 y los flujos documentales.
- ESLint, `npx tsc --noEmit`, pruebas focales y luego suites completas.
- Exportaciones verificadas como `.xlsx`; nunca CSV.

### Definition of Done transversal

- La UI oculta lo no autorizado y el servidor vuelve a rechazarlo.
- Las consultas no recuperan datos sensibles que luego se oculten.
- Las transiciones inválidas fallan sin cambios parciales.
- La auditoría comparte transacción con la mutación o usa un patrón durable equivalente.
- Faena se valida al listar opciones y nuevamente al confirmar.
- Reintentos y doble clic son idempotentes.
- Hay evidencia de error/degradación; “desconocido” no se representa como cero.
- Toda migración nueva nace de `db/schema` con `npm run db:generate`; no se edita el journal ni una migración creada.

## 10. Verificación ejecutada durante la auditoría

- `npx tsc --noEmit`: **aprobado**.
- `npm run lint -- --quiet`: **aprobado**.
- Selección principal de Vitest: **29 archivos / 152 pruebas aprobadas**, incluida 1 suite PGlite de integración.
- Barrido especializado de Combustibles/TAE: **45 archivos / 277 pruebas aprobadas**.
- Revisiones focales adicionales de alcance, toggles, Flota y Mantenciones: aprobadas; se solapan con la selección principal y no se suman al total.
- `git diff --check` previo al informe: sin errores.

### Evidencia no obtenida

- No se ejecutó navegador E2E porque requiere una base desechable y autorización de reset.
- No se ejecutaron suites de concurrencia sobre PostgreSQL real.
- No se hizo build, despliegue, smoke autenticado ni verificación de producción.
- La existencia de endpoints cron no prueba que producción los programe; el hallazgo CO-029 se refiere a la ausencia de scheduling versionado en el repositorio.

## 11. Decisiones de producto que deben cerrarse antes de Fase 2/3

1. ¿Quién puede ver costos: jefatura de mantención, jefatura de faena, gerencia o permisos personalizados?
2. ¿La faena de una mantención representa propiedad del activo, lugar de ejecución o imputación contable?
3. ¿Qué tipos documentales son obligatorios por clase de activo y cuál es su retención legal?
4. ¿Qué transiciones de Mantención requieren aprobación, evidencia o motivo?
5. ¿Qué estados de una carga son contables en cada reporte y desde qué hito?
6. ¿Los lotes TAE/TCT pueden ser multi-faena para operadores scoped, o son siempre una operación global?
7. ¿Qué SLA y responsables aplican a anomalías, vencimientos y mantenciones vencidas?

## 12. Orden sugerido de entrega

Dividir en PR pequeñas y verificables:

1. **RBAC/faena P0:** CO-001, CO-002, CO-003, CO-004 y CO-006.
2. **Mantención/CAPA:** CO-005, CO-020, CO-022 y CO-025.
3. **Estados contables:** CO-014, CO-015, CO-016 y CO-017.
4. **Maestros y asociaciones:** CO-008 a CO-013.
5. **Importaciones/automatización:** CO-018, CO-019 y CO-026 a CO-029.
6. **Vigencia y lecturas:** CO-021 y CO-023.
7. **UX/escala:** CO-030 a CO-042.
8. **Capacidades nuevas:** planes preventivos, OT, conciliación, alertas, reportes y hub operacional.

Cada PR debe incluir su prueba negativa o de regresión antes de pasar a la siguiente fase.
