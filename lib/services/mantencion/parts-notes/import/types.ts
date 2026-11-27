import type { PartsNoteStatus } from "../../parts/types"

/**
 * Importación de las notas de pedido de CHOME ERP (ADR 0001, 2026-11-27). Tipos compartidos por el parseo, el plan,
 * la aplicación y el informe. El archivo de entrada y las decisiones de negocio están en `docs` del paquete: ver
 * `plan.ts` (qué se importa y qué queda pendiente) y `apply.ts` (cómo se escribe).
 */

/** Estados con que llegan las notas de CHOME ERP, ya traducidos a los de la plataforma. */
export type ImportedNoteStatus = Extract<PartsNoteStatus, "enviada" | "aceptada" | "en_espera" | "rechazada" | "cerrada">

export interface ErpItem {
  articulo: string
  codigo: string | null
  cargo: string | null
  proveedor: string | null
  cantidad: number
}

/** Una nota del archivo, ya validada: fecha en UTC, estado traducido y texto limpio (vacío = null). */
export interface ErpNote {
  /** Folio de origen sin prefijo (`123`). */
  erpId: string
  /** Clave de idempotencia: `CHOME-123`. */
  externalRef: string
  /** Fecha de la nota como instante UTC (el archivo trae hora de Chile sin zona). */
  createdAt: string
  solicitante: string | null
  usuario: string | null
  faena: string
  urgente: boolean
  observacion: string | null
  estado: ImportedNoteStatus
  motivo: string | null
  items: ErpItem[]
}

/** Una nota que no se puede leer: sin id, con fecha inválida, sin líneas… No se importa y queda en el informe. */
export interface InvalidNote {
  /** Posición en el archivo (desde 1; `null` si la nota se leyó bien y falló al planificarla) y, si se pudo leer, su folio de origen. */
  position: number | null
  externalRef: string | null
  errors: string[]
}

/** Cómo se imputa una línea. */
export type ChargeResolution =
  | { kind: "none" }
  | { kind: "vehicle"; vehicleId: string; label: string }
  | { kind: "costCenter"; costCenterId: string; label: string }
  | { kind: "pending"; chargeText: string; reason: string }

export interface PlannedLine {
  sortOrder: number
  description: string
  quantity: number
  unitOfMeasure: string
  partNumber: string | null
  productId: string | null
  chargeVehicleId: string | null
  chargeCostCenterId: string | null
  chargeText: string | null
  suggestedSupplierId: string | null
  supplierHint: string | null
  resolution: "pendiente" | "en_compra" | "rechazada"
  resolutionReason: string | null
}

export interface PlannedNote {
  externalRef: string
  erpId: string
  createdAt: string
  /** Año del folio `NP-AAAA-NNNN`: el de la fecha de la nota en hora de Chile. */
  folioYear: number
  worksiteId: string
  worksiteName: string
  requestedByUserId: string | null
  requestedByName: string | null
  urgent: boolean
  notes: string | null
  status: ImportedNoteStatus
  holdReason: string | null
  lines: PlannedLine[]
  /** Avisos de datos que se corrigieron al importar (texto recortado): se informan, la nota entra. */
  warnings: string[]
}

export interface ExistingNote { externalRef: string; code: string; status: string }

/** Regla configurable de notas de prueba: un solicitante/usuario de la lista con «test» en la observación o en un artículo. */
export interface ExclusionRule {
  /** Nombres o logins (se comparan sin tildes ni mayúsculas) de quien crea notas de prueba. */
  actors: readonly string[]
  /** Texto que delata la prueba. Se busca en la observación y en cada artículo. */
  textPattern: RegExp
}

export const DEFAULT_EXCLUSION_RULE: ExclusionRule = {
  actors: ["admin", "administrador", "administrator"],
  textPattern: /\btest/i,
}
