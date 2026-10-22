/**
 * Reglas de la carga en terreno que no dependen de la base de datos. Las usan
 * el servicio (autoridad, responde 422) y el formulario por pasos (aviso
 * temprano), así el operador ve el mismo texto antes y después de enviar.
 */
import { formatQty } from "@/lib/utils"
import { isFillerSealNumber } from "@/lib/combustibles/control/validation"
import { TAE_ALWAYS_REQUIRED_EVIDENCE, type TaeEvidenceKind } from "@/lib/validation/fuel-tae"

/** Tope de litros cuando el equipo no tiene capacidad de estanque cargada. */
export const FALLBACK_MAX_LITERS = 2000
export const MAX_SUBMISSION_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_FUTURE_SKEW_MS = 15 * 60 * 1000

export interface FieldRuleIssue {
  field: "removedSealNumber" | "installedSealNumber" | "noSealReason" | "liters" | "meterReading" | "capturedAt"
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

export type LoadedAtSource = "server" | "device_offline"

/**
 * S-5: en línea la hora es la del servidor. Solo un reenvío desde la cola sin
 * conexión conserva la hora del dispositivo, acotada a la ventana permitida.
 */
export function resolveLoadedAt(
  input: { offline?: boolean | null; capturedAt?: string | null },
  nowMs: number = Date.now(),
): { ok: true; loadedAt: string; source: LoadedAtSource } | { ok: false; issue: FieldRuleIssue } {
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

/** Fotos exigidas: odómetro y medidor de litros siempre; cada sello solo si se informa su número (D-9). */
export function requiredEvidenceKinds(input: SealInputs): TaeEvidenceKind[] {
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
