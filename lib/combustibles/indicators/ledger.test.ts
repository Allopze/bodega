import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"

const getFuelMonthlyTrend = vi.fn()
vi.mock("@/lib/services/dashboard-fuel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/dashboard-fuel")>()
  return { ...original, getFuelMonthlyTrend }
})

const { getLedgerTrend, ledgerReferenceInstant } = await import("./ledger")

const session = { user: { id: "u", permissions: ["combustibles:view"] } } as unknown as Session

beforeEach(() => getFuelMonthlyTrend.mockReset())

describe("getLedgerTrend", () => {
  it("corre la ventana al mes final: pide el libro con un instante a mitad de ese mes (hora de Chile)", async () => {
    getFuelMonthlyTrend.mockResolvedValue([])
    await getLedgerTrend(session, { lastMonth: "2026-08", months: 6, worksiteId: "w1", today: "2026-11-13" })
    const [, months, worksiteId, now] = getFuelMonthlyTrend.mock.calls[0] as [Session, number, string, Date]
    expect(months).toBe(6)
    expect(worksiteId).toBe("w1")
    // Mediodía chileno del 15 de agosto: el mes civil es agosto.
    expect(now.toISOString()).toBe("2026-08-15T15:00:00.000Z")
    expect(ledgerReferenceInstant("2026-08").toISOString()).toBe("2026-08-15T15:00:00.000Z")
  })

  it("recalcula «parcial» con el día de hoy real, no con el instante simulado", async () => {
    // La consulta, llamada con un 15 de octubre simulado, marca octubre como parcial; hoy es 13 de noviembre.
    getFuelMonthlyTrend.mockResolvedValue([
      { month: "Oct", monthKey: "2026-10", liters: 10, amount: 1, loads: 1, providerGap: false, partial: true },
      { month: "Nov", monthKey: "2026-11", liters: 5, amount: 1, loads: 1, providerGap: false, partial: false },
    ])
    const points = await getLedgerTrend(session, { lastMonth: "2026-11", months: 2, today: "2026-11-13" })
    expect(points.map((point) => [point.monthKey, point.partial])).toEqual([["2026-10", false], ["2026-11", true]])
  })

  it("acota la ventana a 36 meses y a al menos uno", async () => {
    getFuelMonthlyTrend.mockResolvedValue([])
    await getLedgerTrend(session, { lastMonth: "2026-10", months: 120, today: "2026-11-13" })
    await getLedgerTrend(session, { lastMonth: "2026-10", months: 0, today: "2026-11-13" })
    expect(getFuelMonthlyTrend.mock.calls.map((call) => call[1])).toEqual([36, 1])
  })
})
