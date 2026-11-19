import { addDaysToPlainDate, formatDate } from "@/lib/utils"

/**
 * Reconstrucción del recorrido de un equipo entre faenas (función pura).
 *
 * Recibe evidencia fechada de dónde estuvo físicamente el equipo y devuelve sus
 * estadías por faena. Nunca inventa una fecha: todo cambio que la evidencia no
 * respalda con seguridad va a `toConfirm` («Por confirmar») para que lo fije una
 * persona. Quién la alimenta desde la base y qué escribe es asunto del script.
 *
 * Fechas civiles como texto `YYYY-MM-DD`; se comparan como texto.
 */

export type EvidenceKind =
  | "carga"
  | "carga_terreno"
  | "tae"
  | "registro_mantencion"
  | "ot"
  | "auditoria"
  | "planilla"

export interface StayEvidence {
  /** Día civil (`YYYY-MM-DD`) en que el equipo estuvo en la faena. */
  day: string
  worksiteId: string
  kind: EvidenceKind
  /** Identificador de la fila de origen, para rastrear la evidencia. */
  ref: string
}

export interface ReconstructedStay {
  worksiteId: string
  /** `null` = sin inicio conocido (la primera estadía). */
  startedOn: string | null
  /** `null` = estadía abierta (la última). */
  endedOn: string | null
  evidence: string
}

export type PendingReason = "ventana_amplia" | "contradiccion" | "planilla" | "faena_actual_distinta"

export interface PendingChange {
  reason: PendingReason
  fromWorksiteId: string | null
  toWorksiteId: string
  lastDayInFrom: string | null
  firstDayInTo: string
  gapDays: number | null
  detail: string
}

export interface StayReconstruction {
  stays: ReconstructedStay[]
  toConfirm: PendingChange[]
  /** `true` cuando no hay nada por confirmar: las estadías pueden escribirse tal cual. */
  confident: boolean
}

type PhysicalKind = Exclude<EvidenceKind, "planilla">

/** Orden fijo y rótulos (singular, plural) con que se resume la evidencia. */
const EVIDENCE_LABELS: ReadonlyArray<readonly [PhysicalKind, string, string]> = [
  ["carga", "carga", "cargas"],
  ["carga_terreno", "carga en terreno", "cargas en terreno"],
  ["tae", "envío TAE", "envíos TAE"],
  ["registro_mantencion", "registro de mantención", "registros de mantención"],
  ["ot", "OT", "OT"],
  ["auditoria", "cambio auditado", "cambios auditados"],
]

const NO_EVIDENCE_TEXT = "Sin evidencia: faena actual"

interface Run {
  worksiteId: string
  firstDay: string
  lastDay: string
  evidence: StayEvidence[]
}

/** Días corridos entre dos fechas civiles (`to − from`). */
function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function compareEvidence(a: StayEvidence, b: StayEvidence): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.worksiteId !== b.worksiteId) return a.worksiteId < b.worksiteId ? -1 : 1
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
  return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0
}

function describeEvidence(run: Run): string {
  const counts = new Map<EvidenceKind, number>()
  for (const item of run.evidence) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  const parts: string[] = []
  for (const [kind, singular, plural] of EVIDENCE_LABELS) {
    const count = counts.get(kind)
    if (count) parts.push(`${count} ${count === 1 ? singular : plural}`)
  }
  const when = run.firstDay === run.lastDay
    ? `el ${formatDate(run.firstDay)}`
    : `entre ${formatDate(run.firstDay)} y ${formatDate(run.lastDay)}`
  return `${parts.join(", ")} ${when}`
}

export function reconstructStays(input: {
  evidence: StayEvidence[]
  currentWorksiteId: string
  maxGapDays: number
}): StayReconstruction {
  const { currentWorksiteId, maxGapDays } = input
  const sorted = [...input.evidence].sort(compareEvidence)
  const planilla = sorted.filter((item) => item.kind === "planilla")
  const physical = sorted.filter((item) => item.kind !== "planilla")

  const toConfirm: PendingChange[] = []

  // 1. Contradicciones: el mismo día en dos faenas. Ese día no ubica al equipo en
  //    ninguna, así que no entra a los tramos, pero se sigue procesando el resto.
  const byDay = new Map<string, StayEvidence[]>()
  for (const item of physical) {
    const list = byDay.get(item.day)
    if (list) list.push(item)
    else byDay.set(item.day, [item])
  }
  const usable: StayEvidence[] = []
  for (const [day, items] of byDay) {
    const worksites = [...new Set(items.map((item) => item.worksiteId))].sort()
    if (worksites.length > 1) {
      toConfirm.push({
        reason: "contradiccion",
        fromWorksiteId: worksites[0]!,
        toWorksiteId: worksites[1]!,
        lastDayInFrom: day,
        firstDayInTo: day,
        gapDays: 0,
        detail: `El ${formatDate(day)} hay evidencia en más de una faena (${worksites.join(", ")}).`,
      })
    } else {
      usable.push(...items)
    }
  }

  // 2. Tramos: evidencia consecutiva de la misma faena se funde en uno.
  const runs: Run[] = []
  for (const item of usable) {
    const last = runs[runs.length - 1]
    if (last && last.worksiteId === item.worksiteId) {
      last.lastDay = item.day
      last.evidence.push(item)
    } else {
      runs.push({ worksiteId: item.worksiteId, firstDay: item.day, lastDay: item.day, evidence: [item] })
    }
  }

  // Sin evidencia física utilizable: una sola estadía en la faena actual.
  if (runs.length === 0) {
    const stays: ReconstructedStay[] = [
      { worksiteId: currentWorksiteId, startedOn: null, endedOn: null, evidence: NO_EVIDENCE_TEXT },
    ]
    toConfirm.push(...contrastPlanilla(planilla, stays))
    return { stays, toConfirm, confident: toConfirm.length === 0 }
  }

  // 3. Bordes entre tramos. El día del cambio ya cuenta en la faena nueva.
  //    Si la ventana supera el tope, el cambio queda en `toConfirm`; el borde que
  //    se deja en las estadías es sólo la propuesta (primer día con evidencia en
  //    la nueva) y no debe escribirse mientras `confident` sea falso.
  const stays: ReconstructedStay[] = runs.map((run, index) => ({
    worksiteId: run.worksiteId,
    startedOn: index === 0 ? null : run.firstDay,
    endedOn: index === runs.length - 1 ? null : addDaysToPlainDate(runs[index + 1]!.firstDay, -1),
    evidence: describeEvidence(run),
  }))
  for (let i = 1; i < runs.length; i++) {
    const from = runs[i - 1]!
    const to = runs[i]!
    const gapDays = calendarDaysBetween(from.lastDay, to.firstDay)
    if (gapDays > maxGapDays) {
      toConfirm.push({
        reason: "ventana_amplia",
        fromWorksiteId: from.worksiteId,
        toWorksiteId: to.worksiteId,
        lastDayInFrom: from.lastDay,
        firstDayInTo: to.firstDay,
        gapDays,
        detail:
          `Pasó de ${from.worksiteId} a ${to.worksiteId} sin evidencia durante ${gapDays} días ` +
          `(entre ${formatDate(from.lastDay)} y ${formatDate(to.firstDay)}; el tope es ${maxGapDays}).`,
      })
    }
  }

  // 4. La estadía abierta debe coincidir con la faena actual. Si no, no se corrige acá.
  const lastRun = runs[runs.length - 1]!
  if (lastRun.worksiteId !== currentWorksiteId) {
    toConfirm.push({
      reason: "faena_actual_distinta",
      fromWorksiteId: lastRun.worksiteId,
      toWorksiteId: currentWorksiteId,
      lastDayInFrom: lastRun.lastDay,
      // No hay evidencia en la faena actual: se repite el último día conocido.
      firstDayInTo: lastRun.lastDay,
      gapDays: null,
      detail:
        `La última evidencia (${formatDate(lastRun.lastDay)}) está en ${lastRun.worksiteId}, ` +
        `pero la faena actual es ${currentWorksiteId}.`,
    })
  }

  toConfirm.push(...contrastPlanilla(planilla, stays))
  return { stays, toConfirm, confident: toConfirm.length === 0 }
}

/** La planilla no crea bordes: sólo se contrasta con la estadía que cubre su día. */
function contrastPlanilla(planilla: StayEvidence[], stays: ReconstructedStay[]): PendingChange[] {
  const pending: PendingChange[] = []
  for (const item of planilla) {
    const covering = stays.find(
      (stay) => (stay.startedOn === null || stay.startedOn <= item.day) && (stay.endedOn === null || item.day <= stay.endedOn),
    )
    if (!covering || covering.worksiteId === item.worksiteId) continue
    pending.push({
      reason: "planilla",
      fromWorksiteId: covering.worksiteId,
      toWorksiteId: item.worksiteId,
      lastDayInFrom: null,
      firstDayInTo: item.day,
      gapDays: null,
      detail:
        `La planilla (${item.ref}) ubica el equipo en ${item.worksiteId} el ${formatDate(item.day)}, ` +
        `pero la evidencia lo tiene en ${covering.worksiteId}.`,
    })
  }
  return pending
}
