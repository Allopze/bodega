import type { FieldKind } from "@/lib/sst/types"

export interface RunInfo {
  id: string
  code: string
  status: string
  origin: string
  subjectType: string | null
  subjectLabel: string | null
  subjectResourceId: string | null
  /** Equipo de flota inspeccionado; habilita derivar a mantención. */
  subjectVehicleId: string | null
  scheduledFor: string | null
  executedAt: string | null
  reviewedAt: string | null
  reviewComment: string | null
  conformingCount: number
  partialCount: number
  nonConformingCount: number
  notApplicableCount: number
  compliancePercent: number | null
  officialComplianceBasisPoints: number | null
  normalizedComplianceBasisPoints: number | null
  executedByUserId: string | null
  closingResult: string | null
  closingRestrictions: string | null
  closingSignatures: { role: string; name: string; userId: string | null; signedAt: string }[] | null
  locationLatitude: string | null
  locationLongitude: string | null
  version: number
}

export interface ItemInfo {
  id: string
  label: string
  kind?: FieldKind
  required: boolean
  countsForCompliance: boolean
  danoPotencial: string | null
  options?: { value: string; label: string }[]
  placeholder?: string
  matrix?: { rowId: string; rowLabel: string; columnLabel: string }
}

export interface SectionInfo {
  id: string
  title: string
  items: ItemInfo[]
}

export interface AnswerInfo {
  /** Id de la fila persistida: es a lo que cuelga la evidencia (función #1). */
  answerId: string
  sectionId: string
  itemId: string
  result: string
  comment: string | null
  /** Respuesta de los ítems que no puntúan (B-08). */
  value: string | null
  /** Fotos adjuntas a esta respuesta (función #1). */
  evidence: { id: string; path: string; caption: string | null }[]
  /** La pre-llenó el reconocimiento y falta ratificarla (sólo ítems `fatal`). */
  needsConfirmation: boolean
}

export interface FindingInfo {
  id: string
  description: string
  criticality: string
  status: string
  capaActionId: string | null
  /** `derived` lo levantó un ítem; `deviation` lo registró una persona. */
  origin: string
  potentialDamageDescription: string | null
  immediateMeasure: string | null
  applicableLaw: string | null
  evidence: { id: string; path: string; caption: string | null }[]
}

export type ResultValue = "" | "conforming" | "partial" | "non_conforming" | "not_applicable" | "recorded"
export interface Draft { result: ResultValue; comment: string; value: string; needsConfirmation: boolean }

/** La planilla física subida y, cuando exista el detector, lo que leyó. */
export interface RunDocumentInfo {
  id: string
  path: string
  caption: string | null
  createdAt: string
}
