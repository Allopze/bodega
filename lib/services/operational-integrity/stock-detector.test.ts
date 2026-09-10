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
  /**
   * `stock_before`/`stock_after` son `real` (float4): su epsilon crece con la
   * magnitud, así que una tolerancia absoluta produce falsos positivos en
   * cuanto los saldos superan la decena.
   *
   * Números tomados de producción: 39,76 - 0,04 se guardó como 39,719997, que
   * difiere del 39,72 exacto en 3e-6 — por encima del 1e-6 absoluto anterior.
   */
  it("tolerates float4 rounding proportional to the balance magnitude", () => {
    const movimiento = {
      id: "r", worksiteId: "ws", productId: "p", type: "egreso_entrega",
      quantity: -0.04, stockBefore: 39.76, stockAfter: 39.719997,
      performedAt: "2026-04-01T00:00:00Z",
    }
    expect(detectStockIntegrity({ stocks: [{ ...stock, quantity: 39.719997 }], movements: [movimiento] })).toEqual([])
  })

  it("still reports a shortfall that exceeds float4 rounding", () => {
    const movimiento = {
      id: "r", worksiteId: "ws", productId: "p", type: "egreso_entrega",
      // Falta una unidad entera: ningún redondeo explica eso.
      quantity: -0.04, stockBefore: 39.76, stockAfter: 38.72,
      performedAt: "2026-04-01T00:00:00Z",
    }
    expect(detectStockIntegrity({ stocks: [{ ...stock, quantity: 38.72 }], movements: [movimiento] }))
      .toMatchObject([{ code: "STOCK_MOVEMENT_CHAIN_BREAK" }])
  })

  /**
   * Una regularización masiva inserta todos sus ajustes con el mismo
   * `performedAt`. Con instantes empatados el desempate por id es arbitrario y
   * no reconstruye el orden de aplicación real, así que exigir un orden
   * concreto reportaba saltos donde el kardex está sano.
   *
   * Caso tomado de producción (2026-08-31): 11 ajustes en un instante que
   * recorren 201,32 -> 134 sumando -67,32. Encadenan; no hay descuadre.
   */
  it("accepts a same-instant block whose balances chain in some order", () => {
    const instant = "2026-02-01T00:00:00Z"
    const block = [
      { id: "z", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -4, stockBefore: 10, stockAfter: 6, performedAt: instant },
      { id: "m", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -3, stockBefore: 6, stockAfter: 3, performedAt: instant },
      { id: "a", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -1, stockBefore: 3, stockAfter: 2, performedAt: instant },
    ]
    // Ordenado por id daría a(3->2), m(6->3), z(10->6): dos "saltos" falsos.
    expect(detectStockIntegrity({ stocks: [{ ...stock, quantity: 2 }], movements: block })).toEqual([])
  })

  it("still reports a same-instant block that does not chain", () => {
    const instant = "2026-02-01T00:00:00Z"
    const block = [
      { id: "a", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -4, stockBefore: 10, stockAfter: 6, performedAt: instant },
      // Hueco real: arranca en 5, no en 6, y nada explica la unidad perdida.
      { id: "b", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -3, stockBefore: 5, stockAfter: 2, performedAt: instant },
    ]
    expect(detectStockIntegrity({ stocks: [{ ...stock, quantity: 2 }], movements: block }))
      .toMatchObject([{ code: "STOCK_MOVEMENT_CHAIN_BREAK" }])
  })

  it("links a same-instant block to the movements around it", () => {
    const block = [
      { id: "a", worksiteId: "ws", productId: "p", type: "ingreso_oc", quantity: 10, stockBefore: 0, stockAfter: 10, performedAt: "2026-01-01T00:00:00Z" },
      { id: "b", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -2, stockBefore: 10, stockAfter: 8, performedAt: "2026-03-01T00:00:00Z" },
      { id: "c", worksiteId: "ws", productId: "p", type: "ajuste", quantity: -3, stockBefore: 8, stockAfter: 5, performedAt: "2026-03-01T00:00:00Z" },
    ]
    expect(detectStockIntegrity({ stocks: [{ ...stock, quantity: 5 }], movements: block })).toEqual([])

    // Y si el bloque no retoma donde quedó el movimiento anterior, sí se reporta.
    const desfasado = [block[0]!, { ...block[1]!, stockBefore: 9, stockAfter: 7 }, { ...block[2]!, stockBefore: 7, stockAfter: 4 }]
    expect(detectStockIntegrity({ stocks: [{ ...stock, quantity: 4 }], movements: desfasado }))
      .toMatchObject([{ code: "STOCK_MOVEMENT_CHAIN_BREAK" }])
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
