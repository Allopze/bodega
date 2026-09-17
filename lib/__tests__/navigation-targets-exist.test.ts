import fs from "node:fs"
import { PDTP_2026_ENGANCHE_DESTINATIONS } from "@/lib/services/pdtp-adapters/fulfillment-contract-2026"
import { resolvePdtpFulfillmentTarget } from "@/lib/services/pdtp/fulfillment"
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

function hasPageForHref(routes: Set<string>, href: string): boolean {
  const pathname = href.split("?")[0]!
  if (routes.has(pathname)) return true
  const segments = pathname.split("/")
  return [...routes].some((route) => {
    const routeSegments = route.split("/")
    return routeSegments.length === segments.length && routeSegments.every(
      (segment, index) => /^\[.+\]$/.test(segment) || segment === segments[index],
    )
  })
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
   * G17: los destinos de las actividades del PDTP viven fuera de `AREA_TREE`,
   * así que el test anterior no los cubre. `/prevencion/constancias` llevó meses
   * en pie como un 404 sin que ningún test lo detectara; ahora existe y queda
   * cubierto por la comprobación de rutas declaradas.
   *
   * Antes esto leía el literal SQL del `CASE` de `operational-work-queue.ts`.
   * Ese `CASE` ya no decide el destino —lo hace `resolvePdtpFulfillmentTarget`
   * contra el contrato anual— y leer el texto fuente cubría una rama de dos.
   * Ahora se recorre el contrato completo, que son los treinta y tantos
   * destinos reales, más el de Constancias y el de la planilla.
   */
  it("todos los destinos del contrato de cumplimiento del PDTP son rutas reales", () => {
    const routes = new Set(collectPageRoutes(path.join(root, "app")))
    const destinos = [
      // Los dos que no salen del contrato: los produce el propio resolutor.
      resolvePdtpFulfillmentTarget({ mechanism: "constancia" }, "ws-1").href,
      resolvePdtpFulfillmentTarget({ mechanism: "formulario" }, "ws-1").href,
      ...Object.keys(PDTP_2026_ENGANCHE_DESTINATIONS).flatMap((n) => ["enganche", "compuesta"].map(
        (mechanism) => resolvePdtpFulfillmentTarget({
          mechanism,
          n: Number(n),
          programId: "programa-ejemplo",
        }, "ws-1").href,
      )),
    ]

    const faltantes = [...new Set(destinos)].filter((href) => !hasPageForHref(routes, href))
    expect(faltantes, `destinos del PDTP sin página: ${faltantes.join(", ")}`).toEqual([])
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
