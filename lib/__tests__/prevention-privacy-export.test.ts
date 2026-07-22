import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetDataset = vi.hoisted(() => vi.fn())
const mockRecordDelivery = vi.hoisted(() => vi.fn(async () => ({ id: "delivery-1" })))

vi.mock("@/lib/services/prevention-privacy", () => ({
  getPreventionPrivacyExportDataset: mockGetDataset,
  recordPreventionPrivacyDelivery: mockRecordDelivery,
}))

import { buildPreventionPrivacySubjectExport } from "@/lib/services/prevention-privacy-export"

function dataset(includesClinical: boolean) {
  return {
    request: {
      id: "ppr-1",
      rightType: "access",
      requestScope: "Todos mis antecedentes preventivos",
    },
    worker: {
      id: "worker-1",
      rut: "11111111-1",
      firstName: "=INJECT",
      lastName: "Titular",
      position: "Operador",
      worksiteId: "ws-1",
    },
    worksite: { id: "ws-1", name: "Faena Norte" },
    healthRecords: [{
      id: "phr-1",
      recordType: "aptitud",
      status: "vigente",
      fitnessStatus: "apto_con_restricciones",
      restrictionsSummary: "No levantar más de 10 kg",
      validFrom: "2026-01-01",
      validUntil: "2026-12-31",
      issuerName: "Médico autorizado",
      providerName: "Prestador",
    }],
    clinicalPayloads: includesClinical ? [{
      recordId: "phr-1",
      payload: { diagnosis: "contenido clínico", nested: { value: "=FORMULA" } },
    }] : [],
    includesClinical,
    purpose: "respuesta a derecho de acceso",
  }
}

describe("privacy subject Excel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDataset.mockResolvedValue(dataset(false))
  })

  it("exports only the subject projection by default and records a checksum", async () => {
    const result = await buildPreventionPrivacySubjectExport({
      requestId: "ppr-1",
      includeClinical: false,
      purpose: "respuesta a derecho de acceso",
      ctx: { userId: "privacy-admin" },
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:privacy:export_subject"],
    })

    const Excel = await import("exceljs")
    const workbook = new Excel.Workbook()
    await workbook.xlsx.load(result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer)
    expect(workbook.getWorksheet("Clínico")).toBeUndefined()
    expect(workbook.getWorksheet("Titular")?.getCell("C2").value).toBe("'=INJECT")
    expect(workbook.getWorksheet("Salud ocupacional")?.getCell("J2").value).toBe("sensitive_preventive")
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(mockRecordDelivery).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "ppr-1",
      includesClinical: false,
      healthRecordCount: 1,
      checksumSha256: result.checksumSha256,
    }))
  })

  it("labels every explicitly authorized clinical value and neutralizes formulas", async () => {
    mockGetDataset.mockResolvedValue(dataset(true))
    const result = await buildPreventionPrivacySubjectExport({
      requestId: "ppr-1",
      includeClinical: true,
      purpose: "respuesta clínica al titular",
      ctx: { userId: "clinical-custodian" },
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:privacy:export_subject", "prevention:health:view_clinical"],
    })

    const Excel = await import("exceljs")
    const workbook = new Excel.Workbook()
    await workbook.xlsx.load(result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer)
    const clinical = workbook.getWorksheet("Clínico")
    expect(clinical).toBeDefined()
    expect(clinical?.getColumn("D").values.slice(2)).toEqual(["clinical", "clinical"])
    expect(clinical?.getColumn("C").values).toContain("'=FORMULA")
    expect(mockRecordDelivery).toHaveBeenCalledWith(expect.objectContaining({ includesClinical: true }))
  })
})
