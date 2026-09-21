import { test, expect, type Page } from "@playwright/test"
import { confirmarDeclararEjecutada, crearInspeccion as crearInspeccionE2E, expectPageTitle, login, responderItemInspeccion, textoVisible } from "./helpers"

/**
 * E2E Spec: Flujo Integral Multimódulo de Inspecciones SST.
 *
 * Cubre el recorrido por la UI:
 *   1. Ejecución de Inspección en terreno con hallazgo crítico.
 *   2. Derivación del hallazgo a Acción Correctiva (CAPA).
 *   3. Verificación del enlace y de los datos heredados en la CAPA.
 *   4. Que el tablero de Prevención sigue en pie tras el recorrido.
 *
 * Lo que este spec NO cubre, pese a lo que decía su cabecera: la acreditación
 * del PDTP al completar la corrida. Afirmarla acá exigiría cablear
 * `pdtpActivityNumbers` en `insptpl-insp-e2e`, que comparten diez specs del
 * PDTP, y toda inspección de los demás specs empezaría a acreditar contra
 * `pdtp-act-e2e` moviéndoles las cuentas. Además es un invariante de servidor,
 * no de navegador, y está probado donde corresponde:
 * `lib/__tests__/pdtp-accreditation.test.ts` —incluida la idempotencia por
 * `sourceId`— y `prevention-inspections-postgres.test.ts`, que verifica que el
 * Reporte de Equipos acredite sólo la n=25.
 */

const crearInspeccion = async (page: Page) => (await crearInspeccionE2E(page, { prefijo: "E2E-INT" })).identificacion

const responderItem = responderItemInspeccion

test.describe("Inspecciones — Flujo Integral y Trazabilidad CAPA / PDTP", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("ciclo completo: Inspección → Hallazgo → Derivación CAPA → Cierre y Trazabilidad", async ({ page }) => {
    // 1. Crear y ejecutar inspección con falla en manómetro (daño grave -> hallazgo Alta)
    await crearInspeccion(page)

    for (const item of ["Sello", "Rótulo", "Manguera", "Certificado CECMEC"]) {
      await responderItem(page, item, "Bueno")
    }
    await responderItem(page, "Manómetro", "Malo", "Aguja en zona roja: presión bajo el mínimo.")

    await page.getByLabel("Resultado del acta").click()
    await page.getByRole("option", { name: "Con observaciones", exact: true }).click()
    // El nombre accesible del campo es su `aria-label` ("Firma de <rol>"), no
    // el texto visible de la etiqueta ("Firma: <rol>").
    await page.getByLabel("Firma de prevencionista").fill("Admin E2E")
    await page.getByLabel("Firma de supervisor").fill("Comprador E2E")

    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    await confirmarDeclararEjecutada(page)

    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "80%").first()).toBeVisible()

    // 2. Localizar el hallazgo generado y derivarlo a CAPA
    const filaHallazgo = page.getByRole("row").filter({ hasText: "Manómetro: aguja en zona verde." })
    await expect(filaHallazgo.getByText("Alta")).toBeVisible()
    await expect(filaHallazgo.getByText("Abierto")).toBeVisible()

    await filaHallazgo.getByRole("button", { name: "Derivar a CAPA" }).click()
    const dialogCapa = page.getByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    await dialogCapa.locator('textarea[name="actionDescription"]').fill("Reemplazo urgente de válvula y manómetro descalibrado.")
    await dialogCapa.locator('textarea[name="immediateMeasure"]').fill("Se retira extintor de faena y se coloca equipo de respaldo.")
    await dialogCapa.getByLabel("Responsable de la CAPA").click()
    await page.getByRole("option", { name: "Admin E2E", exact: true }).click()
    await dialogCapa.getByRole("button", { name: "Derivar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    // 3. Verificar enlace a CAPA
    await page.reload()
    await expect(filaHallazgo.getByText("Con CAPA")).toBeVisible({ timeout: 15_000 })
    await filaHallazgo.getByRole("link", { name: "Ver CAPA" }).click()

    // 4. Navegar a la CAPA y validar datos heredados de la inspección
    await expect(page).toHaveURL(/\/prevencion\/capa\/[^/?]+$/, { timeout: 30_000 })
    await expect(page.getByText("Reemplazo urgente de válvula y manómetro descalibrado.")).toBeVisible()
    await expect(page.getByText("Se retira extintor de faena y se coloca equipo de respaldo.")).toBeVisible()

    // 5. Verificar reflejo en el tablero de Prevención
    await page.goto("/prevencion")
    // El h1 real lo pone `prevention-home.tsx`; "Prevención de riesgos" es el
    // rótulo del área en el sidebar, no el título de la página.
    await expectPageTitle(page, "Inicio de Prevención")
  })
})
