import { test, expect, type Locator, type Page } from "@playwright/test"
import { login, textoVisible } from "./helpers"

/**
 * E2E: hallazgos, CAPA y cierre de una inspección.
 *
 * La segunda mitad del ciclo de vida —derivar el hallazgo, revisar de forma
 * independiente, reabrir para rectificar, cancelar— existía como servicio
 * probado y como diálogos que nadie abría en una prueba de navegador. Son
 * además las transiciones donde la auditoría 2026-08-18 encontró A-04 (una
 * planificada obsoleta no se podía cancelar), A-05 (una ejecución declarada por
 * error quedaba firmada para siempre) y B-06 (el cierre manual de hallazgos).
 *
 * Cada escenario opera sobre **su propia** ejecución sembrada en
 * `e2e/setup-db.ts`: revisar, reabrir y cancelar son terminales, así que
 * compartir una fila obligaría a fijar el orden entre tests y a que un fallo
 * arrastrara a los siguientes.
 *
 * Las que revisa el admin las ejecutó `user-ops-e2e` a propósito:
 * `assessRunReview` exige que el revisor no sea quien ejecutó.
 */

/** Motivo de transición: el servicio exige 10 caracteres en todas. */
const MOTIVO_MIN = 10

async function abrir(page: Page, runId: string, codigo: string) {
  await page.goto(`/prevencion/inspecciones/${runId}`)
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(codigo) })).toBeVisible({ timeout: 30_000 })
}

/**
 * Los diálogos de cancelar, reabrir y cerrar hallazgo son el mismo `ConfirmDialog` con motivo.
 *
 * Tres cosas que ya no son como eran (P2-4):
 *   - el disparador se llama «Cancelar inspección» y «Cerrar hallazgo», no «Cancelar» ni
 *     «Cerrar», que se confundían con el botón que descarta y con la aspa del diálogo;
 *   - el campo se ubica por su etiqueta («Motivo de la cancelación», «Motivo de la
 *     rectificación», «Motivo»): el `<textarea>` ya no es un formulario con `name="reason"`;
 *   - confirmar es un botón común (no `type=submit`) que repite el rótulo del disparador, así
 *     que se busca por su nombre exacto DENTRO del diálogo, donde el disparador no está.
 *
 * `exact: true` en los dos: «Cancelar» es prefijo de «Cancelar inspección», y «Cerrar» lo es
 * de «Cerrar hallazgo» y de la aspa del diálogo.
 */
async function confirmarConMotivo(page: Page, disparador: string, motivo: string, dentroDe: Locator = page.locator("body")) {
  expect(motivo.length).toBeGreaterThanOrEqual(MOTIVO_MIN)
  await dentroDe.getByRole("button", { name: disparador, exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel(/^Motivo/).fill(motivo)
  await dialog.getByRole("button", { name: disparador, exact: true }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
}

test.describe("Inspecciones — revisión independiente y cierre", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /**
   * La segregación que importa: no la de quien incorpora la plantilla (que se
   * retiró a propósito), sino la de quien ejecutó la inspección.
   */
  test("quien ejecutó la inspección no puede revisarla", async ({ page }) => {
    await abrir(page, "insp-e2e-autorrevision", "INSP-E2E-0002")

    await expect(page.getByText("Tú ejecutaste esta inspección: debe revisarla y cerrarla otra persona con permiso de revisión.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Revisar y cerrar" })).toHaveCount(0)
  })

  test("un hallazgo alto sin CAPA bloquea el cierre y lo nombra", async ({ page }) => {
    await abrir(page, "insp-e2e-bloqueada", "INSP-E2E-0003")

    await page.getByRole("button", { name: "Revisar y cerrar" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/El hallazgo "Manómetro: aguja en zona verde\." es Alta y no tiene CAPA\./))
      .toBeVisible()
    await expect(dialog.getByRole("button", { name: "Revisar y cerrar" })).toBeDisabled()
  })

  /**
   * Función #3: el acta de LA inspección. El export Excel es agregado y en
   * fiscalización se pide ésta.
   */
  test("el acta PDF de la inspección está disponible una vez ejecutada", async ({ page }) => {
    await abrir(page, "insp-e2e-bloqueada", "INSP-E2E-0003")

    const acta = page.getByRole("link", { name: "Acta PDF" })
    await expect(acta).toHaveAttribute("href", "/prevencion/inspecciones/insp-e2e-bloqueada/print")

    const [impresion] = await Promise.all([page.waitForEvent("popup"), acta.click()])
    await expect(impresion.getByText("INSP-E2E-0003").first()).toBeVisible({ timeout: 30_000 })
    await impresion.close()

    // `page.request` comparte las cookies de la sesión del navegador.
    const pdf = await page.request.get("/prevencion/inspecciones/insp-e2e-bloqueada/print/pdf")
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()["content-type"]).toMatch(/application\/pdf/)
    const bytes = await pdf.body()
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  test("derivar un hallazgo a CAPA lo enlaza y abre la acción correctiva", async ({ page }) => {
    await abrir(page, "insp-e2e-capa", "INSP-E2E-0004")

    const hallazgo = page.getByRole("row").filter({ hasText: "Manómetro: aguja en zona verde." })
    await expect(hallazgo.getByText("Abierto")).toBeVisible()

    await hallazgo.getByRole("button", { name: "Derivar a CAPA" }).click()
    const dialog = page.getByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    await dialog.locator('textarea[name="actionDescription"]').fill("Reemplazar el extintor y recargar el de reemplazo.")
    await dialog.locator('textarea[name="immediateMeasure"]').fill("Se retira el extintor del pañol.")
    await dialog.getByLabel("Responsable de la CAPA").click()
    await page.getByRole("option", { name: "Admin E2E", exact: true }).click()
    await dialog.getByRole("button", { name: "Derivar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(hallazgo.getByText("Con CAPA")).toBeVisible({ timeout: 15_000 })
    // B-06: con CAPA enlazada ya no se cierra a mano; se cierra con su acción.
    await expect(hallazgo.getByRole("button", { name: "Derivar a CAPA" })).toHaveCount(0)
    await expect(hallazgo.getByRole("button", { name: "Cerrar hallazgo", exact: true })).toHaveCount(0)

    await hallazgo.getByRole("link", { name: "Ver CAPA" }).click()
    await expect(page).toHaveURL(/\/prevencion\/capa\/[^/?]+$/, { timeout: 30_000 })
    await expect(page.getByText("Manómetro: aguja en zona verde.")).toBeVisible()
    await expect(page.getByText("Reemplazar el extintor y recargar el de reemplazo.")).toBeVisible()
  })

  test("revisar y cerrar deja constancia de quién revisó y qué dijo", async ({ page }) => {
    await abrir(page, "insp-e2e-revisar", "INSP-E2E-0005")

    await page.getByRole("button", { name: "Revisar y cerrar" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("button", { name: "Revisar y cerrar" })).toBeEnabled()
    await dialog.locator('textarea[name="reviewComment"]').fill("Revisada en terreno; el sello se repuso en el acto.")
    await dialog.getByRole("button", { name: "Revisar y cerrar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(page.getByText("Revisada y cerrada", { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 })
    // El resumen deja constancia de quién revisó y de lo que dijo.
    const resumen = page.getByRole("region", { name: "Resumen de la inspección" })
    await expect(resumen.getByText(/Revisó:\s*Admin E2E/)).toBeVisible()
    await expect(resumen.getByText("Revisada en terreno; el sello se repuso en el acto.")).toBeVisible()
    // Cerrada, deja de ofrecer la revisión y conserva el camino de rectificación.
    await expect(page.getByRole("button", { name: "Revisar y cerrar" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Reabrir para rectificar" })).toBeVisible()
  })

  /**
   * A-05: antes no existía camino de vuelta y un error de tipeo quedaba
   * firmado. Reabrir borra el cumplimiento calculado —conservarlo afirmaría un
   * resultado que ya no corresponde a ninguna respuesta cerrada— y los
   * hallazgos sin CAPA, que se recalculan al volver a declararla ejecutada.
   */
  test("reabrir para rectificar borra el cumplimiento firmado", async ({ page }) => {
    await abrir(page, "insp-e2e-reabrir", "INSP-E2E-0006")
    await expect(textoVisible(page, "80%").first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()

    await confirmarConMotivo(
      page,
      "Reabrir para rectificar",
      "El sello sí estaba intacto; se marcó por error al digitar.",
    )

    await page.reload()
    await expect(page.getByText("En ejecución", { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 })
    // Mientras se edita no hay cumplimiento a la vista (sólo existe una vez declarada ejecutada), así
    // que el 80% firmado no puede quedar en pantalla...
    await expect(textoVisible(page, "80%")).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Resumen de la inspección" }).getByText("Resultado normalizado")).toHaveCount(0)
    // La sección de hallazgos sólo existe en ejecutada o cerrada.
    await expect(page.getByRole("heading", { name: /^Hallazgos \(/ })).toHaveCount(0)
    // Y vuelve a ser editable.
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeVisible()

    // ...y lo que importa: el porcentaje FIRMADO se borró en el servidor. La bandeja lo muestra.
    await page.goto("/prevencion/inspecciones?q=INSP-E2E-0006")
    const fila = page.getByRole("row").filter({ hasText: "INSP-E2E-0006" })
    await expect(fila.getByText("No calculable")).toBeVisible({ timeout: 30_000 })
    await expect(fila.getByText("80%")).toHaveCount(0)
  })

  /**
   * B-06: cierre manual sólo para hallazgos sin CAPA. Los que la tienen se
   * cierran al verificar o cerrar su acción, en la misma transacción.
   */
  test("un hallazgo sin CAPA se puede cerrar a mano con su motivo", async ({ page }) => {
    await abrir(page, "insp-e2e-hallazgo", "INSP-E2E-0007")

    const hallazgo = page.getByRole("row").filter({ hasText: "Sello de seguridad intacto" })
    await expect(hallazgo.getByText("Abierto")).toBeVisible()

    await confirmarConMotivo(
      page,
      "Cerrar hallazgo",
      "Sello repuesto y verificado por el supervisor de turno.",
      hallazgo,
    )

    await page.reload()
    await expect(hallazgo.getByText("Cerrado")).toBeVisible({ timeout: 15_000 })
    await expect(hallazgo.getByRole("button", { name: "Cerrar hallazgo", exact: true })).toHaveCount(0)
  })

  /**
   * A-04: el esquema soportaba `cancelled` con sus tres campos y su CHECK desde
   * el principio, y nada podía escribirlo: una planificada obsoleta quedaba
   * viva para siempre en la cola de pendientes.
   */
  test("cancelar una planificada la saca de la bandeja de pendientes", async ({ page }) => {
    await abrir(page, "insp-e2e-cancelar", "INSP-E2E-0001")
    await expect(page.getByText("Pendiente de ejecución", { exact: true }).filter({ visible: true }).first()).toBeVisible()

    await confirmarConMotivo(page, "Cancelar inspección", "La faena retiró el extintor de bodega antes de inspeccionarlo.")

    await page.reload()
    await expect(page.getByText("Cancelada", { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 })
    // R-02: el motivo que se obligó a escribir se lee después, con quién canceló y cuándo.
    await expect(page.getByText(/Cancelada por .+ el \d{2}-\d{2}-\d{4}: La faena retiró el extintor de bodega antes de inspeccionarlo\./)).toBeVisible()
    // Cancelada deja de ser editable y de ofrecer transiciones.
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Cancelar inspección", exact: true })).toHaveCount(0)

    await page.goto("/prevencion/inspecciones?estado=cancelled")
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0001" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0005" })).toHaveCount(0)
  })
})

/**
 * El puente con flota: el sujeto de la inspección es un equipo del padrón, así
 * que la falla puede abrir su mantención correctiva y, si quien administra la
 * flota lo confirma, sacarlo de servicio. Detener el equipo es un permiso
 * distinto (`combustibles:manage_vehicles`) porque quien digita el reporte
 * detecta la falla, pero parar una máquina para la faena lo decide flota.
 */
test.describe("Inspecciones — falla de un equipo de flota", () => {
  test("derivar la falla abre la mantención del equipo y permite sacarlo de servicio", async ({ page }) => {
    await login(page)
    await abrir(page, "insp-e2e-equipo", "INSP-E2E-0008")
    await expect(page.getByText("E2E-INSP-1").first()).toBeVisible()

    const hallazgo = page.getByRole("row").filter({ hasText: "Manómetro: aguja en zona verde." })
    await hallazgo.getByRole("button", { name: "Derivar a CAPA" }).click()
    const dialog = page.getByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    await dialog.locator('textarea[name="actionDescription"]').fill("Reparar el sistema y verificar en taller.")
    await dialog.getByLabel("Responsable de la CAPA").click()
    await page.getByRole("option", { name: "Admin E2E", exact: true }).click()
    await expect(dialog.getByText(/Se abrirá automáticamente una OT correctiva/)).toBeVisible()
    await dialog.getByRole("button", { name: "Derivar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(hallazgo.getByText("Con CAPA")).toBeVisible({ timeout: 15_000 })

    // La mantención nace programada para el mismo plazo que la CAPA: taller y
    // Prevención no pueden llevar dos calendarios distintos.
    await page.goto("/mantenciones")
    await expect(page.getByRole("row").filter({ hasText: "E2E-INSP-1" }).first())
      .toBeVisible({ timeout: 30_000 })

    await abrir(page, "insp-e2e-equipo", "INSP-E2E-0008")
    await hallazgo.getByRole("button", { name: "Sacar de servicio" }).click()
    const detener = page.getByRole("dialog", { name: "Sacar el equipo de servicio" })
    await detener.locator('textarea[name="reason"]').fill("Falla grave detectada en la inspección del turno.")
    await detener.getByRole("button", { name: "Confirmar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.goto("/flota/fuel-veh-insp-e2e")
    await expect(page.getByText("Fuera de servicio").first()).toBeVisible({ timeout: 30_000 })
  })
})
