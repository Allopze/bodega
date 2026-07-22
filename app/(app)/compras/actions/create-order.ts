"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { createOrdersBySupplier } from "@/lib/services/purchasing"
import { logger } from "@/lib/logger"
import { createOrderSchema, type ActionState } from "@/lib/validation/operations"
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

  for (const item of items) {
    const dbItem = dbItemMap.get(item.requestItemId)
    if (!dbItem || !["approved", "pending_purchase"].includes(dbItem.status)) {
      return { ok: false, message: "Solo se pueden comprar ítems aprobados pendientes" }
    }
    if (dbItem.request.worksiteId !== worksiteId || !canAccessWorksite(session, dbItem.request.worksiteId)) {
      return { ok: false, message: "La orden contiene ítems de una faena no autorizada" }
    }
    if (item.quantity !== dbItem.quantity) {
      return { ok: false, message: `La orden debe comprar la cantidad aprobada completa (${dbItem.quantity})` }
    }
    if (item.quantity <= 0) {
      return { ok: false, message: "La cantidad de compra debe ser mayor a 0" }
    }
  }

  const deliveryModes = new Set(dbItems.map((i) => i.request.deliveryMode))
  if (deliveryModes.size > 1) {
    return {
      ok: false,
      message:
        "Los ítems seleccionados pertenecen a solicitudes con modo de despacho distinto. Crea órdenes separadas.",
    }
  }
  const deliveryMode = (deliveryModes.values().next().value ?? "via_oficina") as "via_oficina" | "directo_faena"

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
  if (activeSuppliers.length !== targetSupplierIds.length) {
    return { ok: false, message: "Uno o más proveedores no están activos o no existen" }
  }
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
      createdBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      paymentTerms: paymentTerms || null,
      estimatedDelivery: estimatedDelivery || null,
      deliveryAddress: deliveryAddress || null,
      notes: notes || null,
      deliveryMode,
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

    revalidatePath(REVALIDATE)
    if (orderIds.length === 1) redirect(`/compras/${orderIds[0]}`)
    redirect(`${REVALIDATE}?creadas=${orderIds.length}`)
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
    logger.error("[createOrderAction]", e)
    return { ok: false, message: dbErrMsg(e, "Error al crear la orden") }
  }
}
