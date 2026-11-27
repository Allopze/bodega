import type { MantUnit } from "@/lib/mantencion/types"

/** Listas cerradas que alimentan el formulario del equipo (se cargan en el servidor). */
export interface EquipmentFormCatalogs {
  /** `unit` es la del medidor del TIPO: con ella se prellena la «Unidad de mantención» del equipo, que se puede cambiar. */
  types: Array<{ id: string; name: string; unit: MantUnit }>
  brands: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string }>
  schedules: Array<{ id: string; name: string; unit: MantUnit; intervalCount: number }>
}

/** Valores del formulario, todos como texto: lo que se escribe es lo que viaja. */
export interface EquipmentFormValues {
  code: string
  plate: string
  noPlate: boolean
  equipmentTypeId: string
  brandId: string
  model: string
  year: string
  worksiteId: string
  /**
   * Unidad de mantención elegida: `km` o `h`. Vacía = la de su tipo, que es con la que se prellena el control
   * (cambiar el tipo la devuelve a la del tipo nuevo). El servidor valida que sea `km` o `h`.
   */
  unit: string
  scheduleId: string
  initialReading: string
  initialReadingDate: string
}

export const EMPTY_EQUIPMENT_VALUES: EquipmentFormValues = {
  code: "", plate: "", noPlate: false, equipmentTypeId: "", brandId: "", model: "", year: "", worksiteId: "",
  unit: "", scheduleId: "", initialReading: "", initialReadingDate: "",
}
