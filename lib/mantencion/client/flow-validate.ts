import { meterName, parseReadingInput, plural } from "../format"
import { checkReading, type ReadingCheck, type ReadingJump } from "../readings"
import { baseInterval, checkItemResults, checklistFor, suggestInterval } from "../schedule"
import { findDuplicatePreventive, type PreventiveRef } from "../status"
import type { MantChecklistItem, MantScheduleSnapshot, MantSuggestion } from "../types"
import type { FleetRow } from "./fleet-view"
import { totalHours, type FlowDraft, type FlowErrors, type FlowPart, type FlowStep } from "./flow-types"

/**
 * Validación por paso y análisis de la lectura. Todo puro: la misma lógica
 * decide si «Continuar» se habilita, qué avisos se muestran y qué se firma.
 */

export interface FlowCtx {
  row: FleetRow | null
  /** `todayInChile()` del llamador, para que esto siga siendo puro. */
  today: string
}

export const MIN_NOTE = 3
export const MIN_DESCRIPTION = 5
export const MIN_REASON = 5
export const HOURS_WARNING = 12
export const HOURS_MIN = 0.5
export const HOURS_MAX = 72

export interface LectureAnalysis {
  value: number | null
  schedule: MantScheduleSnapshot | null
  check: ReadingCheck | null
  jump: ReadingJump | null
  suggestion: MantSuggestion | null
  /** Intervalo que se usará (el sugerido o el elegido a mano). */
  intervalValue: number | null
  manual: boolean
  items: MantChecklistItem[]
  duplicate: PreventiveRef | null
}

export function analyzeLecture(draft: FlowDraft, row: FleetRow | null): LectureAnalysis {
  const value = parseReadingInput(draft.readingText).value
  const schedule = draft.schedule ?? row?.schedule ?? null
  const empty: LectureAnalysis = { value, schedule, check: null, jump: null, suggestion: null, intervalValue: null, manual: false, items: [], duplicate: null }
  if (!row || value === null) return empty

  const check = checkReading({ value, workDate: draft.workDate, unit: row.eq.unit, readings: row.readings, initial: row.initial })
  const jump = check.ok ? check.jump : null
  if (draft.kind !== "P" || !schedule || schedule.intervals.length === 0) return { ...empty, check, jump }

  const suggestion = suggestInterval(schedule.intervals, value)
  const chosen = draft.intervalIndex !== null && draft.intervalIndex < schedule.intervals.length ? draft.intervalIndex : suggestion.index
  const intervalValue = schedule.intervals[chosen] ?? suggestion.intervalValue
  const duplicate = findDuplicatePreventive({
    previous: row.recentPreventives,
    intervalValue,
    reading: value,
    workDate: draft.workDate,
    base: baseInterval(schedule.intervals),
    excludeId: draft.id,
  })
  return {
    value, schedule, check, jump, suggestion, intervalValue,
    manual: chosen !== suggestion.index,
    items: checklistFor(schedule, intervalValue, row.eq.brandId),
    duplicate,
  }
}

export function groupDone(draft: Pick<FlowDraft, "marks" | "reasons">, items: readonly MantChecklistItem[]): boolean {
  return items.every((item) => {
    const mark = draft.marks[item.key]
    return Boolean(mark) && (mark !== "NR" || (draft.reasons[item.key] ?? "").trim().length >= MIN_NOTE)
  })
}

export function checklistCounts(draft: Pick<FlowDraft, "checklist" | "marks" | "reasons">) {
  const total = draft.checklist.length
  const done = draft.checklist.filter((item) => draft.marks[item.key]).length
  const missingReason = draft.checklist.filter((item) => draft.marks[item.key] === "NR" && (draft.reasons[item.key] ?? "").trim().length < MIN_NOTE).length
  return { total, done, missingReason }
}

/** «Falta 1 ítem» / «Faltan 3 ítems»: el verbo concuerda con la cantidad. */
export function faltaText(count: number, one: string, many: string): string {
  return `${count === 1 ? "Falta" : "Faltan"} ${plural(count, one, many)}`
}

export function partsFilled(job: { parts: readonly FlowPart[] }) {
  return job.parts.filter((part) => part.description.trim())
}

/** «1,5» o «1.5» → 1,5. Una cantidad ilegible vale 0 (y no pasa la validación). */
export function parseQuantity(text: string): number {
  const value = Number(text.trim().replace(",", "."))
  return Number.isFinite(value) ? value : 0
}

function validateLectura(draft: FlowDraft, ctx: FlowCtx, errors: FlowErrors): void {
  const row = ctx.row
  if (!row) { errors.vehicle = "Elige un equipo."; return }
  const analysis = analyzeLecture(draft, row)
  if (analysis.value === null || analysis.value <= 0) errors.reading = `Ingresa la lectura del ${meterName(row.eq.unit)}.`
  else if (analysis.check && !analysis.check.ok) errors.reading = analysis.check.message
  if (!draft.workDate) errors.workDate = "Indica la fecha del trabajo."
  else if (draft.workDate > ctx.today) errors.workDate = "La fecha no puede ser futura."

  if (draft.kind === "P") {
    if (!analysis.schedule || analysis.schedule.intervals.length === 0) errors.schedule = "Este equipo no tiene pauta asignada: no se puede registrar una preventiva."
    else if (analysis.manual && draft.intervalReason.trim().length < MIN_NOTE) errors.ivReason = "Explica por qué usas otra pauta."
  }
  if (Object.keys(errors).length > 0 || analysis.value === null) return
  // Avisos que se confirman una vez: el salto de lectura (regla 3) y la preventiva repetida (regla 7).
  if (analysis.jump && !(draft.ackJump?.reading === analysis.value && draft.ackJump.workDate === draft.workDate)) errors.jump = analysis.jump.question
  if (analysis.duplicate && draft.ackDuplicate !== analysis.duplicate.id) errors.duplicate = "Ya hay una preventiva parecida de este equipo."
}

function validateTrabajo(draft: FlowDraft, ctx: FlowCtx, errors: FlowErrors): void {
  if (draft.jobs.length === 0) errors.workTypes = "Agrega al menos un trabajo."
  for (const job of draft.jobs) {
    if (job.hours < HOURS_MIN || job.hours > HOURS_MAX) errors[`job:${job.workTypeId}`] = `Las horas van entre ${HOURS_MIN} y ${HOURS_MAX}.`
    else if (!job.noParts && !partsFilled(job).some((part) => parseQuantity(part.quantity) > 0)) {
      errors[`job:${job.workTypeId}`] = "Agrega los repuestos con su cantidad, o marca «No se usaron repuestos»."
    }
  }
  if (totalHours(draft.jobs) > HOURS_MAX) errors.hours = `El total de horas no puede pasar de ${HOURS_MAX}.`
  if (draft.executorKind === "otro_mecanico" && !draft.executorUserId) errors.executor = "Elige qué mecánico hizo el trabajo."
  if (draft.executorKind === "externo" && !draft.executorWorkshopId) errors.executor = "Elige el taller externo."
  if (!draft.noOilChange && draft.oilIds.length === 0) errors.oil = "Marca qué aceite se cambió, o «No se cambió aceite»."
  if (draft.description.trim().length < MIN_DESCRIPTION) errors.description = "Describe el trabajo realizado."
  if (draft.driverIds.length === 0) errors.drivers = "Agrega al menos un conductor."
  if (draft.inWorkshop === null) errors.workshop = "Indica si el equipo sigue en taller."
  else if (draft.inWorkshop) {
    if (!draft.workshopEntryDate) errors.workshop = "Indica cuándo entró a taller."
    else if (draft.workshopEntryDate > ctx.today) errors.workshop = "La fecha de ingreso no puede ser futura."
    if (draft.workshopReason.trim().length < MIN_REASON) errors.workshopReason = "Cuenta por qué el equipo sigue en taller."
  }
}

export function validateStep(draft: FlowDraft, step: FlowStep, ctx: FlowCtx): FlowErrors {
  const errors: FlowErrors = {}
  switch (step) {
    case "equipo":
      if (!draft.vehicleId || !ctx.row) errors.vehicle = "Elige un equipo."
      break
    case "lectura":
      validateLectura(draft, ctx, errors)
      break
    case "pauta": {
      const counts = checklistCounts(draft)
      const results = draft.checklist.map((item) => ({ itemKey: item.key, value: draft.marks[item.key] ?? "", reason: draft.reasons[item.key] }))
      const left = counts.total - counts.done
      if (left > 0) errors.pauta = `${faltaText(left, "ítem", "ítems")} por marcar.`
      else if (counts.missingReason > 0) errors.pauta = `Falta el motivo de ${plural(counts.missingReason, "ítem no realizado", "ítems no realizados")}.`
      else if (!checkItemResults(draft.checklist, results).ok) errors.pauta = "Completa todos los ítems."
      break
    }
    case "fotos":
      // Preventiva: las dos fotos con nombre y las notas. Correctiva: de 1 a 3 fotos del trabajo.
      if (draft.kind === "P") {
        if (!draft.photos.filtros) errors.photo_filtros = "Falta la foto de los filtros usados."
        if (!draft.photos.sticker) errors.photo_sticker = "Falta la foto del sticker de mantención."
        if (draft.notes.trim().length < MIN_NOTE) errors.notes = "Escribe tus notas, o toca «Sin novedad» si no hay nada que anotar."
      } else if (draft.photos.correctiva.length === 0) errors.photos = "Falta al menos una foto."
      break
    case "trabajo":
      validateTrabajo(draft, ctx, errors)
      break
    case "revisar":
      break
  }
  return errors
}

/** Todos los pasos a la vez: lo que se revisa antes de firmar. */
export function validateAll(draft: FlowDraft, steps: readonly FlowStep[], ctx: FlowCtx): { step: FlowStep; errors: FlowErrors } | null {
  for (const step of steps) {
    const errors = validateStep(draft, step, ctx)
    // El salto y el duplicado son avisos que ya se confirmaron o se confirman en su pantalla: no bloquean la firma.
    delete errors.jump
    delete errors.duplicate
    if (Object.keys(errors).length > 0) return { step, errors }
  }
  return null
}
