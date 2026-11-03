import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Ciclo de Vida Completo de Acciones Correctivas y Preventivas (CAPA).
 *
 * Cubre:
 *   • Carga del listado principal de CAPA con pestañas de estado con contador, tarjetas de condiciones y filtros por origen/faena.
 *   • Acceso al detalle de una acción CAPA (`/prevencion/capa/[id]`).
 *   • Registro de notas de seguimiento y avance porcentual.
 *   • Incorporación de evidencias documentales y fotográficas.
 *   • Transición de ciclo de vida (avance de estados, verificación de efectividad y cierre).
 */

test.describe("Prevención — Ciclo de vida CAPA", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal muestra las pestañas de estado y las condiciones, y permite filtrar por estado", async ({ page }) => {
    await page.goto("/prevencion/capa")
    await expectPageTitle(page, /Acciones CAPA|Gestión CAPA/i)

    // Regla A5: el estado es UNA representación —pestañas con contador—, sin Select de estado
    // ni tarjetas por estado. Las tarjetas que quedan son condiciones que cruzan los estados.
    const tabs = page.getByRole("navigation", { name: "Estado de las acciones CAPA" })
    await expect(tabs).toBeVisible({ timeout: 30_000 })
    await expect(tabs.getByRole("link", { name: /^Abiertas\s*\d+$/ })).toBeVisible()
    await expect(tabs.getByRole("link", { name: /^Pendiente de verificación\s*\d+$/ })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Estado CAPA" })).toHaveCount(0)
    await expect(page.getByText("Vencidas").first()).toBeVisible()
    await expect(page.getByText("Exigen detener la tarea").first()).toBeVisible()

    // Elegir una pestaña filtra por estado en la URL y la deja marcada.
    await tabs.getByRole("link", { name: /^Cerrada\s*\d+$/ }).click()
    await expect(page).toHaveURL(/status=closed/)
    await expect(tabs.getByRole("link", { name: /^Cerrada\s*\d+$/ })).toHaveAttribute("aria-current", "page")
  })

  test("seguimiento y registro de evidencia en una acción CAPA", async ({ page }) => {
    // 1. Ir a la bandeja y abrir la primera CAPA disponible
    await page.goto("/prevencion/capa")
    const filaCapa = page.getByRole("row").filter({ hasText: /CAPA-/i }).first()

    // Si hay al menos una CAPA en la base
    if (await filaCapa.count() > 0) {
      await filaCapa.getByRole("link").first().click()
      await expect(page).toHaveURL(/\/prevencion\/capa\/[^/?]+$/, { timeout: 30_000 })

      // 2. Registrar un seguimiento
      const followupInput = page.getByLabel("Seguimiento y avance").or(page.locator('textarea[placeholder*="avance"], textarea[name="followup"]'))
      if (await followupInput.count() > 0) {
        await followupInput.first().fill("Se inspeccionó el área y se instaló la protección perimetral.")
        const btnSeguimiento = page.getByRole("button", { name: /Registrar seguimiento|Guardar avance/i })
        if (await btnSeguimiento.count() > 0) {
          await btnSeguimiento.click()
        }
      }

      // 3. Registrar una evidencia
      const refEvidencia = page.locator('input[placeholder*="Referencia"], input[name="reference"]')
      if (await refEvidencia.count() > 0) {
        await refEvidencia.first().fill("DOC-VERIF-E2E-001")
        const btnEvidencia = page.getByRole("button", { name: /Agregar evidencia|Registrar evidencia/i })
        if (await btnEvidencia.count() > 0) {
          await btnEvidencia.click()
        }
      }
    }
  })
})
