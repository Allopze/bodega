# Densidad y auditoría de pantallas autenticadas (`app/(app)/`)

Se cargan cuando se trabaja dentro de `app/(app)/`. Las reglas de layout están en `app/AGENTS.md`.

Los comentarios de código que citan «regla A1», «A2» o «densidad de pantalla de AGENTS.md» se refieren a este archivo.

<!-- BEGIN:screen-density-rules -->
# Screen density rules (avoid the "wall of stuff" screen)

Cada pantalla debe pasar el **test de los 5 segundos**: al abrirla, sin
scrollear, el usuario entiende *qué es*, *en qué estado está su trabajo* y
*qué acción se espera de él*. Estas seis reglas (A1–A6) existen para eso.
Derivan de la auditoría `PLAN_MEJORA_UX_PANTALLAS_2026-07-16.md`.

## A1 — Máximo 4 tiles de KPI sobre el contenido

- No más de **4 tarjetas** de métrica arriba del contenido principal. Cada
  una debe ser accionable (clic = filtra o navega); si un número no cambia
  ninguna decisión, va abajo o se elimina.
- Los KPIs secundarios van en una fila compacta de texto (patrón
  `WarehouseHeaderMetrics` / la "tira editorial" `MetricBar`), no en tarjetas.
- Un tile en estado vacío muestra la acción para dejar de estarlo, nunca "0"
  ni "—" pelados.

### Excepción declarada: el tablero (`/dashboard`)

Inicio pinta **una vista a la vez** (`?vista=`) y cada vista es un dominio
completo, no una pantalla de gestión con una lista debajo: no hay "contenido
principal" que los tiles puedan sepultar. Ahí el tope es de **8 tiles por
vista**, y sobre 4 la fila se parte en **grupos rotulados**
(`DomainSection.kpiGroups`) — Finanzas separa "Ingresos" de "Egresos". Ocho
cifras seguidas sin ese corte se leen como una sola lista indistinguible, que es
el defecto que A1 previene.

Lo que **no** se relaja:

- Cada tile sigue siendo accionable y sigue llevando a su subconjunto, no al
  total (lo verifica `e2e/densidad-kpi.spec.ts`).
- **A5 sigue rigiendo**: una cifra no puede estar en dos vistas del tablero, ni
  dos veces en la misma. Por eso el gasto en OC se fue de Adquisiciones cuando
  nació Finanzas, y el cumplimiento PDTP salió de la fila de tiles al ganar su
  medidor radial.
- Los tres tableros de Control operacional (`/flota/indicadores` y los Paneles
  de Mantención y Combustible, `/mantencion/panel` y `/combustibles`) son el
  análisis del período de un dominio, sin lista principal, y **son en su
  mayoría gráficos** (decisión del usuario 2026-11-14, que lo tuvo que repetir:
  la primera versión abría cada sección con una banda de tiles y la mitad de las
  celdas eran listas). Por eso **no llevan tiles**: las cifras del período van en
  una tira compacta (`SummaryBar numerals="sans"` en el `summary` de
  `DashboardSection`, máximo 4 por sección, cada una accionable), un ranking o un
  reparto por categoría se dibuja con `BarRankingChart`
  (`components/charts/bar-ranking-chart.tsx`) y no con `RankedList`/`ShareBar`, y
  los gráficos van de a dos por fila en `xl` (`layoutChartSlots`,
  `lib/indicators/chart-layout.ts`). Cada sección contesta una sola pregunta.
  **En Mantención y Combustible los Indicadores son el Panel** (decisión del
  usuario 2026-11-14; `/mantencion/indicadores` y `/combustibles/indicadores`
  redirigen al Panel): lo pendiente va en una sola franja arriba de los
  gráficos, nunca en tarjetas-lista. Mantención: la franja «Hoy»
  (`PanelToday`, `SummaryBar` con órdenes por asignar, equipos en taller y
  registros por revisar, sin período). Combustible: el avance y la tira de cinco
  pasos (jefatura, excepción declarada abajo); consulta ve sólo los gráficos, y
  terreno y contrato conservan su estación de trabajo sin gráficos.
- El resto de las pantallas conserva el tope de 4, con una sola excepción más,
  declarada abajo: la tira de pasos del Panel de combustible.
- La superficie del tablero (un panel por grupo en vez de una tarjeta por
  bloque) y sus cifras en sans tienen su propia excepción en la regla 7; no
  cambian ningún tope de esta sección.

### Excepción declarada: el Panel de combustible (`/combustibles`)

La entrada de Combustible es el avance del mes en **cinco pasos** (Fuentes de
datos → Por revisar → Cuadratura → Equipos → Pagos), definidos en
`.impeccable/surfaces/app-app-combustibles.md`. Son cinco tiles porque el mes se
cierra en ese orden y partir la tira en dos rompía la lectura de la secuencia.

- Tope de **5** en esa tira y en ninguna otra pantalla del módulo.
- Cada paso es accionable: su enlace lleva al trabajo que falta, no al total.
- El avance se muestra una sola vez (barra **o** texto «N de 5 pasos listos»),
  además de la insignia de cada paso (A5).
- Un paso dice su estado con la insignia; el borde de la tarjeta no se colorea.

## A2 — Muro de filtros: 4–6 primarios + "Más filtros (N)"

- Máximo 4–6 filtros primarios visibles (los de uso diario: período, faena,
  estado/fuente, búsqueda). El resto va en un `<details>`/Collapsible o
  `Sheet` rotulado "Más filtros" **con contador de activos**.
- Chips removibles de filtros activos bajo la barra (ver
  `combustibles/bitacora/page.tsx`).

## A3 — Lista + acción en el header, no formulario permanente

- La página **es la lista/tabla**. Crear/registrar se dispara desde
  `PageHeader.actions` y abre un `Dialog`/`Sheet` — nunca un formulario
  siempre abierto ocupando el flujo (repite la regla 5 de layout).
- Excepción: estaciones de captura repetitiva (p. ej. `entregas`) pueden
  dejar el form inline pero **plegable**, con la preferencia persistida.
- Si hay varios flujos de alta, un solo botón que pregunta *qué* (ver
  `bodega/movement-sheet.tsx`).

## A4 — Estados vacíos en lenguaje de usuario, con CTA

Todo empty-state tiene tres partes: *qué significa* (sin jerga de modelo de
datos) + *qué hacer para llenarlo* + *CTA real* (botón/Link, no una ruta
pegada como texto). Usa `EmptyState` (`components/ui/empty-state.tsx`). No lleva
ícono en una caja tintada (decisión 2026-11-23): el estado se dice con palabras
y, con `tone` `warning` o `danger`, con el color del título.

## A5 — Una dimensión = una representación interactiva

Si hay pestañas por estado, no hay además un `Select` de estado ni un tile
por estado. Los contadores van sobre las pestañas (ver `prevencion/ppa`). No
repitas la misma cifra en dos controles.

## A5b — Un gráfico = una unidad por eje

Dos magnitudes de **escala distinta** no comparten eje: la chica queda pegada al
piso e ilegible. Usa eje doble (`yAxisId` + `<YAxis orientation="right">`) o dos
tarjetas.

- Litros (miles) + cargas (decenas) → la serie "Cargas" se aplanaba.
- Tasa de frecuencia (personas) + tasa de gravedad (días) → la de frecuencia se
  aplanaba, aunque las dos digan "× 1.000.000 / HH".
- Conteos + dinero → siempre eje doble, con tick compacto (`$1,2M`) para que
  quepa.

Corolario: **si consultas un campo, dibújalo o no lo consultes.** `amount` se
calculaba y se descartaba en los dos gráficos de flota. Derivada de la auditoría
`AUDITORIA_DASHBOARD_COBERTURA_GERENCIA_2026-07-31.md` (G-04).

## A6 — Consistencia de controles y vocabulario

- **Fechas**: usa el `DatePicker` del design system, no `<input type="date">`
  nativo (su formato depende del locale del navegador).
- **Estados**: nunca muestres el valor crudo de enum (`SUBMITTED`); mapéalo a
  label en español + `Badge`.
- **Abreviaturas de dominio** (`Acc. c/TP`, `HH`, `T1`) llevan `title`/Tooltip
  con el nombre completo, o se renombran.
- **Tipografía** (auditoría UI/UX 2026-11-07): caja de oración en rótulos,
  cabeceras e insignias (`text-eyebrow`, `th-type`, `Badge` ya lo hacen); piso
  de 11px (`text-2xs`); pesos 400–600; las cifras de `KpiCard`/`SummaryBar` se
  pasan como número y las palabras con `valueKind: "text"`. Dos reglas ESLint
  locales lo vigilan: `local/ui-type-scale` (prohíbe `uppercase` y
  `text-[9|10px]` en clases fuera de `components/pdf`, `(print)` y la app del
  mecánico) y `local/no-string-kpi-value` (prohíbe `value={String(n)}`).
- **Período**: un período de calendario se elige con `PeriodControl`
  (`components/ui/period-control.tsx`); granularidad o ventana móvil, con
  `SegmentedControl`. Se aplica al cambiar (`router.replace` + `scroll: false`),
  sin botón «Aplicar»/«Filtrar», salvo el rango personalizado dentro de su
  *popover*.
- **Exportar**: `ExportButton` (acción de servidor) o `ExportLink` (descarga
  GET), ambos de `components/ui/export-button.tsx`, con el rótulo «Exportar
  Excel», el ícono `EXPORT_ICON` y la variante `secondary`. No se arman
  enlaces de descarga a mano.
<!-- END:screen-density-rules -->

<!-- BEGIN:ui-audit-checklist -->
# UI Audit Checklist for Agents

When reviewing or building a page, explicitly consider:

- the 5-second comprehension test;
- KPI count and actionability;
- duplicate representation of the same dimension;
- duplicated text search;
- number of visible primary filters;
- discoverability of active filters;
- empty state + real CTA;
- correct placement of page-level actions;
- loading feedback;
- mutation success/error feedback;
- destructive-action confirmation;
- terminology consistency;
- date-control consistency;
- responsive overflow and clipping;
- keyboard accessibility and visible focus;
- console errors;
- failed network requests.

These checks also apply when interpreting `qa/reports/latest.md`.
<!-- END:ui-audit-checklist -->
