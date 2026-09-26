import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: PREV-C06 — "¿qué actividades están atrasadas?".
 *
 * El defecto: el estado se derivaba sólo del mes en curso. Una trimestral no
 * hecha en marzo se veía después como "No programada en este período", una
 * ejecución del mes escondía los meses anteriores en cero, y el KPI
 * "Atrasadas" del tablero contaba sobre una regla y un alcance distintos a los
 * de la lista a la que enlazaba.
 *
 * ## Fixture propio
 *
 * El tablero cuenta la hoja `pdtp_general` del programa activo del año, y el
 * programa E2E (`pdtp-prog-e2e`) no la tiene. Este spec le crea una propia con
 * cuatro actividades y la borra al final (los specs corren en serie):
 *
 *  - ATR-1: planificada en marzo, sin ejecución → atrasada aunque el mes en
 *    curso no tenga plan.
 *  - ATR-2: planificada en febrero y en el mes en curso, ejecutada sólo este
 *    mes → atrasada (la ejecución de hoy no paga febrero).
 *  - ATR-3: planificada en abril con un envío pendiente → NO atrasada (D9: un
 *    envío paga el mes).
 *  - ATR-4: planificada y ejecutada en el mes en curso → al día.
 *
 * Todo está en meses ya vencidos respecto de cualquier fecha de mayo a
 * diciembre de 2026, el año del programa.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-general-atrasadas-e2e"
const YEAR = 2026
const now = new Date()
const CURRENT_MONTH = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", month: "numeric" }).format(now))
const CURRENT_WEEK = Math.min(4, Math.ceil(Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", day: "numeric" }).format(now)) / 7))

const ACTIVITIES = [
  { id: "pdtp-act-atr-1-e2e", n: 91, name: "ATR-1 Trimestral impaga de marzo" },
  { id: "pdtp-act-atr-2-e2e", n: 92, name: "ATR-2 Ejecutada este mes con deuda de febrero" },
  { id: "pdtp-act-atr-3-e2e", n: 93, name: "ATR-3 Enviada en abril y sin revisar" },
  { id: "pdtp-act-atr-4-e2e", n: 94, name: "ATR-4 Al día" },
] as const

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

test.describe.serial("PDTP — atrasadas (PREV-C06)", () => {
  test.skip(CURRENT_MONTH < 5, "el fixture necesita que marzo y abril ya hayan vencido")

  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const stamp = new Date().toISOString()
      await sql`
        insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
        values (${SHEET_ID}, 'pdtp_general', ${PROGRAM_ID}, 'General E2E atrasadas', 'SG-SST', '[]'::jsonb, true)
        on conflict (id) do nothing
      `
      for (const [index, activity] of ACTIVITIES.entries()) {
        await sql`
          insert into pdtp_activities (
            id, program_id, n, display_order, status, activity, program,
            responsible_slugs, responsible_display, schedule_mode, source_sheet_row, created_at, updated_at
          ) values (
            ${activity.id}, ${PROGRAM_ID}, ${activity.n}, ${index + 1}, 'active', ${activity.name}, 'Programa E2E',
            '[]'::jsonb, 'Prevencionista', 'scheduled', ${activity.n}, ${stamp}, ${stamp}
          ) on conflict (id) do nothing
        `
        await sql`
          insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
          values (${`${activity.id}-general`}, ${SHEET_ID}, 'pdtp_general', ${activity.id}, ${index + 1}, ${index + 1})
          on conflict (id) do nothing
        `
      }
      const plan = [
        [ACTIVITIES[0].id, 3, 2],
        [ACTIVITIES[1].id, 2, 1],
        [ACTIVITIES[1].id, CURRENT_MONTH, CURRENT_WEEK],
        [ACTIVITIES[2].id, 4, 1],
        [ACTIVITIES[3].id, CURRENT_MONTH, CURRENT_WEEK],
      ] as const
      for (const [activityId, month, week] of plan) {
        await sql`
          insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
          values (${`${activityId}-s-${YEAR}-${month}-${week}`}, ${activityId}, ${YEAR}, ${month}, ${week}, 1, 'manual-e2e')
          on conflict (id) do nothing
        `
      }
      const executions = [
        [ACTIVITIES[1].id, CURRENT_MONTH, CURRENT_WEEK, "approved"],
        [ACTIVITIES[2].id, 4, 1, "submitted"],
        [ACTIVITIES[3].id, CURRENT_MONTH, CURRENT_WEEK, "approved"],
      ] as const
      for (const [activityId, month, week, status] of executions) {
        await sql`
          insert into pdtp_executions (id, activity_id, worksite_id, year, month, week, executed_quantity, status, evidence_text, created_at, updated_at)
          values (${`${activityId}-e-${month}-${week}`}, ${activityId}, ${WORKSITE_ID}, ${YEAR}, ${month}, ${week}, 1, ${status}, 'Acta E2E', ${stamp}, ${stamp})
          on conflict (id) do nothing
        `
      }
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      const ids = ACTIVITIES.map((activity) => activity.id)
      await sql`delete from pdtp_executions where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_activity_schedule where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_sheet_activities where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_activities where id in ${sql(ids)}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
    } finally { await sql.end() }
  })

  test("el KPI 'Atrasadas' coincide con el largo de la lista a la que enlaza", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp?anio=${YEAR}&faena=${WORKSITE_ID}`)

    const tile = page.getByRole("link").filter({ has: page.locator("[data-kpi-card]", { hasText: "Atrasadas" }) })
    await expect(tile).toBeVisible()
    await expect(tile.locator("p.font-mono")).toHaveText("2")

    await tile.click()
    await expect(page).toHaveURL(/estado=overdue/)
    await expect(page).toHaveURL(/vista=semana/)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const rows = page.getByRole("row").filter({ hasText: /ATR-\d/ })
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: "ATR-1" })).toHaveCount(1)
    await expect(rows.filter({ hasText: "ATR-2" })).toHaveCount(1)
    // ATR-1 no tiene plan este mes y aun así dice cuánto debe.
    await expect(rows.filter({ hasText: "ATR-1" }).getByText(/Atrasado · 1 mes/)).toBeVisible()
  })

  test("sin filtro, la vista semanal muestra lo atrasado junto a lo de esta semana", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&vista=semana&anio=${YEAR}`)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const rows = page.getByRole("row").filter({ hasText: /ATR-\d/ })
    await expect(rows.filter({ hasText: "ATR-1" })).toHaveCount(1)
    await expect(rows.filter({ hasText: "ATR-4" })).toHaveCount(1)
    // D9: el envío de abril paga el mes; sin plan esta semana, no aparece.
    await expect(rows.filter({ hasText: "ATR-3" })).toHaveCount(0)
    await expect(rows.filter({ hasText: "ATR-4" }).getByText("Ejecutado")).toBeVisible()
  })

  test("'Registrar' de una atrasada abre en su primera celda vencida", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&vista=semana&anio=${YEAR}&estado=overdue`)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const row = page.getByRole("row").filter({ hasText: "ATR-1" })
    await row.getByRole("button", { name: "Registrar", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("combobox", { name: "Mes" })).toHaveText(/Mar/)
    await expect(dialog.getByRole("combobox", { name: "Semana" })).toHaveText(/2/)
  })
})
