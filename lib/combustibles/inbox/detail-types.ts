import type { AnomalyCaseStatus, AnomalySeverity, MeterResolutionKind } from "@/lib/combustibles/anomaly-labels"
import { FUEL_INBOX_KINDS, type FuelInboxEvidence, type FuelInboxFilters, type FuelInboxItemDetail, type FuelInboxKind } from "./types"

/**
 * Lo que la hoja de decisión necesita además de la fila y la evidencia del
 * contrato (`types.ts`): el estado exacto del registro de origen y las opciones
 * de las acciones. Módulo de tipos: lo importan el servidor y el cliente.
 */

/** Filtros propios de los casos que llegan de enlaces antiguos (`/anomalias?severidad=…&ref=…`). */
export interface FuelInboxQueryFilters extends FuelInboxFilters {
  caseSeverity?: AnomalySeverity
  /** Sólo `open`, `in_review` o `reopened`: una pestaña de «Pendientes» no lista casos cerrados. */
  caseState?: Extract<AnomalyCaseStatus, "open" | "in_review" | "reopened">
  /** Registro de origen de un caso: tipo y id de la entidad referenciada. */
  caseReference?: { type: string; id: string }
}

export interface FuelInboxVehicleOption {
  value: string
  label: string
  hint?: string
}

export interface FuelInboxItemExtras {
  load?: {
    id: string
    reviewStatus: "ok" | "flagged" | "approved" | "rejected"
    voided: boolean
    hasVehicle: boolean
  }
  case?: {
    id: string
    status: AnomalyCaseStatus
    severity: AnomalySeverity
    ruleCode: string
    ruleName: string | null
    resolutionKind: MeterResolutionKind | null
    assigneeId: string | null
  }
  plate?: {
    batchId: string
    plate: string
    worksiteId: string
    source: string
    /** Equipos de la faena del lote a los que se puede vincular la patente. */
    vehicleOptions: FuelInboxVehicleOption[]
  }
  request?: {
    id: string
    status: "open" | "resolved" | "withdrawn"
    requestedByName: string | null
    note: string | null
  }
  /** Personas que pueden hacerse cargo del caso en su faena. */
  assignees?: { id: string; name: string }[]
}

export interface FuelInboxItem extends FuelInboxItemDetail {
  extras: FuelInboxItemExtras
}

export type { FuelInboxEvidence }

/** Vista de «Decididas»: cada valor sólo aplica a un tipo. */
export const FUEL_INBOX_DECISIONS = ["cuenta", "no-cuenta", "resuelto", "descartado"] as const
export type FuelInboxDecision = (typeof FUEL_INBOX_DECISIONS)[number]

export const FUEL_INBOX_DECISION_LABELS: Record<FuelInboxDecision, string> = {
  cuenta: "Cuentan",
  "no-cuenta": "No cuentan",
  resuelto: "Casos resueltos",
  descartado: "Casos descartados",
}

export function isFuelInboxDecision(value: string | undefined): value is FuelInboxDecision {
  return (FUEL_INBOX_DECISIONS as readonly string[]).includes(value ?? "")
}

/** Tipos de la bandeja que tienen decisiones con ese nombre: cada valor de `decision` sólo existe para un tipo. */
export function decisionKindsFor(decision: string | undefined): FuelInboxKind[] {
  if (decision === "cuenta" || decision === "no-cuenta") return ["carga"]
  if (decision === "resuelto" || decision === "descartado") return ["caso"]
  return [...FUEL_INBOX_KINDS]
}
