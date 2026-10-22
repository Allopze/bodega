import "server-only"
import { logger } from "@/lib/logger"

/** Resultado de una consulta de la vista: el dato (o su valor seguro) y si falló. */
export interface Loaded<T> { data: T; failed: boolean }

/**
 * Seguimiento de fuentes de una vista. A diferencia de `settle`, que solo
 * registra la falla, aquí se recuerda CUÁL falló para que cada bloque muestre
 * su propio estado de error y el aviso de la página cuente cuántas cayeron:
 * un fallback vacío leído como «no hay datos» sería una afirmación falsa.
 */
export function createSourceTracker(scope: string) {
  const degraded: string[] = []
  let total = 0
  function track<T>(promise: Promise<T>, fallback: T, label: string): Promise<Loaded<T>> {
    total += 1
    return promise.then(
      (data) => ({ data, failed: false }),
      (error: unknown) => {
        logger.error(`[${scope}] ${label} falló`, error)
        degraded.push(label)
        return { data: fallback, failed: true }
      },
    )
  }
  return { track, degraded, total: () => total }
}
