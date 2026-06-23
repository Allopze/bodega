/**
 * Borrado permanente de solicitudes de compra.
 * Solo aplica a solicitudes que nunca ingresaron al flujo de compra/recepción.
 *
 * NOTE: las constantes/tipos puros viven en requests-delete.constants.ts para
 * que los Client Components puedan importarlos sin arrastrar node:fs al bundle.
 */

import fs from "node:fs/promises"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  approvalDecisions,
  repuestoQuotations,
  serviceQuotations,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import {
  resolveQuotationAttachmentFile,
  resolveServiceQuotationFile,
} from "@/lib/storage/config"

import {
  isRequestDeletable,
} from "@/lib/services/requests-delete.constants"

export {
  DELETABLE_REQUEST_STATUSES,
  isRequestDeletable,
} from "@/lib/services/requests-delete.constants"
export type { DeletableRequestStatus } from "@/lib/services/requests-delete.constants"

interface DeleteRequestOpts {
  userEmail?: string
}

/**
 * Elimina permanentemente una solicitud y toda su data dependiente.
 * Limpia además los archivos PDF de cotizaciones del disco (best-effort).
 */
export async function deleteRequest(
  requestId: string,
  userId: string,
  opts?: DeleteRequestOpts,
): Promise<void> {
  // Pre-fetch file paths antes de la transacción para limpiar disco después
  const [repuestoFiles, servicioFiles] = await Promise.all([
    db
      .select({ filePath: repuestoQuotations.filePath })
      .from(repuestoQuotations)
      .where(eq(repuestoQuotations.requestId, requestId)),
    db
      .select({ filePath: serviceQuotations.filePath })
      .from(serviceQuotations)
      .where(eq(serviceQuotations.requestId, requestId)),
  ])

  // R-25: Pre-fetch file paths before transaction for disk cleanup after commit.
  // The status check and deletion happen inside the transaction to close
  // the TOCTOU window (status could change between read and delete).
  const [repuestoFiles, servicioFiles] = await Promise.all([
    db.select({ filePath: repuestoQuotations.filePath })
      .from(repuestoQuotations)
      .where(eq(repuestoQuotations.requestId, requestId)),
    db.select({ filePath: serviceQuotations.filePath })
      .from(serviceQuotations)
      .where(eq(serviceQuotations.requestId, requestId)),
  ])

  await db.transaction(async (tx) => {
    // 1. Read request INSIDE the transaction to avoid TOCTOU
    const request = await tx.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, requestId),
      columns: { id: true, code: true, status: true, requestType: true, worksiteId: true, requesterId: true },
    })
    if (!request) throw new Error("Solicitud no encontrada")
    if (!isRequestDeletable(request.status)) {
      throw new Error(`No se puede eliminar una solicitud en estado '${request.status}'`)
    }

    // 2. Obtener todos los request item IDs para limpiar approvalDecisions
    const items = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.requestId, requestId))

    const itemIds = items.map((i) => i.id)

    // 3. Eliminar approvalDecisions (FK sin cascade referencia requestId e itemId)
    if (itemIds.length > 0) {
      await tx.delete(approvalDecisions).where(inArray(approvalDecisions.requestItemId, itemIds))
    }
    await tx.delete(approvalDecisions).where(eq(approvalDecisions.requestId, requestId))

    // 4. Eliminar la solicitud — cascade borra items, attributes, quotations
    const [{ rowCount }] = await tx
      .delete(purchaseRequests)
      .where(eq(purchaseRequests.id, requestId))
      .returning({ rowCount: purchaseRequests.id })

    // 5. Verify deletion occurred (paranoid check)
    if (!rowCount) throw new Error("La solicitud fue modificada concurrentemente")

    // 6. Auditoría (entityId string sobrevive al borrado)
    await recordAudit(
      {
        userId,
        userEmail:  opts?.userEmail,
        action:     "delete",
        entityType: "purchase_request",
        entityId:   requestId,
        entityCode: request.code,
        oldState:   { status: request.status, requestType: request.requestType },
      },
      tx,
    )
  })

  // 5. Limpiar archivos del disco (best-effort, no falla la operación si ya no existen)
  const filePaths = [
    ...repuestoFiles.map((f) => resolveQuotationAttachmentFile(f.filePath)),
    ...servicioFiles.map((f) => resolveServiceQuotationFile(f.filePath)),
  ]
  await Promise.all(
    filePaths.map((p) => (p ? fs.unlink(p).catch(() => undefined) : Promise.resolve())),
  )
}
