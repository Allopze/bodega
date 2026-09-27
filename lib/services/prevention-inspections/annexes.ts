import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionInspectionFindings,
  preventionInspectionRunParticipants,
  preventionInspectionRuns,
} from "@/db/schema"
import { history, nowIso, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { nanoid } from "@/lib/id"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { requireEditableRunForDeviation } from "./deviations"

/** Reemplaza atómicamente la lista ordenada de participantes del Anexo 08. */
export async function saveInspectionParticipants(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    participants: z.array(z.object({
      name: z.string().trim().min(2).max(200),
      position: z.string().trim().min(2).max(200),
      userId: z.string().min(1).nullable().optional(),
    })).min(1).max(30),
  }).parse(input)

  return db.transaction(async (tx) => {
    const { run, sourceDefinitionCode } = await requireEditableRunForDeviation(tx, data.runId, access)
    if (sourceDefinitionCode !== "inspeccion_no_planeada") {
      throw new Error("Los participantes estructurados corresponden al Anexo 08.")
    }
    await tx.delete(preventionInspectionRunParticipants)
      .where(eq(preventionInspectionRunParticipants.runId, run.id))
    await tx.insert(preventionInspectionRunParticipants).values(data.participants.map((participant, sortOrder) => ({
      id: `inspar-${nanoid()}`,
      runId: run.id,
      name: participant.name,
      position: participant.position,
      userId: participant.userId ?? null,
      sortOrder,
    })))
    await history(tx, {
      entityType: "run",
      entityId: run.id,
      worksiteId: run.worksiteId,
      changeType: "participants_saved",
      reason: `${data.participants.length} participante(s) registrados`,
      afterState: { participants: data.participants },
      actorUserId: access.userId,
    })
    return { saved: data.participants.length }
  })
}

/** Anexo 7: registra una acción preventiva directamente en CAPA (máximo seis). */
export async function registerInspectionPreventiveAction(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    actionDescription: z.string().trim().min(10).max(3000),
    responsibleUserId: z.string().min(1),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(input)
  return db.transaction(async (tx) => {
    const { run, sourceDefinitionCode } = await requireEditableRunForDeviation(tx, data.runId, access)
    if (sourceDefinitionCode !== "observacion_planeada") throw new Error("Las acciones preventivas directas corresponden al Anexo 7.")
    const existing = await tx.select({ id: preventionInspectionFindings.id })
      .from(preventionInspectionFindings)
      .where(and(eq(preventionInspectionFindings.runId, run.id), eq(preventionInspectionFindings.origin, "deviation")))
    if (existing.length >= 6) throw new Error("El Anexo 7 admite hasta seis acciones preventivas.")
    const [finding] = await tx.insert(preventionInspectionFindings).values({
      id: `insfnd-${nanoid()}`, runId: run.id, origin: "deviation", answerId: null,
      description: data.actionDescription, criticality: "medium", status: "open",
    }).returning()
    if (!finding) throw new Error("No se pudo registrar la acción preventiva.")
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "inspection", sourceId: run.id, worksiteId: run.worksiteId,
      finding: data.actionDescription, actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId, priority: "medium", targetDate: data.targetDate,
      evidenceRequired: true,
    }, access.userId)
    await tx.update(preventionInspectionFindings).set({ capaActionId: capa.id, status: "capa_linked", updatedAt: nowIso() })
      .where(eq(preventionInspectionFindings.id, finding.id))
    if (run.status === "planned") await tx.update(preventionInspectionRuns).set({ status: "in_progress", version: run.version + 1, updatedAt: nowIso() })
      .where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, run.version)))
    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: "preventive_action_created", reason: data.actionDescription,
      afterState: { findingId: finding.id, capaActionId: capa.id, targetDate: data.targetDate }, actorUserId: access.userId,
    })
    return { findingId: finding.id, capaActionId: capa.id }
  })
}
