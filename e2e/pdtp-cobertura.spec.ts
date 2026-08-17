import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Cobertura MIPER y legal (/prevencion/pdtp/cobertura).
 *
 * Antes de este spec la página solo tenía un smoke de accesibilidad (axe),
 * sin ninguna interacción. El fixture pdtp-prog-e2e tiene 2 actividades sin
 * fuente vinculada, así que el banner de advertencia y el estado "Sin
 * fuente" están garantizados al entrar.
 */
test.describe("PDTP — Cobertura MIPER y legal", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("muestra el banner de actividades sin fuente demostrable", async ({ page }) => {
    await page.goto("/prevencion/pdtp/cobertura")

    await expect(page.getByRole("status")).toContainText("sin fuente demostrable")

    const activityCard = page.locator("div.rounded-lg.border.p-4", { hasText: "Charla de seguridad E2E" })
    await expect(activityCard.getByText("Sin fuente")).toBeVisible()
  })

  test("vincular una fuente a una actividad la quita de \"sin fuente\"", async ({ page }) => {
    await page.goto("/prevencion/pdtp/cobertura")

    const activityCard = page.locator("div.rounded-lg.border.p-4", { hasText: "Charla de seguridad E2E" })
    await activityCard.getByRole("button", { name: "Vincular fuente" }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Vincular origen de la medida" })).toBeVisible()
    // La faena se elige explícitamente y no se deja en la primera de la lista:
    // las fuentes se filtran por faena, y en la suite completa otros specs crean
    // faenas que alteran ese orden — el test pasaba aislado y fallaba en conjunto.
    await dialog.getByLabel("Faena").click()
    await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
    await dialog.getByLabel("Tipo").click()
    await page.getByRole("option", { name: "Auditoría" }).click()
    // Con la auditoría sembrada, el diálogo ofrece el selector "Fuente"; el
    // campo libre "Identificador de fuente" sólo aparece cuando el tipo no
    // tiene ninguna fuente elegible en la faena.
    await dialog.getByLabel("Fuente").click()
    await page.getByRole("option", { name: /AUD-E2E-2026-0001/ }).click()
    await dialog.getByLabel("Justificación").fill("Cubre la charla de seguridad mediante la auditoría preventiva E2E.")
    await dialog.getByRole("button", { name: "Crear vínculo" }).click()

    await expect(dialog).not.toBeVisible()

    // La acción no auto-refresca la vista (se invoca desde onSubmit, no un
    // form action) — recargar confirma que el vínculo quedó persistido.
    await page.reload()
    await expect(activityCard.getByText("Sin fuente")).not.toBeVisible()
    await expect(activityCard.getByText(/Auditoría/)).toBeVisible()
  })

  // Usa el fixture legalreq-e2e/legalapp-e2e/pdtpobl-e2e (e2e/setup-db.ts):
  // un requisito legal publicado y aplicable a ws-e2e, con un reloj de
  // actualización pendiente para esa misma fuente. resolvePdtpUpdateObligation
  // exige que exista un vínculo activo con el mismo sourceType/sourceId antes
  // de dejar declarar la obligación como incorporada.
  test("vincular un requisito legal real y declarar incorporado su reloj de actualización", async ({ page }) => {
    await page.goto("/prevencion/pdtp/cobertura")

    await expect(page.getByText(/Vence|Vencido/).first()).toBeVisible()

    const activityCard = page.locator("div.rounded-lg.border.p-4", { hasText: "Inducción a trabajador nuevo E2E" })
    await activityCard.getByRole("button", { name: "Vincular fuente" }).click()

    const linkDialog = page.getByRole("dialog")
    // El diálogo por defecto muestra la primera faena en orden alfabético, no
    // necesariamente "Faena E2E" (hay más faenas fixture que RE-99-E2E). El
    // picker de "Fuente" filtra por la faena seleccionada aquí, así que hay
    // que fijarla explícitamente antes de elegir el tipo de fuente.
    await linkDialog.getByLabel("Faena").click()
    await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
    await linkDialog.getByLabel("Tipo").click()
    await page.getByRole("option", { name: "Requisito legal" }).click()
    // Con una fuente real publicada y aplicable a la faena, "Fuente" pasa de
    // Input libre a un Select con el picker de requisitos legales.
    await linkDialog.getByLabel("Fuente").click()
    await page.getByRole("option", { name: /RE-99-E2E/ }).click()
    await linkDialog.getByLabel("Justificación").fill("La inducción cubre el requisito legal RE-99-E2E vigente.")
    await linkDialog.getByRole("button", { name: "Crear vínculo" }).click()
    await expect(linkDialog).not.toBeVisible()

    await page.reload()
    await expect(activityCard.getByText(/Requisito legal/)).toBeVisible()

    const resolveButton = page.getByRole("button", { name: "Declarar incorporada" })
    await expect(resolveButton).toBeVisible()
    await resolveButton.click()

    const resolveDialog = page.getByRole("dialog", { name: "Cerrar reloj de actualización" })
    await resolveDialog.getByLabel("Resultado").fill("El requisito RE-99-E2E queda cubierto por la actividad de inducción.")
    await resolveDialog.getByRole("button", { name: "Confirmar incorporación" }).click()
    await expect(resolveDialog).not.toBeVisible()

    await page.reload()
    await expect(page.getByRole("button", { name: "Declarar incorporada" })).toHaveCount(0)
    await expect(page.getByText("No hay actualizaciones MIPER/legal pendientes de incorporar.")).toBeVisible()
  })
})
