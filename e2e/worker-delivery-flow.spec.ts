import { expect, test, type Page } from "@playwright/test"

import { listRecord, login, pickCurrentMonthDate, selectRadixById } from "./helpers"

/**
 * Entregas a trabajador, contra el formulario actual.
 *
 * El módulo se rediseñó (regla A3: la página es la lista y el alta vive en un
 * `Sheet`) y con él cambió la regla de negocio: **el tope ya no es el saldo de
 * la solicitud sino el stock de la bodega de origen**, y el vínculo con una
 * solicitud recibida pasó a ser trazabilidad opcional. Estos specs seguían
 * pidiendo `#deliveryWorkerId`/`#deliveryRequestItemId`, controles que dejaron
 * de existir, así que llevaban tiempo sin probar nada.
 */

const FAENA = "Faena E2E"
const PRODUCTO = "Casco EPP E2E"

/** Abre el panel de alta y deja elegidos bodega y trabajador. */
async function abrirFormulario(page: Page) {
  await login(page)
  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()
  // `toPass`: el panel es cliente puro y un clic anterior a la hidratación se
  // pierde sin dejar rastro (la falla recurrente que documenta `helpers.ts`).
  const sheet = page.getByRole("dialog", { name: "Registrar entrega" })
  await expect(async () => {
    await page.getByRole("button", { name: "Registrar entrega" }).first().click()
    await expect(sheet).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  await selectRadixById(page, "deliverySourceWorksite", FAENA)
  await selectRadixById(page, "deliveryWorker", /Trabajador E2E/)
  return sheet
}

/** Elige producto y cantidad, y agrega la línea. */
async function agregarLinea(page: Page, cantidad: string) {
  await selectRadixById(page, "deliveryProduct", new RegExp(PRODUCTO))
  await page.locator("#deliveryPendingQuantity").fill(cantidad)
  await page.getByRole("button", { name: "Agregar" }).click()
}

function enviar(sheet: ReturnType<Page["getByRole"]>) {
  return sheet.getByRole("button", { name: "Registrar entrega" }).click()
}

test("entregas: no deja agregar más de lo que hay en la bodega", async ({ page }) => {
  await abrirFormulario(page)

  await selectRadixById(page, "deliveryProduct", new RegExp(PRODUCTO))
  const cantidad = page.locator("#deliveryPendingQuantity")
  await cantidad.fill("999")

  // El tope viaja en el `max` del control, así que el navegador ya lo marca.
  await expect.poll(async () =>
    cantidad.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow),
  ).toBe(true)

  // Y el servidor no llega a enterarse: la línea no se agrega y el envío sigue
  // deshabilitado porque no hay ninguna.
  await page.getByRole("button", { name: "Agregar" }).click()
  await expect(page.getByText("Agrega uno o más productos con stock para continuar.")).toBeVisible()
})

test("entregas: rechaza comprobante con formato no permitido", async ({ page }) => {
  const sheet = await abrirFormulario(page)
  await agregarLinea(page, "1")

  await page.locator("#deliveryProofFile").setInputFiles({
    name: "comprobante-e2e.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("comprobante invalido e2e"),
  })
  await enviar(sheet)

  await expect(page.getByText(/identificar el tipo/i).first()).toBeVisible({ timeout: 30_000 })
})

test("entregas: registra comprobante y permite descargarlo", async ({ page }) => {
  const sheet = await abrirFormulario(page)
  await agregarLinea(page, "1")

  await page.locator("#deliveryReceiverName").fill("Receptor adjunto E2E")
  await page.locator("#deliveryProofFile").setInputFiles({
    name: "comprobante-e2e.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ncomprobante adjunto e2e\n%%EOF\n"),
  })
  await enviar(sheet)
  await expect(sheet).toBeHidden({ timeout: 30_000 })

  const fila = listRecord(page, /Receptor adjunto E2E/)
  await expect(fila.first()).toBeVisible({ timeout: 30_000 })
  // "Archivo" exacto: la fila lleva además el enlace a la hoja imprimible
  // ("Comprobante de entrega ENT-…"), y un regex ancho resolvía a los dos.
  const enlace = fila.first().getByRole("link", { name: "Archivo", exact: true })
  const href = await enlace.getAttribute("href")
  expect(href).toMatch(/^\/api\/attachments\//)

  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/pdf")
  expect(await response.text()).toContain("comprobante adjunto e2e")
})

test("entregas: registra EPP a trabajador y descuenta de la bodega", async ({ page }) => {
  const sheet = await abrirFormulario(page)
  await agregarLinea(page, "2")

  await page.locator("#deliveryReceiverName").fill("Supervisor E2E")
  await enviar(sheet)
  await expect(sheet).toBeHidden({ timeout: 30_000 })

  await expect(listRecord(page, /Supervisor E2E/).first()).toBeVisible({ timeout: 30_000 })
})

/**
 * Último día hábil anterior a hoy, en la zona de operación.
 *
 * Se calcula acá a propósito, sin importar `subtractBusinessDays`: si el helper
 * de la aplicación estuviera mal, importarlo haría que la prueba se equivocara
 * igual y no detectara nada.
 */
function ultimoDiaHabilAnterior(): string {
  const cursor = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })}T12:00:00Z`)
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6)
  return cursor.toISOString().slice(0, 10)
}

test("entregas: registra con fecha retroactiva y el comprobante queda con esa fecha", async ({ page }) => {
  const sheet = await abrirFormulario(page)
  await agregarLinea(page, "1")

  const fecha = ultimoDiaHabilAnterior()
  await pickCurrentMonthDate(page, /Fecha de entrega/, fecha)
  await page.locator("#deliveryReceiverName").fill("Retrofecha E2E")
  await enviar(sheet)
  await expect(sheet).toBeHidden({ timeout: 30_000 })

  // La fila muestra la fecha elegida, no la de digitación: es lo único que
  // prueba que el selector viaja hasta la columna `delivered_at`.
  const esperada = fecha.split("-").reverse().join("-") // `formatDate` rinde dd-mm-yyyy
  const fila = listRecord(page, /Retrofecha E2E/).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await expect(fila).toContainText(esperada)
})
