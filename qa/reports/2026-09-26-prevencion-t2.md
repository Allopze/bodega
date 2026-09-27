# Tanda T2: estados y "No aplica" del PDTP (2026-09-26)

Tercera tanda del plan de pendientes de la auditoría de Prevención (`/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, hallazgos PREV-C06 y PREV-C07). Rama `prevencion/t2-estados`, sobre `e47d9b7a` (integración T0+T1+T5 con sus correcciones). Trae la migración **0331 (M-1)**.

**Decisiones aplicadas:** D8 (todo "No aplica" nuevo nace `pending_review` y lo aprueba otra persona con `prevention:pdtp:approve`; los vigentes siguen activos) y D9 con su valor por defecto (un envío paga el mes; las atrasadas se ven en la vista semanal; estado por peor caso; corte por faena).

## Qué cambió

| ID | Cambio | Archivos |
|---|---|---|
| C06, regla | `deriveActivityStatus` evalúa primero la deuda vencida (`countOverdueMonths`) con `pdtpOverdueCutoffMonth(año, período, hoy)`: vencen los meses que terminaron tanto para el período mirado como para hoy; un año cerrado leído en diciembre (T1, `pdtpReferencePeriodForYear`) tiene los 12 vencidos. Una trimestral impaga de marzo ya no se lee en mayo como "No programada", y una ejecución del mes no esconde un mes anterior en cero | `period.ts` |
| C06, D9 | Un mes con un envío pendiente de aprobación no es atraso (`monthlySubmitted`). El indicador sigue contando sólo lo aprobado | `period.ts`, `sheets.ts` |
| C06, peor caso | `aggregatePdtpActivityStatus`: atrasada > no realizada > pendiente > ejecutada > no programada. `pdtpSheetActivityStatus` es la única regla de la planilla y del KPI | `period.ts` |
| C06, corte por faena | La vista agregada recorta cada faena desde su incorporación (`effectiveActivationFor`) con **una sola consulta** de `addedAt` (la misma de la membresía). La vista por faena también | `sheets.ts` |
| C06, planilla | `statusOf` centralizado (conteos, filtro, badge, filas semanales y celda de "Registrar"); la vista semanal muestra las atrasadas aunque esta semana no tengan plan; "Registrar" abre en la primera semana planificada del primer mes vencido; "hoy" sale del servidor | `pdtp-sheet-table.tsx` |
| C06, KPI | "Atrasadas" usa la misma hoja, faena (la elegida o el agregado con peor caso), período y regla que la lista a la que enlaza. Antes contaba sobre todas las faenas aunque hubiera una elegida | `pdtp/page.tsx` |
| C06, visor | `/prevencion/pdtp/actividades` lee un año terminado en diciembre, igual que el tablero | `actividades/page.tsx` |
| C06, "En cero" | `isPdtpActivityZeroThisMonth` pasa a ser un criterio del mes (`p > 0 && aprobado = 0`), sin derivarse del estado: con la regla nueva, derivarlo habría contado actividades que el indicador no cuenta | `period.ts` |
| C07, M-1 | Migración 0331: `reviewed_by_user_id` (FK SET NULL), `reviewed_at`, `review_reason`; estados `active \| pending_review \| rejected \| withdrawn`; índice único parcial `WHERE status IN ('active','pending_review')` (renombrado a `..._cell_open_unique`); checks de revisor ≠ creador, sólo el N/A pasa por revisión y rechazo con motivo ≥ 10. DROP con `IF EXISTS`, checksum registrado, `db:generate` sin cambios pendientes. No toca datos: los N/A vigentes quedan `active` | `db/schema/prevention/pdtp.ts`, `db/migrations/0331_strange_thanos.sql` |
| C07, alta | Un N/A nuevo nace `pending_review` y no cambia el denominador. N/A y "no realizado" comparten el validador de celda futura (`isPdtpCellInFuture`): el N/A ya no se declara sobre semanas que no ocurrieron | `deviations.ts` |
| C07, revisión | `reviewPdtpNotApplicable`: aprueba (→ `active`) o rechaza con motivo (→ `rejected`); quien declaró no revisa; alcance de faena; mes abierto; al aprobar, la celda no puede tener ejecución. Orden de bloqueos advisory de celda → `FOR UPDATE` de la fila. Changelog | `deviations.ts` |
| C07, coherencia | Un N/A pendiente ocupa la celda: bloquea la ejecución manual; lo puede retirar quien lo declaró; la acreditación por integración también lo retira; el conector de casillas lo reconoce como propio. **No se cierra un mes con N/A pendientes** | `executions.ts`, `accreditation.ts`, `slot-deviation-connector.ts`, `period-closures.ts` |
| C07, instancias | El "No aplica" de una instancia programada exige motivo de 10 caracteres (antes 3) | `scheduled-execution.ts`, `lib/prevention/pdtp.ts` |
| C07, UI | Sección "No aplica por revisar" en `/prevencion/pdtp/aprobaciones` (acción `reviewPdtpNotApplicableAction` con `prevention:pdtp:approve`); la planilla de la faena muestra el N/A "En revisión"; el formulario y el toast avisan que el cumplimiento no cambia hasta la aprobación; la marca del mes dice "(en revisión)"; `declaredNotApplicable` junto al porcentaje en el panel del programa | `aprobaciones/`, `actions/deviations.ts`, `pdtp-deviation-form.tsx`, `pdtp-indicators-panel.tsx`, `[programId]/page.tsx` |

**Paridad de autorización y navegación:** no hay permiso nuevo. Revisar reutiliza `prevention:pdtp:approve`, que ya protege `/prevencion/pdtp/aprobaciones` y la aprobación de ejecuciones; no cambian rutas, sidebar, `modules/permissions.ts`, manifiestos ni seed.

**Decisiones de implementación más allá del plan (a confirmar):**
- **El N/A que propaga una casilla** (alcotest, simulacros, CGRD, capacitación, higiene) también nace en revisión: D8 dice "todo N/A nuevo". Hasta que alguien lo apruebe, la celda sigue contando. Un "no aplica" de casilla sobre una semana futura ahora lo rechaza el PDTP (queda en el log y la casilla cambia igual, como ya pasaba con "no hecha" a futuro).
- **Un N/A pendiente no paga el mes** para el estado: si el mes ya venció, la actividad sigue "atrasada" hasta que se apruebe.
- **Severidad del peor caso:** "no realizada" pesa más que "pendiente".
- El rechazo exige motivo; la aprobación admite un comentario opcional.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `npm run test:fast` | 772 archivos / **10.053 pruebas PASS**, 30 archivos omitidos (suites `*-postgres`). Corrió antes del último ajuste de la marca "(en revisión)"; esa suite (`pdtp-sheet-table.test.tsx`, 25/25) se volvió a correr después |
| `npm run test:pglite` | 198 archivos / **2.405 pruebas PASS** |
| `npm run db:verify-migrations` / `db:generate` | PASS: 332 entradas hasta `0331_strange_thanos`, checksums verificados; `db:generate` → "No schema changes" |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido (puerto 3200, base desechable `bodega_t2_e2e` en :55432) | **157 PASS, 2 omitidas.** `pdtp-habilitacion:98` es la omisión condicional de siempre; `pdtp-habilitacion:67` ("el fixture no tiene actividades pendientes") depende del estado que dejan las pruebas anteriores: al correr ese archivo solo contra el mismo servidor, pasa (6 PASS, 1 omitida). Incluye las dos E2E nuevas: `pdtp-atrasadas` (3) y `pdtp-no-aplica-revision` (3) |
| Recorrido de navegador por script (Playwright) a 1440 y 390 px | Tablero, actividades (atrasadas, semana por faena, anual agregada), Aprobaciones y ficha del programa con su panel de indicadores, con un fixture propio (marzo impago, N/A pendiente en mayo y aprobado en junio): **12/12 páginas con HTTP 200, 0 errores de consola, 0 respuestas 5xx, 0 desborde horizontal** en 1440 y 390 px. Revisadas a ojo las capturas del tablero (KPI "Atrasadas" = 1, la deuda de marzo; el N/A pendiente de mayo no paga el mes) y de Aprobaciones a 390 px (la sección nueva cabe, botones de 44 px de alto) |

**Rojo antes que verde** (cada uno visto fallar antes del código):
- `lib/__tests__/pdtp-period.test.ts`: 15 casos C06 (corte, marzo impago en mayo, ejecución del mes que no paga la deuda, D9, año cerrado, mes futuro, primer mes vencido, "En cero" del mes, peor caso) y 3 de `pdtpSheetActivityStatus`/`pdtpPeriodFromChileDate`. El caso previo "executed aunque haya meses anteriores impagos" se reescribió: ahora afirma `overdue`.
- `lib/__tests__/pdtp-worksites.test.ts` (PGlite): corte por incorporación de la faena, D9 y `overdueMonths` por faena.
- `pdtp-sheet-table.test.tsx`: vista semanal con atrasadas, filtro, peor caso agregado, celda de "Registrar", marca "(en revisión)".
- `db/__tests__/pdtp-check-constraints.test.ts` (PGlite): 8 casos de M-1 (índice renombrado, pendiente ocupa la celda, rechazado la libera, sólo N/A, revisor ≠ creador, rechazo con motivo, FK SET NULL).
- `lib/__tests__/pdtp-deviations.test.ts` (PGlite): 10 casos C07 (nace pendiente, aprobación, segregación, rechazo, doble revisión, alcance, celda futura, bloqueo de ejecución, bandeja y conteo, planilla "en revisión").
- `lib/__tests__/pdtp-period-closures.test.ts`: no se cierra con N/A pendientes.
- `scheduled-execution.test.ts`, `pdtp-deviation-action.test.ts`, `pdtp-deviation-form.test.tsx`, `not-applicable-review-section.test.tsx` (nueva), `pdtp-indicators-panel.test.tsx`.

**Escritas después del código:** la prueba de componente "una ejecución de este mes no esconde la deuda" pasó al escribirla porque la regla ya estaba cambiada (la cubre en rojo `pdtp-period.test.ts`); en `pdtp-deviations.test.ts`, "retirar mientras está en revisión" y "la acreditación retira un N/A pendiente" pasaron antes de implementar porque el N/A todavía nacía `active`. Las dos E2E nuevas (`pdtp-atrasadas`, `pdtp-no-aplica-revision`) se escribieron con el código ya hecho y no se vieron en rojo contra la base.

**Pruebas previas ajustadas por el cambio de regla (no por fallo del código):** en `pdtp-deviations.test.ts` los N/A se movieron de años futuros (2060…2069) a 2024/2025 y los que afirmaban el efecto inmediato ahora aprueban primero; `pdtp-slot-deviation-propagation.test.ts` y `prevention-hygiene-pdtp-accreditation.test.ts` esperan `pending_review` y la aprobación de otra persona antes de que la celda salga del denominador.

## Pendiente y riesgos

- **Las atrasadas suben de forma visible** (el defecto las escondía) y el % de faenas con N/A recientes baja hasta que se revisen. Conviene comunicarlo a la jefatura antes del despliegue, junto con T0/T1.
- **N/A de casillas en revisión:** los submódulos declaran "no aplica" con su propio permiso; ahora esas celdas quedan contando hasta que alguien con `prevention:pdtp:approve` las revise. Si el volumen es alto, la bandeja lo mostrará; no hay aprobación masiva.
- **`/pendientes`** sigue excluyendo sólo los desvíos vigentes: una celda con N/A pendiente sigue apareciendo como tarea hasta que se apruebe (coherente con "no cuenta hasta aprobarse", pero es una decisión).
- El "No aplica" de una **instancia programada** sólo endurece el motivo; no pasa por revisión ni se prohíbe a futuro (fuera del alcance del plan).
- La vista semanal de la **ficha del programa** (`/prevencion/pdtp/[id]`) lista los desvíos del mes en curso; un N/A pendiente de otro mes se ve en la marca de la vista anual y en Aprobaciones, no bajo la fila semanal.
- **D6** (cierres ya emitidos que quedarían desviados) sigue pendiente de la consulta de solo lectura previa al despliegue; T2 no cambia fotos, pero los cierres con N/A pendientes ahora se bloquean.

## Lo que NO se verificó

- `npm run test:e2e` completo, las suites `*-postgres` y `npm run doctor`.
- La migración 0331 sólo se aplicó en PGlite y en la base desechable E2E; no en desarrollo, staging ni producción.
- El recorrido de navegador corrió sobre la build del servidor aislado, anterior al último cambio de texto de la marca "(en revisión)" (cubierto por prueba de componente).
- Integración real submódulo → PDTP en navegador (el fixture E2E no tiene conectores); sólo PGlite.
