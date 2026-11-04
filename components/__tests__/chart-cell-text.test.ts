import { createElement, Fragment } from "react"
import { describe, expect, it } from "vitest"
import { chartCellValue, chartRowsValues } from "@/components/charts/chart-cell-text"

/**
 * «Ver datos» → Excel: las celdas son `ReactNode` y a Excel va lo que se lee. Un enlace exporta su
 * texto, un número conserva su tipo y lo que no tiene texto sale vacío, nunca un valor inventado.
 */
describe("chartCellValue", () => {
  it("el texto sale tal como se mostraba, con su formato de pantalla", () => {
    expect(chartCellValue("$1.200.000")).toBe("$1.200.000")
    expect(chartCellValue("12,5 %")).toBe("12,5 %")
  })

  it("un número conserva su tipo: Excel puede sumarlo", () => {
    expect(chartCellValue(42)).toBe(42)
    expect(chartCellValue(0)).toBe(0)
    expect(chartCellValue(-3.5)).toBe(-3.5)
  })

  it("un enlace exporta su texto, no su destino", () => {
    const link = createElement("a", { href: "/combustibles/consumo/litros?proveedor=copec" }, "Copec")

    expect(chartCellValue(link)).toBe("Copec")
  })

  it("un enlace anidado en otros elementos y un fragmento se reducen al texto que se lee", () => {
    const nested = createElement("span", null, createElement("a", { href: "/x" }, "Faena Norte"), " (", "3", ")")

    expect(chartCellValue(nested)).toBe("Faena Norte (3)")
    expect(chartCellValue(createElement(Fragment, null, "a", "b"))).toBe("ab")
    expect(chartCellValue(["$", "1.000"])).toBe("$1.000")
  })

  it("un número dentro de un elemento sale como texto: ya no es una celda numérica sino una mezcla", () => {
    expect(chartCellValue(createElement("strong", null, 12))).toBe("12")
  })

  it("lo que no tiene texto sale vacío: nulo, booleano, indefinido, un ícono sin hijos", () => {
    expect(chartCellValue(null)).toBeNull()
    expect(chartCellValue(undefined)).toBeNull()
    expect(chartCellValue(false)).toBeNull()
    expect(chartCellValue(true)).toBeNull()
    expect(chartCellValue(createElement("svg"))).toBeNull()
    expect(chartCellValue("   ")).toBeNull()
  })

  it("un número no finito no se exporta como «NaN» ni «Infinity»", () => {
    expect(chartCellValue(Number.NaN)).toBeNull()
    expect(chartCellValue(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("colapsa espacios y saltos de línea del marcado", () => {
    expect(chartCellValue(createElement("span", null, "  Ago  \n", createElement("b", null, " 2026 ")))).toBe("Ago 2026")
  })
})

describe("chartRowsValues", () => {
  it("exporta las mismas filas que la tabla, celda por celda", () => {
    const rows = [
      [createElement("a", { href: "/p/copec" }, "Copec"), 12, "$1.000"],
      ["Total", null, 12],
    ]

    expect(chartRowsValues(rows)).toEqual([
      ["Copec", 12, "$1.000"],
      ["Total", null, 12],
    ])
  })
})
