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
