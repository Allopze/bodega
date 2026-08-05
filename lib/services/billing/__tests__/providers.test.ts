import { describe, it, expect } from "vitest"
import {
  BILLING_PROVIDER_IDS,
  getAllBillingProviders,
  getBillingProvider,
  isProviderEnabled,
  assertCapability,
  providerInvoiceFromXml,
  CHIPAX_CONTRACT_BLOCKER,
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

  it("no declara ninguna capacidad mientras el contrato no sea legible", () => {
    for (const value of Object.values(provider.capabilities)) {
      expect(value).toBe(false)
    }
  })

  it("queda deshabilitado sin flag y sin contrato verificado", () => {
    expect(isProviderEnabled("chipax")).toBe(false)
  })

  it("el healthCheck reporta el bloqueo en vez de fingir salud", async () => {
    const health = await provider.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.detail.length).toBeGreaterThan(0)
    expect(health.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("no se considera configurado solo por tener credenciales", async () => {
    expect(await provider.isConfigured()).toBe(false)
  })

  it("el motivo del bloqueo nombra el 401 del contrato", () => {
    expect(CHIPAX_CONTRACT_BLOCKER).toMatch(/401/)
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
