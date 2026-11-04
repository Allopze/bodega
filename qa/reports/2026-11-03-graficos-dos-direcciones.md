# Gráficos: Esencial y Expresiva — 2026-11-03

## Resultado y alcance

Se reemplazó el contenido de `docs/demos/comparativa-graficos.html` después de que el usuario rechazara el acabado de la primera comparación. El usuario eligió comparar ambas direcciones: elegante y sobria para uso diario, y otra más expresiva.

Un solo HTML autónomo, aproximadamente 2 MB, con fuentes, estilos y librerías incorporados. No modifica rutas, permisos, dependencias, base de datos ni código de la aplicación. Funciona abriendo el archivo local sin conexión.

- **Esencial:** áreas apiladas con Recharts, barras por tipo de trabajo, columnas por mes y matriz con valores.
- **Expresiva:** corrientes con D3, Sankey con Apache ECharts, sectores radiales apilados y círculos proporcionales.
- Selector de dirección visual; fondo claro/oscuro; filtro por faena; rango y flechas de selección de mes; detalle del mes, total anual y tabla accesible por teclado.

La vista Esencial toma referencias de los ejemplos de shadcn/ui, pero no utiliza ni afirma utilizar sus componentes. Las librerías incorporadas son Recharts 3.9.0, D3 7.9.0 y ECharts 6.0.0. No se afirma que sean las versiones más recientes.

## Datos y semántica

Se conservaron los 36 valores mensuales ficticios de la primera demo. Totales anuales: Norte 443, Centro 347, Sur 270; total 1.060 miles de litros. Diciembre: 47 + 35 + 30 = 112 miles de litros.

La asignación por trabajo es adicional y simulada, declarada explícitamente en pantalla. Cada distribución conserva el total mensual de su faena, incluido el redondeo a una décima. La forma de corriente usa espesor para el consumo y una base desplazada; no se interpreta su posición vertical como valor absoluto. En los sectores radiales y círculos, el área representa magnitud. La alternativa Esencial permite comparaciones con ejes y valores alineados.

## Verificación real en Chromium / Playwright

Abriendo `file://` con contexto sin conexión:

- 24 combinaciones: 2 direcciones × 4 alcances (todas y cada faena) × 3 meses (enero, junio, diciembre).
- Concordancia del valor visible con el total del mes y conservación de los totales de las asignaciones simuladas.
- Selector de mes por teclado: Home y ArrowRight, resultado febrero.
- Flechas de mes con cambio diciembre → enero → diciembre.
- Cambio de tema claro/oscuro y captura de Expresiva oscura.
- Capturas de ambas direcciones en escritorio 1440 × 1080 y móvil 390 × 844.
- Sin desbordamiento horizontal en móvil; tabla desplegable con doce filas.
- Cambio de vista con movimiento reducido.
- Cero errores de JavaScript; cero errores o advertencias de consola; cero solicitudes HTTP/HTTPS.

Durante la verificación se corrigieron el selector ambiguo de dirección visual, las advertencias de tamaño de Recharts al ocultar su contenedor y el recorte temporal de etiquetas del Sankey durante su animación. Se repitió el recorrido sobre el archivo corregido.

## Capturas finales

- `qa/reports/2026-11-03-graficos-expressive-desktop.png`
- `qa/reports/2026-11-03-graficos-essential-desktop.png`
- `qa/reports/2026-11-03-graficos-expressive-mobile.png`
- `qa/reports/2026-11-03-graficos-essential-mobile.png`
- `qa/reports/2026-11-03-graficos-expressive-dark.png`

El HTML y las capturas están ignorados por las reglas existentes del repositorio. No se cambió `.gitignore`. Este informe Markdown sí es visible para Git.

## Cobertura y límites

No es una auditoría integral de accesibilidad, una prueba de rendimiento ni un UAT de la aplicación. No se recorrieron todas las interacciones de puntero, cada tooltip ni todos los anchos de pantalla. Se verificaron los filtros y los datos mediante las combinaciones indicadas; las capturas muestran los estados mencionados. No se ejecutaron las suites del producto ni se desplegó nada.

## Fuentes de referencia

- [shadcn/ui, gráficos de áreas](https://ui.shadcn.com/charts/area)
- [D3, áreas apiladas y corrientes](https://d3js.org/d3-shape/stack)
- [Apache ECharts, ejemplos](https://echarts.apache.org/examples/en/index.html)

## Revisión visual independiente

Una revisión de las cinco capturas, las fuentes y los resultados automatizados pidió dos correcciones: contraste del texto secundario en modo claro y notas explicativas específicas de cada dirección visual. Ambas se aplicaron. El color secundario `#536b5d` mide 5,66:1 sobre tarjeta y 5,28:1 sobre fondo. Las notas de Esencial describen longitudes de barras y alturas de columnas; las de Expresiva, flujos y sectores radiales.

Se regeneraron las capturas y se repitió el recorrido de 24 combinaciones: cero errores, advertencias y solicitudes externas. El revisor puntuó ambos ajustes como **resueltos** y emitió **ship para el prototipo independiente**, dentro del alcance revisado. Esa verificación de correcciones no certifica accesibilidad completa ni producción. No se requirieron cambios en PRODUCT.md o DESIGN.md.

## Ampliación posterior: galería de seis tipos adicionales

A petición del usuario se agregó una galería visible al mismo HTML, conservando las dos direcciones y sus controles. Incluye treemap, cascada, dispersión, cajas y bigotes, histograma y curvas acumuladas. Esta galería muestra el año completo, responde a dirección visual, fondo y alcance de faena, y declara su independencia del selector de mes.

Semántica verificada:

- Treemap: el área codifica consumo; vista de faenas y desglose de sus doce meses, con botón de regreso. Valores en miles de litros.
- Cascada: total de enero, diferencias mensuales de febrero a diciembre y total de cierre de diciembre. Los signos se conservan y se distinguen aumento/disminución en texto y tooltip.
- Dispersión: once pares consecutivos por faena, con consumo del mes actual en X y del siguiente en Y. La diagonal representa igualdad, sin afirmar correlación causal.
- Cajas: mínimo, Q1, mediana, Q3 y máximo de los doce valores por faena. Los bigotes son mínimo/máximo, explícitamente; no se los presenta como límites de Tukey.
- Histograma: ocho intervalos de cinco mil litros entre 10 y 50. Cuenta observaciones faena-mes; límite inferior incluido y superior excluido, salvo último intervalo cerrado.
- Acumuladas: suma progresiva por faena y doce puntos; los cierres coinciden con los totales anuales originales.

Verificación adicional con Chromium sin conexión: 16 combinaciones (2 direcciones × 2 fondos × 4 alcances). Se comprobó que cada histograma conserva doce observaciones por faena, cada dispersión once pares por faena, la cascada cierra correctamente, las estadísticas de cajas están ordenadas y las curvas cierran en los totales anuales. Se verificaron el desglose del treemap, sus doce meses y el botón de regreso, además del selector de mes por teclado.

Se corrigió un estado inválido de layout que ECharts retenía al reemplazar los datos del treemap: la instancia de ese gráfico se recrea al cambiar la vista. El desglose y el regreso pasaron después de esa corrección. Se ajustaron sus etiquetas para evitar truncar los valores en móvil.

Resultado final del recorrido: cero errores de JavaScript, errores o advertencias de consola y cero solicitudes HTTP/HTTPS. En móvil de 390 px, documento de 390 px y seis contenedores de 356 px: sin desbordamiento horizontal.

Capturas específicas de la galería, posteriores a la ampliación:

- `qa/reports/2026-11-03-galeria-expressive-desktop.png`
- `qa/reports/2026-11-03-galeria-essential-desktop.png`
- `qa/reports/2026-11-03-galeria-mobile.png`
- `qa/reports/2026-11-03-galeria-dark-mobile.png`

Las capturas de la versión anterior documentan las vistas principales antes de añadir la galería. No se realizó auditoría integral de lector de pantalla ni de cada tooltip; las mismas limitaciones de integración y rendimiento indicadas arriba siguen aplicando. El archivo continúa siendo un prototipo local, sin cambios al producto ni despliegue.

Revisión independiente de esta ampliación: **ship para el prototipo**. El revisor examinó las cuatro capturas de galería, transformaciones, opciones y resultados automatizados, y no observó bloqueos materiales. No ejecutó un navegador adicional y distinguió el desglose del treemap verificado por automatización de su nivel inicial visible en las capturas.
