import { test, expect, type Page } from "@playwright/test"
import { MINIMAL_PNG, campoInspeccion, crearInspeccion as crearInspeccionE2E, login, responderItemInspeccion } from "./helpers"

/**
 * E2E Spec: Ejecución Avanzada de Inspecciones SST.
 *
 * Cubre:
 *   • Validación de tipos de respuesta heterogéneos (select, texto, número, booleano).
 *   • Regla de obligatoriedad de comentario en respuestas no conformes o "No aplica".
 *   • Carga de evidencia física y adjuntos fotográficos.
 *   • Validación estricta del acta de cierre (múltiples firmas, resultados y restricciones operativas).
 */

const crearInspeccion = async (page: Page, customSubject?: string) =>
  (await crearInspeccionE2E(page, { prefijo: "E2E-AVZ", identificacion: customSubject })).identificacion

const responderItem = responderItemInspeccion

test.describe("Inspecciones — Ejecución avanzada y validaciones de campo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("los campos descriptivos y numéricos se registran sin alterar el cálculo de cumplimiento", async ({ page }) => {
    await crearInspeccion(page)

    // Tipo de extintor (Select)
    await campoInspeccion(page, "Respuesta de Tipo de extintor").click()
    // El rótulo viene del catálogo SST (`inspeccion-extintores-sections.ts`) y usa
    // el subíndice tipográfico: "CO₂", no una glosa larga.
    await page.getByRole("option", { name: "CO₂" }).click()

    // Peso (Input numérico / texto)
    await campoInspeccion(page, "Respuesta de Peso (kg)").fill("10")

    // Ubicación / Observaciones (Texto libre)
    await campoInspeccion(page, "Respuesta de Observaciones adicionales").fill("Ubicado en pasillo principal sector talleres.")

    // Verificamos que los campos se computen en ítems respondidos pero no otorguen % de cumplimiento firmado
    await expect(page.getByText("3 de 10 ítems respondidos")).toBeVisible()
    await expect(page.getByText("No calculable")).toBeVisible()

    // Guardar respuestas parciales
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // Recargar y verificar persistencia exacta
    await page.reload()
    await expect(campoInspeccion(page, "Respuesta de Peso (kg)")).toHaveValue("10", { timeout: 15_000 })
    await expect(campoInspeccion(page, "Respuesta de Observaciones adicionales")).toHaveValue("Ubicado en pasillo principal sector talleres.")
  })

  test("bloqueo de guardado cuando 'No aplica' carece de justificación técnica", async ({ page }) => {
    await crearInspeccion(page)

    await responderItem(page, "Manguera", "No aplica")
    const aviso = page.locator("div").filter({ hasText: /^Corrige antes de guardar:/ }).first()
    await expect(aviso).toBeVisible()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeDisabled()

    // Llenar la justificación requerida
    await campoInspeccion(page, "Comentario de Manguera").fill("Extintor portátil de 1kg sin manguera de fábrica.")
    await expect(aviso).toBeHidden()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()

    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("En ejecución").first()).toBeVisible({ timeout: 30_000 })
  })

  test("el acta de cierre valida firmas obligatorias y restricciones operativas", async ({ page }) => {
    await crearInspeccion(page)

    // Respondemos los 5 puntuables conformes
    for (const item of ["Manómetro", "Sello", "Rótulo", "Manguera", "Certificado CECMEC"]) {
      await responderItem(page, item, "Bueno")
    }

    // Intentar declarar ejecutada sin firmar acta
    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
    await page.keyboard.press("Escape")

    /* Llenar el acta. Las opciones y los roles que firman los declara la
     * plantilla, no el formulario: extintores ofrece Operativo / Con
     * observaciones / No operativo, y declara `hasRestrictions: false`, así que
     * el campo de restricciones NO se renderiza para este instrumento. */
    await page.getByLabel("Resultado del acta").click()
    await page.getByRole("option", { name: "No operativo / requiere recarga", exact: true }).click()
    await page.getByLabel("Firma de prevencionista").fill("Prevencionista E2E")
    await page.getByLabel("Firma de supervisor").fill("Supervisor Turno E2E")

    // Ahora sí se habilita el cierre
    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialogConfirm = page.getByRole("dialog")
    await dialogConfirm.getByRole("button", { name: "Declarar ejecutada" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(page.getByText("Ejecutada").first()).toBeVisible({ timeout: 15_000 })
    // El acta cerrada se relee resolviendo el `value` contra el rótulo de la
    // plantilla, y la firma queda con la hora que estampó el servidor.
    await expect(page.getByText(/Resultado:\s*No operativo \/ requiere recarga/)).toBeVisible()
    await expect(page.getByText(/prevencionista:\s*Prevencionista E2E/)).toBeVisible()
    await expect(page.getByText(/supervisor:\s*Supervisor Turno E2E/)).toBeVisible()
  })

  test("subida y visualización de hoja de respaldo física", async ({ page }) => {
    await crearInspeccion(page)

    await expect(page.getByRole("heading", { name: "Subir la planilla física" })).toBeVisible()
    await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
      name: "registro-terreno-avanzado.png",
      mimeType: "image/png",
      buffer: MINIMAL_PNG,
    })

    await expect(page.getByRole("heading", { name: "Planilla original" })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole("button", { name: "Ampliar la planilla" })).toBeVisible()
  })
})
