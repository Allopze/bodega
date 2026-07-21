import { expect, test } from "@playwright/test"
import { login, selectRadixById } from "./helpers"

test("crear solicitud EPP con variantes: grid de tallas + cantidad por variante", async ({ page }) => {
  await login(page)

  // Navigate to new request
  await page.goto("/solicitudes")
  await page.getByRole("link", { name: /nueva/i }).click()
  await expect(page.getByRole("heading", { name: /nueva solicitud/i })).toBeVisible()

  // Fill header
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "EPP")
  await selectRadixById(page, "urgency", "Normal")

  // Pick the product from the combobox
  const combobox = page.getByRole("combobox", { name: /buscar producto/i })
  await combobox.fill("Casco E2E")
  // Wait for dropdown to appear and click the grouped product entry
  const listbox = page.getByRole("listbox")
  await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 5000 })
  await listbox.getByRole("option").first().click()

  // Verify variant grid is visible
  await expect(page.getByText(/cantidad por variante/i)).toBeVisible({ timeout: 5000 })

  // Fill quantities per variant in the grid inputs
  const variantInputs = page.locator("[class*='variant'] input[type='number']")
  const inputCount = await variantInputs.count()
  expect(inputCount).toBeGreaterThanOrEqual(2)

  // Fill 2 for first variant and 3 for second
  await variantInputs.nth(0).fill("2")
  await variantInputs.nth(1).fill("3")

  // The total quantity field should auto-update to 5
  const qtyInput = page.locator("#qty-new-0")
  await expect(qtyInput).toHaveValue("5")

  // Save draft
  await page.getByRole("button", { name: /guardar borrador/i }).click()
  await expect(page.getByText(/guardado/i)).toBeVisible({ timeout: 10000 })

  // Submit
  await page.getByRole("button", { name: /enviar a aprobación/i }).click()
  await expect(page.getByText(/enviada/i)).toBeVisible({ timeout: 10000 })

  // Verify it appears in the request list with correct items
  await page.goto("/solicitudes")
  await expect(page.getByRole("row", { name: /Casco E2E/ }).first()).toBeVisible({ timeout: 10000 })
})
