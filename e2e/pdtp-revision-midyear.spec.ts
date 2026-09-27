import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login, textoVisible } from "./helpers"

/**
 * E2E: revisión v+1 a mitad de año (tanda T6, PREV-C05).
 *
 * Una v2 activada en julio no parte el año:
 *  1. la ficha de la v1 reemplazada lo dice y sigue admitiendo el registro
 *     tardío de marzo (D24), pero no una semana que ya es de la v2;
 *  2. otra persona aprueba ese registro y la v1 cierra marzo;
 *  3. el tablero del año muestra el cumplimiento consolidado de las dos
 *     versiones, rotulado.
 *
 * ## Fixture propio
 *
 * `pdtp_programs` sólo admite años desde 2024 y un único programa activo por
 * año, y todos los años pasados ya tienen el suyo en el fixture general: 2024
 * (lo cierra pdtp-cierre-anual) y 2025 (lo lee pdtp-transicion-anual, que corre
 * después de este archivo). Por eso el recorrido se monta sobre 2025: el
 * programa del fixture (v1, sin actividades) pasa a `closed` mientras dura el
 * spec y se le encadenan dos revisiones propias con la faena E2E: la v2,
 * reemplazada desde el 3 de julio, y la v3 activa, cada una con la misma
 * actividad planificada en marzo y septiembre (semana 2). La v3 trae
 * septiembre ya aprobado. Al final se borran las revisiones y el programa del
 * fixture vuelve a `active`, tal como lo espera pdtp-transicion-anual.
 *
 * En este archivo "v1" y "v2" nombran las dos revisiones propias; en pantalla
 * son la v2 y la v3.
 */

const YEAR = 2025
const WORKSITE_ID = "ws-e2e"
/** El programa 2025 del fixture general (e2e/setup-db.ts), versión 1. */
const FIXTURE_2025 = "pdtp-2025-e2e"
const V1 = "pdtp-2025-v2-revision-e2e"
const V2 = "pdtp-2025-v3-revision-e2e"
const ACTIVITY_NAME = "Charla mensual de revisión E2E"
const AUTHOR = "jt@e2e.chome.cl"
const REASON = "Marzo conciliado con la jefatura de faena tras el registro tardío."
// PREV-I03: sin asignación, registra el rol responsable de la actividad.
const CATALOG_SLUG = "jt-revision-e2e"

const v1Activity = `${V1}-a-001`
const v2Activity = `${V2}-a-001`
const weeklyUrl = (programId: string, month: number) =>
  `/prevencion/pdtp/actividades?programa=${programId}&faena=${WORKSITE_ID}&hoja=pdtp_general&vista=semana&mes=${month}&semana=2&anio=${YEAR}`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

function pdf(label: string) {
  return { name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`) }
}

async function cleanup(sql: postgres.Sql) {
  const programs = [V1, V2]
  await sql`delete from audit_log where entity_type = 'pdtp:execution' and entity_id in (select id from pdtp_executions where activity_id in (${v1Activity}, ${v2Activity}))`
  await sql`delete from audit_log where entity_type = 'pdtp_period_closure' and entity_id in (select id from pdtp_period_closures where program_id in ${sql(programs)})`
  await sql`delete from pdtp_period_closures where program_id in ${sql(programs)}`
  await sql`delete from pdtp_executions where activity_id in (${v1Activity}, ${v2Activity})`
  await sql`delete from pdtp_change_log where program_id in ${sql(programs)}`
  await sql`delete from pdtp_activity_schedule where activity_id in (${v1Activity}, ${v2Activity})`
  await sql`delete from pdtp_sheet_activities where activity_id in (${v1Activity}, ${v2Activity})`
  await sql`delete from pdtp_activities where program_id in ${sql(programs)}`
  await sql`delete from pdtp_sheets where program_id in ${sql(programs)}`
  await sql`delete from pdtp_program_worksites where program_id in ${sql(programs)}`
  await sql`update pdtp_programs set source_program_id = null where id in ${sql(programs)}`
  await sql`delete from pdtp_programs where id in ${sql(programs)}`
  await sql`update pdtp_programs set status = 'active' where id = ${FIXTURE_2025}`
  await sql`delete from pdtp_responsible_catalog where slug = ${CATALOG_SLUG}`
}

async function v1Execution(month: number) {
  const sql = openDb()
  try {
    const [row] = await sql<Array<{ id: string; status: string }>>`
      select id, status from pdtp_executions
      where activity_id = ${v1Activity} and worksite_id = ${WORKSITE_ID} and year = ${YEAR} and month = ${month} and origin = 'manual'
    `
    return row
  } finally { await sql.end() }
}

async function registerOn(page: import("@playwright/test").Page, programId: string, month: number, file: ReturnType<typeof pdf>) {
  await page.goto(weeklyUrl(programId, month))
  await page.waitForLoadState("networkidle").catch(() => undefined)
  const row = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
  await row.getByRole("button", { name: "Registrar" }).click()
  const dialog = page.getByRole("dialog", { name: "Registrar ejecución" })
  await dialog.getByLabel("Cantidad").fill("1")
  await dialog.locator("#exec-file").setInputFiles(file)
  await dialog.getByRole("button", { name: "Guardar ejecución" }).click()
  return dialog
}

test.describe.serial("PDTP — revisión v+1 a mitad de año (PREV-C05)", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      await cleanup(sql)
      const now = new Date().toISOString()
      await sql`
        insert into pdtp_responsible_catalog (slug, display_name, role_name, kind, is_active)
        values (${CATALOG_SLUG}, 'Jefe de terreno Revisión E2E', 'jefe_terreno', 'rbac_role', true)
        on conflict (slug) do nothing
      `
      await sql`update pdtp_programs set status = 'closed' where id = ${FIXTURE_2025}`
      for (const [id, version, status, activatedAt] of [
        [V1, 2, "closed", `${YEAR}-01-06T12:00:00.000Z`],
        [V2, 3, "active", `${YEAR}-07-03T15:00:00.000Z`],
      ] as const) {
        await sql`
          insert into pdtp_programs (
            id, year, version, status, applies_to_all_worksites, title, period_start, period_end,
            elaborated_by_user_id, elaborated_by_name, elaborated_by_title, activated_at,
            source_program_id, created_at, updated_at
          ) values (
            ${id}, ${YEAR}, ${version}, ${status}, false, ${`Programa PDTP ${YEAR} E2E v${version}`}, ${`${YEAR}-01-01`}, ${`${YEAR}-12-31`},
            'user-admin-e2e', 'Admin E2E', 'Prevencionista', ${activatedAt},
            ${version === 3 ? V1 : FIXTURE_2025}, ${now}, ${now}
          )
        `
        await sql`
          insert into pdtp_program_worksites (id, program_id, worksite_id, is_active, added_by_user_id, added_at)
          values (${`${id}-ws`}, ${id}, ${WORKSITE_ID}, true, 'user-admin-e2e', ${`${YEAR}-01-01T12:00:00.000Z`})
        `
        await sql`
          insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
          values (${`${id}-sheet`}, 'pdtp_general', ${id}, 'Programa general', 'SG-SST', '[]'::jsonb, true)
        `
        const activityId = `${id}-a-001`
        await sql`
          insert into pdtp_activities (
            id, program_id, n, display_order, status, activity, program,
            responsible_slugs, responsible_display, schedule_mode, source_sheet_row, created_at, updated_at
          ) values (
            ${activityId}, ${id}, 1, 1, 'active', ${ACTIVITY_NAME}, 'Programa E2E',
            ${sql.json([CATALOG_SLUG])}, 'Jefe de terreno', 'scheduled', 1, ${now}, ${now}
          )
        `
        await sql`
          insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
          values (${`${activityId}-sheet`}, ${`${id}-sheet`}, 'pdtp_general', ${activityId}, 1, 1)
        `
        for (const month of [3, 9]) {
          await sql`
            insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
            values (${`${activityId}-s-${month}`}, ${activityId}, ${YEAR}, ${month}, 2, 1, 'manual-e2e')
          `
        }
      }
      await sql`
        insert into pdtp_executions (id, activity_id, worksite_id, year, month, week, executed_quantity, status, evidence_text, created_at, updated_at)
        values (${`${v2Activity}-e-9`}, ${v2Activity}, ${WORKSITE_ID}, ${YEAR}, 9, 2, 1, 'approved', 'Acta E2E', ${now}, ${now})
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try { await cleanup(sql) } finally { await sql.end() }
  })

  test("la ficha de la v1 dice que fue reemplazada y admite el registro tardío de marzo", async ({ page }) => {
    await login(page, AUTHOR)
    await page.goto(`/prevencion/pdtp/${V1}?faena=${WORKSITE_ID}`)
    await expect(textoVisible(page, "Versión reemplazada por v3")).toBeVisible()

    const dialog = await registerOn(page, V1, 3, pdf("acta-marzo-tardia"))
    await expect(dialog).not.toBeVisible()
    await expect.poll(async () => (await v1Execution(3))?.status).toBe("submitted")
  })

  test("la v1 no ofrece registrar una semana que ya es de la v2", async ({ page }) => {
    // El servicio lo rechaza igual ("ese período ya es de la versión v3…",
    // pdtp-revision-windows.test.ts); acá se verifica que la planilla de la v1
    // ni siquiera lo ofrece: septiembre ya no es trabajo de esa versión.
    await login(page, AUTHOR)
    await page.goto(weeklyUrl(V1, 9))
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("row").filter({ hasText: ACTIVITY_NAME }).getByRole("button", { name: "Registrar" })).toHaveCount(0)
    expect(await v1Execution(9)).toBeUndefined()
  })

  test("otra persona aprueba el registro tardío y la v1 cierra marzo", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp/aprobaciones?programId=${V1}`)
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await page.getByRole("button", { name: "Aprobar ejecución Mar semana 2" }).click()
    await expect(page.locator("[data-sonner-toast]").getByText(/aprobada/)).toBeVisible()
    await expect.poll(async () => (await v1Execution(3))?.status).toBe("approved")

    await page.goto(`/prevencion/pdtp/${V1}?faena=${WORKSITE_ID}`)
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await page.getByRole("button", { name: "Cerrar mes" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Cerrar el mes de esta faena" })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Mes que se cierra").click()
    await page.getByRole("option", { name: "Mar" }).click()
    await dialog.getByLabel("Fundamento del cierre").fill(REASON)
    await dialog.getByLabel(/Avisar por correo/).uncheck()
    await dialog.getByRole("button", { name: "Cerrar mes", exact: true }).click()
    await expect(dialog).not.toBeVisible({ timeout: 30_000 })

    const sql = openDb()
    try {
      const [closure] = await sql<Array<{ status: string }>>`
        select status from pdtp_period_closures where program_id = ${V1} and worksite_id = ${WORKSITE_ID} and year = ${YEAR} and month = 3
      `
      expect(closure?.status).toBe("closed")
    } finally { await sql.end() }
  })

  test("el tablero del año consolida las dos versiones y lo rotula", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp?anio=${YEAR}&faena=${WORKSITE_ID}`)
    await expect(page.getByTestId("pdtp-year-versions")).toContainText(/v2 .*\+ v3/)
    // Marzo (v1, aprobado tarde) + septiembre (v2): las dos cuentan en el año.
    const executed = page.getByRole("link").filter({ hasText: "Ejecutadas" })
    await expect(executed).toContainText("2")
  })
})
