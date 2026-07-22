import { asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpDocumentHistory,
  pdtpImportBatches,
  pdtpPrograms,
  pdtpRoleLegendEntries,
  users,
} from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState } from "./helpers"

/** Candidatos para vincular una identidad declarada en el documento. No se
 * acota por permiso PDTP: quien firmó o elaboró históricamente puede no
 * operar hoy el módulo (por ejemplo, gerencia legal). */
export async function listPdtpReconciliationCandidates() {
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name))
}

/**
 * Lee las declaraciones históricas del documento sin confundirlas con las
 * aprobaciones nativas de Chome. `adapterCode` identifica la versión exacta
 * de la referencia que aportó cada registro.
 */
export async function getPdtpDocumentMetadata(programId: string) {
  const [history, roleLegend] = await Promise.all([
    db.select({
      entry: pdtpDocumentHistory,
      linkedUserName: users.name,
      adapterCode: pdtpImportBatches.adapterCode,
      sourceChecksumSha256: pdtpImportBatches.sourceChecksumSha256,
    }).from(pdtpDocumentHistory)
      .leftJoin(users, eq(pdtpDocumentHistory.linkedUserId, users.id))
      .leftJoin(pdtpImportBatches, eq(pdtpDocumentHistory.sourceImportBatchId, pdtpImportBatches.id))
      .where(eq(pdtpDocumentHistory.programId, programId))
      .orderBy(asc(pdtpDocumentHistory.sequence), asc(pdtpDocumentHistory.createdAt)),
    db.select({
      entry: pdtpRoleLegendEntries,
      adapterCode: pdtpImportBatches.adapterCode,
      sourceChecksumSha256: pdtpImportBatches.sourceChecksumSha256,
    }).from(pdtpRoleLegendEntries)
      .innerJoin(pdtpImportBatches, eq(pdtpRoleLegendEntries.sourceImportBatchId, pdtpImportBatches.id))
      .where(eq(pdtpRoleLegendEntries.programId, programId))
      .orderBy(asc(pdtpRoleLegendEntries.code)),
  ])
  return { history, roleLegend }
}

export async function reconcilePdtpDeclaredActor(input: {
  historyEntryId: string
  linkedUserId: string | null
  actorUserId: string
  reason: string
}) {
  const reason = input.reason.trim()
  if (reason.length < 10) throw new Error("Indica un motivo de reconciliación de al menos 10 caracteres.")

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpDocumentHistory} WHERE id = ${input.historyEntryId} FOR UPDATE`)
    const [current] = await tx.select().from(pdtpDocumentHistory)
      .where(eq(pdtpDocumentHistory.id, input.historyEntryId)).limit(1)
    if (!current) throw new Error("Declaración documental no encontrada.")
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, current.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    if (input.linkedUserId) {
      const [linkedUser] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.linkedUserId)).limit(1)
      if (!linkedUser) throw new Error("La persona seleccionada ya no existe.")
    }

    if (current.linkedUserId === input.linkedUserId) return current
    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpDocumentHistory).set({
      linkedUserId: input.linkedUserId,
      reconciledByUserId: input.actorUserId,
      reconciledAt: now,
      reconciliationReason: reason,
      updatedAt: now,
    }).where(eq(pdtpDocumentHistory.id, current.id)).returning()
    if (!updated) throw new Error("No se pudo reconciliar la declaración documental.")
    await addPdtpChangeLogEntry(
      program.id,
      program.version,
      input.actorUserId,
      `document_history:${current.id}`,
      { linkedUserId: current.linkedUserId },
      { linkedUserId: updated.linkedUserId, reason },
      "Identidad declarada en el documento reconciliada explícitamente con una persona usuaria de Chome.",
      tx,
    )
    return updated
  })
}
