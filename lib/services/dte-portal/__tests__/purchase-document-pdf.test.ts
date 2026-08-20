import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockUpdateReturning = vi.fn()
const mockDownloadDtePdf = vi.fn()
const mockFetchBandejaEntrada = vi.fn()
const mockStat = vi.fn()
const mockReadFile = vi.fn()
const mockMkdir = vi.fn()
const mockWriteFile = vi.fn()
const mockRename = vi.fn()
const mockUnlink = vi.fn()
const mockGetPdfMaxSizeMb = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: { dteDocuments: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
    update: () => ({
      set: (...args: unknown[]) => {
        mockUpdateSet(...args)
        return {
          where: (...whereArgs: unknown[]) => {
            mockUpdateWhere(...args, ...whereArgs)
            return { returning: (...returningArgs: unknown[]) => mockUpdateReturning(...args, ...whereArgs, ...returningArgs) }
          },
        }
      },
    }),
  },
}))
vi.mock("@/db/schema", () => ({ dteDocuments: {} }))
vi.mock("node:fs", () => ({
  promises: {
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    rename: (...args: unknown[]) => mockRename(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}))
vi.mock("@/lib/storage/config", () => ({
  resolveDteFile: (value: string) => value.startsWith("storage/dte/") ? `/var/dte/${value.slice("storage/dte/".length)}` : null,
  resolveDteDir: () => "/var/dte",
  createDtePath: (fileName: string) => `storage/dte/${fileName}`,
}))
vi.mock("@/lib/services/dte-portal/config", () => ({
  buildDtePortalClientConfig: vi.fn().mockResolvedValue({
    baseUrl: "https://clientes.dtefacturaenlinea.cl/facturaenlinea",
    credentials: { rutUsr: "1", rutEmp: "2", clave: "3", codEmp: "433" },
  }),
}))
vi.mock("@/lib/services/dte-portal/client", () => ({
  DtePortalClient: class DtePortalClient {},
}))
vi.mock("@/lib/services/dte-portal/download", () => ({
  downloadDtePdf: (...args: unknown[]) => mockDownloadDtePdf(...args),
}))
vi.mock("@/lib/services/dte-portal/bandeja-entrada", () => ({
  fetchBandejaEntrada: (...args: unknown[]) => mockFetchBandejaEntrada(...args),
}))
vi.mock("@/lib/services/system-settings", () => ({
  getPdfMaxSizeMb: (...args: unknown[]) => mockGetPdfMaxSizeMb(...args),
}))

const { buildDtePurchasePdfUrl, getDteDocumentPdf } = await import("../purchase-document-pdf")
const { DTE_PORTAL_BASE_URL, resolveDtePortalResourceUrl } = await import("../portal-origin")

const BASE_DOC = {
  id: "dte-1",
  tipoDte: "33",
  folio: 45678,
  rutEmisor: "76.987.654-3",
  fechaEmision: "2026-07-28",
  codEmp: "433",
  periodo: "2026-07",
  portalRecordId: "9000001" as string | null,
  pdfPath: null as string | null,
}
function createValidPdf(): Buffer {
  const stream = "BT /F1 12 Tf 20 100 Td (Factura DTE) Tj ET"
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj${object}endobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, "latin1")
}

const PDF = createValidPdf()

describe("purchase DTE PDF retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPdfMaxSizeMb.mockResolvedValue(10)
    mockUpdateReturning.mockResolvedValue([{ id: "dte-1" }])
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)
    mockDownloadDtePdf.mockResolvedValue(PDF)
  })

  it("reconstructs a canonical portal PDF route accepted by the origin resolver", () => {
    const post = encodeURIComponent(Buffer.from("Cod_Emp=433&Nreguist=9000001").toString("base64"))
    const url = buildDtePurchasePdfUrl("433", "9000001")

    expect(url).toBe(`dtepdfX.php?post=${post}`)
    expect(resolveDtePortalResourceUrl(url)).toBe(`${DTE_PORTAL_BASE_URL}/dtepdfX.php?post=${post}`)
  })

  it("serves a valid cached PDF without reaching the portal", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, pdfPath: "storage/dte/cached.pdf" })
    mockStat.mockResolvedValue({ isFile: () => true, size: PDF.length })
    mockReadFile.mockResolvedValue(PDF)

    const result = await getDteDocumentPdf("dte-1")

    expect(result).toEqual({ buffer: PDF, fileName: "DTE-33-45678.pdf" })
    expect(mockDownloadDtePdf).not.toHaveBeenCalled()
  })

  it("falls back to the matching inbox row when a historical DTE lacks Nreguist", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, portalRecordId: null })
    mockFetchBandejaEntrada.mockResolvedValue({
      totalRegistros: 1,
      rows: [{
        fechaRecepcion: "2026-07-28 10:00",
        estadoPlataforma: null,
        fecha: "2026-07-28",
        tipoDoc: "33",
        folio: 45678,
        rutEmisor: "76987654-3",
        razonSocial: "Proveedor",
        montoTotal: 119000,
        tipoRef: null,
        folioRef: null,
        fechaRef: null,
        nreguist: "9000001",
        pdfUrl: "../dtepdfX.php?post=portal-token",
        xmlUrl: null,
      }],
    })

    const result = await getDteDocumentPdf("dte-1")

    expect(result.buffer).toEqual(PDF)
    // ORQ-03: el raspado bajo demanda también entrega contexto, o sus warns de
    // fila descartada quedan sueltos y mezclados con los del cron.
    expect(mockFetchBandejaEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ anio: "2026", mes: "07", codEmp: "433" }),
      { correlationId: "dte-pdf:433:2026-07", periodo: "2026-07" },
    )
    const post = encodeURIComponent(Buffer.from("Cod_Emp=433&Nreguist=9000001").toString("base64"))
    expect(mockDownloadDtePdf).toHaveBeenCalledWith(expect.anything(), `dtepdfX.php?post=${post}`, {
      maxBytes: 10 * 1024 * 1024,
    })
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ portalRecordId: "9000001" }))
  })

  it("normalizes the exact legacy PanelCorreo PDF link when Nreguist is absent", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, portalRecordId: null })
    mockFetchBandejaEntrada.mockResolvedValue({
      totalRegistros: 1,
      rows: [{
        fechaRecepcion: "2026-07-28 10:00",
        estadoPlataforma: null,
        fecha: "2026-07-28",
        tipoDoc: "33",
        folio: 45678,
        rutEmisor: "76987654-3",
        razonSocial: "Proveedor",
        montoTotal: 119000,
        tipoRef: null,
        folioRef: null,
        fechaRef: null,
        nreguist: null,
        pdfUrl: "../dtepdfX.php?post=legacy-token",
        xmlUrl: null,
      }],
    })

    await expect(getDteDocumentPdf("dte-1")).resolves.toMatchObject({ buffer: PDF })

    expect(mockDownloadDtePdf).toHaveBeenCalledWith(expect.anything(), "dtepdfX.php?post=legacy-token", {
      maxBytes: 10 * 1024 * 1024,
    })
  })

  it("treats a corrupt cache as a miss and never returns it as a PDF", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, pdfPath: "storage/dte/corrupt.pdf" })
    mockStat.mockResolvedValue({ isFile: () => true, size: PDF.length })
    mockReadFile.mockResolvedValue(Buffer.from("<html>login</html>"))

    const result = await getDteDocumentPdf("dte-1")

    expect(result.buffer).toEqual(PDF)
    expect(mockDownloadDtePdf).toHaveBeenCalledTimes(1)
    expect(mockUnlink).toHaveBeenCalledWith("/var/dte/corrupt.pdf")
  })

  it("rejects a truncated response that only has a PDF header", async () => {
    mockFindFirst.mockResolvedValue(BASE_DOC)
    mockDownloadDtePdf.mockResolvedValue(Buffer.from("%PDF-1.7\n", "latin1"))

    await expect(getDteDocumentPdf("dte-1")).rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
  })

  it("rejects a spoofed PDF shell that has markers but no parseable document", async () => {
    mockFindFirst.mockResolvedValue(BASE_DOC)
    mockDownloadDtePdf.mockResolvedValue(Buffer.from(
      "%PDF-1.7\n1 0 obj\n<<>>\nendobj\nxref\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n",
      "latin1",
    ))

    await expect(getDteDocumentPdf("dte-1")).rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
  })

  it("does not read a cached file that already exceeds the configured maximum", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, pdfPath: "storage/dte/oversized.pdf" })
    mockStat.mockResolvedValue({ isFile: () => true, size: 10 * 1024 * 1024 + 1 })
    mockReadFile.mockResolvedValue(PDF)

    const result = await getDteDocumentPdf("dte-1")

    expect(result.buffer).toEqual(PDF)
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockDownloadDtePdf).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      maxBytes: 10 * 1024 * 1024,
    })
  })
})
