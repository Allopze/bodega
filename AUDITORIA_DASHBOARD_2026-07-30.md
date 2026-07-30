# Auditoría del dashboard de inicio — 2026-07-30

Alcance: `app/(app)/dashboard/**` y los servicios que lo alimentan
(`lib/services/operational-work-queue.ts`, `dashboard-metrics.ts`,
`dashboard-fleet-maintenance.ts`, `operational-period-metrics.ts`).

Objetivo declarado: que se vea y funcione como un **dashboard operacional
completo**. Hoy no lo es. El diagnóstico corto:

> El dashboard muestra cifras de población completa (200 tareas) junto a
> controles que operan sobre una página de 25 filas, sin decirlo en ninguna
> parte. Además está pintado en azul/slate mientras el design system es verde
> esmeralda + naranja, y arrastra tres funcionalidades declaradas que nunca
> se ejecutan.

25 hallazgos: 6 P0 (datos incorrectos), 6 P1 (funcionalidad muerta o rota),
7 P2 (layout / densidad / a11y), 6 P3 (marca, rendimiento, cobertura).

## Estado de la remediación — 2026-07-30

**Los 25 hallazgos están cerrados**, en tres pasadas. La 2ª cerró los 3 que
quedaron abiertos y descubrió 6 problemas nuevos; la 3ª cerró lo que el plan
había dejado sin hacer —**D3 faltaba y ni siquiera estaba anotado**— más 4 items
de deuda visible. Detalle en §Segunda pasada y §Tercera pasada.

> El encabezado de la 2ª pasada decía "no hay hallazgos pendientes". Era falso:
> cierto para los 25 de la auditoría, no para el plan. Queda corregido aquí.

| | Hallazgo | Estado |
|---|---|---|
| D-01 | Población completa mezclada con página de 25 | ✅ corregido |
| D-02 | Gráfico de módulos sobre el muestreo | ✅ corregido |
| D-03 | Selects derivados de las filas cargadas | ✅ corregido |
| D-04 | Filtro imposible "Órdenes de compra" | ✅ corregido |
| D-05 | Falta prioridad "Baja" | ✅ corregido |
| D-06 | Año en UTC, no en hora de Chile | ✅ corregido (raíz) |
| F-01 | `applyPreset` muerto y rótulo falso | ✅ corregido |
| F-02 | Sparklines nunca renderizados | ✅ corregido (2ª pasada) |
| F-03 | Iconos SST/ambientales sin productor | ✅ corregido |
| F-04 | `data-sticky-col` inerte | ✅ corregido |
| F-05 | `metric-bar.tsx` y `dashboard-task-row.tsx` muertos | ✅ corregido |
| F-06 | Filtros perdidos en cada refresh | ✅ corregido |
| L-01 | Dos `<h1>` | ✅ corregido |
| L-02 | Scroll horizontal permanente en la cola | ✅ corregido |
| L-03 | Muro de filtros | ✅ corregido |
| L-04 | Una dimensión, tres representaciones | ✅ corregido |
| L-05 | Jerarquía tipográfica del aside | ✅ corregido |
| L-06 | Ocho gráficos sin agrupación | ✅ corregido |
| L-07 | Rótulo de período falso | ✅ corregido |
| B-01 | Dashboard azul sobre design system esmeralda | ✅ corregido |
| B-02 | Colores de series hardcodeados | ✅ corregido |
| P-01 | Waterfall de dos `Promise.all` | ✅ corregido |
| P-02 | Sin `Suspense` | ✅ corregido |
| P-03 | Dos KPI históricos sin período | ✅ corregido |
| T-01 | Sin e2e de dashboard | ✅ 5/5 en verde (2ª pasada) |

Además, en la 2ª pasada se cerraron 6 hallazgos **nuevos**: recharts en el
bundle inicial (−465 kB), `relativeAge` en días de calendario, `purchase_order`
muerto, agregados huérfanos en `getDashboardData`, mapas de etiquetas
duplicados, y dos problemas que sólo se vieron mirando la pantalla.

Detalle de cada cambio en §Registro de implementación y §Segunda pasada.

---

## P0 — El dashboard muestra datos incorrectos

### D-01 · Cifras de población completa mezcladas con una página de 25 filas

`page.tsx:89` pide `getOperationalWorkQueue(session, { limit: 25 })`. El
servicio devuelve `total` y `summary.*` calculados con `COUNT(*)` sobre la
población completa (`operational-work-queue.ts:944-953`), pero `items` viene
truncado a 25.

La Control Center consume ambos como si fueran lo mismo:

| Elemento | Fuente | Población |
|---|---|---|
| "Tienes N tareas pendientes, N críticas…" | `queueSummary` | **completa** |
| Tile KPI "Tareas pendientes" | `queue.total` | **completa** |
| Chips rápidos ("Todas 25", "Críticas 3") | `tasks.length` | **25** |
| "N de N tareas" | `filteredTasks.length` / `tasks.length` | **25** |
| Filas de la cola | `filteredTasks` | **25** |

Con 200 pendientes el usuario lee *"Tienes 200 tareas pendientes, 12
críticas"* y justo debajo *"Todas 25 · Críticas 3"*. No hay paginación, ni
"cargar más", ni aviso de truncamiento. La cola de trabajo — el widget
principal del dashboard — es un muestreo sin etiquetar.

`app/(app)/dashboard/dashboard-control-center.tsx:180-186`, `:242-244`

### D-02 · "Distribución por Módulo" grafica las 25 filas cargadas

`ModuleWorkloadChart` agrupa `tasks` (25) y rotula el total como
`{tasks.length} tareas`. Es un gráfico literalmente equivocado: presenta un
muestreo como si fuera la distribución del backlog.

`queue.summary.moduleCounts` ya trae los conteos por módulo de la población
completa y el dashboard lo ignora (sólo lo usa para `entregas`, en
`page.tsx:106`).

`app/(app)/dashboard/dashboard-charts.tsx:200-240`

### D-03 · Los selects de Faena y Estado se derivan de las 25 filas

```ts
const worksites = React.useMemo(() => [...new Map(tasks.map(...))], [tasks])
const statuses  = React.useMemo(() => [...new Set(tasks.map(...))], [tasks])
```

El servicio ya devuelve `filterOptions.{worksites,statuses,modules,responsible}`
con `SELECT DISTINCT … FROM enriched` (población completa,
`operational-work-queue.ts:949-952`) y el dashboard **no lo usa**. Faenas y
estados que existen en el backlog no aparecen en el filtro.

`app/(app)/dashboard/dashboard-control-center.tsx:140-149`

### D-04 · Opción de filtro imposible: "Órdenes de compra"

`MODULE_META` ofrece las 12 entradas de `WorkTaskType`, incluida
`purchase_order` → "Órdenes de compra". Pero `MODULE_TO_TASK_TYPE`
(`page.tsx:39-51`) mapea `compras → "purchase"` y nunca produce
`purchase_order`. Seleccionar esa opción devuelve siempre 0 resultados.

`app/(app)/dashboard/dashboard-control-center.tsx:94`, `:272`

### D-05 · Falta el nivel "Baja" en el filtro de Prioridad

El select ofrece Crítico / Alta / Normal. `PRIORITY_RANK` sí contempla `low`,
y hay fuentes que lo producen (`pdtpActionPlan.prioridad = 'baja'`,
`preventionCapaActions.priority = 'baja'` →
`operational-work-queue.ts:654,671`). Esas tareas no son filtrables.

`app/(app)/dashboard/dashboard-control-center.tsx:278-283`

### D-06 · El año se calcula en UTC, no en hora de Chile

`page.tsx:118` — `const currentYear = new Date().getFullYear()`. El contenedor
de producción corre en UTC (documentado en `lib/utils.ts:86-90`), así que
entre las 21:00 CLST del 31-dic y la medianoche UTC el dashboard consulta
PDTP, indicadores SST y eventos ambientales del **año siguiente**.

Es además incoherente dentro de la misma pantalla: `getMonthBounds`
(`dashboard-fleet-maintenance.ts:50-55`) sí resuelve el mes con
`timeZone: "America/Santiago"`. `currentPdtpPeriod()`
(`lib/services/pdtp/period.ts:14-17`) tiene el mismo defecto en año, mes y día.

---

## P1 — Funcionalidad declarada que nunca se ejecuta

### F-01 · `applyPreset` es código muerto y su rótulo miente

La tira de KPIs anuncia **"Selecciona para filtrar"**
(`operational-metrics-strip.tsx:72`), y tanto `MetricCell` como
`OperationalAlert` implementan la rama `metric.preset` / `alert.preset` que
llama a `applyPreset` (filtra la cola + `scrollIntoView`).

Ni `buildOperationalMetrics` ni `buildOperationalAlerts` (`page.tsx:337-379`)
setean nunca `preset` — todos los elementos llevan `href`. Resultado: el
único comportamiento posible es **navegar fuera del dashboard**. La rama
`preset`, la prop `onSelect` encadenada por tres componentes y el scroll
suave son inalcanzables.

### F-02 · Los sparklines nunca se renderizan

`DashboardMetric.sparkline` existe, `MiniSparkline` existe, `SPARKLINE_COLOR`
tiene 12 entradas — y ningún productor puebla el campo. Los KPIs son cuatro
números sin ninguna referencia temporal: no se sabe si 12 críticas es mejor o
peor que ayer.

Es el hueco más visible entre "esto es un dashboard operacional" y lo que
hay: un dashboard operacional dice *estado + dirección*, este sólo dice
estado.

### F-03 · Iconos y colores SST/ambientales sin productor

`icon: … | "sst_tf" | "sst_tg" | "env_events" | "material_damage"` está en el
tipo, en `METRIC_ICON` y en `SPARKLINE_COLOR`. Ninguna métrica los usa. Son
restos de una integración de indicadores de prevención en la tira de KPIs que
nunca se conectó (los datos SST/ambientales sí se cargan, pero sólo van a los
gráficos del fondo de la página).

### F-04 · `data-sticky-col="true"` es inerte en la cola

`dashboard-control-center.tsx:301` pone el atributo sobre el contenedor de la
cola. El CSS que lo implementa (`app/globals.css:272-288`) selecciona
`:is(thead, tbody) > tr > :first-child` — y la cola es un grid de `ul`/`li`,
no una `<table>`. La columna Prioridad/Tarea **no** queda fija durante el
scroll horizontal (que sí ocurre siempre, ver L-02).

### F-05 · Dos archivos muertos en la carpeta

- `metric-bar.tsx` (`MetricBar`) — sin importadores.
- `dashboard-task-row.tsx` (`TaskRow`, `TASK_ICON`, `TASK_TYPE_LABEL`,
  `formatShortDate`) — sin importadores; `lib/urgency-labels.ts:12` todavía lo
  cita como referencia viva en un comentario.

Ambos duplican lógica que ya vive en `operational-metrics-strip.tsx` y
`WorkQueueRow`, con mapas de iconos y labels divergentes.

### F-06 · El estado de los filtros se pierde en cada refresh

`preset`, `module`, `worksiteId`, `priority`, `status` y `sort` viven en
`useState`. Con `loading.tsx` presente, cualquier `router.refresh()` — por
ejemplo el que dispara `WorkAssignmentControl` tras asignar una tarea —
desmonta el árbol y borra los seis filtros. `/pendientes` resolvió esto
llevando el estado a la URL (`work-queue-workbench.tsx:44-51`); el dashboard
no puede hacer lo mismo (ver nota en el plan) pero hoy no hace nada.

---

## P2 — Layout, densidad y accesibilidad

### L-01 · Dos `<h1>` en la página

`PageHeader` emite `<h1>Dashboard</h1>` con `lg:sr-only`
(`components/ui/page-header.tsx:81-89`) y la Control Center emite
`<h1>Hola, {firstName}</h1>` (`dashboard-control-center.tsx:212`). En
escritorio hay dos h1 en el árbol de accesibilidad; **en móvil ambos son
visibles y consecutivos**.

Es exactamente el hallazgo A-27 ya corregido en `/pendientes`
(ver comentario en `app/(app)/pendientes/page.tsx:17-19`). El dashboard nunca
recibió el mismo arreglo.

### L-02 · La cola de trabajo scrollea horizontalmente en todo portátil

La grilla declara `grid-cols-[7rem_minmax(15rem,1.6fr)_9rem_10rem_9rem_8rem_10rem]`
= 68rem de columnas + 6 gaps de 0.75rem ≈ **1160px de ancho intrínseco**,
dentro de un contenedor cuyo `min-w-[760px]` es menor y por tanto inoperante.

Ese contenedor vive en `lg:col-span-8` de 12: en un portátil de 1440px el slot
mide ≈ 890px. La cola scrollea horizontalmente **siempre**, y sin columna fija
(F-04): al desplazarse a la derecha se pierde de vista qué tarea se está
mirando.

### L-03 · Muro de filtros (viola A2)

5 chips rápidos + 5 selects visibles a la vez, sin agrupación "Más filtros
(N)" y sin chips removibles de filtros activos. AGENTS.md A2 fija 4–6
primarios y el resto plegado. `combustibles/bitacora` es la referencia
correcta y ya existe en el repo.

### L-04 · Una dimensión, tres representaciones (viola A5)

- **Módulo**: chips rápidos (Aprobaciones/Recepciones/Entregas) + select
  "Módulo" + gráfico "Distribución por Módulo".
- **Prioridad**: chip "Críticas" + select "Prioridad" + tile KPI "Tareas
  críticas" + alerta "tareas críticas" en el aside.

La cifra de tareas críticas aparece **cuatro veces** en la misma pantalla, dos
de ellas con poblaciones distintas (D-01).

### L-05 · Jerarquía tipográfica inconsistente en el aside

En la misma columna conviven `<h2 class="text-sm font-bold">Requiere
atención</h2>`, `<h2 class="text-h2">Programa de Trabajo Preventivo</h2>` y
`<h2 class="text-sm font-bold">Flujo del mes</h2>`. El título PDTP se ve
notoriamente más grande que sus hermanos sin ser más importante.

`dashboard-control-center.tsx:339`, `:391`; `page.tsx:229`

### L-06 · Ocho gráficos apilados sin agrupación

`DashboardAnalyticsSection` renderiza hasta 8 tarjetas de gráfico en una
grilla de 2 columnas: operativa, módulos, faenas, combustible, mantención,
SST tasas, SST accidentes, material/ambiental. Cuatro filas de tarjetas altas
bajo una cola que ya scrollea. No hay tabs, ni agrupación por dominio, ni
orden por relevancia para el rol.

### L-07 · El rótulo de período de la sección analítica es falso

`"Datos del año en curso"` (`dashboard-analytics-section.tsx:73`) encabeza
gráficos que en su mayoría **no** son del año en curso: tendencia operativa,
combustible y mantención son *últimos 6 meses* (`getFuelMonthlyTrend(session, 6)`
etc.); distribución por módulo e inversión por faena no tienen período
(acumulado histórico). Sólo SST y material/ambiental son anuales.

---

## P3 — Marca, rendimiento y cobertura

### B-01 · El dashboard no usa la paleta del producto

El design system define `--color-primary: #065F46` (verde esmeralda),
`--color-signal: #f39200` (naranja Chome) y `--color-accent: #ffd51e`
(`app/globals.css:31-48`). El dashboard está construido en azul y slate:

| Archivo | Usos `slate-*` / `blue-*` / `bg-white` | Literales hex |
|---|---:|---:|
| `dashboard-charts.tsx` | 37 | 45 |
| `dashboard-control-center.tsx` | 24 | 0 |
| `operational-metrics-strip.tsx` | 20 | 13 |
| `recent-activity.tsx` | 11 | 0 |
| `pdtp-compliance-card.tsx` | 4 | 0 |
| `dashboard-analytics-section.tsx` | 4 | 0 |

`focus-visible:outline-blue-600`, `bg-slate-900 text-white` en el chip activo,
el punto `bg-blue-600` del encabezado de KPIs, `text-blue-600` en todos los
hovers. Es la pantalla de inicio y es la que menos se parece al producto.

Nota: `pdtp-compliance-card.tsx` sí usa tokens en su interior — el resultado
es una tarjeta verde/naranja dentro de una columna azul.

### B-02 · Series de gráficos con colores hardcodeados

58 literales hex repartidos en `dashboard-charts.tsx` y
`operational-metrics-strip.tsx`, sin paleta categórica única ni derivación de
tokens. `#2563eb` aparece 13 veces. Nada garantiza contraste ni distinguibilidad
entre series (p. ej. `#d97706` naranja y `#dc2626` rojo conviven en
`SstAccidentChart`).

### P-01 · Waterfall de dos bloques `Promise.all` independientes

`page.tsx:87-103` espera 10 consultas. `page.tsx:120-132` espera otras 5
(PDTP, programas, SST, eventos ambientales) que **no dependen** del primer
bloque. Son dos viajes secuenciales donde cabe uno: la latencia total es
`max(bloque1) + max(bloque2)` en vez de `max(todo)`.

### P-02 · Sin `Suspense`: la cola espera a los gráficos

La Control Center no se pinta hasta que resuelven `getFuelMonthlyTrend`,
`getMaintenanceMonthlyTrend`, `getOperationalTrendHistory`,
`getCanonicalSafetyIndicatorYear` y `getMaterialEnvironmentalEvents` — cinco
consultas cuyo único consumidor es la sección analítica, que además está
*bajo el pliegue* y con hidratación diferida (`next/dynamic`, `ssr: false`).

Se pagó el costo de diferir Recharts (~168kb, auditoría UIUX-002) y se dejó el
bloqueo de datos intacto.

### P-03 · Dos de los cuatro slots de KPI son cifras históricas sin período

"Inversión acumulada" = `SUM(totalAmount)` de toda OC no borrador/cancelada,
sin filtro de fecha. "Tasa de aprobación" = aprobadas/total **de toda la
historia** (`dashboard-metrics.ts:112-129`). Ninguna de las dos cambia de forma
perceptible de un día a otro ni informa una decisión operativa, y ocupan la
mitad del presupuesto de 4 tiles que fija A1.

### T-01 · Sin cobertura e2e del dashboard

No existe `e2e/dashboard.spec.ts`. El único test es
`dashboard-control-center.test.tsx` (4 casos) y ninguno cubre la discrepancia
total-vs-página, que es el hallazgo más grave.

---

# Plan de remediación

Cinco fases. F1 y F2 son las que convierten esto en un dashboard operacional
correcto; F3–F5 lo convierten en uno *completo*.

## Fase 1 — Honestidad de datos (P0) · ~1 día

Objetivo: que ninguna cifra en pantalla mienta sobre su población.

1. **D-01 · Etiquetar y acotar la cola.** Subir `limit` a 50 y rotular
   explícitamente: `"Mostrando 50 de 214 · Abrir cola completa"` con enlace a
   `/pendientes`. Los chips rápidos pasan a consumir `queue.summary`
   (`critical`, `moduleCounts.aprobaciones`, `.recepciones`, `.entregas`,
   `all`) — que ya vienen de población completa — y al pulsarlos **navegan a
   `/pendientes?quick=…`** en vez de filtrar 50 filas en cliente. La cola del
   dashboard queda como *top-N accionable*, no como sustituto de `/pendientes`.
2. **D-02 · Arreglar el gráfico de módulos.** Alimentar `ModuleWorkloadChart`
   con `queue.summary.moduleCounts` en lugar de `tasks`. Requiere mapear
   `OperationalModule → label` (ya existe `MODULE_LABELS`, indexado por
   `WorkTaskType`; unificar en un solo mapa).
3. **D-03 · Usar `queue.filterOptions`.** Pasar `filterOptions` como prop y
   eliminar los dos `useMemo` que derivan faenas y estados de las filas
   cargadas.
4. **D-04 · Quitar `purchase_order`** de las opciones del select (mantenerlo en
   `MODULE_META` para el render de filas si alguna fuente lo emite a futuro,
   pero derivar las opciones de `filterOptions.modules`, que resuelve el
   problema de raíz).
5. **D-05 · Añadir "Baja"** al select de Prioridad — o mejor, derivarlo también
   de los datos.
6. **D-06 · Año en hora de Chile.** Extraer un helper
   `currentChileYear()` / `currentChilePeriod()` en `lib/utils.ts` con
   `Intl.DateTimeFormat(… timeZone: "America/Santiago")` y usarlo en
   `page.tsx:118` **y** en `currentPdtpPeriod()`. Este último es el arreglo de
   raíz: lo consumen el card PDTP del dashboard y todo el módulo PDTP.

**Verificación:** ampliar `dashboard-control-center.test.tsx` con un caso que
pase `tasks` de 3 filas y `queueSummary.total = 214`, y afirme que los chips
muestran los conteos de `summary` y que aparece el rótulo de truncamiento.

## Fase 2 — Eliminar lo muerto y arreglar lo roto (P1) · ~0.5 día

7. **F-01 · Decidir preset vs href.** Con la Fase 1 los chips navegan a
   `/pendientes`; entonces `applyPreset`, la prop `onSelect` en cadena y la
   rama `metric.preset` / `alert.preset` se **borran** (junto con
   `DashboardQueuePreset`). Y se corrige el rótulo "Selecciona para filtrar" →
   "Selecciona para abrir el detalle".
8. **F-02 · Poblar sparklines** (ver Fase 4 — es la mejora de mayor impacto
   visible; hasta entonces, dejar el campo y el render tal cual, ya están
   guardados por `hasRealSparkline`).
9. **F-03 · Borrar** `sst_tf | sst_tg | env_events | material_damage` del tipo
   `icon` y de los dos mapas, hasta que exista un productor.
10. **F-04 · Quitar `data-sticky-col`** de la cola (es inerte) y resolver el
    scroll horizontal en L-02, que es el problema real que ese atributo
    intentaba mitigar.
11. **F-05 · Borrar** `metric-bar.tsx` y `dashboard-task-row.tsx`; actualizar el
    comentario de `lib/urgency-labels.ts:12`.
12. **F-06 · Persistir filtros en `sessionStorage`.** No en la URL: el dashboard
    es la raíz y ensuciar `?module=…` compite con los enlaces del aside. Ver
    memoria `router-refresh-state-loss`. Si la Fase 1 reduce los filtros a
    "orden + faena" (los demás migran a `/pendientes`), esto se vuelve trivial.

## Fase 3 — Densidad y layout (P2) · ~1 día

13. **L-01 · Un solo `<h1>`.** Pasar `PageHeader` a modo sin título en esta ruta
    (o marcar el saludo como `<h2>`), replicando el arreglo A-27 de
    `/pendientes`.
14. **L-02 · Que la cola quepa.** Dos opciones, en orden de preferencia:
    - (a) reducir a 5 columnas — fusionar *Estado* dentro de la celda de tarea
      (segunda línea) y *Módulo* en un icono junto al título → ancho intrínseco
      ≈ 780px, cabe en el slot de 8/12 en 1440px sin scroll;
    - (b) si se conservan 7 columnas, mover la cola a ancho completo bajo el
      grid y dejar KPIs+aside arriba.
    La (a) mantiene la composición 8+4 y es el diff más corto.
15. **L-03 · Colapsar el muro de filtros** a *Faena · Orden* visibles + `<details>`
    "Más filtros (N)" con el resto, más chips removibles de filtros activos
    (patrón `combustibles/bitacora`).
16. **L-04 · Una dimensión, una representación.** Con la Fase 1, los chips pasan
    a ser navegación y el select de Módulo desaparece del dashboard (vive en
    `/pendientes`). El gráfico de distribución por módulo queda como la única
    representación analítica de esa dimensión.
17. **L-05 · Unificar los `h2` del aside** en una sola escala
    (`text-sm font-bold` o el token `text-h3`, lo que fije DESIGN.md).
18. **L-06/L-07 · Reagrupar la sección analítica** en tres bloques rotulados con
    su período real: *Operación (últimos 6 meses)*, *Prevención y SST (año en
    curso)*, *Flota y combustible (últimos 6 meses)*. Eliminar el rótulo global
    falso.

## Fase 4 — Que se vea como el producto (P3) · ~1.5 días

19. **B-01 · Migrar a tokens.** Reemplazo mecánico en los 6 archivos:
    `bg-white → bg-[var(--color-surface)]`, `border-slate-200/80 →
    border-[var(--color-border)]`, `text-slate-900 → text-[var(--color-text)]`,
    `text-slate-500 → text-[var(--color-text-muted)]`,
    `focus-visible:outline-blue-600 → outline-[var(--color-primary)]`,
    `bg-slate-900 text-white` (chip activo) → `bg-[var(--color-primary)]
    text-white`, `text-blue-600` (hover) → `text-[var(--color-primary)]`,
    `text-red-600` (tono danger) → `text-[var(--color-danger-ink)]`.
    Es el cambio de mayor impacto visual por línea tocada.
20. **B-02 · Paleta categórica única.** Un módulo `chart-palette.ts` con 6–7
    series derivadas de los tokens de marca (primary, signal, accent, info,
    danger, warning + neutro), consumido por los 9 configs de gráfico y por
    `SPARKLINE_COLOR`. Verificar contraste y distinguibilidad de las series
    adyacentes de `SstAccidentChart` y `MaterialEnvironmentalChart`.
21. **F-02 · Sparklines reales.** `getOperationalTrendHistory(session, 6)` ya se
    consulta en la página: alimentar `sparkline` de los tiles *tareas*,
    *aprobaciones* y *recepciones* desde esa serie. Para *críticas* y *stock*
    hace falta una serie nueva; si no existe snapshot histórico, dejarlos sin
    sparkline (el guard ya lo soporta) antes que inventar datos.
22. **P-03 · Reemplazar los dos KPI históricos.** "Inversión acumulada" →
    *Inversión del mes* (ya está en `periodMetrics.spend.current`, con su
    comparación mes anterior). "Tasa de aprobación" → *Tareas vencidas* o
    *Tiempo medio de aprobación*, que sí cambian una decisión diaria. Mantener
    el tope de 4 tiles (A1).

## Fase 5 — Rendimiento y cobertura · ~0.5 día

23. **P-01 · Fusionar los dos `Promise.all`** en uno solo (son independientes).
24. **P-02 · `<Suspense>` alrededor de la sección analítica.** Extraer la carga
    de `trendHistory`, `fuelTrend`, `maintenanceTrend`, `sstYearView` y
    `envEventsData` a un componente servidor propio envuelto en `Suspense` con
    el `chartSkeleton` que ya existe. La Control Center deja de esperar cinco
    consultas que no consume.
25. **T-01 · `e2e/dashboard.spec.ts`.** Casos mínimos:
    - la cifra del saludo coincide con la del tile "Tareas pendientes";
    - con backlog > límite, se muestra el rótulo de truncamiento y los chips
      reflejan `summary`, no las filas visibles;
    - la cola no produce scroll horizontal a 1440px (regresión de L-02);
    - un rol restringido no ve tiles ni alertas fuera de su permiso.

---

## Orden recomendado

**F1 → F2 → F4(19) → F3 → F4(resto) → F5.**

Razón: F1+F2 arreglan la corrección (lo que está mal) con el diff más chico;
el punto 19 de F4 (migración a tokens) es puramente mecánico y entrega el
salto visual más grande por sí solo, así que conviene adelantarlo antes de
tocar layout — así F3 se hace ya sobre la paleta definitiva y no hay que
repintar dos veces.

---

# Registro de implementación — 2026-07-30

## Fase 1 — Honestidad de datos

**D-06 (raíz).** Nuevo `chileDateParts()` en [lib/utils.ts](lib/utils.ts),
junto a los formatters que ya resolvían en `America/Santiago`. Lo consumen
`page.tsx` (para `currentYear`) y **`currentPdtpPeriod()`**
([lib/services/pdtp/period.ts](lib/services/pdtp/period.ts)), que era el
verdadero punto único: lo usan 11 archivos del módulo PDTP, no sólo el
dashboard. Los casos de `pdtp-period.test.ts` pasaban `new Date(2026, 6, 4)`
—hora del proceso— y se reescribieron como instantes UTC explícitos; se agregó
la regresión del 31-dic 21:00 CLST.

**D-01.** La cola pasa de "segundo workbench" a *top-N accionable que enlaza*:

- Límite 25 → 50 (`QUEUE_PREVIEW_LIMIT`).
- Los chips que filtraban en cliente se reemplazan por `queueShortcuts`
  (`buildQueueShortcuts` en `page.tsx`): conteos de `queue.summary` —población
  completa— que **navegan** a `/pendientes?quick=…` / `?module=…`, ya filtrados
  por permiso. Se añadieron *Vencidas* y *Sin responsable*, que el servicio ya
  contaba y nadie exponía.
- Pie explícito: "Mostrando las N más urgentes de M tareas pendientes" +
  "Abrir cola completa", sólo cuando hay truncamiento.
- El contador de la cabecera pasa de "N de M tareas" a "N de M visibles" y la
  descripción dice cuántas son las más urgentes.

**D-02.** `ModuleWorkloadChart` recibe `data`/`total` en vez de `tasks`, y
`page.tsx` los arma desde `queue.summary.moduleCounts`. Su `MODULE_LABELS`
local se borró; el mapa `OperationalModule → label` vive ahora una sola vez en
`page.tsx` (junto a `MODULE_TO_TASK_TYPE`, su hermano).

**D-03/D-04/D-05.** El select de Faena consume `queue.filterOptions.worksites`.
Los selects de Módulo, Prioridad y Estado se eliminaron: filtraban 50 filas
mientras la pantalla mostraba conteos de 243, y `/pendientes` ya los resuelve
en servidor. Eso disuelve D-04 y D-05 por eliminación en vez de por parche.

## Fase 2 — Código muerto y roto

**F-01.** Borrados `DashboardQueuePreset`, el estado `preset`, `applyPreset`,
su `scrollIntoView` y la prop `onSelect` encadenada por tres componentes, más
las ramas `metric.preset` / `alert.preset`. El rótulo pasa de "Selecciona para
filtrar" (falso) a "Selecciona para ver el detalle".

**F-03.** Fuera `sst_tf | sst_tg | env_events | material_damage` del tipo
`icon`, de `METRIC_ICON` y de `SPARKLINE_COLOR`.

**F-04.** Fuera `data-sticky-col="true"`; el problema real que intentaba
mitigar se resuelve en L-02.

**F-05.** Borrados `metric-bar.tsx` y `dashboard-task-row.tsx`; actualizada la
referencia colgante en [lib/urgency-labels.ts](lib/urgency-labels.ts).

**F-06.** Faena y orden persisten en `sessionStorage`
(`dashboard:queue-filters`) con el patrón try/catch del repo. Va con guard
`restored`: sin él, el primer commit escribía los defaults encima de lo leído.
No va en la URL porque el dashboard es la raíz y competiría con los enlaces del
aside.

## Fase 3 — Layout y densidad

**L-01.** El saludo deja de ser `<h1>` y pasa a `<p>` con el mismo estilo:
`PageHeader` ya emite el `<h1>` de la página. "Hola, Ana" no rotula ninguna
sección, así que no era un encabezado — y como `<p>` no hay que degradar los
`<h2>` de las secciones.

**L-02.** La cola pasa de 7 a **4 columnas** (Prioridad · Tarea · Antigüedad ·
Acción); módulo, estado y faena se fusionan en la línea meta de la celda de
tarea. Ancho intrínseco ~1160px → ~544px. El `min-w-[760px]` declarado era
menor que el ancho real y por eso no hacía nada.

> El primer intento (5 columnas, 48rem) **falló el e2e con 92px de desborde**:
> el slot útil no es ~890px sino ~676px, porque el sidebar se come 256px antes
> de que empiece el `PageContainer`. La medición del test corrigió el cálculo.

**L-03/L-04.** De 5 chips + 5 selects a 5 atajos de navegación + 2 selects
(Faena, Orden). Módulo queda con una sola representación (el gráfico), y
prioridad con dos no redundantes: el tile de KPI (estado) y el atajo (acceso).

**L-05.** El `<h2>` de PDTP baja de `text-h2` a `text-sm font-bold`, la escala
de sus hermanos en el aside.

**L-06/L-07.** `DashboardAnalyticsSection` agrupa en *Operación* /
*Prevención y SST* / *Flota y combustible*, cada uno con **su** período real.
El rótulo global "Datos del año en curso" era falso para 5 de 8 gráficos y se
eliminó; "Inversión por faena" y "Distribución por módulo" declaran el suyo en
el subtítulo ("acumulado histórico", "backlog al día de hoy").

## Fase 4 — Marca

**B-01.** Migración mecánica de los 6 archivos a tokens: `bg-white →
bg-[var(--color-surface)]`, `border-slate-* → border-[var(--color-border)]`,
`text-slate-{900,800} → text-[var(--color-text)]`, `text-slate-{700,600,500} →
text-[var(--color-text-muted)]`, `text-slate-400 →
text-[var(--color-text-faint)]`, `blue-600 → var(--color-primary)` (esmeralda),
`red-600 → var(--color-danger-ink)`. **0 clases `slate-*`/`blue-*`/`bg-white`
restantes** en `app/(app)/dashboard/`.

**B-02.** Nuevo [chart-palette.ts](<app/(app)/dashboard/chart-palette.ts>) con
una paleta categórica única: `brand`/`signal`/`danger`/`rule` salen de los
tokens; `blue`/`violet`/`teal`/`neutral` son los hues que el sistema no define
y que hacen falta para separar hasta 7 series (la marca es verde + naranja +
ámbar, demasiado cercanos entre sí como categorías contiguas). Los 58 literales
hex se reasignaron **por semántica**, no por reemplazo ciego: completado →
esmeralda, pendiente → naranja Chome, severidad → rojo, acumulado → gris regla.
`BAR_COLORS` se sustituyó por `CHART_SERIES`.

> Efecto colateral detectado al migrar: `MiniSparkline` construía el id del
> gradiente con el color (`spark-${color}`). Con un token pasaba a ser
> `spark-var(--color-primary)`, un id SVG inválido — y dos sparklines del mismo
> color ya colisionaban entre sí. Ahora usa `React.useId()`.

**P-03.** "Inversión acumulada" (SUM histórico) y "Tasa de aprobación" (ratio
de toda la historia) salen de los 4 slots de KPI. Entran **Tareas vencidas**
(`queue.summary.overdue`, exige acción hoy) e **Inversión del mes**
(`periodMetrics.spend.current`, ya venía con comparación mes anterior).

## Fase 5 — Rendimiento y cobertura

**P-01.** Los dos `Promise.all` secuenciales se fusionan en uno: el bloque de
prevención nunca dependió del operacional.

**P-02.** Nuevo
[dashboard-analytics.tsx](<app/(app)/dashboard/dashboard-analytics.tsx>)
(server component) tras un `<Suspense>` con esqueleto. Se llevó las 5 consultas
que sólo alimentan gráficos —`getOperationalTrendHistory`,
`getFuelMonthlyTrend`, `getMaintenanceMonthlyTrend`,
`getCanonicalSafetyIndicatorYear`, `getMaterialEnvironmentalEvents`— fuera del
lote que bloquea al Centro de Control, que es lo primero que el usuario mira.

## Verificación

- `npx tsc --noEmit` — limpio en todo lo tocado.
- `npx eslint app/(app)/dashboard/ lib/utils.ts lib/services/pdtp/period.ts` —
  limpio.
- `vitest` — 25/25 (`dashboard-control-center` 7, `pdtp-compliance-card` 2,
  `pdtp-period` 16). Tests nuevos: truncamiento anunciado, ausencia de aviso
  cuando no hay truncamiento, restauración de filtros desde `sessionStorage`,
  atajos con conteo de población completa, período en hora de Chile.
- `e2e/dashboard.spec.ts` — ver §Pendientes.

> El test unitario nuevo destapó una duplicación real que la lectura no había
> visto: había **dos** links "Abrir cola completa" (aside + pie de la cola). Se
> eliminó el del aside.

---

# Segunda pasada — cierre de pendientes

Los 3 hallazgos que quedaron abiertos, más 6 problemas nuevos que aparecieron al
cerrarlos. Plan: `~/.claude/plans/squishy-sniffing-kazoo.md`.

## Hallazgo nuevo y más grave: recharts estaba en el bundle inicial

`operational-metrics-strip.tsx` importaba `MiniSparkline` de forma **estática**
desde `dashboard-charts.tsx`, que importa recharts. Cadena completa:

```
page.tsx → dashboard-control-center.tsx ("use client")
         → operational-metrics-strip.tsx
         → dashboard-charts.tsx → import { AreaChart, … } from "recharts"
```

Eso metía recharts en el chunk cliente del Centro de Control **para un
componente que nunca se renderizaba**, y anulaba el `next/dynamic` de la sección
analítica — la optimización que el comentario de ese archivo atribuye a la
auditoría UIUX-002. Existía, pero estaba derrotada desde otro archivo.

**Arreglo:** [mini-sparkline.tsx](<app/(app)/dashboard/mini-sparkline.tsx>), una
`<polyline>` SVG de ~70 líneas sin dependencias, y se borró el `MiniSparkline`
de recharts. Medido sobre el `page_client-reference-manifest.js` de la ruta:

| | chunks de carga inicial | peso | con recharts |
|---|---:|---:|---|
| antes | 20 | 1281.3 kB | 4 chunks (533.6 kB) |
| después | 17 | **815.9 kB** | **0** |

**−465 kB de JS inicial.** Los gráficos siguen cargando en su propio chunk al
hacer scroll (recharts sigue en el build, ya no en la carga inicial).

## F-02 — Sparklines, resuelto por lo que sí es honesto

El bloqueo no era el cron: es que el backlog de la cola es **permission-scoped**
(`requests:view_own` filtra por `requesterId`), así que **ninguna agregación por
faena reconstruye la cifra del tile**. Guardar `backlog_tasks` por faena habría
producido una serie que no corresponde a su número — el mismo tipo de engaño que
motivó toda la auditoría.

Lo que sí calza y se implementó:

- **`stock_alerts`** como métrica nueva de instantánea diaria. Es la única de los
  tiles agregable por faena sin perder fidelidad: `getCriticalStockAlertCount`
  no filtra por permisos ni por usuario. Misma query, con
  `groupBy(worksiteStock.worksiteId)`, dentro del cron que ya corría.
- **`getOperationalSnapshotHistory(session, days)`** — serie diaria por métrica,
  reutilizando el scoping y la **regla de cobertura completa** de
  `getOperationalBacklogComparisons`: un día sólo entra si tiene instantánea de
  todas las faenas visibles. Sin eso la línea caería los días en que faltó el
  snapshot de una faena, dibujando una mejora que nunca ocurrió.
- Sparklines en **"Backlog comparado"** (las 4 métricas con historia real) y en
  el tile de **Stock crítico**.

Los tiles de tareas / críticas / vencidas siguen **sin** sparkline, y eso es la
decisión, no una omisión: mejor sin tendencia que con una que no corresponde.

## T-01 — e2e en verde

`e2e/dashboard.spec.ts`: **5/5**. Cubre coherencia saludo↔KPI, atajos que
navegan a `/pendientes`, truncamiento declarado sólo cuando lo hay, ausencia de
scroll horizontal a 1440px y un solo `<h1>`.

## Correcciones

**C1 · `relativeAge`** contaba múltiplos de 24h: algo creado ayer a las 23:00 y
visto hoy a la 01:00 decía "Hoy". Ahora compara días de calendario con
`chileDateParts()`. Con test de frontera.

**C2 · `purchase_order`** salió de `MODULE_META`. El mapa pasó a `Partial<Record<…>>`
con un `MODULE_FALLBACK`, así que un tipo futuro sin entrada degrada en vez de
romper en runtime.

**C3 · `getDashboardData`** calculaba 6 agregados sin lector. Fuera
`summary.{totalCosts,totalRequests,approvedRequests}` y
`metrics.{my_requests,approved_without_oc,orders_in_progress}` — 6 queries menos
por carga. Los mocks posicionales de `dashboard-service.test.ts` se renumeraron
(16/16 en verde).

**D1 · Etiquetas de módulo unificadas.** `OperationalModule` se movió a
`lib/work-queue.types.ts` (cero imports, client-safe) con re-export desde el
servicio; `OPERATIONAL_MODULE_LABELS` vive en `lib/work-queue-labels.ts`. Se
borraron las dos copias locales — de 4 mapas divergentes al principio de la
auditoría a **1**.

**D2 · Chips removibles de filtros (A2): descartado.** La cola quedó con 2
filtros y un botón "Quitar filtro de faena". Con dos filtros los chips son
ceremonia. Reabrir sólo si los filtros vuelven a crecer.

**D3 · Tipografía del aside: quedó sin hacer** y sin quedar anotado en esta
sección — se cerró en la 3ª pasada.

## Lo que sólo se vio mirando la pantalla

La pasada visual (1440px, capturas del dashboard completo) encontró tres cosas
que ni el typecheck ni los tests podían ver:

1. **La cola de 50 filas ocupaba tres pantallas** con la columna lateral vacía
   desde la fila ~10. Era una regresión que introdujo esta misma remediación al
   subir el límite de 25 a 50 "por honestidad" — pero la honestidad la da el pie
   ("Mostrando las N más urgentes de M") y el atajo "Todas", no el volumen.
   `QUEUE_PREVIEW_LIMIT` quedó en **12**: un top-N que se escanea.
2. **"Inversión por faena" era un bloque casi negro.** `CHART_COLORS.rule`
   (`--color-rule`, oklch 0.225) como relleno macizo dominaba la tarjeta. Pasó a
   `neutral` (gris pizarra) y `rule` salió de la paleta, documentando por qué.
3. **Contradicción aparente en el aside:** una fila decía "Sin snapshot completo
   previo" con un sparkline al lado. No era un bug — la comparación mira el
   último corte **anterior al mes en curso** y el sparkline los últimos 30 días —
   pero se leía como incoherencia. La copia pasó a "Sin corte mensual
   comparable" y el sparkline lleva `title` con su ventana.

El punto 1 es el que importa como método: fue una regresión **propia**, y sólo la
vio la captura.

## Verificación de esta pasada

- `npx tsc --noEmit` — limpio.
- `npx eslint` sobre dashboard, pendientes, servicios y libs tocadas — limpio.
- `vitest` — **90/90** en 6 archivos. Nuevos: `operational-snapshot-history.test.ts`
  (4 casos, incluido el descarte de días sin cobertura completa), frontera de día
  chileno en `relativeAge`, y render del sparkline sólo con serie real.
- `playwright e2e/dashboard.spec.ts` — **5/5**.
- Bundle medido antes/después (tabla arriba).
- Pasada visual con capturas, incluida una corrida con
  `operational_metric_snapshots` sembrado para ver el sparkline con datos reales
  en vez de sólo comprobar que el guard no rompe.

## Nota sobre el proceso concurrente

Durante la primera pasada, otro proceso tenía una feature PDTP a medio escribir
en este mismo checkout, que rompía el build de forma intermitente y bloqueó tres
intentos de correr el e2e (los errores se movieron entre `sheets.ts`,
`actividades/page.tsx` y `pdtp-sheet-table.tsx`). No se tocó nada de eso; al
momento de esta segunda pasada el árbol ya compilaba. Ver
[[concurrent-editing-2026-07-28]].

---

# Tercera pasada — lo que el plan había dejado abierto

Plan: `~/.claude/plans/squishy-sniffing-kazoo.md`.

## Lo que no podía afirmar

**Test de `captureOperationalMetricSnapshots`.** La 2ª pasada le agregó la
métrica `stock_alerts` a un cron que **no tenía una sola línea de cobertura** y
que nunca se ejecutó. Nuevo
[operational-metric-snapshots-capture.test.ts](lib/__tests__/operational-metric-snapshots-capture.test.ts)
(5 casos): una fila por métrica × faena activa, `stock_alerts` con el valor de
cada faena, `"0"` explícito para faenas ausentes del `GROUP BY`, fecha resuelta
en hora de Chile, y sin faenas activas no toca la tabla.

**Verificado con control negativo:** borrando `["stock_alerts", stockAlerts]` del
cron, **3 de los 5 tests fallan**. Un test de cron que pasa con la métrica
borrada no prueba nada.

El caso del `"0"` explícito es el que sostiene el contrato del otro lado:
`getOperationalSnapshotHistory` descarta los días sin cobertura completa, así que
si la captura omitiera una faena la serie se acortaría en silencio.

**e2e de rol restringido — T-01 cerrado de verdad.** El plan de la 1ª pasada pedía
"un rol restringido no ve tiles ni alertas fuera de su permiso" y quedó fuera.
`restricted-roles.spec.ts` entra al dashboard pero sólo para aterrizar y navegar
a `/solicitudes`: no afirma nada de esta pantalla.

Tres tests nuevos con `scoped@e2e.chome.cl` (sin `approvals:approve`,
`purchasing:view`, `deliveries:create` ni `prevention:pdtp:view`): ausencia de los
tiles "Por aprobar" e "Inversión del mes", de la alerta de aprobación y de la
sección PDTP; presencia de los cuatro que sí autoriza; y "Flujo del mes" sin OC ni
Inversión. **Control positivo:** quitando el gate `input.canApprove` del tile,
2 de los 3 fallan.

> Detalle que se presta a error y quedó anotado en el test: con `canApprove`
> falso el `.slice(0, 4)` deja `tasks, critical, overdue, receipts`, así que
> **"Stock crítico" queda cortado** aunque el rol tenga `warehouse:view_stock`.
> El test no afirma que aparezca.

`e2e/dashboard.spec.ts` pasa de 5 a **8 tests**.

## Deuda visible

**D3 · Cabeceras de sección tokenizadas.** Los `<h2>` usaban tres escalas a mano
(`text-base font-bold` en la columna principal, `text-sm font-bold` en el
lateral). El token `text-h3` existía sin usarse. Ahora las seis cabeceras de
sección usan `text-h3` (15px, Exo, 600).

El plan preveía que el lateral quedara grande al subir de 13 a 15px y que la
conclusión fuera "falta un `text-h4`". **La captura dijo lo contrario:** el
lateral tiene ~340px de ancho y a 15px se lee mejor, no peor. La jerarquía
principal-vs-lateral la cargan el ancho de tarjeta y la posición, no el tamaño de
la cabecera. No hace falta `text-h4`.

**A1 · Copia de estado vacío en los cinco tiles.** "Por aprobar / **0** / Ítems
esperando una decisión" describía un estado que no existía. Los cinco tiles
cambian su descripción en 0 siguiendo el patrón que "Tareas críticas" ya tenía:
"Nada esperando decisión", "Sin recepciones pendientes", "Sin entregas por
registrar", "Todo sobre el mínimo definido", "Nada pendiente por ahora".

*Lectura de A1 que se aplicó:* la regla pide "la acción para dejar de estarlo",
pero estos contadores en cero son buenas noticias y no hay acción que tomar — la
copia correcta es confirmarlo, no inventar un CTA. La regla apunta a tiles vacíos
por falta de configuración, no a contadores legítimamente en cero.

> El quinto tile ("Tareas pendientes") no estaba en el plan; lo destapó la
> captura del rol restringido, donde se leía "0 / Acciones disponibles para tu
> rol".

**A4 · Empty state de "Actividad reciente".** Era un `<p>` suelto con jerga
("hechos verificables desde la activación de este registro operacional"). Ahora
usa `EmptyState` con copia en lenguaje de usuario y CTA a `/pendientes` — honesto,
porque la actividad se genera al trabajar las tareas y no existe un "crear
actividad" que inventar.

**`SPARKLINE_COLOR` podado.** Tenía 8 entradas y sólo `stock` tiene productor. Las
otras 7 hacían creer que existía serie para tiles que no pueden tenerla. Queda
una entrada más el fallback que ya existía.

## Estado transitorio que hay que conocer

**El sparkline del tile de Stock crítico está vacío hasta que el cron acumule
≥2 días.** `stock_alerts` se captura desde su primer run y **no es rellenable
retroactivamente**: no existe historia de niveles de stock pasados. En producción
aparece ~2 días después del deploy. No es un bug — es lo que hay que esperar antes
de reportarlo como roto.

Si el cron dejara de correr, la serie se acorta **en silencio** (la regla de
cobertura descarta días incompletos). Hoy sólo hay `logger.error` en la ruta. Ver
§Descartado.

## Verificación de esta pasada

- `tsc` y `eslint` limpios.
- `vitest` — **95/95** en 7 archivos.
- `playwright e2e/dashboard.spec.ts` — **8/8**.
- Los dos controles (negativo del cron, positivo del gate de permisos) se
  ejecutaron rompiendo el código a propósito y restaurándolo.
- Pasada visual a 1440px con dos roles (admin y restringido), que es lo que
  decidió D3 y destapó el quinto tile de A1.

## Descartado con motivo

**Orden de la leyenda en `OperationalTrendChart`.** La leyenda sale "OC Emitidas ·
Recepciones · Solicitudes", distinto del orden de `trendChartConfig`. Lo fija el
`payload` de Recharts; `ChartLegendContent` sólo lo recorre. Los colores mapean
correctamente a cada serie, así que el impacto es nulo y arreglarlo es pelear con
un interno de la librería.

**Monitoreo de crons.** Problema real, pero **de plataforma**: afecta a los 12
crons de `app/api/cron/`, no al dashboard, y ya existe un `backup-health` que
sugiere que el patrón debería ser transversal. Va como candidato separado en vez
de colarse aquí.

## Corrección de una afirmación previa

En la 2ª pasada dije que `npm run screenshots` tiene el `outputDir` hardcodeado.
**Es falso:** `scripts/capture-all-routes.ts:118` acepta `CAPTURE_OUTPUT_DIR`. La
nota de memoria del proyecto estaba desactualizada en ese punto y se corrigió.

---

## Nota sobre el alcance

Cinco de los hallazgos (D-01, D-03, L-03, L-04, F-06) tienen la misma causa
raíz: **el dashboard reimplementó `/pendientes` en cliente en vez de enlazar a
él.** `WorkQueueWorkbench` ya resuelve filtros en servidor, paginación por
cursor, opciones de filtro completas y estado en URL. La decisión de fondo del
plan es que la cola del dashboard sea un *top-N accionable que enlaza*, no un
segundo workbench de menor calidad. Todo lo demás se deriva de eso.
