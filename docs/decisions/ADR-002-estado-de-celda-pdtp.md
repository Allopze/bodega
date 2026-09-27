# ADR-002: Estado de cumplimiento de una celda del PDTP

## Estado

Propuesta. Documenta el estado actual y recomienda un camino; no cambia código.

## Fecha

2026-09-27

## Contexto

La auditoría de production readiness del 2026-09-26 (`qa/reports/2026-09-26-prevencion-production-readiness.md`, hallazgo **PREV-M03**) observó que el estado de cumplimiento de una celda del Programa de Trabajo Preventivo vive en cuatro tablas más un estado derivado, y que `evidence_status` no tenía lector.

Una **celda** es `(actividad, faena, año, mes, semana)`. Para las actividades a demanda o por evento, la unidad es el **caso** (una obligación) y no la semana.

### Dónde vive hoy el estado

| Fuente | Tabla / función | Qué afirma | Quién escribe |
|---|---|---|---|
| Libro de ejecuciones | `pdtp_executions` | "Se hizo esta cantidad, con esta evidencia", con estado `draft`/`submitted`/`approved`/`rejected` y `origin` manual, importado o de integración. Una fila por celda y origen, más las de obligación (`obligation_id`) | `markPdtpExecution`, `reportPdtpObligation`, conectores de acreditación, importador XLSX, aprobar/rechazar |
| Ocurrencias programadas | `pdtp_scheduled_instances` | "Esta fecha tocaba hacerlo": `pending`, `in_progress`, `submitted`, `completed`, `not_applicable`, `cancelled` | `reconcilePdtpScheduledInstances` (materializa), `recordPdtpScheduledInstanceOutcome` (enviar, "no aplica", cancelar), y `syncPdtpScheduledInstanceFromExecution` (la única vía que escribe `completed`) |
| Obligaciones | `pdtp_obligations` | "Ocurrió un caso que exige hacerlo antes de X": `pending`, `overdue`, `reported`, `completed`, `cancelled` | conectores, `createPdtpObligation`, `reportPdtpObligation`, aprobar/rechazar, `refreshPdtpObligationStatuses` (cron) |
| Desvíos | `pdtp_execution_deviations` | "Esta celda no se hizo por un motivo" (`not_performed`), "no aplica" (`not_applicable`, con revisión desde 0331) o "se movió" (`reprogrammed`) | `recordPdtpDeviation`, revisión del "no aplica" |
| Estado derivado | `period.ts` (`PdtpActivityStatus`), `compliance.ts` (`effectiveApprovedExecutionsByCell`, `pdtpCountedExecuted`), `sheets.ts` | `pending`/`executed`/`overdue`/`not_scheduled`/`not_performed` y el % del indicador, calculados en cada lectura | nadie: se recalcula |
| Foto congelada | `pdtp_period_closures` | El mes tal como se cerró y distribuyó | cierre de período |

`evidence_status` de `pdtp_executions` ya tiene escritor y lector: `markPdtpExecution` lo calcula (PREV-M03 parcial) y la aprobación lo lee para no exigir un archivo a las filas `migrated_without_attachment`. Sigue sin ser un estado de la celda: describe una carga, no la celda.

### Invariantes que ya se hacen cumplir (tandas T1–T7)

Las tandas del plan de pendientes (`qa/reports/2026-09-27-prevencion-cierre-plan.md`) no unificaron las tablas, pero dejaron reglas que las mantienen coherentes entre sí:

1. **Un hecho cuenta una vez (T1, T3/I08-a).** `effectiveApprovedExecutionsByCell` es la regla única: la carga manual y las acreditaciones de la misma semana valen `max(manual, Σ acreditaciones)`, y el hecho de una ocurrencia completada no se suma otra vez en su celda. La usan el indicador, el eje, el reporte de gestión, la planilla, la E del RE-36 y los objetivos del cierre.
2. **Tope por actividad y mes (T1, D1).** `pdtpCountedExecuted`: cada actividad aporta al mes como máximo su plan. Una sobreejecución no compensa otra actividad en cero.
3. **Sólo cuenta lo aprobado (T3, D19).** Una ocurrencia está `completed` únicamente porque su ejecución enlazada está aprobada, y sólo `syncPdtpScheduledInstanceFromExecution` lo escribe. La vía manual envía, no completa. Orden de bloqueo: ejecución → ocurrencia.
4. **Ejecución y desvío se excluyen (T2).** Con un `not_applicable` o `reprogrammed` vigente, o un "no aplica" en revisión, la celda no admite ejecuciones. Un `not_performed` se retira solo si llega una ejecución con cantidad. Se decide dentro de la transacción, bajo el advisory lock por celda (`pdtpCellLockKey`).
5. **Mes cerrado es inmutable (T2/T6).** `assertPdtpPeriodOpen` corre dentro de la transacción en ejecuciones, ocurrencias y desvíos. Sin él, la foto de `pdtp_period_closures` quedaría desmintiendo a las tablas vivas.
6. **Ventana por versión (T6, PREV-C05-B).** `assertPdtpProgramAcceptsPeriod` se relee con la fila del programa `FOR SHARE`: una v1 reemplazada sólo acepta los meses de su ventana.
7. **Evidencia verificable (T4).** Archivo real salvo `declaration_allowed`, sha256 al vincular, historial de envíos append-only, y un archivo no se enlaza desde otra faena (`assertPdtpEvidenceLinkable`).
8. **Borrado restringido (T7a, 0333).** Ejecuciones, desvíos y cierres tienen `ON DELETE RESTRICT`. Borrar un programa ya no arrastra su historia en silencio.
9. **Autoría (PREV-I03, esta rama).** La celda la registra su responsable por cargo, la persona asignada o Prevención (`registration-authority.ts`).

Estos invariantes viven en código de servicio, no en la base. Se prueban con PGlite y con las suites `*-postgres`.

## Problema

Cuatro tablas con máquinas de estado propias, reconciliadas por reglas de lectura, cuestan tres cosas:

- **Cada lector nuevo debe conocer las reglas.** Un reporte que sume `pdtp_executions` directamente cuenta dos veces lo que el indicador cuenta una. Ya pasó (I08-a) y se corrigió centralizando la regla, no el dato.
- **"¿Por qué esta celda dice X?" exige leer cuatro tablas y el código de `compliance.ts`.** Es la pregunta de un auditor, y hoy no tiene una fila que la responda.
- **Las escrituras se coordinan con locks y orden de bloqueo.** Funciona y está probado, pero toda vía nueva de escritura debe repetir el patrón (lock por celda, período abierto dentro de la transacción, orden ejecución → ocurrencia).

## Opciones

### A. Tabla canónica de celdas (`pdtp_cells`)

Una fila por celda (y por caso) con el estado final, mantenida en la misma transacción que cada escritura de las cuatro fuentes.

- **A favor:** una fila responde el estado; los lectores dejan de reimplementar reglas; es indexable para tableros.
- **En contra:** es una **quinta** fuente que puede divergir. Toda vía de escritura, incluidos los conectores, el importador y los scripts de backfill, debe actualizarla en la misma transacción, o la tabla miente. Requiere migración y un backfill sobre datos reales, con una ventana en que las dos representaciones conviven. El estado derivado depende del plan vigente, de las ventanas por versión y de la fecha de hoy (`overdue`), así que igual habría que recalcular parte en lectura.
- **Riesgo:** alto. Repite el tipo de incidente que la auditoría encontró con `evidence_status`: una columna que nadie mantenía.

### B. Vista derivada (`pdtp_cell_state_v`, SQL o función de servicio)

Una sola definición, en SQL o en un módulo de servicio, que a partir de las cuatro tablas devuelve el estado de cada celda con su **motivo** ("aprobada por acreditación de inspección", "no aplica aprobado", "vencida sin desvío").

- **A favor:** no agrega estado que mantener: no puede divergir. Centraliza lo que hoy está repartido entre `period.ts`, `compliance.ts` y `sheets.ts`. El motivo responde la pregunta del auditor. Se puede empezar como función TypeScript, sin migración, y pasar a vista SQL si el rendimiento lo pide (T7b ya bajó el tablero de 1.553 a 75 consultas, con un archivo de referencia para comparar cifras).
- **En contra:** las escrituras siguen coordinadas por los invariantes 3 a 6, que siguen viviendo en servicios. Una vista SQL de estas reglas es difícil de leer y de probar.
- **Riesgo:** medio-bajo. El riesgo es de equivalencia (que la vista diga lo mismo que el indicador), y se controla con el archivo de referencia de T7b.

### C. Dejarlo como está

- **A favor:** costo cero. Los invariantes están probados y la re-auditoría no encontró divergencias abiertas.
- **En contra:** el costo de las lecturas nuevas se mantiene y "¿por qué esta celda dice X?" sigue sin respuesta directa.

## Recomendación

**Opción B, en tres pasos, sin tabla nueva.**

1. **Función de servicio `getPdtpCellStates`** (sin migración). Devuelve para un programa, faena y rango de meses `{ celda, estado, motivo, fuentes: { ejecuciónIds, ocurrenciaId, obligaciónIds, desvíoId } }`. Se construye **encima de** `effectiveApprovedExecutionsByCell` y de las mismas cargas que usa `compliance.ts`, no al lado. Criterio de aceptación: para el archivo de referencia de T7b, el indicador calculado desde `getPdtpCellStates` es idéntico cifra por cifra al actual.
2. **Migrar los lectores uno por uno** (planilla, `PdtpActivityStatus`, reporte de gestión, RE-36), cada uno con su prueba de equivalencia antes y después. Un lector que no pase su prueba se queda en la vía antigua hasta que pase.
3. **Mostrar el motivo en la UI** (tooltip de la celda y detalle de la ejecución), que es el valor visible de la unificación para Prevención y los auditores.

Sólo si después de 2 el rendimiento lo exige, materializar la función como **vista SQL** (o vista materializada refrescada por el cron de conciliación), siempre como derivada y nunca escrita por la aplicación. La opción A queda descartada mientras las escrituras vengan de más de una vía, porque es la opción con más superficie para divergir.

### Qué no cambia

- Las cuatro tablas siguen siendo las fuentes de verdad de lo que cada una afirma (un hecho, una ocurrencia, un caso, un desvío). La unificación es de la **lectura**.
- Los invariantes 1 a 9 siguen en los servicios. Si alguno se lleva a la base (por ejemplo, un `CHECK` o un trigger de exclusión ejecución/desvío), va en una migración propia con su análisis de bloqueo, no dentro de este cambio.

## Riesgos y controles

| Riesgo | Control |
|---|---|
| La función dice algo distinto que el indicador | Prueba de equivalencia contra el archivo de referencia de T7b antes de migrar cada lector |
| Regresión de rendimiento en el tablero | Mismo presupuesto de consultas que T7b (75); medir antes y después |
| Un lector migrado a medias mezcla las dos vías | Migrar por lector completo, con su prueba; no por pantalla parcial |
| Se reintroduce estado escrito (tentación de "cachear" en una columna) | Esta ADR: el estado de celda es derivado. Una columna nueva de estado exige revisar esta decisión |

## Consecuencias

- M03 queda **cerrado como decisión** (esta ADR) y **abierto como trabajo** en los pasos 1 a 3, que no requieren migración.
- `evidence_status` conserva su alcance actual (describe una carga, no la celda) y no se promueve a estado de celda.
