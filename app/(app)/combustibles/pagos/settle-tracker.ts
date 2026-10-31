import { settle } from "@/lib/async-settle"

/**
 * `settle` con memoria de qué consultas cayeron a su respaldo: la pantalla sigue
 * rindiendo, y `DegradedDataBanner` dice cuántas fuentes no se pudieron cargar en
 * vez de mostrar un cero o una lista vacía como si fueran el dato real. El error
 * se registra en el servidor (lo hace `settle`).
 */
export function createSettleTracker() {
  const degraded: string[] = []
  let total = 0

  function track<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
    total += 1
    return settle(
      promise.catch((error: unknown) => {
        degraded.push(label)
        throw error
      }),
      fallback,
      label,
    )
  }

  return { track, degraded, total: () => total }
}
