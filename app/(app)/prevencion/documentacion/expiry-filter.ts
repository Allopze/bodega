/**
 * Filtro por vencimiento de la documentación (TASK-UI-006).
 *
 * El indicador del panel y la tira de "Atención documental" anunciaban cuántos
 * documentos vencen pronto, pero llevaban a la lista completa: el usuario tenía
 * que buscar a mano lo que la cifra ya había contado. Estos tres rangos son los
 * mismos que calcula `getDashboardCounters`, de modo que el número del
 * indicador y el de la lista filtrada no pueden discrepar.
 */
export type ExpiryFilter = "7" | "30" | "vencidos"

export const EXPIRY_FILTER_LABELS: Record<ExpiryFilter, string> = {
  "7": "Vencen en 7 días",
  "30": "Vencen en 30 días",
  vencidos: "Ya vencidos",
}

export function parseExpiryFilter(value: string | undefined): ExpiryFilter | null {
  if (value === "7" || value === "30" || value === "vencidos") return value
  return null
}

/** Fecha de hoy en hora de Chile continental, en `YYYY-MM-DD`. */
function todayInChile(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function plusDays(isoDate: string, days: number): string {
  const next = new Date(`${isoDate}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

/**
 * Traduce el filtro a los campos que `searchDocuments` ya entendía.
 *
 * "Ya vencidos" mira sólo hacia atrás; los otros dos son una ventana que empieza
 * hoy, para no mezclar lo vencido con lo que está por vencer: son dos tareas
 * distintas y confundirlas infla la urgencia.
 */
export function expiryFilterInput(filter: ExpiryFilter | null): { expiresBefore?: string; expiresAfter?: string } {
  if (!filter) return {}
  const today = todayInChile()
  if (filter === "vencidos") return { expiresBefore: today }
  return { expiresAfter: today, expiresBefore: plusDays(today, Number(filter)) }
}
