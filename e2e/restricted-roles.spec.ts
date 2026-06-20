/**
 * E2E test: scope enforcement for restricted roles.
 *
 * Verifies that a user with `solicitante_faena` role assigned to a single
 * worksite cannot see data from other worksites.
 *
 * Prereq: setup-db.ts seeds user-scoped-e2e (scoped@e2e.chome.cl / scoped2026)
 * with access to ws-e2e but NOT ws-restricted-e2e.
 */

import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Restricted roles — faena scope enforcement", () => {
  test("scoped user cannot see the ws-restricted worksite in dashboard or solicitudes", async ({ page }) => {
    // Log in as the scoped user
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill("scoped@e2e.chome.cl")
    await page.getByLabel("Contraseña").fill("scoped2026")
    await page.getByRole("button", { name: "Ingresar" }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // Navigate to solicitudes
    await page.goto("/solicitudes")
    await page.waitForLoadState("networkidle")

    // The scoped user should only see solicitudes from ws-e2e, not ws-restricted-e2e
    // If any solicitud exists in the list, its worksite should not be ws-restricted
    const pageText = await page.textContent("body")
    expect(pageText).not.toContain("Faena Restringida")
    expect(pageText).not.toContain("E2E-RESTR")
  })

  test("scoped user cannot create a request for a worksite outside their scope", async ({ page }) => {
    // Log in as scoped user
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill("scoped@e2e.chome.cl")
    await page.getByLabel("Contraseña").fill("scoped2026")
    await page.getByRole("button", { name: "Ingresar" }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // Try to navigate to nueva solicitud
    await page.goto("/solicitudes/nueva")
    await page.waitForLoadState("networkidle")

    // The worksite select should NOT include the restricted faena
    // This is a Radix Select component; check the trigger area
    const pageText = await page.textContent("body")
    expect(pageText).not.toContain("Faena Restringida")
    expect(pageText).not.toContain("E2E-RESTR")
  })

  test("admin user can see all worksites across the system", async ({ page }) => {
    // Log in as admin
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
    await page.getByLabel("Contraseña").fill("chome2026")
    await page.getByRole("button", { name: "Ingresar" }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    // Admin should have full access — can navigate to admin/faenas
    await page.goto("/admin/faenas")
    await page.waitForLoadState("networkidle")

    // Should see both worksites
    const pageText = await page.textContent("body")
    expect(pageText).toContain("Faena E2E")
    expect(pageText).toContain("Faena Restringida")
  })
})
