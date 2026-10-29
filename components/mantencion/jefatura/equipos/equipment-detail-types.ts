import type { EquipmentHistoryEntry } from "@/lib/services/mantencion/equipment-history"
import type { RecentEquipmentRecord } from "@/lib/services/mantencion/equipment"
import type { MantEquipmentState, MantUnit } from "@/lib/mantencion/types"
import type { EquipmentFormCatalogs, EquipmentFormValues } from "./equipment-form-types"

/** Lo que la ficha en modo lectura muestra del equipo, ya resuelto en el servidor. */
export interface EquipmentDetailData {
  vehicleId: string
  code: string
  plate: string
  noPlate: boolean
  typeName: string
  unit: MantUnit
  brandName: string
  model: string | null
  year: number | null
  worksiteName: string
  schedule: { id: string; name: string } | null
  retired: boolean
  retiredReason: string | null
  initialReading: { value: number; date: string } | null
  status: {
    state: MantEquipmentState
    currentReading: { value: number; date: string } | null
    nextReading: number | null
    remaining: number | null
    nextIntervalValue: number | null
    lastPreventive: { reading: number; date: string; intervalValue: number } | null
  }
  workshop: { entryDate: string | null; daysStopped: number | null; stale: boolean } | null
  recordCount: number
  records: RecentEquipmentRecord[]
  history: EquipmentHistoryEntry[]
}

/** Lo que hace falta para editar: sólo se carga si la persona puede administrar equipos. */
export interface EquipmentEditData {
  catalogs: EquipmentFormCatalogs
  initial: EquipmentFormValues
}
