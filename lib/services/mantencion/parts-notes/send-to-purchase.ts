import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"
import { quotationRequirementMessage, type QuotationRequirementReason } from "@/lib/requests/quotation-requirement"
import { deleteRequest } from "@/lib/services/requests-delete"
import { approveRepuestoWithoutQuotation, persistRepuestoDraft, submitRepuestoRequest } from "@/lib/services/repuestos"
import { listSpareParts } from "@/lib/services/spare-parts-catalog"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { viewerFromSession } from "../access"
import { NP_PERMISSIONS } from "./access"
import { assertCanManage, loadNoteContext, NoteRefusal, NOT_FOUND_NOTE } from "./context"
import { loadPartsNotePrefill } from "./prefill"
import { whyNoteLinesAreLocked } from "./status"

/**
 * «Aceptar la nota = aprobar su compra» (ADR 0001, D30 a D32): envía a compra las líneas pendientes de UNA nota. Arma
 * una sola solicitud de repuestos con esas líneas (`partsNoteItemId`), la envía y, si la regla de cotización lo permite,
 * la aprueba en el acto a nombre de quien decide (decisión `approve` con `roleContext: 'mantencion_np'`). Así cae sola en
 * la cola «Pendientes de orden de compra» de /compras (`pendingPurchaseWhere`) y Compras genera la OC desde ahí.
 *
 * Reutiliza el camino de siempre —`loadPartsNotePrefill` (qué líneas se pueden comprar y con qué equipo/OT),
 * `persistRepuestoDraft`, `submitRepuestoRequest`, `approveRepuestoWithoutQuotation`—: ninguna regla se repite aquí.
 *
 * Quién: `mant:np:manage` y la faena de la nota en el alcance (D32). `mant:np:purchase` sigue con «Comprar» a mano (`?np=`).
 *
 * La regla de cotización (umbral) NO se salta: si la solicitud la exige, no es un error. La solicitud queda en BORRADOR con
 * las líneas «en compra» y el resultado trae `needsQuotation` y el aviso (D31). Cualquier otro rechazo del envío borra el
 * borrador (las líneas vuelven a pendiente) y se propaga con su mensaje. Si lo que falla es la aprobación, la solicitud ya
 * está enviada: queda esperando en Aprobaciones y el resultado lo dice, sin deshacer nada.
 */

export interface SendToPurchaseResult {
  requestId: string
  requestCode: string
  /** La solicitud quedó aprobada: ya espera su OC en Compras. */
  approved: boolean
  lineCount: number
  /** Quedó en borrador porque la regla de cotización pide cotizaciones o un precio estimado. */
  needsQuotation: boolean
  message: string
}

/** La nota no tiene líneas por enviar: quien acepta una nota sin líneas pendientes no tiene nada que comprar, y eso no es un fallo. */
export class NoLinesToSendError extends NoteRefusal {
  constructor(code: string) {
    super(`La nota ${code} no tiene líneas pendientes por enviar a compra.`)
    this.name = "NoLinesToSendError"
  }
}

/** Quien decide deja este contexto en la decisión de aprobación (columna de texto libre, sin CHECK). */
export const NOTE_APPROVAL_ROLE_CONTEXT = "mantencion_np"

const QUOTATION_REASONS = Object.keys({
  no_quotation_or_estimate: true,
  needs_quotation: true,
  needs_three: true,
  needs_justification: true,
} satisfies Record<QuotationRequirementReason, true>) as QuotationRequirementReason[]

/** El rechazo de `submitRepuestoRequest` por la regla de cotización (un `Error` con su texto), o `null` si fue otra cosa. */
async function quotationReasonOf(error: unknown): Promise<QuotationRequirementReason | null> {
  if (!(error instanceof Error)) return null
  const { repuestosQuotationThresholdClp } = await getOperationalSettings()
  return QUOTATION_REASONS.find((reason) => quotationRequirementMessage(reason, repuestosQuotationThresholdClp) === error.message) ?? null
}

const lineWord = (count: number) => (count === 1 ? "1 línea" : `${count} líneas`)

/** Aviso de D31. Sin ningún precio conocido no hay umbral que mirar: el aviso lo dice en vez de hablar de un monto que no existe. */
function needsQuotationMessage(reason: QuotationRequirementReason, code: string): string {
  return reason === "no_quotation_or_estimate"
    ? `No se conoce el monto de lo pedido: adjunta las cotizaciones o indica el precio estimado en la solicitud ${code}.`
    : `Supera el umbral de cotización: adjunta las cotizaciones en la solicitud ${code}.`
}

/** Precio estimado de cada repuesto de catálogo, el mismo que precarga el formulario de solicitudes: el último de compra, o el de referencia. */
async function catalogPrices(productIds: ReadonlyArray<string | null>): Promise<Map<string, number>> {
  const ids = [...new Set(productIds.filter((id): id is string => !!id))]
  const prices = new Map<string, number>()
  if (ids.length === 0) return prices
  for (const part of await listSpareParts({ ids, includeInactive: true })) {
    const price = part.lastPrice != null && part.lastPrice > 0 ? part.lastPrice : part.referencePrice
    if (price != null && price > 0) prices.set(part.id, Math.round(price))
  }
  return prices
}

/** El formulario de solicitudes no propone fecha: lo crítico se necesita hoy y lo demás, en tres días (nunca en el pasado, hora de Chile). */
function defaultRequiredDate(urgency: "high" | "critical"): string {
  const today = todayInChile()
  return urgency === "critical" ? today : addDaysToPlainDate(today, 3)
}

async function requestCodeOf(requestId: string): Promise<string> {
  const [row] = await db.select({ code: purchaseRequests.code }).from(purchaseRequests).where(eq(purchaseRequests.id, requestId))
  return row?.code ?? requestId
}

/** El borrador que no pudo enviarse no puede dejar sus líneas «en compra» apuntando a nada: se borra y vuelven a pendiente. */
async function discardDraft(requestId: string, session: Session): Promise<void> {
  try {
    await deleteRequest(requestId, session.user.id, { userEmail: session.user.email ?? undefined })
  } catch (error) {
    logger.error("[sendPartsNoteLinesToPurchase] no se pudo borrar el borrador", error)
  }
}

export async function sendPartsNoteLinesToPurchase(
  session: Session,
  input: { noteId: string; lineIds?: string[] },
): Promise<SendToPurchaseResult> {
  const viewer = viewerFromSession(session)
  if (!viewer.permissions.includes(NP_PERMISSIONS.manage)) throw new NoteRefusal("No tienes permiso para enviar notas de pedido a compra.")
  const note = await loadNoteContext(db, input.noteId)
  if (!note) throw new NoteRefusal(NOT_FOUND_NOTE)
  assertCanManage(viewer, note)
  if (note.status === "en_espera") throw new NoteRefusal("La nota está en espera: acéptala primero.")
  const locked = whyNoteLinesAreLocked(note.status, note.code)
  if (locked) throw new NoteRefusal(locked)

  // Las líneas que se pueden comprar hoy (pendientes, o «en compra» cuyas compras murieron), con su equipo y su OT.
  const prefill = await loadPartsNotePrefill(viewer, input.noteId)
  if (!prefill) throw new NoLinesToSendError(note.code)
  const wanted = input.lineIds ? new Set(input.lineIds) : null
  if (wanted && wanted.size === 0) throw new NoteRefusal("Elige al menos una línea para enviar a compra.")
  const lines = wanted ? prefill.items.filter((line) => wanted.has(line.partsNoteItemId)) : prefill.items
  if (wanted && lines.length < wanted.size) {
    const missing = wanted.size - lines.length
    throw new NoteRefusal(`${missing === 1 ? "Una de las líneas ya no está pendiente" : `${missing} de las líneas ya no están pendientes`} en la nota ${note.code}: actualiza la pantalla.`)
  }

  const prices = await catalogPrices(lines.map((line) => line.productId))
  const actor = session.user.name ?? session.user.email ?? "jefatura"
  const justification = `Nota de pedido ${note.code} aceptada por ${actor}`
  // Con OT, la solicitud nace en la faena donde está el equipo hoy; sin OT, en la faena de la nota y cada línea lleva su cargo.
  const withOrder = !!prefill.workOrderId
  const requestId = await persistRepuestoDraft(session, {
    worksiteId: withOrder ? prefill.worksiteId : note.worksiteId,
    urgency: prefill.urgency,
    requiredDate: defaultRequiredDate(prefill.urgency),
    justification,
    items: lines.map((line, index) => ({
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure,
      sortOrder: index,
      notes: line.partNumber ? `N° de parte: ${line.partNumber}` : null,
      vehicleId: withOrder ? prefill.vehicleId : line.chargeVehicleId,
      workOrderId: prefill.workOrderId,
      partsNoteItemId: line.partsNoteItemId,
      estimatedUnitPrice: (line.productId ? prices.get(line.productId) : undefined) ?? null,
    })),
  })

  const done = { requestId, lineCount: lines.length }
  try {
    await submitRepuestoRequest({ requestId, userId: session.user.id, userEmail: session.user.email ?? undefined })
  } catch (error) {
    const reason = await quotationReasonOf(error)
    if (!reason) {
      await discardDraft(requestId, session)
      throw error
    }
    const requestCode = await requestCodeOf(requestId)
    return { ...done, requestCode, approved: false, needsQuotation: true, message: needsQuotationMessage(reason, requestCode) }
  }

  const requestCode = await requestCodeOf(requestId)
  try {
    await approveRepuestoWithoutQuotation({
      requestId,
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      roleContext: NOTE_APPROVAL_ROLE_CONTEXT,
      justification,
      worksiteIds: viewer.isGlobal ? "all" : [...viewer.worksiteIds],
    })
  } catch (error) {
    logger.error("[sendPartsNoteLinesToPurchase] la solicitud quedó enviada sin aprobar", error)
    const why = safeActionMessage(error, "no se pudo aprobar")
    return { ...done, requestCode, approved: false, needsQuotation: false, message: `La solicitud ${requestCode} quedó enviada a aprobación: ${why}.` }
  }
  return { ...done, requestCode, approved: true, needsQuotation: false, message: `${lineWord(lines.length)} a Compras (${requestCode}).` }
}
