/**
 * Unit tests for work-queue pure functions.
 */

import { describe, it, expect } from "vitest"

import {
  buildWorkTasks,
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
} from "@/lib/work-queue"
import type { WorkActor, WorkQueueSnapshot, OcProgressItem } from "@/lib/work-queue"

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

  it("has returned items", () => {
    expect(requestNextAction("draft", ["returned"])).toContain("Corrige")
  })

  it("has draft items", () => {
    expect(requestNextAction("draft", ["draft", "requested"])).toContain("Envía")
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
    // "cancelled" status with no matching item branches hits the closed fallback
    expect(requestNextAction("cancelled", ["postponed"])).toContain("cancelada")
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
    for (const status of ["draft", "issued", "sent", "supplier_confirmed"]) {
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

  it("labels item status by received vs ordered quantity", () => {
    expect(buildOcProgress("sent", [item(0)])?.items[0]?.statusLabel).toBe("Pendiente recepción")
    expect(buildOcProgress("partially_received", [item(6)])?.items[0]?.statusLabel).toBe("Recepción parcial")
    expect(buildOcProgress("received", [item(12)])?.items[0]?.statusLabel).toBe("Recibido")
  })
})

describe("buildWorkTasks", () => {
  const globalActor: WorkActor = {
    userId: "u-1",
    permissions: [
      "requests:view_all",
      "approvals:approve",
      "purchasing:create_order",
      "purchasing:send_order",
      "receiving:register_office",
      "receiving:register_faena",
      "warehouse:register_movement",
      "deliveries:create",
    ],
    worksiteIds: [],
    isGlobal: true,
  }

  const emptySnapshot: WorkQueueSnapshot = { requests: [], items: [], orders: [] }

  it("returns empty for empty snapshot", () => {
    expect(buildWorkTasks(globalActor, emptySnapshot)).toEqual([])
  })

  it("generates request_followup tasks", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [{
        id: "req-1", code: "SOL-001", worksiteId: "ws-1", worksiteName: "Faena",
        requesterId: "u-1", status: "submitted", urgency: "high",
        createdAt: "2026-01-01", submittedAt: "2026-01-02", itemCount: 3, itemStatuses: ["requested"],
      }],
      items: [],
      orders: [],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "request_followup")).toBe(true)
  })

  it("filters requests by requester when not view_all", () => {
    const limitedActor: WorkActor = {
      userId: "u-2",
      permissions: ["requests:view_own"],
      worksiteIds: ["ws-1"],
      isGlobal: false,
    }
    const snapshot: WorkQueueSnapshot = {
      requests: [{
        id: "req-1", code: "SOL-001", worksiteId: "ws-1", worksiteName: "Faena",
        requesterId: "u-other", status: "submitted", urgency: "normal",
        createdAt: "2026-01-01", submittedAt: "2026-01-02", itemCount: 1, itemStatuses: [],
      }],
      items: [],
      orders: [],
    }
    const tasks = buildWorkTasks(limitedActor, snapshot)
    expect(tasks.some((t) => t.type === "request_followup")).toBe(false)
  })

  it("generates approval tasks for items with 'requested' status", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [{
        id: "item-1", requestId: "req-1", requestCode: "SOL-001",
        worksiteId: "ws-1", worksiteName: "Faena", requesterId: "u-1",
        productName: "Casco", status: "requested", urgency: "critical",
        createdAt: "2026-01-01", quantity: 10, unitOfMeasure: "unidad",
      }],
      orders: [],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "approval")).toBe(true)
  })

  it("generates purchase tasks for approved/pending_purchase items", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [{
        id: "item-1", requestId: "req-1", requestCode: "SOL-001",
        worksiteId: "ws-1", worksiteName: "Faena", requesterId: "u-1",
        productName: "Casco", status: "approved", urgency: "normal",
        createdAt: "2026-01-01", quantity: 5, unitOfMeasure: "unidad",
      }],
      orders: [],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "purchase")).toBe(true)
  })

  it("generates order tasks for draft OC", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [],
      orders: [{
        id: "oc-1", code: "OC-001", worksiteId: "ws-1", worksiteName: "Faena",
        supplierName: "Proveedor", status: "draft",
        createdAt: "2026-01-01", issuedAt: null, sentAt: null,
        itemCount: 2, totalAmount: 10000,
      }],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "purchase_order")).toBe(true)
  })

  it("generates receipt-office tasks for sent orders", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [],
      orders: [{
        id: "oc-1", code: "OC-001", worksiteId: "ws-1", worksiteName: "Faena",
        supplierName: "Proveedor", status: "sent",
        createdAt: "2026-01-01", issuedAt: null, sentAt: "2026-01-03",
        itemCount: 2, totalAmount: 10000,
      }],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "receipt" && t.title.includes("oficina"))).toBe(true)
  })

  it("regression: via_oficina sent order yields office task and no faena task", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [],
      orders: [{
        id: "oc-1", code: "OC-001", worksiteId: "ws-1", worksiteName: "Faena",
        supplierName: "Proveedor", status: "sent", deliveryMode: "via_oficina",
        createdAt: "2026-01-01", issuedAt: null, sentAt: "2026-01-03",
        itemCount: 2, totalAmount: 10000,
      }],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "receipt" && t.title.includes("oficina"))).toBe(true)
    expect(tasks.some((t) => t.type === "receipt" && t.title.includes("faena"))).toBe(false)
  })

  it("directo_faena sent order yields faena task and no office task", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [],
      orders: [{
        id: "oc-1", code: "OC-001", worksiteId: "ws-1", worksiteName: "Faena",
        supplierName: "Proveedor", status: "sent", deliveryMode: "directo_faena",
        createdAt: "2026-01-01", issuedAt: null, sentAt: "2026-01-03",
        itemCount: 2, totalAmount: 10000,
      }],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "receipt" && t.title.includes("faena"))).toBe(true)
    expect(tasks.some((t) => t.type === "receipt" && t.title.includes("oficina"))).toBe(false)
  })

  it("directo_faena partially_received order yields a faena receipt task", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [],
      orders: [{
        id: "oc-1", code: "OC-001", worksiteId: "ws-1", worksiteName: "Faena",
        supplierName: "Proveedor", status: "partially_received", deliveryMode: "directo_faena",
        createdAt: "2026-01-01", issuedAt: null, sentAt: "2026-01-03",
        itemCount: 2, totalAmount: 10000,
      }],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "receipt" && t.title.includes("faena"))).toBe(true)
  })

  it("generates delivery tasks for received items with stock", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [{
        id: "item-1", requestId: "req-1", requestCode: "SOL-001",
        worksiteId: "ws-1", worksiteName: "Faena", requesterId: "u-1",
        productName: "Casco", status: "received", urgency: "normal",
        createdAt: "2026-01-01", quantity: 10, unitOfMeasure: "unidad", hasStock: true,
      }],
      orders: [],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.some((t) => t.type === "warehouse_delivery")).toBe(true)
  })

  it("does not generate delivery tasks without deliveries:create (M-2)", () => {
    // warehouse:register_movement por sí solo no basta: /entregas exige deliveries:create.
    const warehouseOnlyActor: WorkActor = {
      userId: "u-2",
      permissions: ["warehouse:register_movement", "warehouse:view_stock"],
      worksiteIds: [],
      isGlobal: true,
    }
    const snapshot: WorkQueueSnapshot = {
      requests: [],
      items: [{
        id: "item-1", requestId: "req-1", requestCode: "SOL-001",
        worksiteId: "ws-1", worksiteName: "Faena", requesterId: "u-1",
        productName: "Casco", status: "received", urgency: "normal",
        createdAt: "2026-01-01", quantity: 10, unitOfMeasure: "unidad", hasStock: true,
      }],
      orders: [],
    }
    const tasks = buildWorkTasks(warehouseOnlyActor, snapshot)
    expect(tasks.some((t) => t.type === "warehouse_delivery")).toBe(false)
  })

  it("does not generate tasks for inactive statuses", () => {
    const snapshot: WorkQueueSnapshot = {
      requests: [{
        id: "req-1", code: "SOL-001", worksiteId: "ws-1", worksiteName: "Faena",
        requesterId: "u-1", status: "closed", urgency: "normal",
        createdAt: "2026-01-01", submittedAt: null, itemCount: 0, itemStatuses: [],
      }],
      items: [],
      orders: [],
    }
    const tasks = buildWorkTasks(globalActor, snapshot)
    expect(tasks.filter((t) => t.type === "request_followup")).toHaveLength(0)
  })

  it("restricts by worksite scope", () => {
    const scopedActor: WorkActor = {
      userId: "u-1",
      permissions: ["requests:view_all"],
      worksiteIds: ["ws-1"],
      isGlobal: false,
    }
    const snapshot: WorkQueueSnapshot = {
      requests: [{
        id: "req-1", code: "SOL-001", worksiteId: "ws-2", worksiteName: "Other",
        requesterId: "u-1", status: "submitted", urgency: "normal",
        createdAt: "2026-01-01", submittedAt: "2026-01-02", itemCount: 1, itemStatuses: [],
      }],
      items: [],
      orders: [],
    }
    const tasks = buildWorkTasks(scopedActor, snapshot)
    expect(tasks).toHaveLength(0)
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
    for (const closed of ["draft", "issued", "received", "closed", "cancelled"]) {
      expect(RECEIVABLE_ORDER_STATUSES).not.toContain(closed)
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
