/**
 * Reglas de la carga en terreno que no dependen de la base de datos. Las usan
 * el servicio (autoridad, responde 422) y el formulario por pasos (aviso
 * temprano), así el operador ve el mismo texto antes y después de enviar.
 */
import { addDaysToPlainDate, chileLocalDateTimeToUtc, formatDate, formatDateTime, formatQty, todayInChile } from "@/lib/utils"
import { isFillerSealNumber } from "@/lib/combustibles/control/validation"
import {
  CHILE_LOCAL_DATE_TIME_PATTERN,
  PAST_LOAD_REASON_MAX,
  PAST_LOAD_REASON_MIN,
  TAE_ALWAYS_REQUIRED_EVIDENCE,
  type TaeEvidenceKind,
} from "@/lib/validation/fuel-tae"

/** Tope de litros cuando el equipo no tiene capacidad de estanque cargada. */
export const FALLBACK_MAX_LITERS = 2000
export const MAX_SUBMISSION_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_FUTURE_SKEW_MS = 15 * 60 * 1000
/** Hasta cuántos días civiles de Chile hacia atrás se puede registrar una carga de otro día. */
export const MAX_PAST_LOAD_DAYS = 62

export interface FieldRuleIssue {
  field: "removedSealNumber" | "installedSealNumber" | "noSealReason" | "liters" | "meterReading" | "capturedAt" | "pastLoadAt" | "pastLoadReason"
  message: string
}

export interface SealInputs {
  removedSealNumber?: string | null
  installedSealNumber?: string | null
  noSealReason?: string | null
}

/** Sello tal como se escribió (sin espacios en los bordes); vacío → null. Nunca la forma canónica de comparación. */
export function trimSeal(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/** Valores de relleno y sello faltante sin motivo. `null` = sellos válidos. */
export function checkSealInputs(input: SealInputs): FieldRuleIssue | null {
  const removed = trimSeal(input.removedSealNumber)
  const installed = trimSeal(input.installedSealNumber)
  for (const [field, value, label] of [
    ["removedSealNumber", removed, "retirado"],
    ["installedSealNumber", installed, "instalado"],
  ] as const) {
    if (value && isFillerSealNumber(value)) {
      return {
        field,
        message: `El sello ${label} "${value}" no parece un número real. Anota el número grabado en el sello; si no hay sello, deja el campo vacío e indica el motivo.`,
      }
    }
  }
  if ((!removed || !installed) && !(input.noSealReason ?? "").trim()) {
    return { field: "noSealReason", message: "Falta un sello. Escribe su número o indica por qué no hay sello." }
  }
  return null
}

export function litersLimitFor(tankCapacityLiters: number | null | undefined): number {
  return tankCapacityLiters != null && tankCapacityLiters > 0 ? tankCapacityLiters : FALLBACK_MAX_LITERS
}

export function checkLiters(liters: number, tankCapacityLiters: number | null | undefined): FieldRuleIssue | null {
  if (!Number.isFinite(liters) || liters <= 0) return { field: "liters", message: "Los litros deben ser mayores que cero." }
  const limit = litersLimitFor(tankCapacityLiters)
  if (liters > limit) {
    return {
      field: "liters",
      message: tankCapacityLiters != null && tankCapacityLiters > 0
        ? `Los ${formatQty(liters)} L superan la capacidad del estanque de este equipo (${formatQty(limit)} L). Revisa el número que anotaste.`
        : `Los ${formatQty(liters)} L superan el máximo permitido por carga (${formatQty(limit)} L). Revisa el número que anotaste.`,
    }
  }
  return null
}

export function meterRegressionMessage(reading: number, previous: number): string {
  return `La lectura ${formatQty(reading)} es menor que la última registrada para este equipo (${formatQty(previous)}). Revisa el número del tablero. Si el tablero o el equipo fue cambiado, pide a tu supervisor que lo corrija.`
}

export type LoadedAtSource = "server" | "device_offline" | "backdated"

/** Carga de otro día tal como llega del formulario: hora de pared de Chile y motivo. */
export interface PastLoadRequest {
  loadedAt?: string | null
  reason?: string | null
}

/** Primer y último día civil de Chile en que se puede fechar una carga de otro día. */
export function pastLoadWindow(nowMs: number = Date.now()): { earliestDay: string; latestDay: string } {
  const latestDay = todayInChile(nowMs)
  return { earliestDay: addDaysToPlainDate(latestDay, -MAX_PAST_LOAD_DAYS), latestDay }
}

/** `2026-10-12T14:30` solo vale si cada parte existe en el calendario (el 31 de abril no). */
function isRealLocalDateTime(value: string): boolean {
  if (!CHILE_LOCAL_DATE_TIME_PATTERN.test(value)) return false
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number) as [number, number, number, number, number]
  const rebuilt = new Date(Date.UTC(year, month - 1, day, hour, minute))
  return rebuilt.getUTCFullYear() === year && rebuilt.getUTCMonth() === month - 1 && rebuilt.getUTCDate() === day
    && rebuilt.getUTCHours() === hour && rebuilt.getUTCMinutes() === minute
}

/**
 * Valida una carga de otro día: fecha real, no futura, dentro de los
 * `MAX_PAST_LOAD_DAYS` días civiles de Chile, y un motivo con palabras. Lo usan
 * el servicio (autoridad) y el formulario (aviso temprano), con el mismo texto.
 */
export function checkPastLoad(
  input: PastLoadRequest,
  nowMs: number = Date.now(),
): { ok: true; loadedAt: string; reason: string } | { ok: false; issue: FieldRuleIssue } {
  const local = (input.loadedAt ?? "").trim()
  if (!isRealLocalDateTime(local)) {
    return { ok: false, issue: { field: "pastLoadAt", message: "Indica la fecha y la hora en que se hizo la carga." } }
  }
  const loadedAt = chileLocalDateTimeToUtc(local)
  const loadedMs = Date.parse(loadedAt)
  if (loadedMs > nowMs) {
    return { ok: false, issue: { field: "pastLoadAt", message: "La fecha y la hora de la carga no pueden ser futuras." } }
  }
  const { earliestDay } = pastLoadWindow(nowMs)
  if (todayInChile(loadedMs) < earliestDay) {
    return {
      ok: false,
      issue: {
        field: "pastLoadAt",
        message: `Solo se pueden registrar cargas de hasta ${MAX_PAST_LOAD_DAYS} días atrás (desde el ${formatDate(earliestDay)}). Una carga más antigua se ingresa por planilla.`,
      },
    }
  }
  const reason = (input.reason ?? "").trim()
  if (reason.length < PAST_LOAD_REASON_MIN) {
    return { ok: false, issue: { field: "pastLoadReason", message: `Cuenta por qué se registra después (al menos ${PAST_LOAD_REASON_MIN} caracteres).` } }
  }
  if (reason.length > PAST_LOAD_REASON_MAX) {
    return { ok: false, issue: { field: "pastLoadReason", message: `El motivo no puede superar ${PAST_LOAD_REASON_MAX} caracteres.` } }
  }
  return { ok: true, loadedAt, reason }
}

export type ResolvedLoadedAt =
  | { ok: true; loadedAt: string; source: LoadedAtSource; /** Solo en `backdated`. */ backdateReason?: string }
  | { ok: false; issue: FieldRuleIssue }

/**
 * S-5: en línea la hora es la del servidor. Solo un reenvío desde la cola sin
 * conexión conserva la hora del dispositivo, acotada a la ventana permitida.
 * La única otra fuente es `backdated`: una carga de otro día que registra una
 * persona con permiso desde la app (`pastLoad`), con su motivo.
 */
export function resolveLoadedAt(
  input: { offline?: boolean | null; capturedAt?: string | null; pastLoad?: PastLoadRequest | null },
  nowMs: number = Date.now(),
): ResolvedLoadedAt {
  if (input.pastLoad) {
    const past = checkPastLoad(input.pastLoad, nowMs)
    if (!past.ok) return past
    return { ok: true, loadedAt: past.loadedAt, source: "backdated", backdateReason: past.reason }
  }
  if (input.offline && input.capturedAt) {
    const captured = new Date(input.capturedAt).getTime()
    if (!Number.isFinite(captured) || captured < nowMs - MAX_SUBMISSION_AGE_MS || captured > nowMs + MAX_FUTURE_SKEW_MS) {
      return {
        ok: false,
        issue: { field: "capturedAt", message: "La fecha y hora de esta carga está fuera del rango permitido (hasta 30 días atrás). Revisa la hora del teléfono y vuelve a registrarla." },
      }
    }
    return { ok: true, loadedAt: new Date(captured).toISOString(), source: "device_offline" }
  }
  return { ok: true, loadedAt: new Date(nowMs).toISOString(), source: "server" }
}

/**
 * Fotos exigidas: odómetro y medidor de litros siempre; cada sello solo si se informa su número (D-9).
 * Una carga de otro día (`loadedAtSource: "backdated"`, que trae la fila ya guardada) no exige
 * ninguna: el detector de «evidencia faltante» pasa la fila completa y no debe abrirle un caso.
 */
export function requiredEvidenceKinds(input: SealInputs & { loadedAtSource?: string | null }): TaeEvidenceKind[] {
  if (input.loadedAtSource === "backdated") return []
  const kinds: TaeEvidenceKind[] = [...TAE_ALWAYS_REQUIRED_EVIDENCE]
  if (trimSeal(input.removedSealNumber)) kinds.push("removed_seal")
  if (trimSeal(input.installedSealNumber)) kinds.push("installed_seal")
  return kinds
}

export const EVIDENCE_LABELS: Record<TaeEvidenceKind, string> = {
  odometer: "Foto del odómetro u horómetro",
  liter_meter: "Foto del medidor de litros",
  removed_seal: "Foto del sello retirado",
  installed_seal: "Foto del sello instalado",
}

export function missingEvidenceMessage(missing: TaeEvidenceKind[]): string {
  return `Falta: ${missing.map((kind) => EVIDENCE_LABELS[kind].toLowerCase()).join(", ")}.`
}

export function meterAboveNextMessage(reading: number, next: number, nextAt: string): string {
  return `La lectura ${formatQty(reading)} es mayor que la de la carga siguiente de este equipo (${formatQty(next)}, el ${formatDateTime(nextAt)}). Revisa el número del tablero o la fecha que indicaste.`
}

/** Aviso de una posible carga repetida: dice cuál es y qué hacer si de verdad son dos. */
export function possibleDuplicateMessage(other: { loadedAt: string; liters: number }): string {
  return `Ya hay una carga de este equipo el ${formatDateTime(other.loadedAt)} con ${formatQty(other.liters)} L. Si es la misma, no la registres otra vez; si son dos cargas distintas, puedes registrarla igual.`
}

/** Otra carga del mismo equipo que se parece a la que se está registrando. */
export interface DuplicateLoadSummary {
  id: string
  loadedAt: string
  liters: number
  equipment: string
  href: string
}

/**
 * Rechazo que el operador puede resolver confirmando: hay una carga muy parecida
 * y quizá sea la misma. Responde 422 con la otra carga; `acknowledgeDuplicate`
 * en el mismo envío lo salta. No es un `TaeSubmissionRejected`: su código no
 * pertenece a esa lista y el formulario lo trata distinto (muestra la otra carga
 * y deja seguir en vez de mandar a corregir un campo).
 */
export class PossibleDuplicateLoad extends Error {
  readonly status = 422
  readonly code = "possible_duplicate" as const
  constructor(readonly duplicateOf: DuplicateLoadSummary) {
    super(possibleDuplicateMessage(duplicateOf))
    this.name = "PossibleDuplicateLoad"
  }
}

export function isPossibleDuplicateLoad(error: unknown): error is PossibleDuplicateLoad {
  return error instanceof Error && error.name === "PossibleDuplicateLoad" && (error as { code?: unknown }).code === "possible_duplicate"
}

/** Llegó una carga de otro día de alguien sin `combustibles:register_past_load`: 403, no 422. */
export class PastLoadNotAllowed extends Error {
  readonly status = 403
  constructor() {
    super("No tienes permiso para registrar cargas con fecha pasada.")
    this.name = "PastLoadNotAllowed"
  }
}

export function isPastLoadNotAllowed(error: unknown): error is PastLoadNotAllowed {
  return error instanceof Error && error.name === "PastLoadNotAllowed" && (error as { status?: unknown }).status === 403
}
