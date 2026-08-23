import { test, expect } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E Spec: Roles, Permisos y Aislamiento en Inspecciones SST.
 *
 * Cubre:
 *   • Segregación de funciones por perfil: Jefe de Faena vs Administrador SST.
 *   • Protección de endpoints de gestión de plantillas (aprobar / retirar).
 *   • Restricción de permisos de revisión y cierre independiente.
 */

test.describe("Inspecciones — Matriz de Roles y Permisos", () => {
  test("el Jefe de Faena puede ejecutar pero no puede aprobar plantillas ni revisar inspecciones", async ({ page }) => {
    // 1. Iniciar sesión como Jefe de Faena
    await login(page, "jefe.faena@e2e.chome.cl", "chome2026")

    // 2. Acceder a la bandeja de inspecciones: debe cargar
    await page.goto("/prevencion/inspecciones")
    await expectPageTitle(page, "Inspecciones")
    await expect(page.getByRole("button", { name: "Nueva inspección" })).toBeVisible()

    // 3. Acceder al catálogo de plantillas: puede verlas pero NO debe ver botones de acción administrativa
    await page.goto("/prevencion/inspecciones/plantillas")
    await expectPageTitle(page, "Plantillas de inspección")
    await expect(page.getByRole("button", { name: "Publicar nueva versión" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Aprobar" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Retirar" })).toHaveCount(0)

    // 4. Acceder a una inspección ejecutada por otro usuario para revisar: el botón no debe estar disponible
    await page.goto("/prevencion/inspecciones/insp-e2e-bloqueada")
    await expect(page.getByText("INSP-E2E-0003").first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Revisar y cerrar" })).toHaveCount(0)
  })

  test("el Administrador SST tiene control completo sobre plantillas, programas y revisiones", async ({ page }) => {
    // Iniciar sesión como Administrador
    await login(page, "admin@e2e.chome.cl", "chome2026")

    await page.goto("/prevencion/inspecciones/plantillas")
    await expectPageTitle(page, "Plantillas de inspección")
    await expect(page.getByRole("button", { name: "Publicar nueva versión" })).toBeVisible()

    await page.goto("/prevencion/inspecciones/programacion")
    await expectPageTitle(page, "Programación de inspecciones")
    await expect(page.getByRole("button", { name: "Nuevo programa" }).first()).toBeVisible()
  })
})
