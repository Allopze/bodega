import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Flota — gestión documental", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("vehicle detail shows documents panel", async ({ page }) => {
    await page.goto("/flota/fuel-veh-e2e")
    await expect(page.getByRole("heading", { name: "Documentos del vehículo" })).toBeVisible({ timeout: 10_000 })
  })
})
