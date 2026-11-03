/**
 * Antigüedad de la cola de aprobaciones (CHART-030 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`).
 *
 * Módulo **puro** y sin directiva de cliente a propósito: lo leen el servidor
 * (la página y su consulta), el gráfico y el chip de filtro activo, que vive en
 * un componente de cliente. El SQL que calcula la edad está aparte, en
 * `app/(app)/aprobaciones/queue-age.ts`.
 *
 * La edad es de **días civiles chilenos** entre el día de envío y hoy —la foto
 * del momento—, no de horas transcurridas: lo enviado ayer a las 23:00 tiene 1
 * día esta mañana, no 9 horas. La cuenta la hace la base (ver `queue-age.ts`) y
 * aquí sólo se reparte en tramos, de modo que la lista, los contadores y el
 * filtro por URL no puedan discrepar entre sí.
 */

export const APPROVAL_AGE_BUCKETS = [
  { key: "0-1", label: "0–1 días", min: 0, max: 1 },
  { key: "2-3", label: "2–3 días", min: 2, max: 3 },
  { key: "4-7", label: "4–7 días", min: 4, max: 7 },
  { key: "mas-de-7", label: "Más de 7 días", min: 8, max: null },
] as const

export type ApprovalAgeKey = (typeof APPROVAL_AGE_BUCKETS)[number]["key"]
export type ApprovalAgeCounts = Record<ApprovalAgeKey, number>

/** Valor de `?antiguedad=` ya validado; `""` es «sin filtro». */
export type ApprovalAgeFilter = ApprovalAgeKey | ""

export const APPROVAL_AGE_PARAM = "antiguedad"

/** Tramo de una edad en días enteros. Una edad negativa (reloj adelantado) cuenta como recién enviada. */
export function approvalAgeBucketKey(days: number): ApprovalAgeKey {
  const whole = Math.max(0, Math.floor(days))
  const bucket = APPROVAL_AGE_BUCKETS.find((candidate) => candidate.max === null || whole <= candidate.max)
  // El último tramo no tiene techo, así que `find` siempre acierta.
  return bucket!.key
}

/**
 * Reparte filas `{ edad, ítems }` en los cuatro tramos. Una solicitud sin fecha
 * de envío (`ageDays` nulo) no se cuenta: no se sabe cuánto lleva esperando y
 * meterla en «0–1 días» diría que es reciente.
 */
export function bucketApprovalAges(
  rows: ReadonlyArray<{ ageDays: number | null; items: number }>,
): ApprovalAgeCounts {
  const counts: ApprovalAgeCounts = { "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 }
  for (const row of rows) {
    if (row.ageDays === null || !Number.isFinite(row.ageDays)) continue
    counts[approvalAgeBucketKey(row.ageDays)] += row.items
  }
  return counts
}

/** `?antiguedad=` es entrada del usuario: sólo pasan las claves de tramo. */
export function parseApprovalAgeParam(value: string | string[] | undefined): ApprovalAgeFilter {
  const raw = Array.isArray(value) ? value[0] : value
  return APPROVAL_AGE_BUCKETS.find((bucket) => bucket.key === raw)?.key ?? ""
}

export function approvalAgeBucketLabel(key: string): string | null {
  return APPROVAL_AGE_BUCKETS.find((bucket) => bucket.key === key)?.label ?? null
}

/** «hoy», «hace 1 día», «hace 5 días». Sin fecha de envío no se inventa nada. */
export function formatApprovalAge(days: number | null): string | null {
  if (days === null || !Number.isFinite(days)) return null
  if (days <= 0) return "hoy"
  return days === 1 ? "hace 1 día" : `hace ${days} días`
}

/**
 * La respuesta que el gráfico da antes que el dibujo: cuánto espera y cuánto
 * lleva más de una semana. Con un tramo elegido, qué parte del total muestra la
 * lista.
 */
export function approvalAgeSummary(counts: ApprovalAgeCounts, active: ApprovalAgeFilter): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (total === 0) return ""
  if (active) {
    return `Filtrando por «${approvalAgeBucketLabel(active)}»: ${counts[active]} de ${total} ítems.`
  }
  const old = counts["mas-de-7"]
  const waiting = `${total} ${total === 1 ? "ítem espera" : "ítems esperan"} tu decisión`
  if (old === 0) return `${waiting}; ninguno lleva más de 7 días.`
  return `${waiting}; ${old} ${old === 1 ? "lleva" : "llevan"} más de 7 días.`
}

/**
 * URL de la cola con el tramo `key` (o sin tramo si `key` es `""`, que es la
 * salida del filtro). Conserva el resto de los filtros y descarta `page`: al
 * cambiar el conjunto, el número de página ya no significa nada.
 */
export function approvalAgeHref(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
  key: ApprovalAgeFilter,
): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(searchParams)) {
    if (name === "page" || name === APPROVAL_AGE_PARAM) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item)
    } else if (value) {
      params.set(name, value)
    }
  }
  if (key) params.set(APPROVAL_AGE_PARAM, key)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}
