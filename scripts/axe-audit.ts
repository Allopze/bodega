import { chromium } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import fs from "node:fs"
import path from "node:path"

const port = 3127
const baseUrl = `http://127.0.0.1:${port}`

type RouteTarget = {
  slug: string
  path: string
  auth: boolean
  expectedStatus?: number
}

const routes: RouteTarget[] = [
  { slug: "root", path: "/", auth: false },
  { slug: "login", path: "/login", auth: false },
  { slug: "registro", path: "/registro", auth: false },
  { slug: "recuperar", path: "/recuperar", auth: false },
  { slug: "ppa-form", path: "/ppa", auth: false },
  { slug: "not-found", path: "/ruta-inexistente-auditoria", auth: true, expectedStatus: 404 },
  { slug: "dashboard", path: "/dashboard", auth: true },
  { slug: "perfil", path: "/perfil", auth: true },
  { slug: "solicitudes", path: "/solicitudes", auth: true },
  { slug: "solicitudes-nueva", path: "/solicitudes/nueva", auth: true },
  { slug: "solicitudes-detalle", path: "/solicitudes/req-audit-1", auth: true },
  { slug: "aprobaciones", path: "/aprobaciones", auth: true },
  { slug: "compras", path: "/compras", auth: true },
  { slug: "compras-nueva", path: "/compras/nueva", auth: true },
  { slug: "compras-detalle", path: "/compras/po-audit-1", auth: true },
  { slug: "recepcion", path: "/recepcion", auth: true },
  { slug: "recepcion-nueva", path: "/recepcion/nueva?oc=po-audit-1", auth: true },
  { slug: "recepcion-detalle", path: "/recepcion/rec-audit-1", auth: true },
  { slug: "bodega", path: "/bodega", auth: true },
  { slug: "entregas", path: "/entregas", auth: true },
  { slug: "trazabilidad", path: "/trazabilidad", auth: true },
  { slug: "reportes", path: "/reportes", auth: true },
  { slug: "repuestos", path: "/repuestos", auth: true },
  { slug: "repuestos-nueva", path: "/repuestos/nueva", auth: true },
  { slug: "repuestos-detalle", path: "/repuestos/rep-audit-1", auth: true },
  { slug: "servicios", path: "/servicios", auth: true },
  { slug: "servicios-nueva", path: "/servicios/nueva", auth: true },
  { slug: "servicios-detalle", path: "/servicios/srv-audit-1", auth: true },
  { slug: "analitica", path: "/analitica", auth: true },
  { slug: "flota", path: "/flota", auth: true },
  { slug: "mantenciones", path: "/mantenciones", auth: true },
  { slug: "prevencion", path: "/prevencion", auth: true },
  { slug: "prevencion-nueva", path: "/prevencion/nueva", auth: true },
  { slug: "prevencion-detalle", path: "/prevencion/sst-audit-1", auth: true },
  { slug: "prevencion-ppa", path: "/prevencion/ppa", auth: true },
  { slug: "prevencion-ppa-detalle", path: "/prevencion/ppa/ppa-audit-1", auth: true },
  { slug: "admin", path: "/admin", auth: true },
  { slug: "admin-auditoria", path: "/admin/auditoria", auth: true },
  { slug: "admin-configuracion", path: "/admin/configuracion", auth: true },
  { slug: "admin-correo-smtp", path: "/admin/correo-smtp", auth: true },
  { slug: "admin-faenas", path: "/admin/faenas", auth: true },
  { slug: "admin-plantillas", path: "/admin/plantillas", auth: true },
  { slug: "admin-productos", path: "/admin/productos", auth: true },
  { slug: "admin-productos-nuevo", path: "/admin/productos/nuevo", auth: true },
  { slug: "admin-productos-detalle", path: "/admin/productos/prod-audit-1", auth: true },
  { slug: "admin-proveedores", path: "/admin/proveedores", auth: true },
  { slug: "admin-trabajadores", path: "/admin/trabajadores", auth: true },
  { slug: "admin-usuarios", path: "/admin/usuarios", auth: true },
  { slug: "forbidden", path: "/forbidden", auth: true },
  { slug: "soporte", path: "/soporte", auth: true },
  { slug: "soporte-nuevo", path: "/soporte/nuevo", auth: true },
  { slug: "soporte-detalle", path: "/soporte/sop-audit-1", auth: true },
]

type AxeViolation = {
  id: string
  impact: string
  description: string
  help: string
  helpUrl: string
  nodes: number
}

type PageResult = {
  slug: string
  path: string
  url: string
  violations: AxeViolation[]
  violationCount: number
  passes: number
  incomplete: number
  inapplicable: number
}

async function login(page: import("@playwright/test").Page) {
  await page.goto(`${baseUrl}/login`)
  await page.fill('input[name="email"], input[type="email"]', "admin.audit@chome.cl")
  await page.fill('input[name="password"], input[type="password"]', "chome2026")
  await page.click('button[type="submit"]')
  await page.waitForURL("**/dashboard", { timeout: 15000 })
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "es-CL",
  })
  const page = await context.newPage()

  // Login first
  await login(page)

  const results: PageResult[] = []

  for (const route of routes) {
    const url = route.auth ? `${baseUrl}${route.path}` : `${baseUrl}${route.path}`
    console.log(`Analyzing: ${route.slug} (${route.path})`)

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })

      // For 404 pages, just record basic info
      if (route.expectedStatus === 404) {
        results.push({
          slug: route.slug,
          path: route.path,
          url,
          violations: [],
          violationCount: 0,
          passes: 0,
          incomplete: 0,
          inapplicable: 0,
        })
        continue
      }

      const axeResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze()

      const violations: AxeViolation[] = axeResults.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? "unknown",
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
      }))

      results.push({
        slug: route.slug,
        path: route.path,
        url,
        violations,
        violationCount: violations.length,
        passes: axeResults.passes.length,
        incomplete: axeResults.incomplete.length,
        inapplicable: axeResults.inapplicable.length,
      })
    } catch (err) {
      console.error(`  Error on ${route.slug}: ${err}`)
      results.push({
        slug: route.slug,
        path: route.path,
        url,
        violations: [],
        violationCount: -1,
        passes: 0,
        incomplete: 0,
        inapplicable: 0,
      })
    }
  }

  await browser.close()

  const outputDir = path.join(process.cwd(), "audit", "screenshots", "2026-06-09-playwright")
  const outputPath = path.join(outputDir, "axe-results.json")
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2))
  console.log(`\nAxe results written to ${outputPath}`)

  // Print summary
  const totalViolations = results.reduce((sum, r) => sum + Math.max(0, r.violationCount), 0)
  const pagesWithViolations = results.filter((r) => r.violationCount > 0).length
  console.log(`\nSummary: ${totalViolations} total violations across ${pagesWithViolations} pages`)
}

main().catch(console.error)
