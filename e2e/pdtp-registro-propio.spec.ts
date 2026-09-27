import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * PREV-I03 (resto), auditoría 2026-09-26: sin asignación nominal, cualquiera
 * con `prevention:pdtp:execute` en la faena registraba cualquier actividad. La
 * frontera es el servidor (`registration-authority.ts`, probado en
 * `lib/__tests__/pdtp-registration-authority.test.ts`); acá se verifica que la
 * planilla sólo le ofrece "Registrar" a cada persona en lo suyo:
 *
 * - el jefe de terreno ve el botón en la actividad de su cargo y no en la de
 *   la prevencionista de faena;
 * - el administrador (Prevención/administración) lo ve en las dos.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-registro-propio-e2e"
const SHEET_CODE = "s-registro-propio"
const MONTH = 6
const WEEK = 3
const JT = "jt@e2e.chome.cl"
const OWN = { id: "pdtp-act-propia-e2e", n: 871, name: "Charla del jefe de terreno E2E", slug: "jt-registro-propio-e2e", display: "Jefe de terreno Registro E2E", role: "jefe_terreno" }
const FOREIGN = { id: "pdtp-act-ajena-e2e", n: 872, name: "Inspección de la prevencionista E2E", slug: "prf-registro-propio-e2e", display: "Prevencionista Registro E2E", role: "prevencionista_faena" }

const WEEKLY_URL = `/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&hoja=${SHEET_CODE}&vista=semana&mes=${MONTH}&semana=${WEEK}`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

async function cleanup(sql: postgres.Sql) {
  const ids = [OWN.id, FOREIGN.id]
  await sql`delete from pdtp_activity_schedule where activity_id in ${sql(ids)}`
  await sql`delete from pdtp_sheet_activities where activity_id in ${sql(ids)}`
  await sql`delete from pdtp_activities where id in ${sql(ids)}`
  await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
  await sql`delete from pdtp_responsible_catalog where slug in ${sql([OWN.slug, FOREIGN.slug])}`
}

async function registerButton(page: import("@playwright/test").Page, activityName: string) {
  return page.getByRole("row").filter({ hasText: activityName }).getByRole("button", { name: "Registrar", exact: true })
}

test.describe.serial("PDTP — cada quien registra lo suyo (PREV-I03)", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      await cleanup(sql)
      const now = new Date().toISOString()
      await sql`
        insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
        values (${SHEET_ID}, ${SHEET_CODE}, ${PROGRAM_ID}, 'Registro propio E2E', 'SG-SST', '[]'::jsonb, true)
      `
      for (const [index, activity] of [OWN, FOREIGN].entries()) {
        await sql`
          insert into pdtp_responsible_catalog (slug, display_name, role_name, kind, is_active)
          values (${activity.slug}, ${activity.display}, ${activity.role}, 'rbac_role', true)
        `
        await sql`
          insert into pdtp_activities (
            id, program_id, n, display_order, status, activity, program,
            responsible_slugs, responsible_display, schedule_mode, source_sheet_row,
            created_at, updated_at
          ) values (
            ${activity.id}, ${PROGRAM_ID}, ${activity.n}, ${index + 1}, 'active', ${activity.name}, 'Programa E2E',
            ${sql.json([activity.slug])}, ${activity.display}, 'scheduled', ${activity.n}, ${now}, ${now}
          )
        `
        await sql`
          insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
          values (${`${activity.id}-sheet`}, ${SHEET_ID}, ${SHEET_CODE}, ${activity.id}, ${index + 1}, ${index + 1})
        `
        await sql`
          insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
          values (${`${activity.id}-sched`}, ${activity.id}, 2026, ${MONTH}, ${WEEK}, 1, 'manual-e2e')
        `
      }
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try { await cleanup(sql) } finally { await sql.end() }
  })

  test("el jefe de terreno sólo ve 'Registrar' en la actividad de su cargo", async ({ page }) => {
    await login(page, JT)
    await page.goto(WEEKLY_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("row").filter({ hasText: FOREIGN.name })).toBeVisible()
    await expect(await registerButton(page, OWN.name)).toHaveCount(1)
    await expect(await registerButton(page, FOREIGN.name)).toHaveCount(0)
  })

  test("Prevención/administración ve 'Registrar' en las dos", async ({ page }) => {
    await login(page)
    await page.goto(WEEKLY_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(await registerButton(page, OWN.name)).toHaveCount(1)
    await expect(await registerButton(page, FOREIGN.name)).toHaveCount(1)
  })
})
