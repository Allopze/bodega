import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: ciclo de vida del Comité Paritario — las cuatro acciones que existían
 * como servicio probado pero sin ninguna pantalla que las invocara: renuncia
 * de integrante, reemplazo, cancelar una sesión convocada y disolver el
 * comité. Usa el fixture `cphs-e2e-base` (ws-e2e) para las tres primeras —
 * ninguna deja al comité en un estado que invalide a las otras— y
 * `cphs-e2e-dissolve` (ws-restricted-e2e) en exclusiva para disolver, porque
 * es terminal.
 */
test.describe("Prevención — CPHS: ciclo de vida del comité", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("renuncia de integrante deja el asiento vacante", async ({ page }) => {
    await page.goto("/prevencion/cphs/cphs-e2e-base")
    await expect(page.getByRole("heading", { level: 1, name: "CPHS Faena E2E" })).toBeVisible()

    const row = page.getByRole("row", { name: /Suplente Renuncia/ })
    await row.getByRole("button", { name: "Renuncia" }).click()

    const dialog = page.getByRole("dialog", { name: /Renuncia de/ })
    await dialog.getByRole("textbox", { name: "Motivo" }).fill("Renuncia voluntaria registrada en el flujo E2E de ciclo de vida.")
    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByRole("row", { name: /Suplente Renuncia/ }).getByText("Renunció")).toBeVisible()
  })

  test("reemplazo hereda representación y asiento con otra persona", async ({ page }) => {
    await page.goto("/prevencion/cphs/cphs-e2e-base")
    await expect(page.getByRole("heading", { level: 1, name: "CPHS Faena E2E" })).toBeVisible()

    const row = page.getByRole("row", { name: /Suplente Reemplazo/ })
    await row.getByRole("button", { name: "Reemplazar" }).click()

    const dialog = page.getByRole("dialog", { name: /Reemplazar a/ })
    // El picker de reemplazante es un OptionSelect (Radix): hidrata antes de
    // que el clic tenga efecto, así que se reintenta hasta que el menú responde.
    await expect.poll(async () => {
      await dialog.locator("#replace-worker").click()
      return page.getByRole("option", { name: /Trabajador, E2E|E2E, Trabajador/ }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await page.getByRole("option", { name: /Trabajador, E2E|E2E, Trabajador/ }).click()

    await dialog.getByRole("textbox", { name: "Motivo" }).fill("Reemplazo registrado en el flujo E2E de ciclo de vida.")
    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByRole("row", { name: /Trabajador, E2E|E2E, Trabajador/ })).toBeVisible()
  })

  test("cancelar una sesión convocada la deja fuera del cierre de acta", async ({ page }) => {
    await page.goto("/prevencion/cphs/cphs-e2e-base")
    await expect(page.getByRole("heading", { level: 1, name: "CPHS Faena E2E" })).toBeVisible()

    const row = page.getByRole("row", { name: /CPHS-E2E-CANCELAR/ })
    await row.getByRole("button", { name: "Cancelar", exact: true }).click()

    const dialog = page.getByRole("dialog", { name: /Cancelar CPHS-E2E-CANCELAR/ })
    await dialog.getByRole("textbox", { name: "Motivo" }).fill("Sesión cancelada en el flujo E2E de ciclo de vida.")
    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByRole("row", { name: /CPHS-E2E-CANCELAR/ }).getByText("Cancelada")).toBeVisible()
  })

  test("disolver el comité lo saca de gestión activa", async ({ page }) => {
    await page.goto("/prevencion/cphs/cphs-e2e-dissolve")
    await expect(page.getByRole("heading", { level: 1, name: /CPHS Faena Restringida E2E/ })).toBeVisible()

    await page.getByRole("button", { name: "Disolver comité" }).click()
    const dialog = page.getByRole("dialog", { name: "Disolver el comité" })
    await dialog.getByRole("textbox", { name: "Motivo" }).fill("Disolución registrada en el flujo E2E de ciclo de vida.")
    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByText("Disuelto")).toBeVisible()
    await expect(page.getByRole("button", { name: "Disolver comité" })).toHaveCount(0)
  })
})
