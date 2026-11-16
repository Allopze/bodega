"use server"

import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { fuelVehicleProducts, fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import type { PadronBrandOption } from "@/lib/mantencion/padron-identity"
import { logger } from "@/lib/logger"
import { loadPadronMaintenance } from "@/lib/services/mantencion/padron-identity"
import { loadVehicleFormCatalogs, type VehicleFormCatalogs } from "@/app/(app)/combustibles/vehiculos/form-catalogs"
import type { VehicleForEdit } from "@/app/(app)/combustibles/vehiculos/vehicle-form"

export interface VehicleEditPayload {
  vehicle: VehicleForEdit
  catalogs: VehicleFormCatalogs
  maintenanceBrands: PadronBrandOption[]
}

export type VehicleEditLoadResult = { ok: true; data: VehicleEditPayload } | { ok: false; message: string }

const idSchema = z.string().trim().min(1).max(64)

/**
 * Lo que «Editar vehículo» de la cabecera de la ficha necesita para abrir el formulario del
 * padrón (crítica 2026-11-15, paso 4b): el vehículo, las listas del formulario y, si está en
 * Mantención, sus reglas. Se pide al abrir y no con cada vista de la ficha: la mayoría de las
 * visitas no edita. Exige lo mismo que guardar (`admin:fleet_vehicles` y la faena del vehículo
 * en el alcance); el guardado lo vuelve a exigir.
 */
export async function loadVehicleEditAction(vehicleId: string): Promise<VehicleEditLoadResult> {
  let session
  try { session = await requirePermission("admin:fleet_vehicles") }
  catch { return { ok: false, message: "No tienes permiso para editar vehículos." } }
  const parsed = idSchema.safeParse(vehicleId)
  if (!parsed.success) return { ok: false, message: "No se reconoce el vehículo." }
  const id = parsed.data

  try {
    const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
    if (!vehicle) return { ok: false, message: "Ese vehículo ya no existe. Recarga la página." }
    if (!canAccessWorksite(session, vehicle.worksiteId)) return { ok: false, message: "No puedes editar vehículos de esta faena." }

    const [catalogs, products, maintenance] = await Promise.all([
      loadVehicleFormCatalogs(session),
      db.select({ productId: fuelVehicleProducts.productId }).from(fuelVehicleProducts).where(eq(fuelVehicleProducts.vehicleId, id)),
      loadPadronMaintenance(session, id),
    ])
    return {
      ok: true,
      data: {
        vehicle: {
          id: vehicle.id,
          plate: vehicle.plate,
          code: vehicle.code,
          type: vehicle.type,
          equipmentTypeId: vehicle.equipmentTypeId,
          meterType: vehicle.meterType,
          performanceUnit: vehicle.performanceUnit,
          tankCapacityLiters: vehicle.tankCapacityLiters,
          comparisonGroup: vehicle.comparisonGroup,
          usualFuelSupplierId: vehicle.usualFuelSupplierId,
          compatibleProductIds: products.map((row) => row.productId),
          operatingSchedule: vehicle.operatingSchedule,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
          serialNumber: vehicle.serialNumber,
          worksiteId: vehicle.worksiteId,
          responsibleUserId: vehicle.responsibleUserId,
          operationalStatus: vehicle.operationalStatus,
          soapExpiresAt: vehicle.soapExpiresAt,
          technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
          circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
          insurancePolicyNumber: vehicle.insurancePolicyNumber,
          insuranceExpiresAt: vehicle.insuranceExpiresAt,
          notes: vehicle.notes,
          maintenance: maintenance.byVehicle[id] ?? null,
        },
        catalogs,
        maintenanceBrands: maintenance.brands,
      },
    }
  } catch (error) {
    logger.error("[loadVehicleEditAction]", error)
    return { ok: false, message: "No se pudo abrir el formulario. Inténtalo de nuevo." }
  }
}
