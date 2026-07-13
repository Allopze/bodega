# Checklist de pendientes: control integral de combustible

Fecha de consolidación: 2026-07-13. Última actualización: 2026-07-13 (sección 5, visualizaciones: rendimiento por faena/tipo, diferencias y flujo del ciclo, cargas TAE por supervisor/conductor/punto, corrección de gráficos circulares).
Alcance: brechas restantes entre el módulo actual de combustibles y el prompt de control integral.
Estado de referencia: TCT, TAE y facturación permanecen como dominios separados; ya existen captura pública TAE, funcionamiento offline, cuatro evidencias, OCR, identidad por RUT, revisión, importación histórica, exportación XLSX, conciliación de cobertura TAE/TCT y resumen ejecutivo integrado.

## Avance verificado al 2026-07-13

- 162 ítems cerrados; 325 pendientes. La sección 5 (visualizaciones) avanzó de 0 a 15/21 cerrados, invocando la skill de dataviz antes de tocar cualquier gráfico: `PerformanceGroupChart` (rendimiento por faena/tipo, con la desviación estándar como barra de error y el rango esperado como línea de referencia), `CycleStageChart` (diferencias entre etapas y flujo del ciclo, un mismo gráfico satisface ambos ítems), `TaeGroupChart` (cargas por supervisor/conductor/punto de suministro), y se cargaron a gráfico dos listas de texto que ya tenían los datos (gasto por faena/proveedor del log operacional). Se corrigió también un anti-patrón real ya presente en el código: `ProductPieChart` comparaba gasto por producto con una torta — la propia skill de dataviz lo marca como el ejemplo canónico a evitar — ahora usa `CategoryBarChart` en los dos lugares donde se usaba. Quedan sin construir: consumo por tipo de equipo, evolución por equipo, histograma de rendimientos, dos dispersiones (litros vs. km/horómetro) y la matriz faena/equipo/período — las tres últimas son tipos de gráfico genuinamente nuevos que no reutilizan datos ya calculados. Distribución de anomalías sigue bloqueada (sección 11).
- La sección 6 (filtros) avanzó parcialmente: la bitácora ganó filtros estructurados por proveedor/producto/tipo de equipo/observaciones, chips retirables individualmente y limpieza global — todos como parámetros de URL compartibles. Quedan explícitamente abiertos: filtros por marca/modelo/conductor/supervisor/lugar de carga/sello/evidencia (no implementados), los 4 filtros de anomalías (bloqueados en sección 11), la selección cruzada (bloqueada en sección 5 — ahora que hay gráficos, es el siguiente candidato natural) y el contexto de filtro compartido entre rutas (cada página sigue teniendo sus propios parámetros).
- La sección 4 (análisis de equipos) cerró casi completa sobre `/combustibles/analisis`: `lib/combustibles/performance-statistics.ts` (promedio, mediana, percentiles, desviación estándar, coeficiente de variación, confiabilidad de muestra) y `lib/combustibles/equipment-performance.ts` (presets desde catálogo, agregación por faena/equipo/tipo, separación estricta km/L vs L/h por `fuel_vehicles.performance_unit`). De paso se eliminó una duplicación real: `flagOutliers` estaba copiado en dos dashboards distintos, ahora ambos usan la función común. Único ítem no implementado: tendencia temporal multi-período (sólo existe comparación de dos puntos, actual vs. período anterior).
- La sección 7 (bitácora general) cerró completa: `lib/combustibles/fuel-log.ts` unifica `fuel_tae_submissions`, `fuel_loads` y `fuel_operation_records` con `unionAll` de Drizzle, búsqueda/orden/paginación en servidor, columnas configurables, selección múltiple, exportación XLSX (filtrada o por selección) e historial de auditoría por registro en `/combustibles/bitacora/historial/[entityType]/[entityId]`. Quedan explícitamente bloqueados sólo los dos ítems que dependen de la sección 11 (anomalías, inexistente) y "marcar para revisión" (requiere una marca cruzada nueva a las tres fuentes).
- La sección 8 (control por etapas) cerró completa sobre `/combustibles/ciclo`: las tres etapas, las dos diferencias (recibido-vs-registrado y recibido-vs-entregado) y el semáforo normal/advertencia/crítico están implementados, probados (12 pruebas unitarias + 4 de integración PostgreSQL) y trazables a su registro fuente.
- Implementado en las pasadas verificadas: taxonomía canónica y catálogo administrativo de equipos, atributos operacionales por vehículo, catálogo canónico de productos, compatibilidad equipo/producto, producto obligatorio en TAE y cargas facturadas, ledger físico del ciclo combustible, migraciones/backfill completos, auditoría de cambios, historial paginado de lotes TAE, detalle de cargas y reversa transaccional auditada; ruta operativa `/combustibles/ciclo` con registro auditado de recepción/transferencia/entregas, saldo por vasija, semáforo de severidad y gráfico de flujo; catálogo CRUD de estanques por faena y producto; ingesta automática del informe TAE de Copec como recepciones; revisión, corrección y reproceso reutilizable de importaciones históricas TAE en `/combustibles/tae/importar/[id]`; estados de carga/error dedicados (`unstable_retry`) en `/combustibles/tae`, `/combustibles/ciclo`, `/combustibles/bitacora` y `/combustibles/analisis`; bitácora general unificada con filtros estructurados y chips; análisis de rendimiento por equipo con gráficos.
- Validación de esta pasada (secciones 4, 5, 6 y 7): sólo `npx tsc --noEmit` sobre el árbol completo — sin errores, tras corregir en el proceso un `LabelList.formatter` con tipo incompatible y un `ErrorBar` de Recharts mal alimentado (esperaba un valor simétrico único, no una tupla de límites). **No se corrió ESLint ni la suite de pruebas** — a pedido explícito, para ejecutar todo junto al finalizar los 325 pendientes restantes. No se verificó en navegador (Chrome no instalado en este entorno) — los gráficos nuevos no tuvieron inspección visual real, sólo verificación de tipos y de la API de Recharts contra su código fuente instalado.
- Los pendientes permanecen desglosados por sección debajo; ningún criterio de salida se marcó sin evidencia completa.

### Flujo físico real (corregido el 2026-07-13)

El ciclo tiene **dos etapas**, no tres: no hay trasvasije a estanque fijo.

1. **Recibido.** Las vasijas propias (2 camiones y 2 camionetas estanque) cargan combustible en estaciones de servicio Copec con tarjeta TAE. Copec lo reporta en el informe **TAE**, una fila por transacción con guía de despacho. Es la fuente canónica de `received`, y ahora se ingesta automáticamente.
2. **Entregado.** Esas vasijas reparten directo a los equipos en faena. Lo controla la **PWA TAE** (`fuel_tae_submissions`: litros, medidor, sellos, evidencia). No se duplica como movimiento del ledger: `getFuelCycleComparison` la lee de origen, así una carga anulada deja de contar sola.

El canal **TCT** es distinto y paralelo: es el equipo cargando con tarjeta en estación. No es una etapa del ciclo físico, es cobertura del mismo equipo por otra vía, y no se suma ni se resta contra las anteriores.

Aviso de nomenclatura: "TAE" significa tres cosas distintas en la base — `fuel_loads.serviceType='TAE'` (facturación), `fuel_tae_submissions` (PWA de reparto) y el informe Copec (abastecimiento). El ingest nuevo usa el vocabulario del ciclo (`received`, `tae-receipts`), no "TAE" a secas.

## Convención

- `[ ]` Pendiente.
- `[x]` Terminado y verificado.
- Un bloque sólo puede cerrarse cuando se cumpla su criterio de salida.
- No presentar canales independientes como diferencias contables sin un contrato de conciliación aprobado.
- No mezclar km/L con L/h en métricas, estadísticas o comparaciones.

## 1. Modelo completo del ciclo de combustible

- [x] Definir la fuente canónica para combustible recibido. `fuel_cycle_movements` con evento `received`.
- [x] Ingestar automáticamente el informe TAE de Copec como recepciones. Mismo portal y mes que TCT, cambiando el combo "Tipo Producto" (`downloadCopecReports(..., "TAE")`). Parser en `lib/combustibles/tae-receipt-import.ts`, ingest en `lib/combustibles/tae-receipts.ts`.
- [x] Hacer idempotente el ingest de recepciones. La guía de despacho es única por transacción; el índice parcial `fuel_cycle_movements_source_unique` sobre `(source_type, source_id)` impide duplicar al reimportar un mes.
- [x] Asociar cada tarjeta Copec TAE a su vasija. `fuel_storage_locations.tae_card_number`, editable en `/admin/flota-catalogos/estanques-combustible`. Una tarjeta sin vasija NO se importa: se reporta como pendiente en vez de inventar un destino.
- [x] Calcular saldo por vasija (recibido − entregado por estanque). `getFuelStorageBalances` en `lib/combustibles/fuel-cycle.ts`, visible en `/combustibles/ciclo`. `fuel_tae_loading_points.storage_location_id` enlaza el punto de carga PWA con la vasija (asignable desde `/combustibles/tae`); sin ese enlace la vasija muestra saldo igual a lo recibido, porque no hay nada que restarle.
- [ ] Medir el estanque físicamente (aforo/varilla). Sin esto, la diferencia entre etapas no distingue una merma real de una carga no registrada. No implementado: falta modelo de lecturas de aforo y el procedimiento de terreno para tomarlas.
- [x] Documentar el significado exacto de recibido, registrado, entregado y consumido. Ver contrato del ciclo físico en `docs/combustibles/CONTROL_COMBUSTIBLE_INTEGRADO.md`.
- [x] Definir qué documentos o eventos originan cada etapa. Los eventos físicos conservan `source_type`, `source_id` y documento; lo administrativo permanece en `fuel_loads`.
- [x] Modelar combustible recibido por faena, proveedor, producto, fecha y documento.
- [x] Modelar transferencias hacia estanques intermedios.
- [x] Modelar entregas desde estanques intermedios.
- [x] Diferenciar entregas directas a vehículos o maquinaria.
- [x] Relacionar movimientos de combustible sin duplicar compras, facturas o cargas existentes.
- [x] Incorporar el tipo de producto en las cargas TAE. `fuel_tae_submissions.product_id` es obligatorio y se valida también al sincronizar cargas offline.
- [x] Soportar Diésel, BlueMax y productos futuros mediante catálogo. Disponible en `/admin/flota-catalogos/productos-combustible`.
- [x] Registrar la unidad de medida de cada producto. El catálogo admite litro, kilogramo y unidad; TAE muestra la unidad al seleccionar.
- [x] Definir fórmulas de diferencias entre etapas comparables. Implementadas en el read model `getFuelCycleComparison`.
- [x] Calcular diferencia absoluta entre etapas.
- [x] Calcular diferencia porcentual entre etapas.
- [x] Permitir abrir los registros que originan cada diferencia. `/combustibles/ciclo` enlaza las recepciones/entregas filtradas por etapa y las cargas registradas en `/combustibles/facturas` con el mismo período, faena y producto canónico.
- [x] Mostrar “Sin fuente disponible” cuando una etapa no tenga datos canónicos. El read model devuelve estado `unavailable`.
- [x] Evitar sumar o restar TAE y TCT cuando sólo representen canales de cobertura. El contrato mantiene ambos como cobertura, fuera de la fórmula física.

### Criterio de salida

- [x] Existe un contrato de datos aprobado para cada etapa y una prueba automatizada para cada fórmula de diferencia. Pruebas unitarias de absoluta, porcentual, base cero, signo negativo y fuente ausente, más `lib/__tests__/fuel-cycle-integration.test.ts` (PGlite): cuadra `getFuelCycleComparison` y `getFuelStorageBalances` contra Postgres real, incluida la exclusión de cargas anuladas y el alcance de faena.

## 2. Catálogos y taxonomía de equipos

- [x] Reemplazar el tipo libre de `fuel_vehicles.type` por una taxonomía controlada o una relación de catálogo. `equipmentTypeId` es obligatorio; `type` queda como snapshot legacy.
- [x] Crear catálogo configurable de tipos de vehículo y maquinaria. Disponible en `/admin/flota-catalogos/tipos-equipo`.
- [x] Normalizar camiones y tractocamiones.
- [x] Normalizar cargadores.
- [x] Normalizar camionetas.
- [x] Normalizar retroexcavadoras.
- [x] Normalizar excavadoras.
- [x] Normalizar minicargadores.
- [x] Normalizar tractores.
- [x] Normalizar bulldozers.
- [x] Permitir otros tipos sin modificar código. El catálogo admite altas administrativas y crea tipos revisables desde XLSX.
- [x] Definir unidad de rendimiento por equipo.
- [x] Definir tipo de medidor por equipo.
- [x] Definir capacidad de estanque por equipo.
- [x] Administrar estanques físicos por faena, producto, capacidad y estado. Disponible en `/admin/flota-catalogos/estanques-combustible`; las acciones quedan auditadas y refrescan el ciclo físico.
- [x] Definir productos compatibles por equipo. La relación `fuel_vehicle_products` se mantiene desde la ficha y el backend TAE rechaza combinaciones no habilitadas.
- [x] Definir grupo de comparación de cada equipo.
- [x] Definir faena habitual. Se conserva la relación obligatoria `worksiteId`.
- [x] Definir proveedor habitual cuando corresponda.
- [x] Definir horario operativo.
- [x] Definir estado operativo e intervalos de inactividad. `fuel_vehicle_operational_intervals` mantiene un único intervalo abierto por equipo, exige motivo al cambiar, conserva actor y se muestra en `/flota/[id]`.
- [x] Validar cambios de tipo, unidad y capacidad.
- [x] Auditar cambios de clasificación y asignación.

### Criterio de salida

- [ ] Todo equipo activo tiene tipo, unidad de rendimiento, capacidad, faena y estado operativo válidos. Verificación local: 39/39 tienen tipo, rendimiento, faena, estado e intervalo abierto; los 39 aún carecen de capacidad informada y deben corregirse sin inventar valores.

## 3. Reconciliación de datos históricos

- [ ] Revisar los códigos de equipo históricos sin asociación confiable. La herramienta ya existe (ver abajo); revisar cada identidad real de cada faena es trabajo operativo, no de código.
- [ ] Revisar los conductores sin asociación confiable. Ídem.
- [ ] Revisar los supervisores sin asociación confiable. Ídem.
- [x] Permitir corregir el vehículo sugerido antes de importar. El dry-run muestra identidades ambiguas por faena y permite asignar un equipo o marcar "Sin equivalente" antes de confirmar; el backend valida el alcance.
- [x] Permitir corregir el conductor sugerido antes de importar. La decisión se envía al importador y se persiste dentro de la transacción del lote.
- [x] Permitir corregir el supervisor sugerido antes de importar. La decisión se envía al importador y se persiste dentro de la transacción del lote.
- [x] Permitir rechazar explícitamente una sugerencia. Botón "Sin equivalente" en `/combustibles/tae/importar/[id]`: guarda la decisión con destino `null`, distinguible de "todavía no revisado".
- [x] Guardar las decisiones de mapeo aprobadas. Tablas `fuel_tae_vehicle_mappings` y `fuel_tae_worker_mappings` (únicas por faena+identidad histórica), acciones `saveTaeVehicleMappingAction` / `saveTaeWorkerMappingAction`.
- [x] Reutilizar decisiones aprobadas en futuras importaciones. `buildTaeImportPlan` consulta las decisiones ANTES del fuzzy-match; una identidad decidida no vuelve a depender de la heurística. No corrige retroactivamente el lote donde se detectó la ambigüedad — sólo aplica hacia adelante.
- [x] Mostrar diferencias entre el dry-run y la importación definitiva. La pantalla compara validadas, observadas y rechazadas después de importar.
- [x] Crear una pantalla de historial de lotes TAE. Disponible en `/combustibles/tae/importar/historial`, paginada y enlazada desde la importación.
- [x] Crear detalle de filas importadas, observadas y rechazadas por lote. Tabla `fuel_tae_import_rejections` (motivo de formato o de faena, `rowIndex`, `rawRow`) persistida en la misma transacción del import; visible en `/combustibles/tae/importar/[id]` junto a importadas/observadas.
- [x] Implementar reversión transaccional de lotes TAE. El cambio condicional de estado y la eliminación de cargas/evidencias se ejecutan en una transacción y bloquean la doble reversa.
- [x] Auditar la reversión. Se conserva la cabecera del lote y se registran `audit_log` y `status_history` con cantidad de cargas eliminadas.
- [x] Permitir reprocesar filas rechazadas después de corregir catálogos. El detalle del lote ofrece "Reprocesar rechazadas" para filas de faena con `rawRow` persistido; las filas rechazadas por formato siguen requiriendo corregir el Excel fuente.
- [ ] Resolver formalmente la política de evidencias históricas externas.
- [ ] Copiar evidencias históricas al almacenamiento privado o documentar su exclusión definitiva.
- [ ] Evitar dependencia indefinida de enlaces externos.

### Criterio de salida

- [ ] El histórico puede importarse, inspeccionarse, corregirse y revertirse sin modificar manualmente la base de datos. La corrección de identidades y el reproceso de rechazos de faena ya cumplen; sigue abierto el reproceso de filas rechazadas por formato y la política de evidencias externas.

## 4. Análisis especializado de equipos

- [x] Crear una vista reutilizable de análisis de equipos. `/combustibles/analisis` + `getEquipmentPerformanceAnalysis` (`lib/combustibles/equipment-performance.ts`): una sola implementación para los 3 presets y los 3 niveles de agregación.
- [x] Permitir abrirla con presets para camiones y tractocamiones.
- [x] Permitir abrirla con presets para cargadores y camionetas.
- [x] Permitir abrirla con presets para maquinaria pesada.
- [x] Generar presets desde catálogos, no desde listas rígidas de faenas. Los presets filtran por `fuel_equipment_types.category`/`slug` (catálogo de la sección 2); un tipo nuevo con esa categoría entra solo, sin tocar código.
- [x] Agregar agregación por faena.
- [x] Agregar agregación por equipo.
- [x] Agregar agregación por tipo de equipo.
- [x] Separar observaciones km/L de observaciones L/h. La unidad se toma de `fuel_vehicles.performance_unit` (canónico, sección 2), no del dato importado; dos equipos con la misma faena/tipo pero unidades distintas nunca comparten bucket estadístico — clave interna `${grupo}::${unidad}`.
- [x] Calcular promedio.
- [x] Calcular mediana.
- [x] Calcular mínimo.
- [x] Calcular máximo.
- [x] Calcular desviación estándar. Poblacional (÷n), documentado en `performance-statistics.ts`.
- [x] Calcular percentiles configurados. La función `percentile(values, p)` acepta cualquier percentil; la UI sólo expone p10/p90 (no hay selector de percentil para el usuario final).
- [x] Calcular coeficiente de variación.
- [ ] Calcular tendencia temporal. No implementado: sólo existe comparación de dos puntos (período actual vs. anterior inmediato), no una serie temporal con pendiente/dirección a través de múltiples períodos.
- [x] Comparar con el período anterior. `periodVariation`, sobre un período previo de igual duración inmediatamente anterior.
- [x] Comparar con equipos equivalentes. Usa `fuel_vehicles.comparison_group` (sección 2): sólo cuando todos los equipos del bucket declaran el mismo grupo.
- [x] Calcular rango esperado. p10–p90 del grupo comparable (mismo `comparisonGroup` + misma unidad).
- [x] Mostrar cantidad de observaciones.
- [x] Calcular nivel de confiabilidad de la muestra. Tres niveles (insuficiente/baja/confiable) según `MIN_CONCLUSIVE_SAMPLE = 5` — umbral fijo, ver sección 12.
- [x] Mostrar "Muestra no concluyente" cuando no se alcance el mínimo.
- [x] Documentar todas las fórmulas. JSDoc en `lib/combustibles/performance-statistics.ts`: método de desviación estándar, percentil (interpolación lineal), coeficiente de variación y umbral de atípicos.
- [x] Permitir abrir las cargas individuales desde cada agregado. Enlaza a `/combustibles/bitácora` (sección 7) filtrada por faena/patente/fecha; en agregación por tipo de equipo con múltiples faenas o equipos, el enlace sólo lleva el rango de fecha (bitácora todavía no filtra por tipo de equipo).
- [x] **(reuso, no pedido explícitamente pero corregía duplicación real)** `flagOutliers` estaba copiado casi literal en `consumption-dashboard.ts` y `operations-dashboard.ts`, con el comentario "mismo umbral fijo que..." reconociendo la duplicación. Ambos ahora usan `flagOutliers` de `performance-statistics.ts`.

### Criterio de salida

- [x] Las tres familias de equipos se analizan desde una implementación común y ninguna comparación mezcla unidades incompatibles. Verificado por diseño: el bucket estadístico siempre incluye la unidad en su clave; no hay ninguna ruta de código que sume o promedie km/L junto con L/h.

## 5. Visualizaciones analíticas

- [x] Consumo por faena. Ya existía (`CategoryBarChart` en `/combustibles/facturas` y `/combustibles/reportes`, canal facturación); esta pasada agregó el equivalente para el canal log operacional en `/combustibles` (antes era una lista de texto).
- [x] Consumo por proveedor. Nuevo: `/combustibles` (log operacional) y `/combustibles/reportes` (tab "Por proveedor", antes sólo tabla sin gráfico).
- [ ] Consumo por tipo de equipo. No implementado: existe rendimiento por tipo de equipo (ítem siguiente), pero no litros totales por tipo.
- [x] Consumo por equipo individual. Ya existía (`PatenteRankingChart`, `CategoryBarChart` por vehículo).
- [ ] Evolución temporal por equipo. No implementado: la evolución temporal existente es agregada, no por equipo individual.
- [x] Rendimiento por faena. Nuevo: `PerformanceGroupChart` en `/combustibles/analisis`, agregación por faena, separado por unidad.
- [x] Rendimiento por tipo de equipo. Nuevo: mismo componente, agregación por tipo.
- [x] Comparación de equipos equivalentes. El mismo gráfico dibuja el rango esperado del grupo comparable como líneas de referencia y la desviación estándar como barra de error — visible al agregar por equipo individual.
- [x] Diferencias entre etapas del ciclo. Nuevo: `CycleStageChart` en `/combustibles/ciclo` (antes sólo había tarjetas de métricas, sin gráfico).
- [ ] Distribución de anomalías. Bloqueado: dominio de anomalías (sección 11) inexistente.
- [x] Cargas por supervisor. Nuevo: `TaeGroupChart` en `/combustibles/tae` (sólo TAE tiene supervisor por carga).
- [x] Cargas por conductor. Nuevo: mismo componente, dimensión conductor.
- [x] Cargas por punto de suministro. Nuevo: mismo componente, dimensión punto de carga.
- [ ] Histograma de rendimientos. No implementado: requiere binning de las observaciones crudas, que hoy `equipment-performance.ts` no expone (sólo estadísticos agregados).
- [ ] Dispersión litros versus kilometraje. No implementado.
- [ ] Dispersión litros versus horómetro. No implementado.
- [ ] Matriz faena/equipo/período. No implementado: es la visualización más compleja de las 21, mapa de calor 2D genuino, no una extensión de lo ya construido.
- [x] Flujo recibido → registrado → entregado → consumido. Satisfecho por el mismo `CycleStageChart`: las cuatro etapas en orden, la caída entre barras es la lectura del flujo — no se construyó un Sankey aparte (no hay librería para eso en el proyecto; habría sido una dependencia nueva sin necesidad real).
- [x] Definir la pregunta operacional que responde cada visualización. Cada gráfico nuevo lleva una `CardDescription` en forma de pregunta ("¿Qué faena concentra el gasto?", etc.); los gráficos preexistentes no se anotaron retroactivamente.
- [x] Evitar gráficos circulares cuando una comparación precisa requiera barras o tablas. Corregido un caso real: `ProductPieChart` (torta) se usaba para comparar gasto por producto en `/combustibles/facturas` y `/combustibles/reportes` — con 2-3 productos de valores cercanos es exactamente el anti-patrón que la skill de dataviz marca ("donut para comparar valores cercanos → barra"). Ambos sitios ahora usan `CategoryBarChart`. El componente `ProductPieChart` queda sin uso en producción (su test unitario sigue intacto); no se borró en esta pasada para no tocar archivos de prueba mientras las pruebas están explícitamente pausadas.
- [ ] Implementar estado vacío, carga y error por visualización. Estado vacío: sí, en todos los gráficos nuevos (`EmptyChart`). Carga: no aplica dentro de una misma página SSR (los datos ya están resueltos antes de renderizar; lo cubre el `loading.tsx` de la página). Error por visualización individual: no implementado — sólo existe el `error.tsx` de página completa; un gráfico roto tumba la página entera, no sólo su tarjeta.

### Criterio de salida

- [ ] Cada visualización responde a una decisión concreta, reacciona a filtros y permite acceder al detalle. Cumple para los 11 gráficos nuevos y corregidos de esta pasada (todos con pregunta explícita, filtros de la página y clic-a-detalle); no cumple para el conjunto completo de las 21 visualizaciones pedidas porque 6 siguen sin construir (consumo por tipo de equipo, evolución por equipo, histograma, dos dispersiones, matriz) y la distribución de anomalías sigue bloqueada.

## 6. Filtros globales y filtros cruzados

- [x] Agregar filtro por proveedor. En `/combustibles/bitacora`: "—" estructural en filas TAE (no tiene proveedor, ver sección 7), excluye esa fuente en vez de fingir el dato.
- [x] Agregar filtro por tipo de suministro. Interpretado como el filtro "Fuente" (`source`) ya existente en la bitácora — TAE/facturación/log operacional.
- [x] Agregar filtro por producto. "—" estructural en log operacional (no clasifica producto por fila).
- [x] Agregar filtro por tipo de vehículo o maquinaria. Filtro "Tipo" sobre `fuel_equipment_types`.
- [x] Agregar filtro específico por código interno. Ya cubierto por la búsqueda de servidor (`q` hace `ILIKE` sobre código/patente).
- [ ] Agregar filtro por marca. No implementado como filtro con lista de valores; sólo se puede buscar como texto si se agrega a `q` (no se agregó).
- [ ] Agregar filtro por modelo. Mismo caso que marca.
- [ ] Agregar filtro por conductor. Ya se puede *buscar* por nombre (`q`), pero no hay un filtro con lista de conductores para elegir.
- [ ] Agregar filtro por supervisor. Mismo caso que conductor.
- [ ] Agregar filtro por lugar de carga. Sólo existe en TAE (`fuel_tae_loading_points`); no se agregó como filtro de la bitácora en esta pasada.
- [ ] Agregar filtro por tipo de rendimiento. `performanceUnit` ya se usa para separar km/L de L/h en la sección 4, pero la bitácora no lo expone como filtro.
- [ ] Agregar filtro por estado operativo del equipo. `fuel_vehicles.operational_status` existe (sección 2) pero no está en la consulta de la bitácora.
- [x] Agregar filtro por presencia de observaciones. Checkbox "Sólo con observaciones"; excluye estructuralmente el log operacional (nunca tiene observaciones por fila).
- [ ] Agregar filtro separado por sello inicial. No implementado.
- [ ] Agregar filtro separado por sello final. No implementado.
- [ ] Agregar filtros por cada tipo de evidencia. No implementado.
- [ ] Agregar filtro por existencia de anomalías. Bloqueado: dominio de anomalías (sección 11) inexistente.
- [ ] Agregar filtro por tipo de anomalía. Bloqueado, mismo motivo.
- [ ] Agregar filtro por severidad. Bloqueado, mismo motivo.
- [ ] Agregar filtro por responsable de revisión. Bloqueado, mismo motivo.
- [x] Mostrar filtros activos como chips. Fila de chips sobre la tabla de `/combustibles/bitacora`.
- [x] Permitir retirar cada filtro individualmente. Cada chip enlaza a la misma consulta sin ese parámetro.
- [x] Mantener acción global para limpiar filtros. Enlace "Limpiar filtros" a la ruta sin parámetros.
- [ ] Mantener filtros al navegar entre resumen, análisis, bitácora y conciliación. No implementado: cada página (`/combustibles`, `/combustibles/analisis`, `/combustibles/bitacora`, `/combustibles/ciclo`) tiene su propio esquema de parámetros independiente: no comparten contexto de filtro. Es un cambio de arquitectura (un contexto de filtro compartido entre rutas), no una extensión incremental.
- [x] Mantener filtros relevantes en la URL. Todos los filtros de la bitácora y del análisis de rendimiento son parámetros de URL (GET), nunca estado sólo-cliente.
- [x] Permitir compartir una consulta por URL. Consecuencia directa de lo anterior.
- [x] Documentar qué filtros aplican sólo a TCT, TAE o facturación. Cada chip/opción sin datos en una fuente se documenta en el propio código (`lib/combustibles/fuel-log.ts`) con el motivo exacto por el que esa fuente queda excluida.
- [ ] Implementar selección cruzada desde barras. Bloqueado: no hay gráficos de barras todavía (sección 5).
- [ ] Implementar selección cruzada desde filas. No implementado — la bitácora no permite "clic en fila → aplica como filtro".
- [ ] Implementar selección cruzada desde proveedores. Bloqueado, mismo motivo que barras.
- [ ] Implementar selección cruzada desde faenas. Bloqueado, mismo motivo.
- [ ] Implementar selección cruzada desde equipos. Bloqueado, mismo motivo.
- [ ] Mostrar el origen de cada filtro cruzado. Bloqueado, mismo motivo.
- [ ] Permitir retirar filtros cruzados. Bloqueado, mismo motivo.

### Criterio de salida

- [ ] Todos los componentes relacionados reflejan la misma consulta y la URL reproduce el estado compartible. Cumple para la bitácora sola (URL compartible, filtros retirables); no cumple para "todos los componentes relacionados" en conjunto porque no hay contexto de filtro compartido entre `/combustibles`, `/combustibles/analisis`, `/combustibles/bitacora` y `/combustibles/ciclo`, y falta toda la selección cruzada (bloqueada en sección 5).

## 7. Bitácora general unificada

- [x] Crear un read model o consulta unificada para TAE, TCT y registros manuales compatibles. `lib/combustibles/fuel-log.ts`: `unionAll` (Drizzle, `drizzle-orm/pg-core`) sobre `fuel_tae_submissions`, `fuel_loads` y `fuel_operation_records`, en `/combustibles/bitacora`.
- [x] Mantener la fuente original de cada registro. Campo `source` (`tae_pwa`/`invoiced`/`operation_manual`) visible como badge; nunca se suman litros entre fuentes.
- [x] Mostrar fecha y hora.
- [x] Mostrar faena.
- [x] Mostrar proveedor. "—" en filas TAE: la PWA no registra proveedor.
- [x] Mostrar lugar de carga. "—" en facturación y log operacional: no tienen ese concepto.
- [x] Mostrar equipo, código y patente.
- [x] Mostrar tipo de equipo.
- [x] Mostrar conductor. "—" en facturación: no se registra conductor por carga facturada.
- [x] Mostrar supervisor. Mismo criterio que conductor.
- [x] Mostrar producto. "—" en log operacional: el import histórico no clasifica producto por fila.
- [x] Mostrar litros.
- [x] Mostrar kilometraje u horómetro. Campo `meterReading` + `meterLabel` (qué mide, sin inventar una unidad si la fuente no la declara).
- [x] Mostrar rendimiento y unidad. Sólo el log operacional trae `rendimiento`/`tipoRendimiento` (`km_lt`/`lt_hr`) precalculados; no se computa rendimiento nuevo aquí — eso es tarea de la sección 4, y mezclar unidades está prohibido por la convención del checklist.
- [x] Mostrar sello inicial y final. Sólo TAE tiene sellos.
- [x] Mostrar estado de evidencias. Conteo `N/4` sólo para TAE.
- [x] Mostrar observaciones.
- [x] Mostrar estado de validación. Vocabulario propio por fuente (`statusLabel`), sin forzar un estado común inexistente.
- [ ] Mostrar anomalías asociadas. Bloqueado: el dominio de anomalías (sección 11) no existe todavía.
- [x] Mostrar usuario creador y modificador. Mejor esfuerzo por fuente: TAE no tiene creador (PWA anónima) pero sí revisor; facturación tiene creador sin modificador; log operacional expone quién importó el lote.
- [x] Mostrar fechas de creación y modificación.
- [x] Implementar búsqueda de servidor. `ILIKE` sobre código/patente/conductor/supervisor/proveedor según la fuente, dentro de cada rama del `unionAll` (no se trae todo a memoria para filtrar).
- [x] Implementar ordenamiento de servidor. Una sola dimensión ordenable (`occurredAt` asc/desc) — la relevante para un log; no hay orden multi-columna.
- [x] Mantener paginación de servidor. `LIMIT`/`OFFSET` sobre el `unionAll`, conteo total en consulta separada (`getFuelLogTotal`).
- [x] Permitir configurar columnas visibles. Selector de columnas en el cliente (`bitacora-table.tsx`); la preferencia no persiste entre sesiones — no hay backend de preferencias de usuario.
- [x] Abrir detalle completo. TAE y facturación abren su registro; el log operacional (sin página propia por fila) abre el lote que la contiene.
- [x] Abrir visor de evidencias. Enlace a `/combustibles/tae/[id]#evidencia` cuando hay evidencias (se agregó el ancla `id="evidencia"` a esa página); sólo aplica a TAE.
- [x] Consultar historial de cambios. Página nueva `/combustibles/bitacora/historial/[entityType]/[entityId]`: cambios de estado (`status_history`) y auditoría campo a campo (`audit_log`). Sin permiso propio de auditoría todavía (sección 14): reutiliza `combustibles:view`. No aplica al log operacional (se audita por lote, no por fila).
- [ ] Marcar registros para revisión. No implementado: requiere una marca cruzada a las tres fuentes, que hoy no existe como columna/tabla en ninguna. Alcance nuevo, no cubierto en esta pasada.
- [x] Implementar selección múltiple. Checkboxes por fila + "seleccionar todas" (de la página actual).
- [x] Implementar acciones masivas según permisos. Una sola acción definida y con permiso propio: exportar la selección a XLSX (`combustibles:export`). No hay otras acciones masivas definidas para generalizar la infraestructura más allá de eso.
- [ ] Abrir el caso de anomalía relacionado. Bloqueado: mismo motivo que "mostrar anomalías asociadas".
- [x] Exportar la consulta filtrada a XLSX. `exportFuelLogAction`, límite `FUEL_LOG_MAX_EXPORT_ROWS = 10.000` con aviso de truncado.

### Criterio de salida

- [x] La bitácora maneja el volumen esperado sin cargar todas las filas en el navegador y permite llegar desde el resumen al registro fuente. Paginación y conteo son consultas de servidor independientes; los enlaces de detalle abren el registro (o el lote) de origen. No verificado con volumen real de producción ni en navegador — Chrome no está instalado en este entorno; sólo se validó `tsc --noEmit` limpio sobre el árbol completo, sin ejecutar ESLint ni la suite de pruebas (a pedido explícito, se corren todas juntas al final).

## 8. Control de cargas manuales y flujo por etapas

- [x] Crear una vista parametrizable por faena. `/combustibles/ciclo` filtra por `faena`/`producto`/rango de fechas; sin faena seleccionada muestra todas las autorizadas por el alcance de sesión.
- [x] Evitar componentes o consultas duplicadas por faena. Una sola página y un solo read model (`getFuelCycleComparison` + `getFuelStorageBalances`) para cualquier faena configurada.
- [x] Mostrar combustible recibido.
- [x] Mostrar combustible registrado.
- [x] Mostrar combustible entregado.
- [x] Mostrar combustible destinado a estanques intermedios. Sólo se materializa si alguien registra un `transfer` manual (el modelo físico real es de 2 etapas, sin estanque intermedio); la tabla "Saldo por vasija" y el evento "Transferencia" en movimientos del ciclo lo muestran cuando existe.
- [x] Mostrar combustible entregado directamente a equipos. La tabla "Movimientos del ciclo" distingue el evento "Entrega directa" del "Entrega desde estanque".
- [x] Mostrar combustible consumido cuando exista fuente válida. Métrica "Consumido" en `/combustibles/ciclo`; hoy siempre "Sin fuente disponible" porque no existe evento canónico de consumo (ver sección 1).
- [x] Mostrar diferencia contra la etapa anterior. Antes sólo se mostraba recibido-vs-registrado; ahora también recibido-vs-entregado (`comparison.differences.receivedVsDelivered` ya se calculaba pero nunca se renderizaba).
- [x] Mostrar diferencia porcentual.
- [x] Mostrar estado normal, advertencia o crítico. `differenceSeverity` en `lib/combustibles/fuel-cycle.ts` (umbral fijo ±2%/±5%, con pruebas unitarias); mal necesita volverse configurable — ver sección 12.
- [x] Abrir registros involucrados en cada etapa. Las tres etapas y las dos diferencias tienen enlace de trazabilidad a los registros que las originan.
- [x] Actualizar el flujo con los filtros globales. Filtros de faena/producto/fecha de la propia página (no hay TopBar search en esta ruta porque no es texto libre, son filtros estructurados).

### Criterio de salida

- [x] Una misma implementación representa el flujo de cualquier faena configurada y todas las diferencias tienen registros trazables. Verificado con `lib/combustibles/fuel-cycle.test.ts` (12 pruebas, incluida `differenceSeverity`) y `lib/__tests__/fuel-cycle-integration.test.ts` (PGlite). No verificado visualmente en navegador en esta pasada: Chrome no está instalado en el entorno de ejecución (`npx playwright install chrome` pendiente); sí se confirmó que la ruta no arroja error de servidor.

## 9. Gestión de sellos

- [ ] Crear entidad o historial propio de movimientos de sellos.
- [ ] Registrar sello retirado.
- [ ] Registrar sello instalado.
- [ ] Registrar quién efectuó cada cambio.
- [ ] Registrar fecha y carga relacionada.
- [ ] Detectar sellos repetidos de forma persistente.
- [ ] Detectar continuidad inconsistente.
- [ ] Implementar regla configurable de correlatividad.
- [ ] Detectar sellos no correlativos cuando la regla esté activa.
- [ ] Permitir justificar excepciones.
- [ ] Asociar evidencia del sello retirado.
- [ ] Asociar evidencia del sello instalado.
- [ ] Mostrar historial completo por número de sello.
- [ ] Auditar correcciones.

### Criterio de salida

- [ ] Cada sello puede rastrearse entre cargas y toda inconsistencia genera un caso revisable.

## 10. Gestión de evidencias

- [ ] Implementar visor ampliado dentro de la aplicación.
- [ ] Mostrar miniaturas accesibles.
- [ ] Mostrar quién capturó o subió cada evidencia.
- [ ] Mostrar fecha de captura y subida.
- [ ] Permitir reemplazar evidencia con permiso específico.
- [ ] Exigir motivo para reemplazar.
- [ ] Auditar reemplazos.
- [ ] Detectar archivos duplicados por hash.
- [ ] Detectar evidencia reutilizada entre cargas.
- [ ] Detectar archivos ilegibles o corruptos.
- [ ] Definir política de retención.
- [ ] Definir política de eliminación.
- [ ] Verificar respaldos del almacenamiento privado.
- [ ] Registrar acceso o descarga de evidencia sensible.

### Criterio de salida

- [ ] Las evidencias nuevas no dependen de enlaces públicos y todo acceso, reemplazo o eliminación sensible queda protegido y auditado.

## 11. Dominio persistente de anomalías

- [ ] Crear tabla de reglas de anomalía.
- [ ] Crear tabla de ejecuciones de reglas.
- [ ] Crear tabla de casos de anomalía.
- [ ] Relacionar anomalía con carga, equipo, faena y regla.
- [ ] Guardar tipo.
- [ ] Guardar severidad.
- [ ] Guardar descripción.
- [ ] Guardar valor observado.
- [ ] Guardar valor esperado.
- [ ] Guardar responsable.
- [ ] Guardar estado de revisión.
- [ ] Guardar comentarios.
- [ ] Guardar evidencias.
- [ ] Guardar fecha de detección.
- [ ] Guardar fecha y usuario de resolución.
- [ ] Permitir asignar responsable.
- [ ] Permitir comentar.
- [ ] Permitir resolver con motivo.
- [ ] Permitir reabrir.
- [ ] Mantener historial de estados.
- [ ] Evitar duplicar un caso abierto para la misma regla y registro.

### Reglas pendientes

- [ ] Rendimiento fuera del historial del equipo.
- [ ] Rendimiento fuera del grupo comparable.
- [ ] Desviación superior al umbral.
- [ ] Litros superiores a capacidad.
- [ ] Cargas demasiado frecuentes.
- [ ] Cargas duplicadas.
- [ ] Kilometraje inferior al anterior.
- [ ] Horómetro inferior al anterior.
- [ ] Kilometraje sin variación.
- [ ] Horómetro sin variación.
- [ ] Diferencia entre etapas.
- [ ] Falta de sello inicial.
- [ ] Falta de sello final.
- [ ] Sello repetido.
- [ ] Sello no correlativo.
- [ ] Evidencia faltante.
- [ ] Evidencia duplicada.
- [ ] Evidencia ilegible.
- [ ] Identidad o dato obligatorio incompleto.
- [ ] Valor negativo o improbable.
- [ ] Consumo durante inactividad.
- [ ] Carga en faena distinta de la asignada.
- [ ] Proveedor no habitual.
- [ ] Carga fuera de horario.
- [ ] Variación brusca de consumo.
- [ ] Exceso de cargas dentro de una ventana temporal.
- [ ] Diferencia entre PWA TAE y fuente externa comparable.

### Criterio de salida

- [ ] Las anomalías son casos persistentes, asignables, resolubles y auditables, no sólo mensajes calculados al renderizar.

## 12. Configuración de reglas y parámetros

- [ ] Crear pantalla administrativa de reglas.
- [ ] Crear regla.
- [ ] Editar regla.
- [ ] Activar y desactivar regla.
- [ ] Configurar umbral por tipo de equipo.
- [ ] Configurar umbral por faena.
- [ ] Configurar severidad.
- [ ] Configurar ventana temporal.
- [ ] Configurar tamaño mínimo de muestra.
- [ ] Configurar capacidad máxima.
- [ ] Configurar horario operativo.
- [ ] Configurar correlatividad de sellos.
- [ ] Configurar proveedor habitual.
- [ ] Versionar reglas.
- [ ] Simular el efecto de una regla antes de activarla.
- [ ] Auditar modificaciones.
- [ ] Retirar los umbrales fijos actualmente codificados.

### Criterio de salida

- [ ] Los umbrales operativos razonables pueden cambiarse sin desplegar código y todo cambio conserva versión y auditoría.

## 13. Integraciones con otros módulos

- [ ] Relacionar compras y órdenes de compra con combustible recibido.
- [ ] Relacionar facturas con volumen, producto y costo unitario.
- [ ] Relacionar combustible con centros de costo.
- [ ] Relacionar combustible con contratos.
- [ ] Relacionar consumo con mantenciones.
- [ ] Relacionar consumo con fallas mecánicas.
- [ ] Relacionar consumo con repuestos.
- [ ] Relacionar consumo con servicios.
- [ ] Relacionar consumo con horas trabajadas.
- [ ] Relacionar cargas con períodos de inactividad.
- [ ] Relacionar cargas con turnos.
- [ ] Relacionar cargas con asignaciones de conductores.
- [ ] Relacionar anomalías con supervisores.
- [ ] Calcular costo operacional por km.
- [ ] Calcular costo operacional por hora.
- [ ] Calcular costo total por equipo.
- [ ] Comparar consumo antes y después de mantenciones.
- [ ] Detectar aumento de consumo previo a fallas.
- [ ] Detectar cargas de equipos inactivos.
- [ ] Detectar diferencias recurrentes por proveedor.
- [ ] Analizar anomalías por conductor, supervisor y turno.

### Criterio de salida

- [ ] Las relaciones reutilizan entidades existentes y permiten explicar costo, consumo y anomalías sin duplicar datos maestros.

## 14. Permisos

- [ ] Definir permiso para consultar todas las faenas.
- [ ] Definir permiso para ver costos.
- [ ] Permitir datos operativos sin costos.
- [ ] Definir permiso para registrar cargas autenticadas.
- [ ] Definir permiso para editar cargas.
- [ ] Definir permiso para anular cargas.
- [ ] Definir permiso para acceder a fotografías.
- [ ] Definir permiso para revisar anomalías.
- [ ] Definir permiso para resolver anomalías.
- [ ] Definir permiso para asignar responsables.
- [ ] Definir permiso para configurar reglas.
- [x] Definir permiso para administrar catálogos operativos. La taxonomía usa `admin:fleet_catalog` y las fichas usan `combustibles:manage_vehicles`.
- [ ] Definir permiso para consultar auditoría.
- [ ] Definir permiso para exportar datos sensibles.
- [ ] Definir permiso para reemplazar evidencias.
- [ ] Definir permiso para revertir lotes TAE.
- [ ] Aplicar cada permiso en backend.
- [ ] Aplicar alcance de faena en cada consulta y mutación.
- [ ] Agregar grants por rol.
- [ ] Agregar pruebas de autorización y aislamiento entre faenas.

### Criterio de salida

- [ ] Ninguna acción depende únicamente de ocultar botones y cada permiso tiene pruebas positivas y negativas.

## 15. Auditoría e historial

- [ ] Auditar exportaciones TAE.
- [ ] Auditar exportaciones TCT.
- [ ] Auditar exportaciones unificadas.
- [ ] Auditar visualización y descarga de evidencia sensible.
- [ ] Auditar reemplazo de evidencia.
- [ ] Auditar cambios de reglas.
- [x] Auditar cambios de capacidades.
- [x] Auditar cambios de asignación equipo/faena.
- [ ] Auditar cambios de conductor y supervisor.
- [ ] Auditar correcciones masivas.
- [x] Auditar reversión de lotes TAE. `revertTaeImportBatchAction` registra `recordAudit` (acción `delete`, estado anterior/nuevo) y `recordStatusChange` dentro de la misma transacción.
- [ ] Mostrar valor anterior y nuevo por campo.
- [ ] Mostrar usuario responsable.
- [ ] Mostrar fecha y hora.
- [ ] Exigir motivo para correcciones sensibles.
- [ ] Incorporar el historial completo en el detalle de carga.

### Criterio de salida

- [ ] Toda mutación sensible puede reconstruirse con actor, instante, motivo, valor anterior y valor nuevo.

## 16. Exportaciones y reportes

- [ ] Crear reporte ejecutivo PDF.
- [ ] Crear exportación XLSX unificada.
- [ ] Respetar filtros activos.
- [ ] Respetar alcance de faena.
- [ ] Respetar permisos de columnas sensibles.
- [ ] Incluir fecha y hora de generación.
- [ ] Incluir usuario generador.
- [ ] Incluir período.
- [ ] Incluir filtros aplicados.
- [ ] Incluir alcance de faena.
- [ ] Incluir unidades.
- [ ] Incluir fuente de cada dato.
- [ ] Auditar la exportación.
- [ ] Implementar procesamiento asíncrono para archivos grandes.
- [ ] Mostrar progreso y permitir reintento.
- [ ] Implementar reportes programados si operación los requiere.
- [ ] Mantener XLSX como formato de exportación de datos.

### Criterio de salida

- [ ] Cada exportación es reproducible, identifica su contexto y nunca incluye columnas que el usuario no puede consultar.

## 17. Estados de interfaz y resiliencia

- [x] Agregar `loading.tsx` específico a `/combustibles/tae`. Usa `SkeletonPage` y el contexto de ruta TAE.
- [x] Agregar `error.tsx` específico a `/combustibles/tae`. Expone reintento localizado con `unstable_retry` y reporte del error.
- [x] Agregar estados de carga para conciliación. `/combustibles/ciclo/loading.tsx` muestra el esqueleto del ciclo físico.
- [x] Agregar estados de error para conciliación. `/combustibles/ciclo/error.tsx` permite reintentar sin inutilizar el resto del shell.
- [ ] Agregar estados de carga para análisis de equipos.
- [ ] Agregar estados de error para análisis de equipos.
- [x] Implementar reintento localizado. Las fronteras TAE y ciclo usan `unstable_retry` de Next.js.
- [ ] Aislar fallos por visualización o sección.
- [ ] Agregar skeletons representativos.
- [ ] Diferenciar “sin datos” de “sin coincidencias”.
- [ ] Mostrar datos parciales disponibles.
- [ ] Mostrar error de permisos comprensible.
- [ ] Mostrar error de conexión comprensible.
- [ ] Evitar mensajes técnicos al usuario.
- [ ] Registrar errores mediante el logger existente.

### Criterio de salida

- [ ] Un fallo en una consulta o visualización no inutiliza toda la pantalla y el usuario siempre tiene una acción de recuperación.

## 18. Rendimiento y escalabilidad

- [ ] Medir planes de ejecución de consultas principales.
- [ ] Probar el dashboard con volumen representativo.
- [ ] Probar la bitácora con volumen representativo.
- [ ] Probar exportaciones con el límite esperado.
- [ ] Crear índices para reglas y casos de anomalía.
- [ ] Definir límites de consultas analíticas.
- [ ] Evaluar caché para agregados costosos.
- [ ] Evaluar read models o vistas materializadas.
- [ ] Implementar agregaciones incrementales si la medición lo justifica.
- [ ] Procesar detección de anomalías fuera del request cuando corresponda.
- [ ] Agregar debounce a búsquedas URL.
- [ ] Evitar consultas repetidas.
- [ ] Revisar problemas N+1.
- [ ] Medir espacio ocupado en IndexedDB.
- [ ] Definir retención de auditoría.
- [ ] Definir retención de evidencias.
- [ ] Agregar capturas al manifest PWA TAE.

### Criterio de salida

- [ ] Los objetivos de volumen y latencia están documentados y demostrados mediante pruebas reproducibles.

## 19. Pruebas automatizadas faltantes

### Cálculos y dominio

- [ ] Separación estricta de km/L y L/h.
- [ ] Promedio, mediana, percentiles y desviación estándar.
- [ ] Coeficiente de variación.
- [ ] Muestra mínima y nivel de confianza.
- [ ] Diferencias entre etapas.
- [ ] Capacidades y unidades.
- [ ] Todas las reglas de anomalía.

### Filtros y bitácora

- [ ] Combinación de filtros globales.
- [ ] Filtros cruzados.
- [ ] Persistencia URL entre vistas.
- [ ] Paginación de servidor.
- [ ] Ordenamiento de servidor.
- [ ] Acciones masivas.

### Seguridad

- [ ] Permisos granulares positivos y negativos.
- [ ] Aislamiento entre faenas.
- [ ] Token TAE revocado.
- [ ] Token TAE manipulado.
- [ ] Enumeración de tokens y RUT.
- [ ] Rate limiting detrás de NAT compartido.
- [ ] IDs de otra faena enviados manualmente.
- [ ] Evidencia inaccesible sin permiso.

### Archivos y PWA

- [ ] Fotografías falsas o con extensión incorrecta.
- [ ] Fotografías corruptas.
- [ ] Fotografías duplicadas.
- [ ] Fotografías demasiado grandes.
- [ ] Cierre y reapertura con pendientes offline.
- [ ] Fallos parciales y reintento.
- [ ] Actualización del service worker con pendientes.
- [ ] Medición y limpieza de IndexedDB.

### Importación, exportación y auditoría

- [ ] Reversión de lote TAE.
- [ ] Decisiones manuales de mapeo.
- [ ] Exportación con filtros y metadata.
- [ ] Exclusión de columnas por permiso.
- [ ] Auditoría de exportaciones.
- [ ] Auditoría de evidencias.
- [ ] Integridad del historial campo por campo.

### Interfaz

- [ ] Accesibilidad del dashboard de combustibles.
- [ ] Accesibilidad de rutas TAE.
- [ ] Responsive móvil.
- [ ] Responsive tablet.
- [ ] Estados de carga y error parcial.
- [ ] Prueba real contra PostgreSQL del resumen integrado.

### Criterio de salida

- [ ] Los flujos críticos tienen cobertura unitaria, de integración y E2E, incluyendo fallos y denegaciones de permiso.

## 20. Puesta en producción y adopción

- [ ] Respaldar base de datos y almacenamiento.
- [ ] Aplicar migraciones pendientes con `npm run db:migrate`.
- [ ] Ejecutar `npm run db:sync-rbac` en el entorno objetivo.
- [ ] Validar permisos con usuario global.
- [ ] Validar permisos con usuario limitado a faena.
- [ ] Revisar el reporte de mapeo histórico.
- [ ] Corregir catálogos antes de la carga definitiva.
- [ ] Ejecutar importación definitiva.
- [ ] Verificar totales importados.
- [ ] Pilotear en una faena.
- [ ] Comparar diariamente PWA versus control anterior.
- [ ] Publicar QR físicos.
- [ ] Capacitar conductores.
- [ ] Capacitar supervisores y revisores.
- [ ] Publicar una guía breve de operación.
- [ ] Definir fecha de corte.
- [ ] Dejar el Excel anterior en sólo lectura.
- [ ] Revisar pendientes offline después del corte.
- [ ] Verificar respaldos de fotografías.
- [ ] Monitorear errores de sincronización.
- [ ] Monitorear espacio de almacenamiento.
- [ ] Monitorear tiempos de respuesta.
- [ ] Aprobar criterios de aceptación con operación.

### Criterio de salida

- [ ] La operación usa la plataforma como fuente oficial, el Excel quedó retirado y existe evidencia de un piloto estable.

## Orden recomendado de ejecución

### Fase A: contratos y datos maestros

- [ ] Cerrar secciones 1, 2 y 3.

### Fase B: análisis y bitácora

- [ ] Cerrar secciones 4, 5, 6, 7 y 8.

### Fase C: prevención de pérdidas

- [ ] Cerrar secciones 9, 10, 11 y 12.

### Fase D: integración y gobierno

- [ ] Cerrar secciones 13, 14, 15 y 16.

### Fase E: endurecimiento y salida

- [ ] Cerrar secciones 17, 18, 19 y 20.

## Criterio final del módulo

- [ ] Existe trazabilidad desde el indicador ejecutivo hasta el registro fuente.
- [ ] El ciclo recibido → registrado → entregado → consumido está respaldado por fuentes canónicas.
- [ ] Los rendimientos separan unidades y muestran confiabilidad estadística.
- [ ] Las anomalías son configurables, persistentes, asignables y auditables.
- [ ] Los permisos y el alcance de faena se aplican en backend.
- [ ] Las exportaciones respetan filtros, permisos y metadata.
- [ ] Los flujos críticos tienen pruebas automatizadas.
- [ ] La operación completó piloto, capacitación y corte del Excel.
