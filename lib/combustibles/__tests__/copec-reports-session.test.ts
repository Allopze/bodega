import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Doble mínimo del portal: cada locator resuelve sin hacer nada, salvo las
 * fallas que una página tiene programadas. Alcanza para recorrer el login, el
 * cuadro de verificación, la navegación por menú y la selección de mes/producto
 * sin navegador real.
 */
interface PageScript {
  /** Cada falla ocurre UNA vez, en el `skip + 1`-ésimo clic sobre un selector que contenga `on`. */
  timeouts?: Array<{ on: string; skip?: number }>
  /** El radio del producto aparece deshabilitado: el mes no tiene informe. */
  radioDisabled?: boolean
}

interface FakePage extends PageScript {
  id: number
  closed: boolean
  url: string
  seen: Map<string, number>
}

const portal = {
  /** Copec pide código por correo después de la clave. */
  otp: false,
  logins: 0,
  otpFilled: [] as string[],
  comboChoices: [] as string[],
}
const opened: FakePage[] = []
let pageScripts: PageScript[] = []

function timeoutError(message = "locator.click: Timeout 20000ms exceeded."): Error {
  return Object.assign(new Error(message), { name: "TimeoutError" })
}

function maybeFail(state: FakePage, selector: string) {
  for (const timeout of state.timeouts ?? []) {
    if (!selector.includes(timeout.on)) continue
    const count = (state.seen.get(timeout.on) ?? 0) + 1
    state.seen.set(timeout.on, count)
    if (count === (timeout.skip ?? 0) + 1) throw timeoutError()
  }
}

const HOME = "https://tctcliente.copec.cl/VistasAdminCte/AdmCteInicio.aspx"

function fakeLocator(state: FakePage, selector: string): Record<string, unknown> {
  const chain = (suffix: string) => () => fakeLocator(state, `${selector}${suffix}`)
  return {
    click: async () => {
      maybeFail(state, selector)
      if (selector === "#BtnIngresar") {
        portal.logins++
        if (!portal.otp) state.url = HOME
      }
      if (selector === "#BtnValidarOtp") state.url = HOME
      const choice = selector.match(/^text=(.+)$/)?.[1]
      if (choice) portal.comboChoices.push(choice)
    },
    hover: async () => {},
    fill: async (value: string) => {
      // Como Playwright: el call log del error repite los argumentos de `fill`.
      if (state.timeouts?.some((timeout) => timeout.on === `fill:${selector}`)) {
        throw timeoutError(`locator.fill: Timeout 5000ms exceeded.\nCall log:\n  - fill("${value}")`)
      }
      if (selector === "#TxbOtpCodigo") portal.otpFilled.push(value)
    },
    // El cuadro de verificación sólo aparece si el portal lo pide; si no, la
    // espera no termina nunca (como en el navegador, hasta su timeout).
    waitFor: () => (selector === "#TxbOtpCodigo" && !portal.otp ? new Promise(() => {}) : Promise.resolve()),
    inputValue: async () => "",
    count: async () => 1,
    getAttribute: async () => null,
    evaluateAll: async () => [],
    check: async () => { if (state.radioDisabled && selector.includes("RbTipoProducto")) throw timeoutError() },
    isDisabled: async () => Boolean(state.radioDisabled),
    filter: chain(""),
    first: chain(""),
    last: chain(""),
    locator: (inner: string) => fakeLocator(state, `${selector} ${inner}`),
    getByText: (text: string) => fakeLocator(state, `text=${text}`),
  }
}

function fakePage(script: PageScript) {
  const state: FakePage = { id: opened.length + 1, closed: false, url: "about:blank", seen: new Map(), ...script }
  opened.push(state)
  return {
    setDefaultTimeout: () => {},
    goto: async (url: string) => { state.url = url },
    waitForURL: async (pattern: RegExp) => {
      if (/AdmInfConsumosAgrupado/.test(pattern.source)) return
      if (!pattern.test(state.url)) throw timeoutError()
    },
    waitForLoadState: async () => {},
    url: () => state.url,
    keyboard: { press: async () => {} },
    locator: (selector: string) => fakeLocator(state, selector),
    getByText: (text: string) => fakeLocator(state, `text=${text}`),
    close: async () => { state.closed = true },
  }
}

vi.mock("@/lib/pdf/browser-pool", () => ({
  withBrowserContext: async (_options: unknown, run: (context: unknown) => Promise<unknown>) => run({
    newPage: async () => fakePage(pageScripts.shift() ?? {}),
  }),
}))

const mockWaitForCopecOtp = vi.fn(async () => "123456")
vi.mock("@/lib/combustibles/copec-otp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../copec-otp")>()),
  readCopecOtpConfig: () => ({ host: "imap.test", port: 993, user: "plataforma@test", password: "x" }),
  openCopecOtpMailbox: async () => ({ unreadSince: async () => [], markUsed: async () => {}, close: async () => {} }),
  waitForCopecOtp: (...args: unknown[]) => mockWaitForCopecOtp(...(args as [])),
}))

const { downloadCopecReports, withCopecPortalSession, _resetCopecSessionForTesting } = await import("../copec-reports")
const { CopecOtpTimeoutError } = await import("../copec-otp")

const requests = [
  { product: "diesel" as const, from: "2026-02-01", to: "2026-02-28" },
  { product: "bluemax" as const, from: "2026-02-01", to: "2026-02-28" },
]

describe("sesión Copec", () => {
  beforeEach(() => {
    opened.length = 0
    pageScripts = []
    Object.assign(portal, { otp: false, logins: 0, otpFilled: [], comboChoices: [] })
    mockWaitForCopecOtp.mockReset().mockResolvedValue("123456")
    _resetCopecSessionForTesting()
    vi.stubEnv("COPEC_USERNAME", "usuario")
    vi.stubEnv("COPEC_PASSWORD", "clave")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("restablece la página por el menú después de que un producto falla, sin otro login", async () => {
    // Diésel muere con el popup de mes; BlueMax sigue en la misma página ya
    // restablecida y llega hasta el radio (deshabilitado: mes sin informe).
    pageScripts = [{ timeouts: [{ on: "PeriodoIni_popupButton" }], radioDisabled: true }]

    const results = await downloadCopecReports(requests)

    expect(results).toEqual([
      { product: "diesel", unavailable: false, failure: { kind: "selector_changed", message: "Copec no mostró el control esperado para este producto." } },
      { product: "bluemax", unavailable: true },
    ])
    expect(opened).toHaveLength(1)
    expect(portal.logins).toBe(1)
  })

  it("reutiliza la página cuando el producto anterior sólo no tenía informe", async () => {
    pageScripts = [{ radioDisabled: true }]

    const results = await downloadCopecReports(requests)

    expect(results).toEqual([
      { product: "diesel", unavailable: true },
      { product: "bluemax", unavailable: true },
    ])
    expect(opened).toHaveLength(1)
  })

  it("si el menú tampoco responde, descarta la página y vuelve a entrar", async () => {
    // El primer clic al menú es el de la entrada; el segundo, el de la
    // recuperación tras la falla de Diésel.
    pageScripts = [
      { timeouts: [{ on: "PeriodoIni_popupButton" }, { on: "Informes de Consumos", skip: 1 }] },
      { radioDisabled: true },
    ]

    const results = await downloadCopecReports(requests)

    expect(results.map((result) => ("failure" in result ? result.failure.kind : result.unavailable ? "unavailable" : "ok"))).toEqual(["selector_changed", "unavailable"])
    expect(opened).toHaveLength(2)
    expect(opened[0]!.closed).toBe(true)
    expect(portal.logins).toBe(2)
  })

  it("registra la falla del producto si tampoco se puede volver a entrar, sin abortar el canal", async () => {
    pageScripts = [
      { timeouts: [{ on: "PeriodoIni_popupButton" }, { on: "Informes de Consumos", skip: 1 }] },
      { timeouts: [{ on: "Informes de Consumos" }] },
    ]

    const results = await downloadCopecReports(requests)

    expect(results.map((result) => ("failure" in result ? result.failure.kind : "ok"))).toEqual(["selector_changed", "selector_changed"])
  })

  it("comparte la página entre canales: cambia el combo en vez de volver a entrar", async () => {
    pageScripts = [{ radioDisabled: true }]

    await withCopecPortalSession(async (session) => {
      await session.download(requests, "TCT")
      await session.download(requests, "TAE")
    })

    expect(portal.logins).toBe(1)
    expect(opened).toHaveLength(1)
    expect(portal.comboChoices.filter((choice) => choice === "TCT" || choice === "TAE")).toEqual(["TCT", "TAE"])
  })

  it("no entra al portal si la sesión no descarga nada", async () => {
    await withCopecPortalSession(async () => {})

    expect(opened).toHaveLength(0)
    expect(portal.logins).toBe(0)
  })

  describe("verificación por correo", () => {
    beforeEach(() => {
      portal.otp = true
    })

    it("completa el login con el código leído de la casilla", async () => {
      pageScripts = [{ radioDisabled: true }]

      await downloadCopecReports(requests)

      expect(mockWaitForCopecOtp).toHaveBeenCalledOnce()
      expect(portal.otpFilled).toEqual(["123456"])
    })

    it("pide un solo código para todo el barrido", async () => {
      // Antes: TCT y TAE de cada mes eran un login cada uno, un correo por login.
      pageScripts = [{ radioDisabled: true }]

      await withCopecPortalSession(async (session) => {
        for (const from of ["2026-01-01", "2026-02-01"]) {
          const month = requests.map((request) => ({ ...request, from, to: `${from.slice(0, 8)}28` }))
          await session.download(month, "TCT")
          await session.download(month, "TAE")
        }
      })

      expect(mockWaitForCopecOtp).toHaveBeenCalledOnce()
      expect(portal.logins).toBe(1)
    })

    it("si el código no llega, falla como mfa_timeout y no vuelve a intentar el login enseguida", async () => {
      mockWaitForCopecOtp.mockRejectedValue(new CopecOtpTimeoutError())

      await expect(downloadCopecReports(requests, "TCT")).rejects.toMatchObject({ kind: "mfa_timeout" })
      // TAE, en la misma corrida: no dispara otro correo.
      await expect(downloadCopecReports(requests, "TAE")).rejects.toMatchObject({ kind: "mfa_timeout" })

      expect(portal.logins).toBe(1)
    })

    it("no deja el código en el mensaje cuando el cuadro de verificación cambió", async () => {
      pageScripts = [{ timeouts: [{ on: "fill:#TxbOtpCodigo" }] }]

      const failure = await downloadCopecReports(requests).catch((error: unknown) => error)

      expect(failure).toMatchObject({ kind: "selector_changed" })
      expect(String((failure as Error).message)).not.toContain("123456")
    })
  })
})
