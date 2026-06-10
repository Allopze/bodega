import { describe, expect, it } from "vitest"
import {
  buildRequestProgress,
  buildWorkTasks,
  itemStatusLabel,
  requestNextAction,
  type WorkActor,
  type WorkQueueSnapshot,
} from "@/lib/work-queue"

const baseActor: WorkActor = {
  userId:      "user-1",
  permissions: [],
  worksiteIds: ["ws-1"],
  isGlobal:    false,
}

const snapshot: WorkQueueSnapshot = {
  requests: [
    {
      id:           "req-1",
      code:         "SOL-1",
      worksiteId:   "ws-1",
      worksiteName: "Faena Norte",
      requesterId:  "user-1",
      status:       "in_purchasing",
      urgency:      "high",
      createdAt:    "2026-01-01T10:00:00.000Z",
      submittedAt:  "2026-01-02T10:00:00.000Z",
      itemCount:    2,
      itemStatuses: ["approved", "pending_purchase"],
    },
    {
      id:           "req-2",
      code:         "SOL-2",
      worksiteId:   "ws-2",
      worksiteName: "Faena Sur",
      requesterId:  "user-2",
      status:       "in_review",
      urgency:      "critical",
      createdAt:    "2026-01-01T09:00:00.000Z",
      submittedAt:  "2026-01-02T09:00:00.000Z",
      itemCount:    1,
      itemStatuses: ["requested"],
    },
  ],
  items: [
    {
      id:            "item-1",
      requestId:     "req-1",
      requestCode:   "SOL-1",
      worksiteId:    "ws-1",
      worksiteName:  "Faena Norte",
      requesterId:   "user-1",
      productName:   "Guantes",
      status:        "approved",
      urgency:       "high",
      createdAt:     "2026-01-02T10:00:00.000Z",
      quantity:      5,
      unitOfMeasure: "par",
    },
    {
      id:            "item-2",
      requestId:     "req-2",
      requestCode:   "SOL-2",
      worksiteId:    "ws-2",
      worksiteName:  "Faena Sur",
      requesterId:   "user-2",
      productName:   "Casco",
      status:        "requested",
      urgency:       "critical",
      createdAt:     "2026-01-01T09:00:00.000Z",
      quantity:      1,
      unitOfMeasure: "unidad",
    },
    {
      id:            "item-3",
      requestId:     "req-1",
      requestCode:   "SOL-1",
      worksiteId:    "ws-1",
      worksiteName:  "Faena Norte",
      requesterId:   "user-1",
      productName:   "Arnés",
      status:        "received",
      urgency:       "normal",
      createdAt:     "2026-01-03T10:00:00.000Z",
      quantity:      2,
      unitOfMeasure: "unidad",
      hasStock:      true,
    },
  ],
  orders: [
    {
      id:              "oc-1",
      code:            "OC-1",
      worksiteId:      "ws-1",
      worksiteName:    "Faena Norte",
      supplierName:    "Proveedor A",
      status:          "sent",
      createdAt:       "2026-01-04T10:00:00.000Z",
      issuedAt:        "2026-01-05T10:00:00.000Z",
      sentAt:          "2026-01-06T10:00:00.000Z",
      itemCount:       2,
      totalAmount:     10000,
    },
    {
      id:              "oc-2",
      code:            "OC-2",
      worksiteId:      "ws-1",
      worksiteName:    "Faena Norte",
      supplierName:    "Proveedor B",
      status:          "received",
      createdAt:       "2026-01-07T10:00:00.000Z",
      issuedAt:        "2026-01-08T10:00:00.000Z",
      sentAt:          "2026-01-09T10:00:00.000Z",
      itemCount:       1,
      totalAmount:     5000,
    },
  ],
}

describe("buildWorkTasks", () => {
  it("shows a scoped requester only their visible active requests", () => {
    const tasks = buildWorkTasks(
      { ...baseActor, permissions: ["requests:view_own"] },
      snapshot,
    )

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      type: "request_followup",
      href: "/solicitudes/req-1",
    })
  })

  it("builds approval tasks for requested items in visible worksites", () => {
    const tasks = buildWorkTasks(
      {
        ...baseActor,
        permissions: ["approvals:approve"],
        isGlobal: true,
        worksiteIds: [],
      },
      snapshot,
    )

    expect(tasks).toEqual([
      expect.objectContaining({
        type: "approval",
        href: "/aprobaciones?solicitud=req-2",
        priority: "critical",
      }),
    ])
  })

  it("groups approved items into purchase tasks by worksite", () => {
    const tasks = buildWorkTasks(
      { ...baseActor, permissions: ["purchasing:create_order"] },
      snapshot,
    )

    expect(tasks.some((task) =>
      task.type === "purchase" && task.href === "/compras/nueva?faena=ws-1"
    )).toBe(true)
  })

  it("shows sent orders as receiving tasks", () => {
    const tasks = buildWorkTasks(
      { ...baseActor, permissions: ["receiving:register"] },
      snapshot,
    )

    expect(tasks).toEqual([
      expect.objectContaining({
        type: "receipt",
        href: "/recepcion/nueva?oc=oc-1",
      }),
    ])
  })

  it("shows received items with stock as warehouse delivery tasks", () => {
    const tasks = buildWorkTasks(
      { ...baseActor, permissions: ["warehouse:register_movement"] },
      snapshot,
    )

    expect(tasks).toEqual([
      expect.objectContaining({
        type: "warehouse_delivery",
        href: "/bodega?faena=ws-1&item=item-3",
      }),
    ])
  })

})

describe("request progress labels", () => {
  it("maps technical item statuses to user-facing labels", () => {
    expect(itemStatusLabel("pending_purchase")).toBe("Aprobado para compra")
    expect(itemStatusLabel("in_purchase_order")).toBe("Incluido en OC")
  })

  it("returns the next human action for every main stage", () => {
    expect(requestNextAction("submitted", ["requested"])).toBe("Aprobación debe revisar los ítems pendientes.")
    expect(requestNextAction("approved", ["pending_purchase"])).toBe("El módulo de órdenes de compra debe generar la orden de compra.")
    expect(requestNextAction("in_purchasing", ["purchased"])).toBe("Esperando recepción del proveedor.")
    expect(requestNextAction("in_purchasing", ["received"])).toBe("Bodega debe registrar la entrega a faena.")
    expect(requestNextAction("closed", ["delivered"])).toBe("Pedido entregado en faena.")
  })

  it("builds a compact progress summary", () => {
    const progress = buildRequestProgress("in_purchasing", [
      {
        id: "item-1",
        productName: "Guantes",
        status: "purchased",
        quantity: 5,
        unitOfMeasure: "par",
      },
    ])

    expect(progress.currentStage).toBe("Compra")
    expect(progress.completedStages).toEqual(["Solicitado", "Aprobación"])
    expect(progress.items[0]).toMatchObject({
      statusLabel: "Comprado",
      stageLabel: "Compra",
    })
  })
})
