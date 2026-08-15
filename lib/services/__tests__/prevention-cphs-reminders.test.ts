import { describe, expect, it } from "vitest"
import { selectMandateWarningThreshold } from "@/lib/services/prevention-cphs-reminders"

describe("selectMandateWarningThreshold", () => {
  it.each([
    ["2026-10-01", 60],
    ["2026-09-10", 30],
    ["2026-08-20", 7],
    ["2026-11-01", null],
  ] as const)("para vencimiento %s usa el umbral %s", (mandateEndsOn, expected) => {
    expect(selectMandateWarningThreshold(mandateEndsOn, "2026-08-14")).toBe(expected)
  })
})
