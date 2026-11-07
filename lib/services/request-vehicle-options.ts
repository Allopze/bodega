import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelVehicles, mantWorkOrders, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { vehicleLabel } from "@/lib/services/fleet"

/**
 * Equipo de flota que el formulario de solicitudes ofrece en «Equipo de flota»
 * (repuestos y servicios), con las OT abiertas a las que se puede vincular el
 * pedido. `operationalStatus` alimenta la vía rápida de cotizaciones: un equipo
 * que no está operativo permite enviar con menos cotizaciones si la urgencia es
 * crítica (`lib/requests/quotation-requirement.ts`).
 */
export interface RequestVehicleOption {
  id: string
  code: string | null
  plate: string
  /** `KA-135 · RBYD-98`, o sólo la patente si el equipo no tiene código. */
  label: string
  /** `{tipo de equipo} · {faena}`: texto secundario del combobox (entra en la búsqueda). */
  hint: string
  worksiteId: string
  brand: string | null
  model: string | null
  operationalStatus: string
  openWorkOrders: { id: string; folio: string; status: string }[]
}

/**
 * Equipos activos dentro del alcance de faenas de la sesión, ordenados por
 * patente. El alcance es el del rol (`worksiteScopeSql`): el selector no debe
 * delatar el parque de otra faena. El formulario además filtra por la faena
 * elegida en pantalla, y el servidor revalida al guardar.
 */
export async function listVehicleOptionsForRequests(session: Session): Promise<RequestVehicleOption[]> {
  const vehicles = await db
    .select({
      id: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      worksiteId: fuelVehicles.worksiteId,
      brand: fuelVehicles.brand,
      model: fuelVehicles.model,
      operationalStatus: fuelVehicles.operationalStatus,
      typeName: fuelEquipmentTypes.name,
      worksiteName: worksites.name,
    })
    .from(fuelVehicles)
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(and(eq(fuelVehicles.isActive, true), worksiteScopeSql(session, fuelVehicles.worksiteId)))
    .orderBy(asc(fuelVehicles.plate))
  if (vehicles.length === 0) return []

  const openOrders = await db
    .select({
      id: mantWorkOrders.id,
      folio: mantWorkOrders.folio,
      status: mantWorkOrders.status,
      vehicleId: mantWorkOrders.vehicleId,
    })
    .from(mantWorkOrders)
    .where(and(
      inArray(mantWorkOrders.vehicleId, vehicles.map((vehicle) => vehicle.id)),
      inArray(mantWorkOrders.status, [...OT_OPEN_STATUSES]),
    ))
    .orderBy(desc(mantWorkOrders.createdAt))

  const ordersByVehicle = new Map<string, RequestVehicleOption["openWorkOrders"]>()
  for (const order of openOrders) {
    const list = ordersByVehicle.get(order.vehicleId) ?? []
    list.push({ id: order.id, folio: order.folio, status: order.status })
    ordersByVehicle.set(order.vehicleId, list)
  }

  return vehicles.map((vehicle) => ({
    id: vehicle.id,
    code: vehicle.code,
    plate: vehicle.plate,
    label: vehicleLabel(vehicle),
    hint: `${vehicle.typeName} · ${vehicle.worksiteName}`,
    worksiteId: vehicle.worksiteId,
    brand: vehicle.brand,
    model: vehicle.model,
    operationalStatus: vehicle.operationalStatus,
    openWorkOrders: ordersByVehicle.get(vehicle.id) ?? [],
  }))
}
