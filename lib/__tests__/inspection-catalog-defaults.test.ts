import { describe, expect, it } from "vitest"
import { catalogDefaultsFor } from "@/lib/prevention/inspection-wiring"

describe("catalogDefaultsFor", () => {
  it("el Reporte de Equipos conserva su nombre y que quien transcribe pueda revisar", () => {
    expect(catalogDefaultsFor("reporte_equipos")).toEqual({
      name: "Reporte de Uso Diario de Equipos",
      executorOfRecord: "declared_in_form",
    })
  })

  it("una definición fuera del catálogo cae en el título y en platform_user", () => {
    expect(catalogDefaultsFor("no_existe")).toEqual({ name: null, executorOfRecord: "platform_user" })
  })

  it("una definición con dos filas (EPP JT/PRF) no adivina", () => {
    const codes = ["inspeccion_epp", "inspeccion_epp_jt", "epp"]
    for (const code of codes) {
      const result = catalogDefaultsFor(code)
      if (result.name === null) expect(result.executorOfRecord).toBe("platform_user")
    }
  })
})
