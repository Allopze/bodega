import type { IncidentStatus } from "@/lib/services/prevention-incidents"
export { RE20_CLASSIFICATION_OPTIONS } from "@/lib/prevention/re20-classification-options"

export const RE20_WORKBOOK_SHEETS = [
  "PASO A PASO",
  "INV.PRE.ACC",
  "DECLARACIÓN INDIVIDUAL",
  "Entrevista CPHyS-Ejecutivo-Otro",
  "INV.DEF.ACC",
  "ÁRBOL DE CAUSAS",
  "REVISIÓN DE CALIDAD",
  "DIAT",
  "INF.DIFUSIÓN",
  "Seguimiento Acc. CTP STP",
  "Seguimiento Incidente daño",
  "Reporte Cuasi Accidente",
  "Clasificación",
] as const

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: "Reportado",
  triage: "En triage",
  immediate_measures: "Medidas inmediatas",
  under_investigation: "En investigación",
  pending_capa: "Pendiente CAPA",
  pending_verification: "Pendiente verificación",
  closed: "Cerrado",
}

export const INCIDENT_EVENT_LABELS: Record<string, string> = {
  dangerous_incident: "Incidente o suceso peligroso",
  work_accident: "Accidente del trabajo",
  commute_accident: "Accidente de trayecto",
  suspected_occupational_disease: "Presunta enfermedad profesional",
  material_damage: "Daño material",
  environmental_spill: "Daño ambiental o derrame",
  vehicle_event: "Evento vehicular",
  contractor_or_third_party: "Contratista o tercero",
}

export const INCIDENT_SEVERITY_LABELS: Record<string, string> = {
  none: "Sin lesión",
  minor: "Menor",
  medical_treatment: "Tratamiento médico",
  lost_time: "Con tiempo perdido",
  serious: "Grave",
  fatal: "Fatal",
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

/** Client-safe metadata only. Parsing, encryption and persistence stay server-side. */

export function incidentStatusBadgeVariant(status: string): "default" | "info" | "warning" | "success" | "danger" {
  if (status === "closed") return "success"
  if (status === "reported" || status === "triage") return "danger"
  if (status === "pending_verification") return "info"
  return "warning"
}

export function notificationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pendiente",
    sent: "Enviada",
    acknowledged: "Recepcionada",
    not_required: "No aplica",
    overdue: "Atrasada",
    authorized: "Autorizada",
  }
  return labels[status] ?? status
}

export interface Re20CausalEvent {
  id: string
  description: string
  verified: boolean
  source?: string | null
  /** ÁRBOL DE CAUSAS!B9: un hecho puede ser contexto y no causal; por defecto es causal. */
  causal?: boolean
  requiresVerification?: boolean
}

/**
 * Relación DIRIGIDA antecedente → consecuencia (ÁRBOL DE CAUSAS!B44).
 * - chain: la consecuencia tiene un único antecedente.
 * - conjunction: dos o más antecedentes debieron concurrir para la misma consecuencia.
 * - independent: un mismo hecho origina dos o más consecuencias. NO es ausencia de causalidad.
 */
export interface Re20CausalRelation {
  from: string
  to: string
  type: "chain" | "conjunction" | "independent"
  justification?: string | null
}

export interface Re20SlaPolicy {
  version: number
  preliminaryHours: number
  witnessStatementsHours: number
  injuredInterviewHours: number
  definitiveHours: number
  diffusionHours: number
  followupDays: number
}

export const DEFAULT_RE20_SLA_POLICY: Re20SlaPolicy = {
  version: 1,
  preliminaryHours: 3,
  witnessStatementsHours: 5,
  injuredInterviewHours: 24,
  definitiveHours: 72,
  diffusionHours: 24,
  followupDays: 14,
}

/** REVISIÓN DE CALIDAD!C10:E22: `criterion` = columna C, `verification` = columna E (literal). `label` se conserva por compatibilidad. */
export const RE20_QUALITY_CRITERIA = [
  { id: "timeliness", criterion: "Oportunidad", verification: "La investigación se inició prontamente y se preservaron las evidencias disponibles.", label: "La investigación se inició prontamente y se preservaron las evidencias disponibles." },
  { id: "participation", criterion: "Participación", verification: "Se incorporó a personas trabajadoras y sus representantes, con enfoque de género e inclusión.", label: "Se incorporó a personas trabajadoras y sus representantes, con enfoque de género e inclusión." },
  { id: "objectivity", criterion: "Objetividad", verification: "El relato y los hechos no contienen juicios de valor, culpabilización ni suposiciones no identificadas.", label: "El relato y los hechos no contienen juicios de valor, culpabilización ni suposiciones no identificadas." },
  { id: "traceability", criterion: "Trazabilidad", verification: "Cada hecho relevante se respalda con una fuente o evidencia.", label: "Cada hecho relevante se respalda con una fuente o evidencia." },
  { id: "coherence", criterion: "Coherencia", verification: "Relato, línea de tiempo, listado de hechos y árbol son consistentes entre sí.", label: "Relato, línea de tiempo, listado de hechos y árbol son consistentes entre sí." },
  { id: "depth", criterion: "Profundidad", verification: "El análisis no se detuvo en «error humano» y alcanzó condiciones técnicas u organizacionales.", label: "El análisis no se detuvo en «error humano» y alcanzó condiciones técnicas u organizacionales." },
  { id: "root_causes", criterion: "Causas raíz", verification: "Las causas raíz corresponden a hechos sin antecedentes causales verificables adicionales.", label: "Las causas raíz corresponden a hechos sin antecedentes causales verificables adicionales." },
  { id: "measures", criterion: "Medidas", verification: "Cada causa raíz tiene al menos una medida específica, viable y priorizada por jerarquía de control.", label: "Cada causa raíz tiene al menos una medida específica, viable y priorizada por jerarquía de control." },
  { id: "planning", criterion: "Planificación", verification: "Las medidas tienen responsable, plazo, recursos, evidencia y verificador.", label: "Las medidas tienen responsable, plazo, recursos, evidencia y verificador." },
  { id: "risk_assessment", criterion: "IPER", verification: "Se revisó la necesidad de actualizar la matriz IPER y otros instrumentos preventivos.", label: "Se revisó la necesidad de actualizar la matriz IPER y otros instrumentos preventivos." },
  { id: "effectiveness", criterion: "Eficacia", verification: "Se definió cómo y cuándo se evaluará la eficacia y el riesgo residual.", label: "Se definió cómo y cuándo se evaluará la eficacia y el riesgo residual." },
  { id: "confidentiality", criterion: "Confidencialidad", verification: "Los antecedentes personales, médicos y declaraciones están bajo acceso restringido.", label: "Los antecedentes personales, médicos y declaraciones están bajo acceso restringido." },
  { id: "report_attachments", criterion: "Registro", verification: "El informe y sus anexos están foliados, respaldados y disponibles para las entidades competentes.", label: "El informe y sus anexos están foliados, respaldados y disponibles para las entidades competentes." },
] as const

/** Clasificación!AH. */
export const RE20_QUALITY_RESULTS = [
  { id: "meets", label: "Cumple" },
  { id: "partial", label: "Parcial" },
  { id: "does_not_meet", label: "No cumple" },
] as const

/** Clasificación!AI. */
export const RE20_REVIEW_DECISIONS = [
  { id: "approved", label: "Aprobado" },
  { id: "approved_with_observations", label: "Aprobado con observaciones" },
  { id: "changes_required", label: "Requiere corrección" },
] as const

/** Validación ESTRUCTURAL (bloquea guardar): ids, referencias, auto-relaciones, duplicados y ciclos. Permite borradores incompletos. */
export function validateRe20CausalGraph(args: {
  events: Re20CausalEvent[]
  relations: Re20CausalRelation[]
}): string[] {
  const errors: string[] = []
  const ids = new Set<string>()

  for (const event of args.events) {
    const id = event.id.trim()
    if (!id) errors.push("Cada hecho necesita un identificador.")
    else if (ids.has(id)) errors.push("Los identificadores de hechos deben ser únicos.")
    else ids.add(id)
  }

  const graph = new Map<string, string[]>()
  for (const id of ids) graph.set(id, [])
  const pairs = new Set<string>()
  for (const relation of args.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) {
      errors.push("La relación causal apunta a un hecho inexistente.")
      continue
    }
    if (relation.from === relation.to) {
      errors.push("Un hecho no puede ser causa de sí mismo.")
      continue
    }
    const pair = `${relation.from}\u0000${relation.to}`
    if (pairs.has(pair)) {
      errors.push("Hay relaciones causales duplicadas entre los mismos hechos.")
      continue
    }
    pairs.add(pair)
    // Todas las relaciones (también "independent") son aristas dirigidas antecedente → consecuencia.
    graph.get(relation.from)?.push(relation.to)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  function hasCycle(id: string): boolean {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of graph.get(id) ?? []) {
      if (hasCycle(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  if ([...ids].some(hasCycle)) errors.push("El árbol contiene un ciclo causal.")
  return [...new Set(errors)]
}

type Re20CausalTree = { events: Re20CausalEvent[]; relations: Re20CausalRelation[] }

/** Hecho final del árbol (ÁRBOL DE CAUSAS!B9: «H1 es el hecho final»). */
const RE20_FINAL_EVENT_ID = "H1"
const RE20_MAX_TRAJECTORIES = 200

/** Aristas válidas (ambos extremos existen) indexadas por hecho; ignora las dañadas que la validación estructural ya rechaza. */
function causalIndex(tree: Re20CausalTree) {
  const ids = new Set(tree.events.map((event) => event.id))
  const valid = tree.relations.filter((r) => ids.has(r.from) && ids.has(r.to) && r.from !== r.to)
  const out = new Map<string, string[]>()
  const into = new Map<string, string[]>()
  for (const id of ids) { out.set(id, []); into.set(id, []) }
  for (const r of valid) { out.get(r.from)?.push(r.to); into.get(r.to)?.push(r.from) }
  return { ids, valid, out, into }
}

/** Qué falta para dar el árbol por terminado; se exige al completar el informe definitivo, no al guardar borradores. */
export function re20CausalGraphCompletenessIssues(tree: Re20CausalTree): string[] {
  const issues: string[] = []
  const { ids, valid, out, into } = causalIndex(tree)

  if (!ids.has(RE20_FINAL_EVENT_ID)) issues.push("Falta el hecho final H1 (lesión o daño).")
  else if ((out.get(RE20_FINAL_EVENT_ID) ?? []).length > 0) issues.push("H1 es el hecho final y no puede tener consecuencias.")

  for (const r of valid) {
    if (r.type === "chain" && (into.get(r.to) ?? []).length !== 1) {
      issues.push(`${r.to}: una cadena exige un único antecedente; si concurren varios, usa conjunción.`)
    } else if (r.type === "conjunction" && (into.get(r.to) ?? []).length < 2) {
      issues.push(`${r.to}: una conjunción exige dos o más antecedentes.`)
    } else if (r.type === "independent" && (out.get(r.from) ?? []).length < 2) {
      issues.push(`${r.from}: una relación independiente exige que el hecho origine dos o más consecuencias.`)
    }
  }

  if (ids.has(RE20_FINAL_EVENT_ID)) {
    // Alcanzabilidad hacia H1 recorriendo las aristas al revés desde H1.
    const reach = new Set<string>([RE20_FINAL_EVENT_ID])
    const stack = [RE20_FINAL_EVENT_ID]
    while (stack.length) {
      for (const prev of into.get(stack.pop() as string) ?? []) {
        if (!reach.has(prev)) { reach.add(prev); stack.push(prev) }
      }
    }
    for (const event of tree.events) {
      const connected = (out.get(event.id) ?? []).length + (into.get(event.id) ?? []).length > 0
      if (event.causal !== false && connected && !reach.has(event.id)) {
        issues.push(`${event.id}: el hecho causal no conduce al hecho final H1.`)
      }
    }
  }

  if (deriveRe20RootCauses(tree).length === 0) issues.push("El árbol no tiene ninguna causa raíz.")
  return [...new Set(issues)]
}

/** Causas raíz: hechos causales sin antecedentes y con al menos una consecuencia, en el orden del listado. */
export function deriveRe20RootCauses(tree: Re20CausalTree): string[] {
  const { out, into } = causalIndex(tree)
  return tree.events
    .filter((e) => e.causal !== false && (into.get(e.id) ?? []).length === 0 && (out.get(e.id) ?? []).length > 0)
    .map((e) => e.id)
}

/** Trayectorias (8.2): cada camino desde una causa raíz hasta H1, orden estable y tope de 200 caminos. */
export function deriveRe20Trajectories(tree: Re20CausalTree): string[][] {
  const { out } = causalIndex(tree)
  const paths: string[][] = []
  const walk = (id: string, path: string[]) => {
    if (paths.length >= RE20_MAX_TRAJECTORIES || path.includes(id)) return
    const next = [...path, id]
    if (id === RE20_FINAL_EVENT_ID) { paths.push(next); return }
    for (const to of out.get(id) ?? []) walk(to, next)
  }
  for (const root of deriveRe20RootCauses(tree)) walk(root, [])
  return paths
}

export type Re20TaskOffset =
  | "immediate" | "preliminary" | "witness" | "interview" | "definitive" | "review"
  | "diffusion" | "followup" | "diat" | "reintegration" | "plan"

/** Tareas del protocolo (PASO A PASO), en orden de ejecución. */
export const RE20_TASK_DEFINITIONS: ReadonlyArray<{ id: string; sheet: string; label: string; offset: Re20TaskOffset; role: string }> = [
  { id: "notify", sheet: "PASO A PASO", label: "Aviso inmediato y resguardo del lugar", offset: "immediate", role: "Jefatura de terreno" },
  { id: "preliminary_report", sheet: "INV.PRE.ACC", label: "Informe preliminar", offset: "preliminary", role: "Jefatura de terreno" },
  { id: "witness_statements", sheet: "DECLARACIÓN INDIVIDUAL", label: "Declaraciones iniciales", offset: "witness", role: "Investigador" },
  { id: "injured_interview", sheet: "Entrevista CPHyS-Ejecutivo-Otro", label: "Entrevista a persona afectada", offset: "interview", role: "CPHS / Ejecutivo" },
  { id: "definitive_report", sheet: "INV.DEF.ACC", label: "Informe definitivo y conclusión del equipo", offset: "definitive", role: "Investigador responsable" },
  { id: "quality_review", sheet: "REVISIÓN DE CALIDAD", label: "Revisión independiente de calidad", offset: "review", role: "Revisor de calidad" },
  { id: "diat", sheet: "DIAT", label: "Preparar y registrar presentación DIAT", offset: "diat", role: "Administrador de contrato" },
  { id: "diffusion", sheet: "INF.DIFUSIÓN", label: "Difusión posterior a aprobación", offset: "diffusion", role: "Jefatura de terreno" },
  { id: "post_accident_meeting", sheet: "PASO A PASO", label: "Reunión post accidente al reintegro", offset: "reintegration", role: "Comité Paritario" },
  { id: "accident_followup", sheet: "Seguimiento Acc. CTP STP", label: "Verificar medidas cada 14 días", offset: "followup", role: "Responsable de medida" },
  { id: "effectiveness_verification", sheet: "PASO A PASO", label: "Verificar la eficacia de las medidas", offset: "plan", role: "Jefa Dpto. Prevención o verificador designado" },
]

/**
 * Qué tareas aplican según el tipo de evento.
 * - Accidente de trayecto: solo ítems 1-3 del PASO A PASO (N7) + DIAT.
 * - DIAT: solo accidente del trabajo, de trayecto o cualquier evento grave/fatal.
 * - Reunión post accidente: solo accidente del trabajo.
 * - Entrevista a la persona afectada: requiere lesión (accidente o evento grave/fatal).
 */
export function re20ApplicableTaskIds(
  eventType: string,
  opts: { nearMissPotential?: string | null; isFatalOrSerious?: boolean } = {},
): string[] {
  const serious = opts.isFatalOrSerious === true
  const isWork = eventType === "work_accident"
  const diat = isWork || eventType === "commute_accident" || serious
  const commute = ["notify", "preliminary_report", "witness_statements"]
  return RE20_TASK_DEFINITIONS.map((t) => t.id).filter((id) => {
    if (eventType === "commute_accident") return commute.includes(id) || id === "diat"
    if (id === "diat") return diat
    if (id === "post_accident_meeting") return isWork
    if (id === "injured_interview") return isWork || serious
    return true
  })
}

const SEVERE_POTENTIALS = new Set(["grave o fatal", "critical", "fatal"])

/** Árbol obligatorio salvo cuasi accidente (dangerous_incident) cuyo potencial no sea «Grave o fatal» (Reporte Cuasi Accidente!D24, DO-36). */
export function re20TreeRequired(eventType: string, opts: { nearMissPotential?: string | null } = {}): boolean {
  if (eventType !== "dangerous_incident") return true
  return SEVERE_POTENTIALS.has((opts.nearMissPotential ?? "").trim().toLowerCase())
}

function addHours(value: string, hours: number) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error("La fecha del hito RE-20 no es válida.")
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString()
}

/** Próximo vencimiento de seguimiento (cada `followupDays`) desde una fecha ISO. */
export function nextRe20FollowupDueAt(fromIso: string, policy: Re20SlaPolicy = DEFAULT_RE20_SLA_POLICY) {
  return addHours(fromIso, policy.followupDays * 24)
}

/** Fechas operacionales y legales separadas. `diat` es null si no aplica (Ley 16.744; cuenta desde knownAt). */
export function calculateRe20Deadlines(
  input: {
    occurredAt: string
    knownAt: string
    preliminaryAt?: string | null
    qualityApprovedAt?: string | null
    eventType?: string
    isFatalOrSerious?: boolean
    reintegrationAt?: string | null
  },
  policy: Re20SlaPolicy = DEFAULT_RE20_SLA_POLICY,
) {
  // Sin eventType (llamadas heredadas) la DIAT se mantiene aplicable.
  const diatApplies = input.eventType === undefined
    || input.eventType === "work_accident"
    || input.eventType === "commute_accident"
    || input.isFatalOrSerious === true
  return {
    occurredAt: input.occurredAt,
    preliminary: { dueAt: addHours(input.occurredAt, policy.preliminaryHours), kind: "internal" as const },
    witnessStatements: { dueAt: addHours(input.occurredAt, policy.witnessStatementsHours), kind: "internal" as const },
    diat: diatApplies ? { dueAt: addHours(input.knownAt, 24), kind: "legal" as const } : null,
    injuredInterview: {
      dueAt: input.preliminaryAt ? addHours(input.preliminaryAt, policy.injuredInterviewHours) : null,
      kind: "internal" as const,
    },
    definitive: {
      dueAt: input.preliminaryAt ? addHours(input.preliminaryAt, policy.definitiveHours) : null,
      kind: "internal" as const,
    },
    diffusion: {
      dueAt: input.qualityApprovedAt ? addHours(input.qualityApprovedAt, policy.diffusionHours) : null,
      kind: "internal" as const,
    },
    postAccidentMeeting: { dueAt: input.reintegrationAt ?? null, kind: "internal" as const },
  }
}
