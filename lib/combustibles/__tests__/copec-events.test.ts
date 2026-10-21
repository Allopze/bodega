import { describe, expect, it } from "vitest"
import { buildCopecTransactionRows, hasPossibleCopecCorrection } from "../copec-events"
import type { ParsedCopecTransaction } from "../consumption-import"

const event = (patch: Partial<ParsedCopecTransaction> = {}): ParsedCopecTransaction => ({
  rowIndex: 2,
  sourceRef: "GD-123",
  sourceDate: "2026-02-10",
  occurredAt: "2026-02-10T13:00:00.000Z",
  plate: "AA-BB11",
  cardNumber: "1001",
  product: "diesel",
  liters: 10.5,
  unitPrice: 900,
  amount: 9450,
  station: "Copec Norte",
  rawPayload: { "RUT Chofer": "removed-before-parser" },
  ...patch,
})

describe("buildCopecTransactionRows", () => {
  it("uses a deterministic synthetic identity and preserves the reported price and amount", () => {
    const [first] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event()])
    const [again] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event()])
    expect(first).toEqual(again)
    expect(first).toMatchObject({ externalId: null, accountKey: "tct:diesel", unitPrice: 900, amount: 9450, sourceDate: "2026-02-10" })
    expect(first?.sourceRowKey).toContain("guide:")
    expect(first?.sourceRowKey).not.toContain("GD-123")
  })

  it("keeps the TAE identity namespace separate from TCT", () => {
    const [row] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event()], "TAE")
    expect(row?.accountKey).toBe("tae:diesel")
  })

  it("keeps identical legitimate rows distinct by occurrence number", () => {
    const rows = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event(), event()])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.sourceRowKey).not.toBe(rows[1]?.sourceRowKey)
    expect(rows[0]?.sourceRowKey).toContain(":1")
    expect(rows[1]?.sourceRowKey).toContain(":2")
  })
})

describe("hasPossibleCopecCorrection", () => {
  it("flags changed data for a repeated guide or an indistinguishable no-guide event", () => {
    const [original] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event()])
    const [corrected] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event({ amount: 9500 })])
    expect(hasPossibleCopecCorrection(corrected!.sourceRowKey, [{ sourceRowKey: original!.sourceRowKey }])).toBe(true)

    const [withoutGuide] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event({ sourceRef: null })])
    const [withoutGuideCorrected] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event({ sourceRef: null, amount: 9500 })])
    expect(hasPossibleCopecCorrection(withoutGuideCorrected!.sourceRowKey, [{ sourceRowKey: withoutGuide!.sourceRowKey }])).toBe(true)
  })

  it("does not treat an identical re-download as a correction", () => {
    const [row] = buildCopecTransactionRows("2026-02-01", "2026-02-28", "diesel", [event()])
    expect(hasPossibleCopecCorrection(row!.sourceRowKey, [{ sourceRowKey: row!.sourceRowKey }])).toBe(false)
  })
})
