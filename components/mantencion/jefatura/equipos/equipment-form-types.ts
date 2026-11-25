import type { MantUnit } from "@/lib/mantencion/types"

/** Listas cerradas que alimentan el formulario del equipo (se cargan en el servidor). */
export interface EquipmentFormCatalogs {
  /**
   * `unit` es la del TIPO (su default). La del equipo depende además de la faena (los camiones de producción
   * miden en horas, los de Biodiversa en km): el formulario la calcula con `meterType`, `family` y el `code`
   * de la faena, igual que el servidor. Sin esos datos vale `unit`.
   */
  types: Array<{ id: string; name: string; unit: MantUnit; meterType?: string; family?: string | null }>
  brands: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string; code?: string }>
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
  scheduleId: string
  initialReading: string
  initialReadingDate: string
}

export const EMPTY_EQUIPMENT_VALUES: EquipmentFormValues = {
  code: "", plate: "", noPlate: false, equipmentTypeId: "", brandId: "", model: "", year: "", worksiteId: "",
  scheduleId: "", initialReading: "", initialReadingDate: "",
}
