import { expect, test, type Page } from "@playwright/test"

test("flujo solicitud, aprobación, OC, recepción y trazabilidad", async ({ page }) => {
  await login(page)

  await createCatalogRequest(page, "Guante E2E", "5")

  await page.goto("/aprobaciones")
  await page.getByRole("button", { name: "Aprobar", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar aprobación" }).click()
  await expect(page.getByText("Sin ítems pendientes")).toBeVisible({ timeout: 30_000 })

  await page.goto("/compras/nueva")
  await selectRadixById(page, "ocWorksiteId", "Faena E2E")
  await selectRadixById(page, "supplierId", "Proveedor E2E")
  await page.getByLabel(/Incluir Guante E2E/).first().check()
  await page.getByRole("button", { name: /Crear OC \(1 ítem\)/ }).click()
  await expect(page).toHaveURL(/\/compras\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
  const orderId = page.url().split("/").pop()
  expect(orderId).toBeTruthy()

  await page.goto(`/compras/${orderId}/print`)
  await expect(page.locator(".sheet")).toContainText("Guante E2E")
  await page.emulateMedia({ media: "print" })
  const pdf = await page.pdf({ format: "A4", printBackground: true })
  expect(pdf.byteLength).toBeGreaterThan(25_000)
  await page.emulateMedia({ media: "screen" })
  await page.goto(`/compras/${orderId}`)

  await page.getByRole("button", { name: "Emitir orden" }).click()
  const sendButton = page.getByRole("button", { name: "Marcar como enviada" })
  await expect(sendButton).toBeVisible({ timeout: 30_000 })
  await sendButton.click()
  await expect(sendButton).toBeHidden({ timeout: 30_000 })

  // Stage 1 — arrival at Chome office from the receiving queue.
  await page.goto("/recepcion")
  const pendingReceptionRow = page.getByRole("row", { name: /Proveedor E2E/ }).first()
  await expect(pendingReceptionRow).toContainText("Faena E2E")
  await pendingReceptionRow.getByRole("link", { name: "Recibir" }).click()
  await expect(page.getByText("Recepción en oficina")).toBeVisible()
  await submitReceiptForm(page, "5")

  // Stage 2 — receipt at the worksite from the transit queue (generates stock + traceability).
  await page.goto("/recepcion")
  const transitReceptionRow = page.getByRole("row", { name: /Proveedor E2E/ }).first()
  await expect(transitReceptionRow.getByText(/pend\. faena/)).toBeVisible()
  await transitReceptionRow.getByRole("link", { name: "Recibir" }).click()
  await expect(page.getByText(/En oficina: 5/)).toBeVisible()
  const worksiteReceiptButton = page.getByRole("button", { name: /Recepción en faena/ })
  await expect(worksiteReceiptButton).toBeEnabled()
  await worksiteReceiptButton.click()
  await submitReceiptForm(page, "5")
  await expect(page.getByText("Guante E2E")).toBeVisible()

  await page.goto("/trazabilidad?estado=received")
  await expect(page.getByRole("row", { name: /Guante E2E.*5 unidad.*Recibido/ })).toBeVisible()

  await page.goto("/reportes")
  await expect(page.getByRole("button", { name: "Exportar Gasto por faena" })).toBeVisible()
  const response = await page.request.get("/api/reportes/export?tipo=gasto_faena&formato=xlsx")
  expect(response.status()).toBe(200)
  expect(response.headers()["content-disposition"]).toContain("gasto-por-faena.xlsx")
})

test("ítem rechazado no aparece como pendiente de compra", async ({ page }) => {
  await login(page)
  await createCatalogRequest(page, "Rechazo E2E", "2", { freeText: true })

  await page.goto("/aprobaciones")
  await page.getByRole("button", { name: "Rechazar" }).click()
  await page.getByPlaceholder("Explica por qué este ítem no puede ser aprobado...").fill("No corresponde comprar este implemento")
  await page.getByRole("button", { name: "Confirmar rechazo" }).click()
  await expect(page.getByText("Sin ítems pendientes")).toBeVisible({ timeout: 30_000 })

  await page.goto("/trazabilidad?estado=rejected")
  await expect(page.getByRole("row", { name: /Rechazo E2E.*Rechazado/ })).toBeVisible()

  await page.goto("/compras/nueva")
  await expect(page.getByText("Rechazo E2E")).toHaveCount(0)
})

async function login(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function createCatalogRequest(
  page: Page,
  productName: string,
  quantity: string,
  options: { freeText?: boolean } = {},
) {
  await page.goto("/solicitudes/nueva")
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await page.getByLabel("Fecha requerida").fill("2026-07-15")
  await page.getByPlaceholder("Buscar en catálogo o escribir producto...").fill(productName)
  if (options.freeText) {
    await page.getByRole("option", { name: new RegExp(`Usar “${productName}”`) }).click()
  } else {
    await page.getByRole("option", { name: new RegExp(`E2E-001\\s*${productName}`) }).click()
    await expect(page.getByRole("button", { name: "Cambiar" })).toBeVisible()
    await expect(page.locator('form').nth(1).locator('input[name="itemsJson"]')).toHaveValue(/prod-e2e/)
  }
  await page.getByLabel("Cantidad").fill(quantity)
  await page.getByRole("button", { name: "Enviar a aprobación" }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
  await expect(page.getByText(productName).first()).toBeVisible()
}

async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).click()
}

async function submitReceiptForm(page: Page, expectedQuantity: string) {
  await expect(page.locator('input[id^="receiptQty-"]').first()).toHaveValue(expectedQuantity)
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  await expect(page).toHaveURL(/\/recepcion\/(?!nueva(?:\?|$))[^/?]+$/)
}

// ── Browser download: Excel export ──────────────────────────────────────────

test("descarga real de Excel desde el navegador", async ({ page }) => {
  await login(page)
  await page.goto("/reportes")

  await page.getByRole("button", { name: "Exportar Items sin OC" }).click()
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 })

  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
  await page.getByRole("link", { name: "Descargar" }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain(".xlsx")

  const filePath = await download.path()
  expect(filePath).toBeTruthy()

  const fs = await import("fs")
  const stat = fs.statSync(filePath!)
  expect(stat.size).toBeGreaterThan(0)
})

test("cierra sesión y bloquea el acceso al dashboard", async ({ page }) => {
  await login(page)

  await page.getByRole("button", { name: "Abrir menú de usuario" }).click()
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login/)
})
