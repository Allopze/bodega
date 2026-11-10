import { describe, expect, it } from "vitest"
import { buildOcPdfRows, countPendingCostLines, pendingCostNotice } from "./oc-pdfcn-rows"
import type { OcPrintData } from "./oc-print-data"

type Item = OcPrintData["order"]["items"][number]

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "it-1",
    productId: null,
    productNameFree: "Producto libre",
    quantity: 1,
    unitOfMeasure: "unidad",
    unitPrice: 1000,
    discount: null,
    subtotal: 1000,
    notes: null,
    sortOrder: 0,
    requestItem: null,
    ...overrides,
  } as unknown as Item
}

function data(items: Item[], productMap: OcPrintData["productMap"] = {}): OcPrintData {
  return { order: { items }, productMap } as unknown as OcPrintData
}

describe("buildOcPdfRows", () => {
  it("numera las filas con dos dígitos y resuelve el producto del catálogo", () => {
    const rows = buildOcPdfRows(
      data(
        [item({ productId: "p-1" }), item({ id: "it-2" })],
        { "p-1": { id: "p-1", sku: "SKU-9", name: "Guante de cuero" } },
      ),
    )

    expect(rows[0]).toMatchObject({ n: "01", sku: "SKU-9", nombre: "Guante de cuero" })
    // Sin producto de catálogo cae al nombre libre, como la vista de impresión.
    expect(rows[1]).toMatchObject({ n: "02", sku: "", nombre: "Producto libre" })
  })

  it("cae a un nombre explícito cuando no hay catálogo ni texto libre", () => {
    const rows = buildOcPdfRows(data([item({ productNameFree: null })]))
    expect(rows[0]?.nombre).toBe("Producto sin nombre")
  })

  it("apila las sub-notas del Detalle en el orden de la vista de impresión", () => {
    const rows = buildOcPdfRows(data([item({
      notes: "Entregar en portería",
      requestItem: {
        equipment: { code: "EQ-01", name: "Retroexcavadora", serialNumber: "SN-7" },
        worker:    { firstName: "Ana", lastName: "Pérez" },
        attributes: [
          { id: "a1", attributeName: "Talla", value: "L" },
          { id: "a2", attributeName: "Color", value: "Azul" },
        ],
      },
    } as unknown as Partial<Item>)]))

    expect(rows[0]?.notas).toEqual([
      "Equipo: EQ-01 · Retroexcavadora · N° serie SN-7",
      "Colaborador: Ana Pérez",
      "Talla: L",
      "Color: Azul",
      "Entregar en portería",
    ])
  })

  describe("«Equipo: …» de un repuesto pedido para un equipo de flota y una OT (FF-7)", () => {
    const withVehicle = (requestItem: Record<string, unknown>) =>
      buildOcPdfRows(data([item({ requestItem: { equipment: null, worker: null, attributes: [], ...requestItem } } as unknown as Partial<Item>)]))[0]!.notas

    it("dice el código y la patente del equipo y el folio de la OT, como el detalle de la OC", () => {
      expect(withVehicle({ vehicle: { code: "KA-54", plate: "UD-1187" }, workOrder: { folio: "OT-PAC-0006" } }))
        .toEqual(["Equipo: KA-54 · UD-1187 · OT OT-PAC-0006"])
    })

    it("sin código de equipo usa sólo la patente; sin OT no nombra una OT", () => {
      expect(withVehicle({ vehicle: { code: null, plate: "UD-1187" }, workOrder: { folio: "OT-PAC-0006" } }))
        .toEqual(["Equipo: UD-1187 · OT OT-PAC-0006"])
      expect(withVehicle({ vehicle: { code: "KA-54", plate: "UD-1187" }, workOrder: null }))
        .toEqual(["Equipo: KA-54 · UD-1187"])
    })

    it("va primero, antes del colaborador, los atributos y las notas de la línea", () => {
      const rows = buildOcPdfRows(data([item({
        notes: "Entregar en portería",
        requestItem: {
          equipment: null,
          vehicle: { code: "KA-54", plate: "UD-1187" }, workOrder: { folio: "OT-PAC-0006" },
          worker: { firstName: "Ana", lastName: "Pérez" },
          attributes: [{ id: "a1", attributeName: "Talla", value: "L" }],
        },
      } as unknown as Partial<Item>)]))
      expect(rows[0]?.notas).toEqual([
        "Equipo: KA-54 · UD-1187 · OT OT-PAC-0006", "Colaborador: Ana Pérez", "Talla: L", "Entregar en portería",
      ])
    })

    it("el instrumento de un servicio conserva su serie y no arrastra OT", () => {
      expect(withVehicle({
        equipment: { code: "EQ-01", name: "Retroexcavadora", serialNumber: "SN-7" },
        vehicle: null, workOrder: { folio: "OT-PAC-0006" },
      })).toEqual(["Equipo: EQ-01 · Retroexcavadora · N° serie SN-7"])
    })

    it("una línea sin equipo ni vehículo no dibuja la línea", () => {
      expect(withVehicle({ vehicle: null, workOrder: { folio: "OT-PAC-0006" } })).toEqual([])
    })
  })

  it("una línea catalogada como repuesto dice el nombre, el SKU y su N° de parte una sola vez", () => {
    // Compras la catalogó al armar la OC: conserva el texto y el N° de parte libres.
    const rows = buildOcPdfRows(data([item({
      productId: "rpt-1",
      productNameFree: "filtro aceite cat",
      requestItem: {
        equipment: null, worker: null,
        attributes: [
          { id: "a1", attributeName: "N° de Parte", value: "1r 0750" },
          { id: "a2", attributeName: "Equipo", value: "Camión KA-135" },
        ],
      },
    } as unknown as Partial<Item>)], {
      "rpt-1": { id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", isSparePart: true, partNumber: "1R-0750" },
    }))

    expect(rows[0]).toMatchObject({ sku: "RPT-001", nombre: "Filtro de aceite" })
    expect(rows[0]?.notas).toEqual(["N° de parte: 1R-0750", "Equipo: Camión KA-135"])
  })

  it("omite el número de serie cuando no lo hay", () => {
    const rows = buildOcPdfRows(data([item({
      requestItem: { equipment: { code: "EQ-02", name: "Compactador", serialNumber: null }, worker: null, attributes: [] },
    } as unknown as Partial<Item>)]))

    expect(rows[0]?.notas).toEqual(["Equipo: EQ-02 · Compactador"])
  })

  it("descarta atributos con nombre o valor en blanco", () => {
    const rows = buildOcPdfRows(data([item({
      requestItem: {
        equipment: null, worker: null,
        attributes: [
          { id: "a1", attributeName: "  ", value: "L" },
          { id: "a2", attributeName: "Color", value: "   " },
          { id: "a3", attributeName: "Talla", value: "M" },
        ],
      },
    } as unknown as Partial<Item>)]))

    expect(rows[0]?.notas).toEqual(["Talla: M"])
  })

  it("una línea sin precio se imprime 'Por definir', nunca 0", () => {
    // Un 0 impreso es un compromiso de que no se cobra.
    const rows = buildOcPdfRows(data([item({ unitPrice: null, subtotal: null })]))
    expect(rows[0]?.unitario).toBe("Por definir")
    expect(rows[0]?.total).toBe("Por definir")
  })

  it("normaliza la unidad y formatea cantidad, descuento y total", () => {
    const rows = buildOcPdfRows(data([item({
      quantity: 2.5, unitOfMeasure: "unidades", discount: 10, unitPrice: 1500, subtotal: 3375,
    })]))

    expect(rows[0]).toMatchObject({
      cantidad: "2,50", unidad: "UN", unitario: "1.500,00", descuento: "10%", total: "3.375",
    })
  })

  it("un descuento ausente o cero deja la celda vacía", () => {
    expect(buildOcPdfRows(data([item({ discount: undefined })]))[0]?.descuento).toBe("")
    expect(buildOcPdfRows(data([item({ discount: 0 })]))[0]?.descuento).toBe("")
  })
})

describe("líneas con costo pendiente", () => {
  it("cuenta solo las que no tienen precio unitario", () => {
    const d = data([item(), item({ unitPrice: null }), item({ unitPrice: null })])
    expect(countPendingCostLines(d)).toBe(2)
  })

  it("redacta el aviso en singular, plural, o no lo redacta", () => {
    expect(pendingCostNotice(0)).toBeNull()
    expect(pendingCostNotice(1)).toBe("1 servicio con costo por definir, no incluido en los totales.")
    expect(pendingCostNotice(3)).toBe("3 servicios con costo por definir, no incluidos en los totales.")
  })
})
