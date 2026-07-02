import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { removeFile } from "@/lib/storage/helpers"
import { assertCanDeleteQuotation } from "../quotation-access"
import type { RequestModuleConfig, DeleteQuotationInput } from "../request-config"

export async function deleteQuotation(
  config: Pick<RequestModuleConfig, "quotationsTable" | "quotationEntityType" | "storage">,
  input: DeleteQuotationInput,
): Promise<void> {
  const qt = config.quotationsTable
  const [quotation] = await db.select().from(qt).where(eq(qt.id, input.quotationId)).limit(1)
  if (!quotation) throw new Error("Cotización no encontrada")
  if (quotation.status !== "pending") {
    throw new Error("Solo se pueden eliminar cotizaciones pendientes")
  }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, quotation.requestId),
    columns: { id: true, status: true, requesterId: true, worksiteId: true },
  })
  if (!request || !["draft", "returned"].includes(request.status)) {
    throw new Error("La solicitud ya no es editable")
  }
  assertCanDeleteQuotation({
    session: input.session,
    request,
    quotation,
    expectedRequestId: input.expectedRequestId,
    elevatedPermission: input.elevatedPermission,
  })

  await db.delete(qt).where(eq(qt.id, input.quotationId))

  const absolutePath = config.storage.resolveFile(quotation.filePath)
  if (absolutePath) {
    await removeFile(absolutePath).catch(() => { /* ignore */ })
  }

  await recordAudit({
    userId:     input.session.user.id,
    userEmail:  input.userEmail,
    action:     "delete",
    entityType: config.quotationEntityType,
    entityId:   input.quotationId,
    oldState:   { requestId: quotation.requestId, fileName: quotation.fileName },
  })
}
