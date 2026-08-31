import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// El registro de proveedores es una prueba unitaria. `isProviderEnabled` lee
// settings persistidos, pero no debe abrir el PostgreSQL real del entorno de
// desarrollo: una conexión fuera de servicio quedaba como error no manejado
// después de que `readChipaxConfig` ya había vuelto al entorno.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: async () => [] }),
    }),
  },
}))

import {
  BILLING_PROVIDER_IDS,
  getAllBillingProviders,
  getBillingProvider,
  isProviderEnabled,
  assertCapability,
  providerInvoiceFromXml,
  ChipaxProvider,
} from "../providers"
import { DTE_PAGE_SIZE } from "../providers/chipax"
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

  it("está siempre habilitado por flag (ya opera en producción para Compras)", async () => {
    await expect(isProviderEnabled("factura_en_linea")).resolves.toBe(true)
  })
})

describe("Chipax", () => {
  const provider = getBillingProvider("chipax")

  it("declara solo las capacidades verificadas contra el contrato", () => {
    expect(provider.capabilities.canListIssuedInvoices).toBe(true)
    expect(provider.capabilities.canListBankTransactions).toBe(true)
    // `/compras` existe en el contrato pero no se verificó su forma, y las
    // facturas de proveedor ya las cubre FacturaEnLínea.
    expect(provider.capabilities.canListReceivedInvoices).toBe(false)
    expect(provider.capabilities.canCreateInvoices).toBe(false)
    expect(provider.capabilities.canCreateExpenses).toBe(false)
  })

  it("queda deshabilitado mientras el feature flag esté apagado", async () => {
    await expect(isProviderEnabled("chipax")).resolves.toBe(false)
  })

  it("sin credenciales el healthCheck lo dice y NO llama a la red", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const health = await provider.healthCheck()

    expect(health.ok).toBe(false)
    expect(health.detail).toMatch(/CHIPAX_APP_ID/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe("Chipax — contrato real", () => {
  const TOKEN = "jwt-de-prueba-no-debe-filtrarse"

  function nuevoProveedor() {
    // Instancia nueva por prueba: el token se cachea por instancia.
    return getBillingProvider("chipax") as ChipaxProvider
  }

  function respuesta(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    })
  }

  beforeEach(() => {
    vi.stubEnv("CHIPAX_APP_ID", "app-de-prueba")
    vi.stubEnv("CHIPAX_SECRET_KEY", "secreto-de-prueba")
    vi.stubEnv("BILLING_COMPANY_TAX_ID", "78023530-6")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("autentica con {app_id, secret_key} y autoriza con el prefijo JWT", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ items: [], paginationAttributes: { count: 0, totalPages: 1 } }))

    await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })

    const [loginUrl, loginInit] = fetchMock.mock.calls[0]!
    expect(String(loginUrl)).toBe("https://api.chipax.com/v2/login")
    expect(JSON.parse(String(loginInit!.body))).toEqual({
      app_id: "app-de-prueba", secret_key: "secreto-de-prueba",
    })

    // El contrato exige "JWT <token>". Con "Bearer" la API responde 401.
    const [, dteInit] = fetchMock.mock.calls[1]!
    const headers = dteInit!.headers as Record<string, string>
    expect(headers.Authorization).toBe(`JWT ${TOKEN}`)
    expect(headers.Authorization).not.toMatch(/Bearer/)
  })

  // H-16 (AUDITORIA_BUGS_2026-08-05.md): `space()` sólo cubría el GET, así que
  // una renovación de token disparaba login + consulta pegados contra un
  // límite de 60/min, y el reintento por 401 encadenaba tres.
  it("espacia también el login, no sólo la consulta", async () => {
    const momentos: { url: string; at: number }[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      momentos.push({ url: String(url), at: Date.now() })
      // Token ya vencido al recibirlo: cada consulta obliga a renovar, que es
      // el escenario donde login y GET salían pegados.
      return String(url).endsWith("/login")
        ? respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) - 1 })
        : respuesta({ items: [], paginationAttributes: { count: 0, totalPages: 1 } })
    })

    await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })

    // Login seguido de la consulta: dos solicitudes HTTP reales.
    expect(momentos).toHaveLength(2)
    expect(momentos[0]!.url).toMatch(/\/login$/)
    expect(momentos[1]!.url).toMatch(/\/dtes/)
    // Cada una precedida por su propia espera: sin el fix salían con ~0 ms.
    expect(momentos[1]!.at - momentos[0]!.at).toBeGreaterThanOrEqual(1000)
  }, 20_000)

  it("mapea un DTE de venta al modelo normalizado", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({
        items: [{
          id: 987, tipo: 33, folio: 10424, rut: "76.543.210-K", razonSocial: "MINERA EJEMPLO SPA",
          fechaEmision: "2026-06-11T00:00:00.000Z", fechaVencimiento: "2026-07-11T00:00:00.000Z",
          montoNeto: 4200000, montoExento: 0, iva: 798000, montoTotal: 4998000,
        }],
        paginationAttributes: { count: 46, totalPages: 1 },
      }))

    const page = await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })
    const invoice = page.items[0]!

    expect(invoice.externalId).toBe("chipax:dte:987")
    expect(invoice.direction).toBe("sale")
    expect(invoice.docType).toBe("33")
    expect(invoice.folio).toBe(10424)
    // El emisor de una venta es la propia empresa: Chipax no lo repite.
    expect(invoice.issuerTaxId).toBe("78023530-6")
    expect(invoice.receiverTaxId).toBe("76543210-K")
    expect(invoice.issueDate).toBe("2026-06-11")
    expect(invoice.dueDate).toBe("2026-07-11")
    expect(invoice.totalAmount).toBe(4998000)
    // Chipax no informa estado SII: dejarlo en `unknown` evita pisar el que sí
    // entrega FacturaEnLínea.
    expect(invoice.documentStatus).toBe("unknown")
    expect(page.reportedTotal).toBe(46)
  })

  it("tolera el array plano que declara el contrato y el envoltorio que devuelve la API", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta([{
        id: 1, tipo: 33, folio: 500, rut: "76543210-K", razonSocial: "X",
        fechaEmision: "2026-06-01", fechaVencimiento: null,
        montoNeto: 100, montoExento: 0, iva: 19, montoTotal: 119,
      }]))

    const page = await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.dueDate).toBeNull()
  })

  it("pagina con el cursor y lo cierra en la última página", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ items: [], paginationAttributes: { count: 100, totalPages: 3 } }))

    const primera = await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })
    expect(primera.nextCursor).toBe("2")

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ items: [], paginationAttributes: { count: 100, totalPages: 3 } }))
    const ultima = await nuevoProveedor().listIssuedInvoices({ period: "2026-06", cursor: "3" })
    expect(ultima.nextCursor).toBeNull()
  })

  it("convierte una cartola en movimiento bancario con el signo correcto", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({
        docs: [
          { id: 1, fecha: "2026-07-02T00:00:00.000Z", abono: 1190000, cargo: 0, descripcion: "TRANSF FACT 1234", comentario_transferencia: null, cuenta_corriente_id: 7 },
          { id: 2, fecha: "2026-07-03T00:00:00.000Z", abono: 0, cargo: 50000, descripcion: "COMISION", comentario_transferencia: null, cuenta_corriente_id: 7 },
        ],
        pages: 1, total: 2,
      }))

    const page = await nuevoProveedor().listBankTransactions({ period: "2026-07" })

    expect(page.items[0]!.amount).toBe(1190000)    // abono entra: positivo
    expect(page.items[1]!.amount).toBe(-50000)     // cargo sale: negativo
    expect(page.items[0]!.transactionDate).toBe("2026-07-02")
    expect(page.items[0]!.externalId).toBe("chipax:cartola:1")
    // La cartola no identifica contraparte: no se inventa.
    expect(page.items[0]!.counterpartyTaxId).toBeNull()
    // Es un id interno de cuenta, no un número de cuenta bancaria.
    expect(page.items[0]!.accountRef).toBe("cc:7")
  })

  it("tolera una respuesta de cartolas en arreglo plano", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta([
        { id: 9, fecha: "2026-07-04", abono: 100, cargo: 0, descripcion: "ABONO", comentario_transferencia: null, cuenta_corriente_id: 3 },
      ]))

    const page = await nuevoProveedor().listBankTransactions({ period: "2026-07" })

    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]!.externalId).toBe("chipax:cartola:9")
  })

  it("sin RUT de la empresa se niega a mapear ventas en vez de inventar el emisor", async () => {
    vi.stubEnv("BILLING_COMPANY_TAX_ID", "")
    vi.stubEnv("DTE_PORTAL_RUT_EMP", "")

    await expect(nuevoProveedor().listIssuedInvoices({ period: "2026-06" }))
      .rejects.toThrow(/RUT de la empresa/i)
  })

  it("renueva el token una sola vez ante un 401 y no entra en bucle", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ message: "Unauthorized" }, 401))
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ message: "Unauthorized" }, 401))

    await expect(nuevoProveedor().listIssuedInvoices({ period: "2026-06" })).rejects.toThrow(/HTTP 401/)
    // login + dte + login + dte = 4. Un segundo 401 detiene el flujo.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("reintenta una sola vez ante 429 y falla si el proveedor mantiene el límite", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "0" } }))

    await expect(nuevoProveedor().listBankTransactions({ period: "2026-07" }))
      .rejects.toThrow(/límite de tasa después del reintento/i)
  })

  it("acepta una respuesta después de un único 429", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(respuesta({ docs: [], pages: 1, total: 0 }))

    const page = await nuevoProveedor().listBankTransactions({ period: "2026-07" })
    expect(page.items).toHaveLength(0)
  })

  it("sin paginación fiable, una página llena NO se toma por la última", async () => {
    // Si Chipax alinea `/dtes` con su contrato (array plano) o deja de mandar
    // `paginationAttributes`, asumir una sola página perdía en silencio todo lo
    // que viniera después del documento 50, y la corrida quedaba en verde.
    const lleno = Array.from({ length: DTE_PAGE_SIZE }, (_, index) => ({
      id: index + 1, tipo: 33, folio: 1000 + index, rut: "76543210-K", razonSocial: "X",
      fechaEmision: "2026-06-01", fechaVencimiento: null,
      montoNeto: 100, montoExento: 0, iva: 19, montoTotal: 119,
    }))
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta(lleno))

    const page = await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })

    expect(page.items).toHaveLength(DTE_PAGE_SIZE)
    expect(page.nextCursor).toBe("2")
  })

  it("acepta una página mayor a la observada en vez de fallar la corrida entera", async () => {
    // El tamaño de página es una observación del servidor, no algo que la
    // plataforma pida: si Chipax lo sube, la ingesta no puede caerse a cero.
    const items = Array.from({ length: DTE_PAGE_SIZE * 2 }, (_, index) => ({
      id: index + 1, tipo: 33, folio: 2000 + index, rut: "76543210-K", razonSocial: "X",
      fechaEmision: "2026-06-01", fechaVencimiento: null,
      montoNeto: 100, montoExento: 0, iva: 19, montoTotal: 119,
    }))
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ items, paginationAttributes: { count: 100, totalPages: 1 } }))

    const page = await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })
    expect(page.items).toHaveLength(DTE_PAGE_SIZE * 2)
  })

  it("cartolas: un total declarado mayor al entregado abre la página siguiente", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      // Sin `pages`: el total declarado es la única señal de que falta leer.
      .mockResolvedValueOnce(respuesta({
        docs: [{ id: 9, fecha: "2026-07-04", abono: 100, cargo: 0, descripcion: null, comentario_transferencia: null, cuenta_corriente_id: 3 }],
        total: 180,
      }))

    const page = await nuevoProveedor().listBankTransactions({ period: "2026-07" })
    expect(page.nextCursor).toBe("2")
  })

  it("una fila que no cumple el contrato no se lleva la página completa", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({
        items: [
          // Exenta sin IVA: el dato de borde que hacía fallar el mes entero.
          { id: 1, tipo: 34, folio: 900, rut: "76543210-K", razonSocial: "X", fechaEmision: "2026-06-01", fechaVencimiento: null, montoNeto: 0, montoExento: 100, iva: null, montoTotal: 100 },
          { id: 2, tipo: 33, folio: 901, rut: "76543210-K", razonSocial: "Y", fechaEmision: "2026-06-02", fechaVencimiento: null, montoNeto: 100, montoExento: 0, iva: 19, montoTotal: 119 },
        ],
        paginationAttributes: { count: 2, totalPages: 1 },
      }))

    const page = await nuevoProveedor().listIssuedInvoices({ period: "2026-06" })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.folio).toBe(901)
    // El total declarado se conserva: es lo que el sync compara para marcar la
    // corrida como parcial en vez de darla por completa.
    expect(page.reportedTotal).toBe(2)
  })

  it("un 200 con cuerpo que no es JSON se reporta como respuesta inválida, no como error genérico", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(new Response("<html>Mantención</html>", { status: 200, headers: { "Content-Type": "text/html" } }))

    await expect(nuevoProveedor().listIssuedInvoices({ period: "2026-06" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" })
  })

  it("un 429 sin Retry-After espera un piso antes del único reintento", async () => {
    const esperas: number[] = []
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number) => {
      esperas.push(ms ?? 0)
      callback()
      return 0
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      // Sin cabecera: reintentar de inmediato caía en la misma ventana del límite.
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(respuesta({ docs: [], pages: 1, total: 0 }))

    await nuevoProveedor().listBankTransactions({ period: "2026-07" })

    expect(Math.max(...esperas)).toBeGreaterThanOrEqual(15_000)
  })

  it("rechaza respuestas de contrato inválidas antes de mapearlas", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respuesta({ token: TOKEN, tokenExpiration: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(respuesta({ items: [{ id: 1, tipo: 33 }], paginationAttributes: { totalPages: 1 } }))

    await expect(nuevoProveedor().listIssuedInvoices({ period: "2026-07" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" })
  })

  it("no expone el token ni las credenciales al fallar la autenticación", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(respuesta({ error: "Credenciales inválidas" }, 401))

    const health = await nuevoProveedor().healthCheck()
    expect(health.ok).toBe(false)
    expect(JSON.stringify(health)).not.toContain("secreto-de-prueba")
    expect(health.detail).toMatch(/CHIPAX_APP_ID/)
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

  // VTA-07: un XML cargado a mano puede ser una factura de exportación; escribir
  // "CLP" a pelo convertía 12.000 dólares en 12.000 pesos.
  it("usa la moneda que declara el XML y sólo cae a CLP si no declara ninguna", () => {
    const exportacion = `<?xml version="1.0"?><DTE><Documento><Encabezado>
      <IdDoc><TipoDTE>110</TipoDTE><Folio>77</Folio><FchEmis>2026-07-02</FchEmis></IdDoc>
      <Emisor><RUTEmisor>78023530-6</RUTEmisor><RznSoc>CHOME</RznSoc></Emisor>
      <Receptor><RUTRecep>76543210-K</RUTRecep><RznSocRecep>CLIENTE</RznSocRecep></Receptor>
      <Totales><MntNeto>12000</MntNeto><MntTotal>12000</MntTotal><TpoMoneda>DOLAR USA</TpoMoneda></Totales>
    </Encabezado></Documento></DTE>`

    expect(providerInvoiceFromXml(exportacion, "sale")?.currency).toBe("USD")
    expect(providerInvoiceFromXml(exportacion.replace("<TpoMoneda>DOLAR USA</TpoMoneda>", ""), "sale")?.currency).toBe("CLP")
  })
})
