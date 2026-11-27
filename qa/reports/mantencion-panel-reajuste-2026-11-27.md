# Reajuste del Panel de mantención (`/mantencion/panel`) — 2026-11-27

Rama `feat/mant-panel-reajuste` (sin commit). Referencia visual: `Mockup_Panel_Mantencion_Looker.html`.

## Qué cambió

- **Pestañas:** `pestana=hoy|planificacion|correctivo|preventivo`. La unidad pasa a `unidad=km|h` (km por defecto, omitido en la URL) y vale para las tres pestañas, incluida Planificación, que ahora muestra una sola tabla. Bajo las pestañas va la pregunta que responde cada una (`components/mantencion/panel/looker/panel-tabs.tsx`). Se eliminó la composición en dos columnas (`work-tab.tsx`, `work-control-tab.tsx`).
- **Planificación:**
  - Tira de cifras que filtra por `estado` (`planning-summary.tsx`).
  - «Faltantes para la próxima mantención» (`remaining-bars.tsx` sobre `BulletBar`).
  - «¿Se hizo a tiempo…?» (`CrossFilterBars` con `format`; `timingText`/`timingTone` en `planning-rules.ts`).
  - Tabla «Detalle por equipo» de 10 columnas.
  - Filtro por fechas (`planning-date-filter.tsx`: `PeriodControl` sobre `fecha_desde`/`fecha_hasta` y atajos de 7, 30 y 90 días que sólo fijan `fecha_hasta`).
  - Fecha estimada en el servidor (`planning-estimate.ts`, llamada desde `toPlanningRow`).
- **Correctivo:**
  - Tira de cifras calculada en SQL (`corrective-summary.ts`).
  - Combinado a fila completa con la patente en el eje.
  - Conductores (top 10) y trabajos por mes en columnas (`monthly-work-chart.tsx`).
  - Tabla «Trabajos del período» paginada en el servidor (`corrective-table.tsx`).
  - Se quitó la tabla de conductores (A5).
  - La unión pasó a `corrective-union.ts` y ahora filtra por `x_mes`.
- **Preventivo:**
  - Tira de cifras.
  - Cumplimiento por mes en columnas (`monthly-compliance-chart.tsx`).
  - Cumplimiento por faena y mecánico, de menor a mayor.
  - «Cumplimiento por equipo» con «Sin hacer», «Última pauta» y «Fotos completas», ordenado por lo que quedó sin hacer.
  - Ficha del equipo (`equipment-check-sheet.tsx`, `check-detail-view.tsx`, `check-evidence.tsx`) con su cargador `loadEquipmentCheckDetail` (`lib/services/mantencion/looker/equipment-check-detail.ts`).
  - `preventive.ts` se dividió en `preventive-checks.ts` y `preventive-matrix.ts`.
- **Patente y embudo** (`equipment-cell.tsx`): la patente navega (al historial en Planificación y Correctivo, a la ficha en Preventivo) y el embudo filtra (`aria-label` «Filtrar el panel por …»). Ningún elemento hace las dos cosas.
- **Filtros:** `filters.ts` se dividió en `filters.ts` (parseo), `filter-hrefs.ts` (enlaces) y `filter-chips.ts` (chips).
- **Exportación:** un libro por pestaña (`export.ts`, `export-corrective.ts`, `export-preventive.ts`, `export-planning.ts`). «Filtros» incluye la unidad, el estado y el rango de fechas.

## Compatibilidad de URL: redirect

`pestana=camiones|maquinas` se redirige en `page.tsx` (`legacyTabRedirect`, `filters.ts`) a `pestana=correctivo`, más `unidad=h` en el caso de `maquinas`. Los demás parámetros se conservan.

Además, `parseLookerTab`/`parseLookerUnit` hacen la misma conversión. Es el respaldo para la acción de exportar, que también acepta `camiones`/`maquinas` (`looker-export-action.ts`).

Elegí el redirect para que la URL quede canónica: las pestañas, los chips, el botón «Exportar» y los enlaces compartidos ven sólo el valor nuevo.

## Brechas

1. **Histórico sin sistema ni motivo por ítem.** `mant_historical_schedule_items` no trae ninguno de los dos. En la ficha, el sistema se resuelve sólo si el nombre coincide exacto con un único ítem de la pauta vigente del equipo; si no, queda «Sin sistema». El motivo dice siempre «Sin motivo en el formulario»: no se inventan motivos. Si una pauta histórica no trae ítems pero sí `items_not_done`, se muestran esos nombres y se avisa.
2. **Equipos sin datos para estimar la fecha.** Aparecen con «—» y el motivo en el `title` (y en «Observación» del Excel). Los casos:
   - menos de 2 lecturas en 30 días;
   - uso ≤ 0;
   - uso sobre `JUMP_LIMITS.perDay`;
   - sin pauta o sin lectura;
   - fecha a más de 10 años.

   La fecha se calcula desde la última lectura conocida, o la del GPS si es más nueva.
3. **No hay ruta para la pauta de un formulario histórico.** `/mantencion/registros/historicos/[id]` es el trabajo, no la pauta. Para pautas históricas el pie de la ficha ofrece sólo «Historial del equipo».
4. **«Sin foto de respaldo» (Correctivo) cuenta sólo OT y registros de la plataforma.** El importador de formularios descarta las columnas de foto, así que los históricos inflarían la cifra.
5. **«Pautas con fotos incompletas» (Preventivo).** Cuenta como incompletas las históricas importadas sin enlaces de foto, lo que podría inflar la cifra en datos viejos. **Revisado en producción el 2026-11-27** (consulta de sólo lectura): hay 4 pautas históricas (julio, agosto y dos de octubre de 2026), todas importadas el 22-11 y todas con las dos fotos. Con los datos reales la cifra no se infla, así que no se cambió el cálculo.
6. **La grilla «Un mes» de `PeriodControl` deshabilita meses futuros.** Para un rango futuro de la próxima mantención sirven los atajos, los presets o el rango manual.
7. **Agregaciones fuera de SQL.** Los conteos por estado de Planificación y los conductores se arman en el servidor en TS, sobre `loadFleet` y la unión correctiva, no en SQL. Las cifras nuevas de Correctivo y las fotos y el «sin hacer» de Preventivo sí van en SQL. El cliente sólo dibuja.
8. **Ficha y filtros cruzados.** La ficha muestra el período completo del equipo e ignora los filtros cruzados (mes, mecánico): sus números pueden diferir de una tabla filtrada.

## Diferencias con el mockup y la regla que las motivó

- **Ficha:** el mockup la dibuja como panel lateral. Se usó `Sheet` tal cual (modal centrado, `stableHeight`), según el prompt y DESIGN.md «Modales multivista».
- **Matriz de checklist:** el mockup la rediseña (filas Nivel, Mecánico y Evidencia; fila «% realizado»). Se mantuvo la matriz existente; el prompt no pedía ese cambio.
- **Encabezado de la matriz:** muestra la patente (el código si el equipo no la tiene), igual que el resto del panel, también en las observaciones y en el visor de fotos (`checklist-matrix.tsx`). Se actualizaron sus localizadores en las E2E. La hoja «Matriz de checklist» del Excel conserva el código en el encabezado, y «Pautas de la matriz» trae código y patente en columnas aparte.
- **Filtro de frecuencia:** se conservó, aunque el mockup no lo muestra. Quitarlo habría eliminado funcionalidad, y el prompt lo nombra entre los parámetros.
- **Tira de Planificación:** usa `SummaryBarStatCell` con `renderLink` por cifra, porque `SummaryBar` no permite marcar la cifra activa (`aria-current` y la palabra «filtrando»).
- **Cambio de unidad:** además de lo pedido (`equipo`, `x_equipo`, `estado`, `ficha`), suelta `frecuencia`, `x_ot`, `x_check`, `pauta` y `page`. Todos nombran un equipo o una frecuencia de la otra unidad.
- **«Borrar filtros»:** conserva la unidad. No es un filtro sino la vista de la pestaña.

## Resultado de cada comando

| Comando | Resultado |
|---|---|
| `npm run typecheck` | 0 errores |
| `npx eslint` sobre todos los archivos cambiados y nuevos | limpio |
| `npx vitest run` de `app/(app)/mantencion/panel`, `components/mantencion/panel`, `components/charts`, `lib/services/mantencion/looker`, `components/__tests__` | 79 archivos, 7.879 pruebas OK (antes del último ajuste de diseño). Tras ese ajuste: 22 archivos, 399 pruebas OK |
| PGlite `looker-pglite`, `looker-export-pglite`, `equipment-check-detail-pglite` | OK (20/20 en exportación; 10/10 en la ficha) |
| E2E: `mantencion-panel-looker`, `-cobertura`, `-export` y la nueva `-flujo` (build de producción, base propia `_e2e`) | 39 OK, 2 omitidas, 0 fallas. El flujo pasó 4 de 4 con `--repeat-each=4` |
| `npm run check:secrets`, `test:fast` y `test:pglite` completos, `test:e2e` completo | **No corridos localmente**, por decisión del usuario (tiempo). Los cubre el CI antes del deploy |
| `npm run db:verify-migrations` | No aplica: no hay cambios de esquema |

**Las 2 omitidas.** Son el motivo de lo no realizado en un registro nativo y la foto de la matriz. Están condicionadas a `hoy >= 2026-12-01` (corte de formularios): antes de esa fecha no hay registros nativos que contar. El motivo nativo sí está cubierto en PGlite y en las pruebas unitarias.

**Último ajuste de diseño, sin E2E repetida.** Se hizo después de la corrida E2E:
- el combinado de Correctivo a fila completa;
- `DenseChart` bajo 360 px;
- el encabezado de la tabla de Planificación.

No toca localizadores E2E (el `caption` de la tabla no cambió).

## Capturas

`audit/screenshots/mantencion-panel-reajuste/`, con `{planificacion,correctivo,preventivo,ficha}-{escritorio-1600,movil-390,movil-340}.png`.

A 390 y 340 px no hay scroll horizontal de página, las tablas pasan a tarjetas y la ficha ocupa la pantalla con objetivos de 44 px. Las capturas son anteriores al último ajuste de diseño.

## Riesgo restante

- `lib/services/mantencion/looker/types.ts` tiene 418 líneas: pasa el objetivo de 300, bajo el techo de 500.
- Sólo se probó Chromium con emulación móvil, no WebKit real.
- A 340 px la cabecera del shell se parte en tres líneas. Está fuera de este cambio.
