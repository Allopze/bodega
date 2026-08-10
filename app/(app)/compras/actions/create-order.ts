"use server"

import { redirect, unstable_rethrow } from "next/navigation"
import { db } from "@/db"
import { canAccessWorksite, requirePermission, visibleWorksiteIds } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { createOrdersBySupplier } from "@/lib/services/purchasing"
import { logger } from "@/lib/logger"
import { createOrderSchema, type ActionState } from "@/lib/validation/operations"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { dbErrMsg } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function createOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("purchasing:create_order")
  } catch {
    return { ok: false, message: "Sin permisos para crear órdenes de compra" }
  }

  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse((formData.get("itemsJson") as string) ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems", fieldErrors: { items: ["Formato de ítems inválido"] } }
  }

  const parsed = createOrderSchema.safeParse({
    worksiteId: formData.get("worksiteId"),
    supplierId: formData.get("supplierId"),
    paymentTerms: formData.get("paymentTerms"),
    estimatedDelivery: formData.get("estimatedDelivery"),
    deliveryAddress: formData.get("deliveryAddress"),
    notes: formData.get("notes"),
    items: itemsRaw,
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

  const { worksiteId, supplierId, paymentTerms, estimatedDelivery, deliveryAddress, notes, items } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  const itemIds = [...new Set(items.flatMap((item) => (item.requestItemId ? [item.requestItemId] : [])))]
  if (itemIds.length !== items.length) {
    return { ok: false, message: "Hay ítems duplicados o inválidos en la orden" }
  }

  const dbItems = await db.query.purchaseRequestItems.findMany({
    where: (item, { inArray }) => inArray(item.id, itemIds),
    with: { request: true },
  })
  if (dbItems.length !== items.length) {
    return { ok: false, message: "Uno o más ítems ya no están disponibles para compra" }
  }

  const dbItemMap = new Map(dbItems.map((item) => [item.id, item]))

  // Pre-check barato para un error rápido sin abrir la transacción; el valor
  // real que se persiste lo deriva `createOrdersBySupplier` de las
  // solicitudes ya lockeadas (DAT-14) — este chequeo puede quedar obsoleto
  // entre esta lectura y la transacción, y eso está bien: el servicio vuelve
  // a validar bajo lock y rechaza igual si algo cambió.
  const deliveryModes = new Set(dbItems.map((i) => i.request.deliveryMode))
  if (deliveryModes.size > 1) {
    return {
      ok: false,
      message:
        "Los ítems seleccionados pertenecen a solicitudes con modo de despacho distinto. Crea órdenes separadas.",
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
    where: (supplier, { and, eq, inArray }) => and(inArray(supplier.id, targetSupplierIds), eq(supplier.isActive, true)),
  })
  const supplierNameMap = new Map(activeSuppliers.map((s) => [s.id, s.name]))

  // Warn if an item's resolved supplier differs from its suggested supplier
  // without an explicit per-item override by the user.
  const supplierMismatches: string[] = []
  for (const item of items) {
    const dbItem = dbItemMap.get(item.requestItemId)
    if (!dbItem?.suggestedSupplierId || item.isSupplierOverride) continue
    const targetSupplierId = supplierIdsByItem.get(item.requestItemId)!
    if (dbItem.suggestedSupplierId !== targetSupplierId) {
      const suggestedName = supplierNameMap.get(dbItem.suggestedSupplierId) ?? dbItem.suggestedSupplierId
      const actualName = supplierNameMap.get(targetSupplierId) ?? targetSupplierId
      const productName = dbItem.productNameFree ?? `(producto ${item.productId ?? item.requestItemId})`
      supplierMismatches.push(
        `"${productName}": sugerido ${suggestedName}, asignado ${actualName}`
      )
    }
  }

  if (supplierMismatches.length > 0) {
    return {
      ok: false,
      message: `Hay ítems con proveedor distinto al sugerido. Revisa la asignación o usa el selector por ítem para forzar un cambio explícito:
${supplierMismatches.map((m) => `  • ${m}`).join("\n")}`,
    }
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
      worksiteScope: isGlobalRole(session) ? "all" : visibleWorksiteIds(session),
      createdBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      paymentTerms: paymentTerms || null,
      estimatedDelivery: estimatedDelivery || null,
      deliveryAddress: deliveryAddress || null,
      notes: notes || null,
      orders: [...groups.entries()].map(([groupSupplierId, groupItems]) => ({
        supplierId: groupSupplierId,
        items: groupItems.map((item, i) => ({
          requestItemId: item.requestItemId,
          productId: item.productId ?? null,
          productNameFree: item.productNameFree ?? null,
          quantity: item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          unitPrice: item.unitPrice,
          discount: item.discount ?? 0,
          notes: item.notes ?? null,
          sortOrder: i,
        })),
      })),
    })

    revalidateOperationalViews([REVALIDATE, "/compras/nueva"])
    if (orderIds.length === 1) redirect(`/compras/${orderIds[0]}?actualizada=creada`)
    redirect(`${REVALIDATE}?creadas=${orderIds.length}`)
  } catch (e) {
    // `unstable_rethrow` reconoce los errores de control de flujo de Next por su
    // digest, no por el texto del mensaje: con el match por `"NEXT_REDIRECT"`,
    // un cambio de formato haría que este catch se tragara el redirect con la OC
    // ya creada — el usuario vería "Error al crear la orden", reintentaría y
    // quedarían dos.
    unstable_rethrow(e)
    logger.error("[createOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al crear la orden") }
  }
}
