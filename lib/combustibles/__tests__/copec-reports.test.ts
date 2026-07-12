import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockWithBrowserContext } = vi.hoisted(() => ({
  mockWithBrowserContext: vi.fn(),
}))

vi.mock("@/lib/pdf/browser-pool", () => ({
  withBrowserContext: (...args: unknown[]) => mockWithBrowserContext(...args),
}))

const { downloadCopecReports } = await import("../copec-reports")

function reportDownload(fileName: string, content: string) {
  return {
    createReadStream: vi.fn().mockResolvedValue(Readable.from([Buffer.from(content)])),
    suggestedFilename: vi.fn().mockReturnValue(fileName),
  }
}

describe("downloadCopecReports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("COPEC_USERNAME", "copec-user")
    vi.stubEnv("COPEC_PASSWORD", "copec-password")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("reuses one authenticated browser context for TCT and TAE in the same period", async () => {
    const username = { fill: vi.fn() }
    const password = { fill: vi.fn() }
    const login = { click: vi.fn() }
    const card = { click: vi.fn() }
    const dateStart = { click: vi.fn(), fill: vi.fn(), press: vi.fn() }
    const dateEnd = { click: vi.fn(), fill: vi.fn(), press: vi.fn() }
    const search = { click: vi.fn() }
    const exportBtn = { waitFor: vi.fn(), click: vi.fn() }
    const option = { count: vi.fn().mockResolvedValue(1), click: vi.fn() }
    const downloads = [reportDownload("tct.xlsx", "tct"), reportDownload("tae.xlsx", "tae")]

    const page = {
      setDefaultTimeout: vi.fn(),
      goto: vi.fn(),
      waitForURL: vi.fn(),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForEvent: vi.fn()
        .mockResolvedValueOnce(downloads[0])
        .mockResolvedValueOnce(downloads[1]),
      locator: vi.fn((selector: string) => {
        if (selector === "#TxbUsuario") return username
        if (selector === "#TxbClave") return password
        if (selector === "#BtnIngresar") return login
        if (selector === ".rmRootGroup > .rmItem") return { filter: () => ({ first: () => ({ hover: vi.fn() }) }) }
        if (selector === 'a[title="Consumos Por Patente"]') return { filter: () => ({ first: () => ({ click: vi.fn() }) }) }
        if (selector === 'input[id$="RcbxTipoProducto_Input"]') return card
        if (selector === 'input[id$="FechaInicioPatente_dateInput"]') return dateStart
        if (selector === 'input[id$="FechaFinPatente_dateInput"]') return dateEnd
        if (selector === "#Cph1_LinkBtnBuscar") return search
        if (selector === "#Cph1_LinkBtnExportarXls") return exportBtn
        throw new Error(`Selector inesperado: ${selector}`)
      }),
      getByText: vi.fn(() => ({ last: () => option })),
    }
    mockWithBrowserContext.mockImplementation(async (_options, callback) => callback({ newPage: async () => page }))

    const result = await downloadCopecReports([
      { cardType: "TCT", from: "2026-02-01", to: "2026-02-28" },
      { cardType: "TAE", from: "2026-02-01", to: "2026-02-28" },
    ])

    expect(mockWithBrowserContext).toHaveBeenCalledOnce()
    expect(username.fill).toHaveBeenCalledOnce()
    expect(password.fill).toHaveBeenCalledOnce()
    expect(login.click).toHaveBeenCalledOnce()
    expect(search.click).toHaveBeenCalledTimes(2)
    expect(exportBtn.click).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      expect.objectContaining({ cardType: "TCT", unavailable: false, report: expect.objectContaining({ fileName: "tct.xlsx" }) }),
      expect.objectContaining({ cardType: "TAE", unavailable: false, report: expect.objectContaining({ fileName: "tae.xlsx" }) }),
    ])
  })
})
