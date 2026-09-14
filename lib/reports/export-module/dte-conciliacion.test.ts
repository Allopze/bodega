import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireDteCodEmp: vi.fn(),
  docs: [] as unknown[],
  invoices: [] as unknown[],
  orders: [] as unknown[],
  call: 0,
}))

vi.mock("@/lib/services/dte-portal/require-cod-emp", () => ({
  requireDteCodEmp: () => mocks.requireDteCodEmp(),
}))
// Las tres consultas del reporte comparten forma; se devuelven por orden de
// llamada, que es el orden en que el módulo las hace: docs, facturas, órdenes.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const n = mocks.call++
          const rows = n === 0 ? mocks.docs : n === 1 ? mocks.invoices : mocks.orders
          return Object.assign(Promise.resolve(rows), {
            orderBy: () => ({ limit: () => Promise.resolve(rows) }),
          })
        },
      }),
    }),
  },
}))
vi.mock("@/db/schema", () => ({ dteDocuments: {}, purchaseOrderInvoices: {}, purchaseOrders: {} }))
vi.mock("./utils", () => ({ buildDateFilter: () => undefined }))

const { dteConciliacion } = await import("./dte-conciliacion")
const { buildXlsxBuffer } = await import("./excel-builder")

const doc = (folio: number, invoiceId: string) => ({
  tipoDte: "33", folio, fechaEmision: "2026-08-20", rutEmisor: "86887200-4",
  razonSocialEmisor: "APRO", montoTotal: 110670, purchaseOrderInvoiceId: invoiceId,
})

describe("dteConciliacion · evidencia del vínculo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireDteCodEmp.mockResolvedValue("433")
    mocks.call = 0
    mocks.docs = [doc(1, "inv-1"), doc(2, "inv-2"), doc(3, "inv-3")]
    mocks.invoices = [
      { id: "inv-1", invoiceNumber: "1", amount: 110670, purchaseOrderId: "oc-1", linkMethod: "dte_candidate", linkOrderReference: "exact" },
      { id: "inv-2", invoiceNumber: "2", amount: 110670, purchaseOrderId: "oc-1", linkMethod: "dte_candidate", linkOrderReference: "year" },
      { id: "inv-3", invoiceNumber: "3", amount: 110670, purchaseOrderId: "oc-1", linkMethod: "manual_upload", linkOrderReference: null },
    ]
    mocks.orders = [{ id: "oc-1", code: "OC-2026-0026" }]
  })

  it("agrega una columna por cómo se vinculó y otra por lo que citó el proveedor", async () => {
    const report = await dteConciliacion(null, {}, 100)

    expect(report.headers).toContain("Vinculación")
    expect(report.headers).toContain("Referencia del proveedor")
    const via = report.headers.indexOf("Vinculación")
    const ref = report.headers.indexOf("Referencia del proveedor")
    expect(report.rows[0]![via]).toBe("Desde el portal")
    expect(report.rows[0]![ref]).toBe("Cita esta OC")
    expect(report.rows[1]![ref]).toBe("Sólo el año")
  })

  it("dice 'sin XML' y no 'no citó' cuando la factura se cargó a mano", async () => {
    // Nadie miró un XML: afirmar que el proveedor no citó nada sería inventarlo.
    const report = await dteConciliacion(null, {}, 100)
    const ref = report.headers.indexOf("Referencia del proveedor")

    expect(report.rows[2]![ref]).toBe("Sin XML")
  })

  it("resume en una hoja aparte cuántas facturas se adjuntaron sin cita utilizable", async () => {
    const report = await dteConciliacion(null, {}, 100)
    const resumen = report.sheets?.find((s) => /calidad/i.test(s.worksheetName))

    expect(resumen).toBeDefined()
    const fila = (etiqueta: string) => resumen!.rows.find((r) => r[0] === etiqueta)
    expect(fila("Cita esta OC")?.[1]).toBe(1)
    expect(fila("Sólo el año")?.[1]).toBe(1)
    expect(fila("Sin XML")?.[1]).toBe(1)
    expect(fila("Total")?.[1]).toBe(3)
  })

  // El defecto que esto fija vivía justo en esta costura: los tests de arriba miran el
  // objeto `ReportData` y nunca el workbook, así que nadie notó que `buildXlsxBuffer`
  // descartaba la hoja primaria cuando el reporte declaraba una suplementaria. El archivo
  // que se descargaba traía sólo "Calidad de la referencia" —dos columnas de conteo— sin
  // la conciliación ni la discrepancia, que es el contenido del reporte.
  it("exporta el libro con la conciliación y la hoja de calidad, no sólo la segunda", async () => {
    const report = await dteConciliacion(null, {}, 100)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await buildXlsxBuffer(report))

    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      "Conciliación OC-Factura-DTE",
      "Calidad de la referencia",
    ])

    const conciliacion = workbook.getWorksheet("Conciliación OC-Factura-DTE")!
    const encabezados = (conciliacion.getRow(1).values as unknown[]).slice(1)
    expect(encabezados).toEqual(report.headers)
    expect(conciliacion.rowCount).toBe(report.rows.length + 1)

    // La discrepancia es la razón de ser del reporte: 110.670 de DTE contra 110.670 de
    // factura da 0, y esa celda tiene que llegar al archivo.
    const discrepancia = report.headers.indexOf("Discrepancia") + 1
    expect(conciliacion.getRow(2).getCell(discrepancia).value).toBe(0)
  })
})
