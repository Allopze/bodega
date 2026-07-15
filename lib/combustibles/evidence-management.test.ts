import { describe, it, expect, vi } from "vitest"

const mockRecordAudit = vi.hoisted(() => vi.fn())
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

const { logEvidenceAccess } = await import("./evidence-management")

/** Sección 19 — "Auditoría de evidencias": logEvidenceAccess no tenía prueba propia. */
describe("logEvidenceAccess", () => {
  it("registra el acceso con el actor, la evidencia y la acción (ver/descargar)", async () => {
    await logEvidenceAccess("ev-1", "user-1", "view")
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "update",
        entityType: "fuel_tae_evidence",
        entityId: "ev-1",
        newState: { accessed: "view" },
      }),
    )
  })

  it("distingue ver de descargar en el motivo registrado", async () => {
    await logEvidenceAccess("ev-2", "user-2", "download")
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining("download"), newState: { accessed: "download" } }),
    )
  })
})
