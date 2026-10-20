import { nextRe20FollowupDueAt, type Re20SlaPolicy } from "@/lib/prevention/incidents"
import { todayInChile } from "@/lib/utils"
import type { Re20Data, Re20Incident, Re20Task } from "../../types"
import { re20TaskOf, withRe20TaskStatus } from "../../workspace-data"

/* Reglas del seguimiento y la eficacia de las medidas (RE-20-08 / RE-20-09,
 * PASO A PASO actividades 9 a 11). Sin React: se prueban por sí solas. */

export type Re20Measure = Re20Data["measures"][number]

/** Estado de la medida: cada nivel incluye al anterior (eficaz ⊂ verificada ⊂ implementada). */
export type MeasureLevel = "pending" | "implemented" | "verified" | "effective"
export const LEVEL_ORDER: readonly MeasureLevel[] = ["pending", "implemented", "verified", "effective"]
export const LEVEL_LABELS: Record<MeasureLevel, string> = {
  pending: "Sin implementar",
  implemented: "Implementada",
  verified: "Verificada",
  effective: "Eficaz",
}
export const levelAtLeast = (level: MeasureLevel, min: MeasureLevel) => LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(min)

export function levelFlags(level: MeasureLevel) {
  return { implemented: levelAtLeast(level, "implemented"), verified: levelAtLeast(level, "verified"), effective: level === "effective" }
}
export function levelFromFlags(flags: { implementedAt?: string | null; verified?: boolean; effective?: boolean }): MeasureLevel {
  if (flags.effective) return "effective"
  if (flags.verified) return "verified"
  return flags.implementedAt ? "implemented" : "pending"
}

/** Un seguimiento ya registrado (el servidor lo guarda en `preventionIncidentFollowups`). */
export interface FollowupRecord {
  id: string
  kind: "accident" | "damage"
  followupDate: string
  note: string
  measureId: string | null
  implementedAt?: string | null
  verified: boolean
  effective: boolean
  verifierUserId?: string | null
  verifiedAt?: string | null
  residualRisk?: string | null
  lostDays?: number | null
  lossDescription?: string | null
  createdAt?: string
}

/** RE-20-09 (daño material o ambiental) o RE-20-08 (accidentes e incidentes con persona). */
export function followupKind(eventType: Re20Incident["eventType"]): "accident" | "damage" {
  return eventType === "material_damage" || eventType === "environmental_spill" ? "damage" : "accident"
}
export const FOLLOWUP_FORM_CODE = { accident: "RE-20-08", damage: "RE-20-09" } as const

const EFFECTIVE_RESULT = /^eficaz$/i

/** La medida ya tiene su verificación en §10.1: quién, cuándo y con qué resultado. */
export function measureVerified(measure: Re20Measure) {
  return Boolean(measure.verifierUserId && measure.verifiedAt && measure.effectiveness?.result?.trim())
}

function recordTime(record: FollowupRecord) {
  return Date.parse(record.createdAt ?? "") || Date.parse(`${record.followupDate}T12:00:00Z`) || 0
}

export function latestRecord(records: FollowupRecord[], measureId: string) {
  return records.filter((record) => record.measureId === measureId).sort((a, b) => recordTime(b) - recordTime(a))[0] ?? null
}

/** Dónde está hoy la medida: el último seguimiento registrado manda; sin ninguno, lo que dice el expediente. */
export function measureLevel(measure: Re20Measure, records: FollowupRecord[]): MeasureLevel {
  const latest = latestRecord(records, measure.id)
  if (latest) return levelFromFlags(latest)
  if (measureVerified(measure)) return EFFECTIVE_RESULT.test(measure.effectiveness?.result?.trim() ?? "") ? "effective" : "verified"
  return "pending"
}

/* ── Formulario ──────────────────────────────────────────────────────────── */

export interface FollowupForm {
  measureId: string
  followupDate: string
  note: string
  evidenceRef: string
  controlType: string
  level: MeasureLevel
  implementedAt: string
  verifierUserId: string
  verifiedAt: string
  residualRisk: string
  lostDays: string
  lossDescription: string
}

export const FOLLOWUP_ID = (field: string) => `re20-seguimiento-form-${field}`

export function emptyFollowupForm(measure: Re20Measure, level: MeasureLevel = "pending"): FollowupForm {
  return {
    measureId: measure.id,
    followupDate: todayInChile(),
    note: "",
    evidenceRef: "",
    controlType: measure.controlType?.trim() ?? "",
    level,
    implementedAt: "",
    verifierUserId: measure.verifierUserId ?? "",
    verifiedAt: "",
    residualRisk: measure.effectiveness?.residualRisk?.trim() ?? "",
    lostDays: "",
    lossDescription: "",
  }
}

/** Qué falta para registrar. La verificación exige otra persona que el responsable (INV.DEF.ACC!B112). */
export function followupBlockers(form: FollowupForm, measure: Re20Measure): Array<{ label: string; fieldId: string }> {
  const blockers: Array<{ label: string; fieldId: string }> = []
  const { verified, implemented } = levelFlags(form.level)
  if (!form.followupDate) blockers.push({ label: "La fecha del seguimiento", fieldId: FOLLOWUP_ID("followupDate") })
  if (form.note.trim().length < 5) blockers.push({ label: "Qué se constató en este seguimiento (mínimo 5 letras)", fieldId: FOLLOWUP_ID("note") })
  if (implemented && !form.implementedAt) blockers.push({ label: "La fecha en que se implementó", fieldId: FOLLOWUP_ID("implementedAt") })
  if (verified) {
    if (!form.verifierUserId) blockers.push({ label: "Quién verificó la medida", fieldId: FOLLOWUP_ID("verifier") })
    else if (form.verifierUserId === measure.responsibleUserId) blockers.push({ label: "El verificador debe ser distinto del responsable de la medida", fieldId: FOLLOWUP_ID("verifier") })
    if (!form.verifiedAt) blockers.push({ label: "La fecha de la verificación", fieldId: FOLLOWUP_ID("verifiedAt") })
    if (!form.residualRisk) blockers.push({ label: "El riesgo residual", fieldId: FOLLOWUP_ID("residualRisk") })
  }
  const lost = form.lostDays.trim()
  if (lost && (!/^\d+$/.test(lost) || Number(lost) > 10000)) blockers.push({ label: "Los días perdidos: un número entero entre 0 y 10.000", fieldId: FOLLOWUP_ID("lostDays") })
  return blockers
}

/** Lo que recibe `recordBiweeklyFollowupAction`: sólo lo que corresponde al nivel elegido. */
export function followupPayload(form: FollowupForm, measure: Re20Measure, kind: "accident" | "damage") {
  const flags = levelFlags(form.level)
  const opt = (value: string) => value.trim() || undefined
  return {
    followupDate: form.followupDate,
    note: form.note.trim(),
    kind,
    measureId: measure.id,
    ...(measure.rootCauseId ? { rootCauseId: measure.rootCauseId } : {}),
    ...(opt(form.evidenceRef) ? { evidenceRef: opt(form.evidenceRef) } : {}),
    ...(opt(form.controlType) ? { controlType: opt(form.controlType) } : {}),
    ...(flags.implemented && form.implementedAt ? { implementedAt: form.implementedAt } : {}),
    verified: flags.verified,
    effective: flags.effective,
    ...(flags.verified ? { verifierUserId: form.verifierUserId, verifiedAt: form.verifiedAt, residualRisk: form.residualRisk } : {}),
    ...(kind === "accident" && /^\d+$/.test(form.lostDays.trim()) ? { lostDays: Number(form.lostDays.trim()) } : {}),
    ...(kind === "damage" && opt(form.lossDescription) ? { lossDescription: opt(form.lossDescription) } : {}),
  }
}

/** Fecha civil → instante al mediodía UTC (no cambia de día al mostrarla en Chile). */
export const dateToIso = (date: string) => (date ? `${date}T12:00:00.000Z` : null)
/** Instante → fecha civil de Chile, para los selectores de fecha. */
export const isoToDate = (iso: string | null | undefined) => (iso ? todayInChile(iso) : "")

/**
 * Lleva la verificación a la medida del expediente (§10.1, RE-20-04) —el PASO A PASO
 * 11 la registra ahí y en el seguimiento— y mueve las tareas del protocolo:
 * el seguimiento arranca al primer registro y termina cuando toda medida está verificada.
 */
export function applyFollowupToData(data: Re20Data, args: { measureId: string; level: MeasureLevel; verifierUserId?: string; verifiedAt?: string; residualRisk?: string; controlType?: string; effectiveLabel?: string }): Re20Data {
  const { verified, effective } = levelFlags(args.level)
  const measures = data.measures.map((measure) => {
    if (measure.id !== args.measureId) return measure
    return {
      ...measure,
      ...(args.controlType && !measure.controlType ? { controlType: args.controlType } : {}),
      ...(verified ? {
        verifierUserId: args.verifierUserId ?? measure.verifierUserId,
        verifiedAt: dateToIso(args.verifiedAt ?? "") ?? measure.verifiedAt,
        effectiveness: {
          ...measure.effectiveness,
          residualRisk: args.residualRisk ?? measure.effectiveness?.residualRisk,
          result: effective ? (args.effectiveLabel ?? "Eficaz") : measure.effectiveness?.result,
        },
      } : {}),
    }
  })
  let next: Re20Data = { ...data, measures }
  if (re20TaskOf(next, "accident_followup").status === "pending") next = withRe20TaskStatus(next, "accident_followup", "in_progress")
  if (measures.length > 0 && measures.every(measureVerified)) {
    next = withRe20TaskStatus(withRe20TaskStatus(next, "effectiveness_verification", "completed"), "accident_followup", "completed")
  }
  return next
}

/** Próximo vencimiento: «cada N días hasta que la medida sea eficaz», contado desde el último seguimiento. */
export function nextFollowupDue(records: FollowupRecord[], policy: Re20SlaPolicy, fallbackIso: string | null) {
  const last = [...records].sort((a, b) => recordTime(b) - recordTime(a))[0]
  if (!last) return fallbackIso
  return nextRe20FollowupDueAt(`${last.followupDate}T12:00:00.000Z`, policy)
}

/* ── Reunión post accidente (PASO A PASO 9) ──────────────────────────────── */

export interface MeetingNotes {
  causes: string
  newMeasures: string
  reinstruction: string
}

const MEETING_HEADINGS: Array<[keyof MeetingNotes, string]> = [
  ["causes", "Revisión de causas y medidas con la persona"],
  ["newMeasures", "Nuevas medidas acordadas"],
  ["reinstruction", "Reinstrucción"],
]
/** La nota de la tarea admite 2000 caracteres: cada parte lleva su tope. */
export const MEETING_PART_MAX = 620

export function parseMeetingNotes(note: string | null | undefined): MeetingNotes {
  const result: MeetingNotes = { causes: "", newMeasures: "", reinstruction: "" }
  const source = note ?? ""
  const hits = MEETING_HEADINGS.map(([key, heading]) => ({ key, heading, at: source.indexOf(`${heading}:`) })).filter((hit) => hit.at >= 0).sort((a, b) => a.at - b.at)
  if (hits.length === 0) {
    // Una nota escrita antes de esta pantalla se conserva entera en la primera parte.
    result.causes = source.trim()
    return result
  }
  hits.forEach((hit, index) => {
    const start = hit.at + hit.heading.length + 1
    const end = hits[index + 1]?.at ?? source.length
    result[hit.key] = source.slice(start, end).trim()
  })
  return result
}

export function serializeMeetingNotes(notes: MeetingNotes): string | null {
  const parts = MEETING_HEADINGS.filter(([key]) => notes[key].trim()).map(([key, heading]) => `${heading}: ${notes[key].trim()}`)
  return parts.length > 0 ? parts.join("\n") : null
}

export const meetingComplete = (notes: MeetingNotes, reintegrationDate: string) =>
  Boolean(reintegrationDate && notes.causes.trim() && notes.newMeasures.trim() && notes.reinstruction.trim())

/** Cambia campos de una tarea del protocolo (fecha, nota…) sin tocar su estado. */
export function withTaskFields(data: Re20Data, taskId: string, patch: Partial<Pick<Re20Task, "dueAt" | "note" | "responsibleUserId">>): Re20Data {
  const next = { ...re20TaskOf(data, taskId), ...patch }
  return { ...data, tasks: data.tasks.some((task) => task.id === taskId) ? data.tasks.map((task) => task.id === taskId ? next : task) : [...data.tasks, next] }
}
