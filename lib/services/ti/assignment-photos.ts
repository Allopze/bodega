import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import { itAssignmentPhotos, itAssetAssignments, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { removeFile } from "@/lib/storage/helpers"
import { resolveTiFile } from "@/lib/storage/config"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"

export interface PersistPendingPhotoInput {
  stage: "delivery" | "return"
  /** Obligatoria para devolución: la foto no es evidencia hasta confirmar el acta. */
  pendingAssignmentId?: string | null
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  caption?: string | null
  uploadedByUserId: string
}

/**
 * Registra una foto aún pendiente de una entrega/devolución. Solo las fotos
 * ancladas dentro de createAssignment/returnAssignment adquieren carácter de
 * evidencia inmutable. Así cancelar un Sheet no deja filas ni archivos
 * mostrables como si fueran parte de un acta.
 */
export async function persistPendingPhoto(input: PersistPendingPhotoInput, worksiteIds: TiWorksiteScope = "all"): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (input.stage === "return") {
      if (!input.pendingAssignmentId) throw new Error("La devolución requiere una asignación")
      const [assignment] = await tx.select({ id: itAssetAssignments.id, returnedAt: itAssetAssignments.returnedAt, worksiteId: itAssetAssignments.worksiteId })
        .from(itAssetAssignments)
        .where(eq(itAssetAssignments.id, input.pendingAssignmentId))
      if (!assignment || assignment.returnedAt) {
        throw new Error("La asignación no está vigente para recibir una devolución")
      }
      assertTiWorksiteAccess(worksiteIds, assignment.worksiteId)
    } else if (input.pendingAssignmentId) {
      throw new Error("Una fotografía de entrega no puede apuntar a una asignación existente")
    }

    await tx.insert(itAssignmentPhotos).values({
      id,
      assignmentId: null,
      pendingAssignmentId: input.pendingAssignmentId ?? null,
      stage: input.stage,
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      caption: input.caption ?? null,
      uploadedByUserId: input.uploadedByUserId,
    })
    await recordAudit({
      userId: input.uploadedByUserId,
      action: "create",
      entityType: "it_assignment_photo",
      entityId: id,
      newState: { pendingAssignmentId: input.pendingAssignmentId ?? null, stage: input.stage, fileName: input.fileName },
    }, tx)
  })
  return id
}

export async function getPhotoById(id: string) {
  const [row] = await db
    .select({
      id: itAssignmentPhotos.id,
      assignmentId: itAssignmentPhotos.assignmentId,
      pendingAssignmentId: itAssignmentPhotos.pendingAssignmentId,
      stage: itAssignmentPhotos.stage,
      fileName: itAssignmentPhotos.fileName,
      filePath: itAssignmentPhotos.filePath,
      mimeType: itAssignmentPhotos.mimeType,
      caption: itAssignmentPhotos.caption,
      uploadedAt: itAssignmentPhotos.createdAt,
      uploadedByUserId: itAssignmentPhotos.uploadedByUserId,
      uploadedByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itAssignmentPhotos.uploadedByUserId})`,
      assetId: itAssetAssignments.assetId,
      worksiteId: itAssetAssignments.worksiteId,
    })
    .from(itAssignmentPhotos)
    .leftJoin(itAssetAssignments, eq(itAssignmentPhotos.assignmentId, itAssetAssignments.id))
    .where(eq(itAssignmentPhotos.id, id))
    .limit(1)
  return row ?? null
}

/** El usuario que subió una foto pendiente puede descartarla antes del acta. */
export async function deletePendingPhoto(id: string, uploadedByUserId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [photo] = await tx.select({
      id: itAssignmentPhotos.id,
      assignmentId: itAssignmentPhotos.assignmentId,
      filePath: itAssignmentPhotos.filePath,
      uploadedByUserId: itAssignmentPhotos.uploadedByUserId,
    }).from(itAssignmentPhotos).where(eq(itAssignmentPhotos.id, id)).for("update")
    if (!photo || photo.assignmentId || photo.uploadedByUserId !== uploadedByUserId) {
      throw new Error("La fotografía pendiente no existe o ya fue confirmada")
    }
    await tx.delete(itAssignmentPhotos).where(eq(itAssignmentPhotos.id, id))
    await recordAudit({
      userId: uploadedByUserId,
      action: "delete",
      entityType: "it_assignment_photo",
      entityId: id,
      oldState: { filePath: photo.filePath, pending: true },
    }, tx)
    return photo.filePath
  })
}

/** Limpia cargas abandonadas; una foto anclada a un acta nunca entra aquí. */
export async function cleanupOrphanPhotos(olderThanMinutes = 60): Promise<number> {
  const threshold = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()
  const removed = await db.delete(itAssignmentPhotos)
    .where(and(
      isNull(itAssignmentPhotos.assignmentId),
      isNull(itAssignmentPhotos.pendingAssignmentId),
      lt(itAssignmentPhotos.createdAt, threshold),
    ))
    .returning({ filePath: itAssignmentPhotos.filePath })

  await Promise.all(removed.map(async ({ filePath }) => {
    const absolutePath = resolveTiFile(filePath)
    if (!absolutePath) return
    await removeFile(absolutePath).catch(() => undefined)
  }))
  return removed.length
}
