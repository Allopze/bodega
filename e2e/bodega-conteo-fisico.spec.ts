import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Bodega — conteo físico", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("stock page loads", async ({ page }) => {
    await page.goto("/bodega")
    await expect(page.getByRole("heading", { name: "Bodega" })).toBeVisible()
  })
})
