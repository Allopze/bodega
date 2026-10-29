import type { MantItemValue, MantScheduleSnapshot } from "../types"
import { groupChecklist } from "../schedule"
import { groupDone, HOURS_MAX, HOURS_MIN } from "./flow-validate"
import { newJob, stepsFor, type FlowDraft, type FlowErrors, type FlowJob, type FlowStep } from "./flow-types"

/**
 * Reductor puro del flujo de registro. No toca red, ni IndexedDB, ni el reloj:
 * todo lo que necesita saber del mundo (qué es válido, qué se recalcula al salir
 * de «Lectura») llega en `FlowEnv`. Así se prueba sin navegador.
 *
 * Reglas que sostiene:
 *  - «Cambiar» en Revisar lleva al paso y VUELVE directo a Revisar…
 *  - …salvo que el cambio invalide un paso intermedio: ahí se detiene.
 *  - Cambiar el equipo borra lo que dependía de él (lectura, pauta, marcas).
 */

export interface FlowEnv {
  validate(draft: FlowDraft, step: FlowStep): FlowErrors
  /** Lo que se recalcula al salir de un paso (la pauta al salir de «Lectura»). `null` si no hay nada. */
  leave(draft: FlowDraft, step: FlowStep): Partial<FlowDraft> | null
}

export type FlowAction =
  | { type: "patch"; patch: Partial<FlowDraft> }
  | { type: "pickEquipment"; vehicleId: string; schedule: MantScheduleSnapshot | null }
  | { type: "toggleId"; field: "oilIds" | "driverIds"; id: string }
  | { type: "noOilChange" }
  | { type: "mark"; key: string; value: MantItemValue }
  | { type: "markGroup"; group: number }
  | { type: "reason"; key: string; text: string }
  | { type: "toggleGroup"; group: number }
  | { type: "openGroup"; group: number }
  | { type: "photo"; slot: "filtros" | "sticker"; id: string | null }
  | { type: "photoAdd"; id: string }
  | { type: "photoRemove"; id: string }
  | { type: "jobAdd"; workTypeId: string }
  | { type: "jobRemove"; workTypeId: string }
  /** Deshace un «Quitar trabajo»: lo vuelve a su lugar (sin repetir el tipo). */
  | { type: "jobRestore"; job: FlowJob; index: number }
  | { type: "jobHours"; workTypeId: string; hours: number }
  | { type: "jobNoParts"; workTypeId: string; noParts: boolean }
  | { type: "jobPart"; workTypeId: string; index: number; field: "quantity" | "description"; text: string }
  | { type: "jobPartAdd"; workTypeId: string }
  | { type: "jobPartRemove"; workTypeId: string; index: number }
  | { type: "back" }
  | { type: "goStep"; step: number; backToReview: boolean }
  | { type: "next"; env: FlowEnv }
  | { type: "errors"; errors: FlowErrors }

/** Qué errores se limpian al editar cada campo: el aviso desaparece apenas se corrige. */
const ERRORS_CLEARED_BY: Partial<Record<keyof FlowDraft, string[]>> = {
  vehicleId: ["vehicle"],
  readingText: ["reading", "jump", "duplicate"],
  workDate: ["workDate", "reading", "jump", "duplicate"],
  intervalIndex: ["ivReason", "duplicate"],
  intervalReason: ["ivReason"],
  notes: ["notes"],
  jobs: ["workTypes", "hours"],
  oilIds: ["oil"],
  noOilChange: ["oil"],
  executorKind: ["executor"],
  executorUserId: ["executor"],
  executorWorkshopId: ["executor"],
  description: ["description"],
  inWorkshop: ["workshop", "workshopReason"],
  workshopEntryDate: ["workshop"],
  workshopReason: ["workshopReason"],
  driverIds: ["drivers"],
  photos: ["photos", "photo_filtros", "photo_sticker"],
  ackJump: ["jump"],
  ackDuplicate: ["duplicate"],
}

function clearErrors(draft: FlowDraft, changed: Array<keyof FlowDraft>): FlowErrors {
  const drop = new Set(changed.flatMap((field) => ERRORS_CLEARED_BY[field] ?? []))
  const dropJobs = changed.includes("jobs")
  if (drop.size === 0) return draft.errors
  // Los errores por trabajo (`job:<tipo>`) también se limpian al editar la lista.
  return Object.fromEntries(Object.entries(draft.errors).filter(([key]) => !drop.has(key) && !(dropJobs && key.startsWith("job:"))))
}

function patched(draft: FlowDraft, patch: Partial<FlowDraft>): FlowDraft {
  const changed = Object.keys(patch) as Array<keyof FlowDraft>
  return { ...draft, ...patch, errors: patch.errors ?? clearErrors(draft, changed) }
}

function withJob(draft: FlowDraft, workTypeId: string, change: (job: FlowJob) => FlowJob): FlowJob[] {
  return draft.jobs.map((job) => (job.workTypeId === workTypeId ? change(job) : job))
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id]
}

/** Pasa de un paso a otro; con `ret` se detiene en el primer paso intermedio que quedó inválido. */
function advance(draft: FlowDraft, env: FlowEnv): FlowDraft {
  const steps = stepsFor(draft.kind)
  const current = steps[draft.step]
  if (!current) return draft
  const errors = env.validate(draft, current)
  if (Object.keys(errors).length > 0) return { ...draft, errors }

  const left = { ...draft, ...(env.leave(draft, current) ?? {}), errors: {} }
  if (draft.ret === null) return { ...left, step: Math.min(draft.step + 1, steps.length - 1) }

  let step = draft.step + 1
  while (step < draft.ret) {
    const target = steps[step]
    if (!target || Object.keys(env.validate(left, target)).length > 0) break
    step++
  }
  return { ...left, step, ret: step >= draft.ret ? null : draft.ret }
}

export function flowReducer(draft: FlowDraft, action: FlowAction): FlowDraft {
  switch (action.type) {
    case "patch":
      return patched(draft, action.patch)

    case "pickEquipment": {
      if (draft.vehicleId === action.vehicleId) return patched(draft, { schedule: draft.schedule ?? action.schedule })
      return patched(draft, {
        vehicleId: action.vehicleId, schedule: action.schedule,
        readingText: "", intervalIndex: null, intervalOpen: false, intervalReason: "", ackJump: null, ackDuplicate: null,
        checklist: [], intervalValue: null, suggestedIntervalValue: null, marks: {}, reasons: {}, openGroup: 0,
      })
    }

    case "toggleId":
      return patched(draft, { [action.field]: toggled(draft[action.field], action.id) } as Partial<FlowDraft>)

    case "noOilChange":
      // «No se cambió aceite» y los aceites se excluyen entre sí.
      return patched(draft, draft.noOilChange ? { noOilChange: false } : { noOilChange: true, oilIds: [] })

    case "mark": {
      const was = draft.marks[action.key]
      const marks = { ...draft.marks }
      if (was === action.value) delete marks[action.key]
      else marks[action.key] = action.value
      const next = { ...draft, marks }
      const groups = groupChecklist(draft.checklist)
      const at = groups.findIndex((group) => group.items.some((item) => item.key === action.key))
      const group = groups[at]
      // Al completar el sistema abierto con un «Realizado»/«No aplica», se abre el siguiente pendiente.
      if (group && at === draft.openGroup && action.value !== "NR" && !groupDone(draft, group.items) && groupDone(next, group.items)) {
        return { ...next, openGroup: firstIncompleteGroupAfter(next, at) }
      }
      return next
    }

    case "markGroup": {
      const group = groupChecklist(draft.checklist)[action.group]
      if (!group) return draft
      const marks = { ...draft.marks }
      for (const item of group.items) if (!marks[item.key]) marks[item.key] = "R"
      return { ...draft, marks }
    }

    case "reason":
      return { ...draft, reasons: { ...draft.reasons, [action.key]: action.text } }

    case "toggleGroup":
      return { ...draft, openGroup: draft.openGroup === action.group ? -1 : action.group }

    case "openGroup":
      return { ...draft, openGroup: action.group }

    case "photo":
      return patched(draft, { photos: { ...draft.photos, [action.slot]: action.id } })

    case "photoAdd":
      if (draft.photos.correctiva.length >= 3 || draft.photos.correctiva.includes(action.id)) return draft
      return patched(draft, { photos: { ...draft.photos, correctiva: [...draft.photos.correctiva, action.id] } })

    case "photoRemove":
      return patched(draft, {
        photos: {
          filtros: draft.photos.filtros === action.id ? null : draft.photos.filtros,
          sticker: draft.photos.sticker === action.id ? null : draft.photos.sticker,
          correctiva: draft.photos.correctiva.filter((id) => id !== action.id),
        },
      })

    case "jobAdd":
      if (draft.jobs.some((job) => job.workTypeId === action.workTypeId)) return draft
      return patched(draft, { jobs: [...draft.jobs, newJob(action.workTypeId)] })

    case "jobRemove":
      return patched(draft, { jobs: draft.jobs.filter((job) => job.workTypeId !== action.workTypeId) })

    case "jobRestore": {
      if (draft.jobs.some((job) => job.workTypeId === action.job.workTypeId)) return draft
      const jobs = [...draft.jobs]
      jobs.splice(Math.min(action.index, jobs.length), 0, action.job)
      return patched(draft, { jobs })
    }

    case "jobHours": {
      const stepped = Math.round(action.hours * 2) / 2
      const hours = Math.min(HOURS_MAX, Math.max(HOURS_MIN, stepped))
      return patched(draft, { jobs: withJob(draft, action.workTypeId, (job) => ({ ...job, hours })) })
    }

    case "jobNoParts":
      return patched(draft, { jobs: withJob(draft, action.workTypeId, (job) => ({ ...job, noParts: action.noParts })) })

    case "jobPart":
      return patched(draft, {
        jobs: withJob(draft, action.workTypeId, (job) => ({
          ...job, parts: job.parts.map((part, i) => (i === action.index ? { ...part, [action.field]: action.text } : part)),
        })),
      })

    case "jobPartAdd":
      return patched(draft, { jobs: withJob(draft, action.workTypeId, (job) => ({ ...job, parts: [...job.parts, { quantity: "1", description: "" }] })) })

    case "jobPartRemove":
      return patched(draft, {
        jobs: withJob(draft, action.workTypeId, (job) => {
          const parts = job.parts.filter((_, i) => i !== action.index)
          return { ...job, parts: parts.length > 0 ? parts : [{ quantity: "1", description: "" }] }
        }),
      })

    case "back":
      return draft.step === 0 ? draft : { ...draft, step: draft.step - 1, ret: null, errors: {} }

    case "goStep":
      return { ...draft, step: action.step, errors: {}, ret: action.backToReview ? stepsFor(draft.kind).length - 1 : null }

    case "next":
      return advance(draft, action.env)

    case "errors":
      return { ...draft, errors: action.errors }
  }
}

function firstIncompleteGroupAfter(draft: FlowDraft, at: number): number {
  const groups = groupChecklist(draft.checklist)
  const next = groups.findIndex((group, index) => index > at && !groupDone(draft, group.items))
  return next
}
