import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  products, workers, serviceEquipment, purchaseRequests, preventionEmergencyResources,
  fuelVehicles, mantWorkOrders,
} from "@/db/schema"
import { canAccessWorksite } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listReplenishmentSuggestions } from "@/lib/services/epp-replenishment"
import { logger } from "@/lib/logger"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { vehicleLabel } from "@/lib/services/fleet"
import type { PrefillItem } from "../request-form.types"

/**
 * Ítems con los que se abre el creador. Ningún origen crea nada por su cuenta: la
 * solicitud sólo existe cuando la persona la envía a aprobación.
 *
 * Orígenes, en este orden de prioridad: una OT o un equipo de flota (`?ot=`,
 * `?vehiculo=`, para pedir repuestos), un activo de emergencia, la reposición de
 * Bodega (`?producto=`), la copia de otra solicitud (`?desde=`) y las brechas de
 * EPP de Prevención (`?reposicion=1`).
 */
export interface PrefillResult {
  prefillItems?: PrefillItem[]
  prefillNotice?: string
  /**
   * Faena con la que debe abrirse el creador porque el equipo vinculado es de
   * ella (OT, equipo o copia con equipo). Ya validada contra el alcance de la sesión.
   */
  initialWorksiteId?: string
  /** Urgencia con la que se abre el creador: «alta» al pedir repuestos desde una OT. */
  initialUrgency?: string
  /**
   * El ítem viene de la ficha de un repuesto (`?repuesto=`): la página le pone el
   * precio estimado y el proveedor del catálogo, como al elegirlo del buscador.
   */
  sparePartDefaults?: boolean
}

export interface PrefillRequest {
  session: Session
  reposicion: boolean
  desdeId: string
  productoIds: string[]
  cantidades: string[]
  emergencyResourceId: string
  /** `?ot=`: OT abierta para la que se piden repuestos. */
  workOrderId?: string
  /** `?vehiculo=`: equipo de flota para el que se piden repuestos. */
  vehicleId?: string
  /** `?repuesto=`: repuesto de catálogo con el que se abre el pedido (desde su ficha). */
  sparePartId?: string
}

const OPEN_WORK_ORDER_STATUSES: readonly string[] = OT_OPEN_STATUSES

/**
 * Repuestos para una OT (`?ot=`) o para un equipo (`?vehiculo=`): precarga faena,
 * equipo y OT, y deja la descripción y la cantidad para quien pide. Todo se valida
 * en el servidor aunque el enlace salga de una pantalla con permiso: un id ajeno
 * en la URL no puede abrir el creador en una faena fuera del alcance ni sobre una
 * OT ya cerrada.
 */
async function fleetPrefill({
  session, workOrderId, vehicleId,
}: { session: Session; workOrderId: string; vehicleId: string }): Promise<PrefillResult> {
  if (workOrderId) {
    const [order] = await db
      .select({
        id: mantWorkOrders.id,
        folio: mantWorkOrders.folio,
        status: mantWorkOrders.status,
        orderWorksiteId: mantWorkOrders.worksiteId,
        vehicleId: fuelVehicles.id,
        code: fuelVehicles.code,
        plate: fuelVehicles.plate,
        isActive: fuelVehicles.isActive,
        vehicleWorksiteId: fuelVehicles.worksiteId,
      })
      .from(mantWorkOrders)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
      .where(eq(mantWorkOrders.id, workOrderId))
      .limit(1)
    if (
      !order
      || !OPEN_WORK_ORDER_STATUSES.includes(order.status)
      || !canAccessWorksite(session, order.orderWorksiteId)
      || !canAccessWorksite(session, order.vehicleWorksiteId)
    ) {
      return { prefillNotice: "La OT no existe, está cerrada o está fuera de tus faenas." }
    }
    if (!order.isActive) return { prefillNotice: "El equipo de la OT está dado de baja y no admite pedidos de repuestos." }

    const label = vehicleLabel(order)
    return {
      // La faena del equipo manda sobre la de la OT: es la que el servidor revalida.
      initialWorksiteId: order.vehicleWorksiteId,
      initialUrgency: "high",
      prefillItems: [{
        productId: null, productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency: "high", notes: "",
        vehicleId: order.vehicleId, vehicleLabel: label, workOrderId: order.id, workOrderFolio: order.folio,
      }],
      prefillNotice: `Repuestos para la OT ${order.folio} · ${label}. Completa la descripción y la cantidad.`,
    }
  }

  const [vehicle] = await db
    .select({
      id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate,
      isActive: fuelVehicles.isActive, worksiteId: fuelVehicles.worksiteId,
    })
    .from(fuelVehicles)
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!vehicle || !canAccessWorksite(session, vehicle.worksiteId)) {
    return { prefillNotice: "El equipo no existe o está fuera de tus faenas." }
  }
  if (!vehicle.isActive) return { prefillNotice: "El equipo está dado de baja y no admite pedidos de repuestos." }

  const label = vehicleLabel(vehicle)
  return {
    initialWorksiteId: vehicle.worksiteId,
    prefillItems: [{
      productId: null, productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency: "normal", notes: "",
      vehicleId: vehicle.id, vehicleLabel: label, workOrderId: null, workOrderFolio: null,
    }],
    prefillNotice: `Repuestos para el equipo ${label}. Completa la descripción y la cantidad.`,
  }
}

/**
 * «Pedir repuestos» desde la ficha de un repuesto (`?repuesto=`): el pedido abre
 * con ese repuesto elegido. Sólo un repuesto de catálogo activo; uno desactivado
 * o un producto común no se precarga.
 */
async function sparePartPrefill(sparePartId: string): Promise<PrefillResult> {
  const [part] = await db
    .select({
      id: products.id, name: products.name, unitOfMeasure: products.unitOfMeasure,
      isActive: products.isActive, isSparePart: products.isSparePart,
    })
    .from(products)
    .where(eq(products.id, sparePartId))
    .limit(1)
  if (!part || !part.isSparePart) return { prefillNotice: "El repuesto del enlace no existe en el catálogo." }
  if (!part.isActive) return { prefillNotice: "El repuesto del enlace está desactivado: elige otro del catálogo." }
  return {
    sparePartDefaults: true,
    prefillItems: [{
      productId: part.id, productNameFree: "", quantity: 1, unitOfMeasure: part.unitOfMeasure, urgency: "normal", notes: "",
    }],
    prefillNotice: `${part.name} preseleccionado. Indica el equipo y la cantidad.`,
  }
}

export async function buildPrefill({
  session, reposicion, desdeId, productoIds, cantidades, emergencyResourceId, workOrderId = "", vehicleId = "", sparePartId = "",
}: PrefillRequest): Promise<PrefillResult> {
  if (workOrderId || vehicleId) return fleetPrefill({ session, workOrderId, vehicleId })
  if (sparePartId) return sparePartPrefill(sparePartId)

  if (emergencyResourceId) {
    const [resource] = await db.select({
      id: preventionEmergencyResources.id,
      worksiteId: preventionEmergencyResources.worksiteId,
      assetCode: preventionEmergencyResources.assetCode,
      name: preventionEmergencyResources.name,
      status: preventionEmergencyResources.status,
    }).from(preventionEmergencyResources)
      .where(eq(preventionEmergencyResources.id, emergencyResourceId)).limit(1)
    if (!resource || !canAccessWorksite(session, resource.worksiteId)) return { prefillNotice: "El activo no existe o está fuera de tus faenas autorizadas." }
    if (resource.status === "out_of_service") return { prefillNotice: "El activo está dado de baja y no admite recarga." }
    const [product] = await db.select({ id: products.id, name: products.name, unitOfMeasure: products.unitOfMeasure })
      .from(products).where(and(
        eq(products.id, "prod-srv-recarga-extintor"),
        eq(products.isActive, true),
      )).limit(1)
    if (!product) return { prefillNotice: "El servicio de recarga no está disponible en el catálogo." }
    const label = resource.assetCode ? `${resource.assetCode} · ${resource.name}` : resource.name
    return {
      prefillItems: [{
        productId: product.id,
        productNameFree: "",
        quantity: 1,
        unitOfMeasure: product.unitOfMeasure,
        urgency: "critical",
        notes: `Recarga de ${label}`,
        emergencyResourceId: resource.id,
        emergencyResourceLabel: label,
      }],
      prefillNotice: `${label} preseleccionado. Al enviar se abrirá la brecha de cobertura.`,
    }
  }
  // Reposición desde Bodega: `?producto=&cantidad=` (repetibles) para pedir de
  // una vez todo lo que está bajo el mínimo de una faena. Se pre-llena el
  // creador y no se crea la solicitud: arrastra urgencia, fecha requerida y un
  // flujo de aprobación, así que enviarla es una decisión de quien la firma.
  if (productoIds.length > 0) {
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        unitOfMeasure: products.unitOfMeasure,
      })
      .from(products)
      // Reposición de stock: un repuesto de catálogo (consumo directo) no se repone.
      .where(and(eq(products.isActive, true), eq(products.isSparePart, false), inArray(products.id, productoIds)))
    const byId = new Map(rows.map((row) => [row.id, row]))

    const items: PrefillItem[] = []
    for (const [index, productId] of productoIds.entries()) {
      const product = byId.get(productId)
      if (!product) continue
      const parsed = Number(cantidades[index] ?? "")
      items.push({
        productId:       product.id,
        productNameFree: "",
        quantity:        Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
        unitOfMeasure:   product.unitOfMeasure,
        urgency:         "normal",
        notes:           "Reposición sugerida desde Bodega",
      })
    }

    if (items.length === 0) return { prefillNotice: "Los productos del enlace ya no están disponibles en el catálogo." }
    return {
      prefillItems: items,
      prefillNotice: `${items.length} ${items.length === 1 ? "producto pre-cargado" : "productos pre-cargados"} desde Bodega. Revisa las cantidades antes de enviar.`,
    }
  }

  if (desdeId) {
    const source = await db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, desdeId),
      with: { items: { with: { attributes: true } } },
    })
    // Sin acceso a la faena de origen no se copia nada: el creador se abre vacío.
    if (!source || !canAccessWorksite(session, source.worksiteId)) return {}
    const isOwner = source.requesterId === session.user.id
    if (!isOwner && !session.user.permissions.includes("requests:view_all")) return {}

    // El colaborador y los atributos viajan con la copia: sin ellos, duplicar una
    // vacuna o una mantención perdía en silencio para quién era y de qué equipo,
    // y el creador se abría con los campos obligatorios en blanco sin decir por qué.
    const workerIds = [...new Set(source.items.flatMap((item) => item.workerId ? [item.workerId] : []))]
    const workerRows = workerIds.length === 0
      ? []
      : await db
          .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName })
          .from(workers)
          .where(inArray(workers.id, workerIds))
    const workerNameById = new Map(workerRows.map((w) => [w.id, `${w.firstName} ${w.lastName}`]))

    const equipmentIds = [...new Set(source.items.flatMap((item) => item.equipmentId ? [item.equipmentId] : []))]
    const equipmentRows = equipmentIds.length === 0
      ? []
      : await db
          .select({ id: serviceEquipment.id, code: serviceEquipment.code })
          .from(serviceEquipment)
          .where(inArray(serviceEquipment.id, equipmentIds))
    const equipmentCodeById = new Map(equipmentRows.map((e) => [e.id, e.code]))

    // El equipo de flota viaja con la copia, pero la OT no: ya puede estar cerrada,
    // y una copia es un pedido nuevo. El equipo sólo se conserva si sigue activo y
    // en la faena de la solicitud de origen —la que abre el creador—; si no, el
    // servidor rechazaría el borrador, así que se suelta y se avisa.
    const vehicleIds = [...new Set(source.items.flatMap((item) => item.vehicleId ? [item.vehicleId] : []))]
    const vehicleRows = vehicleIds.length === 0
      ? []
      : await db
          .select({
            id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate,
            isActive: fuelVehicles.isActive, worksiteId: fuelVehicles.worksiteId,
          })
          .from(fuelVehicles)
          .where(inArray(fuelVehicles.id, vehicleIds))
    const usableVehicleById = new Map(
      vehicleRows
        .filter((vehicle) => vehicle.isActive && vehicle.worksiteId === source.worksiteId)
        .map((vehicle) => [vehicle.id, vehicle]),
    )
    const droppedVehicle = vehicleIds.some((id) => !usableVehicleById.has(id))

    return {
      ...(usableVehicleById.size > 0 ? { initialWorksiteId: source.worksiteId } : {}),
      prefillItems: source.items.map((item) => {
        const vehicle = item.vehicleId ? usableVehicleById.get(item.vehicleId) : undefined
        return {
          productId:           item.productId,
          productNameFree:     item.productNameFree ?? "",
          quantity:            item.quantity,
          unitOfMeasure:       item.unitOfMeasure,
          urgency:             item.urgency ?? source.urgency,
          notes:               item.notes ?? "",
          suggestedSupplierId: item.suggestedSupplierId,
          supplierHint:        item.supplierHint,
          workerId:            item.workerId,
          workerName:          item.workerId ? (workerNameById.get(item.workerId) ?? null) : null,
          equipmentCode:       item.equipmentId ? (equipmentCodeById.get(item.equipmentId) ?? null) : null,
          vehicleId:           vehicle?.id ?? null,
          vehicleLabel:        vehicle ? vehicleLabel(vehicle) : null,
          estimatedUnitPrice:  item.estimatedUnitPrice,
          attributes:          item.attributes.map((a) => ({
            attributeId: a.attributeId, attributeName: a.attributeName, value: a.value,
          })),
        }
      }),
      prefillNotice: `Ítems copiados de ${source.code}. Revísalos antes de enviar: la copia se crea recién al enviarla.`
        + (droppedVehicle ? " El equipo de flota ya no está disponible en esa faena: vuelve a elegirlo." : ""),
    }
  }

  if (!reposicion || !session.user.permissions.includes("prevention:epp:view")) return {}

  try {
    const suggestions = await listReplenishmentSuggestions({
      userId:      session.user.id,
      scope:       resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    if (suggestions.length === 0) {
      return { prefillNotice: "No hay brechas de EPP pendientes de reposición en tus faenas." }
    }
    return {
      prefillItems: suggestions.map((suggestion) => ({
        productId:       suggestion.productId,
        productNameFree: suggestion.productId ? "" : suggestion.productName,
        quantity:        1,
        unitOfMeasure:   suggestion.unitOfMeasure,
        urgency:         suggestion.urgency,
        notes:           suggestion.notes,
        workerId:        suggestion.workerId,
        workerName:      suggestion.workerName,
        replenishmentGapKey: suggestion.gapKey,
      })),
      prefillNotice: `${suggestions.length} ${suggestions.length === 1 ? "brecha de EPP detectada" : "brechas de EPP detectadas"} por Prevención. Quita las que no correspondan antes de enviar.`,
    }
  } catch (e) {
    logger.error("[NuevaSolicitudPage:reposicion]", e)
    return {}
  }
}
