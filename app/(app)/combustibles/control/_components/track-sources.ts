import "server-only"
import { logger } from "@/lib/logger"

/** Resultado de una consulta de la vista: el dato (o su valor seguro) y si falló. */
export interface Loaded<T> { data: T; failed: boolean }

/**
 * Seguimiento de las fuentes de una pantalla de Consumo. A diferencia de
 * `settle`, que sólo registra la falla, aquí se recuerda CUÁL falló para que
 * cada bloque muestre su propio error y `DegradedDataBanner` cuente cuántas
 * cayeron: un valor de respaldo vacío leído como «no hay datos» sería una
 * afirmación falsa.
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
