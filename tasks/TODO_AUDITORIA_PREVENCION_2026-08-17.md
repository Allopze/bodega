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
- [x] **SST-09** `NULLS NOT DISTINCT` en el unique de carpetas (migración 0181). Drizzle 0.45
      no sabe expresarlo para `uniqueIndex` (sólo para `unique()`), así que vive en el SQL con
      una nota en el esquema para que no se pierda al regenerar.
- [x] **DATA-04 + DATA-05** Unique parcial de `sourceImportBatchId` y las dos FK
      (`sourceImportBatchId` y auto-FK `supersedesMatrixId`, ambas `restrict`) en la 0181.
- [x] **HIG-07** El `SELECT` de acciones abiertas dentro de la tx, en capacitación y EPP.

## Fase 5 — Colas offline ✅ COMPLETA

- [x] **OFF-01** `filledAt` en el PPA (columna nueva + Zod, acotado a no futuro) y `queuedAt`
      en el incidente, que se registra en el historial en vez de una columna: `occurredAt`/
      `knownAt` ya venían del terreno, lo que faltaba era distinguir "reportó tarde" de
      "sincronizó tarde" cuando la banda DIAT nace vencida.
- [x] **OFF-02** `ppaSubmitSchema.safeParse` al desencolar; un rechazo permanente del servidor
      marca `failed` de una vez con el motivo, en vez de gastar reintentos en silencio. En
      incidentes, `retriable: false` y contador de rechazados visible en el formulario.
- [x] **OFF-03/04** Cola PPA con tope (100) y expiración por edad (30 días); la limpieza ya no
      borra los `failed` (perdía la evaluación y su motivo), sólo lo sincronizado. En
      incidentes, la purga pasó de `attempts>=8 && >30 días` a dos políticas independientes:
      25 reportes viejos nunca reintentados bloqueaban el formulario para siempre.
- [x] **OFF-05** `clearIncidentReportQueue` + `clearPpaQueue` invocadas desde `useSignOut`.

## Fase 6 — Cron ✅ COMPLETA

- [x] **CRON-03** `withCronLock` (`pg_try_advisory_lock`) en los 8; el que encadena tres jobs
      PDTP toma un solo lock para los tres. `try` y no `advisory_lock`: la corrida solapada se
      salta en vez de encolarse y agotar el timeout.
- [x] **CRON-04** `try/catch` por entidad en los 7 bucles de los cinco servicios, con contador
      `errors` en el resultado para que una corrida degradada sea visible en el JSON del cron.
- [x] **CRON-02** `maxDuration = 300` en los 8, y proyección + `limit` en el recorrido de CAPA
      abiertas (traía la fila entera de todas).

## Fase 7 — Fechas, API, UX, seguridad menor ✅ COMPLETA

- [x] **DATE-01/02** `todayInChile(now)` en los dos `dedupeKey`.
- [x] **DATE-03** `chileDateParts` en `assessMeetingCadence` (arregla los 4 llamadores de una) y
      `heldAt` en vez de `closedAt` en la cola de atención, que contradecía al cron y a la ficha.
- [x] **DATE-04** `addDaysToPlainDate(todayInChile(), 30)` en las dos listas de brechas.
- [x] **API-01** `ppaExportFiltersSchema` + `safeParse` con 400 y `fieldErrors`.
- [x] **API-02** `safeCell` en las hojas "Acuses" e "Indicadores".
- [x] **API-04** `re20TextSchemas` para las seis entradas del expediente RE-20.
- [x] **SEC-01** Se audita `delivered`, no `loaded`.
- [x] **PRIV-03** El tope agregado se decide con `stat` antes de leer a memoria.
- [x] **PRIV-05** Caché de idempotencia después de `auth()` y con clave `userId:requestId:key`.
- [x] **UX-01/02** Catálogos en español para conciliación y estado de denominadores; fallback
      explícito en el badge del inventario ARCO.

## Fase 8 — Pruebas que faltan ✅ COMPLETA

- [x] **TEST-01** `prevention-incidents-concurrency-postgres.test.ts`: dos reportes con la misma
      clave en `Promise.allSettled` → un solo incidente y exactamente un `idempotentReplay`.
      **Con sus dos variables en `ci.yml`**, o el `describeIf` lo saltaba en verde (la trampa que
      el propio workflow documenta que ya ocurrió con `PURCHASE_ORDERS_CONCURRENCY_*`). Entra al
      job existente por el glob `prevention-*-postgres`.
- [x] **TEST-02** `pdtp-checklist-scoring.test.ts`: 6 casos sobre la fórmula B/R/M (regular=0,5;
      `na`/`no_tiene` fuera del denominador; sólo excluidos → null; los 4 sinónimos de
      conformidad; sin responder no cuenta; redondeo a 2 decimales).

## Requiere decisión de Prevención (NO implementar a ciegas)

- [ ] **NORM-01** Convención de 6.000 días de cargo por muerte (bloquea el fix del fatal).
- [ ] **NORM-02** ¿Accidentabilidad con accidentes o con lesionados?
- [ ] **NORM-04** ¿Bloquear o advertir un CPHS que no sea 3+3?
- [ ] **NORM-06** ¿Exigir resolución de la autoridad para reiniciar faena?
- [ ] **NORM-07** ¿Prorratear días perdidos entre meses?
- [ ] **NORM-08** ¿Calcular siniestralidad o quitarla del checklist?
