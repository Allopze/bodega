import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockAssertOrderAccess = vi.fn()
const mockPendingFindMany = vi.fn()
const mockOrderRows = vi.fn()
const mockEnrich = vi.fn()
const mockRevalidate = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: { dteDocuments: { findMany: (...args: unknown[]) => mockPendingFindMany(...args) } },
    select: () => ({ from: () => ({ leftJoin: () => ({ where: () => mockOrderRows() }) }) }),
  },
}))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("../actions.helpers", () => ({
  assertOrderAccess: (...args: unknown[]) => mockAssertOrderAccess(...args),
}))
vi.mock("@/lib/services/dte-portal/purchase-document-xml", () => ({
  enrichDteDocumentLines: (...args: unknown[]) => mockEnrich(...args),
}))
vi.mock("@/lib/services/operational-cache", () => ({
  revalidateOperationalViews: (...args: unknown[]) => mockRevalidate(...args),
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

const { analyzeDteCandidateLines } = await import("./dte-analyze-lines")

/** El portal entrega el RUT sin puntos; `suppliers.rut` se ingresa a mano. */
const doc = (id: string, rutEmisor = "76000000-0") => ({ id, rutEmisor })

describe("analyzeDteCandidateLines", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue({ user: { id: "user-1" } })
    mockAssertOrderAccess.mockResolvedValue(null)
    mockOrderRows.mockReturnValue([{ createdAt: "2026-07-01T12:00:00.000Z", supplierRut: "76.000.000-0" }])
    mockPendingFindMany.mockResolvedValue([doc("dte-1")])
    mockEnrich.mockResolvedValue({ ok: true, lineCount: 2 })
  })

  it("analiza los DTE del proveedor de la OC y revalida su detalle", async () => {
    const result = await analyzeDteCandidateLines("oc-1")

    expect(result).toEqual({ ok: true, message: "1 DTE analizado(s)." })
    expect(mockEnrich).toHaveBeenCalledWith("dte-1")
    expect(mockRevalidate).toHaveBeenCalledWith(["/compras/oc-1"])
  })

  // El RUT se compara normalizado y en memoria: la consulta no puede hacerlo
  // porque los dos formatos conviven en la base.
  it("descarta los DTE de otro proveedor aunque la consulta los traiga", async () => {
    mockPendingFindMany.mockResolvedValue([doc("propio"), doc("ajeno", "96542490-3")])

    const result = await analyzeDteCandidateLines("oc-1")

    expect(mockEnrich).toHaveBeenCalledTimes(1)
    expect(mockEnrich).toHaveBeenCalledWith("propio")
    expect(result.message).toContain("1 DTE analizado(s).")
  })

  // Cada documento es una descarga al portal disparada por un clic.
  it("no pasa de diez documentos por pulsación y dice cuántos quedan", async () => {
    mockPendingFindMany.mockResolvedValue(Array.from({ length: 14 }, (_, i) => doc(`dte-${i}`)))

    const result = await analyzeDteCandidateLines("oc-1")

    expect(mockEnrich).toHaveBeenCalledTimes(10)
    expect(result.message).toContain("Quedan 4 por analizar")
  })

  // Un "listo" a secas sobre un documento que sigue sin líneas manda a
  // confirmar a ciegas: el diálogo se abriría sin asociaciones que revisar.
  it("nombra los documentos cuyo XML el portal no entregó", async () => {
    mockPendingFindMany.mockResolvedValue([doc("con-xml"), doc("sin-xml")])
    mockEnrich.mockImplementation(async (id: string) =>
      id === "sin-xml" ? { ok: false, errorCode: "DTE_XML_DOWNLOAD_FAILED" } : { ok: true, lineCount: 1 })

    const result = await analyzeDteCandidateLines("oc-1")

    expect(result.message).toContain("1 DTE analizado(s).")
    expect(result.message).toContain("1 sin XML disponible en el portal.")
  })

  it("no sale al portal cuando no hay nada pendiente", async () => {
    mockPendingFindMany.mockResolvedValue([])

    const result = await analyzeDteCandidateLines("oc-1")

    expect(result).toEqual({ ok: true, message: "No hay DTE pendientes de análisis para esta orden." })
    expect(mockEnrich).not.toHaveBeenCalled()
  })

  it("se detiene antes de consultar nada si la faena no es del usuario", async () => {
    mockAssertOrderAccess.mockResolvedValue({ ok: false, message: "No tienes acceso a esta orden" })

    const result = await analyzeDteCandidateLines("oc-1")

    expect(result).toEqual({ ok: false, message: "No tienes acceso a esta orden" })
    expect(mockPendingFindMany).not.toHaveBeenCalled()
  })

  it("no analiza sin RUT del proveedor: no habría con qué comparar", async () => {
    mockOrderRows.mockReturnValue([{ createdAt: "2026-07-01T12:00:00.000Z", supplierRut: null }])

    const result = await analyzeDteCandidateLines("oc-1")

    expect(result).toEqual({ ok: false, message: "El proveedor de esta OC no tiene RUT cargado" })
    expect(mockPendingFindMany).not.toHaveBeenCalled()
  })
})
