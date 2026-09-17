export interface PdtpListQuery {
  hoja?: string
  faena?: string
  vista?: string
  anio?: string
}

export interface PdtpActivitiesQuery extends PdtpListQuery {
  programa: string
  estado?: string
  mes?: number
  semana?: number
  /** Id de `pdtp_objectives`. Sin objetivos en el programa, este filtro no aplica. */
  objetivo?: string
  /** `"yo"`: sólo las actividades asignadas nominalmente a quien mira. */
  asignado?: string
}

export function resolvePdtpYear(value: string | undefined, currentYear = new Date().getFullYear()): number {
  const year = Number(value)
  return Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : currentYear
}

export function buildPdtpProgramHref(programId: string, query: PdtpListQuery): string {
  const params = new URLSearchParams()
  if (query.hoja) params.set("hoja", query.hoja)
  if (query.faena) params.set("faena", query.faena)
  if (query.vista) params.set("vista", query.vista)
  const search = params.toString()
  return `/prevencion/pdtp/${programId}${search ? `?${search}` : ""}`
}

/** Conserva el contexto de trabajo cuando una corrección abre el editor PDTP. */
export function buildPdtpActivitiesHref(query: PdtpActivitiesQuery): string {
  const params = new URLSearchParams({ programa: query.programa })
  if (query.hoja) params.set("hoja", query.hoja)
  if (query.faena) params.set("faena", query.faena)
  if (query.vista) params.set("vista", query.vista)
  if (query.anio) params.set("anio", query.anio)
  if (query.estado && query.estado !== "all") params.set("estado", query.estado)
  if (query.mes) params.set("mes", String(query.mes))
  if (query.semana) params.set("semana", String(query.semana))
  if (query.objetivo) params.set("objetivo", query.objetivo)
  if (query.asignado) params.set("asignado", query.asignado)
  return `/prevencion/pdtp/actividades?${params}`
}

/** Evita redirecciones abiertas al volver desde el editor al visor transversal. */
export function resolvePdtpActivitiesReturnHref(value: string | undefined): string | undefined {
  if (!value) return undefined
  const url = new URL(value, "https://chome.local")
  return url.origin === "https://chome.local" && url.pathname === "/prevencion/pdtp/actividades"
    ? `${url.pathname}${url.search}`
    : undefined
}

export function resolveSelectedWorksiteId(
  requestedWorksiteId: string | undefined,
  worksites: Array<{ id: string }>,
): string | undefined {
  if (requestedWorksiteId && worksites.some((worksite) => worksite.id === requestedWorksiteId)) {
    return requestedWorksiteId
  }
  return worksites.length === 1 ? worksites.at(0)?.id : undefined
}
