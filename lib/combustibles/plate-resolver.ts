/**
 * Resolución patente→vehículo de las sincronizaciones de proveedor.
 *
 * Vivía duplicada byte a byte en `copec-sync` (dos veces en el mismo período:
 * una para el ledger y otra para la proyección) y en `aramco-sync`, y cada copia
 * traía el padrón completo y los mappings por su cuenta.
 *
 * Vive acá y no en `xlsx-utils` porque consulta la base: ese módulo se bundlea al
 * navegador —`parseFuelExcel` corre en el modal de facturas— y arrastrarle `@/db`
 * metería el cliente de Postgres en el bundle de cliente.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderMappings } from "@/db/schema"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"

export interface ResolvedVehicle {
  id: string
  plate: string
  worksiteId: string
}

/**
 * Carga el padrón una vez y devuelve el resolutor.
 *
 * El matching es por `plateMatchKey` (sin separadores) y no por igualdad exacta:
 * el catálogo guarda la patente con el formato del alta manual y cada proveedor
 * trae el suyo — "AB-CD12" contra "ABCD12" no calzaba y la carga quedaba
 * pendiente como "patente sin vincular" pese a que el vehículo sí existe.
 *
 * Un mapping manual activo MANDA sobre el catálogo, incluso cuando no tiene
 * vehículo: en ese caso devuelve `undefined` y la fila queda pendiente, en vez de
 * caer al catálogo y deshacer en silencio la decisión que alguien tomó a mano.
 */
export async function loadVehicleResolver(
  mapping: { provider: "copec" | "aramco"; sourceAccount: string },
): Promise<(plate: string) => ResolvedVehicle | undefined> {
  const [vehicles, mappings] = await Promise.all([
    db.query.fuelVehicles.findMany({ columns: { id: true, plate: true, worksiteId: true } }),
    db.query.fuelProviderMappings.findMany({
      where: and(
        eq(fuelProviderMappings.provider, mapping.provider),
        eq(fuelProviderMappings.sourceAccount, mapping.sourceAccount),
        eq(fuelProviderMappings.isActive, true),
      ),
      columns: { externalKey: true, vehicleId: true },
    }),
  ])
  const byPlateKey = new Map(vehicles.map((vehicle) => [plateMatchKey(vehicle.plate), vehicle]))
  const byVehicleId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const byMappedPlate = new Map(mappings.map((item) => [item.externalKey, item]))

  return (plate: string) => {
    const mapped = byMappedPlate.get(plateMatchKey(plate))
    if (mapped) return mapped.vehicleId ? byVehicleId.get(mapped.vehicleId) : undefined
    return byPlateKey.get(plateMatchKey(plate))
  }
}
