import { describe, expect, it } from "vitest"
import {
  computeItemStatus,
  computePendingBreakdown,
  effectiveRequestedQty,
  isComputedStatus,
  normalizeTraceabilityDateParam,
  buildConsolidatedRows,
  attachTimelines,
  computeFaenaKPIs,
  applySecondaryFilters,
  type LinkedMaps,
  type RawItemRow,
  type ApprovalRow,
  type OcRow,
  type DeliveryRow,
} from "./trazabilidad-consolidated"

describe("computeItemStatus", () => {
  it("computes 'solicitado' when only request exists", () => {
    const status = computeItemStatus({
      itemStatus: "requested",
      requested: 20,
      approved: null,
      inOc: 0,
      receivedOffice: 0,
      dispatched: 0,
      receivedFaena: 0,
      delivered: 0,
    })
    expect(status).toBe("solicitado")
  })

  it("computes 'aprobado' when item is approved but not yet in OC", () => {
    const status = computeItemStatus({
      itemStatus: "approved",
      requested: 20,
      approved: 20,
      inOc: 0,
      receivedOffice: 0,
      dispatched: 0,
      receivedFaena: 0,
      delivered: 0,
    })
    expect(status).toBe("aprobado")
  })

  it("computes 'pedido_proveedor' when ordered in OC but nothing received yet", () => {
    const status = computeItemStatus({
      itemStatus: "in_purchase_order",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 0,
      dispatched: 0,
      receivedFaena: 0,
      delivered: 0,
    })
    expect(status).toBe("pedido_proveedor")
  })

  it("computes 'parcialmente_recibido_oficina' when part arrives at office", () => {
    const status = computeItemStatus({
      itemStatus: "partially_office_received",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 15,
      dispatched: 0,
      receivedFaena: 0,
      delivered: 0,
    })
    expect(status).toBe("parcialmente_recibido_oficina")
  })

  it("computes 'en_oficina' when fully arrived at office without dispatch", () => {
    const status = computeItemStatus({
      itemStatus: "office_received",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 20,
      dispatched: 0,
      receivedFaena: 0,
      delivered: 0,
    })
    expect(status).toBe("en_oficina")
  })

  it("computes 'parcialmente_enviado_faena' when partially dispatched to faena", () => {
    const status = computeItemStatus({
      itemStatus: "office_received",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 20,
      dispatched: 10,
      receivedFaena: 0,
      delivered: 0,
    })
    expect(status).toBe("parcialmente_enviado_faena")
  })

  it("computes 'en_faena' when goods arrived at faena", () => {
    const status = computeItemStatus({
      itemStatus: "received",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 20,
      dispatched: 20,
      receivedFaena: 20,
      delivered: 0,
    })
    expect(status).toBe("en_faena")
  })

  it("computes 'parcialmente_recibido_faena' when partially received at faena", () => {
    const status = computeItemStatus({
      itemStatus: "partially_received",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 20,
      dispatched: 20,
      receivedFaena: 10,
      delivered: 0,
    })
    expect(status).toBe("parcialmente_recibido_faena")
  })

  it("computes 'parcialmente_entregado' when delivered to workers partially", () => {
    const status = computeItemStatus({
      itemStatus: "partially_delivered",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 20,
      dispatched: 20,
      receivedFaena: 20,
      delivered: 6,
    })
    expect(status).toBe("parcialmente_entregado")
  })

  it("computes 'entregado' when fully delivered", () => {
    const status = computeItemStatus({
      itemStatus: "delivered",
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 20,
      dispatched: 20,
      receivedFaena: 20,
      delivered: 20,
    })
    expect(status).toBe("entregado")
  })

  it("handles rejected and cancelled items", () => {
    expect(
      computeItemStatus({
        itemStatus: "rejected",
        requested: 10,
        approved: null,
        inOc: 0,
        receivedOffice: 0,
        dispatched: 0,
        receivedFaena: 0,
        delivered: 0,
      }),
    ).toBe("rechazado")

    expect(
      computeItemStatus({
        itemStatus: "cancelled",
        requested: 10,
        approved: null,
        inOc: 0,
        receivedOffice: 0,
        dispatched: 0,
        receivedFaena: 0,
        delivered: 0,
      }),
    ).toBe("cancelado")
  })
})

describe("computePendingBreakdown", () => {
  it("calculates pending units by stage accurately as specified by user prompt", () => {
    // Solicitado: 20, Pedido: 20, Recibido oficina: 15, Enviado faena: 10, Faena recibe: 10, Entregado: 6
    // Stock en faena: 4 (10 - 6), En oficina: 5 (15 - 10), Pendiente proveedor: 5 (20 - 15)
    const breakdown = computePendingBreakdown({
      requested: 20,
      approved: 20,
      inOc: 20,
      receivedOffice: 15,
      dispatched: 10,
      receivedFaena: 10,
      delivered: 6,
    })

    expect(breakdown.pendingTotal).toBe(14) // 20 - 6
    expect(breakdown.pendingFromSupplier).toBe(5) // 20 - 15
    expect(breakdown.inOffice).toBe(5) // 15 - 10
    expect(breakdown.inTransit).toBe(0) // 10 - 10
    expect(breakdown.inFaenaAvailable).toBe(4) // 10 - 6
    expect(breakdown.notYetOrdered).toBe(0) // 20 - 20
  })

  it("calculates pending when purchase is not yet made", () => {
    const breakdown = computePendingBreakdown({
      requested: 50,
      approved: 50,
      inOc: 20,
      receivedOffice: 0,
      dispatched: 0,
      receivedFaena: 0,
      delivered: 0,
    })

    expect(breakdown.pendingTotal).toBe(50)
    expect(breakdown.notYetOrdered).toBe(30)
    expect(breakdown.pendingFromSupplier).toBe(20)
    expect(breakdown.inOffice).toBe(0)
    expect(breakdown.inTransit).toBe(0)
    expect(breakdown.inFaenaAvailable).toBe(0)
  })

  it("calculates inTransit when GDI is dispatched but not confirmed at faena", () => {
    const breakdown = computePendingBreakdown({
      requested: 100,
      approved: 100,
      inOc: 100,
      receivedOffice: 80,
      dispatched: 60,
      receivedFaena: 40,
      delivered: 20,
    })

    expect(breakdown.pendingTotal).toBe(80) // 100 - 20
    expect(breakdown.notYetOrdered).toBe(0)
    expect(breakdown.pendingFromSupplier).toBe(20) // 100 - 80 = 20
    expect(breakdown.inOffice).toBe(20) // 80 - 60
    expect(breakdown.inTransit).toBe(20) // 60 - 40
    expect(breakdown.inFaenaAvailable).toBe(20) // 40 - 20
  })
})

/* ── Cierre medido contra lo aprobado ─────────────────────────────────────── */

describe("cantidad comprometida", () => {
  it("un ítem aprobado con cantidad recortada se cierra al entregar lo aprobado", () => {
    // Piden 10, aprueban 6, se entregan las 6. Medido contra `requested` el
    // ítem quedaba "parcialmente entregado" para siempre, con 4 unidades
    // pendientes que nadie iba a comprar nunca.
    const status = computeItemStatus({
      itemStatus: "partially_delivered",
      requested: 10,
      approved: 6,
      inOc: 6,
      receivedOffice: 6,
      dispatched: 6,
      receivedFaena: 6,
      delivered: 6,
    })

    expect(status).toBe("entregado")
  })

  it("el saldo por entregar también se mide contra lo aprobado", () => {
    const breakdown = computePendingBreakdown({
      requested: 10,
      approved: 6,
      inOc: 6,
      receivedOffice: 6,
      dispatched: 6,
      receivedFaena: 6,
      delivered: 6,
    })

    // `pendingTotal` usaba `requested` mientras `notYetOrdered` ya usaba lo
    // aprobado: las dos mitades del mismo desglose no cuadraban.
    expect(breakdown.pendingTotal).toBe(0)
    expect(breakdown.notYetOrdered).toBe(0)
  })

  it("sin aprobación la referencia sigue siendo lo solicitado", () => {
    expect(effectiveRequestedQty(10, null)).toBe(10)
    expect(effectiveRequestedQty(10, 6)).toBe(6)
    expect(effectiveRequestedQty(10, 0)).toBe(0)
  })
})

/* ── Normalización de parámetros ──────────────────────────────────────────── */

describe("normalizeTraceabilityDateParam", () => {
  it("acepta una fecha ISO de día completo", () => {
    expect(normalizeTraceabilityDateParam("2026-09-04")).toBe("2026-09-04")
  })

  it("descarta lo que Postgres rechazaría como timestamp", () => {
    // La fecha se interpola como literal en el WHERE: un valor inválido no
    // era un filtro raro, era un 500 en toda la pantalla.
    expect(normalizeTraceabilityDateParam("ayer")).toBe("")
    expect(normalizeTraceabilityDateParam("2026-9-4")).toBe("")
    expect(normalizeTraceabilityDateParam("2026-09-04T00:00:00Z")).toBe("")
    expect(normalizeTraceabilityDateParam(undefined)).toBe("")
    expect(normalizeTraceabilityDateParam(["2026-09-04", "otra"])).toBe("2026-09-04")
  })

  it("descarta días que no existen aunque parseen", () => {
    // `new Date("2026-02-31")` no falla: rueda al 3 de marzo.
    expect(normalizeTraceabilityDateParam("2026-02-31")).toBe("")
    expect(normalizeTraceabilityDateParam("2026-13-01")).toBe("")
  })
})

describe("isComputedStatus", () => {
  it("reconoce los estados calculados y rechaza el resto", () => {
    expect(isComputedStatus("entregado")).toBe(true)
    expect(isComputedStatus("parcialmente_entregado")).toBe(true)
    // Un `?estado=` inventado dejaba la tabla vacía como si la faena no
    // tuviera nada, en vez de ignorarse.
    expect(isComputedStatus("inventado")).toBe(false)
    expect(isComputedStatus("")).toBe(false)
    expect(isComputedStatus("toString")).toBe(false)
  })
})

/* ── Agregación por ítem ──────────────────────────────────────────────────── */

function rawItem(overrides: Partial<RawItemRow> = {}): RawItemRow {
  return {
    itemId: "item-1",
    requestId: "req-1",
    requestCode: "SOL-0001",
    requestStatus: "approved",
    requestDate: "2026-08-01T12:00:00.000Z",
    requesterId: "u-1",
    requesterName: "Ana Solicitante",
    deliveryMode: "via_oficina",
    urgency: null,
    productId: "prod-1",
    productNameCatalog: "Bota de seguridad",
    productNameFree: null,
    productSku: "BOTA-01",
    categoryId: "cat-1",
    categoryName: "Calzado",
    notes: null,
    uom: "par",
    quantity: 10,
    status: "approved",
    updatedAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  }
}

function approval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "dec-1",
    requestItemId: "item-1",
    type: "approve",
    decidedAt: "2026-08-02T12:00:00.000Z",
    decidedByName: "Jefa Chome",
    reason: "Autorizado",
    modifiedQty: null,
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
    sentAt: "2026-08-03T12:00:00.000Z",
    createdAt: "2026-08-03T12:00:00.000Z",
    supplierId: "sup-1",
    supplierName: "Proveedor Uno",
    quantity: 10,
    quantityOfficeReceived: 0,
    quantityReceived: 0,
    ...overrides,
  }
}

function delivery(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: "di-1",
    requestItemId: "item-1",
    deliveryId: "del-1",
    deliveryCode: "ENT-2026-0001",
    deliveredAt: "2026-08-10T12:00:00.000Z",
    deliveredByName: "Bodeguero",
    receiverName: "Cuadrilla",
    workerFirstName: null,
    workerLastName: null,
    quantity: 4,
    returnQuantity: null,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  }
}

function linkedMaps(parts: {
  approvals?: ApprovalRow[]
  ocs?: OcRow[]
  deliveries?: DeliveryRow[]
  stock?: Array<[string, number]>
} = {}): LinkedMaps {
  return {
    approvalsByItem: new Map(parts.approvals ? [["item-1", parts.approvals]] : []),
    ocsByItem: new Map(parts.ocs ? [["item-1", parts.ocs]] : []),
    deliveriesByItem: new Map(parts.deliveries ? [["item-1", parts.deliveries]] : []),
    receiptsByOcItem: new Map(),
    gdisByOcItem: new Map(),
    stockByProduct: new Map(parts.stock ?? []),
  }
}

describe("buildConsolidatedRows", () => {
  it("la cantidad aprobada la fija la última decisión, no la primera", () => {
    // Sin orden estable, un ítem con `modify` + `approve` tomaba la decisión
    // que Postgres devolviera primero y la cantidad cambiaba entre cargas.
    const rows = buildConsolidatedRows(
      [rawItem()],
      linkedMaps({
        approvals: [
          approval({ id: "dec-1", type: "modify", modifiedQty: 4, decidedAt: "2026-08-02T10:00:00.000Z" }),
          approval({ id: "dec-2", type: "modify", modifiedQty: 7, decidedAt: "2026-08-02T18:00:00.000Z" }),
        ],
      }),
      "ws-1",
      "Faena Uno",
    )

    expect(rows[0]?.approved).toBe(7)
  })

  it("una aprobación posterior sin ajuste vuelve a la cantidad pedida", () => {
    const rows = buildConsolidatedRows(
      [rawItem()],
      linkedMaps({
        approvals: [
          approval({ id: "dec-1", type: "modify", modifiedQty: 4, decidedAt: "2026-08-02T10:00:00.000Z" }),
          approval({ id: "dec-2", type: "approve", modifiedQty: null, decidedAt: "2026-08-02T18:00:00.000Z" }),
        ],
      }),
      "ws-1",
      "Faena Uno",
    )

    expect(rows[0]?.approved).toBe(10)
  })

  it("una entrega anulada no suma en entregado", () => {
    const rows = buildConsolidatedRows(
      [rawItem()],
      linkedMaps({
        deliveries: [
          delivery({ id: "di-ok", quantity: 4 }),
          delivery({
            id: "di-void",
            quantity: 6,
            voidedAt: "2026-08-11T12:00:00.000Z",
            voidReason: "Anulada por error de digitación",
          }),
        ],
      }),
      "ws-1",
      "Faena Uno",
    )

    // Contándola, `delivered` daba 10 y el ítem salía "Entregado" con 6 pares
    // todavía en la faena.
    expect(rows[0]?.delivered).toBe(4)
    expect(rows[0]?.computedStatus).toBe("parcialmente_entregado")
    expect(rows[0]?.pendingTotal).toBe(6)
  })

  it("no alerta por comprar en un ítem servido desde el stock de la faena", () => {
    // `inOc < approved` a secas encendía el ámbar en todo ítem que nunca pasó
    // por una OC, incluso ya entregado completo.
    const rows = buildConsolidatedRows(
      [rawItem({ status: "delivered" })],
      linkedMaps({ deliveries: [delivery({ quantity: 10 })] }),
      "ws-1",
      "Faena Uno",
    )

    expect(rows[0]?.computedStatus).toBe("entregado")
    expect(rows[0]?.alert).toBe(false)
  })

  it("no alerta en ítems rechazados ni cancelados", () => {
    const rejected = buildConsolidatedRows(
      [rawItem({ status: "rejected" })],
      linkedMaps(),
      "ws-1",
      "Faena Uno",
    )
    const cancelled = buildConsolidatedRows(
      [rawItem({ status: "cancelled" })],
      linkedMaps(),
      "ws-1",
      "Faena Uno",
    )

    expect(rejected[0]?.alert).toBe(false)
    expect(cancelled[0]?.alert).toBe(false)
  })

  it("alerta cuando quedan unidades aprobadas sin comprar", () => {
    const rows = buildConsolidatedRows(
      [rawItem({ status: "pending_purchase" })],
      linkedMaps({ ocs: [oc({ quantity: 6 })] }),
      "ws-1",
      "Faena Uno",
    )

    expect(rows[0]?.alert).toBe(true)
    expect(rows[0]?.pendingBreakdown.notYetOrdered).toBe(4)
  })

  it("no arma el historial: se cuelga después, sobre la página visible", () => {
    // Construirlo acá lo armaba para todos los ítems de la faena para después
    // quedarse con 25 en el `slice()` de la paginación.
    const maps = linkedMaps({ deliveries: [delivery()] })
    const rows = buildConsolidatedRows([rawItem()], maps, "ws-1", "Faena Uno")

    expect(rows[0]?.timeline).toEqual([])

    const withTimeline = attachTimelines(rows, maps)
    expect(withTimeline[0]?.timeline.length).toBeGreaterThan(0)
    // La entrega enlaza a su comprobante, no al listado de entregas.
    expect(withTimeline[0]?.timeline.find((e) => e.type === "delivery")?.href)
      .toBe("/entregas/del-1/print")
  })

  it("marca los movimientos anulados en el historial en vez de esconderlos", () => {
    const maps = linkedMaps({
      deliveries: [delivery({ voidedAt: "2026-08-11T12:00:00.000Z", voidReason: "Error de digitación" })],
    })
    const rows = attachTimelines(buildConsolidatedRows([rawItem()], maps, "ws-1", "Faena Uno"), maps)

    const event = rows[0]?.timeline.find((e) => e.type === "delivery")
    expect(event?.voided).toBe(true)
    expect(event?.title).toContain("anulada")
    expect(event?.description).toContain("Error de digitación")
  })
})

/* ── Filtros secundarios y KPIs ───────────────────────────────────────────── */

describe("applySecondaryFilters", () => {
  const rows = buildConsolidatedRows(
    [
      rawItem({ itemId: "item-1", categoryId: "cat-1", productNameCatalog: "Bota de seguridad" }),
      rawItem({ itemId: "item-2", categoryId: "cat-2", productNameCatalog: "Casco dieléctrico" }),
    ],
    linkedMaps(),
    "ws-1",
    "Faena Uno",
  )

  const noFilters = {
    filterEstado: "",
    filterCategoria: "",
    filterProveedor: "",
    filterPendientes: false,
    filterQ: "",
    ocsByItem: new Map<string, OcRow[]>(),
  }

  it("filtra por categoría con el id que viaja en la fila", () => {
    const filtered = applySecondaryFilters(rows, { ...noFilters, filterCategoria: "cat-2" })
    expect(filtered.map((r) => r.itemId)).toEqual(["item-2"])
  })

  it("ignora un estado inválido en vez de vaciar la tabla", () => {
    const filtered = applySecondaryFilters(rows, { ...noFilters, filterEstado: "inventado" })
    expect(filtered).toHaveLength(2)
  })

  it("aplica un estado válido", () => {
    const filtered = applySecondaryFilters(rows, { ...noFilters, filterEstado: "entregado" })
    expect(filtered).toHaveLength(0)
  })

  it("busca en código, producto y SKU", () => {
    expect(applySecondaryFilters(rows, { ...noFilters, filterQ: "casco" }).map((r) => r.itemId))
      .toEqual(["item-2"])
    expect(applySecondaryFilters(rows, { ...noFilters, filterQ: "BOTA-01" })).toHaveLength(2)
  })
})

describe("computeFaenaKPIs", () => {
  it("cuenta sobre las filas que recibe, que son las ya filtradas", () => {
    const rows = buildConsolidatedRows(
      [
        rawItem({ itemId: "item-1", status: "delivered" }),
        rawItem({ itemId: "item-2", status: "pending_purchase" }),
      ],
      {
        ...linkedMaps(),
        deliveriesByItem: new Map([["item-1", [delivery({ quantity: 10 })]]]),
      },
      "ws-1",
      "Faena Uno",
    )

    const all = computeFaenaKPIs(rows)
    expect(all.fullyDelivered).toBe(1)
    expect(all.pendingPurchase).toBe(1)

    // Calcularlos antes de los filtros dejaba "Sin resultados" encima de
    // siete tarjetas con números.
    const onlyDelivered = computeFaenaKPIs(rows.filter((r) => r.computedStatus === "entregado"))
    expect(onlyDelivered.fullyDelivered).toBe(1)
    expect(onlyDelivered.pendingPurchase).toBe(0)
    expect(onlyDelivered.openRequests).toBe(0)
  })
})
