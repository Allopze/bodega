import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * Contrato: todo gráfico tiene lectura equivalente (TASK-UI-015).
 *
 * La auditoría pedía "resúmenes/tablas equivalentes" y "el color no es el único
 * canal". Se cumplía en Combustibles y en ningún otro dominio, y nada lo
 * impedía: un gráfico nuevo nacía sin alternativa textual y nadie se enteraba
 * hasta la siguiente auditoría manual.
 *
 * Este barrido es estático a propósito. Renderizar once superficies con datos
 * reales costaría minutos y probaría menos: lo que hay que garantizar es que
 * ningún archivo dibuje con Recharts sin ofrecer también la cifra en texto.
 */
const REPO = path.resolve(__dirname, "../..")

/**
 * Excepciones **nombradas**, no un patrón: cada una dice por qué su lectura
 * equivalente no es una `ChartDataTable`. Una lista con motivos envejece mejor
 * que un `skip` silencioso.
 */
const ALTERNATIVA_PROPIA: Record<string, string> = {
  "components/ui/chart.tsx": "Primitivas de Recharts compartidas; no dibuja ninguna serie por sí mismo.",
  "app/(app)/combustibles/consumption-charts.tsx": "Usa ChartDataSummary, la variante de Combustibles previa a ChartDataTable.",
  "app/(app)/combustibles/fuel-charts.tsx": "Usa ChartDataSummary, la variante de Combustibles previa a ChartDataTable.",
}

function chartFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "app", "components", "lib"], { cwd: REPO, encoding: "utf-8" })
  return out
    .split("\n")
    .filter((file) => (file.endsWith(".tsx") || file.endsWith(".ts")) && !file.includes(".test."))
    .filter((file) => /from "recharts"/.test(readFileSync(path.join(REPO, file), "utf-8")))
}

describe("lectura equivalente de gráficos", () => {
  const files = chartFiles()

  it("el barrido encuentra las superficies de gráfico", () => {
    // Guarda contra un filtro roto que dejaría la prueba verde sin comprobar nada.
    expect(files.length).toBeGreaterThan(5)
  })

  it("ningún gráfico ofrece el color como único canal de su dato", () => {
    const sinAlternativa = files.filter((file) => {
      if (file in ALTERNATIVA_PROPIA) return false
      const source = readFileSync(path.join(REPO, file), "utf-8")
      return !source.includes("ChartDataTable") && !source.includes("ChartDataSummary")
    })

    expect(sinAlternativa).toEqual([])
  })

  it("cada excepción sigue existiendo y conserva su motivo", () => {
    for (const [file, motivo] of Object.entries(ALTERNATIVA_PROPIA)) {
      expect(files, `${file} ya no dibuja: retírala de la lista`).toContain(file)
      expect(motivo.length).toBeGreaterThan(20)
    }
  })
})
