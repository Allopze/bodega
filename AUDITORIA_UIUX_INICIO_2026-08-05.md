# Auditoría UI/UX del Inicio (dashboard) — 2026-08-05

Objetivo declarado: que el Inicio "se vea hermoso, lleno de información útil, con
gráficos bien posicionados y buena jerarquía". Esta auditoría evalúa el estado
actual contra ese objetivo con evidencia de código **y** de render real.

> **Estado 2026-08-05 (misma fecha, sesión de remediación):** aplicados los
> ítems 1–9 del plan (15 de 16 hallazgos con fix; I-09 parcial). Ver el
> **Registro de implementación** al final del documento. Pendiente: la parte
> de I-09 que exige datos reales de staging.

## 1. Método y evidencia

- Lectura completa del árbol `app/(app)/dashboard/` (~3.750 líneas) más los
  componentes compartidos (`KpiCard`, `SummaryBar`, `DashboardGrid`,
  `ChartDataTable`, `chart-palette`).
- Captura renderizada con la BD de fixtures del pipeline de capturas
  (`admin.audit@chome.cl`), build de producción fresco, en tres viewports:
  **1920×1080**, **1366×768** (portátil, el caso más apretado con sidebar
  abierto) y **390×844**. Página completa por cortes, con los charts diferidos
  ya montados.
- Evidencia persistida en `audit/screenshots/inicio-2026-08-05/` (34 cortes) y
  `audit/screenshots/dashboard/` (corrida estándar del pipeline).
- Marco: secuencia de 16 pasos del skill UI/UX (Few/Tufte para dashboards,
  heurísticas de Nielsen, WCAG 2.2), respetando las decisiones ya cerradas en
  `AUDITORIA_DASHBOARD_2026-07-30.md` y
  `AUDITORIA_DASHBOARD_COBERTURA_GERENCIA_2026-07-31.md` (no se re-litigan).

**Límite del método**: los fixtures pueblan una sola faena con pocos registros.
Los juicios de densidad con datos reales (¿cuántas barras tiene "Proveedores
por gasto" en prod?) deben re-verificarse contra staging. Los defectos de
código citados no dependen de los datos.

## 2. Diagnóstico general

- **Superficie**: dashboard operacional-ejecutivo, ~6.900 px de alto en desktop
  (Centro de Control above-the-fold + 6 secciones por dominio con índice).
- **Puntuación global**: **6,6 / 10**
- **Veredicto**: la **arquitectura de información es sólida** — probablemente
  lo mejor del producto: cuadrantes correctos (dinero arriba-izquierda, cola en
  el centro, alertas al costado), cero repetición de cifras dentro del Centro
  de Control (A5), cada gráfico con conclusión en prosa y tabla equivalente.
  Pero **no está listo para llamarse "hermoso y lleno de información útil"**:
  el KPI de dinero — la cifra número uno de gerencia — **nunca muestra un
  número**, hay tres valores distintos para "aprobaciones" en la misma
  pantalla, y dos stickies se pisan tapando el título. Primero verdad y
  estabilidad visual; el refinamiento estético es lo de menos (§6).

### Puntuación por dimensiones

| Dimensión | Nota | Por qué |
|---|---|---|
| Arquitectura de información | 8,5 | Ranuras semánticas, cascadas por permiso, secciones por dominio con índice y enlaces de drill-down |
| Jerarquía visual | 7,5 | Punto focal único, tipografía consistente (Exo/mono), pero stickies en colisión y truncados a 1366 |
| Datos y confianza | 4,5 | "—" en Inversión, 0/1/3 para aprobaciones, conclusiones automáticas absurdas en cero |
| Accesibilidad | 8,0 | Tabla equivalente por gráfico (raro de ver, excelente), aria/focus correctos; color-por-índice miente en un caso |
| Responsividad | 6,0 | 1366: barra índice tapa el título y KPIs truncados; mobile: CTA de la cola fuera de pantalla |
| Usabilidad | 7,0 | Todo navega y filtra; contradicciones numéricas y controles solitarios restan |

## 3. Lo que ya está bien (no romperlo)

1. **Cuadrantes de Few**: KPI cards arriba-izquierda con cifra grande, tendencias
   al centro, listas al pie. La regla "máximo 4 tiles accionables" (A1) se cumple.
2. **A5 dentro del Centro de Control**: `shownAsTile` evita que una cifra sea
   tile y alerta a la vez ([page.tsx:196-216](app/(app)/dashboard/page.tsx#L196-L216)).
3. **`ChartDataTable` en casi todos los gráficos**: conclusión en prosa
   ("Lectura rápida") + tabla plegable. Cumple "el color no es el único canal"
   mejor que la mayoría de los dashboards comerciales.
4. **Honestidad de alcance**: las notas "no sigue el filtro de arriba" en DTE y
   deuda de combustible dicen la verdad en vez de fingir coherencia.
5. **Rendimiento percibido**: Suspense por sección, skeletons con altura
   reservada, Recharts fuera del chunk inicial, error boundary por gráfico.
6. **Estados vacíos** con lenguaje de usuario y CTA real (A4).

## 4. Hallazgos

### P0 — El dashboard muestra "—" o cifras contradictorias

#### I-01 · El KPI de Inversión nunca muestra un número — Crítico

- **Problema**: el tile "Inversión" (primera posición, la ranura de dinero) y
  la fila "Inversión emitida" de Flujo del mes renderizan **"—" siempre**, con
  o sin gasto. También la "Lectura rápida" de Inversión por Faena: *"Faena
  Mininco concentra la mayor inversión: **—**"* mientras la barra sí dibuja
  ~$230k al lado.
- **Evidencia**: `desktop-1920-slice-00/01/02.png`. Causa raíz:
  `COALESCE(SUM(totalAmount), 0)` tipado `sql<number>` en
  [operational-period-metrics.ts:126-127](lib/services/operational-period-metrics.ts#L126-L127)
  y [dashboard-metrics.ts:112](lib/services/dashboard-metrics.ts#L112) — el
  driver devuelve los agregados NUMERIC/BIGINT como **string**, y
  [formatCLP](lib/utils.ts#L33-L40) hace `Number.isFinite(amount)` sin coerción
  → `VALUE_MISSING` ("—"). El módulo de analítica ya resuelve esto con
  `Number(...)` ([analytics-module/dashboard.ts:62-69](lib/services/analytics-module/dashboard.ts#L62-L69));
  estos dos servicios omitieron la conversión. Por eso "Gasto" de la sección
  Adquisiciones sí muestra "$0" y el tile de arriba no.
- **Principio**: Nielsen #1 (visibilidad del estado del sistema); Few: la
  métrica estratégica va arriba-izquierda **y con cifra**. Un "—" en la ranura
  de dinero le dice a gerencia "esto está roto".
- **Recomendación**: `Number(...)` en los dos servicios (mismo patrón que
  analítica) + un test que pase un agregado string por `formatCLP` vía estas
  rutas. Considerar que `formatCLP` haga `Number(amount)` defensivo o
  `assert` en dev, para que el próximo `sql<number>` mentiroso no llegue a
  producción.

#### I-02 · Tres cifras distintas para "aprobaciones" en la misma pantalla — Alto

- **Problema**: la alerta dice "**3** ítems esperan aprobación", el atajo de la
  cola dice "Aprobaciones **1**", y el KPI "Por aprobar" de la sección
  Adquisiciones dice "**0** · Esperando decisión ahora".
- **Evidencia**: `desktop-1920-slice-00.png` (alerta y atajo) +
  `slice-01.png` (KPI). Son tres fuentes:
  `data.metrics.pending_approvals` ([page.tsx:204](app/(app)/dashboard/page.tsx#L204)),
  `queue.summary.moduleCounts.aprobaciones` ([page.tsx:374](app/(app)/dashboard/page.tsx#L374))
  y `analytics.kpis.pendingApprovals` filtrado por el período elegido
  ([dashboard-domain-sections.tsx:119-120](app/(app)/dashboard/dashboard-domain-sections.tsx#L119-L120)).
- **Principio**: consistencia y estándares (Nielsen #4). El usuario no sabe que
  una es población total, otra es "lo asignado a tu cola" y otra "creadas en el
  período": lee tres veces la misma etiqueta con tres números.
- **Recomendación**: (a) unificar la fuente — el conteo de aprobaciones
  pendientes es estado actual, no debería seguir la ventana del período; (b) si
  las poblaciones son legítimamente distintas, el rótulo debe decirlo
  ("Aprobaciones creadas · mes en curso" vs. "Esperando tu decisión · ahora").
  Hoy dos de los tres dicen "ahora" y aún así difieren.

#### I-03 · Conclusiones automáticas absurdas cuando todo es cero — Alto

- **Problema**: con datos en cero, las "Lecturas rápidas" afirman cosas sin
  sentido: *"La gravedad más alta se registró en **Ene: 0**"*, *"El mes con más
  eventos es **Ene**"* (todos los meses tienen 0), *"El más rezagado es
  **Procesos: 100%**"* (todo está al 100%). Además "Accidentes por estado de
  calificación" pinta una **rejilla vacía** (solo ejes y gridlines) cuando no
  hay ningún accidente.
- **Evidencia**: `desktop-1920-slice-03/04.png`. Causa: `maxBy`
  ([dashboard-charts.tsx:127-129](app/(app)/dashboard/dashboard-charts.tsx#L127-L129))
  devuelve la primera fila en empate y las conclusiones se interpolan sin caso
  base; `SstAccidentChart` solo se oculta con `data.length === 0`, no con
  datos todos-cero ([dashboard-charts.tsx:345-348](app/(app)/dashboard/dashboard-charts.tsx#L345-L348)).
- **Principio**: la conclusión es "lo que la mayoría viene a buscar" (contrato
  declarado en [chart-data-table.tsx:19-24](components/ui/chart-data-table.tsx#L19-L24)).
  Una conclusión falsa es peor que ninguna: entrena al usuario a ignorarlas.
- **Recomendación**: caso base en cada conclusión cuando `max === 0` ("Sin
  accidentes registrados este año", "Sin eventos en el período", "Todas las
  áreas al 100%") y ocultar (o reemplazar por empty-state de una línea) los
  gráficos cuyo total es 0. Es el mismo criterio que ya aplica
  `StatusShareBar` (`total === 0 → null`).

#### I-04 · PDTP global: el aside pide elegir faena mientras Prevención calcula el global — Medio

- **Problema**: con alcance "Todas las faenas", la tarjeta PDTP del aside
  muestra "**—** avance real", barra vacía y eyebrow "SELECCIONA FAENA";
  cuatro pantallas más abajo, el KPI de Prevención muestra "Cumplimiento PDTP
  **50%** · Avance acreditado · año 2026" — global, sin pedir nada.
- **Evidencia**: `desktop-1920-slice-00.png` vs. `slice-03.png`. Dos motores:
  [pdtp-compliance-card.tsx:203](app/(app)/dashboard/pdtp-compliance-card.tsx#L203)
  anula `percent` cuando hay más de una faena;
  [dashboard-domain-sections.tsx:233](app/(app)/dashboard/dashboard-domain-sections.tsx#L233)
  usa `getPdtpComplianceIndicatorsForScope`, que sí agrega multi-faena.
- **Principio**: consistencia (Nielsen #4). Si el número global existe y es
  legítimo (lo publica la sección Prevención), la tarjeta protagonista no puede
  declararse incapaz de calcularlo.
- **Recomendación**: alimentar la tarjeta del aside con el mismo agregado
  global (`getPdtpComplianceIndicatorsForScope`) y reservar "selecciona faena"
  solo para lo que de verdad es por-faena (p. ej. cumplimiento integral).

### P1 — Layout: cosas que se pisan, se cortan o se duplican

#### I-05 · El índice sticky de dominios choca con la TopBar — Alto

- **Problema**: al scrollear las secciones de dominio, el índice pega texto
  sobre texto. A **1920** (rail vertical, `2xl:top-4`, fondo transparente) los
  rótulos "Control preventivo en terreno", "Cumplimiento y gobernanza" quedan
  superpuestos al título "Dashboard" de la TopBar. A **1366** (barra
  horizontal, `top-0`, mismo `z-10` que la TopBar) la barra **tapa el título y
  el buscador** por completo.
- **Evidencia**: `desktop-1920-slice-02.png` (texto sobre "Dashboard"),
  `laptop-1366-slice-03.png` (TopBar cubierta). Causa:
  [dashboard-domain-shell.tsx:23-28](app/(app)/dashboard/dashboard-domain-shell.tsx#L23-L28)
  (`sticky top-0 z-10`, `2xl:top-4 2xl:bg-transparent`) contra
  [app-shell.tsx:145](components/layout/app-shell.tsx#L145) (TopBar
  `sticky top-0 z-10` en el mismo scroll container).
- **Principio**: jerarquía y legibilidad; dos capas sticky al mismo z con
  offsets que no se conocen entre sí siempre terminan así.
- **Recomendación**: offset del índice = alto de la TopBar (`top-14`/`top-16`
  con token, no número mágico) en ambos breakpoints, fondo opaco también en
  `2xl`, y z-index por debajo de la TopBar. Verificar con una captura
  scrolleada (el pipeline hoy solo captura el tope de la página — por eso
  ninguna pasada anterior lo vio).

#### I-06 · La celda Acción desborda sobre Antigüedad en la cola — Medio

- **Problema**: a 1920, cuando una fila trae control de asignación + CTA
  ("Asignar" + "Aprobar o devolver"), el contenido (~230 px) no cabe en la
  columna de 9rem (144 px) y, siendo `whitespace-nowrap` + `justify-self-end`,
  desborda hacia la izquierda **encima** de "56 días".
- **Evidencia**: `desktop-1920-slice-00/01.png` (filas "Aprobar Cinta
  reflectante", "Comprar Cinta reflectante": se lee "56 día⟂Asignar"). Código:
  [dashboard-control-center.tsx:483](app/(app)/dashboard/dashboard-control-center.tsx#L483)
  (grid `5.5rem_minmax(12rem,1fr)_5rem_9rem`) y
  [:498-501](app/(app)/dashboard/dashboard-control-center.tsx#L498-L501).
- **Principio**: Gestalt (proximidad/legibilidad); una tabla que se pisa a
  1920 px transmite descuido aunque todo lo demás esté pulido.
- **Recomendación**: ensanchar la 4ª columna a `minmax(9rem,max-content)` o
  llevar "Asignar" a un icon-button con tooltip. El comentario del propio
  archivo (L-02) ya redujo columnas por ancho intrínseco; esta celda quedó
  fuera de ese cálculo.

#### I-07 · "Faena Mininco · Faena Mininco": la faena se imprime dos veces por fila — Medio

- **Problema**: cada fila de la cola muestra la faena duplicada:
  *"Faena Mininco · Faena Mininco · Prevencionista Faena"*.
- **Evidencia**: todas las filas en `desktop-1920-slice-00/01.png`. Causa: el
  servicio ya incluye la faena dentro de `subtitle`
  ([operational-work-queue.ts:524-761](lib/services/operational-work-queue.ts#L524),
  `CONCAT(worksites.name, ' · ', …)` o `worksites.name` a secas) y la fila
  vuelve a anteponer `task.worksiteName`
  ([dashboard-control-center.tsx:492-494](app/(app)/dashboard/dashboard-control-center.tsx#L492-L494)).
  `/pendientes` probablemente comparte el síntoma (misma fuente).
- **Principio**: relación señal-ruido (Few/Tufte). En la celda que ya trunca,
  la mitad del espacio la ocupa un dato repetido.
- **Recomendación**: sacar la faena del `subtitle` en el servicio (la UI ya la
  tiene como campo propio) — fix único para dashboard y `/pendientes`.

#### I-08 · KPIs truncados en portátil (1366) — Medio

- **Problema**: con sidebar abierto a 1366, los tiles truncan **label y
  detalle**: "Incidentes abier…", "Su plazo comprometid…", "OC emitidas · mes
  en c…", "Órdenes con recepción…". Cuatro de cuatro tiles con elipsis.
- **Evidencia**: `laptop-1366-slice-00.png`. Código:
  [kpi-card.tsx:51](components/ui/kpi-card.tsx#L51) y
  [:90](components/ui/kpi-card.tsx#L90) (`truncate` en ambos).
- **Principio**: Fitts/legibilidad; 1366 es el caso normal de la operación
  según las auditorías anteriores del repo, no un edge case.
- **Recomendación**: permitir 2 líneas en el detalle (`line-clamp-2` en vez de
  `truncate`) y acortar copys ("Su plazo comprometido ya venció" → "Plazo
  vencido"); el `title` ya existe como fallback pero nadie hoverea tiles.

#### I-09 · Gráficos de un solo dato: barras gigantes y huecos a la derecha — Medio (estético)

- **Problema**: con pocos datos, `WorksiteActivityChart`, "Mayor déficit de
  stock" y la dona de documentos rinden **una** barra de ~150 px de grosor o un
  anillo de una sola categoría dentro de una tarjeta `h-56`, y varias secciones
  quedan con la segunda columna del grid de charts vacía (hueco blanco del
  mismo alto que la tarjeta vecina).
- **Evidencia**: `desktop-1920-slice-02.png` (Inversión por faena),
  `slice-05.png` (déficit de stock + hueco), `slice-06.png` (dona "vigente"
  única + hueco).
- **Principio**: Tufte (data-ink ratio): una tarjeta de 380 px para un solo
  número es decoración; el hueco rompe la retícula.
- **Recomendación**: (a) `barSize={18-24}` fijo en los `BarChart` verticales
  (ya lo hace `ThresholdRankingChart`; `WorksiteActivityChart` no); (b) bajo un
  umbral de datos (≤2 elementos), degradar a `SummaryBar`/stat simple en vez
  de chart; (c) cuando una sección queda con N impar de charts, dejar que el
  último ocupe `xl:col-span-2` o compactar su alto. Con datos reales de prod
  esto se atenúa — verificar contra staging antes de invertir en (b).

#### I-10 · "Distribución por módulo": un color por barra sin significado — Medio

- **Problema**: las 6 barras usan 6 colores del `CHART_SERIES` (verde, azul,
  naranja, morado, teal, **rojo**) siendo **una sola serie**. El rojo cae en
  "Aprobaciones" y el naranja en "Recepciones": colores que en todo el resto
  del producto significan peligro/pendiente, acá asignados por posición.
- **Evidencia**: `desktop-1920-slice-02.png`; código
  [dashboard-charts.tsx:281-285](app/(app)/dashboard/dashboard-charts.tsx#L281-L285).
- **Principio**: el propio design system lo declara: *"brand, signal y danger
  […] el color codifica semántica"* ([chart-palette.ts](lib/chart-palette.ts));
  paleta categórica es para **categorías independientes entre gráficos**, no
  para teñir una serie única. Few: antipatrón "árbol de Navidad".
- **Recomendación**: una serie = un color (azul o brand) — igual que ya hace
  "Tendencia operativa". Si se quiere resaltar el módulo dominante, un solo
  acento en la barra mayor.

#### I-11 · `StatusShareBar` colorea por índice y miente la semántica — Alto

- **Problema**: "Resultado de los simulacros" muestra una barra **verde
  completa** cuya única categoría es "**Por mejorar**". El verde (brand =
  positivo/completado) se asigna por índice tras filtrar los ceros, así que la
  primera categoría presente hereda el color "bueno" aunque sea la mala.
- **Evidencia**: `desktop-1920-slice-06.png`; código
  [dashboard-charts.tsx:826-833](app/(app)/dashboard/dashboard-charts.tsx#L826-L833)
  (`CHART_SERIES[index]` sobre `slices` ya filtradas).
- **Principio**: WCAG 1.4.1 está cubierto por la leyenda, pero el color
  semántico invertido es peor que color neutro: comunica lo contrario del dato
  (Few: los colores de estado deben salir de una escala de severidad real).
- **Recomendación**: que el consumidor pase el color por categoría
  (`{ key, label, value, color? }`) y que los llamadores con semántica
  (satisfactorio/por mejorar, activo/suspendido, habilitado/no habilitado)
  mapeen brand/signal/danger explícitamente; índice solo como fallback.

#### I-12 · Cola en mobile: la acción queda fuera de pantalla — Medio

- **Problema**: en 390 px la tabla mantiene `min-w-[34rem]` y muestra solo
  Prioridad + Tarea; **Antigüedad y el CTA** ("Aprobar o devolver", "Revisar
  solicitud") viven fuera del viewport y exigen scroll horizontal dentro de la
  tarjeta, sin affordance visible de que hay más columnas. La página completa
  además mide ~13.800 px.
- **Evidencia**: `mobile-390-slice-02.png`; código
  [dashboard-control-center.tsx:308-319](app/(app)/dashboard/dashboard-control-center.tsx#L308-L319).
- **Principio**: reachability móvil y Nielsen #7; la acción principal de cada
  fila no puede requerir un gesto que nada anuncia.
- **Recomendación**: bajo `sm`, cambiar la fila a layout apilado (badge +
  título + meta + CTA en bloque) en vez de tabla con scroll lateral. Es el
  mismo componente; un variant por breakpoint. La longitud total de la página
  en móvil se mitiga sola si los charts vacíos se ocultan (I-03/I-09).

### P2 — Consistencia, copy y detalles

#### I-13 · La página se llama "Dashboard"; el nav la llama "Inicio" — Bajo

- **Evidencia**: sidebar "Inicio" activo junto al título "Dashboard"
  (`desktop-1920-slice-00.png`);
  [page.tsx:47,232](app/(app)/dashboard/page.tsx#L47) vs.
  [desktop-nav.tsx:148](components/layout/desktop-nav.tsx#L148). Ya estaba
  detectado en `AUDITORIA_LENGUAJE_TECNICO.md` §2.2 y quedó a medio migrar: el
  nav se cambió, el título/metadata/loading no.
- **Principio**: Krug — "¿dónde estoy?" debe tener una sola respuesta.
- **Recomendación**: `title="Inicio"` en PageHeader, metadata y `loading.tsx`.

#### I-14 · Chip de tendencia "↑ 0%" en verde — Bajo

- **Evidencia**: KPI "Gasto $0 · ↑0%" (`desktop-1920-slice-01.png`);
  [kpi-card.tsx:76-88](components/ui/kpi-card.tsx#L76-L88) trata `>= 0` como
  positivo (flecha arriba + verde éxito).
- **Recomendación**: caso `trend === 0` neutro ("= 0%" gris, sin flecha). Una
  variación nula presentada como buena noticia es una micro-mentira semántica.

#### I-15 · `MaintenanceTrendChart` es el único gráfico sin tabla equivalente — Bajo

- **Evidencia**: [dashboard-charts.tsx:568-595](app/(app)/dashboard/dashboard-charts.tsx#L568-L595)
  no monta `ChartDataTable`; los otros 10 sí. Rompe la paridad TASK-UI-015
  (lector de pantalla y 320 px se quedan sin las cifras de mantención).
- **Recomendación**: agregar la tabla (mes / completadas / programadas / costo)
  — 10 líneas, patrón idéntico al de `FuelConsumptionChart`.

#### I-16 · Micro-copys y detalles menores — Bajo

- "El texto se filtra desde la búsqueda de la cabecera": instrucción permanente
  en el subtítulo de la cola; mejor un `placeholder`/hint en el buscador o
  nada ([dashboard-control-center.tsx:263-268](app/(app)/dashboard/dashboard-control-center.tsx#L263-L268)).
- Tooltip del ranking pega valor y nombre sin separador: "1 de 1Procesos"
  (`desktop-1920-slice-04.png`;
  [dashboard-charts.tsx:778-784](app/(app)/dashboard/dashboard-charts.tsx#L778-L784)).
- La banda de filtros de la cola reserva grid de 3 columnas para **un** select
  ("Ordenar por") — una franja de borde a borde casi vacía
  ([dashboard-control-center.tsx:299-305](app/(app)/dashboard/dashboard-control-center.tsx#L299-L305));
  cabría inline en el header de la tarjeta.
- "1 abiertas en total", "1 cuenta(s)", "ejecutado(s)": pluralización a medias
  en varios KPIs; el repo ya conjuga bien en otros ("1 fila"/"filas").

## 5. Plan de acción priorizado

| # | Acción | Hallazgos | Esfuerzo |
|---|--------|-----------|----------|
| 1 | `Number(...)` en los agregados de `operational-period-metrics` y `dashboard-metrics` + test de `formatCLP` sobre esas rutas | I-01 | ~1 h |
| 2 | Sticky del índice: offset bajo la TopBar, fondo opaco, z-index menor | I-05 | ~1 h |
| 3 | Unificar/rotular las tres cifras de aprobaciones | I-02 | ~2 h |
| 4 | Caso base "todo en cero" en conclusiones + ocultar charts sin datos | I-03 | ~2 h |
| 5 | Quitar la faena del `subtitle` del servicio de cola | I-07 | ~1 h |
| 6 | Columna Acción `max-content`; fila apilada en mobile | I-06, I-12 | ~2 h |
| 7 | Color por categoría en `StatusShareBar`; una serie = un color en Distribución por módulo | I-10, I-11 | ~1,5 h |
| 8 | PDTP global en la tarjeta del aside | I-04 | ~1,5 h |
| 9 | `line-clamp-2` + copys cortos en KPIs; chip 0% neutro; título "Inicio"; tabla en Mantención; micro-copys | I-08, I-13—I-16 | ~2 h |
| 10 | Pasada estética con datos reales (staging): `barSize` fijo, degradar charts de ≤2 datos, ocupar huecos del grid | I-09 | ~0,5 día |

Los ítems 1-5 son los que separan "se ve bonito" de "dice la verdad"; ninguno
requiere rediseño, solo corrección. Tras aplicarlos conviene **agregar al
pipeline de capturas 1-2 tomas scrolleadas** del dashboard: los hallazgos I-05,
I-06 y I-07 eran invisibles para las capturas actuales (solo tope de página) y
por eso sobrevivieron a tres auditorías previas.

## 6. Sobre "que se vea hermoso"

La base estética es buena y no hay que inventarle una personalidad nueva:
canvas gris suave, tarjetas blancas con hairline + `shadow-xs`, Exo para
display, mono tabular para cifras, verde esmeralda como único protagonista.
Lo que hoy la sabotea no es falta de diseño sino los defectos de arriba
(un "—" gigante, texto pisado, barras de 150 px). Con eso corregido, tres
refinamientos de bajo riesgo y alto retorno visual:

1. **Disciplina cromática en charts**: brand para "lo logrado", signal para "lo
   pendiente", danger solo para severidad real, azul/violeta/teal únicamente
   cuando conviven ≥3 series. Hoy el 80% ya lo cumple; I-10/I-11 son las fugas.
2. **Ritmo vertical de las secciones**: los títulos de dominio (`text-h3` +
   hairline) compiten con los títulos de tarjeta (eyebrow uppercase). Subir los
   títulos de dominio un escalón (`text-h2` o peso/espaciado mayor) haría el
   escaneo por anclas más obvio sin agregar nada.
3. **Sparklines donde ya hay serie**: la regla del repo ("solo series reales")
   es correcta; hoy solo stock la cumple. Cuando existan 30 días de snapshots
   de solicitudes/OC/CAPA, el aside "Backlog comparado" gana lectura de
   tendencia gratis — la infraestructura ya está
   ([operational-metric-snapshots](lib/services/operational-metric-snapshots.ts)).

## Anexo — Evidencia

- `audit/screenshots/inicio-2026-08-05/desktop-1920-slice-00..07.png` — página
  completa por cortes, 1920×1080.
- `audit/screenshots/inicio-2026-08-05/laptop-1366-slice-00..10.png` — ídem 1366×768.
- `audit/screenshots/inicio-2026-08-05/mobile-390-slice-00..14.png` — ídem 390×844.
- `audit/screenshots/dashboard/` — corrida estándar del pipeline (con
  interacciones de selects/dropdowns), misma fecha.
- BD de fixtures: la del pipeline de capturas (una faena con datos, resto en
  cero) — ver "Límite del método" en §1.

---

# Registro de implementación — 2026-08-05

Los 10 ítems del plan §5, en orden. Typecheck limpio; 110 tests pasando
(incluye los 2 nuevos/actualizados). Verificación visual re-capturada tras el
build (ver nota al final).

## 1 · I-01 — Inversión "—" · ✅

- `Number(...)` en los tres agregados de spend
  ([operational-period-metrics.ts:131-138](lib/services/operational-period-metrics.ts#L131-L138))
  y en `totalCost` ([dashboard-metrics.ts:129](lib/services/dashboard-metrics.ts#L129)).
- Endurecido `formatCLP` para aceptar string numérico del driver (y seguir
  respondiendo "—" a un string no numérico): [lib/utils.ts](lib/utils.ts#L33) —
  mata la clase entera de bugs, no solo estas dos rutas. Test nuevo en
  [formatting.test.ts](lib/__tests__/formatting.test.ts) ("acepta agregados
  string del driver").

## 2 · I-05 — Stickies en colisión · ✅

- Índice de dominios: `top-0` → `top-14` (alto exacto de la TopBar,
  `h-[3.5rem]`), `2xl:top-4` → `2xl:top-18`, `z-10` → `z-5` (bajo la TopBar) y
  fondo con blur también en `2xl`
  ([dashboard-domain-shell.tsx:23-35](app/(app)/dashboard/dashboard-domain-shell.tsx#L23-L35)).
- Anclas de sección re-ajustadas al nuevo offset: `scroll-mt-28 2xl:scroll-mt-20`.

## 3 · I-02 — Tres cifras de aprobaciones · ✅ (con matiz)

- El KPI "Por aprobar" de Adquisiciones ahora recibe
  `data.metrics.pending_approvals` desde la página — la **misma** cifra y la
  misma ventana ("ahora") que la alerta del Centro de Control; su detalle dice
  "Ítems esperando decisión ahora"
  ([dashboard-domain-sections.tsx](app/(app)/dashboard/dashboard-domain-sections.tsx#L119),
  [page.tsx](app/(app)/dashboard/page.tsx#L311)).
- **Matiz**: el atajo "Aprobaciones N" de la cola puede seguir difiriendo — es
  la población de **tu cola** (tareas accionables filtradas por
  `approvalQueueFilter`), y vive dentro de la tarjeta "Cola de trabajo" que
  declara ese contexto. Alerta y KPI ya no se contradicen entre sí.

## 4 · I-03 — Conclusiones absurdas / rejillas vacías · ✅

- Guard "todo en cero → `null`" en `OperationalTrendChart`, `SstTrendChart`,
  `SstAccidentChart` y `MaterialEnvironmentalChart`
  ([dashboard-charts.tsx](app/(app)/dashboard/dashboard-charts.tsx)).
- `ThresholdRankingChart`: caso base cuando todos los valores son iguales
  ("Sin diferencias: todos en 100%." / "Un solo caso: …") en vez de "el más
  rezagado es X: 100%".
- `MaintenanceTrendChart`: conclusión con caso "Sin costos de mantención
  registrados".

## 5 · I-07 — Faena duplicada en cada fila · ✅

- Raíz corregida en el **servicio**: ninguna variante de `subtitle` incluye ya
  la faena (13 sitios SQL + 2 builders JS;
  [operational-work-queue.ts](lib/services/operational-work-queue.ts)). Las OC
  conservan el proveedor; las solicitudes, su conteo de ítems; la rama de
  hidratación JS de OC ahora también trae el proveedor (join a `suppliers`).
- Consumidores ajustados: la fila del dashboard compone
  `faena · código · detalle · responsable` sin duplicados
  ([page.tsx `toDashboardTask`](app/(app)/dashboard/page.tsx#L73),
  [dashboard-control-center.tsx](app/(app)/dashboard/dashboard-control-center.tsx#L492));
  `/pendientes` deja de emitir "código · " colgante con subtítulo vacío
  ([work-queue-workbench.tsx:329](app/(app)/pendientes/work-queue-workbench.tsx#L329)).
  En `/pendientes` esto además elimina la faena que aparecía dos veces (columna
  propia + subtítulo).

## 6 · I-06 + I-12 — Layout de la cola · ✅

- Celda Acción: `flex-wrap` en vez de `whitespace-nowrap` — "Asignar" + CTA ya
  no desbordan sobre "56 días"; en el peor caso se apilan dentro de su columna.
- Mobile (<`sm`): la fila se apila (prioridad / título+meta / antigüedad /
  acciones) y desaparece el `min-w` que forzaba scroll lateral con el CTA
  fuera del viewport. El encabezado de columnas se oculta bajo `sm`
  ([dashboard-control-center.tsx `WorkQueueRow`](app/(app)/dashboard/dashboard-control-center.tsx#L480)).

## 7 · I-10 + I-11 — Colores que mienten · ✅

- "Distribución por módulo": una serie = un color (azul del config); el rojo
  posicional sobre "Aprobaciones" desaparece.
- `StatusShareBar` acepta `color` por categoría; los tres llamadores declaran
  semántica: permisos (activos verde / suspendidos naranja), simulacros
  (satisfactorios verde / **por mejorar naranja**), evaluaciones SST
  (habilitados verde / no habilitados rojo / borrador gris)
  ([dashboard-charts.tsx](app/(app)/dashboard/dashboard-charts.tsx#L796),
  [dashboard-domain-sections.tsx](app/(app)/dashboard/dashboard-domain-sections.tsx#L483)).

## 8 · I-04 — PDTP global en el aside · ✅

- `loadPdtpComplianceSummary` usa `getPdtpComplianceIndicatorsForScope` (el
  mismo motor que la sección Prevención) cuando el alcance tiene más de una
  faena; el eyebrow dice "Global · N faenas". La rama "Selecciona faena" y el
  prop `requiresWorksiteSelection` se eliminaron (código muerto). El
  cumplimiento **integral** sigue siendo por-faena (no tiene agregado).
- Test actualizado: el caso que congelaba "sin número global" ahora asegura lo
  contrario ([pdtp-compliance-card.test.tsx](app/(app)/dashboard/pdtp-compliance-card.test.tsx)).

## 9 · I-08, I-13, I-14, I-15, I-16 — Pack menor · ✅

- **I-08**: detalle del KPI con `line-clamp-2` en vez de `truncate`
  ([kpi-card.tsx](components/ui/kpi-card.tsx)); el copy del tile de vencidas se
  acorta: "Su plazo comprometido ya venció" → "Plazo comprometido vencido".
- **I-13**: título/metadata/loading a "Inicio" + `DASHBOARD_ITEM.label`
  alineado ([nav-items.ts](components/layout/nav-items.ts#L41)).
- **I-14**: chip de tendencia `0%` neutro (sin flecha, gris); verde solo para
  `> 0`.
- **I-15**: `MaintenanceTrendChart` con su `ChartDataTable` (mes / completadas
  / programadas / costo).
- **I-16**: fuera la coletilla "El texto se filtra desde la búsqueda de la
  cabecera"; atajos + "Ordenar por" en una sola fila (desaparece la banda
  casi vacía de borde a borde); tooltips del ranking y de Inversión por Faena
  como un solo string ("Procesos: 100% · 1 de 1" — antes "1 de 1Procesos");
  pluralización "1 abierta en total".

## 10 · I-09 — Estética con datos escasos · ✔ cerrado (2026-08-06)

- Hecho: `barSize={22}` en Inversión por Faena (la barra única de ~150 px de
  grosor); los charts todo-en-cero ahora se ocultan (ítem 4), lo que elimina
  varios de los huecos observados.
- **Cierre con datos reales (2026-08-06, seed demo + gaps, tablero de vistas
  conmutadas):** las dos decisiones diferidas se tomaron mirando el render
  real (evidencia en `audit/screenshots/inicio-2026-08-05/i09-datos-reales/`):
  - **Degradar ≤2 datos: sí.** `ThresholdRankingChart` con 1-2 filas rinde un
    medidor compacto por fila (color de umbral + detalle) y
    `CompositionDonutChart` con 1-2 porciones rinde total + barra de
    composición apilada — la tarjeta deja de reservar ~200 px de plot para
    uno o dos números (Cobertura MIPER, Principales clientes, Gasto por
    módulo eran exactamente ese caso). Umbral fijado por test en
    `dashboard-charts.test.tsx`.
  - **Impar: ancho completo, no compactar.** Los rankings de faena que
    cerraban cada sección ("Cumplimiento PDTP por faena", "Inversión por
    faena") van en `xl:col-span-2 2xl:col-span-3`: un ranking de hasta 9
    faenas gana con barras y rótulos largos, y el hueco desaparece sin
    depender del conteo dinámico de charts ocultos.
  - Además `maxBarSize={48}` en los BarCharts verticales que no tenían tope
    (workload, accidentes, impacto material), como seguro para meses con
    1-2 categorías.

## Verificación

- `tsc --noEmit` limpio · `eslint` sin errores nuevos en lo tocado · `vitest`:
  77 tests del dashboard + 16 de formato + 33 de work-queue, todos verdes
  (incluye el test nuevo de `formatCLP` y el actualizado de la tarjeta PDTP).
- Re-captura visual post-fix (pipeline + pasada scrolleada en 1920/1366/390) —
  evidencia en `audit/screenshots/dashboard/` y
  `audit/screenshots/inicio-2026-08-05/post-fix/`. Confirmado en render:
  - Tile "Inversión **$0**" y lectura rápida "…concentra la mayor inversión:
    **$248.948**" (antes "—" en ambos).
  - La ranura de cumplimiento ahora la ocupa "Cumplimiento PDTP 50%" y la
    tarjeta del aside muestra "GLOBAL · 2 FAENAS · 50%" con barra, esperado y
    varianza (−50 pp).
  - TopBar "Inicio"; índice de dominios bajo la TopBar en 1920 y 1366, sin
    texto pisado.
  - Filas de la cola sin faena duplicada y sin desborde de la celda Acción; en
    390 px la fila se apila con el CTA visible.
  - "Por aprobar 3" (Adquisiciones) = "3 ítems esperan aprobación" (alerta).
  - Distribución por módulo monocroma; conclusiones "Sin diferencias: todos en
    100%." / "Un solo caso: …"; los charts SST todo-en-cero ya no rinden
    rejillas vacías (la página bajó de 6.875 px a 6.166 px de alto en 1920).

## Adenda: §6.2 aplicado

Los títulos de dominio subieron un escalón (`text-h3` → `text-h2`) para que el
nivel de navegación no compita con los títulos de sus propias tarjetas.

## Lo que queda (fuera de esta sesión)

1. **I-09 resto**: pasada estética contra staging con datos reales (degradar
   charts de ≤2 datos a `SummaryBar`, huecos del grid de charts en secciones
   con N impar). No se puede juzgar con fixtures de una faena.
2. **Recomendación §5 final**: agregar 1–2 tomas scrolleadas del dashboard al
   pipeline de capturas (`scripts/capture-all-routes.ts`) para que defectos
   como I-05/I-06/I-07 no vuelvan a ser invisibles. Es un cambio al pipeline,
   no a la página.
3. **§6.3 (sparklines del backlog)**: depende de acumular ~30 días de
   instantáneas de solicitudes/OC/CAPA; la infraestructura ya existe
   (`operational-metric-snapshots`), solo falta que pase el tiempo.
4. `/analitica` conserva su "Por aprobar" filtrado por período (semántica
   propia de esa pantalla con filtros explícitos); si molesta allá, es un
   cambio de esa página, no del Inicio.
