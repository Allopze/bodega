import { describe, expect, it } from "vitest"
import {
  aggregateConsolidatedRows,
  computeAggregateStatus,
  type ConsolidatedRow,
  type LinkedMaps,
  type OcRow,
} from "./trazabilidad-consolidated"

function row(overrides: Partial<ConsolidatedRow> = {}): ConsolidatedRow {
  return {
    itemId: "item-1",
    requestId: "req-1",
    requestCode: "SOL-0001",
    requestDate: "2026-08-01T12:00:00.000Z",
    requesterId: "user-1",
    requesterName: "Ana Solicitante",
    deliveryMode: "via_oficina",
    urgency: null,
    requestUrgency: "normal",
    productId: "prod-1",
    productName: "Bota de seguridad",
    productSku: "BOTA-01",
    categoryId: "cat-1",
    categoryName: "Calzado",
    notes: null,
    uom: "par",
    worksiteId: "ws-1",
    worksiteName: "Faena Uno",
    requested: 6,
    approved: 6,
    inOc: 6,
    receivedOffice: 4,
    receivedFaena: 4,
    dispatched: 4,
    stockInFaena: 0,
    delivered: 4,
    pendingTotal: 2,
    pendingBreakdown: {
      pendingTotal: 2,
      notYetOrdered: 0,
      pendingFromSupplier: 2,
      inOffice: 0,
      inTransit: 0,
      inFaenaAvailable: 0,
    },
    computedStatus: "parcialmente_entregado",
    computedStatusLabel: "Parcialmente entregado",
    computedStatusColor: "warning",
    supplierNames: ["Proveedor Uno"],
    ocCodes: [
      {
        id: "po-1",
        code: "OC-2026-0001",
        supplierName: "Proveedor Uno",
        quantity: 6,
      },
    ],
    lastUpdated: "2026-08-08T12:00:00.000Z",
    alert: false,
    timeline: [],
    ...overrides,
  }
}

function oc(overrides: Partial<OcRow> = {}): OcRow {
  return {
    id: "poi-1",
    requestItemId: "item-1",
    purchaseOrderId: "po-1",
    orderCode: "OC-2026-0001",
    orderStatus: "sent",
    issuedAt: "2026-08-03T12:00:00.000Z",
    sentAt: "2026-08-04T12:00:00.000Z",
    createdAt: "2026-08-02T12:00:00.000Z",
    supplierId: "sup-1",
    supplierName: "Proveedor Uno",
    quantity: 6,
    quantityOfficeReceived: 4,
    quantityReceived: 4,
    ...overrides,
  }
}

function linkedMaps(ocs: OcRow[] = []): LinkedMaps {
  const ocsByItem = new Map<string, OcRow[]>()
  for (const order of ocs) {
    if (!order.requestItemId) continue
    const itemOrders = ocsByItem.get(order.requestItemId) ?? []
    itemOrders.push(order)
    ocsByItem.set(order.requestItemId, itemOrders)
  }

  return {
    approvalsByItem: new Map(),
    ocsByItem,
    deliveriesByItem: new Map(),
    receiptsByOcItem: new Map(),
    gdisByOcItem: new Map(),
    stockByProduct: new Map(),
  }
}

describe("aggregateConsolidatedRows", () => {
  it("agrega dos líneas de una solicitud y resume su avance por UOM", () => {
    const rows = [
      row(),
      row({
        itemId: "item-2",
        productId: "prod-2",
        productName: "Zapato de seguridad",
        productSku: "ZAP-01",
        requested: 4,
        approved: 4,
        inOc: 4,
        receivedOffice: 0,
        receivedFaena: 0,
        dispatched: 0,
        delivered: 0,
        pendingTotal: 4,
        pendingBreakdown: {
          pendingTotal: 4,
          notYetOrdered: 0,
          pendingFromSupplier: 4,
          inOffice: 0,
          inTransit: 0,
          inFaenaAvailable: 0,
        },
        computedStatus: "pedido_proveedor",
        computedStatusLabel: "Pedido a proveedor",
        computedStatusColor: "info",
        ocCodes: [
          {
            id: "po-1",
            code: "OC-2026-0001",
            supplierName: "Proveedor Uno",
            quantity: 4,
          },
        ],
        lastUpdated: "2026-08-09T12:00:00.000Z",
      }),
    ]
    const maps = linkedMaps([
      oc(),
      oc({
        id: "poi-2",
        requestItemId: "item-2",
        quantity: 4,
        quantityOfficeReceived: 0,
        quantityReceived: 0,
        sentAt: "2026-08-05T12:00:00.000Z",
      }),
    ])

    const result = aggregateConsolidatedRows(rows, maps)

    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]).toMatchObject({
      requestId: "req-1",
      lineCount: 2,
      orderCount: 1,
      pendingTotal: 6,
      hasPending: true,
      lastUpdated: "2026-08-09T12:00:00.000Z",
    })
    expect(result.requests[0]?.lines).toEqual(rows)
    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]).toMatchObject({
      orderId: "po-1",
      requestIds: ["req-1"],
      lineIds: ["item-1", "item-2"],
      lineCount: 2,
      lastUpdated: "2026-08-05T12:00:00.000Z",
    })
    expect(result.requests[0]?.quantitiesByUom).toEqual([
      {
        uom: "par",
        requested: 10,
        approved: 10,
        inOc: 10,
        receivedOffice: 4,
        receivedFaena: 4,
        delivered: 4,
        pendingTotal: 6,
      },
    ])
  })

  it("relaciona una solicitud con varias OCs sin multiplicar sus líneas", () => {
    const rows = [row()]
    const maps = linkedMaps([
      oc({ quantity: 2, quantityOfficeReceived: 1, quantityReceived: 1 }),
      oc({
        id: "poi-2",
        purchaseOrderId: "po-2",
        orderCode: "OC-2026-0002",
        supplierId: "sup-2",
        supplierName: "Proveedor Dos",
        quantity: 4,
        quantityOfficeReceived: 3,
        quantityReceived: 3,
      }),
    ])

    const result = aggregateConsolidatedRows(rows, maps)

    expect(result.requests[0]).toMatchObject({ lineCount: 1, orderCount: 2 })
    expect(result.requests[0]?.orders.map((order) => order.orderId)).toEqual(["po-1", "po-2"])
    expect(result.orders).toHaveLength(2)
    expect(result.orders[0]?.quantitiesByUom).toEqual([
      {
        uom: "par",
        inOc: 2,
        receivedOffice: 1,
        receivedFaena: 1,
      },
    ])
    expect(result.orders[1]?.quantitiesByUom).toEqual([
      {
        uom: "par",
        inOc: 4,
        receivedOffice: 3,
        receivedFaena: 3,
      },
    ])
  })

  it("expone sólo cantidades exactas de OC cuando una línea está parcialmente ordenada", () => {
    const partiallyOrdered = row({
      requested: 10,
      approved: 10,
      inOc: 4,
      receivedOffice: 3,
      receivedFaena: 2,
      delivered: 1,
      pendingTotal: 9,
    })

    const result = aggregateConsolidatedRows(
      [partiallyOrdered],
      linkedMaps([
        oc({
          quantity: 4,
          quantityOfficeReceived: 3,
          quantityReceived: 2,
        }),
      ]),
    )

    expect(result.requests[0]?.quantitiesByUom).toEqual([
      {
        uom: "par",
        requested: 10,
        approved: 10,
        inOc: 4,
        receivedOffice: 3,
        receivedFaena: 2,
        delivered: 1,
        pendingTotal: 9,
      },
    ])
    expect(result.orders[0]?.quantitiesByUom).toEqual([
      {
        uom: "par",
        inOc: 4,
        receivedOffice: 3,
        receivedFaena: 2,
      },
    ])
  })

  it("deduplica globalmente una OC compartida y limita cada proyección a su solicitud", () => {
    const rows = [
      row(),
      row({
        itemId: "item-2",
        requestId: "req-2",
        requestCode: "SOL-0002",
        requesterId: "user-2",
        requesterName: "Bruno Solicitante",
        requested: 4,
        approved: 4,
        inOc: 4,
        delivered: 0,
        pendingTotal: 4,
        computedStatus: "pedido_proveedor",
        computedStatusLabel: "Pedido a proveedor",
        computedStatusColor: "info",
      }),
    ]
    const maps = linkedMaps([
      oc(),
      oc({ id: "poi-2", requestItemId: "item-2", quantity: 4 }),
    ])

    const result = aggregateConsolidatedRows(rows, maps)

    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]).toMatchObject({
      orderId: "po-1",
      requestIds: ["req-1", "req-2"],
      lineIds: ["item-1", "item-2"],
      lineCount: 2,
    })
    expect(result.requests[0]?.orders[0]).toMatchObject({
      requestIds: ["req-1"],
      lineIds: ["item-1"],
      lineCount: 1,
    })
    expect(result.requests[1]?.orders[0]).toMatchObject({
      requestIds: ["req-2"],
      lineIds: ["item-2"],
      lineCount: 1,
    })
  })

  it("conserva una línea sin OC sin inventar una orden", () => {
    const result = aggregateConsolidatedRows(
      [
        row({
          inOc: 0,
          ocCodes: [],
          supplierNames: [],
          computedStatus: "aprobado",
          computedStatusLabel: "Aprobado (por comprar)",
          computedStatusColor: "signal",
        }),
      ],
      linkedMaps(),
    )

    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]).toMatchObject({ lineCount: 1, orderCount: 0, orders: [] })
    expect(result.orders).toEqual([])
  })

  it("mantiene par y unidad como resúmenes separados", () => {
    const result = aggregateConsolidatedRows(
      [
        row(),
        row({
          itemId: "item-2",
          uom: "unidad",
          requested: 2,
          approved: null,
          inOc: 0,
          receivedOffice: 0,
          receivedFaena: 0,
          dispatched: 0,
          delivered: 0,
          pendingTotal: 2,
          computedStatus: "solicitado",
          computedStatusLabel: "Solicitado",
          computedStatusColor: "neutral",
          ocCodes: [],
          supplierNames: [],
        }),
      ],
      linkedMaps([oc()]),
    )

    expect(result.requests[0]?.quantitiesByUom).toEqual([
      {
        uom: "par",
        requested: 6,
        approved: 6,
        inOc: 6,
        receivedOffice: 4,
        receivedFaena: 4,
        delivered: 4,
        pendingTotal: 2,
      },
      {
        uom: "unidad",
        requested: 2,
        approved: null,
        inOc: 0,
        receivedOffice: 0,
        receivedFaena: 0,
        delivered: 0,
        pendingTotal: 2,
      },
    ])
    expect(result.requests[0]).toMatchObject({
      pendingTotal: null,
      hasPending: true,
    })
  })

  it("conserva la urgencia de la solicitud y resuelve overrides sin depender del orden", () => {
    const inherited = aggregateConsolidatedRows(
      [row({ urgency: null, requestUrgency: "high" })],
      linkedMaps(),
    )
    const withOverrides = aggregateConsolidatedRows(
      [
        row({ itemId: "item-1", urgency: "normal", requestUrgency: null }),
        row({ itemId: "item-2", urgency: "critical", requestUrgency: null }),
      ].reverse(),
      linkedMaps(),
    )

    expect(inherited.requests[0]?.urgency).toBe("high")
    expect(withOverrides.requests[0]?.urgency).toBe("critical")
  })
})

describe("computeAggregateStatus", () => {
  it("rechaza un conjunto vacío porque no existe una solicitud que clasificar", () => {
    expect(() => computeAggregateStatus([])).toThrow("sin líneas")
  })

  it("marca parcialmente entregada una solicitud con avance y saldo", () => {
    const result = computeAggregateStatus([
      row({ computedStatus: "entregado", delivered: 6, pendingTotal: 0 }),
      row({
        itemId: "item-2",
        computedStatus: "pedido_proveedor",
        computedStatusLabel: "Pedido a proveedor",
        computedStatusColor: "info",
        delivered: 0,
        pendingTotal: 4,
      }),
    ])

    expect(result).toEqual({
      status: "parcialmente_entregado",
      statusLabel: "Parcialmente entregado",
      statusColor: "warning",
      statusCounts: { entregado: 1, pedido_proveedor: 1 },
    })
  })

  it("usa el estado más bloqueante cuando no existe avance de entrega", () => {
    const result = computeAggregateStatus([
      row({
        computedStatus: "pedido_proveedor",
        computedStatusLabel: "Pedido a proveedor",
        computedStatusColor: "info",
        delivered: 0,
      }),
      row({
        itemId: "item-2",
        computedStatus: "solicitado",
        computedStatusLabel: "Solicitado",
        computedStatusColor: "neutral",
        delivered: 0,
      }),
    ])

    expect(result).toMatchObject({
      status: "solicitado",
      statusLabel: "Solicitado",
      statusColor: "neutral",
      statusCounts: { pedido_proveedor: 1, solicitado: 1 },
    })
  })

  it("considera entregada una solicitud cuando todas sus líneas aplicables lo están", () => {
    const result = computeAggregateStatus([
      row({ computedStatus: "entregado", delivered: 6, pendingTotal: 0 }),
      row({
        itemId: "item-2",
        computedStatus: "cancelado",
        computedStatusLabel: "Cancelado",
        computedStatusColor: "neutral",
        delivered: 0,
        pendingTotal: 0,
      }),
    ])

    expect(result).toMatchObject({
      status: "entregado",
      statusCounts: { entregado: 1, cancelado: 1 },
    })
  })
})
