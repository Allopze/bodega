# Auditoría del dashboard de inicio: cobertura de plataforma y lectura de gerencia — 2026-07-31

**Pregunta auditada:** ¿el dashboard de inicio muestra indicadores y gráficos de *todo* lo
relativo a la plataforma, y puede gerencia entender su interfaz?

**Respuesta corta:** cubre **6 de ~19 dominios**, y la interfaz es legible pero está mal
priorizada para gerencia. El problema que se temía —un muro de filtros confusos— **no
existe**: hay 3 controles en toda la pantalla y ninguno reencuadra el tablero. El problema
real es el inverso.

**Alcance:** `app/(app)/dashboard/` (17 archivos) más los servicios que consume. Todo lo que
sigue está verificado contra el rol de gerencia real, `jefa_chome` ("Jefatura", global,
[system-rbac.ts:20](lib/auth/system-rbac.ts#L20)), con sus permisos declarados en
`modules/*/manifest.ts`.

**Relación con la auditoría previa.** [AUDITORIA_DASHBOARD_2026-07-30.md](AUDITORIA_DASHBOARD_2026-07-30.md)
cerró 25 hallazgos de **honestidad de datos, layout, marca y rendimiento**, y esos ejes están
correctos. Esta auditoría mira **cobertura funcional y prioridad de lectura**, que aquella no
cubrió. Dos hallazgos de abajo (G-04.4 y la aserción vacía de G-01) son regresiones o puntos
ciegos de esa remediación y se declaran como tales.

---

## 1. Cobertura: 6 de ~19 dominios

La plataforma tiene 240 tablas y 21 módulos registrados
([modules/registry.ts](modules/registry.ts)). El dashboard representa seis dominios.

| Dominio | Tablas | Hoy en el dashboard | Veredicto |
|---|---|---|---|
| Adquisiciones (solicitudes/aprobaciones/OC/recepción) | 16 | 4 tiles, Flujo del mes, Backlog comparado, 3 gráficos | **cubierto** — falta lead time y facturación |
| PDTP | 30 | `PdtpComplianceCard` (el mejor widget del tablero) | **cubierto** |
| Indicadores de accidentabilidad | 5 | 3 gráficos | **cubierto** |
| Combustibles | 39 | 1 gráfico (litros + cargas) | **débil** — sin costo, deuda vencida, TAE ni anomalías |
| Flota / mantenciones | 8 | 1 gráfico (completadas vs programadas) | **débil** — sin vencimientos de documentos, sin costo/km |
| Bodega / inventario | 6 | 1 alerta + 1 tile que nunca se renderiza (G-01) | **casi ausente** — 0 gráficos |
| Entregas / EPP | 6 | 1 alerta de brechas EPP | **casi ausente** |
| CAPA | 4 | 1 fila de texto en el aside | débil |
| Incidentes DS 44 / RE-20 | 14 | nada | **ausente** |
| Documentación SST | 10 | nada | **ausente** |
| Capacitación y competencias | 7 | nada | **ausente** |
| MIPER / riesgos + requisitos legales | 16 | nada | **ausente** |
| Evaluaciones SST de trabajador | 6 | nada | **ausente** |
| PPA | 3 | nada | **ausente** |
| Inspecciones | 6 | nada | ausente |
| Permisos de trabajo | 8 | nada | ausente |
| CPHS / gobernanza | 6 | nada | ausente |
| Emergencias, higiene, gestión del cambio, campañas | 22 | nada | ausente |
| Soporte | 1 | nada | menor |

### Lo importante: casi nada de esto requiere escribir queries

El dashboard calcula **dos métricas propias** (`pending_approvals`, `orders_pending_receipt` —
[dashboard-metrics.ts:26](lib/services/dashboard-metrics.ts#L26)). Trece funciones de
agregación **ya escritas y probadas** no tienen ningún consumidor en esta pantalla:

| Función | Archivo | Entrega |
|---|---|---|
| `getCapaDashboardCounts` | [prevention-capa.ts:641](lib/services/prevention-capa.ts#L641) | abiertas, vencidas, pendientes de verificación, no reconciliadas |
| `getIncidentDashboardCounts` | [prevention-incidents.ts:1318](lib/services/prevention-incidents.ts#L1318) | abiertos, notificaciones vencidas, fatales/graves, pendientes de investigación |
| `getDashboardCounters` | [prevention-documents/search.ts:104](lib/services/prevention-documents/search.ts#L104) | 8 estados, por vencer 7/15/30, pendientes de revisión, acuses pendientes |
| `getRiskDashboard` | [prevention-risk-legal.ts:794](lib/services/prevention-risk-legal.ts#L794) | matrices, `criticalBlockers`, cobertura de procesos y cargos |
| `getLegalDashboard` | [prevention-risk-legal.ts:839](lib/services/prevention-risk-legal.ts#L839) | cumplimiento legal y `gaps` |
| `getPdtpIntegralCompliance` | [pdtp/compliance.ts:395](lib/services/pdtp/compliance.ts#L395) | cumplimiento integral ponderado de 3 ejes |
| `getPpaStats` | [ppa-module/calculos.ts:166](lib/services/ppa-module/calculos.ts#L166) | detenidos, % desviaciones, tiempo medio de respuesta, top razones |
| `getDashboardStats` | [sst-module/dashboard.ts:5](lib/services/sst-module/dashboard.ts#L5) | habilitados/no habilitados, seguimientos pendientes |
| `getFuelControlOverview` | [fuel-control-overview.ts:42](lib/combustibles/fuel-control-overview.ts#L42) | facturado vs TAE, pendientes de revisión, sellos y evidencia faltantes |
| `getFleetOverview` | [fleet.ts:16](lib/services/fleet.ts#L16) | costo operacional por equipo, odómetro/horómetro |
| `getUsageMaintenanceAlerts` | [maintenance.ts:148](lib/services/maintenance.ts#L148) | mantenciones vencidas por uso |
| `listCompetencyGaps` | [prevention-training.ts:653](lib/services/prevention-training.ts#L653) | brechas de competencia por `enforcement` |
| `getAnalyticsDashboard` | [analytics-module/dashboard.ts:19](lib/services/analytics-module/dashboard.ts#L19) | gasto por mes/módulo, top proveedores, rotación, riesgo de stock, EPP |

Más `getStockAlerts` ([stock-alerts.ts:25](lib/services/stock-alerts.ts#L25)), del que el
dashboard sólo usa el contador de críticos y descarta el nivel `warning` y el `deficit`.

---

## 2. Lectura de gerencia: siete hallazgos

### G-01 · P0 — Las 4 tarjetas superiores son la misma dimensión, y dos métricas de negocio son código inalcanzable

`buildOperationalMetrics` ([page.tsx:362-391](app/(app)/dashboard/page.tsx#L362-L391)) arma 8
candidatos en orden fijo y corta con `.slice(0, 4)`. Para `jefa_chome` el resultado es
**siempre**:

> Tareas pendientes · Tareas críticas · Tareas vencidas · Por aprobar

Tres de las cuatro son el mismo eje. Y por posición en la lista:

- **"Inversión del mes"** (candidato 8) y **"Stock crítico"** (candidato 7) **no se renderizan
  para ningún rol.** El sparkline de stock que la auditoría anterior construyó, probó y
  documentó vive en una tarjeta que nunca se pinta.
- Para el rol restringido del e2e el corte deja `tasks, critical, overdue, receipts` — ya
  anotado en [dashboard.spec.ts:117-118](e2e/dashboard.spec.ts#L117-L118) como "Stock crítico
  queda cortado", pero registrado como detalle en vez de como el defecto que es.
- **Consecuencia:** la aserción [dashboard.spec.ts:107](e2e/dashboard.spec.ts#L107)
  (`"Inversión del mes"` ausente para el rol restringido) **pasa por el corte, no por el gate
  de permisos**. Es una aserción vacía: no puede fallar. Coincide con lo que la propia
  auditoría anterior reportó ("quitando el gate `canApprove`, **2 de los 3** fallan").

### G-02 · P0 — La misma cifra hasta cuatro veces en una pantalla

"Críticas" aparece en:

1. el saludo — `buildOperationalSummary` ([dashboard-control-center.tsx:503](app/(app)/dashboard/dashboard-control-center.tsx#L503))
2. el tile de KPI — `buildOperationalMetrics` ([page.tsx:381](app/(app)/dashboard/page.tsx#L381))
3. el chip de atajo — `buildQueueShortcuts` ([page.tsx:279](app/(app)/dashboard/page.tsx#L279))
4. la tarjeta de alerta — `buildOperationalAlerts` ([page.tsx:410](app/(app)/dashboard/page.tsx#L410))

"Vencidas" igual, cuatro veces. "Por aprobar" tres. "Sin responsable" y "Recepciones", dos.
De ~26 números en pantalla, ~10 son repeticiones de 6 cifras.

La auditoría anterior cerró L-04 declarando "prioridad con dos representaciones no
redundantes: el tile (estado) y el atajo (acceso)". **No contó el saludo ni la alerta del
aside**, que siguen ahí. `AGENTS.md` A5 es explícito: *"No repitas la misma cifra en dos
controles"*.

### G-03 · P1 — Los ocho gráficos son callejones sin salida

Ninguno de los 8 gráficos enlaza a su módulo. Verificado por búsqueda: en toda la carpeta
`app/(app)/dashboard/` la única referencia a otro módulo desde el bloque analítico son los
`id` de las secciones. En particular:

- **`/analitica`** —la pantalla que sí tiene el detalle filtrable, con 5 filtros en URL, 4
  KPIs, 4 gráficos y 7 tablas de ranking— **no está enlazada desde ningún punto del
  dashboard.**
- Tampoco `/prevencion/indicadores`, `/flota`, `/combustibles` ni `/mantenciones`.

Gerencia ve una tendencia, se pregunta por qué, y no tiene a dónde ir.

### G-04 · P1 — Poca variedad, y cuatro gráficos con defectos de lectura

**Variedad.** De 8 gráficos: 5 barras verticales agrupadas, 1 barra horizontal, 1 área, 1
línea. Sin dona, gauge, combo barra+línea, barra apilada 100% ni mapa de calor — **y todos
esos tipos ya existen en el repo**:

| Tipo | Ya implementado en |
|---|---|
| `PieChart` | [combustibles/fuel-charts.tsx:165](app/(app)/combustibles/fuel-charts.tsx#L165), [anomalias/anomaly-distribution-chart.tsx:124](app/(app)/combustibles/anomalias/anomaly-distribution-chart.tsx#L124) |
| `ComposedChart` | [material-environmental-charts.tsx:94](app/(app)/prevencion/indicadores-material-ambiental/material-environmental-charts.tsx#L94) |
| Barra horizontal con semáforo por umbral | [pdtp-dashboard-charts.tsx:40](app/(app)/prevencion/pdtp/pdtp-dashboard-charts.tsx#L40) |
| `ReferenceLine`, `ErrorBar` | [analisis/histogram-chart.tsx](app/(app)/combustibles/analisis/histogram-chart.tsx), [analisis/performance-charts.tsx](app/(app)/combustibles/analisis/performance-charts.tsx) |
| Heatmap (CSS puro, sin recharts) | [worksite-equipment-heatmap.tsx:29](app/(app)/combustibles/worksite-equipment-heatmap.tsx#L29) |
| `ScatterChart` + `ZAxis` | [combustibles/scatter-charts.tsx:24](app/(app)/combustibles/scatter-charts.tsx#L24) |
| Barra de progreso con marcadores esperado/meta | [pdtp-compliance-card.tsx:120-133](app/(app)/dashboard/pdtp-compliance-card.tsx#L120-L133) |

**Defectos concretos** (los cuatro primeros comparten causa: dos magnitudes de escala distinta
en un eje común):

1. **`FuelConsumptionChart`** ([dashboard-charts.tsx:396-397](app/(app)/dashboard/dashboard-charts.tsx#L396-L397))
   grafica **litros (miles) y cargas (decenas) en el mismo eje Y** → la serie "Cargas" queda
   pegada al piso, ilegible. Y `amount` —el costo, lo que le importa a gerencia— se consulta y
   se descarta ([FuelMonthlyChartPoint:373](app/(app)/dashboard/dashboard-charts.tsx#L373)).
2. **`SstTrendChart`** ([:241-242](app/(app)/dashboard/dashboard-charts.tsx#L241-L242)) pone
   tasa de frecuencia y tasa de gravedad en un eje común; la de gravedad es órdenes de
   magnitud mayor → la de frecuencia se aplana.
3. **`MaintenanceTrendChart`** ([:410](app/(app)/dashboard/dashboard-charts.tsx#L410)) también
   consulta `amount` y no lo dibuja.
4. **`WorksiteActivityChart`** ([:306](app/(app)/dashboard/dashboard-charts.tsx#L306)) vive
   bajo el rótulo de grupo **"Operación · Últimos 6 meses"**
   ([dashboard-analytics-section.tsx:101](app/(app)/dashboard/dashboard-analytics-section.tsx#L101))
   pero su subtítulo dice "acumulado histórico" y su query **no filtra por fecha**
   ([dashboard-metrics.ts:100-111](lib/services/dashboard-metrics.ts#L100-L111)). Es el
   hallazgo **L-07 reintroducido a nivel de grupo** por la propia remediación que lo cerró.
   Además es gris (`CHART_COLORS.neutral`) y mapea `requestsCount`/`pendingCount` que nunca
   dibuja ([:320-325](app/(app)/dashboard/dashboard-charts.tsx#L320-L325)).

**Y un error de dato, no de estética:**

5. **`SstAccidentChart`** ([dashboard-analytics.tsx:67-69](app/(app)/dashboard/dashboard-analytics.tsx#L67-L69))
   rotula "Acc. sin tiempo perdido" una serie que viene de `m.provisional.accidents`, mientras
   la otra viene de `m.confirmed.accidents`. **Mezcla dos estados de conciliación bajo un
   rótulo de gravedad.** Un accidente provisional no es un accidente sin tiempo perdido.

### G-05 · P1 — No hay alcance global, y el único selector de faena engaña

El select "Faena" ([dashboard-control-center.tsx:288](app/(app)/dashboard/dashboard-control-center.tsx#L288))
filtra **en el cliente las 12 filas cargadas** (`QUEUE_PREVIEW_LIMIT`). Lo ignoran:

- los 4 tiles de KPI
- las 9 alertas de "Requiere atención"
- la tarjeta PDTP
- "Flujo del mes" y "Backlog comparado"
- los 8 gráficos

La sección analítica **no tiene ningún control**: períodos fijos de 6 meses / año en curso, sin
selector de faena ni de año. Gerencia no puede pedir "faena X" ni "este trimestre".

Es el problema inverso al temido: **no sobran filtros, faltan los dos que importan.** Como
referencia, `/prevencion/indicadores` y `/prevencion/pdtp` sí tienen selector de faena y año, y
`/pendientes` tiene 9 filtros en URL.

### G-06 · P2 — Las acciones rápidas son solo de adquisiciones

[quick-actions.tsx:29-38](app/(app)/dashboard/quick-actions.tsx#L29-L38): 7 accesos, todos de
Adquisiciones/Bodega/Reportes. **Cero de prevención** —el módulo con 111 permisos y ~180
tablas— y ninguno a `/analitica`. Como el orden de la lista fija la jerarquía, para Jefatura la
acción primaria es "Nueva solicitud".

### G-07 · P2 — Tercera implementación de tile, tres paletas de gráfico

- El dashboard **no usa** [kpi-card.tsx](components/ui/kpi-card.tsx) —que sí usan `/analitica`,
  PDTP y combustibles— ni [summary-bar.tsx](components/ui/summary-bar.tsx). Tiene su propio
  `MetricCell` ([operational-metrics-strip.tsx:70](app/(app)/dashboard/operational-metrics-strip.tsx#L70)).
- Coexisten tres paletas sin relación: [chart-palette.ts](app/(app)/dashboard/chart-palette.ts)
  (7 colores), [analitica/analytics-charts.tsx:19-26](app/(app)/analitica/analytics-charts.tsx#L19-L26)
  (`COLORS[6]`), y tokens directos en prevención.
- Ningún gráfico del dashboard está envuelto en
  [ChartErrorBoundary](components/chart-error-boundary.tsx), que ya existe.

---

## 3. La tensión que hay que resolver a propósito

`PRODUCT.md` lista como anti-referencia: *"Dashboards genéricos con muros de KPI, tarjetas
repetidas y cifras sin acción"*. `AGENTS.md` fija **A1: máximo 4 tiles** y **A5: una dimensión
= una representación**. El pedido es cubrir todo con gráficos variados y vistosos.

No se resuelve subiendo el número de tarjetas. Se resuelve así:

> **Un dominio = una cifra titular + un gráfico que la explica + un enlace al módulo**, en
> secciones separadas y rotuladas.

Así se cubre todo sin que ninguna franja de la pantalla sea un muro, y **se elimina** la
repetición de G-02 en lugar de multiplicarla.

---

# Plan de acción

Decisiones tomadas con el usuario: **una página larga con índice** · **alcance global de faena
+ período** · **la fila superior con una cifra por dominio, elegida según el rol**.

> **Estado de implementación** — Fases 0 ✅ · 1 ✅ · 2 ✅ · 4 parcial ✅ · e2e 16/16 ✅.
> Pendientes: **Fase 3** (secciones por dominio) y la **pasada visual**.
> El registro de lo ejecutado está en [§Registro de implementación](#registro-de-implementación)
> al final del documento.

## Fase 0 — Corregir lo roto antes de agregar nada · ~0.5 día

Todo bug, no feature. Va primero para no construir sobre datos que engañan.

| # | Qué | Dónde |
|---|---|---|
| 0.1 | `SstAccidentChart`: ambas series desde `m.confirmed`. Si "sin tiempo perdido" no existe en `confirmed`, pasa a una serie y lo declara — **no se rellena con otra población** | [dashboard-analytics.tsx:64-70](app/(app)/dashboard/dashboard-analytics.tsx#L64-L70) |
| 0.2 | `WorksiteActivityChart`: filtrar por el período del grupo (la Fase 1 lo resuelve de raíz); quitar los campos mapeados que no se dibujan; relleno `brand` en vez de gris | [dashboard-charts.tsx:306-366](app/(app)/dashboard/dashboard-charts.tsx#L306-L366), [dashboard-metrics.ts:100](lib/services/dashboard-metrics.ts#L100) |
| 0.3 | `FuelConsumptionChart` → **combo**: litros en barra (eje izq.) + `amount` en línea (eje der.). "Cargas" sale del eje compartido y pasa al tooltip | [dashboard-charts.tsx:377-402](app/(app)/dashboard/dashboard-charts.tsx#L377-L402) |
| 0.4 | `SstTrendChart`: segundo `YAxis` (`yAxisId`) para tasa de gravedad | [dashboard-charts.tsx:224-249](app/(app)/dashboard/dashboard-charts.tsx#L224-L249) |
| 0.5 | `MaintenanceTrendChart`: `amount` como línea en eje derecho | [dashboard-charts.tsx:413-438](app/(app)/dashboard/dashboard-charts.tsx#L413-L438) |
| 0.6 | La aserción vacía queda válida sola al cerrar G-01 (Fase 2); verificar con control positivo | [dashboard.spec.ts:107](e2e/dashboard.spec.ts#L107) |

## Fase 1 — Alcance global: faena + período, en la URL · ~1 día

Dos controles en la cabecera que reencuadran **todo** el tablero. Son los únicos filtros de la
pantalla.

- **`searchParams`** en `page.tsx`: `?faena=<id|all>&periodo=<mes|trimestre|anio>`. Es la única
  forma de que un Server Component reconsulte, y **resuelve** el problema de pérdida de estado
  en `router.refresh()` en vez de sufrirlo: con el estado en la URL, el refresh de
  `WorkAssignmentControl` ya no lo borra.

  > **Matiz frente a la decisión F-06** ([dashboard-control-center.tsx:112-118](app/(app)/dashboard/dashboard-control-center.tsx#L112-L118)):
  > a la URL va el **alcance del servidor**. El **orden de la cola** sigue en `sessionStorage`
  > — es preferencia de UI, no alcance de datos. Precedente en el repo:
  > `/prevencion/indicadores` pone el año en la URL y la faena en estado local;
  > `/prevencion/pdtp` pone ambos en la URL.

- **Período**: reusar [segmented-control.tsx](components/ui/segmented-control.tsx) con
  `variant="pills"` — ya renderiza `Link` con `href`, así que es navegación de servidor sin
  una línea de cliente.
- **Faena**: [worksite-select.tsx](components/ui/worksite-select.tsx) envuelto en un cliente de
  ~10 líneas que hace `router.replace`. Las opciones ya vienen en
  `queue.filterOptions.worksites`. Respetar `resolveWorksiteScope`: un rol de faena única no ve
  el selector.
- **Propagar** el alcance a `getDashboardData`, `getOperationalWorkQueue`,
  `getOperationalPeriodMetrics`, `getOperationalBacklogComparisons`,
  `loadPdtpComplianceSummary` y a las 5 queries de `dashboard-analytics.tsx`. Varias ya aceptan
  `scope`/`worksiteIds`; `scopeToWorksiteIds` ([dashboard-helpers.ts](app/(app)/dashboard/dashboard-helpers.ts))
  es el puente.
- **Eliminar** el select "Faena" de la cola y el botón "Quitar filtro de faena": el global lo
  subsume, la cola queda consultada por faena en el servidor y desaparece la ambigüedad "12 de
  N". **La pantalla queda con 2 controles, no 3.**
- Cada bloque declara el alcance al que responde. Donde una serie **no** pueda respetarlo —
  `getOperationalSnapshotHistory` exige cobertura completa de faenas por día — decirlo en la
  copia en vez de dibujar una serie que no corresponde al filtro.

## Fase 2 — Fila superior: una cifra por dominio, según el rol · ~0.5 día

Reemplazar el `.slice(0, 4)` sobre orden fijo por **selección por ranura**: cuatro ranuras con
dueño semántico, cada una con su cascada de candidatos por permiso.

| Ranura | Para Jefatura | Cascada si no hay permiso |
|---|---|---|
| **Dinero** | Inversión del período (`periodMetrics.spend`, con su variación) | OC activas → *ranura cedida* |
| **Cumplimiento** | Cumplimiento PDTP % vs meta | % cumplimiento legal → Documentos vencidos |
| **Riesgo** | Incidentes abiertos (destacando fatales/graves) | CAPA vencidas → Stock crítico |
| **Mi trabajo** | Tareas vencidas | Tareas pendientes |

- Se mantiene A1 (4 tiles) y se mantiene `MetricCell`: funciona, tiene el sparkline, y
  cambiarlo por `KpiCard` es una regresión visual sin beneficio. `KpiCard` se reusa en las
  secciones nuevas de la Fase 3.
- **Cierra G-02.** Al salir "Tareas pendientes/críticas" de la fila superior cada cifra queda
  con una sola representación. Además: quitar del saludo los fragmentos de críticas y vencidas
  ([:502-506](app/(app)/dashboard/dashboard-control-center.tsx#L502-L506)) y **quitar de
  "Requiere atención" las alertas que ya son un tile**. Regla nueva: *una cifra no puede ser
  tile y alerta a la vez*.
- El e2e de gating se reescribe contra las ranuras, no contra las 4 primeras de una lista.

## Fase 3 — Secciones por dominio con índice · ~2 días

Debajo del Centro de Control, cinco secciones ancladas. Cada una: **fila de KPIs compactos
(`KpiCard`) + 1–2 gráficos + enlace "Ver detalle" a su módulo** — esto cierra G-03.

**Índice.** Reusar `SegmentedControl variant="pills"` con las cinco anclas: rail lateral sticky
desde `2xl` (≥1536px), barra sticky horizontal debajo, mismo componente con clases
responsivas. *Por qué no lateral siempre:* a 1280px el sidebar ya se lleva 256px (medido por el
e2e de la auditoría anterior) y un rail de 180px más deja los gráficos bajo 420px de ancho.

| Sección | KPIs (de funciones existentes) | Gráficos | Enlaces |
|---|---|---|---|
| **Adquisiciones** | Inversión del período · OC activas · Solicitudes activas · Tasa de rechazo en recepción *(nueva, trivial)* | Combo monto + nº OC por mes · Dona de gasto por módulo (`getAnalyticsDashboard.spendByModule`) · Barra horizontal inversión por faena (Fase 0) | `/compras`, `/analitica` |
| **Bodega y entregas** | Stock crítico · Stock en alerta (`getStockAlerts` ya trae `warning`) · Entregas del período · Brechas EPP bloqueantes | Barra horizontal top productos bajo mínimo con déficit y **semáforo por umbral** · Entregas de EPP por mes | `/bodega`, `/entregas` |
| **Prevención y SST** | Cumplimiento PDTP vs meta · Incidentes abiertos · CAPA vencidas · % cumplimiento legal | `PdtpComplianceCard` (se muda acá desde el aside) · Tasas con eje doble (Fase 0) · Accidentes (Fase 0) · **Barra horizontal semáforo de cumplimiento PDTP por faena** | `/prevencion/pdtp`, `/prevencion/incidentes`, `/prevencion/indicadores` |
| **Flota y combustible** | Costo del período · Deuda vencida de cuenta corriente *(nueva)* · Documentos por vencer a 30 días *(nueva)* · Anomalías abiertas | Combo litros + costo (Fase 0) · Mantenciones vs programadas + costo (Fase 0) · Brecha TAE vs facturado (`getFuelControlOverview` ya la calcula) | `/combustibles`, `/flota`, `/mantenciones` |
| **Cumplimiento y gobernanza** | Documentos por vencer 7/15/30 y acuses pendientes · Competencias por vencer y brechas · % desviaciones PPA · Trabajadores habilitados | Dona de estados documentales · **Barra apilada 100%** de estados PPA o evaluaciones SST | `/prevencion/documentacion`, `/prevencion/capacitacion`, `/prevencion/ppa` |

### Decisiones cerradas con el usuario (2026-07-31)

**1. `getAnalyticsDashboard` se reusa entera y se muestra más de lo que devuelve.** Su firma
—`(session, { fromDate, toDate, worksiteId })`— encaja exacto con el alcance global: las fechas
salen de `getOperationalCalendarBounds(now, scope.period)` y la faena de `scopedWorksiteId`.
Corre ~20 consultas, así que si se paga se aprovecha: además de la dona de gasto por módulo y
las entregas de EPP, **se surfacea lo que ya calcula y hoy nadie lee** — `topSuppliers`,
`productRotation`, `stockRisks` y `vehicleCosts`. Mismo costo, cuatro visualizaciones más de
cobertura. Va detrás de su propio `Suspense`, bajo el pliegue.

> Descartado: extraer dos consultas sueltas. Habría duplicado los predicados de fecha y faena
> que esa función ya resuelve, con el riesgo de que diverjan.

**2. El orden de las secciones lo decide el perfil de permisos, no un slug de rol.** Gerencia
quiere el gasto primero, pero no todos los roles deben ver lo mismo primero. Mismo mecanismo
que las ranuras de la fila superior:

| Perfil | Orden |
|---|---|
| Con `purchasing:view` (Jefatura, Administrador) | Adquisiciones → Flota y combustible → Prevención → Bodega → Gobernanza |
| Sin dinero pero con prevención | Prevención → Gobernanza → Bodega → Adquisiciones → Flota |
| Resto | Adquisiciones → Bodega → el que su permiso autorice |

Esto ordena, **no** decide visibilidad: la sección ya desaparece completa si el rol no ve nada
de ese dominio. El índice lista sólo las secciones presentes, en el mismo orden.

**3. De G-07 entran ahora la paleta única y `ChartErrorBoundary`; `MetricCell` no.** Las dos
primeras son requisito de esta fase —van a nacer ~7 gráficos nuevos y hacerlo después es
tocarlos dos veces—. Migrar `MetricCell` a `KpiCard` queda como **deuda anotada**: funciona,
tiene el sparkline, y cambiarlo es una regresión visual sin beneficio sobre una fila que la
Fase 2 recién rehizo.

**Reglas de esta fase:**

- **Sólo tres consultas nuevas** (tasa de rechazo, deuda vencida, documentos por vencer), y las
  tres son un `count`/`sum` con `where` sobre campos que ya existen
  (`receipt_items.quantityRejected`, `fuel_monthly_statements.status='overdue'`,
  `fleet_vehicle_documents.expiresAt`). Todo lo demás consume funciones ya probadas.
- **La sección analítica actual se disuelve** en las nuevas: los 8 gráficos de
  `DashboardAnalyticsSection` se reparten entre Adquisiciones, Prevención y Flota. No quedan
  cinco secciones *más* el bloque viejo.
- **`lib/chart-palette.ts`**: `app/(app)/dashboard/chart-palette.ts` se mueve ahí y lo consumen
  también `/analitica` y las secciones nuevas. Las tres paletas quedan en una.
- Cada sección respeta permisos y **desaparece completa** si el rol no ve nada de ese dominio
  (patrón ya usado en [dashboard-analytics-section.tsx:94](app/(app)/dashboard/dashboard-analytics-section.tsx#L94)).
  El índice sólo lista las secciones presentes.
- Cada sección con su propio `Suspense`: el Centro de Control no espera a ninguna (P-02).
- **Los gráficos siguen tras `next/dynamic`.** Prohibido importar `dashboard-charts.tsx`
  estáticamente desde algo del árbol inicial: eso ya metió recharts en el chunk inicial una vez
  (1281 kB → 816 kB al arreglarlo).
- Envolver cada gráfico en `ChartErrorBoundary`: con ~15 gráficos, uno que reviente no puede
  tumbar la página.
- El aside pierde la tarjeta PDTP y "Backlog comparado" (se van a sus secciones). Queda con
  "Requiere atención" y "Flujo del mes".

## Fase 4 — Que se vean bien y consistentes · ~0.5 día

- **Una sola paleta.** `chart-palette.ts` pasa a `lib/chart-palette.ts` y la consumen también
  `/analitica` y las secciones nuevas. Las tres paletas actuales se reducen a una.
- **Tipos nuevos, todos con precedente en el repo** (ver tabla de G-04): dona para composición,
  combo barra+línea para magnitud + dinero, apilada 100% para estados, barra horizontal con
  semáforo por umbral para cumplimiento por faena, y la barra con marcadores de esperado/meta
  de `PdtpComplianceCard` como patrón de cualquier "% vs meta". Cargar el skill `dataviz` y
  `DESIGN.md` antes del primer gráfico.
- **Registrar en `AGENTS.md` la regla que falta**: *un gráfico = una unidad por eje*; dos
  magnitudes de escala distinta exigen eje doble o dos tarjetas. Es la causa raíz de cuatro de
  los cinco defectos de G-04.
- **G-06**: añadir a `quick-actions.tsx` un acceso a `/analitica` (`analytics:view`) y uno de
  prevención, y ordenar la lista para que la acción primaria de un rol global no sea "Nueva
  solicitud".

## Fase 5 — Verificación

- `tsc` y `eslint` limpios; `vitest` con casos nuevos para la **selección por ranura** (fixtures
  de `jefa_chome`, `prevencionista_faena`, `solicitante_faena`) y para las tres agregaciones
  nuevas.
- **Controles, no sólo verde** (método de la auditoría anterior): quitar el gate de una ranura
  debe hacer fallar su test; borrar una métrica de una agregación nueva debe hacer fallar la
  suya. Si no falla, el test no prueba nada.
- `e2e/dashboard.spec.ts` amplía: el alcance global reencuadra (una cifra cambia al elegir
  faena), el índice navega a cada ancla, cada sección declara su período, sin scroll horizontal
  a 1440px **y 390px**, un solo `<h1>`, gating por rol contra las ranuras.
- **Bundle**: leer `.next/server/app/(app)/dashboard/page_client-reference-manifest.js` y
  confirmar **0 chunks con recharts en el árbol inicial**. Es la trampa que ya volvió una vez.
- **Pasada visual** a 1440px y 390px con `jefa_chome` y con `scoped@e2e.chome.cl`
  (`npm run screenshots`, `CAPTURE_OUTPUT_DIR`). Tres de los hallazgos de la auditoría anterior
  sólo se vieron mirando la pantalla.
- **Prueba de los 5 segundos con lectura de gerencia**: dinero, cumplimiento, riesgo y trabajo
  visibles sin scrollear; ninguna cifra repetida en la misma franja.

## Orden y peso

`Fase 0` → `Fase 1` → `Fase 2` → `Fase 3` → `Fase 4` → `Fase 5`. **~4.5 días.**

Las fases 0–2 arreglan la lectura de gerencia con **diff pequeño** y son entregables por sí
solas. La Fase 3 es la que aporta la cobertura y la única grande; puede fraccionarse por
sección si conviene cortar antes.

---

## Fuera de alcance, anotado

- [prevencion/indicadores/indicadores-dashboard.tsx](app/(app)/prevencion/indicadores/indicadores-dashboard.tsx)
  + [indicadores-charts.tsx](app/(app)/prevencion/indicadores/indicadores-charts.tsx) =
  **378 líneas de código muerto** (5 gráficos, 6 `KpiCard`) que nada renderiza;
  [page.tsx:45](app/(app)/prevencion/indicadores/page.tsx#L45) monta
  `CanonicalIndicatorsDashboard`. Y `indicadores-dashboard.test.tsx` en realidad testea el
  canónico. Borrado limpio, pero es otra pantalla.
- `/analitica` declara `xl:grid-cols-5` con 4 hijos ([analitica/page.tsx:88](app/(app)/analitica/page.tsx#L88)).
- `getWorkQueueSnapshot` ([dashboard-snapshot.ts](lib/services/dashboard-snapshot.ts), 234
  líneas) está en el barrel `dashboard.ts` sin consumidor en el dashboard.
- Sólo 2 de 14 archivos con recharts usan el wrapper [components/ui/chart.tsx](components/ui/chart.tsx);
  los otros 12 duplican `ResponsiveContainer` + `tooltipStyle()`.
- Monitoreo de los 12 crons: si `operational-metric-snapshots` se detiene, las series se
  acortan **en silencio** (sólo hay `logger.error`). Ya descartado como problema de plataforma,
  no de esta pantalla.

---

# Registro de implementación

## Fase 0 — Corregir lo roto · ✅ 2026-07-31

### 0.1 · `SstAccidentChart` ya no miente sobre gravedad

Al ir a arreglarlo apareció que el defecto era **peor de lo auditado**. `confirmed` son los
casos con `inclusionStatus === "included"` y `provisional` es `[...confirmados, ...pendientes]`
([safety-indicators-calc.ts:217-219](lib/prevention/safety-indicators-calc.ts#L217-L219)): no
son dos clases de gravedad, es un **superconjunto**. El gráfico dibujaba la barra chica
*contenida dentro* de la grande como si fueran categorías excluyentes.

Y `IndicatorMetricSet` ([:105-113](lib/prevention/safety-indicators-calc.ts#L105-L113)) **no
tiene desglose de tiempo perdido**: el dato existe a nivel de caso
(`absenceAtLeastNormalShift`) pero el motor canónico no lo agrega. O sea que la pregunta que el
rótulo prometía —CTP vs STP— **no se puede responder con esta fuente**.

Decisión: el gráfico deja de prometerlo y grafica la partición que sí es real y sí le sirve a
gerencia — **"Accidentes por estado de calificación"**, barra **apilada** con `confirmados` +
`porCalificar`, donde el tope de la columna es el total provisional. `stackId` compartido
porque son partes de un total, no magnitudes a comparar. El subtítulo cambia solo cuando no hay
pendientes ("Todos los accidentes del período están confirmados").

La derivación se extrajo a `toSstMonthlyPoints` —función pura y exportada— porque era la única
lógica de la sección y necesitaba un test.

### 0.2 · `WorksiteActivityChart`: período honesto y dos queries muertas menos

- **Período**: el gráfico sale del grupo "Operación · Últimos 6 meses" a su propio bloque
  **"Inversión · Acumulado histórico"**. Su query no filtra por fecha, así que el rótulo del
  grupo era falso (L-07 reintroducido a nivel de grupo por la remediación que lo cerró). Cuando
  la Fase 1 le dé un período real, vuelve a Operación.
- **Campos muertos**: la firma pasa de las 6 columnas de `worksitesBreakdown` a
  `{ name, totalCost }[]` — lo único que dibuja.
- **Hallazgo nuevo al tirar del hilo:** `pendingCount` y `approvedCount` **no los leía nadie**
  en todo el repo, y se calculaban con **dos queries de agregación completas** (una con `join`
  contra `purchase_request_items`) dentro del `Promise.all` que **bloquea el Centro de
  Control**. Borradas: la query, los mapas y los campos. `getDashboardData` pasa de 3 a 1
  consulta de detalle por faena. `requestsCount` se queda porque decide el filtro de
  `worksitesBreakdown`.
- **Color**: `CHART_COLORS.neutral` (gris pizarra) → `brand`. El gris estaba reservado para
  acumulados de referencia, pero acá es la única serie de la tarjeta.

### 0.3 · `FuelConsumptionChart` pasa a combo

`ComposedChart`: litros en barra (eje izquierdo) + **costo** en línea (eje derecho, con
`compactCLPTick`). Antes litros (miles) y cargas (decenas) competían en un eje común y la serie
"Cargas" quedaba pegada al piso; el `amount` se consultaba y se descartaba. Las cargas siguen en
el tooltip, donde una cifra de apoyo no compite por escala.

### 0.4 · `SstTrendChart` con eje por tasa

`yAxisId` separado para TF y TG. Comparten el rótulo "× 1.000.000 / HH" pero no la escala: TG
cuenta **días** perdidos y de cargo, TF cuenta **personas** lesionadas
([:187-188](lib/prevention/safety-indicators-calc.ts#L187-L188)). Un accidente con 30 días de
reposo mueve TG dos órdenes de magnitud más que TF.

### 0.5 · `MaintenanceTrendChart` con su costo

`ComposedChart`: conteos en barras (eje izquierdo) + `amount` en línea (eje derecho). Ya se
calculaba y se descartaba.

### Efecto colateral: los guards de sección

`hasFuelData` y `hasMaintenanceData` seguían mirando `loads` y omitiendo `amount`. Con el
criterio viejo, un mes con costo y sin cargas dejaba la sección reservando el hueco mientras el
gráfico devolvía `null` dentro — tarjeta vacía. Ahora el guard de la sección y el del gráfico
usan el mismo criterio.

### Verificación de esta fase

- `tsc --noEmit` y `eslint` limpios.
- `vitest` — **43/43** en 7 archivos, incluido el nuevo
  [dashboard-analytics.test.ts](app/(app)/dashboard/dashboard-analytics.test.ts) (5 casos sobre
  `toSstMonthlyPoints`).
- **Control negativo del test nuevo:** reintroduciendo el bug original
  (`porCalificar: m.provisional.accidents`) **fallan 3 de 5**. Un test que pasa con el bug
  puesto no prueba nada.
- **Control negativo de la query que quedó:** forzando `totalCost: 0` en `getDashboardData`
  **falla 1 de 16** en `dashboard-service.test.ts` — la única consulta de detalle que sobrevivió
  sigue cubierta.

### Deuda que esta fase deja anotada

- Los cambios de eje y de tipo de gráfico **no tienen test**: un test que afirme `yAxisId`
  estaría probando internos de recharts. Quedan cubiertos por la pasada visual de la Fase 5,
  que es donde de verdad se ven.
- `WorksiteActivityChart` sigue ordenando y cortando en cliente datos que
  `getDashboardData` ya devuelve ordenados por `totalCost`. El `slice(0, 6)` sí es del cliente;
  el `sort` es redundante.

---

## Fase 1 — Alcance global de faena y período · ✅ 2026-07-31

### Lo que se construyó

**[dashboard-scope.ts](app/(app)/dashboard/dashboard-scope.ts)** — el alcance vive en
`?faena=<id|all>&periodo=<mes|trimestre|anio>`, con `parseDashboardScope`,
`intersectWorksiteScope`, `dashboardScopeHref` y los rótulos derivados.

**[dashboard-scope-controls.tsx](app/(app)/dashboard/dashboard-scope-controls.tsx)** — dos
controles en la cabecera. El período reusa `SegmentedControl` (ya renderiza `Link`, así que
navega **sin una línea de cliente**); la faena envuelve `WorksiteSelect` en ~10 líneas con
`router.replace` — `replace` y no `push` para no llenar el historial al comparar faenas.

**La pantalla bajó de 3 controles a 2.** El select de faena de la cola y el botón "Quitar
filtro de faena" se fueron: el global los subsume y la cola ahora llega **consultada** por
faena desde el servidor, así que desaparece la ambigüedad de "12 de N".

### La decisión de fondo: URL vs. sessionStorage

Frente a F-06 (que puso los filtros en `sessionStorage` "nunca en la URL"), acá se separan dos
cosas que antes iban juntas:

| Estado | Dónde | Por qué |
|---|---|---|
| Alcance (faena, período) | **URL** | Reconsulta el servidor. Un RSC no tiene otra forma. Y con el valor en la URL, el `router.refresh()` de `WorkAssignmentControl` **ya no lo borra** — resuelve el problema de F-06 en vez de sufrirlo. |
| Orden de la cola | `sessionStorage` | Preferencia de UI aplicada en cliente sobre filas ya cargadas. En la URL ensuciaría la raíz sin necesidad. |

Precedente en el repo: `/prevencion/pdtp` pone año y faena en la URL; `/prevencion/indicadores`
pone el año.

### Root cause encontrado al propagar: cuatro copias del mismo predicado

Agregar "filtrar por faena" exigía tocar `scopeFilter` en `operational-period-metrics.ts`, otro
igual en `operational-trend-history.ts`, y `fuelScope`/`maintenanceScope`/`vehicleScope` en
`dashboard-fleet-maintenance.ts` — **cinco copias** que sólo diferían en la columna. Y ya
existía [`worksiteScopeSql`](lib/auth/scope.ts) haciendo exactamente eso, con **104
llamadores**.

El parámetro se agregó **una vez**, en el helper compartido, y las cinco copias se borraron.
`getDashboardData` además tenía `requestWorksiteFilter` e `itemWorksiteFilter` byte-idénticos:
ahora es uno.

> **Regla de seguridad, fijada en un solo lugar:** `worksiteId` **se intersecta** con el
> alcance del rol, nunca lo reemplaza. Una faena fuera del permiso devuelve el mismo predicado
> que no tener acceso (cero filas), no las filas de esa faena. Con 104 llamadores, la regla se
> prueba en `worksite-scope.test.ts` y no en cada uno.

### Bug de LEFT JOIN que el alcance por faena iba a amplificar

`getDashboardData` filtraba `purchase_requests.worksiteId` en el **`WHERE`** de un `LEFT JOIN`,
lo que lo degrada a `INNER` y borra las faenas sin solicitudes. Con una sola faena elegida, eso
hacía **desaparecer la fila entera — y con ella su inversión —** justo cuando la faena todavía
no tenía ninguna solicitud. El predicado se movió al `ON`.

### Faenas seleccionables: `listVisibleWorksites`, no `filterOptions`

El selector se alimenta de `listVisibleWorksites(roleScope)` y no de
`queue.filterOptions.worksites`, porque esas últimas son sólo las faenas **con trabajo
pendiente** — una faena sin tareas no habría sido seleccionable, y es justo la que gerencia
querría abrir para ver su inversión o su cumplimiento.

### Detalles que sólo aparecen al conectar todo

- **`Suspense key={alcance}`**: sin ella, cambiar de faena reusaba el árbol suspendido y la
  sección analítica mostraba los datos de la faena anterior mientras las consultas nuevas
  resolvían.
- **Los enlaces arrastran la faena.** `pendientesHref` agrega `worksiteId` a los atajos, tiles,
  alertas y filas de backlog. Sin eso, salir del dashboard con una faena elegida aterrizaba en
  `/pendientes` sin filtro: el conteo del atajo y la lista de destino hablaban de poblaciones
  distintas.
- **Los rótulos siguen al período.** `periodComparison` decía "vs. mes anterior" escrito a mano
  y el título del aside "Flujo del mes"; con trimestre elegido ambos habrían mentido. Ahora
  salen de `periodComparisonLabel` y `periodFlowTitle`.
- **El `contextLabel`** describía la faena principal del usuario incluso mostrando todas — con
  un selector arriba habría sido una contradicción visible. Ahora declara el alcance elegido.
- **Las instantáneas también se acotan.** Acotar `visibleActiveWorksiteIds` a una faena **no
  debilita** la regla de cobertura completa: la vuelve "esa faena tiene instantánea ese día",
  más fácil de satisfacer que "todas la tienen".

### Verificación

- `tsc`, `eslint` y **`next build`** limpios (el build valida el contrato de `searchParams`, que
  `tsc` solo no revisa).
- `vitest` — 78/78 en los 9 archivos del dashboard; **3191/3191 en todo el proyecto**.
- Nuevos: [dashboard-scope.test.ts](app/(app)/dashboard/dashboard-scope.test.ts) (15 casos) y
  6 casos de período (trimestre, cruce de año, hora de Chile) en
  `operational-period-metrics.test.ts`, más 5 casos de intersección en `worksite-scope.test.ts`.
- **Controles negativos (3):** romper la intersección de alcance en `dashboard-scope.ts` → cae
  1; romperla en `worksiteScopeSql` → cae 1; cambiar el trimestre calendario por "últimos 3
  meses" → caen 2.
- **Bundle:** `page_client-reference-manifest.js` referencia 20 chunks y **0 con recharts**
  (el único hit es un `.css`). La optimización de UIUX-002 sigue en pie.

---

## Fase 2 — Fila superior por ranura semántica · ✅ 2026-07-31

`buildOperationalMetrics` pasa de "8 candidatos en orden fijo cortados con `.slice(0, 4)`" a
**cuatro ranuras con dueño semántico**, cada una con su cascada por permiso.

Para Jefatura el resultado medido cambia de:

```
Tareas pendientes · Tareas críticas · Tareas vencidas · Por aprobar   ← 3 del mismo eje
```

a:

```
Inversión del período · Cumplimiento PDTP · Incidentes abiertos · Tareas vencidas
```

- **Dinero**: inversión del período → OC activas → *ranura cedida*
- **Cumplimiento**: PDTP % vs meta → Por recibir
- **Riesgo**: incidentes abiertos (destacando fatales/graves) → CAPA vencidas → stock crítico
- **Mi trabajo**: tareas vencidas → por aprobar → tareas pendientes

Si ninguna candidata califica, **la ranura se cede**: la fila queda con menos de cuatro tiles en
vez de rellenarse con otro contador de tareas. Un `solicitante_faena` ve una sola.

Se consumen dos de las trece funciones que estaban sin lector: `getCapaDashboardCounts` y
`getIncidentDashboardCounts`. Ambas hacen `requirePermission` adentro, así que el gate va afuera
del `Promise.all` y no en un `catch`.

### G-02 cerrado: la misma cifra, una sola vez

- **El saludo** declara sólo el total. Enumeraba total + críticas + vencidas + entregas, y esas
  tres ya vivían en su chip de atajo y en su tarjeta de alerta: "críticas" aparecía **cuatro
  veces** en la misma pantalla contando el tile.
- **Las alertas del aside** reciben `shownAsTile` con las claves que la fila superior ocupó y
  las saltan. Regla nueva: *una cifra no puede ser tile y alerta a la vez*.

### Efecto colateral: la aserción e2e vacía deja de serlo

`e2e/dashboard.spec.ts:107` afirmaba que el rol restringido no ve "Inversión del mes", pero
pasaba **por el corte, no por el gate**: el tile no se renderizaba para nadie. Ahora el tile sí
existe para quien tiene `purchasing:view`, así que la aserción por fin depende del permiso.

### Verificación

- `tsc` y `eslint` limpios; `vitest` 3191/3191.
- Nuevo [dashboard-metrics-slots.test.ts](app/(app)/dashboard/dashboard-metrics-slots.test.ts):
  12 casos con fixtures de Jefatura, `prevencionista_faena` y `solicitante_faena`.
- **Control negativo:** restaurando el `.slice(0, 4)` sobre la lista aplanada, **fallan 8 de
  los 12**.

---

## Fase 4 (parcial) — G-06 y las reglas de diseño · ✅ 2026-07-31

Se adelantaron las dos piezas de la Fase 4 que no dependen de la Fase 3.

**G-06 cerrado.** [quick-actions.tsx](app/(app)/dashboard/quick-actions.tsx) gana dos accesos
que faltaban —`/analitica` (`analytics:view`) y `/prevencion` (`prevention:pdtp:view`)— y
reordena la lista: "Revisar aprobaciones" pasa a primera y "Nueva solicitud" a segunda. Como el
orden **es** la jerarquía, la acción primaria de Jefatura era "Nueva solicitud"; crear una
solicitud no es trabajo de jefatura, decidir sobre ellas sí. Quien no puede aprobar no tiene el
permiso, así que para un solicitante la primaria sigue siendo la suya.

**Reglas de diseño registradas.** `AGENTS.md` gana **A5b — un gráfico = una unidad por eje**,
con su corolario *"si consultas un campo, dibújalo o no lo consultes"*. Es la causa raíz de
cuatro de los cinco defectos de G-04. `DESIGN.md` refleja A5b y el corolario de A5 (una cifra no
puede ser tile **y** alerta).

Queda pendiente de la Fase 4 lo que depende de las secciones nuevas: unificar las tres paletas
en `lib/chart-palette.ts` y los tipos de gráfico nuevos (dona, apilada 100%, semáforo por
umbral).

---

# Estado final y trabajo pendiente

## Cerrado

| Hallazgo | Estado |
|---|---|
| **G-01** · fila superior de una sola dimensión, tiles inalcanzables | ✅ Fase 2 |
| **G-02** · la misma cifra hasta 4 veces | ✅ Fase 2 |
| **G-04** · defectos de lectura de los gráficos (5 de 5) | ✅ Fase 0 |
| **G-05** · sin alcance global | ✅ Fase 1 |
| **G-06** · accesos rápidos sólo de adquisiciones | ✅ Fase 4 parcial |
| Reglas A5b / corolario A5 en `AGENTS.md` y `DESIGN.md` | ✅ Fase 4 parcial |

Hallazgos nuevos encontrados **durante** la implementación y también cerrados:

- `pendingCount` y `approvedCount`: dos queries de agregación sin ningún lector, en el
  `Promise.all` que bloquea el Centro de Control.
- `SstAccidentChart` era peor que lo auditado: `provisional` es un **superconjunto** de
  `confirmed`, no otra clase de gravedad.
- Bug de `LEFT JOIN` en `getDashboardData` que el alcance por faena iba a amplificar.
- Cinco copias del mismo predicado de faena, con `worksiteScopeSql` ya existiendo.
- `hasFuelData` / `hasMaintenanceData` con criterio distinto al guard de su gráfico.

## Pendiente

**Fase 3 — las cinco secciones por dominio (lo que cierra G-03 y la cobertura).** Es la fase
grande y la única que no se empezó. Sigue vigente tal como está especificada arriba, con dos
notas que la implementación de las Fases 1–2 deja más fáciles:

- El alcance global ya está construido y propagado: cada sección nueva recibe `scope` y
  `worksiteScope` sin trabajo extra.
- Dos de las trece funciones sin lector ya se consumen (`getCapaDashboardCounts`,
  `getIncidentDashboardCounts`), así que la sección de Prevención parte con sus KPIs resueltos.
- El índice sigue siendo `SegmentedControl variant="pills"` con las anclas.

**G-03 sigue abierto en su mayor parte.** Los tiles, alertas y filas de backlog ya enlazan a su
módulo *y conservan la faena*, pero **los 8 gráficos siguen sin enlace** y `/analitica` sólo se
alcanza desde las acciones rápidas, no desde la analítica.

**G-07 sigue abierto.** Tres paletas de gráfico, `MetricCell` como tercera implementación de
tile, y ningún gráfico envuelto en `ChartErrorBoundary`.

**Fase 5 — e2e reescrito y ejecutado ✅ · pasada visual pendiente.**

[e2e/dashboard.spec.ts](e2e/dashboard.spec.ts) pasa de 8 a **16 tests**, reescrito contra el
contrato nuevo:

- Los tres que la Fase 2 rompía: el saludo ya no enumera (y se verifica que **no** enumere);
  la fila superior no repite la dimensión de tareas; el rol restringido pasa de "cuatro tiles
  fijos" a las ranuras que su permiso autoriza.
- La aserción de la inversión ahora usa el rótulo nuevo ("Inversión del período") y **depende
  del permiso**: antes pasaba por el corte, que ocultaba el tile para todos los roles.
- Uno nuevo afirma que el rol restringido **sí** ve "Stock crítico" — lo que el corte anterior
  le negaba pese a tener `warehouse:view_stock`.
- Cinco nuevos para el alcance global: dos controles y no tres, el período viaja en la URL y
  reencuadra el rótulo del flujo, elegir faena sobrevive al recargar, los atajos arrastran la
  faena, y una faena inexistente cae a "todas" en vez de dejar el tablero en cero.

### Ejecutado: **16/16 en verde, cero saltados**

Y la corrida encontró dos cosas que sólo se ven ejecutando:

**1. Un fallo real de selector, con un dato que confirma la Fase 2.** El test del período
empataba dos elementos con `getByRole("link", { name: "Trimestre" })`: el enlace del control y
**el tile de dinero**, cuyo nombre accesible incluye su descripción ("OC emitidas · trimestre
en curso"). El tile renderizó `Inversión del período $25.466` con datos reales del seed — la
tarjeta que antes de la Fase 2 era inalcanzable. El test falló *porque ahora existe*. Corregido
acotando el localizador al grupo.

**2. Dos tests que pasaban sin afirmar nada.** "Elegir faena reencuadra el tablero" y "los
atajos arrastran la faena" salían **saltados** con el motivo "El usuario tiene una sola faena
autorizada". Era falso: el admin del seed es global y hay dos faenas activas.

> **Causa:** `locator.count()` **no auto-espera**. Se ejecutaba antes de que el control
> existiera en el DOM, devolvía 0, y el `test.skip` convertía la carrera en un "no aplica".
> Una sonda descartable confirmó que el selector sí estaba en la página
> (`combobox aria-label="Faena del tablero"`).
>
> Es el modo de falla en que **el silencio parece éxito**: dos de los tests más importantes del
> alcance global reportaban verde sin ejercitar una línea. El arreglo ancla el conteo en un
> hermano que siempre renderiza (el grupo de período), de modo que un 0 signifique de verdad
> "este rol no tiene selector".

Lección para el resto de la fase: **un `test.skip` condicional sobre un `count()` es una
aserción vacía esperando a pasar.** Si se usa, el conteo va después de un `expect(...).toBeVisible()`
sobre algo que siempre está.

**Pasada visual: no se hizo.** El eje doble, la barra apilada, el combo de costo y la cabecera
con dos controles **sólo se ven mirando**, y la auditoría anterior encontró tres cosas por esa
vía que ningún test detectó.

**Un detalle encontrado leyendo, ya corregido y con test:** `WorksiteSelect` emite `""` al
elegir "todas las faenas", no su `allValue`. Sin normalizarlo, volver a "todas" dejaba un
`?faena=` vacío colgando en la URL.
