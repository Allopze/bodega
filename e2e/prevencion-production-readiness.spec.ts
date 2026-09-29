import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E de la auditoría de production readiness de Prevención (2026-09-28).
 *
 * Cubre en navegador lo que las pruebas de servicio no ven:
 *
 *  - PRV-15: el canal público `/reportar-incidente` abre sin sesión.
 *  - M-02: una mutación a `/api` con un `Origin` ajeno se rechaza en el proxy.
 *  - PRV-20: el tile "Ejecutadas" dice cuántas esperan aprobación y lleva a
 *    Aprobaciones.
 *  - PRV-02: una ejecución de integración sin evidencia verificada sólo se
 *    aprueba con motivo, y el motivo queda guardado.
 *
 * ## Fixture propio
 *
 * Actividad N°95, exclusiva de este archivo (`pdtp_activities` es único por
 * programa y número). Julio, semana 1, ya ocurrió: PRV-03 rechaza lo futuro.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const ACTIVITY_ID = "pdtp-act-readiness-e2e"
const ACTIVITY_N = 95
const ACTIVITY_NAME = "Coordinación con mandante E2E (readiness)"
const EXECUTION_ID = "pdtp-exec-readiness-e2e"
const MONTH = 7
const WEEK = 1
const APPROVAL_REASON = "Revisé el acta de coordinación en el módulo de origen E2E"

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

async function executionRow() {
  const sql = openDb()
  try {
    const [row] = await sql<Array<{ status: string; source_metadata_json: Record<string, unknown> }>>`
      select status, source_metadata_json from pdtp_executions where id = ${EXECUTION_ID}
    `
    return row
  } finally { await sql.end() }
}

test.describe("Prevención — canal público y origen de las mutaciones", () => {
  test("/reportar-incidente abre sin sesión (PRV-15)", async ({ page }) => {
    const response = await page.goto("/reportar-incidente")
    expect(response?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/reportar-incidente/)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test("una mutación a /api desde otro origen se rechaza (M-02)", async ({ page }) => {
    await login(page)
    const crossOrigin = await page.request.post("/api/prevencion/pdtp/evidence", {
      headers: { Origin: "https://evil.example" },
      multipart: { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID },
    })
    expect(crossOrigin.status()).toBe(403)
    expect(await crossOrigin.json()).toMatchObject({ error: "Origen no permitido" })

    // El mismo pedido sin Origin ajeno llega al handler (que responde por su
    // propia validación, no por el origen).
    const sameOrigin = await page.request.post("/api/prevencion/pdtp/evidence", {
      multipart: { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID },
    })
    expect(sameOrigin.status()).not.toBe(403)
  })
})

test.describe.serial("PDTP — aprobación de una integración sin evidencia verificada", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const now = new Date().toISOString()
      await sql`
        insert into pdtp_activities (
          id, program_id, n, display_order, status, activity, program,
          responsible_slugs, responsible_display, schedule_mode, source_sheet_row,
          created_at, updated_at
        )
        values (
          ${ACTIVITY_ID}, ${PROGRAM_ID}, ${ACTIVITY_N}, 1, 'active', ${ACTIVITY_NAME}, 'Programa E2E',
          ${sql.json([])}, 'Prevención', 'scheduled', ${ACTIVITY_N}, ${now}, ${now}
        )
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
        values ('pdtp-sched-readiness-e2e', ${ACTIVITY_ID}, 2026, ${MONTH}, ${WEEK}, 1, 'manual-e2e')
        on conflict (id) do nothing
      `
      // Llegó de otro módulo y su evidencia no se pudo verificar (PRV-01): queda
      // `submitted` con `evidence_status = pending`.
      await sql`
        insert into pdtp_executions (
          id, activity_id, worksite_id, year, month, week, executed_quantity, status,
          evidence_photos, origin, evidence_status, source_metadata_json, created_at, updated_at
        )
        values (
          ${EXECUTION_ID}, ${ACTIVITY_ID}, ${WORKSITE_ID}, 2026, ${MONTH}, ${WEEK}, 1, 'submitted',
          ${sql.json([])}, 'integration', 'pending', ${sql.json({ evidenceRejection: "missing" })}, ${now}, ${now}
        )
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      await sql`delete from audit_log where entity_type = 'pdtp:execution' and entity_id = ${EXECUTION_ID}`
      await sql`delete from pdtp_change_log where section = ${`execution:${EXECUTION_ID}`}`
      await sql`delete from pdtp_executions where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activity_schedule where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activities where id = ${ACTIVITY_ID}`
    } finally { await sql.end() }
  })

  test("el tile Ejecutadas avisa lo que espera aprobación y lleva a Aprobaciones (PRV-20)", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp?anio=2026&faena=${WORKSITE_ID}`)
    const link = page.getByRole("link", { name: /por aprobar →/ })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", "/prevencion/pdtp/aprobaciones")
    await link.click()
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/aprobaciones/)
  })

  test("aprobarla exige un motivo, que queda guardado (PRV-02)", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    // Otro spec puede tener pendiente la misma semana: se busca en la fila de esta actividad.
    await page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
      .getByRole("button", { name: `Aprobar ejecución Jul semana ${WEEK}`, exact: true }).click()

    const dialog = page.getByRole("dialog", { name: "Aprobar sin evidencia verificada" })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole("button", { name: "Aprobar con motivo" })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel("Motivo de la aprobación").fill(APPROVAL_REASON)
    await confirm.click()

    await expect.poll(async () => (await executionRow())?.status).toBe("approved")
    expect((await executionRow())?.source_metadata_json).toMatchObject({ approvalReason: APPROVAL_REASON })
  })
})
