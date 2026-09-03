import { describe, expect, it } from "vitest"
import {
  computeItemStatus,
  computePendingBreakdown,
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
