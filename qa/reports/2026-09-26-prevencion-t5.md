# Tanda T5: cambio de año 2027 (2026-09-26)

T5 es la tanda del plan de pendientes de la auditoría de Prevención que prepara el paso a 2027 (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, hallazgo PREV-C03). Se hizo en paralelo a T1, en la rama `prevencion/t5-cambio-anio` (worktree aislado, desde `319598c7`). Trae la única migración de la tanda: **0330 (M-2)**.

## Qué se corrigió

| ID | Cambio | Archivos |
|---|---|---|
| C03.5 | Un hecho de un año **posterior** al del programa vigente lanza `PdtpNoActiveProgramError`: el libro lo deja reintentable (`error` con la marca `[no-active-program]`) y el conector de inspecciones lo guarda `pending` sin revertir el cierre del run en enero. Un año anterior sin programa sigue en `skippedOutOfPeriod`. El libro de cumplimiento se acota al año del programa. Tras activar se vacía el libro con cursor (`drainPdtpFulfillmentEvents`), no sólo los 50 eventos más antiguos | `accreditation.ts`, `fulfillment.ts`, `backlog.ts`, `pdtp-accreditation-connectors.ts`, `actions/program-lifecycle.ts` |
| C03.6 | Migración 0330: `year_closed_at`, `year_closed_by_user_id` (FK a users, `SET NULL`), `year_close_reason` y el CHECK `year_closed_at IS NULL OR status IN ('closed','archived')`. `closePdtpProgramYear` manual y estricto (D21): por faena operativa, cada mes desde la activación de la primera versión del año (o la incorporación de la faena) cerrado por cualquier versión del año; no antes de terminar el año en Chile; no con revisiones abiertas; marca todas las versiones. Un año cerrado rechaza hechos tardíos (rechazo visible en el libro, sin tumbar el cierre de una inspección), no se archiva y sus meses no se reabren. Disparadores filtrados por año (dos años activos no duplican obligaciones). Opciones de inspección sin números repetidos. Recordatorio semanal de cierre pendiente. Botón "Cerrar el año" en la ficha, con motivo y lista de lo que falta, con el permiso existente `prevention:pdtp:lifecycle:manage` | `db/schema/prevention/pdtp.ts`, `0330_massive_wild_child.sql`, `year-close.ts`, `lifecycle.ts`, `period-closures.ts`, `trigger-events.ts`, `reminders.ts`, `prevention-inspections.ts`, `program-lifecycle-controls.tsx`, `[programId]/page.tsx` |
| C03.1 | `copyPdtpProgramContent` (`program-copy.ts`): la única copia programa→programa, con modo `revision` (v+1, sin cambios de comportamiento) y `next_year`. `next_year` (D20): período y título del año nuevo, `program_copy`, cabecera copiada (incluido `appliesToAllWorksites` y `documentRevision`), programación re-anclada con `remapPdtpScheduleDefinitionToYear` (días de semana explícitos, año completo → año completo, bisiestos, informe), sin retiradas, overrides ni padrón; la leyenda de roles sí. `createAnnualPdtpProgram` copia por omisión la versión vigente del año elegible más reciente y deja la Base 2026 como alternativa; rechaza orígenes en borrador o superados. Al activar el año nuevo se traspasan las asignaciones nominales vigentes del año copiado (sólo cuentas activas). `/prevencion/pdtp/nuevo`: selector de origen y aviso cuando el año ya existe (`created:false`) | `program-copy.ts`, `programs.ts`, `schedule-definition.ts`, `assignees.ts`, `lifecycle.ts`, `program-crud.ts`, `nuevo/*`, `pdtp.ts` (esquema de creación) |
| C03.2 | Huella de contenido v20 con `manualEvidencePolicy`. `instantiatePdtpTemplateVersion` restaura mecanismo, programación re-anclada, padrón declarado, capacidades, plazos, política de evidencia, configuración de ejecución, recordatorios, ejecutores, exclusiones y ajustes firmados por faena; omite e informa (sin re-apuntar) referencias a vínculos, usuarios, roles o faenas que ya no existen; no instancia retiradas ni padrón ni overrides | `content-digest.ts`, `templates.ts`, `programs.ts` |
| C03.4 | `PROGRAM_SLOT_BASE_YEAR`: 2026 conserva su cronograma congelado; desde 2027 las casillas (simulacro, CGRD, alcotest, higiene) se derivan de la planificación del programa activo del año (D22). Una sola regla de siembra (faenas operativas de cada año con programa activo) desde los puntos de alta, el backfill (`PROGRAM_SLOTS_YEAR`) y la activación. Catálogo de capacitación por año: 2027 es copia de 2026 con versión `programa-capacitacion-2027-v1`; el año es obligatorio. Pantallas con `?anio` o el año operativo | `program-slots-2026.ts`, `prevention-program-slots.ts`, `training-occurrences-catalog.ts`, `prevention-training-occurrences.ts`, `instruments.ts`, `occurrence-gap-connector.ts`, páginas de capacitación, CGRD, alcotest, simulacros, higiene |
| C03.7 | `resolvePdtpOperationalYears` (pura) y `getPdtpOperationalYears` (`operational-years.ts`). Tablero (tarjeta, KPI, medidor), `/prevencion/pdtp`, cierres, constancias, cobertura, aplicabilidad y actividades usan el año operativo; la tarjeta y el tablero PDTP muestran "PDTP <año> · cierre pendiente" (D23). Constancias junta las deudas del año en cierre, rotuladas por año | `period.ts`, `operational-years.ts`, `pdtp-compliance-card.tsx`, `prevention-section.tsx`, `resumen-view.tsx`, `pdtp/page.tsx`, `cierres/page.tsx`, `constancias.ts`, `constancias-workbench.tsx` |

## Decisiones tomadas fuera de los valores por defecto

- **Publicar una Base desde cualquier año.** La revisión adversarial mostró que `publishPdtpBase2026Revision` es la compuerta del XLSX oficial 2026 y que generalizarla no tiene sentido; `createPdtpTemplateVersion` ya publica desde cualquier año. No se tocó la compuerta; una prueba publica "Base preventiva 2026" desde un programa de otro año y la instancia completa.
- **Plantillas y retiradas.** Se aplicó a la instanciación el mismo criterio que a la copia anual: una actividad retirada no se instancia (antes se re-anclaba su retiro y quedaba vigente parte del año).
- **Siembra sin ningún programa activo.** La regla única cae al año base 2026 cuando no existe ningún programa activo (arranque de la plataforma y fixtures), que era el único comportamiento anterior.
- **Hecho tardío de un año cerrado en una inspección.** No revierte el cierre del run: se registra `rejected` con motivo en la misma transacción. Un hecho de un año anterior sin programa sigue lanzando como antes.
- **Recordatorios del año en cierre.** Se interpretó como un aviso semanal a quien puede cerrar el año (qué meses faltan o que ya puede cerrarse); el recordatorio semanal de celdas sigue al año civil.
- **Traspaso de asignaciones al año nuevo.** Sólo cuentas activas (opción `onlyActiveUsers` del traspaso existente); rigen desde el 1 de enero del año nuevo o desde hoy.
- **Suites PGlite que activan programas.** Desde que la activación siembra casillas, tres suites tuvieron que limpiar esas tablas antes de borrar faenas o el catálogo.

## Pruebas (rojo → verde)

- `lib/__tests__/pdtp-year-transition.test.ts` (nuevo, 7 casos): enero en espera y acreditado al activar, panel acotado por año, vaciado con más de 50 eventos, cierre de inspección en enero, hecho tardío de año cerrado, disparadores con dos años activos. **Rojo verificado** (3 fallos y 2 fallos antes de implementar backlog/vaciado/conector y el filtro por año).
- `lib/__tests__/pdtp-accreditation.test.ts`: año siguiente lanza, año anterior sigue fuera de período, año cerrado rechaza. **Rojo verificado.**
- `lib/__tests__/pdtp-year-close.test.ts` (nuevo, 8 casos). Rojo verificado sólo para archivar/reabrir/idempotencia; el servicio de cierre se escribió antes de su prueba.
- `lib/__tests__/pdtp-year-copy.test.ts` (nuevo, 10 casos): copia columna a columna, tablas asociadas, bloqueos, `created:false`, concurrencia, orígenes inválidos, traspaso de asignaciones al activar, instanciación completa de la Base. Rojo verificado para el traspaso de asignaciones y para C03.2; la extracción de la copia se escribió antes de su prueba.
- `lib/services/pdtp/schedule-definition.test.ts` (5 casos nuevos, rojo verificado), `lib/__tests__/pdtp-period.test.ts` (5, rojo verificado), `pdtp-objectives.test.ts` (pin 20 y forma v19/v20, rojo verificado), `prevention-training-occurrences.test.ts` y `program-slots-2026.test.ts` (rojo verificado), `pdtp-constancias.test.ts` (2, rojo verificado), `program-lifecycle-controls.test.tsx` (4, rojo verificado), `create-form.test.tsx` (6, rojo verificado), `pdtp-compliance-card.test.tsx` (2, rojo verificado), `prevention-program-slots-pglite.test.ts` (4 casos por año; escritos después del servicio), `prevencion-pdtp-actions.test.ts` (3; escritos después de la acción), `db/__tests__/pdtp-check-constraints.test.ts` (CHECK y `SET NULL`; escrito después del esquema).

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:fast` | 769 archivos / **9.997 pruebas PASS**, 29 archivos omitidos (suites `*-postgres`) |
| `npm run test:pglite` | 198 archivos / **2.374 pruebas PASS** (primera corrida: 78 fallos en 3 suites por las casillas que ahora siembra la activación; corregido en `d153942a` y re-ejecutado completo) |
| Migración | `db:generate` generó 0330 sin `DROP`; checksum registrado; `db:generate` posterior: "No schema changes"; `db:verify-migrations` PASS (331 entradas) |
| E2E `pdtp-*` + `prevencion-*` (incluye los 2 specs nuevos) contra servidor aislado propio (puerto 3200, base desechable `bodega_t5_e2e` en `:55432`) | **152 PASS**, 0 fallos |
| Recorrido de navegador (script Playwright propio, escritorio 1440 px y 390 px) | `/prevencion/pdtp/nuevo`, `/prevencion/pdtp`, fichas 2025 y 2024, constancias, capacitación e inicio (vista Prevención): sin desborde horizontal, sin errores de consola ni respuestas 5xx. Capturas en el scratchpad de la sesión |

E2E nuevos con fixtures propios en `e2e/setup-db.ts` (el fixture 2026 no cambia):
- `e2e/pdtp-cierre-anual.spec.ts`: cierra el año 2024 (`pdtp-2024-e2e`, doce cierres) desde la ficha.
- `e2e/pdtp-transicion-anual.spec.ts`: con 2025 (`pdtp-2025-e2e`) activo mientras corre 2026, verifica el aviso en `/prevencion/pdtp`, el menú de cierres, la ficha y el inicio.
- `e2e/pdtp-flow.spec.ts` actualizado al nuevo creador.

## Pendiente

- `npm run doctor`, `test:e2e` completo y las suites `*-postgres` no se corrieron en esta tanda.
- El recorrido de navegador fue un script propio (el MCP de navegador no estaba disponible); no hubo recorrido manual interactivo del cierre anual fuera del spec.
- Las pantallas de casillas aceptan `?anio`, pero no se agregó un selector de año visible en capacitación, CGRD, alcotest, simulacros ni higiene.
- La cola operacional (`/pendientes`) no se revisó con el año operativo.
- Reabrir un año cerrado no está previsto (decisión D21: estricto).
- Merge: conflictos esperables con T1 en `lib/validation/prevention-module/pdtp.ts` (otra zona del archivo), `fulfillment.ts` (una línea en la compuerta de cobertura) y `app/(app)/prevencion/pdtp/page.tsx` (año por omisión y aviso). La migración 0330 debe seguir siendo la siguiente a 0329 al integrar.
