# Auditoría UI/UX general — escritorio — 6 de octubre de 2026

**Estado:** auditoría inicial del checkout `main` en `02000589`; las correcciones de esta lista están aplicadas localmente y verificadas en QA de escritorio. No se ejecutaron acciones de negocio ni se desplegaron cambios.

## Alcance y método

- **Foco:** escritorio a **1440 × 900**. Playwright Chromium con la sesión QA de administrador global abrió `/dashboard`, `/pendientes`, `/prevencion`, `/flota`, `/facturacion`, `/combustibles`, `/admin` y `/ti`. Las ocho rutas respondieron HTTP 200, sin errores de consola observados y sin desborde del contenedor `[data-shell-scroll]`. Las [capturas de escritorio](evidence/2026-10-06-general-uiux/) muestran la primera vista de cada una.
- Se aplicó Impeccable `audit` a patrones compartidos. El detector CLI dio **0 hallazgos** en `components/layout`, `components/ui`, Flota, Facturación y Combustibles. Se contrastaron los resultados con código, capturas, axe y pruebas puntuales del buscador en las portadas.
- El recorrido original también produjo mediciones a 390 px; **no intervienen en los hallazgos, prioridades ni recomendaciones de este informe**. Las auditorías por módulo del 3–6 de octubre se usaron como antecedentes; no se reabren defectos que la implementación posterior declaró resueltos.
- **Límite:** ocho primeras vistas y algunos controles. No representa las 208 páginas de `app/(app)`, estados de modales, todos los roles/faenas ni tareas completas. No hubo lector de pantalla real, medición de rendimiento en producción ni pruebas con usuarios. Las capturas provienen de `next dev` y pueden mostrar su indicador flotante.

## Correcciones aplicadas y verificación de escritorio

Las capturas de [verificación posterior](evidence/2026-10-06-general-uiux-fixes/) cubren `/facturacion`, `/prevencion`, `/combustibles`, `/admin` y una solicitud de QA a **1440 × 900** y **1024 × 768**; las capturas [`solicitud-detalle-1440.png`](evidence/2026-10-06-general-uiux-fixes/solicitud-detalle-1440.png) y [`solicitud-detalle-1024.png`](evidence/2026-10-06-general-uiux-fixes/solicitud-detalle-1024.png) muestran la sección corregida tras desplazar el contenedor de escritorio. Las diez cargas respondieron HTTP 200, sin errores de consola ni respuestas 5xx. `npm run typecheck`, ESLint dirigido a los seis archivos y `request-form.test.tsx` (21 pruebas) pasaron; no se ejecutó E2E.

- El buscador de la shell ya no aparece en las portadas sin listas filtrables de Facturación, Prevención y Combustibles. Sigue disponible en `/admin`; al ingresar un término inexistente cambió el contenido. También permanece en `/combustibles/bitacora` y `/facturacion/sincronizacion`.
- Los cinco enlaces de factura verificados miden al menos **32 px de alto**, con **8 px** de separación vertical.
- En “Atención requerida” se muestran 12 filas y 7 títulos distintos; el riesgo identifica cada fila y la segunda línea indica clasificación y acción pendiente.
- El resumen de sincronización presenta una frase operativa y conserva los mensajes técnicos en el detalle.
- El detalle QA `/solicitudes/QA_req_correos` bajó de **2.425 a 1.482 px** de alto en el contenido principal. Reemplazó controles deshabilitados por datos legibles y compactos; se verificaron cero controles deshabilitados visibles y se conservaron los tres ítems.

Los cambios están sin commit. Esta pasada cubre escritorio; no incluye zoom 200 %, roles de faena acotada ni lector de pantalla real.

## Veredicto

La interfaz de escritorio tiene una base coherente: Inicio y TI ponen trabajo concreto antes de los gráficos; Flota deja la tabla visible en la primera pantalla; Facturación identifica período y origen de los montos. La mejora transversal de mayor valor es **hacer fiable el buscador del TopBar**: aparece en tres portadas donde escribir no cambia nada. Después, conviene reducir texto repetido y traducir mensajes técnicos a decisiones operativas.

**Se retira el 13/20 de la versión anterior:** mezclaba problemas exclusivos de móvil con observaciones de escritorio y asignaba nota a rendimiento sin medir tiempos. Esta revisión no usa un puntaje global que el alcance no puede sostener.

## Hallazgos confirmados de escritorio

### P1 — El buscador del TopBar prometía filtrar y no hacía nada en tres portadas — corregido

**Evidencia.** A 1440 px, escribir `ZZZ_AUDIT_NOT_PRESENT_2026` en “Filtrar en esta página” no cambia el contenido de `/facturacion`, `/prevencion` ni `/combustibles`, incluso después de `networkidle`. [`hidesShellSearch`](../../components/layout/top-bar.tsx#L66-L71) no excluye esas portadas y sus componentes no consumen `searchQuery`. [Facturación](evidence/2026-10-06-general-uiux/facturacion-1440.png) y [Prevención](evidence/2026-10-06-general-uiux/prevencion-1440.png) muestran el control; `/admin`, en cambio, sí filtra su índice.

**Impacto.** Un control que parece activo falla en silencio. El usuario puede interpretar que no hay coincidencias o que la búsqueda de la plataforma es poco fiable.

**Corrección.** Se ocultó para las rutas raíz exactas `/facturacion`, `/prevencion` y `/combustibles`, sin alterar la búsqueda de sus subrutas. La prueba de escritorio confirmó que las tres portadas ya no muestran el campo, que `/admin` sigue filtrando y que las listas de `/combustibles/bitacora` y `/facturacion/sincronizacion` conservan el buscador. Comando Impeccable: `harden`.

### P1 — Un enlace de facturas tenía área de activación insuficiente — corregido

**Evidencia.** axe detectó `target-size` (`serious`) en un enlace “Folio …” de la lista “Facturas sin relación con la operación”: **212 × 13 px**, demasiado próximo a otro destino. El enlace se renderiza sin padding en [`facturacion/page.tsx`](../../app/%28app%29/facturacion/page.tsx#L248-L271). La primera pasada de `/dashboard` informó `link-name`, pero la segunda no lo reprodujo: se clasifica como advertencia de automatización, no como defecto confirmado.

**Impacto.** Al seleccionar una factura concreta aumenta el riesgo de activar la fila vecina, especialmente con puntero de precisión reducida. Aplica WCAG 2.5.8.

**Corrección.** Cada enlace ocupa al menos 32 px de alto y tiene 8 px de separación respecto del siguiente. Se mantuvo folio, cliente y monto en su nombre visible y accesible. La medida se confirmó en cinco destinos a 1440 y 1024 px. Comando: `harden`.

## Oportunidades de mejora en escritorio

### P2 — La portada de Prevención repetía casi el mismo aviso doce veces — corregido

En la [captura de escritorio](evidence/2026-10-06-general-uiux/prevencion-1440.png), la columna “Atención requerida” muestra una inspección seguida de avisos MIPER con el mismo título “Riesgo Importante sin medida por implementar con responsable y plazo”. El dato que distingue cada caso queda en una segunda línea de poco peso visual. El servicio ya limita y reparte por tipo en [`prevention-attention.ts`](../../lib/services/prevention-attention.ts#L38-L77); la presentación de [`prevention-home.tsx`](../../app/%28app%29/prevencion/prevention-home.tsx#L63-L79) no resume el grupo ni explicita el acto concreto.

**Corrección.** Las filas MIPER ahora llevan el nombre del riesgo como título y muestran clasificación más acción faltante en la segunda línea. Faena y destino por fila se conservaron. En la muestra quedaron 7 títulos distintos entre 12 filas; los riesgos con el mismo nombre siguen compartiendo título. Comando: `clarify`.

### P2 — Facturación mostraba un error técnico truncado en el resumen ejecutivo — corregido

En “Estado de las fuentes”, la [captura de escritorio](evidence/2026-10-06-general-uiux/facturacion-1440.png) muestra un texto como “Documento 33/13497 sin RUT de contraparte … XML no disponible … cursor …” bajo un badge “Parcial”. [`facturacion/page.tsx`](../../app/%28app%29/facturacion/page.tsx#L177-L220) imprime `run.errorSummary` directamente y lo corta a dos líneas. El estado es real, pero el resumen no dice con claridad qué parte de los datos falta, si se reintentará ni qué debe hacer el usuario.

**Corrección.** El resumen ahora indica que la sincronización reportó errores, sin presentar el texto técnico truncado ni afirmar que habrá reintento. Quien tiene permiso de gestión recibe la indicación de abrir “Ver detalle”; los mensajes originales siguen disponibles en la página de sincronización. Comando: `clarify`.

### P2 — El detalle de solicitud se mostraba como un formulario deshabilitado — corregido

La revisión reabrió una solicitud de QA en escritorio. El detalle montaba `RequestForm` tras los paneles de progreso y personas; la vista repetía metadatos en una barra lateral y exponía campos deshabilitados. Ahora los datos generales e ítems se presentan como resumen de lectura, con atributos, cantidades, urgencia, colaborador, equipo, proveedor y observaciones cuando existen. Se mantuvo el flujo de cancelación autorizado. En esta solicitud, el alto de `main` bajó de 2.425 a 1.482 px, conservando los tres ítems. Comando Impeccable: `distill`.

### Decisión de producto — alcance de “Mis pendientes”

En [escritorio](evidence/2026-10-06-general-uiux/pendientes-1440.png), el título promete “Todo lo que requiere tu acción”, mientras la lista explica que incluye **331 acciones dentro de tus permisos y faenas**. El filtro “Asignadas a mí” se retiró por una decisión anterior; el servicio conserva responsables propios de CAPA, inspecciones y otros dominios ([`operational-work-queue.ts`](../../lib/services/operational-work-queue.ts#L129-L163)). Validar si “Mis pendientes” significa trabajo disponible para mi rol o trabajo asignado nominalmente. Ajustar el nombre o dar una vista de responsables nativos solo si esa distinción es útil; no introducir responsables genéricos.

## Lo que funciona

- [Inicio](evidence/2026-10-06-general-uiux/dashboard-1440.png) muestra las 215 vencidas, cuatro señales de atención y cinco tareas urgentes antes del panorama; [TI](evidence/2026-10-06-general-uiux/ti-1440.png) muestra actas, préstamos y vencimientos antes de los gráficos.
- [Flota](evidence/2026-10-06-general-uiux/flota-1440.png) ofrece búsqueda propia, filtros compactos y filas de vehículos visibles desde la primera pantalla. [Admin](evidence/2026-10-06-general-uiux/admin-1440.png) muestra salud operativa e índice filtrable por permisos.
- Los ocho recorridos de escritorio no mostraron desborde del pozo ni errores de consola. El sistema de tokens y la estructura `PageHeader`/`PageContainer` son consistentes en la muestra.

## Estado restante

La semántica de “Mis pendientes” sigue como decisión de producto: acordar si significa acciones disponibles por rol/faena o acciones asignadas nominalmente antes de cambiar el título o los responsables visibles. No se modificó el flujo.

**Verificación pendiente:** zoom 200 %, roles con faena acotada, lector de pantalla real, rendimiento medido y flujos completos de formularios. No se certificó producción.
