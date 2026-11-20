/**
 * La recepción en faena de una OC vía oficina que ya tiene guía de despacho.
 *
 * `registerReceipt` rechaza la etapa de faena del formulario genérico cuando la
 * OC tiene cualquier guía no anulada: «La recepción final debe cotejarse con la
 * guía …». El formulario igual la ofrecía, y varias entradas mandaban ahí (la
 * cola de pendientes, el detalle de la solicitud, el aviso de OC enviada). Quien
 * marcaba lo que llegó y lo que no terminaba en un botón que no podía guardar
 * (OC-2026-0065, 2026-11-20). La pantalla ahora dice dónde se hace.
 */

import { receiptGuideActionLabel } from "./recepcion-table.helpers"

export interface OrderGuide {
  id:        string
  code:      string
  status:    string
  receiptId: string | null
}

/** Despachada o con llegada parcial: falta confirmar en faena. */
const TO_CONFIRM = new Set(["dispatched", "partially_received"])

/**
 * La guía que manda, de las no anuladas de la OC en orden de creación: la
 * primera por confirmar, si no la primera en borrador, y si todas se cerraron,
 * la última (su recepción en oficina es donde se prepara el despacho siguiente).
 */
export function pickFaenaGuide(guides: readonly OrderGuide[]): OrderGuide | null {
  const live = guides.filter((guide) => guide.status !== "cancelled")
  return live.find((guide) => TO_CONFIRM.has(guide.status))
    ?? live.find((guide) => guide.status === "draft")
    ?? live.at(-1)
    ?? null
}

export interface FaenaGuidePermissions {
  viewGuides:    boolean
  receiveGuide:  boolean
  dispatchGuide: boolean
  viewReceipts:  boolean
}

export interface FaenaGuideNotice {
  title:       string
  description: string
  action:      { href: string; label: string } | null
}

/** Qué decirle a quien quiere recibir en faena, y adónde mandarlo si puede ir. */
export function faenaGuideNotice(
  guide: OrderGuide,
  worksiteName: string,
  can: FaenaGuidePermissions,
): FaenaGuideNotice {
  const guideHref = `/bodega/guias/${guide.id}`

  if (TO_CONFIRM.has(guide.status)) {
    const action = can.receiveGuide
      ? { href: guideHref, label: receiptGuideActionLabel(guide.status) }
      : can.viewGuides ? { href: guideHref, label: `Ver la guía ${guide.code}` } : null
    return {
      title: `La recepción en faena se confirma en la guía ${guide.code}`,
      description: guide.status === "partially_received"
        ? `La guía ${guide.code} ya tiene una llegada parcial a ${worksiteName}. Lo que falta se confirma en la misma guía cuando llegue.`
        : `La oficina despachó esta OC a ${worksiteName} con la guía ${guide.code}. Ahí se marca lo que llegó y, si falta algo, el motivo.`
          + (can.receiveGuide ? "" : " La confirma quien recibe en faena."),
      action,
    }
  }

  if (guide.status === "draft") {
    const action = can.dispatchGuide
      ? { href: guideHref, label: receiptGuideActionLabel(guide.status) }
      : can.viewGuides ? { href: guideHref, label: `Ver la guía ${guide.code}` } : null
    return {
      title: `La guía ${guide.code} todavía no sale de oficina`,
      description: `Lo que llegó a oficina viaja a ${worksiteName} con esa guía. Cuando la oficina la despache, la llegada se confirma en la guía.`,
      action,
    }
  }

  return {
    title: "Lo que falta se despacha con otra guía",
    description: `Las guías de esta OC ya se confirmaron en ${worksiteName}. Lo que quedó en oficina se despacha preparando otra guía desde la recepción en oficina.`,
    action: guide.receiptId && can.viewReceipts
      ? { href: `/recepcion/${guide.receiptId}`, label: "Ver recepción en oficina" }
      : null,
  }
}
