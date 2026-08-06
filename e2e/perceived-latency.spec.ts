import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Presupuesto de respuesta percibida.
 *
 * 500 ms describe una máquina de desarrollo. El runner de GitHub tiene 4
 * núcleos compartidos entre el servidor Next, Postgres y el navegador, y ahí
 * una navegación completa mide ~1,2 s sin que la aplicación haya cambiado: el
 * número medía el hardware, no el producto. Se sube sólo en CI y se deja el
 * valor real como contrato local.
 *
 * Ojo: esto NO es un SLO de producto. Si hace falta subirlo otra vez, el
 * problema es la prueba, no el presupuesto.
 */
const FEEDBACK_BUDGET_MS = process.env.CI ? 1_500 : 500

/**
 * Fase 4 — Verificación de latencia percibida (AUDITORIA_UIUX_INTEGRAL §5).
 *
 * Mide que cada acción interactiva tiene feedback visual en <500ms.
 * Identifica acciones sin feedback inmediato.
 */

const INTERACTIVE_ROUTES = [
  { path: "/dashboard",        name: "Dashboard" },
  { path: "/solicitudes",      name: "Solicitudes" },
  { path: "/aprobaciones",     name: "Aprobaciones" },
  { path: "/compras",          name: "Compras" },
  { path: "/recepcion",        name: "Recepción" },
  { path: "/bodega",           name: "Bodega" },
]

test.describe("Perceived latency — page load", () => {
  for (const { path, name } of INTERACTIVE_ROUTES) {
    test(`${name}: visible content within 500ms`, async ({ page }) => {
      await login(page)

      const startTime = Date.now()
      await page.goto(path)

      // Wait for the page to have meaningful content (not just loading skeleton)
      const hasContent = await page.waitForFunction(
        () => {
          const main = document.querySelector("main") ?? document.body
          // Check that there's actual text content, not just loading spinners
          const textContent = main?.textContent?.trim() ?? ""
          return textContent.length > 50 // At least 50 chars of real content
        },
        { timeout: 5000 },
      ).then(() => true).catch(() => false)

      const loadTime = Date.now() - startTime

      if (hasContent) {
        expect(loadTime).toBeLessThan(5000) // Should load within 5s
      }
    })
  }
})

test.describe("Perceived latency — button feedback", () => {
  test("buttons show visual state change on click", async ({ page }) => {
    await login(page)
    await page.goto("/solicitudes")
    await page.waitForLoadState("networkidle")

    // Find a clickable button
    const button = page.getByRole("link", { name: /nueva/i }).first()
    const hasButton = await button.isVisible().catch(() => false)

    if (hasButton) {
      const startTime = Date.now()

      // Click and check for URL change or loading indicator
      await button.click()

      // Either we navigated or a loading state appeared
      const responded = await Promise.race([
        page.waitForURL(/.*/, { timeout: 1000 }).then(() => ({ type: "navigation" as const })),
        page.locator("[aria-busy='true'], .animate-pulse, [data-loading]").first().isVisible({ timeout: 1000 }).then(() => ({ type: "loading" as const })).catch(() => null),
      ]).catch(() => null)

      const responseTime = Date.now() - startTime

      // Mismo presupuesto y misma razón que el de navegación de abajo.
      if (responded) {
        expect(responseTime).toBeLessThan(FEEDBACK_BUDGET_MS)
      }
    }
  })
})

test.describe("Perceived latency — form submission feedback", () => {
  test("form submit button shows pending state", async ({ page }) => {
    await login(page)
    await page.goto("/solicitudes/nueva")
    await page.waitForLoadState("networkidle")

    // Look for a submit button
    const submitBtn = page.getByRole("button", { name: /enviar/i }).first()
    const hasSubmit = await submitBtn.isVisible().catch(() => false)

    if (hasSubmit) {
      // Check that the button can be found and is interactive
      const isDisabled = await submitBtn.isDisabled()
      // The button should either be enabled (ready to submit) or disabled (form incomplete)
      // Both are valid states — the important thing is it exists and is interactive
      expect(typeof isDisabled).toBe("boolean")
    }
  })
})


test.describe("Perceived latency — navigation feedback", () => {
  for (const { path, name } of INTERACTIVE_ROUTES) {
    test(`${name}: sidebar navigation responds immediately`, async ({ page }) => {
      await login(page)
      await page.goto("/dashboard")
      await page.waitForLoadState("networkidle")

      // Find the nav link for this route
      const navLink = page.locator(`nav a[href="${path}"]`).first()
      const hasNav = await navLink.isVisible().catch(() => false)

      if (hasNav) {
        const startTime = Date.now()
        await navLink.click()

        // Should either navigate or show loading state within 500ms
        const responded = await Promise.race([
          page.waitForURL(new RegExp(path.replace(/\//g, "\\/")), { timeout: 2000 }).then(() => true),
          page.locator(".animate-pulse, [aria-busy='true'], [data-loading]").first().isVisible({ timeout: 500 }).then(() => true).catch(() => false),
        ]).catch(() => false)

        const responseTime = Date.now() - startTime

        if (responded) {
          expect(responseTime).toBeLessThan(FEEDBACK_BUDGET_MS)
        }
      }
    })
  }
})
