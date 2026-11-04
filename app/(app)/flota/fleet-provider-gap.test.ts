import { describe, expect, it } from "vitest"
import { coverageNoticeText } from "@/lib/combustibles/coverage-notice"
import { fleetProviderGapNotice, fleetProviderGapSubject } from "./fleet-provider-gap"

/**
 * C-4 en Flota: el aviso de que un mes de la ventana de 12 meses no trae datos del proveedor.
 * Lo comparten el resumen de la lista y la hoja «Metadatos» de la exportación, así que el
 * texto tiene que salir de un solo lugar y decir qué cifras alcanza.
 */
describe("fleetProviderGapNotice", () => {
  it("un mes: lo nombra y dice que los totales no lo incluyen", () => {
    expect(fleetProviderGapNotice(["2026-09"], 12)).toBe("Sin datos del proveedor en sep-2026: los totales de 12 meses no incluyen ese mes.")
  })

  it("varios meses: los lista con «y» y habla en plural", () => {
    expect(fleetProviderGapNotice(["2025-11", "2025-12", "2026-09"], 12)).toBe(
      "Sin datos del proveedor en nov-2025, dic-2025 y sep-2026: los totales de 12 meses no incluyen esos meses.",
    )
  })

  it("sin meses sin datos no hay aviso", () => {
    expect(fleetProviderGapNotice([], 12)).toBeNull()
  })

  it("la ventana sale del llamador: no repite el 12 a mano", () => {
    expect(fleetProviderGapNotice(["2026-09"], 6)).toBe("Sin datos del proveedor en sep-2026: los totales de 6 meses no incluyen ese mes.")
  })

  // La pantalla (`CoverageNotice`) y la hoja «Metadatos» salen de la misma frase compartida: si una cambia sin la otra, el archivo
  // y la pantalla se contradicen.
  it("es la frase del aviso compartido de cobertura con las cifras de Flota por sujeto", () => {
    expect(fleetProviderGapSubject(12)).toBe("los totales de 12 meses")
    expect(fleetProviderGapNotice(["2026-09"], 12)).toBe(coverageNoticeText({ gapMonths: ["2026-09"], subject: fleetProviderGapSubject(12) }))
  })
})
