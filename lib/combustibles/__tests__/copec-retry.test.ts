import { describe, expect, it, vi } from "vitest"
import { isRetryableCopecFailure, retryCopecRequest, CopecReportFailure, CopecReportTimeoutFailure } from "../copec-reports"

describe("reintentos acotados de consultas Copec", () => {
  it("reintenta una falla temporal de red una vez", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new CopecReportFailure("network", "Error temporal"))
      .mockResolvedValueOnce("archivo")

    await expect(retryCopecRequest(operation, isRetryableCopecFailure, async () => {})).resolves.toBe("archivo")
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([
    "provider_limit",
    "provider_rejected",
    "invalid_file",
  ] as const)("no reintenta el fallo %s", async (kind) => {
    const operation = vi.fn().mockRejectedValue(new CopecReportFailure(kind, "Fallo permanente"))

    await expect(retryCopecRequest(operation, isRetryableCopecFailure, async () => {})).rejects.toMatchObject({ kind })
    expect(operation).toHaveBeenCalledOnce()
  })

  it("no reintenta un timeout de generación: otra espera completa no cabe en el plazo", async () => {
    const operation = vi.fn().mockRejectedValue(new CopecReportTimeoutFailure("Copec demoró demasiado"))

    await expect(retryCopecRequest(operation, isRetryableCopecFailure, async () => {})).rejects.toMatchObject({ kind: "network" })
    expect(operation).toHaveBeenCalledOnce()
  })
})
