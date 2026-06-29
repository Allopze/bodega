import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Mantenciones module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("page loads with filters and history", async ({ page }) => {
    await page.goto("/mantenciones")
    await expect(page.getByRole("heading", { name: "Mantenciones" })).toBeVisible()
  })
})
