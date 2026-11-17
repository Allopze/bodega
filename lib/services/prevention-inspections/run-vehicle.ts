import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelEquipmentTypes, fuelVehicles } from "@/db/schema"

type Executor = typeof db | Tx

/**
 * Tipo del equipo que es sujeto de una ejecución, para decidir qué secciones de
 * la plantilla le corresponden (`appliesToVehicleTypes`).
 *
 * La fuente canónica es el tipo de equipo del catálogo (`equipmentTypeId` →
 * `fuel_equipment_types.slug`); `fuel_vehicles.type` es el snapshot legado y sólo
 * respalda si el catálogo no devolviera nada. Los tipos que la normalización
 * creó para valores heredados (`legacy-…`) no son un tipo real: se tratan como
 * desconocidos, y desconocido muestra todo. Sin equipo, `null`.
 */
export async function getRunVehicleType(executor: Executor, vehicleId: string | null | undefined): Promise<string | null> {
  if (!vehicleId) return null
  const [row] = await executor.select({ slug: fuelEquipmentTypes.slug, legacyType: fuelVehicles.type })
    .from(fuelVehicles)
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!row) return null
  const type = (row.slug ?? row.legacyType)?.trim().toLowerCase()
  if (!type || type.startsWith("legacy-")) return null
  return type
}
