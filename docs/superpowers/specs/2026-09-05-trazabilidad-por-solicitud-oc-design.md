# Trazabilidad consolidada por solicitud y orden de compra

## Problema

La vista de `/bodega/trazabilidad` presenta una fila y una tarjeta por cada
ítem de solicitud. Esto fragmenta una misma solicitud en varias unidades
visuales, obliga a revisar líneas repetidas para entender el avance documental
y hace que los conteos de seguimiento parezcan conteos de ítems aunque el
trabajo operativo se organiza por solicitudes y órdenes de compra.

Además, el click principal de una tarjeta móvil actualmente expande el detalle
del ítem. No lleva al usuario al documento que debe revisar.

## Objetivo

La unidad principal de la vista de seguimiento será una **solicitud**. Cada
solicitud agregará sus líneas y mostrará sus órdenes de compra asociadas. Las
órdenes de compra serán enlaces navegables a su detalle, incluso cuando una OC
contenga líneas de más de una solicitud.

La vista de detalle de ítem seguirá disponible como evidencia secundaria, pero
no será la unidad de tabla, tarjeta, paginación, KPI ni exportación principal.

## Enfoques considerados

### A. Solicitud con OCs anidadas (recomendado)

Una tarjeta o fila representa una solicitud. Dentro se resumen las OCs
relacionadas y se permite abrir cada una. El encabezado de la tarjeta navega a
`/solicitudes/[requestId]`; cada OC navega a `/compras/[orderId]`.

Evita dividir solicitudes y mantiene el contexto de la solicitud cuando una OC
es compartida. Los KPIs pueden contar solicitudes y OCs únicas sin duplicarlas.

### B. Tarjetas planas por relación solicitud/OC

Cada tarjeta representa el par solicitud/OC, con otra tarjeta para las líneas
sin OC.

Es más sencillo de renderizar, pero repite una solicitud cuando tiene varias
OCs y repite una OC cuando sirve a varias solicitudes. También complica la
paginación y la lectura de los totales.

### C. Pestañas independientes de Solicitudes y OCs

Cada pestaña tendría una entidad como unidad principal.

La separación es clara, pero duplica consultas, filtros y lógica de estado, y
obliga al usuario a cambiar de pestaña para entender la relación entre ambos
documentos.

Se implementará el enfoque A.

## Modelo de datos de la vista

El pipeline seguirá partiendo de las líneas existentes para conservar la
trazabilidad de cantidades y documentos, pero expondrá un DTO agregado nuevo,
por ejemplo `ConsolidatedRequest`:

- identidad de solicitud, faena, solicitante, fecha, modalidad y urgencia;
- cantidad de líneas y resumen de productos/categorías;
- OCs relacionadas, agrupadas por `purchaseOrderId`, con código, proveedor,
  estado y cantidad de líneas atribuibles;
- resumen de avance por etapa: solicitado, aprobado, en OC, oficina, faena,
  entregado y pendiente;
- alertas y fecha de última actualización;
- líneas originales sólo para el panel expandido o el enlace de evidencia.

Las cantidades no se sumarán entre unidades de medida diferentes. Cuando una
solicitud tenga UOM heterogéneas, el agregado mostrará conteos por UOM y las
cantidades permanecerán en el detalle de líneas.

El resumen específico de una OC sólo mostrará cantidades enlazadas directamente
a sus ítems de OC: ordenado, recibido en oficina y recibido en faena. Las
entregas y los pendientes permanecerán a nivel de solicitud/línea, porque el
modelo actual enlaza las entregas al ítem de solicitud y no a un ítem de OC;
repartirlas entre OCs introduciría una atribución que los datos no prueban.

Los identificadores de OC se deduplicarán globalmente para KPIs y filtros. Una
OC compartida puede aparecer dentro de más de una solicitud por sus líneas
atribuibles, pero no aumentará dos veces el KPI global de OCs.

## Estado y filtros

El estado de una solicitud se derivará del estado de sus líneas usando la misma
secuencia de etapas que hoy calcula `computeItemStatus`:

- `entregado` cuando todas las líneas aplicables están entregadas;
- `parcialmente_entregado` cuando existe avance de entrega y aún queda saldo;
- en los demás casos, el estado de avance más bloqueante de sus líneas.

El agregado conservará también un conteo por estado para no ocultar una mezcla
de etapas. El filtro de estado coincidirá con el estado agregado y la tarjeta
mostrará el desglose cuando haya estados mixtos.

Los filtros de categoría, proveedor, pendientes y texto buscarán en la
solicitud y sus OCs/líneas. Una solicitud aparecerá si al menos una línea u OC
coincide; el resumen indicará cuántas líneas coinciden para evitar una lectura
engañosa del resultado filtrado.

La paginación se aplicará después de agrupar, de modo que una solicitud nunca
quede dividida entre páginas. El límite de carga y el aviso de truncamiento se
expresarán en solicitudes agregadas, manteniendo la protección existente para
faenas grandes.

## Navegación e interacción

- El encabezado y el área principal de la tarjeta/fila de solicitud serán un
  enlace a `/solicitudes/[requestId]`.
- Cada bloque de OC tendrá su propio enlace a `/compras/[orderId]`.
- La expansión del resumen será un control separado y accesible; no reemplaza
  el click de navegación de la tarjeta.
- Los enlaces a recepciones, guías, entregas y al detalle de línea seguirán
  dentro del historial/documentos asociados.
- La tabla desktop y las tarjetas mobile usarán el mismo agregado para evitar
  que cada breakpoint muestre una unidad de negocio distinta.
- Los KPI superiores seguirán reglas de densidad del módulo y llevarán a un
  filtro o vista de solicitudes/OCs correspondiente cuando exista una
  navegación clara.

## Exportación

El endpoint seguirá generando Excel y reutilizará el mismo pipeline agregado.
El libro tendrá como mínimo:

1. una hoja resumen con una fila por solicitud;
2. una hoja de órdenes de compra con una fila por OC única en el alcance;
3. el detalle de líneas sólo si es necesario para auditoría, claramente
   separado del resumen.

Los filtros, el alcance por faena y el indicador de truncamiento serán iguales
  a los de la pantalla. No se volverá a introducir un export separado con
  semántica de ítem.

## Compatibilidad y alcance

- Se mantienen las rutas `/bodega/trazabilidad` y la pestaña de búsqueda por
  código.
- Se mantiene `/bodega/trazabilidad/[itemId]` para revisar evidencia puntual.
- Las rutas de solicitud y OC existentes serán la autoridad para los enlaces;
  no se crearán duplicados de sus páginas.
- No se cambia el modelo de datos ni se modifica el historial documental.
- Los artefactos de auditoría y otros cambios preexistentes del árbol de
  trabajo quedan fuera de este cambio.

## Verificación y criterios de aceptación

Se agregarán pruebas deterministas para:

- una solicitud con varios ítems;
- una solicitud con varias OCs;
- una OC compartida entre solicitudes;
- líneas sin OC;
- UOM heterogéneas sin sumas inválidas;
- filtros y KPIs sin doble conteo;
- paginación por solicitudes agregadas;
- navegación de tarjeta a solicitud y de bloque OC a compra.

La validación final incluirá tests de servicio/exportación, typecheck y lint
dirigido, además de Playwright sobre la vista autenticada cuando el entorno
local esté disponible. El informe QA deberá separar bugs confirmados,
hallazgos funcionales, advertencias de automatización y brechas de cobertura.

## Revisión de la especificación

La propuesta usa una única unidad visible (solicitud), conserva la relación
con OC sin duplicar métricas globales, evita sumar UOM incompatibles y define
un destino navegable para cada tarjeta. No quedan placeholders ni rutas nuevas
implícitas. El siguiente paso, tras la revisión de este archivo, es preparar el
plan de implementación por capas: DTO/servicio, exportación, UI desktop/mobile,
y regresiones.
