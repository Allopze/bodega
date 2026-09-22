import { test, expect } from "@playwright/test"
import { login, MINIMAL_PNG } from "./helpers"

/**
 * E2E: mapa de riesgos espacial (DS 44 art. 62, requisito Oro de la
 * certificación CPHS) — cargar un plano de planta, ubicar un marcador sobre un
 * peligro de la matriz IPER publicada y quitarlo. Vive bajo CGRD desde el
 * 2026-09-22; los marcadores siguen saliendo de la MIPER.
 *
 * No hay librería de mapas en el repo: el overlay es CSS puro sobre una imagen
 * responsiva, así que el clic se posiciona por porcentaje del `boundingBox`
 * real, igual que calcula el cliente.
 *
 * El plano usa `MINIMAL_PNG` (e2e/helpers.ts): sin bytes de imagen de verdad el
 * navegador no le da dimensiones al <img> y el clic porcentual no tiene
 * dónde caer.
 */

test.describe("Prevención — CGRD: mapa de riesgos espacial", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/cgrd/mapa")
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
      buffer: MINIMAL_PNG,
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

/**
 * El mapa se trasladó a CGRD el 2026-09-22. Sin este test, romper el redirect no
 * falla ninguna suite: los bookmarks y los enlaces del manual antiguo caen en un
 * 404 que nadie observa.
 *
 * Fuera del describe de arriba a propósito: aquel navega al mapa en su
 * `beforeEach`, y acá lo que se prueba es justamente la llegada desde la ruta
 * anterior.
 */
test("la ruta anterior del mapa redirige a CGRD", async ({ page }) => {
  await login(page)
  await page.goto("/prevencion/miper/mapa")
  await expect(page).toHaveURL(/\/prevencion\/cgrd\/mapa$/)
  await expect(page.getByRole("heading", { level: 1, name: "Mapa de riesgos" })).toBeVisible()
})
