import { randomUUID } from "node:crypto"
import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: TI › Apps (`/ti/apps` y `/ti/apps/[appId]`).
 *
 * Cubre:
 *   • La lista con las tres apps del teléfono y su insignia.
 *   • El detalle de PPA, con la cifra «Atascados o con error» que filtra la tabla
 *     de teléfonos por `?estado=atencion`.
 *   • Un id de app desconocido da la pantalla de «no encontrado».
 *
 * Los avisos se siembran por la ruta pública `POST /api/pwa/aviso`, igual que lo
 * hace la app en el teléfono: dos teléfonos de PPA (uno con un envío rechazado) y
 * ninguno de TAE. Cada corrida usa ids nuevos, así que no choca con otras.
 *
 * La BD de E2E es compartida entre specs: otros pueden haber abierto `/tae` y
 * dejado un aviso de TAE, por eso la tarjeta de TAE sólo se verifica en que tenga
 * una insignia de estado y no en que diga «Sin avisos aún».
 */

const PPA_OK = randomUUID()
const PPA_ERROR = randomUUID()
const shortId = (uuid: string) => uuid.slice(0, 8)

async function sembrarAviso(page: Page, deviceId: string, overrides: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/pwa/aviso", {
    data: {
      app: "ppa",
      deviceId,
      version: "e2e-version",
      builtAt: null,
      installed: false,
      platform: "E2E Playwright",
      pending: 0,
      failed: 0,
      oldestPendingAt: null,
      lastAttemptAt: null,
      lastError: null,
      // Reloj del teléfono al mandar: el servidor corrige con él el desfase de las demás fechas.
      sentAt: new Date().toISOString(),
      ...overrides,
    },
  })
  expect(response.status(), "el aviso se guarda (204)").toBe(204)
}

async function sembrarPpa(page: Page) {
  await sembrarAviso(page, PPA_OK)
  await sembrarAviso(page, PPA_ERROR, { failed: 1, lastError: "El servidor rechazó el envío E2E" })
}

test.describe("TI › Apps", () => {
  test("la lista muestra las tres apps del teléfono", async ({ page }) => {
    await sembrarPpa(page)
    await login(page)
    await page.goto("/ti/apps")

    await expect(page.getByRole("heading", { name: "Apps", exact: true })).toBeVisible()
    // Dentro de <main>: el menú lateral también tiene enlaces «Mantención» y similares.
    const main = page.getByRole("main")
    const ppa = main.getByRole("link", { name: /PPA Digital/ })
    const mantencion = main.getByRole("link", { name: /Mantención/ })
    const tae = main.getByRole("link", { name: /Control TAE/ })
    await expect(ppa).toBeVisible()
    await expect(mantencion).toBeVisible()
    await expect(tae).toBeVisible()

    // PPA tiene un teléfono con un envío rechazado y otro con versión atrasada.
    await expect(ppa).toContainText("Requiere atención")
    // TAE: sin avisos aún, o ya con alguno si otro spec abrió la app; nunca sin insignia.
    await expect(tae).toContainText(/Sin avisos aún|Al día|Requiere atención|Desactivada/)
  })

  test("el detalle de PPA filtra por atención", async ({ page }) => {
    await sembrarPpa(page)
    await login(page)
    await page.goto("/ti/apps")
    await page.getByRole("main").getByRole("link", { name: /PPA Digital/ }).click()

    await expect(page).toHaveURL(/\/ti\/apps\/ppa$/)
    await expect(page.getByRole("heading", { name: "PPA Digital", exact: true })).toBeVisible()
    // Sin filtro, los dos teléfonos sembrados están en la tabla.
    await expect(page.getByRole("row", { name: new RegExp(shortId(PPA_OK)) })).toBeVisible()
    await expect(page.getByRole("row", { name: new RegExp(shortId(PPA_ERROR)) })).toBeVisible()

    await page.getByRole("main").getByRole("link", { name: /Atascados o con error/ }).click()
    await expect(page).toHaveURL(/estado=atencion/)
    await expect(page.getByText("Mostrando:")).toBeVisible()

    const conError = page.getByRole("row", { name: new RegExp(shortId(PPA_ERROR)) })
    await expect(conError).toBeVisible()
    await expect(conError).toContainText("Con error")
    await expect(page.getByRole("row", { name: new RegExp(shortId(PPA_OK)) })).toHaveCount(0)

    await page.getByRole("link", { name: "Ver todos", exact: true }).click()
    await expect(page).not.toHaveURL(/estado=/)
    await expect(page.getByRole("row", { name: new RegExp(shortId(PPA_OK)) })).toBeVisible()
  })

  test("un id de app desconocido da la pantalla de no encontrado", async ({ page }) => {
    await login(page)
    await page.goto("/ti/apps/bodega")
    // Se mira el `h1` y no el estado HTTP: el 404 de la app se pinta con el shell puesto.
    await expect(
      page.getByRole("heading", { level: 1, name: /No encontramos este registro|Esta dirección no existe|Recurso no encontrado/ }),
    ).toBeVisible()
  })
})
