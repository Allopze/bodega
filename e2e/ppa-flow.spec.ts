/**
 * E2E: PPA Digital — flujo crítico del trabajador y del responsable.
 *
 * Cubre los criterios de aceptación clave:
 *   • Acceso público al formulario sin login.
 *   • Envío seguro → "Puede iniciar el trabajo".
 *   • Respuesta crítica → confirmación → "DETENGA EL TRABAJO".
 *   • Revisión del responsable → autorización → estado actualizado.
 *   • La ruta pública funciona sin login; el panel interno está protegido.
 *
 * Usa las fixtures de e2e/setup-db.ts (Faena E2E + trabajador 11111111-1 +
 * admin con permisos ppa:*).
 */
import { expect, test, type Page } from "@playwright/test"
import { login } from "./helpers"

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
  await page.locator("#worksite").selectOption({ label: FAENA })
  await page.locator("#rutSearch").fill(RUT)
  await page.getByRole("button", { name: "Verificar" }).click()
  await expect(page.getByText(/Verificado:/)).toBeVisible()
  await page.locator("#tipo").selectOption("conductor_batea")
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

test.describe("PPA Digital — revisión del responsable", () => {
  test("autorizar un PPA detenido actualiza el estado", async ({ page }) => {
    // 1) El trabajador genera un PPA detenido (peligro no controlado).
    await startForm(page)
    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-si").click()
    await page.getByLabel("¿Cuál es el peligro?").fill("Cable eléctrico expuesto en la zona de trabajo")
    await checkRequiredControls(page)
    await page.getByTestId("seguro-si").click()
    await page.getByRole("button", { name: "Enviar PPA" }).click()
    await page.getByRole("button", { name: "Enviar de todos modos" }).click()
    await expect(page).toHaveURL(/\/ppa\/result\//)

    // 2) El responsable inicia sesión y revisa.
    await login(page)
    await gotoWithRetry(page, "/prevencion/ppa")
    await page.getByRole("button", { name: "Detenidos" }).click()
    await page.getByRole("link", { name: /Trabajador E2E/ }).first().click()
    await expect(page).toHaveURL(/\/prevencion\/ppa\/[^/]+$/)

    await page.getByLabel("Acción correctiva implementada").fill("Se aisló el cable y se delimitó la zona")
    await page.getByText("Autorizar inicio").click()
    await page.getByRole("button", { name: "Registrar revisión" }).click()

    // Confirmación de autorización de un trabajo detenido.
    await page.getByRole("button", { name: "Sí, autorizar" }).click()

    await expect(page.getByText("Intervención del responsable")).toBeVisible()
    await expect(page.getByText("Autorizó el inicio", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Cerrar caso" })).toBeVisible()
  })
})

test.describe("PPA Digital — acceso y permisos", () => {
  test("la ruta pública abre sin login y el panel interno está protegido", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#worksite")).toBeVisible()

    await gotoWithRetry(page, "/prevencion/ppa")
    await expect(page).toHaveURL(/\/login/)
  })
})
