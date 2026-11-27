import type { StageTab } from "@/components/ui/stage-tabs"
import type {
  PartsNoteFilterSet, PartsNoteLineStage, PartsNoteStatus, PartsNoteTab, RecordPartStockStatus,
} from "@/lib/services/mantencion/parts/types"
import { isPartsNoteOpen, PARTS_NOTE_STATUSES } from "@/lib/mantencion/contracts"
import type { NoteActionKey } from "@/lib/services/mantencion/parts-notes/transitions"
import { isCivilDate } from "@/lib/validation/dates"
import type { Permission } from "@/modules/permissions"
import { formatDateRelative, formatQty } from "@/lib/utils"

// Ojo: sólo `import type` de los servicios. Este módulo lo importan componentes de cliente y los
// servicios traen la base de datos; un import de valor la metería en el bundle.

export type RawSearchParams = Record<string, string | string[] | undefined>

/** Largo mínimo del motivo al rechazar una línea, anular una nota, liberar una reserva o conciliar sin movimiento. */
export const NOTE_REASON_MIN = 5
export const NOTE_REASON_MAX = 1000

/** Filas por página de la bandeja: la búsqueda de la barra superior filtra la página cargada, así que es holgada. */
export const PARTS_NOTES_PAGE_SIZE = 50

export type InboxTab = PartsNoteTab | "por_conciliar"

/**
 * «Pendientes» son las notas por resolver: abiertas y con al menos una línea pendiente, aunque tengan otras ya
 * resueltas (también es la cifra «Notas de pedido por resolver» del Panel). «En gestión», las que no tienen nada
 * pendiente pero esperan una compra que aún no llega. «Cerradas», lo cerrado y lo anulado.
 */
export const INBOX_TAB_LABELS: Record<InboxTab, string> = {
  pendientes: "Pendientes",
  en_gestion: "En gestión",
  cerradas: "Cerradas",
  por_conciliar: "Por conciliar",
}

const NOTE_TABS: readonly PartsNoteTab[] = ["pendientes", "en_gestion", "cerradas"]

function first(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key]
  const text = Array.isArray(value) ? value[0] : value
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

/** «Por conciliar» sólo existe para quien administra las notas (`mant:np:manage`). */
export function isInboxTab(value: string | undefined, canManage: boolean): value is InboxTab {
  if (!value) return false
  if (value === "por_conciliar") return canManage
  return (NOTE_TABS as readonly string[]).includes(value)
}

/**
 * Permisos que abren la bandeja y la ficha: ver las de sus faenas, resolverlas, comprarlas (la persona de compras que no
 * resuelve) o ver las que pidió uno mismo. El alcance de cada una lo pone el servidor (`noteVisibility`).
 */
export const PARTS_NOTES_VIEW_PERMISSIONS: Permission[] = ["mant:np:view_worksite", "mant:np:manage", "mant:np:purchase", "mant:np:view_own"]

/**
 * Parámetros de la URL que son filtros (los que limpia «Limpiar filtros»; la pestaña `estado` y la página no). `situacion` es el
 * estado exacto —uno de los nueve— DENTRO de la pestaña; `urgencia`, `urgente` o `normal`; `desde`/`hasta`, el día en que se creó la nota.
 */
export const NOTE_FILTER_PARAMS = ["faena", "q", "situacion", "urgencia", "desde", "hasta", "solicitante", "equipo", "articulo"] as const

/** Qué estados caen en cada pestaña (`TAB_CONDITIONS`): el estado exacto sólo se ofrece entre los de la pestaña activa. */
export const STATUSES_BY_TAB: Record<PartsNoteTab, readonly PartsNoteStatus[]> = {
  pendientes: ["enviada", "aceptada", "en_espera", "en_gestion"],
  en_gestion: ["en_compra", "recibida_parcial"],
  cerradas: ["cerrada", "rechazada", "anulada"],
}

export const URGENCY_OPTIONS = [{ value: "urgente", label: "Urgentes" }, { value: "normal", label: "Normales" }] as const

function isNoteStatus(value: string | undefined): value is PartsNoteStatus {
  return !!value && (PARTS_NOTE_STATUSES as readonly string[]).includes(value)
}

/** Los filtros de la URL (todo menos la pestaña y la página), ya validados: un valor mal formado se ignora en vez de llegar a la consulta. */
export function parsePartsNoteFilters(raw: RawSearchParams): PartsNoteFilterSet {
  const situacion = first(raw, "situacion")
  const urgencia = first(raw, "urgencia")
  const desde = first(raw, "desde")
  const hasta = first(raw, "hasta")
  const worksiteId = first(raw, "faena")
  const q = first(raw, "q")
  const requester = first(raw, "solicitante")
  const equipment = first(raw, "equipo")
  const article = first(raw, "articulo")
  return {
    ...(worksiteId ? { worksiteId } : {}),
    ...(q ? { q } : {}),
    ...(isNoteStatus(situacion) ? { status: situacion } : {}),
    ...(urgencia === "urgente" || urgencia === "normal" ? { urgent: urgencia === "urgente" } : {}),
    ...(isCivilDate(desde) ? { from: desde } : {}),
    ...(isCivilDate(hasta) ? { to: hasta } : {}),
    ...(requester ? { requester } : {}),
    ...(equipment ? { equipment } : {}),
    ...(article ? { article } : {}),
  }
}

/** Cuántos filtros de «Más filtros» hay activos (estado exacto, solicitante, equipo y repuesto): lo que dice el contador del botón. */
export function advancedFilterCount(filters: PartsNoteFilterSet): number {
  return [filters.status, filters.requester, filters.equipment, filters.article].filter(Boolean).length
}

/** Hay algún filtro activo distinto de la pestaña. */
export function hasPartsNoteFilters(filters: PartsNoteFilterSet): boolean {
  return Object.values(filters).some((value) => value !== undefined)
}

/**
 * La URL de la bandeja (`?estado=&faena=&q=&situacion=&urgencia=&desde=&hasta=&solicitante=&equipo=&articulo=&pagina=`) como filtros.
 * Sin `estado` rige «Pendientes» (`explicitTab: false`: la página redirige a `?estado=pendientes` para que la pestaña quede marcada).
 * Un valor de pestaña que el usuario no puede ver («Por conciliar» sin `manage`) se trata como ausente.
 */
export function parsePartsNotesQuery(raw: RawSearchParams, canManage: boolean): { tab: InboxTab; explicitTab: boolean; page: number } & PartsNoteFilterSet {
  const estado = first(raw, "estado")
  const page = Number.parseInt(first(raw, "pagina") ?? "1", 10)
  return {
    tab: isInboxTab(estado, canManage) ? estado : "pendientes",
    explicitTab: isInboxTab(estado, canManage),
    ...parsePartsNoteFilters(raw),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

/**
 * Los parámetros de la URL que lleva la exportación: la pestaña (salvo «Por conciliar», que no es una lista de notas) y los
 * filtros, tal como están en la URL. El servidor los vuelve a leer con `parsePartsNoteFilters`: aquí no se decide nada.
 */
export function exportParamsOf(raw: RawSearchParams, tab: InboxTab): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = tab === "por_conciliar" ? {} : { estado: tab }
  for (const key of NOTE_FILTER_PARAMS) params[key] = first(raw, key)
  return params
}

/** Pestañas en orden de trabajo. `conciliation` es `null` cuando quien mira no puede conciliar: la pestaña no se ofrece. */
export function buildPartsNotesTabs(counts: Record<PartsNoteTab, number>, conciliation: number | null): StageTab[] {
  const tabs: StageTab[] = NOTE_TABS.map((tab) => ({
    value: tab,
    label: INBOX_TAB_LABELS[tab],
    count: counts[tab],
    countTone: tab === "pendientes" ? "signal" : undefined,
  }))
  if (conciliation !== null) tabs.push({ value: "por_conciliar", label: INBOX_TAB_LABELS.por_conciliar, count: conciliation, countTone: "signal" })
  return tabs
}

export const NOTE_STATUS_TEXT: Record<PartsNoteStatus, string> = {
  enviada: "Enviada",
  aceptada: "Aceptada",
  en_espera: "En espera",
  en_gestion: "En gestión",
  en_compra: "En compra",
  recibida_parcial: "Recibida parcial",
  cerrada: "Cerrada",
  rechazada: "Rechazada",
  anulada: "Anulada",
}

/** Tono de la insignia de cada estado: lo que espera una decisión de jefatura va en naranja; lo que espera compras, en azul. */
export const NOTE_STATUS_TONE: Record<PartsNoteStatus, "signal" | "info" | "success" | "danger" | "neutral"> = {
  enviada: "signal",
  aceptada: "info",
  en_espera: "neutral",
  en_gestion: "info",
  en_compra: "info",
  recibida_parcial: "success",
  cerrada: "success",
  rechazada: "danger",
  anulada: "neutral",
}

/** Rótulo de cada acción de cabecera. Es el mismo de `NOTE_ACTIONS` (el servicio); una prueba cuida que no se separen. */
export const NOTE_ACTION_LABELS: Record<NoteActionKey, string> = {
  aceptar: "Aceptar",
  en_espera: "Poner en espera",
  rechazar: "Rechazar nota",
  anular: "Anular nota",
  reabrir: "Reabrir",
}

/** «2 de 3»: las líneas que faltan resolver sobre el total de la nota. */
export function pendingLinesText(pending: number, total: number): string {
  return `${pending} de ${total}`
}

/** Una nota sigue pendiente mientras esté abierta y le falten líneas por resolver. */
export function isNotePending(row: { status: PartsNoteStatus; pendingLines: number }): boolean {
  return isPartsNoteOpen(row.status) && row.pendingLines > 0
}

/** El cargo de una nota sin OT en una celda: los dos primeros (equipo, centro de costo o texto original) y cuántos más hay. */
export function chargesText(charges: readonly string[], shown = 2): string {
  if (charges.length <= shown) return charges.join(", ")
  return `${charges.slice(0, shown).join(", ")} +${charges.length - shown}`
}

/** «Hoy», «Ayer», «Hace 5 días»: desde cuándo espera la nota. */
export function ageText(createdAt: string, now: Date = new Date()): string {
  const text = formatDateRelative(createdAt, now)
  return text === "—" ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

// ── Etapa de una línea ───────────────────────────────────────────────────────

/** La clave `en_bodega` es del contrato con el servicio; el rótulo dice «Reservado», porque lo que llega o sale del stock de la faena para una OT queda reservado para ella. */
export const STAGE_TEXT: Record<PartsNoteLineStage, string> = {
  pedido: "Pedido",
  en_compra: "En compra",
  en_bodega: "Reservado",
  rechazado: "Rechazado",
}

/** Insignia de la etapa: el naranja signal es de lo pendiente («Pedido»); lo ya resuelto va en otro tono. */
export const STAGE_META: Record<PartsNoteLineStage, { label: string; variant: "signal" | "info" | "success" | "danger" }> = {
  pedido: { label: STAGE_TEXT.pedido, variant: "signal" },
  en_compra: { label: STAGE_TEXT.en_compra, variant: "info" },
  en_bodega: { label: STAGE_TEXT.en_bodega, variant: "success" },
  rechazado: { label: STAGE_TEXT.rechazado, variant: "danger" },
}

/** Sin OT lo que llega entra a stock libre de la faena, no queda reservado para ninguna orden: la insignia dice «En la faena». */
export function stageMeta(stage: PartsNoteLineStage, hasWorkOrder: boolean): (typeof STAGE_META)[PartsNoteLineStage] {
  return !hasWorkOrder && stage === "en_bodega" ? { label: "En la faena", variant: "success" } : STAGE_META[stage]
}

export type ProgressStep = { key: "pedido" | "en_compra" | "llego" | "usado"; label: string; state: "done" | "current" | "todo" }

/**
 * La cadena «Pedido → En compra → Llegó 2/2 → Usado 1/2» de una línea. Una línea rechazada no avanza
 * (`null`: se dice «Rechazado» con su motivo). Los números sólo aparecen donde ya hay algo que contar;
 * el paso actual se marca con `aria-current` y peso, no sólo con color.
 */
export function lineProgress(
  line: { stage: PartsNoteLineStage; quantity: number; arrived: number; used: number },
  options: { usage?: boolean } = {},
): ProgressStep[] | null {
  if (line.stage === "rechazado") return null
  const usage = options.usage ?? true
  const arrived = line.stage === "en_bodega" ? line.arrived : 0
  const used = line.stage === "en_bodega" ? line.used : 0
  const reached = line.stage === "pedido" ? 0 : line.stage === "en_compra" ? 1 : usage && used > 0 ? 3 : 2
  // Sin OT no hay consumo de una reserva: la cadena termina en lo que llegó a la faena.
  const complete = arrived > 0 && (usage ? used >= arrived : arrived >= line.quantity)
  const labels: Array<[ProgressStep["key"], string]> = [
    ["pedido", "Pedido"],
    ["en_compra", "En compra"],
    ["llego", arrived > 0 ? `Llegó ${formatQty(arrived)}/${formatQty(line.quantity)}` : "Llegó"],
    ...(usage ? [["usado", arrived > 0 && used > 0 ? `Usado ${formatQty(used)}/${formatQty(arrived)}` : "Usado"] as [ProgressStep["key"], string]] : []),
  ]
  return labels.map(([key, label], index) => ({
    key,
    label,
    state: complete || index < reached ? "done" : index === reached ? "current" : "todo",
  }))
}

// ── Consumos de la OT ────────────────────────────────────────────────────────

export type ConsumptionMeta = { label: string; variant: "success" | "signal" | "neutral" } | null

/** Estado de stock de un repuesto declarado en un registro; `no_aplica` (texto libre) no lleva insignia. */
export function consumptionMeta(status: RecordPartStockStatus): ConsumptionMeta {
  switch (status) {
    case "descontado": return { label: "Descontado", variant: "success" }
    case "pendiente_conciliar": return { label: "Pendiente de conciliar", variant: "signal" }
    case "revertido": return { label: "Revertido", variant: "neutral" }
    case "sin_movimiento": return { label: "Sin movimiento", variant: "neutral" }
    case "no_aplica": return null
  }
}

/** «1,5» o «1.5» → 1,5. Una cantidad ilegible vale 0 (y no pasa la validación). */
export function parseQty(text: string): number {
  const value = Number(text.trim().replace(",", "."))
  return Number.isFinite(value) ? value : 0
}

/** Cantidad para un campo de texto: coma decimal, sin ceros de más. */
export function qtyInputText(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",")
}
