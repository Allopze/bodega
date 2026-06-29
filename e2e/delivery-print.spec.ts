import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Entregas — comprobante firmado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("comprobante print page loads with delivery data", async ({ page }) => {
    await page.goto("/entregas/del-e2e/print")
    await expect(page.getByText("Comprobante de Entrega EPP")).toBeVisible()
    await expect(page.getByText("ENT-2026-0001")).toBeVisible()
  })
})
