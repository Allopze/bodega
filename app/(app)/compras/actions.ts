"use server"

import { redirect }     from "next/navigation"
import { revalidatePath } from "next/cache"
import { promises as fs } from "node:fs"
import path from "node:path"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrderInvoices, purchaseOrders, purchaseRequestItems, purchaseRequests, suppliers, worksites } from "@/db/schema"
import { count, eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { createOrdersBySupplier, issueOrder, markOrderSent, cancelOrder, createPurchaseOrderInvoice, deletePurchaseOrderInvoice } from "@/lib/services/purchasing"
import { postponeItem } from "@/lib/services/item-state"
import { getUserIdsWithPermission, notifyManyUser } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import { nanoid } from "@/lib/id"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { createInvoiceAttachmentPath, resolvePurchaseOrdersDir } from "@/lib/storage/config"
import { createOrderSchema, invoiceSchema, type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/compras"

const ALLOWED_INVOICE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/xml",
  "text/xml",
])

// ── Create OC ─────────────────────────────────────────────────────────────────

export async function createOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos para crear órdenes de compra" } }

  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems", fieldErrors: { items: ["Formato de ítems inválido"] } }
  }

  const parsed = createOrderSchema.safeParse({
    worksiteId:        formData.get("worksiteId"),
    supplierId:        formData.get("supplierId"),
    paymentTerms:      formData.get("paymentTerms"),
    estimatedDelivery: formData.get("estimatedDelivery"),
    deliveryAddress:   formData.get("deliveryAddress"),
    notes:             formData.get("notes"),
    items:             itemsRaw,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de la orden",
      fieldErrors: {
        ...flattened.fieldErrors,
        items: flattened.fieldErrors.items ?? flattened.formErrors,
      },
    }
  }

  const {
    worksiteId,
    supplierId,
    paymentTerms,
    estimatedDelivery,
    deliveryAddress,
    notes,
    items,
  } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  const itemIds = [...new Set(items.map((item) => item.requestItemId).filter(Boolean))]
  if (itemIds.length !== items.length) {
    return { ok: false, message: "Hay ítems duplicados o inválidos en la orden" }
  }

  const dbItems = await db.query.purchaseRequestItems.findMany({
    where: (item, { inArray }) => inArray(item.id, itemIds),
    with:  { request: true },
  })
  if (dbItems.length !== items.length) {
    return { ok: false, message: "Uno o más ítems ya no están disponibles para compra" }
  }

  const dbItemMap = new Map(dbItems.map((item) => [item.id, item]))

  for (const item of items) {
    const dbItem = dbItemMap.get(item.requestItemId)
    if (!dbItem || !["approved", "pending_purchase"].includes(dbItem.status)) {
      return { ok: false, message: "Solo se pueden comprar ítems aprobados pendientes" }
    }
    if (dbItem.request.worksiteId !== worksiteId || !canAccessWorksite(session, dbItem.request.worksiteId)) {
      return { ok: false, message: "La orden contiene ítems de una faena no autorizada" }
    }
    if (item.quantity > dbItem.quantity) {
      return { ok: false, message: `La cantidad de compra (${item.quantity}) no puede superar la cantidad aprobada (${dbItem.quantity})` }
    }
    if (item.quantity <= 0) {
      return { ok: false, message: "La cantidad de compra debe ser mayor a 0" }
    }
  }

  const supplierIdsByItem = new Map<string, string>()
  for (const item of items) {
    const dbItem = dbItemMap.get(item.requestItemId)
    const targetSupplierId = item.supplierId || dbItem?.suggestedSupplierId || supplierId
    if (!targetSupplierId) {
      return { ok: false, message: "Cada ítem debe tener un proveedor asignado" }
    }
    supplierIdsByItem.set(item.requestItemId, targetSupplierId)
  }

  const targetSupplierIds = [...new Set(supplierIdsByItem.values())]
  const activeSuppliers = await db.query.suppliers.findMany({
    where: (supplier, { and, eq, inArray }) => and(
      inArray(supplier.id, targetSupplierIds),
      eq(supplier.isActive, true),
    ),
  })
  if (activeSuppliers.length !== targetSupplierIds.length) {
    return { ok: false, message: "Uno o más proveedores no están activos o no existen" }
  }

  const groups = new Map<string, typeof items>()
  for (const item of items) {
    const targetSupplierId = supplierIdsByItem.get(item.requestItemId)!
    const supplierItems = groups.get(targetSupplierId) ?? []
    supplierItems.push(item)
    groups.set(targetSupplierId, supplierItems)
  }

  try {
    const orderIds = await createOrdersBySupplier({
      worksiteId,
      createdBy:          session.user.id,
      userEmail:          session.user.email ?? undefined,
      paymentTerms:       paymentTerms || null,
      estimatedDelivery:  estimatedDelivery || null,
      deliveryAddress:    deliveryAddress || null,
      notes:              notes || null,
      orders: [...groups.entries()].map(([groupSupplierId, groupItems]) => ({
        supplierId: groupSupplierId,
        items: groupItems.map((item, i) => ({
          requestItemId:   item.requestItemId,
          productId:       item.productId ?? null,
          productNameFree: item.productNameFree ?? null,
          quantity:        item.quantity,
          unitOfMeasure:   item.unitOfMeasure,
          unitPrice:       item.unitPrice,
          discount:        item.discount ?? 0,
          notes:           item.notes ?? null,
          sortOrder:       i,
        })),
      })),
    })

    revalidatePath(REVALIDATE)
    if (orderIds.length === 1) redirect(`/compras/${orderIds[0]}`)
    redirect(`${REVALIDATE}?creadas=${orderIds.length}`)
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
    logger.error("[createOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al crear la orden" }
  }
}

// ── Issue OC (draft → issued) ─────────────────────────────────────────────────

export async function issueOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos" } }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await issueOrder(orderId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })
  } catch (e) {
    logger.error("[issueOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al emitir orden" }
  }
  redirect(`/compras/${orderId}?actualizada=emitida`)
}

// ── Mark as sent (issued → sent) ──────────────────────────────────────────────

export async function sendOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para enviar órdenes" } }

  const orderId = formData.get("orderId") as string | null
  if (!orderId) return { ok: false, message: "Orden no especificada" }
  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    const [[orderSummary], [itemCountRow]] = await Promise.all([
      db
        .select({
          code:         purchaseOrders.code,
          worksiteName: worksites.name,
          supplierName: suppliers.name,
        })
        .from(purchaseOrders)
        .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
        .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(eq(purchaseOrders.id, orderId)),
      db
        .select({ n: count() })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, orderId)),
    ])

    await markOrderSent(orderId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })

    void getUserIdsWithPermission("receiving:register_office").then((receiverIds) =>
      notifyManyUser(receiverIds, {
        type:       "oc_sent",
        title:      `OC lista para recepción: ${orderSummary?.code ?? "Orden enviada"}`,
        body:       `${orderSummary?.worksiteName ?? "Faena"} · ${itemCountRow?.n ?? 0} ítem${(itemCountRow?.n ?? 0) === 1 ? "" : "s"} enviado${(itemCountRow?.n ?? 0) === 1 ? "" : "s"} al proveedor${orderSummary?.supplierName ? ` ${orderSummary.supplierName}` : ""}.`,
        entityType: "purchase_order",
        entityId:   orderId,
        entityHref: `/recepcion/nueva?oc=${orderId}`,
      }),
    )

  } catch (e) {
    logger.error("[sendOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al enviar orden" }
  }
  redirect(`/compras/${orderId}?actualizada=enviada`)
}

// ── File helpers ───────────────────────────────────────────────────────────────

type InvoiceAttachment = {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

async function persistInvoiceFile(value: FormDataEntryValue | null): Promise<
  | { ok: true; attachment: InvoiceAttachment | null; absolutePath?: string }
  | { ok: false; message: string }
> {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: true, attachment: null }
  }

  if (!ALLOWED_INVOICE_TYPES.has(value.type)) {
    return { ok: false, message: "La factura debe ser PDF, JPG, PNG o XML" }
  }

  const maxMb = await getPdfMaxSizeMb()
  const maxBytes = maxMb * 1024 * 1024
  if (value.size > maxBytes) {
    return { ok: false, message: `El archivo supera el límite de ${maxMb} MB` }
  }

  const safeName = sanitizeFileName(value.name || "factura")
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolvePurchaseOrdersDir()
  const relativePath = createInvoiceAttachmentPath(storageName)
  const absolutePath = path.join(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(await value.arrayBuffer()))

  return {
    ok: true,
    absolutePath,
    attachment: {
      fileName: safeName,
      filePath: relativePath,
      fileSize: value.size,
      mimeType: value.type,
    },
  }
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "factura"
}

async function assertOrderAccess(session: Awaited<ReturnType<typeof requirePermission>>, orderId: string): Promise<ActionState | null> {
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, orderId),
  })
  if (!order) return { ok: false, message: "Orden no encontrada" }
  if (!canAccessWorksite(session, order.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta orden" }
  }
  return null
}

// ── Postpone item ─────────────────────────────────────────────────────────────

export async function postponeItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos" } }

  const itemId = formData.get("itemId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!itemId) return { ok: false, message: "Ítem no especificado" }
  if (!reason) return { ok: false, message: "El motivo de postergación es obligatorio" }

  const item = await db
    .select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      worksiteId: purchaseRequests.worksiteId,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(eq(purchaseRequestItems.id, itemId))
    .then((rows) => rows[0])

  if (!item) return { ok: false, message: "Ítem no encontrado" }
  if (!["approved", "pending_purchase"].includes(item.status)) {
    return { ok: false, message: "Solo se pueden postergar ítems aprobados pendientes de compra" }
  }
  if (!canAccessWorksite(session, item.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de este ítem" }
  }

  const orderLink = await db.query.purchaseOrderItems.findFirst({
    where: eq(purchaseOrderItems.requestItemId, itemId),
  })
  if (orderLink) {
    return { ok: false, message: "No se puede postergar un ítem que ya está en una OC" }
  }

  try {
    await postponeItem(itemId, session.user.id, reason, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ítem postergado" }
  } catch (e) {
    logger.error("[postponeItemAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al postergar ítem" }
  }
}

// ── Add Invoice ───────────────────────────────────────────────────────────────

export async function addInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para adjuntar facturas" } }

  const parsed = invoiceSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    invoiceNumber:   formData.get("invoiceNumber"),
    amount:          formData.get("amount"),
    issueDate:       formData.get("issueDate"),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la factura",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { purchaseOrderId, invoiceNumber, amount, issueDate } = parsed.data

  const accessError = await assertOrderAccess(session, purchaseOrderId)
  if (accessError) return accessError

  const fileResult = await persistInvoiceFile(formData.get("file"))
  if (!fileResult.ok) return { ok: false, message: fileResult.message }

  if (!fileResult.attachment) {
    return { ok: false, message: "El archivo de la factura es obligatorio" }
  }

  try {
    await createPurchaseOrderInvoice({
      purchaseOrderId,
      invoiceNumber,
      amount,
      issueDate: issueDate || null,
      fileName:  fileResult.attachment.fileName,
      filePath:  fileResult.attachment.filePath,
      fileSize:  fileResult.attachment.fileSize,
      mimeType:  fileResult.attachment.mimeType,
      uploadedBy: session.user.id,
      userEmail:  session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${purchaseOrderId}`)
    return { ok: true, message: `Factura ${invoiceNumber} adjuntada correctamente` }
  } catch (e) {
    if (fileResult.absolutePath) {
      await fs.unlink(fileResult.absolutePath).catch(() => undefined)
    }
    logger.error("[addInvoiceAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al adjuntar factura" }
  }
}

// ── Delete Invoice ─────────────────────────────────────────────────────────────

export async function deleteInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:send_order") }
  catch { return { ok: false, message: "Sin permisos para eliminar facturas" } }

  const invoiceId = formData.get("invoiceId") as string | null
  const purchaseOrderId = formData.get("purchaseOrderId") as string | null

  if (!invoiceId) return { ok: false, message: "Factura no especificada" }
  if (!purchaseOrderId) return { ok: false, message: "Orden no especificada" }

  // Verify order access before deletion
  const accessError = await assertOrderAccess(session, purchaseOrderId)
  if (accessError) return accessError

  // Verify invoice belongs to this order
  const invoice = await db.query.purchaseOrderInvoices.findFirst({
    where: eq(purchaseOrderInvoices.id, invoiceId),
    columns: { purchaseOrderId: true },
  })
  if (!invoice || invoice.purchaseOrderId !== purchaseOrderId) {
    return { ok: false, message: "Factura no encontrada en esta orden" }
  }

  try {
    const { filePath } = await deletePurchaseOrderInvoice(invoiceId, session.user.id, {
      userEmail: session.user.email ?? undefined,
    })

    // Remove the file from disk (best-effort — don't fail if already gone)
    const { resolveInvoiceAttachmentFile } = await import("@/lib/storage/config")
    const absolutePath = resolveInvoiceAttachmentFile(filePath)
    if (absolutePath) {
      await fs.unlink(absolutePath).catch(() => undefined)
    }

    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${purchaseOrderId}`)
    return { ok: true, message: "Factura eliminada correctamente" }
  } catch (e) {
    logger.error("[deleteInvoiceAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar factura" }
  }
}

// ── Cancel Order (draft/issued/sent → cancelled) ──────────────────────────────

export async function cancelOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { return { ok: false, message: "Sin permisos para anular la orden" } }

  const orderId = formData.get("orderId") as string | null
  const reason = (formData.get("reason") as string | null)?.trim()

  if (!orderId) return { ok: false, message: "Orden no especificada" }
  if (!reason) return { ok: false, message: "El motivo de anulación es obligatorio" }

  const accessError = await assertOrderAccess(session, orderId)
  if (accessError) return accessError

  try {
    await cancelOrder(orderId, session.user.id, reason, {
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath(REVALIDATE)
    revalidatePath(`/compras/${orderId}`)
    return { ok: true, message: "Orden de compra anulada correctamente" }
  } catch (e) {
    logger.error("[cancelOrderAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al anular orden" }
  }
}
