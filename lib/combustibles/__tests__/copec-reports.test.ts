import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockWithBrowserContext } = vi.hoisted(() => ({
  mockWithBrowserContext: vi.fn(),
}))

vi.mock("@/lib/pdf/browser-pool", () => ({
  withBrowserContext: (...args: unknown[]) => mockWithBrowserContext(...args),
}))

const { downloadCopecReports } = await import("../copec-reports")

function reportResponse(fileName: string, content: string) {
  return {
    ok: vi.fn().mockReturnValue(true),
    status: vi.fn().mockReturnValue(200),
    body: vi.fn().mockResolvedValue(Buffer.from(`PK${content}`)),
    headers: vi.fn().mockReturnValue({ "content-disposition": `attachment; filename=${fileName}` }),
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

  it("downloads monthly TCT detail for Diesel and BlueMax in one authenticated session", async () => {
    const username = { fill: vi.fn() }
    const password = { fill: vi.fn() }
    const login = { click: vi.fn() }
    const reportMenu = { filter: () => ({ first: () => ({ click: vi.fn() }) }) }
    const rootMenu = { filter: () => ({ first: () => ({ hover: vi.fn() }) }) }
    const tctCombo = { inputValue: vi.fn().mockResolvedValue("TCT") }
    const reportTypeCombo = { inputValue: vi.fn().mockResolvedValue("Por Patente / Asignación") }
    const downloadTypeCombo = { inputValue: vi.fn().mockResolvedValue("Descargar Detalle") }
    const popup = { click: vi.fn() }
    const yearCell = { count: vi.fn().mockResolvedValue(1), getAttribute: vi.fn().mockResolvedValue(""), click: vi.fn() }
    const monthCell = { click: vi.fn() }
    const monthView = {
      waitFor: vi.fn(),
      locator: vi.fn(() => yearCell),
      getByText: vi.fn(() => monthCell),
    }
    const popupOk = { click: vi.fn() }
    const diesel = { check: vi.fn() }
    const bluemax = { check: vi.fn() }
    const search = { click: vi.fn() }
    let routeHandler: ((route: unknown) => Promise<void>) | undefined
    const abort = vi.fn().mockResolvedValue(undefined)
    const continueRoute = vi.fn().mockResolvedValue(undefined)
    const browserRequest = {
      method: vi.fn().mockReturnValue("POST"),
      postData: vi.fn().mockReturnValue("__EVENTTARGET=ctl00%24Cph1%24LinkBtnExportarXlsPatentes"),
    }
    const responses = [reportResponse("tct-diesel-detalle.xlsx", "diesel"), reportResponse("tct-bluemax-detalle.xlsx", "bluemax")]
    const fetch = vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1])
    const exportButton = {
      waitFor: vi.fn(),
      click: vi.fn(async () => routeHandler?.({
        request: () => browserRequest,
        abort,
        continue: continueRoute,
      })),
    }

    const page = {
      setDefaultTimeout: vi.fn(),
      goto: vi.fn(),
      waitForURL: vi.fn(),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      route: vi.fn(async (_url: string, handler: (route: unknown) => Promise<void>) => { routeHandler = handler }),
      unroute: vi.fn(),
      request: { fetch },
      locator: vi.fn((selector: string) => {
        if (selector === "#TxbUsuario") return username
        if (selector === "#TxbClave") return password
        if (selector === "#BtnIngresar") return login
        if (selector === ".rmRootGroup > .rmItem") return rootMenu
        if (selector === 'a[title="Informes de Consumos"]') return reportMenu
        if (selector === 'input[id$="RcbxTipoProducto_Input"]') return tctCombo
        if (selector === 'input[id$="RcbxTipoInforme_Input"]') return reportTypeCombo
        if (selector === 'a[id$="PeriodoIni_popupButton"]') return popup
        if (selector === '[id$="PeriodoIni_MonthYearTableViewID"]') return monthView
        if (selector === "#rcMView_OK") return popupOk
        if (selector === "#Cph1_RbTipoProductoPatPatentes_0") return diesel
        if (selector === "#Cph1_RbTipoProductoPatPatentes_1") return bluemax
        if (selector === "#Cph1_LinkBtnBuscarPatentes") return search
        if (selector === "#Cph1_LinkBtnExportarXlsPatentes") return exportButton
        if (selector === 'input[id$="RcbxTipoDescargaPatente_Input"]') return downloadTypeCombo
        throw new Error(`Selector inesperado: ${selector}`)
      }),
    }
    mockWithBrowserContext.mockImplementation(async (_options, callback) => callback({ newPage: async () => page }))

    const result = await downloadCopecReports([
      { product: "diesel", from: "2026-02-01", to: "2026-02-28" },
      { product: "bluemax", from: "2026-02-01", to: "2026-02-28" },
    ])

    expect(mockWithBrowserContext).toHaveBeenCalledOnce()
    expect(username.fill).toHaveBeenCalledOnce()
    expect(password.fill).toHaveBeenCalledOnce()
    expect(login.click).toHaveBeenCalledOnce()
    expect(diesel.check).toHaveBeenCalledOnce()
    expect(bluemax.check).toHaveBeenCalledOnce()
    expect(search.click).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      expect.objectContaining({ product: "diesel", unavailable: false, report: expect.objectContaining({ fileName: "tct-diesel-detalle.xlsx" }) }),
      expect.objectContaining({ product: "bluemax", unavailable: false, report: expect.objectContaining({ fileName: "tct-bluemax-detalle.xlsx" }) }),
    ])
  })
})
