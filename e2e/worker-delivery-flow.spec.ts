import { expect, test, type Page } from "@playwright/test"
import { clearRateLimits } from "./helpers"

test("entregas: bloquea cantidad mayor al saldo pendiente", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /SOL-2026-EPP · Casco EPP E2E/)
  const quantity = page.locator("#deliveryQuantity")
  await quantity.fill("5")

  await expect.poll(async () =>
    quantity.evaluate((el) => {
      const input = el as HTMLInputElement
      return {
        max: input.max,
        rangeOverflow: input.validity.rangeOverflow,
      }
    }),
  ).toEqual({ max: "4", rangeOverflow: true })

  await page.getByRole("button", { name: "Registrar entrega" }).click()
  await expect(page.getByRole("row", { name: /Trabajador E2E.*Casco EPP E2E.*5 unidad/ })).toHaveCount(0)
})

test("entregas: rechaza comprobante con formato no permitido", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /SOL-2026-EPP-BAD · Casco EPP E2E/)
  await page.locator("#deliveryQuantity").fill("1")
  await page.getByLabel("Comprobante").setInputFiles({
    name: "comprobante-e2e.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("comprobante invalido e2e"),
  })
  await page.getByRole("button", { name: "Registrar entrega" }).click()

  await expect(page.locator("#main-content").getByText(/No se pudo identificar el tipo del archivo/)).toBeVisible({
    timeout: 30_000,
  })
})

test("entregas: registra comprobante y permite descargarlo", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /SOL-2026-EPP-ADJ · Casco EPP E2E/)
  await page.locator("#deliveryQuantity").fill("1")
  await page.getByLabel("Recibido por").fill("Receptor adjunto E2E")
  await page.getByLabel("Comprobante").setInputFiles({
    name: "comprobante-e2e.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ncomprobante adjunto e2e\n%%EOF\n"),
  })
  await page.getByRole("button", { name: "Registrar entrega" }).click()

  await page.goto("/dashboard")
  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  const row = page.getByRole("row", { name: /SOL-2026-EPP-ADJ/ })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toContainText("Receptor adjunto E2E")
  const link = row.getByRole("link", { name: /Adjunto|Archivo/ })
  const href = await link.getAttribute("href")
  expect(href).toMatch(/^\/api\/attachments\//)

  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/pdf")
  expect(await response.text()).toContain("comprobante adjunto e2e")
})

test("entregas: registra EPP recibido a trabajador", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /SOL-2026-EPP · Casco EPP E2E/)
  await page.locator("#deliveryQuantity").fill("2")
  await page.getByLabel("Recibido por").fill("Supervisor E2E")
  await page.getByRole("button", { name: "Registrar entrega" }).click()

  await page.goto("/dashboard")
  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await expect(page.getByRole("row", { name: /SOL-2026-EPP/ }).filter({ hasText: "Supervisor E2E" })).toBeVisible({
    timeout: 30_000,
  })
})

async function login(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).click()
}
