import { test, expect } from "@playwright/test"
import { login, clearRateLimits } from "./helpers"

/**
 * E2E Spec: Módulo de TI (`/ti`).
 *
 * Cubre:
 *   • Carga del dashboard TI.
 *   • Inventario con el activo sembrado por `setup-db.ts` (TI-E2E-0001).
 *   • Mesa de ayuda con el ticket sembrado (INC-E2E-0001).
 *   • Reportes con export Excel.
 *   • Guard de autorización: un rol sin `ti:view` termina en /forbidden.
 *
 * Cada test hace su propio login explícito (patrón `restricted-roles.spec.ts`):
 * el `beforeEach` con el admin bloqueaba el cambio de usuario del último test,
 * porque una sesión activa en /login redirige a /dashboard.
 */
test.describe("Módulo de TI", () => {
  test("el dashboard TI carga con su título", async ({ page }) => {
    await login(page)
    await page.goto("/ti")
    await expect(page).toHaveURL(/\/ti$/)
    await expect(page.getByRole("heading", { name: "TI", exact: true })).toBeVisible()
  })

  test("el inventario lista el activo sembrado", async ({ page }) => {
    await login(page)
    await page.goto("/ti/activos")
    await expect(page.getByRole("heading", { name: "Inventario TI" })).toBeVisible()
    await expect(page.getByText("TI-E2E-0001").first()).toBeVisible()
    await expect(page.getByText("ThinkPad T14").first()).toBeVisible()
  })

  test("el ticket sembrado aparece en la mesa de ayuda", async ({ page }) => {
    await login(page)
    await page.goto("/ti/tickets")
    await expect(page.getByRole("heading", { name: "Tickets TI" })).toBeVisible()
    await expect(page.getByText("INC-E2E-0001").first()).toBeVisible()
    await expect(page.getByText("Notebook no enciende").first()).toBeVisible()
  })

  test("reportes TI lista los reportes con export Excel", async ({ page }) => {
    await login(page)
    await page.goto("/ti/reportes")
    await expect(page.getByRole("heading", { name: "Reportes TI" })).toBeVisible()
    await expect(page.getByText("Inventario general").first()).toBeVisible()
    await expect(page.getByRole("button", { name: /Exportar/i }).first()).toBeVisible()
  })

  test("un rol sin permiso ti:view es redirigido a /forbidden", async ({ page }) => {
    // jefe.faena@e2e.chome.cl solo tiene permisos de prevención (p-prev-insp-*).
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill("jefe.faena@e2e.chome.cl")
    await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goto("/ti")
    await expect(page).toHaveURL(/\/forbidden/)
  })
})