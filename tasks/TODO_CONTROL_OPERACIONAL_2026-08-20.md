# TODO activo — Control operacional

Estado global: **en implementación**.

## Fase 0 — Contención crítica

- [x] T01 CO-001/017: scope, lock, estado y auditoría de anomalías.
- [x] T02 CO-002: reversa TAE autorizada por todas las faenas del lote.
- [x] T03 CO-003: cuenta corriente global + `view_costs` en acciones.
- [x] T04 CO-004/033: matriz de capacidades y redacción de costos/destinos.
- [x] T05 CO-006: `flota:manage_documents` en manifiesto, UI, acciones y servicio.
- [x] T06 CO-005: máquina de estados Mantención/CAPA y evidencia idempotente.

## Fase 1 — Alcance e integridad

- [x] T07 CO-007: guard central de módulo/submódulo deshabilitado.
- [x] T08 CO-008/012/022: centros de costo y faena efectiva de mantención.
- [x] T09 CO-009/013: catálogos scoped en cargas/TAE/Bitácora.
- [x] T10 CO-010/011: punto, vasija, vehículo y producto de la misma faena.
- [x] T11 CO-014: predicado canónico de estados contabilizables.
- [x] T12 CO-015: ciclo de vida y control optimista de cargas.
- [x] T13 CO-016: sellos TAE idempotentes con constraint.
- [x] T14 CO-018/019: severidad real y detector `carga_duplicada`.
- [x] T15 CO-020/024/036/041: fechas/estados/metadatos válidos y Chile.
- [x] T16 CO-021: documentos versionados y vigencia actual.
- [x] T17 CO-023: lecturas cronológicas y resets.

## Fase 2 — Atomicidad, importaciones y automatización

- [ ] T18 CO-025/028: auditoría atómica, staging/retención y bajas auditadas.
- [ ] T19 CO-026/027: locks de importación y ledger/reproceso.
- [ ] T20 CO-029/039: scheduler, cursor, health y alertas.
- [ ] T21 CO-037/038: degradación visible y períodos coherentes.
- [ ] T22 CO-040: evidencia externa segura y exportaciones acotadas.

## Fase 3 — Features y UX

- [ ] T23 CO-030: paginación y exportación Excel de Flota/Mantenciones.
- [ ] T24 CO-031/032/035: enlaces, búsqueda y filtros.
- [ ] T25 CO-034: móvil y accesibilidad.
- [ ] T26: planes preventivos configurables.
- [ ] T27: OT completa + estado operacional.
- [ ] T28: adjuntos y política documental.
- [ ] T29: notificaciones, SLA y escalamiento.
- [ ] T30: reconciliación persistente y reproceso.
- [ ] T31: observabilidad y hub operacional.
- [ ] T32: reportes de gestión operacional.
- [ ] T33: contrato unificado de activos.
- [ ] T34 CO-042: consulta de detalle sin N+1.

## Fase 4 — Verificación final

- [ ] T35: migraciones generadas/verificadas y sin drift.
- [ ] T36: unitarias, `test:fast`, PGlite y PostgreSQL secuencial.
- [ ] T37: lint, TypeScript, secretos, seguridad, React Doctor y build.
- [ ] T38: E2E desechable completo.
- [ ] T39: auditoría final de requisitos y documentación actualizada.

## Registro de avance

- 2026-08-20: auditoría terminada; 42 hallazgos y capacidades faltantes convertidos en 39 tareas verificables.
- 2026-08-20: asumidos contratos conservadores de costos, faena, estados contables y retención; sin commit/push/deploy.
- 2026-08-20: inicia T01; contrato de transiciones alineado con la UI y mutaciones diseñadas con lock + scope + auditoría en una transacción.
- 2026-08-20: T01 implementada. Estado, asignación y comentarios ahora validan faena bajo lock; estado/asignación usan token optimista; reevaluación automática y trazas son atómicas. La revisión adversarial añadió la carrera de asignación y el cierre/reapertura transaccional. Regresiones escritas, aún no ejecutadas por instrucción del usuario.
- 2026-08-20: inicia T02; las cargas del lote se bloquean y se exige cobertura completa de sus faenas antes de borrar cualquier derivado.
- 2026-08-20: T02 implementada. Reversa y reproceso serializan sobre el lote padre; la reversa valida todas las faenas, oculta existencia/estado fuera de alcance y conserva auditoría atómica. Revisión adversarial superada y regresión PostgreSQL de concurrencia escrita, aún no ejecutada.
- 2026-08-20: inicia T03; creación de resumen y registro de pagos se alinean con el gate global + costos de sus páginas.
- 2026-08-20: T03 implementada. Las mutaciones de cuenta corriente requieren gestión dedicada, lectura de costos y alcance global antes de validar o consultar; el layout evita oráculos y las notificaciones financieras excluyen grants scoped. Revisión adversarial superada y regresiones escritas, aún no ejecutadas.
- 2026-08-20: inicia T04; servicios y superficies separan capacidades de combustible, TAE, flota, mantenciones y costos, y proyectan `null` en vez de consultar montos sin autorización.
- 2026-08-21: T04 implementada. La matriz separa datasets y costos desde SQL hasta UI, reportes Excel, filtros, auditoría, deep links y notificaciones; Finanzas usa un read model mínimo de compras y la cuenta corriente exige base + costos + global. Se escribieron regresiones negativas por roles custom y la revisión adversarial final pasó; las pruebas siguen pendientes para la fase final por instrucción del usuario.
- 2026-08-21: inicia T05; la gestión documental de Flota se separa de `flota:view` con un permiso dedicado repetido en manifiesto, UI, acciones y servicios.
- 2026-08-21: T05 implementada. La lectura y descarga conservan `flota:view`, mientras carga y eliminación exigen `flota:manage_documents` en UI, acción y servicio, con alcance por faena autoritativo. Regresiones negativas escritas y revisión adversarial superada; pruebas pendientes para la fase final.
- 2026-08-21: inicia T06; la edición genérica dejará de controlar estados y completar, reabrir o cancelar pasarán por transiciones explícitas, serializadas e históricas con evidencia CAPA vigente idempotente.
- 2026-08-21: T06 implementada. Crear/editar ya no puede saltar el ciclo de vida; iniciar, completar, reabrir y cancelar usan estado esperado y lock. La evidencia CAPA reserva `mantencion:`, es única/canonicalizada, se supersede sin borrarse y sólo la vigente cuenta; la migración concilia duplicados/colisiones históricas y la regresión PostgreSQL cubre recompletado concurrente. Dos bloqueos adversariales fueron corregidos y la segunda revisión pasó; pruebas aún pendientes.
- 2026-08-21: inicia T07; los toggles se elevan desde visibilidad de navegación a una política central de acceso para rutas, Server Actions, endpoints y flujos públicos/automatizados.
- 2026-08-21: la primera revisión adversarial de T07 detectó aliases SST, acciones despachables desde rutas hermanas, APIs/jobs sin owner, fail-open y pendientes de Prevención fuera del toggle. Se reemplazó la inferencia desde el menú por un inventario autoritativo con cobertura estática, destinos operacionales explícitos, enforcement central en proxy después de auth/secreto y lectura fail-closed.
- 2026-08-21: T07 cerrada tras la segunda revisión adversarial (38 hallazgos, 5 refutados). Correcciones: la PWA pública de PPA y sus envíos anónimos quedaron bajo el toggle; el guard de permiso dejó de depender de la cabecera `x-chome-pathname` (una ruta con punto salta el matcher y desactivaba la puerta entera); el enforcement se movió al proxy para TODA request autenticada —un layout compartido no se re-ejecuta en navegación RSC parcial—; `requireAuth` también consulta el toggle; el submódulo se evalúa por la ruta canónica **y** por la real; `assertInspectionOperationEnabled` dejó de ser código muerto y gobierna Inspecciones/Auditorías desde el `kind` persistido; se corrigieron los owners de casos reservados, adjuntos de Entregas e impresión SST; la puerta de recuperación ya no desaparece del menú. La prueba de inventario ahora recorre `(print)` y `(public)` y exige el owner correcto —encontró dos huecos reales— y se agregó regresión del fail-open sin cabecera. Ojo: un agente revisor mutó `lib/services/maintenance.ts` para demostrar una prueba débil y no lo restauró; se detectó por regresión roja.
- 2026-08-21: T08 implementada y revisada (16 hallazgos confirmados, 1 refutado). La faena de una mantención es siempre la del equipo: se retiró el selector de faena, se derivó del vehículo en una sola lectura dentro de la transacción, y una FK compuesta `(vehicle_id, worksite_id) ON UPDATE CASCADE` sostiene la invariante cuando el equipo se traslada —antes ningún llamador la mantenía—. Los centros de costo se acotan a vigentes + transversales + faena visible, se validan contra la faena del **equipo** y sólo se revalidan cuando cambian (si no, un centro heredado dejaba el registro inmutable); el formulario los filtra por el vehículo elegido y conserva el heredado. Migraciones 0199 (realineo + NOT NULL) y 0200 (FK compuesta, índice único primero). El mismo defecto en Facturación (propuestas y contratos aceptaban cualquier `costCenterId`) se cerró con el helper compartido.
- 2026-08-21: T10 implementada. El alta de un punto de carga TAE valida la vasija (faena + vigencia) dentro de la transacción, igual que ya hacía la reasignación, y deja de reportar cualquier fallo como nombre duplicado. Los movimientos del ciclo físico validan además el equipo: faena, vigencia y compatibilidad con el producto vía `fuel_vehicle_products`. Regresión PGlite nueva con las cuatro negativas y la comprobación de que un fallo no deja rastro.
- 2026-08-21: T11 implementada. `lib/combustibles/load-status.ts` fija el predicado contable (`registered` + `reconciled`) y lo consumen reportes, ciclo físico, Flota, panel de control, analítica, tendencias del dashboard y la creación de estados de cuenta —que antes arrastraba borradores y anuladas al cobro—. Los listados que administran cargas siguen mostrando los cuatro estados a propósito. La regresión PGlite comprueba que las tres superficies cierran el mismo mes con la misma cifra.
- 2026-08-21: T12 implementada. Editar exige `draft`/`registered` (antes sólo se bloqueaba `reconciled`, así que una carga anulada se podía editar de vuelta al circuito) y eliminar excluye `reconciled`. Los tres conjuntos viajan en el `WHERE` de la mutación además de comprobarse antes, y registrar exige `draft` en el propio `UPDATE`: dos clics ya no aplican la transición dos veces. Regresión PGlite sobre los cuatro caminos.
- 2026-08-21: T13 implementada. Un envío TAE registra a lo más un movimiento por (tipo, sello): índice único nuevo (migración 0201, que concilia el histórico conservando el movimiento más antiguo) y `onConflictDoNothing` simétrico en ambos inserts. Antes el retiro se insertaba siempre —revalidar duplicaba el movimiento— y la instalación se protegía con un SELECT previo que dos revisiones concurrentes atraviesan igual. Regresión: validar → observar → validar deja exactamente dos movimientos.
- 2026-08-21: T14 implementada. La severidad de la regla gobierna el caso: `severityOf` la lee del registro en los 8 detectores batch y en los 10 inline de TAE (los `select` inline ahora traen la columna), con el literal previo como valor por omisión. `carga_duplicada` se retiró del seed: se sembraba activa sin catálogo ni detector, así que la pantalla mostraba una regla viva que nunca abría un caso, y `exceso_cargas_ventana` ya cubre esa repetición. Regresión de paridad seed ↔ catálogo y de severidad efectiva.
- 2026-08-21: gates ejecutados sobre lo implementado hasta T14 (se levantó la pausa de pruebas para no acumular deuda): `npx tsc --noEmit` y `npm run lint -- --quiet` limpios; suite rápida 527 archivos / 4503 pruebas en verde; suite PGlite 72 archivos / 804 pruebas en verde. Se corrigieron 11 archivos de prueba que el propio trabajo dejó rojos —7 por el guard de módulo, que ahora consulta `system_settings` en cada verificación de permiso (mockean el toggle), y 4 heredados de T04— además de la aserción de reportes. Pendientes de Fase 4: E2E en base desechable y PostgreSQL real secuencial.
- 2026-08-21: T15 implementada. `civilDate`/`isCivilDate` (lib/validation/dates.ts) exigen un día que exista de verdad: la regex aceptaba 2026-02-31 y ese string llegaba crudo a `${fecha}::date`, tumbando la ficha completa del equipo —el lector además ahora salta la fila corrupta en vez de caerse—. Los metadatos documentales de Flota pasan por un esquema Zod compartido con taxonomía cerrada, validado en la acción **y** en el servicio (los valores son las etiquetas que la ficha ya venía escribiendo; no se migran a slugs para no dejar el histórico fuera de su propia taxonomía). El filtro de estado operativo de Bitácora usa el enum de la columna: los tres `inactivo_*` que ofrecía no existen en `fuel_vehicles.operational_status`, así que devolvían cero filas y se leían como "no hubo cargas". El rango por defecto del panel TAE usa `todayInChile()`. NO se hizo saneamiento de datos históricos de `maintenance_date` (no hay acceso a producción desde acá); la entrada quedó cerrada y la lectura tolerante.
- 2026-08-21: T09 implementada. El alta manual de cargas y los catálogos de Bitácora (puntos de carga, responsables de anomalías) se acotan por faena. El ledger de importaciones TAE dejó de publicar cifras del archivo completo: un rol acotado ve sólo lotes con cargas suyas, con válidas/observadas/litros recalculados sobre ellas, sin hash, sin totales del lote y sin filas rechazadas —que no tienen faena resoluble—; el reproceso sigue disponible sin publicar el tamaño del lote ajeno. Regresión PGlite nueva sobre el ledger.
- 2026-08-21: T16 implementada. `fleet_vehicle_documents` versiona `current`/`replaced` (`supersededAt`, `supersededBy` autorreferencial) con índice único parcial `(vehicleId, documentType) WHERE status='current'` — subir un documento nuevo reemplaza la versión vigente en vez de dejar dos vigentes o borrar el histórico. `resolveExpiryCandidates()` resuelve la vigencia canónica por tipo (la columna del vehículo prima sobre el documento cuando ambos existen). Migración 0202 concilia la pila histórica antes del índice único. Regresión PGlite sobre subir/reemplazar/borrar una versión.
- 2026-08-21: T17 implementada (CO-023 + un cuarto sitio no citado por la auditoría original). `MAX`/`MIN` sobre `fuelLoads.odometerReading/hourMeterReading` reemplazado por primera/última lectura CRONOLÓGICA real (`db.selectDistinctOn` ordenado asc/desc) en `getFleetOverview` (fleet.ts) y en el mismo agregado de `analytics-module/dashboard.ts` (`/analitica`, que tenía el mismo defecto sin estar en la auditoría — si sólo se arreglaba fleet.ts, `/analitica` seguía mostrando otra "última lectura" que `/flota`). `getFleetVehicleDetail` y `getUsageMaintenanceAlerts` (maintenance.ts) ganaron desempate por instante real (`fuelOperationOccurredAtSql()`, extraído a helper reusable en `fuel-log.ts`) más `createdAt`: dos cargas del mismo día ya no devuelven un ganador arbitrario. `getUsageMaintenanceAlerts` trata `usage < 0` como señal (`possibleMeterReset: true`, UI en /mantenciones y KPI del dashboard) en vez de descartar la fila en silencio. Detección de lectura regresiva (`kilometraje_regresivo`/`horometro_regresivo`) extendida más allá de TAE: nuevo detector batch en `anomaly-detector.ts` cubre `fuel_operation_records` y `fuel_loads` reusando el mismo `ruleCode` (el `referenceEntityType` distingue la fuente). Un caso de reset ya **resuelto/descartado** ahora corta la ventana de comparación: `getFleetOverview` excluye de "primera lectura" cualquier carga con un reset aceptado posterior (subquery `NOT EXISTS` correlacionada — interpolar una tabla con `alias()` de drizzle dentro de `sql\`\`` no emite el `AS` que la define, así que el alias va como texto plano) y `getUsageMaintenanceAlerts` omite la alerta cuando el reset aceptado es posterior a la última mantención. De paso: `lib/__tests__/anomaly-detection-integration.test.ts` instanciaba PGlite y migraba pero nunca estuvo en `tests/pglite-files.ts` (corría fuera de su gate, en el proyecto paralelo) — se registró. Regresión PGlite: desempate mismo-día-distinta-hora, reset abierto vs. aceptado (kmDriven cambia de 5.000 a 14.000 al resolver el caso), detector batch de ambas fuentes nuevas, y suite unitaria para `possibleMeterReset`/supresión tras reset aceptado.
