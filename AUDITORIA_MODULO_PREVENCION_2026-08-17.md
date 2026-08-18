# Auditoría adversarial del módulo de Prevención — 2026-08-17

**Alcance:** `app/(app)/prevencion/**` (~50k LOC, 27 subdominios), `app/api/prevencion/**` (39 rutas),
8 cron jobs, `lib/services/prevention-*` + `pdtp/**` + `sst-module/**` + `ppa-module/**` +
`prevention-documents/**` (~75k LOC), `db/schema/prevention/**` (19 archivos, 4.921 líneas),
`lib/prevention/**`, `lib/sst/**`, `lib/validation/prevention-module/**`, colas offline y suites de prueba.

**Commit auditado:** `c707f4b` (posterior a `e473a96`, que remedió los 57 hallazgos de la auditoría anterior).

**Método:** 10 auditores paralelos por eje + verificación manual del auditor principal sobre cada
hallazgo CRITICAL/HIGH (leyendo el código citado, no confiando en el reporte). Se descartaron los
falsos positivos ya litigados en las 6 auditorías previas del módulo.

**Veredicto general:** el módulo está sólido en las dimensiones que más se han auditado — RBAC
(40/40 endpoints con guard, 14 flujos 4-ojos correctos por `userId` en servidor), fórmulas SUSESO,
cifrado de datos sensibles, convenciones de UI (cero `<select>` nativos, cero CSV, cero `sonner`
directo) y zona horaria en los indicadores. La deuda real está concentrada en **atomicidad de
escrituras multi-tabla** y en **idempotencia apoyada en nada**: 30 de los 61 hallazgos son
transacciones ausentes, CAS declarado pero no aplicado en el `WHERE`, o deduplicación sin índice
único que la respalde. Hay **1 hallazgo CRITICAL que destruye evidencia legal de forma automática y
silenciosa**.

| Severidad | Cantidad |
|---|---|
| CRITICAL | 1 |
| HIGH | 15 |
| MEDIUM | 27 |
| LOW | 13 |
| INFO | 5 |
| **Total** | **61** |

---

## 🔴 CRITICAL

### [GC-01] CRITICAL — El recolector de evidencias PDTP borra las fotos de cierre de acciones correctivas todavía referenciadas

- **Ubicación:** `lib/services/pdtp/evidence-gc.ts:70-92` (construcción del set) y `:95-113` (borrado);
  productor no contemplado en `lib/services/pdtp/followups.ts:49-68`;
  cron en `app/api/cron/pdtp-evidence-gc/route.ts:38`.
- **Evidencia:**

```ts
// evidence-gc.ts:70-78 — el set de "referenciados" se construye SÓLO desde pdtp_executions
const referenced = new Set<string>()
const rows = await db
  .select({
    evidenceUrl: pdtpExecutions.evidenceUrl,
    evidencePhotos: pdtpExecutions.evidencePhotos,
  })
  .from(pdtpExecutions)
...
// :95-113
for (const name of files) {
  if (referenced.has(name)) { result.kept++; continue }
  const stat = await fs.stat(`${dir}/${name}`)
  if (stat.mtimeMs > cutoff) { result.kept++; continue }
  if (!dryRun) { await fs.unlink(`${dir}/${name}`) }   // ← borrado real
```

```ts
// followups.ts:59-68 — la evidencia de CAPA se persiste en OTRA tabla
for (const photo of input.evidenciaPhotos ?? []) {
  const result = await addCapaEvidenceWithClient(tx, {
    actionId: capa.id, kind: "photo", reference: photo, ...
  }, access)
```

  La cadena está verificada de punta a punta:
  1. `app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/execution-action-plan-panel.tsx:294`
     sube cada archivo de seguimiento a `POST /api/prevencion/pdtp/evidence` — **el mismo endpoint**
     que el registro de ejecución.
  2. Ese endpoint escribe en `resolvePdtpEvidenceDir()` (`lib/storage/config.ts:214`) = `storage/pdtp-evidence/`
     y devuelve un `path` con prefijo `storage/pdtp-evidence/` (`config.ts:222`).
  3. `followups.ts` guarda esos `path` en `prevention_capa_evidence.reference`, **nunca** en
     `pdtp_executions.evidencePhotos`.
  4. El GC no consulta `prevention_capa_evidence`, así que esos archivos son "huérfanos" para él.
- **Agravantes verificados:** `dryRun` es `false` salvo que se pase explícitamente
  (`route.ts:38`: `searchParams.get("dryRun") === "true"`), y el umbral por defecto es **1 hora**
  (`evidence-gc.ts:27`: `DEFAULT_OLDER_THAN_MS = 60 * 60 * 1000`). La única protección — "muy
  reciente, probablemente upload sin submit" — expira en 60 minutos.
- **Escenario de falla:** un prevencionista cierra una acción correctiva del Anexo 8 adjuntando la
  foto del control implementado. Una hora después, la próxima corrida del cron (documentado como
  "semanalmente, lunes 3 AM") clasifica el archivo como huérfano y ejecuta `fs.unlink`. La fila de
  `prevention_capa_evidence` sobrevive apuntando a un archivo inexistente; `capa-view.ts:251-273`
  la sigue renderizando en la línea de tiempo, así que la UI afirma que la evidencia existe.
- **Impacto:** **pérdida permanente e irrecuperable de evidencia con valor legal** (respaldo del
  cierre de acciones correctivas, DS 44). Es el único hallazgo de la auditoría que destruye datos
  sin intervención humana y sin dejar rastro del borrado más allá de un log.
- **Causa raíz:** el GC se escribió cuando `storage/pdtp-evidence/` tenía un único consumidor;
  `followups.ts` agregó un segundo consumidor sin extender el set de referencias. El acoplamiento
  es implícito: nada en el código del GC declara que ese directorio es de uso exclusivo.
- **Mitigación inmediata (hoy, sin desplegar):** desactivar el cron `pdtp-evidence-gc` en el
  scheduler externo, o pasarle `?dryRun=true`. Los crons de prevención se configuran fuera del
  repo, así que **el primer paso es verificar si está agendado**: si lo está, ya hay evidencia
  borrada y conviene revisar `prevention_capa_evidence` contra el contenido del directorio.
- **Corrección propuesta:**

```ts
// evidence-gc.ts — añadir el segundo productor al set de referenciados
const capaRows = await db
  .select({ reference: preventionCapaEvidence.reference })
  .from(preventionCapaEvidence)
for (const row of capaRows) {
  const name = row.reference?.split("/").pop()
  if (name) referenced.add(name)
}
```

  Y como defensa estructural: subir la evidencia de CAPA a un directorio propio, para que un tercer
  consumidor futuro no herede el mismo agujero. Mientras el fix no esté desplegado, subir
  `DEFAULT_OLDER_THAN_MS` no basta — sólo retrasa el borrado.
- **Confianza:** alta (cadena verificada archivo por archivo por el auditor principal).

---

## 🟠 HIGH

### [NORM-01] HIGH — Un accidente fatal no puede entrar a los indicadores DS 44 sin falsificar días de ausencia

- **Ubicación:** `lib/services/prevention-incidents.ts:210-217`; `lib/prevention/safety-indicators-calc.ts:212-216`.
- **Evidencia:**

```ts
// prevention-incidents.ts:210-217 (indicatorClassificationSchema)
if (value.inclusionStatus === "included" && !value.absenceAtLeastNormalShift) {
  ctx.addIssue({ ..., message: "Una persona incluida debe tener ausencia igual o superior a una jornada normal." })
}
if (value.absenceAtLeastNormalShift && value.absenceDays < 1) {
  ctx.addIssue({ ..., message: "Registra al menos un día de ausencia." })
}
```

```ts
// safety-indicators-calc.ts:212-216 — el filtro del motor canónico
const periodCases = deduplicateCases(args.cases.filter((item) => (
  inPeriod(item, args.year, args.startMonth, args.endMonth)
  && item.eventType === "work_accident"
  && item.absenceAtLeastNormalShift        // ← un fallecido no tiene "ausencia"
)))
```

- **Escenario de falla:** ocurre un accidente del trabajo fatal. El fallecido se registra con
  `absenceDays: 0` (no tiene días de ausencia: tiene días de cargo). Al clasificarlo para
  indicadores, marcar `inclusionStatus: "included"` exige `absenceAtLeastNormalShift: true`, que a
  su vez exige `absenceDays >= 1`. El clasificador tiene dos salidas y ambas son malas: dejar el
  fatal fuera de frecuencia/gravedad/accidentabilidad del período, o inventar días de ausencia.
  Además, `grep` de `6000`/`chargeDays` confirma que **no existe** ningún default ni sugerencia de
  los 6.000 días de cargo por muerte: `chargeDays` es entrada manual con default 0.
- **Impacto:** el indicador más sensible que se reporta a la autoridad (un fatal) puede quedar fuera
  del numerador, o entrar con datos deliberadamente falsos. Incumplimiento reportable.
- **Corrección propuesta:** aceptar `included` con `absenceDays = 0` cuando `actualSeverity === "fatal"`,
  exigiendo en ese caso `chargeDays >= 6000` (o prellenándolo); e incluir en `periodCases` los casos
  con `chargeDays > 0` aunque `absenceAtLeastNormalShift` sea `false`. Requiere propagar
  `actualSeverity` al caso canónico y versionar `SAFETY_INDICATOR_FORMULA_VERSION`.
- **Confianza:** alta (mecánica verificada por el auditor principal); alta-media en la convención
  de los 6.000 días (NCh 436 / práctica de mutuales).

### [PRIV-01] HIGH — El banco de trabajo ARCO expone expedientes reservados de Ley Karin y datos de salud a un rol sin acceso a ninguno de los dos

- **Ubicación:** `lib/services/prevention-privacy-rights.ts:357-421`, en concreto `:371-377`
  (salud) y `:378-386` (casos reservados); consumido por
  `app/(app)/prevencion/privacidad/solicitudes/[id]/page.tsx`.
- **Evidencia:**

```ts
export async function getPreventionPrivacyRequestWorkbench(args: {...}) {
  requireManagePermission(args.permissions)   // ← ÚNICO gate: prevention:privacy:manage_requests
  ...
  db.select({
    id: preventionHealthRecords.id, recordType: ..., status: ...,
    fitnessStatus: preventionHealthRecords.fitnessStatus,     // ← dato de salud ocupacional
    validUntil: ...,
  }).from(preventionHealthRecords).where(eq(preventionHealthRecords.workerId, subject.id)),
  db.select({
    subjectLinkId: preventionReservedCaseSubjects.id,
    id: preventionReservedCases.id,
    code: preventionReservedCases.code,
    category: preventionReservedCases.category,               // ← 'ley_karin'
    status: preventionReservedCases.status,
  }).from(preventionReservedCaseSubjects)
    .innerJoin(preventionReservedCases, ...)
```

  No hay verificación de membresía en `preventionReservedCaseMembers` ni del permiso
  `prevention:reserved_case:view/investigate`, ni de `prevention:health:view_restrictions`. **Todo el
  resto del módulo sí las exige**: `getPreventionReservedCase` (`prevention-reserved-cases.ts:171-189`),
  `readPreventionSensitiveFile` (`prevention-sensitive-files.ts:276-284`),
  `getPreventionHealthRestriction` (`prevention-health.ts:181`) y la propia ejecución del derecho
  sobre dominio reservado (`prevention-privacy-rights.ts:201-207`).
- **Escenario de falla:** el manifiesto RBAC concede `prevention:privacy:manage_requests` a
  `jefa_chome` y `administrador`, con un comentario explícito de que salud y casos reservados
  "requieren grants nominativos". `jefa_chome` **no** tiene `reserved_case:view`. Aun así, creando
  una solicitud de privacidad de cualquier trabajador en su alcance (tiene el permiso para hacerlo)
  y abriéndola, ve que esa persona está vinculada a un caso `ley_karin`, con su código
  `RES-YYYY-XXXX`, su estado y su aptitud ocupacional.
- **Impacto:** filtración de metadatos protegidos por **Ley 21.643 (Ley Karin)** — la identidad de
  una persona como parte de una denuncia de acoso es reservada al comité investigador nominado — y
  de datos de salud (**Ley 21.719**). El contenido cifrado no se expone; lo que se filtra
  (existencia + categoría + código + estado + aptitud) es precisamente lo que la ley protege.
- **Corrección propuesta:** filtrar los casos reservados a aquellos donde el actor es miembro
  (join con `preventionReservedCaseMembers`) **y** tiene el permiso reservado; si no, devolver sólo
  un agregado sin código ni categoría ("N expedientes reservados; requiere acceso nominativo").
  Enmascarar `fitnessStatus` salvo con `prevention:health:view_restrictions`.
- **Confianza:** alta (verificado por el auditor principal; el `fitnessStatus` es un hallazgo
  adicional encontrado durante esa verificación).

### [HIG-01] HIGH — Dos mediciones de higiene concurrentes pueden dejar un GES sobre el límite permisible sin vigilancia médica obligatoria

- **Ubicación:** `lib/services/prevention-hygiene.ts:226-237`.
- **Evidencia:**

```ts
// La obligación de vigilancia se recalcula con todo el historial, no sólo
// con la medición recién ingresada.
const measurements = await tx.select({ measuredOn: ..., outcome: ... })
  .from(preventionExposureMeasurements)
  .where(eq(preventionExposureMeasurements.groupId, data.groupId))
const obligation = deriveSurveillanceObligation(measurements)

await tx.update(preventionExposureGroups).set({
  surveillanceRequired: obligation.required,
  surveillanceReason: obligation.required ? obligation.basis : null,
  version: row.group.version + 1,                        // ← valor leído en memoria
  updatedAt: now,
}).where(eq(preventionExposureGroups.id, data.groupId))  // ← sin eq(version, …)
```

- **Escenario de falla:** dos higienistas registran mediciones del mismo GES a la vez. Bajo READ
  COMMITTED ninguna transacción ve la fila de la otra, así que cada una recalcula
  `deriveSurveillanceObligation` **sin** la medición ajena. Medición A = `above_limit` (exige
  vigilancia), medición B = `below_action`. Si B commitea segunda, el grupo queda con
  `surveillanceRequired = false` pese a existir una medición sobre el límite permisible. El `version`
  no protege nada: se calcula en memoria y el `UPDATE` no lo verifica.
- **Impacto:** exactamente la decisión regulatoria que la función existe para tomar (DS 594 /
  protocolos MINSAL PREXOR-PLANESI-TMERT) queda mal resuelta: un GES sobre el límite sin vigilancia
  médica activada, y sin ninguna señal en el tablero.
- **Corrección propuesta:** tomar el grupo con `FOR UPDATE` al inicio de la transacción — es lo
  único que serializa el recálculo, no sólo el contador. El patrón ya existe en el repo
  (`prevention-privacy-rights.ts:134,137,198,247,289`).
- **Confianza:** alta (verificado por el auditor principal).

### [SST-01] HIGH — `archiveEvaluationPdf` hace cinco escrituras sin transacción y produce, en silencio, los estados que `integrity.ts` clasifica como críticos

- **Ubicación:** `lib/services/sst-module/evaluation-archive.ts:81-114`.
- **Evidencia:** cinco operaciones consecutivas con `db` suelto — `insert(sstDocuments)` con
  `currentVersionId: null` y `status: "vigente"`; `insert(sstDocumentVersions)` con `status: "vigente"`;
  `update(sstDocuments)` fijando `currentVersionId`; `insert(sstDocumentLinks)`; `recordAuditEntry`.
  Todo envuelto en un `try/catch` que sólo loguea (`:115-117`).
- **Escenario de falla:** si el proceso muere entre el primer y el segundo insert, queda un
  `sst_documents` con `status = "vigente"` y `currentVersionId = NULL`. Si muere entre el segundo y
  el tercero, queda una versión `vigente` que el documento no apunta. Ambos son los hallazgos que
  `prevention-documents/integrity.ts` clasifica como **críticos**
  (`CURRENT_VERSION_NOT_PUBLISHED` / `DRAFT_WITH_PUBLISHED_VERSION`) y que exigen la pantalla de
  regularización manual. El `catch` best-effort hace que el estado parcial sea silencioso por diseño.
- **Impacto:** documentos legales huérfanos en la biblioteca, que requieren intervención manual y
  que el propio módulo considera inconsistencias críticas.
- **Corrección propuesta:** envolver `:82-114` en un solo `db.transaction`. Requiere dar a
  `recordAuditEntry` (`prevention-documents/utils.ts:231-257`) el parámetro
  `client: ActivityDb = db` que `recordOperationalActivity` ya tiene.
- **Confianza:** alta (verificado por el auditor principal).

### [SST-02] HIGH — Doble cierre de una evaluación SST crea dos actas legales vigentes en la biblioteca

- **Ubicación:** `lib/services/sst-module/evaluation-archive.ts:81-92`;
  llamador en `app/(app)/prevencion/actions/evaluations.ts:150`.
- **Evidencia:** `const docId = \`sdoc-${nanoid()}\`` — id **nuevo en cada invocación**. La
  procedencia queda sólo en un JSONB (`extraMetadata: { evaluationId }`) sin índice único que lo
  cubra: los índices de `db/schema/prevention/library.ts:76-85` son sobre `categorySlug/status`,
  `folderId/status`, `worksiteId/status`, `expiresAt` y `responsibleUserId`. El
  `sst_document_versions_checksum_idx` **no** es único.
- **Escenario de falla:** `closeEvaluation` es idempotente (`evaluations.ts:196` retorna si ya está
  cerrada), pero `closeEvaluationAction` invoca `archiveEvaluationPdf` **después** del cierre. Dos
  clics en "Cerrar" (o el reintento de un server action con red inestable) producen dos cierres
  idempotentes y **dos documentos distintos**, ambos `status: "vigente"`, ambos vinculados al mismo
  trabajador, con dos PDFs en disco. El `onConflictDoNothing` del link no colisiona porque el
  `documentId` es nuevo.
- **Impacto:** duplicación de evidencia con valor legal. Un auditor externo ve dos actas vigentes de
  la misma evaluación y no puede saber cuál es la buena.
- **Corrección propuesta:** id determinista (`sdoc-eval-${evaluationId}`) + `onConflictDoNothing` en
  el insert, y salida temprana si no hubo inserción. Alternativa: índice único parcial sobre
  `(extraMetadata->>'evaluationId')` filtrado por `tags @> '["evaluacion-sst"]'`, mismo patrón que
  `prevention_capa_sst_evaluation_n_unique`.
- **Confianza:** alta.

### [SST-03] HIGH — `getEvaluation` usa el `db` de nivel superior dentro de una transacción

- **Ubicación:** `lib/services/sst-module/evaluations.ts:99-105` (el helper);
  call site en `lib/services/sst-module/action-plan.ts:77-81`.
- **Evidencia:**

```ts
// action-plan.ts:76-81 — deleteActionPlanItem
await db.transaction(async (tx) => {
  const capa = await loadSstCapa(tx, id)                        // ✅ tx
  if (!capa) throw new Error("Ítem del plan de acción no encontrado.")
  const evaluation = await getEvaluation(capa.sourceId, worksiteIds)   // ❌ db
```

```ts
// evaluations.ts:99-101 — no acepta cliente
export async function getEvaluation(id: string, worksiteIds: string[] | "all") {
  const [evaluation] = await db.select().from(sstEvaluations)...
```

- **Escenario de falla:** es el mismo anti-patrón que causó el autodeadlock corregido el 2026-08-14
  en `prevention-cphs-certification.ts`. Bajo PGlite (una sola conexión) se autobloquea; bajo
  Postgres real toma una **segunda** conexión del pool mientras la transacción retiene la primera —
  riesgo de deadlock por agotamiento de pool — y además evalúa el control de acceso sobre un
  snapshot distinto del que se escribe.
- **Corrección propuesta:** dar a `getEvaluation` la firma opcional `tx?: Tx` que `assertEditable`
  ya tiene (`sst-module/helpers.ts:11-16`: `const client = tx ?? db`) y pasarla en los tres call
  sites transaccionales.
- **Confianza:** alta (verificado por el auditor principal).

### [SST-04] HIGH — `saveActionPlanItem` no verifica que la evaluación siga abierta: se puede agregar una acción a un acta ya cerrada

- **Ubicación:** `lib/services/sst-module/action-plan.ts:36-39`.
- **Evidencia:** valida el scope con `getEvaluation` **fuera** de la transacción y nunca llama a
  `assertEditable`, a diferencia de `saveResponses` (`responses.ts:17`) y `closeEvaluation`
  (`evaluations.ts:206`), que sí lo hacen dentro de la `tx`.
- **Escenario de falla:** un usuario cierra la evaluación (`closeEvaluation`, que sí toma
  `assertEditable` dentro de su transacción) mientras otro guarda el ítem `n` del plan de acción.
  Las dos operaciones se intercalan y la CAPA se crea **después** de que el acta quedó cerrada e
  inmutable. El acta impresa muestra una fila que no existía al firmar.
- **Impacto:** violación de la inmutabilidad del acta SST cerrada (DS 44).
- **Corrección propuesta:** `await assertEditable(data.evaluationId, tx)` como primera línea dentro
  de la transacción.
- **Confianza:** alta.

### [PDTP-01] HIGH — `accreditPdtpFromEvent` acumula cantidad y claves con read-modify-write sin transacción

- **Ubicación:** `lib/services/pdtp/accreditation.ts:266-423`.
- **Evidencia:**

```ts
const [existing] = await db.select({...}).where(eq(pdtpExecutions.idempotencyKey, idempotencyKey)).limit(1)
const [periodRow] = existing ? [] : await db.select({...}).where(and(... period ...))
await db.update(pdtpExecutions).set({
  executedQuantity: periodRow.executedQuantity + executedQuantity,
  sourceMetadataJson: { ...meta, accreditedKeys: [...contributed, idempotencyKey] },
```

- **Escenario de falla:** dos eventos operacionales de la misma semana/faena/actividad (p. ej. dos
  inspecciones) llegan en paralelo. Ambos leen `executedQuantity = 2` y `accreditedKeys = [k0]`;
  R1 escribe `3` con `[k0,k1]`, R2 escribe `3` con `[k0,k2]`. Se pierde un evento **y** su clave, así
  que un reintento posterior de R1 vuelve a sumar: la idempotencia se rompe en ambos sentidos.
- **Impacto:** el numerador del cumplimiento PDTP queda por debajo del trabajo realmente ejecutado y
  `accreditedKeys` deja de ser un registro fiable.
- **Corrección propuesta:** transacción con `SELECT … FOR UPDATE` antes del update (patrón de
  `executions.ts:170`, `obligations.ts:185`), o mover la suma a SQL
  (`executed_quantity = executed_quantity + $n` y append de `jsonb` en la propia sentencia).
- **Confianza:** alta.

### [PDTP-02] HIGH — `updatePdtpActivity` borra y reinserta el calendario sin transacción

- **Ubicación:** `lib/services/pdtp/activities.ts:145-184`.
- **Evidencia:** `update(pdtpActivities)` → `delete(pdtpActivitySchedule)` de las celdas obsoletas →
  bucle de `insert … onConflictDoUpdate` → `addPdtpChangeLogEntry`. Todo con `db` suelto.
- **Escenario de falla:** el `delete` commitea y el proceso falla antes de terminar los inserts. La
  actividad queda con la definición nueva y un calendario **truncado**: celdas borradas que nunca se
  reinsertaron. El changelog nunca se escribe, así que la pérdida no queda trazada.
- **Impacto:** pérdida silenciosa de cantidad planificada — el denominador del indicador de
  cumplimiento — sin registro en `pdtp_change_log`.
- **Corrección propuesta:** envolver desde el `update` hasta el changelog en `db.transaction`
  pasando `tx`. El mismo patrón ya está bien resuelto en `worksites.ts:511-535`.
- **Confianza:** alta.

### [PDTP-03] HIGH — `addPdtpActivity` valida la existencia de las hojas *después* de escribir

- **Ubicación:** `lib/services/pdtp/activities.ts:202-243`.
- **Evidencia:** `insert(pdtpActivities)` → bucle de `insert(pdtpActivitySchedule)` → bucle de
  membresías donde `resolveSheetForProgram` puede devolver `null` y **lanzar**
  (`throw new Error(\`Hoja PDTP no encontrada: ${sheetCode}.\`)`). Sin transacción.
- **Escenario de falla:** con `sheetCodes = ["pdtp_general", "codigo_inexistente"]`, la actividad y
  su calendario ya commitearon, la primera membresía también, y la segunda lanza. Queda una
  actividad a medio insertar, invisible en la vista donde el usuario la pidió, y sin changelog.
  Segundo escenario: dos `addPdtpActivity` concurrentes leen el mismo `MAX(n)` (`:193-198`) y el
  segundo revienta con `23505` crudo sobre `pdtp_activities_program_n_unique`, sin el reintento por
  `isUniqueViolation` que `programs.ts` sí implementa.
- **Corrección propuesta:** validar todos los `sheetCodes` antes de cualquier escritura, envolver
  todo en `db.transaction`, y reusar el patrón de reintento de `programs.ts` para el correlativo `n`.
- **Confianza:** alta.

### [PDTP-04] HIGH — `generateActionPlanFromChecklist` deduplica sobre un JSONB sin índice único: doble clic duplica acciones correctivas

- **Ubicación:** `lib/services/pdtp/action-plan.ts:232-303`.
- **Evidencia:** la deduplicación consulta `sourceRef->>'checklistInstanceId'`, `->>'seccionId'` y
  `->>'itemId'` y luego crea la CAPA en una transacción **por ítem**. Los únicos índices únicos de
  `prevention_capa_actions` son `prevention_capa_source_item_unique(sourceType, sourceItemId)` y
  `prevention_capa_sst_evaluation_n_unique` (acotado a `sourceType = 'sst_evaluation'`): **ninguno
  cubre la tripleta**, y este generador no puebla `sourceItemId`.
- **Escenario de falla:** doble clic en "Enviar revisión". Dos ejecuciones leen `existing = undefined`
  para el mismo ítem y ambas crean una CAPA. El `%` de cierre (`getPdtpActionClosureRate`) y los
  badges (`countPdtpActionsByExecution`) cuentan dos veces el mismo hallazgo.
- **Corrección propuesta:** poblar `sourceItemId` con `${instanceId}:${seccionId}:${itemId}` para
  apoyarse en el índice único que **ya existe** (cero migraciones), y mover el bucle completo a una
  sola transacción.
- **Confianza:** alta.

### [PDTP-05] HIGH — `submitExecutionChecklist` completa el checklist y genera el plan de acción en paralelo, sin unidad de trabajo común

- **Ubicación:** `lib/services/pdtp/action-plan.ts:170-186`.
- **Evidencia:**

```ts
const [completion, actionPlan] = await Promise.all([
  completeExecutionChecklist(instanceId, userId),
  generateActionPlanFromChecklist(instanceId, userId),
])
```

  `completeExecutionChecklist` marca la instancia `completado` con `db` suelto
  (`execution-checklists.ts:231-237`); `generateActionPlanFromChecklist` abre transacciones propias.
  El `recalcExecutionQuantityFromInstances` posterior va en un `try {} catch { /* no-op */ }` (`:182-184`).
- **Escenario de falla:** la generación falla a mitad. El checklist queda **completado** con un plan
  de acción parcial: ítems `no_cumple` sin acción correctiva asociada, y el usuario ve el checklist
  cerrado. La cantidad ejecutada puede quedar desalineada sin ninguna señal.
- **Impacto:** estado terminal alcanzado con la obligación derivada incompleta — incumplimiento
  silencioso del Anexo 8 (todo `no_cumple` genera acción).
- **Corrección propuesta:** una sola `db.transaction` que pase `tx` a completar, generar y
  recalcular, **en secuencia**. El `Promise.all` sobre el mismo `instanceId` no aporta paralelismo
  real y agrava la carrera.
- **Confianza:** alta.

### [PDTP-06] HIGH — `rollbackPdtpImportBatch` evalúa su guarda fuera de la transacción y pisa ediciones ajenas

- **Ubicación:** `lib/services/pdtp/imports.ts:670-697`.
- **Evidencia:** lee el batch y consulta `pdtpChangeLog` en busca de cambios posteriores **antes** de
  abrir la transacción; dentro, restaura el snapshot con `tx.update(pdtpActivities).set(activity)`
  sin volver a comprobar nada y sin `FOR UPDATE` sobre batch ni programa — a diferencia de
  `applyPdtpImportBatch:425-436`, que sí bloquea ambos.
- **Escenario de falla:** la comprobación pasa y, antes de que la transacción abra, otro usuario
  edita una actividad. El rollback restaura el snapshot y **pisa esa edición sin traza**. Dos
  rollbacks concurrentes del mismo lote pueden entrar ambos; el segundo reinserta
  `snapshot.schedules`/`memberships` (`:719-720`, sin `onConflict`) y falla a mitad tras haber
  borrado ya las filas actuales.
- **Corrección propuesta:** repetir dentro de la transacción el `FOR UPDATE` de batch + programa y
  re-evaluar `hasLaterChange`, exactamente como hace `applyPdtpImportBatch`.
- **Confianza:** alta.

### [OFF-01] HIGH — Los registros encolados offline se archivan con la fecha de sincronización: el PPA pierde su valor probatorio y las bandas DIAT nacen vencidas

- **Ubicación:** incidentes — `lib/services/prevention-incidents.ts:443-455` y
  `app/(app)/prevencion/incidentes/reportar/offline-incident-queue.ts:92-97`;
  PPA — `lib/services/ppa-module/evaluaciones.ts:104,130-131`, `lib/pwa/offline-queue.ts:119-127`,
  `lib/pwa/hooks.ts:63`.
- **Evidencia:** ambas colas guardan un `queuedAt`/`createdAt` local… que **nunca sale del
  navegador**: el envío pasa sólo `entry.payload` / `item.payload`. En el servidor,
  `createdAt: now` es la hora de sincronización. En PPA es peor: `ppaSubmitSchema`
  (`lib/validation/ppa.ts:11-57`) **no declara ningún campo de fecha**, así que toda la temporalidad
  del registro es el `createdAt` del servidor.
- **Escenario de falla:** (a) un PPA llenado el lunes antes de entrar al frente de trabajo y
  sincronizado el viernes queda archivado como del viernes; (b) un incidente encolado el 1 de agosto
  y sincronizado el 25 nace con `createdAt = 25` mientras las bandas de notificación se calculan
  sobre `knownAt` del terreno, así que la banda DIAT/DIEP **nace vencida por 24 días** sin forma de
  distinguirlo de un incumplimiento real.
- **Impacto:** el PPA es la verificación *previa* a la tarea y su valor probatorio depende de haber
  sido llenado antes de trabajar; con fecha de sincronización puede incluso parecer llenado
  *después* del incidente que pretendía prevenir. En incidentes, el plazo de 24 h del DS 44 aparece
  incumplido aunque el trabajador reportó a tiempo.
- **Corrección propuesta:** añadir `filledAt`/`queuedAt` al payload y al schema Zod (validado
  `<= now` con tolerancia de deriva de reloj), persistirlo, y usarlo para las bandas cuando
  `offlineSync === true`. Mínimo sin migración: registrarlo en el historial del incidente.
- **Confianza:** alta.

### [OFF-02] HIGH — Las colas offline pierden reportes en silencio: sin validación al desencolar y sin distinguir rechazo permanente de fallo de red

- **Ubicación:** `app/(app)/prevencion/incidentes/reportar/offline-incident-queue.ts:108` (`as QueueEntry[]`),
  `:124-159` (tratamiento uniforme del error); PPA — `lib/pwa/offline-queue.ts:27`
  (`payload: Record<string, unknown>`), `lib/pwa/hooks.ts:63,73-77`.
- **Evidencia:** `getAll()` se castea sin validar (`OfflineIncidentReport` es sólo un `interface` de
  compilación); en PPA el comentario dice "matches ppaSubmitSchema" y nada lo verifica. En el flush,
  `{ ok: false }` por validación, permiso o clave usada recibe el **mismo** tratamiento que un fallo
  de red: `attempts + 1`.
- **Escenario de falla:** tras un deploy que endurezca el schema (p. ej. RUT con dígito verificador),
  el cliente viejo servido desde el caché del Service Worker encoló un payload de la forma anterior.
  El rechazo es permanente pero consume los reintentos; al agotarlos, la entrada queda invisible
  pero contada como `pending` (incidentes: el usuario ve "Sincronizar (1)" para siempre sin saber
  que ese 1 está muerto) o se **borra automáticamente a los 7 días** (PPA). `lastError` no se
  muestra en ninguna vista.
- **Impacto:** pérdida silenciosa de un reporte de incidente o de una evaluación de terreno ya
  escritos en faena — el peor caso posible del módulo.
- **Corrección propuesta:** validar con Zod antes de enviar; ampliar el resultado del `sender` a
  `{ ok } | { retriable: boolean }` y, ante `retriable: false`, mover la entrada a un estado
  `failed` visible en la UI (con reintentar / copiar datos) en vez de dejarla contando como
  pendiente. No borrar automáticamente lo que nunca se entregó.
- **Confianza:** alta.

### [DATE-03] HIGH — La cadencia mensual del CPHS mide meses en UTC y, en la cola de atención, mide una columna distinta que el resto del sistema

- **Ubicación:** `lib/prevention/cphs.ts:171-177`; llamadores en
  `lib/services/prevention-cphs-reminders.ts:61,131`, `lib/services/prevention-attention.ts:155,165,182`,
  `app/(app)/prevencion/cphs/page.tsx:41,65`, `lib/services/prevention-cphs.ts:578`.
- **Evidencia:**

```ts
const months = (now.getUTCFullYear() - last.getUTCFullYear()) * 12 + (now.getUTCMonth() - last.getUTCMonth())
return { monthsWithoutMeeting: months, overdue: months >= 2 }
```

- **Escenario de falla (dos vectores):**
  1. **UTC:** una sesión del 1 de febrero a las 21:00 de Chile se guarda como 2 de febrero UTC.
     Evaluada el 31 de marzo a las 21:00 Chile (= 1 de abril UTC), el cálculo da 2 meses y emite un
     aviso falso de "el comité no sesiona hace dos meses o más", cuando en calendario chileno es 1.
  2. **Columna distinta:** el cron usa `max(heldAt)` con un comentario explícito de que `closedAt`
     era incorrecto, y `prevention-cphs.ts:975` usa `MAX(t.held_at)`; pero
     `prevention-attention.ts:155` **sigue usando** `max(closedAt)`. Un acta de enero firmada en
     marzo deja la cola de atención "al día" mientras el cron reclama.
- **Impacto:** aviso falso o ausencia de aviso sobre un deber legal mensual (DS 54 art. 17), y la
  cola de "Requiere atención" contradice al cron y a la ficha del comité sobre el mismo comité.
- **Corrección propuesta:** derivar ambos meses con `chileDateParts` (`lib/utils.ts:262`) — un fix
  único en la función compartida que arregla los cuatro llamadores — y cambiar `closedAt` → `heldAt`
  en `prevention-attention.ts:155`.
- **Confianza:** alta (el vector 2 es certeza documental: los otros tres llamadores usan `heldAt`).
- **Nota:** subsume el hallazgo NORM-09 del eje normativo (mismo defecto, descubierto por dos
  auditores independientes).

---

## 🟡 MEDIUM

### Cumplimiento normativo

| ID | Hallazgo | Ubicación | Corrección |
|---|---|---|---|
| **NORM-02** | La tasa de accidentabilidad usa **lesionados** como numerador, pero el rótulo de la UI dice "Accidentes × 100 / dotación promedio". Con 3 lesionados en un accidente y 100 trabajadores, SUSESO da 1,0 y el sistema muestra 3,0. `accidents` se calcula y se persiste, pero no alimenta ninguna tasa. *(Verificado por el auditor principal.)* | `lib/prevention/safety-indicators-calc.ts:176-189`; rótulo en `app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx:95` | `accidentabilityRate: (accidents / workerAverage) * 100`, o corregir el rótulo. Obliga a versionar `SAFETY_INDICATOR_FORMULA_VERSION` |
| **NORM-03** | Reportar un incidente ocurrido en un mes ya cerrado **no** invalida el snapshot aprobado. `invalidateClosedIndicatorPeriodWithClient` sólo se invoca desde la clasificación; para eventos sin personas (daño material, derrame) nunca se reabre y los `eventCounts` cambian en silencio. | `prevention-incidents.ts:429-548` vs `:578-584`; `prevention-indicadores.ts:705-738` | Invocar la invalidación (que ya existe) desde `reportPreventionIncident` cuando `occurredAt` cae en período cerrado |
| **NORM-04** | No se exige la composición fija del CPHS (DS 54 arts. 3-4: **tres** titulares por parte + un suplente por titular): sólo paridad. Un comité 1+1 sin suplentes pasa como válido y satisface el requisito Bronce `parity_valid`. El comentario del código parte de una premisa normativa incorrecta ("la cifra depende de la dotación" — es fija). *(Verificado.)* | `lib/prevention/cphs.ts:66-98` | Agregar issues cuando `companyTitulars !== 3 \|\| workerTitulars !== 3` o falten suplentes |
| **NORM-05** | La vigilancia de salud genera **un solo ciclo**: `recordSurveillanceOutcome` marca `attended` y no crea la matrícula siguiente ni avanza `dueOn`. Un GES PREXOR con periodicidad 12 meses nunca vuelve a citarse, y el panel muestra 100 % de asistencia indefinidamente. *(Verificado.)* | `prevention-hygiene.ts:286-372, 418-433`; schema `hygiene.ts:142` | Al registrar `attended`, insertar la matrícula del ciclo siguiente (el índice único ya lo permite); y matricular a los nuevos integrantes del GES |
| **NORM-06** | El reinicio de faenas se autoriza sin exigir evidencia de la autorización del organismo fiscalizador: el carril `restart_authorization` está **exento** del gate de evidencia del cierre. | `prevention-incidents.ts:1208-1266` y `:916-919` | Exigir `evidenceReference` + checksum al autorizar, y quitar la exención del carril |

### Integridad, transaccionalidad y concurrencia

| ID | Hallazgo | Ubicación | Corrección |
|---|---|---|---|
| **DATA-01** | `sourceItemId` de las medidas prescritas se deriva con `COUNT(*)+1` sin lock. Dos medidas concurrentes de la misma visita calculan la misma clave; el índice único protege la integridad pero convierte la carrera en un 500 opaco y **se pierde la medida** (obligación DS 44 art. 70). *(Verificado; hallado por dos auditores.)* | `prevention-external-engagements.ts:135-154` | `SELECT … FOR UPDATE` del engagement antes de contar (patrón de `prevention-change.ts:216`), o `nanoid()` en la clave: el ordinal no se usa para nada más |
| **DATA-02** | `createPreliminaryReport` hace check-then-write sobre la investigación **fuera** de transacción, y la acreditación PDTP corre sin atomicidad. Dos usuarios registrando el informe preliminar (SLA 3 h) chocan con el único de `incidentId` y reciben un error crudo. | `prevention-incidents.ts:1384-1419` | `db.transaction` + `onConflictDoUpdate({ target: incidentId })` |
| **DATA-03** | Cinco escrituras del expediente RE-20 usan `getInvestigableIncident` (que lee con `db`) en vez del loader transaccional `findIncidentForMutation`: se puede escribir una declaración o difusión sobre un expediente que se cerró entremedio. | `prevention-incidents.ts:1421-1477, 1479-1511, 1528-1582` | Una sola función (la transaccional); envolver las cinco en `db.transaction` |
| **DATA-04** | La activación de un lote MIPER no serializa la creación de la matriz borrador: falta unique en `sourceImportBatchId`. Si entremedio se consume el `matrixVersion`, quedan **dos matrices apuntando al mismo lote**, cada una con parte de las filas, y `reopenRiskImportBatch` sólo ve una. *(Ausencia de unique/FK verificada.)* | `prevention-risk-import.ts:488-539`; schema `risk-legal.ts:94` | Unique parcial sobre `sourceImportBatchId` + FK, y/o `FOR UPDATE` del lote |
| **DATA-05** | `sourceImportBatchId` y `supersedesMatrixId` son texto libre **sin FK**, mientras su análogo `supersedesRequirementId` sí la tiene con `onDelete: "restrict"` y un comentario extenso justificándolo ("el registro legal es oponible"). La cadena de supersesión MIPER (art. 62) puede romperse sin que la base lo impida. *(Verificado.)* | `db/schema/prevention/risk-legal.ts:94-95` vs `:333` | Self-FK con `restrict` en `supersedesMatrixId`; FK a `preventionRiskImportBatches` en el otro |
| **HIG-02** | `setProtocolApplicability`: el `expectedVersion` se compara **en memoria** y el `UPDATE` no lo lleva en el `WHERE`; el CAS es cosmético. Se puede perder el pronunciamiento que justifica descartar un protocolo MINSAL obligatorio. | `prevention-hygiene.ts:590-623` | `onConflictDoUpdate` sobre el índice único existente, o mover `version` al `WHERE` |
| **HIG-03** | `enrollGroupInSurveillance`: el único es `(programId, workerId, dueOn)`, así que re-matricular el mismo GES en otra fecha **duplica matrículas pendientes**. No existe ninguna función que las cancele, por lo que el duplicado es permanente e infla la cobertura de vigilancia. | `prevention-hygiene.ts:314-327`; schema `hygiene.ts:142` | Excluir a quienes ya tienen matrícula `pending`/`summoned`, o índice único parcial por estado |
| **HIG-04** | Estados huérfanos en higiene: `surveillance_programs.status` nunca sale de `'active'`, `exposure_groups.isActive = false` no tiene escritor y **`exposure_group_members.leftOn` tampoco** — nadie puede salir de un GES. Un trabajador que deja de estar expuesto sigue contando y siendo matriculado. | `prevention-hygiene.ts` (archivo completo); schema `hygiene.ts:122,49,66` | `leaveExposureGroup` (UPDATE de `leftOn` + historial) y transición de estado del programa; ~15 líneas cada una |
| **HIG-05** | `closeCampaign` hace check-then-write **sin transacción ni CAS** (la tabla no tiene `version`) y dispara `accreditPdtpFromEvent` con el mismo `sourceId`; además `cancelled` y `draft` son estados inalcanzables: una campaña no realizada queda `active` para siempre. Es el único servicio del alcance sin tabla de historial. | `prevention-campaigns.ts:128-176`; schema `campaigns.ts:10-27` | `db.transaction` + `WHERE … AND status = 'active'` (CAS por estado, sin añadir columna) y una función de cancelación |
| **HIG-06** | `closeExternalEngagement`: mismo patrón que HIG-02 — `expectedVersion` verificado en memoria, `WHERE` sólo por `id`. Dos cierres concurrentes escriben `outcome` distintos y el segundo pisa al primero sin error. Además el gate de "medidas abiertas" se evalúa sin `FOR UPDATE`, así que una medida agregada en paralelo queda viva bajo un engagement cerrado. *(Verificado.)* | `prevention-external-engagements.ts:176-201` | Mover `expectedVersion` al `WHERE`, verificar `!updated`, y tomar el engagement `FOR UPDATE` |
| **HIG-07** | `escalateBlockingGapsToCapa` (capacitación y EPP) lee las acciones ya abiertas con `db` **antes** de abrir la transacción. Dos escalamientos concurrentes crean CAPA duplicadas: no hay unique que lo impida porque estas llamadas no pasan `sourceItemId`. | `prevention-training.ts:713-751`; `prevention-epp.ts:260-297` | Mover el `SELECT` dentro de la `tx` (cambio de una palabra: `db` → `tx`), o poblar `sourceItemId` |
| **HIG-08** | `recordTrainingAttendance` y `saveInspectionAnswers` mutan datos hijos **sin mover `version`**, así que el CAS del cierre no ve el cambio. El propio repo documenta el riesgo en `prevention-permits.ts:104-115` (`bumpPermitVersion` existe justo para esto). Se otorgan competencias sobre un padrón que el aprobador no vio. | `prevention-training.ts:332-348`; `prevention-inspections.ts:422-427` | Replicar `bumpPermitVersion` (incremento en SQL) en ambas mutaciones hijas |
| **HIG-09** | Al cerrar un acta con integrantes reemplazados, sus filas de asistencia se **borran físicamente**. Se pierde la traza de que fueron convocados, el denominador de asistencia cambia retroactivamente y el borrado no queda en el historial. | `prevention-cphs.ts:718-740` | No borrar: marcar con `excuseReason` de sistema, o excluir por join contra el estado del integrante |
| **SST-05** | `closeEvaluationVisit`: tres operaciones sin transacción, sin `FOR UPDATE` y con el `UPDATE` sin condición de estado. Doble cierre pisa `closedByUserId`; y `createEvaluation` no valida que la visita esté abierta, así que puede quedar una visita `cerrada` con una participación `borrador` — estado que la propia invariante declara imposible. | `sst-module/evaluations.ts:298-307` | Transacción con `.for("update")` y `WHERE … AND estado <> 'cerrada'`; gate en `createEvaluation` |
| **SST-06** | `archiveDocument` hace dos UPDATEs multi-tabla sin transacción. Un fallo entremedio deja el documento `archivado` con versiones activas que quedan **congeladas sin transición posible**: no se pueden avanzar (documento archivado) ni archivar. | `prevention-documents/crud.ts:202-205` | Una transacción para ambos UPDATEs |
| **SST-07** | `assignDocumentVersionToWorkforce` trocea en lotes de 200 con **una transacción por lote**. Un fallo en el lote 2 de una faena de 500 deja 200 asignados y 300 no, el contador se pierde con el `throw`, y nada reporta el parcial: `ACK_WITHOUT_DISTRIBUTION` no se dispara porque hay >0 targets. | `prevention-documents/distribution.ts:409-413` | El troceo es correcto; lo que falta es reportar el parcial (devolver `assigned` con el error) |
| **SST-08** | Al publicar una versión nueva, los acuses y targets de distribución **pendientes** de la versión anterior quedan huérfanos y sin salida: no se pueden acusar ni eximir (ambos caminos exigen `currentVersionId === version.id`). `integrity.ts` no tiene código de hallazgo para esto, así que la brecha es invisible. | `prevention-documents/workflow.ts:262-286`; schema `library.ts:138,152` | Cerrar los `pendiente` de la versión anterior con un estado terminal, o re-emitirlos contra la nueva |
| **SST-09** | El único de carpetas es `(parent_id, slug)` **sin `NULLS NOT DISTINCT`** (verificado en `db/migrations/0018:17`; el repo sí usa esa cláusula donde la quiere, en `0024`). Con `parent_id = NULL` el índice no aplica, así que `getOrCreateSystemFolder` puede crear dos carpetas "Evaluaciones SST" y las actas se reparten entre ambas. | `prevention-documents/folders-queries.ts:78-93` | `NULLS NOT DISTINCT` o índice parcial `WHERE parent_id IS NULL` |
| **PDTP-07** | Revocación de acreditación por lote sin transacción: `revoked.push` no consulta el resultado del `UPDATE`, así que reporta como revocadas ejecuciones que no cambiaron; y un fallo a mitad deja el evento parcialmente revocado. | `pdtp/accreditation.ts:468-517` | Un `db.transaction` y un solo `UPDATE … RETURNING id` |
| **PDTP-08** | Nueve sitios escriben contenido firmable y su entrada de `pdtp_change_log` **sin compartir transacción** (el helper acepta `tx` y simplemente no se le pasa). Exclusiones, overrides y duplicados pueden aplicarse sin que su motivo — parte del contenido que firman los aprobadores — quede registrado. | `pdtp/activities.ts:90-98,183,243,304-388,407-415`; `obligations.ts:145-149`; `worksites.ts:145-157,178-185`; `overrides.ts:85-136,182-203` | Pasar `tx` en los nueve; en `duplicatePdtpActivity` el `tx` está tres líneas arriba |
| **PDTP-09** | `syncPdtpCphsHeadcountExclusion` lee el headcount y aplica N exclusiones sin transacción común, sobre un conteo que puede haber cambiado. Con más de una actividad CPHS, un fallo a mitad deja unas excluidas y otras no para el mismo criterio legal. | `pdtp/worksites.ts:225-255` | Dar parámetro `client` a `excludeActivityForWorksite`/`includeActivityForWorksite` y envolver todo |
| **PDTP-10** | `upsertChecklistResponses` lee la instancia **antes** de abrir la transacción y no hay guard que impida escribir respuestas en una instancia `completado`: el `porcentajeCumplimiento` firmado al cerrar se recalcula después, y el cliente recibe un `overallStatus` obsoleto. | `pdtp/execution-checklists.ts:169-213` | Mover la lectura dentro de la `tx` con `FOR UPDATE` y rechazar si está `completado` |
| **PDTP-11** | `recalcExecutionQuantityFromInstances` hace count-then-write sin transacción: dos instancias completadas a la vez cuentan 5 y ambas escriben 5 cuando el valor correcto es 6. Y `completeExecutionChecklist` no re-chequea el estado, así que dos submits pisan `completedByUserId`. | `pdtp/execution-checklists.ts:227-239, 356-370` | `UPDATE … SET executed_quantity = (SELECT count(*) …)` en una sola sentencia |
| **PDTP-12** | `savePdtpActivityChecklist` calcula la versión dentro de la `tx` pero sin lock, y usa `nanoid()` en vez del id determinista que el resto del módulo usa (`templates.ts:407`, `activities.ts:367`). Doble submit falla con `23505` crudo: `ensureDefaultChecklist` sí captura `isUniqueViolation`, esta no. | `pdtp/checklists.ts:52-88` | `FOR UPDATE` + id determinista `pdtpActivityChecklistId(activityId, version)` |
| **PDTP-13** | `deletePdtpActivityChecklist` documenta en su JSDoc que sólo borra plantillas sin instancias, **y esa verificación no existe en el cuerpo**. La FK es `onDelete: "set null"`, así que las instancias sobreviven con `checklistId = NULL`: se pierde para siempre el vínculo a la plantilla que originó respuestas con valor legal. | `pdtp/checklists.ts:120-128` vs guard correcto en `imports.ts:700-703` | Replicar el guard de `imports.ts`, o pasar a soft delete (`isActive = false`) |
| **PDTP-14** | `finalizePdtpImportBootstrap` hace read-modify-write de `applyResultJson` con la lectura **fuera** de la transacción y sin `FOR UPDATE`. La lista `checklistIdsCreated` del perdedor desaparece — y es exactamente la lista que el rollback usa para limpiar, así que quedan artefactos que ningún rollback borrará. | `pdtp/imports.ts:644-665` | `FOR UPDATE` sobre el batch (que `applyPdtpImportBatch:425` sí toma) y lectura dentro de la `tx` |
| **PDTP-15** | `rejectPdtpExecution` devuelve la obligación a `pending`/`overdue` **sin verificar el resultado** del UPDATE, a diferencia del camino de aprobación, que sí falla cerrado. Si no matchea, la obligación conserva `completedQuantity` y `reportedAt` de un reporte rechazado y se cuenta como cumplida. | `pdtp/executions.ts:255-262` vs `:196-205` | `.returning()` + guard, simétrico con la rama de aprobación |

### APIs, cron y performance

| ID | Hallazgo | Ubicación | Corrección |
|---|---|---|---|
| **API-01** | `/api/prevencion/ppa/export` arma cinco filtros crudos del query string y los pasa a `gte`/`lte` contra `created_at`: `dateFrom=no-es-fecha` produce un 500, y `dateFrom=99999-01-01` un Excel **silenciosamente vacío**. `estado` tampoco se valida contra el conjunto de estados PPA. No existe `PpaExportFiltersSchema`. *(Verificado.)* | `app/api/prevencion/ppa/export/route.ts:26-33` → `ppa-module/calculos.ts:34-35` | Schema Zod con `z.string().date()` y `z.enum(PPA_ESTADOS)`, `safeParse` y 400 con `fieldErrors` |
| **API-02** | `sanitizeCell` no se aplica a las hojas "Acuses" ni "Indicadores": el resto de las hojas de esos mismos archivos sí lo usa. Riesgo bajo hoy (columnas generadas por el sistema), latente en la próxima columna de texto libre. | `documentacion/[id]/expediente/route.ts:74`; `pdtp/reporte-gestion/route.ts:151` | El mismo `Object.fromEntries(...map(safeCell))` de las hojas vecinas |
| **CRON-01** | `sst-weekly-alerts` devuelve `err.message` al cliente: es el único de los ocho sin el gate de `NODE_ENV` que los otros siete ya aplican (`pdtp-weekly-reminders:45`, y los cinco `prevention-*` con string fijo). Filtra detalle interno de Postgres. *(Verificado.)* | `app/api/cron/sst-weekly-alerts/route.ts:37-43` | Copiar el patrón vecino: `isProd ? "Internal cron error" : err.message` |
| **CRON-02** | Ningún cron declara `maxDuration` y dos recorren la tabla completa sin paginar (`prevention-capa-reminders` selecciona todas las CAPA abiertas con `select()` sin proyección; `evidence-gc` carga todas las ejecuciones). Un corte por timeout deja estado parcial y la corrida siguiente empieza de cero. | los 8 `route.ts`; `prevention-capa-reminders.ts:23-24`; `pdtp/evidence-gc.ts:72-78` | `maxDuration` explícito y `.limit(N)` con cursor en los dos recorridos completos |
| **CRON-03** | La idempotencia se resolvió por **contenido** (`dedupeKey`) y no por **corrida**: no hay lock en ninguno de los ocho. `createNotifications` hace `selectDistinct` + `insert` no atómicos (correo duplicado), `prevention-document-ack-reminders` incrementa `reminderCount` sin condición (contador de un acuse legal inflado), y `sst-alerts` filtra `isNull(alertSentAt)` al principio y marca al final. | `notification-create.ts:110-149`; `prevention-document-ack-reminders.ts:105-112`; `sst-alerts.ts:102-105` | `pg_try_advisory_lock(hashtext('cron:<nombre>'))` por job, y `onConflictDoNothing().returning()` en `createNotifications` para derivar los destinatarios de email de las filas realmente insertadas |
| **PERF-01** | `runPdtpObligationReminders` tiene tres N+1 anidados: resuelve permisos **por candidato** (no por faena única), consulta existencia por par candidato×destinatario, y suma 4 queries más por par. Con 50 obligaciones × 4 destinatarios: ~1.050 round-trips secuenciales, encadenados con otros dos jobs en el mismo request. | `pdtp/reminders.ts:219-262` | Cachear permisos por `worksiteId` (como ya hace `prevention-training-reminders.ts:51-58`) e **invertir el orden**: registrar primero y notificar sólo si `created`, lo que borra el SELECT previo (redundante con el `onConflictDoNothing`) |
| **PERF-02** | `runPreventionCapaReminders`: `1 + 3·faenas + hasta 12·N` queries. Cada `createNotifications` con `dedupeKey` cuesta 3 queries y hay hasta 4 llamadas por acción, todas secuenciales. Con 500 CAPA abiertas, ~6.000 round-trips con una conexión del pool tomada todo el tiempo. | `prevention-capa-reminders.ts:23-24, 50-111` | Proyección + `limit`; y acumular `(recipients, payload)` para un solo `createNotifications` por lote |
| **PERF-03** | `checkOverdueWeeklyAlerts`: 6 queries secuenciales por semana vencida, sin memoizar `getUsersWithSstInWorksite`. En régimen normal N es pequeño (filtra `alertSentAt IS NULL`), pero la primera corrida o una caída prolongada dan ~600 round-trips. | `sst-alerts.ts:65-112` | Un `inArray` para las evaluaciones, `Map` para los roles por faena, y un `UPDATE … WHERE id IN (…)` final |
| **PERF-04** | `markOverdueIncidentNotifications` hace un `UPDATE` por carril en bucle, más un `select()` sin proyección de todos los carriles vencidos. | `prevention-incidents.ts` (`markOverdueIncidentNotifications`) | Un solo `UPDATE … SET escalated_at = COALESCE(escalated_at, $now) WHERE status='pending' AND deadline_at <= $now RETURNING *` |
| **PERF-05** | `findPdtpWeeklyPending` invoca `loadProgramScheduleAndExecutions` **por faena** (15 faenas × 41 actividades = 30+ queries en `Promise.all`, saturando el pool), y luego filtra el período en JS sobre todas las semanas del año. | `pdtp/reminders.ts:88-113` | Una query con `inArray(worksiteId, …)` y el filtro de período en el `WHERE` |
| **DATE-01** | El `dedupeKey` de recordatorios de incidentes usa el día **UTC**. Una corrida a las 20:30 de Chile del día D graba la clave con fecha D+1, y la corrida de la mañana siguiente queda deduplicada: el carril DT/SEREMI atrasado pierde un ciclo de recordatorio. El archivo es el único de sus hermanos que no importa `todayInChile`. *(Verificado.)* | `prevention-incident-reminders.ts:53` (usado en `:83,98`) | `const day = todayInChile(now)`. `nowMs` está bien: compara instantes |
| **DATE-02** | Idéntico en los acuses de documentos: el acuse vencido no vuelve a avisar ni a escalar ese día. *(Verificado.)* | `prevention-document-ack-reminders.ts:51` (usado en `:87,100`) | `const today = todayInChile(now)` |
| **OFF-03** | La cola PPA **no tiene tope de entradas ni expiración**: es la única de las tres colas del repo sin política de retención (incidentes: 25/30 d; TAE: 48 h + purga). Además la limpieza sólo borra `failed` con `attempts >= 3`, así que un `failed` con 1-2 intentos es residente permanente. Al agotar la cuota de IndexedDB, `store.put` rechaza y **el PPA se pierde justo cuando la cola importa**. | `lib/pwa/offline-queue.ts:110-135`; `lib/pwa/hooks.ts:152-162` | Reusar la política de la cola de incidentes en `enqueuePpa`; corregir la condición de limpieza |
| **OFF-04** | La purga de la cola de incidentes exige `attempts >= MAX_RETRIES` **Y** 30 días: 25 reportes viejos nunca reintentados (dispositivo apagado) **no se purgan** y bloquean todo reporte nuevo con "La cola offline está llena", sin ninguna vista para inspeccionar o descartar. *(Verificado por el auditor principal.)* | `offline-incident-queue.ts:78-90` | Separar las dos políticas (expiración por edad; descarte por reintentos) y añadir una vista mínima de la cola reusando `listQueuedIncidentReports`, que ya existe y hoy sólo se usa para contar |
| **OFF-05** | Datos personales sin cifrar en IndexedDB: `initialNarrative` (10k caracteres sobre un accidente con personas), `workerName`, `identificationHint`, `employerName`, hasta 30 días, sin borrado en el logout — mientras el servidor **sí** cifra el equivalente (`prevention-incidents.ts:505`). Mitigación real existente: el camino offline nunca puebla el bloque `sensitive`. | `offline-incident-queue.ts:1-30, 92-98` | Mínimo accionable: borrar la cola en el logout (o advertir si queda contenido). Opcional: WebCrypto con clave de sesión |
| **UX-01** | `reconciliationStatus` y `status` de los denominadores se pintan **crudos** en la pestaña "Denominadores", mientras el mismo archivo usa `STATUS_LABELS` correctamente en las tablas mensual y semestral. Peor: el fallback sí está en español, así que la misma columna alterna idioma según haya registro o no. *(Verificado.)* | `canonical-indicators-dashboard.tsx:150` (mapa disponible en `:18`) | Reutilizar el `STATUS_LABELS` del propio archivo, como en `:142` |
| **UX-02** | El badge del inventario ARCO pinta `row.status` sin mapa, en la pantalla más sensible del módulo (ejercicio de derechos con plazo legal). Los productores del inventario sí aplican `labelOf`, pero el consumidor no lo garantiza estructuralmente. | `privacy-right-execution-workbench.tsx:145` | Garantizarlo en el productor con fallback explícito ("Sin estado") en vez de parchear el consumidor |
| **TEST-01** | Ninguna prueba ejercita **dos transacciones en carrera** en incidentes ni en PPA, pese a que la seguridad de ambas colas offline descansa en `onConflictDoNothing` sobre `clientSubmissionId`. Los 9 dominios logísticos sí tienen su `*concurrency-postgres.test.ts`; prevención no aportó ninguno. | patrón en `lib/__tests__/*concurrency-postgres.test.ts`; código sin cobertura: `prevention-incidents.ts:476-485`, `ppa-module/evaluaciones.ts:134-163` | Un `prevention-incidents-concurrency-postgres.test.ts` con dos reportes en `Promise.all` sobre la misma clave. **Ojo:** hay que agregar sus dos variables de entorno o el `describeIf` lo salta en verde — el bug que `ci.yml:277-281` documenta que ya ocurrió |
| **TEST-02** | `calculateInstanceCompliance` (scoring B/R/M, `regular = 0.5`) tiene **una sola aserción y es la trivial**: que un checklist vacío devuelve `null`. La fórmula normativa no tiene ninguna aserción numérica, y el propio comentario del código dice que el bug de contar los `na` en el denominador **ya ocurrió una vez**. Alimenta el cumplimiento integral del programa. | impl. `pdtp/execution-checklists.ts:254-284`; test `lib/__tests__/pdtp-checklist-action-plan.test.ts:675-678` | Una tabla de casos en un `it`: `[cumple, regular, no_cumple] → 50%`; `[cumple, na, no_tiene] → 100%`; sólo `na` → `null`; cada sinónimo de cumple → 100%. Cinco `expect` cubren toda la fórmula |

---

## 🔵 LOW / INFO

| ID | Sev | Hallazgo | Ubicación |
|---|---|---|---|
| **SEC-01** | LOW | `bulk-download` audita como descargados los documentos **descartados por el límite agregado**: la auditoría itera `loaded` (todo lo leído de disco) en vez de `files` (lo empaquetado). La bitácora afirma entregas que no ocurrieron. Los filtros de faena y confidencialidad sí son correctos. | `documentacion/bulk-download/route.ts:82-90` |
| **SEC-02** | LOW | `/api/prevencion/capa/export` exige `prevention:capa:view`, mientras sus cinco pares del módulo exigen un `:export` dedicado. No existe `prevention:capa:export` en el registro, así que es una brecha de diseño del manifiesto, no un olvido. La ruta tampoco audita. | `capa/export/route.ts:12-20` |
| **SEC-03** | INFO | `POST /pdtp/evidence/gc` admite `olderThanMs=0` y ejecuta un GC destructivo **global** (sin scope de faena) con permiso de gestión ordinaria. Su gemelo por cron sí valida `CRON_SECRET`. Ver GC-01: hoy este endpoint es un segundo camino al mismo borrado. | `pdtp/evidence/gc/route.ts:21-37` |
| **PRIV-02** | MEDIUM→LOW | La IP se toma del **extremo izquierdo** de `X-Forwarded-For`, que bajo `proxy_add_x_forwarded_for` es el valor suministrado por el cliente. Rotándolo se evade la cuota de 30 envíos/5 min del formulario público PPA, y la IP del rastro de auditoría de accesos sensibles es falsificable. El comentario del código afirma lo contrario ("la única que el cliente no puede rotar"). | `app/(public)/ppa/actions.ts:37,104`; y la IP de auditoría en 4 rutas sensibles |
| **PRIV-03** | MEDIUM→LOW | `bulk-download` lee **todos** los archivos a memoria con `Promise.all` y aplica el tope agregado *después*; `createZip` luego hace `Buffer.concat`. 50 documentos × 25 MB ≈ 1,25 GB de Buffers y ~2,5 GB de pico. El límite individual de 250 MB nunca dispara porque la subida está topada en 25 MB. | `documentacion/bulk-download/route.ts:55-81, 124-181` |
| **PRIV-04** | LOW | La exportación ARCO incluye la banda de salud (`fitnessStatus`, `restrictionsSummary`) exigiendo sólo `privacy:export_subject`, sin `health:view_restrictions`. Hoy no explotable (el único portador es `administrador`, que tiene ambos), pero se activaría al crear un rol "sólo exportación". | `prevention-privacy.ts:299-361`; `prevention-privacy-export.ts:88-115` |
| **PRIV-05** | LOW | El caché de idempotencia del ejecutor de derechos ARCO es un `Map` de proceso consultado **antes** de `auth()`, con clave sin namespace de usuario ni de solicitud. Un reinicio, una segunda réplica o dos POST concurrentes (el `get` no es atómico con el `set`) permiten doble ejecución de un borrado, o la omisión silenciosa de una ejecución legítima. | `privacidad/solicitudes/[id]/execute/route.ts:11-31,54` |
| **PRIV-06** | INFO | Oráculo de existencia por canal temporal: la rama "existe pero denegado" hace una query de membresía y un insert de auditoría extra respecto a "no existe". Mitigado de forma fuerte por ids `nanoid` (~126 bits); los códigos HTTP y mensajes ya son uniformes, que era el vector principal. | `prevention-reserved-cases.ts:170` vs `:180-188`, y 2 sitios equivalentes |
| **DATA-06** | LOW-MED | Un lote MIPER cuyas filas se rechazan todas termina `activated` con una **matriz borrador vacía**, que no puede pasar a revisión ("una MIPER sin peligros no puede enviarse a revisión") y cuyo lote ya no se puede reabrir: ambos atrapados, ocupando el correlativo `matrixVersion`. Los estados `reviewed` y `rejected` del CHECK no tienen ninguna ruta de entrada. *(Camino verificado.)* | `prevention-risk-import.ts:397,417,452-455,537`; schema `risk-legal.ts:273` |
| **DATA-07** | LOW | `resolveHierarchy` hace get-or-create sin `onConflictDoNothing`: dos `addRiskEntry` concurrentes con la misma tarea nueva chocan con `prevention_risk_tasks_process_code_unique`. Durante la activación de un lote grande (una sola transacción) ese choque **mata el lote completo**. El `throw` de validación de nombre es además inalcanzable en la rama de inserción. | `prevention-risk-legal.ts:285-290` (y `:276-282`) |
| **DATA-08** | LOW | De los tres hijos de una entrada MIPER, sólo los **marcadores** tienen política de supersesión: los `pdtp_source_links` de tipo `risk_control` siguen `isActive` apuntando a controles de una matriz ya `superseded`, así que un peligro crítico de v2 puede contarse como cubierto por un control de v1. | `prevention-risk-legal.ts:405-481` vs `:1094-1097, 1229-1242` |
| **HIG-10** | LOW | `closeCommitteeMeeting` no valida que el `responsibleUserId` del acuerdo esté en alcance ni sea de la faena — sólo que el usuario esté activo — mientras `closeManagementReview:879-892` sí hace `requireAccess` por compromiso. | `prevention-cphs.ts:768-788` |
| **HIG-11** | LOW | `updateEppRequirement`/`deactivateEppRequirement`/`createEppRequirement` escriben fila + historial **sin transacción**: si el insert del historial falla, el cambio de obligatoriedad de EPP queda sin traza en la tabla declarada "historial inmutable". Bonus: `updatedAt: todayInChile()` escribe `"2026-08-17"` en una columna `timestamptz`, perdiendo la hora. | `prevention-epp.ts:106-121, 134-203` |
| **HIG-12** | LOW | Seis mutaciones hacen check-then-write con la guarda de estado en memoria y el `WHERE` sólo por `id` (`revokeCompetency`, `resignCommitteeMember`, `recordCommitteeDtRegistration`, `linkActivityToMeeting`, `markAgendaSent`, `recordSurveillanceOutcome`). Efecto benigno (last-write-wins sobre un timestamp o un motivo), salvo `resignCommitteeMember`, que puede perder la carrera contra `replaceCommitteeMember`. | 6 sitios en `prevention-cphs.ts`, `prevention-training.ts`, `prevention-hygiene.ts` |
| **SST-10** | LOW | `markWeekCompleted` y `reopenEvaluationVisit`: check-then-write sin condición de estado en el `WHERE`. Idempotentes en el valor, así que el daño es cosmético (el error "ya está completada" no se dispara, o se pierde el motivo del primero). | `sst-module/weekly.ts:14-25`; `evaluations.ts:309-317` |
| **SST-11** | LOW | `uploadDocumentVersion` valida duplicado por checksum sin unique que lo respalde (`sst_document_versions_checksum_idx` **no** es único). El unique de `(documentId, version)` salva la carrera del número, pero el usuario recibe un error genérico en vez de "este archivo ya existe como versión N". | `prevention-documents/crud.ts:148-175` |
| **SST-12** | LOW | Estados declarados sin escritor: `sst_evaluation_visits.en_revision` es inalcanzable; `sst_documents.vencido` se deriva en lectura pero está en el CHECK; y **`sst_document_versions.archivado` es terminal absoluto** — `restoreDocument` restaura el documento pero no sus versiones, así que queda en `borrador` sin ninguna versión que someter a revisión. | schema `sst.ts:26`, `library.ts:82`; `crud.ts:218-221` |
| **SST-13** | LOW | `listFolderDescendantIds` hace BFS **sin protección de ciclo**, a diferencia de `getFolderPath` y `buildFolderOptionLabels`, que sí la tienen. Con un ciclo en `parentId` no termina. `moveDocumentFolder` lo previene usando esta misma función, así que el ciclo tendría que venir de un cambio directo en base. Coste del arreglo: un `Set`. | `prevention-documents/folders-move.ts:32-42` |
| **PDTP-16** | LOW | `setPdtpActivityWorksiteParams` usa `if (existing) update else insert` cuando la función hermana ya resuelve lo mismo con `onConflictDoUpdate` sobre ese target (`worksites.ts:500-509`). Doble guardado → `23505` crudo. Sus únicos consumidores son el propio archivo y un test: puede ser código muerto, y entonces la respuesta correcta es borrarlo. | `pdtp/worksites.ts:306-341` |
| **PDTP-17** | LOW | Un lote `staged` no caduca nunca, y al re-subir el mismo archivo se devuelve el lote viejo **con su preview congelada**, aunque el programa haya cambiado. El `apply` sí revalida (no corrompe datos), pero el usuario recibe un error inesperado tras confirmar una previsualización que decía estar limpia. `failed` es un estado del CHECK sin ningún productor. | `pdtp/imports.ts:164-174, 298-355`; schema `pdtp.ts:134` |
| **PDTP-18** | LOW | El rechazo de una ejecución de obligación no deja entrada en `pdtp_change_log` (el reporte sí la deja): la bitácora de control de cambios no registra que una obligación volvió a estar pendiente. Puede ser decisión deliberada de no ensuciar el changelog con eventos operacionales. | `pdtp/obligations.ts:190-194`; `executions.ts:255-262` |
| **API-03** | LOW | `?hoja=xxx` inexistente termina en 500 auditado en vez de 400. La decisión está **documentada por escrito** (el conjunto válido depende del programa resuelto) y el fallo queda auditado; lo listo sólo porque un input de usuario que produce 500 es, por contrato HTTP, un 400. | `pdtp/export/route.ts:105-114` |
| **API-04** | LOW | Seis server actions del expediente RE-20 no validan con Zod en **ningún** nivel (tipos TS que no validan en runtime): `followupDate` entra sin validar formato, y `preliminaryReportText`/`statementText`/`onePageSummary`/`rootCauseText` sin longitud máxima. `markIncidentDiffusion` es la única con un guard manual. | `app/(app)/prevencion/incidentes/actions.ts:171-263` → `prevention-incidents.ts:1384-1584` |
| **CRON-04** | LOW | Sólo `sst-alerts` y `pdtp-evidence-gc` aíslan errores por entidad; los cinco `prevention-*` no tienen `try/catch` dentro del `for`, así que **un registro corrupto aborta el batch entero** — y como no hay cursor, vuelve a romper la corrida siguiente: el job queda permanentemente caído por una fila mala. | `sst-alerts.ts:65-112` (correcto) vs los 5 `prevention-*-reminders.ts` |
| **PERF-06** | LOW | Tres exports heredan el `.limit(500)` de su `list*` sin propagar `rowLimitApplied` (sólo el de incidentes lo hace, con `limit: 2000` explícito). El usuario descarga un Excel truncado en silencio: evidencia incompleta ante fiscalización. Las tablas hijas multiplican el volumen (500 inspecciones × ~40 ítems = 20.000 filas en memoria). | `prevention-permits-export.ts:36`; `prevention-inspections-export.ts:35-44`; `prevention-training-export.ts:49-72` |
| **DATE-04** | LOW | `defaultTargetDate()` calcula "hoy + 30" en UTC (`new Date()` → `setUTCDate` → `toISOString`), así que a las 21:00 de Chile sugiere D+31. Esquiva la regla de ESLint porque el `.toISOString()` va sobre un `Date` mutado. Código duplicado idéntico en dos archivos. *(Verificado.)* | `epp-gap-list.tsx:24-28`; `competency-gap-list.tsx:24-28` |
| **DATE-05** | INFO | `monthDeadline` construye el fin de mes con `Date.UTC` y lo lee con `toISOString`: ida y vuelta se cancelan, **no es bug**. Lo dejo anotado porque es un patrón frágil idéntico al que sí rompió en otros sitios: cambiar a `new Date(year, month, 0)` lo rompería en silencio. | `lib/prevention/cphs-program.ts:54-57` |
| **UX-03** | LOW | Único botón `size="icon"` del módulo sin `aria-label` (tiene `title`, cuyo fallback como nombre accesible varía por navegador/AT). El patrón correcto está documentado en `miper/risk-map-panel.tsx:136`, con comentario explicando por qué se cambió `title` por `aria-label`. | `pdtp/aplicabilidad/pdtp-aplicabilidad-client.tsx:205-214` |
| **UX-04** | LOW | Tres tiras de métricas **no accionables** (`<div>` sin `onClick`/`href`) frente a ~13 que sí lo son en el mismo módulo, sin señal visual que las distinga. En CPHS el usuario ve "Sin sesionar: 3" y no puede ver cuáles; en Gestión del Cambio hay una `DataTable` justo debajo esperando el filtro. | `cphs/committee-list.tsx:91-99`; `gestion-cambio/change-list.tsx:56-64`; `indicadores-material-ambiental/material-environmental-dashboard.tsx:96-110` |
| **UX-05** | LOW | Detalle de programa de higiene con 5 celdas de métrica (`md:grid-cols-5`, el único del módulo). Atenuante: 3 de las 5 son *atributos* del programa, no KPI, y el patrón `facts`/`gap-px` es la tira que A1 permite. Pero "Vencidos: N" no lleva a los N vencidos. | `higiene/programas/[programId]/program-detail.tsx:61-78` |
| **UX-06** | INFO | Cuatro fechas renderizadas como ISO crudo (`.slice(0, 10)`) donde el resto del módulo usa `formatDate`. No hay ambigüedad de lectura ni bug de TZ (el string ya viene normalizado del servidor); el problema es la inconsistencia dentro de la misma tabla en `privacy-requests-workbench.tsx`, donde "Vence 2026-09-01" convive con badges en español. | `pdtp/acciones/acciones-table.tsx:135`; `privacidad/solicitudes/privacy-requests-workbench.tsx:188`; `pdtp/[programId]/page.tsx:363`; `documentacion/[id]/distribution-tab.tsx:174` |
| **UX-07** | INFO | Anclas de KPI que apuntan a `TabsContent`: Radix no monta el panel inactivo, así que el clic es silencioso salvo que coincida con la pestaña abierta. En MIPER `#bloqueos` sí funciona siempre (es una `<section>` fuera de las pestañas); en requisitos legales los tres destinos son pestañas. `pdtp/cobertura` no tiene el problema. | `miper/miper-workbench.tsx:191-196`; `requisitos-legales/legal-requirements-workbench.tsx:62` |
| **NORM-07** | LOW | Los días perdidos se imputan íntegros al mes de **ocurrencia**: un accidente del 20 de diciembre con 45 días de reposo carga los 45 en diciembre y ninguno en el año siguiente. Convención simple y trazable, distinta de la estadística mensual estándar. | `prevention-indicadores.ts:135-140` + `safety-indicators-calc.ts:179-188` |
| **NORM-08** | LOW | La tasa de siniestralidad (DS 67) no se calcula en ninguna parte, pero el checklist interno de auditoría SGSST **pregunta por ella**. La determina el organismo administrador para la cotización adicional, así que el impacto es bajo; la incoherencia es con la propia herramienta. | única mención en `lib/sst/definitions/auditoria-sgsst-sections.ts:209` |
| **NORM-10** | INFO | El docstring de `closeCommitteeMeeting` afirma que exige "mayoría de titulares Y ambas representaciones"; `assessQuorum` deliberadamente **ya no** exige mayoría (DS 54 art. 17, con comentario extenso justificándolo). El código es el correcto; el comentario miente. | `prevention-cphs.ts:656-660` vs `lib/prevention/cphs.ts:150-155` |
| **NORM-11** | INFO | `committeeSchema` sólo valida `mandateEndsOn > constitutedOn`: admite mandatos de 10 años, cuando el DS 54 art. 21 fija 2. `expireLapsedCommittees` sí vence por fecha correctamente. | `prevention-cphs.ts:49-59` |
| **TEST-03** | LOW | `prevention-risk-import.test.ts` mockea `@/db` con un Proxy que explota en cualquier acceso. **No es un mal test** — tiene control positivo explícito, que es justo lo que evita el falso verde. El hallazgo es de alcance: por diseño, ninguna prueba de ese archivo puede cubrir el resto del servicio, que queda sólo en el test real-Postgres tras `describeIf`. Conviene documentarlo para que nadie "complete" la cobertura mockeando `db` de verdad. | `lib/services/prevention-risk-import.test.ts:7-10, 69-71` |
| **TEST-04** | LOW | No pude confirmar si el gate "regular/malo exigen observación" existe en el motor PDTP: `observacion` entra y sale como opcional y no vi validación en el camino de guardado, mientras el nombre del tipo de ítem (`bueno_regular_malo_obs`) declara la intención. **Requiere verificación antes de accionarlo** — puede vivir en el motor de Inspecciones, lo que encajaría con la divergencia conocida entre los dos motores. | `pdtp/execution-checklists.ts:35,183,195`; `lib/sst/checklist.ts:14-16` |
| **DATA-09** | INFO | `assertNotPpaDriven` parsea el input dos veces por request. Correcto en atomicidad (usa `tx`, y el `UPDATE` revalida `version` + `status` en el `WHERE`). Sin impacto; no requiere acción. | `prevention-capa.ts:339-349, 436-446` |

---

## Matriz de priorización

| # | ID | Sev | Dominio | Consecuencia si no se corrige | Esfuerzo |
|---|---|---|---|---|---|
| 1 | GC-01 | CRITICAL | PDTP / storage | Borrado automático e irrecuperable de evidencia legal de cierre de CAPA | S (una query + set) |
| 2 | NORM-01 | HIGH | Indicadores | Accidente fatal fuera del indicador oficial, o dato falsificado | M (schema + motor + versión de fórmula) |
| 3 | PRIV-01 | HIGH | Privacidad | Filtración de metadatos Ley Karin y de salud a rol sin acceso | S (dos filtros) |
| 4 | HIG-01 | HIGH | Higiene | GES sobre el límite sin vigilancia médica obligatoria | S (`FOR UPDATE`) |
| 5 | SST-01/02 | HIGH | Documentos SST | Documentos legales huérfanos; dos actas vigentes de la misma evaluación | M (transacción + id determinista + `client` en `recordAuditEntry`) |
| 6 | OFF-01/02 | HIGH | Terreno | PPA sin valor probatorio; pérdida silenciosa de reportes de incidente | M (schema + payload + estado `failed` en UI) |
| 7 | PDTP-04/05 | HIGH | PDTP | CAPA duplicadas; checklist cerrado con plan de acción incompleto (Anexo 8) | S (`sourceItemId`) + M (transacción común) |
| 8 | PDTP-01/02/03/06 | HIGH | PDTP | Cumplimiento subestimado; calendario truncado; actividades huérfanas; ediciones pisadas | M (transacciones + locks) |
| 9 | SST-03/04 | HIGH | SST | Riesgo de deadlock por pool; acción agregada a un acta cerrada | S (dos firmas) |
| 10 | DATE-03 | HIGH | CPHS | Aviso falso/ausente de un deber legal mensual; dos pantallas se contradicen | S (una función + una columna) |
| 11 | CRON-03 + CRON-01 | MEDIUM | Cron | Correo duplicado; contadores legales inflados; fuga de error interno | S (advisory lock + `onConflictDoNothing`) |
| 12 | HIG-02/06 + SST-05 | MEDIUM | CPHS/higiene/SST | CAS cosmético: se pierden pronunciamientos y cierres sin error | S (mover `version` al `WHERE`) — patrón repetido |
| 13 | API-01 | MEDIUM | PPA | Export de cumplimiento silenciosamente vacío o 500 | S (un schema Zod) |
| 14 | Bloque MEDIUM restante | MEDIUM | varios | Ver tabla anterior | S–M |
| 15 | Bloque LOW/INFO | LOW | varios | Deuda, inconsistencias y trazabilidad | S |

---

## Plan de remediación por fases

### P0 — Inmediato (hoy / esta semana)

1. **Contener GC-01 antes de tocar código.** Verificar en el scheduler externo si
   `pdtp-evidence-gc` está agendado. Si lo está: desactivarlo o pasarle `?dryRun=true`, y auditar
   `prevention_capa_evidence` contra el contenido de `storage/pdtp-evidence/` para cuantificar la
   evidencia ya perdida. Después, el fix (incluir `prevention_capa_evidence.reference` en el set de
   referenciados) y, como defensa estructural, un directorio propio para la evidencia de CAPA.
2. **PRIV-01** — dos filtros en `getPreventionPrivacyRequestWorkbench`. Es el hallazgo de menor
   esfuerzo y mayor exposición legal (Ley Karin).
3. **HIG-01** — `FOR UPDATE` sobre el grupo de exposición. Una línea que cierra una decisión
   regulatoria mal tomada.
4. **SST-03 / SST-04** — dar `tx?` a `getEvaluation` y añadir `assertEditable` dentro de la
   transacción. Dos firmas; el patrón correcto ya existe en el mismo directorio.
5. **CRON-01** — copiar el gate de `NODE_ENV` del cron vecino.

### P1 — Corto plazo (2-3 semanas)

6. **La deuda transversal de atomicidad**, en un solo barrido y por orden de valor legal:
   `archiveEvaluationPdf` (SST-01, incluye dar `client` a `recordAuditEntry`), los cinco caminos
   RE-20 (DATA-03), `updatePdtpActivity` y `addPdtpActivity` (PDTP-02/03),
   `submitExecutionChecklist` (PDTP-05), `rollbackPdtpImportBatch` (PDTP-06),
   `accreditPdtpFromEvent` (PDTP-01), `archiveDocument` (SST-06) y los nueve changelog sin `tx`
   (PDTP-08). Todos comparten la misma corrección y el repo ya tiene el patrón correcto en
   `obligations.ts`, `approval-flow.ts` y `workflow.ts`.
7. **El patrón "CAS declarado pero no aplicado"** — mover `expectedVersion` al `WHERE` en HIG-02,
   HIG-06 y las seis de HIG-12; y `bumpPermitVersion` replicado en HIG-08. Conviene hacerlo de una
   vez y dejar una nota en `AGENTS.md`, porque es el defecto más repetido del módulo.
8. **Idempotencia sin respaldo** — `sourceItemId` en PDTP-04, id determinista en SST-02,
   `NULLS NOT DISTINCT` en SST-09, unique de lote MIPER en DATA-04, y el `SELECT` dentro de la `tx`
   en HIG-07.
9. **Colas offline** — OFF-01 (marca temporal del cliente en ambos payloads), OFF-02 (validación al
   desencolar + estado `failed` visible), OFF-03/04 (políticas de retención unificadas) y OFF-05
   (limpieza en logout).
10. **Cron** — advisory lock por job (CRON-03), `try/catch` por iteración (CRON-04) y `maxDuration`
    + paginación en los dos recorridos completos (CRON-02).
11. **NORM-01** — la rama de fatalidad en el motor de indicadores, con `SAFETY_INDICATOR_FORMULA_VERSION`
    versionado. Decisión de negocio previa: confirmar con Prevención la convención de los 6.000 días.
12. **Pruebas que faltan** — TEST-01 (dos tests de concurrencia, **con sus variables de entorno en
    CI**) y TEST-02 (cinco `expect` sobre el scoring B/R/M). Ambas cubren lógica que esta auditoría
    encontró sin red.

### P2 — Mejoras (backlog)

13. **Decisiones de negocio pendientes**, para llevar a Prevención antes de codificar: NORM-02
    (¿accidentes o lesionados en la accidentabilidad?), NORM-04 (¿bloquear o advertir un CPHS que no
    sea 3+3?), NORM-06 (¿exigir la resolución de la autoridad para reiniciar?), NORM-07 (¿prorratear
    días perdidos?), NORM-08 (¿calcular siniestralidad o quitarla del checklist?).
14. **Cobertura funcional faltante** — HIG-04 (`leaveExposureGroup` y transiciones del programa),
    NORM-05 (ciclo siguiente de vigilancia), HIG-05 (cancelar campañas), DATA-06 y PDTP-17 (salidas
    de los lotes atrapados), SST-08 y SST-12 (estados terminales sin salida).
15. **Performance** — PERF-01 a PERF-06 en orden. PERF-01 es el de mejor relación esfuerzo/beneficio
    porque la corrección **borra** código (invertir registrar/notificar elimina una query por par).
16. **Fechas y UX** — DATE-01/02/04 (tres `todayInChile`), UX-01/02 (enums en español en las dos
    pantallas normativas), UX-03/04/05/06/07.
17. **Deuda estructural señalada** — dar `client` a `recordAuditEntry` para acabar con las dos
    convenciones de la misma tabla de auditoría; unificar el predicado de "error de red", del que hay
    tres copias divergentes; y evaluar borrar el código muerto detectado
    (`getPdtpProgramActivityCount` sin call sites, `setPdtpActivityWorksiteParams`).

---

## Verificado como correcto (no volver a auditar)

Esta sección existe para que la próxima pasada no re-descubra lo que ya se revisó.

**RBAC y segregación de funciones — el eje más sólido del módulo.** Las 40 rutas de
`app/api/prevencion/**` validan sesión; ninguna server action de escritura corre con permiso de
`view` (las dos excepciones — acuse de AST y `revalidateBiblioteca` — son correctas y acotadas por
identidad). Los 8 crons validan `CRON_SECRET` con comparación timing-safe. `worksiteScopeSql`
**intersecta** el `worksiteId` pedido con el alcance del rol en vez de reemplazarlo, y
`scope.mode === "none"` devuelve `false` (falla cerrado). Ningún endpoint acepta identidad del
cliente (los 4 aciertos del grep son responsables asignados, no actores). Las rutas de descarga
resuelven pertenencia contra la base, no contra el nombre del archivo. **14 flujos 4-ojos
verificados por `userId` en el servidor**: MOC, planes de emergencia, MIPER (cadena de 3:
creador≠revisor≠aprobador), verificación de controles, requisitos legales, plantillas de inspección,
capacitaciones, permisos PTAR, acuse de AST por identidad, CAPA, autorización de reinicio tras fatal,
reporte idempotente de incidente y aprobación PDTP por pasos (con el permiso leído de la BD contra
un catálogo validado, no del body).

**Fórmulas y reglas normativas correctas.** Frecuencia y gravedad con factor millón, división por
cero → `null` con estado `non_calculable` (nunca 0 fantasma); trayecto excluido de las tasas pero
con DIAT exigida; DIAT/DIEP a 24 h desde `knownAt`, fatal con deadline inmediato y envío tardío
marcado sin bloquear; fatal/grave exige suspensión y medidas inmediatas; cierre de incidente exige
investigación, CAPA cerradas y notificaciones con evidencia; denominadores con aprobación segregada,
CHECK SQL de evidencia y reapertura trazable; snapshot con hash de fuentes y bitácora append-only;
desagregación por sexo con supresión de grupos <5. Umbral CPHS >25 correcto; quórum DS 54 art. 17
correcto y bien documentado (un representante por parte, suplente cubre titular, invitado nunca
altera el quórum); certificación Mutual con reserva de versión antes del snapshot (cierra la
carrera), brechas → CAPA a 60 días y expediente certificado inmutable; MIPER con vocabulario único
de 4 niveles, versionado con supersede + hash, revisión anual auto-programada y obligación PDTP a
30 días; mapa de riesgos reapuntado al publicar con historial de los huérfanos; art. 20 con
reciprocidad por tipo de información; art. 70 con CAPA obligatoria y numeración idempotente; RIOHS
con los 12 capítulos, completitud como gate de publicación dentro de la transacción y constancia
nominativa; higiene con nivel de acción (no sólo LPP), límites congelados por medición y protocolo
sin pronunciamiento como "por evaluar" (≠ "no aplica").

**Concurrencia bien resuelta (los patrones a copiar).** `prevention-permits.ts` es el servicio mejor
construido del alcance (CAS, mapa de transiciones explícito, `bumpPermitVersion` en las cinco
mutaciones hijas, gate de aislamientos vivos). `ppa-module/reportes.ts`: las seis transiciones con
`expectedPpaVersion` en el `WHERE` + `version + 1` en SQL + `if (!updated) throw`.
`pdtp/approval-flow.ts:decidePdtpApprovalStep`: unique de deduplicación, CAS de cinco columnas,
digest re-verificado dentro de la `tx` y efecto externo post-commit con el comentario que lo explica.
`applyPdtpImportBatch`: `FOR UPDATE` de batch **y** programa, re-chequeo dentro de la `tx`,
re-validación de actividades ajenas. `prevention-documents/workflow.ts`: `lockWorkflowContext` cubre
todos los caminos de publicación. `integrity.ts`: cinco acciones de regularización, todas con
`FOR UPDATE` y re-validación, todas archivan en vez de borrar.
`executePreventionPrivacyRight`: el mejor uso de `FOR UPDATE` del repo (cuatro dominios).
Barrido programático de los 47 archivos del alcance buscando `db.*` dentro de `db.transaction`:
**cero instancias** salvo `getEvaluation` (SST-03) — el anti-patrón corregido en
`prevention-cphs-certification` no reapareció. Los 35 call sites de `addPdtpChangeLogEntry` y
`recordOperationalActivity` dentro de transacciones pasan `tx` correctamente.

**Ausencia de hard deletes con valor legal.** Barrido completo: actas, certificados, mediciones de
higiene, permisos firmados, documentos, versiones y acuses **nunca** se borran (archivado lógico).
Los únicos `delete` son borradores, pasos de AST en estado editable, hallazgos sin CAPA, el payload
clínico en una supresión ARCO (que **es** el propósito), y la asistencia CPHS de HIG-09 — el único
problemático.

**Privacidad y datos sensibles.** AES-256-GCM con IV aleatorio y AAD por entidad; archivos sensibles
con doble checksum, round-trip de descifrado antes de persistir y escritura atómica `wx` + `rename`;
404 uniforme para inexistencia / faena ajena / falta de permiso / falta de membresía, con registro
del acceso denegado; la bitácora nunca copia contenido sensible; supresión ARCO real y no cosmética
(re-cifra el payload redactado y **rechaza** si aún contiene RUT o nombre del titular); tokens
públicos PPA hasheados SHA-256, derivados por HMAC de `AUTH_SECRET`, lookup sólo por hash,
revocables y con rotación de secreto soportada; rate-limit persistente en Postgres con ventana fija
atómica; `Content-Disposition` sin inyección y rutas de storage sin traversal.

**Convenciones de UI — barridas recursivas sobre todo el subárbol, 100 % del módulo.** Cero
`<select>` nativos (convención `OptionSelect` con centinela `__none__` respetada), cero imports
directos de `sonner`, **cero rastro de CSV**, cero `toLocaleDateString`, la única `<img>` tiene
`alt`, un solo botón icon-only sin `aria-label` (UX-03). Las 3 búsquedas locales son legítimas
(`/prevencion/ppa` está en `ROUTES_WITH_OWN_SEARCH`; las otras dos son buscadores dentro de
diálogos). Las 71 `page.tsx`: las que no importan `PageHeader`/`PageContainer` delegan a un
componente que sí los usa — cero incumplimientos reales.

**Fechas.** `prevention-indicadores.ts` es el mejor archivo del módulo en este eje: el año/mes del
incidente se derivan **en SQL** con `at time zone 'America/Santiago'` y la invalidación de períodos
usa `Intl` con la misma zona. Inventario completo de ~45 sitios de fecha revisados: los patrones
`setUTCDate(+n)` sobre cadenas `YYYY-MM-DD` son **correctos** (ida y vuelta en UTC se cancelan); los
`new Date().getFullYear()` son correctos porque `TZ=America/Santiago` está fijada en
`docker-compose.yml` y en CI. Los cuatro bugs reales son DATE-01, DATE-02, DATE-03 y DATE-04.

**Colas offline — lo que está bien.** Idempotencia end-to-end en ambas (claves estables generadas
antes del envío, `onConflictDoNothing` + recuperación de fila, `idempotentReplay` propagado a la UI);
un ítem malo no bloquea la cola; `recoverStalePpas` rescata los `syncing` huérfanos; el Service
Worker nunca cachea `/api/*`; ninguna cola usa `localStorage`. El camino offline de incidentes
**nunca** puebla el bloque `sensitive`, que es una mitigación deliberada real.

**Calidad de pruebas — la muestra leída es buena.** `safety-indicators-calc.test.ts` (212 líneas) es
ejemplar: golden examples documentados, factor millón, no-calculable, exclusión de ausencia menor a
un turno, deduplicación persona-evento, supresión de grupos pequeños y semestre sobre seis meses
crudos. `prevention-incidents.test.ts`, `riohs.test.ts` y las dos suites de cola offline: sin
trivialidades, con controles positivos. **No se encontró ningún `expect(true)`, snapshot gigante sin
intención ni aserción sobre el mock en lugar del efecto.** CI ejecuta las 13 suites
`prevention-*-postgres.test.ts` con sus 26 variables de entorno, en serie y con guarda destructiva.

**Falsos positivos de auditorías anteriores, respetados y no re-reportados:** SoD de PPA por permiso
y no por persona; ausencia deliberada de `prevention:contractors:*` (Chome es contratista);
`pdtp:view` sin `capa:view` en tres roles; export de incidentes sin filtros (registro legal
completo); catálogo Mutual en código; columnas de protocolo de higiene sólo en Zod; los tres espejos
de CAPA retirados; `ppa_status_history` que no es espejo; ODI en el catálogo de cursos; §17 y §7 del
CPHS descartados; equidad de género inimplementable; la lectura equivalente de gráficos revertida a
propósito; y la ausencia de modo oscuro.

---

## Estado de remediación (actualizado 2026-08-18)

Los 61 hallazgos están cerrados. Las seis decisiones normativas que este informe dejó
abiertas fueron resueltas por Prevención el 2026-08-18 e implementadas; **tres cambiaron
la recomendación técnica de este informe** y conviene leerlas como corrección a él:

- **NORM-06** — el informe proponía no bloquear el reinicio y exigir la resolución sólo al
  cerrar el expediente. Es incorrecto: el riesgo se materializa cuando la faena vuelve a
  operar, no cuando se cierra el papel. Hoy no se levanta la suspensión sin registrar
  organismo, folio, fecha y documento de respaldo.
- **NORM-07** — el informe proponía conservar la imputación al mes de ocurrencia. El
  argumento decisivo que faltaba es que la tasa de gravedad se calcula por SEMESTRE: un
  accidente de junio con 45 días cargaba todo al primer semestre. Ahora los días se
  reparten por el mes real de incapacidad; los registros sin fechas quedan marcados como
  heredados en vez de inventarles períodos.
- **NORM-08** — el informe proponía calcular la siniestralidad como
  `días perdidos / dotación × 100`. Eso NO es la siniestralidad del DS 67, que suma
  incapacidades temporales más invalideces y muertes sobre períodos anuales; rotularlo así
  habría sido técnicamente incorrecto. Se corrigió el checklist para preguntar por las
  tasas del DS 44 y el DS 67 queda como módulo independiente.

Las otras tres (NORM-01 días de cargo, NORM-02 numerador de accidentabilidad, NORM-04
composición del CPHS) se aprobaron con precisiones que también están implementadas. Dos
hallazgos del informe cayeron al implementarlos y **no deben re-reportarse**: **SST-04**
era un falso positivo (el plan de acción sí continúa tras cerrar el acta) y **HIG-08**
quedó diferido con causa. El detalle por fase está en
`tasks/TODO_AUDITORIA_PREVENCION_2026-08-17.md`.

---

## Zonas no cubiertas (para la próxima pasada)

Se declaran explícitamente para que nadie las lea como "revisado y limpio":

1. **Esquema Drizzle desde el eje de calidad de tipos** — se revisaron `risk-legal.ts`, `capa.ts`,
   `incidents.ts` y los uniques citados a lo largo del informe, pero **no** se auditaron
   sistemáticamente los 19 archivos buscando `text` donde debería haber enum/CHECK, FKs sin índice
   (Postgres no los crea solos), `timestamp` vs `timestamptz` inconsistentes, `jsonb` sin `$type<>`
   ni coherencia de nullability. Es la mayor laguna.
2. **Calidad de los schemas Zod** — se verificó *que* los servicios llaman a `.parse()`, no la
   permisividad de esos schemas: `.passthrough()`, strings sin `.max()`, números sin rango
   (horas-hombre, días perdidos), fechas sin cota de año, arrays sin `.max()`, `z.any()`. Sólo se
   leyeron íntegros 5 de los ~15 schemas.
3. **`lib/services/pdtp/compliance.ts`** (488 líneas) y **`reminders.ts`** parcialmente — el segundo
   es el productor de los recordatorios y candidato natural a los mismos defectos de atomicidad.
4. **`prevention-capa.ts` como motor** — se verificó que sus funciones aceptan `tx` y que los call
   sites lo pasan, pero no se auditó su máquina de estados interna ni `reconcileCapaAction`.
5. **Reglas de layout A2, A3, A4 y A5** — no auditadas (muro de filtros, lista+acción en header,
   estados vacíos con CTA, una dimensión = una representación). Candidatos concretos anotados:
   `coordinacion/engagements-workbench.tsx` (único componente con filtros en `useState` **y**
   `router.refresh`), `cphs/committee-list.tsx` (posible métrica duplicada entre la tira y las
   pseudo-pestañas), y dos empty-states caseros sin `EmptyState`.
6. **Nivel de aislamiento del pool** — se asumió READ COMMITTED (default de Postgres). No se verificó
   `db/index.ts`; bajo SERIALIZABLE varias carreras fallarían con error de serialización en vez de
   corromper, lo que cambiaría la severidad de HIG-01 y SST-09.
7. **Drift esquema↔producción** — todas las afirmaciones sobre índices únicos vienen del esquema
   Drizzle y, donde se cita, de la migración. No se comparó contra la base real.
8. **Nada se ejecutó** — auditoría de sólo lectura: sin tests, sin typecheck, sin reproducción de
   carreras. Las severidades reflejan lectura de código, no medición.
