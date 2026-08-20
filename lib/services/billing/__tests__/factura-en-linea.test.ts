/**
 * Adaptador de FacturaEnLínea: qué se injerta del XML y qué se persiste.
 *
 * El portal se sustituye por mocks de módulo y la base por un stub instalado en
 * `globalThis.__db` ANTES de importar el adaptador (el singleton de `@/db` lo
 * respeta, igual que las pruebas PGlite).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DtePortalClient } from "@/lib/services/dte-portal/client"
import type { DteDocumentRow } from "@/lib/services/dte-portal/types"

const queryByPeriodo = vi.fn()
const downloadDteXml = vi.fn()
const fetchBandejaEntrada = vi.fn()

vi.mock("@/lib/services/dte-portal/query", () => ({
  queryByPeriodo: (...args: unknown[]) => queryByPeriodo(...args),
}))
vi.mock("@/lib/services/dte-portal/download", () => ({
  downloadDteXml: (...args: unknown[]) => downloadDteXml(...args),
}))
vi.mock("@/lib/services/dte-portal/bandeja-entrada", () => ({
  fetchBandejaEntrada: (...args: unknown[]) => fetchBandejaEntrada(...args),
}))

// `hydrateKnownSales` consulta la base; acá nunca hay nada persistido.
const dbStub = {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }) }),
}
;(globalThis as unknown as { __db: unknown }).__db = dbStub

const { FacturaEnLineaProvider } = await import("../providers/factura-en-linea")

const client = {
  credentials: { rutUsr: "1-9", rutEmp: "78023530-6", clave: "clave-secreta", codEmp: "433" },
} as unknown as DtePortalClient

function fila(overrides: Partial<DteDocumentRow> = {}): DteDocumentRow {
  return {
    rowId: null,
    estadoSii: "aceptado",
    estadoIntercambio: null,
    fecha: "2026-07-15",
    tipoDoc: "33",
    folio: 1234,
    razonSocial: "MINERA EJEMPLO SPA",
    estado: "Enviado",
    montoNeto: 4200000,
    montoTotal: 4998000,
    pdfUrl: "pdf_dte.php?post=abc+def&Ced=1",
    xmlUrl: "estadodoc.php?codemp=433&folio=1234&tipodoc=33",
    rutEmisor: null,
    codEmp: "433",
    ...overrides,
  }
}

function documento(options: {
  docType?: string
  folio?: number
  issuerTaxId?: string
  receiverTaxId?: string
  currency?: string
} = {}): string {
  const moneda = options.currency ? `<TpoMoneda>${options.currency}</TpoMoneda>` : ""
  return `<Documento ID="F${options.folio ?? 1234}">
    <Encabezado>
      <IdDoc><TipoDTE>${options.docType ?? "33"}</TipoDTE><Folio>${options.folio ?? 1234}</Folio>
        <FchEmis>2026-07-15</FchEmis><FchVenc>2026-08-14</FchVenc></IdDoc>
      <Emisor><RUTEmisor>${options.issuerTaxId ?? "78023530-6"}</RUTEmisor><RznSoc>CHOME</RznSoc></Emisor>
      <Receptor><RUTRecep>${options.receiverTaxId ?? "76543210-K"}</RUTRecep>
        <RznSocRecep>MINERA EJEMPLO SPA</RznSocRecep></Receptor>
      <Totales><MntNeto>4200000</MntNeto><IVA>798000</IVA><MntTotal>4998000</MntTotal>${moneda}</Totales>
    </Encabezado>
  </Documento>`
}

function sobre(...documentos: string[]): string {
  return `<?xml version="1.0" encoding="ISO-8859-1"?><EnvioDTE><SetDTE>${
    documentos.map((doc) => `<DTE version="1.0">${doc}</DTE>`).join("")
  }</SetDTE></EnvioDTE>`
}

async function ventas(row: DteDocumentRow, xml: string) {
  queryByPeriodo.mockResolvedValue({ docs: [row], totalDocs: 1 })
  downloadDteXml.mockResolvedValue({ xml, buffer: Buffer.from(xml) })
  const page = await new FacturaEnLineaProvider(client).listIssuedInvoices({ period: "2026-07" })
  return page.items[0]!
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("FacturaEnLínea — enriquecimiento desde el XML", () => {
  it("injerta el XML cuando corresponde al mismo documento", async () => {
    const invoice = await ventas(fila(), sobre(documento()))

    expect(invoice.receiverTaxId).toBe("76543210-K")
    expect(invoice.dueDate).toBe("2026-08-14")
  })

  it("descarta el XML de otro documento en vez de injertar su receptor", async () => {
    const invoice = await ventas(
      fila(),
      sobre(documento({ folio: 1111, receiverTaxId: "77111222-3" })),
    )

    expect(invoice.receiverTaxId).toBeNull()
    expect(invoice.dueDate).toBeNull()
  })

  it("elige su documento dentro de un sobre cuyo primer DTE es ajeno", async () => {
    // El sobre trae dos documentos y el propio es el SEGUNDO: se selecciona por
    // identidad, no por posición, así que sí se enriquece.
    const invoice = await ventas(
      fila(),
      sobre(documento({ folio: 1111, receiverTaxId: "77111222-3" }), documento()),
    )

    expect(invoice.receiverTaxId).toBe("76543210-K")
  })

  it("no injerta nada si el sobre multi-documento no trae el folio pedido", async () => {
    const invoice = await ventas(
      fila(),
      sobre(
        documento({ folio: 1111, receiverTaxId: "77111222-3" }),
        documento({ folio: 2222, receiverTaxId: "77333444-5" }),
      ),
    )

    expect(invoice.receiverTaxId).toBeNull()
    expect(invoice.dueDate).toBeNull()
  })

  it("conserva la moneda del listado si el XML declara una desconocida", async () => {
    const invoice = await ventas(
      fila({ tipoDoc: "110", folio: 900, montoNeto: 5000, montoTotal: 5000 }),
      sobre(documento({ docType: "110", folio: 900, currency: "MONEDA MARCIANA" })),
    )

    expect(invoice.currency).toBe("CLP")
  })

  it("usa la moneda declarada por el documento y no la asume CLP", async () => {
    const invoice = await ventas(
      fila({ tipoDoc: "110", folio: 900, montoNeto: 5000, montoTotal: 5000 }),
      sobre(documento({ docType: "110", folio: 900, currency: "DOLAR USA" })),
    )

    expect(invoice.currency).toBe("USD")
  })
})

describe("FacturaEnLínea — URL persistida del documento", () => {
  it("no persiste las credenciales del portal en document_url", async () => {
    const invoice = await ventas(
      fila({ pdfUrl: "pdf_dte.php?post=abc+def&clave=clave-secreta&rut_usr=1-9&rut_emp=78023530-6&Ced=1" }),
      sobre(documento()),
    )

    expect(invoice.documentUrl).toBe("pdf_dte.php?post=abc+def&Ced=1")
  })

  it("conserva verbatim la URL que no trae credenciales", async () => {
    const invoice = await ventas(fila(), sobre(documento()))

    expect(invoice.documentUrl).toBe("pdf_dte.php?post=abc+def&Ced=1")
  })
})

describe("FacturaEnLínea — completitud de la Bandeja de Entrada", () => {
  const bandeja = {
    fechaRecepcion: "2026-07-15 10:00",
    estadoPlataforma: "Recibido",
    fecha: "2026-07-15",
    tipoDoc: "33",
    folio: 88,
    rutEmisor: "76.987.654-3",
    razonSocial: "PROVEEDOR SPA",
    montoTotal: 119000,
    tipoRef: null,
    folioRef: null,
    fechaRef: null,
    nreguist: "9000001",
    pdfUrl: null,
    xmlUrl: null,
  }

  // ORQ-01: `totalRegistros` se rellena con `rows.length` cuando el portal no
  // declara el total, así que entregarlo como total del proveedor hace que el
  // sync compare un número contra sí mismo y cierre en éxito una corrida que
  // nadie pudo verificar. Se propaga `declaredTotal`.
  it("no declara un total propio cuando el portal no declaró ninguno", async () => {
    fetchBandejaEntrada.mockResolvedValue({ rows: [bandeja], totalRegistros: 1, declaredTotal: null })

    const page = await new FacturaEnLineaProvider(client).listReceivedInvoices({ period: "2026-07" })

    expect(page.items).toHaveLength(1)
    expect(page.reportedTotal).toBeNull()
  })

  it("propaga el total declarado por el portal aunque no calce con las filas leídas", async () => {
    fetchBandejaEntrada.mockResolvedValue({ rows: [bandeja], totalRegistros: 4, declaredTotal: 4 })

    const page = await new FacturaEnLineaProvider(client).listReceivedInvoices({ period: "2026-07" })

    expect(page.reportedTotal).toBe(4)
  })

  // ORQ-03: los warns de fila descartada necesitan el período para poder
  // reconstruir qué se perdió y de qué consulta.
  it("entrega contexto de diagnóstico al raspado de la bandeja", async () => {
    fetchBandejaEntrada.mockResolvedValue({ rows: [], totalRegistros: 0, declaredTotal: 0 })

    await new FacturaEnLineaProvider(client).listReceivedInvoices({ period: "2026-07" })

    expect(fetchBandejaEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ anio: "2026", mes: "07", codEmp: "433" }),
      expect.objectContaining({ periodo: "2026-07" }),
    )
  })
})
