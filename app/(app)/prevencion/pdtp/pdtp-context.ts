export interface PdtpListQuery {
  hoja?: string
  faena?: string
  vista?: string
  anio?: string
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

export function resolveSelectedWorksiteId(
  requestedWorksiteId: string | undefined,
  worksites: Array<{ id: string }>,
): string | undefined {
  if (requestedWorksiteId && worksites.some((worksite) => worksite.id === requestedWorksiteId)) {
    return requestedWorksiteId
  }
  return worksites.length === 1 ? worksites.at(0)?.id : undefined
}
