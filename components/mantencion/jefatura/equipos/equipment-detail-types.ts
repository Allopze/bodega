import type { EquipmentHistoryEntry } from "@/lib/services/mantencion/equipment-history"
import type { EquipmentInsurance } from "@/lib/services/mantencion/equipment-life"
import type { VehiclePurchaseRecord } from "@/lib/services/vehicle-purchase-history"
import type { MantGpsReadingSource } from "@/lib/mantencion/gps-estimate"
import type { MantEquipmentState, MantEquipmentStatus, MantUnit } from "@/lib/mantencion/types"
import type { EquipmentLifeData } from "./equipment-life-section"
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
  /** Correctiva abierta con el equipo en taller: ingreso, días detenido y fecha de la última novedad (`YYYY-MM-DD`). */
  workshop: { entryDate: string | null; daysStopped: number | null; stale: boolean; lastActivityDate: string } | null
  /** Estimación GPS, separada del estado oficial; `null` si no hay lectura más nueva. */
  gpsStatus: MantEquipmentStatus | null
  gpsReadingAt: string | null
  /** Fuente de la estimación (GPS o horómetro de Cat vía VisionLink); ausente = GPS. */
  gpsReadingSource?: MantGpsReadingSource | null
  recordCount: number
  /** Hoja de vida: historial completo de mantenciones dentro del alcance de lectura. */
  life: EquipmentLifeData
  insurance: EquipmentInsurance
  /** `flota:view`: habilita el enlace a la ficha de flota y a los documentos de seguro. */
  canViewFleet: boolean
  history: EquipmentHistoryEntry[]
  /** Repuestos y servicios comprados para el equipo. `null` = sin capacidad de verlos: la tarjeta no se dibuja. */
  purchases: VehiclePurchaseRecord[] | null
  /**
   * Qué puede hacer quien mira con ellos: abrir la solicitud, abrir la OC, abrir la ficha del repuesto
   * de catálogo (`repuestos:catalog`) y pedir repuestos (`null` = no puede).
   */
  purchaseLinks: { canOpenRequests: boolean; canOpenOrders: boolean; canOpenSpareParts: boolean; newRequestHref: string | null }
}

/** Lo que hace falta para editar: sólo se carga si la persona puede administrar equipos. */
export interface EquipmentEditData {
  catalogs: EquipmentFormCatalogs
  initial: EquipmentFormValues
}
