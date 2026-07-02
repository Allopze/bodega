import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { mkdirp, writeBuffer, removeFile } from "@/lib/storage/helpers"
import path from "node:path"
import type { RequestModuleConfig, AddQuotationInput } from "../request-config"

export async function addQuotation(
  config: Pick<RequestModuleConfig, "requestType" | "quotationsTable" | "quotationEntityType" | "storage">,
  input: AddQuotationInput,
): Promise<string> {
  const now = new Date().toISOString()
  const qt = config.quotationsTable

  const request = await db.query.purchaseRequests.findFirst({
    where: and(
      eq(purchaseRequests.id, input.requestId),
      eq(purchaseRequests.requestType, config.requestType),
    ),
    columns: { id: true, status: true, requesterId: true },
  })
  if (!request) throw new Error(`Solicitud de ${config.requestType === "repuestos" ? "repuestos" : "servicios"} no encontrada`)
  if (!["draft", "returned"].includes(request.status)) {
    throw new Error("Solo se pueden agregar cotizaciones a solicitudes en borrador o devueltas")
  }

  const dir = config.storage.dir()
  await mkdirp(dir)

  const ext = path.extname(input.fileName) || ".pdf"
  const storageName = `${nanoid()}${ext}`
  const absolutePath = path.join(/*turbopackIgnore: true*/ dir, storageName)
  await writeBuffer(absolutePath, input.fileBuffer)

  const filePath = config.storage.createPath(storageName)
  const quotationId = nanoid()

  try {
    await db.insert(qt).values({
      id:               quotationId,
      requestId:        input.requestId,
      supplierId:       input.supplierId ?? null,
      supplierNameFree: input.supplierNameFree ?? null,
      fileName:         input.fileName,
      filePath,
      fileSize:         input.fileSize ? String(input.fileSize) : null,
      uploadedBy:       input.uploadedBy,
      totalAmount:      input.totalAmount,
      status:           "pending",
      notes:            input.notes ?? null,
      decidedBy:        null,
      selectedAt:       null,
      createdAt:        now,
      updatedAt:        now,
    })

    await recordAudit({
      userId:     input.uploadedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: config.quotationEntityType,
      entityId:   quotationId,
      newState:   {
        requestId:   input.requestId,
        totalAmount: input.totalAmount,
        fileName:    input.fileName,
      },
    })
  } catch (err) {
    await removeFile(absolutePath).catch(() => { /* ignore */ })
    throw err
  }

  return quotationId
}
