import type { StageTab } from "@/components/ui/stage-tabs"
import type {
  PartsNoteLineStage, PartsNoteStatus, PartsNoteTab, RecordPartStockStatus,
} from "@/lib/services/mantencion/parts/types"
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
 * La URL de la bandeja (`?estado=&faena=&q=&pagina=`) como filtros. Sin `estado` rige «Pendientes»
 * (`explicitTab: false`: la página redirige a `?estado=pendientes` para que la pestaña quede marcada).
 * Un valor de pestaña que el usuario no puede ver («Por conciliar» sin `manage`) se trata como ausente.
 */
export function parsePartsNotesQuery(raw: RawSearchParams, canManage: boolean): { tab: InboxTab; explicitTab: boolean; worksiteId?: string; q?: string; page: number } {
  const estado = first(raw, "estado")
  const page = Number.parseInt(first(raw, "pagina") ?? "1", 10)
  const worksiteId = first(raw, "faena")
  const q = first(raw, "q")
  return {
    tab: isInboxTab(estado, canManage) ? estado : "pendientes",
    explicitTab: isInboxTab(estado, canManage),
    ...(worksiteId ? { worksiteId } : {}),
    ...(q ? { q } : {}),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
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
  en_gestion: "En gestión",
  cerrada: "Cerrada",
  anulada: "Anulada",
}

/** «2 de 3»: las líneas que faltan resolver sobre el total de la nota. */
export function pendingLinesText(pending: number, total: number): string {
  return `${pending} de ${total}`
}

/** Una nota sigue pendiente mientras esté abierta y le falten líneas por resolver. */
export function isNotePending(row: { status: PartsNoteStatus; pendingLines: number }): boolean {
  return (row.status === "enviada" || row.status === "en_gestion") && row.pendingLines > 0
}

/** «Hoy», «Ayer», «Hace 5 días»: desde cuándo espera la nota. */
export function ageText(createdAt: string, now: Date = new Date()): string {
  const text = formatDateRelative(createdAt, now)
  return text === "—" ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

// ── Etapa de una línea ───────────────────────────────────────────────────────

export const STAGE_TEXT: Record<PartsNoteLineStage, string> = {
  pedido: "Pedido",
  en_compra: "En compra",
  en_bodega: "En bodega",
  rechazado: "Rechazada",
}

/** Insignia de la etapa: el naranja signal es de lo pendiente («Pedido»); lo ya resuelto va en otro tono. */
export const STAGE_META: Record<PartsNoteLineStage, { label: string; variant: "signal" | "info" | "success" | "danger" }> = {
  pedido: { label: STAGE_TEXT.pedido, variant: "signal" },
  en_compra: { label: STAGE_TEXT.en_compra, variant: "info" },
  en_bodega: { label: STAGE_TEXT.en_bodega, variant: "success" },
  rechazado: { label: STAGE_TEXT.rechazado, variant: "danger" },
}

export type ProgressStep = { key: "pedido" | "en_compra" | "llego" | "usado"; label: string; state: "done" | "current" | "todo" }

/**
 * La cadena «Pedido → En compra → Llegó 2/2 → Usado 1/2» de una línea. Una línea rechazada no avanza
 * (`null`: se dice «Rechazada» con su motivo). Los números sólo aparecen donde ya hay algo que contar;
 * el paso actual se marca con `aria-current` y peso, no sólo con color.
 */
export function lineProgress(line: { stage: PartsNoteLineStage; quantity: number; arrived: number; used: number }): ProgressStep[] | null {
  if (line.stage === "rechazado") return null
  const arrived = line.stage === "en_bodega" ? line.arrived : 0
  const used = line.stage === "en_bodega" ? line.used : 0
  const reached = line.stage === "pedido" ? 0 : line.stage === "en_compra" ? 1 : used > 0 ? 3 : 2
  const complete = arrived > 0 && used >= arrived
  const labels: Array<[ProgressStep["key"], string]> = [
    ["pedido", "Pedido"],
    ["en_compra", "En compra"],
    ["llego", arrived > 0 ? `Llegó ${formatQty(arrived)}/${formatQty(line.quantity)}` : "Llegó"],
    ["usado", arrived > 0 && used > 0 ? `Usado ${formatQty(used)}/${formatQty(arrived)}` : "Usado"],
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
