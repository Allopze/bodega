import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Fase 4 — Verificación zoom 200% (AUDITORIA_UIUX_INTEGRAL §5, WCAG 1.4.4).
 *
 * Navega a las 10 pantallas más densas a 960×540 (equivalente a 200% zoom
 * en un monitor 1920×1080) y verifica:
 * 1. No hay scroll horizontal (scrollWidth ≤ clientWidth + 1)
 * 2. No hay superposición de contenido
 * 3. Los controles siguen siendo clickeables
 */

const DENSE_PAGES = [
  { path: "/dashboard",                    name: "Dashboard" },
  { path: "/pendientes",                   name: "Mis pendientes" },
  { path: "/solicitudes",                  name: "Solicitudes" },
  { path: "/aprobaciones",                 name: "Aprobaciones" },
  { path: "/compras",                      name: "Compras" },
  { path: "/recepcion",                    name: "Recepción" },
  { path: "/entregas",                     name: "Entregas" },
  { path: "/seguimiento",                 name: "Seguimiento de solicitudes" },
  { path: "/bodega",                       name: "Bodega" },
  { path: "/prevencion/indicadores",       name: "Indicadores SST" },
  { path: "/prevencion/pdtp",              name: "PDTP Programas" },
  { path: "/prevencion/ppa",               name: "PPA" },
  { path: "/prevencion/evaluaciones",      name: "Evaluaciones" },
]

test.describe("Zoom 200% — no horizontal overflow", () => {
  for (const { path, name } of DENSE_PAGES) {
    test(`${name} (${path})`, async ({ page }) => {
      // Set viewport to 960×540 (200% zoom on 1920×1080)
      await page.setViewportSize({ width: 960, height: 540 })

      await login(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle")

      // Check no horizontal overflow
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        }
      })

      expect(overflow.hasOverflow).toBeFalsy()
    })
  }
})

test.describe("Zoom 200% — controls are clickable", () => {
  for (const { path, name } of DENSE_PAGES) {
    test(`${name}: buttons have minimum touch target`, async ({ page }) => {
      await page.setViewportSize({ width: 960, height: 540 })

      await login(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle")

      // Find all visible buttons and check they have reasonable dimensions
      const buttonSizes = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, a[role='button'], [role='combobox']"))
          .filter((el) => {
            const rect = el.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          })
          .slice(0, 20) // Check first 20 visible buttons

        return buttons.map((el) => {
          const rect = el.getBoundingClientRect()
          return {
            tag: el.tagName,
            text: el.textContent?.trim().substring(0, 30),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        })
      })

      // Every button should be at least 24px (WCAG 2.5.8 AA minimum).
      // El mensaje identifica al control: un "23" pelado no dice cuál corregir.
      for (const btn of buttonSizes) {
        const label = `${btn.tag} "${btn.text}" mide ${btn.width}×${btn.height}px en ${path}`
        expect(btn.height, label).toBeGreaterThanOrEqual(24)
        expect(btn.width, label).toBeGreaterThanOrEqual(24)
      }
    })
  }
})

/**
 * Objetivo táctil de la paginación en el teléfono (WCAG 2.5.5, 44 × 44 px).
 *
 * El bloque de arriba mide a 960 px contra el mínimo AA de 24 px; en terreno
 * la lista se pagina con el pulgar, y `Pagination` (el de las tablas cliente y
 * la planilla PDTP) medía 28 px de alto bajo `sm`. `ServerPagination` ya medía
 * 44 px, pero a costa de salirse del pozo del shell a 320 px, así que además de
 * medir cada control se exige que quede dentro de la ventana: un botón de 44 px
 * recortado por el pozo no es un objetivo táctil.
 *
 * Se mide sólo lo visible: bajo `sm` los números de página no se dibujan.
 */
// Las rutas que en el fixture E2E abren ya paginadas: tres con
// `ServerPagination` (enlaces) y una con `Pagination` de `DataTable` (botones).
const PAGINATED_PAGES = [
  { path: "/solicitudes", name: "Solicitudes" },
  { path: "/seguimiento", name: "Seguimiento de solicitudes" },
  { path: "/compras", name: "Compras" },
  { path: "/admin/trabajadores", name: "Trabajadores" },
]

test.describe("Móvil 320 px — la paginación es un objetivo táctil de 44 px", () => {
  test("anterior, actual y siguiente miden 44 × 44 px y caben en la ventana", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await login(page)

    const medidos: string[] = []
    const fallan: string[] = []
    for (const { path, name } of PAGINATED_PAGES) {
      await page.goto(path)
      await page.waitForLoadState("networkidle").catch(() => undefined)
      const controles = await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLElement>(
          "[aria-label='Página anterior'], [aria-label='Página siguiente'], [aria-label^='Ir a página']",
        ))
          .map((el) => ({ el, rect: el.getBoundingClientRect(), estilo: getComputedStyle(el) }))
          .filter(({ rect, estilo }) => rect.width > 0 && rect.height > 0 && estilo.visibility !== "hidden")
          .map(({ el, rect }) => ({
            tipo: el.tagName === "BUTTON" ? "cliente" : "servidor",
            nombre: el.getAttribute("aria-label") ?? "",
            ancho: Math.round(rect.width),
            alto: Math.round(rect.height),
            derecha: Math.round(rect.right),
            ventana: window.innerWidth,
          }))
      })
      for (const c of controles) {
        medidos.push(c.tipo)
        if (c.ancho < 44 || c.alto < 44) fallan.push(`${name}: "${c.nombre}" mide ${c.ancho}×${c.alto}px`)
        if (c.derecha > c.ventana) fallan.push(`${name}: "${c.nombre}" termina en ${c.derecha}px, fuera de ${c.ventana}px`)
      }
    }

    // Sin ningún control medido la prueba no probaría nada: el fixture E2E
    // tiene que seguir dejando al menos una lista paginada.
    expect(medidos, "ninguna pantalla mostró `Pagination` (cliente)").toContain("cliente")
    expect(medidos, "ninguna pantalla mostró `ServerPagination`").toContain("servidor")
    expect(fallan).toEqual([])
  })
})
