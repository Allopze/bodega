import { describe, expect, it, vi } from "vitest"
import { isRetryableCopecFailure, retryCopecRequest, CopecReportFailure, CopecReportTimeoutFailure, withCopecExportDeadline } from "../copec-reports"

describe("reintentos acotados de exportación Copec", () => {
  it("reintenta una falla temporal de red una vez", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new CopecReportFailure("network", "Error temporal"))
      .mockResolvedValueOnce("archivo")

    await expect(retryCopecRequest(operation, isRetryableCopecFailure, async () => {})).resolves.toBe("archivo")
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([
    "session_expired",
    "selector_changed",
    "provider_limit",
    "provider_rejected",
    "invalid_file",
    "report_unavailable",
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

describe("plazo de la exportación Copec", () => {
  it("vence con una falla tipada, no con un Error plano que aborte el período completo", async () => {
    // Un Error plano subía sin clasificar por encima de `downloadCopecChannel`
    // y la corrida perdía también el canal TAE.
    const failure = await withCopecExportDeadline(new Promise(() => {}), 5).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CopecReportFailure)
    expect(failure).toMatchObject({ kind: "network" })
  })

  it("entrega la respuesta cuando llega antes del plazo", async () => {
    await expect(withCopecExportDeadline(Promise.resolve("archivo"), 1_000)).resolves.toBe("archivo")
  })
})
