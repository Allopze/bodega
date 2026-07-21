import { beforeEach, describe, expect, it, vi } from "vitest"

const transaction = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: { transaction },
}))

import { closeSafetyIndicatorPeriod } from "@/lib/services/prevention-indicadores"

describe("closeSafetyIndicatorPeriod definitive gates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("requires an auditable close reason before opening a transaction", async () => {
    await expect(closeSafetyIndicatorPeriod(
      { worksiteId: "ws-1", year: 2026, month: 7, reason: "breve" },
      "user-1",
      { mode: "all", ids: [] },
    )).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  })

  it("rejects a foreign worksite before opening a transaction", async () => {
    await expect(closeSafetyIndicatorPeriod(
      {
        worksiteId: "ws-foreign",
        year: 2026,
        month: 7,
        reason: "Cierre conciliado con evidencia aprobada.",
      },
      "user-1",
      { mode: "some", ids: ["ws-own"] },
    )).rejects.toThrow(/no encontrada o sin acceso/i)
    expect(transaction).not.toHaveBeenCalled()
  })
})
