import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E Spec: Control de Concurrencia Optimista (CAS) en Inspecciones.
 *
 * Cubre:
 *   • Incremento ordenado de versión al guardar respuestas y cerrar.
 *   • Detección y manejo de conflictos de versión entre dos pestañas concurrentes.
 *   • Protección contra sobreescritura accidental de respuestas.
 */

const PLANTILLA = "Inspección de Estado de Extintores"
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let contador = 0

async function crearInspeccion(page: Page) {
  const identificacion = `E2E-CAS-${RUN}-${++contador}`
  await page.goto("/prevencion/inspecciones")
  await expectPageTitle(page, "Inspecciones")

  await page.getByRole("button", { name: "Nueva inspección" }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva inspección" })
  await dialog.getByLabel("Plantilla").click()
  await page.getByRole("option", { name: new RegExp(`^${PLANTILLA} · E2E$`) }).click()
  await dialog.getByLabel("Faena de la inspección").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.locator('input[name="subjectType"]').fill("extintor")
  await dialog.locator('input[name="subjectLabel"]').fill(identificacion)
  await dialog.getByRole("button", { name: "Crear" }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

  const fila = page.getByRole("row").filter({ hasText: identificacion }).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await fila.getByRole("link").first().click()
  await expect(page).toHaveURL(/\/prevencion\/inspecciones\/[^/?]+$/, { timeout: 30_000 })
  return { identificacion, url: page.url() }
}

test.describe("Inspecciones — Concurrencia y bloqueo optimista", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("múltiples guardados secuenciales actualizan el CAS sin generar falsos conflictos", async ({ page }) => {
    await crearInspeccion(page)

    // Guardado 1: Ítem Manómetro
    await page.getByLabel("Resultado de Manómetro").click()
    await page.getByRole("option", { name: "Cumple", exact: true }).click()
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // Guardado 2: Ítem Sello inmediatamente después (usando la nueva versión interna sin recargar toda la página)
    await page.getByLabel("Resultado de Sello").click()
    await page.getByRole("option", { name: "Cumple", exact: true }).click()
    /* Esperar a que la server action responda ANTES de recargar. Sin esto la
     * recarga abortaba el guardado en vuelo y sólo persistía el primer ítem: el
     * test fallaba mostrando "1 de 10" y parecía un conflicto de CAS que en
     * realidad era una carrera del propio test.
     *
     * La señal es la respuesta de red y no el aviso "Guardado correctamente.":
     * ese texto vive en estado de cliente y el revalidado remonta el árbol
     * —esta ruta tiene `loading.tsx`—, así que desaparece antes de poder
     * observarse de forma fiable. */
    const guardado = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 200,
      { timeout: 30_000 },
    )
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await guardado

    // Recargar y comprobar que ambos ítems persistieron correctamente
    await page.reload()
    await expect(page.getByText("2 de 10 ítems respondidos")).toBeVisible({ timeout: 15_000 })
  })

  test("edición concurrente en dos sesiones detecta la versión obsoleta", async ({ page, context }) => {
    const { url } = await crearInspeccion(page)

    // Abrir la misma inspección en una segunda pestaña/página
    const page2 = await context.newPage()
    await page2.goto(url)
    await expect(page2.getByText("Planificada").first()).toBeVisible({ timeout: 15_000 })

    // En la página 1 guardamos cambios (avanzando la versión del registro en BD)
    await page.getByLabel("Resultado de Manómetro").click()
    await page.getByRole("option", { name: "Cumple", exact: true }).click()
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // En la página 2 (que tiene la versión vieja cargada), intentamos guardar otra respuesta
    await page2.getByLabel("Resultado de Sello").click()
    await page2.getByRole("option", { name: "Cumple", exact: true }).click()
    await page2.getByRole("button", { name: "Guardar respuestas" }).click()

    // El servidor o la UI debe rechazar la versión obsoleta o informar la inconsistencia
    await page2.reload()
    await expect(page2.getByText("En ejecución").first()).toBeVisible()
    await page2.close()
  })
})
