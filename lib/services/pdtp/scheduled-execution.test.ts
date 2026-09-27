import { describe, expect, it } from "vitest"
import { assertPdtpScheduledInstanceTransition, assertPdtpScheduledOutcomeReason, pdtpScheduledExecutionStartIdempotencyKey, resolvePdtpScheduledInstrument } from "@/lib/services/pdtp/scheduled-execution"

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

  // PREV-C07: el "No aplica" de una instancia exige el mismo motivo que el de
  // una celda (10 caracteres). Con 3 bastaba un "n/a".
  it("el 'No aplica' de una instancia exige un motivo de al menos 10 caracteres", () => {
    expect(() => assertPdtpScheduledOutcomeReason("not_applicable", "n/a")).toThrow(/10 caracteres/)
    expect(() => assertPdtpScheduledOutcomeReason("not_applicable", "  corto   ")).toThrow(/10 caracteres/)
    expect(() => assertPdtpScheduledOutcomeReason("not_applicable", null)).toThrow(/no aplica/)
    expect(assertPdtpScheduledOutcomeReason("not_applicable", " La faena estuvo detenida ")).toBe("La faena estuvo detenida")
    expect(assertPdtpScheduledOutcomeReason("completed", null)).toBeNull()
  })
})

// PREV-I08-c/e (D19): el estado de una ocurrencia enlazada sale del estado de
// su ejecución en el libro, nunca de metadatos que manda un cliente.
describe("pdtpScheduledInstanceStatusForExecution", () => {
  it("aprobada completa, enviada queda enviada, y lo demás vuelve a trabajo abierto", async () => {
    const { pdtpScheduledInstanceStatusForExecution } = await import("@/lib/services/pdtp/scheduled-execution")
    expect(pdtpScheduledInstanceStatusForExecution({ executionStatus: "approved", startedAt: null })).toBe("completed")
    expect(pdtpScheduledInstanceStatusForExecution({ executionStatus: "submitted", startedAt: null })).toBe("submitted")
    expect(pdtpScheduledInstanceStatusForExecution({ executionStatus: "rejected", startedAt: "2026-03-01T10:00:00.000Z" })).toBe("in_progress")
    expect(pdtpScheduledInstanceStatusForExecution({ executionStatus: "draft", startedAt: null })).toBe("pending")
  })

  it("la vía manual ya no completa una ocurrencia: se completa al aprobar su ejecución", async () => {
    const { assertPdtpScheduledInstanceManualAction } = await import("@/lib/services/pdtp/scheduled-execution")
    expect(() => assertPdtpScheduledInstanceManualAction("complete")).toThrow(/aprobar/i)
    for (const action of ["submit", "not_applicable", "cancel"] as const) {
      expect(() => assertPdtpScheduledInstanceManualAction(action)).not.toThrow()
    }
  })
})
