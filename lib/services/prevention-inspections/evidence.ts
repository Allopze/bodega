import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionInspectionAnswerEvidence,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionFindingEvidence,
  preventionInspectionRunDocuments,
  preventionInspectionRuns,
} from "@/db/schema"
import { history, NOT_FOUND, requireAccess, type Client, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { nanoid } from "@/lib/id"

/* ── Evidencia fotográfica (función #1) ───────────────────────────────────
 * `evidenceReference` existía en el esquema y en el export desde el principio,
 * y ninguna pantalla adjuntaba nada: una inspección sin foto del hallazgo no
 * sirve como evidencia. Se modela 1-a-N porque un incumplimiento suele
 * necesitar más de un ángulo.
 */

/** Resuelve la respuesta y comprueba que su inspección siga siendo editable. */
async function requireEditableAnswer(client: Client, answerId: string, access: InspectionAccess) {
  const [row] = await client.select({ answer: preventionInspectionAnswers, run: preventionInspectionRuns })
    .from(preventionInspectionAnswers)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionAnswers.runId))
    .where(eq(preventionInspectionAnswers.id, answerId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
  // Mismo criterio que `saveAnswersWithClient`: sin esto se podría adjuntar o
  // borrar evidencia de una inspección ya revisada.
  if (!["planned", "in_progress"].includes(row.run.status)) {
    throw new Error("No se puede modificar la evidencia de una inspección ya ejecutada.")
  }
  return row
}

/* ── Documento origen: la foto de la planilla ─────────────────────────────── */

/**
 * Adjunta la foto de la planilla física al run.
 *
 * El alcance y la editabilidad se comprueban contra el run real, no contra un
 * `worksiteId` que venga en el formulario — mismo criterio que
 * `addAnswerEvidence`.
 */
export async function addRunDocument(input: {
  runId: string
  path: string
  fileName?: string | null
  mimeType?: string | null
  fileSize?: number | null
  checksumSha256?: string | null
  caption?: string | null
  kind?: "source_form" | "attachment"
  /**
   * Lo que leyó el detector de marcas. **Modo sombra**: se guarda para poder
   * medirlo contra lo que teclee la persona, y NO pre-llena respuestas. El
   * pre-llenado se enciende cuando la medición lo respalde.
   */
  extraction?: {
    layoutVersion: string
    cells: { sectionId: string; itemId: string; result: string; confidence: number }[]
  } | null
}, access: InspectionAccess) {
  const [run] = await db.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, input.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:ingest", run.worksiteId)
  if (["reviewed", "cancelled"].includes(run.status)) {
    throw new Error("No se pueden adjuntar documentos a una inspección cerrada o cancelada.")
  }
  const [created] = await db.insert(preventionInspectionRunDocuments).values({
    id: `insdoc-${nanoid()}`,
    runId: input.runId,
    path: input.path,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    fileSize: input.fileSize ?? null,
    checksumSha256: input.checksumSha256 ?? null,
    kind: input.kind ?? "source_form",
    caption: input.caption ?? null,
    extraction: input.extraction ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar el documento.")
  await history(db, {
    entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
    changeType: "document_attached", reason: input.caption ?? "Planilla adjunta",
    actorUserId: access.userId,
  })
  return created
}

export async function deleteRunDocument(input: { documentId: string }, access: InspectionAccess) {
  const [row] = await db.select({ document: preventionInspectionRunDocuments, run: preventionInspectionRuns })
    .from(preventionInspectionRunDocuments)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionRunDocuments.runId))
    .where(eq(preventionInspectionRunDocuments.id, input.documentId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:ingest", row.run.worksiteId)
  if (["reviewed", "cancelled"].includes(row.run.status)) {
    throw new Error("No se pueden quitar documentos de una inspección cerrada o cancelada.")
  }
  await db.delete(preventionInspectionRunDocuments)
    .where(eq(preventionInspectionRunDocuments.id, input.documentId))
  // El archivo físico lo recoge el GC de evidencias, igual que las fotos de respuesta.
  return { id: input.documentId }
}

export async function addAnswerEvidence(input: {
  answerId: string
  path: string
  caption?: string | null
}, access: InspectionAccess) {
  const data = z.object({
    answerId: z.string().min(1),
    // El path lo produce la ruta de subida, nunca el usuario: se valida el
    // prefijo igual que hace PDTP para que nadie inyecte una ruta arbitraria.
    path: z.string().regex(/^storage\/inspection-evidence\/[A-Za-z0-9._-]+$/, "Ruta de evidencia inválida."),
    caption: z.string().trim().max(300).nullable().optional(),
  }).parse(input)

  const row = await requireEditableAnswer(db, data.answerId, access)
  const [created] = await db.insert(preventionInspectionAnswerEvidence).values({
    id: `insev-${nanoid()}`,
    answerId: data.answerId,
    path: data.path,
    caption: data.caption ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar la evidencia.")
  await history(db, {
    entityType: "answer", entityId: data.answerId, worksiteId: row.run.worksiteId,
    changeType: "evidence_added", reason: `Evidencia adjuntada a "${row.answer.itemLabel}"`,
    actorUserId: access.userId,
  })
  return created
}

async function requireFindingEvidenceTarget(findingId: string, access: InspectionAccess) {
  const [row] = await db.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .where(eq(preventionInspectionFindings.id, findingId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
  if (!["planned", "in_progress", "completed"].includes(row.run.status)) {
    throw new Error("No se puede adjuntar evidencia a una inspección cerrada o cancelada.")
  }
  return row
}

/** Valida autorización y estado antes de escribir el archivo físico. */
export async function assertFindingEvidenceUploadAllowed(findingId: string, access: InspectionAccess) {
  await requireFindingEvidenceTarget(z.string().min(1).parse(findingId), access)
}

export async function addFindingEvidence(input: {
  findingId: string
  path: string
  fileName: string
  mimeType: string
  fileSize: number
  checksumSha256: string
  caption?: string | null
}, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    path: z.string().regex(/^storage\/inspection-evidence\/[A-Za-z0-9._-]+$/, "Ruta de evidencia inválida."),
    fileName: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(200),
    fileSize: z.number().int().positive().max(25 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    caption: z.string().trim().max(500).nullable().optional(),
  }).parse(input)

  const row = await requireFindingEvidenceTarget(data.findingId, access)
  const [created] = await db.insert(preventionInspectionFindingEvidence).values({
    id: `insfev-${nanoid()}`,
    findingId: row.finding.id,
    path: data.path,
    fileName: data.fileName,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    checksumSha256: data.checksumSha256,
    caption: data.caption ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar la evidencia al hallazgo.")
  await history(db, {
    entityType: "finding", entityId: row.finding.id, worksiteId: row.run.worksiteId,
    changeType: "evidence_added", reason: data.caption ?? data.fileName,
    actorUserId: access.userId,
  })
  return created
}

export async function deleteAnswerEvidence(input: { evidenceId: string }, access: InspectionAccess) {
  const data = z.object({ evidenceId: z.string().min(1) }).parse(input)
  const [evidence] = await db.select().from(preventionInspectionAnswerEvidence)
    .where(eq(preventionInspectionAnswerEvidence.id, data.evidenceId)).limit(1)
  if (!evidence) throw new Error(NOT_FOUND)
  const row = await requireEditableAnswer(db, evidence.answerId, access)

  await db.delete(preventionInspectionAnswerEvidence)
    .where(eq(preventionInspectionAnswerEvidence.id, data.evidenceId))
  // El archivo físico no se borra aquí: lo recoge el GC de evidencias, que ya
  // recorre el directorio comparándolo contra las referencias en BD.
  await history(db, {
    entityType: "answer", entityId: evidence.answerId, worksiteId: row.run.worksiteId,
    changeType: "evidence_removed", reason: `Evidencia eliminada de "${row.answer.itemLabel}"`,
    actorUserId: access.userId,
  })
  return { deleted: 1 }
}
