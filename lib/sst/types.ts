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
  /** Escala B/R/M (Anexo 13 Carros): Bueno / Regular / Malo, sin escape. */
  | 'bueno_regular_malo_obs'
  /** B/R/M + N/A (Anexo 3 EPP). */
  | 'bueno_regular_malo_na_obs'
  /** B/R/M + N/A + NT "no tiene" (Anexo 14 Contenedores). */
  | 'bueno_regular_malo_na_nt_obs'
  | 'text'
  /** Texto libre multilínea (relato/descripción). `text` es de una sola línea. */
  | 'textarea'
  /**
   * Lectura numérica (horómetro, odómetro, litros). Distinto de `text` porque
   * su valor se calcula: alimenta `maintenance_records.hourMeterReading` al
   * derivar una mantención desde un hallazgo. Guardado como `recorded`, igual
   * que el resto de los campos de dato.
   */
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'signature'
  | 'readonly'

export type StatusValue =
  | 'cumple'
  /**
   * Estado intermedio de las escalas B/R/M (Bueno / Regular / Malo) de los
   * anexos de inspección. Puntúa 0.5 — ver PARTIAL_STATUSES en
   * `lib/sst/compliance.ts`.
   */
  | 'regular'
  | 'no_cumple'
  | 'na'
  /**
   * "NT = NO TIENE" del Anexo 14 (Contenedores): el componente no existe en el
   * sujeto inspeccionado. Distinto de 'na' ("no aplica"), pero puntúa igual —
   * ambos salen del denominador.
   */
  | 'no_tiene'
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
  /**
   * Daño potencial del hallazgo si este ítem resulta 'no_cumple' (solo PDTP).
   * Deriva prioridad/plazo automáticos de la acción correctiva generada —
   * ver PDTP_DANO_POTENCIAL_A_PRIORIDAD en lib/services/pdtp/checklist-domain.ts.
   * Ítems sin este campo caen al default ("media", +7 días).
   */
  danoPotencial?: 'leve' | 'moderado' | 'grave' | 'fatal'
}

export interface ChecklistSection {
  id: string
  title: string
  description?: string
  items: ChecklistItem[]
  appliesWhen?: CargoCondition[]  // only show for specific cargos
  countsForCompliance?: boolean   // whether items count toward % calculation
  hasActionCorrectiva?: boolean   // adds "Acción correctiva" column
  requiresPermission?: string     // gate: only users with this permission can view/edit this section
  weekNumber?: 1 | 2 | 3 | 4     // set for acompanamiento_terreno_sN weekly sections (conductor_lider)
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

/**
 * Rol del evaluador que crea la evaluación.
 * - 'prevencionista_faena': evalúa secciones 1-2 de trabajador nuevo y todas de trabajador antiguo
 * - 'admin_contrato': idem prevencionista_faena (ambas definiciones, mismas secciones)
 * - 'conductor_lider': evalúa SOLO secciones 3.x de acompañamiento en terreno
 * - null: legado (evaluaciones creadas antes de la separación por rol)
 */
export type EvaluatorRole = 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'

/** Estado de una sub-evaluación semanal del conductor líder */
export type WeeklyEvalState = 'bloqueada' | 'pendiente' | 'completada'

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
  /** Respuestas 'regular' (escala B/R/M). Puntúan 0.5 en `percentage`. */
  regulares: number
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
