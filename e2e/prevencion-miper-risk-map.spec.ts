import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: mapa de riesgos espacial de MIPER (§13/Oro) — cargar un plano de
 * planta, ubicar un marcador sobre un peligro de la matriz publicada y
 * quitarlo. No hay librería de mapas en el repo: el overlay es CSS puro
 * sobre una imagen responsiva, así que el clic se posiciona por porcentaje
 * del `boundingBox` real, igual que calcula el cliente.
 *
 * PNG mínimo válido (1×1, cabecera real): sin bytes de imagen de verdad el
 * navegador no le da dimensiones al <img> y el clic porcentual no tiene
 * dónde caer.
 */
const MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

test.describe("Prevención — MIPER: mapa de riesgos espacial", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    // El mapa no es una pestaña del workbench: es su propia página
    // (`/prevencion/miper/mapa`). El test navegaba a `/prevencion/miper` y
    // buscaba un `tab` que no existe, así que agotaba el timeout del
    // `beforeEach` sin llegar a ejercitar nada.
    await page.goto("/prevencion/miper/mapa")
    await expect(page.getByRole("heading", { level: 1, name: "Mapa de riesgos" })).toBeVisible()
  })

  test("carga un plano, ubica un marcador y lo quita", async ({ page }) => {
    // La faena por defecto ya es "Faena E2E" (única en el fixture con matriz
    // MIPER publicada); si el orden alfabético cambiara, se selecciona igual.
    await expect.poll(async () => {
      await page.locator("#riskmap-worksite").click()
      return page.getByRole("option", { name: "Faena E2E" }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await page.getByRole("option", { name: "Faena E2E" }).click()

    await page.getByRole("button", { name: "Cargar plano" }).click()
    const uploadDialog = page.getByRole("dialog", { name: "Cargar plano de riesgos" })
    await uploadDialog.getByRole("textbox", { name: "Título" }).fill("Planta principal E2E")
    await page.locator("#riskmap-file").setInputFiles({
      name: "plano-e2e.png",
      mimeType: "image/png",
      buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64"),
    })
    await uploadDialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    const mapArea = page.getByRole("button", { name: /Plano de riesgos: clic para ubicar un marcador/ })
    await expect(mapArea).toBeVisible({ timeout: 15_000 })
    const box = await mapArea.boundingBox()
    if (!box) throw new Error("El plano no tiene dimensiones renderizadas.")
    await mapArea.click({ position: { x: box.width / 2, y: box.height / 2 } })

    const markerDialog = page.getByRole("dialog", { name: "Ubicar marcador" })
    await expect.poll(async () => {
      await markerDialog.locator("#riskmap-entry").click()
      return page.getByRole("option", { name: /Caída de altura E2E/ }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await page.getByRole("option", { name: /Caída de altura E2E/ }).click()
    await markerDialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByText("Planta principal E2E (1 marcador)")).toBeVisible({ timeout: 15_000 })

    // Quitar el marcador: clic sobre el punto ubicado, abre el detalle.
    await page.locator('button[title*="Caída de altura E2E"]').click()
    const detailDialog = page.getByRole("dialog", { name: "Caída de altura E2E" })
    await detailDialog.getByRole("button", { name: "Quitar marcador" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByText("Planta principal E2E (0 marcadores)")).toBeVisible({ timeout: 15_000 })
  })
})
