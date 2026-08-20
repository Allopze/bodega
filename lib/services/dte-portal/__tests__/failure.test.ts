import { describe, it, expect } from "vitest"
import { classifyDteFailure } from "../failure"
import { DtePortalTooManyOperationsError, DtePortalStartsPausedError } from "../operation-lease"
import { DtePortalError } from "../types"

describe("classifyDteFailure", () => {
  // El cupo de operaciones simultáneas es propio: sin rama caía en
  // DTE_UNEXPECTED y una espera reintentable parecía una falla del portal.
  it("clasifica el exceso de operaciones simultáneas con su propio código", () => {
    expect(classifyDteFailure(new DtePortalTooManyOperationsError())).toEqual({
      code: "DTE_PORTAL_TOO_MANY_OPERATIONS",
      summary: expect.stringMatching(/simultáneas/i),
    })
  })

  it("no confunde el exceso de operaciones con la pausa por cambio de credenciales", () => {
    expect(classifyDteFailure(new DtePortalStartsPausedError()).code).toBe("DTE_PORTAL_STARTS_PAUSED")
  })

  it("mapea los errores del portal y deja el resto en el default", () => {
    expect(classifyDteFailure(new DtePortalError("boom", "TIMEOUT")).code).toBe("DTE_TIMEOUT")
    expect(classifyDteFailure(new Error("cualquier cosa")).code).toBe("DTE_UNEXPECTED")
  })

  it("redacta cualquier mensaje que contenga un secreto", () => {
    expect(classifyDteFailure(new Error("clave=s3cr3t0"), ["s3cr3t0"]).code).toBe("DTE_SECRET_REDACTED")
  })
})
