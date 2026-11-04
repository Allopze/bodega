/**
 * Días por etapa de **un** ítem (CHART-029, vista por ítem), sin acceso a datos.
 *
 * Es la misma medida de `lead-time-shape.ts` —los mismos cuatro tramos entre los mismos cinco hitos—
 * aplicada a una sola fila: lo que Analítica promedia, acá se ve ítem por ítem para saber **dónde se
 * atascó** el que uno pidió. Los hitos salen de `lead-time-sql.ts` (una sola definición) y esta parte
 * sólo decide qué se puede afirmar de cada tramo.
 *
 * Un ítem no está siempre cerrado, y la ficha lo ve en cualquier momento de su ciclo. Cada tramo queda en
 * uno de estos estados, y la pantalla los dice con palabras (el color no carga el significado solo):
 *
 *  - `done`: ocurrieron sus dos hitos, en orden → días medidos;
 *  - `current`: se cumplió el hito de partida y el de llegada aún no, en un ítem abierto → días hasta hoy;
 *  - `pending`: el ítem todavía no llegó a ese tramo;
 *  - `skipped`: el ítem terminó (se cerró o se rechazó) sin pasar por ese tramo: p. ej. un servicio que
 *    no tiene entrega a un trabajador. No es un atraso, es que no ocurrió;
 *  - `no_date`: hay hitos posteriores pero falta uno de este tramo (dato histórico incompleto);
 *  - `out_of_order`: las fechas están al revés (una OC emitida antes de aprobar el ítem). No se corrige
 *    ni se inventa una duración: se dice.
 */

import { LEAD_TIME_CLOSED_ITEM_STATUSES, LEAD_TIME_STAGES, type LeadTimeStageKey } from "./lead-time-shape"

/** Los hitos de un ítem, en días civiles de Chile desde 1970 (ver `lead-time-shape.ts`). */
export interface ItemMilestones {
  submittedDay: number | null
  approvedDay: number | null
  issuedDay: number | null
  arrivedDay: number | null
  deliveredDay: number | null
  /** Último movimiento (última recepción o entrega no anuladas). */
  closedDay: number | null
}

/** `open` sigue en curso, `closed` terminó la adquisición, `stopped` se detuvo (rechazado). */
export type ItemOutcome = "open" | "closed" | "stopped"

export function itemOutcome(status: string): ItemOutcome {
  if (LEAD_TIME_CLOSED_ITEM_STATUSES.includes(status)) return "closed"
  if (status === "rejected") return "stopped"
  return "open"
}

export type ItemStageState = "done" | "current" | "pending" | "skipped" | "no_date" | "out_of_order"

export interface ItemStage {
  key: LeadTimeStageKey
  label: string
  fromDay: number | null
  toDay: number | null
  /** Días corridos; `null` salvo en `done` y `current`. */
  days: number | null
  state: ItemStageState
}

export interface ItemLeadTimeView {
  outcome: ItemOutcome
  stages: ItemStage[]
  /** Envío → cierre (ítem cerrado) o envío → hoy (abierto); `null` si no es medible o el ítem se detuvo. */
  totalDays: number | null
}

/** Los cinco hitos, en el orden del ciclo, tomados de la definición de tramos (no se repite la lista). */
const MILESTONE_KEYS = [LEAD_TIME_STAGES[0].from, ...LEAD_TIME_STAGES.map((stage) => stage.to)] as const

export function buildItemLeadTimeView(milestones: ItemMilestones, status: string, todayDay: number): ItemLeadTimeView {
  const outcome = itemOutcome(status)
  const days = MILESTONE_KEYS.map((key) => milestones[key])
  // Hasta dónde llegó el ítem: el último hito con fecha.
  const frontier = days.reduce<number>((last, day, index) => (day === null ? last : index), -1)

  const stages = LEAD_TIME_STAGES.map((stage, index): ItemStage => {
    const fromDay = days[index] ?? null
    const toDay = days[index + 1] ?? null
    const base = { key: stage.key, label: stage.label, fromDay, toDay }
    if (index < frontier) {
      if (fromDay === null || toDay === null) return { ...base, days: null, state: "no_date" }
      return toDay < fromDay ? { ...base, days: null, state: "out_of_order" } : { ...base, days: toDay - fromDay, state: "done" }
    }
    if (index === frontier && fromDay !== null && toDay === null && outcome === "open") {
      return { ...base, days: Math.max(0, todayDay - fromDay), state: "current" }
    }
    return { ...base, days: null, state: outcome === "open" ? "pending" : "skipped" }
  })

  const submitted = milestones.submittedDay
  let totalDays: number | null = null
  if (submitted !== null) {
    if (outcome === "closed" && milestones.closedDay !== null && milestones.closedDay >= submitted) totalDays = milestones.closedDay - submitted
    if (outcome === "open") totalDays = Math.max(0, todayDay - submitted)
  }
  return { outcome, stages, totalDays }
}

/**
 * La frase que responde la ficha: dónde está el ítem y dónde se demoró, armada de los mismos números
 * que se dibujan. Verdadera en los estados parciales: un ítem abierto no «se demoró» en un tramo que
 * todavía corre, uno rechazado no «lleva» días, y un empate de tramos se dice como empate.
 */
export function itemStageHeadline(view: ItemLeadTimeView, formatDays: (value: number) => string): string {
  const { outcome, stages, totalDays } = view
  const current = stages.find((stage) => stage.state === "current")
  const done = stages.filter((stage) => stage.state === "done" && stage.days !== null)

  if (outcome === "stopped") return "El ítem se rechazó: no hay plazos que medir después de la solicitud."
  if (!current && done.length === 0) {
    return outcome === "closed"
      ? "El ítem se cerró, pero sus fechas no alcanzan para medir los tramos."
      : "Todavía no hay fechas suficientes para medir los tramos de este ítem."
  }

  const sentences: string[] = []
  if (outcome === "closed" && totalDays !== null) {
    sentences.push(totalDays === 0 ? "Se cerró el mismo día de la solicitud." : `Se cerró ${formatDays(totalDays)} después de la solicitud.`)
  }
  if (outcome === "open") {
    const since = totalDays === null ? "" : `Lleva ${formatDays(totalDays)} desde la solicitud`
    const where = current
      ? current.days === 0
        ? `entró hoy al tramo «${current.label}»`
        : `está en el tramo «${current.label}» desde hace ${formatDays(current.days ?? 0)}`
      : ""
    if (since && where) sentences.push(`${since} y ${where}.`)
    else if (since) sentences.push(`${since}.`)
    else if (where) sentences.push(`Hoy ${where}.`)
  }

  if (done.length === 1) {
    const [only] = done
    sentences.push(`Tramo ya medido: «${only!.label}» (${formatDays(only!.days ?? 0)}).`)
  } else if (done.length > 1) {
    const longest = Math.max(...done.map((stage) => stage.days ?? 0))
    const slowest = done.filter((stage) => stage.days === longest)
    if (slowest.length === 1) {
      sentences.push(`El tramo más lento fue «${slowest[0]!.label}» (${formatDays(longest)}).`)
    } else if (slowest.length === done.length) {
      sentences.push(`Los tramos medidos duraron lo mismo (${formatDays(longest)} cada uno).`)
    } else {
      const names = slowest.map((stage) => `«${stage.label}»`)
      sentences.push(`Los tramos más lentos fueron ${names.slice(0, -1).join(", ")} y ${names.at(-1)} (${formatDays(longest)} cada uno).`)
    }
  }
  return sentences.join(" ")
}
