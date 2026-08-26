import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: ficha de una entrada de riesgo MIPER (`/prevencion/miper/riesgos/[id]`).
 *
 * Regresión directa del enlace muerto: `capaSourceHref("risk", id)`
 * (lib/prevention/capa.ts) apuntaba a esta ruta antes de que existiera —
 * toda CAPA de origen `risk` era un 404. El fixture fijo `riskentry-e2e`
 * (e2e/setup-db.ts) da un id conocido sin depender de la UI para descubrirlo.
 */

test.describe("Prevención — MIPER: ficha de riesgo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la ficha de un riesgo carga con su evaluación y no es un 404", async ({ page }) => {
    const response = await page.goto("/prevencion/miper/riesgos/riskentry-e2e")
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole("heading", { level: 1, name: "Caída de altura E2E" })).toBeVisible()
    await expect(page.getByText("Caída con lesión grave")).toBeVisible()
    // P=2×C=4 → MR=8 → Importante (fixture de e2e/setup-db.ts).
    await expect(page.getByText(/Importante.*MR 8/)).toBeVisible()
  })

  test("una entrada inexistente sí es un 404 real", async ({ page }) => {
    const response = await page.goto("/prevencion/miper/riesgos/no-existe-esta-entrada")
    expect(response?.status()).toBe(404)
  })
})
