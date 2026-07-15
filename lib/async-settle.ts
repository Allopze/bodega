/**
 * Wrapper `settle` para Promise.allSettled con fallback tipado.
 *
 * Envuelve una consulta individual (no un arreglo de promesas) y atrapa su
 * error devolviendo el valor `fallback`. El resto del Promise.all sigue en
 * paralelo normalmente — si otra consulta falla, no afecta a ésta ni viceversa.
 *
 * Uso preferido sobre Promise.allSettled directo porque:
 * 1. El llamador no necesita destructurear `{ status, value }` ni castear.
 * 2. Cada promesa falla en aislado con su propio fallback.
 * 3. El logger registra el error server-side sin silenciarlo del todo.
 *
 * @example
 * const [kpis, charts] = await Promise.all([
 *   settle(getKpis(session), { total: 0 }),
 *   settle(getCharts(session), []),
 * ])
 */
import { logger } from "@/lib/logger"

export async function settle<T>(promise: Promise<T>, fallback: T, label?: string): Promise<T> {
  try {
    return await promise
  } catch (error) {
    logger.error(`[settle]${label ? ` ${label}` : ""} Fallback usado tras error`, error)
    return fallback
  }
}
