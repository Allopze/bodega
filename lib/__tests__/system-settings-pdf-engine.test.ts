import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPdfEngineFor,
  getPdfEngineSettings,
  updatePdfEngineSettings,
} from "@/lib/services/system-settings"
import { PDF_DOCUMENT_LIST, PDF_DOCUMENT_SPECS } from "@/lib/pdf/engines"
import { recordAudit } from "@/lib/audit"

const mocks = vi.hoisted(() => {
  const limit = vi.fn()
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  const values = vi.fn(() => ({ onConflictDoUpdate: vi.fn() }))
  const insert = vi.fn(() => ({ values }))
  return { limit, select, insert, values }
})

vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
}))

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))

const ACTOR = { userId: "u-1", userEmail: "admin@chome.cl" }

/** `getPdfEngineSettings` lee las claves en el orden de `PDF_DOCUMENT_LIST`. */
function mockStored(values: Record<string, string | null>) {
  const secuencia = PDF_DOCUMENT_LIST.map((spec) => values[spec.id] ?? null)
  mocks.limit.mockReset()
  for (const value of secuencia) {
    if (value === null) mocks.limit.mockResolvedValueOnce([])
    else mocks.limit.mockResolvedValueOnce([{ key: "x", value }])
  }
  mocks.limit.mockResolvedValue([])
}

describe("getPdfEngineSettings", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin filas guardadas devuelve el motor por defecto de cada documento", async () => {
    mocks.limit.mockResolvedValue([])
    const settings = await getPdfEngineSettings()
    for (const spec of PDF_DOCUMENT_LIST) {
      expect(settings[spec.id]).toBe(spec.defaultEngine)
    }
  })

  it("un valor corrupto en base de datos degrada al motor por defecto", async () => {
    mockStored({ oc: "motor-que-no-existe" })
    const settings = await getPdfEngineSettings()
    expect(settings.oc).toBe(PDF_DOCUMENT_SPECS.oc.defaultEngine)
  })

  it("un fallo de base de datos no propaga: cae a los valores por defecto", async () => {
    mocks.limit.mockRejectedValue(new Error("DB failure"))
    const settings = await getPdfEngineSettings()
    expect(settings.oc).toBe(PDF_DOCUMENT_SPECS.oc.defaultEngine)
  })

  it("respeta un valor guardado válido", async () => {
    mockStored({ oc: "chromium" })
    expect((await getPdfEngineSettings()).oc).toBe("chromium")
  })
})

describe("getPdfEngineFor", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lee una sola clave y devuelve el motor del documento", async () => {
    mocks.limit.mockResolvedValueOnce([{ key: "pdf.engine.oc", value: "chromium" }])
    expect(await getPdfEngineFor("oc")).toBe("chromium")
    expect(mocks.limit).toHaveBeenCalledTimes(1)
  })

  it("sin fila guardada devuelve el motor por defecto", async () => {
    mocks.limit.mockResolvedValue([])
    expect(await getPdfEngineFor("sst")).toBe(PDF_DOCUMENT_SPECS.sst.defaultEngine)
  })
})

describe("updatePdfEngineSettings", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin cambios reales no escribe ni audita", async () => {
    mocks.limit.mockResolvedValue([])
    await updatePdfEngineSettings({ oc: PDF_DOCUMENT_SPECS.oc.defaultEngine }, ACTOR)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("con una entrada vacía no escribe ni audita", async () => {
    mocks.limit.mockResolvedValue([])
    await updatePdfEngineSettings({}, ACTOR)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("rechaza un motor que el documento no implementa", async () => {
    mocks.limit.mockResolvedValue([])
    await expect(updatePdfEngineSettings({ oc: "basura" }, ACTOR)).rejects.toThrow(
      /Motor de PDF no válido para Orden de compra/,
    )
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("escribe la clave del documento y audita una sola vez", async () => {
    mockStored({ oc: "chromium" })
    const result = await updatePdfEngineSettings({ oc: "pdfcn" }, ACTOR)

    expect(result.oc).toBe("pdfcn")
    expect(mocks.insert).toHaveBeenCalledTimes(1)
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ key: "pdf.engine.oc", value: "pdfcn" }),
    )
    expect(recordAudit).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        entityType: "pdf_engine_settings",
        entityId: "batch",
        oldState: { oc: "chromium" },
        newState: { oc: "pdfcn" },
      }),
      expect.anything(),
    )
  })

  it("solo escribe los documentos que cambiaron", async () => {
    mockStored({ oc: "chromium" })
    await updatePdfEngineSettings({ oc: "pdfcn", sst: "chromium" }, ACTOR)

    expect(mocks.insert).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ oldState: { oc: "chromium" }, newState: { oc: "pdfcn" } }),
      expect.anything(),
    )
  })
})
