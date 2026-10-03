/**
 * Ejecución del Programa de Trabajo Preventivo RE-04.1 (F2, §7.4–§7.6).
 *
 * Ocurrencias, registros «Se hizo / No se hizo», evidencia y avance derivado.
 *
 * Dos reglas mandan sobre el resto:
 *
 * - **Todo va por el `Client` que se recibe.** El sellado de la primera versión
 *   ocurre dentro de la transacción de `approveMiperFinal`, así que
 *   `syncOccurrences` recibe un `tx`. Resolver la conexión global `db` ahí cuelga
 *   la suite de PGlite (una sola conexión) — la lección más cara de la F1.
 * - **Los registros y la evidencia son de sólo inserción.** Corregir es anular
 *   con motivo y volver a registrar; el trigger de la 0346 rechaza cualquier
 *   otro `UPDATE` y todo `DELETE`. El avance nunca se guarda: se deriva.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskMatrices, preventionRiskMatrixVersions, preventionRiskOccurrenceEvidence,
  preventionRiskProgramActions, preventionRiskProgramOccurrenceRecords,
  preventionRiskProgramOccurrences, preventionRiskPrograms,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { occurrenceDates, type ProgramScheduleKind } from "@/lib/prevention/miper/schedule"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { claimPreventionEvidenceUpload } from "@/lib/services/prevention-evidence-upload"
import {
  occurrenceEvidenceRefSchema, occurrenceEvidenceSchema, occurrenceRecordRefSchema, occurrenceRecordSchema,
} from "@/lib/validation/prevention-module/miper"
import { todayInChile } from "@/lib/utils"
import { activeProgramControlLinks } from "./program-links"
import { type Client, type MiperAccess, miperHistory, nowIso, OUT_OF_SCOPE, scopeAllows } from "./shared"

const EXECUTE = "prevention:risk:program:execute"
const VIEW = "prevention:risk:view"

export type ProgramAction = typeof preventionRiskProgramActions.$inferSelect
type Program = typeof preventionRiskPrograms.$inferSelect

/* ── Autorización (§6.3) ──────────────────────────────────────────────────
 * Registra quien tenga `program:execute` sobre la faena, o el responsable
 * nominal de la actividad si además ve la faena con `risk:view`. Cualquier otra
 * persona recibe el mismo mensaje que un registro ajeno: «fuera de alcance»,
 * sin revelar que la ocurrencia existe.
 */
function requireExecute(access: MiperAccess, action: ProgramAction, worksiteId: string): string {
  if (access.permissions.includes(EXECUTE) && scopeAllows(access.scope, worksiteId)) return EXECUTE
  const isNominal = action.responsibleUserId !== null
    && action.responsibleUserId === access.userId
    && access.permissions.includes(VIEW)
    && scopeAllows(access.scope, worksiteId)
  if (isNominal) return VIEW
  throw new RiskLegalDomainError(OUT_OF_SCOPE)
}

/* ── Carga de contexto (siempre por el cliente recibido) ────────────────── */

async function loadProgramByMatrix(client: Client, matrixId: string): Promise<Program | null> {
  const [program] = await client.select().from(preventionRiskPrograms).where(eq(preventionRiskPrograms.matrixId, matrixId)).limit(1)
  return program ?? null
}

async function loadOccurrenceContext(client: Client, occurrenceId: string) {
  const [row] = await client.select({
    occurrence: preventionRiskProgramOccurrences,
    action: preventionRiskProgramActions,
    program: preventionRiskPrograms,
  }).from(preventionRiskProgramOccurrences)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .where(eq(preventionRiskProgramOccurrences.id, occurrenceId))
    .limit(1)
  if (!row) throw new RiskLegalDomainError(OUT_OF_SCOPE)
  return row
}

async function loadRecordContext(client: Client, recordId: string) {
  const [row] = await client.select({
    record: preventionRiskProgramOccurrenceRecords,
    occurrence: preventionRiskProgramOccurrences,
    action: preventionRiskProgramActions,
    program: preventionRiskPrograms,
  }).from(preventionRiskProgramOccurrenceRecords)
    .innerJoin(preventionRiskProgramOccurrences, eq(preventionRiskProgramOccurrences.id, preventionRiskProgramOccurrenceRecords.occurrenceId))
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .where(eq(preventionRiskProgramOccurrenceRecords.id, recordId))
    .limit(1)
  if (!row) throw new RiskLegalDomainError(OUT_OF_SCOPE)
  return row
}

/* ── Ocurrencias: generación y supersesión (§7.4) ───────────────────────── */

/**
 * Crea las ocurrencias que falten de una actividad, desde `starts_on` hasta el
 * 31-12 del período, **sin tocar** las existentes (mover la fecha de inicio
 * hacia adelante agrega las nuevas y conserva las ya generadas y registradas).
 *
 * Es no-op mientras la matriz no tenga ninguna versión sellada: un MIPER en
 * borrador tiene actividades pero no genera ocurrencias ejecutables (§7.4,
 * decisión abierta §14.3). `period` se puede pasar para ahorrar la lectura del
 * programa cuando el llamador ya lo conoce (el sellado).
 */
export async function syncOccurrences(client: Client, action: ProgramAction, period?: number): Promise<number> {
  if (action.status !== "active") return 0
  const [program] = await client.select({ id: preventionRiskPrograms.id, matrixId: preventionRiskPrograms.matrixId, period: preventionRiskPrograms.period })
    .from(preventionRiskPrograms).where(eq(preventionRiskPrograms.id, action.programId)).limit(1)
  if (!program) return 0

  const [sealed] = await client.select({ id: preventionRiskMatrixVersions.id }).from(preventionRiskMatrixVersions)
    .where(eq(preventionRiskMatrixVersions.matrixId, program.matrixId)).limit(1)
  if (!sealed) {
    const [matrix] = await client.select({ status: preventionRiskMatrices.status }).from(preventionRiskMatrices)
      .where(eq(preventionRiskMatrices.id, program.matrixId)).limit(1)
    if (!matrix || matrix.status !== "published") return 0
  }

  const dueDates = occurrenceDates({
    scheduleKind: action.scheduleKind as ProgramScheduleKind,
    startsOn: action.startsOn,
    periodEnd: `${period ?? program.period}-12-31`,
  })
  if (dueDates.length === 0) return 0

  const existing = await client.select({ dueOn: preventionRiskProgramOccurrences.dueOn }).from(preventionRiskProgramOccurrences)
    .where(eq(preventionRiskProgramOccurrences.actionId, action.id))
  const known = new Set(existing.map((row) => row.dueOn))
  const missing = dueDates.filter((dueOn) => !known.has(dueOn))
  if (missing.length === 0) return 0

  const now = nowIso()
  const inserted = await client.insert(preventionRiskProgramOccurrences)
    .values(missing.map((dueOn) => ({
      id: `riskoccurrence-${nanoid()}`, actionId: action.id, dueOn, outcome: "pending" as const, createdAt: now, updatedAt: now,
    })))
    .onConflictDoNothing()
    .returning({ id: preventionRiskProgramOccurrences.id })
  return inserted.length
}

/**
 * Al reemplazarse el MIPER por el del período siguiente, las ocurrencias
 * pendientes del programa anterior pasan a `superseded` y dejan de contar
 * (§7.4). Lo ya registrado —«Se hizo»/«No se hizo»— se conserva intacto.
 */
export async function supersedePendingOccurrences(client: Client, matrixId: string): Promise<number> {
  const program = await loadProgramByMatrix(client, matrixId)
  if (!program) return 0
  const actionIds = client.select({ id: preventionRiskProgramActions.id }).from(preventionRiskProgramActions)
    .where(eq(preventionRiskProgramActions.programId, program.id))
  const superseded = await client.update(preventionRiskProgramOccurrences)
    .set({ outcome: "superseded", updatedAt: nowIso() })
    .where(and(
      eq(preventionRiskProgramOccurrences.outcome, "pending"),
      inArray(preventionRiskProgramOccurrences.actionId, actionIds),
    ))
    .returning({ id: preventionRiskProgramOccurrences.id })
  return superseded.length
}

/* ── Registros de ejecución (§7.4) ──────────────────────────────────────── */

async function attachEvidence(
  client: Client,
  args: { recordId: string; evidenceUploadId: string; description?: string | null },
  program: Program,
  access: MiperAccess,
) {
  /* El archivo ya existe (`storePreventionEvidence` lo subió desde el
   * formulario); acá se reclama para la faena y se acredita. Rechaza una ruta
   * inventada o un archivo de otra faena. */
  await claimPreventionEvidenceUpload(client, {
    path: args.evidenceUploadId, domain: "miper", worksiteId: program.worksiteId, userId: access.userId,
  })
  await client.insert(preventionRiskOccurrenceEvidence).values({
    id: `riskoccurrenceevidence-${nanoid()}`,
    recordId: args.recordId,
    evidenceUploadId: args.evidenceUploadId,
    description: args.description ?? null,
    uploadedByUserId: access.userId,
    uploadedAt: nowIso(),
  })
}

/**
 * Registra «Se hizo» o «No se hizo» sobre una ocurrencia.
 *
 * - `done`: exige fecha efectiva (no futura) y **al menos una evidencia**; queda
 *   `late` si la fecha es posterior al vencimiento.
 * - `not_done`: exige motivo (≥ 10); la evidencia es opcional.
 *
 * Nunca corrige un registro previo: el anterior queda en el historial y la
 * ocurrencia apunta al vigente. Así un «No se hizo» seguido de un «Se hizo
 * (fuera de plazo)» son dos registros visibles.
 */
export async function recordOccurrence(input: unknown, access: MiperAccess) {
  const data = occurrenceRecordSchema.parse(input)
  return db.transaction(async (tx) => {
    const ctx = await loadOccurrenceContext(tx, data.occurrenceId)
    const actingAs = requireExecute(access, ctx.action, ctx.program.worksiteId)
    if (ctx.occurrence.outcome === "superseded") {
      throw new RiskLegalDomainError("Esta ocurrencia fue reemplazada por el período siguiente y ya no se registra.")
    }

    const now = nowIso()
    if (data.outcome === "done") {
      if (!data.effectiveOn) throw new RiskLegalDomainError("Indica la fecha en que se ejecutó la actividad.")
      if (data.effectiveOn > todayInChile()) throw new RiskLegalDomainError("La fecha de ejecución no puede ser futura.")
      if (!data.evidence || data.evidence.length === 0) {
        throw new RiskLegalDomainError("Adjunta al menos un archivo como evidencia de la ejecución.")
      }
    } else if ((data.reason ?? "").trim().length < 10) {
      throw new RiskLegalDomainError("Explica por qué no se hizo la actividad (al menos 10 caracteres).")
    }

    const late = data.outcome === "done" && data.effectiveOn! > ctx.occurrence.dueOn
    const recordId = `riskoccurrencerecord-${nanoid()}`
    await tx.insert(preventionRiskProgramOccurrenceRecords).values({
      id: recordId,
      occurrenceId: ctx.occurrence.id,
      outcome: data.outcome,
      effectiveOn: data.outcome === "done" ? data.effectiveOn! : null,
      late,
      reason: data.outcome === "not_done" ? data.reason!.trim() : null,
      notes: data.notes ?? null,
      recordedByUserId: access.userId,
      recordedAt: now,
    })
    for (const item of data.evidence ?? []) {
      await attachEvidence(tx, { recordId, evidenceUploadId: item.evidenceUploadId, description: item.description ?? null }, ctx.program, access)
    }
    await tx.update(preventionRiskProgramOccurrences)
      .set({ outcome: data.outcome, currentRecordId: recordId, updatedAt: now })
      .where(eq(preventionRiskProgramOccurrences.id, ctx.occurrence.id))
    await miperHistory(tx, {
      matrixId: ctx.program.matrixId, worksiteId: ctx.program.worksiteId, object: "occurrence", objectId: ctx.occurrence.id,
      changeType: data.outcome === "done" ? "occurrence_done" : "occurrence_not_done",
      after: { recordId, outcome: data.outcome, effectiveOn: data.effectiveOn ?? null, late, dueOn: ctx.occurrence.dueOn },
      actorUserId: access.userId, actingAs,
    })
    return { recordId, outcome: data.outcome, late }
  })
}

/**
 * Anula un registro con motivo. La ocurrencia vuelve al resultado del registro
 * vigente anterior —o a `pending` si no queda ninguno—. Nada se borra.
 */
export async function voidOccurrenceRecord(input: unknown, access: MiperAccess): Promise<void> {
  const data = occurrenceRecordRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const ctx = await loadRecordContext(tx, data.recordId)
    const actingAs = requireExecute(access, ctx.action, ctx.program.worksiteId)
    if (ctx.record.voidedAt) throw new RiskLegalDomainError("Ese registro ya está anulado.")
    const now = nowIso()
    await tx.update(preventionRiskProgramOccurrenceRecords)
      .set({ voidedAt: now, voidedByUserId: access.userId, voidReason: data.reason })
      .where(eq(preventionRiskProgramOccurrenceRecords.id, ctx.record.id))

    const [previous] = await tx.select().from(preventionRiskProgramOccurrenceRecords)
      .where(and(
        eq(preventionRiskProgramOccurrenceRecords.occurrenceId, ctx.occurrence.id),
        isNull(preventionRiskProgramOccurrenceRecords.voidedAt),
      ))
      .orderBy(desc(preventionRiskProgramOccurrenceRecords.recordedAt))
      .limit(1)
    await tx.update(preventionRiskProgramOccurrences)
      .set({ outcome: previous?.outcome ?? "pending", currentRecordId: previous?.id ?? null, updatedAt: now })
      .where(eq(preventionRiskProgramOccurrences.id, ctx.occurrence.id))
    await miperHistory(tx, {
      matrixId: ctx.program.matrixId, worksiteId: ctx.program.worksiteId, object: "occurrence", objectId: ctx.occurrence.id,
      changeType: "occurrence_record_voided", reason: data.reason,
      before: { recordId: ctx.record.id, outcome: ctx.record.outcome },
      after: { outcome: previous?.outcome ?? "pending", currentRecordId: previous?.id ?? null },
      actorUserId: access.userId, actingAs,
    })
  })
}

/* ── Evidencia (§7.6) ───────────────────────────────────────────────────── */

/** Agrega un archivo ya subido a un registro vigente. */
export async function addOccurrenceEvidence(input: unknown, access: MiperAccess) {
  const data = occurrenceEvidenceSchema.parse(input)
  return db.transaction(async (tx) => {
    const ctx = await loadRecordContext(tx, data.recordId)
    const actingAs = requireExecute(access, ctx.action, ctx.program.worksiteId)
    if (ctx.record.voidedAt) throw new RiskLegalDomainError("El registro está anulado: no admite evidencia nueva.")
    const evidenceId = `riskoccurrenceevidence-${nanoid()}`
    await claimPreventionEvidenceUpload(tx, {
      path: data.evidenceUploadId, domain: "miper", worksiteId: ctx.program.worksiteId, userId: access.userId,
    })
    await tx.insert(preventionRiskOccurrenceEvidence).values({
      id: evidenceId,
      recordId: ctx.record.id,
      evidenceUploadId: data.evidenceUploadId,
      description: data.description ?? null,
      uploadedByUserId: access.userId,
      uploadedAt: nowIso(),
    })
    await miperHistory(tx, {
      matrixId: ctx.program.matrixId, worksiteId: ctx.program.worksiteId, object: "evidence", objectId: evidenceId,
      changeType: "evidence_added", after: { recordId: ctx.record.id, evidenceUploadId: data.evidenceUploadId },
      actorUserId: access.userId, actingAs,
    })
    return { id: evidenceId }
  })
}

/**
 * Retira una evidencia con motivo. El archivo **no se borra** —la fila de
 * acreditación queda marcada— porque de él puede depender una fiscalización.
 */
export async function withdrawOccurrenceEvidence(input: unknown, access: MiperAccess): Promise<void> {
  const data = occurrenceEvidenceRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const [row] = await tx.select({
      evidence: preventionRiskOccurrenceEvidence,
      record: preventionRiskProgramOccurrenceRecords,
      action: preventionRiskProgramActions,
      program: preventionRiskPrograms,
    }).from(preventionRiskOccurrenceEvidence)
      .innerJoin(preventionRiskProgramOccurrenceRecords, eq(preventionRiskProgramOccurrenceRecords.id, preventionRiskOccurrenceEvidence.recordId))
      .innerJoin(preventionRiskProgramOccurrences, eq(preventionRiskProgramOccurrences.id, preventionRiskProgramOccurrenceRecords.occurrenceId))
      .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
      .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
      .where(eq(preventionRiskOccurrenceEvidence.id, data.evidenceId))
      .limit(1)
    if (!row) throw new RiskLegalDomainError(OUT_OF_SCOPE)
    const actingAs = requireExecute(access, row.action, row.program.worksiteId)
    if (row.evidence.withdrawnAt) throw new RiskLegalDomainError("Esa evidencia ya fue retirada.")
    await tx.update(preventionRiskOccurrenceEvidence)
      .set({ withdrawnAt: nowIso(), withdrawnByUserId: access.userId, withdrawReason: data.reason })
      .where(eq(preventionRiskOccurrenceEvidence.id, row.evidence.id))
    await miperHistory(tx, {
      matrixId: row.program.matrixId, worksiteId: row.program.worksiteId, object: "evidence", objectId: row.evidence.id,
      changeType: "evidence_withdrawn", reason: data.reason, after: { recordId: row.record.id, evidenceUploadId: row.evidence.evidenceUploadId },
      actorUserId: access.userId, actingAs,
    })
  })
}

/* ── Vínculos con el programa ─────────────────────────────────────────────── */

/**
 * Los controles del MIPER que ya tienen una actividad vinculada. Es lo que hace
 * posible la regla del Intolerable (§6.2) al enviar a revisión: un riesgo
 * Intolerable exige al menos una de sus medidas dentro del programa. El criterio
 * (sólo actividades vivas) vive en `activeProgramControlLinks`.
 */
export async function programLinkedControlIds(client: Client, matrixId: string): Promise<Set<string>> {
  const links = await activeProgramControlLinks(client, [matrixId])
  return new Set(links.map((link) => link.controlId))
}
