import { describe, expect, it } from "vitest"
import { detectStockIntegrity } from "./stock-detector"

const stock = { worksiteId: "ws", productId: "p", quantity: 8 }
const movements = [
  { id: "a", worksiteId: "ws", productId: "p", type: "ingreso_oc", quantity: 10, stockBefore: 0, stockAfter: 10, performedAt: "2026-01-01T00:00:00Z" },
  { id: "b", worksiteId: "ws", productId: "p", type: "egreso_entrega", quantity: -2, stockBefore: 10, stockAfter: 8, performedAt: "2026-01-01T00:00:00Z" },
]
describe("stock integrity detector", () => {
  it("accepts a chain ordered by timestamp and id regardless of query order", () => {
    expect(detectStockIntegrity({ stocks: [stock], movements: [...movements].reverse() })).toEqual([])
  })
  it("accepts positive audit-only EPP retirement without reducing stock", () => {
    expect(detectStockIntegrity({ stocks: [stock], movements: [...movements, { ...movements[1]!, id: "c", type: "retiro_epp_trabajador", quantity: 2, stockBefore: 8 }] })).toEqual([])
  })
  it("allows retirement at zero when applyMovementTx has no materialized stock row", () => {
    expect(detectStockIntegrity({ stocks: [], movements: [{ ...movements[0]!, type: "retiro_epp_trabajador", quantity: 1, stockBefore: 0, stockAfter: 0 }] })).toEqual([])
  })
  it.each([
    { stockBefore: 11, stockAfter: 9 },
    { stockBefore: 10, stockAfter: 9 },
  ])("detects arithmetic or continuity corruption %j", change => {
    const findings = detectStockIntegrity({ stocks: [{ ...stock, quantity: 9 }], movements: [movements[0]!, { ...movements[1]!, ...change }] })
    expect(findings).toMatchObject([{ code: "STOCK_MOVEMENT_CHAIN_BREAK", severity: "critical", worksiteId: "ws" }])
  })
  it("compares last balance to materialized stock with stable evidence", () => {
    const input = { stocks: [{ ...stock, quantity: 7 }], movements }
    const [finding] = detectStockIntegrity(input)
    expect(finding).toMatchObject({ code: "STOCK_BALANCE_MISMATCH", severity: "critical" })
    expect(finding!.fingerprint).toMatch(/^v1:[a-f0-9]{64}$/)
    expect(detectStockIntegrity({ ...input, movements: [...movements].reverse() })[0]!.fingerprint).toBe(finding!.fingerprint)
    expect(detectStockIntegrity({ ...input, stocks: [{ ...stock, quantity: 6 }] })[0]!.fingerprint).not.toBe(finding!.fingerprint)
  })
  it("detects missing materialized rows and keeps variants separate", () => {
    expect(detectStockIntegrity({ stocks: [{ ...stock, productId: "other" }], movements })).toMatchObject([{ code: "STOCK_BALANCE_MISMATCH", entityId: "p" }])
    expect(detectStockIntegrity({ stocks: [stock], movements: [] })).toEqual([])
  })
})
