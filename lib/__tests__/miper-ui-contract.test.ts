import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")

describe("contratos React de la pantalla MIPER", () => {
  it("serializa una fecha de referencia estable para SSR e hidratación", () => {
    const page = source("app/(app)/prevencion/miper/page.tsx")
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")

    expect(page).toContain("const today = new Date().toISOString().slice(0, 10)")
    expect(page).toContain("today={today}")
    expect(workbench).toContain("today: string")
    expect(workbench).not.toContain("new Date().toISOString().slice(0, 10)")
  })

  it("permite activar el plano de riesgos con teclado cuando es editable", () => {
    const riskMap = source("app/(app)/prevencion/miper/risk-map-panel.tsx")

    expect(riskMap).toContain("onKeyDown={handleKeyDown}")
    expect(riskMap).toContain("tabIndex={canEdit ? 0 : undefined}")
    expect(riskMap).toContain('event.key !== "Enter" && event.key !== " "')
    expect(riskMap).toContain("setPendingPoint({ xPct: 50, yPct: 50 })")
    expect(riskMap).toContain("Plano de riesgos: clic para ubicar un marcador")
  })

  it("conserva el tab activo cuando una mutación refresca los datos", () => {
    const workbench = source("app/(app)/prevencion/miper/miper-workbench.tsx")

    expect(workbench).toContain('useState(() => resolveMiperTab(searchParams.get("tab")))')
    expect(workbench).toContain('params.set("tab", value)')
    expect(workbench).toContain('router.replace(qs ? `?${qs}` : "", { scroll: false })')
    expect(workbench).toContain('<Tabs value={activeTab} onValueChange={navigateTab}>')
    expect(workbench).not.toContain('<Tabs defaultValue="versions">')
  })

  it("conserva la faena elegida del mapa cuando una mutación refresca los datos", () => {
    const riskMap = source("app/(app)/prevencion/miper/risk-map-panel.tsx")

    expect(riskMap).toContain('searchParams.get("mapWorksite")')
    expect(riskMap).toContain('params.set("mapWorksite", value)')
    expect(riskMap).toContain("onValueChange={navigateWorksite}")
    expect(riskMap).toContain('router.replace(qs ? `?${qs}` : "", { scroll: false })')
  })
})
