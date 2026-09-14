import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { mkdirp, writeBuffer, removeFile } from "@/lib/storage/helpers"
import path from "node:path"
import type { RequestModuleConfig, AddQuotationInput } from "../request-config"
import { resolveStorageFile } from "@/lib/storage/config"
import { QUOTATION_EXTENSION_BY_MIME, QUOTATION_SERVABLE_MIME_TYPES } from "@/lib/storage/quotation-content-type"

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
  if (request.status !== "draft") {
    throw new Error("Solo se pueden agregar cotizaciones a solicitudes en borrador")
  }

  const dir = config.storage.dir()
  await mkdirp(dir)

  /*
   * COT-004 (auditoría 2026-09-14): la extensión interna sale del MIME que la
   * validación por bytes mágicos declaró, no del nombre que mandó el cliente.
   * Antes un PNG llamado "oferta.pdf" se guardaba como `.pdf` y se servía como
   * PDF; y al revés, un PDF sin extensión terminaba en binario genérico. El
   * nombre original se conserva íntegro en `fileName` para la descarga.
   */
  const declaredMime = input.mimeType?.trim() || null
  // Sólo se persiste un tipo del catálogo aceptado: un caller que mande otra
  // cosa deja la fila como legacy (MIME nulo) en vez de guardar algo que la
  // descarga no debería servir en línea.
  const validatedMime = declaredMime && QUOTATION_SERVABLE_MIME_TYPES.has(declaredMime) ? declaredMime : null
  const ext = (validatedMime ? QUOTATION_EXTENSION_BY_MIME[validatedMime] : undefined)
    ?? (path.extname(input.fileName) || ".pdf")
  const storageName = `${nanoid()}${ext}`
  const absolutePath = resolveStorageFile(dir, storageName)
  await writeBuffer(absolutePath, input.fileBuffer)

  const filePath = config.storage.createPath(storageName)
  const quotationId = nanoid()

  try {
    // Insert y auditoría en una transacción, y el estado `draft` re-verificado
    // bajo lock adentro: el pre-check de arriba corre fuera de la transacción,
    // así que entre ese chequeo y el insert la solicitud podía enviarse y quedaba
    // una cotización `pending` colgando de una solicitud ya enviada.
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: purchaseRequests.status })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, input.requestId))
        .for("update")
      if (!locked || locked.status !== "draft") {
        throw new Error("Solo se pueden agregar cotizaciones a solicitudes en borrador")
      }

      await tx.insert(qt).values({
        id:               quotationId,
        requestId:        input.requestId,
        supplierId:       input.supplierId ?? null,
        supplierNameFree: input.supplierNameFree ?? null,
        fileName:         input.fileName,
        filePath,
        fileSize:         input.fileSize ? String(input.fileSize) : null,
        // COT-004: el MIME autoritativo se persiste; la descarga lo devuelve
        // tal cual en vez de adivinarlo por la extensión de la ruta.
        mimeType:         validatedMime,
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
      }, tx)
    })
  } catch (err) {
    await removeFile(absolutePath).catch(() => { /* ignore */ })
    throw err
  }

  return quotationId
}
