import { deriveRe20RootCauses } from "@/lib/prevention/incidents"
import type { Re20Data, Re20Incident, Re20Person, Re20QualityReview } from "../../types"

/* Modelo del ONE PAGE RE-20-06 (hoja INF.DIFUSIÓN). Se arma con la MISMA regla
 * que el servicio (`publishOnePageDiffusion`): lo que se ve aquí es lo que se
 * publica. Sin React: se prueba por sí solo. */

/** La hoja del Excel tiene cuatro filas de causa raíz / medida (C17:L23). */
export const ONE_PAGE_MAX_ROWS = 4
/** El servicio exige al menos 10 caracteres en el resumen, las causas y el plan. */
const MIN_TEXT = 10

export interface OnePageRow {
  rootCause: string
  measure: string
  responsible: string
  dueAt: string | null
  status: string
}

export interface OnePageModel {
  summary: string
  date: string
  subManagement: string
  area: string
  place: string
  injury: string
  bodyZone: string
  potential: string
  rows: OnePageRow[]
  shown: OnePageRow[]
  hiddenRows: number
  rootCauseText: string
  actionPlanText: string
  learning: string
  /** Lo que falta en el expediente para poder publicar, dicho como tarea. */
  problems: string[]
}

export function buildOnePage(args: { data: Re20Data; incident: Pick<Re20Incident, "occurredAt" | "location">; people: Re20Person[] }): OnePageModel {
  const { data, incident, people } = args
  const text = (value: string | null | undefined) => value?.trim() ?? ""
  const describe = (id?: string | null) => (id ? text(data.causalTree.events.find((event) => event.id === id)?.description) : "")
  const rows: OnePageRow[] = data.measures
    .filter((measure) => text(measure.description))
    .map((measure) => ({
      rootCause: describe(measure.rootCauseId),
      measure: text(measure.description),
      responsible: (measure.responsibleUserId ? people.find((person) => person.id === measure.responsibleUserId)?.name : null) ?? text(measure.responsibleRole),
      dueAt: measure.dueAt ?? null,
      status: text(measure.status),
    }))
  const rootCauseText = deriveRe20RootCauses(data.causalTree).map(describe).filter(Boolean).join("; ")
  const actionPlanText = rows.map((row) => row.measure).join("; ")
  const summary = text(data.definitive.reconstruction) || text(data.preliminary.eventDescription)
  const problems: string[] = []
  if (summary.length < MIN_TEXT) problems.push("El relato del caso: la reconstrucción del informe definitivo o la descripción del preliminar")
  if (rootCauseText.length < MIN_TEXT) problems.push("Las causas raíz del árbol de causas")
  if (actionPlanText.length < MIN_TEXT) problems.push("Las medidas correctivas con su descripción")
  return {
    summary,
    date: incident.occurredAt,
    subManagement: text(data.preliminary.subManagement),
    area: text(data.preliminary.area),
    place: incident.location,
    injury: text(data.affectedPerson.injurySummary) || text(data.preliminary.injuryDescription),
    bodyZone: text(data.preliminary.bodyZone),
    potential: text(data.nearMiss.potential),
    rows,
    shown: rows.slice(0, ONE_PAGE_MAX_ROWS),
    hiddenRows: Math.max(0, rows.length - ONE_PAGE_MAX_ROWS),
    rootCauseText,
    actionPlanText,
    learning: text(data.definitive.closure.learningDetail),
    problems,
  }
}

const APPROVING = new Set(["approved", "approved_with_observations"])

/** La difusión exige que la ÚLTIMA revisión sea aprobatoria (no basta una aprobación antigua). */
export function latestReviewApproves(reviews: Re20QualityReview[]) {
  const latest = [...reviews].sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))[0]
  return latest ? APPROVING.has(latest.decision) : false
}
