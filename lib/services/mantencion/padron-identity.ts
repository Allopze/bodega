import type { Session } from "next-auth"
import { db } from "@/db"
import { can } from "@/lib/auth/can"
import type { PadronBrandOption, PadronMaintenance } from "@/lib/mantencion/padron-identity"
import { equipmentScope, isWorksiteInScope, viewerFromSession } from "./access"
import { listMantCatalogs } from "./catalogs"
import { loadEquipmentCurrents } from "./equipment-resolve"

/**
 * Lo que el formulario del padrón muestra de los equipos de Mantención (crítica 2026-11-15, paso
 * 4b): su marca de la lista, «Sin patente», qué fija su unidad y si quien edita puede cambiar lo
 * que es del perfil. Con `vehicleId`, sólo ese equipo (la ficha); sin él, todos (la tabla del
 * padrón). Un vehículo que no está en Mantención no aparece: el padrón lo edita como siempre.
 */
export async function loadPadronMaintenance(
  session: Session,
  vehicleId?: string,
): Promise<{ byVehicle: Record<string, PadronMaintenance>; brands: PadronBrandOption[] }> {
  const [currents, catalogs] = await Promise.all([
    loadEquipmentCurrents(db, vehicleId),
    listMantCatalogs({ includeInactive: true }),
  ])
  const manages = can(session, "mant:equipment:manage")
  const scope = manages ? equipmentScope(viewerFromSession(session)) : null
  const byVehicle: Record<string, PadronMaintenance> = {}
  for (const current of currents) {
    byVehicle[current.vehicleId] = {
      brandId: current.brandId,
      noPlate: current.fields.noPlate,
      unit: current.unit,
      typeUnit: current.typeUnit,
      unitFixedBy: current.recordCount > 0
        ? { kind: "registros" }
        : current.fields.schedule ? { kind: "pauta", scheduleName: current.fields.schedule } : null,
      canChangeProfile: !!scope && isWorksiteInScope(scope, current.worksiteId),
    }
  }
  return { byVehicle, brands: catalogs.brands.map((brand) => ({ id: brand.id, name: brand.name, isActive: brand.isActive })) }
}
