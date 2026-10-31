import { describe, expect, it } from "vitest"
import { INVOICE_FILTER_KEYS, invoiceEquipmentLabel, parseInvoiceParams } from "./invoice-params"

describe("parseInvoiceParams", () => {
  it("lee los nombres nuevos", () => {
    expect(parseInvoiceParams({ q: " F-881204 ", faena: "ws-1", equipo: "veh-1", estado: "draft", servicio: "TAE", proveedor: "sup-1", productoId: "p-1", pagina: "3" })).toEqual({
      q: "F-881204", faena: "ws-1", equipo: "veh-1", estado: "draft", servicio: "TAE", proveedor: "sup-1", producto: "", productoId: "p-1", pagina: 3,
    })
  })

  it("los nombres de antes del rediseño siguen valiendo: la página puente no pierde el filtro en silencio", () => {
    expect(parseInvoiceParams({ status: "reconciled", service: "TCT", vehicle: "veh-9", page: "2" })).toMatchObject({
      estado: "reconciled", servicio: "TCT", equipo: "veh-9", pagina: 2,
    })
  })

  it("el nombre nuevo manda sobre el antiguo", () => {
    expect(parseInvoiceParams({ estado: "draft", status: "cancelled" }).estado).toBe("draft")
  })

  it("ignora un estado o un tipo de tarjeta que no existen, y las claves heredadas del prototipo de Object", () => {
    expect(parseInvoiceParams({ estado: "constructor", servicio: "toString" })).toMatchObject({ estado: "", servicio: "" })
    expect(parseInvoiceParams({ estado: "SUBMITTED" }).estado).toBe("")
  })

  it("una página inválida vuelve a la primera", () => {
    expect(parseInvoiceParams({ pagina: "0" }).pagina).toBe(1)
    expect(parseInvoiceParams({ pagina: "abc" }).pagina).toBe(1)
    expect(parseInvoiceParams({}).pagina).toBe(1)
  })

  it("toma el primer valor cuando el parámetro se repite", () => {
    expect(parseInvoiceParams({ faena: ["ws-1", "ws-2"] }).faena).toBe("ws-1")
  })

  it("enumera los filtros que cuentan como activos", () => {
    expect([...INVOICE_FILTER_KEYS]).toEqual(["faena", "equipo", "estado", "servicio", "proveedor", "producto", "productoId"])
  })
})

describe("invoiceEquipmentLabel", () => {
  it("«código · patente», o sólo la patente si el equipo no tiene código", () => {
    expect(invoiceEquipmentLabel({ code: "CM-11", plate: "AA-BB-11" })).toBe("CM-11 · AA-BB-11")
    expect(invoiceEquipmentLabel({ code: null, plate: "AA-BB-11" })).toBe("AA-BB-11")
    expect(invoiceEquipmentLabel(null)).toBe("—")
  })
})
