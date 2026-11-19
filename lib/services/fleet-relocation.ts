import type { Tx } from "@/db"
import { moveProviderMappingsWithVehicleTx } from "@/lib/combustibles/provider-mappings"
import { closeContractAssignmentsOnRelocationTx } from "@/lib/services/contracts/assignments"
import { todayInChile } from "@/lib/utils"

/**
 * ÚNICA puerta para cambiar de faena a un equipo de flota.
 *
 * Trasladar un vehículo tiene dos consecuencias que deben ocurrir el mismo día y
 * en la misma transacción: sus asignaciones de proveedor (patente → faena, para
 * el combustible) siguen al vehículo, y su asignación de contrato —que es de la
 * faena donde estaba— deja de regir. Antes sólo existía lo primero y cada sitio
 * llamaba a `moveProviderMappingsWithVehicleTx` por su cuenta; el que se olvidara
 * dejaba al equipo en un contrato de una faena donde ya no está.
 * `lib/__tests__/fleet-relocation-callers.test.ts` impide volver a llamarla
 * directamente.
 *
 * Quien llama ya cambió `fuel_vehicles.worksite_id` dentro de `tx`. Sin
 * `effectiveFrom`, el traslado rige desde hoy en Chile.
 */
export async function relocateVehicleWorksiteTx(
  tx: Tx,
  input: { vehicleId: string; worksiteId: string; actorUserId: string; actorEmail?: string | null; effectiveFrom?: string },
): Promise<{ movedMappings: number; closedAssignments: number }> {
  const effectiveFrom = input.effectiveFrom ?? todayInChile()
  const movedMappings = await moveProviderMappingsWithVehicleTx(tx, { ...input, effectiveFrom })
  const closedAssignments = await closeContractAssignmentsOnRelocationTx(tx, {
    vehicleId: input.vehicleId, effectiveFrom, actorUserId: input.actorUserId, actorEmail: input.actorEmail,
  })
  return { movedMappings, closedAssignments }
}
