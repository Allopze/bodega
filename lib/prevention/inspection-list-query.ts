import type { InspectionListFilters } from "@/lib/services/prevention-inspections"

const KINDS = new Set(["inspection", "observation", "audit"])
const STATUSES = new Set(["planned", "in_progress", "completed", "reviewed", "cancelled"])
const VIEWS = new Set(["pending_review", "open_findings", "critical", "overdue"])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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
  const assignedToUserId = clean(single(params, "responsable"))
  const executedFrom = clean(single(params, "desde"))
  const executedTo = clean(single(params, "hasta"))

  const filter: InspectionListFilters = {}
  if (kind && KINDS.has(kind)) filter.kinds = [kind]
  if (status && STATUSES.has(status)) filter.status = status
  if (worksiteId) filter.worksiteId = worksiteId
  if (search) filter.search = search
  if (view && VIEWS.has(view)) filter.view = view as InspectionListFilters["view"]
  if (assignedToUserId) filter.assignedToUserId = assignedToUserId
  // Sin validar, un `?desde=ayer` devolvía cero filas sin decir por qué.
  if (executedFrom && ISO_DATE.test(executedFrom)) filter.executedFrom = executedFrom
  if (executedTo && ISO_DATE.test(executedTo)) filter.executedTo = executedTo

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
  if (filter.assignedToUserId) params.set("responsable", filter.assignedToUserId)
  if (filter.executedFrom) params.set("desde", filter.executedFrom)
  if (filter.executedTo) params.set("hasta", filter.executedTo)
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
  contenedor: "Contenedor",
}

/** Traduce sólo valores técnicos conocidos; los tipos libres siguen intactos. */
export function inspectionSubjectTypeLabel(subjectType: string) {
  const normalized = subjectType.trim().toLocaleLowerCase("es-CL")
  return SUBJECT_TYPE_LABELS[normalized] ?? subjectType
}

export function safeNewInspectionDefaults() {
  return { templateId: "", worksiteId: "", subjectRef: "_none" } as const
}

/* ── Sujeto inspeccionado ─────────────────────────────────────────────────
 * Vivía en `inspection-run-list.tsx`, así que sólo lo tenía el alta ad-hoc.
 * La programación no podía declarar sujeto (INS-04) pese a que el esquema, el
 * servicio y el materializador lo soportan, y toda inspección nacida del cron
 * llegaba sin saber qué se inspecciona. Compartirlo evita que las dos
 * pantallas inventen dos formas de codificar lo mismo.
 */

/**
 * Sujeto inspeccionable: recurso del inventario de emergencias, equipo de flota
 * o contenedor del catálogo. `source` discrimina a cuál de las tres FK va el
 * id — el CHECK `prevention_inspection_run_single_subject` no admite dos.
 */
export type InspectionSubjectOption = {
  source: "resource" | "vehicle" | "container"
  id: string
  name: string
  kind: string
  location: string
  serialNumber: string | null
}

/** Valor del selector: `source:id`, porque un id suelto no dice a qué tabla apunta. */
export function subjectRefOf(subject: Pick<InspectionSubjectOption, "source" | "id">) {
  return `${subject.source}:${subject.id}`
}

/** Centinela del selector cuando no se eligió sujeto del inventario. */
export const NO_SUBJECT = "_none"

/** Descompone `source:id` en el par de FK que espera el servicio. */
export function subjectIdsFromRef(ref: string): {
  subjectResourceId: string | null
  subjectVehicleId: string | null
  subjectContainerId: string | null
} {
  return {
    subjectResourceId: ref.startsWith("resource:") ? ref.slice("resource:".length) : null,
    subjectVehicleId: ref.startsWith("vehicle:") ? ref.slice("vehicle:".length) : null,
    subjectContainerId: ref.startsWith("container:") ? ref.slice("container:".length) : null,
  }
}

/** Vuelve del par de FK persistido al valor del selector. */
export function subjectRefFromIds(subject: {
  subjectResourceId?: string | null
  subjectVehicleId?: string | null
  subjectContainerId?: string | null
}): string {
  if (subject.subjectResourceId) return `resource:${subject.subjectResourceId}`
  if (subject.subjectVehicleId) return `vehicle:${subject.subjectVehicleId}`
  if (subject.subjectContainerId) return `container:${subject.subjectContainerId}`
  return NO_SUBJECT
}

/**
 * Código de definición de la plantilla que exige sujeto del catálogo.
 *
 * El servicio rechaza el alta sin contenedor (`assertContainerSubject`); acá
 * sirve para no ofrecer siquiera el texto libre en el selector, que era la vía
 * por la que entraban las etiquetas escritas a mano.
 */
export const CONTAINER_DEFINITION_CODE = "inspeccion_contenedores"

export function templateRequiresContainer(sourceDefinitionCode: string | null | undefined) {
  return sourceDefinitionCode === CONTAINER_DEFINITION_CODE
}
