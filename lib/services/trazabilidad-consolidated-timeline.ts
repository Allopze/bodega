import type { TimelineEvent } from "./trazabilidad-consolidated.types"

interface TimelineBuildParams {
  item: {
    requestId: string
    requestCode: string
    requestDate: string
    requesterName: string
    quantity: number
    uom: string
  }
  approvals: Array<{
    id: string
    type: string
    decidedAt: string
    decidedByName: string
    modifiedQty: number | null
    reason: string | null
  }>
  ocs: Array<{
    id: string
    purchaseOrderId: string
    orderCode: string
    supplierName: string
    quantity: number
    issuedAt: string | null
    createdAt: string
  }>
  receiptsByOcItem: Map<string, Array<{
    id: string
    receiptId: string
    receiptCode: string
    locationType: string
    receivedAt: string
    receivedByName: string
    quantityReceived: number
    quantityRejected: number
  }>>
  gdisByOcItem: Map<string, Array<{
    id: string
    guideId: string
    guideCode: string
    guideStatus: string
    dispatchedAt: string | null
    receivedAt: string | null
    dispatchedByName: string | null
    quantity: number
  }>>
  deliveries: Array<{
    id: string
    deliveryId: string
    deliveryCode: string
    deliveredAt: string
    deliveredByName: string
    receiverName: string | null
    workerFirstName: string | null
    workerLastName: string | null
    quantity: number
    returnQuantity: number | null
    voidedAt: string | null
    voidReason: string | null
  }>
}

const GUIDE_STATUS_LABEL: Record<string, string> = {
  received: "Recibido en faena",
  partially_received: "Recibido parcialmente en faena",
  dispatched: "En camino",
}

/**
 * Reconstruye el historial cronológico de movimientos vinculados a un ítem.
 */
export function buildItemTimeline(params: TimelineBuildParams): TimelineEvent[] {
  const { item, approvals, ocs, receiptsByOcItem, gdisByOcItem, deliveries } = params
  const timeline: TimelineEvent[] = []

  // 1. Solicitud
  timeline.push({
    id: `req-${item.requestId}`,
    date: item.requestDate,
    type: "request",
    title: `Solicitud ${item.requestCode}`,
    description: `${item.requesterName} solicitó ${item.quantity} ${item.uom}`,
    quantity: item.quantity,
    actor: item.requesterName,
    href: `/solicitudes/${item.requestId}`,
  })

  // 2. Aprobaciones
  for (const app of approvals) {
    // `modifiedQty` de 0 es una decisión real —"aprobado sin unidades"— y con
    // un chequeo por truthiness se describía como una aprobación sin ajuste.
    const hasAdjustment = app.modifiedQty != null
    timeline.push({
      id: `app-${app.id}`,
      date: app.decidedAt,
      type: "approval",
      title: app.type === "modify" ? "Aprobación con ajuste de cantidad" : "Aprobación de ítem",
      description: hasAdjustment
        ? `${app.decidedByName} aprobó con cantidad ajustada a ${app.modifiedQty} ${item.uom}. Motivo: ${app.reason ?? "Sin notas"}`
        : `Aprobado por ${app.decidedByName}. Motivo: ${app.reason ?? "Sin notas"}`,
      quantity: app.modifiedQty ?? item.quantity,
      actor: app.decidedByName,
    })
  }

  // 3. Órdenes de compra y sus recepciones/guías
  for (const oc of ocs) {
    timeline.push({
      id: `oc-${oc.id}`,
      date: oc.issuedAt ?? oc.createdAt,
      type: "purchase_order",
      title: `Orden de compra ${oc.orderCode}`,
      description: `Compras pidió ${oc.quantity} ${item.uom} a proveedor ${oc.supplierName}`,
      quantity: oc.quantity,
      actor: oc.supplierName,
      href: `/compras/${oc.purchaseOrderId}`,
    })

    const recs = receiptsByOcItem.get(oc.id) ?? []
    for (const rec of recs) {
      timeline.push({
        id: `rec-${rec.id}`,
        date: rec.receivedAt,
        type: rec.locationType === "office" ? "receipt_office" : "receipt_faena",
        title: `Recepción ${rec.receiptCode} (${rec.locationType === "office" ? "Oficina" : "Faena"})`,
        description: `${rec.receivedByName} recibió ${rec.quantityReceived} ${item.uom}${
          rec.quantityRejected > 0 ? ` (${rec.quantityRejected} rechazadas)` : ""
        }`,
        quantity: rec.quantityReceived,
        actor: rec.receivedByName,
        href: `/recepcion/${rec.receiptId}`,
      })
    }

    const gdis = gdisByOcItem.get(oc.id) ?? []
    for (const gdi of gdis) {
      timeline.push({
        id: `gdi-${gdi.id}`,
        date: gdi.dispatchedAt ?? gdi.receivedAt ?? item.requestDate,
        type: "dispatch_guide",
        title: `Guía de despacho ${gdi.guideCode}`,
        description: `Despacho de ${gdi.quantity} ${item.uom} a faena. Estado: ${
          GUIDE_STATUS_LABEL[gdi.guideStatus] ?? gdi.guideStatus
        }`,
        quantity: gdi.quantity,
        actor: gdi.dispatchedByName ?? undefined,
        href: `/bodega/guias/${gdi.guideId}`,
      })
    }
  }

  // 4. Entregas a personal
  for (const del of deliveries) {
    const recipient =
      del.workerFirstName && del.workerLastName
        ? `${del.workerFirstName} ${del.workerLastName}`
        : (del.receiverName ?? "Personal en faena")

    const voided = del.voidedAt != null

    timeline.push({
      id: `del-${del.id}`,
      date: del.deliveredAt,
      type: "delivery",
      title: voided ? `Entrega ${del.deliveryCode} (anulada)` : `Entrega ${del.deliveryCode}`,
      description: voided
        ? `Entrega anulada de ${del.quantity} ${item.uom} a ${recipient}. No cuenta como entregado. Motivo: ${del.voidReason ?? "Sin motivo registrado"}`
        : `Entrega de ${del.quantity} ${item.uom} a ${recipient} por ${del.deliveredByName}${
            del.returnQuantity ? ` (Devolución: ${del.returnQuantity})` : ""
          }`,
      quantity: del.quantity,
      actor: del.deliveredByName,
      voided,
      // El documento de la entrega es su comprobante firmado, no el listado
      // completo de entregas al que apuntaba antes.
      href: `/entregas/${del.deliveryId}/print`,
    })
  }

  // Ordenar cronológicamente
  timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return timeline
}
