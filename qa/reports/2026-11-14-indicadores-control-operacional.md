# QA — Indicadores de Control operacional (GPS, Mantención, Combustible)

Fecha: 2026-11-14 · Rama: `feat/indicadores-control-operacional` · Entorno: `next dev` :3002 (worktree) contra `bodega_dev` (clon de prod con datos mock) y E2E contra `bodega-e2e-postgres`.

## Alcance recorrido

| Ruta | Escritorio 1440 | Móvil 390 | Datos |
|---|---|---|---|
| `/flota/indicadores` | sí | sí | sembrados `QA_ind_*`: 1.773 lecturas GPS (5 camionetas OnWay, 4 máquinas Wialon), 1.423 viajes y 406 alertas, jun–nov 2026; VisionLink real del clon |
| `/mantencion/indicadores` | sí | sí | los del clon: 36 OT, 545 registros, 222 intervalos operacionales |
| `/combustibles/indicadores` | sí | sí | los del clon (cargas, libro Copec, telemetría) |

No recorrido: roles acotados en navegador (lo cubren las pruebas PGlite de alcance y la E2E de navegación), períodos semana/trimestre de Combustible, la exportación a Excel de «Ver datos».

## PASS (verificado)

- Las tres páginas cargan con su título, las dos secciones y sus gráficos; 0 errores de consola y 0 peticiones fallidas (sin contar el avatar externo); sin desborde horizontal a 1440 ni a 390.
- Ningún esqueleto `[data-chart-loading]` queda colgado; ninguna celda de gráfico vacía.
- Ítems de menú nuevos en su grupo: «Indicadores GPS» (Flota), «Indicadores» (Mantención y Combustible); estado activo correcto.

## Hallazgos de la primera pasada (corregidos y re-verificados)

| Tipo | Hallazgo | Arreglo |
|---|---|---|
| INCONSISTENCY | Combustible mostraba litros de dos fuentes: el tile (cargas, 1.684 L en nov) y el gráfico «Litros y costo» (libro Copec, 537 L) | Los litros salen siempre de las cargas; el libro queda como «Costo del libro de Copec por mes» con precio por litro, sólo con `view_costs` |
| INCONSISTENCY (A5) | Titulares de gráfico repetían la cifra del tile (km, horas, % ralentí, viajes, registros preventivos, OT en cola) | Titulares con el balde pico o la conclusión (p. ej. «16.535 km en jul 2026, el mes de más recorrido»; «36 % de los registros fueron correctivos») |
| PRODUCT BUG | Días fuera de servicio: tile 81,8 y titular 81,7 (doble redondeo) | Un solo cálculo y redondeo; el titular dice el pico |
| UX FINDING | Ranking «Equipos con más OT de reparación» con 8 empatados en 1 OT, coronando a uno | Sólo equipos con ≥ 2; empates dichos como empate |
| UX FINDING | Celdas huérfanas (media fila vacía) en GPS y Eficiencia de Combustible | Reparto de anchos que cierra filas a 2 y 3 columnas |
| FUNCTIONAL FINDING | Variaciones de +482 % contra un período anterior casi sin lecturas | GPS no muestra la variación sin base comparable (cobertura anterior < 50 % de la actual) |
| UX FINDING | El mes en curso coronado como «el período con más» en Mantención | El balde parcial no compite por el pico |

## Revisión de código (corregido)

- PRODUCT BUG: GPS filtraba `operational_status <> 'inactivo'`, valor que no existe en la columna: los equipos dados de baja entraban en flota, vinculados, km y rankings. Ahora `is_active = true` (prueba PGlite nueva).
- PRODUCT BUG: el costo del libro (mensual) se comparaba en períodos semana/rango, comparando un mes consigo mismo. Ahora sólo entre períodos de meses completos (prueba nueva).
- Rango `desde`/`hasta` sin tope en GPS/Mantención: acotado a 5 años (prueba nueva).
- División por cero posible en el titular de eficiencia; el libro ya no se consulta sin `view_costs`.

## Pruebas deterministas

- `npm run typecheck`, `npm run lint`: OK.
- `npm run test:fast`: 1.354 archivos OK (32 omitidos). `npm run test:pglite`: 383 archivos OK.
- E2E: `indicadores-gps` (6), `indicadores-mantencion` (7), `indicadores-combustibles` (5 + 1 omitido por falta de datos en la base E2E), `control-operacional-navegacion` (29), `densidad-kpi-filtros` (13), `densidad-kpi` (19), `dashboard-rediseno` (5 + 1 omitido por datos).
- Tras los arreglos de la revisión de código se re-corrieron typecheck, eslint y las suites dirigidas (no la E2E completa).

## COVERAGE GAPS

- Prod tiene pocas lecturas de medidor GPS (en dev había 3 antes de sembrar): el tablero GPS en prod mostrará sobre todo lo que informen OnWay/Wialon/VisionLink desde que se sincronizan; verificar tras el deploy.
- Los gráficos GPS no ofrecen Excel: `flota` no tiene permiso `*:export` en `CHART_EXPORT_PERMISSIONS`.
- Los datos `QA_ind_*` quedan en `bodega_dev` para mirar el tablero GPS; se borran con `DELETE … WHERE id LIKE 'QA_ind_%'` en `fuel_meter_readings`, `fleet_gps_trips` y `fleet_gps_alerts`.

## Segunda pasada: «en su mayoría gráficos» (2026-11-14)

Pedido del usuario: «los paneles o dashboards deben contener en su mayoría GRÁFICOS». La primera versión abría cada sección con 3–4 tiles grandes y la mitad de las celdas eran listas (`RankedList`) o barras de reparto (`ShareBar`).

- Sin tiles: las cifras del período van en una tira compacta (`SummaryBar numerals="sans"`), cada una con su enlace.
- Rankings y repartos por estado como barras horizontales (`components/charts/bar-ranking-chart.tsx`, nuevo y compartido): GPS 4, Mantención 3, Combustible 2.
- Gráficos de a dos por fila en `xl`: reparto único en `lib/indicators/chart-layout.ts` (reemplaza los tres helpers por dominio), que prioriza no dejar huecos en `xl`.
- Combustible › Eficiencia sin párrafos bajo los gráficos (la advertencia pasa a la descripción y al Excel).
- Arreglos en piezas compartidas vistos en el recorrido: la variación de la tira usa la fuente de la cifra (iba en mono junto a cifras sans) y la cifra no se corta («1.684 / L»); la etiqueta de la barra no se parte.

Verificación: recorrido en `next dev` :3002 contra `bodega_dev`, escritorio 1440 y móvil 390, en las tres rutas: 0 errores de consola, 0 peticiones fallidas, sin desborde; 8 / 6 / 12 gráficos dibujados. `typecheck`, `lint`, `test:fast` (1.354 archivos), `test:pglite` (383) y E2E `indicadores-gps` (7), `indicadores-mantencion` (7), `indicadores-combustibles` (6 + 1 omitido por datos), `control-operacional-navegacion` (29), `densidad-kpi-filtros` (13), `densidad-kpi` (19), `dashboard-rediseno` (5 + 1 omitido por datos): todo en verde.

Pendiente observado (no nuevo): «Días fuera de servicio» muestra +1.008 % porque el período anterior casi no tiene intervalos registrados; GPS ya oculta variaciones sin base comparable, Mantención no.

## Tercera pasada: los Indicadores son el Panel (Mantención y Combustible)

Pedido del usuario: «Indicadores debe ser el panel de mantención y de combustibles». Eligió
«franja arriba + gráficos».

### Qué cambió

- **`/mantencion/panel`** abre con la franja «Hoy» (`PanelToday`: órdenes por asignar, equipos en
  taller y registros por revisar, sin período, acotada por faena) y debajo los gráficos de Órdenes
  de trabajo y Pautas y disponibilidad. Salieron los tiles y las tarjetas-lista (En taller ahora,
  Próximas mantenciones, Estado de la flota, Registros por semana, Horas por faena, Ítems sin
  hacer). El Excel del Panel (`exportPanel`, últimos 30 días, con esas listas) sigue en el header.
- **`/combustibles`**: jefatura ve el avance y la tira de cinco pasos y debajo Consumo y Eficiencia;
  consulta ve sólo los gráficos; terreno y contrato conservan su estación de trabajo sin gráficos.
  Salieron «Lo que vence primero», «El período en tres cifras» y el panel de consulta en tres frases.
- `/mantencion/indicadores` y `/combustibles/indicadores` redirigen (308) al Panel con sus
  parámetros; sus ítems de menú se borraron. Los enlaces «Panel de …» dentro de las secciones (que
  ahora apuntaban a la misma página) salieron, y «OT abiertas» ya no repite «N por asignar» (A5).

### Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | 0 / 0 (sin advertencias) |
| `npm run test:fast` | 1353 archivos OK, 32 omitidos |
| `npm run test:pglite` | 383 archivos OK (incluye `countPendingReview` e `inWorkshop` por alcance) |
| E2E | indicadores-mantencion 7, indicadores-combustibles 7 + 1 omitido por datos, mantencion-2-jefatura 13, combustibles 14, control-operacional-navegacion 29, densidad-kpi-filtros 13, densidad-kpi 19, mantencion-4-permisos 5, control-operacional-combustible 2, keyboard-navigation 19 |

`mantencion-2-jefatura` falló una vez («anular… desaparece de los cálculos») porque leía el tile
«Registros ·» que ya no existe; ahora mide el titular de Registros firmados y pasa.

Recorrido en navegador (`next dev` :3002 contra `bodega_dev`, 1440 y 390 px): `/mantencion/panel`
(franja «Hoy» + 6 gráficos), `/combustibles` como jefatura (tira de pasos + 12 gráficos) y las dos
direcciones viejas, que llegan al Panel. 0 errores de consola, 0 peticiones fallidas, sin desborde
horizontal.

### Pendientes y riesgos

- Las variantes consulta, terreno y contrato de Combustible no se recorrieron en el navegador (el
  usuario QA es jefatura); las cubren las pruebas de la página.
- Terreno y contrato ya no tienen camino a los gráficos (antes: el ítem «Indicadores»).
- El Excel del Panel de mantención mira los últimos 30 días, no el rango de la pantalla; su hoja
  de metadatos lo dice.
