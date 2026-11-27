import { describe, expect, it } from "vitest"
import { EXCEL_DATE_FORMAT } from "@/lib/reports/excel-dates"
import {
  correctiveNotes, correctiveSheet, driversSheet, equipmentSeriesSheet, monthlyWorkSheet,
} from "./export-corrective"
import type { CorrectiveWorkRow, DriverRow, EquipmentSeriesRow, MonthlyCount } from "./types"

/** Fechas de calendario como las escribe el libro: medianoche UTC del día, sin desfase de zona. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function work(over: Partial<CorrectiveWorkRow> = {}): CorrectiveWorkRow {
  return {
    id: "ot:1", source: "ot", date: "2026-10-20", vehicleId: "v-1", recordId: null, code: "KA-143", plate: "SJFC-66", typeName: "Camión",
    unit: "km", reading: 345_000, readingText: null, reference: "OT-0001", workPerformed: "Reparación de frenos",
    worksiteId: "ws-1", worksiteName: "Teno", hours: 4, photoId: "p-1", photoUrl: null, drivers: ["JUAN PEREZ", "PEDRO SOTO"], ...over,
  }
}

describe("hoja «Correctivos»", () => {
  it("una fila por trabajo con la fecha de Excel, la lectura numérica, el conductor y las horas como número; la foto no viaja", () => {
    const sheet = correctiveSheet([work()], "km")
    expect(sheet.worksheetName).toBe("Correctivos")
    expect(sheet.headers).toEqual([
      "Fecha", "Fuente", "Referencia", "Código", "Patente", "Tipo de equipo", "Faena", "Odómetro (km)", "Lectura del formulario",
      "Conductor", "Horas hombre", "Trabajo realizado",
    ])
    expect(sheet.rows[0]).toEqual([
      day("2026-10-20"), "Orden de trabajo", "OT-0001", "KA-143", "SJFC-66", "Camión", "Teno", 345_000, null,
      "JUAN PEREZ, PEDRO SOTO", 4, "Reparación de frenos",
    ])
    expect(sheet.columnFormats?.[0]).toBe(EXCEL_DATE_FORMAT)
    expect(JSON.stringify(sheet.rows)).not.toContain("p-1")
  })

  it("el formulario histórico trae la lectura como texto y puede no tener faena, folio, conductor ni horas", () => {
    const row = work({ id: "h:1", source: "historial", reading: null, readingText: "145.000", reference: "", worksiteName: null, hours: null, workPerformed: "", drivers: [] })
    expect(correctiveSheet([row], "h").rows[0]).toEqual([
      day("2026-10-20"), "Historial de formularios", null, "KA-143", "SJFC-66", "Camión", "Sin faena", null, "145.000", null, null, null,
    ])
    expect(correctiveSheet([row], "h").headers[7]).toBe("Horómetro (h)")
    expect(correctiveSheet([work({ source: "registro" })], "km").rows[0]![1]).toBe("Registro de la plataforma")
  })
})

describe("hojas de conductores, horas por equipo y trabajos por mes", () => {
  it("«Conductores»: horas prorrateadas y registros", () => {
    const drivers: DriverRow[] = [{ key: "juan perez", label: "JUAN PEREZ", records: 2, hours: 1.5 }]
    const sheet = driversSheet(drivers)
    expect(sheet.worksheetName).toBe("Conductores")
    expect(sheet.headers).toEqual(["Conductor", "Horas (prorrateadas)", "Registros"])
    expect(sheet.rows).toEqual([["JUAN PEREZ", 1.5, 2]])
  })

  it("«Horas y registros»: la serie del gráfico combinado, con patente y código por separado", () => {
    const series: EquipmentSeriesRow[] = [{ vehicleId: "v-1", label: "SJFC-66", code: "KA-143", plate: "SJFC-66", records: 3, hours: 7.5 }]
    const sheet = equipmentSeriesSheet(series)
    expect(sheet.worksheetName).toBe("Horas y registros")
    expect(sheet.headers).toEqual(["Patente", "Código", "Horas trabajadas", "Registros"])
    expect(sheet.rows).toEqual([["SJFC-66", "KA-143", 7.5, 3]])
  })

  it("«Trabajos por mes»: un mes sin trabajos queda con 0, porque el período sí lo cubre", () => {
    const months: MonthlyCount[] = [
      { key: "2026-10", label: "oct 2026", count: 5, partial: false },
      { key: "2026-11", label: "nov 2026", count: 0, partial: true },
    ]
    const sheet = monthlyWorkSheet(months)
    expect(sheet.worksheetName).toBe("Trabajos por mes")
    expect(sheet.rows).toEqual([["oct 2026", 5], ["nov 2026", 0]])
  })
})

describe("notas de lectura de Correctivo", () => {
  it("dicen la unidad, que la fecha es el ingreso a taller y que cada hoja ignora lo que ella emite", () => {
    const km = correctiveNotes("km").join("\n")
    expect(km).toMatch(/equipos por kilómetros/)
    expect(km).toMatch(/ingreso a taller/)
    expect(km).toMatch(/ignora la selección que ella misma emite/)
    expect(correctiveNotes("h").join("\n")).toMatch(/equipos por horas/)
  })
})
