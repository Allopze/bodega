import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseHistoricalWorkbook, resolveHistoricalEquipment, resolveHistoricalWorksite } from "@/lib/services/mantencion/historical-workbook"

const headers = ["Marca temporal", "Dirección de correo electrónico", "Puntuación", "FAENA ", "Orden de trabajo", "TIPO DE ACCION", "CAMBIO DE ACEITE ( SI CORRESPONDE)", "TIPO DE TRABAJO", "QUIEN REALIZA TRABAJO", "SI ES EXTERNO. ¿CUAL?", "CONDUCTOR", "Equipo ", "ODOMETRO U HOROMETRO", "TRABAJO REALIZADO", "REPUESTOS", "FECHA INGRESO EQUIPO TALLER", "FECHA SALIDA TALLER", "HORAS TRABAJADAS", "FOTOGRAFIA", "OTRA COLUMNA"]

async function workbook(rows: unknown[][], first = headers) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet("BIODIVERSA")
  sheet.addRow(first)
  rows.forEach((row) => sheet.addRow(row))
  return await book.xlsx.writeBuffer() as ArrayBuffer
}

const row = ["19/08/2025 0:50:09", "taller@example.test", 0, "BIODIVERSA", "0012", "ACCION PREDICTIVA", "", "MECANICO", "Mecánico", "", "", "KA-1 / BCDF-12", 0, "Reparación", "", new Date("2025-08-18T00:00:00.000Z"), null, 2, "", "Dato adicional"]

describe("consolidado histórico de mantención", () => {
  it("conserva columnas y ceros, distingue las fechas del taller y no altera la clase predictiva", async () => {
    const parsed = await parseHistoricalWorkbook(await workbook([row]))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({ sheet: "BIODIVERSA", rowNumber: 2, worksiteText: "BIODIVERSA", equipmentText: "KA-1 / BCDF-12", kindText: "ACCION PREDICTIVA", entryDate: "2025-08-18", exitDate: null, readingText: "0", orderText: "0012" })
    expect(parsed.rows[0]?.fields).toContainEqual({ header: "OTRA COLUMNA", value: "Dato adicional" })
    expect(parsed.rows[0]?.fields).toContainEqual({ header: "Puntuación", value: "0" })
  })

  it("usa la marca temporal y el correo como identidad sin depender de hoja o fila", async () => {
    const original = await parseHistoricalWorkbook(await workbook([row]))
    const moved = await parseHistoricalWorkbook(await workbook([[], row]))
    expect(original.ok && moved.ok && original.rows[0]?.sourceKey).toBe(moved.ok && moved.rows[0]?.sourceKey)
    const changed = [...row]; changed[13] = "Otro trabajo"
    const updated = await parseHistoricalWorkbook(await workbook([changed]))
    expect(original.ok && updated.ok && original.rows[0]?.sourceKey).toBe(updated.ok && updated.rows[0]?.sourceKey)
    expect(original.ok && updated.ok && original.rows[0]?.fingerprint).not.toBe(updated.ok && updated.rows[0]?.fingerprint)
  })

  it("rechaza archivos no reconocidos y dos filas con la misma identidad", async () => {
    expect(await parseHistoricalWorkbook(await workbook([row], ["Documento equivocado"]))).toMatchObject({ ok: false })
    expect(await parseHistoricalWorkbook(await workbook([row, row]))).toMatchObject({ ok: false })
  })

  it("ignora las columnas de fotos y stickers, incluso si faltan o cambian sus enlaces", async () => {
    const first = [...row, "https://drive.google.com/sticker-a"]
    first[18] = "https://drive.google.com/foto-a"
    const changed = [...first]
    changed[18] = "https://drive.google.com/foto-b"
    changed[20] = "https://drive.google.com/sticker-b"
    const fullHeaders = [...headers, "IMAGEN DE STICKER"]
    const a = await parseHistoricalWorkbook(await workbook([first], fullHeaders))
    const b = await parseHistoricalWorkbook(await workbook([changed], fullHeaders))
    const noPhotoHeaders = fullHeaders.filter((_, index) => index !== 18 && index !== 20)
    const noPhotos = first.filter((_, index) => index !== 18 && index !== 20)
    const c = await parseHistoricalWorkbook(await workbook([noPhotos], noPhotoHeaders))
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!a.ok || !b.ok || !c.ok) return
    expect(a.rows[0]?.fields.map((field) => field.header)).not.toContain("FOTOGRAFIA")
    expect(a.rows[0]?.fields.map((field) => field.header)).not.toContain("IMAGEN DE STICKER")
    expect(a.rows[0]?.fields).toContainEqual({ header: "OTRA COLUMNA", value: "Dato adicional" })
    expect(a.rows[0]?.fingerprint).toBe(b.rows[0]?.fingerprint)
    expect(a.rows[0]?.fingerprint).toBe(c.rows[0]?.fingerprint)
  })

  it("acepta una fecha de envío sin hora y conserva únicamente la fecha", async () => {
    const dated = [...row]; dated[0] = "19/08/2025"
    const withTime = await parseHistoricalWorkbook(await workbook([row]))
    const withoutTime = await parseHistoricalWorkbook(await workbook([dated]))
    expect(withTime.ok && withoutTime.ok).toBe(true)
    if (!withTime.ok || !withoutTime.ok) return
    expect(withTime.rows[0]?.submittedAt).toBe("2025-08-19")
    expect(withoutTime.rows[0]?.submittedAt).toBe("2025-08-19")
    expect(withTime.rows[0]?.fields).toContainEqual({ header: "Fecha de envío", value: "2025-08-19" })
    expect(withTime.rows[0]?.fingerprint).toBe(withoutTime.rows[0]?.fingerprint)
  })

  it("rechaza hojas con un número excesivo de filas declaradas", async () => {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet("BIODIVERSA")
    sheet.addRow(headers)
    sheet.getCell("A20002").value = "dato"
    expect(await parseHistoricalWorkbook(await book.xlsx.writeBuffer() as ArrayBuffer)).toMatchObject({ ok: false, message: expect.stringContaining("demasiadas filas") })
  })

  it("no asigna un equipo si el código y la patente discrepan o son ambiguos", () => {
    const fleet = [
      { id: "one", code: "KA-1", plate: "BCDF12" },
      { id: "two", code: "KA-2", plate: "GHJK34" },
    ]
    expect(resolveHistoricalEquipment("ka-1 / bcdf-12", fleet)).toEqual({ vehicleId: "one", state: "linked" })
    expect(resolveHistoricalEquipment("KA-1 / GHJK-34", fleet)).toEqual({ vehicleId: null, state: "conflict" })
    expect(resolveHistoricalEquipment("KA-1 / LPRS-56", fleet)).toEqual({ vehicleId: null, state: "conflict" })
    expect(resolveHistoricalEquipment("KA-9 / LPRS-56", fleet)).toEqual({ vehicleId: null, state: "unmatched" })
    expect(resolveHistoricalEquipment("KA-1", [...fleet, { id: "three", code: "KA-1", plate: "LPRS56" }])).toEqual({ vehicleId: null, state: "conflict" })
  })

  it("usa la faena de la fila y sólo resuelve equivalencias explícitas", () => {
    const sites = [{ id: "bio", name: "Biodiversa" }, { id: "cho", name: "Cholguan - Arauco" }, { id: "teno", name: "Teno - Arauco" }]
    expect(resolveHistoricalWorksite("BIODIVERSA", sites)).toBe("bio")
    expect(resolveHistoricalWorksite("CHOLGUAN", sites)).toBe("cho")
    expect(resolveHistoricalWorksite("ARAUCO", sites)).toBeNull()
  })
})
