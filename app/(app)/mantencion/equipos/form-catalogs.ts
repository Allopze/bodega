import type { EquipmentFormCatalogs } from "@/components/mantencion/jefatura/equipos/equipment-form-types"
import { listEquipmentTypes, listMantCatalogs } from "@/lib/services/mantencion/catalogs"
import { listSchedules } from "@/lib/services/mantencion/schedules"
import { listMantWorksites } from "@/lib/services/mantencion/worksites"

/** Las listas cerradas del formulario del equipo: tipos con medidor, marcas, faenas activas y pautas. */
export async function loadEquipmentFormCatalogs(): Promise<EquipmentFormCatalogs> {
  const [types, catalogs, worksites, schedules] = await Promise.all([
    listEquipmentTypes(),
    listMantCatalogs(),
    listMantWorksites(),
    listSchedules(),
  ])
  return {
    types,
    brands: catalogs.brands.map((item) => ({ id: item.id, name: item.name })),
    worksites: worksites.map((item) => ({ id: item.id, name: item.name })),
    schedules: schedules.map((item) => ({ id: item.id, name: item.name, unit: item.unit, intervalCount: item.intervals.length })),
  }
}
