import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

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

  // PRV-05 (auditoría 2026-09-28): cancelar saca la obligación del indicador de
  // plazos, así que se pide y la aprueba otra persona.
  async function abrirCaso(page: import("@playwright/test").Page, caseId: string) {
    await page.goto("/prevencion/pdtp/obligaciones")
    await page.getByRole("button", { name: "Registrar necesidad o evento" }).click()
    const createDialog = page.getByRole("dialog", { name: "Registrar una necesidad o evento" })
    await createDialog.getByRole("combobox").nth(1).click()
    await page.getByRole("option", { name: "Faena E2E" }).click()
    await createDialog.getByPlaceholder("Ej.: incidente").fill("induccion")
    await createDialog.getByPlaceholder("Código o ID del caso").fill(caseId)
    await createDialog.locator("textarea").fill(`Ingresó otro trabajador nuevo, se abre el caso ${caseId}.`)
    await createDialog.getByRole("button", { name: "Abrir obligación" }).click()
    await expect(createDialog).not.toBeVisible()
    return page.getByRole("article").filter({ hasText: caseId })
  }

  test("pedir la cancelación la deja en revisión, sin cancelarla", async ({ page }) => {
    const caseArticle = await abrirCaso(page, "caso-cancel-e2e")
    await caseArticle.getByRole("button", { name: "Cancelar" }).click()
    const cancelDialog = page.getByRole("dialog", { name: "Pedir cancelación" })
    await expect(cancelDialog.getByText(/la aprueba otra persona/)).toBeVisible()
    await cancelDialog.locator("textarea").fill("Se registró por error, no corresponde a un caso real E2E.")
    await cancelDialog.getByRole("button", { name: "Pedir cancelación" }).click()
    await expect(cancelDialog).not.toBeVisible()

    // Sigue exigiéndose: todavía se puede reportar y el botón cede su lugar al aviso.
    await expect(caseArticle.getByText("Cancelación en revisión")).toBeVisible()
    await expect(caseArticle.getByRole("button", { name: "Cancelar" })).toHaveCount(0)
    await expect(caseArticle.getByRole("button", { name: "Reportar trabajo" })).toBeVisible()

    await page.goto("/prevencion/pdtp/aprobaciones")
    const own = page.getByRole("listitem").filter({ hasText: "Se registró por error, no corresponde a un caso real E2E." })
    await expect(own.getByText("La pediste tú: la revisa otra persona.")).toBeVisible()
    await expect(own.getByRole("button", { name: /Aprobar/ })).toHaveCount(0)
  })

  test("otra persona aprueba la cancelación desde Aprobaciones", async ({ page }) => {
    const caseArticle = await abrirCaso(page, "caso-cancel-ajena-e2e")
    await expect(caseArticle).toBeVisible()

    const sql = openDb()
    const reason = "La pidió el jefe de terreno: el caso quedó duplicado."
    try {
      const [obligation] = await sql`select id, program_id, worksite_id from pdtp_obligations where source_id = 'caso-cancel-ajena-e2e'`
      await sql`insert into pdtp_review_requests (id, kind, target_id, program_id, worksite_id, reason, status, requested_by_user_id, requested_at)
        values (${"rr-e2e-cancel"}, 'obligation_cancellation', ${obligation!.id}, ${obligation!.program_id}, ${obligation!.worksite_id}, ${reason}, 'pending_review', 'user-jefe-terreno-e2e', now())`
    } finally { await sql.end() }

    await page.goto("/prevencion/pdtp/aprobaciones")
    const item = page.getByRole("listitem").filter({ hasText: reason })
    await item.getByRole("button", { name: /Aprobar cancelación/ }).click()
    await expect(page.getByRole("listitem").filter({ hasText: reason })).toHaveCount(0)

    const check = openDb()
    try {
      const [row] = await check`select status, cancelled_by_user_id from pdtp_obligations where source_id = 'caso-cancel-ajena-e2e'`
      expect(row).toMatchObject({ status: "cancelled", cancelled_by_user_id: "user-admin-e2e" })
    } finally { await check.end() }
  })
})
