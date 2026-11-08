import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * Configuración de Talana desde la plataforma (token y modo).
 *
 * El servidor E2E puede o no tener llavero de cifrado: con él el token se puede
 * escribir; sin él el campo queda deshabilitado y el aviso lo explica. En los
 * dos casos el modo se guarda, porque no es un secreto. La prueba no escribe un
 * token: verificaría lo mismo que las pruebas unitarias y dejaría un secreto
 * de juguete en la base.
 */

const DIALOG_NAME = "Configurar la sincronización con Talana"

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Configurar", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: DIALOG_NAME })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("Talana — configuración desde la plataforma", () => {
  test("el administrador cambia el modo y lo restaura al del servidor", async ({ page }) => {
    await login(page)
    await page.goto("/admin/talana")

    const dialog = await openSettings(page)
    const token = dialog.getByLabel("Token de la API", { exact: true })
    await expect(token).toHaveValue("")
    if (await dialog.getByText("No hay llavero de cifrado en el servidor").isVisible()) {
      await expect(token).toBeDisabled()
    } else {
      await expect(token).toBeEnabled()
    }

    // Pasar a «Aplicar» pide confirmación; cancelarla no guarda nada.
    await dialog.getByRole("radio", { name: /^Aplicar/ }).click()
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click()
    const confirmApply = page.getByRole("alertdialog", { name: "¿Pasar la sincronización a «Aplicar»?" })
      .or(page.getByRole("dialog", { name: "¿Pasar la sincronización a «Aplicar»?" }))
    await expect(confirmApply).toBeVisible()
    await confirmApply.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(confirmApply).toBeHidden()

    // Simulación no pide confirmación y queda guardada en la plataforma.
    await dialog.getByRole("radio", { name: /^Simulación/ }).click()
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    const reopened = await openSettings(page)
    await expect(reopened.getByText("Hoy: Simulación · Guardado en la plataforma.")).toBeVisible({ timeout: 30_000 })

    // Restaurar devuelve el mando al .env del servidor (que en E2E no define modo).
    await reopened.getByRole("button", { name: "Restaurar la configuración del servidor", exact: true }).click()
    const confirmClear = page.getByRole("alertdialog", { name: "¿Restaurar la configuración del servidor?" })
      .or(page.getByRole("dialog", { name: "¿Restaurar la configuración del servidor?" }))
    await confirmClear.getByRole("button", { name: "Restaurar", exact: true }).click()
    await expect(reopened).toBeHidden({ timeout: 30_000 })

    const afterRestore = await openSettings(page)
    await expect(afterRestore.getByText("Hoy: Simulación · Guardado en la plataforma.")).toHaveCount(0)
    await expect(afterRestore.getByRole("button", { name: "Restaurar la configuración del servidor", exact: true })).toHaveCount(0)
  })

  test("RR. HH. ve la sincronización pero no puede configurarla", async ({ page }) => {
    await login(page, "rrhh@e2e.chome.cl")
    await page.goto("/admin/talana")
    await expect(page.getByRole("heading", { name: "Sincronización Talana" }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Configurar", exact: true })).toHaveCount(0)
  })
})
