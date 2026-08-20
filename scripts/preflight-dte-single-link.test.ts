import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.fn()

vi.mock("@/db", () => ({
  db: { select: mockSelect },
}))

const { assertNoDteSingleBusinessLinkConflicts } = await import("./preflight-dte-single-link")

/**
 * Cadena que acepta las dos formas de consulta del preflight —
 * `.from().where()` y `.from().where().groupBy().having()`— y resuelve a
 * `rows`. Encadenar `mockImplementationOnce` por consulta era frágil: al
 * agregar el chequeo de duplicados por carga de combustible, la tercera
 * llamada se quedaba sin mock y el fallo aparecía como "Cannot read
 * properties of undefined".
 */
function selectResolving(rows: unknown[]) {
  const terminal = Promise.resolve(rows) as Promise<unknown[]> & {
    groupBy: () => { having: () => Promise<unknown[]> }
  }
  terminal.groupBy = () => ({ having: () => Promise.resolve(rows) })
  return () => ({ from: () => ({ where: () => terminal }) })
}

describe("DTE single-business-link migration preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Sin conflictos en ninguna de las tres consultas.
    mockSelect.mockImplementation(selectResolving([]))
  })

  it("allows the migration when no historical DTE is linked to both domains", async () => {
    await expect(assertNoDteSingleBusinessLinkConflicts()).resolves.toEqual([])
  })

  it("blocks the migration with the exact conflicting DTE ids for remediation", async () => {
    mockSelect.mockImplementationOnce(selectResolving([{
      id: "dte-conflict-1",
      purchaseOrderInvoiceId: "invoice-1",
      fuelLoadId: "fuel-1",
    }]))

    await expect(assertNoDteSingleBusinessLinkConflicts()).rejects.toThrow(/dte-conflict-1/)
  })

  it("blocks the migration when a fuel load carries more than one DTE", async () => {
    // Las dos primeras consultas salen limpias; la tercera —duplicados por
    // carga de combustible, prerrequisito de la migración 0194— encuentra una.
    mockSelect
      .mockImplementationOnce(selectResolving([]))
      .mockImplementationOnce(selectResolving([]))
      .mockImplementationOnce(selectResolving([{ fuelLoadId: "fuel-dup-1" }]))
      .mockImplementationOnce(selectResolving([{ id: "dte-fuel-a" }, { id: "dte-fuel-b" }]))

    await expect(assertNoDteSingleBusinessLinkConflicts()).rejects.toThrow(/fuel-dup-1/)
  })
})
