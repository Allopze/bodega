import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E tests for the module toggle feature.
 *
 * Prereq: setup-db.ts seeds the admin user (admin@e2e.chome.cl / chome2026)
 * with full admin permissions including admin:module_management.
 *
 * Flow:
 *   1. Login as admin
 *   2. Navigate to /admin/modulos
 *   3. Toggle the "Control operacional" module off
 *   4. Verify nav items for that module disappear
 *   5. Re-toggle the module on
 *   6. Verify nav items reappear
 */

test.describe("Module toggles", () => {
  function flotaModuleSection(page: import("@playwright/test").Page) {
    // Varias tarjetas mencionan "Flota" (Combustibles y Mantenciones enlazan
    // catálogos de flota), así que filtrar por texto elige la sección
    // equivocada. El identificador del módulo dejó de pintarse en la interfaz
    // —era jerga— y vive ahora en `data-module-id`, que sigue siendo único.
    return page.locator("section[data-module-id='flota']").first()
  }

  /** Apagar exige confirmar el impacto; encender no. */
  async function confirmDisable(page: import("@playwright/test").Page, label: string) {
    await page.getByRole("button", { name: label }).click()
  }

  async function resetFlotaToggles() {
    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await sql`
        delete from system_settings
        where key in ('module.enabled:flota', 'submodule.enabled:flota:/flota')
      `
    } finally {
      await sql.end()
    }
  }

  test.beforeEach(async ({ page }) => {
    await resetFlotaToggles()
    await login(page)
  })

  // El `beforeEach` protege a las pruebas de este archivo, pero no a las que
  // vienen después: si la última muere con Flota apagada, el ajuste es global y
  // los specs siguientes del mismo shard ven una navegación mutilada — y fallan
  // lejos de la causa. Restaurar al final cierra esa dependencia de orden.
  test.afterAll(async () => {
    await resetFlotaToggles()
  })

  test("admin/modulos page loads and shows module list", async ({ page }) => {
    await page.goto("/admin/modulos")
    await expect(page.getByRole("heading", { name: "Módulos del sistema" })).toBeVisible()

    // Should show the summary with module count
    await expect(page.getByText(/de \d+ módulos activos/)).toBeVisible()
  })

  test("toggle a module off and verify nav items disappear", async ({ page }) => {
    // First, verify the "Control operacional" nav is visible before toggle
    await page.goto("/dashboard")
    await page.getByRole("button", { name: "Control operacional" }).click()
    await expect(page.getByRole("link", { name: "Flota" }).first()).toBeVisible()

    // Go to admin/modulos and toggle "Control operacional" off
    await page.goto("/admin/modulos")

    // Find the "Control operacional" module card
    const moduleSection = flotaModuleSection(page)
    await expect(moduleSection).toBeVisible()

    // Click the toggle switch for the module (the first switch in the card)
    await moduleSection.getByLabel("Desactivar módulo Flota").click({ force: true })
    // La confirmación nombra lo que se va a ocultar; sin ella no hay cambio.
    await expect(page.getByRole("dialog")).toContainText("rutas, acciones y automatizaciones")
    const disableResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await confirmDisable(page, "Desactivar módulo")
    await disableResponse
    await page.reload()
    await expect(flotaModuleSection(page).getByLabel("Activar módulo Flota")).toBeVisible()

    // Verify nav items disappeared — navigate back to dashboard
    await page.goto("/dashboard")

    // The Flota link should no longer be visible in the main nav
    // (it might still be in the collapsed rail, but the main panel item should be gone)
    await page.waitForTimeout(500) // Allow nav to re-render
    // There might be icons/avatars with "Flota" text elsewhere;
    // check that it's NOT in the sidebar navigation
    const sidebarFlota = page.locator('nav[aria-label="Navegación"], nav[aria-label="Áreas"]').getByRole("link", { name: "Flota" })
    await expect(sidebarFlota).toHaveCount(0)

    await page.goto("/flota")
    await expect(page).toHaveURL(/\/modulo-inactivo\?desde=%2Fflota/)
    await expect(page.getByRole("heading", { name: "Módulo inactivo" })).toBeVisible()

    // But the admin page should still be accessible since it's a different module
    await page.goto("/admin/modulos")
    await expect(page.getByRole("heading", { name: "Módulos del sistema" })).toBeVisible()
  })

  test("toggle a module back on and verify nav items reappear", async ({ page }) => {
    await page.goto("/admin/modulos")

    // Find and toggle "Control operacional" off
    const moduleSection = flotaModuleSection(page)
    const disableToggle = moduleSection.getByLabel("Desactivar módulo Flota")
    await expect(disableToggle).toBeVisible()
    await disableToggle.click({ force: true })
    const disableResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await confirmDisable(page, "Desactivar módulo")
    await disableResponse
    await page.waitForTimeout(300)

    // Now toggle it back on
    await page.reload()
    const refreshedModuleSection = flotaModuleSection(page)
    // `force: true` desactiva la auto-espera de Playwright, así que tras un
    // reload el clic puede caer antes de que el interruptor tenga caja y
    // fallar con "Element is not visible". Esperar explícitamente devuelve esa
    // espera sin cambiar la semántica del clic sobre un input `sr-only`.
    const enableToggle = refreshedModuleSection.getByLabel("Activar módulo Flota")
    await expect(enableToggle).toBeVisible()
    const enableResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await enableToggle.click({ force: true })
    await enableResponse
    await page.reload()
    await expect(flotaModuleSection(page).getByLabel("Desactivar módulo Flota")).toBeVisible()

    // Navigate to dashboard and verify nav items reappeared
    await page.goto("/dashboard")
    await page.getByRole("button", { name: "Control operacional" }).click()
    await page.waitForTimeout(500)

    const sidebarFlota = page.locator('nav[aria-label="Navegación"], nav[aria-label="Áreas"]').getByRole("link", { name: "Flota" })
    await expect(sidebarFlota.first()).toBeVisible()
  })

  test("submodule toggle is independent from module toggle", async ({ page }) => {
    await page.goto("/admin/modulos")

    // Find the "Control operacional" card
    const card = flotaModuleSection(page)

    // Selecciona Flota por su contrato accesible, no por posición: Control
    // operacional comparte la tarjeta y puede agregar superficies antes.
    const subToggle = card.getByLabel("Desactivar Flota")
    await expect(subToggle).toBeVisible()
    await subToggle.click({ force: true })
    const submoduleResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await confirmDisable(page, "Ocultar pantalla")
    await submoduleResponse
    await page.goto("/flota")
    await expect(page).toHaveURL(/\/modulo-inactivo\?desde=%2Fflota/)
  })

  test("la confirmación es la única vía: cancelar deja el módulo encendido", async ({ page }) => {
    await page.goto("/admin/modulos")
    const moduleSection = flotaModuleSection(page)
    await moduleSection.getByLabel("Desactivar módulo Flota").click({ force: true })

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // El diálogo nombra las pantallas afectadas, no pregunta "¿estás seguro?".
    await expect(dialog).toContainText("rutas, acciones y automatizaciones")

    await dialog.getByRole("button", { name: "Cancelar" }).click()
    await page.reload()
    await expect(flotaModuleSection(page).getByLabel("Desactivar módulo Flota")).toBeVisible()
  })

  test("permission check: non-admin cannot access /admin/modulos", async ({ browser }) => {
    // Login as scoped user
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill("scoped@e2e.chome.cl")
    await page.getByLabel("Contraseña", { exact: true }).fill("scoped2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // Try to access the module management page
    await page.goto("/admin/modulos")
    // Should be redirected to /forbidden or get a 403
    await expect(page).toHaveURL(/\/forbidden|\/login/)
    await context.close()
  })
})
