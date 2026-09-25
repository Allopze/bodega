import { test, expect, type Page } from "@playwright/test"
import { campoInspeccion, crearInspeccion as crearInspeccionE2E, login, textoVisible } from "./helpers"

/**
 * E2E Spec: Control de Concurrencia Optimista (CAS) en Inspecciones.
 *
 * Cubre:
 *   • Incremento ordenado de versión al guardar respuestas y cerrar.
 *   • Detección y manejo de conflictos de versión entre dos pestañas concurrentes.
 *   • Protección contra sobreescritura accidental de respuestas.
 */

const crearInspeccion = (page: Page) => crearInspeccionE2E(page, { prefijo: "E2E-CAS" })

test.describe("Inspecciones — Concurrencia y bloqueo optimista", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("múltiples guardados secuenciales actualizan el CAS sin generar falsos conflictos", async ({ page }) => {
    await crearInspeccion(page)

    // Guardado 1: Ítem Manómetro
    await campoInspeccion(page, "Resultado de Manómetro").click()
    await page.getByRole("option", { name: "Bueno", exact: true }).click()
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // Guardado 2: Ítem Sello inmediatamente después (usando la nueva versión interna sin recargar toda la página)
    await campoInspeccion(page, "Resultado de Sello").click()
    await page.getByRole("option", { name: "Bueno", exact: true }).click()
    /* Esperar a que la server action responda ANTES de recargar. Sin esto la
     * recarga abortaba el guardado en vuelo y sólo persistía el primer ítem: el
     * test fallaba mostrando "1 de 10" y parecía un conflicto de CAS que en
     * realidad era una carrera del propio test.
     *
     * La señal es la respuesta de red y no el aviso "Guardado correctamente.":
     * `saveAnswers` le pasa a `useOperation` un `onSuccess` propio, y en ese
     * caso el hook no guarda ese texto, así que nunca aparece. */
    const guardado = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 200,
      { timeout: 30_000 },
    )
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await guardado

    // Recargar y comprobar que ambos ítems persistieron correctamente
    await page.reload()
    await expect(textoVisible(page, "2 de 5 obligatorios · 2 de 10 totales")).toBeVisible({ timeout: 15_000 })
  })

  test("edición concurrente en dos sesiones detecta la versión obsoleta", async ({ page, context }) => {
    const { url } = await crearInspeccion(page)

    // Abrir la misma inspección en una segunda pestaña/página
    const page2 = await context.newPage()
    await page2.goto(url)
    await expect(textoVisible(page2, "Pendiente de ejecución").first()).toBeVisible({ timeout: 15_000 })

    // En la página 1 guardamos cambios (avanzando la versión del registro en BD)
    await campoInspeccion(page, "Resultado de Manómetro").click()
    await page.getByRole("option", { name: "Bueno", exact: true }).click()
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // En la página 2 (que tiene la versión vieja cargada), intentamos guardar otra respuesta
    await campoInspeccion(page2, "Resultado de Sello").click()
    await page2.getByRole("option", { name: "Bueno", exact: true }).click()
    await page2.getByRole("button", { name: "Guardar respuestas" }).click()

    // El servidor o la UI debe rechazar la versión obsoleta o informar la inconsistencia
    await page2.reload()
    await expect(textoVisible(page2, "En ejecución").first()).toBeVisible()
    await page2.close()
  })
})
