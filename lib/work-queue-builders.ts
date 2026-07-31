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
  }))

  const statuses = items.map((item) => item.status)
  const currentStage = requestCurrentStage(requestStatus, statuses)
  const currentIndex = Math.max(0, STAGES.indexOf(currentStage))

  return {
    currentStage,
    completedStages: STAGES.slice(0, currentIndex),
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
      statusLabel:   ocItemStatusLabel(item),
      stageLabel:    currentStage,
    })),
  }
}

/**
 * La etapa mira también las cantidades, no sólo el estado de la OC.
 *
 * `receiving.ts` avanza el estado al registrar una recepción, así que en la ruta
 * normal ambos concuerdan. Pero derivar la etapa **sólo** del estado deja al
 * stepper a merced de cualquier fila escrita fuera del servicio (seeds, cargas,
 * arreglos manuales): con `sent` y 6 de 12 unidades ya recibidas, marcaba
 * "Recepción" apagada mientras la propia página mostraba la recepción parcial
 * (auditoría UI/UX 2026-07-29, A-10). Con los datos a la vista, el stepper no
 * puede contradecir a la tabla que tiene al lado.
 */
function ocCurrentStage(orderStatus: string, items: OcProgressItem[]): string {
  if (["partially_office_received", "office_received", "partially_received"].includes(orderStatus)) return "Recepción"
  if (["received", "closed"].includes(orderStatus)) return "Recepción"
  if (items.some((item) => item.quantityReceived > 0)) return "Recepción"
  // draft / issued / sent
  return "Compra"
}

/**
 * El mismo panel lo leen dos audiencias: quien compra (en `/compras/[id]`) y
 * quien recibe (en `/recepcion/[id]`). Con una sola voz, el detalle de una
 * recepción ya registrada mostraba "Confirma la recepción del proveedor o
 * registra la llegada a oficina" — una instrucción de la otra pantalla (A-10).
 */
export type OcProgressAudience = "compras" | "recepcion"

export interface OcProgressOptions {
  /** La OC no tiene factura conciliada. Sólo lo sabe la pantalla de compras, que
   *  es también la única audiencia que puede resolverlo. */
  invoicePending?: boolean
}

function ocNextAction(
  orderStatus: string,
  audience: OcProgressAudience,
  items: OcProgressItem[],
  options: OcProgressOptions = {},
): string {
  if (audience === "recepcion") {
    switch (orderStatus) {
      case "draft":
      case "issued":             return "La orden aún no ha sido enviada al proveedor."
      case "sent":
        return items.some((item) => item.quantityReceived > 0)
          ? "Recepción parcial registrada. Queda saldo por recibir."
          : "Pendiente de que lleguen los ítems."
      case "partially_office_received":
      case "office_received":    return "Los ítems están en oficina. Falta despacharlos a faena."
      case "partially_received": return "Queda saldo pendiente por recibir en faena."
      case "received":           return "Orden recibida completamente."
      case "closed":             return "Orden cerrada."
      default:                   return "Revisa el detalle para ver el siguiente paso."
    }
  }
  switch (orderStatus) {
    case "draft":              return "Emite la orden para poder enviarla al proveedor."
    case "issued":             return "Marca la orden como enviada al proveedor."
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
    case "closed":             return "Orden cerrada."
    default:                   return "Revisa el detalle para ver el siguiente paso."
  }
}

function ocItemStatusLabel(item: OcProgressItem): string {
  if (item.quantityReceived <= 0) return "Pendiente recepción"
  if (item.quantityReceived >= item.quantity) return "Recibido"
  return "Recepción parcial"
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
