import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { costCenters, fuelEquipmentTypes, fuelVehicles, mantWorkOrders, suppliers, worksites } from "@/db/schema"
import { OT_PERMISSIONS } from "@/lib/mantencion/work-order-states"
import type { MantViewer } from "../access"
import { equipmentLabel } from "../work-orders/core"

/**
 * Lo que el formulario «Nueva nota de pedido» (web) ofrece para elegir, SIEMPRE recortado al alcance de quien pide
 * (resuelto aquí, en el servidor): las faenas activas de su alcance (un rol global, todas), los equipos y centros de costo
 * de esas faenas (el cargo de cada línea), las OT abiertas en que puede pedir repuestos y los proveedores activos.
 *
 * Una OT sólo se ofrece si el alta la va a aceptar (`targetOfWorkOrderTx` en `create.ts`): `asignada` o `en_ejecucion`, y
 * asignada a quien pide o, si administra las OT (`mant:ot:manage`), cualquiera de su alcance. Esta lectura sólo ayuda a
 * elegir: el servicio de alta vuelve a validar faena, OT, cargo y proveedor.
 */

/** Tope de OT que viajan al formulario: las más recientes de su alcance (el selector filtra escribiendo). */
export const NEW_NOTE_MAX_WORK_ORDERS = 400

export interface NewNoteWorksite { id: string; name: string }
export interface NewNoteVehicle { id: string; worksiteId: string; code: string; plate: string; typeName: string }
export interface NewNoteCostCenter { id: string; worksiteId: string; code: string; name: string }
export interface NewNoteWorkOrder { id: string; worksiteId: string; vehicleId: string; folio: string; equipment: string }
export interface NewNoteSupplier { id: string; name: string; rut: string | null }

export interface NewNoteOptions {
  worksites: NewNoteWorksite[]
  vehicles: NewNoteVehicle[]
  costCenters: NewNoteCostCenter[]
  workOrders: NewNoteWorkOrder[]
  suppliers: NewNoteSupplier[]
}

/** OT en que todavía se puede pedir repuestos (misma lista que `ALLOWED_STATUSES` de `create.ts`). */
const OPEN_FOR_PARTS = ["asignada", "en_ejecucion"] as const

const EMPTY: NewNoteOptions = { worksites: [], vehicles: [], costCenters: [], workOrders: [], suppliers: [] }

export async function loadNewNoteOptions(viewer: MantViewer): Promise<NewNoteOptions> {
  const activeWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))
  const scoped = viewer.isGlobal ? activeWorksites : activeWorksites.filter((worksite) => viewer.worksiteIds.includes(worksite.id))
  if (scoped.length === 0) return EMPTY
  const worksiteIds = scoped.map((worksite) => worksite.id)
  const managesOrders = viewer.permissions.includes(OT_PERMISSIONS.manage)

  const [vehicleRows, costCenterRows, orderRows, supplierRows] = await Promise.all([
    db
      .select({ id: fuelVehicles.id, worksiteId: fuelVehicles.worksiteId, code: fuelVehicles.code, plate: fuelVehicles.plate, typeName: fuelEquipmentTypes.name })
      .from(fuelVehicles)
      .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
      .where(and(eq(fuelVehicles.isActive, true), inArray(fuelVehicles.worksiteId, worksiteIds)))
      .orderBy(asc(fuelVehicles.code), asc(fuelVehicles.plate)),
    db
      .select({ id: costCenters.id, worksiteId: costCenters.worksiteId, code: costCenters.code, name: costCenters.name })
      .from(costCenters)
      .where(and(eq(costCenters.isActive, true), inArray(costCenters.worksiteId, worksiteIds)))
      .orderBy(asc(costCenters.name)),
    db
      .select({
        id: mantWorkOrders.id,
        worksiteId: mantWorkOrders.worksiteId,
        vehicleId: mantWorkOrders.vehicleId,
        folio: mantWorkOrders.folio,
        snapshot: mantWorkOrders.equipmentSnapshot,
        assignedToUserId: mantWorkOrders.assignedToUserId,
      })
      .from(mantWorkOrders)
      .where(and(
        inArray(mantWorkOrders.status, [...OPEN_FOR_PARTS]),
        inArray(mantWorkOrders.worksiteId, worksiteIds),
        // Sin `mant:ot:manage` sólo las OT asignadas a quien pide: es la regla del alta.
        managesOrders ? undefined : eq(mantWorkOrders.assignedToUserId, viewer.userId),
      ))
      .orderBy(desc(mantWorkOrders.createdAt))
      .limit(NEW_NOTE_MAX_WORK_ORDERS),
    db
      .select({ id: suppliers.id, name: suppliers.name, rut: suppliers.rut })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
  ])

  return {
    worksites: scoped,
    vehicles: vehicleRows.map((row) => ({ id: row.id, worksiteId: row.worksiteId, code: row.code ?? row.plate, plate: row.plate, typeName: row.typeName })),
    costCenters: costCenterRows.flatMap((row) => (row.worksiteId ? [{ id: row.id, worksiteId: row.worksiteId, code: row.code, name: row.name }] : [])),
    workOrders: orderRows.map((row) => ({ id: row.id, worksiteId: row.worksiteId, vehicleId: row.vehicleId, folio: row.folio, equipment: equipmentLabel(row.snapshot) })),
    suppliers: supplierRows,
  }
}
