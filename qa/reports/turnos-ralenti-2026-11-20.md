# Turnos y ralentí — verificación (2026-11-20)

Rama `feat/turnos-ralenti`. Spec: `docs/superpowers/specs/2026-11-20-turnos-ralenti-design.md`.
Plan: `docs/superpowers/plans/2026-11-20-turnos-ralenti.md`.

## Alcance verificado

| Qué | Cómo | Resultado |
|---|---|---|
| Tipos | `npm run typecheck` (tras el último cambio) | PASS |
| Lint | `npm run lint` + hook en cada commit | PASS |
| Unitarias | `npm run test:fast` | PASS (21.244) |
| PGlite | `npm run test:pglite` | 5.316 PASS, 1 FAIL previo de `main` |
| Migraciones | `npm run db:verify-migrations` (397 entradas, 0396) | PASS |
| React Doctor | `npm run doctor` | Sin errores; avisos como el resto del repo |
| E2E | `e2e/flota-turnos.spec.ts` + `e2e/control-operacional-navegacion.spec.ts`, base `bodega_e2e_turnos`, puerto 3107 | 32/32 PASS |
| Navegador con datos reales | `next dev` propio en :3003 contra `bodega_dev`, usuario QA (rol global), 1440 px y 390 px | PASS (detalle abajo) |
| API VisionLink real | Sondeos de sólo lectura; backfill de tramos 2026-10-01 → 2026-11-20 en `bodega_dev` | 6 equipos, 22.742 tramos, 0 fallos |
| Importación | 320 turnos de «Ralentí Cholguán», dry-run y `--apply` en `bodega_dev` | 320 importados, 0 errores; 2.ª pasada: 0 nuevos |

## Recorrido en el navegador (`bodega_dev`)

- **Día 12-11:** los 7 turnos importados con estado y %; fila de equipos con % del día, motor y turnos.
- **Cuadre con la página original** (mismos datos de VisionLink, misma fórmula), turnos del 12-11:

  | Turno | Página original | Plataforma |
  |---|---|---|
  | GR-10 06–14 | 42,3 % | 42,2 % |
  | GR-10 14–22 | 79,9 % | 80,0 % |
  | GR-11 06–18 | 49,9 % | 49,9 % |

  Diferencia ≤ 0,1 pp (redondeo de minutos en la página original).
- **Operadores (1–19 nov):** ranking ponderado por horas, 15 operadores, sin pendientes.
- **Equipos (6–19 nov):** grilla con «SS» sólo en CR-53 (callado desde el 27-08), domingos detenidos («–»), CR-51/TO-37 «s/d» (ConnectPro sin dato de ralentí), litros en vacío del resumen diario.
- **Mutación:** registrar un turno `QA_` (GR-06, 20-11) y anularlo con motivo: OK; el turno anulado no se muestra.
- **390 px:** sin desplazamiento horizontal de la página en Día ni en Equipos.
- **Consola:** 0 errores. **Red:** 0 respuestas 5xx; sólo solicitudes abortadas al navegar (prefetch RSC y `/api/apps/visita`, ajenas a esta rama).

## Hallazgos y lo que se hizo

| # | Tipo | Hallazgo | Estado |
|---|---|---|---|
| 1 | PRODUCT BUG (propio) | La regla «sin fila diaria = sin señal» marcaba «Sin señal» los días detenidos: VisionLink **omite** los días sin uso (GR-10 y CR-52 el domingo 15-11, verificado contra la API). | Corregido: sin señal = sin datos ese día ni después y ≥ 3 días callado. Spec actualizado. |
| 2 | PRODUCT BUG (propio) | La paginación de tramos cortaba en silencio en el tope y guardaba días incompletos como conocidos. | Corregido: `VISIONLINK_TRUNCATED`, ventana de 7 días, URL repetida = error. |
| 3 | PRODUCT BUG (propio) | Un turno «Pendiente de datos» mostraba un % parcial con la barra «en meta». | Corregido: el % sólo en turnos en meta / sobre meta. |
| 4 | PRODUCT BUG (propio) | Un día con motor pero sin dato de ralentí (ConnectPro) se mostraba «– motor detenido». | Corregido: «s/d» y «Sin dato de ralentí». |
| 5 | PRODUCT BUG (propio) | La importación no calzaba apellidos compuestos («San Martín»). | Corregido y probado con los 15 operadores reales. |
| 6 | FUNCTIONAL | Turnos históricos con operador dado de baja no se podían corregir; orden de bloqueo no fijo al mover de equipo. | Corregido con pruebas. |
| 7 | IMPROVEMENT | Importación: código de equipo ambiguo, cruces por equipo (archivo y base), mapeo operador → trabajador visible en el dry-run. | Hecho. |
| 8 | INCONSISTENCY (previa) | `/flota/traslados` y `/flota/turnos` caen en el patrón de `top-bar.tsx` que oculta la búsqueda en `/flota/<id>`. En Turnos no hace falta búsqueda; en Traslados la tabla dice usar la barra. | Sin cambio: anterior a esta rama. |

## Puertas y fallas previas de `main`

- `test:pglite`: `lib/__tests__/module-toggles.test.ts` falla en `main` por `/api/apps/recientes` y `/api/apps/visita` sin inventario (vienen de «Visitas por app», `f26827c89`). No es de esta rama.
- Corrida final, posterior al último cambio: `test:fast` 21.244 pasadas, 0 fallidas; `test:pglite` 5.316 pasadas y 1 fallida (la de `module-toggles` de arriba, previa).

## Cobertura que falta

- No se recorrió con un usuario `admin_contrato` real en `bodega_dev` (el alcance por faena lo cubren las pruebas PGlite y la E2E con un admin. de contrato sembrado).
- El cron horario no corrió en un entorno programado; se probó la ruta (pruebas) y el sync (backfill real).
- Navegadores móviles reales (WebKit) no: sólo Chromium a 390 px.

## Estado de `bodega_dev`

Migrado a 0396, `db:sync-rbac`, tramos y resumen diario desde 2026-10-01, 320 turnos importados (autor: el admin. de contrato de Cholguán), 1 turno `QA_` anulado (GR-06, 20-11), interruptor `/flota/turnos` **encendido**.
