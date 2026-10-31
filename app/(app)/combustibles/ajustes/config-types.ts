import type { PerformanceFamily } from "@/lib/combustibles/control/contracts"
import type { ProviderMapping } from "@/lib/combustibles/control/catalogs"

/** Filas ya serializables que la página entrega a las secciones (nada de funciones ni fechas). */

export interface MandanteRow {
  id: string
  name: string
  clientId: string | null
  clientName: string | null
  tolerancePct: number
  isActive: boolean
  /** Solo faenas del alcance de quien mira. */
  worksiteIds: string[]
}

export interface WorksiteOption {
  id: string
  name: string
  /** Mandante al que pertenece hoy, si lo hay. */
  mandanteId: string | null
  mandanteName: string | null
}

export interface Option {
  id: string
  name: string
}

export interface SupplyMediumRow {
  id: string
  name: string
  kind: string
  fuelSupplierId: string | null
  fuelSupplierName: string | null
  providerMapping: ProviderMapping
  aliases: string[]
  sortOrder: number
  isActive: boolean
}

export interface EquipmentTypeRow {
  id: string
  name: string
  performanceFamily: PerformanceFamily | null
  vehicleCount: number
}
