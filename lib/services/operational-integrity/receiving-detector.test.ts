import { describe, expect, it } from "vitest"
import { detectReceivingIntegrity } from "./receiving-detector"

const line = { id: "line", purchaseOrderId: "po", worksiteId: "ws", quantity: 10, deliveryMode: "via_oficina" }
const office = { id: "r1", receiptId: "receipt1", purchaseOrderItemId: "line", locationType: "office", quantityReceived: 6, quantityRejected: 2, quantityDamaged: 2 }
const faena = { ...office, id: "r2", receiptId: "receipt2", locationType: "faena", quantityReceived: 6, quantityRejected: 0, quantityDamaged: 0 }
describe("receiving integrity detector", () => {
  it("separates office disposition from final receipt", () => {
    expect(detectReceivingIntegrity({ orderItems: [line], receipts: [office, faena] })).toEqual([])
  })
  it("caps via-office faena disposition by accepted office units", () => {
    expect(detectReceivingIntegrity({ orderItems: [line], receipts: [office, { ...faena, quantityDamaged: 1 }] })).toMatchObject([{ code: "RECEIPT_DISPOSITION_EXCEEDS_LIMIT", severity: "high", entityId: "receipt2" }])
  })
  it.each(["office", "faena"])("sums accepted rejected damaged across receipts at %s", locationType => {
    const findings = detectReceivingIntegrity({ orderItems: [{ ...line, deliveryMode: "directo_faena" }], receipts: [{ ...office, locationType }, { ...faena, locationType, quantityReceived: 1 }] })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.snapshot).toMatchObject({ limit: 10, disposed: 11 })
  })
  it("keeps fingerprint and case identity stable under row reordering", () => {
    const receipts = [office, { ...faena, quantityReceived: 7 }]
    expect(detectReceivingIntegrity({ orderItems: [line], receipts })).toEqual(detectReceivingIntegrity({ orderItems: [line], receipts: receipts.reverse() }))
  })
})
