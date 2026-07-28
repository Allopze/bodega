import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Trabajo por necesidad y eventos (/prevencion/pdtp/obligaciones).
 *
 * Antes de este spec la página solo tenía un smoke de accesibilidad. Sin la
 * actividad "por evento" confirmada (pdtp-act-event-e2e, ver e2e/setup-db.ts)
 * el botón "Registrar necesidad o evento" queda siempre deshabilitado, así
 * que este spec depende de ese fixture.
 *
 * Los diálogos de este workbench no asocian <label> con el control (Field
 * sin htmlFor), así que los selects/inputs se ubican por posición y
 * placeholder dentro del diálogo en vez de getByLabel.
 */
test.describe("PDTP — Trabajo por necesidad y eventos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("registrar un caso y reportar el trabajo realizado", async ({ page }) => {
    await page.goto("/prevencion/pdtp/obligaciones")

    const registerButton = page.getByRole("button", { name: "Registrar necesidad o evento" })
    await expect(registerButton).toBeEnabled()
    await registerButton.click()

    const createDialog = page.getByRole("dialog", { name: "Registrar una necesidad o evento" })
    await createDialog.getByRole("combobox").nth(1).click() // Faena (Actividad ya viene preseleccionada, es la única)
    await page.getByRole("option", { name: "Faena E2E" }).click()
    await createDialog.getByPlaceholder("Ej.: incidente").fill("induccion")
    await createDialog.getByPlaceholder("Código o ID del caso").fill("caso-report-e2e")
    await createDialog.locator("textarea").fill("Ingresó un trabajador nuevo a la faena, se abre el caso E2E.")
    await createDialog.getByRole("button", { name: "Abrir obligación" }).click()
    await expect(createDialog).not.toBeVisible()

    const caseArticle = page.getByRole("article").filter({ hasText: "caso-report-e2e" })
    await expect(caseArticle).toBeVisible()
    await expect(caseArticle.getByRole("button", { name: "Reportar trabajo" })).toBeVisible()

    await caseArticle.getByRole("button", { name: "Reportar trabajo" }).click()
    const reportDialog = page.getByRole("dialog", { name: "Reportar trabajo realizado" })
    await reportDialog.locator("textarea").fill("Inducción realizada y registro de firma adjunto en expediente físico.")
    await reportDialog.getByRole("button", { name: "Enviar a aprobación" }).click()
    await expect(reportDialog).not.toBeVisible()

    await expect(caseArticle.getByRole("button", { name: "Reportar trabajo" })).toHaveCount(0)
    await expect(caseArticle.getByRole("button", { name: "Ir a aprobación" })).toBeVisible()
  })

  test("registrar un caso y cancelarlo con motivo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/obligaciones")

    await page.getByRole("button", { name: "Registrar necesidad o evento" }).click()
    const createDialog = page.getByRole("dialog", { name: "Registrar una necesidad o evento" })
    await createDialog.getByRole("combobox").nth(1).click()
    await page.getByRole("option", { name: "Faena E2E" }).click()
    await createDialog.getByPlaceholder("Ej.: incidente").fill("induccion")
    await createDialog.getByPlaceholder("Código o ID del caso").fill("caso-cancel-e2e")
    await createDialog.locator("textarea").fill("Ingresó otro trabajador nuevo, se abre un segundo caso E2E para cancelar.")
    await createDialog.getByRole("button", { name: "Abrir obligación" }).click()
    await expect(createDialog).not.toBeVisible()

    const caseArticle = page.getByRole("article").filter({ hasText: "caso-cancel-e2e" })
    await expect(caseArticle.getByRole("button", { name: "Cancelar" })).toBeVisible()

    await caseArticle.getByRole("button", { name: "Cancelar" }).click()
    const cancelDialog = page.getByRole("dialog", { name: "Cancelar obligación" })
    await cancelDialog.locator("textarea").fill("Se registró por error, no corresponde a un caso real E2E.")
    await cancelDialog.getByRole("button", { name: "Confirmar cancelación" }).click()
    await expect(cancelDialog).not.toBeVisible()

    await expect(caseArticle.getByRole("button", { name: "Cancelar" })).toHaveCount(0)
    await expect(caseArticle.getByRole("button", { name: "Reportar trabajo" })).toHaveCount(0)
  })
})
