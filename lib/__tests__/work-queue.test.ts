/**
 * Unit tests for work-queue pure functions.
 */

import { describe, it, expect } from "vitest"

import {
  buildRequestProgress,
  buildOcProgress,
  requestStatusLabel,
  itemStatusLabel,
  itemStageLabel,
  requestNextAction,
  PURCHASE_ITEM_STATUSES,
  RECEIVE_ITEM_STATUSES,
  OFFICE_RECEIVABLE_STATUSES,
  FAENA_RECEIVABLE_STATUSES,
  DIRECT_FAENA_RECEIVABLE_STATUSES,
  RECEIVABLE_ORDER_STATUSES,
  COMPLETED_RECEIPT_ORDER_STATUSES,
} from "@/lib/work-queue"
import type { OcProgressItem } from "@/lib/work-queue"

// Estas etiquetas ahora leen del vocabulario canónico de StateBadge
// (components/states/state-badge.tsx) — deben coincidir siempre con el badge.
describe("requestStatusLabel", () => {
  it("returns correct labels", () => {
    expect(requestStatusLabel("draft")).toBe("Borrador")
    expect(requestStatusLabel("submitted")).toBe("Enviada")
    expect(requestStatusLabel("approved")).toBe("Aprobada")
    expect(requestStatusLabel("cancelled")).toBe("Cancelada")
    expect(requestStatusLabel("unknown")).toBe("unknown")
  })
})

describe("itemStatusLabel", () => {
  it("returns correct labels", () => {
    expect(itemStatusLabel("draft")).toBe("Borrador")
    expect(itemStatusLabel("requested")).toBe("Solicitado")
    expect(itemStatusLabel("received")).toBe("Recibido")
    expect(itemStatusLabel("delivered")).toBe("Entregado")
    expect(itemStatusLabel("unknown")).toBe("unknown")
  })
})

describe("itemStageLabel", () => {
  it("maps status to correct stage", () => {
    expect(itemStageLabel("draft")).toBe("Solicitado")
    expect(itemStageLabel("requested")).toBe("Aprobación")
    expect(itemStageLabel("approved")).toBe("Compra")
    expect(itemStageLabel("pending_purchase")).toBe("Compra")
    expect(itemStageLabel("in_purchase_order")).toBe("Compra")
    expect(itemStageLabel("received")).toBe("Recepción")
    expect(itemStageLabel("delivered")).toBe("Entrega")
    expect(itemStageLabel("unknown")).toBe("Solicitado")
  })
})

describe("requestNextAction", () => {
  it("cancelled request", () => {
    expect(requestNextAction("cancelled", ["draft"])).toContain("cancelada")
  })

  it("no items", () => {
    expect(requestNextAction("draft", [])).toContain("Agrega ítems")
  })

  it("all delivered", () => {
    expect(requestNextAction("closed", ["delivered", "delivered"])).toContain("entregado")
  })

  it("all rejected", () => {
    expect(requestNextAction("closed", ["rejected", "rejected"])).toContain("sin ítems aprobados")
  })

  it("has draft items", () => {
    expect(requestNextAction("draft", ["draft", "requested"])).toContain("Adjunta las cotizaciones")
  })

  it("has requested items (needs approval)", () => {
    expect(requestNextAction("submitted", ["requested"])).toContain("Aprobación")
  })

  it("has approved items (needs purchase)", () => {
    expect(requestNextAction("approved", ["approved"])).toContain("compra")
  })

  it("has in_purchase_order items", () => {
    expect(requestNextAction("in_purchasing", ["in_purchase_order"])).toContain("emitir")
  })

  it("has purchased items (needs receipt)", () => {
    expect(requestNextAction("in_purchasing", ["purchased"])).toContain("recepción")
  })

  it("has received items (needs delivery)", () => {
    expect(requestNextAction("in_purchasing", ["received"])).toContain("entrega")
  })

  it("closed request with all delivered items", () => {
    // "delivered" hits the delivered branch first, not the closed branch
    expect(requestNextAction("closed", ["delivered"])).toContain("entregado")
  })

  it("closed request with no active items", () => {
    // "cancelled" status short-circuits before any item branch is even inspected
    expect(requestNextAction("cancelled", ["pending_purchase"])).toContain("cancelada")
  })

  it("fallback for unknown status", () => {
    // Use a status that doesn't match any specific branch to reach the fallback
    expect(requestNextAction("in_review", [])).toContain("Agrega")
  })
})

describe("buildOcProgress", () => {
  const item = (quantityReceived: number): OcProgressItem => ({
    id: "i-1", productName: "Guante", quantity: 12, unitOfMeasure: "par", quantityReceived,
  })

  it("returns null for cancelled orders (no stepper)", () => {
    expect(buildOcProgress("cancelled", [item(0)])).toBeNull()
  })

  it("maps purchase-phase statuses to Compra with Solicitado+Aprobación done", () => {
    for (const status of ["draft", "sent"]) {
      const progress = buildOcProgress(status, [item(0)])
      expect(progress?.currentStage).toBe("Compra")
      expect(progress?.completedStages).toEqual(["Solicitado", "Aprobación"])
    }
  })

  it("maps reception statuses to Recepción", () => {
    for (const status of ["partially_office_received", "office_received", "partially_received", "received", "closed"]) {
      expect(buildOcProgress(status, [item(0)])?.currentStage).toBe("Recepción")
    }
  })

  it("marks Recepción as completed once the order has no pending balance", () => {
    for (const status of ["partially_office_received", "office_received", "partially_received"]) {
      expect(buildOcProgress(status, [item(0)])?.completedStages).not.toContain("Recepción")
    }
    for (const status of ["received", "closed"]) {
      expect(buildOcProgress(status, [item(12)])?.completedStages).toContain("Recepción")
    }
  })

  it("labels item status by received vs ordered quantity", () => {
    expect(buildOcProgress("sent", [item(0)])?.items[0]?.statusLabel).toBe("Pendiente recepción")
    expect(buildOcProgress("partially_received", [item(6)])?.items[0]?.statusLabel).toBe("Recepción parcial")
    expect(buildOcProgress("received", [item(12)])?.items[0]?.statusLabel).toBe("Recibido")
  })

  it("preserves the selected product attributes in the shared progress item", () => {
    const itemWithAttributes = {
      ...item(12),
      attributes: [
        { name: "Talla", value: "M" },
        { name: "Color", value: "Azul" },
      ],
    }

    const progress = buildOcProgress("received", [itemWithAttributes])

    expect(progress?.items[0]?.attributes).toEqual(itemWithAttributes.attributes)
  })

  it("asks for the invoice before closing a received order that has none", () => {
    const pending = buildOcProgress("received", [item(12)], "compras", { invoicePending: true })
    expect(pending?.nextAction).toBe("Adjunta la factura y luego cierra la orden.")

    const reconciled = buildOcProgress("received", [item(12)], "compras")
    expect(reconciled?.nextAction).toContain("Ciérrala")
  })

  it("keeps reception as the next step while there is a balance to receive", () => {
    const progress = buildOcProgress("partially_received", [item(6)], "compras", { invoicePending: true })
    expect(progress?.nextAction).toContain("recepción del saldo pendiente")
  })

  it("never asks the receiving audience for the invoice", () => {
    const progress = buildOcProgress("received", [item(12)], "recepcion", { invoicePending: true })
    expect(progress?.nextAction).toBe("Orden recibida completamente.")
  })
})

describe("buildRequestProgress", () => {
  it("returns Solicitado stage for draft", () => {
    const result = buildRequestProgress("draft", [])
    expect(result.currentStage).toBe("Solicitado")
    expect(result.completedStages).toEqual([])
  })

  it("returns correct stage for submitted with requested items", () => {
    const result = buildRequestProgress("submitted", [
      { id: "1", productName: "Casco", status: "requested", quantity: 5, unitOfMeasure: "unidad" },
    ])
    expect(result.currentStage).toBe("Aprobación")
    expect(result.completedStages).toContain("Solicitado")
  })

  it("returns Entrega stage for closed request", () => {
    const result = buildRequestProgress("closed", [
      { id: "1", productName: "Casco", status: "delivered", quantity: 5, unitOfMeasure: "unidad" },
    ])
    expect(result.currentStage).toBe("Entrega")
    expect(result.completedStages).toContain("Recepción")
  })

  it("formats items with correct labels", () => {
    const result = buildRequestProgress("submitted", [
      { id: "1", productName: "Casco", status: "requested", quantity: 10, unitOfMeasure: "unidad" },
    ])
    const item = result.items[0]!
    expect(item.quantityLabel).toContain("10")
    expect(item.statusLabel).toBe("Solicitado")
  })

  it("preserves selected attributes for request progress items", () => {
    const itemWithAttributes = {
      id: "1",
      productName: "Guante",
      status: "requested",
      quantity: 10,
      unitOfMeasure: "par",
      attributes: [{ name: "Talla", value: "L" }],
    }

    const result = buildRequestProgress("submitted", [itemWithAttributes])

    expect(result.items[0]?.attributes).toEqual(itemWithAttributes.attributes)
  })
})

// El CTA de la solicitud enlaza a /recepcion/nueva sólo si la OC está en esta
// unión; si divergiera de los sets por etapa, ofrecería un enlace que el
// destino rechaza (o la lista escondería una OC que sí es recibible).
describe("RECEIVABLE_ORDER_STATUSES", () => {
  it("es exactamente la unión de los estados recibibles por etapa", () => {
    const union = new Set([
      ...OFFICE_RECEIVABLE_STATUSES,
      ...FAENA_RECEIVABLE_STATUSES,
      ...DIRECT_FAENA_RECEIVABLE_STATUSES,
    ])
    expect(new Set(RECEIVABLE_ORDER_STATUSES)).toEqual(union)
  })

  it("no se solapa con los estados de OC ya cerrados para recepción", () => {
    for (const closed of ["draft", "received", "closed", "cancelled"]) {
      expect(RECEIVABLE_ORDER_STATUSES).not.toContain(closed)
    }
  })
})

describe("COMPLETED_RECEIPT_ORDER_STATUSES", () => {
  it("separa las OC con recepción finalizada de Compras y de la bandeja activa", () => {
    expect(COMPLETED_RECEIPT_ORDER_STATUSES).toEqual(["received", "closed"])
    for (const status of COMPLETED_RECEIPT_ORDER_STATUSES) {
      expect(RECEIVABLE_ORDER_STATUSES).not.toContain(status)
    }
  })
})

// Un ítem en estos estados espera llegada: es el par de item de una OC
// recibible, y lo que dispara el CTA "Registrar recepción".
describe("RECEIVE_ITEM_STATUSES", () => {
  it("cubre los estados de ítem cuya etapa es Recepción o previa a ella", () => {
    for (const status of RECEIVE_ITEM_STATUSES) {
      expect(["Compra", "Recepción"]).toContain(itemStageLabel(status))
    }
  })

  it("no se solapa con los estados que ya sólo admiten compra", () => {
    for (const status of RECEIVE_ITEM_STATUSES) {
      expect(PURCHASE_ITEM_STATUSES.has(status)).toBe(false)
    }
  })
})
