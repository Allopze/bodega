import type { MantUnit } from "@/lib/mantencion/types"

/** Listas cerradas que alimentan el formulario del equipo (se cargan en el servidor). */
export interface EquipmentFormCatalogs {
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
  newWorksiteName: string
  scheduleId: string
  initialReading: string
  initialReadingDate: string
  retired: boolean
  retiredReason: string
}

export const EMPTY_EQUIPMENT_VALUES: EquipmentFormValues = {
  code: "", plate: "", noPlate: false, equipmentTypeId: "", brandId: "", model: "", year: "", worksiteId: "",
  newWorksiteName: "", scheduleId: "", initialReading: "", initialReadingDate: "", retired: false, retiredReason: "",
}
