# Addendum UI/UX — recaptura de Adquisiciones

Fecha de recaptura: 2026-08-09  
Evidencia: `audit/screenshots/2026-08-08-adquisiciones-refresh/`

## Alcance y evidencia

Se generaron nueve corridas nuevas y aisladas, sin modificar los lotes previos ni `AUDITORIA_ADQUISICIONES_2026-08-08.md`:

| Viewport | Filtros | Modo | Capturas válidas |
| --- | --- | --- | ---: |
| 1920 x 1080 | adquisiciones, aprobaciones, inventario | completo | 84 |
| 1366 x 768 | adquisiciones, aprobaciones, inventario | completo | 84 |
| 390 x 844 | adquisiciones, aprobaciones, inventario | base y modales | 32 |

Los nueve `manifest.json` suman 200 resultados. Cada resultado terminó HTTP 2xx y `capture-ok`; no hay errores de cliente, scroll horizontal detectado, referencias faltantes, huérfanos, archivos obsoletos ni hashes duplicados. Las capturas se ejecutaron contra un servidor de producción temporal y una base de datos desechable.

La revisión manual se concentró en escritorio y laptop: jerarquía de cabecera, acciones primarias, densidad, pasos del flujo, tablas, pestañas y modales. Móvil se usó solo como línea base de carga y modales declarados.

## Hallazgos

### P2 — La acción de impresión queda recortada a 1366 px

- **Captura:** `laptop-1366/adquisiciones/laptop-compras-detalle.png`.
- **Impacto:** el botón `Imprimir / PDF` sobresale por el borde derecho de la tarjeta. En un ancho de laptop común la acción se percibe incompleta y su extremo clicable queda fuera del lienzo, aunque el detector de scroll horizontal no lo registra por estar contenido.
- **Principio afectado:** adaptación al viewport y conservación de acciones primarias.
- **Recomendación:** permitir que la cabecera de la tarjeta lateral se ajuste o apile a este breakpoint; evitar mínimos rígidos y aplicar `minmax(0, …)`/`flex-wrap` para que estado y acción conserven íntegros texto, borde y área clicable.
- **Criterio de aceptación:** a 1366 x 768 se ve el botón completo, incluidos borde y radio derecho; badge de estado y acción siguen legibles y no hay recorte visual ni área interactiva fuera del viewport.

### P2 — “Stock por faena” no nombra sus columnas operativas

- **Capturas:** `desktop-1920/inventario/desktop-bodega.png` y `laptop-1366/inventario/laptop-bodega.png`.
- **Impacto:** valores como `6 pares`, `10` junto a un lápiz y `09-06-2026` carecen de encabezados. Para saber si son disponible, mínimo, edición o fecha de actualización, la persona debe inferirlo; esto aumenta el riesgo de interpretar mal el stock o modificar un umbral equivocado.
- **Principio afectado:** reconocimiento antes que recuerdo e información operativa autoexplicativa.
- **Recomendación:** usar encabezados semánticos visibles —por ejemplo, `Disponible`, `Mínimo` y `Actualizado`— y reemplazar o acompañar el ícono de lápiz con una etiqueta/tooltip que explique la acción.
- **Criterio de aceptación:** cada cantidad y fecha se entiende sin hover; la acción comunica qué modifica y la composición conserva esa claridad a 1366 px.

### P3 — El resumen contradice la opcionalidad del proveedor al iniciar una OC

- **Capturas:** `desktop-1920/adquisiciones/desktop-compras-nueva.png` y `laptop-1366/adquisiciones/laptop-compras-nueva.png`.
- **Impacto:** el selector dice `Selecciona proveedor (opcional)`, mientras el resumen marca `Proveedor: Falta` aun sin ítems elegidos. La señal parece un error de validación y deja ambigua la condición real para crear la orden.
- **Principio afectado:** correspondencia entre controles, estado del sistema y validación progresiva.
- **Recomendación:** antes de seleccionar ítems, mostrar `Pendiente al seleccionar ítems` o `No requerido aún`; exigir proveedor solo cuando un ítem escogido lo requiera y explicar esa condición en el resumen.
- **Criterio de aceptación:** con cero ítems el resumen no informa un proveedor faltante; con ítems sin proveedor obligatorio se puede continuar cuando el resto esté completo; con un ítem que sí lo requiere, control y resumen indican de forma consistente que falta.

## Controles verificados

- Las cabeceras, acciones de página, listas, modales y transiciones principales de Solicitudes, Compras, Recepción, Aprobaciones, Bodega, Entregas y Trazabilidad cargaron en los tres viewports.
- En 1920 px y 1366 px, las tablas y formularios principales mantienen una jerarquía clara; los hallazgos anteriores son excepciones concretas, no una certificación general de todos los estados posibles.
- La línea base móvil carga las rutas y modales declarados sin regresiones visuales evidentes en esta muestra.

## Límites de esta revisión

No se certifican navegación por teclado, lector de pantalla ni archivos PDF descargados: esas afirmaciones requieren pruebas específicas. Tampoco se evaluaron flujos sin datos de fixture, permisos alternativos ni una auditoría de accesibilidad automatizada completa.
