# Auditoría de visualización de datos y experiencia analítica — Plataforma Chome

**Fecha:** 2026-11-02 · **Revisión con datos de producción:** 2026-11-03 · **Rama auditada:** `main` @ `d29767f66` · **Tipo:** descubrimiento y diseño. **El informe no modificó código ni lógica de negocio**; las tres correcciones colaterales del Anexo C viven en una rama aparte.

---

## Alcance, método y límites

**Qué se recorrió**

El informe tuvo dos pasadas. La **primera** (2026-11-02) se hizo sobre la base de desarrollo de entonces. La **revisión** (2026-11-03) se hizo después de clonar producción y poblar con datos simulados los módulos vacíos; las secciones A, D, F, H, I y los anexos están actualizados a la revisión.

- **Código:** las 289 `page.tsx` bajo `app/`, los servicios de `lib/services`, el esquema de `db/schema`, el RBAC (`modules/`, `lib/auth`), los primitivos de `components/ui` y los 28 archivos que importan recharts. Lo leyeron cinco pasadas paralelas por dominio, y verifiqué personalmente las afirmaciones que sostienen el Top 10 (ver «Verificaciones propias»).
- **Navegador:** recorridos con Playwright (Chromium del repositorio, sesión QA de `playwright/.auth/monkeytest.json`, `next dev` en `:3001`). En cada ruta se midieron tablas visibles, filas, columnas, gráficos visibles (`svg.recharts-surface`), tiles de KPI (`[data-kpi-card]`), cifras en el contenido y errores de consola.
  - Primera pasada: las **198 rutas estáticas** sobre la base de desarrollo de entonces.
  - Revisión: las mismas 198 más **27 fichas** (`[id]`) con registros reales o simulados, sobre el clon poblado. Las capturas se anonimizaron (sección H).
- **Datos:**
  - **Producción:** restore íntegro del dump de producción del 2026-11-02 en una base local aislada, consultado sólo con conteos, rangos de fecha y percentiles (Anexo B).
  - **Desarrollo:** el clon de producción más datos simulados (ids `mock-…`), usado sólo para ver las pantallas con datos.

**Qué no se pudo verificar (brechas de cobertura)**

| Brecha | Causa | Efecto en el informe |
|---|---|---|
| Frecuencia de **consulta** | No existe registro de lecturas ni de visitas a páginas. | La frecuencia se estimó por la actividad de **escritura** en producción ([Ep], Anexo B); subestima las pantallas sólo de lectura (reportes, analítica, facturación), que conservan [S]. |
| Gráficos de módulos sin datos en producción | Mantención, higiene, incidentes, CAPA, permisos, cargas en terreno y TI tienen 0 filas en producción. | Se observaron con **datos simulados**; la forma de la pantalla es real, las cifras no. Lo declaran las capturas y la tabla D.5. |
| Pantallas de entrada de datos y modales | El recorrido no abre modales, pestañas inactivas ni pliegues `<details>`, y no ejecuta acciones. | Los gráficos plegados (combustible, pagos) se auditaron por código. |
| Roles distintos del QA | La sesión QA tiene los roles amplios. | La visibilidad por rol se auditó por código (RBAC, sección E). |
| `/flota/monitoreo` | La pantalla del mapa no llega a «red inactiva» en el entorno (teselas externas sin internet) y se cortó por tiempo. | Auditada por código; sin datos GPS en producción de todos modos. |
| Entorno de la primera pasada | En la primera pasada, `/flota` y `/mantencion/*` fallaban porque a la base de desarrollo le faltaba la migración 0369. Era un problema del entorno, no del producto, y quedó resuelto antes de la revisión. | Ninguno en la versión actual. |

**Convenciones:** **[E]** = evidencia (código leído, consulta o navegador); **[S]** = supuesto o inferencia. Las rutas de pantalla omiten el grupo `(app)`. Los enlaces a archivos son relativos a la raíz del repositorio.

**Antecedente:** la auditoría `AUDITORIA_DASHBOARD_COBERTURA_GERENCIA_2026-07-31.md` (hoy fuera del árbol, commit `652524356`) ya reestructuró `/dashboard`, y el rediseño de octubre (`aa1c1cab`) lo llevó al patrón de panel único. **Por eso este informe se concentra en los módulos, no en el tablero**, que hoy es la mejor referencia interna.

---

## A. Diagnóstico ejecutivo

### Qué tan dependiente es Chome de tablas y cifras

Medido en el navegador sobre las 193 rutas estáticas que cargaron **[E]**:

| Medida | Valor |
|---|---|
| Rutas con al menos una tabla visible | **91** (47 %) |
| Rutas con al menos un gráfico visible en su estado inicial | **6** (3 %), y 3 de ellas son redirecciones a la misma bandeja (`/combustibles/revisar`) |
| Rutas con tabla y **sin** gráfico | **90** |
| Gráficos visibles en total | 20 |
| Tablas visibles en total | 97 (1.363 filas) |
| Cifras numéricas en el contenido | ≈ 20.000, de las cuales 11.558 están en una sola pantalla (`/prevencion/capacitacion`) |

Desglose por módulo **[E]**:

| Módulo | Rutas | Con tabla | Con gráfico visible | Tablas | Gráficos | Tiles KPI |
|---|---|---|---|---|---|---|
| Combustibles | 55 | 15 | 3* | 17 | 15* | 8 |
| Prevención | 47 | 22 | 1 | 23 | 2 | 4 |
| Admin | 39 | 27 | 0 | 28 | 0 | 4 |
| TI | 10 | 8 | 1 | 9 | 2 | 4 |
| Facturación | 8 | 4 | 0 | 4 | 0 | 4 |
| Bodega | 6 | 4 | 0 | 4 | 0 | 4 |
| Resto (compras, recepción, solicitudes, seguimiento, control operacional, entregas, pendientes, mantención…) | 28 | 11 | 1 (`/dashboard`) | 12 | 1 | 19 |

\* Combustibles: las tres rutas con gráfico son `/combustibles/anomalias`, `/revision` y `/revisar`, que redirigen a la misma bandeja. Sus otros 18 gráficos están **plegados** (`<details>`) o vacíos en desarrollo.

**Con datos (revisión del 2026-11-03).** El mismo recorrido sobre el clon de producción poblado da casi la misma proporción. Se descartaron 35 rutas que eran redirecciones a otra ya medida **[E]**:

| Medida | Primera pasada (base de desarrollo) | Revisión (clon poblado) |
|---|---|---|
| Rutas estáticas únicas medidas | 193 | 163 |
| Con tabla visible | 91 | 94 |
| Con gráfico visible al abrir | 6 | **7** (4 %): `/dashboard`, `/analitica`, `/ti`, `/mantencion/panel`, `/combustibles/revisar`, `/combustibles/consumo/litros` y `…/motor-en-vacio` |
| Tabla sin gráfico | 90 | 90 |
| Fichas `[id]` medidas | — | 27, y sólo **1** con gráfico (`/combustibles/consumo/equipos/[id]`) |
| Errores de consola | — | 3, todos de la CSP que bloquea el estilo del mapa de `/flota/monitoreo` (Anexo C, C-11) |

Con datos, aparecieron gráficos donde antes había estados vacíos (consumo de combustible, analítica, mantención). Aun así, **la proporción no cambia**: la plataforma muestra una tabla en 6 de cada 10 pantallas y un gráfico en menos de 1 de cada 20, y las fichas de detalle casi no dibujan nada.

### Cuánto de lo que se propone tiene datos hoy

El restore de producción (Anexo B) muestra **dos plataformas**:

- **Adquisiciones, bodega y entregas, MIPER, facturación y combustible (Copec)** tienen datos reales y uso diario o semanal. Ahí las visualizaciones se pueden hacer ya.
- **Prevención SST** (indicadores DS 44, incidentes, CAPA, higiene, CPHS, permisos, requisitos legales), **mantención**, **TI** y las **cargas de combustible en terreno** tienen 0 o casi 0 filas. El programa PDTP 2026 está en borrador.

Por eso la sección F separa lo que más mejora **hoy** de lo que más mejorará **cuando cada módulo esté en uso**, y la hoja de ruta agrega una fase de datos y adopción (I, Fase 0b). Construir hoy los gráficos de la segunda lista produce pantallas vacías.

**El número sobrestima el problema en un sentido y lo subestima en otro.** Lo sobrestima porque gran parte de esas 90 rutas son bandejas de trabajo, catálogos y registros donde la tabla **es** la herramienta correcta (ver la sección J). Lo subestima porque la mayoría de los gráficos que existen **no se ven sin una acción**:

- Combustibles guarda más de 10 gráficos en pliegues.
- Pagos los esconde bajo la tabla.
- Material y ambiental los pone en una pestaña.
- Consumo los deja detrás de un estado vacío por período.

Hay, por tanto, dos defectos distintos:

1. **Ausencia real de gráficos donde la pregunta es temporal o comparativa.** Pasa en indicadores de seguridad, incidentes, CAPA, capacitación, reportes, facturación, bodega, seguimiento y mantención.
2. **Gráficos presentes pero mudos o escondidos.** No tienen meta, nombre accesible, leyenda ni marca de mes parcial, el color no significa nada o están detrás de un clic.

### Los diez problemas principales de presentación

1. **El tiempo casi nunca se dibuja.** Los indicadores DS 44 (`/prevencion/indicadores`), la siniestralidad (`/prevencion/incidentes`), el backlog CAPA, el flujo de abastecimiento y la cobranza son series mensuales que se muestran como tablas o como una cifra única. El tablero sí dibuja la serie SST; la página del dominio no **[E]**.
2. **Los programas anuales se muestran como listas, no como calendarios.** `/prevencion/capacitacion` renderiza **2.730 tarjetas** de casillas en una página (verificado en el navegador). El hueco que importa («este mes, en esta faena, no se hizo») sólo se encuentra filtrando. El mismo patrón se repite en CPHS, alcotest, emergencias, higiene, CGRD y cierres PDTP **[E]**.
3. **Cifras sin período ni comparación.** Hay tiles con períodos mezclados en la misma fila (PDTP: ejecutadas del año, pendientes del mes, atrasadas del período) y casi ningún `Delta` fuera del tablero **[E]**.
4. **Cifras que no cuadran o mienten.**
   - «Total eventos» ignora la faena elegida (material y ambiental).
   - Los tiles de `/seguimiento` no son excluyentes, pero parecen sumarse.
   - En `/reportes` la misma cifra aparece 3 veces y se cuentan recepciones anuladas.
   - `/analitica` pinta en rojo una baja del gasto (verificado en el navegador).
   - `/analitica` y el tablero fechan el gasto con criterios distintos.

   **[E]** en todos los casos.
5. **Gráficos con umbrales propios en vez de la meta del negocio.** El avance PDTP por faena usa 80/50 fijos e ignora `indicators.target`, y con ejecución cero **se ve vacío**: barras de 0 % sin rótulo (verificado en la captura) **[E]**.
6. **Color sin significado.** `lib/chart-palette.ts` mezcla tres tokens con **8 hex fijos**. `/analitica`, `anomaly-distribution-chart` (con una torta) y `evolution-by-vehicle-chart` asignan un color por barra o regla que no codifica nada, contra la regla de `RankedList` de `AGENTS.md` **[E]**.
7. **Accesibilidad desigual de los gráficos.** Cinco archivos no tienen nombre accesible: analítica, anomalías, `fuel-charts`, material y ambiental, y PDTP. **Ningún** gráfico ofrece alternativa en tabla salvo uno de mantención (`chart-data-table.tsx`, un `<details>` «Ver datos»). `fuel-charts.tsx` usa tokens base como color de texto de los ejes (regla 8) **[E]**.
8. **Callejones sin salida.** Fuera del tablero y de tres gráficos de combustible, hacer clic en un gráfico no lleva a nada. El patrón «indicador → gráfico → desglose → registros» existe en el tablero y casi en ningún módulo **[E]**.
9. **La confianza en el dato no se ve.** Hay tres casos **[E]**:
   - **Control operacional:** muestra **disponibilidad 100 %** con una **cobertura de estado de 20,8 %** en la misma fila (captura del navegador).
   - **Fuentes de combustible:** la cobertura sólo se describe en frases.
   - **Copec:** en `fuel_provider_transactions` conviven filas `transaction` y `period_aggregate`, estas últimas con 45 filas fechadas en el centinela 2020-01-01 en `bodega_dev`. Un gráfico que las sume duplicaría el volumen.
10. **Consultas analíticas escritas y no usadas.** `getIncidentAnalyticsData`, `getTicketsByMonth`, `getTicketsByCategory`, `getAssetsByAge` y `getFleetGpsHistory` tienen **0 llamadores** (grep). Además, `summary.monthly` de facturación se consulta y no se dibuja **[E]**.

### Qué está bien y debe preservarse

- **`/dashboard`** es una referencia sólida: panel único por grupo, `Delta`, `RankedList` de un tono, carga diferida con skeleton y `ChartErrorBoundary`, y `useChartMotion` respetando `prefers-reduced-motion`.
- **El panel de combustible** (`/combustibles`) responde con frases y deja el gráfico como apoyo.
- **`equipment-performance-chart.tsx`** es el mejor gráfico de la plataforma: tiene rango normal como `ReferenceArea`, punto fuera de rango marcado y una descripción accesible rica. **Es el modelo a imitar.**
- **El árbol causal RE-20** (`causal-diagram.tsx`) es SVG con `role="img"`, `<title>`, sólo tokens y una descripción textual equivalente.
- **Las bandejas** (`/pendientes`, `/combustibles/revisar`, `/aprobaciones`) están bien resueltas como listas.

**Conclusión:** Chome no necesita «más gráficos». Necesita:

1. **dibujar el tiempo** donde la pregunta es una tendencia;
2. **un calendario** donde la pregunta es «qué casilla falta»;
3. **corregir y hacer navegables** los gráficos que ya existen;
4. **una base de componentes y una paleta** que obliguen a eso.

La mitad de las propuestas de mayor puntaje no requieren backend.

---

## B. Inventario completo de pantallas

Prioridad: **P1** ≥ 75 · **P2** 65–74 · **P3** 55–64 · **P4** < 55 · **Mantener**: la tabla, el formulario o la lista ya es la forma correcta (ver la sección J). Las rutas de redirección se agrupan al final. La «medición» entre corchetes viene del recorrido en navegador **[E]**.

### Inicio, pendientes y transversales

| Módulo | Pantalla | Representación actual | Problema identificado | Oportunidad | Prioridad |
|---|---|---|---|---|---|
| Inicio | `/dashboard` (8 vistas) | Paneles, tiles con `Delta`, 1 gráfico visible en Resumen; varios gráficos por vista | Ningún gráfico tiene tabla alternativa; los nombres accesibles son genéricos; los gráficos de recharts no navegan; flota usa 6 meses fijos; mantención casi ausente (sólo «OT abiertas») | Llevar el patrón «Ver datos» y el drill-down a sus gráficos; vista o bloque de mantención (sección E) | P2 |
| Pendientes | `/pendientes` | Bandeja con filtros rápidos [1 tabla, 50 filas] | — | Mantener. Opcional: antigüedad de lo vencido por módulo | Mantener |
| Perfil | `/perfil` | Formularios | — | — | Mantener |
| Soporte | `/soporte`, `/[id]`, `/nuevo` | Lista, detalle, formulario | — | — | Mantener |

### Prevención

| Módulo | Pantalla | Representación actual | Problema identificado | Oportunidad | Prioridad |
|---|---|---|---|---|---|
| Prevención | `/prevencion` (inicio) | Cola de atención y lista de módulos | — | Mantener (es una bandeja) | Mantener |
| PDTP | `/prevencion/pdtp` | 4 tiles, un área de tendencia, barras por faena y «eje» en texto [2 gráficos] | Períodos mezclados; no muestra la meta; % descartado; barras de 0 % invisibles; área sobre conteos | CHART-004 | P1 |
| PDTP | `/pdtp/[programId]` | Tiles, tabla mensual plegada, grilla | La serie mensual sólo existe en tabla | CHART-004 (O4b) | P1 |
| PDTP | `/pdtp/[programId]/reporte` | Tabla de 9 columnas | Desviaciones sin desvío declarado escondidas; meta oculta | CHART-005 | P1 |
| PDTP | `/pdtp/[programId]/cierres` | Tabla mes × faena | Los meses faltantes no se ven | CHART-008 | P1 |
| PDTP | `/pdtp/actividades` | Grilla de captura semanal o anual | — | Mantener (captura) | Mantener |
| PDTP | `/pdtp/acciones` | Tabla de 10 columnas | Tabla larga sin resumen | CHART-003 | P2 |
| PDTP | `/pdtp/cobertura` | Tira de 4 cifras y listas | — | CHART-015 | P3 |
| PDTP | `/pdtp/aplicabilidad`, `/aprobaciones`, `/obligaciones`, `/programas`, `/plantillas`, `/nuevo`, `/[id]/editar`, `/[id]/habilitacion`, `/[id]/ejecucion/[id]`, `/[id]/cierres/[id]` | Configuración, colas, formularios, snapshots | — (`/pdtp/aprobaciones` mostró un error de hidratación en `pdtp-evidence-thumbs.tsx:112`, ajeno a la visualización) | Mantener | Mantener |
| Indicadores | `/prevencion/indicadores` | 4 cifras y 3 pestañas de tablas [1 tabla de 12 filas × 6 columnas, 0 gráficos] | Sin gráfico; cifras de períodos distintos; faena en estado local | CHART-001 | P1 |
| Indicadores | `/prevencion/indicadores-material-ambiental` | 4 cifras, tabla, 4 gráficos en otra pestaña | Total que ignora la faena; 3 gráficos redundantes; `monotone` sobre conteos | CHART-006 | P3 (bug: inmediato) |
| Incidentes | `/prevencion/incidentes` | 4 tiles, 3 selects y DataTable | Sin gráfico; tiles que ignoran los filtros; A5 | CHART-002 | P2 |
| Incidentes | `/incidentes/[id]`, `/reportar`, `/configuracion` | Expediente RE-20 con árbol causal SVG, formulario, configuración | — | Mantener (el árbol causal es un modelo) | Mantener |
| CAPA | `/prevencion/capa` | 4 tiles y una tabla de 6 columnas | Sin antigüedad ni tendencia; A5 | CHART-003 | P2 |
| CAPA | `/capa/[id]` | Ficha | — | Mantener | Mantener |
| MIPER | `/prevencion/miper` | Franja de 4 cifras y DataTable [18 filas] | Sólo 2 de 4 niveles de riesgo | CHART-007 (portafolio) | P1 |
| MIPER | `/miper/[id]` | SummaryBar, barras `Progress`, matriz | Sin distribución P×C | CHART-007 | P1 |
| MIPER | `/miper/controles/[id]`, `/miper/factores` | Ficha, catálogo | — | Mantener | Mantener |
| CGRD | `/prevencion/cgrd` | Workbench con listas | Casillas como lista | CHART-008 | P1 |
| CGRD | `/cgrd/mapa` | Plano con peligros | — | Mantener (ya es visual) | Mantener |
| Capacitación | `/prevencion/capacitacion` | Chips de estado y **2.730 tarjetas** [11.558 cifras] | Lista sin forma temporal; el hueco no se ve | CHART-008 | P1 |
| CPHS | `/prevencion/cphs` | 4 cifras inertes, pestañas y tablas | Cifras no accionables (A1); no se ve la cadencia de sesiones | CHART-008 | P1 |
| CPHS | `/cphs/[committeeId]` | Datos y tablas | La asistencia no se agrega | CHART-015 | P3 |
| CPHS | `/cphs/[id]/programa` | 4 tiles y tabla por mes | Sin forma mensual | CHART-008 / 015 | P1 |
| CPHS | `/cphs/[id]/certificacion` | 4 tiles y tabla | Tile duplicado («Plazo de brechas») | CHART-015 | P3 |
| Alcotest | `/prevencion/alcotest` | 30 artículos y hasta ~52 tarjetas de casillas | Carga la tabla entera en JS; sin período | CHART-008, CHART-010 | P1 |
| Inspecciones | `/prevencion/inspecciones` | 4 tiles y tabla paginada | Sin tendencia de cumplimiento | CHART-010 | P2 |
| Inspecciones | `/inspecciones/seguimiento` | DataTable con barra `Progress` | — | Mantener (tabla de trabajo) | Mantener |
| Inspecciones | `/inspecciones/programacion` | Tabla de programas con próxima fecha | Fechas futuras sin vista temporal | CHART-012 | P2 |
| Inspecciones | `/inspecciones/plantillas`, `/[runId]` | Catálogo, captura | — | Mantener | Mantener |
| Higiene | `/prevencion/higiene` | 4 tiles, pestañas, tablas, casillas | «Última medición» como badge | CHART-009 (lista), CHART-008 | P1 |
| Higiene | `/higiene/grupos/[groupId]` | Tabla de mediciones | Serie temporal como tabla | CHART-009 | P1 |
| Higiene | `/higiene/programas/[programId]` | Tabla de matriculados | Vencimientos como fechas sueltas | CHART-012 | P2 |
| Emergencias | `/prevencion/emergencias` | 4 tiles, 4 cifras de recursos, DataTable | 8 cifras arriba; totales sin faena ni fecha | CHART-012, CHART-008 | P2 |
| Emergencias | `/emergencias/[planId]` | 5 tablas y casillas | Vencimientos de recursos sin vista temporal | CHART-012 | P2 |
| Permisos | `/prevencion/permisos` | 4 tiles y DataTable | La ventana horaria se lee como texto | CHART-014 | P2 |
| Permisos | `/permisos/[permitId]` | Ficha | — | Mantener | Mantener |
| PPA | `/prevencion/ppa` | SummaryBar, 3 `RankPanel` locales, tabla | Histórico sin período; ranking por conteo absoluto; A5 | CHART-011 | P2 |
| PPA | `/ppa/[id]` | Ficha | — | Mantener | Mantener |
| Legal | `/prevencion/requisitos-legales` | 4 tiles-enlace y pestañas de tarjetas | Requisito × faena exige abrir N tarjetas; los anclajes a pestañas probablemente no navegan [S] | CHART-013 | P2 |
| Legal | `/requisitos-legales/[id]` | Ficha | — | Mantener | Mantener |
| Documentación | `/prevencion/documentacion` (+ `[id]`, papelera, regularización) | Explorador y tira de vencimientos | Vencimientos sólo a 7/15/30 días | CHART-012 | P2 |
| EPP preventivo | `/prevencion/epp-preventivo` | Pestañas y tablas | Sin agregación por EPP | CHART-015 | P3 |
| Faenas | `/prevencion/faenas`, `/[worksiteId]` | 4 tiles y tabla | El umbral de dotación es texto | CHART-015 | P3 |
| Evaluaciones | `/prevencion/evaluaciones` | Tabla por trabajador | Corte en 50 filas sin paginación ni aviso | Mantener la tabla y paginar | Mantener |
| Evaluaciones | `/prevencion/[id]`, `/nueva`, `/trabajador/[workerId]` | Detalle, formulario, historial | El historial se carga y se descarta | CHART-015 (sparkline) | P3 |
| Constancias | `/prevencion/constancias` | 2 tiles y tarjetas | Tiles y `Select` para la misma dimensión (A5) | Quitar uno de los dos controles; mantener | Mantener |
| Campañas | `/prevencion/campanas` | Tabla | No hay fecha programada en el esquema | Mantener | Mantener |
| Coordinación | `/prevencion/coordinacion`, `/[id]` | Tabla de fiscalizaciones | — | Mantener (registro) | Mantener |
| Privacidad | `/prevencion/privacidad` (+ solicitudes, `[id]`, auditoría) | Tablas | `.slice(0,10)` en vez de `formatDate` | Mantener (evidencia legal) | Mantener |

### Combustibles, flota y control operacional

| Módulo | Pantalla | Representación actual | Problema identificado | Oportunidad | Prioridad |
|---|---|---|---|---|---|
| Combustibles | `/combustibles` (panel) | Frases, cifras con `Delta`, mini-barras CSS de 5 períodos | — | Mantener (bien resuelto) | Mantener |
| Consumo | `/combustibles/consumo/litros` | Frase-respuesta, 4 gráficos y pliegues con más de 10 gráficos [revisión: 10 gráficos visibles con datos simulados; en producción, 0 cargas en terreno] | La tasa no se grafica; mes parcial sin marca | CHART-016, CHART-022 | P1 |
| Consumo | `/consumo/rendimiento/[familia]` | Tabla paginada, `RankedList`, gráfico plegado | Desviaciones leídas fila por fila | CHART-017 | P1 |
| Consumo | `/consumo/equipos/[id]` | SummaryBar, 2 gráficos (modelo a imitar), tabla | El vacío como 5 cifras | CHART-024 | P3 |
| Consumo | `/consumo/motor-en-vacio` | 3 gráficos y 4 tablas | Telemetría contra cargas como tabla | CHART-021 | P2 |
| Cargas | `/combustibles/cargas`, `/cargas/tarjetas`, `/cargas/[origen]/[id]`, `/historial`, `/registrar` | Bitácoras, fichas, formulario | — | Mantener (registro operativo) | Mantener |
| Cuadratura | `/cuadratura/estanques` | 4 `KpiCard`, gráfico duplicado, 2 tablas [1 tabla, 4 tiles] | A5; nivel contra capacidad en tabla | CHART-020 | P2 |
| Cuadratura | `/cuadratura/mandante` | 2 tablas | Meses fuera de tolerancia como filas | CHART-019 | P1 |
| Cuadratura | `/cuadratura/proveedor` | Tabla | Pares de cifras | CHART-019 | P1 |
| Cuadratura | `/cuadratura/sellos` | Tabla, `RankedList`, 2 gráficos plegados | Cadena rota sólo como filas | Mantener (auditoría) | Mantener |
| Cuadratura | `/cuadratura/tarjeta-y-terreno` | `SegmentedControl` y tabla | Sin vista de cobertura por mes | Opcional: 100 % apilado por mes | P3 |
| Revisión | `/combustibles/revisar` | Bandeja, `RankedList`, torta y barras plegadas [5 gráficos] | Color sin significado; conteo duplicado; sin tendencia | CHART-023 | P2 |
| Fuentes | `/combustibles/fuentes`, `/fuentes/archivos` | Tarjetas de texto y tabla | Cobertura en frases | CHART-022 | P2 |
| Pagos | `/combustibles/pagos` | Frase, tabla y 4 gráficos plegados | Gráficos escondidos; el precio cae a 0 cuando no hay litros | Mantener la tabla; corregir el gráfico (sección C) | P3 |
| Pagos | `/pagos/estados` (+ `[id]`), `/pagos/nueva` | Frase y tabla | La antigüedad de la deuda sólo en texto | Barra por tramo de vencimiento (Disponible) | P3 |
| Ajustes | `/combustibles/ajustes/*` (7) | Catálogos y reglas | — | Mantener | Mantener |
| Flota | `/flota` | SummaryBar y tabla [1 tabla de 25 filas × 7 columnas] | Cifras a 12 meses sin contexto | Mantener la tabla | Mantener |
| Flota | `/flota/[id]` | Datos, listas, efecto de OT como «a → b» | Sin unidad; dos fuentes de rendimiento distintas; **sin datos, «Rendimiento» muestra sólo «km/L» sin valor** (verificado en el navegador) | CHART-018 | P2 |
| Flota | `/flota/monitoreo` | Mapa MapLibre y tabla | La pestaña Historial no lleva a ningún historial | CHART-028 | P4 |
| Control operacional | `/control-operacional` | 4 tiles, SummaryBar, tabla de **16 columnas**, fuentes [1 tabla de 25 filas, 4 tiles] | **Disponibilidad 100 % con 20,8 % de cobertura**; sin tendencia | CHART-025; mantener la tabla | P2 |

### Mantención

| Módulo | Pantalla | Representación actual | Problema identificado | Oportunidad | Prioridad |
|---|---|---|---|---|---|
| Mantención | `/mantencion/panel` | 4 KPI, lista de taller, tabla de próximas, barras CSS de estado, gráfico semanal con «Ver datos», `RankedList` | Sin OT, disponibilidad ni MTTR; «próximas» en lecturas no comparables; **«Mantenciones vencidas: 0» cuando ningún equipo es evaluable** (A1: un tile vacío debe mostrar la acción, no «0»; verificado en el navegador) | CHART-027, CHART-026, CHART-025 | P1 |
| Mantención | `/mantencion/ot`, `/ot/[id]` | StageTabs con contadores, tabla de 9 columnas, ficha | — | Mantener (los contadores ya están en las pestañas) | Mantener |
| Mantención | `/mantencion/equipos/[id]` | Cifras sueltas, hoja de vida de 8 columnas, OT | La progresión de lecturas sólo en filas | CHART-018 | P2 |
| Mantención | `/mantencion/equipos`, `/nuevo`, `/importar`, `/registros`, `/registros/[id]`, `/pautas`, `/pautas/[id]`, `/dispositivos` | Catálogos, colas, matriz de pauta | — | Mantener | Mantener |
| Mecánico | `/m/mantencion` (PWA) | Listas táctiles | — | Mantener (captura en terreno) | Mantener |

### Abastecimiento, bodega y finanzas

| Módulo | Pantalla | Representación actual | Problema identificado | Oportunidad | Prioridad |
|---|---|---|---|---|---|
| Analítica | `/analitica` | 4 KPI, 4 gráficos, listas, 4 rankings en tabla [revisión: 3 gráficos y 4 tablas con datos reales; combustible en $0] | Color sin significado (verificado); tendencia de un solo punto con la ventana por defecto; combustible en $0 en producción (C-9); sin leyenda; base de fecha distinta del tablero; delta invertido | CHART-033, CHART-029, CHART-034 | P2 |
| Reportes | `/reportes` | 4 tiles y listas de texto [0 tablas, 39 cifras] | Cifra triple; anuladas contadas; sin período; UUID | CHART-032 | P2 |
| Bodega | `/bodega` (stock y kardex) | Tabla agrupada (hasta 2.000 filas) y kardex | Sin cobertura ni tendencia | CHART-035 | P2 |
| Bodega | `/bodega/guias`, `/[id]`, `/nueva`, `/editar` | Tabla, detalle, formularios | Sin tiempo en tránsito | CHART-037 | P3 |
| Bodega | `/bodega/documentos` | Tabla | — | Mantener | Mantener |
| Bodega | `/bodega/trazabilidad/trabajador/[workerId]` | Hoja de vida EPP | Vida útil no visible (dato personal) | Opcional, de baja prioridad | P4 |
| Entregas | `/entregas` | Estación de entrega y tabla [25 filas] | — | Mantener (registro con firma) | Mantener |
| Recepción | `/recepcion`, `/[id]`, `/nueva` | Cola por etapa, detalle, formulario | La antigüedad desde el envío no se ve | Mantener; agregar columna «días desde envío» | Mantener |
| Compras | `/compras` | Colas por etapa | — | Mantener | Mantener |
| Compras | `/compras/[id]` | Tabla OC/recibido/facturado y conciliación en cifras | — | Opcional: bullet OC contra recibido contra facturado | P3 |
| Compras | `/compras/dte` | Tabla con tope de 300 | El tope oculta volumen | CHART-034 | P2 |
| Compras | `/compras/nueva`, `/solicitudes/nueva` | Formularios | — | — | Mantener |
| Solicitudes | `/solicitudes` | Lista por etapa | — | Mantener | Mantener |
| Solicitudes | `/solicitudes/[id]` | Stepper sin fechas y timeline | Sin duración por etapa | CHART-029 | P2 |
| Aprobaciones | `/aprobaciones` | Cola agrupada | Sólo fecha, sin antigüedad | CHART-030 | P1 |
| Seguimiento | `/seguimiento` | 4 KPI, MetricBar y tabla de 9 columnas | Cifras no excluyentes | CHART-031 | P2 |
| Seguimiento | `/seguimiento/[itemId]` | 6 tablas y timeline | Hay que leer 6 tablas; la factura no aparece | CHART-029 (vista por ítem) | P2 |
| Facturación | `/facturacion` | 4 MoneyStat, tabla de antigüedad, listas | Lo mensual se consulta y se pierde; `toLocaleDateString` | CHART-036 | P1 |
| Facturación | `/facturas`, `/[id]`, `/cobranza`, `/pendientes`, `/propuestas`, `/clientes`, `/duplicados`, `/sincronizacion` | Tablas operativas | — | Mantener (dato tributario por fila) | Mantener |

### TI y administración

| Módulo | Pantalla | Representación actual | Problema identificado | Oportunidad | Prioridad |
|---|---|---|---|---|---|
| TI | `/ti` | 4 KPI, 2 gráficos, bloque de atención [2 gráficos, 2 tablas] | Sin tendencia de tickets ni SLA; consultas sin uso | CHART-038 | P3 |
| TI | `/ti/garantias`, `/ti/licencias` | Chips de banda y tabla | Horizonte como chips | CHART-012 | P2 |
| TI | `/ti/activos`, `/[id]`, `/asignaciones`, `/bajas`, `/mantenciones`, `/accesos`, `/tickets`, `/[id]`, `/reportes` | Tablas, matriz, tarjetas de exportación | — | Mantener | Mantener |
| Admin | `/admin` | Índice y 4 señales | — | Mantener | Mantener |
| Admin | ≈26 catálogos (cargos, productos, proveedores, trabajadores, usuarios, roles, faenas, flota-catálogos…) | DataTable | — | Mantener (datos de referencia) | Mantener |
| Admin | Configuración (módulos, SMTP, DTE, seguridad, parámetros, almacenamiento) | Formularios | — | Mantener | Mantener |
| Admin | `/admin/auditoria` | Tabla [30 filas] | — | Mantener (forense) | Mantener |
| Admin | `/admin/backups`, `/admin/notificaciones` | Tablas | Tendencias de tamaño y volumen sólo en filas | CHART-039 | P4 |
| Admin | Fichas (`contenedores/[id]`, `productos/[id]`, `inventario-faena/[id]`…) | Ficha, tabla, timeline | % de inspección leído en filas | Opcional: sparkline | P4 |

### Rutas sin contenido propio

- 36 redirecciones heredadas de combustibles (`/analisis`, `/anomalias*`, `/bitacora*`, `/control/*`, `/cuenta-corriente*`, `/tae/*`, `/reportes`, …).
- Las redirecciones de `/trazabilidad/**` y `/bodega/trazabilidad/**` hacia `/seguimiento`.
- `/mantencion` (redirige según permiso), `/modulo-inactivo`, `/forbidden`, `/login`, `/recuperar`.

Ninguna de estas rutas es candidata a visualización.

---

## C. Inventario de gráficos existentes

Biblioteca: **recharts 3.9.0 (MIT)** en 28 archivos; `accessibilityLayer` aparece en 12 usos. **MapLibre GL 6.9** se usa en un mapa. El resto son barras CSS y SVG propios. No hay otra biblioteca de gráficos instalada **[E]**.

**Paleta:** `lib/chart-palette.ts` define `CHART_COLORS`, con 3 tokens (`--color-primary`, `--color-signal`, `--color-danger`) y **8 hex** (`#2563eb`, `#7c3aed`, `#0891b2`, `#be185d`, `#d97706`, `#4f46e5`, `#0284c7`, `#64748b`). También define `CHART_SERIES`, que empieza por la marca y sigue por los hex. `app/globals.css` no tiene tokens `--color-chart-*` **[E]**.

**Columnas de la tabla:** Acc. = nombre accesible (✔ sí · ✖ no). Veredicto: **Mantener** · **Mejorar** · **Reemplazar** · **Retirar**.

| Archivo | Tipo | Qué dibuja | Acc. | Color | Interacción | Veredicto |
|---|---|---|---|---|---|---|
| `dashboard/charts/trend-charts.tsx` | Composed (operativa, facturación) | Solicitudes, OC y recepciones; facturado contra cobrado | ✔ genérico | tokens | tooltip | **Mantener**; agregar tabla alternativa y drill-down; mover a `components/charts` para reutilizarlo en `/facturacion` |
| `dashboard/charts/sst-charts.tsx` | Composed ×3 | Tendencia SST, accidentes, material y ambiental | ✔ | tokens | tooltip | **Mantener**; reutilizar en `/prevencion/indicadores` (CHART-001) |
| `dashboard/charts/fleet-charts.tsx` | Composed | Litros y cargas (eje doble) | ✔ | tokens | tooltip | **Mejorar**: ventana configurable (hoy 6 meses fijos) y marca de mes parcial |
| `dashboard/charts/composition-charts.tsx` | Pie (donut) y barra CSS | Gasto por módulo, documentos por estado | ✔ resumen | tokens | — | **Mantener** (≤ 5 partes); vigilar que no crezca |
| `dashboard/charts/debt-aging-chart.tsx` | Flex enlazado | Antigüedad de deuda | ✔ | tokens | enlaces | **Mantener**; reutilizar en `/facturacion` |
| `prevencion/pdtp/pdtp-dashboard-charts.tsx` | Area y Bar | Programadas contra ejecutadas; % por faena | ✖ | tokens y degradado decorativo | tooltip | **Mejorar** (CHART-004): barras + % + meta; quitar degradado; rotular 0 %; nombre accesible |
| `prevencion/indicadores-material-ambiental/material-environmental-charts.tsx` | Bar, Line, Bar apilada, Composed | Los mismos 36 conteos, 4 veces | ✖ | tokens | tooltip | **Reemplazar** por 2 gráficos (CHART-006) |
| `analitica/analytics-charts.tsx` | Line y Bar | Gasto mensual; por tipo; rankings | ✖ | **hex por barra** | tooltip | **Reemplazar**: área apilada con leyenda, `RankedList`, Pareto (CHART-033) |
| `combustibles/consumption-charts.tsx` | Area, Line, Bar ×2 | Monto y litros (eje doble), CLP/L, top patentes, rendimiento | ✔ | tokens | **clic → ficha** | **Mantener**; marcar mes parcial |
| `combustibles/fuel-charts.tsx` | Area y Bar | Monto y precio (eje doble); top categorías | ✖ | **tokens base en texto de ejes** (`--color-info`, `--color-signal`) | clic → filtro | **Mejorar**: usar `-ink` en ejes (regla 8); precio nulo en vez de 0 sin litros; nombre accesible |
| `combustibles/evolution-by-vehicle-chart.tsx` | Line, 8 series | Litros por patente | ✔ | 8 colores, incluidos danger y warning como categorías | leyenda sólo si ≤ 6 | **Reemplazar** por *small multiples* o por resaltar 1 serie sobre el resto en gris |
| `combustibles/anomalias/anomaly-distribution-chart.tsx` | Bar, **Pie**, Bar | Casos por estado, severidad y regla | ✖ | **multicolor sin significado** | tooltip | **Retirar** la torta; reglas en `RankedList` (CHART-023) |
| `combustibles/scatter-charts.tsx` | Scatter | Litros contra km u horas | ✔ | primary | tooltip | **Mantener**; base para CHART-021 |
| `combustibles/control/_charts/overview-monthly-chart.tsx` | Bar apilada | Litros por mes y medio | ✔ | hex de `CHART_COLORS` | tooltip y leyenda | **Mejorar**: paleta categórica con tokens |
| `…/overview-meter-chart.tsx` | Composed | km/h contra litros (eje doble) | ✔ | brand y azul hex | tooltip | **Complementar** con la tasa (CHART-016) |
| `…/overview-ranking-chart.tsx` | Bar horizontal | Faenas por litros | ✔ | brand | tooltip | **Mantener** o pasar a `RankedList` |
| `…/performance-dispersion-chart.tsx` | Composed | Promedio y σ por faena, **eje doble con la misma unidad** | ✔ | brand y azul hex | tooltip | **Mejorar**: un solo eje (es la misma unidad) o barras de error |
| `…/idle-monthly`, `idle-liters`, `idle-daily-chart.tsx` | Composed | Horas, litros y % en vacío (eje doble) | ✔ | tokens | tooltip | **Mantener**; reutilizar `idle-daily` en la ficha (CHART-024) |
| `combustibles/consumo/equipos/[id]/equipment-performance-chart.tsx` | Composed y `ReferenceArea` | Rendimiento carga a carga con rango normal | ✔ rico | tokens | tooltip y etiquetas | **Mantener: es el modelo de la plataforma** |
| `…/equipment-liters-chart.tsx` | Bar | Litros por mes (12 m) | ✔ | brand | tooltip | **Mantener** |
| `combustibles/cuadratura/estanques/cycle-stage-chart.tsx` | Bar | Recibido, registrado, entregado | ✔ | primary | etiquetas | **Retirar** (duplica los tiles, A5) y reemplazar por CHART-020 |
| `combustibles/cuadratura/sellos/group-chart.tsx` | Bar horizontal | Litros por grupo | ✔ | primary | **clic → cargas** | **Mantener** |
| `ti/ti-charts-inner.tsx` | Bar apilada, Composed | Equipos por faena; mantenciones por mes (costo y cantidad) | ✔ `role=img` | tokens | tooltip | **Mantener** |
| `components/mantencion/jefatura/panel/weekly-chart-inner.tsx` | Bar apilada | Registros por semana | ✔ | **hex propios** (`weekly-chart-colors.ts`) | «Ver datos» | **Mejorar**: llevar sus colores a la paleta; **promover** su `ChartDataTable` a `components/ui` |
| `components/ui/chart-interactions.tsx` | Area, Composed | Primitivos interactivos | parcial | tokens | — | **Mantener** |
| `components/ui/chart.tsx` | `ChartContainer` y tooltip | Contenedor estilo shadcn con ejes y grilla en tokens | — | tokens | — | **Mantener**: es la base de la capa común |
| Sin recharts: `mini-sparkline.tsx`, `ranked-list.tsx`, `delta.tsx`, `panel-figures-card.tsx`, `worksite-equipment-heatmap.tsx`, `StatusShareBar`, `RadialTickGauge` | SVG y CSS | Sparklines, rankings, variaciones, matriz | variable (el heatmap no tiene `role`) | tokens | enlaces | **Mantener**: son la base de los primitivos nuevos |
| `prevencion/incidentes/[id]/re20/.../causal-diagram.tsx` | SVG propio | Árbol causal | ✔ ejemplar | tokens | — | **Mantener** (modelo de accesibilidad) |
| `pdtp-sheet-table-ui.tsx:121` `PdtpProgressRing` | SVG | Anillo de progreso | `aria-hidden` | umbrales fijos | — | **Retirar** (sin usos) |
| `flota/monitoreo/fleet-gps-map.tsx` | MapLibre, clusters | Última posición | sección rotulada; la tabla es la alternativa | **hex** `#005c3f`, `#64748b`, `#ffffff` | clic → estado | **Mejorar**: tokens, antigüedad de la posición, estilo de teselas de producción |

**Defectos transversales [E]:**

- **Mes parcial:** ningún gráfico de combustible marca el mes en curso como parcial (grep «parcial» = 0 en los archivos de gráficos).
- **Precio cero:** `fuel-charts.tsx:27` convierte el precio en 0 cuando no hay litros.
- **Tabla alternativa:** sólo un gráfico de la plataforma la ofrece.
- **Leyendas:** no hay una política de leyenda; `/analitica` no la tiene y `evolution-by-vehicle` la oculta con más de 6 series.
## D. Catálogo de oportunidades

### Cómo se puntúa

Cada ficha suma seis criterios (máximo 100). Junto a cada componente se marca su respaldo:
**[E]** evidencia leída en código, base de datos o navegador; **[S]** supuesto razonado.

| Criterio | Máx. | Cómo se asigna |
|---|---|---|
| Comprensión | 25 | Cuánto acorta pasar de la representación actual a la respuesta. 20+ cuando hoy la respuesta exige leer filas o sumar de cabeza; <12 cuando el cambio es cosmético. **[E]** sobre la pantalla actual, **[S]** sobre el efecto. |
| Decisión | 25 | Si la vista cambia una acción concreta (a quién llamar, qué equipo detener, qué pagar). 20+ sólo si la decisión está nombrada en la pantalla o en el dominio. **[S]** salvo que el flujo esté en el código. |
| Frecuencia | 15 | **Siempre [S]: no hay telemetría de uso en el repositorio.** Se estima por la naturaleza de la pantalla: bandeja diaria 12–15, revisión semanal 8–11, cierre mensual 5–7, configuración 0–3. Debe recalibrarse con datos de acceso. |
| Datos | 15 | Disponible 13–15 · Requiere procesamiento 10–12 · Requiere desarrollo backend 6–9 · Requiere nuevos datos 0–5. Se descuenta por problemas de calidad conocidos. **[E]**. |
| UX/visual | 10 | Mejora de jerarquía, coherencia con el sistema y accesibilidad. **[S]** acotado por las reglas de `AGENTS.md`. |
| Facilidad | 10 | 9–10 si reutiliza un componente existente; 5–8 si hay que construir el gráfico sobre datos ya cargados; ≤4 si exige consultas nuevas, migración o un primitivo nuevo. **[E]** sobre el código. |

Prioridad: **P1** ≥ 75 · **P2** 65–74 · **P3** 55–64 · **P4** < 55.

**Revisión del 2026-11-03 con datos de producción.** La primera pasada midió volumen en `bodega_dev` y estimó la frecuencia. La revisión consultó un restore íntegro de producción (dump del 2026-11-02, sólo lectura, sin datos simulados) y cambió dos criterios:

- **Datos (15), ahora [E] de producción.** La clase del modelo (Disponible / Procesamiento / Backend / Nuevos datos) se mantiene, pero se acota por lo que realmente hay registrado: una serie con al menos 3 meses o cientos de filas no tiene tope; datos escasos (pocas filas o menos de 3 meses) quedan en 8 como máximo; una tabla vacía o casi vacía queda en 3 como máximo, aunque el modelo la soporte. Un gráfico sin datos es una pantalla vacía.
- **Frecuencia (15), ahora [Ep] = evidencia parcial.** No existe ningún registro de lecturas o visitas a páginas: se usó la **actividad de escritura** de los últimos 60 días (`audit_log`, `operational_activity_events`) por módulo y por usuarios distintos. Mide uso de captura, no de consulta, así que subestima pantallas sólo de lectura (reportes, analítica, facturación), que conservan [S].

Cada ficha muestra el puntaje revisado, el de la primera pasada y lo que hay en producción. La primera pasada sigue siendo la mejor medida del **potencial** de una propuesta cuando su módulo esté en uso (ver la sección F).

Clases de disponibilidad (requeridas por el encargo):
**Disponible** (la página ya carga el dato) · **Procesamiento** (el dato existe y falta agregarlo) ·
**Backend** (falta una consulta o un servicio) · **Nuevos datos** (hoy no se registra).

Convención de rutas: las rutas de pantalla omiten el grupo `(app)`; los enlaces a archivos son relativos a la raíz del repositorio.

---

### D.1 Prevención

#### CHART-001: Tendencia de tasas DS 44 en Indicadores

- **Módulo:** Prevención › Indicadores
- **Pantalla:** Indicadores de accidentabilidad
- **Ruta:** `/prevencion/indicadores`
- **Archivos y líneas:** [canonical-indicators-dashboard.tsx:97-158](app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx#L97-L158) (tira de 4 cifras y 3 pestañas de tablas); serie ya calculada en `getCanonicalSafetyIndicatorYear` ([prevention-indicadores.ts:361](lib/services/prevention-indicadores.ts#L361)); fórmulas en [safety-indicators-calc.ts:235-236](lib/prevention/safety-indicators-calc.ts#L235-L236); gráfico reutilizable `SstTrendChart` en [sst-charts.tsx:128](app/(app)/dashboard/charts/sst-charts.tsx#L128).
- **Representación actual:** cuatro cifras de períodos distintos (accidentabilidad anual, frecuencia del último mes con horas hombre (HH), gravedad semestral) y tres pestañas con tablas. **Ningún gráfico**: verificado por grep y en el navegador.
- **Problema:** la pregunta de la pantalla («¿la siniestralidad mejora o empeora, y en qué faena?») exige leer 12 filas por faena. La serie existe y el tablero `/dashboard` la dibuja, pero la página propia del dominio no. Las cifras no tienen período anterior.
- **Visualización recomendada:** líneas de tasa de frecuencia (TF) y tasa de gravedad (TG) por mes, con **eje doble** (regla A5b: escalas distintas), y barras tenues de lesionados como contexto. Los puntos `provisional` van con marcador hueco y los `confirmed` con marcador lleno. Debajo va una `RankedList` de TF anual por faena (un solo tono) que filtra la tabla.
- **Datos y campos necesarios:** `prevention_incident_people` (días de ausencia y de cargo, [incidents.ts:66](db/schema/prevention/incidents.ts#L66)); `safety_indicator_denominators.worker_count`, `worked_hours` ([safety-indicators.ts:49-55](db/schema/prevention/safety-indicators.ts#L49-L55)); `prevention_incidents.occurred_at`, `worksite_id`.
- **Fórmula o agregación:** TF = lesionados × 1.000.000 / HH. TG = (días de ausencia + días de cargo) × 1.000.000 / HH. Agregación por mes calendario y faena, en unidades × 10⁶ HH. **Nulos:** HH = 0 da tasa nula y se dibuja como hueco, nunca como 0. Comparación: el mismo mes del año anterior (el selector de año ya existe).
- **Disponibilidad de datos:** **Disponible** (`view.groups[].monthly[]` ya llega a la página).
- **Filtros e interacciones:** el selector de faena y año existente (hoy en estado local; debe pasar a la URL con `router.replace(…, { scroll:false })`). Tooltip con n de lesionados, HH y estado provisional o confirmado. Clic en un mes enfoca la fila de la tabla «Cálculo mensual».
- **Beneficio funcional:** distingue tendencia de ruido y muestra qué faena arrastra el indicador.
- **Beneficio visual:** la pantalla deja de ser tres tablas de cifras sin forma.
- **Requisitos técnicos:** importar `SstTrendChart` y `toSstMonthlyPoints` ([sst-monthly-points.ts:32](app/(app)/dashboard/sst-monthly-points.ts#L32)) desde el tablero. Si se usa en dos superficies, conviene moverlo a `components/charts/`. Corregir `new Date().getFullYear()` ([page.tsx:27](app/(app)/prevencion/indicadores/page.tsx#L27)) y `getMonth()` ([canonical-indicators-dashboard.tsx:65](app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx#L65)) por `codeYear()` y `todayInChile()`.
- **Riesgos de interpretación:** con pocas HH, un solo caso dispara la tasa, por eso el tooltip debe mostrar n y HH. La TG es semestral por norma y el punto mensual es indicativo; hay que decirlo en el subtítulo.
- **Complejidad:** baja.
- **Puntuación:** 22 + 22 + 2[Ep] + 3[E] + 8 + 9 = **66** (revisada el 2026-11-03 con datos de producción; primera pasada: 84). En producción: 0 registros de HH y 1 incidente.
- **Prioridad:** **P2** (primera pasada: P1)

#### CHART-002: Patrón de eventos y matriz de gravedad real × potencial

- **Módulo:** Prevención › Incidentes
- **Pantalla:** Incidentes
- **Ruta:** `/prevencion/incidentes`
- **Archivos y líneas:** lista con 4 tiles, 3 selects y DataTable ([incident-list.tsx:83-136](app/(app)/prevencion/incidentes/incident-list.tsx#L83-L136)); límite de 500 filas en [prevention-incidents.ts:961](lib/services/prevention-incidents.ts#L961); función de analítica **sin ningún llamador** `getIncidentAnalyticsData` ([prevention-indicadores.ts:1056](lib/services/prevention-indicadores.ts#L1056)), con 0 usos verificados por grep.
- **Representación actual:** tiles de conteo que **no responden a los filtros** (`getIncidentDashboardCounts`, [prevention-incidents.ts:1806](lib/services/prevention-incidents.ts#L1806)) más una tabla de 5 columnas. Sin gráfico.
- **Problema:** la señal preventiva clave (eventos de potencial alto o crítico sin daño, es decir, casi accidentes) sólo aparece si se lee fila por fila. Además, tile y lista divergen al filtrar.
- **Visualización recomendada:**
  - **(a)** Barras apiladas por mes de ocurrencia, con 12 meses y los 8 `event_type` agrupados en 3 o 4 familias.
  - **(b)** Mapa de calor de 6 × 5: `actual_severity` (none → fatal) × `potential_severity` (low → fatal). Un solo tono secuencial por conteo, con la diagonal superior resaltada como «potencial mayor que el daño». Va en un bloque plegable sobre la tabla.
- **Datos y campos necesarios:** `prevention_incidents.occurred_at`, `event_type`, `actual_severity`, `potential_severity`, `worksite_id` ([incidents.ts:17-57](db/schema/prevention/incidents.ts#L17-L57), con los CHECK de dominio en :56-57).
- **Fórmula o agregación:** `count(*)` agrupado por `date_trunc('month', occurred_at)` × familia, y `count(*)` por par de gravedades. Unidad: eventos. Los eventos sin gravedad potencial van a una columna «sin evaluar».
- **Disponibilidad de datos:** **Backend** (menor). Hay que extender `getIncidentAnalyticsData` con el eje mensual que ya usa `getMaterialEnvironmentalEvents`. Agregar en el cliente truncaría a 500.
- **Filtros e interacciones:** los filtros de la página (faena, año, tipo) rigen también el gráfico. Clic en una celda o barra aplica ese filtro a la tabla y lo refleja en la URL. Con esto se corrige de paso la divergencia de los tiles.
- **Beneficio funcional:** prioriza investigaciones por potencial, no por daño.
- **Beneficio visual:** una matriz reemplaza la búsqueda manual.
- **Requisitos técnicos:** nueva consulta agregada con `scopeCondition(access.scope)`. La matriz se hace con CSS grid y tokens (precedente: `worksite-equipment-heatmap.tsx`), sin biblioteca nueva.
- **Riesgos de interpretación:** volumen bajo. En `bodega_dev`, `prevention_incidents` tiene **0 filas**, así que no se pudo ver con datos. Con n pequeño hay que mostrar el número en cada celda y no sólo la intensidad.
- **Complejidad:** media.
- **Puntuación:** 20 + 20 + 2[Ep] + 3[E] + 8 + 7 = **60** (revisada el 2026-11-03 con datos de producción; primera pasada: 74). En producción: 1 incidente.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-003: Antigüedad y flujo del backlog CAPA

- **Módulo:** Prevención › CAPA (acciones correctivas y preventivas) / PDTP › Acciones
- **Pantalla:** Acciones CAPA
- **Ruta:** `/prevencion/capa` (y `/prevencion/pdtp/acciones`)
- **Archivos y líneas:** tiles-botón ([capa-list.tsx:134-147](app/(app)/prevencion/capa/capa-list.tsx#L134-L147)); paginación de a 50 ([prevention-capa.ts:956](lib/services/prevention-capa.ts#L956)); `getCapaDashboardCounts` devuelve sólo 5 escalares ([prevention-capa.ts:996](lib/services/prevention-capa.ts#L996)).
- **Representación actual:** 4 tiles sin antigüedad ni tendencia, que no responden a los filtros, más una tabla de 6 columnas. El tile «Vencidas» y el `Select` de estado repiten la misma dimensión (A5).
- **Problema:** «Vencidas: 12» no dice si son de ayer o de hace un semestre, ni si el backlog crece.
- **Visualización recomendada:**
  - **(a)** Histograma de atraso en tramos 1–7, 8–30, 31–90 y >90 días, apilado por `priority`, sobre acciones abiertas.
  - **(b)** Flujo mensual: barras de creadas contra cerradas por mes, más una línea de backlog abierto al cierre de cada mes.
  - (a) reemplaza al tile «Vencidas»; el `Select` se conserva para los demás estados.
- **Datos y campos necesarios:** `prevention_capa_actions.target_date`, `status`, `priority`, `source_type`, `worksite_id`, `created_at`, `closed_at`, `verified_at` ([capa.ts:7-90](db/schema/prevention/capa.ts#L7-L90)).
- **Fórmula o agregación:**
  - Atraso = `todayInChile() − target_date` para estados abiertos. `target_date` es `text` y hay que parsearlo; si es nulo, cuenta como «sin plazo».
  - Backlog(m) = creadas ≤ m − cerradas ≤ m.
  - Las canceladas quedan fuera.
  - Hay que **definir el cierre**: `closed` o `verified`, porque en PDTP son la misma cara ([action-plan.ts:290](lib/services/pdtp/action-plan.ts#L290)).
- **Disponibilidad de datos:** **Backend**.
- **Filtros e interacciones:** faena, fuente y prioridad. Clic en un tramo filtra la tabla con `?atraso=31-90`.
- **Beneficio funcional:** prioriza lo crónico y muestra si el equipo cierra al ritmo que abre.
- **Beneficio visual:** reemplaza dos cifras sin contexto.
- **Requisitos técnicos:** consulta agregada con alcance por faena; componente de barras de antigüedad (patrón compartido con CHART-031 y CHART-026).
- **Riesgos de interpretación:** confundir «verificada» con «cerrada»; acciones sin plazo.
- **Complejidad:** media.
- **Puntuación:** 19 + 21 + 2[Ep] + 3[E] + 7 + 6 = **58** (revisada el 2026-11-03 con datos de producción; primera pasada: 71). En producción: 0 acciones CAPA.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-004: Gráficos de cumplimiento PDTP corregidos y con meta

- **Módulo:** Prevención › PDTP (Programa de Trabajo Preventivo)
- **Pantalla:** Cumplimiento PDTP y ficha del programa
- **Ruta:** `/prevencion/pdtp`, `/prevencion/pdtp/[programId]`
- **Archivos y líneas:**
  - área de programadas contra ejecutadas: [pdtp-dashboard-charts.tsx:55](app/(app)/prevencion/pdtp/pdtp-dashboard-charts.tsx#L55)
  - barra por faena con umbrales fijos 80/50: [:58](app/(app)/prevencion/pdtp/pdtp-dashboard-charts.tsx#L58)
  - «Avance por eje» como `<ol>` de texto: [:62](app/(app)/prevencion/pdtp/pdtp-dashboard-charts.tsx#L62)
  - `compliancePercent` calculado y descartado, con null convertido a 0: [page.tsx:169](app/(app)/prevencion/pdtp/page.tsx#L169)
  - serie mensual sólo como tabla plegada: [pdtp-indicators-panel.tsx:141-173](app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx#L141-L173)
  - anillo de progreso sin usos: `PdtpProgressRing` en [pdtp-sheet-table-ui.tsx:121](app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx#L121)
- **Representación actual:**
  - 4 tiles de períodos mezclados: ejecutadas del año, pendientes del mes, atrasadas del período.
  - Un área (que sugiere continuidad sobre conteos discretos).
  - Barras con umbrales fijos que **ignoran `indicators.target`**.
  - Un «gráfico» de eje que en realidad es texto.
- **Problema:** no se ve la meta del programa, el % mensual no se dibuja y la lectura por eje exige comparar números.
- **Visualización recomendada:**
  - **Tendencia:** barras agrupadas de plan contra ejecutado por mes, línea de % en eje derecho (A5b) y `ReferenceLine` en la meta.
  - **Por faena:** las mismas barras con el color definido por `meta` (no por 80/50) y clic hacia `?faena=` (como en `/dashboard`).
  - **Por eje:** `RankedList` en formato porcentaje.
  - **En la ficha del programa:** el mismo gráfico mensual sobre la tabla plegada, con los meses con actividades «en cero» marcados como puntos.
  - **Tiles:** rotular explícitamente el período de cada uno.
- **Datos y campos necesarios:** `getPdtpComplianceIndicatorsForScope`, `getPdtpComplianceByCategoryForScope` (ya cargados); `data.monthly` en la ficha.
- **Fórmula o agregación:** % mensual = ejecutadas / programadas; **nulo si programadas = 0** (corregir l.169). La meta sale de `indicators.target`. Unidad: actividades y %.
- **Disponibilidad de datos:** **Disponible**. En `bodega_dev` hay 1.642 filas en `pdtp_activity_schedule` y 174 actividades.
- **Filtros e interacciones:** faena, eje y mes. Tooltip con plan, ejecutado y desviación. Clic en un mes lleva a la hoja de actividades filtrada.
- **Beneficio funcional:** responde «¿voy en meta?» y «¿qué faena o eje me atrasa?» en una sola mirada.
- **Beneficio visual:** retira el área decorativa con degradado y unifica umbrales.
- **Requisitos técnicos:** cambios locales en `pdtp-dashboard-charts.tsx`; borrar `PdtpProgressRing` o reutilizarlo; nombre accesible en `ChartFrame`.
- **Riesgos de interpretación:** el % mensual sobre un plan chico es volátil, por eso el tooltip debe mostrar plan y ejecutado.
- **Complejidad:** baja.
- **Puntuación:** 20 + 22 + 3[Ep] + 6[E] + 8 + 9 = **68** (revisada el 2026-11-03 con datos de producción; primera pasada: 86). En producción: plan de 821 casillas, programa 2026 en borrador, 0 ejecuciones.
- **Prioridad:** **P2** (primera pasada: P1)

#### CHART-005: Resumen visual del Reporte de gestión PDTP

- **Módulo:** Prevención › PDTP
- **Pantalla:** Reporte de gestión
- **Ruta:** `/prevencion/pdtp/[programId]/reporte`
- **Archivos y líneas:** tabla de 9 columnas ([reporte/page.tsx:145-190](app/(app)/prevencion/pdtp/%5BprogramId%5D/reporte/page.tsx#L145-L190)); comentario que nombra «el caso más grave» ([:21-27](app/(app)/prevencion/pdtp/%5BprogramId%5D/reporte/page.tsx#L21-L27)); datos en [management-report.ts:16-57](lib/services/pdtp/management-report.ts#L16-L57).
- **Representación actual:** sólo la tabla. `report.target` no se muestra.
- **Problema:** las actividades en desviación **sin desvío declarado** (lo más grave) se pierden entre filas que cumplen.
- **Visualización recomendada:**
  - **(a)** Barra de proporción en tres segmentos: cumplen, en desviación con desvío declarado, en desviación sin desvío declarado. El último va en `--color-danger`.
  - **(b)** Bullet chart con el % por actividad contra la meta, ordenado de peor a mejor y con ancla a su fila.
  - La tabla se mantiene (es el formato del Excel de origen).
- **Datos y campos necesarios:** `report.activities[]{planned, executed, percent, meetsTarget, deviations}`, `report.target`.
- **Fórmula o agregación:** conteo de actividades por clase; % = ejecutado / planificado. Una actividad con planificado = 0 va como «sin plan».
- **Disponibilidad de datos:** **Disponible**. El corte por responsable requiere procesamiento: `responsibles` es un conjunto, así que cada actividad puede contar para varios responsables.
- **Filtros e interacciones:** los filtros del reporte (`reporte-gestion-filters.tsx`). Clic en un segmento filtra la tabla.
- **Beneficio funcional:** convierte el reporte en una lista de acción.
- **Beneficio visual:** el reporte gana una cabecera legible.
- **Requisitos técnicos:** componentes `ShareBar` (existe `StatusShareBar` en el tablero) y `BulletList` (nuevo, CSS).
- **Riesgos de interpretación:** doble conteo si se segmenta por responsable.
- **Complejidad:** baja.
- **Puntuación:** 19 + 20 + 3[Ep] + 6[E] + 7 + 9 = **64** (revisada el 2026-11-03 con datos de producción; primera pasada: 76). En producción: plan de 821 casillas, programa en borrador, 0 ejecuciones.
- **Prioridad:** **P3** (primera pasada: P1)

#### CHART-006: Depurar Indicadores material y ambiental (y corregir su cifra total)

- **Módulo:** Prevención › Indicadores
- **Pantalla:** Indicadores material y ambiental
- **Ruta:** `/prevencion/indicadores-material-ambiental`
- **Archivos y líneas:** 4 gráficos que repiten los mismos 36 valores ([material-environmental-charts.tsx:45-95](app/(app)/prevencion/indicadores-material-ambiental/material-environmental-charts.tsx#L45-L95)); tile «Total eventos» que suma **todas** las faenas mientras los otros tres muestran la faena elegida ([material-environmental-dashboard.tsx:49-59, 96-115](app/(app)/prevencion/indicadores-material-ambiental/material-environmental-dashboard.tsx#L49-L115)). El defecto está **verificado leyendo el código**.
- **Representación actual:** tira de 4 cifras, más una pestaña de tabla, una de 4 gráficos (barras agrupadas, líneas `monotone`, barras apiladas por faena y combinado) y una tabla por faena.
- **Problema:**
  - Hay redundancia: 3 de los 4 gráficos codifican el mismo dato.
  - La curva `monotone` sugiere valores intermedios en conteos.
  - Los textos remiten a una «tabla equivalente» que vive en otra pestaña.
  - La cifra total contradice a las otras tres.
- **Visualización recomendada:**
  - Un gráfico de barras apiladas por mes y tipo.
  - Un comparativo por faena (`RankedList` o barras apiladas horizontales sin `radius` interno).
  - La tabla en la **misma** pestaña, plegable.
  - Corregir el tile para que use `selectedData`.
  - Reutilizar `MaterialEnvironmentalChart` del tablero ([sst-charts.tsx:295](app/(app)/dashboard/charts/sst-charts.tsx#L295)).
- **Datos y campos necesarios:** `prevention_incidents` con `event_type` ∈ {dangerous_incident, material_damage, environmental_spill} por mes (`getMaterialEnvironmentalEvents`, [prevention-indicadores.ts:939](lib/services/prevention-indicadores.ts#L939)).
- **Fórmula o agregación:** conteo de eventos por mes, tipo y faena.
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** faena y año, ambos en la URL (hoy la faena es estado local y se pierde al cambiar de año).
- **Beneficio funcional:** una cifra confiable.
- **Beneficio visual:** menos ruido.
- **Requisitos técnicos:** cambios locales.
- **Riesgos de interpretación:** volumen bajo, por lo que conviene etiquetar el valor sobre cada barra.
- **Complejidad:** baja.
- **Puntuación:** 12 + 10 + 2[Ep] + 3[E] + 6 + 10 = **43** (revisada el 2026-11-03 con datos de producción; primera pasada: 57). En producción: 1 incidente.
- **Prioridad:** **P4** (primera pasada: P3) · la corrección de la cifra «Total eventos» sigue siendo inmediata (Fase 0)

#### CHART-007: Mapa de calor probabilidad × consecuencia en la matriz MIPER

- **Módulo:** Prevención › MIPER (Matriz de Identificación de Peligros y Evaluación de Riesgos)
- **Pantalla:** Workspace de la matriz y portafolio
- **Ruta:** `/prevencion/miper/[id]` y `/prevencion/miper`
- **Archivos y líneas:** resumen con barras `Progress` por actividad ([resumen-panel.tsx:72-121](app/(app)/prevencion/miper/%5Bid%5D/resumen-panel.tsx#L72-L121)); columnas `probability`, `consequence`, `magnitude`, `classification` y `residual_level` ([risk-legal.ts:219-241](db/schema/prevention/risk-legal.ts#L219-L241)); `classificationCounts` con los 4 niveles ([miper/queries.ts:164-168](lib/services/miper/queries.ts#L164-L168)), de los que el portafolio expone sólo 2 ([portfolio.ts:103-104](lib/services/miper/portfolio.ts#L103-L104)).
- **Representación actual:** la cifra «Importantes e intolerables» y barras de avance. No hay distribución del riesgo.
- **Problema:** una matriz de riesgos sin su propia matriz visual. No se ve dónde se concentra el riesgo ni el efecto de los controles.
- **Visualización recomendada:**
  - Cuadrícula de 3 × 3 (P ∈ {1,2,4} × C ∈ {1,2,4}) con el conteo por celda y el color por clasificación con tokens semánticos. **Inherente y residual lado a lado.**
  - Clic en una celda filtra la matriz (`hrefToMatrixOnly(…, {clasificacion})` ya existe).
  - En el portafolio, una barra apilada de 4 niveles por faena.
- **Datos y campos necesarios:** `prevention_risk_entries.probability`, `consequence`, `classification`, `residual_level`. En `bodega_dev` hay 222 entradas.
- **Fórmula o agregación:** conteo por (P, C). Las entradas sin P o C van a «sin evaluar», fuera de la grilla.
- **Disponibilidad de datos:** **Disponible** en el workspace (`rows[].classification` ya está en el cliente; falta confirmar que P y C viajan al cliente). En el portafolio es **Procesamiento**. **Revisión con producción:** la parte inherente tiene datos (540 riesgos, todos con P y C, ninguno sobre P=2); la residual **no**: `residual_level` está vacío en los 540, así que esa mitad es **Nuevos datos** hasta que se registre el efecto de los controles.
- **Filtros e interacciones:** actividad, proceso y faena. Tooltip con los 3 peligros más frecuentes de la celda.
- **Beneficio funcional:** muestra el efecto de los controles y la concentración del riesgo.
- **Beneficio visual:** es la representación canónica del dominio, y los usuarios la reconocen.
- **Requisitos técnicos:** componente `RiskMatrix` en CSS grid, accesible como tabla (`role="table"`, cada celda con su conteo en texto).
- **Riesgos de interpretación:** la escala 1–2–4 no es lineal, así que no conviene interpolar colores. Usar las 4 clases discretas.
- **Complejidad:** baja a media.
- **Puntuación:** 21 + 18 + 12[Ep] + 14[E] + 9 + 8 = **82** (revisada el 2026-11-03 con datos de producción; primera pasada: 78). En producción: 540 riesgos; 788 escrituras de 5 usuarios en 60 días.
- **Prioridad:** **P1** (primera pasada: P1)

#### CHART-008: Calendario de cumplimiento faena × mes (primitivo compartido)

- **Módulo:** Prevención, transversal: capacitación, cierres PDTP, CPHS, alcotest, emergencias, higiene, CGRD
- **Pantalla:**
  - Capacitación
  - Cierres PDTP
  - CPHS (Comité Paritario de Higiene y Seguridad): lista y programa
  - Alcotest
  - Emergencias
  - Higiene
  - CGRD
- **Ruta:**
  - `/prevencion/capacitacion`
  - `/prevencion/pdtp/[programId]/cierres`
  - `/prevencion/cphs`
  - `/prevencion/cphs/[committeeId]/programa`
  - `/prevencion/alcotest`
  - `/prevencion/emergencias`
  - `/prevencion/higiene`
  - `/prevencion/cgrd`
- **Archivos y líneas:**
  - grid de tarjetas: [training-occurrence-list.tsx:187-228](app/(app)/prevencion/capacitacion/training-occurrence-list.tsx#L187-L228)
  - tabla de cierres: [cierres/page.tsx:76-84](app/(app)/prevencion/pdtp/%5BprogramId%5D/cierres/page.tsx#L76-L84)
  - cifras inertes de CPHS: [committee-list.tsx:83-99](app/(app)/prevencion/cphs/committee-list.tsx#L83-L99)
  - tabla mensual del programa CPHS: [program-panel.tsx:146-190](app/(app)/prevencion/cphs/%5BcommitteeId%5D/programa/program-panel.tsx#L146-L190)
  - `ProgramSlotList`, que repite tarjetas «mes · semana» en 4 pantallas: [program-slot-list.tsx](components/prevention/program-slot-list.tsx)
- **Representación actual:** listas o grids de tarjetas y tablas. Hasta ~52 tarjetas por pantalla en alcotest.
- **Problema:** todas responden «¿qué casilla del programa anual falta y en qué faena?», y ninguna lo muestra como calendario. El hueco (el mes sin sesión, sin capacitación o sin cierre) es el dato, y en una lista no se ve.
- **Visualización recomendada:** **un solo primitivo** `ComplianceCalendar`: matriz de filas (faena, comité o tipo) × 12 columnas de mes. Cada celda muestra el estado:
  - cumplido: `success`
  - parcial: `warning-ink`
  - vencido sin cumplir: `danger`
  - pendiente futuro: neutro
  - no exigible: rayado o atenuado

  La celda lleva texto o ícono además del color (los estados no dependen sólo del color, como exige `PRODUCT.md`). Clic en una celda filtra la lista de abajo, que se mantiene.
- **Datos y campos necesarios:**
  - `prevention_training_occurrences.worksite_id`, `year`, `scheduled_month`, `status`, `completed_at` (2.821 filas en `bodega_dev`)
  - `prevention_committee_meetings.scheduled_for`, `held_at`, `status`, `quorum_reached`
  - `prevention_committee_program_activities.planned_month`, `status`
  - cierres PDTP (`status`, `driftedSinceClose`)
  - `ProgramSlotRow{scheduledMonth, status}` (alcotest: 161 casillas; simulacros: 14; higiene: 7; reuniones GRD: 28)
- **Fórmula o agregación:** por celda, estado agregado = completadas / (total − no aplica). «Vencido» = mes < mes actual y no completado. Las casillas previas a `activationPeriod` no son exigibles.
- **Disponibilidad de datos:** **Disponible** en todas las pantallas (cada una ya carga sus casillas). Los cierres son **Procesamiento**: los meses faltantes se derivan de `currentPdtpPeriod()`.
- **Filtros e interacciones:** año. Clic en una celda filtra la lista. Teclado: navegación por flechas en la grilla (`role="grid"`).
- **Beneficio funcional:** un patrón aprendido una vez sirve en 8 pantallas, y el auditor ve los huecos de cumplimiento legal.
- **Beneficio visual:** reemplaza muros de tarjetas por una sola forma y compacta 4 pantallas.
- **Requisitos técnicos:**
  - componente nuevo en `components/ui/` sobre CSS grid y tokens (precedente: `combustibles/worksite-equipment-heatmap.tsx`);
  - adaptadores por dominio;
  - se corrige en la capa del primitivo, como pide `AGENTS.md`.
- **Riesgos de interpretación:** mezclar «no exigible» con «pendiente», por eso necesitan estilos distintos y una leyenda.
- **Complejidad:** media (un primitivo y 8 integraciones pequeñas).
- **Puntuación:** 23 + 22 + 5[Ep] + 12[E] + 9 + 6 = **77** (revisada el 2026-11-03 con datos de producción; primera pasada: 85). En producción: 3.991 casillas de capacitación (17 hechas) y 230 de alcotest; 0 sesiones CPHS.
- **Prioridad:** **P1** (primera pasada: P1)

#### CHART-009: Exposición contra límite permisible en Higiene

- **Módulo:** Prevención › Higiene ocupacional
- **Pantalla:** Detalle de grupo de exposición similar (GES)
- **Ruta:** `/prevencion/higiene/grupos/[groupId]` (y la lista `/prevencion/higiene`)
- **Archivos y líneas:** tabla de mediciones ([group-detail.tsx:149-168](app/(app)/prevencion/higiene/grupos/%5BgroupId%5D/group-detail.tsx#L149-L168)); interfaz con `measurements` (:51-62); badge «Última medición» en la lista ([hygiene-dashboard.tsx:205-208](app/(app)/prevencion/higiene/hygiene-dashboard.tsx#L205-L208)).
- **Representación actual:** una serie temporal mostrada como tabla. La lista muestra sólo un badge.
- **Problema:** no se ve si la exposición sube hacia el límite ni a qué distancia está.
- **Visualización recomendada:**
  - Puntos y línea de `value` en el tiempo.
  - Límite permisible y nivel de acción como **líneas escalonadas** construidas desde los *snapshots* de cada medición (los límites cambian).
  - Eje Y desde 0.
  - En la lista de GES, una barra `value/limit` dentro de la celda.
- **Datos y campos necesarios:** `prevention_exposure_measurements.measured_on`, `value`, `unit`, `permissible_limit_snapshot`, `action_level_snapshot`, `outcome`.
- **Fórmula o agregación:** ninguna en el detalle (valor crudo). En la lista, cociente = valor / límite de la última medición. Si no hay límite (`not_comparable`), se dibuja sólo la serie con la etiqueta «sin límite declarado».
- **Disponibilidad de datos:** **Disponible** en el detalle; **Procesamiento** en la lista.
- **Filtros e interacciones:** agente o unidad. Tooltip con resultado y laboratorio.
- **Beneficio funcional:** anticipa la acción antes de superar el límite.
- **Beneficio visual:** es la forma natural de este dato.
- **Requisitos técnicos:** `ComposedChart` con `Line type="stepAfter"`.
- **Riesgos de interpretación:** unidades mixtas dentro de un grupo, así que se grafica sólo la unidad dominante y se advierte. Pocas mediciones: mostrar los puntos, sin suavizar.
- **Complejidad:** baja.
- **Puntuación:** 22 + 20 + 2[Ep] + 3[E] + 7 + 9 = **63** (revisada el 2026-11-03 con datos de producción; primera pasada: 77). En producción: 0 mediciones de exposición.
- **Prioridad:** **P3** (primera pasada: P1)

#### CHART-010: Tendencia de cumplimiento de inspecciones y controles de alcotest

- **Módulo:** Prevención › Inspecciones / Alcotest
- **Pantalla:** Inspecciones; Alcotest
- **Ruta:** `/prevencion/inspecciones`, `/prevencion/alcotest`
- **Archivos y líneas:** tiles sin período y tabla paginada (`inspection-run-list.tsx:284, 483`); `summarizeInspectionRuns` sólo con totales ([queries.ts:220](lib/services/prevention-inspections/queries.ts#L220)); `listAlcoholTests` hace `select()` de toda la tabla y filtra en JS ([prevention-alcotest.ts:232](lib/services/prevention-alcotest.ts#L232)); la interfaz corta a 30 ([alcotest-workbench.tsx:121](app/(app)/prevencion/alcotest/alcotest-workbench.tsx#L121)).
- **Representación actual:** tiles y tabla en inspecciones; 30 artículos en alcotest.
- **Problema:** no se ve si el cumplimiento mejora ni qué plantilla o faena lo arrastra. Alcotest carga toda la tabla, un riesgo de rendimiento que crece con el uso.
- **Visualización recomendada:**
  - **Inspecciones:** línea mensual de cumplimiento **ponderado por ítems** y barras apiladas de hallazgos abiertos por criticidad, en un panel plegable sobre la tabla.
  - **Alcotest:** barras mensuales de controles con positivos destacados, por faena.
- **Datos y campos necesarios:** `prevention_inspection_runs.executed_at`, `conforming_count`, `compliance_percent`, `template_id`, `worksite_id`; `prevention_inspection_findings.criticality`, `status`, `closed_at`; `alcohol_tests.performed_at`, `result`, `shift`.
- **Fórmula o agregación:** cumplimiento = Σ conformes / Σ evaluables (nunca el promedio de porcentajes); positivos = conteo por mes.
- **Disponibilidad de datos:** inspecciones, **Backend**; alcotest, **Disponible**. Hay que corregir la consulta, que hoy trae la tabla entera.
- **Filtros e interacciones:** plantilla (ya es un filtro de la página), faena y período.
- **Beneficio funcional:** detecta deterioro por plantilla o faena.
- **Beneficio visual:** los tiles ganan contexto.
- **Requisitos técnicos:** serie agregada con `access.scope`; paginación del lado del servidor en alcotest.
- **Riesgos de interpretación:** mezclar plantillas de distinta exigencia, por eso conviene segmentar por plantilla. En alcotest, los positivos son datos sensibles: mostrar sólo conteos agregados, nunca nombres en el gráfico.
- **Complejidad:** media.
- **Puntuación:** 18 + 18 + 10[Ep] + 8[E] + 7 + 6 = **67** (revisada el 2026-11-03 con datos de producción; primera pasada: 68). En producción: 22 inspecciones (ago–oct) y 1 control de alcotest.
- **Prioridad:** **P2** (primera pasada: P2)

#### CHART-011: Tasa de detención y tendencia en PPA

- **Módulo:** Prevención › PPA
- **Pantalla:** PPA
- **Ruta:** `/prevencion/ppa`
- **Archivos y líneas:** `RankPanel` local que duplica `RankedList` ([ppa/page.tsx:21-51, 99-136](app/(app)/prevencion/ppa/page.tsx#L21-L136)); `getPpaStats` histórico completo, sin período ([calculos.ts:166-227](lib/services/ppa-module/calculos.ts#L166-L227)); «Total PPA» repetido en la tira y en la pestaña «Todos» ([ppa-list.tsx:24](app/(app)/prevencion/ppa/ppa-list.tsx#L24)).
- **Representación actual:** tira de métricas, 3 rankings hechos con `div` y una tabla.
- **Problema:** el ranking de faenas ordena por **conteo absoluto** de detenidos, lo que castiga a la faena que más PPA llena. No hay período ni tendencia.
- **Visualización recomendada:** barras mensuales de envíos con la tasa de detención en eje derecho (A5b), y `RankedList` de **tasa** de detención por faena (formato %, con n visible).
- **Datos y campos necesarios:** `ppa_submissions.worksite_id`, `tipo_trabajo`, `resultado`, `triggered_reasons`, `estado`, `reviewed_at`, `filled_at`, `created_at`.
- **Fórmula o agregación:** tasa = detenidos / total por faena y mes, con mes = `coalesce(filled_at, created_at)`. Tiempo de revisión = **mediana** de `reviewed_at − created_at`.
- **Disponibilidad de datos:** **Backend**.
- **Filtros e interacciones:** período, faena y tipo de trabajo.
- **Beneficio funcional:** compara faenas con justicia.
- **Beneficio visual:** retira un componente local duplicado.
- **Requisitos técnicos:** agregación mensual; `RankedList` existente.
- **Riesgos de interpretación:** los envíos offline llegan tarde, por eso hay que fechar por `filled_at`. Una faena con n pequeño da tasas extremas: mostrar n.
- **Complejidad:** media.
- **Puntuación:** 17 + 18 + 4[Ep] + 5[E] + 7 + 6 = **57** (revisada el 2026-11-03 con datos de producción; primera pasada: 65). En producción: 11 PPA.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-012: Horizonte de vencimientos (primitivo compartido)

- **Módulo:** transversal: emergencias, documentación, vigilancia de salud, programación de inspecciones, garantías y licencias TI
- **Pantalla:**
  - Emergencias
  - Documentación
  - Programa de vigilancia
  - Programación de inspecciones
  - Garantías TI
  - Licencias TI
- **Ruta:**
  - `/prevencion/emergencias`
  - `/prevencion/documentacion`
  - `/prevencion/higiene/programas/[programId]`
  - `/prevencion/inspecciones/programacion`
  - `/ti/garantias`
  - `/ti/licencias`
- **Archivos y líneas:**
  - `resourceFacts` sin fecha: [emergency-list.tsx:127-170](app/(app)/prevencion/emergencias/emergency-list.tsx#L127-L170)
  - vencimientos de documentos sólo a 7, 15 y 30 días: [search.ts:196](lib/services/prevention-documents/search.ts#L196)
  - bandas en chips: `countWarrantyBands`, [warranty-windows.ts:50](app/(app)/ti/garantias/warranty-windows.ts#L50)
  - `it_licenses.renewal_date` y `cost`: [ti.ts:267-270](db/schema/ti.ts#L267-L270)
- **Representación actual:** chips con contador, fechas sueltas en columnas de tabla y cifras totales.
- **Problema:** «¿qué vence y cuándo se me junta el trabajo?» no se puede contestar sin ordenar una tabla.
- **Visualización recomendada:** **un primitivo** `ExpiryHorizon`. Barras por semana (próximas 12) o por mes (próximos 12), con una barra «vencido» a la izquierda, apiladas por tipo (vence / inspección / renovación). En licencias, la variante mide costo. Reemplaza los chips de banda (para no duplicar, A5). Clic en una barra filtra la tabla.
- **Datos y campos necesarios:**
  - `prevention_emergency_resources.kind`, `next_inspection_at`, `expires_at`, `status`
  - documentos `expires_at`
  - `prevention_surveillance_enrollments.due_on`
  - programas de inspección `next_due_on`
  - `it_assets.warranty_end_date`
  - `it_licenses.renewal_date`, `cost`
- **Fórmula o agregación:** conteo (o Σ costo) por semana o mes de vencimiento, más los ya vencidos. Las fechas nulas van a «sin fecha».
- **Disponibilidad de datos:**
  - TI garantías, licencias y vigilancia: **Disponible**
  - documentos: **Procesamiento**
  - emergencias: **Backend** (hoy sólo hay conteos agregados)
  - varios campos son `text`: hay que validar el formato al agregarlos
- **Filtros e interacciones:** faena y tipo.
- **Beneficio funcional:** planifica la carga y evita vencimientos legales.
- **Beneficio visual:** un patrón para 6 pantallas.
- **Requisitos técnicos:** componente nuevo y una consulta por dominio.
- **Riesgos de interpretación:** fechas de texto mal formadas que se pierden en silencio, por eso hay que contar y mostrar «fecha inválida».
- **Complejidad:** media.
- **Puntuación:** 18 + 20 + 3[Ep] + 4[E] + 7 + 6 = **58** (revisada el 2026-11-03 con datos de producción; primera pasada: 72). En producción: 0 recursos de emergencia y 0 activos TI.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-013: Matriz requisito × faena en Requisitos legales

- **Módulo:** Prevención › Requisitos legales
- **Pantalla:** Requisitos legales, pestaña Aplicabilidad
- **Ruta:** `/prevencion/requisitos-legales`
- **Archivos y líneas:** `complianceStatus` y `applicabilityStatus` ([risk-legal.ts:476-482](db/schema/prevention/risk-legal.ts#L476-L482)); `getLegalDashboard` ([prevention-risk-legal.ts:1097](lib/services/prevention-risk-legal.ts#L1097)).
- **Representación actual:** N tarjetas. Los tiles enlazan a `#aplicabilidad` y `#brechas`, que viven en pestañas no activas. Es una inferencia del código: Radix no monta el contenido inactivo, así que el ancla no lleva a ningún lado. No se verificó en el navegador.
- **Problema:** saber qué requisito falla en qué faena obliga a abrir cada tarjeta.
- **Visualización recomendada:** matriz (requisitos en filas, faenas en columnas) con el estado de cumplimiento por celda (cumple / brecha / no aplica / sin evaluar), ícono y texto. Es una tabla visual, no un gráfico; se agrupa por norma.
- **Datos y campos necesarios:** los indicados arriba.
- **Fórmula o agregación:** ninguna (estado por celda).
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** norma y estado. Clic en una celda abre el requisito.
- **Beneficio funcional:** prepara una fiscalización en minutos.
- **Beneficio visual:** reemplaza un muro de tarjetas.
- **Requisitos técnicos:** reutilizar la grilla de CHART-008.
- **Riesgos de interpretación:** con muchos requisitos, agrupar y plegar.
- **Complejidad:** baja.
- **Puntuación:** 18 + 17 + 2[Ep] + 3[E] + 8 + 8 = **56** (revisada el 2026-11-03 con datos de producción; primera pasada: 71). En producción: 0 requisitos legales.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-014: Ventanas de permisos de trabajo (Gantt corto)

- **Módulo:** Prevención › Permisos de trabajo
- **Pantalla:** Permisos
- **Ruta:** `/prevencion/permisos`
- **Archivos y líneas:** `planned_start_at`, `planned_end_at`, `extended_until_at` ([permits.ts:70-71](db/schema/prevention/permits.ts#L70-L71)); permisos completos en el cliente ([work-permit-list.tsx:99-103](app/(app)/prevencion/permisos/work-permit-list.tsx#L99-L103)).
- **Representación actual:** tiles y una DataTable; la ventana se lee como texto.
- **Problema:** «¿qué trabajo está habilitado ahora y hasta cuándo?» se calcula de cabeza.
- **Visualización recomendada:** Gantt de hoy ±3 días, una barra por permiso vigente o pendiente, agrupado por faena. Línea de «ahora» y extensión en rayado.
- **Datos y campos necesarios:** los citados, más `status` y el tipo de trabajo.
- **Fórmula o agregación:** ninguna.
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** faena y tipo. Clic abre el permiso.
- **Beneficio funcional:** coordinación en terreno: solapes de trabajos en caliente o LOTO (bloqueo y etiquetado de energías).
- **Beneficio visual:** muestra el tiempo como tiempo.
- **Requisitos técnicos:** componente `TimelineBars` en CSS grid (también lo usan CHART-017 y CHART-025).
- **Riesgos de interpretación:** con muchos permisos, limitar la vista a vigentes y pendientes.
- **Complejidad:** media.
- **Puntuación:** 16 + 17 + 2[Ep] + 3[E] + 7 + 6 = **51** (revisada el 2026-11-03 con datos de producción; primera pasada: 70). En producción: 0 permisos de trabajo.
- **Prioridad:** **P4** (primera pasada: P2)

#### CHART-015: Micro-visualizaciones en fichas de Prevención (agrupadas)

Se agrupan aquí porque cada una es pequeña y comparte el mismo criterio: **dato ya cargado, gráfico mínimo, la tabla se queda**.

| Pantalla | Ruta | Archivo | Propuesta | Datos | Disponibilidad |
|---|---|---|---|---|---|
| Historial del trabajador | `/prevencion/trabajador/[workerId]` | [page.tsx:70-71](app/(app)/prevencion/trabajador/%5BworkerId%5D/page.tsx#L70-L71) carga `evaluations` y las descarta | `MiniSparkline` del % de cumplimiento por fecha | `sst_evaluations.porcentaje_cumplimiento`, `fecha_evaluacion` | Disponible |
| Faenas | `/prevencion/faenas` | `worksite-organization-list.tsx:21` | Barra de dotación con marcas en 10 y 25 (umbrales de comité y delegado) | `headcount` | Disponible |
| EPP preventivo | `/prevencion/epp-preventivo` | `epp-gap-list.tsx:81` | `RankedList` de brechas por EPP exigido, que filtra la tabla | brechas ya cargadas | Procesamiento |
| Programa CPHS | `/prevencion/cphs/[id]/programa` | [program-panel.tsx:146-190](app/(app)/prevencion/cphs/%5BcommitteeId%5D/programa/program-panel.tsx#L146-L190) | Barras apiladas de 12 meses (realizada / atrasada / pendiente) que reemplazan el tile «Actividades» | `planned_month`, `status`, `completed_at` | Disponible |
| Asistencia CPHS | `/prevencion/cphs/[committeeId]` | `committee-detail.tsx:224` | `RankedList` en % de asistencia por integrante | `prevention_committee_attendance.attended` | Procesamiento |
| Cobertura PDTP | `/prevencion/pdtp/cobertura` | `cobertura/page.tsx` | Barra apilada de actividades por tipo de fuente (MIPER, legal, CAPA…) | listas ya cargadas | Disponible |
| Certificación CPHS | `/prevencion/cphs/[id]/certificacion` | `certification-panel.tsx:107-108` | Barra de progreso de requisitos cumplidos sobre aplicables; corregir el tile «Plazo de brechas», que filtra igual que «Brechas abiertas» | requisitos | Disponible |

- **Puntuación del grupo:** 12 + 13 + 4[Ep] + 5[E] + 6 + 9 = **49** (revisada el 2026-11-03 con datos de producción; primera pasada: 60). En producción: casi todo vacío.
- **Prioridad:** **P4** (primera pasada: P3)

---

### D.2 Combustibles, Flota y Control operacional

#### CHART-016: Rendimiento mensual (km/L o L/h) en Consumo › Litros

- **Módulo:** Combustibles › Consumo
- **Pantalla:** Litros y rendimiento
- **Ruta:** `/combustibles/consumo/litros`
- **Archivos y líneas:** `OverviewMeterChart` (km u horas contra litros con doble eje, [consumo/litros/page.tsx:241-262](app/(app)/combustibles/consumo/litros/page.tsx#L241-L262)); `getMeterSeries` ([overview.ts:134](lib/combustibles/control/queries/overview.ts#L134)); columnas `fuel_equipment_loads.meter_delta`, `accumulated_liters` ([fuel-control.ts:71](db/schema/fuel-control.ts#L71)).
- **Representación actual:**
  - el rendimiento global sale sólo como texto;
  - el gráfico de doble eje obliga a dividir de cabeza para obtener la tasa;
  - el mes en curso no lleva marca de parcial (grep de «parcial» en los gráficos: 0 resultados).
- **Problema:** la tasa, que es lo que se gestiona, no se dibuja.
- **Visualización recomendada:**
  - línea de km/L **o** L/h por mes (nunca ambos en un eje);
  - banda de ±10 % en torno al global de la ventana;
  - número de tramos en el tooltip;
  - último mes con trazo discontinuo y rótulo «parcial».
- **Datos y campos necesarios:** `points{measure, liters, segments}` de `getMeterSeries`.
- **Fórmula o agregación:**
  - km/L = Σkm / ΣL y L/h = ΣL / Σh, como razón de sumas (`globalRatio`), nunca como promedio de razones;
  - nulo si no hay tramos;
  - período: los 12 meses de `consumptionChartWindow`.
- **Disponibilidad de datos:** **Disponible**. En `bodega_dev` hay 320 lecturas de medidor.
- **Filtros e interacciones:** faena, mandante y medio de carga. No se puede filtrar por producto: `fuel_equipment_loads` no tiene columna de producto.
- **Beneficio funcional:** ver si el rendimiento de la flota se degrada.
- **Beneficio visual:** retira una división mental.
- **Requisitos técnicos:** cálculo en el cliente.
- **Riesgos de interpretación:**
  - meses con pocos tramos;
  - mes parcial;
  - mezclar unidades: separar por `measure`.
- **Complejidad:** baja.
- **Puntuación:** 18 + 18 + 6[Ep] + 3[E] + 7 + 9 = **61** (revisada el 2026-11-03 con datos de producción; primera pasada: 77). En producción: 0 cargas en terreno; hay 3.910 lecturas de odómetro Copec que la serie no usa.
- **Prioridad:** **P3** (primera pasada: P1)

#### CHART-017: Desviación de rendimiento por equipo frente a su modelo y su historial

- **Módulo:** Combustibles › Consumo › Rendimiento
- **Pantalla:** Rendimiento por familia
- **Ruta:** `/combustibles/consumo/rendimiento/[familia]`
- **Archivos y líneas:**
  - columnas «Dif. modelo» y «Dif. historial»: [stats-tables.tsx:131-132](app/(app)/combustibles/consumo/rendimiento/%5Bfamilia%5D/stats-tables.tsx#L131-L132)
  - `deltaModelPct` y `deltaHistoryPct`: [performance.ts:90-113](lib/combustibles/control/queries/performance.ts#L90-L113)
  - `getEquipmentWorseSummary` devuelve sólo 3 ejemplos: [:292](lib/combustibles/control/queries/performance.ts#L292)
- **Representación actual:** tabla paginada; la anomalía queda en una columna «Aviso».
- **Problema:** para saber qué equipos rinden peor que su modelo hay que recorrer páginas.
- **Visualización recomendada:**
  - barras divergentes (o dumbbell) ordenadas por desviación, top N sin paginar;
  - umbral de 10 % como `ReferenceLine` (`WORSE_PERFORMANCE_THRESHOLD_PCT`);
  - polaridad invertida para L/h;
  - clic que lleva a la ficha del equipo.
  - La tabla se mantiene debajo.
- **Datos y campos necesarios:** los deltas por equipo, n de cargas y coeficiente de variación.
- **Fórmula o agregación:** Δ = (propio − referencia) / referencia. Es nulo si el modelo tiene un solo equipo.
- **Disponibilidad de datos:** **Backend** (top N sin paginar con los dos deltas).
- **Filtros e interacciones:** faena y mandante. Selector «contra modelo / contra historial».
- **Beneficio funcional:** decidir qué equipo inspeccionar.
- **Beneficio visual:** la anomalía pasa a ser la forma del gráfico y deja de ser una columna.
- **Requisitos técnicos:** ampliar el servicio; recharts `BarChart` horizontal.
- **Riesgos de interpretación:** n bajo, por eso hay que mostrar n y CV y atenuar los equipos con n < 5.
- **Complejidad:** media.
- **Puntuación:** 21 + 22 + 6[Ep] + 3[E] + 8 + 6 = **66** (revisada el 2026-11-03 con datos de producción; primera pasada: 75). En producción: 0 cargas en terreno.
- **Prioridad:** **P2** (primera pasada: P1)

#### CHART-018: Hoja de vida visual del equipo (flota, combustible y mantención)

- **Módulo:** Flota / Mantención / Combustibles
- **Pantalla:** Ficha de flota; ficha de equipo de mantención
- **Ruta:** `/flota/[id]`, `/mantencion/equipos/[id]`
- **Archivos y líneas:**
  - efecto de la OT como texto «a → b» sin unidad: [flota/[id]/page.tsx:131-213](app/(app)/flota/%5Bid%5D/page.tsx#L131-L213), en particular la línea :189
  - el impacto promedia `fuel_operation_records.rendimiento` (valor declarado) y no el rendimiento calculado: [fleet.ts:435-449](lib/services/fleet.ts#L435-L449)
  - cifras sueltas en mantención: [equipment-read-sections.tsx:44-67](components/mantencion/jefatura/equipos/equipment-read-sections.tsx#L44-L67)
  - hoja de vida de 8 columnas: [equipment-life-section.tsx:63-107](components/mantencion/jefatura/equipos/equipment-life-section.tsx#L63-L107)
- **Representación actual:** listas de intervalos de estado, texto «x.xx → y.yy» y tablas.
- **Problema:**
  - la pregunta «¿la OT mejoró el equipo? ¿cada cuánto falla?» se responde comparando filas de pantallas distintas;
  - además, flota y combustibles calculan el rendimiento con **fuentes distintas**: un hecho leído en el código.
- **Visualización recomendada:** una línea de tiempo común a las dos fichas, con un eje de fecha compartido:
  1. **Carril de rendimiento:** rendimiento carga a carga, con el rango normal del equipo como `ReferenceArea`.
  2. **Carril de taller:** estadías en taller como bandas sombreadas.
  3. **Carril de estado:** franja de estado operativo (operativo / mantención / fuera de servicio).
  4. **Carril de lectura:** lectura de km u horas, con marcas P (preventiva) y C (correctiva) y una línea en la próxima pauta.
  - La hoja de vida tabular se mantiene.
- **Datos y campos necesarios:**
  - `fuel_equipment_loads.performance_value`, `occurred_at`;
  - `mant_work_orders.workshop_entry_at`, `workshop_exit_at` ([mantencion-work-orders.ts:64-73](db/schema/mantencion-work-orders.ts#L64-L73));
  - `fuel_vehicle_operational_intervals` ([fuel-vehicles.ts:108](db/schema/fuel-vehicles.ts#L108));
  - `mant_records.reading`, `unit`, `work_date`, `kind`.
- **Fórmula o agregación:** ninguna (series crudas). El efecto de la OT se calcula como la mediana del rendimiento 30 días antes contra 30 días después, con n visible.
- **Disponibilidad de datos:** **Backend**: reutilizar la serie de `getEquipmentFile` y unificar la fuente del rendimiento.
- **Filtros e interacciones:** ventana de 90 días, 1 año o todo; zoom por arrastre (`Brush`). Clic en una banda abre la OT.
- **Beneficio funcional:** relaciona causa (taller) y efecto (rendimiento, disponibilidad) en un solo eje.
- **Beneficio visual:** sustituye texto y tablas dispersas por una sola lectura.
- **Requisitos técnicos:** `ComposedChart` para la serie más carriles `TimelineBars` (CHART-014). Hay que alinear permisos: `flota:view` y `mant:records:view_*`.
- **Riesgos de interpretación:**
  - unidades distintas por equipo, que nunca se mezclan;
  - pocas cargas dentro de la ventana;
  - la disponibilidad se sobrestima si una correctiva no mueve el estado (ver CHART-026).
- **Complejidad:** alta.
- **Puntuación:** 22 + 21 + 2[Ep] + 3[E] + 9 + 4 = **61** (revisada el 2026-11-03 con datos de producción; primera pasada: 72). En producción: 0 perfiles de mantención, 0 cargas, un solo intervalo por vehículo.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-019: Cuadratura frente a la tolerancia (mandante y proveedor)

- **Módulo:** Combustibles › Cuadratura
- **Pantalla:** Mandante; Proveedor
- **Ruta:** `/combustibles/cuadratura/mandante`, `/combustibles/cuadratura/proveedor`
- **Archivos y líneas:**
  - meses fuera de tolerancia como filas con badge: [mandante-sections.tsx:100-145](app/(app)/combustibles/cuadratura/mandante/mandante-sections.tsx#L100-L145)
  - `MandanteMonthSummary`: [reconciliation-summary.ts:22-33](lib/combustibles/control/queries/reconciliation-summary.ts#L22-L33)
  - proveedor: [medium-section.tsx:43-60](app/(app)/combustibles/cuadratura/proveedor/medium-section.tsx#L43-L60)
  - `MediumCrossRow`: [reconciliation.ts:202-212](lib/combustibles/control/queries/reconciliation.ts#L202-L212)
- **Representación actual:** dos tablas con pares de cifras.
- **Problema:** «¿cuadra dentro de la tolerancia?» es una comparación contra un umbral, y la tabla no la dibuja.
- **Visualización recomendada:**
  - **Mandante:** barras pareadas (entró / entregado) por mes, con la diferencia % en el eje derecho (A5b) y una banda de ±tolerancia. Los meses fuera de la banda van en `--color-danger` y con texto.
  - **Proveedor:** dumbbell terreno ↔ proveedor por medio.
- **Datos y campos necesarios:** `inLiters`, `deliveredLiters`, `differencePct`, `overTolerance`, `tolerancePct`; `fieldLiters`, `reportedLiters` (aquí nulo ≠ 0).
- **Fórmula o agregación:**
  - diferencia % = (entró − entregado) / entró;
  - nula si entró = 0;
  - sólo meses completos (`wholeMonths`).
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** faena y mandante. Clic en un mes lleva a las cargas del mes.
- **Beneficio funcional:** detecta pérdidas o errores de registro.
- **Beneficio visual:** el umbral se ve.
- **Requisitos técnicos:** `ComposedChart` con `ReferenceArea`.
- **Riesgos de interpretación:**
  - la TCT (transacciones de tarjeta Copec) es mensual y el registro de terreno es por carga;
  - en `bodega_dev` conviven filas `transaction` y `period_aggregate` en `fuel_provider_transactions` (45 agregados fechados el 2020-01-01, un centinela), así que sumarlas duplicaría el volumen. Ver la sección A.
- **Complejidad:** baja.
- **Puntuación:** 19 + 21 + 6[Ep] + 4[E] + 7 + 8 = **65** (revisada el 2026-11-03 con datos de producción; primera pasada: 77). En producción: entradas a estanque sí (342 movimientos), entregas en terreno 0.
- **Prioridad:** **P2** (primera pasada: P1)

#### CHART-020: Nivel de estanque contra capacidad y su evolución

- **Módulo:** Combustibles › Cuadratura › Estanques
- **Pantalla:** Estanques
- **Ruta:** `/combustibles/cuadratura/estanques`
- **Archivos y líneas:**
  - 4 `KpiCard` y un gráfico plegado con **las mismas cifras**: [estanques/page.tsx:122-159](app/(app)/combustibles/cuadratura/estanques/page.tsx#L122-L159)
  - nivel en tabla: [estanques-sections.tsx:44-63](app/(app)/combustibles/cuadratura/estanques/estanques-sections.tsx#L44-L63)
  - `getFuelStorageBalances`: [fuel-cycle.ts:165](lib/combustibles/fuel-cycle.ts#L165)
- **Representación actual:** tiles, más un gráfico duplicado (A5) y tablas.
- **Problema:** «¿cuánto queda y cuándo hay que pedir?» no se ve.
- **Visualización recomendada:**
  - **Ahora:** bullet bar de nivel sobre capacidad por estanque, con la marca de reposición; se retira el gráfico duplicado.
  - **Después:** nivel en el tiempo (línea escalonada) con las entradas y salidas como barras.
- **Datos y campos necesarios:** balances por estanque; `fuel_cycle_movements.quantity`, `occurred_at`, origen y destino ([fuel-cycle.ts:34](db/schema/fuel-cycle.ts#L34)).
- **Fórmula o agregación:** nivel = Σ entradas − Σ salidas. Sin capacidad declarada, se muestra sólo el nivel.
- **Disponibilidad de datos:** la bullet bar está **Disponible**; la serie temporal requiere **Backend**.
- **Filtros e interacciones:** producto y faena.
- **Beneficio funcional:** planificar la reposición.
- **Beneficio visual:** quita un duplicado.
- **Requisitos técnicos:** componente `BulletBar` (también lo usan CHART-005 y CHART-027).
- **Riesgos de interpretación:** nivel por encima de la capacidad (la tabla ya lo marca).
- **Complejidad:** baja (ahora) / media (serie).
- **Puntuación:** 16 + 18 + 6[Ep] + 10[E] + 7 + 7 = **64** (revisada el 2026-11-03 con datos de producción; primera pasada: 69). En producción: 342 movimientos de estanque.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-021: Telemetría contra cargas (L/h)

- **Módulo:** Combustibles › Consumo › Motor en vacío
- **Pantalla:** Motor en vacío
- **Ruta:** `/combustibles/consumo/motor-en-vacio`
- **Archivos y líneas:** `LitersPerHourTable` ([motor-en-vacio/page.tsx:151-153](app/(app)/combustibles/consumo/motor-en-vacio/page.tsx#L151-L153)); `getLitersPerHourComparison` ([idle-comparison.ts:16-28](lib/combustibles/control/queries/idle-comparison.ts#L16-L28)).
- **Representación actual:** tabla de pares de L/h.
- **Problema:** la discrepancia entre telemetría y registro de cargas (un posible desvío de combustible) se lee fila por fila.
- **Visualización recomendada:** gráfico de dispersión con la diagonal y = x y una banda de ±15 %. Cada punto es un equipo-mes; los que quedan fuera de la banda llevan rótulo.
- **Datos y campos necesarios:** `telemetryLph`, `loadsLph`, `differencePct` de `fuel_telemetry_daily` (VisionLink).
- **Fórmula o agregación:** L/h telemetría = Σ(litros trabajando + litros en vacío) / Σ horas; L/h cargas = Σ litros cargados / Σ horas.
- **Disponibilidad de datos:** **Disponible**, con cobertura limitada. En `bodega_dev` hay 475 días de telemetría de **5 equipos**, entre el 2026-07-01 y el 2026-10-29.
- **Filtros e interacciones:** mes. Clic lleva a la ficha del equipo.
- **Beneficio funcional:** detecta descuadres por equipo.
- **Beneficio visual:** muestra la desviación de un vistazo.
- **Requisitos técnicos:** `ScatterChart` (ya hay uno en [scatter-charts.tsx](app/(app)/combustibles/scatter-charts.tsx)).
- **Riesgos de interpretación:**
  - huecos de sincronización: la corrida diaria de VisionLink cubre 14 días;
  - meses sin cargas calculadas;
  - pocos equipos, así que no hay que inferir conclusiones de flota.
- **Complejidad:** baja.
- **Puntuación:** 17 + 16 + 4[Ep] + 4[E] + 7 + 8 = **56** (revisada el 2026-11-03 con datos de producción; primera pasada: 65). En producción: telemetría de 6 equipos desde 2024-12, pero 0 cargas para comparar.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-022: Cobertura de datos por fuente y mes

- **Módulo:** Combustibles › Fuentes
- **Pantalla:** Fuentes de datos
- **Ruta:** `/combustibles/fuentes`
- **Archivos y líneas:** cobertura como `technical: string[]` ([sources-status.ts:66-72](lib/combustibles/sources-status.ts#L66-L72)); `fuel_provider_period_coverage` ([fuel-integrations.ts:205](db/schema/fuel-integrations.ts#L205)).
- **Representación actual:** tarjetas con frases de texto.
- **Problema:** antes de creer cualquier gráfico de combustible hay que saber si el mes está completo. La memoria del proyecto registra que el sync de OnWay está caído desde el 2026-10-30, y eso no se ve de un vistazo.
- **Visualización recomendada:** mapa de calor de fuentes (Copec TCT, Copec transacciones, OnWay, VisionLink, registro manual) × meses. La celda indica completo / parcial / sin datos / rechazos, con los litros en el tooltip. El mismo estado alimenta un **aviso de cobertura en cada gráfico de combustible** (ver la sección I, fase 4).
- **Datos y campos necesarios:** `fuel_provider_period_coverage.channel`, `product`, `period_month`, `status`, `rows_*`, `quantity_total`; días con datos de `fuel_telemetry_daily.day`; `completeUntil`.
- **Fórmula o agregación:** estado por celda.
- **Disponibilidad de datos:** **Procesamiento**.
- **Filtros e interacciones:** clic en una celda lleva a los archivos o corridas del mes.
- **Beneficio funcional:** confianza en los datos.
- **Beneficio visual:** el estado de la integración queda visible.
- **Requisitos técnicos:** grilla de CHART-008.
- **Riesgos de interpretación:** ninguno relevante.
- **Complejidad:** baja.
- **Puntuación:** 18 + 20 + 6[Ep] + 13[E] + 7 + 7 = **71** (revisada el 2026-11-03 con datos de producción; primera pasada: 70). En producción: 48 coberturas; hueco Copec en septiembre de 2026.
- **Prioridad:** **P2** (primera pasada: P2)

#### CHART-023: Casos de anomalía en el tiempo y evidencia como gráfico

- **Módulo:** Combustibles › Revisar
- **Pantalla:** Bandeja de revisión
- **Ruta:** `/combustibles/revisar`
- **Archivos y líneas:**
  - torta y barras multicolor sin nombre accesible, con `RULE_COLORS`: [anomaly-distribution-chart.tsx:16-125](app/(app)/combustibles/anomalias/anomaly-distribution-chart.tsx#L16-L125)
  - el conteo por tipo aparece dos veces, en `SegmentedControl` y en `RankedList`: [revisar/page.tsx:155-161, 255](app/(app)/combustibles/revisar/page.tsx#L155-L255)
  - lecturas del medidor mostradas como tarjetas: [inbox-evidence.tsx:24-50](components/combustibles/inbox/inbox-evidence.tsx#L24-L50)
- **Representación actual:** bandeja, torta, barras multicolor y un conteo duplicado.
- **Problema:** el color no codifica nada (contradice la regla de `RankedList`), no hay tendencia de casos, y la evidencia del medidor regresivo se lee como números.
- **Visualización recomendada:**
  - **(a)** Retirar la torta. Reemplazar las barras por reglas en `RankedList` de un solo tono y quitar el conteo duplicado.
  - **(b)** Casos por semana según `detected_at`, apilados por severidad.
  - **(c)** En la evidencia, un sparkline de las lecturas con el punto regresivo marcado.
- **Datos y campos necesarios:** anomalías `detected_at`, `severity`, `rule` ([fuel-anomalies.ts:29-55](db/schema/fuel-anomalies.ts#L29-L55)); evidencia `type:"readings"`.
- **Fórmula o agregación:** conteo de casos por semana y severidad.
- **Disponibilidad de datos:** (b) **Backend**; (a) y (c) **Disponible**.
- **Filtros e interacciones:** clic en una regla filtra la bandeja.
- **Beneficio funcional:** ver si una regla se dispara de más (un falso positivo que se repite).
- **Beneficio visual:** menos color sin significado.
- **Requisitos técnicos:** `MiniSparkline` existente.
- **Riesgos de interpretación:** un cambio de reglas altera la serie; marcar con una anotación las fechas de cambio de regla.
- **Complejidad:** baja a media.
- **Puntuación:** 15 + 17 + 6[Ep] + 12[E] + 7 + 7 = **64** (revisada el 2026-11-03 con datos de producción; primera pasada: 66). En producción: 346 casos de anomalía.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-024: Vacío diario en la ficha de consumo del equipo

- **Módulo:** Combustibles › Consumo › Equipo
- **Ruta:** `/combustibles/consumo/equipos/[id]`
- **Archivos y líneas:** 5 cifras sueltas ([equipos/[id]/page.tsx:190-202](app/(app)/combustibles/consumo/equipos/%5Bid%5D/page.tsx#L190-L202)); `IdleDailyChart` y `getIdleDailySeries` ya existen ([idle.ts:181](lib/combustibles/control/queries/idle.ts#L181)).
- **Representación actual:** cifras sueltas.
- **Visualización recomendada:** reutilizar `IdleDailyChart` filtrado por el equipo.
- **Datos y campos necesarios:** horas de motor y horas en vacío por día, de `fuel_telemetry_daily`.
- **Fórmula o agregación:** % en vacío = horas en vacío / horas de motor, por día.
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** los del gráfico existente (tooltip por día).
- **Problema / Beneficio:** el vacío del equipo se ve como hábito diario y no como un promedio.
- **Requisitos técnicos:** importar el componente y pasarle el equipo.
- **Riesgos de interpretación:** los días con menos de 1 h de motor dan porcentajes engañosos; la página de vacío ya lo advierte.
- **Complejidad:** muy baja.
- **Puntuación:** 12 + 13 + 4[Ep] + 12[E] + 6 + 10 = **57** (revisada el 2026-11-03 con datos de producción; primera pasada: 62). En producción: telemetría de 6 equipos.
- **Prioridad:** **P3** (primera pasada: P3)

#### CHART-025: Disponibilidad de flota en el tiempo

- **Módulo:** Control operacional / Mantención
- **Pantalla:** Control operacional; Panel de mantención
- **Ruta:** `/control-operacional`, `/mantencion/panel`
- **Archivos y líneas:**
  - `SummaryBar` con disponibilidad y MTTR (tiempo medio de reparación) sin período anterior: [control-operacional/page.tsx:248](app/(app)/control-operacional/page.tsx#L248)
  - agregado sólo total: [operational-control.ts:143-162, 275-280](lib/services/operational-control.ts#L143-L280)
  - MTTR ya calculado: [operational-control.ts:507-508](lib/services/operational-control.ts#L507-L508)
- **Representación actual:** cifras sin tendencia.
- **Problema:** «¿la disponibilidad empeora?» no tiene respuesta.
- **Visualización recomendada:**
  - línea semanal de disponibilidad de flota, con los umbrales 80 y 90 (`AVAILABILITY_THRESHOLDS`) como banda;
  - franja tipo Gantt por equipo para las últimas 8 semanas;
  - la tasa de cobertura del historial siempre a la vista, al lado.
- **Datos y campos necesarios:** `fuel_vehicle_operational_intervals.state`, `started_at`, `ended_at`. En `bodega_dev` hay 19 intervalos.
- **Fórmula o agregación:** horas operativas / horas del período, con los intervalos recortados al período.
- **Disponibilidad de datos:** **Backend** (serie semanal).
- **Filtros e interacciones:** faena y tipo de equipo.
- **Beneficio funcional:** gestionar la flota con la tendencia a la vista.
- **Beneficio visual:** contexto para una cifra crítica.
- **Requisitos técnicos:** consulta de serie; `TimelineBars`.
- **Riesgos de interpretación:** **serio**. Una correctiva con el equipo en taller registrada desde la app **no** mueve el estado (sólo lo hacen OT, flota, inspecciones y combustible, según `vehicle-status.ts`), así que la disponibilidad queda **sobrestimada**. Esto debe resolverse en los datos antes de destacar la cifra (ver CHART-026).
- **Complejidad:** media.
- **Puntuación:** 19 + 22 + 4[Ep] + 3[E] + 7 + 5 = **60** (revisada el 2026-11-03 con datos de producción; primera pasada: 68). En producción: 89 intervalos, uno por vehículo: no hay historia.
- **Prioridad:** **P3** (primera pasada: P2)

#### CHART-026: Mantención: antigüedad de OT, tiempo de ciclo y MTTR/MTBF

- **Módulo:** Mantención
- **Pantalla:** Panel de jefatura; OT
- **Ruta:** `/mantencion/panel`, `/mantencion/ot`
- **Archivos y líneas:**
  - KPI del panel: [panel-kpis.tsx:40-77](components/mantencion/jefatura/panel/panel-kpis.tsx#L40-L77)
  - tarjetas: [panel-cards.tsx](components/mantencion/jefatura/panel/panel-cards.tsx)
  - `mant_work_orders`: [mantencion-work-orders.ts:40-93](db/schema/mantencion-work-orders.ts#L40-L93)
  - eventos de la OT: `mant_work_order_events` (:195-206)
  - `getWorkOrderGlobalMetrics` y `meanTimeToRepairHours`: `lib/services/mantencion/work-orders/metrics.ts:170, 217`
- **Representación actual:** el panel ya tiene un gráfico semanal y `RankedList`, pero no muestra las OT abiertas, su antigüedad, el tiempo de ciclo ni el MTTR.
- **Problema:** el jefe de mantención no ve el atasco en el flujo de OT ni su evolución.
- **Visualización recomendada:**
  - **(a)** Barras horizontales apiladas de OT abiertas por estado × tramo de edad (0–2, 3–7, 8–15 y más de 15 días), con clic que lleva a `/mantencion/ot?estado=`.
  - **(b)** Mediana y p90 de horas por etapa: barras con bigote.
  - **(c)** MTTR mensual con n visible.
  - **(d)** MDBF (lectura media entre fallas) por equipo como `RankedList` con su unidad: nunca un promedio de flota que mezcle km y horas.
- **Datos y campos necesarios:** `status`, `request_date`, `assigned_at`, `started_at`, `created_at`, `workshop_entry_at`, `workshop_exit_at`; `from_status`, `to_status`, `created_at` de los eventos; correctivas `mant_records.kind='C'` con `reading`.
- **Fórmula o agregación:**
  - edad = hoy − `created_at`;
  - horas por etapa = diferencia entre transiciones consecutivas;
  - MTTR = Σ(salida − entrada) / n reparaciones;
  - MDBF = Δ lectura entre correctivas consecutivas, con al menos 2 por equipo.
- **Disponibilidad de datos:**
  - (a) **Backend**;
  - (b) y (c) **Procesamiento**;
  - (d) **Procesamiento**, con datos insuficientes hoy.
  - **Advertencia:** la OT nació el 2026-11-02 (migración 0369; en `bodega_dev` hay 0 OT y 0 registros de mantención), así que hoy casi no hay historia: es **Nuevos datos** en la práctica. El valor llega a medida que se acumulan meses.
- **Filtros e interacciones:** faena y taller.
- **Beneficio funcional:** atacar el atasco y ver el efecto.
- **Beneficio visual:** lleva el panel al nivel del flujo de OT.
- **Requisitos técnicos:** consultas nuevas con `lib/services/mantencion/access.ts`.
- **Riesgos de interpretación:**
  - n pequeño: mostrar puntos y no promedios;
  - `mant_record_correctives.hours` son horas-hombre, no tiempo detenido;
  - una correctiva no siempre es una falla.
- **Complejidad:** media.
- **Puntuación:** 18 + 20 + 2[Ep] + 2[E] + 7 + 5 = **54** (revisada el 2026-11-03 con datos de producción; primera pasada: 65). En producción: 0 OT (módulo recién lanzado).
- **Prioridad:** **P4** (primera pasada: P2) · construirla cuando haya 2–3 meses de OT

#### CHART-027: Próximas mantenciones como % del intervalo consumido

- **Módulo:** Mantención
- **Pantalla:** Panel de jefatura, tarjeta «Próximas mantenciones»
- **Ruta:** `/mantencion/panel`
- **Archivos y líneas:** tabla `UpcomingCard` ([panel-cards.tsx:158](components/mantencion/jefatura/panel/panel-cards.tsx#L158)); `closeness()` ya normaliza ([panel.ts:195-198](lib/services/mantencion/panel.ts#L195-L198)).
- **Representación actual:** una tabla expresada en lecturas restantes («faltan 1.200 km» o «faltan 40 h»).
- **Problema:** no se pueden comparar un camión (km) y una grúa (horas). La urgencia relativa no se ve.
- **Visualización recomendada:**
  - una barra bullet por fila, de 0 a 100 % del intervalo, con la marca de tolerancia;
  - por encima de 100 % = vencida, en `danger` y con el texto «vencida»;
  - la fila se ordena por % y conserva la lectura restante como texto.
- **Datos y campos necesarios:** `remaining` y `nextIntervalValue` de `loadFleet`.
- **Fórmula o agregación:** % = 1 − restante / intervalo. Un equipo sin intervalo va como «sin pauta».
- **Disponibilidad de datos:** **Disponible**. En `bodega_dev` hay 119 perfiles de equipo y 197 ítems de pauta.
- **Filtros e interacciones:** faena. Clic lleva a la ficha.
- **Beneficio funcional:** priorizar el taller de la semana.
- **Beneficio visual:** compara unidades distintas sin mezclarlas.
- **Requisitos técnicos:** `BulletBar` (CHART-020).
- **Riesgos de interpretación:** la proyección a fecha calendario **no** forma parte de esta propuesta: necesita estimar el uso diario a partir de lecturas escasas, lo que es **Procesamiento** y frágil. Si se hace, se muestra como rango.
- **Complejidad:** baja.
- **Puntuación:** 18 + 21 + 2[Ep] + 3[E] + 8 + 9 = **61** (revisada el 2026-11-03 con datos de producción; primera pasada: 83). En producción: 0 perfiles: la carga inicial no corrió en producción.
- **Prioridad:** **P3** (primera pasada: P1)

#### CHART-028: Recorridos GPS (backend existente sin interfaz)

- **Módulo:** Flota › Monitoreo
- **Ruta:** `/flota/monitoreo` (pestaña Historial)
- **Archivos y líneas:**
  - la pestaña «Historial» manda a la ficha de flota, que no tiene historial GPS: [fleet-gps-workspace.tsx:95](app/(app)/flota/monitoreo/fleet-gps-workspace.tsx#L95)
  - `getFleetGpsHistory` **sin llamadores** (verificado por grep): [fleet-gps.ts:118](lib/services/fleet-gps.ts#L118)
- **Representación actual:** mapa MapLibre de la última posición y una tabla.
- **Problema:** el historial está consultado pero no tiene interfaz.
- **Visualización recomendada:** recorrido diario como línea sobre el mapa existente y barras de km por día.
- **Datos y campos necesarios:** `fleet_gps_position_history` (retención de 30 días); `fleet_gps_trips.distance_km`, `idle_duration`.
- **Fórmula o agregación:** km por día = Σ `distance_km` de los viajes del día; el recorrido se dibuja con los puntos crudos.
- **Disponibilidad de datos:** **Backend** (sólo la interfaz; el servicio existe). **Hoy, además, el sync OnWay está caído desde el 2026-10-30** según la memoria del proyecto, y eso debe resolverse primero.
- **Filtros e interacciones:** equipo y día.
- **Beneficio funcional:** reconstruir el uso de un equipo en un día dado.
- **Requisitos técnicos:** capa GeoJSON en MapLibre. Hay que retirar los colores hex de [fleet-gps-map.tsx:43-45](app/(app)/flota/monitoreo/fleet-gps-map.tsx#L43-L45) y el estilo de teselas de desarrollo.
- **Riesgos de interpretación:** huecos de sincronización.
- **Complejidad:** media.
- **Puntuación:** 14 + 12 + 2[Ep] + 0[E] + 8 + 5 = **41** (revisada el 2026-11-03 con datos de producción; primera pasada: 51). En producción: 0 posiciones históricas; sync OnWay caído.
- **Prioridad:** **P4** (primera pasada: P4)

---

### D.3 Abastecimiento, bodega y finanzas

#### CHART-029: Lead time del ciclo solicitud → aprobación → OC → recepción → entrega

- **Módulo:** Adquisiciones / Seguimiento / Analítica
- **Pantalla:** Analítica; ficha de seguimiento de ítem; ficha de solicitud
- **Ruta:** `/analitica`, `/seguimiento/[itemId]`, `/solicitudes/[id]`
- **Archivos y líneas:**
  - **Fuentes de fecha:**
    - `purchase_requests.submitted_at` ([requests.ts:33](db/schema/requests.ts#L33))
    - `approval_decisions.decided_at` ([:176](db/schema/requests.ts#L176))
    - `purchase_orders.issued_at` / `sent_at` ([purchasing.ts:28-30](db/schema/purchasing.ts#L28-L30)), unidas por `purchase_order_items.request_item_id` (:81)
    - `receipts.received_at` ([receiving.ts:16](db/schema/receiving.ts#L16)), unidas por `receipt_items.purchase_order_item_id` (:67)
    - `deliveries.delivered_at` (:113), unidas por `delivery_items.request_item_id` (:155)
    - alternativa: `status_history` ([audit.ts:45-53](db/schema/audit.ts#L45-L53))
  - **Pantallas actuales:**
    - el stepper sin fechas `RequestProgressPanel` ([request-progress-panel.tsx](components/states/request-progress-panel.tsx))
    - las 6 tablas de `/seguimiento/[itemId]`
- **Representación actual:** un stepper sin duraciones y seis tablas separadas por ítem. **No existe ningún servicio de lead time** en `lib/services` (verificado).
- **Problema:** la pregunta más frecuente de un área de abastecimiento («¿dónde se demora lo que pedí?») no tiene respuesta agregada. Por ítem, hay que reconstruirla leyendo seis tablas. La factura **no** forma parte de la traza (`TimelineEvent`, `types.ts:110-117`).
- **Visualización recomendada:**
  - **Agregado (en /analitica):** una barra horizontal apilada por faena o tipo de solicitud, con un segmento por tramo (aprobación, emisión de OC, llegada, entrega) y largo igual a la mediana de días. Un marcador indica el P90.
  - **Por ítem:** un swimlane de etapas con duración y fecha.
  - **En la solicitud:** días por etapa dentro del stepper existente.
  - **Sankey descartado:** las etapas son secuenciales y no se ramifican.
- **Datos y campos necesarios:** los citados, más `request_type`, `worksite_id` y proveedor.
- **Fórmula o agregación:**
  - días corridos por tramo; P50 y P90 por faena, tipo y proveedor;
  - recepción parcial: la primera recepción marca «llegó algo» y la última, «completo»;
  - se excluyen las recepciones `voided`;
  - se compara con el período anterior.
- **Disponibilidad de datos:** **Backend**. En `bodega_dev` hay 35 OC (2026-07-08 → 10-02) y 58 entregas, así que la serie sería pobre en desarrollo.
- **Filtros e interacciones:** período, faena, tipo y proveedor. Clic en un tramo lista los ítems más lentos de ese tramo.
- **Beneficio funcional:** saber si el cuello de botella está en aprobar, comprar o despachar, y a quién reclamar.
- **Beneficio visual:** el proceso se ve como proceso.
- **Requisitos técnicos:** servicio nuevo con alcance `worksiteFilter`; componente `StageDurationBar`.
- **Riesgos de interpretación:**
  - fechas en `text` con formatos mezclados, día o ISO (comentario en `analytics-module/dashboard.ts:51-52`);
  - ítems divididos (`splitFromItemId`);
  - servicios sin recepción física;
  - **sesgo de supervivencia**: sólo cuentan los ítems cerrados, por eso se acompaña con la antigüedad de los abiertos (CHART-030).
- **Complejidad:** alta.
- **Puntuación:** 22 + 22 + 13[Ep] + 9[E] + 8 + 3 = **77** (revisada el 2026-11-03 con datos de producción; primera pasada: 71). En producción: 55 solicitudes, 252 ítems, 57 OC, 78 recepciones y 240 entregas (jul–nov).
- **Prioridad:** **P1** (primera pasada: P2)

#### CHART-030: Antigüedad de la cola de aprobaciones

- **Módulo:** Adquisiciones › Aprobaciones
- **Pantalla:** Aprobaciones
- **Ruta:** `/aprobaciones`
- **Archivos y líneas:** `ageDays` ya calculado ([aprobaciones/page.tsx:91](app/(app)/aprobaciones/page.tsx#L91)); la cola muestra sólo la fecha (`request-group.tsx:112-114`); permisos (:52-53).
- **Representación actual:** una lista paginada agrupada por solicitud.
- **Problema:** el aprobador no ve cuánto de lo suyo lleva más de una semana.
- **Visualización recomendada:**
  - barra horizontal apilada con los tramos 0–1, 2–3, 4–7 y más de 7 días, coloreados por urgencia;
  - clic en un tramo filtra la cola;
  - la urgencia sólo colorea: no se agrega un control de urgencia (A5).
  - Cada fila de la lista suma «hace N días» en mono.
- **Datos y campos necesarios:** `purchase_request_items.status='requested'`, `purchase_requests.submitted_at`, `urgency`.
- **Fórmula o agregación:** edad = hoy − `submitted_at`, en días, como foto del momento.
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** los existentes.
- **Beneficio funcional:** desbloquear primero lo más antiguo o urgente.
- **Beneficio visual:** contexto inmediato.
- **Requisitos técnicos:** cambio local; barra CSS (`StatusShareBar` existente).
- **Riesgos de interpretación:** ninguno relevante.
- **Complejidad:** baja.
- **Puntuación:** 14 + 17 + 13[Ep] + 15[E] + 7 + 9 = **75** (revisada el 2026-11-03 con datos de producción; primera pasada: 80). En producción: 245 decisiones; la espera por aprobación tiene **mediana de 8,3 h y P90 de 6 días** (máx. 21), y al momento del clon la cola estaba vacía. El gráfico de antigüedad sólo muestra algo en los picos: lo más informativo es la distribución de esa espera, que cubre CHART-029.
- **Prioridad:** **P1** (primera pasada: P1)

#### CHART-031: Distribución por estado en Seguimiento

- **Módulo:** Adquisiciones › Seguimiento
- **Ruta:** `/seguimiento`
- **Archivos y líneas:**
  - 4 `KpiCard` y un `MetricBar` de 3 ([consolidated-kpis.tsx:78-136](app/(app)/seguimiento/_components/consolidated-kpis.tsx#L78-L136));
  - `computeAggregateKPIs` cuenta solicitudes con *alguna* línea en cada etapa, así que **las cifras no son excluyentes** ([trazabilidad-consolidated-builder.ts:393-440](lib/services/trazabilidad-consolidated-builder.ts#L393-L440));
  - «Esperando proveedor» cuenta OC, no solicitudes;
  - truncado a 2.000 ítems (`trazabilidad-consolidated-queries.ts:36`).
- **Representación actual:** 7 cifras de una misma dimensión (la etapa), medidas en unidades distintas. Verificado en el navegador: 4 tiles y una tabla de 9 columnas.
- **Problema:** las cifras parecen sumar el total, pero no suman.
- **Visualización recomendada:** una barra 100 % ordenada por ciclo de vida (Borrador → … → Entregado), sobre `ConsolidatedRequest.status`, que sí es excluyente. Los segmentos son clicables y llevan a `?estado=`. Reemplaza a los 4 tiles y al `MetricBar`.
- **Datos y campos necesarios:** el `status` por solicitud, ya cargado.
- **Fórmula o agregación:** conteo por estado.
- **Disponibilidad de datos:** **Procesamiento** (en el cliente).
- **Filtros e interacciones:** los existentes; se mantiene el aviso de truncamiento.
- **Beneficio funcional:** una lectura correcta.
- **Beneficio visual:** 7 cifras pasan a una barra.
- **Requisitos técnicos:** `StatusShareBar`.
- **Riesgos de interpretación:** el truncamiento.
- **Complejidad:** baja.
- **Puntuación:** 17 + 15 + 11[Ep] + 13[E] + 7 + 8 = **71** (revisada el 2026-11-03 con datos de producción; primera pasada: 70). En producción: 55 solicitudes reales.
- **Prioridad:** **P2** (primera pasada: P2)

#### CHART-032: Rehacer Reportes (estado por ciclo, faena y período)

- **Módulo:** Reportes
- **Ruta:** `/reportes`
- **Archivos y líneas:**
  - tiles con `xl:grid-cols-5` para 4 tiles ([reportes/page.tsx:177-221](app/(app)/reportes/page.tsx#L177-L221));
  - `pendingReceiptCount` mostrado 3 veces (l.141, 146 y 161; verificado);
  - «Recepciones» cuenta las anuladas (l.77-82);
  - una faena inactiva aparece como UUID (l.155);
  - estados ordenados por conteo y no por ciclo (`helpers:66`).
- **Representación actual:** tiles, más listas de estado y paneles de desglose en texto. Verificado en el navegador: 0 tablas, 0 gráficos y 39 cifras.
- **Problema:** es histórico, no tiene período, repite cifras y ordena mal.
- **Visualización recomendada:**
  - barras horizontales de estado **en orden de ciclo**;
  - una barra agrupada por faena con «ítems sin OC» y «OC pendientes», en lugar de dos paneles de texto;
  - selector de período con comparación.
- **Datos y campos necesarios:** las consultas de l.84-118 con filtro de período.
- **Fórmula o agregación:** conteos por estado y faena dentro del período.
- **Disponibilidad de datos:** **Disponible** (más un filtro).
- **Filtros e interacciones:** período y faena.
- **Beneficio funcional:** saber dónde se atasca el flujo.
- **Beneficio visual:** la pantalla deja de ser una lista de cifras.
- **Requisitos técnicos:** cambios locales y corrección de los tres defectos.
- **Riesgos de interpretación:** solape con `/analitica` y con el tablero. Hay que decidir si `/reportes` sobrevive o se fusiona (ver la sección E).
- **Complejidad:** baja.
- **Puntuación:** 16 + 14 + 5[S] + 15[E] + 7 + 8 = **65** (revisada el 2026-11-03 con datos de producción; primera pasada: 65). En producción: datos reales de adquisiciones.
- **Prioridad:** **P2** (primera pasada: P2)

#### CHART-033: Analítica: Pareto de proveedores, rankings de un tono y una sola base de fecha

- **Módulo:** Reportes › Analítica
- **Ruta:** `/analitica`
- **Archivos y líneas:**
  - **Gráficos:** [analytics-charts.tsx](app/(app)/analitica/analytics-charts.tsx).
    - Ninguno lleva `<Legend>`: la línea de 3 series sólo se distingue en el tooltip.
    - Usan `Cell` de un color por barra, tomado de `CHART_SERIES` (l.63, 102), con hex ([chart-palette.ts:30-38](lib/chart-palette.ts#L30-L38)).
    - No tienen nombre accesible.
  - **Fechas:** se fecha por `createdAt` (`dashboard.ts:145, 161`), mientras el tablero Finanzas usa `issuedAt` (:53-63).
  - **«Gasto total»:** no pasa `trendPolarity` y cae en `"up-good"` ([kpi-card.tsx:28](components/ui/kpi-card.tsx#L28)). **Verificado en el navegador:** una baja de 100 % del gasto aparece como chip rojo.
  - **Tile «Alertas»:** lleva a `/dashboard` (page.tsx:147).
- **Representación actual:** 4 KPI, 4 gráficos (en `bodega_dev` se ven vacíos con `ChartEmpty`, que es correcto) y 4 tablas top-10.
- **Problema:** **Con datos de producción** (captura [a-analitica.png](qa/reports/2026-11-03-visualizaciones/a-analitica.png)): con la ventana por defecto de 30 días la tendencia mensual es un solo punto; un alza de gasto de 133 % se pinta en verde; y combustible marca $0 porque el servicio lee `fuel_loads` (0 filas) y no las transacciones Copec (Anexo C, C-9 y C-10).
  - el color no codifica nada;
  - las cifras de /analitica y de `/dashboard?vista=finanzas` divergen en el mismo período;
  - la semántica del delta está invertida.
- **Visualización recomendada:**
  - Pareto de proveedores (barras de un tono y línea acumulada, con referencia en `supplierConcentrationPct` = 60 %);
  - faenas y vehículos en `RankedList`;
  - el gasto mensual como área apilada de compras + combustible, con leyenda y sin la serie «Total», que es redundante.
- **Datos y campos necesarios:** `topSuppliers` (`limit(10)`) y `totalSpend` («Otros» = total − top 10).
- **Fórmula o agregación:**
  - % acumulado = Σ gasto de los i primeros / gasto total;
  - **unificar** con el predicado `issuedAt` + `issuedOrderPredicate`;
  - **decidir** neto o con IVA: hoy el KPI suma `totalAmount` (con IVA, inferido) y las barras suman `subtotal`.
- **Disponibilidad de datos:** **Procesamiento**.
- **Filtros e interacciones:** los existentes. Clic en un proveedor lleva a `/compras?proveedor=`.
- **Beneficio funcional:** ver la concentración y el riesgo de dependencia de proveedores.
- **Beneficio visual:** coherencia con el tablero.
- **Requisitos técnicos:** cambios locales y en el servicio.
- **Riesgos de interpretación:** mezcla de compras y combustible en un mismo ranking; neto contra IVA.
- **Complejidad:** media.
- **Puntuación:** 18 + 18 + 8[S] + 12[E] + 8 + 8 = **72** (revisada el 2026-11-03 con datos de producción; primera pasada: 72). En producción: 57 OC y 5.671 transacciones Copec.
- **Prioridad:** **P2** (primera pasada: P2) · la polaridad del delta sigue siendo una corrección inmediata (Fase 0)

#### CHART-034: Conciliación OC–factura y cobertura DTE

- **Módulo:** Compras / Facturación
- **Ruta:** `/compras/dte` y un panel en `/analitica`
- **Archivos y líneas:**
  - `purchase_orders.invoice_reconciliation_status` ([purchasing.ts:43](db/schema/purchasing.ts#L43)), con índice en l.74;
  - `purchase_order_invoices.amount` / `document_kind` (:175-176);
  - fórmula de monto por facturar ([invoice-reconciliation.ts:505](lib/services/purchasing-module/invoice-reconciliation.ts#L505));
  - `dte_documents.periodo`, `monto_total`, `purchase_order_invoice_id`, `fuel_load_id` ([dte.ts:120-165](db/schema/dte.ts#L120-L165));
  - tope de 300 filas (`compras/dte/page.tsx:23`).
- **Representación actual:** el estado se ve OC por OC; los DTE se muestran en una tabla truncada.
- **Problema:** no se sabe cuánto queda por facturar ni qué fracción de los DTE está sin vincular.
- **Visualización recomendada:**
  - barras mensuales (por mes de emisión) apiladas por estado de conciliación, con `needs_review` en `danger`;
  - barras de DTE por período apiladas en: vinculado a OC / vinculado a combustible / sin vincular, en monto y en cantidad.
- **Datos y campos necesarios:** los citados.
- **Fórmula o agregación:**
  - monto por facturar = Σ max(0, OC − facturado);
  - las notas de crédito restan;
  - se excluyen los documentos anulados.
- **Disponibilidad de datos:** conteos **Disponible**; montos **Procesamiento**.
- **Filtros e interacciones:** período. Clic lleva a la lista filtrada.
- **Beneficio funcional:** control de cierre contable.
- **Beneficio visual:** muestra lo que el tope de 300 filas oculta.
- **Requisitos técnicos:** consulta agregada.
- **Riesgos de interpretación:**
  - el estado es una proyección y puede estar desfasado (`invoiceReconciliationUpdatedAt`);
  - **`dte_documents` no tiene faena** (inferido), así que el gráfico de DTE es global. Hay que decidir si lo ve un rol con alcance limitado a algunas faenas.
- **Complejidad:** media.
- **Puntuación:** 17 + 19 + 7[Ep] + 12[E] + 7 + 7 = **69** (revisada el 2026-11-03 con datos de producción; primera pasada: 68). En producción: 3.363 DTE y 36 facturas de OC.
- **Prioridad:** **P2** (primera pasada: P2)

#### CHART-035: Cobertura de stock en días y saldo en el tiempo (Bodega)

- **Módulo:** Bodega
- **Pantalla:** Stock; Kardex
- **Ruta:** `/bodega`
- **Archivos y líneas:**
  - hasta 2.000 filas sin paginar ([bodega/page.tsx:42](app/(app)/bodega/page.tsx#L42));
  - umbrales mínimos retirados el 2026-10-02 (`attention.ts:39-41`);
  - columna Saldo del kardex (`kardex-table.tsx:96`);
  - `worksite_stock.quantity`, `inventory_movements.type`, `quantity`, `performed_at` ([stock.ts:14-54](db/schema/stock.ts#L14-L54)).
- **Representación actual:** una tabla agrupada y el kardex paginado.
- **Problema:** con los mínimos retirados, nada dice qué reponer. El kardex no muestra tendencia.
- **Visualización recomendada:**
  - **(a)** Columna «cobertura (días)» con una barra en la celda, más una tira de resumen: menos de 7 d / 7–30 / más de 30 / sin consumo.
  - **(b)** Con un producto y una faena filtrados, una línea escalonada del saldo y barras de ingreso y egreso sobre el kardex.
- **Datos y campos necesarios:** los citados.
- **Fórmula o agregación:**
  - cobertura = stock / (egresos de los últimos 90 días / 90);
  - egresos considerados: `egreso_entrega` y `egreso_desecho`; `egreso_traslado` es discutible y no es consumo final;
  - con 0 consumo se muestra «sin consumo», nunca ∞.
- **Disponibilidad de datos:** (a) **Backend**; (b) **Disponible**, con la serie completa. En `bodega_dev` hay sólo **10** movimientos de inventario: no se pudo ver con datos.
- **Filtros e interacciones:** faena y familia.
- **Beneficio funcional:** reponer antes del quiebre de stock sin volver a los mínimos manuales.
- **Beneficio visual:** contexto por fila.
- **Requisitos técnicos:** consulta con `worksiteScopeSql`.
- **Riesgos de interpretación:** demanda irregular de EPP; productos nuevos sin historia; las variantes de talla deben sumarse con cuidado.
- **Complejidad:** media.
- **Puntuación:** 18 + 21 + 12[Ep] + 9[E] + 7 + 5 = **72** (revisada el 2026-11-03 con datos de producción; primera pasada: 70). En producción: 724 movimientos y 199 saldos.
- **Prioridad:** **P2** (primera pasada: P2)

#### CHART-036: Facturación: reutilizar los gráficos del tablero

- **Módulo:** Facturación
- **Ruta:** `/facturacion`
- **Archivos y líneas:**
  - tabla de antigüedad ([facturacion/page.tsx:139-165](app/(app)/facturacion/page.tsx#L139-L165));
  - `summary.monthly` consultado y **no dibujado** ([billing/queries.ts:549, 767](lib/services/billing/queries.ts#L549); verificado: la página no lo referencia);
  - `toLocaleDateString` en l.118, que viola la regla de fechas (verificado);
  - `DebtAgingChart` y `BillingFlowChart` ya existen en `dashboard/charts/`.
- **Representación actual:** 4 `MoneyStat` sin comparación, la tabla de antigüedad y listas de texto. Verificado en el navegador: 1 tabla de 5 filas y 75 cifras.
- **Problema:** el dato mensual está consultado y se pierde; la antigüedad de la deuda va como tabla.
- **Visualización recomendada:**
  - `BillingFlowChart` (facturado contra cobrado por mes);
  - `DebtAgingChart` (tramos en orden cronológico, como exige la regla 7), con la tabla como alternativa plegable;
  - rankings de clientes y faenas en `RankedList`, una lista por moneda;
  - `Delta` contra el mes anterior en los `MoneyStat`.
- **Datos y campos necesarios:** `summary.monthly{period, currency, invoiced, collected}`.
- **Fórmula o agregación:** la existente.
- **Disponibilidad de datos:** **Disponible**.
- **Filtros e interacciones:** período y moneda. Los tramos llevan a la cobranza filtrada.
- **Beneficio funcional:** ver el flujo de caja y la deuda vencida.
- **Beneficio visual:** coherencia con Finanzas del tablero.
- **Requisitos técnicos:** mover los dos gráficos a `components/charts/` para que no dependan de la ruta del tablero.
- **Riesgos de interpretación:** monedas mezcladas: nunca sumar CLP con USD.
- **Complejidad:** baja.
- **Puntuación:** 18 + 19 + 6[S] + 15[E] + 8 + 9 = **75** (revisada el 2026-11-03 con datos de producción; primera pasada: 77). En producción: 565 facturas (jul–oct).
- **Prioridad:** **P1** (primera pasada: P1)

#### CHART-037: Tiempo en tránsito de las guías

- **Módulo:** Bodega › Guías
- **Ruta:** `/bodega/guias`
- **Archivos y líneas:** `dispatch_guides.dispatched_at` → `received_at`, `destination_worksite_id` ([dispatch-guides.ts:26-44](db/schema/dispatch-guides.ts#L26-L44)).
- **Representación actual:** una tabla.
- **Problema:** no se ve qué destino tarda en confirmar las guías.
- **Visualización recomendada:** mediana y P90 de días por destino (`RankedList` con bigote), más la antigüedad de las guías despachadas sin confirmar.
- **Datos y campos necesarios:** `dispatched_at`, `received_at`, `destination_worksite_id`, `status`.
- **Fórmula o agregación:** días = `received_at` − `dispatched_at`.
- **Disponibilidad de datos:** **Procesamiento**.
- **Filtros e interacciones:** período.
- **Beneficio funcional:** detectar los destinos que no confirman la recepción.
- **Beneficio visual:** sí, menor.
- **Requisitos técnicos:** consulta simple.
- **Riesgos de interpretación:** `partially_received` fija `received_at` antes de que llegue todo.
- **Complejidad:** baja.
- **Puntuación:** 12 + 13 + 9[Ep] + 10[E] + 6 + 8 = **58** (revisada el 2026-11-03 con datos de producción; primera pasada: 56). En producción: 36 guías.
- **Prioridad:** **P3** (primera pasada: P3)

---

### D.4 TI y Administración

#### CHART-038: Mesa de ayuda TI: volumen, SLA y edad del parque

- **Módulo:** TI
- **Ruta:** `/ti`
- **Archivos y líneas:**
  - `getTicketsByMonth`, `getTicketsByCategory` y `getAssetsByAge` **existen y no tienen llamadores** (0 usos, verificado por grep; `lib/services/ti/queries.ts:187-225`);
  - `getTicketsByMonth` no aplica el filtro de «últimos 12 meses» que promete su comentario;
  - `it_tickets.created_at`, `resolved_at`, `due_at`, `priority` ([ti.ts:214-233](db/schema/ti.ts#L214-L233));
  - gráficos existentes ([ti-charts-inner.tsx:83, 121](app/(app)/ti/ti-charts-inner.tsx#L83-L121)), verificados en el navegador: 2 gráficos y 2 tablas.
- **Representación actual:** 4 KPI, equipos por faena y mantenciones por mes.
- **Problema:** la mesa de ayuda no tiene tendencia ni medición de SLA; las consultas están escritas y no se usan.
- **Visualización recomendada:** barras de tickets por mes con la línea de % de SLA cumplido en el eje derecho (A5b), y barras de antigüedad del parque por año de compra, con «sin fecha» aparte.
- **Datos y campos necesarios:** los citados.
- **Fórmula o agregación:** % SLA = resueltos con `resolved_at` ≤ `due_at` / resueltos con `due_at` no nulo. Los tickets anteriores a la migración (con `due_at` nulo) quedan fuera del denominador.
- **Disponibilidad de datos:** volumen **Disponible**; SLA **Procesamiento**.
- **Filtros e interacciones:** categoría y prioridad.
- **Beneficio funcional:** dimensionar la mesa y planificar la renovación del parque.
- **Beneficio visual:** sí.
- **Requisitos técnicos:** conectar las consultas y corregir el filtro de 12 meses.
- **Riesgos de interpretación:** volumen bajo (8 activos en `bodega_dev`).
- **Complejidad:** baja.
- **Puntuación:** 14 + 15 + 2[Ep] + 2[E] + 6 + 8 = **47** (revisada el 2026-11-03 con datos de producción; primera pasada: 62). En producción: 0 activos, 0 tickets, 0 licencias.
- **Prioridad:** **P4** (primera pasada: P3)

#### CHART-039: Administración: crecimiento de respaldos y volumen de notificaciones

- **Módulo:** Admin
- **Ruta:** `/admin/backups`, `/admin/notificaciones`
- **Archivos y líneas:** `backup_log.started_at`, `completed_at`, `total_size_bytes` ([backups.ts:7-34](db/schema/backups.ts#L7-L34)); `notifications.type`, `created_at` ([audit.ts:146](db/schema/audit.ts#L146)).
- **Representación actual:** tablas.
- **Problema:** las tendencias de tamaño, duración y volumen de correos sólo se pueden reconstruir leyendo filas.
- **Visualización recomendada:** una línea de tamaño y duración de los respaldos, y barras de notificaciones por día y tipo.
- **Datos y campos necesarios:** los citados.
- **Fórmula o agregación:** ninguna en respaldos; conteo por día y tipo en notificaciones.
- **Disponibilidad de datos:** respaldos **Disponible**. Notificaciones: **Nuevos datos** para una historia confiable, porque las leídas se borran al superar la retención y la serie larga queda sesgada.
- **Filtros e interacciones:** —
- **Beneficio funcional:** anticipar el espacio de respaldo y diagnosticar picos de correo (la memoria del proyecto registra un caso: «DTE health», 2026-10-05).
- **Beneficio visual:** menor.
- **Requisitos técnicos:** cambios locales.
- **Riesgos de interpretación:** la retención de notificaciones.
- **Complejidad:** baja.
- **Puntuación:** 8 + 9 + 2[Ep] + 12[E] + 4 + 9 = **44** (revisada el 2026-11-03 con datos de producción; primera pasada: 44). En producción: 12 respaldos y 3.542 notificaciones.
- **Prioridad:** **P4** (primera pasada: P4)

---

### D.5 Tabla resumen del catálogo (orden por puntaje revisado)

| ID | Propuesta | Ruta principal | Disponibilidad en el modelo | En producción (2026-11-02) | Puntaje revisado | Primera pasada (potencial) | Prioridad |
|---|---|---|---|---|---|---|---|
| CHART-007 | Mapa de calor P×C en MIPER | `/prevencion/miper/[id]` | Disponible | 540 riesgos; 788 escrituras de 5 usuarios en 60 días | **82** | 78 | P1 |
| CHART-008 | Calendario de cumplimiento faena × mes (primitivo) | 8 pantallas de Prevención | Disponible | 3.991 casillas de capacitación (17 hechas) y 230 de alcotest; 0 sesiones CPHS | **77** | 85 | P1 |
| CHART-029 | Lead time del ciclo de abastecimiento | `/analitica`, `/seguimiento/[id]` | Backend | 55 solicitudes, 252 ítems, 57 OC, 78 recepciones y 240 entregas (jul–nov) | **77** | 71 | P1 |
| CHART-030 | Antigüedad de la cola de aprobaciones | `/aprobaciones` | Disponible | 245 decisiones; espera por aprobación P50 8,3 h, P90 6 días; cola vacía al clonar | **75** | 80 | P1 |
| CHART-036 | Facturación con los gráficos del tablero | `/facturacion` | Disponible | 565 facturas (jul–oct) | **75** | 77 | P1 |
| CHART-033 | Analítica: Pareto y una base de fecha | `/analitica` | Procesamiento | 57 OC y 5.671 transacciones Copec | **72** | 72 | P2 |
| CHART-035 | Cobertura de stock y saldo del kardex | `/bodega` | Backend / Disponible | 724 movimientos y 199 saldos | **72** | 70 | P2 |
| CHART-022 | Cobertura de datos por fuente y mes | `/combustibles/fuentes` | Procesamiento | 48 coberturas; hueco Copec en septiembre de 2026 | **71** | 70 | P2 |
| CHART-031 | Distribución por estado en Seguimiento | `/seguimiento` | Procesamiento | 55 solicitudes reales | **71** | 70 | P2 |
| CHART-034 | Conciliación OC–factura y cobertura DTE | `/compras/dte`, `/analitica` | Disponible / Procesamiento | 3.363 DTE y 36 facturas de OC | **69** | 68 | P2 |
| CHART-004 | PDTP con meta, % mensual y eje como ranking | `/prevencion/pdtp` | Disponible | plan de 821 casillas, programa 2026 en borrador, 0 ejecuciones | **68** | 86 | P2 |
| CHART-010 | Tendencia de inspecciones y alcotest | `/prevencion/inspecciones` | Backend / Disponible | 22 inspecciones (ago–oct) y 1 control de alcotest | **67** | 68 | P2 |
| CHART-001 | Tendencia de tasas DS 44 | `/prevencion/indicadores` | Disponible | 0 registros de HH y 1 incidente | **66** | 84 | P2 |
| CHART-017 | Desviación por equipo contra modelo | `/combustibles/consumo/rendimiento/[familia]` | Backend | 0 cargas en terreno | **66** | 75 | P2 |
| CHART-019 | Cuadratura contra tolerancia | `/combustibles/cuadratura/mandante` | Disponible | entradas a estanque sí (342 movimientos), entregas en terreno 0 | **65** | 77 | P2 |
| CHART-032 | Rehacer Reportes | `/reportes` | Disponible | datos reales de adquisiciones | **65** | 65 | P2 |
| CHART-005 | Resumen del reporte de gestión PDTP | `/prevencion/pdtp/[id]/reporte` | Disponible | plan de 821 casillas, programa en borrador, 0 ejecuciones | **64** | 76 | P3 |
| CHART-020 | Nivel de estanque contra capacidad | `/combustibles/cuadratura/estanques` | Disponible / Backend | 342 movimientos de estanque | **64** | 69 | P3 |
| CHART-023 | Anomalías en el tiempo y evidencia | `/combustibles/revisar` | Mixta | 346 casos de anomalía | **64** | 66 | P3 |
| CHART-009 | Exposición contra límite (higiene) | `/prevencion/higiene/grupos/[id]` | Disponible | 0 mediciones de exposición | **63** | 77 | P3 |
| CHART-027 | Próximas mantenciones como % del intervalo | `/mantencion/panel` | Disponible | 0 perfiles: la carga inicial no corrió en producción | **61** | 83 | P3 |
| CHART-016 | Rendimiento mensual km/L o L/h | `/combustibles/consumo/litros` | Disponible | 0 cargas en terreno; hay 3.910 lecturas de odómetro Copec que la serie no usa | **61** | 77 | P3 |
| CHART-018 | Hoja de vida visual del equipo | `/flota/[id]`, `/mantencion/equipos/[id]` | Backend | 0 perfiles de mantención, 0 cargas, un solo intervalo por vehículo | **61** | 72 | P3 |
| CHART-002 | Eventos y matriz de gravedad real × potencial | `/prevencion/incidentes` | Backend (menor) | 1 incidente | **60** | 74 | P3 |
| CHART-025 | Disponibilidad de flota en el tiempo | `/control-operacional` | Backend | 89 intervalos, uno por vehículo: no hay historia | **60** | 68 | P3 |
| CHART-012 | Horizonte de vencimientos (primitivo) | 6 pantallas | Mixta | 0 recursos de emergencia y 0 activos TI | **58** | 72 | P3 |
| CHART-003 | Antigüedad y flujo CAPA | `/prevencion/capa` | Backend | 0 acciones CAPA | **58** | 71 | P3 |
| CHART-037 | Tránsito de guías | `/bodega/guias` | Procesamiento | 36 guías | **58** | 56 | P3 |
| CHART-011 | Tasa de detención PPA | `/prevencion/ppa` | Backend | 11 PPA | **57** | 65 | P3 |
| CHART-024 | Vacío diario en la ficha del equipo | `/combustibles/consumo/equipos/[id]` | Disponible | telemetría de 6 equipos | **57** | 62 | P3 |
| CHART-013 | Matriz requisito × faena | `/prevencion/requisitos-legales` | Disponible | 0 requisitos legales | **56** | 71 | P3 |
| CHART-021 | Telemetría contra cargas | `/combustibles/consumo/motor-en-vacio` | Disponible | telemetría de 6 equipos desde 2024-12, pero 0 cargas para comparar | **56** | 65 | P3 |
| CHART-026 | OT: antigüedad, ciclo, MTTR, MDBF | `/mantencion/panel` | Backend / nuevos datos | 0 OT (módulo recién lanzado) | **54** | 65 | P4 |
| CHART-014 | Gantt de permisos de trabajo | `/prevencion/permisos` | Disponible | 0 permisos de trabajo | **51** | 70 | P4 |
| CHART-015 | Micro-visualizaciones de Prevención | varias | Disponible | casi todo vacío | **49** | 60 | P4 |
| CHART-038 | Mesa de ayuda y parque TI | `/ti` | Disponible / Procesamiento | 0 activos, 0 tickets, 0 licencias | **47** | 62 | P4 |
| CHART-039 | Respaldos y notificaciones | `/admin/*` | Disponible / nuevos datos | 12 respaldos y 3.542 notificaciones | **44** | 44 | P4 |
| CHART-006 | Depurar material/ambiental | `/prevencion/indicadores-material-ambiental` | Disponible | 1 incidente | **43** | 57 | P4 |
| CHART-028 | Recorridos GPS | `/flota/monitoreo` | Backend | 0 posiciones históricas; sync OnWay caído | **41** | 51 | P4 |

**Cuáles se pueden hacer ya y cuáles requieren backend** (revisado con datos de producción):

- **Se pueden hacer ya y mostrarían datos reales:**
  - **Datos ya cargados en la página:** 007 (MIPER), 008 (calendario: el plan está, aunque casi todo pendiente), 030 (aprobaciones), 032 (reportes), 036 (facturación), 020 (nivel de estanque), 023 (anomalías sin torta) y 024 (vacío diario, en 6 equipos).
  - **Con procesamiento ligero:** 031 (seguimiento), 033 (analítica), 022 (cobertura de fuentes) y 034 (conciliación y DTE).
- **Requieren backend y tienen datos reales esperando:** 029 (lead time), 035 (cobertura de stock) y 010 (inspecciones; 22 ejecuciones).
- **El modelo los soporta, pero producción no tiene los datos:**
  - **Prevención:** 001 y 006 (0 registros de HH, 1 incidente), 003 (0 CAPA), 004 y 005 (programa PDTP 2026 en borrador, 0 ejecuciones), 009 (0 mediciones), 013 (0 requisitos legales) y 014 (0 permisos).
  - **Combustible:** 016, 017, 019 y 021 (0 cargas en terreno).
  - **Mantención:** 018, 025, 026 y 027 (sin carga inicial ni OT).
  - **Otros:** 012 (0 recursos y 0 activos TI), 028 (sync OnWay caído) y 038 (0 TI).

  Construirlos hoy produce pantallas vacías: conviene hacerlos **junto con la puesta en marcha** de cada módulo y con un estado vacío que diga qué hay que registrar (regla A4).

---

## E. Propuestas de nuevos dashboards

No se propone un tablero gigante. `/dashboard` ya cumple el papel de vista ejecutiva por dominio. Lo que falta son **vistas analíticas por responsabilidad**, cada una dentro de su módulo, con su propio permiso y sin repetir cifras del tablero (A5). Cinco propuestas, en orden de valor:

### E1. Siniestralidad y aprendizaje — `/prevencion/indicadores` reestructurada

- **Público:** prevencionistas, comités paritarios, jefatura y gerencia. Permiso `prevention:indicadores:view` + `prevention:incidents:view`.
- **Preguntas:**
  - ¿Mejora o empeora la siniestralidad?
  - ¿Qué faena la arrastra?
  - ¿Qué casi-accidentes con potencial alto no se están investigando?
- **Indicadores principales** (máximo 4, regla A1):
  - TF del último mes con HH, con Δ contra el mismo mes del año anterior.
  - TG semestral.
  - Lesionados en lo que va del año.
  - Eventos de potencial alto o crítico sin investigación cerrada (accionable).
- **Gráficos:**
  - Tendencia TF/TG (CHART-001).
  - Matriz gravedad real × potencial (CHART-002b).
  - Eventos por mes y familia (CHART-002a).
  - TF por faena (`RankedList`).
- **Absorbe** `/prevencion/indicadores-material-ambiental`, que pasa a ser una familia dentro de «eventos por mes». Así se elimina la duplicación (CHART-006).
- **Filtros globales:** año y faena, en la URL.
- **Fuentes:** `prevention_incidents`, `prevention_incident_people`, `safety_indicator_denominators`.
- **Frecuencia de actualización:** al cargar la página. Los datos son eventos y no requieren tiempo real.
- **Organización:** KPI → tendencia → (matriz | ranking) → tabla «Cálculo mensual» plegada como alternativa y auditoría del cálculo.
- **Interacciones:**
  - clic en un mes enfoca la fila;
  - clic en una celda de la matriz lleva a `/prevencion/incidentes?real=…&potencial=…`;
  - clic en una faena filtra todo.
- **Personalización por rol:** el alcance por faena ya lo resuelve `listVisibleWorksites(scope)`. No hace falta configurar nada.
- **Complejidad:** media. Una consulta nueva (eje mensual en `getIncidentAnalyticsData`) y reutilizar `SstTrendChart`.
- **Requisito de datos (revisión):** en producción hay 0 registros de horas hombre y 1 incidente. El tablero sólo tiene sentido después de la Fase 0b.2–0b.3; hasta entonces, su estado vacío debe pedir la carga de HH por faena.

### E2. Calendario de cumplimiento del sistema de gestión — nueva vista en `/prevencion/pdtp`

- **Público:** prevencionistas, administradores de contrato, auditores internos.
- **Preguntas:**
  - ¿Qué obligación anual (PDTP, capacitación, CPHS, simulacros, alcotest, higiene, cierres) está incumplida, en qué faena y en qué mes?
  - ¿Qué me pedirá un fiscalizador?
- **Indicadores principales:**
  - % de casillas exigibles cumplidas a la fecha.
  - Casillas vencidas sin cumplir.
  - Meses sin cierre.
  - Faenas con al menos un programa en rojo.
- **Gráficos:**
  - `ComplianceCalendar` (CHART-008) con una fila por programa × faena, agrupada por programa y plegable.
  - Barra de % por programa.
- **Filtros globales:** año, faena y programa.
- **Fuentes:**
  - `prevention_training_occurrences`
  - `prevention_committee_meetings`
  - `prevention_committee_program_activities`
  - `ProgramSlotRow` (alcotest, simulacros, higiene, GRD)
  - cierres PDTP
  - `pdtp_activity_schedule`
- **Frecuencia:** al cargar la página.
- **Organización:** KPI → calendario integral → al hacer clic en una celda, la lista de casillas del programa correspondiente, con su acción.
- **Interacciones:** teclado en la grilla; cada celda enlaza a la pantalla operativa ya filtrada.
- **Personalización por rol:** cada fila se muestra sólo si el usuario tiene el permiso de ese programa. El usuario ve sus programas, no todos.
- **Complejidad:** media. Requiere un primitivo y un adaptador por programa; **no** requiere backend nuevo.
- **Requisito de datos (revisión):** el plan anual sí existe en producción (3.991 casillas de capacitación y 230 de alcotest), así que el calendario muestra datos reales desde el primer día, aunque casi todo esté pendiente. Las filas de PDTP y CPHS quedan vacías hasta activar el programa y registrar sesiones.

### E3. Mantención y disponibilidad — ampliar `/mantencion/panel` y agregar un bloque al tablero

- **Público:** jefe y supervisor de mantención, jefatura de operaciones.
- **Brecha observada [S]:** según los permisos por defecto, `supervisor_mantencion` tiene permisos de OT pero no de flota ni de combustible, así que no ve **ninguna** cifra de mantención en `/dashboard`. «OT abiertas» vive sólo en la vista flota (`fleet-section.tsx:137`).
- **Preguntas:**
  - ¿Qué equipo intervengo esta semana?
  - ¿Dónde se atascan las OT?
  - ¿Mejora la disponibilidad?
- **Indicadores principales:**
  - Equipos vencidos de pauta.
  - OT abiertas de más de 7 días.
  - Disponibilidad semanal, **junto a su cobertura**.
  - MTTR del mes, con n.
- **Gráficos:**
  - Próximas mantenciones como % del intervalo (CHART-027).
  - Antigüedad de OT por estado (CHART-026a).
  - Disponibilidad semanal con banda 80/90 (CHART-025).
  - Ciclo por etapa (CHART-026b).
- **Filtros globales:** faena y taller.
- **Fuentes:**
  - `mant_work_orders` y sus eventos
  - `mant_records`
  - `fuel_vehicle_operational_intervals`
  - `loadFleet`
- **Requisito previo de datos:** que una correctiva con el equipo en taller **mueva el estado operativo**. Sin eso, la disponibilidad queda sobrestimada (CHART-025).
- **Bloque en el tablero:** un bloque «Mantención» visible con `mant:ot:view_*`, con 2 cifras como máximo y un enlace al panel.
- **Complejidad:** media a alta. El panel es la parte barata (CHART-027, Disponible). La disponibilidad y el MTTR dependen de que se acumulen datos (las OT existen desde el 2026-11-02).
- **Requisito de datos (revisión):** en producción hay 0 perfiles, 0 registros y 0 OT. La carga inicial no puede correr hasta decidir 6 faenas (Anexo C, C-3).

### E4. Abastecimiento — `/analitica` reorientada y `/reportes` absorbida

- **Público:** jefa Chome, secretaría, compras, aprobadores. Permiso `analytics:view`.
- **Preguntas:**
  - ¿Cuánto tarda lo que pido y en qué tramo se atasca?
  - ¿Cuánto compro, a quién, y qué tan concentrado está?
  - ¿Qué falta por facturar?
- **Indicadores principales:**
  - Gasto del período con Δ y polaridad correcta.
  - Mediana de días de solicitud a entrega.
  - Ítems abiertos de más de 15 días.
  - Monto por facturar.
- **Gráficos:**
  - Gasto mensual como área apilada (compras + combustible).
  - Lead time por tramo (CHART-029).
  - Pareto de proveedores (CHART-033).
  - Conciliación OC–factura (CHART-034).
  - Estados en orden de ciclo (lo útil de CHART-032).
- **Filtros globales:** período (URL), faena y proveedor. Se reemplaza el formulario de 5 filtros con botón «Filtrar» por filtros que aplican al cambiar. Hoy se ven 5 filtros más el botón, en el límite de A2.
- **Requisito previo:** **unificar la base de fecha con el tablero** (`issuedAt` + `issuedOrderPredicate`) y definir si las cifras son netas o con IVA.
- **Qué pasa con `/reportes`:** queda como redirección o como pestaña de exportación. Hoy repite cifras de `/analitica` y del tablero con una tercera base de fecha.
- **Complejidad:** alta por el lead time; media para el resto.
- **Requisito de datos (revisión):** es el tablero con más datos reales (4 meses de flujo completo). Antes hay que decidir la fuente del gasto en combustible, porque hoy `fuel_loads` está vacío en producción (C-9).

### E5. Salud de datos de combustible — ampliar `/combustibles/fuentes`

- **Público:** responsables de combustible e integraciones.
- **Preguntas:**
  - ¿Llegaron los datos de Copec, OnWay y VisionLink?
  - ¿Qué mes puedo cerrar?
- **Contenido:** el mapa de cobertura fuente × mes (CHART-022), el estado de la última corrida y los rechazos abiertos.
- **Reutilización:** el mismo estado alimenta un **aviso de cobertura** en cada gráfico de combustible: «Octubre: OnWay sin datos desde el día 30».
- **Complejidad:** baja a media.

**No se proponen** tableros nuevos para administración ni para TI. TI basta con ampliar `/ti` (CHART-038). En administración, la tabla es la herramienta correcta.

---

## F. Top 10 de transformaciones visuales

La primera versión de esta sección ordenaba por el puntaje calculado sobre `bodega_dev`. La revisión del 2026-11-03, hecha sobre un restore de producción, mostró que varias de esas propuestas descansan en módulos que **en producción todavía no tienen datos**. Por eso hay dos listas: lo que más mejora la plataforma **hoy**, y lo que más la mejorará **cuando cada módulo esté en uso**.

### F.1 Hoy: mayor impacto con datos reales

| # | ID | Transformación | Pantalla | Puntaje | Datos en producción | Esfuerzo | Por qué está aquí |
|---|---|---|---|---|---|---|---|
| 1 | CHART-007 | Matriz P×C inherente contra residual | `/prevencion/miper/[id]` | 82 | 540 riesgos; el módulo de Prevención con más actividad (788 escrituras de 5 usuarios en 60 días) | Bajo-medio | Es la representación canónica del dominio y hoy no existe en la pantalla que más se usa de Prevención |
| 2 | CHART-008 | Calendario de cumplimiento faena × mes | 8 pantallas | 77 | 3.991 casillas de capacitación y 230 de alcotest | Medio | El plan anual existe y se lee como 2.730 tarjetas; el calendario muestra de inmediato que casi todo está pendiente (17 de 3.991 hechas) |
| 3 | CHART-029 | Lead time solicitud → entrega | `/analitica`, `/seguimiento/[itemId]` | 77 | 4 meses de flujo completo (55 solicitudes → 240 entregas) | Alto | La pregunta más frecuente de abastecimiento («¿dónde se demora?») no tiene respuesta hoy, y los datos ya están |
| 4 | CHART-036 | Facturación con los gráficos del tablero | `/facturacion` | 75 | 565 facturas | Bajo | La serie mensual se consulta y se descarta; reutilizar el gráfico cuesta horas |
| 5 | CHART-030 | Antigüedad de la cola de aprobaciones | `/aprobaciones` | 75 | 245 decisiones; espera P50 8,3 h y P90 6 días; cola vacía al clonar | Bajo | Barato, y destapa las esperas largas (el 10 % pasa de 6 días) cuando ocurren |
| 6 | CHART-033 | Analítica: Pareto de proveedores y una base de fecha | `/analitica` | 72 | 57 OC y 5.671 transacciones Copec | Medio | Corrige cifras que hoy no cuadran con el tablero y muestra la concentración de proveedores |
| 7 | CHART-035 | Cobertura de stock en días y saldo del kardex | `/bodega` | 72 | 724 movimientos y 199 saldos | Medio | Con los mínimos de stock retirados, hoy nada indica qué reponer |
| 8 | CHART-022 | Cobertura de datos por fuente y mes | `/combustibles/fuentes` | 71 | El restore muestra **septiembre de 2026 sin ninguna transacción Copec** y 2025 sólo con enero | Bajo | Sin este mapa, un hueco de integración se lee como «no se cargó combustible» |
| 9 | CHART-031 | Distribución por estado en Seguimiento | `/seguimiento` | 71 | 55 solicitudes | Bajo | Reemplaza 7 cifras que parecen sumar el total y no lo hacen |
| 10 | CHART-034 | Conciliación OC–factura y cobertura DTE | `/compras/dte`, `/analitica` | 69 | 3.363 DTE y 36 facturas de OC | Medio | Muestra lo que el tope de 300 filas oculta y cuánto queda por facturar |

**Por qué cambió respecto de la primera versión:**

- Salieron del Top 10 de hoy:
  - **CHART-004** (PDTP): el programa 2026 está en borrador y tiene 0 ejecuciones.
  - **CHART-001** (tasas DS 44): hay 0 registros de horas hombre y 1 incidente.
  - **CHART-027** (próximas mantenciones): la carga inicial de mantención no corrió en producción.
  - **CHART-009** (higiene), **CHART-016** y **CHART-019** (combustible): 0 mediciones y 0 cargas en terreno.
- Entraron las propuestas de abastecimiento y bodega, que tienen datos y uso reales.

### F.2 Cuando cada módulo esté en uso: mayor potencial

Ordenadas por el puntaje de la primera pasada, que suponía datos. Conviene construirlas **en el mismo trabajo** que pone en marcha cada módulo, porque así el gráfico nace con datos y su estado vacío enseña qué registrar.

| ID | Transformación | Potencial | Qué falta para que tenga datos |
|---|---|---|---|
| CHART-004 | PDTP con meta, % mensual y eje como ranking | 86 | Activar el programa PDTP 2026 (hoy en borrador) y registrar ejecuciones |
| CHART-001 | Tendencia de tasas DS 44 | 84 | Cargar las horas hombre por faena y mes (`safety_indicator_denominators`: 0 filas) y registrar los incidentes en la plataforma |
| CHART-027 | Próximas mantenciones como % del intervalo | 83 | Correr la carga inicial de mantención: decidir antes las 6 faenas pendientes (Anexo C) |
| CHART-009 | Exposición contra límite (higiene) | 77 | Registrar mediciones de exposición |
| CHART-016 | Rendimiento mensual | 77 | Registrar cargas en terreno, o **hacer que la serie use las 3.910 lecturas de odómetro Copec**, que hoy sólo lee el detector de anomalías |
| CHART-019 | Cuadratura contra tolerancia | 77 | Registrar las entregas en terreno (las entradas a estanque sí existen) |
| CHART-005 | Resumen del reporte de gestión PDTP | 76 | Lo mismo que CHART-004 |
| CHART-017 | Desviación por equipo contra su modelo | 75 | Lo mismo que CHART-016 |

## G. Comparación de bibliotecas gráficas

**Stack real [E]:** Next.js 16.4, React 19.2.4, Tailwind 4, tokens OKLCH en `app/globals.css`, recharts 3.9.0 en 28 archivos, MapLibre GL 6.9 y una puerta de tamaño de bundle de 3 MB de JavaScript de primera carga por ruta (`scripts/check-bundle-budget.ts`). Recharts trae d3 a través de `victory-vendor`.

| Criterio | **Recharts 3** (instalada) | Apache ECharts | Nivo | visx | D3 directo | Highcharts | Tremor |
|---|---|---|---|---|---|---|---|
| Licencia y costo | MIT, gratis | Apache-2.0, gratis | MIT, gratis | MIT, gratis | ISC, gratis | **Comercial** (uso empresarial con licencia de pago) | Apache-2.0, gratis |
| Ya en el repo | **Sí**: 28 archivos, `ChartContainer` estilo shadcn, tokens | No | No | No | Transitiva (vía recharts) | No | No (se apoya en recharts) |
| Render | SVG | Canvas o SVG | SVG, Canvas o HTML | SVG | SVG o Canvas | SVG | SVG (recharts) |
| Variedad | Línea, área, barra, compuesto, dispersión, torta, radial, treemap, Sankey, embudo | La más amplia: calendario, heatmap, Gantt (vía custom), Sankey, grafo | Amplia: calendario, heatmap, bullet, Sankey | Primitivas, se arma todo | Ilimitada | Muy amplia | Subconjunto de recharts |
| Accesibilidad | `accessibilityLayer` (teclado y ARIA), SVG inspeccionable | ARIA generada; canvas opaco al lector de pantalla | Parcial | La que uno construya | La que uno construya | Módulo de accesibilidad maduro | La de recharts |
| Coherencia con DESIGN.md | Alta: ya usa `var(--color-*)` | Baja: tema propio, otra estética | Media: su propio sistema de temas | Alta, pero cuesta construirla | Alta, pero cuesta construirla | Media | **Baja**: impone su propio lenguaje visual |
| Rendimiento con muchos puntos | Bueno hasta miles de puntos SVG | El mejor (canvas, decenas de miles) | Bueno | Bueno | El que se construya | Bueno | El de recharts |
| Tamaño agregado al bundle | **0** (ya está) | Alto (**no medido aquí**; con tree-shaking sigue siendo un motor completo) | Medio-alto | Bajo-medio | Bajo | Alto | Medio |
| Costo de adopción | Nulo | Alto (segunda forma de hacer gráficos) | Medio | Alto | Alto | Licencia más integración | Medio y riesgo de choque visual |

**Recomendación (fundada en el repositorio):** **seguir con Recharts y no agregar dependencias.** Lo que recharts no trae de serie se construye como **primitivos propios en CSS grid o SVG con tokens**, siguiendo los precedentes que ya existen y funcionan: `worksite-equipment-heatmap.tsx`, `ranked-list.tsx`, `StatusShareBar`, `causal-diagram.tsx` y `mini-sparkline.tsx`.

| Necesidad detectada | Cómo cubrirla |
|---|---|
| Calendario de cumplimiento, matriz P×C, matriz requisito × faena, cobertura de fuentes | `ComplianceCalendar` / `MatrixGrid` (CSS grid, `role="grid"` o `table`) |
| Gantt de permisos, estadías en taller, disponibilidad | `TimelineBars` (CSS grid sobre un eje temporal) |
| Bullet de intervalo, nivel de estanque, meta por actividad | `BulletBar` (CSS) |
| Antigüedad por tramos | `AgingBar` (variante de `StatusShareBar`) |
| Lead time por etapas | `StageDurationBar` (CSS apilado con marcador P90) |
| Series, barras, combos, dispersión, Pareto | Recharts dentro de `ChartFrame` |
| Recorridos GPS | MapLibre (ya instalado) |

**Cuándo reabrir la decisión:** sólo si aparece un caso con más de 10.000 puntos por gráfico, por ejemplo telemetría por minuto, donde SVG se vuelve lento. En ese caso se evalúa ECharts **para ese componente aislado**, cargado con `next/dynamic`. Hoy no existe ese caso: la telemetría es diaria (`fuel_telemetry_daily`).

**Descartadas explícitamente:**

- **Highcharts**, por licencia.
- **Tremor**, por estética propia que compite con `DESIGN.md` y porque el repositorio ya tiene `ChartContainer`.
- **Nivo y visx**, porque duplican lo que recharts más los primitivos CSS ya cubren.

---

## H. Propuestas de distribución visual (las cinco primeras de cada ranking)

**Qué esquema corresponde a cada ranking:**

- **Las cinco primeras de hoy (F.1):** H.6 (CHART-007), H.2 (CHART-008), H.7 (CHART-029), H.8 (CHART-036) y H.5 (CHART-030).
- **Las primeras del ranking de potencial (F.2):** H.1 (CHART-004), H.3 (CHART-001) y H.4 (CHART-027). Se conservan para cuando su módulo tenga datos.

Las cifras y nombres dentro de los esquemas son **ilustrativos**, salvo cuando se citan de una captura. Los esquemas usan la estructura real del shell: `PageHeader` proyecta título y acciones al TopBar, `PageContainer` envuelve el contenido y las tarjetas flotan sobre el lienzo (regla 7), salvo en `/dashboard`.

**Capturas de referencia.** Están anonimizadas en [qa/reports/2026-11-03-visualizaciones/](qa/reports/2026-11-03-visualizaciones/). **No se versionan**: el `.gitignore` excluye a propósito las imágenes de `qa/` y sólo guarda `.md`. Quedan en este checkout; para compartirlas hay que adjuntarlas o forzar su ingreso. Antes de cada captura, el script reemplazó en la página los nombres de usuarios, trabajadores y conductores por «Persona», los correos por «correo@ejemplo.cl» y los formatos de patente por «XXXX-00»; además ocultó los avatares. Se tomaron sobre `bodega_dev` (clon de producción más datos simulados del 2026-11-02): **mantención, higiene, incidentes, CAPA y las cargas de combustible que muestran son datos simulados** (en producción esas tablas están vacías; ver Anexo B), y el texto `QA_mock` que aparece en algunas los delata.

| Captura | Qué muestra |
|---|---|
| [h1-pdtp.png](qa/reports/2026-11-03-visualizaciones/h1-pdtp.png) | Estado actual de H.1 (PDTP): tiles de período mixto y gráficos sin meta |
| [h2-capacitacion.png](qa/reports/2026-11-03-visualizaciones/h2-capacitacion.png) | Estado actual de H.2: el muro de tarjetas de capacitación |
| [h3-indicadores.png](qa/reports/2026-11-03-visualizaciones/h3-indicadores.png) | Estado actual de H.3: indicadores DS 44 sólo en tabla |
| [h4-mantencion-panel.png](qa/reports/2026-11-03-visualizaciones/h4-mantencion-panel.png) | Estado actual de H.4: panel de mantención, «Próximas mantenciones» en tabla |
| [h5-aprobaciones.png](qa/reports/2026-11-03-visualizaciones/h5-aprobaciones.png) | Estado actual de H.5: cola de aprobaciones (vacía al momento del clon) |
| [a-control-operacional.png](qa/reports/2026-11-03-visualizaciones/a-control-operacional.png) | Disponibilidad junto a su cobertura (riesgo de CHART-025) |
| [a-analitica.png](qa/reports/2026-11-03-visualizaciones/a-analitica.png) | `/analitica` con datos: barras multicolor y rankings en tabla (CHART-033) |
| [m-pdtp.png](qa/reports/2026-11-03-visualizaciones/m-pdtp.png), [m-mantencion-panel.png](qa/reports/2026-11-03-visualizaciones/m-mantencion-panel.png) | Móvil a 390 px: tiles a pantalla completa antes del primer gráfico |

### H.1 CHART-004 — `/prevencion/pdtp`

Hoy (captura de 1440 px): 4 tiles de período mixto. «Tendencia de ejecución mensual» es un área donde Ejecutadas va pegada a 0 y Programadas sube hasta 700 desde agosto. «Avance anual por faena» muestra seis faenas **sin ninguna barra visible**, porque el avance es 0 %. «Avance por eje» es un estado vacío. En móvil (390 px), cada tile ocupa el ancho completo y el primer gráfico aparece después de unos 3 altos de pantalla.

```text
┌ TopBar ─ Cumplimiento PDTP 2026 · Programa v2 ─────────────── [Ver actividades] [Nuevo programa] ┐
│ Año [2026▾]  Faena [Todas▾]                                    Meta del programa: 90 %          │
├──────────────────┬──────────────────┬──────────────────┬──────────────────────────────────────┤
│ Cumplimiento     │ Ejecutadas · año │ Atrasadas · hoy  │ Por aprobar                          │
│ a la fecha 0,2 % │ 1 de 481 prog.   │ 38 actividades → │ 6 ejecuciones →                      │
│ meta 90 % ▼      │                  │                  │                                      │
├──────────────────┴──────────────────┴──────────────────┴──────────────────────────────────────┤
│ Ejecución mensual — plan vs. ejecutado                                          [Ver datos ▸] │
│  800 ┤                    ▇                                     100 %                        │
│      ┤               ▇    ▇  ▇   ▇        ← barras: programadas (gris) / ejecutadas (verde)  │
│  400 ┤               ▇    ▇  ▇   ▇        ── línea: % del mes (eje der.)                      │
│      ┤ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ meta 90 % (ReferenceLine)                         │
│    0 ┼─E──F──M──A──M──J──J──A──S──O──N──D─   clic en mes → /pdtp/actividades?mes=            │
├───────────────────────────────────────────────┬───────────────────────────────────────────────┤
│ Avance anual por faena (vs. meta)             │ Avance por eje (RankedList, %)                │
│ Biodiversa      ▏0 %  0 de 74       →         │ Gestión de riesgos   ██░░░░ 12 %  →           │
│ Teno - Arauco   ▏0 %  0 de 81       →         │ Capacitación         █░░░░░  4 %  →           │
│ … (rótulo siempre visible; 0 % nunca vacío)   │ …                                             │
└───────────────────────────────────────────────┴───────────────────────────────────────────────┘
Móvil: tiles 2×2 compactos → gráfico → rankings apilados; la tabla «Ver datos» reemplaza el gráfico <360 px.
```

**Notas:**

- Cada tile lleva su período en el rótulo.
- El color del ranking por faena sale de la meta, no de 80/50.
- El 0 % se dibuja con rótulo y un trazo mínimo.

### H.2 CHART-008 — Calendario de cumplimiento (ejemplo: `/prevencion/capacitacion`)

Hoy (captura de 1440 px): pestañas «Todas 2730 · Pendientes 2730 · Hechas 0» y debajo una tarjeta por casilla, con título largo, faena, mes y semana, y 3 botones. Para saber qué faena está al día hay que filtrar y recorrer.

```text
┌ TopBar ─ Campañas y capacitación ─────────────────────────────────────────── [Exportar Excel] ┐
│ Programa [Anual 2026▾]  Faena [Todas▾]                                                       │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Cumplimiento por faena y mes                    ■ hecho ◧ parcial ■ vencido □ futuro ▨ no exig.│
│                 Ene  Feb  Mar  Abr  May  Jun  Jul  Ago  Sep  Oct  Nov  Dic   Año            │
│ Biodiversa      ▨    ▨    ▨    ▨    ▨    ▨    ▨    ▨    ■0/9 ■0/9 □    □     0 %  →         │
│ Cholguan       ▨    ▨    ▨    ▨    ▨    ▨    ▨    ▨    ■0/9 ◧4/9 □    □    22 %  →         │
│ Horcones        …                                                                          │
│ (celda = texto «0/9» + color; foco con flechas; Enter filtra la lista)                     │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Casillas · Cholguan · octubre (9)          [Pendientes 5] [Hechas 4] [No aplica 0]        │
│ CAP-21 Charla diaria de seguridad … semana 1                  [Marcar hecha] [⋯]            │
│ …  (la lista actual, pero ya filtrada por la celda elegida)                                 │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Notas:**

- Los rótulos de faena de la maqueta son ilustrativos.
- La grilla se reutiliza tal cual para CPHS (comité × mes, con estado de sesión y quórum), alcotest, simulacros, higiene, CGRD, cierres PDTP y requisitos legales (requisito × faena).

### H.3 CHART-001 — `/prevencion/indicadores`

Hoy (captura de 1440 px): cuatro cifras «No calculable» o «0», en mono, un aviso de denominadores faltantes y una tabla de 12 meses con «—». No hay ningún gráfico.

```text
┌ TopBar ─ Indicadores de seguridad y salud en el trabajo ─────────────────── [Exportar Excel] ┐
│ Faena [Total visibles▾]  Año [2026▾]                   (ambos en la URL)                    │
├───────────────────┬───────────────────┬───────────────────┬──────────────────────────────────┤
│ Frecuencia · oct  │ Gravedad · S2     │ Lesionados · año  │ Casos por calificar              │
│ 12,4  ▲ 3,1 vs oct│ 88    ▼ 12 vs S1  │ 4                 │ 0 · bloquean aprobación →        │
│       2025        │                   │                   │                                  │
├───────────────────┴───────────────────┴───────────────────┴──────────────────────────────────┤
│ Tendencia de tasas — × 1.000.000 HH                                          [Ver datos ▸] │
│  TF ─●─  (eje izq.)     TG ─■─ (eje der.)     ▁ lesionados (barras tenues)                   │
│  ○ = provisional   ● = confirmado   hueco = sin HH declaradas                              │
├───────────────────────────────────────────────┬───────────────────────────────────────────────┤
│ Frecuencia anual por faena (RankedList)       │ Si faltan HH: EmptyState «Carga las horas-  │
│ Faena A  ███████ 18,2  · 2 casos / 110 mil HH │ hombre de la faena para calcular» + CTA      │
│ Faena B  ███ 7,9                              │                                             │
├───────────────────────────────────────────────┴───────────────────────────────────────────────┤
│ ▸ Cálculo mensual (tabla actual, plegable)   ▸ Denominadores   ▸ Datos del sistema anterior    │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### H.4 CHART-027 — `/mantencion/panel`, «Próximas mantenciones»

Hoy (captura de 1440 px, después de migrar `bodega_dev`): la tarjeta muestra el estado vacío «Todavía no hay mantenciones que calcular», porque la base de desarrollo no tiene lecturas ni registros. Los 4 tiles del panel muestran «0», incluido «Mantenciones vencidas», que debería mostrar la acción para volverse evaluable. El esquema de abajo sale del código (`panel-cards.tsx:158`).

```text
┌ Próximas mantenciones (12) ───────────────────────────── Faena [Todas▾] ── Ver todas → ┐
│ Equipo           Pauta            Intervalo consumido                     Restante       │
│ EQ-01 · camión   P-10.000 km      ████████████████████▌│ 104 % vencida   −400 km       │
│ EQ-02 · grúa     P-250 h          ██████████████████░░│  92 %            20 h          │
│ EQ-03 · cargador P-500 h         ███████████████░░░░░│  78 %           110 h          │
│ …            (ordenado por %, la marca │ = tolerancia; texto siempre presente)          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**Notas:**

- Los códigos de equipo de la maqueta son ficticios.
- La barra se suma a la fila existente, no la reemplaza.
- «Vencida» va en texto y en `--color-danger`, nunca sólo en color.

### H.5 CHART-030 — `/aprobaciones`

```text
┌ TopBar ─ Aprobaciones ───────────────────────────────────────────── [Buscar en aprobaciones] ┐
│ Antigüedad de lo que espera tu decisión (23 ítems)                                          │
│ ┌───────────────┬───────────┬────────────────────┬─────────────────────────┐               │
│ │ 0–1 d · 6     │ 2–3 d · 5 │ 4–7 d · 7          │ >7 d · 5 ← más antiguo  │  ■ urgente     │
│ └───────────────┴───────────┴────────────────────┴─────────────────────────┘  □ normal      │
│   clic en un tramo filtra la cola (?antiguedad=8+); la urgencia sólo colorea                 │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ SOL-0412 · Biodiversa · 3 ítems · hace 9 días · URGENTE           [Aprobar] [Rechazar] [⋯]   │
│ …  (cola actual + «hace N días» en mono en cada grupo)                                     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### H.6 CHART-007 — Matriz MIPER (`/prevencion/miper/[id]`, panel Resumen)

Hoy, según el código ([resumen-panel.tsx:72-121](app/(app)/prevencion/miper/%5Bid%5D/resumen-panel.tsx#L72-L121)), el panel muestra la cifra «Importantes e intolerables» y barras de avance por actividad, pero ninguna distribución del riesgo.

Las cifras del esquema son **reales**: el total de las 3 matrices de producción al 2026-11-02, 540 riesgos.

```text
┌ Resumen de la matriz ─────────────────────────────────────────────────────────────────────┐
│ Riesgos 540 · Importantes 46 · Intolerables 0 · Sin evaluar 0                            │
├───────────────────────────────────────────┬───────────────────────────────────────────────┤
│ Riesgo INHERENTE (P × C, RE-04)           │ Riesgo RESIDUAL                               │
│              C=1        C=2        C=4    │                                               │
│  P=4   │   —        │   —        │   —   ││  Sin datos: ningún riesgo tiene nivel         │
│  P=2   │   —        │ 277 Mod.   │ 46 Imp││  residual registrado (540 de 540 vacíos).     │
│  P=1   │ 28 Tol.    │ 178 Tol.   │ 11 Mod││  → Registrar controles y su efecto            │
│ (celda = conteo + clase en texto; clic → matriz filtrada por esa celda)                 │
├───────────────────────────────────────────┴───────────────────────────────────────────────┤
│ ▸ Avance por actividad (barras actuales, plegables)                                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Notas:**

- Las clases son las cuatro de RE-04: tolerable (P×C ≤ 2), moderado (4), importante (8) e intolerable (16). Usan `success` / `info` / `warning-ink` / `danger`, siempre con su nombre en texto.
- La grilla es una tabla accesible (`role="table"`), no una imagen.
- **Hallazgo que el gráfico hace visible:** ningún riesgo de producción supera P=2, y **ninguno tiene nivel residual registrado**. Por eso la mitad «residual» de la propuesta depende de capturar el efecto de los controles: es Nuevos datos.

### H.7 CHART-029 — Lead time de abastecimiento (`/analitica`, sección nueva)

```text
┌ ¿Dónde se demora lo que pedimos? · Ítems entregados en oct-2026 (n=61) ─── Período [Mes▾] ┐
│ Mediana solicitud → entrega: 18 días  ▲ 3 vs sep        Ítems abiertos >15 días: 22 →     │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Faena            Aprobar   Emitir OC        Llegar a bodega          Entregar   P90      │
│ Cholguan-Arauco  ██ 2d     ████ 4d          ████████████ 9d          ██ 2d      │ 31 d   │
│ Biodiversa       █ 1d      ██████ 6d        ████████ 7d              █ 1d       │ 24 d   │
│ Santa Fe         ███ 3d    ███ 3d           ██████████████ 11d       ███ 3d     │ 38 d   │
│ (segmentos = mediana por tramo; │ = P90 total; clic en un tramo → ítems más lentos)       │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Ítems más lentos del tramo «Llegar a bodega» · Santa Fe (tabla actual de seguimiento)     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
En /seguimiento/[itemId] el mismo eje se dibuja como una sola fila con fechas por etapa.
```

**Notas:**

- Las cifras son ilustrativas.
- El subtítulo declara la muestra (sólo ítems cerrados) para evitar el sesgo de supervivencia, y la antigüedad de los abiertos va al lado.

### H.8 CHART-036 — Facturación (`/facturacion`)

Hoy, según el código ([facturacion/page.tsx:125-175](app/(app)/facturacion/page.tsx#L125-L175)), la pantalla muestra 4 `MoneyStat` sin comparación, una tabla de antigüedad de la deuda y listas de texto.

```text
┌ TopBar ─ Facturación y cobranza ─────────────────────────────────── Moneda [CLP▾] Período ┐
├────────────────┬────────────────┬────────────────┬──────────────────────────────────────┤
│ Facturado · oct│ Cobrado · oct  │ Por cobrar     │ Vencido                              │
│ $X  ▲ 8 % vs sep│ $Y  ▼ 3 % vs sep│ $Z             │ $W · 14 facturas →                   │
├────────────────┴────────────────┴───────────┬────┴──────────────────────────────────────┤
│ Facturado vs. cobrado por mes (BillingFlow) │ Antigüedad de la deuda (DebtAging)        │
│  ▇▆ ▇▅ ▇▇ ▆▅ (barras pares, 12 meses)       │ No vencida ████████ · 1–30 ███ · 31–60 ██ │
│                                [Ver datos ▸]│ · 61–90 █ · >90 █  (clic → cobranza)     │
├─────────────────────────────────────────────┴───────────────────────────────────────────┤
│ Clientes con más deuda (RankedList, un tono)  │ Por faena (RankedList)                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Nota:** los dos gráficos ya existen en `app/(app)/dashboard/charts/`. El trabajo es moverlos a `components/charts/` y alimentarlos con `summary.monthly`, que hoy se consulta y no se dibuja.

## I. Hoja de ruta de implementación

### Fase 0 — Corregir cifras incorrectas (antes de dibujar nada)

Son defectos verificados, no propuestas. Esfuerzo: ~1 día.

| # | Defecto | Dónde |
|---|---|---|
| 0.1 | «Total eventos» ignora la faena | `material-environmental-dashboard.tsx:49-59, 99` |
| 0.2 | El gasto usa `trendPolarity` `up-good`: una baja aparece en rojo (verificado en navegador) | `analitica/page.tsx:104-114` |
| 0.3 | `pendingReceiptCount` triple; recepciones anuladas contadas; faena como UUID | `reportes/page.tsx:77-82, 141-161, 155` |
| 0.4 | % mensual PDTP: null convertido en 0 | `pdtp/page.tsx:169` |
| 0.5 | Precio CLP/L = 0 sin litros (debe ser un hueco) | `fuel-charts.tsx:27` |
| 0.6 | Fechas UTC u otro locale: `getFullYear()`/`getMonth()` en indicadores; `toLocaleDateString` en facturación; `.slice(0,10)` en privacidad | ver sección B |
| 0.7 | Tiles que no responden a los filtros (incidentes, CAPA) | `getIncidentDashboardCounts`, `getCapaDashboardCounts` |
| 0.8 | «Mantenciones vencidas: 0» cuando ningún equipo tiene pauta y lectura para evaluarse: debe mostrar la acción (A1), no un cero que se lee como «todo al día» | `components/mantencion/jefatura/panel/panel-kpis.tsx` |
| 0.9 | «Rendimiento» en la ficha de flota muestra sólo la unidad «km/L» cuando no hay valor | `app/(app)/flota/[id]/page.tsx` |

- **Riesgo:** bajo.
- **Criterio de aceptación:** pruebas unitarias por cifra y verificación en navegador de cada pantalla.

**Estado al 2026-11-03.** Ninguna de las filas 0.1 a 0.9 se implementó: esperan autorización. Aparte, en la rama `fix/seed-faenas-y-defectos-sst` (sin commit) se corrigieron tres defectos que salieron a la luz en la revisión (ver Anexo C):

- la gravedad DS 44 que perdía días de licencia al cruzar de mes;
- el cumplimiento de inspección sobre 100 % que impedía cerrar «Maquinaria Pesada»;
- la carga inicial de mantención que duplicaba faenas.

### Fase 0b — Datos y adopción (sin esto, la mitad del catálogo muestra pantallas vacías)

No es trabajo de visualización, pero lo condiciona. Viene de comparar el catálogo con un restore de producción (Anexo B).

| # | Qué falta registrar o activar | Desbloquea | Responsable natural |
|---|---|---|---|
| 0b.1 | Activar el programa PDTP 2026 (hoy `draft`) y registrar ejecuciones | 004, 005, 008 (fila PDTP) | Prevención |
| 0b.2 | Cargar horas hombre por faena y mes (`safety_indicator_denominators`: 0 filas) | 001 | Prevención con RR. HH. |
| 0b.3 | Registrar incidentes y acciones CAPA en la plataforma (1 incidente y 0 CAPA en producción) | 001, 002, 003, 006 | Prevención |
| 0b.4 | Decidir las 6 faenas pendientes y correr la carga inicial de mantención | 018, 025, 026, 027 | Jefatura de mantención |
| 0b.5 | Registrar cargas en terreno, **o** derivar el rendimiento de las 3.910 lecturas de odómetro Copec (requiere backend) | 016, 017, 019, 021 | Combustible / desarrollo |
| 0b.6 | Registrar el nivel residual de los riesgos MIPER (0 de 540) | 007 (mitad residual) | Prevención |
| 0b.7 | Reponer los meses de Copec que faltan (septiembre de 2026 sin transacciones; 2025 sólo enero) o declararlos fuera de cobertura | 022, 033 y todos los gráficos de combustible | Integraciones |

**Criterio:** cada visualización de este grupo se construye **en el mismo trabajo** que activa su dato, con un estado vacío que diga qué registrar (A4), no antes.

### Fase 1 — Quick wins (Top 10 de hoy, sección F.1, más la base mínima)

- **Base mínima (primero):**
  1. **`ChartFrame` común** en `components/charts/`:
     - título;
     - subtítulo con período y unidad;
     - nombre accesible **con resumen de datos**;
     - «Ver datos» con tabla (se promueve `chart-data-table.tsx` de mantención);
     - estado vacío con CTA (`ChartEmpty`);
     - `href` de drill-down;
     - marca de período parcial.
  2. **Paleta de gráficos con tokens:** `--color-chart-1…6`, en OKLCH, en `app/globals.css`. Reemplazan los 8 hex de `chart-palette.ts`. Llevan una prueba de contraste como `design-tokens-contrast.test.ts`.
  3. **Primitivos CSS:** `BulletBar`, `AgingBar`, `ComplianceCalendar`.
- **Entregas:** las del ranking de hoy (F.1) que no requieren backend:
  - CHART-007 (mitad inherente)
  - CHART-030
  - CHART-008 (capacitación y alcotest primero; CPHS cuando haya sesiones)
  - CHART-036
  - CHART-031
  - CHART-022
  - CHART-020 (barra de nivel)
  - CHART-023 (retirar la torta)

  Las del ranking de potencial (004, 001, 027, 009, 016, 019, 005, 017) entran cuando su fila de la Fase 0b las desbloquee; con un buen estado vacío pueden adelantarse, pero no aportan lectura hasta que haya datos.
- **Dependencias:** Fase 0.
- **Esfuerzo:** 2–3 semanas de una persona.
- **Riesgos:**
  - mover los gráficos del tablero a `components/charts` sin romper `e2e/dashboard-rediseno.spec.ts`;
  - los locators en pantallas con doble árbol (tarjetas `md:hidden` y tabla).
- **Criterios de aceptación:**
  - cada gráfico tiene nombre accesible con resumen, tabla alternativa y drill-down a una lista filtrada en la URL (`router.replace(…, { scroll:false })`);
  - ningún gráfico usa hex;
  - las cifras del gráfico y de la tabla coinciden (prueba unitaria sobre el adaptador);
  - axe sin violaciones *serious*;
  - recorrido en navegador a 1440 y 390 px sin desborde horizontal;
  - `npm run check:bundle-budget` sigue bajo los 3 MB.

### Fase 2 — Modernización de vistas analíticas existentes

- **Entregas:**
  - CHART-033 (`/analitica`: Pareto, `RankedList`, área apilada y **una sola base de fecha**);
  - 032 (`/reportes` absorbida en E4);
  - 006 (material y ambiental absorbida en E1);
  - 023 (anomalías sin torta);
  - 031 (seguimiento);
  - 020 (estanques sin duplicado);
  - 021, 024;
  - 013, 014, 015;
  - retiro de `PdtpProgressRing`;
  - `evolution-by-vehicle` a *small multiples*;
  - `fuel-charts` con tokens `-ink` en los ejes.
- **Dependencias:** Fase 1 (`ChartFrame` y paleta).
- **Esfuerzo:** 2–3 semanas.
- **Riesgos:** unificar la base de fecha cambia cifras históricas de `/analitica`, así que hay que avisar a los usuarios.
- **Criterios de aceptación:**
  - `/analitica` y `/dashboard?vista=finanzas` dan la misma cifra para el mismo período (prueba de integración);
  - no queda ningún gráfico multicolor sin significado.

### Fase 3 — Visualizaciones avanzadas y dashboards nuevos

- **Entregas:**
  - CHART-002 y E1 (siniestralidad);
  - 003 (CAPA);
  - 010, 011;
  - 012 (`ExpiryHorizon`);
  - 017 (desviación por equipo);
  - 018 (hoja de vida del equipo);
  - 022 y E5 (salud de datos);
  - 025 y 026 con E3 (mantención);
  - 029 (lead time) con E4;
  - 034, 035;
  - E2 (calendario integral).
- **Dependencias:**
  - consultas nuevas con alcance por faena y pruebas PGlite;
  - para 025 y 026: que la correctiva en taller mueva el estado operativo, y al menos 2–3 meses de OT;
  - para 028: el sync OnWay restablecido.
- **Esfuerzo:** 6–8 semanas.
- **Riesgos:**
  - rendimiento de agregaciones sobre tablas que crecen (alcotest hoy carga la tabla entera);
  - formatos de fecha en `text`;
  - n pequeño en tasas.
- **Criterios de aceptación:**
  - cada consulta nueva tiene prueba de alcance por faena (un usuario de la faena A no ve datos de la B);
  - `npm run perf:queries` sin regresión;
  - cada tasa muestra su n;
  - las métricas con datos insuficientes muestran el estado «datos insuficientes», nunca un número.

### Fase 4 — Consolidación

- **Contenido:**
  - **Inventario único** de gráficos en `components/charts/`, con una página interna de referencia o pruebas de snapshot por componente.
  - **Aviso de cobertura de datos** reutilizable en todos los gráficos de combustible y de integraciones.
  - **Patrón de drill-down** documentado en `DESIGN.md` (indicador → gráfico → desglose → registros).
  - **Responsive:** en menos de 360 px los gráficos densos se reemplazan por su tabla o por `RankedList`.
  - **Movimiento:** `useChartMotion` en todos los gráficos, con entrada ≤ 200 ms y sin animación en `prefers-reduced-motion`.
  - **Exportación:** «Ver datos» exporta a **Excel** con `ExportButton` (regla de exportación; nunca CSV).
  - **Prueba de guardia:** un test que falle si un archivo de gráfico importa recharts sin `ChartFrame` o usa un literal hex, igual que `modal-alto-estable.test.ts` hace con los modales.
- **Esfuerzo:** 1–2 semanas.
- **Criterios de aceptación:**
  - la prueba de guardia pasa;
  - `DESIGN.md` documenta la paleta y el patrón;
  - hay un recorrido completo en navegador con informe en `qa/reports/`.

### Identidad visual de los gráficos (transversal a todas las fases)

- **Color con significado, no con decoración.**
  - **Una serie:** `--color-primary`.
  - **Comparación contra referencia** (plan, meta, período anterior): la referencia en `--color-border-strong` o `--color-text-faint` y lo propio en `--color-primary`.
  - **Estados:** sólo `success` / `warning-ink` / `danger` / `info`, siempre con texto o ícono.
  - **Categorías sin semántica:** una paleta categórica de 6 tokens, y nunca más de 6 colores en un gráfico. Con más series, se resalta una y el resto va en gris, o se usan *small multiples*.
  - **Naranja** (`--color-signal`): sólo para pendientes, como manda `DESIGN.md`.
- **Tipografía:**
  - ejes y etiquetas en `text-xs` con `--color-text-muted`;
  - valores en `font-mono tabular-nums` fuera del tablero y en sans dentro del tablero (regla 7);
  - el titular del gráfico responde la pregunta («Ejecutado 0,2 % contra meta 90 %») y no la describe («Tendencia mensual»).
- **Geometría:**
  - sin degradados ni sombras en los datos;
  - barras con radio sólo en el extremo libre (nunca entre segmentos apilados);
  - grilla horizontal tenue y sin grilla vertical;
  - el eje Y empieza en 0 para las barras.
- **Densidad:** máximo 2 gráficos por fila en escritorio y 1 en móvil. El gráfico nunca reemplaza la tabla en pantallas de registro.

---

## J. Elementos que NO deben transformarse

| Superficie | Ejemplos | Por qué la tabla, la lista o el formulario es la forma correcta |
|---|---|---|
| Bandejas de trabajo | `/pendientes`, `/combustibles/revisar`, `/aprobaciones` (la cola), `/mantencion/registros`, `/prevencion/pdtp/aprobaciones`, `/inspecciones/seguimiento` | Cada fila es una decisión individual con acción. Un gráfico puede **encabezarlas** (antigüedad), nunca reemplazarlas |
| Registros con firma o valor legal | `/entregas`, `/bodega/trazabilidad/trabajador/[id]`, actas CPHS, cierres PDTP congelados, expediente RE-20 | Son evidencia: se auditan fila por fila y deben verse como documento |
| Bitácoras y kardex | `/combustibles/cargas`, `/cargas/tarjetas`, kardex, movimientos de estanque, `/bodega/documentos` | Se consultan para encontrar un registro. El gráfico (saldo, CHART-035b) complementa, no sustituye |
| Auditoría y forense | `/admin/auditoria`, `/prevencion/privacidad/auditoria`, `/cuadratura/sellos` (cadena) | La pregunta es «quién hizo qué y cuándo»: requiere el registro exacto |
| Catálogos y maestros | ≈ 26 páginas de `/admin/*`, `/combustibles/ajustes/*`, `/mantencion/pautas` (la matriz ya es la forma correcta), plantillas de inspección | Son datos de referencia sin magnitud que graficar |
| Superficies de captura | `/prevencion/pdtp/actividades`, `/inspecciones/[runId]`, `/m/mantencion` (PWA del mecánico), formularios de alta | El usuario está registrando. Un gráfico distrae y consume pantalla en terreno |
| Documentos tributarios | `/facturacion/facturas`, `/compras/dte` (la lista), cobranza | Cada fila lleva un dato tributario y una acción. El gráfico de cobertura (CHART-034) va aparte |
| Pantallas con muy pocos registros | coordinación, campañas, privacidad, dispositivos | Con decenas de filas, un gráfico agrega ruido y no información |
| El panel de combustible | `/combustibles` | Ya responde con frases y mini-barras: es la forma más clara para la jefatura |

**Reglas que se derivan:**

1. Si la decisión es **sobre una fila**, la tabla se queda.
2. Si la decisión es **sobre un patrón**, el gráfico va **encima** de la tabla, la filtra con un clic y nunca la elimina.
3. Un gráfico que no lleva a una acción ni a un subconjunto **no se agrega**.

---

## Verificaciones propias

Las afirmaciones que sostienen el Top 10 y la Fase 0 las verifiqué yo, además de las pasadas por dominio **[E]**:

- `/prevencion/indicadores` no importa ningún gráfico (grep) y en el navegador muestra 1 tabla de 12 × 6 y 0 gráficos.
- `getIncidentAnalyticsData`, `getTicketsByMonth`, `getTicketsByCategory`, `getAssetsByAge` y `getFleetGpsHistory` tienen 0 llamadores (grep sobre `app`, `lib` y `components`).
- `lib/chart-palette.ts` tiene 8 hex. `analytics-charts.tsx` usa `Cell` con `CHART_SERIES` por barra y no importa `Legend`.
- El total de material y ambiental suma todas las faenas (lectura de `material-environmental-dashboard.tsx:49-115`).
- `fuel-charts.tsx` usa `var(--color-info)` y `var(--color-signal)` como color de texto de los ejes.
- `reportes/page.tsx` usa `pendingReceiptCount` en las líneas 124, 141 y 146. `facturacion/page.tsx:118` usa `toLocaleDateString`. `indicadores/page.tsx:27` usa `getFullYear()`.
- Capturas: PDTP con barras por faena vacías; capacitación con 2.730 tarjetas; control operacional con 100 % de disponibilidad y 20,8 % de cobertura; analítica con el delta en rojo para una baja de gasto.
- `bodega_dev`: 367 migraciones contra 370 en el journal; el log del servidor mostraba `relation "mant_work_orders" does not exist`. Después de migrar (370/370), las rutas cargan; ver el anexo.

**Agregado en la revisión del 2026-11-03 [E]:**

- **Conteos y rangos de producción** (Anexo B), sobre un restore íntegro y sin datos simulados.
- **Espera por aprobación en producción:** mediana 8,3 h, P90 145,8 h (unos 6 días), máximo 524,7 h, sobre 210 aprobaciones. La cola estaba vacía (0 ítems en estado `requested`).
- **MIPER en producción:** 540 riesgos, todos con P y C y ninguno sobre P=2; `residual_level` está vacío en los 540. Clases RE-04: tolerable 206, moderado 288, importante 46.
- **Copec en producción:** 4.963 transacciones y 708 agregados. No hay ninguna de septiembre de 2026; de 2025 sólo hay enero; 45 agregados llevan la fecha centinela 2020-01-01.
- **Fuentes de combustible en el código:**
  - `/analitica` calcula el gasto en combustible desde `fuel_loads` (`analytics-module/dashboard.ts:143-175`), con 0 filas en producción.
  - La serie de rendimiento lee `fuel_equipment_loads` (`control/queries/overview.ts:134`, `performance.ts`), también con 0 filas.
- **Capturas con datos:** analítica (alza de 133 % en verde, tendencia de un punto, barras multicolor) y PDTP en móvil.
- **Las tres correcciones colaterales** (Anexo C, C-1 a C-3), con pruebas que fallan con el código anterior y pasan con el nuevo; C-1 también se comprobó en pantalla.

**No verificado** (inferencia marcada **[S]** en el texto):

- que los anclajes a pestañas de requisitos legales no naveguen;
- que `probability` y `consequence` lleguen al cliente en MIPER;
- que `totalAmount` incluya IVA;
- la brecha de visibilidad de `supervisor_mantencion` en el tablero (sale de los permisos por defecto, no de una sesión con ese rol).

## Anexo A — Evidencia del recorrido en navegador

- **Entorno:** `next dev` en `:3001`, base `bodega_dev`, sesión QA y Chromium de `@playwright/test`, a 1440 × 900 px. Fecha: 2026-11-02.
- **Resultado:** 198 rutas estáticas, 198 respuestas HTTP 200, 5 con error de entorno (mantención y flota, por la migración faltante) y 0 fallas de navegación.
- **Segundo recorrido**, con `bodega_dev` en 370/370: las 5 rutas cargan, igual que `/flota/[id]`, `/mantencion/equipos/[id]` y `/combustibles/consumo/equipos/[id]`, todas sin errores de consola. `/control-operacional` ya no muestra «1 de 4 fuentes no pudo cargarse».
- **Errores de consola:** además de los 5 de entorno, se observó un error de hidratación en `/prevencion/pdtp/aprobaciones` (`pdtp-evidence-thumbs.tsx:112`, un `Tooltip` sobre un `span` con `tabIndex`). Es ajeno a la visualización y queda anotado para su propia investigación.
- **Ruido conocido:** los avatares de `api.dicebear.com` fallan en el sandbox (sin internet).
- **Recorrido de la revisión (2026-11-03):** sobre el clon de producción poblado, 198 rutas estáticas y 27 fichas. Hubo 1 corte por tiempo (`/flota/monitoreo`, C-11) y 3 errores de consola, todos de la CSP del mapa. El detalle por ruta está en [qa/reports/2026-11-03-revision-visualizaciones.md](qa/reports/2026-11-03-revision-visualizaciones.md).
- **Resumen versionado:** las métricas por módulo están en la sección A. El resumen del recorrido está en [qa/reports/2026-11-02-recorrido-visualizaciones.md](qa/reports/2026-11-02-recorrido-visualizaciones.md).
- **Capturas y JSON por ruta:** quedaron fuera del repositorio por los datos personales y operativos que contienen (ver la sección H).


## Anexo B — Datos en producción por propuesta (2026-11-02)

**Fuente.** Restore íntegro del `pg_dump` de producción del 2026-11-02 (370 migraciones), en una base local aislada y sin datos simulados. Sólo se leyeron conteos y rangos de fecha: ningún dato personal pasó a este informe.

**Fecha de negocio vs. fecha de carga.** Las fechas son de negocio cuando la tabla las tiene. Si no, son `created_at`, que en tablas importadas es la fecha de carga, no la del hecho.

| Tabla | Filas | Rango | Propuestas que alimenta |
|---|---|---|---|
| `safety_indicator_denominators` | **0** | — | 001 |
| `prevention_incidents` / `prevention_incident_people` | **1** / 0 | 2026-09-30 | 001, 002, 006 |
| `prevention_capa_actions` | **0** | — | 003 |
| `pdtp_programs` / `pdtp_activity_schedule` / `pdtp_executions` | 1 (**draft**) / 821 / **0** | — | 004, 005, 008 |
| `prevention_risk_entries` | 540 (residual vacío en 540) | carga 2026-10-04 | 007 |
| `prevention_training_occurrences` | 3.991 (17 completadas) | carga sep–oct 2026 | 008 |
| `prevention_alcotest_slots` / `alcohol_tests` | 230 / 1 | — | 008, 010 |
| `prevention_committees` / `…_meetings` | 1 / **0** | — | 008, 015 |
| `prevention_exposure_measurements` | **0** | — | 009 |
| `prevention_inspection_runs` / `…_findings` | 22 / 1 | 2026-08-25 → 10-26 | 010 |
| `ppa_submissions` | 11 | 2026-07-08 → 11-02 | 011 |
| `prevention_emergency_plans` / `…_resources` | 10 / **0** | — | 012 |
| `prevention_work_permits` | **0** | — | 014 |
| `prevention_legal_requirements` | **0** | — | 013 |
| `fuel_tae_submissions` / `fuel_equipment_loads` | **0** / **0** | — | 016, 017, 019, 021, 024 |
| `fuel_provider_transactions` | 5.671 (4.963 transacciones + 708 agregados) | 2025-01 y 2026-01 → 2026-11; **sin septiembre de 2026**; 45 agregados con la fecha centinela 2020-01-01 | 019, 022, 033 |
| `fuel_meter_readings` (Copec TCT) | 3.910 | carga 2026-08-31 → 11-02 | 016 (hoy sin usar) |
| `fuel_telemetry_daily` (VisionLink) | 1.955, 6 equipos | día 2024-12-01 → 2026-11-01 | 021, 024 |
| `fuel_cycle_movements` | 342 | carga 2026-10-30 → 11-02 | 019, 020 |
| `fuel_anomaly_cases` | 346 | 2026-09-01 → 11-02 | 023 |
| `fuel_provider_period_coverage` | 48 | — | 022 |
| `fuel_vehicle_operational_intervals` | 89 (uno por vehículo) | 2026-08-31 → 10-30 | 018, 025 |
| `fleet_gps_position_history` | **0** | — | 028 |
| `mant_equipment_profiles` / `mant_records` / `mant_work_orders` | **0** / **0** / **0** | — | 018, 025, 026, 027 |
| `purchase_requests` / `…_items` / `approval_decisions` | 55 / 252 / 245 | 2026-07-08 → 10-29 | 029, 030, 031, 032 |
| `purchase_orders` / `receipts` / `deliveries` | 57 / 78 / 240 | 2026-07 → 11 | 029, 032, 033 |
| `inventory_movements` / `worksite_stock` | 724 / 199 | 2026-07-24 → 10-28 | 035 |
| `dispatch_guides` | 36 | 2026-08-12 → 10-23 | 037 |
| `dte_documents` / `purchase_order_invoices` | 3.363 / 36 | período 2026-05 → 2026-11 | 034 |
| `billing_invoices` | 565 | emisión 2026-07-14 → 10-30 | 036 |
| `it_assets` / `it_tickets` / `it_licenses` | **0** / **0** / **0** | — | 012, 038 |
| `backup_log` / `notifications` | 12 / 3.542 | 2026-10-26 → 11-02 / 2026-07 → 11 | 039 |

**Actividad por módulo (proxy de frecuencia).** No existe registro de lecturas ni de visitas a páginas. Lo que hay son escrituras: `operational_activity_events`, desde su inicio, y `audit_log` de los últimos 60 días.

| Módulo | Escrituras | Usuarios distintos | Lectura |
|---|---|---|---|
| Adquisiciones (solicitudes, compras, recepción) | 994 eventos operacionales; 512 escrituras de ítems | 7 | Uso diario |
| Bodega y entregas | 240 entregas; 533 movimientos; 450 cambios de producto | 6 | Uso diario |
| MIPER | 788 | 5 | Uso alto en el último mes (carga de matrices) |
| Inspecciones | 273 | 7 | Uso semanal |
| Combustible (mapeos, importaciones) | 190 | 1 | Lo opera una persona; el resto se sincroniza solo |
| Capacitación, alcotest, emergencias | 36 / 22 / 77 | 1 cada uno | Arranque |
| PDTP | 4 | 1 | Configuración, sin ejecución |
| Incidentes, CAPA, higiene, CPHS, permisos, legal, TI, mantención | 0 | 0 | Sin uso todavía |

## Anexo C — Hallazgos colaterales de la revisión

Salieron al poblar y recorrer la plataforma con datos. No son propuestas de visualización, pero afectan las cifras que cualquier gráfico mostraría.

| # | Hallazgo | Evidencia | Estado |
|---|---|---|---|
| C-1 | **La gravedad DS 44 mensual y semestral perdía los días de licencia que caen fuera del mes del accidente.** Un ajuste de rendimiento de julio (49a460a3a) pasaba al cálculo sólo los casos del período, y la corrección NORM-07 de agosto (a698ef15b) necesita todos los casos del año. | Con datos: Santa Fe mostraba «S1 6 + S2 0» con 25 días en el año. Ahora muestra junio 6, julio 19, S1 6 y S2 19. En pantalla, mayo, junio y julio pasaron de 0/6/0 a 31/13/19. | **Corregido** en `fix/seed-faenas-y-defectos-sst` (`lib/services/prevention-indicadores.ts`), con regresión en `prevention-indicators-groups.test.ts`. Sin commit. |
| C-2 | **La inspección «Observación de Seguridad: Maquinaria Pesada» v02 no se podía cerrar** cuando los 22 ítems estaban conformes y la reinstrucción era «sí». La respuesta de un ítem que no puntúa sumaba al numerador: 23/22 = 104,55 %, y la restricción de la base lo rechazaba. | Error capturado al poblar; reproducido con la plantilla real (antes 10.455 puntos base, ahora 10.000). | **Corregido** en la misma rama (`lib/prevention/inspections.ts`), con regresión. |
| C-3 | **La carga inicial de mantención creaba faenas duplicadas** («Cholguan» junto a «Cholguan - Arauco») sobre las faenas ya unificadas en producción. | Corrida sobre el clon: 10 faenas `MANT-*`. | **Corregido** en la misma rama: las decisiones van en `db/seed/mantencion-faenas.json` y una faena sin decidir detiene la carga. **Faltan 6 decisiones**: Arauco, Cabrero, Servimar, Sin ubicación, Ecoservitran y Panguipulli. |
| C-4 | **No hay transacciones Copec de septiembre de 2026**, y de 2025 sólo hay enero. Además, 45 agregados por período llevan la fecha centinela 2020-01-01. | Anexo B. | Abierto. Cualquier serie de combustible mostrará un valle falso en septiembre. Ver CHART-022 y Fase 0b.7. |
| C-5 | **El programa PDTP 2026 de producción está en `draft`**: su tablero muestra 0 % y la ejecución está bloqueada. | `pdtp_programs.status`. | Abierto. Es una decisión de Prevención, no un defecto. Fase 0b.1. |
| C-6 | **El rendimiento de combustible ignora 3.910 lecturas de odómetro Copec** que sí tiene producción: la serie sólo lee cargas en terreno, y hay 0. | `lib/combustibles/control/queries/overview.ts` y `performance.ts` leen `fuel_equipment_loads`; `fuel_meter_readings` sólo lo usa el detector de anomalías. | Abierto (requiere backend). Fase 0b.5. |
| C-7 | **Ningún riesgo MIPER tiene nivel residual registrado** (0 de 540). | `prevention_risk_entries.residual_level`. | Abierto. Fase 0b.6. |
| C-8 | **Error de hidratación en `/prevencion/pdtp/aprobaciones`**: un `Tooltip` envuelve un `span` con `tabIndex` en `pdtp-evidence-thumbs.tsx:112`. | Log del servidor en el primer recorrido. | Abierto, sin investigar. |
| C-9 | **`/analitica` muestra combustible en $0 en producción.** Calcula el gasto desde `fuel_loads` (`lib/services/analytics-module/dashboard.ts:143-175`), que tiene 0 filas, mientras las 5.671 transacciones Copec con monto viven en `fuel_provider_transactions`. | Anexo B y lectura del servicio. En el clon, analítica muestra «Combustible $0 · 0 cargas». | Abierto. Antes de cualquier gráfico de gasto (CHART-033) hay que decidir de qué fuente sale el gasto en combustible. |
| C-10 | **La «Tendencia mensual de gasto» de `/analitica` es un solo punto** con la ventana por defecto (últimos 30 días); además, un aumento de gasto de 133 % se pinta en verde. | Captura [a-analitica.png](qa/reports/2026-11-03-visualizaciones/a-analitica.png). | Abierto. La polaridad está en la Fase 0 (0.2); la ventana mínima de una serie mensual debería ser de 6 a 12 meses (CHART-033). |
| C-11 | **El mapa de `/flota/monitoreo` no carga su estilo en desarrollo**: la CSP (`lib/security/csp.ts:54`, `connect-src 'self'`) bloquea `tiles.openfreemap.org`, el estilo por defecto fuera de producción (`fleet-gps-map.tsx:7`). La página no termina de cargar. | Error de consola en el recorrido de la revisión. | Abierto. En producción el estilo sale de `NEXT_PUBLIC_MAP_STYLE_URL`; **no se verificó** si la CSP de producción lo permite. |

