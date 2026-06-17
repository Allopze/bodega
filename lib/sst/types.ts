// ============================================================
// SST Domain Types — Chome SST Checklists
// Ported from app_cumplimiento/src/shared/types.ts
// (DB record types are excluded — inferred from Drizzle schema)
// ============================================================

// --- Checklist Schema Types (schema-driven engine) ---

export type FieldKind =
  | 'cumple_nocumple_obs'
  | 'cumple_nocumple_na_obs'
  | 'entregado_obs'
  | 'apto_obs'
  | 'si_no_obs'
  | 'text'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'signature'
  | 'readonly'

export type StatusValue =
  | 'cumple'
  | 'no_cumple'
  | 'na'
  | 'entregado'
  | 'no_entregado'
  | 'apto'
  | 'no_apto'
  | 'si'
  | 'no'
  | null

export interface SelectOption {
  value: string
  label: string
}

export interface ChecklistItem {
  id: string
  label: string
  kind: FieldKind
  options?: SelectOption[]       // for select/multiselect
  placeholder?: string           // for text fields
  required?: boolean
}

export interface ChecklistSection {
  id: string
  title: string
  description?: string
  items: ChecklistItem[]
  appliesWhen?: CargoCondition[]  // only show for specific cargos
  countsForCompliance?: boolean   // whether items count toward % calculation
  hasActionCorrectiva?: boolean   // adds "Acción correctiva" column
}

export type Cargo = string

export type CargoCondition = Cargo

export interface ChecklistDefinition {
  code: string
  version: string
  revisionDate: string
  title: string
  tipo: TipoEvaluacion
  subtitle?: string
  legalFramework: string[]
  applicableTo: string
  objective?: string
  frequencySuggested?: string
  evaluationCriteria?: string
  sections: ChecklistSection[]
  closingAct: ClosingActDefinition
}

export interface ClosingActDefinition {
  title: string
  resultOptions: SelectOption[]
  hasRestrictions?: boolean
  signatureRoles: string[]
}

// --- Evaluation Domain Types ---

export type TipoEvaluacion = 'nuevo' | 'seguimiento'
export type EstadoEvaluacion = 'borrador' | 'cerrado'

export type MotivoSeguimiento =
  | 'control_periodico'
  | 'post_incidente_persona'
  | 'post_incidente_material'
  | 'post_incidente_ambiental'
  | 'cuasi_accidente'
  | 'incumplimiento_procedimiento'
  | 'reincidencia'
  | 'reincorporacion'
  | 'otro'

export type ResultadoFinal =
  | 'habilitado_autonomo'
  | 'habilitado_restricciones'
  | 'no_habilitado'
  | 'requiere_reforzamiento'
  | null

export type ResultadoEficacia =
  | 'eficaz'
  | 'parcialmente_eficaz'
  | 'no_eficaz'
  | null

// --- Utility Types ---

export interface ComplianceResult {
  cumplidos: number
  noCumplidos: number
  na: number
  total: number
  percentage: number
}

export interface EfficacyResult {
  percentage: number
  classification: ResultadoEficacia
  hasCriticalDeviation: boolean
  hasReincidence: boolean
}
