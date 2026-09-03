import ExcelJS from "exceljs"
import { describe, it, expect, vi } from "vitest"

import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildTrazabilidadReportData } from "@/lib/services/trazabilidad-export-format"

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

/**
 * El export dejó de ser la tabla plana de trazabilidad y pasó a ser la vista
 * consolidada por faena (solicitado → pedido → recibido → despachado → en faena
 * → entregado → pendiente), con hoja «Trazabilidad por Faena». Este test sigue
 * cubriendo lo mismo que antes —que el dato llega intacto al libro y que los
 * vacíos no se rellenan con ceros inventados— sobre el contrato nuevo.
 */
describe("trazabilidad Excel export", () => {
  const row = {
    productName: "Producto, con coma",
    productSku: "SKU-001",
    worksiteName: "Faena Mininco",
    requestCode: "SO/2026/0001",
    requestDate: "2026-08-10T00:00:00.000Z",
    requesterName: "Ana Solicitante",
    categoryName: "EPP",
    uom: "par",
    requested: 20,
    approved: null,
    inOc: 20,
    suppliers: "Proveedor X",
    ocCodes: "OC-2026-0001",
    receivedOffice: 15,
    dispatched: 10,
    receivedFaena: 10,
    stockInFaena: 4,
    delivered: 6,
    pendingTotal: 14,
    notYetOrdered: 0,
    pendingFromSupplier: 5,
    inOffice: 5,
    inTransit: 0,
    inFaenaAvailable: 4,
    received: 10,
    status: "partially_delivered",
    alert: true,
  }

  async function loadSheet(rows: Parameters<typeof buildTrazabilidadReportData>[0]) {
    const buffer = await buildXlsxBuffer(buildTrazabilidadReportData(rows))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)
    return workbook.getWorksheet("Trazabilidad por Faena")
  }

  it("builds workbook-compatible report data", async () => {
    const worksheet = await loadSheet([row])

    expect(worksheet).toBeDefined()
    expect(worksheet?.getRow(1).values).toEqual([
      undefined,
      "Faena", "Solicitud", "Fecha", "Solicitante", "Categoría",
      "Producto", "SKU", "Unidad",
      "Solicitado", "Aprobado", "En OC", "Proveedores", "Órdenes de Compra",
      "Recibido Oficina", "Despachado a Faena", "Recibido Faena", "Stock en Faena",
      "Entregado", "Pendiente Total", "Pend. Compra", "Pend. Proveedor",
      "En Oficina", "En Camino", "En Faena por Entregar",
      "Estado Consolidado", "Alerta",
    ])

    // La coma del nombre no parte la celda: era el punto del test original,
    // cuando el export todavía pasaba por CSV.
    expect(worksheet?.getCell("F2").value).toBe("Producto, con coma")
    expect(worksheet?.getCell("B2").value).toBe("SO/2026/0001")
    expect(worksheet?.getCell("Z2").value).toBe("Sí")
  })

  it("recorre la etapa completa de cada ítem en su propia columna", async () => {
    const worksheet = await loadSheet([row])

    // Las etapas son columnas separadas a propósito: «15 pendientes» no dice
    // dónde están esas unidades, y eso es lo que la vista vino a responder.
    expect(worksheet?.getCell("I2").value).toBe(20)   // Solicitado
    expect(worksheet?.getCell("K2").value).toBe(20)   // En OC
    expect(worksheet?.getCell("N2").value).toBe(15)   // Recibido oficina
    expect(worksheet?.getCell("O2").value).toBe(10)   // Despachado a faena
    expect(worksheet?.getCell("Q2").value).toBe(4)    // Stock en faena
    expect(worksheet?.getCell("R2").value).toBe(6)    // Entregado
    expect(worksheet?.getCell("V2").value).toBe(5)    // Pendiente en oficina
  })

  it("deja vacías las cantidades desconocidas en vez de escribir cero", async () => {
    // Un cero afirma «no hay»; el vacío dice «no se sabe». Confundirlos haría
    // leer un aprobado ausente como un rechazo.
    const worksheet = await loadSheet([{
      productName: "Casco",
      productSku: null,
      worksiteName: "Faena Mininco",
      requestCode: "SO/2026/0002",
      requested: 5,
      approved: null,
      inOc: 0,
      received: 0,
      status: "requested",
      alert: false,
    }])

    expect(worksheet?.getCell("J2").value).toBe("")   // Aprobado desconocido
    expect(worksheet?.getCell("G2").value).toBe("")   // Sin SKU
    expect(worksheet?.getCell("Q2").value).toBe("")   // Stock en faena desconocido
    expect(worksheet?.getCell("Z2").value).toBe("No")
    // Lo que sí se sabe sigue siendo numérico.
    expect(worksheet?.getCell("I2").value).toBe(5)
    expect(worksheet?.getCell("S2").value).toBe(5)    // Pendiente total = solicitado
  })
})
