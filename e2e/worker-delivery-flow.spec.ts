import { expect, test } from "@playwright/test"

import { listRecord, login, selectRadixById } from "./helpers"

test("entregas: bloquea cantidad mayor al saldo pendiente", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /^SOL-2026-EPP · Casco EPP E2E/)
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
  ).toEqual({ max: "2", rangeOverflow: true })

  await page.locator("form").getByRole("button", { name: "Registrar entrega" }).click()
  // El registro no debe existir en ninguna de las dos representaciones. La
  // cantidad es parte de la aserción: existen entregas legítimas del mismo EPP
  // al mismo trabajador, y lo que esta prueba niega es la de 5 unidades, que
  // excede el saldo pendiente.
  await expect(listRecord(page, /Trabajador E2E/).filter({ hasText: "Casco EPP E2E" }).filter({ hasText: /5 unidad/ })).toHaveCount(0)
})

test("entregas: rechaza comprobante con formato no permitido", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /SOL-2026-EPP-BAD.*Casco EPP E2E/)
  await page.locator("#deliveryQuantity").fill("1")
  await page.locator("#deliveryProofFile").setInputFiles({
    name: "comprobante-e2e.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("comprobante invalido e2e"),
  })
  await page.locator("form").getByRole("button", { name: "Registrar entrega" }).click()

  await expect(page.locator("#main-content").getByText(/identificar el tipo/i)).toBeVisible({
    timeout: 30_000,
  })
})

test("entregas: registra comprobante y permite descargarlo", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /SOL-2026-EPP-ADJ.*Casco EPP E2E/)
  await page.locator("#deliveryQuantity").fill("1")
  await page.getByLabel("Recibido por").fill("Receptor adjunto E2E")
  await page.locator("#deliveryProofFile").setInputFiles({
    name: "comprobante-e2e.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ncomprobante adjunto e2e\n%%EOF\n"),
  })
  await page.locator("form").getByRole("button", { name: "Registrar entrega" }).click()

  await page.goto("/dashboard")
  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  const row = listRecord(page, /SOL-2026-EPP-ADJ/)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toContainText("Receptor adjunto E2E")
  const link = row.getByRole("link", { name: /Adjunto|Archivo/ })
  const href = await link.getAttribute("href")
  expect(href).toMatch(/^\/api\/attachments\//)

  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/pdf")
  const text = await response.text()
  expect(text).toContain("comprobante adjunto e2e")
})

test("entregas: registra EPP recibido a trabajador", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /^SOL-2026-EPP · Casco EPP E2E/)
  await page.locator("#deliveryQuantity").fill("2")
  await page.getByLabel("Recibido por").fill("Supervisor E2E")
  await page.locator("form").getByRole("button", { name: "Registrar entrega" }).click()

  await page.goto("/dashboard")
  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await expect(listRecord(page, /SOL-2026-EPP/).filter({ hasText: "Supervisor E2E" })).toBeVisible({
    timeout: 30_000,
  })
})
