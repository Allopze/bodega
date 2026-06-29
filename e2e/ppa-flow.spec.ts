/**
 * E2E: PPA Digital — flujos críticos del trabajador y del responsable.
 *
 * Cubre los criterios de aceptación clave:
 *   • Acceso público al formulario sin login.
 *   • Envío seguro → "Puede iniciar el trabajo".
 *   • Respuesta crítica → confirmación → "DETENGA EL TRABAJO".
 *   • Revisión del responsable → autorización / rechazo / corrección.
 *   • Cierre de caso tras resolución.
 *   • La ruta pública funciona sin login; el panel interno está protegido.
 *
 * Usa las fixtures de e2e/setup-db.ts (Faena E2E + trabajador 11111111-1 +
 * admin con permisos ppa:*).
 */
import { expect, test, type Page } from "@playwright/test"
import { login, selectRadixById } from "./helpers"

const FAENA = "Faena E2E"
const RUT = "11111111-1"

/** Navega con reintento para manejar errores transitorios de conexión. */
async function gotoWithRetry(page: Page, url: string) {
  await expect(async () => {
    await page.goto(url)
  }).toPass({ timeout: 30_000 })
}

async function startForm(page: Page) {
  await page.goto("/ppa")
  // La faena se deriva del RUT: no hay selector de faena en el modo verificación.
  await page.locator("#rutSearch").fill(RUT)
  await page.getByRole("button", { name: "Verificar" }).click()
  await expect(page.getByText(/Verificado:/)).toBeVisible()
  await expect(page.getByText(new RegExp(`Faena:.*${FAENA}`))).toBeVisible()
  await selectRadixById(page, "tipo", "Conductor Batea")
}

async function checkRequiredControls(page: Page) {
  await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
  await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()
}

test.describe("PPA Digital — formulario público", () => {
  test("envío seguro permite iniciar el trabajo", async ({ page }) => {
    await startForm(page)
    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-no").click()
    await checkRequiredControls(page)
    await page.getByTestId("seguro-si").click()
    await page.getByRole("button", { name: "Enviar PPA" }).click()

    await expect(page).toHaveURL(/\/ppa\/result\//)
    await expect(page.getByText(/Puede iniciar el trabajo/i)).toBeVisible()
  })

  test("respuesta crítica detiene el trabajo (con confirmación)", async ({ page }) => {
    await startForm(page)
    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-no").click()
    await checkRequiredControls(page)
    await page.getByTestId("seguro-no").click()
    await page.getByRole("button", { name: "Enviar PPA" }).click()

    // Confirmación antes de enviar una respuesta crítica.
    await expect(page.getByText(/El trabajo se detendrá/i)).toBeVisible()
    await page.getByRole("button", { name: "Enviar de todos modos" }).click()

    await expect(page).toHaveURL(/\/ppa\/result\//)
    await expect(page.getByText(/Detenga el trabajo/i)).toBeVisible()
  })
})

async function submitStoppedPpa(page: Page) {
  await startForm(page)
  await page.getByTestId("cambio-no").click()
  await page.getByTestId("peligro-si").click()
  await page.getByLabel("¿Cuál es el peligro?").fill("Cable eléctrico expuesto en la zona de trabajo")
  await checkRequiredControls(page)
  await page.getByTestId("seguro-si").click()
  await page.getByRole("button", { name: "Enviar PPA" }).click()
  await page.getByRole("button", { name: "Enviar de todos modos" }).click()
  await expect(page).toHaveURL(/\/ppa\/result\//)
}

async function goToStoppedPpaDetail(page: Page) {
  await login(page)
  await gotoWithRetry(page, "/prevencion/ppa")
  await page.getByRole("button", { name: "Detenidos" }).click()
  await page.getByRole("link", { name: /Trabajador E2E/ }).first().click()
  await expect(page).toHaveURL(/\/prevencion\/ppa\/[^/]+$/)
}

test.describe("PPA Digital — revisión del responsable", () => {
  test("autorizar un PPA detenido actualiza el estado", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    await page.getByLabel("Acción correctiva implementada").fill("Se aisló el cable y se delimitó la zona")
    await page.getByText("Autorizar inicio").click()
    await page.getByRole("button", { name: "Registrar revisión" }).click()
    await page.getByRole("button", { name: "Sí, autorizar" }).click()

    await expect(page.getByText("Autorizó el inicio", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Cerrar caso" })).toBeVisible()
  })

  test("rechazar un PPA detenido muestra estado rechazado", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    await page.getByText("Rechazar inicio").click()
    await page.getByRole("button", { name: "Registrar revisión" }).click()

    await expect(page.getByText("Rechazó el inicio", { exact: true })).toBeVisible()
  })

  test("solicitar corrección cambia estado a en corrección", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    await page.getByText("Solicitar corrección").click()
    await page.getByRole("button", { name: "Registrar revisión" }).click()

    await expect(page.getByText("Solicitó corrección", { exact: true })).toBeVisible()
  })

  test("cerrar un caso autorizado muestra estado cerrado", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    // Autorizar
    await page.getByLabel("Acción correctiva implementada").fill("Se aisló el cable y se delimitó la zona")
    await page.getByText("Autorizar inicio").click()
    await page.getByRole("button", { name: "Registrar revisión" }).click()
    await page.getByRole("button", { name: "Sí, autorizar" }).click()
    await expect(page.getByText("Autorizó el inicio", { exact: true })).toBeVisible()

    // Cerrar
    await page.getByRole("button", { name: "Cerrar caso" }).click()
    await expect(page.getByRole("dialog").getByRole("button", { name: "Cerrar caso" })).toBeVisible()
    await page.getByRole("dialog").getByRole("button", { name: "Cerrar caso" }).click()

    await expect(page.getByText("Caso cerrado")).toBeVisible()
  })
})

test.describe("PPA Digital — exportación XLSX", () => {
  test("abrir dialogo de exportación y descargar XLSX", async ({ page }) => {
    await login(page)
    await gotoWithRetry(page, "/prevencion/ppa")

    // Abrir el dialogo de exportación.
    await page.getByRole("button", { name: /Exportar XLSX/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByText("Exportar PPA Digital")).toBeVisible()

    // Seleccionar filtro de estado.
    await selectRadixById(page, "ppa-export-estado", "Trabajo detenido")

    // Descargar y verificar que devuelve un XLSX.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Descargar" }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
  })
})

test.describe("PPA Digital — acceso y permisos", () => {
  test("la ruta pública abre sin login y el panel interno está protegido", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible()

    await gotoWithRetry(page, "/prevencion/ppa")
    await expect(page).toHaveURL(/\/login/)
  })
})
