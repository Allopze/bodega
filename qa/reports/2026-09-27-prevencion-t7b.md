# Tanda T7b: rendimiento del cumplimiento PDTP (I12) (2026-09-27)

T7b cierra la tanda T7 del plan de pendientes de la auditoría de Prevención (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, sección T7, ítems I12; auditoría `2026-09-26-prevencion-production-readiness.md`, hallazgo PREV-I12). Rama `prevencion/t7b-rendimiento`, sobre `e1c48698` (integración de la ola 3: T0–T6 y T7a, migraciones hasta 0333). **Sin migración.**

Decisión aplicada: **D25** con su valor por defecto. El pool sigue en 10 y no hay caché entre requests. `db/index.ts` no cambió; una prueba vigila las dos cosas.

Requisito duro: **ninguna cifra de cumplimiento cambia.** Abajo está la evidencia.

## Qué cambió

| Ítem I12 | Cambio | Archivos |
|---|---|---|
| Carga por lote | `loadProgramScheduleAndExecutionsForWorksites` trae calendario, ejecuciones, overrides, exclusiones, vigencia y desvíos de **todas** las faenas con 6 consultas fijas, más 1 de ocurrencias enlazadas. Antes eran 7 por faena. La costura (overrides → exclusiones → vigencia → desvíos → vigencia) se aplica faena por faena con sus propias filas. `loadProgramScheduleAndExecutions(…, faena)` es el mismo cargador con una sola faena. `loadWorksiteAddedAtMap` lee la incorporación de todas las faenas en una consulta | `helpers.ts`, `overrides.ts`, `deviations.ts` |
| Padrón por lote | `loadPdtpSubjectRosterBatch` hace una consulta por fuente, agrupada por faena. Dotación, extintores, equipos y expuestos GES usan las mismas condiciones que antes. El flujo (trabajadores nuevos) se agrupa por faena y mes, con un `CASE` sobre los mismos límites de texto por mes que la consulta individual. Las capacidades se consultan una vez por conjunto de códigos. Antes era una consulta por actividad y faena, y **doce** por cada actividad de flujo. Los textos de explicación y el estado salen de las mismas funciones en las dos vías | `subject-registry.ts` |
| Indicador por lote | `loadPdtpIndicatorInputsForTargets` carga, una vez por versión y para todas las faenas, lo siguiente: calendario y ejecuciones, incorporación, ocurrencias, estado de las ejecuciones enlazadas, parámetros, padrón, obligaciones y exclusiones del piso anual. Cada faena se arma con `assemblePdtpIndicatorInputs`, que es el cálculo de antes trasladado tal cual. `computePdtpIndicatorsFromInputs` queda puro, porque las exclusiones del piso anual ahora viajan en las entradas. El tablero consolidado, el año por faena y el alcance usan `computeYearIndicatorsForTargets`: una membresía por versión y entradas por lote | `compliance.ts` |
| Núcleo único con el integral | `getPdtpComplianceWithIntegral(programa, faena)` devuelve `{ indicators, integral }` a partir de las mismas entradas. `ejecucion` es `annual.percent`, y verificación y cierre miran exactamente `approvedExecutionIds`, con el mismo corte por faena y la misma ventana. `getPdtpIntegralCompliance` es ahora su proyección y ya no recalcula el indicador entero. La ficha del programa y la foto del cierre de mes (`buildPdtpClosureSnapshot`) lo usan | `compliance.ts`, `[programId]/page.tsx`, `period-closures.ts`, `index.ts` |
| Eje sin bucle secuencial | `getPdtpComplianceByCategoryForScope` lee las obligaciones una sola vez para todas las faenas y las reparte por faena para el piso anual. Antes había una consulta por faena, en serie. Corren en paralelo el calendario, las obligaciones y las exclusiones. `loadClosedOnTimeByActivityMonth` pasa a ser `loadClosedOnTimeRows` + `tallyClosedOnTime`, con la misma regla | `compliance.ts` |
| Integral por alcance | Las ejecuciones de cada versión se cargan por lote, con las versiones en paralelo. Se conserva que este integral lea las ejecuciones de todas las faenas en cada versión, aunque la faena no opere esa versión; así era antes | `compliance.ts` |
| Planilla agregada | `getPdtpAggregatedSheetViewByProgram` usa la carga por lote. Es la lectura de "Atrasadas" del tablero | `sheets.ts` |
| `React.cache` | `request-cache.ts` agrupa las lecturas base con argumentos primitivos: programa por id, programa del año, ventana de versión, ventanas del año y actividades del programa. Las usan el indicador, el eje, el integral y la planilla, así que en un render el tablero y la ficha leen cada una una vez. Se siguió la guía de `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` ("Deduplicating requests"). Fuera de un render de Server Components `cache` no memoriza: en pruebas, scripts, crons y server actions todo se consulta como antes, y una mutación nunca lee una fila vieja de ahí | `request-cache.ts` (nuevo), `compliance.ts`, `sheets.ts` |
| D25 | La prueba falla si `compliance.ts`, `helpers.ts`, `request-cache.ts`, `sheets.ts` o `subject-registry.ts` importan `next/cache` o usan la directiva de caché, o si el pool deja de ser `max: 10` | `pdtp-compliance-performance.test.ts` |
| `perf:queries` | Nuevo bloque PDTP que siembra 10 faenas × 80 actividades × 2 versiones y mide los servicios reales: consultas y mediana de 5 corridas, con el SLO de 1 s que ya aplica CI. `PERF_PDTP_DUMP=archivo` guarda los resultados completos para comparar cifras entre dos versiones del código | `scripts/measure-operational-queries.ts`, `lib/testing/pdtp-compliance-fixture.ts` |

No hay permisos, rutas ni menús nuevos. La UI no cambia: las mismas páginas muestran los mismos números con menos consultas.

## Antes → después

### Postgres real (`npm run perf:queries`, base desechable `bodega_t7b_perf_test` en 127.0.0.1:55432)

Conjunto: 10 faenas × 80 actividades × 2 versiones (2025). Las mediciones "antes" se hicieron con los archivos de servicio de `e1c48698` restaurados temporalmente sobre el mismo script.

| Lectura | Consultas antes | Consultas después | ms antes (mediana de 5) | ms después |
|---|---:|---:|---:|---:|
| Tablero: cumplimiento consolidado, 10 faenas | 1.380 | **47** | 331–339 | **84–91** |
| Tablero: avance por eje, 10 faenas | 96 | **14** | 49–56 | **27–29** |
| Tablero: planilla agregada (atrasadas), 10 faenas | 77 | **14** | 82–83 | **55–57** |
| Tablero: las tres lecturas como la página | 1.553 | **75** | 413–434 | **159–164** |
| Ficha: indicador + integral de una faena | 154 | **26** | 50–54 | **15–17** |
| Inicio: año consolidado de una faena | 138 | **47** | 66–71 | **21–23** |

Los rangos vienen de dos corridas de cada lado. Las consultas no dependen ya del número de faenas, y antes crecían ~138 por faena. Con un pool de 10, las 1.553 consultas del tablero se encolaban; ahora son 75, casi todas en paralelo.

### Conteo determinista (PGlite, 28 actividades × 2 versiones)

| Lectura | Antes (1 / 2 / 6 faenas) | Después (1 / 2 / 6 faenas) |
|---|---|---|
| Tablero consolidado | 68 / 136 / 408 | 47 / 47 / 47 |
| Eje | 15 / 24 / 60 | 14 / 14 / 14 |
| Planilla agregada | 14 / 21 / 49 | 14 / 14 / 14 |
| Integral por alcance | 95 / 179 / 515 | 74 / 74 / 74 |
| Indicador de una faena | 35 | 24 |
| Integral de una faena | 49 | 26 |
| Ficha (indicador + integral) | 35 + 49 = 84 | 26 |

`pg_stat_statements`: la extensión está disponible en el contenedor `:55432`, pero no está en `shared_preload_libraries`. Activarla exige reiniciar el contenedor compartido que usan otras tandas, y **no se hizo**. El conteo sale del logger de drizzle sobre la misma conexión que usan los servicios.

## Las cifras no cambian (evidencia)

1. **Dorado generado antes de optimizar.** El commit `920d6b38` agrega el conjunto sintético y `lib/__tests__/fixtures/pdtp-compliance-golden-2025.json`, generado con el código **anterior**. Dos corridas sin regenerar coincidieron, así que es determinista. El dorado cubre 71 lecturas:
   - tablero consolidado y por versión, y un subconjunto de faenas;
   - eje con todas las faenas y con una;
   - integral por alcance, consolidado y por versión;
   - indicador sin faena;
   - planilla agregada y planilla por faena (por huella sha256 del JSON canónico, más sus totales);
   - indicador, integral y año de cada una de las 6 faenas en las dos versiones;
   - las lecturas por número de año.

   El conjunto ejercita a propósito:
   - dos versiones con ejecuciones tardías fuera de ventana;
   - una faena incorporada en abril;
   - las seis fuentes de padrón y override manual, incluida una incidencia de "pendiente de clasificación";
   - plazo con piso anual;
   - ocurrencias completadas con ejecución aprobada y enviada, N/A y canceladas;
   - una actividad retirada, sobreejecución, integración que duplica lo manual, overrides, exclusiones, los tres tipos de desvío y CAPA.

   **Pasa sin cambios después de cada commit de optimización.**
2. **Volcado a escala real, idéntico byte a byte.** El volcado de `PERF_PDTP_DUMP` sobre 10 × 80 × 2 incluye tablero consolidado, tablero de la v1, eje, planilla agregada, y el indicador, el integral y el año de las 10 faenas: 34 lecturas, 2,5 MB. `cmp` entre el código anterior y el nuevo: **idéntico**, incluido el orden de las filas.
3. **Equivalencias directas.** Hay dos:
   - `getPdtpComplianceWithIntegral` es igual (`toEqual`) a pedir `getPdtpComplianceIndicators` + `getPdtpIntegralCompliance`, en las dos versiones y en dos faenas, una de ellas la incorporada a mitad de año;
   - `loadPdtpSubjectRosterBatch(...).get` es igual a `resolvePdtpSubjectRoster` sin `members`. Se compararon más de 100 casos: cada fuente, las 6 faenas, los 12 meses del flujo y conjuntos de capacidades repetidos, en mayúsculas, vacíos y nulos.
4. **Suites existentes, sin tocar una línea:** `test:pglite` completo en verde, 2.604. Entre ellas: `pdtp-compliance-zero`, `prevention-pdtp`, `pdtp-revision-windows`, `pdtp-revision-midyear`, `pdtp-period-closures`, `pdtp-re36-document`, `pdtp-coverage-r2`, `pdtp-capability-subjects`, `pdtp-annual-minimum` y `pdtp-deviations`.

## Rojo → verde (TDD)

| Prueba | Rojo sobre el código anterior (`e1c48698` + prueba) | Verde |
|---|---|---|
| `pdtp-compliance-performance.test.ts` › presupuesto de consultas (7 casos) | **6 fallan**: tablero `expected 408 to be 136`, eje `60 to be 24`, planilla `49 to be 21`, integral por alcance `515 to be 179`, ficha `'undefined' to be 'function'` y indicador de una faena `35 ≤ 26`. Pasa la guarda D25, que es caracterización: el pool ya estaba en 10 | 7/7 |
| ↳ cifras doradas (2) | Verdes por construcción: se generaron con el código anterior | 2/2 |
| ↳ padrón por lote (1) | La función no existía (se escribió junto con ella) | 1/1 |

La salida roja quedó en el scratchpad de la sesión (`red-budget-old-code.txt`).

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (también en el hook pre-commit de cada commit) |
| `npm run test:fast` | **10.087 PASS**, 293 omitidas (774 archivos) |
| `npm run test:pglite` | **2.604 PASS**, 1 omitida (la sonda de consultas, que sólo corre con `PDTP_PROBE_OUT`), 213 archivos |
| `npm run db:verify-migrations` | PASS: 334 entradas hasta 0333, checksums verificados. Sin migración nueva |
| `npm run perf:queries` (base desechable propia) | PASS: todas las lecturas bajo el SLO de 1 s; tabla arriba |
| E2E `pdtp-*` + `prevencion-*` (servidor propio en :3300, base `bodega_t7b_e2e`, config temporal en el scratchpad) | **167 PASS, 1 omitida** (7,1 min). El log del servidor no muestra errores del PDTP. Sí tiene 3 "The destination stream closed early" en inspecciones y CPHS, un stream cortado por la navegación del test, ajeno a estos cambios. Servidor detenido y bases `bodega_t7b_*` eliminadas al terminar |

## Sin hacer / sin verificar

- **`pg_stat_statements`** no se midió (ver arriba). El plan pedía medirlo en `/prevencion/pdtp` con 10 faenas. Lo que hay es el conteo de consultas y el tiempo de los servicios reales en Postgres real. Queda pendiente repetirlo en una copia con la extensión precargada.
- **Volumen real:** los datos son sintéticos. No se midió sobre una copia del programa 2026, porque requiere autorizar la clonación de la base de desarrollo.
- No hay medición de la página renderizada (TTFB) en el servidor E2E. Se verificó que las páginas cargan y funcionan (E2E), no su latencia en el navegador. El efecto de `React.cache` solo existe dentro de un render, así que ninguna prueba lo mide; las cifras de arriba son **sin** esa deduplicación.
- Otros consumidores de `loadProgramScheduleAndExecutions` faena por faena siguen igual: `constancias.ts` y `reminders.ts` (este recorre faenas). No son el tablero y quedaron fuera del alcance de I12.
- No se corrieron `test:e2e` completo, las suites `*-postgres` ni `npm run doctor`.

## Conflictos de merge esperables

- **`lib/services/pdtp/compliance.ts`**: reescritura amplia de la carga (`loadPdtpIndicatorInputs` → `loadPdtpIndicatorInputsForTargets` + `assemblePdtpIndicatorInputs`), del eje y del integral. El plan pone I12 al final de `compliance.ts`; cualquier rama que lo toque después de T6/T3 chocará aquí. La regla de cómputo (`computePdtpIndicatorsFromInputs`, `effectiveApprovedExecutionsByCell`) solo perdió el `async` y la consulta de exclusiones.
- `lib/services/pdtp/helpers.ts` (`loadProgramScheduleAndExecutions`, `loadApprovedExecutionsForWorksites`) y `subject-registry.ts`.
- `lib/services/pdtp/sheets.ts`: dos lecturas base a `request-cache` y la planilla agregada por lote. **No** se tocó `pdtp-sheet-table.tsx`, `pdtp-execution-form.tsx` ni la cabecera y tarjetas del tablero, donde trabaja otra rama.
- `app/(app)/prevencion/pdtp/[programId]/page.tsx`: solo el bloque que pedía indicador e integral.
- `lib/services/pdtp/period-closures.ts`: una línea de import y el `Promise.all` de la foto.
- `tests/pglite-files.ts`: una línea junto a `pdtp-compliance-zero`.
- `scripts/measure-operational-queries.ts`: bloque nuevo al final.
