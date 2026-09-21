import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: prácticas de madurez Plata/Oro del Comité Paritario — tabla previa,
 * invitado no integrante, envío del acta a gerencia, comisiones y vincular
 * una actividad del programa a la sesión que la revisó. Las seis acciones
 * existían como servicio probado sin ninguna pantalla que las invocara.
 *
 * Todas comparten el comité `cphs-e2e-base` (ws-e2e) pero cada una opera
 * sobre un recurso distinto (sesión, comisión o actividad) para no acoplar
 * el orden entre ellas ni con `prevencion-cphs-lifecycle.spec.ts`, que corre
 * en un archivo aparte y puede ejecutarse en paralelo contra la misma base.
 */
test.describe("Prevención — CPHS: madurez Plata y Oro", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/cphs/cphs-e2e-base")
    await expect(page.getByRole("heading", { level: 1, name: "CPHS Faena E2E" })).toBeVisible()
  })

  test("marcar tabla enviada deja constancia de haberla enviado antes de sesionar", async ({ page }) => {
    const row = page.getByRole("row", { name: /CPHS-E2E-AGENDA/ })
    await row.getByRole("button", { name: "Marcar tabla enviada" }).click()
    await expect(row.getByText("Tabla enviada previamente")).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole("button", { name: "Marcar tabla enviada" })).toHaveCount(0)
  })

  test("agregar invitado no integrante a una sesión convocada", async ({ page }) => {
    const row = page.getByRole("row", { name: /CPHS-E2E-AGENDA/ })
    await row.getByRole("button", { name: "Agregar invitado" }).click()

    const dialog = page.getByRole("dialog", { name: "Agregar invitado" })
    // "Origen" ya parte en "Trabajador de la faena" (primera opción); sólo
    // hace falta elegir la persona.
    await expect.poll(async () => {
      await dialog.locator("#guest-worker").click()
      return page.getByRole("option", { name: /Invitado, CPHS E2E|CPHS E2E, Invitado/ }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await page.getByRole("option", { name: /Invitado, CPHS E2E|CPHS E2E, Invitado/ }).click()

    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(row.getByText(/\+1 invitado/)).toBeVisible()
  })

  test("enviar acta a gerencia sólo está disponible en una sesión cerrada", async ({ page }) => {
    const row = page.getByRole("row", { name: /CPHS-E2E-CERRADA/ })
    await row.getByRole("button", { name: "Enviar acta a gerencia" }).click()
    await expect(row.getByText("Enviada a gerencia")).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole("button", { name: "Enviar acta a gerencia" })).toHaveCount(0)
  })

  test("crear una comisión de trabajo", async ({ page }) => {
    await page.getByRole("button", { name: "Nueva comisión" }).click()
    const dialog = page.getByRole("dialog", { name: "Nueva comisión" })
    await dialog.getByRole("textbox", { name: "Nombre" }).fill("Comisión Seguridad Vial E2E")
    await dialog.getByRole("textbox", { name: "Propósito" }).fill("Comisión creada en el flujo E2E de madurez del comité.")
    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByText("Comisión Seguridad Vial E2E")).toBeVisible()
  })

  test("asignar un integrante a una comisión existente", async ({ page }) => {
    await expect(page.getByText("Comisión Higiene E2E")).toBeVisible()
    await page.getByRole("button", { name: "Asignar integrante a Comisión Higiene E2E" }).click()

    const dialog = page.getByRole("dialog", { name: /Asignar integrante a Comisión Higiene E2E/ })
    await expect.poll(async () => {
      await dialog.locator("#commission-member").click()
      return page.getByRole("option", { name: /Presidenta/ }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await page.getByRole("option", { name: /Presidenta/ }).click()

    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByText(/1 integrante/)).toBeVisible()
  })

  test("vincular una actividad del programa a la sesión que la revisó", async ({ page }) => {
    // Acotado al pozo: tras el renombre del sidebar hay DOS enlaces con este
    // nombre —el del comité y el de PDTP en la navegación—, y sin acotar
    // Playwright tomaba el del sidebar y aterrizaba en /prevencion/pdtp.
    //
    // `[data-shell-scroll]` y no `getByRole("main")`: el enlace del comité es
    // una acción de `PageHeader`, que en escritorio la pinta la TopBar. Desde
    // que la TopBar salió de `<main>` para recuperar el rol `banner`, `main` ya
    // no lo contiene. El pozo contiene banner y contenido, y sigue excluyendo
    // el menú lateral, que es de lo que había que desempatar.
    await page.locator("[data-shell-scroll]").getByRole("link", { name: "Programa de trabajo" }).click()
    await expect(page).toHaveURL(/\/prevencion\/cphs\/cphs-e2e-base\/programa/)
    await expect(page.getByText("Actividad E2E para vincular a sesión")).toBeVisible()

    await page.getByRole("button", { name: "Vincular a sesión" }).click()
    const dialog = page.getByRole("dialog", { name: "Vincular a una sesión" })
    await expect.poll(async () => {
      await dialog.locator("#link-meeting").click()
      return page.getByRole("option", { name: /CPHS-E2E-VINCULAR/ }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await page.getByRole("option", { name: /CPHS-E2E-VINCULAR/ }).click()

    await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(page.getByText(/Revisada en CPHS-E2E-VINCULAR/)).toBeVisible()
  })
})
