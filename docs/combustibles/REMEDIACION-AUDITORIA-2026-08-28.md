# Remediación auditoría Copec / Aramco — 2026-08-28

Estado: **17/17 hallazgos cerrados en código**. Quedan 2 acciones que sólo se
pueden hacer sobre producción (§ Pendiente en producción).

| # | Hallazgo | Sev. | Estado | Dónde |
|---|----------|------|--------|-------|
| 1 | El set `pending` de Copec nunca se vacía → `rowsPending` crece para siempre | P1 | hecho | `copec-sync.ts` |
| 2 | Doble conteo de `rowsPending` en Copec | P1 | hecho | `copec-sync.ts` |
| 3 | Aramco: gasolina/kerosene se descartaba en silencio | P1 | hecho | migración 0230, `provider-validation.ts`, `fuel-sources.ts`, `fuel-products.ts` |
| 4 | `fuel_meter_readings.occurred_at` mezclaba dos bases de tiempo | P1 | hecho | `meter-readings.ts` |
| 5 | `fuelSupplierIdForProvider("aramco")` devolvía `null` en producción | P1 | hecho (código) | `fuel-sources.ts`, `fuel-reconciliation.ts` |
| 6 | Copec TCT no podía conciliar: agregado mensual vs cargas individuales | P1 | hecho | migración 0231, `provider-validation.ts`, `fuel-reconciliation.ts` |
| 7 | Las acciones manuales no tomaban el lock del cron | P2 | hecho | `copec-sync-action.ts`, `aramco-sync-action.ts` |
| 8 | `withCronLock` podía desbloquear en otra conexión del pool | P2 | hecho | `cron-lock.ts` |
| 9 | Una fila corrupta de Aramco bloqueaba toda la sincronización | P2 | hecho | `aramco-client.ts`, `aramco-sync.ts` |
| 10 | Lote huérfano con datos obsoletos cuando el grupo desaparecía | P2 | hecho | `open-period.ts` + ambos syncs |
| 11 | `copecProjectionHash` sensible al orden de filas | P2 | hecho | `copec-sync.ts` |
| 12 | RUT de chofer/atendedor en `fuel_consumption_records.raw_row` | P2 | hecho (código) | `meter-readings.ts`, `consumption-import.ts` |
| 13 | Cron de Copec sin credenciales reportaba `failed` | P3 | hecho | `copec-reports.ts`, ruta cron |
| 14 | Tres `normalizePlate`; `source_plate` con dos formas | P3 | hecho | `provider-validation.ts`, `fuel-provider-ledger.ts` |
| 15 | `[await a, await b]` secuencial disfrazado de paralelo | P3 | hecho | `fuel-reconciliation.ts` |
| 16 | `documentNumber` sin escapar en el query string de Aramco | P3 | hecho | `aramco-client.ts` |
| 17 | `getCopecSyncPlan` no acotaba los períodos por corrida | P3 | hecho | `copec-sync.ts` |

## Cambios que alteran comportamiento observable

- **Hash de proyección Copec (#11).** Ordenar las filas cambia el valor del
  hash, así que en el primer despliegue **todos** los lotes TCT existentes se
  reconstruyen una vez. Es idempotente (`replaceBatchRecords`) y no toca
  vínculos manuales de vehículo, pero deja `updated_at` nuevo en esos registros.
- **Tope de 4 meses por corrida Copec (#17).** Un cursor muy atrasado ya no
  planifica el histórico entero: avanza de a 4 meses por corrida.
- **Instante de las lecturas Aramco (#4).** Las filas de `fuel_meter_readings`
  con `source = 'aramco'` se corrigen solas al pasar la ventana de 4 meses del
  cron. Lo anterior a esa ventana queda con hora de pared hasta que se
  reprocese; el histórico completo de la cuenta son 154 transacciones.
- **Fuentes nuevas de Aramco (#3).** `Aramco Fleet Gasolina` y
  `Aramco Fleet Kerosene` se suman a `ARAMCO_SOURCES`. Si la cuenta llega a
  transar esos productos, aparecen lotes que antes no existían.
- **Migración 0231** borra los `fuel_reconciliation_links` que la conciliación
  había producido cruzando evidencia agregada: eran `unmatched` por
  construcción y ensuciaban `unmatched_reconciliation_links` del preflight.

## Pendiente en producción

1. **Ficha del proveedor Aramco en `fuel_suppliers` (#5).** El código ahora
   busca por `aramco`, `esmax` y `petrobras`, avisa por log si no encuentra
   nada y cierra la corrida como `partial` con el motivo. Pero la ficha la crea
   operación, no el código: mientras no exista, la conciliación de Aramco
   seguirá sin poder cruzar. Verificar con:
   `select id, name, is_active from fuel_suppliers;`
2. **Purga de los RUT ya guardados (#12).** El código dejó de escribirlos, pero
   `fuel_consumption_records.raw_row->'detalle'` conserva los de las cargas
   anteriores. Se limpian solos al refrescarse el período; los meses cerrados
   necesitan un `UPDATE` dirigido sobre esa columna, que es una operación de
   datos y requiere autorización aparte.

## Verificación

- `npx vitest run` — 4957 pasan. Los 4 fallos restantes (`fleet-onway-sync`,
  `pdtp-2026-contract`, `prevention-pdtp-catalog`, `capture-all-routes`) fallan
  igual en `HEAD` sin estos cambios: fixture `PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx`
  ausente e inventario de rutas desactualizado.
- `npx vitest run --config vitest.pglite.config.ts` — 875 pasan. Los 53 fallos
  (`prevention-pdtp`, `module-toggles`, `stock-export`) también se reproducen en
  `HEAD`, verificado. Los casos nuevos de granularidad y de alias de proveedor
  pasan, y de paso confirman que 0230 y 0231 aplican limpio.
- `npx tsc --noEmit` y `npx eslint` limpios sobre lo tocado.
- Migraciones nuevas: `0230_seed_fuel_gasoline_kerosene`,
  `0231_provider_transaction_granularity`. **No aplicadas en producción.**

---

## Anexo: fallos preexistentes de la suite (2026-08-29)

Cuatro familias de fallo que ya venían de antes de esta remediación, con su
causa raíz. Todas corregidas.

| Test | Causa raíz | Remedio |
|---|---|---|
| `fleet-onway-sync/route.test.ts` (1) | El mock de `syncOnway` omitía `warnings`, que `SyncOnwayResult` declara obligatorio y la ruta lee (`result.warnings.length`) para elegir entre `success` y `partial`. Reventaba con TypeError dentro del `try` y la corrida se clasificaba como `failed` (503). Nació roto en `94f87ae`; `vi.fn()` no está tipado, así que TS no lo cazó. | Mock completo con los 10 campos del contrato. |
| `pdtp-2026-contract` (1), `prevention-pdtp-catalog` (1), `prevention-pdtp` (50) | `65c2b2b chore: limpia documentos historicos de la raiz` borró `PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx` (4,5 MB), que 52 casos leen desde la raíz del repo. Cada uno resolvía la ruta por su cuenta, así que no había un solo lugar donde arreglarlo. | Libro restaurado bit a bit (sha256 y tamaño coinciden con `PDTP_2026_SOURCE`) en `tests/fixtures/`, con la ubicación declarada UNA vez en `PDTP_2026_SOURCE.repoPath`. Añadido a `.dockerignore`: en la raíz también viajaba al contexto de build. |
| `module-toggles` (1) | Tres crons (`feedback-sla-reminders`, `fleet-onway-retention`, `fleet-onway-sync`) nunca se registraron en `NAV_ROUTE_TARGETS`. Dos de ellos además ignoraban el toggle: apagar Soporte o Monitoreo GPS cerraba la UI mientras el cron seguía mandando correos y purgando datos. | Los tres registrados, y los dos que faltaban ahora consultan `isRouteOperational` como el resto. |
| `stock-export` (1) | La unificación del vocabulario de movimientos (`e368def`) cambió `egreso_desecho` de «Retiro» a «Baja»; la prueba de exportación quedó con la palabra vieja. «Retiro» además ya nombra otra cosa (`retiro_epp_trabajador`). | La prueba compara contra `MOVEMENT_TYPE_LABELS`, no contra un literal duplicado. |

`capture-all-routes` aparecía fallando en las primeras corridas: era ruido de
otro proceso commiteando rutas sobre este mismo checkout a mitad de la
ejecución. Pasa de forma estable.

**De paso:** `scripts/generate-pdtp-2026-sanitized-fixture.ts` colocaba las filas
de `PDTP GENERAL` con `13 + activityNumber`. Como en esa vista faltan las
actividades 4 y 8, todo lo posterior al primer hueco quedaba una fila corrida y
las celdas E caían fuera de donde el contrato las fija (`F19` en vez de `F18`).
El extractor lee secuencialmente, así que los conteos cuadraban y el desfase no
se veía. Corregido a `14 + index`.
