# Plan: panel de Mantención estilo Looker Studio

## Decisiones

1. **Cuatro pestañas en `/mantencion/panel`**: `Hoy` (el Panel actual, intacto), `Planificación`, `Camiones` y `Máquinas`.
2. **La matriz de checklist se construye importando el bloque «Detalle por ítem»** del consolidado: nueva tabla `mant_historical_schedule_items` + migración + importador.
3. **La próxima mantención usa la regla actual de `equipmentStatus`** (`punto + intervalo base`, `lib/mantencion/status.ts:53-57`), no la regla «programado + frecuencia» del ejemplo de Looker (339.990 → 340.000 → 380.000). Se documenta en la UI.
4. **Correctivo = histórico + nativo**: formularios importados (hasta el corte) y OT/registros de la plataforma, unificados y rotulados por fuente.

## Evidencia del relevamiento

- Panel actual: `app/(app)/mantencion/panel/page.tsx:66-151` (consultas), `:188-253` (layout). Exportación: `panel/actions.ts:46-99`.
- Estado de flota: `lib/services/mantencion/fleet.ts:97-306`; `equipmentStatus` en `lib/mantencion/status.ts:44-66`; `suggestInterval` en `lib/mantencion/schedule.ts:13-23`.
- Registros, ítems y fotos: `db/schema/mantencion-records.ts:32-110`, `:112-128`, `:203-242`.
- OT: `db/schema/mantencion-work-orders.ts:27-183`.
- Pautas: `db/schema/mantencion-schedules.ts:35-89`.
- Historial: `db/schema/mantencion-historical.ts:9-62`; pautas históricas: `db/schema/mantencion-historical-inspections.ts:93-131`.
- Parser que descarta el detalle: `lib/services/mantencion/consolidated-workbook.ts:334-338`, `:462-514`.
- El consolidado real trae en `PAUTAS_PREVENTIVAS`: `MECANICO`, `ITEMS_NO_REALIZADOS`, `OBSERVACIONES`, `IMG_FILTROS`, `IMG_STICKER`, y debajo la tabla «Detalle por ítem» (`FORMULARIO | ES_PRUEBA | FECHA | PATENTE | ID_EQUIPO | PAUTA | ITEM | RESULTADO`). La hoja `LEEME` advierte que los conductores no se cruzaron entre fuentes.
- UI reutilizable: `components/ui/dashboard-panel.tsx:36-115`, `components/dashboard/dashboard-section.tsx:30-112`, `components/ui/filter-toolbar.tsx:12-166`, `lib/hooks/use-url-filters.ts:13-96`, `components/ui/data-table.tsx:65-491`, `components/charts/bar-ranking-chart.tsx:64-195`, `components/mantencion/jefatura/registros/photo-gallery.tsx:13-50`.
- Tokens y tipografía: `app/globals.css:8-115`; la paleta `#27894d` es la del mecánico (`DESIGN.md:226`), se aplica scoped en este tablero.
- Referencia de pruebas: `e2e/indicadores-mantencion.spec.ts:24-198`.

## Brechas reportadas

| # | Brecha | Decisión |
|---|---|---|
| G1 | La regla «próxima = programado + frecuencia» no existe; `equipmentStatus` usa `punto + base`. | Se usa la regla actual y se dice bajo la tabla. |
| G2 | El consolidado trae mecánico, observaciones, ítems no realizados y fotos, pero el importador no los guarda. | Columnas nuevas nullable; fallback a `fields` JSONB para mecánico/observaciones. |
| G3 | La matriz ítem × mantención no existe en la base. | Tabla nueva + importación del detalle. |
| G4 | Las fotos históricas son enlaces de Google Drive. | Se guardan como URL y se muestran como enlaces; las nativas usan el visor existente. |
| G5 | Los conductores históricos son texto libre y no están cruzados. | Normalización por `nameKey`; horas prorrateadas y avisadas. |
| G6 | El detalle no trae marca temporal. | Vínculo por formulario + fecha + patente + pauta; ambigüedad = rechazo informado. |
| G7 | La frecuencia 250 h no existe en el seed actual. | El filtro se genera con los intervalos activos del alcance. |
| G8 | Hoy el cumplimiento solo lee el histórico y no aplica el corte. | Histórico `< 2026-12-01`; nativo `>= 2026-12-01`. |
| G9 | Sin reimportar el consolidado no hay detalle histórico. | Estado vacío honesto con la instrucción de reimportar. |
| G10 | Equipos sin pauta/lectura no tienen próxima ni faltantes. | Se muestran rotulados y al final; no se inventan ceros. |

## Filtros y filtro cruzado

- URL: `pestana=hoy|planificacion|camiones|maquinas`; manuales `desde`, `hasta`, `faena`, `equipo`, `frecuencia`, `page`; cruzados `x_equipo`, `x_ot`, `x_conductor`, `x_mes`, `x_faena`, `x_mecanico`, `x_check`.
- Navegación con `router.replace(url, { scroll: false })` y transición pendiente (`aria-busy`).
- Cambio de pestaña: enlace solo con `pestana` → filtros reiniciados.
- Cada bloque ignora la dimensión que él mismo emite (tabla km ignora `x_equipo`; barras de mes ignoran `x_mes`; matriz ignora `x_check`; tabla de OT ignora `x_ot`; etc.).
- Al fijar un filtro de nivel equipo (`x_equipo`, `x_ot`, `x_check`) se limpian los otros dos. `x_mes`, `x_conductor`, `x_faena` y `x_mecanico` son aditivos.
- Segundo clic elimina el filtro; chips uno por valor; «Borrar filtros» limpia todo y vuelve al período por defecto.
- Controles de faena/código/frecuencia reflejan los valores derivados del clic.
- Accesibilidad: el control enfocable es un `<button aria-pressed>` (Enter/Espacio); las barras son botones HTML; el combinado lleva leyenda de botones.

## Reglas de datos

- **Planificación**: `B` = lectura de la última preventiva; `A` = `suggestInterval(intervals, B).point`; `delta = A − B`; `próxima` = `status.nextReading`; `faltantes = status.remaining`. Orden por faltantes ascendente, nulos al final. Semáforo solo en la celda. Ajuste manual visible con ícono y motivo.
- **Correctivo**: unión de histórico (antes del corte), OT con ingreso a taller y registros kind C sin OT (desde el corte). Solo OT con `workshop_entry_at`. Unidad km para Camiones, h para Máquinas. Paginación de servidor. Conductores: nativos por tabla; históricos por `fields` con cabecera `CONDUCTOR`; horas prorrateadas.
- **Preventivo**: % por pauta = R / (R + NR), NA fuera. % por mes y por faena+mecánico = promedio de los % de cada pauta. % por patente con su nivel. Matriz: últimas 8 pautas, filas = unión de ítems, celdas R/NR/NA/—; fotos arriba y observaciones abajo.
- Agregaciones en SQL; el único orden client-side es el de las tablas de Planificación (≤120 filas), justificado.

## Cambios de esquema e importación

- `mant_historical_schedule_checks`: `mechanic`, `observations`, `items_not_done text[]`, `filters_photo_url`, `sticker_photo_url` (nullable).
- Nueva `mant_historical_schedule_items`: `source_key` PK, `check_source_key` FK, `item_name`, `result` (`realizado|no_realizado|no_aplica`), `sort_order`, `imported_at`; unique `(check_source_key, item_name)`, índice `(check_source_key, sort_order)`.
- Parser: leer el bloque «Detalle por ítem» tras la fila en blanco; vincular por formulario + fecha + patente + pauta; rechazar ambigüedad. Sin tocar `fields` ni el fingerprint.
- Importador: persistir columnas nuevas y reemplazar los ítems de cada pauta en la misma transacción; reportar creados/actualizados/rechazados.
- Migración generada con `npm run db:generate`; checksums con `npm run db:verify-migrations -- --update-checksums`. Nunca editar el journal a mano.

## Archivos

- Servicios: `lib/services/mantencion/looker/{filters,resolve,planning,corrective,preventive,types}.ts`.
- UI: `components/mantencion/panel/looker/{panel-tabs,filter-bar,multi-select-popover,filter-toggle,cross-filter-row,cross-filter-bars,compliance-bar,delta-bar-chart,hours-records-combo-chart,planning-tables,checklist-matrix,corrective-panel,preventive-panel,work-control-tab}.tsx`.
- Páginas: `app/(app)/mantencion/panel/{page,hoy-tab,planificacion-tab,camiones-tab,maquinas-tab}.tsx`.
- Primitivo compartido: `FilterToolbar` gana `clearLabel` opcional.
- Estilos: clase scoped `mant-looker` con `--mant-green:#27894d`, `--mant-amber:#ffd51e`, `--mant-orange:#f39200`, `--mant-gray:#4b4f54`, `--mant-black:#1d1d1b`, `--mant-bg:#f5f7f6`. Exo en títulos, Myriad en cuerpo, Geist Mono en cifras. Sin glassmorphism, blur, degradados ni sombras fuertes.

## Verificación

- Unitarias: parseo/toggle/chips, reglas de planificación, matriz, tablas, despacho por pestaña.
- PGlite: unión correctiva + paginación + alcance; cumplimiento/matriz/corte; importación idempotente del detalle.
- E2E secuencial con estado (`e2e/mantencion-panel-looker.spec.ts`): cargar pestaña, clic en fila, verificar otros bloques y chip, segundo clic, «Borrar filtros», recarga con URL, cambio de pestaña, teclado y consola limpia.
- Puertas completas: `npm run typecheck`, `npm run lint`, `npm run check:secrets`, `npm run test:fast`, `npm run test:pglite`, `npm run test:e2e` (suite completa), `npm run db:verify-migrations`.
- Capturas desktop/móvil en `audit/screenshots/mantencion-panel-looker/` y informe en `qa/reports/mantencion-panel-looker-2026-11-23.md`.
- Comparación con Looker: no hay captura del panel original en el repositorio; se compara contra la estructura descrita y el consolidado, documentando G1, G4, G5, G7 y G9.

## Fuera de alcance

- Cambiar `equipmentStatus` o el semáforo del resto del módulo.
- Proxy o descarga de fotos de Google Drive.
- Exportaciones nuevas para las pestañas Looker.
- Drill-down o navegación entre gráficos.
- Reimportar el consolidado en producción (paso operativo posterior).
