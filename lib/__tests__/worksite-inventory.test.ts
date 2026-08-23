import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseInventoryXlsx } from "@/lib/services/worksite-inventory"

/**
 * El parser es lo único de la carga masiva que puede probarse sin base, y es
 * justo donde vive el valor: doscientos extintores sólo son cargables si cada
 * fila mala se reporta por su número de fila real en vez de tumbar el lote.
 */
async function sheet(rows: unknown[][], headers = ["NOMBRE", "TIPO", "UBICACION", "SERIE", "PROXIMA INSPECCION", "VENCIMIENTO"]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet("Inventario")
  worksheet.addRow(headers)
  for (const row of rows) worksheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe("parseInventoryXlsx", () => {
  it("lee una planilla con todas las columnas", async () => {
    const rows = await parseInventoryXlsx(await sheet([
      ["Extintor Pañol 1", "Extintor", "Pañol herramientas", "SN-001", "2026-09-01", "2027-03-01"],
      ["Kit derrame Bodega", "Kit de derrame", "Bodega RESPEL", null, null, null],
    ]))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.values).toMatchObject({
      name: "Extintor Pañol 1",
      kind: "Extintor",
      location: "Pañol herramientas",
      serialNumber: "SN-001",
      nextInspectionAt: "2026-09-01",
      expiresAt: "2027-03-01",
    })
    // Celdas vacías quedan nulas, no como cadena vacía: la columna es nullable y
    // un "" haría pasar por declarada una fecha que nadie declaró.
    expect(rows[1]!.values).toMatchObject({
      name: "Kit derrame Bodega",
      serialNumber: null,
      nextInspectionAt: null,
      expiresAt: null,
    })
  })

  it("busca las columnas por nombre, así que el orden no importa", async () => {
    const rows = await parseInventoryXlsx(await sheet(
      [["Comedor", "Extintor A", "Extintor"]],
      ["UBICACION", "NOMBRE", "TIPO"],
    ))
    expect(rows[0]!.values).toMatchObject({ name: "Extintor A", kind: "Extintor", location: "Comedor" })
  })

  it("rechaza la planilla entera si falta una columna obligatoria", async () => {
    const rows = await parseInventoryXlsx(await sheet([["Extintor A", "Extintor"]], ["NOMBRE", "TIPO"]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.error).toContain("UBICACION")
  })

  it("una fila mala no bota al lote, y se informa con su fila real de Excel", async () => {
    const rows = await parseInventoryXlsx(await sheet([
      ["Extintor OK", "Extintor", "Pañol", null, null, null],
      ["X", "Extintor", "Pañol", null, null, null],
      ["Extintor con fecha mala", "Extintor", "Pañol", null, "01-09-2026", null],
    ]))

    expect(rows.filter((row) => row.values)).toHaveLength(1)
    const rejected = rows.filter((row) => row.error)
    expect(rejected).toHaveLength(2)
    // Fila 1 es el encabezado, así que la primera de datos es la 2.
    expect(rejected[0]!.line).toBe(3)
    expect(rejected[0]!.error).toContain("name")
    expect(rejected[1]!.line).toBe(4)
    expect(rejected[1]!.error).toContain("Fecha inválida")
  })

  it("ignora las filas del todo vacías que la planilla arrastra al final", async () => {
    const rows = await parseInventoryXlsx(await sheet([
      ["Extintor B", "Extintor", "Oficina", null, null, null],
      [null, null, null, null, null, null],
      [null, null, null, null, null, null],
    ]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.values?.name).toBe("Extintor B")
  })

  it("un archivo que no es Excel se rechaza sin reventar", async () => {
    const rows = await parseInventoryXlsx(Buffer.from("no soy una planilla"))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.error).toContain("inválido")
  })
})
