import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"
import { accessibilityTargets, AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"

/*
 * UX-001 y UX-002 (auditoría 2026-09-14).
 *
 * Antes: una lista `CRITICAL_PAGES` escrita a mano con ~20 rutas sobre 207, y
 * `.disableRules(["color-contrast"])` en las dos suites. Es decir, la
 * auditoría automática dejaba fuera módulos completos —combustibles, flota,
 * mantenciones, facturación, TI, recepción, trazabilidad— y renunciaba al
 * único criterio que más se rompe al cambiar estilos.
 *
 * Ahora el alcance sale del inventario de rutas (el mismo que alimenta las
 * capturas) y las reglas activas están declaradas en un módulo que se verifica
 * sin navegador, en `accessibility-targets.test.ts`.
 */
const targets = accessibilityTargets()

test.describe("Accessibility audit", () => {
  for (const { path, name, auth } of targets) {
    test(`${name} (${path})`, async ({ page }) => {
      if (auth) await login(page)
      await page.goto(path)

      await page.waitForLoadState("networkidle")

      const results = await new AxeBuilder({ page })
        .withTags([...AXE_TAGS])
        .disableRules([...AXE_DISABLED_RULES])
        .analyze()

      expect(results.violations).toEqual([])
    })
  }
})
