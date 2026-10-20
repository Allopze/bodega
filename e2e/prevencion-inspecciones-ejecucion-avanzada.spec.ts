import { test, expect, type Page } from "@playwright/test"
import { MINIMAL_PNG, abrirComentarioInspeccion, campoInspeccion, confirmarDeclararEjecutada, crearInspeccion as crearInspeccionE2E, login, responderItemInspeccion, textoVisible } from "./helpers"

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

    // Los campos descriptivos no mueven el avance de los obligatorios, y mientras se edita no hay
    // cumplimiento que mostrar (sólo existe tras declarar ejecutada).
    await expect(textoVisible(page, "0 de 5 obligatorios")).toBeVisible()
    await expect(textoVisible(page, "Aún no calculable")).toHaveCount(0)
    await expect(textoVisible(page, "Resultado normalizado")).toHaveCount(0)

    // Guardar respuestas parciales
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // Recargar y verificar persistencia exacta
    await page.reload()
    await expect(campoInspeccion(page, "Respuesta de Peso (kg)")).toHaveValue("10", { timeout: 15_000 })
    await expect(campoInspeccion(page, "Respuesta de Observaciones adicionales")).toHaveValue("Ubicado en pasillo principal sector talleres.")
  })

  // Se ejerce con "Malo" y no con "No aplica": la escala manda, y los cinco ítems
  // puntuables de esta plantilla son `bueno_malo_obs`, que no ofrece escape. Ofrecer
  // "No aplica" donde el instrumento no lo tiene es justamente lo que
  // `validateAnswerRow` rechaza —sacaría del denominador un ítem que el papel obliga a
  // juzgar, inflando el cumplimiento—. La regla bajo prueba es la misma: un resultado
  // `non_conforming` sin motivo no se envía, con el mismo mínimo que un "No aplica" o un
  // "Regular".
  //
  // Lo que cambió (P1-1) es qué frena: la fila retenida ya no apaga «Guardar respuestas»;
  // queda nombrada en «Respuestas que todavía no se guardan» y es el cierre el que se
  // bloquea.
  test("un 'Malo' sin justificación técnica queda retenido sin frenar el guardado", async ({ page }) => {
    await crearInspeccion(page)

    await responderItem(page, "Manguera", "Malo")

    // Se afirma la fila retenida y el botón: el aviso de lo retenido es independiente del
    // de «Para declarar ejecutada falta:», que sigue ahí mientras queden ítems sin responder.
    const motivoFaltante = page.getByRole("button", { name: /Manguera.*exige indicar el motivo/ })
    await expect(textoVisible(page, "Respuestas que todavía no se guardan")).toBeVisible()
    await expect(motivoFaltante).toBeVisible()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()

    // El cierre sí queda bloqueado, y lo dice dentro del propio diálogo.
    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/Manguera.*exige indicar el motivo/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    // Llenar la justificación requerida
    await (await abrirComentarioInspeccion(page, "Manguera")).fill("Manguera cortada en dos puntos; extintor fuera de servicio.")
    await expect(motivoFaltante).toHaveCount(0)
    await expect(textoVisible(page, "Respuestas que todavía no se guardan")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()

    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible({ timeout: 30_000 })
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
    await confirmarDeclararEjecutada(page)

    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    // El acta cerrada se relee resolviendo el `value` contra el rótulo de la
    // plantilla, y la firma queda con la hora que estampó el servidor.
    const acta = page.locator("section#acta-cierre")
    await expect(acta.getByText("No operativo / requiere recarga", { exact: true })).toBeVisible()
    await expect(acta.getByText(/^Prevencionista E2E · \d{2}-\d{2}-\d{4}/)).toBeVisible()
    await expect(acta.getByText(/^Supervisor Turno E2E · \d{2}-\d{2}-\d{4}/)).toBeVisible()
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
