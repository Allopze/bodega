import { describe, expect, it } from "vitest"
import { assertPdtpScheduledInstanceTransition, pdtpScheduledExecutionStartIdempotencyKey, resolvePdtpScheduledInstrument } from "@/lib/services/pdtp/scheduled-execution"

describe("scheduled execution start", () => {
  it("is stable for one instance, connector and instrument", () => {
    expect(pdtpScheduledExecutionStartIdempotencyKey("instance-1", "inspections", "template-7"))
      .toBe("pdtp-start:instance-1:inspections:template-7")
    expect(pdtpScheduledExecutionStartIdempotencyKey("instance-1", "inspections", null))
      .toBe("pdtp-start:instance-1:inspections:none")
  })

  it("allows execution outcomes once and preserves terminal history", () => {
    expect(assertPdtpScheduledInstanceTransition("pending", "submit")).toBe("submitted")
    expect(assertPdtpScheduledInstanceTransition("in_progress", "complete")).toBe("completed")
    expect(assertPdtpScheduledInstanceTransition("submitted", "complete")).toBe("completed")
    expect(assertPdtpScheduledInstanceTransition("completed", "complete")).toBe("completed")
    expect(() => assertPdtpScheduledInstanceTransition("completed", "cancel")).toThrow(/terminal/i)
  })

  it("uses the configured instrument and rejects a forged context", () => {
    expect(resolvePdtpScheduledInstrument("binding-1", null)).toBe("binding-1")
    expect(resolvePdtpScheduledInstrument("binding-1", "binding-1")).toBe("binding-1")
    expect(() => resolvePdtpScheduledInstrument("binding-1", "binding-2")).toThrow(/instrumento/i)
    expect(() => resolvePdtpScheduledInstrument(null, "binding-1")).toThrow(/instrumento/i)
  })
})
