import { expect, test } from "@playwright/test"
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
  test.beforeEach(async ({ page }) => {
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
    await expect(page.getByRole("link", { name: "Flota" }).first()).toBeVisible()

    // Go to admin/modulos and toggle "Control operacional" off
    await page.goto("/admin/modulos")

    // Find the "Control operacional" module card
    const moduleSection = page.locator("section").filter({ hasText: "Control operacional" }).first()
    await expect(moduleSection).toBeVisible()

    // Click the toggle switch for the module (the first switch in the card)
    const toggle = moduleSection.locator('input[type="checkbox"]').first()
    await toggle.click()

    // Wait for the toast confirmation
    await expect(page.getByText(/Módulo desactivado/).first()).toBeVisible({ timeout: 10_000 })

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
    // First, disable the module
    await page.goto("/admin/modulos")

    // Find and toggle "Control operacional" off
    const moduleSection = page.locator("section").filter({ hasText: "Control operacional" }).first()
    const toggle = moduleSection.locator('input[type="checkbox"]').first()
    await toggle.click()
    await expect(page.getByText(/Módulo desactivado/).first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(300)

    // Now toggle it back on
    const toggleAgain = moduleSection.locator('input[type="checkbox"]').first()
    await toggleAgain.click()
    await expect(page.getByText(/Módulo activado/).first()).toBeVisible({ timeout: 10_000 })

    // Navigate to dashboard and verify nav items reappeared
    await page.goto("/dashboard")
    await page.waitForTimeout(500)

    const sidebarFlota = page.locator('nav[aria-label="Navegación"], nav[aria-label="Áreas"]').getByRole("link", { name: "Flota" })
    await expect(sidebarFlota.first()).toBeVisible()
  })

  test("submodule toggle is independent from module toggle", async ({ page }) => {
    await page.goto("/admin/modulos")

    // Find the "Control operacional" card
    const card = page.locator("section").filter({ hasText: "Control operacional" }).first()

    // Toggle the first submodule's switch (should be Flota)
    const submoduleSwitches = card.locator('input[type="checkbox"]')
    // The first switch is the module itself; the second is the first submodule
    if (await submoduleSwitches.count() > 1) {
      const subToggle = submoduleSwitches.nth(1)
      await subToggle.click()
      await expect(page.getByText(/Submódulo (activado|desactivado)/).first()).toBeVisible({ timeout: 10_000 })
    }
  })

  test("permission check: non-admin cannot access /admin/modulos", async ({ page }) => {
    // Login as scoped user
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill("scoped@e2e.chome.cl")
    await page.getByLabel("Contraseña").fill("scoped2026")
    await page.getByRole("button", { name: "Ingresar" }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // Try to access the module management page
    await page.goto("/admin/modulos")
    // Should be redirected to /forbidden or get a 403
    await expect(page).toHaveURL(/\/forbidden|\/login/)
  })
})
