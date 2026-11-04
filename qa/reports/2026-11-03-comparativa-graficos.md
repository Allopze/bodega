> Informe histórico de la primera demo. El HTML fue reemplazado por las dos direcciones visuales solicitadas después; la evidencia vigente está en `qa/reports/2026-11-03-graficos-dos-direcciones.md`.

# Comparativa de librerías de gráficos — 2026-11-03

## Alcance

Prototipo independiente: `docs/demos/comparativa-graficos.html`. Un único HTML con JavaScript, estilos y librerías incorporados; abre por `file://` y funciona sin conexión. No modifica rutas, dependencias, permisos ni datos de la aplicación. Los datos son ficticios del año 2025.

Librerías verificadas: Recharts 3.9.0 (la versión instalada del repo), Apache ECharts 6.0.0, Chart.js 4.5.1, Plotly.js basic 3.1.0, Vega-Lite 6.5.0 con Vega 6.4.0 y Vega-Embed 7.3.0, D3 7.9.0. Son las versiones del prototipo, no una afirmación sobre las últimas versiones disponibles.

## Verificación ejecutada

Playwright con Chromium real y contexto sin conexión, abriendo el HTML local:

- Las seis librerías generaron sus SVG/Canvas.
- Evolución mensual, barras acumuladas y anillo, cada uno con 12 y 6 meses: seis combinaciones aplicadas a las seis librerías.
- Filtros de faena y protección para conservar al menos una seleccionada.
- Tabla compartida de 12 filas y totales anuales: Norte 443, Centro 347, Sur 270; total 1.060 miles de litros.
- Tooltip de Recharts observado: abril, Norte 35, Centro 23, Sur 21 miles de litros.
- Escritorio 1440 × 1080: seis contenedores de gráficos con altura de 285 px.
- Móvil 390 × 844: ancho del documento de 390 px y tarjetas de 358 px; sin desbordamiento horizontal. Tabla desplegada y visible en captura.
- Preferencia de movimiento reducido y cambio a barras ejecutados.
- Cero errores de JavaScript, cero errores o advertencias de consola, cero solicitudes HTTP/HTTPS durante el recorrido.

La primera captura detectó que Vega-Embed alteraba la altura del contenedor y ocultaba su pie en escritorio. Se corrigió usando un nodo interior para el motor y se repitió el recorrido completo y las capturas. También se hizo explícito el color de los puntos de Recharts.

## Evidencia

- `qa/reports/2026-11-03-comparativa-graficos-desktop.png`
- `qa/reports/2026-11-03-comparativa-graficos-mobile.png`

El HTML y las capturas son artefactos locales ignorados por las reglas existentes de `/docs/**` y `/qa/**`; este informe Markdown sí es visible para Git. No se alteró `.gitignore`.

## Hallazgos y límites

No se observaron errores funcionales durante el recorrido descrito. No se realizaron benchmarks de carga, memoria, rendimiento ni comparación de tamaño individual: todas las librerías están incorporadas juntas. La recomendación incluida es una valoración de diseño y adecuación al repo, no una clasificación cuantitativa.

La revisión responsive cubre los tamaños indicados, no todos los dispositivos. Los tooltips de las otras cinco bibliotecas, el zoom y la descarga de imagen de Plotly no tuvieron pruebas de interacción exhaustivas. La tabla proporciona una alternativa por teclado; no se realizó una auditoría integral con lector de pantalla. Los gráficos no se integraron en Next.js ni se hizo UAT autenticado o despliegue. Typecheck, lint y suites de aplicación no se ejecutaron: no cambió el código de la aplicación.

## Revisión visual independiente

Una revisión adicional de las capturas finales, las fuentes del prototipo y los resultados automatizados dio disposición **ship** para la demo independiente. No observó defectos visuales bloqueantes. Detectó una mención a selección en Plotly que no correspondía a los controles habilitados: se corrigió el texto a zoom y descarga de imagen. No ejecutó otra sesión de navegador ni evaluó producción. No requiere modificar PRODUCT.md o DESIGN.md.

## Fuentes técnicas

- [Recharts: instalación](https://recharts.github.io/en-US/guide/installation/)
- [Apache ECharts: Canvas y SVG](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/)
- [Chart.js: integración](https://www.chartjs.org/docs/latest/getting-started/integration.html)
- [Plotly: primeros pasos](https://plotly.com/javascript/getting-started/)
- [Vega-Lite: integración](https://vega.github.io/vega-lite/usage/embed.html)
- [D3: primeros pasos](https://d3js.org/getting-started)
