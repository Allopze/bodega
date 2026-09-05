import { describe, expect, it } from "vitest"
import { detectTraceabilityIntegrity } from "./traceability-integrity"

describe("detectTraceabilityIntegrity", () => {
  const base = {
    requestItemId: "item-1",
    requestCode: "SOL-001",
    worksiteId: "faena-1",
    deliveryMode: "via_oficina" as const,
    orderedQuantity: 5,
    cancelledOrderedQuantity: 0,
  }

  it("does not count an office receipt as stock available at the worksite", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        receipts: [{ quantityReceived: 5, locationType: "office", worksiteId: null, receivedAt: "2026-08-01T10:00:00Z" }],
        deliveries: [{ quantity: 1, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    expect(findings).toMatchObject([{ code: "DELIVERY_EXCEEDS_FAENA_RECEIPT", requestItemId: "item-1" }])
  })

  it("flags only the excess of traced deliveries over a partial faena receipt", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        receipts: [{ quantityReceived: 3, locationType: "faena", worksiteId: "faena-1", receivedAt: "2026-08-01T10:00:00Z" }],
        deliveries: [{ quantity: 4, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    expect(findings).toMatchObject([{ code: "DELIVERY_EXCEEDS_FAENA_RECEIPT", excessQuantity: 1 }])
  })

  it("preserves a chronological exception even if a later receipt balances the total", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        deliveryMode: "directo_faena",
        receipts: [{ quantityReceived: 2, locationType: "faena", worksiteId: "faena-1", receivedAt: "2026-08-03T10:00:00Z" }],
        deliveries: [{ quantity: 2, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    expect(findings).toMatchObject([{ code: "DELIVERY_BEFORE_FAENA_RECEIPT", requestItemId: "item-1" }])
  })

  it("does not treat rejected or damaged quantity as received stock, but retains it in the snapshot", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        receipts: [{
          quantityReceived: 0,
          quantityRejected: 2,
          quantityDamaged: 1,
          locationType: "faena",
          worksiteId: "faena-1",
          receivedAt: "2026-08-01T10:00:00Z",
        }],
        deliveries: [{ quantity: 1, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    expect(findings).toMatchObject([{
      code: "DELIVERY_EXCEEDS_FAENA_RECEIPT",
      snapshot: { receivedAtFaena: 0, rejectedAtFaena: 2, damagedAtFaena: 1 },
    }])
  })

  it("keeps a cancelled purchase order as context instead of creating a third defect", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        cancelledOrderedQuantity: 5,
        receipts: [{ quantityReceived: 2, locationType: "faena", worksiteId: "faena-1", receivedAt: "2026-08-01T10:00:00Z" }],
        deliveries: [{ quantity: 2, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    expect(findings).toEqual([])
  })

  it("does not create findings for linked deliveries that remain within the received amount", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        receipts: [{ quantityReceived: 5, locationType: "faena", worksiteId: "faena-1", receivedAt: "2026-08-01T10:00:00Z" }],
        deliveries: [{ quantity: 2, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    expect(findings).toEqual([])
  })

  // TR-06 (auditoría 2026-09-05): el detector comparaba totales históricos
  // (Σ recibidos vs Σ entregados). Una recepción posterior equilibraba el
  // total y tapaba el déficit intermedio: recibir 5 el día 1, entregar 10 el
  // día 2 —cuando sólo había 5 en faena— y recibir otros 5 el día 3 no
  // generaba ninguna excepción, aunque al entregar faltaban 5. El saldo debe
  // comprobarse en cada salida, conservando la excepción aunque después se
  // equilibre.
  it("preserves an intermediate deficit even when a later receipt balances the total (TR-06)", () => {
    const findings = detectTraceabilityIntegrity({
      items: [{
        ...base,
        receipts: [
          { quantityReceived: 5, locationType: "faena", worksiteId: "faena-1", receivedAt: "2026-08-01T10:00:00Z" },
          { quantityReceived: 5, locationType: "faena", worksiteId: "faena-1", receivedAt: "2026-08-03T10:00:00Z" },
        ],
        deliveries: [{ quantity: 10, deliveredAt: "2026-08-02T10:00:00Z" }],
      }],
    })

    // Σ recibidos = 10 y Σ entregados = 10, pero al entregar el día 2 el saldo
    // acumulado era 5: hay un exceso intermedio de 5 que el total esconde.
    expect(findings).toMatchObject([{
      code: "DELIVERY_EXCEEDS_FAENA_RECEIPT",
      requestItemId: "item-1",
      excessQuantity: 5,
    }])
  })
})
