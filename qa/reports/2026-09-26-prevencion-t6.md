# Tanda T6: revisión v+1 a mitad de año (2026-09-26)

T6 es la tanda del plan de pendientes de la auditoría de Prevención que evita que una revisión v+1 parta el año (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, hallazgo PREV-C05, partes B, C y D; C05-A se hizo en T0). Rama `prevencion/t6-revision`, sobre `a533f9d8` (integración ola 2: T0+T1+T5+T2+T4+T3+laterales+reglas de cierre anual con 0332). **Sin migración.** Incluye tres arreglos que dejó pendientes la revisión de T5.

Decisión aplicada: **D24** con su valor por defecto. Una v1 cerrada por reemplazo admite registros tardíos, aprobaciones, desvíos y cierres de sus propios meses. Las obligaciones siguen naciendo sólo en la versión activa.

## Qué cambió

| ID | Cambio | Archivos |
|---|---|---|
| C05-B, ventana | Cada versión del año es dueña de un tramo: desde su semana de activación hasta la de su sucesora. Las ventanas son contiguas y no se solapan, y la semana de activación es de la versión que entra. `assertPdtpProgramAcceptsPeriod` es la regla única de D24:<br>• la versión activa acepta desde su activación;<br>• una versión `closed` con sucesora acepta sólo su ventana, y el mensaje nombra la versión dueña;<br>• un año cerrado formalmente, un archivado o un borrador no aceptan nada.<br>Aprobar y rechazar usan la variante `assertPdtpProgramAcceptsReview`, que no exige la semana de activación porque la línea de base recibe hechos históricos por integración. La regla corre en ejecución, desvío, revisión de N/A, aprobación, rechazo y cierre de mes. Dentro de la transacción se relee con la fila del programa `FOR SHARE` | `version-window.ts` (nuevo), `executions.ts`, `deviations.ts`, `period-closures.ts` |
| C05-B, acreditación | La versión se elige por el **período** del hecho (la celda planificada si viene, si no la semana real), no por el instante: `resolvePdtpVersionOwningPeriod`. La primera versión sigue siendo la línea de base del año. Si el año planificado es distinto del real, se toma el borde del año. Se conservan el `FOR SHARE` de `resolvePdtpActiveProgramForEvent` y el envoltorio transaccional de `accreditPdtpFromEvent` (T3) | `accreditation.ts` |
| C05-B, lecturas | La planilla (por faena y agregada), el indicador, el eje, el integral y el reporte de una versión reemplazada se leen sólo dentro de su ventana. Antes, la v1 cerrada seguía mostrando como atraso lo planificado para las semanas de la v2. Sin sucesora el cálculo es exactamente el de antes | `sheets.ts`, `compliance.ts`, `helpers.ts`, `management-report.ts` |
| C05-B, UI | La ficha de una versión reemplazada avisa "Versión reemplazada por vN", enlaza la vigente y ofrece "Cerrar mes" | `[programId]/page.tsx` |
| C05-C | `getPdtpYearComplianceIndicators` consolida el año: cada versión aporta su ventana, con el corte por incorporación de cada faena, y las actividades se juntan por `catalogActivityId` (si falta, por número; con catálogo repetido dentro de una versión, por número). El tope por actividad y mes (D1) y el listado de actividades en cero se aplican una vez sobre la unión. Con una sola versión el resultado es **idéntico** al del programa, porque es el mismo cálculo con una sola entrada; lo fija una prueba. `getPdtpComplianceIndicatorsForScope(…, { consolidateYear })` también consolida, igual que el integral agregado | `compliance.ts` |
| C05-C, rótulos | Varias pantallas ahora muestran el año consolidado y lo rotulan:<br>• la tarjeta de inicio y la sección Prevención muestran "Consolidado v1 + v2";<br>• el tablero PDTP muestra "Año consolidado: v1 (desde…, hasta la activación de v2…) + v2 (desde…)".<br>El reporte de gestión y su Excel dicen qué versión miden: en la descripción, en el nombre del archivo (`pdtp-reporte-gestion-2026-v1.xlsx`) y en una fila "Versión" de la hoja Indicadores | `pdtp-compliance-card.tsx`, `prevention-section.tsx`, `pdtp/page.tsx`, `reporte/page.tsx`, `api/.../reporte-gestion/route.ts` |
| C05-D | `handoverPdtpOperationalLayer` corre en la misma transacción de la activación. Reutiliza `handoverPdtpWorksiteAssignees` de T0 y además traspasa los desvíos abiertos de la versión anterior cuya semana ya es de la nueva:<br>• se copian a la actividad equivalente (catálogo o número) con su tipo, motivo, autor, estado y revisión;<br>• el original se retira con un motivo que nombra la versión;<br>• una reprogramación con origen en la versión anterior y destino en la nueva se copia **sin** retirar el original.<br>Cada copia pasa el validador de celda de C07: actividad vigente y no excluida, faena que opera la versión, planificado en la celda, destino exigible, nada a futuro, sin ejecución y mes abierto. Lo que no pasa se retira igual y queda en el control de cambios (sección `handover`). Es idempotente | `operational-handover.ts` (nuevo), `lifecycle.ts` |
| Revisión T5 (1) | Al activar, se quitan las casillas **pendientes, sin hecho y sin evidencia** del año que la planificación vigente ya no pide, y sólo desde la semana de activación. Nunca se tocan las cumplidas, las no hechas ni las declaradas no aplicables. Se borran porque las tablas no tienen estado "cancelada" y T6 no trae migración | `prevention-program-slots.ts` |
| Revisión T5 (2) | Sin ningún programa activo ya no se siembra el año base 2026 si ese año está cerrado formalmente: en enero de 2027, una faena nueva ya no recibe casillas de un año cerrado | `prevention-program-slots.ts` |
| Revisión T5 (3) | Los pasos posteriores a la activación ahora corren cada uno por su cuenta: materializar, reconciliar disparadores, revisar la carpeta legal y sembrar casillas. Si uno falla:<br>• queda en el control de cambios (`lifecycle:post-activation`) y en `postActivationWarnings`;<br>• la acción de activar lo muestra como aviso ("Programa activado. Aviso: no se pudo…").<br>La activación sigue sin revertirse | `lifecycle.ts`, `actions/program-lifecycle.ts` |

**Paridad de autorización y navegación:** no hay permisos, rutas ni entradas de menú nuevas. Cerrar el mes de una versión reemplazada usa `prevention:pdtp:close_period`, que ya existía.

## Decisiones más allá de los valores por defecto

- **"No aplica" en revisión al activar la v+1:** se traspasa **en revisión**, con quien lo declaró. La semana es de la versión nueva, así que la revisión también. Con el autor, la segregación viaja intacta. El original queda `withdrawn` para que Aprobaciones no lo muestre dos veces. Un N/A ya aprobado viaja aprobado.
- **Corte por semana y no por instante.** Un hecho del lunes de la semana de activación, anterior a la hora de activar, antes caía en la v1. Ahora cae en la v2, que es dueña de esa semana. Por eso se ajustaron dos pruebas previas que fijaban el corte por instante (`pdtp-accreditation` "corte efectivo entre revisiones" y `pdtp-fulfillment` "acredita cada hecho en la versión vigente en su fecha"): el hecho "previo" se movió a la semana anterior.
- **Aprobar o rechazar es más permisivo que registrar** (`assertPdtpProgramAcceptsReview`). Sólo frena un año cerrado y las semanas de la sucesora; no exige la semana de activación ni un estado vigente. Así no se bloquea la revisión de hechos históricos que llegaron por integración a la línea de base.
- **El mes partido por la activación lo pueden cerrar las dos versiones.** Cada una cierra la parte de su ventana. La versión anterior lo cierra sólo si la primera semana del mes todavía era suya. El cierre anual (T5) ya acepta el cierre de cualquier versión.
- **La ventana vive en `version-window.ts`, no en `period.ts`.** El plan nombraba los dos. `period.ts` no cambió: recortar las filas a la ventana basta para que `deriveActivityStatus` y el corte de atrasos no vean semanas de la sucesora.
- **La ficha de cada versión sigue midiendo la suya.** Sólo el tablero, la tarjeta de inicio y la sección Prevención muestran el año consolidado. La foto de los cierres también sigue por versión: no cambia la forma de `PdtpComplianceIndicators` y los cierres ya emitidos no se desvían.
- **E2E sobre 2025.** `pdtp_programs` sólo admite años desde 2024 y un único programa activo por año, y 2024 y 2025 ya tienen el suyo en el fixture general. El spec pasa el programa 2025 del fixture a `closed` mientras corre, le encadena dos revisiones propias (v2 y v3) y lo devuelve a `active` al terminar. Corre antes que `pdtp-transicion-anual`, que es quien lo lee, y después de la corrida quedó `active` en la base (comprobado).

## Pruebas (rojo → verde)

| Prueba | Rojo observado | Verde |
|---|---|---|
| `pdtp-revision-windows.test.ts` (nueva, PGlite), C05-B escrituras: tardía en la v1, semana de la v2 rechazada, semana de activación, desvío, cierre, aprobación y año cerrado, archivado | 6 de 7 ("archivado" ya fallaba con el mensaje esperado) | ✓ |
| ↳ acreditación por período (planificado en marzo tras la v2; semana de activación) | 2 de 2 | ✓ |
| ↳ planilla y el indicador de la v1 recortados a su ventana | 2 de 2 | ✓ |
| ↳ C05-C: el agregado por faenas consolida | 1 de 1 | ✓ |
| ↳ C05-C: igualdad con una versión, suma entre versiones, cero deduplicado, tope en el mes partido | **Escritas después de `getPdtpYearComplianceIndicators`**; pasaron al escribirlas | ✓ |
| ↳ C05-C: reporte de gestión recortado y con rótulo | 1 de 1 | ✓ |
| ↳ C05-D (3 casos: traspaso con estados, idempotencia, asignaciones) | 3 de 3 (módulo inexistente; el módulo se escribió antes de correrlas, así que el rojo se observó quitándolo) | ✓ |
| `pdtp-year-copy.test.ts`, la activación real traspasa el desvío | 1 de 1 | ✓ |
| `pdtp-year-copy.test.ts`, aviso cuando falla la siembra de casillas | 1 de 1 | ✓ |
| `prevention-program-slots-pglite.test.ts` (casilla obsoleta al activar la v2; año base cerrado) | 2 de 2 | ✓ |
| `pdtp-revision-window-concurrency-postgres.test.ts` (nueva, Postgres real): ejecución de la v1 mientras se activa la v2 | Rojo verificado quitando la relectura con `FOR SHARE`: la escritura no esperaba | 1/1 |
| `pdtp-compliance-card.test.tsx` (rótulo "Consolidado") | 1 de 2 (el caso negativo caracteriza) | ✓ |
| `reporte-gestion/route.test.ts` (Excel con versión) | 1 de 1 | ✓ |
| `version-window.test.ts` (nueva, pura, 4 casos) | **Escrita después del módulo** | ✓ |
| `prevencion-pdtp-actions.test.ts` (aviso de la acción) | **Escrita después del código** | ✓ |
| `e2e/pdtp-revision-midyear.spec.ts` (nuevo, 4 casos) | Escrito con el código ya hecho, sin rojo contra la base. La primera corrida mostró que la planilla de la v1 ni siquiera ofrece las semanas de la v2, así que ese caso se reescribió para verificar eso (el rechazo del servicio ya lo cubre PGlite) | 4/4 |

**Pruebas previas ajustadas por el cambio de regla:**
- `pdtp-accreditation` y `pdtp-fulfillment`: corte por semana (ver decisiones).
- `e2e/pdtp-reporte-gestion`: nombre de archivo con la versión.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS (sobre el HEAD final) |
| `npm run lint` | PASS (completo, y además en el hook de cada commit) |
| `npm run test:fast` | 771 archivos / **10.058 pruebas PASS**, 32 archivos omitidos (suites `*-postgres`, incluida la nueva) |
| `npm run test:pglite` | 211 archivos / **2.574 pruebas PASS** |
| `npm run db:verify-migrations` | PASS: 333 entradas hasta `0332_acoustic_hellcat`, checksums verificados. Sin migración nueva |
| `pdtp-revision-window-concurrency-postgres` contra el contenedor desechable `:55432` (base `bodega_t6_window_test`) | 1/1 PASS |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado propio (puerto 3200, base desechable `bodega_t6_e2e`, reconstruida) | **166 PASS, 1 fallo, 1 omitida.** El fallo fue `pdtp-reporte-gestion:51`, que esperaba el nombre de archivo sin versión. Se ajustó el spec y se volvió a correr: 3/3 PASS. La omitida es la condicional de siempre (`pdtp-habilitacion:98`). El spec nuevo, 4/4 |
| Recorrido de navegador por script (Playwright) a 1440 y 390 px, con fixture 2025 propio (v2 reemplazada, v3 activa) | Se recorrieron ficha v2, ficha v3, tablero 2025, reporte de la v2, vista semanal de la v2, Aprobaciones e inicio: **HTTP 200, 0 errores de consola, 0 respuestas 5xx**. Se revisaron las capturas: el rótulo del año consolidado envuelve bien a 390 px. A 1440 px no hay desborde. A 390 px hay 7 px de desborde en el tablero PDTP y 9 px en inicio; **son previos a T6**: los mismos valores aparecen en `/prevencion/pdtp?anio=2026` (una sola versión, sin rótulo nuevo) y los causan la fila de acciones del encabezado ("Nuevo programa") y las tarjetas de inicio |

## Pendiente y riesgos

- **Hallazgo previo, no corregido:** a 390 px la fila de acciones del encabezado del tablero PDTP y las tarjetas de inicio desbordan unos 7 y 9 px.
- **Lectores que siguen mirando sólo la versión activa del año:**
  - constancias (`constancias.ts`), recordatorios de celdas y conectores de submódulos que resuelven "el activo del año";
  - la cola `/pendientes`.
  No muestran deudas de la ventana de una versión reemplazada. Registrar y cerrar esas semanas sí es posible, desde la ficha de esa versión.
- **Activar desde la firma legal** (`activatePdtpIfAllStepsApproved`) descarta el aviso de pasos posteriores. Queda en el control de cambios, pero la firma no lo muestra como toast.
- **Las casillas obsoletas se borran, no se cancelan** (no hay estado para eso sin migración). Sólo se borran pendientes sin hecho ni evidencia, así que no se pierde información.
- **Ocurrencias programadas** (actividades del creador nuevo): el recorte de la versión anterior es por día de activación, igual que su materialización. Su vía manual en una versión reemplazada sigue exigiendo programa activo, fuera del alcance de D24.
- **No verificado:**
  - `npm run test:e2e` completo;
  - las demás suites `*-postgres` (sólo se corrió la nueva);
  - `npm run doctor`;
  - una revisión v+1 real sobre una copia del programa 2026;
  - D6: cuántos cierres emitidos cambiarían. No debería haber ninguno, porque sin sucesora nada cambia y antes no se podía cerrar un mes posterior a la activación desde la v1.

## Conflictos de merge esperados

- `lib/services/pdtp/compliance.ts` (T7/I12): `getPdtpComplianceIndicators` quedó partido en `loadPdtpIndicatorInputs` y `computePdtpIndicatorsFromInputs` (el cuerpo es el mismo, reordenado). Además, `getPdtpComplianceIndicatorsForScope` e `getPdtpIntegralComplianceForScope` tienen un parámetro `options` nuevo. I12 debería construir su núcleo único sobre estas dos funciones.
- `lib/services/pdtp/accreditation.ts`: el bloque `effectiveForDate` de `resolvePdtpActiveProgramForEvent` se reemplazó por la resolución por período.
- `lib/services/pdtp/executions.ts`, `deviations.ts` y `period-closures.ts`: guardas de estado y activación reemplazadas por `assertPdtpProgramAcceptsPeriod`.
- `lib/services/pdtp/lifecycle.ts`: la cola posterior a `activatePdtpProgram` se reescribió y ahora devuelve `postActivationWarnings`.
- `lib/services/prevention-program-slots.ts`: `ensurePreventionProgramSlotsForProgram` devuelve `PreventionProgramActivationSlotCounts`.
- `lib/services/pdtp/sheets.ts`, `helpers.ts` (`loadApprovedExecutionsForWorksites` acepta `until`), `tests/pglite-files.ts` (una entrada al final del bloque PDTP) y `qa/reports/latest.md`.
