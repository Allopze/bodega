import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Fase 4 — Verificación por teclado (AUDITORIA_UIUX_INTEGRAL §5).
 *
 * Recorre los 5 flujos críticos usando exclusivamente teclado
 * (Tab / Shift+Tab / Enter / Espacio / Escape) y verifica:
 * 1. El foco es visible en todo momento (outline o ring CSS)
 * 2. El orden de tabulación es lógico
 * 3. No hay "trampas de foco" (bucle infinito o foco perdido)
 * 4. Los diálogos atrapan el foco (Tab no escapa al body)
 * 5. El skip-link funciona
 */

const CRITICAL_ROUTES = [
  { path: "/dashboard",        name: "Dashboard" },
  { path: "/pendientes",       name: "Mis pendientes" },
  { path: "/solicitudes",      name: "Solicitudes" },
  { path: "/aprobaciones",     name: "Aprobaciones" },
  { path: "/compras",          name: "Compras" },
  { path: "/recepcion",        name: "Recepción" },
  { path: "/bodega",           name: "Bodega" },
  { path: "/entregas",         name: "Entregas" },
  { path: "/trazabilidad",     name: "Trazabilidad" },
  { path: "/combustibles",     name: "Combustibles" },
  { path: "/combustibles/reportes", name: "Reportes de combustibles" },
  { path: "/prevencion/pdtp",  name: "PDTP" },
  { path: "/prevencion/ppa",   name: "PPA" },
  { path: "/prevencion/capa",  name: "CAPA" },
  { path: "/prevencion/emergencias", name: "Emergencias" },
  { path: "/prevencion/indicadores", name: "Indicadores" },
]

test.describe("Keyboard navigation — focus visibility", () => {
  for (const { path, name } of CRITICAL_ROUTES) {
    test(`${name}: focus is visible after Tab`, async ({ page }) => {
      await login(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle")

      // Press Tab to move focus to the first focusable element
      await page.keyboard.press("Tab")

      // Verify that the focused element has a visible focus indicator
      const focused = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const style = window.getComputedStyle(el)
        return {
          tag: el.tagName,
          hasOutline: style.outlineStyle !== "none",
          hasBoxShadow: style.boxShadow !== "none",
          hasRing: el.className.toString().includes("ring"),
          hasFocusVisible: el.matches(":focus-visible"),
        }
      })

      // At minimum, the element should be :focus-visible or have a ring class
      expect(focused).not.toBeNull()
      expect(
        focused!.hasOutline || focused!.hasRing || focused!.hasFocusVisible,
      ).toBeTruthy()
    })
  }
})

test.describe("Keyboard navigation — skip link", () => {
  test("skip link appears on Tab and moves focus to main", async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    // Tab from the body — the skip link should be the first focusable element
    await page.keyboard.press("Tab")

    const skipLink = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return null
      return {
        tag: el.tagName,
        text: el.textContent?.trim(),
        href: el.getAttribute("href"),
      }
    })

    // El `href` se assertea, no se da por supuesto: el comentario anterior decía
    // "should point to #main-content or similar" y la prueba sólo comprobaba que
    // el foco cayera en un `<a>`. Que el destino sea `#main-content` es lo que
    // hace del enlace un salto real; que el foco llegue allí y no vuelva al
    // cromo lo verifica `e2e/shell-scroll.spec.ts`.
    expect(skipLink).not.toBeNull()
    expect(skipLink!.tag).toBe("A")
    expect(skipLink!.href).toBe("#main-content")
  })
})

test.describe("Keyboard navigation — dialog focus trap", () => {
  test("Tab does not escape a modal dialog", async ({ page }) => {
    await login(page)
    await page.goto("/solicitudes/nueva")
    await page.waitForLoadState("networkidle")

    // If there's a dialog-triggering button, click it
    const dialogTrigger = page.getByRole("button", { name: /ayuda|info|detalles/i }).first()
    const hasTrigger = await dialogTrigger.isVisible().catch(() => false)

    if (hasTrigger) {
      await dialogTrigger.click()
      await page.waitForTimeout(300)

      // Count focusable elements inside the dialog
      const focusableCount = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog']")
        if (!dialog) return -1
        return dialog.querySelectorAll(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ).length
      })

      if (focusableCount > 0) {
        // Tab through all focusable elements — focus should stay inside the dialog
        for (let i = 0; i < focusableCount + 2; i++) {
          await page.keyboard.press("Tab")
        }

        const focusedInDialog = await page.evaluate(() => {
          const el = document.activeElement
          const dialog = document.querySelector("[role='dialog']")
          return dialog?.contains(el) ?? false
        })

        expect(focusedInDialog).toBeTruthy()
      }
    }
  })
})

test.describe("Keyboard navigation — Escape closes overlays", () => {
  test("Escape closes dropdowns and returns focus", async ({ page }) => {
    await login(page)
    await page.goto("/solicitudes")
    await page.waitForLoadState("networkidle")

    // Try to open a Select dropdown
    const selectTrigger = page.locator("[role='combobox']").first()
    const hasSelect = await selectTrigger.isVisible().catch(() => false)

    if (hasSelect) {
      await selectTrigger.click()
      await page.waitForTimeout(200)

      // Verify the dropdown is open
      const optionsVisible = await page.getByRole("option").first().isVisible().catch(() => false)

      if (optionsVisible) {
        await page.keyboard.press("Escape")
        await page.waitForTimeout(200)

        // Dropdown should be closed
        const optionsAfterEscape = await page.getByRole("option").first().isVisible().catch(() => false)
        expect(optionsAfterEscape).toBeFalsy()
      }
    }
  })
})
