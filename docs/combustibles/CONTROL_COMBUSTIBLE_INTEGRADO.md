# Control de combustible integrado

Fecha: 2026-07-12

## Decisión de dominio

La portada `/combustibles` funciona como resumen ejecutivo, pero no convierte TCT, TAE y facturación en una sola tabla ni supone que sean documentos espejo:

- **Facturado / registrado** proviene de `fuel_loads`, excluyendo registros cancelados.
- **Entregado en terreno TAE** proviene de `fuel_tae_submissions`, excluyendo cargas anuladas.
- **Consumo reportado TCT** proviene de `fuel_consumption_records` y conserva sus fuentes de origen.

Los tres canales comparten período, faena y alcance de permisos. Se muestran juntos para detectar cobertura y brechas de datos, no para calcular una diferencia contable directa. La conciliación por mes, faena y equipo permanece en `/combustibles/tae/conciliacion`.

## Contrato del ciclo físico

`fuel_cycle_movements` es la fuente canónica de los eventos físicos. No replica compras, facturas ni cargas: los referencia mediante `source_type` y `source_id` cuando corresponda.

| Etapa | Evento fuente | Significado |
|---|---|---|
| Recibido | `received` | Combustible recibido de un proveedor, con documento y estanque destino. |
| Registrado | `fuel_loads` | Carga facturada o registrada administrativamente. |
| Transferido | `transfer` | Movimiento entre dos estanques distintos de la misma faena/producto. |
| Entregado | `tank_delivery` o `direct_delivery` | Entrega desde estanque o directa desde proveedor a un equipo. |
| Consumido | fuente futura | No se infiere desde TAE/TCT mientras no exista un evento canónico de consumo. |

Las diferencias sólo se calculan entre dos etapas con fuente disponible: `absoluta = izquierda - derecha`; `porcentual = absoluta / derecha × 100`, salvo divisor cero. Cuando falta una etapa, el resultado es `unavailable` y la interfaz debe mostrar “Sin fuente disponible”. TAE y TCT continúan siendo canales de cobertura, no diferencias contables.

La operación se realiza en `/combustibles/ciclo`: permite registrar recepción, transferencia, entrega desde estanque y entrega directa, con autorización por faena, auditoría y validación de la forma de cada evento. Los estanques se administran en `/admin/flota-catalogos/estanques-combustible`, con faena, producto, capacidad, estado y auditoría. La misma ruta del ciclo muestra la conciliación y la bitácora bajo el mismo período, faena y producto. Cada diferencia enlaza sus dos conjuntos de registros: los movimientos físicos se filtran por etapa dentro del ciclo y las cargas registradas se abren en `/combustibles/facturas` con el mismo rango, faena y producto canónico. Cuando un movimiento conserva una referencia `fuel_load` o `tae_submission`, también ofrece abrir el registro individual; un evento manual sin referencia declara explícitamente “Sin fuente disponible”.

## Indicadores y fórmulas

- Volumen de cada canal: suma de litros válidos dentro del período filtrado.
- Variación: `(período actual - período anterior) / período anterior × 100`. Si el período anterior es cero, no se inventa un porcentaje.
- Equipos TAE: cantidad de códigos de equipo distintos.
- Pendientes TAE: cargas con estado `submitted`.
- Observadas TAE: cargas con estado `observed`.
- Sello incompleto: falta el sello retirado o el instalado.
- Evidencia incompleta: la carga tiene menos de cuatro tipos de evidencia distintos.

Las métricas TAE no se consultan ni se muestran si la sesión carece de `combustibles:tae_view`. Todas las consultas aplican el alcance de faena en servidor.

## Navegación y filtros

La portada conserva los filtros URL del análisis TCT (`desde`, `hasta`, `faena`, fuente, patente y asociación). Al entrar a TAE, traduce el período a los parámetros de esa bitácora (`from`, `to`, `faena`). Las señales de calidad agregan filtros accionables:

- `estado=submitted` o `estado=observed`;
- `sello=faltante`;
- `evidencia=faltante`.

La bitácora y su exportación XLSX aplican esos filtros en el servidor. No se cargan todas las filas en el navegador.

## Límites actuales

- La fuente canónica física y el catálogo de estanques ya existen. Aún falta una prueba de integración PostgreSQL que cubra el read model completo del ciclo, además de las pruebas unitarias de fórmula.
- TAE clasifica el producto, pero el consumo canónico aún no existe como etapa física independiente.
- Las reglas avanzadas configurables y los casos persistentes de anomalía siguen siendo una fase posterior. Hoy la portada expone señales derivadas y los estados de revisión existentes.
- La taxonomía de equipos y sus intervalos de estado ya están normalizados, pero los 39 equipos activos de la base local aún requieren completar su capacidad de estanque antes de cerrar el criterio de integridad del catálogo. Todavía no existe la vista analítica común que compare familias sin mezclar km/L y L/h.

## Rendimiento y despliegue

Las agregaciones se ejecutan en PostgreSQL y la bitácora TAE conserva paginación de servidor. Los índices existentes cubren período/faena, estado, equipo y evidencia por carga. Para desplegar:

1. construir con `npm run build`;
2. aplicar migraciones pendientes con `npm run db:migrate` (no usar `db:push`);
3. ejecutar `npm run db:sync-rbac` si el entorno todavía no tiene permisos TAE;
4. validar `/combustibles`, `/combustibles/tae` y `/combustibles/tae/conciliacion` con un usuario global y uno limitado a faena.

## Taxonomía operativa de equipos

Desde las migraciones `0043_awesome_fat_cobra`, `0044_woozy_ted_forrester` y `0045_glossy_firebrand`, `fuel_vehicles.equipment_type_id` es la relación canónica y obligatoria con `fuel_equipment_types`. La columna `fuel_vehicles.type` se conserva como snapshot de compatibilidad para consumidores legacy, pero las pantallas administrativas y analíticas nuevas deben leer la relación.

El catálogo define:

- familia analítica (`truck`, `light`, `heavy`, `storage`, `support`, `other`);
- medidor predeterminado (`odometer`, `hour_meter`, `none`);
- unidad de rendimiento (`km_per_liter`, `liters_per_hour`, `not_applicable`);
- estado y orden de presentación.

Cada vehículo puede complementar el tipo con capacidad, grupo comparable, proveedor habitual y horario operativo. La validación impide combinar km/L con horómetro o L/h con odómetro. Los tipos desconocidos de integraciones legacy usan temporalmente `fet-other` o crean una entrada revisable; deben reclasificarse desde `/admin/flota-catalogos/tipos-equipo`.

La migración `0049_harsh_moon_knight` incorpora `fuel_vehicle_operational_intervals`. Cada alta abre un intervalo y cada cambio de estado cierra el vigente y crea el siguiente dentro de la misma transacción. El cambio exige motivo, conserva actor y se audita junto con la ficha. La ficha `/flota/[id]` muestra hasta 25 intervalos recientes. El backfill crea un intervalo abierto para cada equipo preexistente sin inventar un actor histórico.

## Historial y reversa de importaciones TAE

- `/combustibles/tae/importar/historial` lista todos los lotes, su estado, conteos, volumen, responsable y fecha.
- `/combustibles/tae/importar/[id]` conserva el resumen trazable y muestra las cargas importadas u observadas que siguen vigentes.
- La reversa exige simultáneamente `combustibles:tae_import` y `combustibles:revert`.
- La transición `imported -> reverted`, la eliminación de las cargas del lote y la auditoría se ejecutan en una sola transacción.
- Al eliminar una carga, sus evidencias privadas se eliminan mediante la relación `ON DELETE CASCADE`; la cabecera del lote no se elimina.
- Las filas rechazadas todavía se conservan sólo como conteo agregado. Persistir su detalle y permitir reprocesarlas sigue siendo trabajo pendiente.

## Productos y compatibilidad de equipos

`fuel_products` es el catálogo canónico del dominio. Incluye código, nombre, categoría, unidad, alias de integración y estado. La administración se realiza en `/admin/flota-catalogos/productos-combustible` con `admin:fleet_catalog`.

La relación `fuel_vehicle_products` declara qué productos puede recibir cada equipo. La ficha administrativa exige al menos un producto compatible. El formulario público TAE sólo ofrece esas opciones y `createTaeSubmission` vuelve a comprobar la relación y el estado del producto antes de guardar, por lo que una carga offline no puede eludir la regla al sincronizarse.

Las migraciones `0046_ancient_speedball` y `0047_keen_jetstream` crean el catálogo, relacionan cargas facturadas y TAE, rellenan el histórico y vuelven obligatorias ambas referencias. Las cargas históricas TAE sin columna de producto se clasifican como `No especificado (histórico)`; no se asumen como Diésel. Los 39 equipos existentes recibieron compatibilidad con Diésel y BlueMax sólo se añadió cuando existía una carga previa que lo respaldara.
