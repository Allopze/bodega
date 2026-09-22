import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Contratos del panel del mapa de riesgos. Salieron de `miper-ui-contract` el
 * 2026-09-22, cuando la pantalla se trasladó a CGRD: dejaron de describir la
 * MIPER.
 */
const root = process.cwd()
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")

const PANEL = "app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx"

describe("contratos React del mapa de riesgos", () => {
  it("permite activar el plano de riesgos con teclado cuando es editable", () => {
    const riskMap = source(PANEL)

    expect(riskMap).toContain("onKeyDown={handleKeyDown}")
    expect(riskMap).toContain("tabIndex={canEdit ? 0 : undefined}")
    expect(riskMap).toContain('event.key !== "Enter" && event.key !== " "')
    expect(riskMap).toContain("setPendingPoint({ xPct: 50, yPct: 50 })")
    expect(riskMap).toContain("Plano de riesgos: clic para ubicar un marcador")
  })

  it("conserva la faena elegida del mapa cuando una mutación refresca los datos", () => {
    const riskMap = source(PANEL)

    expect(riskMap).toContain('searchParams.get("mapWorksite")')
    expect(riskMap).toContain('params.set("mapWorksite", value)')
    expect(riskMap).toContain("onValueChange={navigateWorksite}")
    expect(riskMap).toContain('router.replace(qs ? `?${qs}` : "", { scroll: false })')
  })

  it("consume la API del mapa en su ruta de CGRD", () => {
    // El traslado de la API (2026-09-22) es invisible para el typecheck: la URL
    // se arma como string. Si alguien la revierte a /api/prevencion/miper/mapa,
    // el plano deja de cargar y sólo lo nota un e2e con navegador.
    const riskMap = source(PANEL)

    expect(riskMap).toContain("/api/prevencion/cgrd/mapa")
    expect(riskMap).not.toContain("/api/prevencion/miper/mapa")
  })
})
