import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpExecutions, pdtpPrograms, worksites } from "@/db/schema"
import { pdtpExecutionId } from "./helpers"
import { assertWorksiteAccess } from "./helpers"
import type { WorksiteScope } from "./helpers"
import { pdtpExecutionSchema } from "@/lib/validation/prevention"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { existsSync } from "node:fs"
import { logger } from "@/lib/logger"

export async function markPdtpExecution(input: unknown, userId: string, scope: WorksiteScope) {
  const data = pdtpExecutionSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const [activity] = await db.select({ programId: pdtpActivities.programId }).from(pdtpActivities).where(eq(pdtpActivities.id, data.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db.select({ status: pdtpPrograms.status, year: pdtpPrograms.year }).from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") throw new Error("Solo se pueden registrar ejecuciones contra programas PDTP en estado activo.")
  // Espejo del guard de overrides.ts: sin esto, una ejecución con el año
  // calendario (en vez del año del programa) queda huérfana — el detalle y
  // /aprobaciones consultan por `program.year`, así que nunca aparecería.
  if (program.year !== data.year) {
    throw new Error(`La ejecución debe corresponder al año del programa (${program.year}).`)
  }

  // Si la ejecución ya está aprobada, no se permite reescribir. Sólo
  // 'draft' o 'rejected' (devuelta para corrección) son editables.
  // H-M3: también leemos evidenceUrl/evidencePhotos existentes para
  // hacer append-only (preservar la historia de evidencias).
  const [existing] = await db
    .select({
      status: pdtpExecutions.status,
      evidenceUrl: pdtpExecutions.evidenceUrl,
      evidencePhotos: pdtpExecutions.evidencePhotos,
    })
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

  // Append-only: dedupe por nombre de archivo, preserva URLs previas
  function fileName(url: string): string {
    const idx = url.lastIndexOf("/")
    return idx >= 0 ? url.slice(idx + 1) : url
  }
  const previousPhotos = Array.isArray(existing?.evidencePhotos) ? existing.evidencePhotos : []
  const newPhotosInput = (data.evidencePhotos ?? []).filter(Boolean)
  // H-B7: filtramos fotos nuevas cuyo archivo no exista físicamente
  const verifiedNewPhotos = newPhotosInput.filter((url) => {
    const absolutePath = resolvePdtpEvidenceFile(url)
    if (!absolutePath || !existsSync(absolutePath)) {
      logger.warn({ url }, "[pdtp] foto de evidencia sin archivo físico, descartada")
      return false
    }
    return true
  })
  const allPhotos = [...previousPhotos, ...verifiedNewPhotos]
  const dedupedPhotos: string[] = []
  const seen = new Set<string>()
  for (const url of allPhotos) {
    const name = fileName(url)
    if (seen.has(name)) continue
    seen.add(name)
    dedupedPhotos.push(url)
  }
  // evidenceUrl: si viene uno nuevo, se usa; si no, se preserva el
  // previo. Esto evita que un re-envío sin archivo borre el archivo
  // que el prevencionista subió antes.
  // H-B7: si se recibió una URL nueva, verificamos que el archivo
  // físico exista; si no, descartamos la referencia y loggeamos.
  // Razón: la DB no debe quedar con referencias a archivos inexistentes
  // (un upload pudo fallar, el cliente pudo cerrar la pestaña, etc).
  let nextEvidenceUrl: string | null = null
  if (data.evidenceUrl) {
    const absolutePath = resolvePdtpEvidenceFile(data.evidenceUrl)
    if (absolutePath && existsSync(absolutePath)) {
      nextEvidenceUrl = data.evidenceUrl
    } else {
      logger.warn(
        { evidenceUrl: data.evidenceUrl, activityId: data.activityId, worksiteId: data.worksiteId },
        "[pdtp] evidenceUrl no se pudo resolver a un archivo físico; se descarta la referencia"
      )
    }
  } else {
    nextEvidenceUrl = existing?.evidenceUrl ?? null
  }

  const now = new Date().toISOString()
  const id = pdtpExecutionId(data.activityId, data.worksiteId, data.year, data.month, data.week)

  // H-B8 (intencional): `evidenceText || null` colapsa string vacío a
  // null en DB. Es la convención del módulo: "sin texto de evidencia"
  // ≡ NULL (semánticamente equivalente y simplifica queries). Lo mismo
  // aplica a `evidenceUrl` cuando se preserva el previo inexistente.
  const [row] = await db.insert(pdtpExecutions).values({
    id, activityId: data.activityId, worksiteId: data.worksiteId, year: data.year, month: data.month,
    week: data.week, executedQuantity: data.executedQuantity, status: "submitted",
    evidenceText: data.evidenceText || null, evidenceUrl: nextEvidenceUrl,
    evidencePhotos: dedupedPhotos, executedByUserId: userId, executedAt: now, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [pdtpExecutions.activityId, pdtpExecutions.worksiteId, pdtpExecutions.year, pdtpExecutions.month, pdtpExecutions.week],
    set: {
      executedQuantity: data.executedQuantity, status: "submitted",
      evidenceText: data.evidenceText || null, evidenceUrl: nextEvidenceUrl,
      evidencePhotos: dedupedPhotos, executedByUserId: userId, executedAt: now,
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
  scope: WorksiteScope,
  filter: { programId?: string; year?: number } = {},
): Promise<PendingPdtpExecution[]> {
  // Bug E: antes exigía un `year` fijo (el caller pasaba
  // currentPdtpPeriod().year) — un programa cuyo año difiere del calendario
  // (o cuyas ejecuciones ya no son del año en curso) nunca aparecía acá.
  // Con `programId` filtramos por las actividades de ESE programa (no por
  // año: un programa tiene un solo año, y así funciona sin importar cuál
  // sea). Sin programId ni year, se listan pendientes de todos los años.
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
      filter.programId ? eq(pdtpActivities.programId, filter.programId) : undefined,
      filter.year ? eq(pdtpExecutions.year, filter.year) : undefined,
      scope === "all" ? undefined : inArray(pdtpExecutions.worksiteId, scope),
    ))
    .orderBy(asc(worksites.name), asc(pdtpExecutions.month), asc(pdtpExecutions.week))

  return rows.map((r) => ({
    ...r,
    evidencePhotos: Array.isArray(r.evidencePhotos) ? r.evidencePhotos : [],
  }))
}
