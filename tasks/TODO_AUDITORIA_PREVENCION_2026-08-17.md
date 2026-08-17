# TODO — remediación auditoría de Prevención (2026-08-17)

Informe: `AUDITORIA_MODULO_PREVENCION_2026-08-17.md` (raíz).
Base: `c707f4b`. 61 hallazgos (1 CRITICAL, 15 HIGH, 27 MEDIUM, 13 LOW, 5 INFO).

Se trabaja **por causa raíz**: 30 de los 61 son tres patrones repetidos (CAS cosmético,
mutación hija sin bump de `version`, escritura + historial sin `tx` compartida).

## Reglas de esta tanda

- [ ] `npm run typecheck` + `npm run lint` + tests relevantes verdes antes de cerrar cada fase.
- [ ] Ningún cambio de esquema sin releer `_journal.json` en el momento de generar
      (checkout compartido: drizzle migra el árbol entero, no sólo mis cambios).
- [ ] Lo que exija decisión de Prevención NO se implementa a medias: se deja listado.
- [ ] No re-litigar los falsos positivos de las 6 auditorías previas.

---

## Fase 0 — Contención del CRITICAL (fuera del repo, requiere al usuario)

- [ ] **GC-01a** Verificar en el scheduler externo si `pdtp-evidence-gc` está agendado.
      Si lo está: desactivarlo o pasarle `?dryRun=true` hasta desplegar el fix.
- [ ] **GC-01b** Si estuvo corriendo: cruzar `prevention_capa_evidence.reference` contra
      el contenido de `storage/pdtp-evidence/` para cuantificar la evidencia ya perdida.

## Fase 1 — P0: los 6 arreglos inmediatos ✅ COMPLETA

Verificación: `typecheck` + `lint` limpios; 140 tests PGlite de prevención en verde.

- [x] **GC-01** `evidence-gc.ts` consulta ahora los DOS productores del directorio
      (`pdtp_executions` + `prevention_capa_evidence`). Test de regresión nuevo en
      `pdtp-evidence-gc.test.ts` ("conserva la evidencia referenciada SÓLO desde
      prevention_capa_evidence"), 4/4 verde.
- [x] **PRIV-01** El workbench filtra casos reservados por membresía nominativa + permiso
      + alcance de faena, y enmascara `fitnessStatus` sin `health:view_restrictions`.
      Los no visibles se reportan como contador (`restrictedReservedCaseCount`) para que
      el inventario no mienta por omisión. `getPreventionPrivacyRequestWorkbench` ahora
      exige `ctx` (necesita el `userId` para la membresía).
- [x] **HIG-01** `FOR UPDATE` sobre el GES en `recordExposureMeasurement`.
- [x] **SST-03** `getEvaluation(id, worksiteIds, tx?)`, mismo contrato que `assertEditable`;
      los dos call sites de `action-plan.ts` le pasan `tx`. Verificado que los demás
      call sites quedan ANTES de abrir la transacción.
- [x] ~~**SST-04** `saveActionPlanItem`: `assertEditable` dentro de la transacción.~~
      **FALSO POSITIVO — no re-reportar.** Lo inmutable al cerrar el acta son las
      respuestas y hallazgos, NO el plan de acción, que por diseño se sigue trabajando
      después del cierre. El test `"allows continuing the corrective action plan after
      the evaluation is closed"` (`sst-delete-evaluation.test.ts:320`) lo afirma
      explícitamente. El gate se implementó, rompió ese test y se revirtió; queda un
      comentario en `action-plan.ts` explicando por qué NO lleva el gate.
- [x] **CRON-01** `sst-weekly-alerts` con el gate de `NODE_ENV` de sus siete hermanos.

## Fase 2 — Patrón repetido: CAS cosmético y `version` que no se mueve ✅ COMPLETA

Verificación: `typecheck` + `lint` limpios; 4.182 tests de la suite rápida, 140 PGlite de
prevención y 76 de Postgres real (higiene, capacitación, inspecciones, CPHS, privacidad) en verde.

- [x] **HIG-02** `setProtocolApplicability`: `version` en el `WHERE` + incremento en SQL +
      `!saved` ⇒ error de concurrencia.
- [x] **HIG-06** `closeExternalEngagement`: `FOR UPDATE` sobre la interacción (serializa
      contra `addPrescribedMeasure`, que era el estado que el gate quería impedir),
      `expectedVersion` e `isNull(closedAt)` en el `WHERE`, incremento en SQL.
- [x] **HIG-12** — parcial, por diseño. Corregidas las **tres con consecuencia real**:
      `resignCommitteeMember` (perdía la carrera contra `replaceCommitteeMember`),
      `markAgendaSent` (pisaba la evidencia de convocatoria en plazo) y `revokeCompetency`
      (pisaba la autoría del retiro de una habilitación).
      **NO se tocaron** `recordCommitteeDtRegistration`, `linkActivityToMeeting` ni
      `recordSurveillanceOutcome`: ahí el *last-write-wins* es benigno y un guard de estado
      bloquearía correcciones legítimas (re-registrar la DT con la referencia corregida,
      re-vincular una actividad a otra sesión, corregir el resultado de un control).
- [ ] ~~**HIG-08** `recordTrainingAttendance` / `saveInspectionAnswers`: bump de `version`.~~
      **DIFERIDO con causa.** Se implementó y **rompió 5 tests de Postgres real**. Motivo:
      `session-detail.tsx` e `inspection-run-detail.tsx` toman `expectedVersion` de sus props
      y **no refrescan tras guardar**, así que el bump convertía el flujo normal de un solo
      usuario (registrar asistencia → cerrar) en un falso "cambió mientras la editabas".
      Además la analogía con `bumpPermitVersion` es imperfecta: `closeTrainingSession`
      recalcula sobre la asistencia vigente, así que no hay lost update, sólo la posibilidad
      de aprobar sin haber visto un cambio ajeno. **Para retomarlo hay que mover el bump Y
      refrescar la UI en el mismo cambio**, con cuidado del footgun `router.refresh` +
      `loading.tsx`. Queda comentario en ambos servicios explicando por qué no lo llevan.

## Fase 3 — Atomicidad (transacción ausente) ✅ COMPLETA

Verificación: `typecheck` + `lint` limpios; 4.183 tests de la suite rápida, 107 PGlite de
PDTP/prevención y **176 de Postgres real (las 13 suites `prevention-*-postgres`)** en verde.

- [x] **SST-01** `archiveEvaluationPdf`: las cinco escrituras en una transacción. Causa raíz
      compartida resuelta: `recordAuditEntry` acepta ahora `client` (como
      `recordOperationalActivity`), que era lo que mantenía dos convenciones para la misma
      tabla de auditoría.
- [x] **DATA-03** Las cinco escrituras RE-20 en transacción, con `getInvestigableIncident`
      aceptando cliente y tomando `FOR UPDATE` sobre el incidente. La acreditación PDTP
      queda post-commit, que es el patrón deliberado del archivo.
- [x] **DATA-02** `createPreliminaryReport`: transacción + `onConflictDoUpdate` sobre el
      único de `incidentId`, en vez de leer-y-decidir.
- [x] **PDTP-02** `updatePdtpActivity`: actividad + calendario + changelog en una tx.
- [x] **PDTP-03** `addPdtpActivity`: hojas resueltas ANTES de escribir + todo en una tx.
- [x] **PDTP-05** `submitExecutionChecklist`: una transacción y **en secuencia**, sin
      `Promise.all`. Ver la trampa de abajo.
- [x] **PDTP-06** `rollbackPdtpImportBatch`: carga, chequeo de alcance y guarda de "cambios
      posteriores" dentro de la tx, con `FOR UPDATE` de batch y programa en el mismo orden
      que `applyPdtpImportBatch` (para no invertir el orden de bloqueo).
- [x] **PDTP-01** `accreditPdtpFromEvent`: suma y append de la clave **en SQL**
      (`jsonb_set` + `||`), con `NOT (accreditedKeys @> clave)` en el `WHERE` para que la
      idempotencia sea atómica y no dependa del `includes` en memoria.
- [x] **SST-06** `archiveDocument`: documento + versiones + auditoría en una tx.
- [x] **PDTP-08** Changelog dentro de su transacción en `batchUpdatePdtpActivities`,
      `duplicatePdtpActivity`, `reorderPdtpActivities`, `createPdtpObligation`,
      `excludeActivityForWorksite`, `includeActivityForWorksite` y los dos de `overrides.ts`.
- [x] **HIG-11** EPP: las tres mutaciones con su historial en una tx, `updatedAt` con
      timestamp real (era `todayInChile()` sobre una columna `timestamptz`, perdía la hora)
      y `isActive` en el `WHERE` de la desactivación.

### ⚠️ Trampa vivida en esta fase (documentar, no repetir)

Al compartir la transacción en `submitExecutionChecklist` **introduje el mismo anti-patrón
que la auditoría reporta**: `getNonCompliantItems` usaba el `db` de nivel superior y pasó a
ejecutarse dentro de una `tx`. Bajo PGlite (una sola conexión) eso es un **autodeadlock**: la
suite se colgó >15 min sin fallar, que es la peor forma de romperse. Corregido threading el
cliente. **Antes de meter una función existente dentro de una transacción, hay que revisar
qué usa por dentro**, no sólo su firma.

### Extra adelantado de la Fase 4

- [x] **SST-02** Id determinista (`sdoc-eval-<evaluationId>`) + `onConflictDoNothing` para el
      acta SST archivada, con comprobación previa para no re-renderizar el PDF. Vive en el
      mismo bloque que SST-01, así que se hizo junto.
- [x] **PDTP-04** `sourceItemId` = `<instanceId>:<seccionId>:<itemId>` en el generador de plan
      de acción, para que el unique ya existente respalde la deduplicación; la violación de
      unique se traduce a `existentes++` en vez de reventar. Cero migraciones.

## Fase 4 — Idempotencia sin respaldo

- [x] **PDTP-04** Hecho en la Fase 3 (mismo camino de código).
- [x] **SST-02** Hecho en la Fase 3 (mismo bloque que SST-01).
- [ ] **SST-09** `NULLS NOT DISTINCT` en el unique de carpetas. **Requiere migración.**
- [ ] **DATA-04** Unique/FK de `sourceImportBatchId` en matrices MIPER. **Requiere migración.**
- [ ] **HIG-07** `escalateBlockingGapsToCapa`: el `SELECT` dentro de la tx (capacitación y EPP).

## Fase 5 — Colas offline

- [ ] **OFF-01** Marca temporal del cliente en ambos payloads.
- [ ] **OFF-02** Validación Zod al desencolar + estado `failed` visible.
- [ ] **OFF-03/04** Políticas de retención unificadas.
- [ ] **OFF-05** Limpieza de la cola en el logout.

## Fase 6 — Cron

- [ ] **CRON-03** Advisory lock por job + `onConflictDoNothing().returning()`.
- [ ] **CRON-04** `try/catch` por iteración en los cinco `prevention-*`.
- [ ] **CRON-02** `maxDuration` + paginación en los dos recorridos completos.

## Fase 7 — Fechas, API, UX, seguridad menor

- [ ] **DATE-01/02** `todayInChile` en los dos `dedupeKey`.
- [ ] **DATE-03** `chileDateParts` en la cadencia CPHS + `heldAt` en la cola de atención.
- [ ] **DATE-04** `defaultTargetDate` desde `todayInChile` (helper compartido).
- [ ] **API-01** Schema Zod para los filtros del export PPA.
- [ ] **API-02** `safeCell` en las dos hojas que faltan.
- [ ] **API-04** Zod en las 6 actions RE-20.
- [ ] **SEC-01** `bulk-download`: auditar lo entregado, no lo leído.
- [ ] **PRIV-03** `bulk-download`: tope agregado antes de leer a memoria.
- [ ] **PRIV-05** Idempotencia ARCO después de `auth()` y con clave namespaced.
- [ ] **UX-01/02** Enums en español en indicadores y ARCO.

## Fase 8 — Pruebas que faltan

- [ ] **TEST-01** Concurrencia de incidentes y PPA (con sus env vars en CI).
- [ ] **TEST-02** Cinco `expect` sobre el scoring B/R/M.

## Requiere decisión de Prevención (NO implementar a ciegas)

- [ ] **NORM-01** Convención de 6.000 días de cargo por muerte (bloquea el fix del fatal).
- [ ] **NORM-02** ¿Accidentabilidad con accidentes o con lesionados?
- [ ] **NORM-04** ¿Bloquear o advertir un CPHS que no sea 3+3?
- [ ] **NORM-06** ¿Exigir resolución de la autoridad para reiniciar faena?
- [ ] **NORM-07** ¿Prorratear días perdidos entre meses?
- [ ] **NORM-08** ¿Calcular siniestralidad o quitarla del checklist?
