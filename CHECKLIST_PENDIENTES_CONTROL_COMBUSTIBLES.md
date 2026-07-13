# Checklist de pendientes: control integral de combustible

Fecha de consolidación: 2026-07-13
Alcance: brechas restantes entre el módulo actual de combustibles y el prompt de control integral.
Estado de referencia: TCT, TAE y facturación permanecen como dominios separados; ya existen captura pública TAE, funcionamiento offline, cuatro evidencias, OCR, identidad por RUT, revisión, importación histórica, exportación XLSX, conciliación de cobertura TAE/TCT y resumen ejecutivo integrado.

## Avance verificado al 2026-07-13

- 46 ítems cerrados; 435 pendientes. La operación física end-to-end fue entregada; la trazabilidad de las diferencias ya abre ambos conjuntos de registros y las fórmulas tienen cobertura unitaria, pero el criterio del modelo se mantiene abierto hasta agregar la prueba de integración PostgreSQL del read model.
- Implementado en las pasadas verificadas: taxonomía canónica y catálogo administrativo de equipos, atributos operacionales por vehículo, catálogo canónico de productos, compatibilidad equipo/producto, producto obligatorio en TAE y cargas facturadas, ledger físico del ciclo combustible, migraciones/backfill completos, auditoría de cambios, historial paginado de lotes TAE, detalle de cargas y reversa transaccional auditada. Desde 2026-07-13: ruta operativa `/combustibles/ciclo` con registro autorizado y auditado de recepción/transferencia/entregas, filtros, conciliación física y bitácora navegable cuando existe registro origen; catálogo CRUD de estanques por faena y producto en `/admin/flota-catalogos/estanques-combustible`.
- Validación más reciente: migración `0049_harsh_moon_knight` aplicada localmente, 39 de 39 equipos con un intervalo operacional abierto, 22 pruebas focalizadas aprobadas, esquema Drizzle sincronizado, ESLint y TypeScript aprobados, React Doctor 82/100 sin diagnósticos en los componentes de esta pasada y build de producción Next.js completado.
- Los pendientes permanecen desglosados por sección debajo; ningún criterio de salida se marcó sin evidencia completa.

## Convención

- `[ ]` Pendiente.
- `[x]` Terminado y verificado.
- Un bloque sólo puede cerrarse cuando se cumpla su criterio de salida.
- No presentar canales independientes como diferencias contables sin un contrato de conciliación aprobado.
- No mezclar km/L con L/h en métricas, estadísticas o comparaciones.

## 1. Modelo completo del ciclo de combustible

- [x] Definir la fuente canónica para combustible recibido. `fuel_cycle_movements` con evento `received`.
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

- [ ] Existe un contrato de datos aprobado para cada etapa y una prueba automatizada para cada fórmula de diferencia. El contrato y las pruebas unitarias de absoluta, porcentual, base cero, signo negativo y fuente ausente están listos; falta la prueba de integración PostgreSQL del read model completo.

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

- [ ] Revisar los códigos de equipo históricos sin asociación confiable.
- [ ] Revisar los conductores sin asociación confiable.
- [ ] Revisar los supervisores sin asociación confiable.
- [ ] Permitir corregir el vehículo sugerido antes de importar.
- [ ] Permitir corregir el conductor sugerido antes de importar.
- [ ] Permitir corregir el supervisor sugerido antes de importar.
- [ ] Permitir rechazar explícitamente una sugerencia.
- [ ] Guardar las decisiones de mapeo aprobadas.
- [ ] Reutilizar decisiones aprobadas en futuras importaciones.
- [ ] Mostrar diferencias entre el dry-run y la importación definitiva.
- [x] Crear una pantalla de historial de lotes TAE. Disponible en `/combustibles/tae/importar/historial`, paginada y enlazada desde la importación.
- [ ] Crear detalle de filas importadas, observadas y rechazadas por lote.
- [x] Implementar reversión transaccional de lotes TAE. El cambio condicional de estado y la eliminación de cargas/evidencias se ejecutan en una transacción y bloquean la doble reversa.
- [x] Auditar la reversión. Se conserva la cabecera del lote y se registran `audit_log` y `status_history` con cantidad de cargas eliminadas.
- [ ] Permitir reprocesar filas rechazadas después de corregir catálogos.
- [ ] Resolver formalmente la política de evidencias históricas externas.
- [ ] Copiar evidencias históricas al almacenamiento privado o documentar su exclusión definitiva.
- [ ] Evitar dependencia indefinida de enlaces externos.

### Criterio de salida

- [ ] El histórico puede importarse, inspeccionarse, corregirse y revertirse sin modificar manualmente la base de datos.

## 4. Análisis especializado de equipos

- [ ] Crear una vista reutilizable de análisis de equipos.
- [ ] Permitir abrirla con presets para camiones y tractocamiones.
- [ ] Permitir abrirla con presets para cargadores y camionetas.
- [ ] Permitir abrirla con presets para maquinaria pesada.
- [ ] Generar presets desde catálogos, no desde listas rígidas de faenas.
- [ ] Agregar agregación por faena.
- [ ] Agregar agregación por equipo.
- [ ] Agregar agregación por tipo de equipo.
- [ ] Separar observaciones km/L de observaciones L/h.
- [ ] Calcular promedio.
- [ ] Calcular mediana.
- [ ] Calcular mínimo.
- [ ] Calcular máximo.
- [ ] Calcular desviación estándar.
- [ ] Calcular percentiles configurados.
- [ ] Calcular coeficiente de variación.
- [ ] Calcular tendencia temporal.
- [ ] Comparar con el período anterior.
- [ ] Comparar con equipos equivalentes.
- [ ] Calcular rango esperado.
- [ ] Mostrar cantidad de observaciones.
- [ ] Calcular nivel de confiabilidad de la muestra.
- [ ] Mostrar “Muestra no concluyente” cuando no se alcance el mínimo.
- [ ] Documentar todas las fórmulas.
- [ ] Permitir abrir las cargas individuales desde cada agregado.

### Criterio de salida

- [ ] Las tres familias de equipos se analizan desde una implementación común y ninguna comparación mezcla unidades incompatibles.

## 5. Visualizaciones analíticas

- [ ] Consumo por faena.
- [ ] Consumo por proveedor.
- [ ] Consumo por tipo de equipo.
- [ ] Consumo por equipo individual.
- [ ] Evolución temporal por equipo.
- [ ] Rendimiento por faena.
- [ ] Rendimiento por tipo de equipo.
- [ ] Comparación de equipos equivalentes.
- [ ] Diferencias entre etapas del ciclo.
- [ ] Distribución de anomalías.
- [ ] Cargas por supervisor.
- [ ] Cargas por conductor.
- [ ] Cargas por punto de suministro.
- [ ] Histograma de rendimientos.
- [ ] Dispersión litros versus kilometraje.
- [ ] Dispersión litros versus horómetro.
- [ ] Matriz faena/equipo/período.
- [ ] Flujo recibido → registrado → entregado → consumido.
- [ ] Definir la pregunta operacional que responde cada visualización.
- [ ] Evitar gráficos circulares cuando una comparación precisa requiera barras o tablas.
- [ ] Implementar estado vacío, carga y error por visualización.

### Criterio de salida

- [ ] Cada visualización responde a una decisión concreta, reacciona a filtros y permite acceder al detalle.

## 6. Filtros globales y filtros cruzados

- [ ] Agregar filtro por proveedor.
- [ ] Agregar filtro por tipo de suministro.
- [ ] Agregar filtro por producto.
- [ ] Agregar filtro por tipo de vehículo o maquinaria.
- [ ] Agregar filtro específico por código interno.
- [ ] Agregar filtro por marca.
- [ ] Agregar filtro por modelo.
- [ ] Agregar filtro por conductor.
- [ ] Agregar filtro por supervisor.
- [ ] Agregar filtro por lugar de carga.
- [ ] Agregar filtro por tipo de rendimiento.
- [ ] Agregar filtro por estado operativo del equipo.
- [ ] Agregar filtro por presencia de observaciones.
- [ ] Agregar filtro separado por sello inicial.
- [ ] Agregar filtro separado por sello final.
- [ ] Agregar filtros por cada tipo de evidencia.
- [ ] Agregar filtro por existencia de anomalías.
- [ ] Agregar filtro por tipo de anomalía.
- [ ] Agregar filtro por severidad.
- [ ] Agregar filtro por responsable de revisión.
- [ ] Mostrar filtros activos como chips.
- [ ] Permitir retirar cada filtro individualmente.
- [ ] Mantener acción global para limpiar filtros.
- [ ] Mantener filtros al navegar entre resumen, análisis, bitácora y conciliación.
- [ ] Mantener filtros relevantes en la URL.
- [ ] Permitir compartir una consulta por URL.
- [ ] Documentar qué filtros aplican sólo a TCT, TAE o facturación.
- [ ] Implementar selección cruzada desde barras.
- [ ] Implementar selección cruzada desde filas.
- [ ] Implementar selección cruzada desde proveedores.
- [ ] Implementar selección cruzada desde faenas.
- [ ] Implementar selección cruzada desde equipos.
- [ ] Mostrar el origen de cada filtro cruzado.
- [ ] Permitir retirar filtros cruzados.

### Criterio de salida

- [ ] Todos los componentes relacionados reflejan la misma consulta y la URL reproduce el estado compartible.

## 7. Bitácora general unificada

- [ ] Crear un read model o consulta unificada para TAE, TCT y registros manuales compatibles.
- [ ] Mantener la fuente original de cada registro.
- [ ] Mostrar fecha y hora.
- [ ] Mostrar faena.
- [ ] Mostrar proveedor.
- [ ] Mostrar lugar de carga.
- [ ] Mostrar equipo, código y patente.
- [ ] Mostrar tipo de equipo.
- [ ] Mostrar conductor.
- [ ] Mostrar supervisor.
- [ ] Mostrar producto.
- [ ] Mostrar litros.
- [ ] Mostrar kilometraje u horómetro.
- [ ] Mostrar rendimiento y unidad.
- [ ] Mostrar sello inicial y final.
- [ ] Mostrar estado de evidencias.
- [ ] Mostrar observaciones.
- [ ] Mostrar estado de validación.
- [ ] Mostrar anomalías asociadas.
- [ ] Mostrar usuario creador y modificador.
- [ ] Mostrar fechas de creación y modificación.
- [ ] Implementar búsqueda de servidor.
- [ ] Implementar ordenamiento de servidor.
- [ ] Mantener paginación de servidor.
- [ ] Permitir configurar columnas visibles.
- [ ] Abrir detalle completo.
- [ ] Abrir visor de evidencias.
- [ ] Consultar historial de cambios.
- [ ] Marcar registros para revisión.
- [ ] Implementar selección múltiple.
- [ ] Implementar acciones masivas según permisos.
- [ ] Abrir el caso de anomalía relacionado.
- [ ] Exportar la consulta filtrada a XLSX.

### Criterio de salida

- [ ] La bitácora maneja el volumen esperado sin cargar todas las filas en el navegador y permite llegar desde el resumen al registro fuente.

## 8. Control de cargas manuales y flujo por etapas

- [ ] Crear una vista parametrizable por faena.
- [ ] Evitar componentes o consultas duplicadas por faena.
- [ ] Mostrar combustible recibido.
- [ ] Mostrar combustible registrado.
- [ ] Mostrar combustible entregado.
- [ ] Mostrar combustible destinado a estanques intermedios.
- [ ] Mostrar combustible entregado directamente a equipos.
- [ ] Mostrar combustible consumido cuando exista fuente válida.
- [ ] Mostrar diferencia contra la etapa anterior.
- [ ] Mostrar diferencia porcentual.
- [ ] Mostrar estado normal, advertencia o crítico.
- [ ] Abrir registros involucrados en cada etapa.
- [ ] Actualizar el flujo con los filtros globales.

### Criterio de salida

- [ ] Una misma implementación representa el flujo de cualquier faena configurada y todas las diferencias tienen registros trazables.

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
- [ ] Auditar reversión de lotes TAE.
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

- [ ] Agregar `loading.tsx` específico a `/combustibles/tae`.
- [ ] Agregar `error.tsx` específico a `/combustibles/tae`.
- [ ] Agregar estados de carga para conciliación.
- [ ] Agregar estados de error para conciliación.
- [ ] Agregar estados de carga para análisis de equipos.
- [ ] Agregar estados de error para análisis de equipos.
- [ ] Implementar reintento localizado.
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
