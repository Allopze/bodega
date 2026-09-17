import { describe, expect, it } from "vitest"
import { PDTP_2026_OBJECTIVES, pdtpObjectiveForLegacyNumber } from "./objectives"

describe("objetivos 2026", () => {
  it("mapea los números del RE-36 a su objetivo", () => {
    expect(pdtpObjectiveForLegacyNumber(9)).toBe("1")
    expect(pdtpObjectiveForLegacyNumber(10)).toBe("2")
    expect(pdtpObjectiveForLegacyNumber(89)).toBe("8")
    expect(pdtpObjectiveForLegacyNumber(90)).toBeNull()
  })

  it("cubre 1..89 sin huecos ni solapes", () => {
    const covered = PDTP_2026_OBJECTIVES.flatMap((o) => Array.from({ length: o.to - o.from + 1 }, (_, i) => o.from + i))
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 89 }, (_, i) => i + 1))
  })

  it("tiene exactamente 8 objetivos con nombres no vacíos", () => {
    expect(PDTP_2026_OBJECTIVES).toHaveLength(8)
    for (const objective of PDTP_2026_OBJECTIVES) {
      expect(objective.name.trim().length).toBeGreaterThan(0)
      expect(objective.code.trim().length).toBeGreaterThan(0)
    }
  })
})
