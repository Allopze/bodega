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

    // The reconciliation panel lives in the "Facturación" tab (OcDetailTabs),
    // which isn't the default active tab, and only renders once the OC has
    // an invoice attached.
    await page.getByRole("tab", { name: "Facturación" }).click()
    const conciliacion = page.getByText("Conciliación por ítem")
    await expect(conciliacion).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Total facturado")).toBeVisible()
  })
})
