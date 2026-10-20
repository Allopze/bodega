/**
 * Consulta del Seguimiento de inspecciones, en puro: sin base de datos ni React.
 *
 * Una sola definición de «en qué estado está un hallazgo» y de «qué filtros trae la URL», para que la
 * pantalla, el servicio y el Excel del Anexo 15 no lean tres cosas distintas bajo el mismo nombre
 * (el patrón de `inspection-list-query.ts`: el mismo parser alimenta filas y descarga).
 */

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams

/**
 * Las cuatro situaciones en que puede estar un hallazgo. Son excluyentes: cada hallazgo cae en
 * exactamente una, de modo que un filtro por estado y el orden de atención no se contradicen.
 */
export const FOLLOWUP_STATUSES = ["sin_capa", "abiertas", "vencidas", "cerradas"] as const
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number]

export const FOLLOWUP_STATUS_LABELS: Record<FollowupStatus, string> = {
  sin_capa: "Sin acción CAPA",
  abiertas: "Abiertas",
  vencidas: "Vencidas",
  cerradas: "Cerradas",
}

/** Tipos de instrumento por los que se puede acotar (los mismos de `INSPECTION_KIND_LABELS`). */
export const FOLLOWUP_KINDS = ["inspection", "observation", "audit"] as const
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number]

export interface InspectionFollowupFilter {
  worksiteId?: string
  status?: FollowupStatus
  kind?: FollowupKind
  /** Texto libre sobre hallazgo, medida, código, sujeto, faena y responsable. */
  search?: string
}

/**
 * `attention`: lo que pide acción primero (vencidas, luego sin acción CAPA, luego abiertas por plazo,
 * luego cerradas). `chronological`: del más antiguo al más nuevo, que es el orden del Excel oficial.
 */
export type InspectionFollowupOrder = "attention" | "chronological"

/** Una acción CAPA en alguno de estos estados ya no está viva: no hay nada que ejecutar. */
const CLOSED_CAPA_STATUSES = new Set(["verified", "closed", "cancelled"])

/** Lo que hace falta de una fila para clasificarla; `InspectionFollowupRow` lo cumple. */
export interface FollowupClassifiable {
  actionId: string | null
  /** Estado crudo de la acción CAPA (`pending`, `in_progress`…); `null` sin acción. */
  capaStatus: string | null
  /** Plazo comprometido de la acción (`YYYY-MM-DD`); `null` sin acción. */
  targetDate: string | null
  /** Estado crudo del hallazgo (`open`, `capa_linked`, `closed`). */
  findingStatus: string
}

/**
 * Clasifica un hallazgo. `today` es el día de Chile (`todayInChile()`), no el de UTC: entre las 20:00
 * y la medianoche el segundo ya es mañana y lo que vence hoy aparecería vencido.
 *
 * - Sin acción CAPA y sin cerrar: `sin_capa` (nadie se ha hecho cargo).
 * - Sin acción CAPA pero cerrado (se resolvió sin derivar): `cerradas`.
 * - Con acción viva: `vencidas` si su plazo ya pasó, `abiertas` si no.
 * - Con acción verificada, cerrada o cancelada: `cerradas`.
 */
export function followupStatusOf(row: FollowupClassifiable, today: string): FollowupStatus {
  if (!row.actionId) return row.findingStatus === "closed" ? "cerradas" : "sin_capa"
  if (row.capaStatus && CLOSED_CAPA_STATUSES.has(row.capaStatus)) return "cerradas"
  return row.targetDate && row.targetDate < today ? "vencidas" : "abiertas"
}

/** Prioridad de atención de cada situación: menor es primero. */
const ATTENTION_RANK: Record<FollowupStatus, number> = { vencidas: 0, sin_capa: 1, abiertas: 2, cerradas: 3 }

/**
 * Orden de la pantalla. Es estable: dentro de una misma situación respeta el orden en que llegaron las
 * filas (cronológico), salvo en vencidas y abiertas, donde manda el plazo (la más atrasada, o la que
 * vence antes, primero). Recibe el estado ya calculado para no clasificar dos veces.
 */
export function compareByAttention(
  a: { followupStatus: FollowupStatus; targetDate: string | null },
  b: { followupStatus: FollowupStatus; targetDate: string | null },
): number {
  const byRank = ATTENTION_RANK[a.followupStatus] - ATTENTION_RANK[b.followupStatus]
  if (byRank !== 0) return byRank
  if (a.followupStatus === "vencidas" || a.followupStatus === "abiertas") {
    return (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31")
  }
  return 0
}

/** Días calendario que lleva vencido un plazo (`YYYY-MM-DD`) a la fecha `today`; 0 si no ha vencido. */
export function followupDaysOverdue(targetDate: string | null, today: string): number {
  if (!targetDate || targetDate >= today) return 0
  const target = Date.parse(`${targetDate}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(target) || Number.isNaN(now)) return 0
  return Math.round((now - target) / 86_400_000)
}

function single(params: SearchParams, key: string) {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

function clean(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

/**
 * Lee la URL de la pantalla (y del enlace de descarga). Un valor que no existe se descarta en vez de
 * convertirse en un filtro que devuelve cero filas sin decir por qué.
 */
export function parseInspectionFollowupQuery(params: SearchParams): InspectionFollowupFilter {
  const status = clean(single(params, "estado"))
  const kind = clean(single(params, "tipo"))
  const worksiteId = clean(single(params, "faena"))
  const search = clean(single(params, "q"))

  const filter: InspectionFollowupFilter = {}
  if (status && (FOLLOWUP_STATUSES as readonly string[]).includes(status)) filter.status = status as FollowupStatus
  if (kind && (FOLLOWUP_KINDS as readonly string[]).includes(kind)) filter.kind = kind as FollowupKind
  if (worksiteId) filter.worksiteId = worksiteId
  if (search) filter.search = search
  return filter
}

/** Query del enlace «Exportar Excel»: lo que se descarga es lo que la pantalla muestra. */
export function buildInspectionFollowupExportQuery(filter: InspectionFollowupFilter): string {
  const params = new URLSearchParams()
  if (filter.status) params.set("estado", filter.status)
  if (filter.kind) params.set("tipo", filter.kind)
  if (filter.worksiteId) params.set("faena", filter.worksiteId)
  if (filter.search) params.set("q", filter.search)
  const query = params.toString()
  return query ? `?${query}` : ""
}

/** ¿Hay algún filtro puesto? Distingue «aún no hay hallazgos» de «no hay con estos filtros». */
export function followupFilterIsActive(filter: InspectionFollowupFilter): boolean {
  return Boolean(filter.status || filter.kind || filter.worksiteId || filter.search)
}
