import { expect, test, type Page } from "@playwright/test"
import { login, selectRadixById, pickCurrentMonthDate } from "./helpers"


test("flujo solicitud, aprobación, OC, recepción y trazabilidad", async ({ page }) => {
  await login(page)

  const requestCode = await createCatalogRequest(page, "Guante E2E", "5")

  await page.goto("/aprobaciones")
  // Acotado a SU solicitud: la bandeja puede tener pendientes de otros specs
  // (`epp-variant-request-flow` deja dos ítems sin aprobar), y un "Aprobar"
  // suelto caía en strict mode. El grupo es el div cuyo hijo directo es la
  // lista de ítems; se filtra por el código de esta solicitud.
  const ownGroup = page.locator("div:has(> ul)").filter({ hasText: requestCode })
  await expect(ownGroup).toHaveCount(1)
  await ownGroup.getByRole("button", { name: "Aprobar", exact: true }).click()
  await page.getByRole("button", { name: "Confirmar aprobación" }).click()
  // Su grupo desaparece de la cola; el resto de la bandeja puede seguir con
  // pendientes ajenos, así que no se puede afirmar "Sin ítems pendientes".
  await expect(ownGroup).toHaveCount(0, { timeout: 30_000 })

  await page.goto("/compras/nueva")
  await selectRadixById(page, "ocWorksiteId", "Faena E2E")
  await selectRadixById(page, "supplierId", "Proveedor E2E")
  // Acotado a SU solicitud: el seed también deja un ítem `approved` de "Guante
  // E2E" (el fixture de OC de `pdf-exports`, con cantidad 10), así que
  // seleccionar por nombre con `.first()` incluía el del seed y la OC quedaba
  // con la cantidad equivocada. La fila es el div cuyo hijo directo es el
  // checkbox; se filtra por el código de la solicitud que este test creó.
  const ownItemRow = page
    .locator('div:has(> input[type="checkbox"])')
    .filter({ hasText: `SOL ${requestCode}` })
  await expect(ownItemRow).toHaveCount(1)
  await ownItemRow.getByLabel(/Incluir Guante E2E/).check()
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
  // La bandeja se renderiza en el servidor, así que si se pide antes de que el
  // commit de "Marcar como enviada" sea visible, llega vacía y ninguna espera de
  // Playwright la rellena: hay que volver a pedirla. `expect.poll` recarga hasta
  // que la OC aparece, en vez de depender de que la revalidación haya ganado la
  // carrera (falla intermitente vista en las rondas 3 y 5).
  await expect.poll(async () => {
    await page.goto("/recepcion")
    return page.locator("tbody tr").filter({ hasText: "Proveedor E2E" }).count()
  }, { timeout: 30_000 }).toBeGreaterThan(0)
  const pendingReceptionRow = page.locator("tbody tr").filter({ hasText: "Proveedor E2E" }).first()
  await expect(pendingReceptionRow).toContainText("Faena E2E")
  await pendingReceptionRow.getByRole("link", { name: "Recibir" }).click()
  // Se acota a la tarjeta de etapa: "Recepción en oficina" también aparece como
  // `statusLabel` en la sección "Responsables de la recepción", así que un
  // `getByText` suelto cae en strict mode. Nunca se había notado porque el bug de
  // `pickCurrentMonthDate` cortaba este spec antes de llegar acá.
  await expect(page.getByRole("button", { name: "Recepción en oficina" })).toBeVisible()
  await submitReceiptForm(page, "5")

  // Stage 2 — receipt at the worksite from the transit queue (generates stock + traceability).
  await expect.poll(async () => {
    await page.goto("/recepcion")
    return page.locator("tbody tr").filter({ hasText: "Proveedor E2E" }).count()
  }, { timeout: 30_000 }).toBeGreaterThan(0)
  const transitReceptionRow = page.locator("tbody tr").filter({ hasText: "Proveedor E2E" }).first()
  // El badge de la columna "Pend. de faena" cuenta LÍNEAS pendientes de despacho
  // (una acá), y dice sólo el número: antes repetía el nombre de la columna
  // ("N pend. faena"), jerga duplicada (auditoría UI/UX 2026-07-29, A-35).
  await expect(transitReceptionRow.getByText(/^1 ítem$/)).toBeVisible()
  await transitReceptionRow.getByRole("link", { name: "Recibir" }).click()
  // A-35 reescribió "En oficina: N" como "Llegó antes a oficina: N", porque bajo
  // un título "Ítems recibidos en faena" se leía como contradicción.
  await expect(page.getByText(/(En oficina|Llegó antes a oficina): 5/)).toBeVisible()
  const worksiteReceiptButton = page.getByRole("button", { name: /Recepción en faena/ })
  await expect(worksiteReceiptButton).toBeEnabled()
  await worksiteReceiptButton.click()
  await submitReceiptForm(page, "5")
  // Acotado a la tabla: el nombre del producto también aparece en el panel de
  // seguimiento de la misma página, así que un `getByText` suelto era ambiguo.
  await expect(page.getByRole("table").getByText("Guante E2E").first()).toBeVisible()

  await page.goto("/trazabilidad?estado=received")
  await expect(page.getByRole("row", { name: /Guante E2E.*5 unidad.*Recibido/ }).first()).toBeVisible()

  await page.goto("/reportes")
  // La pasada 32 unificó los cuatro exportes bajo una sola entrada: el informe
  // ya no es un botón propio sino una opción del menú "Exportar Excel".
  await page.getByRole("button", { name: "Exportar Excel" }).click()
  await expect(page.getByRole("menuitem", { name: "Gasto por faena" })).toBeVisible()
  await page.keyboard.press("Escape")
  const response = await page.request.get("/api/reportes/export?tipo=gasto_faena&formato=xlsx")
  expect(response.status()).toBe(200)
  expect(response.headers()["content-disposition"]).toContain("gasto-por-faena.xlsx")
})

test("ítem rechazado no aparece como pendiente de compra", async ({ page }) => {
  await login(page)
  await createCatalogRequest(page, "Rechazo E2E", "2", { freeText: true })

  await page.goto("/aprobaciones")
  // Scoped to this test's own item: other tests in the full suite leave
  // pending approvals in the shared E2E DB, so an unscoped "Rechazar" click
  // can race against unrelated items (intermittent strict-mode violations /
  // dialog-not-found timeouts under the full run).
  const ownItem = page.getByRole("listitem").filter({ hasText: "Rechazo E2E" })
  await ownItem.getByRole("button", { name: "Rechazar" }).click()
  await page.getByPlaceholder("Explica por qué este ítem no puede ser aprobado...").fill("No corresponde comprar este implemento")
  await page.getByRole("button", { name: "Confirmar rechazo" }).click()
  await expect(ownItem).not.toBeVisible({ timeout: 30_000 })

  await page.goto("/trazabilidad?estado=rejected")
  await expect(page.getByRole("row", { name: /Rechazo E2E.*Rechazado/ }).first()).toBeVisible()

  await page.goto("/compras/nueva")
  await expect(page.getByText("Rechazo E2E")).toHaveCount(0)
})


test("descarga real de Excel desde el navegador", async ({ page }) => {
  await login(page)
  await page.goto("/reportes")

  // La pasada 32 dejó una sola entrada de exportación: el informe se elige
  // dentro del menú, no desde un botón propio por informe.
  await page.getByRole("button", { name: "Exportar Excel" }).click()
  await page.getByRole("menuitem", { name: "Ítems sin OC" }).click()
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

/** Crea una solicitud y devuelve su código, para poder identificar luego SU ítem. */
async function createCatalogRequest(
  page: Page,
  productName: string,
  quantity: string,
  options: { freeText?: boolean } = {},
): Promise<string> {
  await page.goto("/solicitudes/nueva")
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Buscar en catálogo o escribir producto...").fill(productName)
  if (options.freeText) {
    await page.getByRole("option", { name: new RegExp(`Usar “${productName}”`) }).click()
  } else {
    await page.getByRole("option", { name: new RegExp(`E2E-001\\s*${productName}`) }).click()
    await expect(page.getByRole("button", { name: "Cambiar" })).toBeVisible()
  }
  await page.getByLabel("Cantidad").fill(quantity)
  await page.getByRole("button", { name: "Enviar a aprobación" }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
  await expect(page.getByText(productName).first()).toBeVisible()
  // El código es el título de la página de detalle. Se lee con `textContent`
  // y no `innerText` porque el h1 del PageHeader es `lg:sr-only` en desktop.
  const code = await page.getByRole("heading", { level: 1 }).first().textContent()
  expect(code?.trim()).toMatch(/^SOL-/)
  return code!.trim()
}

async function submitReceiptForm(page: Page, expectedQuantity: string) {
  await expect(page.locator('input[id^="receiptQty-"]').first()).toHaveValue(expectedQuantity)
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  await expect(page).toHaveURL(/\/recepcion\/(?!nueva(?:\?|$))[^/?]+$/)
}
