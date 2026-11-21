import { describe, expect, it } from "vitest"
import { isHiddenHistoricalHeader, visibleHistoricalFields } from "@/lib/mantencion/historical-privacy"

describe("campos ocultos del historial (opción B, 2026-11-21)", () => {
  it("oculta la cuenta de correo con los encabezados del consolidado y del formulario", () => {
    expect(isHiddenHistoricalHeader("CORREO")).toBe(true)
    expect(isHiddenHistoricalHeader("Dirección de correo electrónico")).toBe(true)
    expect(isHiddenHistoricalHeader("  Email Address ")).toBe(true)
  })

  it("no oculta al responsable, al conductor ni un campo que sólo menciona el correo", () => {
    for (const header of ["REALIZA_RESPONSABLE", "CONDUCTOR", "TALLER_EXTERNO", "Correo del taller", "TALLER_REGISTRO"]) {
      expect(isHiddenHistoricalHeader(header)).toBe(false)
    }
  })

  it("filtra la fila sin cambiar el orden ni el resto de los campos", () => {
    const fields = [
      { header: "MARCA_TEMPORAL", value: "2026-05-01" },
      { header: "CORREO", value: "persona@example.com" },
      { header: "REALIZA_RESPONSABLE", value: "Mecánico" },
      { header: "Dirección de correo electrónico", value: "otra@example.com" },
      { header: "CONDUCTOR", value: "Conductor" },
    ]
    expect(visibleHistoricalFields(fields).map((field) => field.header)).toEqual(["MARCA_TEMPORAL", "REALIZA_RESPONSABLE", "CONDUCTOR"])
  })
})
