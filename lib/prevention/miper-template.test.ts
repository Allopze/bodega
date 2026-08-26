import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import {
  IPER_DATA_FIELDS,
  MIPER_SHEETS,
  cellText,
  detectHeaderRows,
  findSheet,
  isEmptyDataRow,
  mapColumns,
  readCell,
} from "./miper-template"

/** Cabecera de dos filas fusionadas (grupo R1 + subcolumna R2), datos desde R3 — misma forma que R12/R13/R14 del archivo real. */
function twoRowHeaderSheet() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(MIPER_SHEETS.iper)
  sheet.addRow(["N°", "ACTIVIDAD", "TAREA", "PUESTO DE TRABAJO", "LUGAR DE TRABAJO ESPECÍFICO", "N° DE TRABAJADORES", "N° DE TRABAJADORES", "N° DE TRABAJADORES", "FACTORES DE RIESGO", "RUTINARIA /NO RUTINARIA", "PELIGRO", "RIESGO", "DAÑO PROBABLE", "EVALUACIÓN DEL RIESGO", "EVALUACIÓN DEL RIESGO", "EVALUACIÓN DEL RIESGO", "EVALUACIÓN DEL RIESGO", "MEDIDA DE CONTROL", "ESTA CONTROLADO EL RIESGO", "RESPONSABLE", "PLAZOS"])
  sheet.addRow(["N°", "ACTIVIDAD", "TAREA", "PUESTO DE TRABAJO", "LUGAR DE TRABAJO ESPECÍFICO", "F", "M", "OTRO", "FACTORES DE RIESGO", "RUTINARIA /NO RUTINARIA", "PELIGRO", "RIESGO", "DAÑO PROBABLE", "PROBABILIDAD", "CONSECUENCIA", "MR", "CLASIFICACION DEL RIESGO", "MEDIDA DE CONTROL", "ESTA CONTROLADO EL RIESGO", "RESPONSABLE", "PLAZOS"])
  return { workbook, sheet }
}

describe("findSheet", () => {
  it("encuentra una hoja por nombre canónico tolerando mayúsculas/tildes", async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("re-04 iper")
    expect(findSheet(workbook, MIPER_SHEETS.iper)?.name).toBe("re-04 iper")
    expect(findSheet(workbook, MIPER_SHEETS.modifications)).toBeNull()
  })
})

describe("detectHeaderRows", () => {
  it("detecta un encabezado de dos filas fusionadas (R12/R13 del archivo real)", () => {
    const { sheet } = twoRowHeaderSheet()
    expect(detectHeaderRows(sheet)).toEqual({ groupRow: 1, subRow: 2, firstDataRow: 3 })
  })

  it("detecta un encabezado de una sola fila cuando la siguiente no aporta alias nuevos", () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("simple")
    sheet.addRow(["ACTIVIDAD", "TAREA", "PELIGRO", "RIESGO", "PROBABILIDAD", "CONSECUENCIA"])
    sheet.addRow(["Op.", "Tarea 1", "Corte", "Herida", 2, 4])
    expect(detectHeaderRows(sheet)).toEqual({ groupRow: 1, subRow: null, firstDataRow: 2 })
  })

  it("funciona con el encabezado corrido a otra fila (deriva de plantilla entre faenas)", () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("corrido")
    sheet.addRow(["Cabecera del documento"])
    sheet.addRow(["Otra fila de metadatos"])
    sheet.addRow(["ACTIVIDAD", "TAREA", "PELIGRO", "RIESGO", "PROBABILIDAD", "CONSECUENCIA"])
    expect(detectHeaderRows(sheet)?.groupRow).toBe(3)
  })

  it("devuelve null si no encuentra actividad+peligro en el rango de escaneo", () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("vacia")
    sheet.addRow(["Columna A", "Columna B"])
    expect(detectHeaderRows(sheet, 5)).toBeNull()
  })
})

describe("mapColumns + isEmptyDataRow", () => {
  it("mapea las columnas del encabezado de dos filas y ubica probabilidad/consecuencia/clasificación", () => {
    const { sheet } = twoRowHeaderSheet()
    const header = detectHeaderRows(sheet)!
    const columns = mapColumns(sheet, header)
    expect(columns.activity).toBeDefined()
    expect(columns.probability).toBeDefined()
    expect(columns.consequence).toBeDefined()
    expect(columns.classification).toBeDefined()
    expect(columns.workersFemale).toBeDefined()
    expect(columns.workersMale).toBeDefined()
  })

  it("una fila con todas las columnas de DATOS vacías es fantasma aunque la clasificación venga cacheada con REVISAR", () => {
    const { sheet } = twoRowHeaderSheet()
    const header = detectHeaderRows(sheet)!
    const columns = mapColumns(sheet, header)
    const phantomRow = sheet.getRow(3)
    phantomRow.getCell(columns.classification!).value = "REVISAR"
    // Ninguna columna de dato (IPER_DATA_FIELDS) tiene contenido.
    expect(isEmptyDataRow(phantomRow, columns)).toBe(true)
    expect(IPER_DATA_FIELDS).not.toContain("classification")
  })

  it("una fila con al menos un dato sustantivo no es vacía", () => {
    const { sheet } = twoRowHeaderSheet()
    const header = detectHeaderRows(sheet)!
    const columns = mapColumns(sheet, header)
    const dataRow = sheet.getRow(3)
    dataRow.getCell(columns.activity!).value = "Operación planta"
    expect(isEmptyDataRow(dataRow, columns)).toBe(false)
  })
})

describe("readCell sobre celdas fusionadas", () => {
  it("resuelve .master: leer una celda que no es la ancla del merge devuelve el mismo valor que la ancla", () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("cabecera")
    sheet.getCell("D7").value = "78.023.530-6"
    sheet.mergeCells("D7:E8")
    expect(readCell(sheet, "D7")).toBe("78.023.530-6")
    expect(readCell(sheet, "E8")).toBe("78.023.530-6")
  })
})

describe("cellText", () => {
  it("lee el resultado cacheado de una fórmula, nunca la fórmula misma", () => {
    expect(cellText({ value: { formula: "N14*O14", result: 8 } as never })).toBe("8")
  })

  it("una fórmula sin resultado cacheado se lee como vacía, no como error", () => {
    expect(cellText({ value: { formula: "N14*O14", result: null } as never })).toBe("")
  })

  it("resuelve rich text y fechas", () => {
    expect(cellText({ value: { richText: [{ text: "Hola " }, { text: "mundo" }] } as never })).toBe("Hola mundo")
    expect(cellText({ value: new Date("2026-01-01T00:00:00.000Z") })).toBe("2026-01-01T00:00:00.000Z")
  })
})
