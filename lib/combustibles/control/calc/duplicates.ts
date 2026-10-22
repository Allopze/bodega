import type { LoadSource, ReviewStatus } from "../contracts"

/**
 * Supuesto S-7: la misma carga física puede llegar por la planilla consolidada
 * y por el formulario de sellos. Una carga del mismo equipo que llega por OTRO
 * canal dentro de la ventana (± minutos) y con litros dentro de la tolerancia
 * es duplicada de la primera y sale de los cálculos.
 *
 * Una carga `approved` ya pasó por un revisor que dijo «no es duplicada»: esa
 * decisión es persistente y no se vuelve a marcar.
 */
export interface DuplicateCandidate {
  id: string
  source: LoadSource
  occurredAtMs: number
  liters: number
  voided: boolean
  reviewStatus: ReviewStatus
}

export interface DuplicateSettings {
  duplicateWindowMinutes: number
  duplicateLitersTolerance: number
}

/** Pequeño margen para comparar litros con decimales (0,5 L de tolerancia no debe fallar por 1e-12). */
const LITERS_EPSILON = 1e-9

/**
 * Devuelve `id → id de la carga original` para cada duplicada. Las cargas
 * deben venir ordenadas por instante y luego por id (el orden de la serie).
 */
export function detectDuplicates(loads: readonly DuplicateCandidate[], settings: DuplicateSettings): Map<string, string> {
  const duplicates = new Map<string, string>()
  const windowMs = settings.duplicateWindowMinutes * 60_000
  // Posibles originales: no anuladas, no rechazadas y que no son a su vez duplicadas.
  const originals: DuplicateCandidate[] = []

  for (const load of loads) {
    if (load.voided) continue
    if (load.reviewStatus !== "approved") {
      const original = findOriginal(originals, load, windowMs, settings.duplicateLitersTolerance)
      if (original) {
        duplicates.set(load.id, original.id)
        continue
      }
    }
    if (load.reviewStatus !== "rejected") originals.push(load)
  }
  return duplicates
}

function findOriginal(
  originals: readonly DuplicateCandidate[],
  load: DuplicateCandidate,
  windowMs: number,
  litersTolerance: number,
): DuplicateCandidate | null {
  // Desde la más reciente hacia atrás: la ventana es corta y la lista está ordenada.
  for (let i = originals.length - 1; i >= 0; i--) {
    const candidate = originals[i]!
    if (load.occurredAtMs - candidate.occurredAtMs > windowMs) break
    if (candidate.source === load.source) continue
    if (Math.abs(candidate.liters - load.liters) <= litersTolerance + LITERS_EPSILON) return candidate
  }
  return null
}
