/**
 * Nombres con que el libro RE-20 v3 rotula cada lista desplegable (hoja «Clasificación», fila 10),
 * en el orden de sus columnas. Es lo único que ve la persona: el slug de la categoría no sale a pantalla.
 */
export const RE20_CATALOG_LISTS: ReadonlyArray<{ category: string; label: string; group: string }> = [
  { category: "event_type", label: "Tipo de evento", group: "Evento y clasificación" },
  { category: "mutual_classification", label: "Clasificación ante la mutualidad", group: "Evento y clasificación" },
  { category: "potential_severity", label: "Potencial del evento", group: "Evento y clasificación" },
  { category: "mutual_status", label: "Estatus ante la mutualidad", group: "Evento y clasificación" },
  { category: "situation", label: "Situación", group: "Evento y clasificación" },
  { category: "activity", label: "Actividad que se realizaba (situación)", group: "Actividad, accidente y lesión" },
  { category: "accident_type", label: "Tipo de accidente", group: "Actividad, accidente y lesión" },
  { category: "causal_agent", label: "Agente causante", group: "Actividad, accidente y lesión" },
  { category: "agent_category", label: "Categoría del agente", group: "Actividad, accidente y lesión" },
  { category: "source", label: "Fuente", group: "Actividad, accidente y lesión" },
  { category: "body_zone", label: "Zona corporal", group: "Actividad, accidente y lesión" },
  { category: "loss", label: "Daños o pérdidas", group: "Actividad, accidente y lesión" },
  { category: "temperature", label: "Temperaturas", group: "Condiciones del lugar" },
  { category: "weather", label: "Clima", group: "Condiciones del lugar" },
  { category: "shift_system", label: "Sistema de turnos", group: "Condiciones del lugar" },
  { category: "physical_conditions", label: "Información del lugar físico", group: "Condiciones del lugar" },
  { category: "causal_event_id", label: "ID de hechos", group: "Árbol de causas y medidas" },
  { category: "causal_relation", label: "Relación causal", group: "Árbol de causas y medidas" },
  { category: "control_type", label: "Tipo de control", group: "Árbol de causas y medidas" },
  { category: "corrective_preventive", label: "Correctiva / preventiva", group: "Árbol de causas y medidas" },
  { category: "action_scope", label: "Alcance", group: "Árbol de causas y medidas" },
  { category: "priority", label: "Prioridad", group: "Árbol de causas y medidas" },
  { category: "action_status", label: "Estado de la medida", group: "Árbol de causas y medidas" },
  { category: "effectiveness", label: "Resultado de eficacia", group: "Árbol de causas y medidas" },
  { category: "residual_risk", label: "Riesgo residual", group: "Árbol de causas y medidas" },
  { category: "evidence_type", label: "Tipo de evidencia", group: "Investigación y registros" },
  { category: "declarant_quality", label: "Calidad de quien declara", group: "Investigación y registros" },
  { category: "investigation_role", label: "Rol en la investigación", group: "Investigación y registros" },
  { category: "quality_result", label: "Resultado de calidad", group: "Investigación y registros" },
  { category: "review_result", label: "Resultado de la revisión", group: "Investigación y registros" },
  { category: "cphs_decision", label: "Decisión del Comité Paritario", group: "Investigación y registros" },
  { category: "yes_no", label: "Sí / No", group: "Respuestas generales" },
  { category: "yes_no_unverified", label: "Sí / No / No verificable", group: "Respuestas generales" },
  { category: "yes_no_not_applicable", label: "Sí / No / No aplica", group: "Respuestas generales" },
  { category: "authorization_license", label: "Autorización o licencia", group: "Respuestas generales" },
  { category: "worker_sex", label: "Sexo (registro estadístico)", group: "Respuestas generales" },
  { category: "legacy_substandard_act", label: "Acto subestándar", group: "Listas anteriores" },
  { category: "legacy_substandard_condition", label: "Condición subestándar", group: "Listas anteriores" },
  { category: "legacy_personal_factor", label: "Factor personal", group: "Listas anteriores" },
  { category: "legacy_work_factor", label: "Factor del trabajo", group: "Listas anteriores" },
  { category: "legacy_root_cause", label: "Causa raíz (modelo anterior)", group: "Listas anteriores" },
  { category: "legacy_probability", label: "Probabilidad", group: "Listas anteriores" },
  { category: "legacy_severity", label: "Severidad", group: "Listas anteriores" },
  { category: "legacy_marital_status", label: "Estado civil", group: "Listas anteriores" },
  { category: "legacy_incident_type", label: "Tipo (anterior)", group: "Listas anteriores" },
]

const LIST_INDEX = new Map(RE20_CATALOG_LISTS.map((list, index) => [list.category, index]))

export function isLegacyCategory(category: string) {
  return category.startsWith("legacy_")
}

/** Rótulo en español de la lista; una categoría que el libro no conoce se muestra genérica, nunca con su slug. */
export function catalogListLabel(category: string) {
  const list = RE20_CATALOG_LISTS.find((item) => item.category === category)
  return list?.label ?? "Otra lista"
}

export function catalogListOrder(category: string) {
  return LIST_INDEX.get(category) ?? RE20_CATALOG_LISTS.length
}

export const AGENT_CATEGORY_LIST = "agent_category"
export const AGENT_LIST = "causal_agent"

/** Plazos operacionales internos: llave de la política, rótulo, unidad, qué mide y desde cuándo corre. */
export const RE20_POLICY_FIELDS = [
  { key: "preliminaryHours", label: "Informe preliminar", sheet: "RE-20-02", unit: "horas", max: 168, help: "Desde que se conoce el evento hasta que se registra el informe preliminar." },
  { key: "witnessStatementsHours", label: "Declaraciones", sheet: "RE-20-07", unit: "horas", max: 168, help: "Desde que se conoce el evento hasta tomar la declaración de testigos y personas involucradas." },
  { key: "injuredInterviewHours", label: "Entrevista a la persona afectada", sheet: "RE-20-03", unit: "horas", max: 168, help: "Desde el informe preliminar hasta realizar la entrevista a la persona afectada." },
  { key: "definitiveHours", label: "Informe definitivo", sheet: "RE-20-04", unit: "horas", max: 720, help: "Desde el informe preliminar hasta completar el informe definitivo con su árbol de causas y medidas." },
  { key: "diffusionHours", label: "Difusión", sheet: "RE-20-06", unit: "horas", max: 168, help: "Desde la aprobación de la revisión de calidad hasta difundir el aprendizaje a los equipos." },
  { key: "followupDays", label: "Seguimiento", sheet: "RE-20-08 / RE-20-09", unit: "días", max: 365, help: "Desde el informe definitivo, cada cuántos días se registra un seguimiento de las medidas." },
] as const

export type Re20PolicyKey = typeof RE20_POLICY_FIELDS[number]["key"]
