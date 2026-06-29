import { test, expect } from "@playwright/test"
import { login } from "./helpers"

const OC_FIXTURE_ID = "oc-e2e"

test.describe("Conciliación OC-factura-recepción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("OC detail page loads and shows conciliación panel", async ({ page }) => {
    await page.goto(`/compras/${OC_FIXTURE_ID}`)
    await expect(page.getByRole("heading", { name: /OC-2026/ })).toBeVisible({ timeout: 10_000 })

    // The conciliación panel should be visible (fixture now has received quantities)
    const conciliacion = page.getByText("Conciliación OC-factura-recepción")
    await expect(conciliacion).toBeVisible({ timeout: 10_000 })
  })
})
