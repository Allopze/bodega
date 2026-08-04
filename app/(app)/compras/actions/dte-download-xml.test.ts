import { describe, it, expect, vi, beforeEach } from "vitest"

const SII_DTE = '<?xml version="1.0" encoding="ISO-8859-1"?><EnvDTE><SetDTE><DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>45678</Folio><FchEmis>2026-07-28</FchEmis></IdDoc><Emisor><RUTEmisor>76.987.654-3</RUTEmisor><RznSoc>Señalética Ñuble SpA</RznSoc></Emisor><Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales></Encabezado><Detalle><NroLinDet>1</NroLinDet><NmbItem>Casco amarillo</NmbItem><QtyItem>10</QtyItem><UnmdItem>UN</UnmdItem><PrcItem>5000</PrcItem><MontoItem>50000</MontoItem></Detalle></Documento></DTE></SetDTE></EnvDTE>'

const mockRequirePermission = vi.fn()
const mockFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockDownloadDteXml = vi.fn()
const mockMkdirp = vi.fn()
const mockWriteBuffer = vi.fn()
const mockReadBuffer = vi.fn()

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("@/db", () => ({
  db: {
    query: { dteDocuments: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
    update: () => ({ set: (...args: unknown[]) => ({ where: (...whereArgs: unknown[]) => mockUpdateSet(...args, ...whereArgs) }) }),
  },
}))
vi.mock("@/db/schema", () => ({ dteDocuments: {} }))
vi.mock("@/lib/services/dte-portal/download", () => ({
  downloadDteXml: (...args: unknown[]) => mockDownloadDteXml(...args),
}))
vi.mock("@/lib/services/dte-portal/config", () => ({
  buildDtePortalClientConfig: () => ({
    baseUrl: "https://clientes.dtefacturaenlinea.cl/facturaenlinea",
    credentials: { rutUsr: "1", rutEmp: "2", clave: "3", codEmp: "433" },
  }),
}))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: (...args: unknown[]) => mockMkdirp(...args),
  writeBuffer: (...args: unknown[]) => mockWriteBuffer(...args),
  readBuffer: (...args: unknown[]) => mockReadBuffer(...args),
}))

const { downloadDteDocumentXml } = await import("./dte-download-xml")

const BASE_DOC = {
  id: "dte-1",
  tipoDte: "33",
  folio: 45678,
  rutEmisor: "76987654-3",
  xmlPath: null as string | null,
}

describe("downloadDteDocumentXml", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue({ user: { id: "user-1" } })
    mockMkdirp.mockResolvedValue(undefined)
    mockWriteBuffer.mockResolvedValue(undefined)
  })

  it("returns an explicit error when the document does not exist", async () => {
    mockFindFirst.mockResolvedValue(undefined)

    const result = await downloadDteDocumentXml("missing")

    expect(result).toEqual({ ok: false, error: "Documento DTE no encontrado" })
    expect(mockDownloadDteXml).not.toHaveBeenCalled()
  })

  it("downloads, parses and persists the XML on first view (reusing lib/services/purchasing-module/dte-parser.ts)", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC })
    mockDownloadDteXml.mockResolvedValue({ xml: SII_DTE, buffer: Buffer.from(SII_DTE, "latin1") })
    mockUpdateSet.mockResolvedValue(undefined)

    const result = await downloadDteDocumentXml("dte-1")

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.detail.netAmount).toBe(100000)
    expect(result.detail.taxAmount).toBe(19000)
    expect(result.detail.totalAmount).toBe(119000)
    expect(result.detail.items).toHaveLength(1)

    // El enlace se reconstruye desde RUT/tipo/folio ya guardados, sin URL cruda persistida.
    expect(mockDownloadDteXml).toHaveBeenCalledWith(expect.anything(), "empr/Chome/DTEProveedores/PRV_76987654-3_33_45678.xml")
    expect(mockWriteBuffer).toHaveBeenCalledTimes(1)
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ montoNeto: 100000, iva: 19000, xmlPath: expect.stringContaining("storage/dte/") }),
      expect.anything(),
    )
  })

  it("reuses the cached XML file instead of hitting the portal again", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, xmlPath: "storage/dte/already-downloaded.xml" })
    mockReadBuffer.mockResolvedValue(Buffer.from(SII_DTE, "latin1"))

    const result = await downloadDteDocumentXml("dte-1")

    expect(result.ok).toBe(true)
    expect(mockDownloadDteXml).not.toHaveBeenCalled()
    expect(mockReadBuffer).toHaveBeenCalledTimes(1)
  })

  it("falls back to a fresh download when the cached file is missing", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC, xmlPath: "storage/dte/gone.xml" })
    mockReadBuffer.mockRejectedValue(new Error("ENOENT"))
    mockDownloadDteXml.mockResolvedValue({ xml: SII_DTE, buffer: Buffer.from(SII_DTE, "latin1") })
    mockUpdateSet.mockResolvedValue(undefined)

    const result = await downloadDteDocumentXml("dte-1")

    expect(result.ok).toBe(true)
    expect(mockDownloadDteXml).toHaveBeenCalledTimes(1)
  })

  it("returns an explicit error when the portal download fails", async () => {
    mockFindFirst.mockResolvedValue({ ...BASE_DOC })
    mockDownloadDteXml.mockRejectedValue(new Error("timeout"))

    const result = await downloadDteDocumentXml("dte-1")

    expect(result).toEqual({ ok: false, error: "timeout" })
  })
})
