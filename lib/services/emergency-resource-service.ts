import { and, desc, eq, isNull } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  preventionEmergencyResourceAssignments,
  preventionEmergencyResourceEvents,
  preventionEmergencyResourcePoints,
  preventionEmergencyResources,
  preventionEmergencyResourceServiceCases,
  attachments,
} from "@/db/schema"
import { nanoid } from "@/lib/id"

export async function openEmergencyResourceServiceCaseTx(tx: Tx, input: {
  resourceId: string
  requestItemId: string
  worksiteId: string
  actorUserId: string
}) {
  const [resource] = await tx.select().from(preventionEmergencyResources)
    .where(and(
      eq(preventionEmergencyResources.id, input.resourceId),
      eq(preventionEmergencyResources.worksiteId, input.worksiteId),
    ))
    .for("update")
    .limit(1)
  if (!resource) throw new Error("El activo de emergencia no pertenece a la faena de la solicitud.")
  if (resource.status === "out_of_service") throw new Error("El activo está dado de baja y no admite una solicitud de recarga.")

  const [openCase] = await tx.select({ id: preventionEmergencyResourceServiceCases.id })
    .from(preventionEmergencyResourceServiceCases)
    .where(and(
      eq(preventionEmergencyResourceServiceCases.resourceId, resource.id),
      eq(preventionEmergencyResourceServiceCases.status, "open"),
    )).limit(1)
  if (openCase) throw new Error("Este extintor ya tiene un caso de recarga abierto.")

  const [assignment] = await tx.select().from(preventionEmergencyResourceAssignments)
    .where(and(
      eq(preventionEmergencyResourceAssignments.resourceId, resource.id),
      isNull(preventionEmergencyResourceAssignments.unassignedAt),
    ))
    .for("update")
    .limit(1)
  const now = new Date().toISOString()
  if (assignment) {
    await tx.update(preventionEmergencyResourceAssignments).set({
      unassignedAt: now,
      reason: "Activo enviado a recarga",
    }).where(eq(preventionEmergencyResourceAssignments.id, assignment.id))
  }

  let previousPointId = assignment?.pointId ?? null
  if (!previousPointId) {
    const [previousCase] = await tx.select({ previousPointId: preventionEmergencyResourceServiceCases.previousPointId })
      .from(preventionEmergencyResourceServiceCases)
      .where(and(
        eq(preventionEmergencyResourceServiceCases.resourceId, resource.id),
        eq(preventionEmergencyResourceServiceCases.status, "cancelled"),
      ))
      .orderBy(desc(preventionEmergencyResourceServiceCases.openedAt))
      .limit(1)
    previousPointId = previousCase?.previousPointId ?? null
  }

  await tx.update(preventionEmergencyResources).set({
    status: "needs_maintenance",
    version: resource.version + 1,
    updatedAt: now,
  }).where(eq(preventionEmergencyResources.id, resource.id))

  const caseId = `pemgrsc-${nanoid()}`
  await tx.insert(preventionEmergencyResourceServiceCases).values({
    id: caseId,
    resourceId: resource.id,
    previousPointId,
    requestItemId: input.requestItemId,
    openedByUserId: input.actorUserId,
  })
  await tx.insert(preventionEmergencyResourceEvents).values({
    id: `pemgrev-${nanoid()}`,
    worksiteId: resource.worksiteId,
    resourceId: resource.id,
    eventType: "service_requested",
    actorUserId: input.actorUserId,
    sourceType: "purchase_request_item",
    sourceId: input.requestItemId,
    notes: "Solicitud de recarga enviada; la asignación vigente terminó.",
    snapshot: { previousPointId, previousStatus: resource.status },
  })
  return { caseId, previousPointId }
}

export interface EmergencyServiceCertificate {
  fileName: string
  filePath: string
  fileSize?: number | null
  mimeType?: string | null
}

/** Cierra el caso administrativo sin alterar el estado ni reconstruir cobertura. */
export async function cancelEmergencyResourceServiceCaseTx(tx: Tx, input: {
  requestItemId: string
  actorUserId: string
  reason: string
}) {
  const [serviceCase] = await tx.select().from(preventionEmergencyResourceServiceCases)
    .where(and(
      eq(preventionEmergencyResourceServiceCases.requestItemId, input.requestItemId),
      eq(preventionEmergencyResourceServiceCases.status, "open"),
    )).for("update").limit(1)
  if (!serviceCase) return { cancelled: false as const }

  await tx.update(preventionEmergencyResourceServiceCases).set({ status: "cancelled" })
    .where(eq(preventionEmergencyResourceServiceCases.id, serviceCase.id))
  // Deliberadamente no cambia el activo ni su asignación: cancelar/rechazar la
  // compra no acredita mantención y la brecha sigue crítica hasta reemplazarlo.
  void input.actorUserId
  void input.reason
  return { cancelled: true as const, caseId: serviceCase.id }
}

export async function completeEmergencyResourceServiceCaseTx(tx: Tx, input: {
  requestItemId: string
  receiptItemId: string
  actorUserId: string
  maintenanceDate: string
  nextExpiryDate: string
  certificate?: EmergencyServiceCertificate | null
}) {
  const [serviceCase] = await tx.select().from(preventionEmergencyResourceServiceCases)
    .where(and(
      eq(preventionEmergencyResourceServiceCases.requestItemId, input.requestItemId),
      eq(preventionEmergencyResourceServiceCases.status, "open"),
    )).for("update").limit(1)
  if (!serviceCase) throw new Error("No existe un caso de recarga abierto para esta línea.")

  const [resource] = await tx.select().from(preventionEmergencyResources)
    .where(eq(preventionEmergencyResources.id, serviceCase.resourceId))
    .for("update").limit(1)
  if (!resource) throw new Error("El activo asociado a la recarga ya no existe.")

  const now = new Date().toISOString()
  await tx.update(preventionEmergencyResources).set({
    status: "operational",
    lastMaintenanceAt: input.maintenanceDate,
    expiresAt: input.nextExpiryDate,
    version: resource.version + 1,
    updatedAt: now,
  }).where(eq(preventionEmergencyResources.id, resource.id))

  let restoredPointId: string | null = null
  if (serviceCase.previousPointId) {
    const [point] = await tx.select().from(preventionEmergencyResourcePoints)
      .where(eq(preventionEmergencyResourcePoints.id, serviceCase.previousPointId))
      .for("update").limit(1)
    if (point
      && point.isActive
      && point.worksiteId === resource.worksiteId
      && point.requiredTypeId !== null
      && point.requiredTypeId === resource.typeId
    ) {
      const [replacement] = await tx.select({ id: preventionEmergencyResourceAssignments.id })
        .from(preventionEmergencyResourceAssignments)
        .where(and(
          eq(preventionEmergencyResourceAssignments.pointId, point.id),
          isNull(preventionEmergencyResourceAssignments.unassignedAt),
        )).limit(1)
      if (!replacement) {
        await tx.insert(preventionEmergencyResourceAssignments).values({
          id: `pemgra-${nanoid()}`,
          pointId: point.id,
          resourceId: resource.id,
          actorUserId: input.actorUserId,
          reason: "Restauración tras recepción final conforme",
        })
        restoredPointId = point.id
      }
    }
  }

  await tx.update(preventionEmergencyResourceServiceCases).set({
    status: "completed",
    completedReceiptItemId: input.receiptItemId,
    completedByUserId: input.actorUserId,
    completedAt: now,
  }).where(eq(preventionEmergencyResourceServiceCases.id, serviceCase.id))
  await tx.insert(preventionEmergencyResourceEvents).values({
    id: `pemgrev-${nanoid()}`,
    worksiteId: resource.worksiteId,
    resourceId: resource.id,
    eventType: "service_completed",
    actorUserId: input.actorUserId,
    sourceType: "receipt_item",
    sourceId: input.receiptItemId,
    notes: restoredPointId
      ? "Recarga completada y punto anterior restaurado."
      : "Recarga completada; activo operativo y disponible sin asignación.",
    snapshot: {
      maintenanceDate: input.maintenanceDate,
      nextExpiryDate: input.nextExpiryDate,
      restoredPointId,
    },
  })

  if (input.certificate) {
    await tx.insert(attachments).values({
      id: `att-${nanoid()}`,
      entityType: "prevention_emergency_resource_service_case",
      entityId: serviceCase.id,
      fileName: input.certificate.fileName,
      filePath: input.certificate.filePath,
      fileSize: input.certificate.fileSize ?? null,
      mimeType: input.certificate.mimeType ?? null,
      uploadedBy: input.actorUserId,
    })
  }
  return { caseId: serviceCase.id, resourceId: resource.id, restoredPointId }
}
