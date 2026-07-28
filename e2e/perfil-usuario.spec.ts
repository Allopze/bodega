import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Perfil de Usuario y Preferencias (`/perfil`).
 *
 * Covers:
 *   • Carga de la información de cuenta.
 *   • Formularios de actualización de contraseña y preferencias de notificación.
 */
test.describe("Módulo de Mi Perfil", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista de perfil carga correctamente con la información de cuenta", async ({ page }) => {
    await page.goto("/perfil")
    await expect(page).toHaveURL(/\/perfil/)

    // Título de la página
    await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Cuenta" })).toBeVisible()

    // Formularios de seguridad y preferencias. "Cambiar contraseña" es el botón
    // de envío del formulario, no un encabezado: la sección se titula
    // "Seguridad" (ver app/(app)/perfil/page.tsx).
    await expect(page.getByRole("heading", { name: "Seguridad" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Cambiar contraseña/i })).toBeVisible()
  })
})
