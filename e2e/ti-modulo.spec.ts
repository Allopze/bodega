import { test, expect } from "@playwright/test"
import { login, clearRateLimits, textoVisible } from "./helpers"

/**
 * E2E Spec: Módulo de TI (`/ti`).
 *
 * Cubre:
 *   • Carga del resumen TI ("Atención hoy").
 *   • Inventario con el activo sembrado por `setup-db.ts` (TI-E2E-0001).
 *   • Mesa de ayuda con el ticket sembrado (INC-E2E-0001).
 *   • Reportes con export Excel.
 *   • Guard de autorización: un rol sin `ti:view` termina en /forbidden.
 *   • Ficha: "Corregir estado" abierto desde un menú no deja la página sin
 *     clics y devuelve el foco al menú (auditoría UI/UX TI 2026-10-05).
 *   • Ticket: "Cerrado" ofrece el campo Resolución que el servidor exige.
 *
 * Cada test hace su propio login explícito (patrón `restricted-roles.spec.ts`):
 * el `beforeEach` con el admin bloqueaba el cambio de usuario del último test,
 * porque una sesión activa en /login redirige a /dashboard.
 */
test.describe("Módulo de TI", () => {
  test("el resumen TI carga con su título", async ({ page }) => {
    await login(page)
    await page.goto("/ti")
    await expect(page).toHaveURL(/\/ti$/)
    await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Atención hoy" })).toBeVisible()
  })

  test("el inventario lista el activo sembrado", async ({ page }) => {
    await login(page)
    await page.goto("/ti/activos")
    await expect(page.getByRole("heading", { name: "Inventario", exact: true })).toBeVisible()
    await expect(textoVisible(page, "TI-E2E-0001").first()).toBeVisible()
    await expect(textoVisible(page, /ThinkPad T14/).first()).toBeVisible()
  })

  test("el ticket sembrado aparece en la mesa de ayuda", async ({ page }) => {
    await login(page)
    await page.goto("/ti/tickets")
    await expect(page.getByRole("heading", { name: "Mesa de ayuda", exact: true })).toBeVisible()
    await expect(textoVisible(page, "INC-E2E-0001").first()).toBeVisible()
    await expect(textoVisible(page, "Notebook no enciende").first()).toBeVisible()
  })

  test("reportes TI lista los reportes con export Excel", async ({ page }) => {
    await login(page)
    await page.goto("/ti/reportes")
    await expect(page.getByRole("heading", { name: "Reportes TI" })).toBeVisible()
    await expect(textoVisible(page, "Inventario general").first()).toBeVisible()
    await expect(page.getByRole("button", { name: /Exportar/i }).first()).toBeVisible()
  })

  test("corregir estado desde el menú de la ficha no deja la página sin clics", async ({ page }) => {
    await login(page)
    await page.goto("/ti/activos/it-asset-e2e")
    await expect(page.getByRole("button", { name: "Entregar" }).first()).toBeVisible()
    const menu = page.getByRole("button", { name: "Más acciones" })
    await menu.click()
    await page.getByRole("menuitem", { name: /Corregir estado/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    // Un menú modal dejaba `pointer-events: none` en el body al abrir la hoja.
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe("none")
    await expect(menu).toBeFocused()
    await menu.click()
    await expect(page.getByRole("menu")).toBeVisible()
  })

  test("cerrar un ticket ofrece el campo de resolución que el servidor exige", async ({ page }) => {
    await login(page)
    await page.goto("/ti/tickets/it-ticket-e2e")
    await page.getByRole("combobox", { name: /Nuevo estado/ }).click()
    await page.getByRole("option", { name: "Cerrado", exact: true }).click()
    await expect(page.getByLabel(/Resolución/)).toBeVisible()
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