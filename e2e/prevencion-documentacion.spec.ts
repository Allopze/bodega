import { test, expect } from "@playwright/test"
import { login, textoVisible } from "./helpers"

/**
 * Smoke E2E del módulo de Documentación SST.
 *
 * Guarda de regresión para el bug que rompía el build de producción: el
 * componente cliente `documentacion-view.tsx` arrastraba `@/db` al bundle del
 * navegador. Este spec obliga a que las páginas del módulo (que hidratan ese
 * componente cliente) rendericen en un navegador real, no solo que compilen.
 *
 * Y la subida tipada (2026-09-24): primero se declara qué documento es, y un
 * registro externo —una carta conductora— queda vigente al cargarlo.
 */
test.describe("Documentación SST", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el listado de documentación carga (no /forbidden)", async ({ page }) => {
    await page.goto("/prevencion/documentacion")
    await expect(page).toHaveURL(/\/prevencion\/documentacion/)
    await expect(page.getByRole("heading", { name: "Registro documental", level: 1 })).toBeVisible()
    // La vista cliente hidrató: el control para crear carpeta está presente.
    await expect(page.getByRole("button", { name: "Nueva carpeta" })).toBeVisible()
  })

  test("el botón Subir documento abre el modal (no navega a un formulario) y conserva la carga masiva", async ({ page }) => {
    await page.goto("/prevencion/documentacion")
    await page.getByRole("button", { name: "Subir documento", exact: true }).click()
    await expect(page.getByRole("button", { name: "Documento clasificado" })).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Carga masiva (sin clasificar)" }).click()
    await expect(page.getByRole("button", { name: "Subir archivos" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Subir carpeta" })).toBeVisible()
  })

  test("una carta conductora declarada como tal queda vigente al cargarla", async ({ page }) => {
    await page.goto("/prevencion/documentacion")
    await page.getByRole("button", { name: "Subir documento", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Subir documento" })

    await dialog.getByRole("combobox", { name: /Tipo de documento/ }).click()
    await page.getByRole("option", { name: /Carta conductora del RIOHS a la SEREMI/ }).click()
    // Corporativo es el valor por defecto con alcance global.
    await expect(dialog.getByText(/Quedará vigente al cargarlo/)).toBeVisible()

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "carta-seremi.pdf",
      mimeType: "application/pdf",
      // Único por corrida: el mismo archivo dos veces en un documento es un duplicado.
      buffer: Buffer.from(`%PDF-1.4\n% carta conductora e2e ${Date.now()}\n%%EOF\n`),
    })
    await dialog.getByRole("button", { name: "Cargar documento" }).click()
    await expect(textoVisible(page, /Documento cargado y vigente/)).toBeVisible()
    await expect(dialog).toBeHidden()
  })

  test("la papelera carga", async ({ page }) => {
    await page.goto("/prevencion/documentacion/papelera")
    await expect(page).not.toHaveURL(/\/forbidden/)
  })
})
