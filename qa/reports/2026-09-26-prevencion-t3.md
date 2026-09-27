# Tanda T3: fuentes, instancias e integración (2026-09-26)

T3 es la tanda del plan de pendientes de la auditoría de Prevención que cierra la integración entre el libro de ejecuciones, las ocurrencias programadas y los submódulos de origen (plan en `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, sección T3). Rama `prevencion/t3-fuentes`, sobre `41b41014` (integración ola 1: T0+T1+T5+T2+T4+laterales). **Sin migración.**

Decisiones aplicadas con su valor por defecto:
- **D16:** una inspección fuera de la membresía se cierra y su hecho queda rechazado con motivo.
- **D17:** el backfill de B01 omite y lista lo cerrado, y `--actor` es obligatorio.
- **D19:** en las instancias sólo cuenta lo aprobado, y la vía manual no completa.
- **D4:** la N°63 se mantiene. Además, el barrido RE-20 corre cada hora (D18) y sólo desde la activación del programa.

## Qué se corrigió

| ID | Cambio | Archivos |
|---|---|---|
| I08-a (residuales) | **Regla única de "un hecho, un conteo"** en `effectiveApprovedExecutionsByCell`. La celda se deduplica con la fila enlazada incluida (D2) y después se descuenta la parte que es el hecho de la ocurrencia. Una carga manual de la misma semana queda absorbida, y lo que declare por encima sigue contando. La usan el indicador, el eje, el reporte de gestión, la planilla, la E del RE-36 y los objetivos del cierre (que salen del RE-36). Las vistas que no representan ocurrencias (eje, reporte y planilla) llevan el hecho a la celda de su ocurrencia (`instanceCells`), que es donde lo cuenta el indicador. El RE-36 no lo repite en E porque ya lo muestra en su hoja de calendario. `loadProgramScheduleAndExecutions` adjunta la ocurrencia enlazada. D19: una ocurrencia completada cuenta sólo si su ejecución enlazada está aprobada, lo que cubre las filas heredadas del enlace anterior | `compliance.ts`, `helpers.ts`, `sheets.ts`, `management-report.ts`, `re36-document.ts`, `scheduled-compliance.ts` |
| I08-c | La acción manual ya no acepta `sourceMetadata` ni `complete`: sólo enviar, "no aplica" y cancelar. Las tres pasan por `assertPdtpPeriodOpen` dentro de la transacción, y la acción autentica antes de validar. Nueva `syncPdtpScheduledInstanceFromExecution`: es la única vía que escribe "cumplida" y la única que reabre, con orden de bloqueo **ejecución → ocurrencia** | `scheduled-execution.ts`, `actions/scheduled-instances.ts`, `lib/validation/prevention-module/pdtp.ts` |
| I08-d | El enlace del cumplimiento ya no pasa la `evidenceRef` descriptiva, que no es un archivo PDTP y dejaba la ocurrencia pendiente para siempre, ni copia los metadatos del conector. Todas las políticas enlazan, `manual_confirmed` incluida. No se enlaza a una ocurrencia de un mes cerrado. Un hecho nuevo desplaza a una ejecución rechazada o en borrador. Cada enlace va en su savepoint | `fulfillment.ts` |
| I08-e | Aprobar completa la ocurrencia y exige su mes abierto. Rechazar la devuelve a trabajo abierto sin desenlazarla. `/pendientes` marca bloqueada toda ocurrencia enviada, porque espera la aprobación en el PDTP cualquiera sea la política | `executions.ts`, `executable-instances.ts` |
| I08-f | `pdtpConnectorAcceptsFulfillmentSource` acepta por binding (`capacitacion_ocurrencia`, `vigilancia`) y respeta el instrumento fijado en la configuración anual. No se agregan eventos nuevos al registro | `connectors.ts` |
| I08-b | Revocar la fuente reabre la ocurrencia (pendiente, o en curso si se había iniciado), limpia su resultado, deja traza y la desenlaza. Todo va en un savepoint: una falla sólo se registra y no revierte la anulación del módulo de origen | `accreditation.ts` |
| I16 | `PdtpWorksiteNotInProgramError` lleva programa y faena. El libro deja el hecho `rejected` con `skippedWorksiteNotInProgram` y un motivo neutro ("…o salió de ella al cerrarse"), no `error`. El cierre de inspección no falla (D16): el hecho queda rechazado en la misma transacción. El reconciliador ordena por `updatedAt, id`, y el vaciado fija un tope de `updatedAt` para no volver a tomar lo que reintentó. El panel del libro muestra esos rechazos a quien cubre la faena (`sessionWorksiteIds`), y si no se pasa, no los abre. Reabrir o cancelar una inspección con transacción deja la revocación en el libro (ver decisiones) | `accreditation.ts`, `fulfillment.ts`, `backlog.ts`, `pdtp-accreditation-connectors.ts`, `[programId]/page.tsx` |
| C03.5 | **Verificado, sin rehacer:** T5 ya lanza `PdtpNoActiveProgramError` para un hecho de un año posterior y acota el libro por año. **Hueco cerrado:** la resolución relee la fila del programa `FOR SHARE`, igual que `reopenPdtpPeriod`, y `accreditPdtpFromEvent` corre en una transacción (un savepoint si el conector trae la suya) para sostener el lock hasta escribir. Un hecho tardío ya no se cuela en un año que se está cerrando | `accreditation.ts` |
| B01-BACKFILL | `onlyExecutionIds` en la revocación. `scripts/revert-pdtp-revoked-approvals.ts` genera por defecto un reporte JSON, y `--apply` exige `--actor` con un usuario real. Clasifica cada caso como `revert`, `already_reverted`, `source_mismatch`, `source_recompleted`, `closed_program`, `closed_period`, `aggregated_manual` o `auto_approved`, y sólo aplica `revert`. Usa una transacción por evento, que reclasifica con el evento bloqueado. Anota `result_json.backfillB01` **sin tocar `updated_at` ni `status`**. Declara el período ciego anterior al 03-09-2026 y lista esas aprobaciones para revisión manual. `--include-inspections` suma el detector por estado del run. Hay un servicio one-shot de compose que sólo reporta (bundle esbuild y COPY), queda fuera de `deploy-prod.sh`, y hay un script npm para uso local. RUNBOOK actualizado | `accreditation.ts`, `scripts/revert-pdtp-revoked-approvals.ts`, `Dockerfile`, `docker-compose.yml`, `package.json`, `docs/deploy/RUNBOOK.md` |
| D4 | `reconcileIncidentRe20Obligations` corre dentro del cron `prevention-incident-reminders`, cada hora y con el mismo candado. Repara desde las tablas del incidente:<br>- toma sólo incidentes creados desde la activación de un programa activo;<br>- entra todo incidente cuyas obligaciones no cubren 66, 67 y las filtrables vigentes, o que tiene alguna pendiente (pérdida parcial);<br>- crea las obligaciones faltantes y cancela lo que el triage ya no exige;<br>- reporta cada hito con su fecha real sólo si la obligación no tiene **ninguna** ejecución (un rechazo humano no se reenvía) y el mes está abierto;<br>- nunca lanza, y la ruta aísla su falla de los recordatorios.<br>La suite `prevention-incidents-re20` ya estaba registrada desde T4 | `incident-accreditation-connector.ts`, `app/api/cron/prevention-incident-reminders/route.ts` |

### Regla de conteo único (I08-a), para el ADR

Una ejecución aprobada enlazada a una ocurrencia **que cuenta** es el hecho de esa ocurrencia. Una ocurrencia cuenta cuando está completada, su ejecución está aprobada (D19) y su fecha no es anterior al corte de exigibilidad de la vista.

1. Se deduplica la celda semanal con `max(manual, Σ integración)`, con la fila enlazada incluida.
2. Se descuenta de esa celda la cantidad de la fila enlazada, sin bajar de 0.
3. Si la vista no representa ocurrencias, suma la cantidad planificada de la ocurrencia en la celda de su `scheduledFor`.

Ejemplos:
- manual 1 + enlazada 1 → la celda vale 0 y la ocurrencia 1.
- manual 3 + enlazada 1 → la celda vale 2 y la ocurrencia 1.
- enlazada a una ocurrencia enviada, en "no aplica" o cancelada → sigue contando por el libro.

## Decisiones fuera de los valores por defecto

- **La revocación de inspecciones deja una fila `revoked` ya resuelta, no `pending`.** El plan pedía `recordPendingPdtpFulfillmentRevocation`. Con `pending`, el reconciliador habría vuelto a revocar lo ya revocado y habría duplicado la historia de la ejecución (T4, `audit_log`). La función nueva es `recordResolvedPdtpFulfillmentRevocation`, y el efecto buscado es el mismo: el `completed` viejo queda rechazado por "última intención".
- **`accreditPdtpFromEvent` abre una transacción.** Hace falta para que el `FOR SHARE` de C03.5 proteja algo. Efecto lateral: las escrituras de varias actividades de un mismo hecho ahora son atómicas.
- **El eje, el reporte y la planilla también cuentan el hecho de una ocurrencia en el mes de la ocurrencia.** El pedido era aplicar la exclusión en esas vistas. Excluir sin más habría hecho desaparecer el hecho de las vistas que no cargan ocurrencias, así que se mueve en vez de quitarse. El planificado de las ocurrencias todavía no entra en esas vistas: eso es I12/T7.
- **`source_recompleted` en el backfill** considera cualquier finalización posterior no rechazada, no sólo las `accredited`. Una en `error` o `pending` es igualmente la última intención del origen.
- **No se aplicó la rotación de cola a `reconcilePdtpTriggerEvents`.** Tiene el mismo patrón, pero no estaba en el alcance de T3. Queda como pendiente.

## Evidencia de TDD (rojo → verde)

| Prueba | Rojo observado | Verde |
|---|---|---|
| `compliance-cells.test.ts` (I08-a, 6 casos nuevos) | 4 de 6. Las 2 de "sigue contando por el libro" caracterizan | 13/13 |
| `scheduled-compliance.test.ts` (D19) | 1/1 | 3/3 |
| `connectors.test.ts` (I08-f) | 3/3 (función inexistente) | 8/8 |
| `scheduled-execution.test.ts` (estado derivado, vía manual) | 2/2 | 6/6 |
| `actions/scheduled-instances.test.ts` (nuevo) | 3/3 | 3/3 |
| `pdtp-scheduled-instance-integrity.test.ts` (nuevo, PGlite) | 16 de 19. Pasaban desde el inicio "no aplica con mes abierto", "volver a completar la misma fuente" y "una falla al reabrir no revierte la revocación": sin I08-b no se reabría nada | 20/20 |
| ↳ "el reporte de gestión cuenta el hecho en el mes de su ocurrencia" | **Escrita después del código.** Rojo verificado revirtiendo `management-report.ts` | ✓ |
| `pdtp-fulfillment.test.ts` (I16: rechazo, heredado, cola, panel) | 4 de 4 | ✓ |
| ↳ "vaciar el libro recorre cada evento una sola vez" | Pasaba antes: caracteriza que el cambio de orden no rompe el vaciado | ✓ |
| ↳ caso existente de instancia `completed` sin aprobación | Consagraba I08-e; se reescribió (ahora `submitted`) | ✓ |
| `pdtp-accreditation.test.ts` (I16: cierre en faena ajena; cancelado antes de activar) | 2 de 2 | ✓ |
| `pdtp-accreditation.test.ts` (`onlyExecutionIds`) | Rojo verificado desactivando el filtro, porque la implementación se aplicó antes de correrla | ✓ |
| `pdtp-accreditation-year-close-postgres.test.ts` (nuevo, C03.5, Postgres real) | Rojo: el hecho se escribía sin esperar al cierre (`settled` = true) | 1/1 |
| `scripts/__tests__/revert-pdtp-revoked-approvals.test.ts` (nuevo) | Módulo inexistente | 11/11 |
| `deploy-workflow.test.ts` (one-shot B01) | 1/1 | 34/34 |
| `prevention-incidents-re20.test.ts` (D4, 7 casos) | 7/7 (función inexistente) | 20/20 |
| `prevention-cron-contract.test.ts` (barrido encadenado y aislado) | 2/2 | 34/34 |

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS sobre el HEAD final (lint corre además en el hook de cada commit) |
| `npm run test:fast` | 770 archivos / **10.048 pruebas PASS**, 31 archivos omitidos (suites `*-postgres`, incluida la nueva) |
| `npm run test:pglite` | 210 archivos / **2.545 pruebas PASS** |
| `pdtp-accreditation-year-close-postgres` y `pdtp-year-close-concurrency-postgres` contra el contenedor desechable `:55432` (bases `_test`) | 1/1 y 1/1 PASS |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado (puerto 3200, base desechable `bodega_t3_e2e`, reconstruida) | **162 PASS, 2 omitidas**, ambas condicionales de `pdtp-habilitacion` (`:67` y `:98`); T4 tenía sólo la de `:98`. `:67` depende del estado que dejan las pruebas anteriores y no se investigó más |
| Recorrido de navegador por script a 1440 y 390 px | Se recorrieron la ficha `/prevencion/pdtp/pdtp-2025-e2e`, `/pendientes` y `/prevencion/pdtp/aprobaciones`. Antes se sembró en la base desechable un hecho rechazado por faena fuera de la membresía (`ws-restricted-e2e`), insertado directo, no por el conector. En los dos anchos el panel del libro muestra el motivo nuevo. Hubo 0 px de desborde horizontal, sin errores de consola ni respuestas 4xx/5xx. El script de B01 en modo reporte contra la misma base terminó con 0 casos y no escribió nada. **Limitación:** la verificación del panel es por texto; la captura de página completa no pasa del alto de la ventana porque el scroll vive en el contenedor del shell |

## Pendiente y riesgos

- **Cambio visible, sólo en actividades del creador nuevo (no `legacy_grid`):** las fuentes que no se autoaprueban dejan la ocurrencia "Enviada" hasta que alguien apruebe en el PDTP. El programa 2026 usa `legacy_grid`, así que hoy no se ve en producción.
- **Etiquetas del creador:** "Registro completado" (`source_completed`) ya no completa la ocurrencia sin aprobación. El texto de ayuda del selector de política queda para UX (W8). Los recordatorios de ocurrencias `submitted` siguen saliendo.
- **Datos heredados:** antes de activar instancias en producción conviene correr en modo lectura `SELECT count(*) FROM pdtp_scheduled_instances i JOIN pdtp_executions e ON e.scheduled_instance_id = i.id WHERE i.status = 'completed' AND e.status <> 'approved'`. El indicador ya no las cuenta, pero su estado visible sigue diciendo "cumplida".
- **B01-BACKFILL no se ejecutó sobre ninguna base real.** El orden es reporte, revisión con Prevención, respaldo y recién entonces `--apply --actor`. El período ciego (antes del 03-09-2026) sólo se lista.
- **Preflight de cableado:** los errores permanentes por faena fuera de la membresía pasan a `rejected`, que no bloquea el preflight. Puede pasar a `ok` donde antes no pasaba; hay que avisarlo en las notas del despliegue. `deploy-prod.sh` ya corre el reconciliador tras cada deploy, así que los `error` heredados se convierten solos.
- **D4, límites:**
  - Lo perdido durante una v1 no se repara después de activar v2.
  - El evento configurable `incident_registered` no se repara.
  - La fecha del preliminar es la del último envío, y el actor del preliminar es aproximado (quien inició la investigación).
- **Sin corregir, fuera de alcance:**
  - la misma cabeza de cola en `reconcilePdtpTriggerEvents`;
  - la rama transaccional de inspecciones no deja rastro para `skippedExcluded` y `skippedCatalogNotFound`;
  - `derivePdtpScheduledInstanceStatus` compara la fecha en UTC;
  - la ejecución y la revisión de un run comparten la clave del libro (`fulfillment.ts:92-94`), ya registrada como ticket en el plan.
- **No verificado:** `npm run test:e2e` completo, las demás suites `*-postgres`, `npm run doctor`, el cron en un contenedor real y el reporte del script contra una copia de producción.

## Conflictos de merge esperados

- `lib/services/pdtp/compliance.ts` (T6/T7): cambió la firma de `effectiveApprovedExecutionsByCell` (opciones) y el bloque de instancias del indicador. `helpers.ts`: `loadApprovedExecutionsForWorksites` devuelve `cutoff` por faena.
- `lib/services/pdtp/accreditation.ts` (T6 reemplaza la resolución por período): el `FOR SHARE` vive en `resolvePdtpActiveProgramForEvent`, y `accreditPdtpFromEvent` es ahora un envoltorio transaccional de `accreditPdtpFromEventInTransaction`.
- `lib/services/pdtp/executions.ts`: ganchos de sincronización en aprobar y rechazar.
- `lib/services/pdtp/fulfillment.ts`: el cursor del reconciliador pasa de `createdAt` a `updatedAt` (`PdtpFulfillmentReconcileCursor`).
- `Dockerfile`, `docker-compose.yml`, `package.json`, `deploy-workflow.test.ts` y `tests/pglite-files.ts`: agregados al final de sus listas.
- La migración 0332 de otro frente no choca: T3 no tocó el esquema.
