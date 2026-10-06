/**
 * Builder functions for the work-queue module — progreso de ciclo de una
 * solicitud y de una OC, que alimentan `RequestProgressPanel`.
 *
 * Aquí vivía además `buildWorkTasks`, un segundo constructor de la cola de
 * pendientes que ninguna pantalla consumía: `/pendientes`, el dashboard y los
 * badges leen la proyección SQL de `lib/services/operational-work-queue.ts`.
 * Mantener las dos era una trampa —al agregar la tarea "Adjuntar factura" sólo
 * una de las dos la conocía—, así que se eliminó junto con `getWorkQueueSnapshot`
 * y los tipos de fila que sólo ella usaba.
 */
import {
  type RequestProgressItem,
  type RequestProgress,
} from "./work-queue.types"
import {
  STAGES,
  itemStatusLabel, itemStageLabel, requestNextAction, requestCurrentStage,
} from "./work-queue-labels"
import { formatQty } from "./utils"

export function buildRequestProgress(requestStatus: string, items: RequestProgressItem[]): RequestProgress {
  const itemSummaries = items.map((item) => ({
    id:            item.id,
    productName:   item.productName,
    quantityLabel: formatQuantity(item.quantity, item.unitOfMeasure),
    statusLabel:   itemStatusLabel(item.status),
    stageLabel:    itemStageLabel(item.status),
    attributes:    item.attributes ?? [],
  }))

  const statuses = items.map((item) => item.status)
  const currentStage = requestCurrentStage(requestStatus, statuses)
  const currentIndex = Math.max(0, STAGES.indexOf(currentStage))
  const completedStages = requestStatus === "closed"
    ? STAGES.slice(0, currentIndex + 1)
    : STAGES.slice(0, currentIndex)

  return {
    currentStage,
    completedStages,
    nextAction: requestNextAction(requestStatus, statuses),
    items: itemSummaries,
  }
}

export interface OcProgressItem {
  id:               string
  productName:      string
  quantity:         number
  unitOfMeasure:    string
  quantityReceived: number
  attributes?:      RequestProgressItem["attributes"]
}

/**
 * Progreso de ciclo de una OC, alimentado al mismo RequestProgressPanel que las
 * solicitudes. La OC arranca post-aprobación: Solicitado y Aprobación siempre
 * completas. La etapa Entrega (al trabajador) es de otro módulo, así que la OC
 * tope en Recepción. Devuelve null en OC anulada (sin stepper).
 */
export function buildOcProgress(
  orderStatus: string,
  items: OcProgressItem[],
  audience: OcProgressAudience = "compras",
  options: OcProgressOptions = {},
): RequestProgress | null {
  if (orderStatus === "cancelled") return null

  const currentStage = ocCurrentStage(orderStatus, items)
  const currentIndex = Math.max(0, STAGES.indexOf(currentStage))
  // "received"/"closed" no son "Recepción en curso": ya no queda saldo por
  // recibir, así que la etapa se marca completada (tilde verde) en vez de
  // "actual" (borde azul) — aunque el stepper siga topando ahí, sin avanzar
  // a "Entrega", que pertenece a otro módulo (ver comentario de la función).
  const isReceptionDone = ["received", "closed"].includes(orderStatus)
  const completedIndex = isReceptionDone ? currentIndex + 1 : currentIndex

  return {
    currentStage,
    completedStages: STAGES.slice(0, completedIndex),
    nextAction: ocNextAction(orderStatus, audience, items, options),
    items: items.map((item) => ({
      id:            item.id,
      productName:   item.productName,
      quantityLabel: formatQuantity(item.quantity, item.unitOfMeasure),
      statusLabel:   ocItemStatusLabel(item, orderStatus),
      stageLabel:    currentStage,
      attributes:    item.attributes ?? [],
    })),
  }
}

/**
 * La etapa mira también las cantidades, no sólo el estado. `sent` pasa a
 * Recepción porque la OC ya salió al proveedor y espera la llegada. Si una
 * escritura externa deja cantidades recibidas aunque el estado siga en una
 * etapa anterior, la tabla ya muestra la recepción y el stepper debe coincidir.
 */
function ocCurrentStage(orderStatus: string, items: OcProgressItem[]): string {
  if (["sent", "partially_office_received", "office_received", "partially_received"].includes(orderStatus)) return "Recepción"
  if (["received", "closed"].includes(orderStatus)) return "Recepción"
  if (items.some((item) => item.quantityReceived > 0)) return "Recepción"
  // draft / issued: la OC aún no se ha enviado al proveedor.
  return "Compra"
}

/**
 * El mismo panel lo leen dos audiencias: quien compra (en `/compras/[id]`) y
 * quien recibe (en `/recepcion/[id]`). Con una sola voz, el detalle de una
 * recepción ya registrada mostraba "Confirma la recepción del proveedor o
 * registra la llegada a oficina" — una instrucción de la otra pantalla (A-10).
 */
export type OcProgressAudience = "compras" | "recepcion"

/** Estado de la guía de despacho viva de la OC, si la hay (ADQ-04). */
export type OcActiveGuideStatus = "draft" | "dispatched" | "partially_received"

export interface OcProgressOptions {
  /**
   * Guía de despacho interna viva de la OC. El siguiente paso de una OC con
   * mercadería en oficina depende de ella: sin guía hay que despachar, con la
   * guía ya despachada lo que falta es confirmar la llegada a faena. Sin este
   * dato el texto decía "Despacha los ítems a faena" cuando la GDI ya había
   * salido y el botón de al lado pedía confirmar (ADQ-04). Quien llama —la
   * pantalla— es el único que conoce las guías.
   */
  activeGuideStatus?: OcActiveGuideStatus | null
  /** La OC no tiene factura conciliada. Sólo lo sabe la pantalla de compras, que
   *  es también la única audiencia que puede resolverlo. */
  invoicePending?: boolean
}

/**
 * Siguiente paso cuando ya hay mercadería en oficina por llevar a faena: depende
 * de la guía viva. `null` si no hay guía y rige el texto genérico de la etapa.
 */
function guideNextAction(guideStatus: OcActiveGuideStatus | null | undefined): string | null {
  if (guideStatus === "dispatched") return "La guía de despacho ya salió: falta confirmar la llegada a faena."
  if (guideStatus === "draft") return "Completa el despacho de la guía hacia faena."
  if (guideStatus === "partially_received") return "La faena registró diferencias en la guía: revísalas para cerrar la recepción."
  return null
}

function ocNextAction(
  orderStatus: string,
  audience: OcProgressAudience,
  items: OcProgressItem[],
  options: OcProgressOptions = {},
): string {
  if (["partially_office_received", "office_received", "partially_received"].includes(orderStatus)) {
    const byGuide = guideNextAction(options.activeGuideStatus)
    if (byGuide) return byGuide
  }
  if (audience === "recepcion") {
    switch (orderStatus) {
      case "draft":              return "Falta emitir la OC."
      case "sent":
        return items.some((item) => item.quantityReceived > 0)
          ? "Recepción parcial registrada. Queda saldo por recibir."
          : "Falta que lleguen los ítems del proveedor."
      case "partially_office_received":
      case "office_received":    return "Los ítems están en oficina. Falta despacharlos a faena."
      case "partially_received": return "Queda saldo pendiente por recibir en faena."
      case "received":           return "Orden recibida completamente."
      case "closed":             return "Orden completada."
      default:                   return "Revisa el detalle para ver el siguiente paso."
    }
  }
  switch (orderStatus) {
    // Chome no envía la OC (OC-002): el paso es emitirla.
    case "draft":              return "Falta emitir la OC."
    case "sent":               return "Registra la recepción cuando lleguen los ítems."
    case "partially_office_received": return "Completa la llegada a oficina del saldo pendiente."
    case "office_received":    return "Despacha los ítems a faena para completar la recepción."
    case "partially_received": return "Registra la recepción del saldo pendiente en faena."
    // Recibida y sin factura, el siguiente paso no es cerrar: cerrar sin factura
    // deja la OC sin respaldo y el aviso aparecía recién dentro del formulario
    // de cierre. Mientras queda saldo por recibir manda la recepción.
    case "received":           return options.invoicePending
      ? "Adjunta la factura y luego cierra la orden."
      : "Orden recibida completamente. Ciérrala para archivarla."
    case "closed":             return "Orden completada."
    default:                   return "Revisa el detalle para ver el siguiente paso."
  }
}

/**
 * ADQ-07: con la OC en Borrador (o emitida sin enviar) nada salió al proveedor,
 * así que "Pendiente recepción" mentía: lo pendiente es emitirla. Y ADQ-10: el
 * resto usa el vocabulario canónico —"Pendiente de recepción", "Recibido
 * parcial"— que ya trae el badge del ítem.
 */
function ocItemStatusLabel(item: OcProgressItem, orderStatus: string): string {
  if (item.quantityReceived <= 0) {
    return ["draft", "issued"].includes(orderStatus) ? "OC por emitir" : "Pendiente de recepción"
  }
  if (item.quantityReceived >= item.quantity) return "Recibido"
  return "Recibido parcial"
}

// ── Private helpers ──────────────────────────────────────────────────────────












/**
 * Duplicaba a `formatQty` sin concordar el plural, así que el panel de
 * seguimiento mostraba "4 rollo" mientras el resto ya decía "4 rollos"
 * (auditoría UI/UX 2026-07-29, A-25). Delega en el formateador compartido.
 */
function formatQuantity(quantity: number, unit: string): string {
  return formatQty(quantity, unit)
}
