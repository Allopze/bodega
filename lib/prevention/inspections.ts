import { PARTIAL_STATUS_WEIGHT } from "@/lib/sst/compliance"
import type { FieldKind } from "@/lib/sst/types"

export const INSPECTION_KIND_LABELS: Record<string, string> = {
  inspection: "Inspección",
  observation: "Observación planeada",
  audit: "Auditoría",
}

export const INSPECTION_RUN_STATUS_LABELS: Record<string, string> = {
  planned: "Planificada",
  in_progress: "En ejecución",
  completed: "Ejecutada",
  reviewed: "Revisada y cerrada",
  cancelled: "Cancelada",
}

export const INSPECTION_RESULT_LABELS: Record<string, string> = {
  conforming: "Cumple",
  // "Regular" (escala B/R/M): puntúa 0,5 — ver PARTIAL_STATUS_WEIGHT en
  // lib/sst/compliance.ts. H-04, AUDITORIA_BUGS_2026-08-05.md.
  partial: "Regular",
  non_conforming: "No cumple",
  not_applicable: "No aplica",
  /**
   * Ítems que no puntúan (`text`, `textarea`, `date`, `select`…): su respuesta
   * es el `value`, no un juicio de conformidad. Antes no tenían dónde
   * guardarse y el formulario les ofrecía "Cumple / No cumple" sobre un relato
   * libre (B-08, auditoría 2026-08-18).
   */
  recorded: "Registrado",
}

export const FINDING_CRITICALITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

export const FINDING_STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  capa_linked: "Con CAPA",
  closed: "Cerrado",
}

export const INSPECTION_FREQUENCY_LABELS: Record<string, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  biannual: "Semestral",
  annual: "Anual",
  on_demand: "A demanda",
}

/** Días entre ejecuciones por frecuencia. Es el default; el programa lo puede sobrescribir. */
export const FREQUENCY_INTERVAL_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  biannual: 182,
  annual: 365,
  on_demand: 365,
}

export function runStatusBadgeVariant(status: string): "default" | "info" | "success" | "warning" | "outline" {
  if (status === "reviewed") return "success"
  if (status === "completed") return "info"
  if (status === "in_progress") return "warning"
  if (status === "cancelled") return "outline"
  return "default"
}

/**
 * Variante del badge de una respuesta. 'partial' tiene su propia rama a
 * propósito: antes de H-04 un estado no reconocido caía al `else` de
 * "success" (verde) por accidente — exactamente el riesgo que introducir un
 * estado nuevo sin actualizar este mapeo habría repetido.
 */
export function resultBadgeVariant(result: string): "success" | "warning" | "danger" | "outline" {
  if (result === "non_conforming") return "danger"
  if (result === "partial") return "warning"
  if (result === "not_applicable") return "outline"
  // 'recorded' no es conformidad: pintarlo verde afirmaría algo que el ítem
  // nunca evaluó. Es exactamente el accidente que el comentario de arriba
  // advierte para todo estado nuevo que caiga al `return` final.
  if (result === "recorded") return "outline"
  return "success"
}

export function criticalityBadgeVariant(criticality: string): "default" | "warning" | "danger" {
  if (criticality === "critical" || criticality === "high") return "danger"
  if (criticality === "medium") return "warning"
  return "default"
}

/**
 * El daño potencial declarado en la plantilla define la criticidad del
 * hallazgo. No la decide quien ejecuta en terreno: así dos personas frente al
 * mismo incumplimiento producen la misma severidad.
 *
 * Un ítem sin `danoPotencial` cae a `medium`, igual que el default histórico
 * del checklist PDTP.
 */
export function criticalityFromDanoPotencial(dano: string | null | undefined): "low" | "medium" | "high" | "critical" {
  switch (dano) {
    case "fatal": return "critical"
    case "grave": return "high"
    case "leve": return "low"
    case "moderado": return "medium"
    default: return "medium"
  }
}

/**
 * Prioridad, plazo y respuesta de terreno de la CAPA derivada.
 *
 * `requiresImmediateStop` separa dos cosas que no son la misma: detener la
 * tarea en el acto —respuesta inmediata por definición— y el plazo
 * administrativo para cerrar la acción con evidencia. Expresar la urgencia
 * como un plazo de cero días sólo produce acciones vencidas al nacer.
 */
export function capaPriorityForCriticality(criticality: string): {
  priority: "low" | "medium" | "high" | "critical"
  dueInDays: number
  requiresImmediateStop: boolean
} {
  switch (criticality) {
    case "critical": return { priority: "critical", dueInDays: 3, requiresImmediateStop: true }
    case "high": return { priority: "high", dueInDays: 7, requiresImmediateStop: false }
    case "low": return { priority: "low", dueInDays: 30, requiresImmediateStop: false }
    default: return { priority: "medium", dueInDays: 15, requiresImmediateStop: false }
  }
}

/** Ítems con escala B/R/M (Bueno/Regular/Malo): los únicos que admiten 'partial'. */
const BRM_KINDS: readonly FieldKind[] = [
  "bueno_regular_malo_obs",
  "bueno_regular_malo_na_obs",
  "bueno_regular_malo_na_nt_obs",
]

/** ¿Este tipo de ítem admite la respuesta intermedia 'partial' (Regular)? */
export function fieldKindAcceptsPartial(kind: FieldKind | null | undefined): boolean {
  return kind !== null && kind !== undefined && BRM_KINDS.includes(kind)
}

/**
 * Tipos de campo que NO expresan un juicio de conformidad: su respuesta es un
 * dato (`value`), no cumple/no cumple. `observacion_planeada` es 100% de estos
 * —un relato libre— y `inspeccion_extintores` mezcla ambos (N° de serie, fecha
 * de vencimiento de carga, tipo).
 */
const NON_SCORABLE_KINDS: readonly FieldKind[] = [
  "text",
  "number",
  "textarea",
  "date",
  "select",
  "multiselect",
  "signature",
  "readonly",
]

/**
 * ¿Este ítem se puntúa en el porcentaje de cumplimiento?
 *
 * Discriminador único: ningún otro sitio debe reimplementar la lista. Un ítem
 * sin `kind` declarado se trata como puntuable, que es el comportamiento
 * histórico de todo el catálogo booleano.
 */
export function fieldKindIsScorable(kind: FieldKind | null | undefined): boolean {
  if (kind === null || kind === undefined) return true
  return !NON_SCORABLE_KINDS.includes(kind)
}

export interface InspectionItemSpec {
  sectionId: string
  itemId: string
  label: string
  required: boolean
  countsForCompliance: boolean
  danoPotencial?: string | null
  /**
   * Tipo de campo del catálogo SST (lib/sst/types.ts). Determina si el ítem
   * admite 'partial' — sin esto se perdía la escala B/R/M al aplanar la
   * definición (H-04, AUDITORIA_BUGS_2026-08-05.md) — y si puntúa
   * (`fieldKindIsScorable`, B-08).
   */
  kind?: FieldKind
  /** Opciones del `select`. Sin ellas la UI no puede pintar el campo. */
  options?: { value: string; label: string }[]
  placeholder?: string
}

export type InspectionResult = "conforming" | "partial" | "non_conforming" | "not_applicable" | "recorded"

export interface InspectionAnswerInput {
  sectionId: string
  itemId: string
  result: InspectionResult
  comment?: string | null
  /** Respuesta de los ítems que no puntúan: es el dato en sí, no un juicio. */
  value?: string | null
  /**
   * La pre-llenó el reconocimiento de la planilla y falta que una persona la
   * ratifique. Sólo la marca la ingesta, y sólo en ítems `fatal`.
   */
  needsConfirmation?: boolean
}

/** Largo mínimo de la observación que justifica un 'no aplica' o un 'Regular'. */
export const ANSWER_COMMENT_MIN_LENGTH = 3

/**
 * Valida una respuesta contra el ítem al que responde. Devuelve el mensaje de
 * error, o `null` si es válida.
 *
 * Vive aquí, pura, porque la consumen **los dos lados**: el servicio antes de
 * tocar la BD y el formulario antes de enviar. Antes de B-03 la única guarda
 * era el CHECK `prevention_inspection_answer_requires_comment` de Postgres, que
 * reventaba el INSERT en lote completo —perdiendo las respuestas válidas del
 * mismo guardado— y devolvía el texto crudo de la violación al usuario.
 */
export function validateAnswerRow(
  item: Pick<InspectionItemSpec, "label" | "kind">,
  answer: Pick<InspectionAnswerInput, "result" | "comment" | "value">,
): string | null {
  // B-08: el vocabulario de conformidad y el de dato no se mezclan. Marcar
  // "Cumple" sobre un relato libre, o "Registrado" sobre un ítem que sí se
  // puntúa, corrompe el cálculo de cumplimiento en direcciones opuestas.
  const scorable = fieldKindIsScorable(item.kind)
  if (!scorable && answer.result !== "recorded") {
    return `"${item.label}" no se evalúa como cumple/no cumple: se responde con su contenido.`
  }
  if (scorable && answer.result === "recorded") {
    return `"${item.label}" exige una respuesta de conformidad, no un valor registrado.`
  }
  if (answer.result === "recorded" && (answer.value?.trim().length ?? 0) === 0) {
    return `"${item.label}" requiere un valor.`
  }
  if (item.kind === "number" && answer.result === "recorded") {
    const raw = answer.value?.trim() ?? ""
    // "134.122" en el papel son ciento treinta y cuatro mil, no 134,122.
    // `Number()` lo acepta en silencio y el horómetro entra mil veces menor,
    // que después viaja a `maintenance_records.hourMeterReading`. Se rechaza
    // el patrón de separador de miles en vez de adivinar cuál quiso decir.
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
      return `"${item.label}": escribe el número sin separador de miles (${raw.replace(/\./g, "")}).`
    }
    const parsed = Number(raw.replace(",", "."))
    if (!Number.isFinite(parsed) || parsed < 0) {
      return `"${item.label}" requiere un número válido de 0 o más.`
    }
  }
  // 'partial' (Regular) sólo existe en la escala B/R/M — aceptarlo en un ítem
  // cumple/no-cumple inventaría un estado que ese ítem no tiene.
  if (answer.result === "partial" && !fieldKindAcceptsPartial(item.kind)) {
    return `"${item.label}" no admite la respuesta "Regular".`
  }
  if (answer.result === "not_applicable" && (answer.comment?.trim().length ?? 0) < ANSWER_COMMENT_MIN_LENGTH) {
    return `"${item.label}": un "No aplica" exige indicar el motivo (mínimo ${ANSWER_COMMENT_MIN_LENGTH} caracteres).`
  }
  if (answer.result === "partial" && (answer.comment?.trim().length ?? 0) < ANSWER_COMMENT_MIN_LENGTH) {
    return `"${item.label}": un "Regular" exige justificarse por escrito (mínimo ${ANSWER_COMMENT_MIN_LENGTH} caracteres).`
  }
  return null
}

export interface ComplianceSummary {
  conforming: number
  /** Respuestas 'partial' (Regular, escala B/R/M). Puntúan 0,5 en `compliancePercent`. */
  partial: number
  nonConforming: number
  notApplicable: number
  /**
   * Porcentaje sobre los ítems que cuentan para cumplimiento y fueron
   * respondidos como cumple/regular/no cumple. Los "no aplica" salen del
   * denominador: incluirlos castigaría o premiaría según cuántos ítems no
   * correspondan. Sin ítems evaluables devuelve `null`, no 0: no es cero
   * cumplimiento, es cumplimiento no calculable.
   *
   * Misma fórmula que `calculateCompliance` en lib/sst/compliance.ts —
   * (cumplidos + 0,5·regulares) / total — para que un mismo checklist B/R/M
   * puntúe igual sin importar por qué motor pasó (H-04).
   */
  compliancePercent: number | null
}

export function summarizeCompliance(items: InspectionItemSpec[], answers: InspectionAnswerInput[]): ComplianceSummary {
  const spec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))
  let conforming = 0
  let partial = 0
  let nonConforming = 0
  let notApplicable = 0
  let scored = 0
  let scoredPoints = 0

  for (const answer of answers) {
    const item = spec.get(`${answer.sectionId}::${answer.itemId}`)
    if (answer.result === "conforming") conforming += 1
    else if (answer.result === "partial") partial += 1
    else if (answer.result === "non_conforming") nonConforming += 1
    // `else if` explícito, no `else`: el `else` capturaba como "no aplica"
    // cualquier estado desconocido, así que 'recorded' habría inflado ese
    // contador. Un dato registrado no es una exclusión.
    else if (answer.result === "not_applicable") notApplicable += 1

    if (!item?.countsForCompliance) continue
    if (answer.result === "not_applicable" || answer.result === "recorded") continue
    scored += 1
    if (answer.result === "conforming") scoredPoints += 1
    else if (answer.result === "partial") scoredPoints += PARTIAL_STATUS_WEIGHT
  }

  return {
    conforming,
    partial,
    nonConforming,
    notApplicable,
    compliancePercent: scored === 0 ? null : Math.round((scoredPoints / scored) * 100),
  }
}

export interface DerivedFinding {
  sectionId: string
  itemId: string
  description: string
  criticality: "low" | "medium" | "high" | "critical"
}

/** Cada respuesta no conforme produce un hallazgo con su criticidad derivada. */
export function deriveFindings(items: InspectionItemSpec[], answers: InspectionAnswerInput[]): DerivedFinding[] {
  const spec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))
  const findings: DerivedFinding[] = []
  for (const answer of answers) {
    if (answer.result !== "non_conforming") continue
    const item = spec.get(`${answer.sectionId}::${answer.itemId}`)
    if (!item) continue
    findings.push({
      sectionId: answer.sectionId,
      itemId: answer.itemId,
      description: answer.comment?.trim() ? `${item.label}: ${answer.comment.trim()}` : item.label,
      criticality: criticalityFromDanoPotencial(item.danoPotencial),
    })
  }
  return findings
}

export interface CompletionBlocker {
  kind: "missing_required" | "missing_na_reason" | "missing_partial_reason" | "missing_closing_act" | "unconfirmed_critical"
  detail: string
}

/**
 * Ítems cuya respuesta pre-llenada por el reconocimiento exige ratificación
 * humana antes de cerrar la subida.
 *
 * Son los de daño potencial `fatal` —frenos, dirección, sistema de acople—.
 * El reconocimiento sí los pre-llena (decisión del 2026-08-19), pero leídos al
 * revés dejan el equipo operando con la falla que mata, así que no pueden
 * quedar aprobados por omisión: el resto del formulario sí.
 */
export function requiresHumanConfirmation(item: Pick<InspectionItemSpec, "danoPotencial">): boolean {
  return item.danoPotencial === "fatal"
}

/* ── Acta de cierre (función #2) ──────────────────────────────────────────
 * Cada definición del catálogo declara `closingAct` con su resultado global y
 * los roles que firman, y el motor la descartaba entera.
 */

export interface ClosingActSpec {
  title: string
  resultOptions: { value: string; label: string }[]
  hasRestrictions: boolean
  signatureRoles: string[]
}

export interface ClosingActInput {
  result: string
  restrictions?: string | null
  /** Firma registrada: rol, nombre y momento. Sin trazo manuscrito. */
  signatures: { role: string; name: string; userId?: string | null }[]
}

/** Extrae el acta del snapshot de la plantilla; `null` si no declara resultados. */
export function closingActFromDefinition(definition: {
  closingAct?: {
    title?: string
    resultOptions?: { value: string; label: string }[]
    hasRestrictions?: boolean
    signatureRoles?: string[]
  }
}): ClosingActSpec | null {
  const act = definition.closingAct
  if (!act?.resultOptions?.length) return null
  return {
    title: act.title ?? "Cierre",
    resultOptions: act.resultOptions,
    hasRestrictions: act.hasRestrictions ?? false,
    signatureRoles: act.signatureRoles ?? [],
  }
}

/**
 * Valida el acta contra lo que declara la plantilla. Devuelve el mensaje de
 * error o `null`.
 *
 * `resultOptions` es dinámico por plantilla, así que no puede ser un CHECK de
 * base: la validación vive aquí y la consumen el servicio y el formulario.
 */
export function validateClosingAct(spec: ClosingActSpec, act: ClosingActInput | null | undefined): string | null {
  if (!act) return `Falta completar el acta de cierre "${spec.title}".`
  if (!spec.resultOptions.some((option) => option.value === act.result)) {
    return `El resultado del acta no corresponde a las opciones de la plantilla.`
  }
  const signed = new Set(act.signatures.filter((item) => item.name.trim().length > 0).map((item) => item.role))
  const missing = spec.signatureRoles.filter((role) => !signed.has(role))
  if (missing.length > 0) {
    return `Faltan firmas del acta: ${missing.join(", ")}.`
  }
  return null
}

/**
 * Una inspección no se declara ejecutada con ítems obligatorios sin responder.
 *
 * Piso de seguridad: el catálogo SST heredado no declara `required` en ningún
 * ítem, así que confiar sólo en esa marca dejaría el gate inerte y permitiría
 * cerrar una inspección sin una sola respuesta. Cuando la plantilla no declara
 * obligatorios, se exigen todos los ítems que cuentan para cumplimiento. En
 * cuanto Prevención marque obligatorios reales, manda la marca por ítem.
 */
export function assessRunCompletion(
  items: InspectionItemSpec[],
  answers: InspectionAnswerInput[],
  /** Acta declarada por la plantilla y lo que el ejecutante llenó (función #2). */
  closing?: { spec: ClosingActSpec | null; act: ClosingActInput | null | undefined },
): { allowed: boolean; blockers: CompletionBlocker[] } {
  const answered = new Map(answers.map((answer) => [`${answer.sectionId}::${answer.itemId}`, answer]))
  const blockers: CompletionBlocker[] = []

  for (const item of items) {
    // Unión, no ternario. El criterio anterior era
    // `declaresRequired ? item.required : item.countsForCompliance`, y como
    // `observacion_planeada` es la ÚNICA definición del catálogo que declara
    // `required: true`, el piso de seguridad se apagaba justo donde más falta
    // hacía y quedaba activo donde no. Ahora cada ítem se juzga solo: es
    // obligatorio si lo declara, o si puntúa para el cumplimiento (C-04).
    const mustAnswer = item.required || (item.countsForCompliance && fieldKindIsScorable(item.kind))
    if (!mustAnswer) continue
    const answer = answered.get(`${item.sectionId}::${item.itemId}`)
    if (!answer) {
      blockers.push({ kind: "missing_required", detail: item.label })
      continue
    }
    // Un ítem que no puntúa se responde con su `value`; sin contenido, no está
    // respondido por más que exista la fila.
    if (!fieldKindIsScorable(item.kind) && (answer.value?.trim().length ?? 0) === 0) {
      blockers.push({ kind: "missing_required", detail: item.label })
      continue
    }
    if (answer.result === "not_applicable" && (answer.comment?.trim().length ?? 0) < ANSWER_COMMENT_MIN_LENGTH) {
      blockers.push({ kind: "missing_na_reason", detail: item.label })
    }
    // 'Regular' (escala B/R/M) exige justificarse por escrito, igual que en
    // el motor SST — ver requiresObservation en lib/sst/compliance.ts.
    if (answer.result === "partial" && (answer.comment?.trim().length ?? 0) < ANSWER_COMMENT_MIN_LENGTH) {
      blockers.push({ kind: "missing_partial_reason", detail: item.label })
    }
  }
  // Ratificación de lo que leyó la máquina en los ítems que matan. Va después
  // del recorrido de obligatorios para que el mensaje liste sólo lo que queda
  // realmente pendiente de confirmar, no lo que además falta responder.
  for (const answer of answers) {
    if (!answer.needsConfirmation) continue
    const item = items.find((entry) => entry.sectionId === answer.sectionId && entry.itemId === answer.itemId)
    if (!item || !requiresHumanConfirmation(item)) continue
    blockers.push({ kind: "unconfirmed_critical", detail: item.label })
  }

  // El acta sólo se exige si la plantilla la declara. `closing` es opcional
  // para no romper a los llamadores que sólo evalúan las respuestas.
  if (closing?.spec) {
    const problem = validateClosingAct(closing.spec, closing.act)
    if (problem) blockers.push({ kind: "missing_closing_act", detail: problem })
  }
  return { allowed: blockers.length === 0, blockers }
}

export interface ReviewBlocker {
  kind: "executor_is_reviewer" | "critical_finding_without_capa"
  detail: string
}

/**
 * Criticidades que **obligan** a una acción correctiva: sin ella la inspección
 * no cierra.
 *
 * `medium` queda deliberadamente fuera. Se evaluó incluirlo (2026-08-23) y se
 * descartó al ver el costo con la calibración real de desviaciones: la mayoría
 * de lo que levanta una caminata semanal o una inspección de área cae en
 * moderado, así que obligar CAPA ahí convierte un recorrido de seis hallazgos
 * en cinco acciones con plazo y responsable. El seguimiento formal se reserva
 * para lo que tiene consecuencia grave; el resto se cierra con su motivo.
 *
 * Vive acá y no como literal repetido porque la regla gobierna dos puertas —el
 * cierre de la inspección y el aviso a las 48 h— y tenerla escrita dos veces
 * garantiza que alguna se quede atrás. Cambiar el criterio es cambiar esta
 * lista, en un solo lugar.
 *
 * Ojo: la propuesta de sacar un equipo de servicio NO usa esta lista, aunque
 * hoy coincidan. Que un hallazgo exija acción correctiva no es lo mismo que
 * detener un camión en faena: son dos decisiones y pueden divergir.
 */
export const CAPA_REQUIRED_CRITICALITIES = ["high", "critical"] as const

export function requiresCapa(criticality: string): boolean {
  return (CAPA_REQUIRED_CRITICALITIES as readonly string[]).includes(criticality)
}

/**
 * Revisar y cerrar exige independencia de quien ejecutó y que todo hallazgo alto
 * o crítico tenga una CAPA enlazada — ver `CAPA_REQUIRED_CRITICALITIES`. Un
 * hallazgo grave sin acción es exactamente lo que la auditoría no acepta como
 * cierre.
 */
export function assessRunReview(args: {
  executedByUserId: string | null
  reviewerUserId: string
  findings: { id: string; description: string; criticality: string; capaActionId: string | null }[]
}): { allowed: boolean; blockers: ReviewBlocker[] } {
  const blockers: ReviewBlocker[] = []
  if (args.executedByUserId && args.executedByUserId === args.reviewerUserId) {
    blockers.push({ kind: "executor_is_reviewer", detail: "Quien ejecutó la inspección no puede revisarla y cerrarla." })
  }
  for (const finding of args.findings) {
    if (requiresCapa(finding.criticality) && !finding.capaActionId) {
      blockers.push({ kind: "critical_finding_without_capa", detail: `El hallazgo "${finding.description}" es ${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality} y no tiene CAPA.` })
    }
  }
  return { allowed: blockers.length === 0, blockers }
}

/* ── Motor de transiciones del run ────────────────────────────────────────
 * Una sola puerta para cancelar, reabrir y cerrar, al estilo de
 * `assertCapaTransition` (lib/services/prevention-capa.ts). Tres funciones
 * ad-hoc serían tres lugares donde olvidar una guarda.
 */

export type InspectionRunStatus = "planned" | "in_progress" | "completed" | "reviewed" | "cancelled"

export const RUN_TRANSITIONS: Record<InspectionRunStatus, readonly InspectionRunStatus[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  // Reabrir devuelve a `in_progress`: rectificar es volver a ejecutar, no un
  // estado nuevo.
  completed: ["reviewed", "in_progress", "cancelled"],
  reviewed: ["in_progress"],
  cancelled: [],
}

/**
 * Permiso exigido según el estado destino.
 *
 * Reabrir pide `:review` y no `:execute` a propósito: deshacer una ejecución
 * declarada es una decisión de supervisión, no de terreno.
 */
export const RUN_TRANSITION_PERMISSION: Record<InspectionRunStatus, string> = {
  planned: "prevention:inspections:manage",
  in_progress: "prevention:inspections:review",
  completed: "prevention:inspections:execute",
  reviewed: "prevention:inspections:review",
  cancelled: "prevention:inspections:manage",
}

/** Motivo mínimo para las transiciones que destruyen o revierten trabajo. */
export const TRANSITION_REASON_MIN_LENGTH = 10

export function requireTransitionReason(reason: string | undefined, label: string, min = TRANSITION_REASON_MIN_LENGTH) {
  if ((reason?.trim().length ?? 0) < min) {
    throw new Error(`${label} requiere un motivo de al menos ${min} caracteres.`)
  }
}

/**
 * Guarda única de una transición de estado del run: legalidad, permiso, motivo
 * e independencia del revisor.
 *
 * `assessRunReview` sigue existiendo como la vista que consume el formulario
 * de revisión; esta función es la que el servicio no puede saltarse.
 */
export function assertInspectionRunTransition(args: {
  fromStatus: InspectionRunStatus
  toStatus: InspectionRunStatus
  permissions: readonly string[]
  actorUserId: string
  executedByUserId?: string | null
  reason?: string
  findings?: { id: string; description: string; criticality: string; capaActionId: string | null }[]
}) {
  if (!RUN_TRANSITIONS[args.fromStatus].includes(args.toStatus)) {
    throw new Error(`Transición inválida: ${INSPECTION_RUN_STATUS_LABELS[args.fromStatus] ?? args.fromStatus} → ${INSPECTION_RUN_STATUS_LABELS[args.toStatus] ?? args.toStatus}.`)
  }
  if (!args.permissions.includes(RUN_TRANSITION_PERMISSION[args.toStatus])) {
    throw new Error("Inspección no encontrada o fuera de alcance.")
  }
  // Cancelar destruye una ejecución planificada; reabrir borra cumplimiento y
  // hallazgos ya calculados. Ambas exigen dejar dicho por qué.
  if (args.toStatus === "cancelled") requireTransitionReason(args.reason, "Cancelar la inspección")
  if (args.toStatus === "in_progress") requireTransitionReason(args.reason, "Reabrir la inspección")

  if (args.toStatus === "reviewed") {
    const review = assessRunReview({
      executedByUserId: args.executedByUserId ?? null,
      reviewerUserId: args.actorUserId,
      findings: args.findings ?? [],
    })
    if (!review.allowed) {
      throw new Error(`No se puede cerrar la inspección: ${review.blockers.map((item) => item.detail).join(" ")}`)
    }
  }
}

export interface EnrichmentCoverage {
  totalItems: number
  withDanoPotencial: number
  withRequired: number
  /** `true` cuando ningún ítem declara daño potencial. */
  criticalityInert: boolean
}

/**
 * Mide cuánto de la plantilla está realmente calibrado.
 *
 * `danoPotencial` es el campo que gobierna la criticidad del hallazgo aquí y
 * la prioridad y el plazo de la acción correctiva en PDTP: sin él, todo cae al
 * default medio, incluidos incumplimientos de consecuencia fatal. La mayoría
 * del catálogo SST ya lo declara (auditoría 2026-08-18); la excepción es
 * `observacion_planeada`, cuyo formulario es un relato libre sin ítems
 * puntuables.
 *
 * Esta función no inventa severidades —eso lo decide Prevención— pero deja el
 * vacío a la vista en la bandeja y en la exportación, en vez de degradarse en
 * silencio.
 */
export function assessEnrichmentCoverage(items: InspectionItemSpec[]): EnrichmentCoverage {
  const withDanoPotencial = items.filter((item) => Boolean(item.danoPotencial)).length
  return {
    totalItems: items.length,
    withDanoPotencial,
    withRequired: items.filter((item) => item.required).length,
    criticalityInert: items.length > 0 && withDanoPotencial === 0,
  }
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/**
 * Próximo vencimiento de una programación, anclado a la fecha comprometida.
 *
 * Antes se calculaba `addDays(hoy, intervalDays)` al completar la ejecución
 * (A-12): una inspección mensual ejecutada con 20 días de atraso corría el
 * calendario 20 días, y el corrimiento se acumulaba hasta convertir una
 * obligación mensual en una de ~50 días sin que nada lo señalara.
 *
 * Avanza desde `dueOn` y, si eso sigue en el pasado, rueda en intervalos
 * completos hasta superar hoy: un programa diario abandonado seis meses genera
 * UNA ejecución, no 180.
 */
export function nextDueAfter(dueOn: string, intervalDays: number, today: string): string {
  const step = Math.max(1, Math.trunc(intervalDays))
  let next = addDays(dueOn, step)
  if (next > today) return next
  // Salto directo en vez de bucle: con un programa diario abandonado años,
  // iterar día a día sería miles de vueltas.
  const gapDays = Math.floor((Date.parse(`${today}T12:00:00.000Z`) - Date.parse(`${next}T12:00:00.000Z`)) / 86_400_000)
  const periods = Math.floor(gapDays / step) + 1
  next = addDays(next, periods * step)
  // Red de seguridad ante bordes de redondeo: nunca devolver una fecha pasada.
  while (next <= today) next = addDays(next, step)
  return next
}

/* ── Origen de la inspección y oportunidad del cierre ──────────────────────
 * La certificación Mutual distingue las inspecciones del comité paritario de
 * las del Departamento de Prevención, y pide demostrar seguimiento de las
 * medidas que generan. El indicador de cierre oportuno responde eso: no cuántos
 * hallazgos hubo, sino cuántos se cerraron dentro del plazo comprometido.
 */

export const INSPECTION_ORIGIN_LABELS: Record<string, string> = {
  prevencion: "Departamento de Prevención",
  cphs: "Comité Paritario",
  mandante: "Mandante",
}

export interface FindingClosureRow {
  /** Plazo comprometido de la acción correctiva, `YYYY-MM-DD`. */
  targetDate: string | null
  /** Fecha de cierre efectivo, `YYYY-MM-DD`; `null` si sigue abierto. */
  closedOn: string | null
}

export interface TimelyClosureSummary {
  /** Hallazgos con acción correctiva y plazo comprometido. */
  tracked: number
  closedOnTime: number
  closedLate: number
  /** Abiertos cuyo plazo ya venció. */
  overdue: number
  openOnTime: number
  /** Porcentaje de cierre oportuno sobre lo ya resuelto o vencido; `null` si nada venció aún. */
  timelyPct: number | null
}

/**
 * Un hallazgo cerrado después de su plazo cuenta como cerrado, pero no como
 * cerrado a tiempo: si no se distinguen, un módulo que cierra todo con seis
 * meses de atraso se ve idéntico a uno que cumple.
 */
export function summarizeTimelyClosure(findings: FindingClosureRow[], asOf: string): TimelyClosureSummary {
  const tracked = findings.filter((finding) => finding.targetDate !== null)
  let closedOnTime = 0
  let closedLate = 0
  let overdue = 0
  let openOnTime = 0

  for (const finding of tracked) {
    const target = finding.targetDate!
    if (finding.closedOn) {
      if (finding.closedOn <= target) closedOnTime++
      else closedLate++
    } else if (target < asOf) {
      overdue++
    } else {
      openOnTime++
    }
  }

  // El denominador es lo que ya se puede juzgar: cerrado o vencido. Lo que
  // sigue abierto dentro de plazo no es ni cumplimiento ni incumplimiento.
  const judged = closedOnTime + closedLate + overdue
  return {
    tracked: tracked.length,
    closedOnTime,
    closedLate,
    overdue,
    openOnTime,
    timelyPct: judged === 0 ? null : Math.round((closedOnTime / judged) * 100),
  }
}
