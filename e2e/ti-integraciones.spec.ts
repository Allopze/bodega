import { test, expect } from "@playwright/test"
import { login, clearRateLimits } from "./helpers"

/**
 * E2E Spec: Integraciones de TI (`/ti/integraciones`).
 *
 * Cubre:
 *   • El menú de TI lleva a la pantalla.
 *   • El filtro por estado viaja en la URL (cifra «Sin corridas» → `estado=never`).
 *   • Guard de autorización: un rol sin `ti:view` termina en /forbidden.
 *
 * En la base E2E el cron no corre, así que los jobs salen «Sin corridas»: la
 * cifra y el filtro se pueden recorrer sin sembrar nada.
 */
test.describe("Integraciones de TI", () => {
  test("el menú de TI lleva a Integraciones", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 })
    await login(page)
    await page.goto("/ti")
    // `exact: true`: el breadcrumb de la página destino repite el rótulo, pero aquí
    // el panel lateral es el único `<nav>` de este nombre.
    const sidebar = page.getByRole("navigation", { name: "Navegación", exact: true })
    await sidebar.getByRole("link", { name: "Integraciones", exact: true }).click()
    await expect(page).toHaveURL(/\/ti\/integraciones$/)
    await expect(page.getByRole("heading", { name: "Integraciones", exact: true })).toBeVisible()
  })

  test("el filtro por estado viaja en la URL", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 })
    await login(page)
    await page.goto("/ti/integraciones")
    await page.getByRole("link", { name: /Sin corridas/ }).click()
    await expect(page).toHaveURL(/estado=never/)
    await expect(page.getByText("Mostrando:")).toBeVisible()
    await page.getByRole("link", { name: "Ver todas", exact: true }).click()
    await expect(page).not.toHaveURL(/estado=/)
  })

  test("un rol sin permiso ti:view es redirigido a /forbidden", async ({ page }) => {
    // jefe.faena@e2e.chome.cl solo tiene permisos de prevención (p-prev-insp-*).
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill("jefe.faena@e2e.chome.cl")
    await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto("/ti/integraciones")
    await expect(page).toHaveURL(/\/forbidden/)
  })
})
