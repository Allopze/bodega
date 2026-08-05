import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  BILLING_PROVIDER_IDS,
  getAllBillingProviders,
  getBillingProvider,
  isProviderEnabled,
  assertCapability,
  providerInvoiceFromXml,
  CHIPAX_CONTRACT_BLOCKER,
  ChipaxProvider,
} from "../providers"
import type { BillingProvider } from "../providers/types"

/** Capacidad → método que la implementa. Es el contrato que se verifica. */
const CAPABILITY_METHODS: ReadonlyArray<[keyof BillingProvider["capabilities"], keyof BillingProvider]> = [
  ["canListIssuedInvoices", "listIssuedInvoices"],
  ["canListReceivedInvoices", "listReceivedInvoices"],
  ["canListBankTransactions", "listBankTransactions"],
  ["canListClients", "listClients"],
]

describe("registro de proveedores", () => {
  it("expone exactamente los proveedores declarados en el esquema", () => {
    expect([...BILLING_PROVIDER_IDS]).toEqual(["factura_en_linea", "chipax", "manual"])
    expect(getAllBillingProviders().map((provider) => provider.id)).toEqual([...BILLING_PROVIDER_IDS])
  })

  it("toda capacidad declarada tiene su método implementado", () => {
    for (const provider of getAllBillingProviders()) {
      for (const [capability, method] of CAPABILITY_METHODS) {
        if (provider.capabilities[capability]) {
          expect(typeof provider[method], `${provider.id}.${String(method)}`).toBe("function")
        }
      }
    }
  })

  it("ningún proveedor declara capacidad de escritura", () => {
    for (const provider of getAllBillingProviders()) {
      expect(provider.capabilities.canCreateInvoices, provider.id).toBe(false)
      expect(provider.capabilities.canCreateExpenses, provider.id).toBe(false)
    }
  })

  it("assertCapability falla si se pide algo que el proveedor no declara", () => {
    const manual = getBillingProvider("manual")
    expect(() => assertCapability(manual, "canListIssuedInvoices", "listIssuedInvoices"))
      .toThrow(/no declara la capacidad/i)
  })
})

describe("FacturaEnLínea", () => {
  const provider = getBillingProvider("factura_en_linea")

  it("puede listar ventas y compras, y traer XML", () => {
    expect(provider.capabilities.canListIssuedInvoices).toBe(true)
    expect(provider.capabilities.canListReceivedInvoices).toBe(true)
    expect(provider.capabilities.canRetrieveXml).toBe(true)
  })

  it("no declara pagos ni movimientos bancarios: el portal es un emisor de DTE, no un banco", () => {
    expect(provider.capabilities.canListPayments).toBe(false)
    expect(provider.capabilities.canListBankTransactions).toBe(false)
  })

  it("está siempre habilitado por flag (ya opera en producción para Compras)", () => {
    expect(isProviderEnabled("factura_en_linea")).toBe(true)
  })
})

describe("Chipax", () => {
  const provider = getBillingProvider("chipax")

  it("no declara ninguna capacidad de datos mientras el contrato no sea legible", () => {
    for (const value of Object.values(provider.capabilities)) {
      expect(value).toBe(false)
    }
  })

  it("queda deshabilitado sin flag y sin contrato verificado", () => {
    expect(isProviderEnabled("chipax")).toBe(false)
  })

  it("sin credenciales el healthCheck lo dice y NO llama a la red", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const health = await provider.healthCheck()

    expect(health.ok).toBe(false)
    expect(health.detail).toMatch(/CHIPAX_APP_ID/)
    expect(health.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Sin credenciales no tiene sentido molestar al proveedor.
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("autenticarse NO alcanza para considerarlo configurado", async () => {
    // Es la distinción central: tener la credencial no autoriza a adivinar
    // rutas de datos. Hacen falta credenciales Y contrato verificado.
    vi.stubEnv("CHIPAX_APP_ID", "app-de-prueba")
    vi.stubEnv("CHIPAX_SECRET_KEY", "secreto-de-prueba")
    expect(await provider.isConfigured()).toBe(false)
    vi.unstubAllEnvs()
  })

  it("el motivo del bloqueo nombra el 401 del contrato de datos", () => {
    expect(CHIPAX_CONTRACT_BLOCKER).toMatch(/401/)
  })
})

describe("Chipax — autenticación", () => {
  const provider = getBillingProvider("chipax") as ChipaxProvider

  beforeEach(() => {
    vi.stubEnv("CHIPAX_APP_ID", "app-de-prueba")
    vi.stubEnv("CHIPAX_SECRET_KEY", "secreto-de-prueba")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("envía exactamente {app_id, secret_key} a POST /login", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "no-debe-filtrarse" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    )

    await provider.login()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://api.chipax.com/v2/login")
    expect(init!.method).toBe("POST")
    // Ni un campo de más: agregar propiedades no documentadas es la vía rápida
    // a un 400 inexplicable.
    expect(JSON.parse(String(init!.body))).toEqual({
      app_id: "app-de-prueba",
      secret_key: "secreto-de-prueba",
    })
  })

  it("reporta los NOMBRES de los campos de la respuesta, nunca sus valores", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "jwt-secretísimo", expiresIn: 3600 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    )

    const result = await provider.login()

    expect(result.ok).toBe(true)
    expect(result.responseFields).toEqual(["token", "expiresIn"])
    // El valor del token no puede aparecer en ninguna parte del diagnóstico.
    expect(result.detail).not.toContain("jwt-secretísimo")
    expect(JSON.stringify(result)).not.toContain("jwt-secretísimo")
  })

  it("distingue credencial equivocada (401) de esquema equivocado (400)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Credenciales inválidas" }), { status: 401 }),
    )
    expect((await provider.login()).detail).toMatch(/CHIPAX_APP_ID/)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Parámetros inválidos." }), { status: 400 }),
    )
    expect((await provider.login()).detail).toMatch(/releerlo|parámetros/i)
  })

  it("no expone credenciales cuando la red falla", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED con secret_key=secretísimo"),
    )
    const result = await provider.login()

    expect(result.ok).toBe(false)
    expect(result.detail).not.toContain("secretísimo")
    expect(result.detail).toMatch(/omitido por contener credenciales/i)
  })

  it("aunque el login funcione, sin contrato de datos el healthCheck no dice ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "x" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    )

    const health = await provider.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.detail).toMatch(/Autenticación correcta/)
    expect(health.detail).toMatch(/contrato/i)
  })
})

describe("Carga manual", () => {
  const provider = getBillingProvider("manual")

  it("siempre está disponible: no depende de un servicio externo", async () => {
    expect(await provider.isConfigured()).toBe(true)
    expect((await provider.healthCheck()).ok).toBe(true)
  })

  it("convierte un XML DTE en documento normalizado con la dirección que se le indica", () => {
    const xml = `<?xml version="1.0"?><DTE><Documento><Encabezado>
      <IdDoc><TipoDTE>33</TipoDTE><Folio>5001</Folio><FchEmis>2026-07-02</FchEmis></IdDoc>
      <Emisor><RUTEmisor>78023530-6</RUTEmisor><RznSoc>CHOME</RznSoc></Emisor>
      <Receptor><RUTRecep>76543210-K</RUTRecep><RznSocRecep>CLIENTE</RznSocRecep></Receptor>
      <Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales>
    </Encabezado></Documento></DTE>`

    const asSale = providerInvoiceFromXml(xml, "sale")
    expect(asSale?.direction).toBe("sale")
    expect(asSale?.folio).toBe(5001)
    expect(asSale?.receiverTaxId).toBe("76543210-K")
    // Un XML en mano no prueba nada sobre el estado del documento en el SII.
    expect(asSale?.documentStatus).toBe("unknown")

    expect(providerInvoiceFromXml(xml, "purchase")?.direction).toBe("purchase")
  })

  it("devuelve null ante un XML inválido en vez de un registro a medias", () => {
    expect(providerInvoiceFromXml("<xml/>", "sale")).toBeNull()
  })
})
