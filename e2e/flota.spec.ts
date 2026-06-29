import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Flota module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("overview page loads", async ({ page }) => {
    await page.goto("/flota")
    await expect(page.getByRole("heading", { name: "Flota" })).toBeVisible()
  })

  test("vehicle detail page loads", async ({ page }) => {
    await page.goto("/flota/fuel-veh-e2e")
    await expect(page.getByRole("heading", { name: /Patente/ }).or(page.getByText("Datos operacionales"))).toBeVisible({ timeout: 10_000 })
  })
})
