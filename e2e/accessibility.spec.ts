import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"

const CRITICAL_PAGES = [
  { path: "/dashboard",        name: "Dashboard" },
  { path: "/solicitudes",      name: "Solicitudes" },
  { path: "/solicitudes/nueva", name: "Nueva solicitud" },
  { path: "/aprobaciones",     name: "Aprobaciones" },
  { path: "/compras",          name: "Compras" },
  { path: "/compras/nueva",    name: "Nueva compra" },
  { path: "/recepcion",        name: "Recepción" },
  { path: "/bodega",           name: "Bodega" },
  { path: "/entregas",         name: "Entregas" },
  { path: "/trazabilidad",     name: "Trazabilidad" },
  { path: "/reportes",         name: "Reportes" },
  { path: "/admin/faenas",     name: "Admin faenas" },
  { path: "/admin/usuarios",   name: "Admin usuarios" },
  { path: "/admin/productos",  name: "Admin productos" },
  { path: "/admin/proveedores", name: "Admin proveedores" },
  { path: "/admin/trabajadores", name: "Admin trabajadores" },
  { path: "/admin/auditoria",  name: "Admin auditoría" },
  { path: "/login",            name: "Login" },
  { path: "/prevencion/pdtp",             name: "PDTP — Programas" },
  { path: "/prevencion/pdtp/nuevo",       name: "PDTP — Nuevo programa" },
  { path: "/prevencion/pdtp/obligaciones", name: "PDTP — Trabajo por eventos" },
  { path: "/prevencion/pdtp/plantillas",  name: "PDTP — Plantillas" },
  { path: "/prevencion/pdtp/aprobaciones", name: "PDTP — Aprobaciones" },
  { path: "/prevencion/pdtp/acciones",    name: "PDTP — Acciones correctivas" },
  { path: "/prevencion/pdtp/cobertura",   name: "PDTP — Cobertura MIPER y legal" },
]

test.describe("Accessibility audit", () => {
  for (const { path, name } of CRITICAL_PAGES) {
    test(`${name} (${path})`, async ({ page }) => {
      await login(page)
      await page.goto(path)

      await page.waitForLoadState("networkidle")

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"]) // audited separately in AUDITORIA.md
        .analyze()

      expect(results.violations).toEqual([])
    })
  }
})
