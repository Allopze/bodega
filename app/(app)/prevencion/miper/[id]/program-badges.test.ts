import { describe, expect, it } from "vitest"
import type { ProgramOccurrenceView } from "@/lib/services/miper/program-queries"
import { occurrenceBadge, recordBadge } from "./program-badges"

const occurrence = (patch: Partial<ProgramOccurrenceView>): ProgramOccurrenceView => ({
  id: "o1", dueOn: "2026-05-10", outcome: "pending", late: false, effectiveOn: null, reason: null, evidenceCount: 0, ...patch,
})

describe("program-badges", () => {
  it("pendiente vencida = Vencida", () => {
    expect(occurrenceBadge(occurrence({}), "2026-06-01").label).toBe("Vencida")
    expect(occurrenceBadge(occurrence({}), "2026-05-01").label).toBe("Pendiente")
  })

  it("hecha fuera de plazo = Fuera de plazo", () => {
    expect(occurrenceBadge(occurrence({ outcome: "done", late: true }), "2026-06-01").label).toBe("Fuera de plazo")
    expect(occurrenceBadge(occurrence({ outcome: "done" }), "2026-06-01").label).toBe("Realizada")
  })

  it("reemplazada = Reemplazada", () => {
    expect(occurrenceBadge(occurrence({ outcome: "superseded" }), "2026-06-01").label).toBe("Reemplazada")
  })

  it("registro anulado = Anulado", () => {
    expect(recordBadge({ outcome: "done", voidedAt: "2026-05-11T10:00:00Z" }).label).toBe("Anulado")
    expect(recordBadge({ outcome: "not_done", voidedAt: null }).label).toBe("No se hizo")
  })
})
