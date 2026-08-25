import type { InspectionListFilters } from "@/lib/services/prevention-inspections"

const KINDS = new Set(["inspection", "observation", "audit"])
const STATUSES = new Set(["planned", "in_progress", "completed", "reviewed", "cancelled"])
const VIEWS = new Set(["pending_review", "open_findings", "critical"])

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams

function single(params: SearchParams, key: string) {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

function clean(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function parseInspectionListQuery(params: SearchParams): {
  page: number
  filter: InspectionListFilters
} {
  const rawPage = Number(single(params, "pagina") ?? 1)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const kind = clean(single(params, "tipo"))
  const status = clean(single(params, "estado"))
  const view = clean(single(params, "vista"))
  const worksiteId = clean(single(params, "faena"))
  const search = clean(single(params, "q"))

  const filter: InspectionListFilters = {}
  if (kind && KINDS.has(kind)) filter.kinds = [kind]
  if (status && STATUSES.has(status)) filter.status = status
  if (worksiteId) filter.worksiteId = worksiteId
  if (search) filter.search = search
  if (view && VIEWS.has(view)) filter.view = view as InspectionListFilters["view"]

  return { page, filter }
}

export function buildInspectionExportQuery(filter: InspectionListFilters) {
  const params = new URLSearchParams()
  const kind = filter.kinds?.[0]
  if (kind) params.set("tipo", kind)
  if (filter.status) params.set("estado", filter.status)
  if (filter.worksiteId) params.set("faena", filter.worksiteId)
  if (filter.search) params.set("q", filter.search)
  if (filter.view) params.set("vista", filter.view)
  const query = params.toString()
  return query ? `?${query}` : ""
}

const TASK_STATUS_LABELS: Record<string, string> = {
  planned: "Pendiente de ejecución",
  in_progress: "En ejecución",
  completed: "Pendiente de revisión",
  reviewed: "Revisada y cerrada",
  cancelled: "Cancelada",
}

export function inspectionTaskStatusLabel(status: string) {
  return TASK_STATUS_LABELS[status] ?? status
}

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  equipment: "Equipo",
  equipo: "Equipo",
  vehicle: "Vehículo",
  vehiculo: "Vehículo",
  camion: "Camión",
}

/** Traduce sólo valores técnicos conocidos; los tipos libres siguen intactos. */
export function inspectionSubjectTypeLabel(subjectType: string) {
  const normalized = subjectType.trim().toLocaleLowerCase("es-CL")
  return SUBJECT_TYPE_LABELS[normalized] ?? subjectType
}

export function safeNewInspectionDefaults() {
  return { templateId: "", worksiteId: "", subjectRef: "_none" } as const
}
