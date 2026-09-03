import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AREA_TREE, DASHBOARD_ITEM } from "@/components/layout/nav-items"

const root = process.cwd()

/**
 * Rutas concretas del App Router: cada directorio con `page.tsx`, ignorando los
 * grupos entre paréntesis —que no aportan segmento— y los segmentos dinámicos,
 * que la navegación nunca enlaza directamente.
 */
function collectPageRoutes(dir: string, prefix = ""): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const { name } = entry
    if (name.startsWith("_") || name === "api") continue
    const segment = name.startsWith("(") ? "" : `/${name}`
    const child = path.join(dir, name)
    if (fs.existsSync(path.join(child, "page.tsx"))) found.push(prefix + segment || "/")
    found.push(...collectPageRoutes(child, prefix + segment))
  }
  return found
}

function navHrefs(): string[] {
  // `DASHBOARD_ITEM.href` está tipado como literal; el acumulador es de rutas.
  const hrefs: string[] = [DASHBOARD_ITEM.href]
  for (const area of AREA_TREE) {
    for (const item of area.items) {
      hrefs.push(item.href)
      for (const child of item.children ?? []) hrefs.push(child.href)
    }
  }
  return [...new Set(hrefs)]
}

describe("destinos de navegación", () => {
  /**
   * Criterio de aceptación de TASK-UI-005: "redirects declarados y sin rutas
   * fantasma". Una entrada del sidebar que apunta a una ruta inexistente rinde
   * un 404 dentro de la propia navegación y, además, infla la cobertura nominal
   * que EVID-003 señaló. La comprobación es estática porque el árbol se compone
   * desde los manifiestos de módulo y nadie revisa a mano si el destino existe.
   */
  it("todos apuntan a una página real del App Router", () => {
    const routes = new Set(collectPageRoutes(path.join(root, "app")))
    const orphans = navHrefs().filter((href) => !routes.has(href.split("?")[0]!))

    expect(orphans).toEqual([])
  })

  /**
   * G17: la cola operacional (`operational-work-queue.ts`) construye el CTA de
   * las actividades `mechanism = 'constancia'` con un `CONCAT` de SQL, fuera de
   * `AREA_TREE`, así que el test anterior no lo cubre. `/prevencion/constancias`
   * llevó meses en pie como un 404 sin que ningún test lo detectara — este lee
   * el literal real de la consulta, no una copia a mano, para que un futuro
   * cambio de ruta sin la página correspondiente vuelva a fallar acá.
   */
  it("el CTA de Constancias en la cola operacional apunta a una ruta real", () => {
    const source = fs.readFileSync(path.join(root, "lib/services/operational-work-queue.ts"), "utf8")
    const match = source.match(/WHEN 'constancia' THEN CONCAT\('([^']+)'/)
    expect(match, "no se encontró la rama 'constancia' del CASE de href en operational-work-queue.ts").not.toBeNull()
    const hrefPrefix = match![1]!.split("?")[0]!

    const routes = new Set(collectPageRoutes(path.join(root, "app")))
    expect(routes.has(hrefPrefix)).toBe(true)
  })

  it("ninguna etiqueta se repite dentro de su área", () => {
    // Dos entradas con el mismo texto en el mismo grupo son indistinguibles a
    // 1280 px, que es justo lo que TASK-UI-005 prohíbe.
    for (const area of AREA_TREE) {
      const labels = area.items.map((item) => item.label)
      expect(new Set(labels).size, `área "${area.label}"`).toBe(labels.length)

      for (const item of area.items) {
        const childLabels = (item.children ?? []).map((child) => child.label)
        expect(new Set(childLabels).size, `hijos de "${item.label}"`).toBe(childLabels.length)
      }
    }
  })
})
