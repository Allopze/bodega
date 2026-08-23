import { describe, expect, it } from "vitest"
import { parseInventoryPaste } from "@/lib/services/worksite-inventory"

/**
 * El parser es lo único de la carga masiva que puede probarse sin base, y es
 * justo donde vive el valor: doscientos extintores pegados desde Excel sólo son
 * cargables si cada fila mala se reporta por su número de línea en vez de
 * tumbar el lote entero.
 */
describe("parseInventoryPaste", () => {
  it("acepta el pegado tabulado de Excel", () => {
    const rows = parseInventoryPaste([
      "Extintor Pañol 1\tExtintor\tPañol herramientas\tSN-001\t2026-09-01\t2027-03-01",
      "Kit derrame Bodega\tKit de derrame\tBodega RESPEL\t\t\t",
    ].join("\n"))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.values).toMatchObject({
      name: "Extintor Pañol 1",
      kind: "Extintor",
      location: "Pañol herramientas",
      serialNumber: "SN-001",
      nextInspectionAt: "2026-09-01",
      expiresAt: "2027-03-01",
    })
    // Serie y fechas vacías quedan nulas, no como cadena vacía: la columna es
    // nullable y un "" haría pasar por declarada una fecha que nadie declaró.
    expect(rows[1]!.values).toMatchObject({
      name: "Kit derrame Bodega",
      serialNumber: null,
      nextInspectionAt: null,
      expiresAt: null,
    })
  })

  it("acepta punto y coma para un CSV exportado a mano", () => {
    const rows = parseInventoryPaste("Extintor A;Extintor;Comedor;;;")
    expect(rows[0]!.values).toMatchObject({ name: "Extintor A", kind: "Extintor", location: "Comedor" })
  })

  it("ignora la fila de títulos y las líneas en blanco", () => {
    const rows = parseInventoryPaste([
      "nombre\ttipo\tubicación\tserie\tpróxima inspección\tvencimiento",
      "",
      "Extintor B\tExtintor\tOficina\t\t\t",
      "   ",
    ].join("\n"))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.values?.name).toBe("Extintor B")
  })

  it("rechaza la fila y no el lote, informando su línea", () => {
    const rows = parseInventoryPaste([
      "Extintor OK\tExtintor\tPañol\t\t\t",
      "X\tExtintor\tPañol\t\t\t",
      "Extintor con fecha mala\tExtintor\tPañol\t\t01-09-2026\t",
    ].join("\n"))

    expect(rows.filter((row) => row.values)).toHaveLength(1)
    const rejected = rows.filter((row) => row.error)
    expect(rejected).toHaveLength(2)
    // El número de línea es el del texto pegado, para poder corregir en la planilla.
    expect(rejected[0]!.line).toBe(2)
    expect(rejected[0]!.error).toContain("name")
    expect(rejected[1]!.line).toBe(3)
    expect(rejected[1]!.error).toContain("Fecha inválida")
  })

  it("una fila incompleta no se inventa columnas vacías válidas", () => {
    const rows = parseInventoryPaste("Sólo el nombre")
    expect(rows[0]!.values).toBeUndefined()
    expect(rows[0]!.error).toBeTruthy()
  })
})
