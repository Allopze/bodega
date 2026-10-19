import { inspectionProgramIsOverdue } from "@/lib/prevention/inspections"
import { inspectionSubjectTypeLabel } from "@/lib/prevention/inspection-list-query"

/*
 * Reglas de la interfaz del catálogo de plantillas y de la programación de
 * inspecciones, sin React ni base de datos: así se prueban en el entorno de
 * Node y las pantallas sólo las aplican.
 *
 * Todo lo de acá decide qué se le ofrece a la persona. Que el servidor valide
 * lo mismo no es motivo para ofrecerle un botón que va a rechazar (patrón I-04):
 * un botón que falla es peor que un texto que dice por qué todavía no.
 */

/** «1 inspección» / «3 inspecciones». */
export function pluralize(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/* ── Acreditación PDTP ───────────────────────────────────────────────────── */

export type PdtpAxes = { execute: string[]; review: string[] }

/** Mismo conjunto de ids, sin importar el orden ni los repetidos. */
export function sameIdSet(a: readonly string[], b: readonly string[]) {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size) return false
  for (const id of left) if (!right.has(id)) return false
  return true
}

/**
 * Qué ejes de la acreditación cambiaron respecto de lo que el diálogo mostró al
 * abrir. «Ejecución» y «revisión» son dos ejes independientes: tocar uno no debe
 * reescribir el otro.
 */
export function changedPdtpAxes(current: PdtpAxes, preload: PdtpAxes) {
  const execute = !sameIdSet(current.execute, preload.execute)
  const review = !sameIdSet(current.review, preload.review)
  return { execute, review, any: execute || review }
}

/**
 * El cuerpo que se manda al servidor: **sólo** los ejes que cambiaron. Un eje
 * omitido se conserva tal cual —sea de catálogo o de números históricos—, y un
 * arreglo vacío lo apaga. Mandar siempre los dos era lo que vaciaba en silencio
 * un eje que la persona no había tocado (P2-13).
 */
export function pdtpSavePayload(current: PdtpAxes, preload: PdtpAxes) {
  const changed = changedPdtpAxes(current, preload)
  return {
    ...(changed.execute ? { catalogActivityIds: current.execute } : {}),
    ...(changed.review ? { reviewCatalogActivityIds: current.review } : {}),
  }
}

/** «N° 29 no tiene actividad en el catálogo corporativo…», una línea por número. */
export function unmappedPdtpWarning(n: number) {
  return `N° ${n} no tiene actividad en el catálogo corporativo: si guardas este eje sin elegir una, dejará de acreditar.`
}

/** El aviso informativo de un eje que hoy acredita por número y no por identidad. */
export function numbersAccreditationNotice(labels: readonly string[]) {
  return `Hoy acredita por número de actividad (${labels.join(", ")}). Al guardar quedará vinculada a su actividad del catálogo.`
}

/* ── Incorporar una plantilla ────────────────────────────────────────────── */

export type OfficialSourceCandidate = { id: string; checksumSha256: string }

/**
 * La regla de la fuente documental al incorporar un anexo oficial.
 *
 * Un instrumento que transcribe un anexo oficial **no se puede aprobar** sin la
 * planilla vinculada, así que el campo es obligatorio. Pero sólo cuando hay con
 * qué cumplirlo: si la Biblioteca SST no tiene el archivo con el checksum del
 * anexo, exigirlo dejaría la incorporación imposible, y el aviso ya ofrece la
 * salida (subir el documento y vincularlo después). Cuando el checksum es
 * conocido sólo se ofrecen los archivos que coinciden —el servidor rechaza los
 * demás— y el que coincide viene preseleccionado.
 */
export function officialSourceGate<T extends OfficialSourceCandidate>(input: {
  needsOfficialSource: boolean
  officialChecksumSha256: string | null
  sources: readonly T[]
  /** Fuente elegida; vacío si no hay. */
  selectedId: string
}) {
  const { needsOfficialSource, officialChecksumSha256, sources, selectedId } = input
  if (!needsOfficialSource) {
    return { required: false, candidates: [...sources], preselectedId: "", noMatch: false, blocked: false }
  }
  const candidates = officialChecksumSha256
    ? sources.filter((source) => source.checksumSha256 === officialChecksumSha256)
    : [...sources]
  const preselectedId = officialChecksumSha256 ? candidates[0]?.id ?? "" : ""
  // Con checksum conocido y sin ninguna coincidencia: aviso en vez de bloqueo.
  const noMatch = officialChecksumSha256 !== null && candidates.length === 0
  const blocked = selectedId === "" && !noMatch && candidates.length > 0
  return { required: true, candidates, preselectedId, noMatch, blocked }
}

/* ── Qué se ofrece sobre una plantilla ───────────────────────────────────── */

export type TemplateActionInput = {
  status: string
  provenanceKind: string
  authorUserId: string
  sourceDocumentVersionId: string | null
  parityReport: { status: string; differences: string[] } | null
  recordsDeviations: boolean
}

export type TemplateActionContext = {
  canManage: boolean
  canApprove: boolean
  currentUserId: string | null
}

export const TEMPLATE_NOTICE = {
  missingSource: "Falta vincular la planilla oficial.",
  parityByOther: "La paridad la declara otra persona con permiso de aprobación.",
  approveAfterParity: "Se aprueba después de declarar la paridad sin diferencias.",
} as const

/**
 * Las acciones que la fila de una plantilla ofrece, y el texto que ocupa el
 * lugar de las que el servidor rechazaría hoy.
 *
 * Los permisos son los de las acciones (`manage` y `approve`); el resto replica
 * lo que exigen `approveInspectionTemplate`, `setInspectionTemplateParity` y
 * `linkInspectionTemplateSource`. Es presentación, no autorización: el servidor
 * vuelve a comprobar todo.
 */
export function templateActionState(item: TemplateActionInput, ctx: TemplateActionContext) {
  const retired = item.status === "superseded"
  const draft = item.status === "draft"
  const official = item.provenanceKind === "official_document"
  const hasSource = Boolean(item.sourceDocumentVersionId)
  const paritySettled = item.parityReport?.status === "passed" && (item.parityReport.differences?.length ?? 0) === 0
  // Un anexo oficial se aprueba con fuente vinculada y paridad sin diferencias.
  const readyToApprove = draft && (!official || (hasSource && paritySettled))
  // La paridad la declara alguien distinto de quien incorporó la plantilla.
  const isAuthor = ctx.currentUserId !== null && item.authorUserId === ctx.currentUserId

  let notice: string | null = null
  if (draft && official && (ctx.canManage || ctx.canApprove)) {
    if (!hasSource) notice = TEMPLATE_NOTICE.missingSource
    else if (!paritySettled) {
      notice = ctx.canApprove && !isAuthor ? TEMPLATE_NOTICE.approveAfterParity : TEMPLATE_NOTICE.parityByOther
    }
  }

  // Elegir el archivo es administrar el instrumento (`manage`), y sólo en un borrador.
  const linkSource: "Vincular fuente" | "Cambiar fuente" | null =
    ctx.canManage && draft && official ? (hasSource ? "Cambiar fuente" : "Vincular fuente") : null

  return {
    pdtp: ctx.canManage && !retired,
    // El catálogo de desviaciones sólo existe en los instrumentos que las registran.
    deviations: ctx.canManage && !retired && item.recordsDeviations,
    linkSource,
    declareParity: ctx.canApprove && draft && official && hasSource && !isAuthor,
    approve: ctx.canApprove && readyToApprove,
    requestApproval: ctx.canManage && !ctx.canApprove && readyToApprove,
    retire: ctx.canApprove && !retired,
    notice,
  }
}

/* ── Retirar y revertir ──────────────────────────────────────────────────── */

type Data = Record<string, unknown> | undefined

const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/**
 * Qué le pasó a la plantilla al retirarla, dicho como lo vive quien la retiró:
 * si desapareció, qué se conservó, y qué programaciones dejaron de generar
 * inspecciones (nada más se lo avisa).
 */
export function retireTemplateMessage(data: Data) {
  if (data?.outcome === "deleted") return "Plantilla eliminada: no tenía inspecciones ni programaciones."
  const runs = numberOf(data?.runs)
  const activePrograms = numberOf(data?.activePrograms)
  const kept = runs > 0
    ? `Plantilla retirada. Se conservan ${pluralize(runs, "inspección", "inspecciones")}.`
    : "Plantilla retirada."
  if (activePrograms === 0) return kept
  const consequence = activePrograms === 1
    ? "1 programación activa ya no generará inspecciones: revísala en Programación."
    : `${activePrograms} programaciones activas ya no generarán inspecciones: revísalas en Programación.`
  return `${kept} ${consequence}`
}

/** Qué se movió al volver a una versión anterior. */
export function rollbackTemplateMessage(versionLabel: string, data: Data) {
  const programs = numberOf(data?.programs)
  const plannedRuns = numberOf(data?.plannedRuns)
  const moved = [
    programs > 0 ? pluralize(programs, "programación", "programaciones") : null,
    plannedRuns > 0 ? pluralize(plannedRuns, "inspección planificada", "inspecciones planificadas") : null,
  ].filter(Boolean)
  const base = `Se volvió a la versión ${versionLabel}.`
  return moved.length > 0 ? `${base} Pasaron a ella ${moved.join(" y ")}.` : base
}

/* ── Programación ────────────────────────────────────────────────────────── */

export type ProgramFilterInput = {
  templateName: string
  worksiteId: string
  worksiteName: string
  subjectLabel: string | null
  subjectType: string | null
  riskLabel: string | null
  assigneeName: string | null
  isActive: boolean
  templateApproved: boolean
  nextDueOn: string
}

/**
 * Qué se inspecciona en una programación: el sujeto del inventario que se eligió,
 * o el tipo escrito a mano, o nada. «No especificado» afirmaba que no se había
 * declarado un sujeto cuando sí se había elegido uno.
 */
export function programSubjectLabel(program: Pick<ProgramFilterInput, "subjectLabel" | "subjectType">) {
  return program.subjectLabel
    ?? (program.subjectType ? inspectionSubjectTypeLabel(program.subjectType) : null)
    ?? "Sin sujeto definido"
}

/**
 * Lee los filtros de la URL de Programación. «Vencidas» es una vista y no un
 * estado: `estado=overdue` es el enlace de antes de que se unificaran y se lee
 * como `vista=vencidas`.
 */
export function normalizeProgramFilters(params: { estado?: string | null; vista?: string | null }) {
  const estado = params.estado ?? ""
  const status: "all" | "active" | "paused" = estado === "active" || estado === "paused" ? estado : "all"
  return { status, overdueView: params.vista === "vencidas" || estado === "overdue" }
}

export function filterPrograms<T extends ProgramFilterInput>(programs: readonly T[], filters: {
  query: string
  status: "all" | "active" | "paused"
  worksite: string
  overdueView: boolean
  today: string
}): T[] {
  const needle = filters.query.trim().toLocaleLowerCase("es-CL")
  return programs.filter((item) => {
    const searchable = [
      item.templateName, item.worksiteName, programSubjectLabel(item), item.riskLabel ?? "", item.assigneeName ?? "",
    ].join(" ").toLocaleLowerCase("es-CL")
    const overdue = inspectionProgramIsOverdue(item, filters.today)
    return (!needle || searchable.includes(needle))
      && (filters.worksite === "all" || item.worksiteId === filters.worksite)
      && (filters.status === "all" || (filters.status === "active" ? item.isActive : !item.isActive))
      && (!filters.overdueView || overdue)
  })
}
