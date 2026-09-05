import ExcelJS from "exceljs"
import { describe, it, expect, vi } from "vitest"

import { buildXlsxBuffer } from "@/lib/reports/export"
import {
  buildTrazabilidadConsolidadaReportData,
  buildTrazabilidadReportData,
} from "@/lib/services/trazabilidad-export-format"
import type { ConsolidatedOrder } from "@/lib/services/trazabilidad-consolidated.types"

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
    status: "Parcialmente entregado",
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
      ...row,
      productName: "Casco",
      productSku: null,
      requestCode: "SO/2026/0002",
      requested: 5,
      approved: null,
      inOc: 0,
      stockInFaena: null,
      delivered: 0,
      pendingTotal: 5,
      status: "Solicitado",
      alert: false,
    }])

    expect(worksheet?.getCell("J2").value).toBe("")   // Aprobado desconocido
    expect(worksheet?.getCell("G2").value).toBe("")   // Sin SKU
    expect(worksheet?.getCell("Q2").value).toBe("")   // Sin producto de catálogo: stock desconocido
    expect(worksheet?.getCell("Z2").value).toBe("No")
    // Lo que sí se sabe sigue siendo numérico.
    expect(worksheet?.getCell("I2").value).toBe(5)
    expect(worksheet?.getCell("S2").value).toBe(5)    // Pendiente total = solicitado
  })
})

describe("buildTrazabilidadConsolidadaReportData", () => {
  const line = {
    itemId: "item-1",
    requestId: "req-1",
    requestCode: "SOL-0001",
    requestDate: "2026-08-01T12:00:00.000Z",
    requesterId: "u-1",
    requesterName: "Ana Solicitante",
    deliveryMode: "via_oficina",
    urgency: null,
    requestUrgency: "normal",
    worksiteId: "ws-1",
    worksiteName: "Faena Uno",
    productId: "prod-1",
    productName: "Bota de seguridad",
    productSku: "BOTA-01",
    categoryId: "cat-1",
    categoryName: "Calzado",
    notes: null,
    uom: "par",
    requested: 6,
    approved: 6,
    inOc: 6,
    receivedOffice: 4,
    receivedFaena: 4,
    dispatched: 4,
    stockInFaena: 0,
    delivered: 4,
    pendingTotal: 2,
    pendingBreakdown: {
      pendingTotal: 2, notYetOrdered: 0, pendingFromSupplier: 2,
      inOffice: 0, inTransit: 0, inFaenaAvailable: 0,
    },
    computedStatus: "parcialmente_entregado" as const,
    computedStatusLabel: "Parcialmente entregado",
    computedStatusColor: "warning" as const,
    supplierNames: ["Proveedor Uno"],
    ocCodes: [],
    lastUpdated: "2026-08-04T12:00:00.000Z",
    alert: false,
    timeline: [],
  }

  const orders: ConsolidatedOrder[] = [
    {
      orderId: "po-1",
      code: "OC-2026-0001",
      supplierName: "Proveedor Uno",
      orderStatus: "sent",
      requestIds: ["req-1"],
      lineIds: ["item-1"],
      lineCount: 1,
      quantitiesByUom: [{ uom: "par", inOc: 6, receivedOffice: 4, receivedFaena: 4 }],
      lastUpdated: "2026-08-04T12:00:00.000Z",
    },
  ]

  const report = buildTrazabilidadConsolidadaReportData({
    requests: [{
      requestId: "req-1",
      requestCode: "SOL-0001",
      requestDate: "2026-08-01T12:00:00.000Z",
      requesterId: "u-1",
      requesterName: "Ana Solicitante",
      worksiteId: "ws-1",
      worksiteName: "Faena Uno",
      deliveryMode: "via_oficina",
      urgency: "normal",
      lineCount: 1,
      orderCount: 1,
      orders,
      lines: [line],
      quantitiesByUom: [{ uom: "par", requested: 6, approved: 6, inOc: 6, receivedOffice: 4, receivedFaena: 4, delivered: 4, pendingTotal: 2 }],
      status: "parcialmente_entregado",
      statusLabel: "Parcialmente entregado",
      statusColor: "warning",
      statusCounts: { parcialmente_entregado: 1 },
      pendingTotal: 2,
      hasPending: true,
      alert: false,
      lastUpdated: "2026-08-04T12:00:00.000Z",
    }],
    orders,
    meta: { truncado: true },
  })

  it("genera hojas por solicitud, ordenes y detalle de lineas", async () => {
    const buffer = await buildXlsxBuffer(report)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)

    const names = workbook.worksheets.map((sheet) => sheet.name)
    expect(names).toContain("Solicitudes")
    expect(names).toContain("Órdenes de compra")
    expect(names).toContain("Detalle de líneas")
    // TR-F3: el libro expone su propio alcance en una hoja de metadatos.
    expect(names).toContain("Metadatos")
    // OP-02: el truncamiento se anuncia dentro del propio libro.
    expect(names).toContain("Advertencias")

    // La hoja de metadatos refleja el filtro de faena y el truncamiento.
    const metaSheet = workbook.getWorksheet("Metadatos")
    const metaRows = Array.from(metaSheet?.getRows(2, metaSheet?.rowCount ?? 0) ?? []).map((r) => [
      r.getCell(1).value,
      r.getCell(2).value,
    ])
    const metaObj = Object.fromEntries(metaRows)
    expect(metaObj["Truncado por límite de filas"]).toBe("Sí")
    expect(metaObj["Desde"]).toBe("(sin límite)")

    // Una solicitud genera una fila en "Solicitudes" (encabezado + 1).
    const requestsSheet = workbook.getWorksheet("Solicitudes")
    expect(requestsSheet?.rowCount).toBe(2)
    expect(requestsSheet?.getCell("B2").value).toBe("SOL-0001")

    // La OC compartida aparece una sola vez en su hoja.
    const ordersSheet = workbook.getWorksheet("Órdenes de compra")
    expect(ordersSheet?.rowCount).toBe(2)
    expect(ordersSheet?.getCell("A2").value).toBe("OC-2026-0001")
    // TR-I3: el estado de la OC se exporta con el vocabulario en español, no
    // con el valor crudo de la columna ("sent").
    expect(ordersSheet?.getCell("C2").value).toBe("Pendiente de recepción")

    // El detalle de líneas conserva la evidencia por ítem.
    const linesSheet = workbook.getWorksheet("Detalle de líneas")
    expect(linesSheet?.rowCount).toBe(2)
    expect(linesSheet?.getCell("C2").value).toBe("Bota de seguridad")
  })
})
