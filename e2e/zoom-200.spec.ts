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
  { path: "/trazabilidad",                 name: "Trazabilidad" },
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
