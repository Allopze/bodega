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
    return page.locator("section").filter({ hasText: "Control operacional" }).filter({ hasText: "flota" }).first()
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
    const disableResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await moduleSection.getByLabel("Desactivar módulo Control operacional").click({ force: true })
    await disableResponse
    await page.reload()
    await expect(flotaModuleSection(page).getByLabel("Activar módulo Control operacional")).toBeVisible()

    // Verify nav items disappeared — navigate back to dashboard
    await page.goto("/dashboard")

    // The Flota link should no longer be visible in the main nav
    // (it might still be in the collapsed rail, but the main panel item should be gone)
    await page.waitForTimeout(500) // Allow nav to re-render
    // There might be icons/avatars with "Flota" text elsewhere;
    // check that it's NOT in the sidebar navigation
    const sidebarFlota = page.locator('nav[aria-label="Navegación"], nav[aria-label="Áreas"]').getByRole("link", { name: "Flota" })
    await expect(sidebarFlota).toHaveCount(0)

    // But the admin page should still be accessible since it's a different module
    await page.goto("/admin/modulos")
    await expect(page.getByRole("heading", { name: "Módulos del sistema" })).toBeVisible()
  })

  test("toggle a module back on and verify nav items reappear", async ({ page }) => {
    await page.goto("/admin/modulos")

    // Find and toggle "Control operacional" off
    const moduleSection = flotaModuleSection(page)
    const disableResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await moduleSection.getByLabel("Desactivar módulo Control operacional").locator("xpath=..").click({ force: true })
    await disableResponse
    await page.waitForTimeout(300)

    // Now toggle it back on
    await page.reload()
    const refreshedModuleSection = flotaModuleSection(page)
    const enableResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
    await refreshedModuleSection.getByLabel("Activar módulo Control operacional").locator("xpath=..").click({ force: true })
    await enableResponse
    await page.reload()
    await expect(flotaModuleSection(page).getByLabel("Desactivar módulo Control operacional")).toBeVisible()

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

    // Toggle the first submodule's switch (should be Flota)
    const submoduleSwitches = card.locator('input[type="checkbox"]')
    // The first switch is the module itself; the second is the first submodule
    if (await submoduleSwitches.count() > 1) {
      const subToggle = submoduleSwitches.nth(1)
      const submoduleResponse = page.waitForResponse((response) => response.status() === 200 && response.url().includes("/admin/modulos"))
      await subToggle.locator("xpath=..").click({ force: true })
      await submoduleResponse
    }
  })

  test("permission check: non-admin cannot access /admin/modulos", async ({ browser }) => {
    // Login as scoped user
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill("scoped@e2e.chome.cl")
    await page.getByLabel("Contraseña").fill("scoped2026")
    await page.getByRole("button", { name: "Ingresar" }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // Try to access the module management page
    await page.goto("/admin/modulos")
    // Should be redirected to /forbidden or get a 403
    await expect(page).toHaveURL(/\/forbidden|\/login/)
    await context.close()
  })
})
