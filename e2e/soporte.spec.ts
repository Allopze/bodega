import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Soporte module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("report list page loads", async ({ page }) => {
    await page.goto("/soporte")
    await expect(page.getByRole("heading", { name: "Soporte" })).toBeVisible()
  })

  test("new report form loads", async ({ page }) => {
    await page.goto("/soporte/nuevo")
    await expect(page.getByLabel("Título")).toBeVisible({ timeout: 10_000 })
  })
})
