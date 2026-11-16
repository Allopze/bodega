import { eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelProducts, fuelSuppliers, users, worksites } from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"

/** Las listas del formulario del padrón, ya en la forma que pide `VehicleForm`. */
export interface VehicleFormCatalogs {
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  equipmentTypes: Array<{ id: string; name: string; category: string; defaultMeterType: string; defaultPerformanceUnit: string; isActive: boolean }>
  suppliers: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string; unit: string; isActive: boolean }>
}

/**
 * Faenas del alcance de quien edita, usuarios activos (responsable), tipos de equipo,
 * proveedores activos y productos. Las usan la tabla del padrón y «Editar vehículo» de la ficha
 * del vehículo (crítica 2026-11-15, paso 4b), para que el formulario ofrezca lo mismo en los dos.
 */
export async function loadVehicleFormCatalogs(session: Session): Promise<VehicleFormCatalogs> {
  const worksiteScope = resolveWorksiteScope(session)
  const [worksitesList, usersList, equipmentTypes, suppliers, products] = await Promise.all([
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
    db.query.users.findMany({ where: eq(users.isActive, true), orderBy: [users.name] }),
    db.query.fuelEquipmentTypes.findMany({ orderBy: [fuelEquipmentTypes.sortOrder, fuelEquipmentTypes.name] }),
    db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), orderBy: [fuelSuppliers.name] }),
    db.query.fuelProducts.findMany({ orderBy: [fuelProducts.name] }),
  ])
  return {
    worksites: worksitesList.map((item) => ({ id: item.id, name: item.name })),
    users: usersList.map((item) => ({ id: item.id, name: item.name })),
    equipmentTypes: equipmentTypes.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      defaultMeterType: item.defaultMeterType,
      defaultPerformanceUnit: item.defaultPerformanceUnit,
      isActive: item.isActive,
    })),
    suppliers: suppliers.map((item) => ({ id: item.id, name: item.name })),
    products: products.map((item) => ({ id: item.id, name: item.name, unit: item.unit, isActive: item.isActive })),
  }
}
