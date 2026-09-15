# Revisión de tallas, variantes y editor de ítems — 2026-09-06

## Resultado

Se amplió la identificación del producto a talla, color, medida, modelo y los demás atributos concretos. Se corrigieron pérdidas de datos y errores de elección en el catálogo, las solicitudes y las entregas. Los cambios están en el árbol de trabajo; no se hizo commit, despliegue ni modificación de producción.

La variante sigue siendo una fila de `products`. Inventario y movimientos siguen utilizando `productId`; no se agregó una segunda identidad ni se modificó el esquema de la base de datos. Un atributo de catálogo con varias opciones es una definición pendiente de selección, no una variante física determinada. El lector compartido no inventa valores para ese caso. Cuando existe una solicitud, sus valores registrados tienen prioridad sobre el catálogo actual.

## Hallazgos y correcciones

| Hallazgo confirmado | Corrección |
| --- | --- |
| Los lectores operacionales recuperaban solamente la primera talla e ignoraban color, modelo y medida. | Lectura agrupada de todos los atributos y presentación compartida de la identidad concreta. Se mantiene el lector de talla para sugerencias y columnas de Excel. |
| Una familia con varios colores y sin talla seleccionaba automáticamente el primer producto al entregar. | Se exige elegir cuando hay más de una variante; las opciones muestran atributos y SKU. El stock sigue descontándose del producto seleccionado. |
| En edición sólo era accesible General; atributos y proveedor existían como pasos inaccesibles. | Navegación explícita entre General, Talla y otros atributos, y Proveedor. La edición de una variante reemplaza el valor elegido sin crear una combinación ambigua. |
| Un JSON malformado podía convertirse en atributos/proveedores vacíos al guardar. | Se rechaza el formulario; la actualización también rechaza campos serializados ausentes mediante validación. |
| El servidor de solicitudes validaba presencia y tipos numéricos, pero no contrastaba los valores select con el producto. | Las reglas reciben las opciones del catálogo y rechazan talla/color/modelo ajenos al producto elegido. Verificado también contra PGlite. |
| Cambiar los atributos de una variante ya utilizada podía cambiar la interpretación del inventario e histórico. | El editor comprueba uso en solicitudes, OC, movimientos, entregas/devoluciones y stock. Rechaza cambiar la identidad concreta y solicita crear otra variante. Las demás modificaciones se revierten si falla esa validación. |
| Guardar una variante podía asignarle otra familia y perder agrupación/metadatos. | Se conserva su familia cuando categoría y clasificación EPP siguen iguales. |
| El alta individual perdía `sizeFamily`; convertir JSON a texto con comas podía dividir una medida como `1,5 m`. | Se conserva la familia y se serializan las opciones como JSON, incluso al cargar el editor. |
| Valores personalizados de talla/color quedaban ocultos cuando existía un preset. | Se muestran conjuntamente los valores guardados y los atajos del catálogo. También se pueden agregar otros ejes, como material o medida. |
| El asistente podía avanzar con atributos vacíos y regeneraba combinaciones descartadas al pasar de paso. | Se bloquean atributos sin valor; se conservan las combinaciones revisadas y se invalidan cuando cambian sus entradas. Se impide enviar el alta desde pasos intermedios. |
| Un lote podía declarar combinaciones incompletas, repetidas o incompatibles con sus ejes. | Validación del lote y normalización de unidad compartida con el alta individual. |
| Elegir como preferido un proveedor ya presente podía duplicarlo en el envío. | Se elimina esa duplicación y el servidor rechaza proveedores repetidos. |
| Errores de campos podían no ser visibles en el paso activo; fallos de red del lote no tenían mensaje. | Resumen visible de errores y manejo del fallo del lote. |
| La vista móvil del editor repetía el título ya presentado por `PageHeader`. | Se retiró el encabezado duplicado del formulario embebido. Comprobado en Chromium a 390 px. |

## Cobertura del recorrido

| Etapa | Evidencia/cambio |
| --- | --- |
| Catálogo: alta y modificación | Helpers, schemas, server actions, pruebas de formulario y recorrido real de creación/edición. |
| Solicitud | Identificación visible con atributos registrados, selector general para familias que no se distinguen sólo por talla y validación cliente/servidor. |
| Compra pendiente y nueva OC | Nombre completo con atributos; lectura de los valores de solicitud. |
| OC: detalle y documentos | Identificación por línea; combinación de atributos de catálogo y solicitud. HTML y constructor de filas del PDF comparten los valores. |
| Recepción: alta y detalle | Atributos del producto y valores registrados disponibles al cotejar cada línea. |
| Bodega, alertas y disponibilidad EPP | Identidad completa del producto sin cambiar saldos ni reglas de entrega general. |
| Guías: opciones, edición, detalle e impresión | Atributos en productos y movimientos mostrados. |
| Entrega, historial y comprobante | Selección inequívoca por variante; descripción completa también cuando ya no queda stock. |
| Trazabilidad individual, consolidada y por trabajador | Identidad y valores registrados en las lecturas utilizadas por pantallas y exportaciones. |
| Excel | Stock, kardex, entregas, rotación, valorización e ítems sin OC mantienen la talla en su columna y añaden los demás atributos a la descripción. |

Archivos compartidos principales: `lib/products/variant-grouping.ts`, `lib/services/product-sizes.ts`, `lib/products/service-items.ts`. Editor: `app/(app)/admin/productos/product-form.tsx`, sus helpers y `actions/products.ts`. La protección añadida a la edición se realiza bajo el bloqueo de producto ya existente.

## Verificación final

- `npm run test:fast -- …`: **199/199**, 16 archivos. Incluye catálogo, variantes, formularios, selección de entregas, editor de solicitudes y filas de documento de OC.
- `npm run test:pglite -- …`: **169/169**, 8 archivos. Incluye persistencia de atributos, inventario por talla, solicitudes/servicios, exportación Excel, compras pendientes, guías y trazabilidad.
- `npm run typecheck`: aprobado después de los últimos ajustes.
- Lint focalizado de los archivos modificados: aprobado después de los últimos ajustes.
- `git diff --check`: aprobado.
- React Doctor: resultado final **84/100**, 21 advertencias (primera ejecución: 83/100 y 26 advertencias). El análisis usa `main → origin/main` e incluye trabajo concurrente ajeno al encargo. No equivale a una medición exclusiva de este parche ni a un baseline anterior a todos los cambios.

Las pruebas se ejecutaron al final del bloque de implementación, según lo solicitado. Los fallos encontrados en esa fase se corrigieron y se repitió la verificación correspondiente.

## Navegador y datos locales

Entorno: Next.js 16.3.3 en `localhost:3001`, base **local** `bodega_dev`. Chromium autenticado con la configuración QA existente. No se publicaron credenciales ni sesiones.

- Cinco rutas procesadas con HTTP 200 y destino correcto: alta de producto, catálogo, bodega, entregas y nueva compra.
- Alta real de un producto con prefijo `QA_VARIANTES_`: talla personalizada `QA47`, color y medida `1,5 m`. Consulta posterior confirmó los tres atributos y la familia de talla.
- Edición real: acceso a atributos y proveedor, cambio Azul → Negro y comprobación de persistencia de un único color. El producto temporal y su familia temporal fueron eliminados al finalizar.
- Verificación móvil a 390 × 844: atributos persistidos y ausencia del encabezado duplicado.
- Cuatro vistas documentales locales comprobadas: detalle de OC con talla `T/L`, impresión de OC con esa talla, recepción con modelo `500X` e impresión de entrega con talla `41`.
- **0 errores de página y 0 respuestas HTTP fallidas registradas** en los recorridos completados. Esto describe esos recorridos, no toda la aplicación.
- Advertencia de automatización resuelta: el primer muestreo documental seleccionó una OC eliminada. Se verificó su estado y se corrigió el muestreo para usar una OC vigente; no se clasificó como defecto del producto.
- Consulta de sólo lectura previa a los fixtures: **122 productos, 230 atributos, 0 select con múltiples valores** en la base local inspeccionada. No es un inventario de producción.

Reporte QA dirigido: `qa/reports/variants-2026-09-06/report.md`. Evidencia: `qa/reports/variants-2026-09-06/browser.json`, `workflow.json`, `documents.json` y `editor-mobile.png`. Los logs de pruebas están en `/tmp/bodega-variants-{unit,integration,typecheck,lint,doctor}.log` durante esta sesión.

## Límites y oportunidades restantes

- No se ejecutó `audit`/`audit:full`: esos scripts no existen en el `package.json` actual. La verificación descrita es dirigida con Playwright; no se presenta el reporte antiguo `qa/reports/latest.md` como evidencia de este trabajo ni se afirma cobertura de toda la aplicación.
- No se hizo build de producción, despliegue, envío real a proveedores ni prueba física de recepción/entrega. La integración de inventario y transiciones se verificó en PGlite, no mediante mutaciones exploratorias de datos operacionales reales.
- La comprobación en navegador de documentos corresponde a la vista HTML de impresión. Las filas usadas por el PDF se probaron automáticamente; no se certificó aquí la representación binaria final del PDF que tiene cambios concurrentes.
- La protección de identidad se incorporó al editor manual. Importadores y scripts que escriben directamente en `product_attributes` requieren su propia política de reconciliación histórica; este trabajo no certifica su inmutabilidad ni reescribe datos anteriores.
- Un producto heredado con varias opciones y sin valor registrado sigue siendo ambiguo. No se puede deducir su talla/color físico de un saldo agregado. Si aparecieran casos así fuera de la base local revisada, requieren conciliación con evidencia antes de separar existencias.
- La confirmación de descarte del formulario completo y una política común de inmutabilidad para todas las vías de importación son mejoras adicionales a evaluar. No se cambió la navegación compartida ni la semántica de importación durante esta revisión.
