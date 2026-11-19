import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { addDaysToPlainDate } from "@/lib/utils"

/**
 * Cambia la faena de un vehículo en las pruebas respetando el invariante de
 * las estadías: cierra la abierta el día anterior a `startedOn`, abre la nueva
 * y actualiza `fuel_vehicles.worksite_id`, todo en una transacción. Un
 * `UPDATE` directo de la faena lo frena la base (`FLEET_STAY_INVARIANT`).
 *
 * Sólo para fixtures: el código de producción cambia de faena por el servicio
 * de traslados.
 */
export async function setVehicleWorksiteForTest(
  db: DB,
  vehicleId: string,
  worksiteId: string,
  startedOn: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(schema.fuelVehicleWorksiteIntervals)
      .set({ endedOn: addDaysToPlainDate(startedOn, -1) })
      .where(and(
        eq(schema.fuelVehicleWorksiteIntervals.vehicleId, vehicleId),
        isNull(schema.fuelVehicleWorksiteIntervals.endedOn),
      ))
    await tx.insert(schema.fuelVehicleWorksiteIntervals).values({
      id: randomUUID(),
      vehicleId,
      worksiteId,
      startedOn,
      source: "reconstruccion",
    })
    await tx.update(schema.fuelVehicles).set({ worksiteId }).where(eq(schema.fuelVehicles.id, vehicleId))
  })
}
