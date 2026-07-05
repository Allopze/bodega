import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpExecutions, pdtpPrograms, worksites } from "@/db/schema"
import { pdtpExecutionId } from "./helpers"
import { assertWorksiteAccess } from "./helpers"
import type { WorksiteScope } from "./helpers"
import { pdtpExecutionSchema } from "@/lib/validation/prevention"

export async function markPdtpExecution(input: unknown, userId: string, scope: WorksiteScope) {
  const data = pdtpExecutionSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const [activity] = await db.select({ programId: pdtpActivities.programId }).from(pdtpActivities).where(eq(pdtpActivities.id, data.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select({ status: pdtpPrograms.status }).from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") throw new Error("Solo se pueden registrar ejecuciones contra programas PDTP en estado activo.")

  // Si la ejecución ya está aprobada, no se permite reescribir. Sólo
  // 'draft' o 'rejected' (devuelta para corrección) son editables.
  const [existing] = await db
    .select({ status: pdtpExecutions.status })
    .from(pdtpExecutions)
    .where(and(
      eq(pdtpExecutions.activityId, data.activityId),
      eq(pdtpExecutions.worksiteId, data.worksiteId),
      eq(pdtpExecutions.year, data.year),
      eq(pdtpExecutions.month, data.month),
      eq(pdtpExecutions.week, data.week),
    ))
    .limit(1)
  if (existing && existing.status === "approved") {
    throw new Error("La ejecución ya fue aprobada y no se puede modificar.")
  }

  const now = new Date().toISOString()
  const id = pdtpExecutionId(data.activityId, data.worksiteId, data.year, data.month, data.week)

  const [row] = await db.insert(pdtpExecutions).values({
    id, activityId: data.activityId, worksiteId: data.worksiteId, year: data.year, month: data.month,
    week: data.week, executedQuantity: data.executedQuantity, status: "submitted",
    evidenceText: data.evidenceText || null, evidenceUrl: data.evidenceUrl || null,
    evidencePhotos: data.evidencePhotos, executedByUserId: userId, executedAt: now, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [pdtpExecutions.activityId, pdtpExecutions.worksiteId, pdtpExecutions.year, pdtpExecutions.month, pdtpExecutions.week],
    set: {
      executedQuantity: data.executedQuantity, status: "submitted",
      evidenceText: data.evidenceText || null, evidenceUrl: data.evidenceUrl || null,
      evidencePhotos: data.evidencePhotos, executedByUserId: userId, executedAt: now,
      // Limpia rechazo previo: cuando el prevencionista reenvía, la
      // ejecución vuelve a 'submitted' con un nuevo intento.
      rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
      updatedAt: now,
    },
  }).returning()

  if (!row) throw new Error("No se pudo registrar la ejecucion PDTP.")
  return row
}

export async function approvePdtpExecution(executionId: string, userId: string, scope: WorksiteScope) {
  const [execution] = await db.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  if (execution.status === "approved") throw new Error("La ejecución ya fue aprobada.")
  if (execution.status !== "submitted" && execution.status !== "rejected") {
    throw new Error("Solo se pueden aprobar ejecuciones en estado 'submitted' o 'rejected'.")
  }
  assertWorksiteAccess(execution.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpExecutions)
    .set({
      status: "approved",
      approvedByUserId: userId,
      approvedAt: now,
      // Aprobar limpia cualquier rechazo previo.
      rejectedByUserId: null,
      rejectedAt: null,
      rejectionReason: null,
      updatedAt: now,
    })
    .where(eq(pdtpExecutions.id, executionId)).returning()
  if (!updated) throw new Error("No se pudo aprobar la ejecución PDTP.")
  return updated
}

export async function rejectPdtpExecution(
  executionId: string,
  userId: string,
  reason: string,
  scope: WorksiteScope,
) {
  if (!reason || reason.trim().length === 0) {
    throw new Error("Debes indicar el motivo del rechazo.")
  }
  if (reason.length > 1000) {
    throw new Error("El motivo del rechazo no puede superar 1000 caracteres.")
  }
  const [execution] = await db.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  if (execution.status === "approved") throw new Error("La ejecución ya fue aprobada, no se puede rechazar.")
  if (execution.status === "rejected") throw new Error("La ejecución ya fue rechazada.")
  if (execution.status !== "submitted") throw new Error("Solo se pueden rechazar ejecuciones en estado 'submitted'.")
  assertWorksiteAccess(execution.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(pdtpExecutions)
    .set({
      status: "rejected",
      rejectedByUserId: userId,
      rejectedAt: now,
      rejectionReason: reason.trim(),
      updatedAt: now,
    })
    .where(eq(pdtpExecutions.id, executionId)).returning()
  if (!updated) throw new Error("No se pudo rechazar la ejecución PDTP.")
  return updated
}

export type PendingPdtpExecution = {
  id: string
  activityId: string
  activityN: number
  activityName: string
  worksiteId: string
  worksiteName: string
  year: number
  month: number
  week: number
  executedQuantity: number
  evidenceText: string | null
  evidenceUrl: string | null
  evidencePhotos: string[]
  executedByUserId: string | null
  executedAt: string | null
}

export async function listPendingPdtpExecutions(
  year: number,
  scope: WorksiteScope,
): Promise<PendingPdtpExecution[]> {
  const rows = await db
    .select({
      id: pdtpExecutions.id,
      activityId: pdtpExecutions.activityId,
      activityN: pdtpActivities.n,
      activityName: pdtpActivities.activity,
      worksiteId: pdtpExecutions.worksiteId,
      worksiteName: worksites.name,
      year: pdtpExecutions.year,
      month: pdtpExecutions.month,
      week: pdtpExecutions.week,
      executedQuantity: pdtpExecutions.executedQuantity,
      evidenceText: pdtpExecutions.evidenceText,
      evidenceUrl: pdtpExecutions.evidenceUrl,
      evidencePhotos: pdtpExecutions.evidencePhotos,
      executedByUserId: pdtpExecutions.executedByUserId,
      executedAt: pdtpExecutions.executedAt,
    })
    .from(pdtpExecutions)
    .innerJoin(pdtpActivities, eq(pdtpExecutions.activityId, pdtpActivities.id))
    .innerJoin(worksites, eq(pdtpExecutions.worksiteId, worksites.id))
    .where(and(
      eq(pdtpExecutions.status, "submitted"),
      eq(pdtpExecutions.year, year),
      scope === "all" ? undefined : inArray(pdtpExecutions.worksiteId, scope),
    ))
    .orderBy(asc(worksites.name), asc(pdtpExecutions.month), asc(pdtpExecutions.week))

  return rows.map((r) => ({
    ...r,
    evidencePhotos: Array.isArray(r.evidencePhotos) ? r.evidencePhotos : [],
  }))
}
