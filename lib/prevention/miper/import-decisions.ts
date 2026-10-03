/**
 * Estado de las decisiones del paso «Medidas detectadas» de la importación
 * (Fase C, spec §8). Puro, sin React: lo usa el diálogo y lo prueba `vitest`.
 *
 * - El tipo de cada frase nace SUGERIDO (`confirmed: false`), salvo que el Excel
 *   lo traiga ROTULADO («IV. Controles administrativos: …», como lo escribe el
 *   libro exportado; `source: "prefix"`). Un romano suelto («I. USAR CASCO»,
 *   `source: "numeral"`) es sólo una sugerencia. El Excel del RE-04 no trae tipo:
 *   siempre lo confirma una persona, eligiéndolo, con «Confirmar» o con «Aceptar
 *   sugerencias».
 * - Responsables y plazos nacen en su sugerencia y se pueden cambiar; no piden
 *   una confirmación aparte.
 * - Todas las funciones devuelven un objeto nuevo: nada se modifica en el lugar.
 */
import type { DeadlineDecision, ImportMappings, MeasureAnalysis, ResponsibleDecision } from "./re04-measures"
import type { ControlHierarchy } from "./snapshot"

export type PhraseDecision = { hierarchy: ControlHierarchy; confirmed: boolean }
export type ImportDecisions = {
  phrases: Record<string, PhraseDecision>
  responsibles: Record<string, ResponsibleDecision>
  deadlines: Record<string, DeadlineDecision>
}
export type ImportSummary = { measures: number; existing: number; pending: number }

export function initialDecisions(analysis: MeasureAnalysis): ImportDecisions {
  return {
    phrases: Object.fromEntries(analysis.phrases.map((phrase) => [phrase.key, { hierarchy: phrase.suggestion.hierarchy, confirmed: phrase.suggestion.source === "prefix" }])),
    responsibles: Object.fromEntries(analysis.responsibles.map((group) => [group.key, group.suggestion])),
    deadlines: Object.fromEntries(analysis.deadlines.map((group) => [group.key, group.suggestion])),
  }
}

export function unconfirmedCount(decisions: ImportDecisions): number {
  return Object.values(decisions.phrases).filter((decision) => !decision.confirmed).length
}

/** «Aceptar sugerencias»: confirma todas las frases con el tipo que ya tienen. */
export function acceptSuggestions(decisions: ImportDecisions): ImportDecisions {
  return {
    ...decisions,
    phrases: Object.fromEntries(Object.entries(decisions.phrases).map(([key, decision]) => [key, { ...decision, confirmed: true }])),
  }
}

/** Elegir un tipo (o confirmar el sugerido) confirma esa frase. */
export function choosePhraseType(decisions: ImportDecisions, key: string, hierarchy: ControlHierarchy): ImportDecisions {
  return { ...decisions, phrases: { ...decisions.phrases, [key]: { hierarchy, confirmed: true } } }
}

/** Lo que viaja a `commitRiskImportAction`: las decisiones, sin el estado de confirmación. */
export function decisionsToMappings(decisions: ImportDecisions): ImportMappings {
  return {
    measureMapping: Object.fromEntries(Object.entries(decisions.phrases).map(([key, decision]) => [key, decision.hierarchy])),
    responsibleMapping: { ...decisions.responsibles },
    deadlineMapping: { ...decisions.deadlines },
  }
}

/**
 * Cuántas medidas se cargarían y cómo: sólo las de las filas que se cargan
 * (`loadableRows`, las «listas»), existentes o por implementar según la decisión
 * de su plazo.
 */
export function importSummary(analysis: MeasureAnalysis, loadableRows: ReadonlySet<number>, deadlines: Record<string, DeadlineDecision>): ImportSummary {
  let existing = 0
  let pending = 0
  for (const measure of analysis.measures) {
    if (!loadableRows.has(measure.rowNumber)) continue
    if (deadlines[measure.deadlineKey]?.kind === "existing") existing += 1
    else pending += 1
  }
  return { measures: existing + pending, existing, pending }
}
