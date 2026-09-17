import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * Regresión E2E del editor anual simplificado. La secuencia termina retirando
 * la actividad fixture, por eso se ejecuta en serie y el retiro queda al final.
 * Los primeros pasos vuelven siempre al estado heredado para no dejar residuos
 * si una ejecución local se repite contra el mismo servidor.
 */
test.describe.serial("PDTP anual — ajustes, Base y retiro", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    // Todo lo que sigue —pestañas, diálogos, selects Radix— es cliente puro:
    // sin hidratar, el primer clic no abre nada y el fallo se lee como "no
    // existe el botón del diálogo". En el runner de CI, más lento, esa carrera
    // se pierde; en local casi nunca.
    await page.waitForLoadState("networkidle").catch(() => undefined)
  })

  test("permite un cero explícito por faena y volver a la herencia", async ({ page }) => {
    await page.getByRole("tab", { name: /Ajustes por faena/ }).click()
    const row = page.locator("div.grid", { hasText: "Actividad ajustable anual E2E" }).last()

    await row.getByRole("button", { name: "Configurar" }).click()
    const dialog = page.getByRole("dialog", { name: /Ajuste por faena/ })
    await dialog.getByRole("combobox", { name: "Modo de planificación" }).click()
    await page.getByRole("option", { name: "Ajustar planificación" }).click()
    await dialog.getByLabel("Ene semana 1").fill("0")
    await dialog.getByLabel("Motivo del ajuste").fill("Validación E2E de planificación local con cero explícito.")
    await dialog.getByRole("button", { name: "Guardar ajuste" }).click()

    await expect(dialog).not.toBeVisible()
    await expect(row.getByText("Ajustado")).toBeVisible()

    await row.getByRole("button", { name: "Configurar" }).click()
    const inheritDialog = page.getByRole("dialog", { name: /Ajuste por faena/ })
    await inheritDialog.getByRole("combobox", { name: "Modo de planificación" }).click()
    await page.getByRole("option", { name: "Heredar planificación" }).click()
    await inheritDialog.getByLabel("Motivo del ajuste").fill("Validación E2E de retorno completo a la herencia global.")
    await inheritDialog.getByRole("button", { name: "Guardar ajuste" }).click()

    await expect(inheritDialog).not.toBeVisible()
    await expect(row.getByText("Heredado")).toBeVisible()
  })

  test("excluye la actividad para una faena y permite volver a incluirla", async ({ page }) => {
    await page.getByRole("tab", { name: /Ajustes por faena/ }).click()
    const row = page.locator("div.grid", { hasText: "Actividad ajustable anual E2E" }).last()

    await row.getByRole("button", { name: "Configurar" }).click()
    const excludeDialog = page.getByRole("dialog", { name: /Ajuste por faena/ })
    await excludeDialog.getByLabel("Excluir de esta faena").check()
    await excludeDialog.getByLabel("Motivo del ajuste").fill("La actividad queda fuera del alcance de esta faena durante la prueba.")
    await excludeDialog.getByRole("button", { name: "Guardar ajuste" }).click()
    await expect(row.getByText("Excluido")).toBeVisible()

    await row.getByRole("button", { name: "Configurar" }).click()
    const includeDialog = page.getByRole("dialog", { name: /Ajuste por faena/ })
    await includeDialog.getByLabel("Excluir de esta faena").uncheck()
    await includeDialog.getByLabel("Motivo del ajuste").fill("La actividad vuelve a heredar la aplicabilidad general del programa.")
    await includeDialog.getByRole("button", { name: "Guardar ajuste" }).click()
    await expect(row.getByText("Heredado")).toBeVisible()
  })

  test("muestra la comparación contra la revisión Base 2026", async ({ page }) => {
    await page.getByRole("tab", { name: /Revisión/ }).click()

    await expect(page.getByRole("heading", { name: "Cambios frente a la Base vigente" })).toBeVisible()
    await expect(page.getByText(/Revisión 1/)).toBeVisible()
    await expect(page.getByText("Agregadas")).toBeVisible()
    await expect(page.getByText("Ajustes por faena", { exact: true })).toBeVisible()
  })

  test("retira sin borrar ni renumerar y usa una fecha válida del año del programa", async ({ page }) => {
    const activityRow = page.getByRole("row").filter({ hasText: "Actividad ajustable anual E2E" })
    if (await activityRow.getByText("Retirada").isVisible().catch(() => false)) {
      await expect(activityRow).toContainText("90")
      return
    }

    await activityRow.getByRole("button", { name: "Retirar" }).click()
    const dialog = page.getByRole("dialog", { name: "Retirar actividad N°90" })
    await expect(dialog.getByRole("button", { name: "Fecha efectiva: 01-01-2027" })).toBeVisible()
    await dialog.getByLabel("Motivo del retiro").fill("La actividad se reemplaza por un control preventivo equivalente validado.")
    await dialog.getByRole("button", { name: "Retirar actividad" }).click()

    await expect(dialog).not.toBeVisible()
    await expect(activityRow.getByText("Retirada")).toBeVisible()
    await expect(activityRow).toContainText("90")
  })
})
