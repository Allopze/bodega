import { expect, test, type Page } from "@playwright/test"

test("flujo solicitud, aprobación, OC, recepción y trazabilidad", async ({ page }) => {
  await login(page)

  await createCatalogRequest(page, "Guante E2E", "5")

  await page.goto("/aprobaciones")
  await page.getByRole("button", { name: "Aprobar", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar aprobación" }).click()
  await expect(page.getByText("Sin ítems pendientes")).toBeVisible()

  await page.goto("/compras/nueva")
  await selectRadixById(page, "ocWorksiteId", "Faena E2E")
  await selectRadixById(page, "supplierId", "Proveedor E2E")
  await page.getByLabel(/Incluir Guante E2E/).check()
  await page.getByRole("button", { name: /Crear OC \(1 ítem\)/ }).click()
  await expect(page).toHaveURL(/\/compras\/(?!nueva$)[^/]+$/)
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

  // Stage 1 — arrival at Chome office (mandatory first step, no stock).
  await page.goto(`/recepcion/nueva?oc=${orderId}`)
  await expect(page.getByText("Recepción en oficina")).toBeVisible()
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  await expect(page).toHaveURL(/\/recepcion\/[^/]+$/)

  // Stage 2 — receipt at the worksite (generates stock + traceability).
  await page.goto(`/recepcion/nueva?oc=${orderId}&afterOffice=1`)
  await page.reload()
  await expect(page.getByText(/En oficina: 5/)).toBeVisible()
  const worksiteReceiptButton = page.getByRole("button", { name: /Recepción en faena/ })
  await expect(worksiteReceiptButton).toBeEnabled()
  await worksiteReceiptButton.click()
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  await expect(page).toHaveURL(/\/recepcion\/[^/]+$/)
  await expect(page.getByText("Guante E2E")).toBeVisible()

  await page.goto("/trazabilidad?estado=received")
  await expect(page.getByRole("row", { name: /Guante E2E.*5 unidad.*Recibido/ })).toBeVisible()

  await page.goto("/reportes")
  await expect(page.getByRole("link", { name: "Exportar Excel: Gasto por faena", exact: true })).toBeVisible()
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
  await expect(page.getByText("Sin ítems pendientes")).toBeVisible()

  await page.goto("/trazabilidad?estado=rejected")
  await expect(page.getByRole("row", { name: /Rechazo E2E.*Rechazado/ })).toBeVisible()

  await page.goto("/compras/nueva")
  await expect(page).toHaveURL(/\/compras$/)
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

// ── Browser download: Excel export ──────────────────────────────────────────

test("descarga real de Excel desde el navegador", async ({ page }) => {
  await login(page)
  await page.goto("/reportes")
  await expect(page.getByRole("link", { name: "Exportar Excel: Ítems sin OC", exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
  await page.getByRole("link", { name: "Exportar Excel: Ítems sin OC", exact: true }).click()
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
