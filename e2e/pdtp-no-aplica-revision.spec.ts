import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: PREV-C07 (D8) — el "No aplica" pasa por revisión.
 *
 * Antes sacaba la celda del denominador al instante y sin segundo actor. Ahora
 * nace "En revisión", no cambia el cumplimiento, y lo aprueba o rechaza otra
 * persona con `prevention:pdtp:approve` desde Aprobaciones.
 *
 * Fixture propio en la hoja `s-na-e2e`:
 *  - N°78, planificada en la semana en curso: el admin declara ahí el "No
 *    aplica" desde la vista semanal de la ficha del programa (la única que
 *    ofrece "No aplica": pide administrar el programa).
 *  - N°79, planificada en marzo y abril (semana 3) con dos "No aplica"
 *    pendientes sembrados a nombre del jefe de terreno, porque quien declara
 *    no puede revisar lo propio.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-na-e2e"
const SHEET_CODE = "s-na-e2e"
const ACTIVITY_ID = "pdtp-act-na-e2e"
const ACTIVITY_N = 78
const ACTIVITY_NAME = "Revisión de extintores E2E (no aplica)"
const REVIEW_ACTIVITY_ID = "pdtp-act-na-revision-e2e"
const REVIEW_ACTIVITY_N = 79
const now = new Date()
const CURRENT_MONTH = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", month: "numeric" }).format(now))
const CURRENT_WEEK = Math.min(4, Math.ceil(Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", day: "numeric" }).format(now)) / 7))
const DECLARANT_ID = "user-jefe-terreno-e2e"
const DEV_APPROVE = "pdtp-dev-na-aprobar-e2e"
const DEV_REJECT = "pdtp-dev-na-rechazar-e2e"

const VIEW_URL = `/prevencion/pdtp/${PROGRAM_ID}?hoja=${SHEET_CODE}&faena=${WORKSITE_ID}&vista=semana`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

test.describe.serial("PDTP — revisión del 'No aplica' (PREV-C07)", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const stamp = new Date().toISOString()
      await sql`
        insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
        values (${SHEET_ID}, ${SHEET_CODE}, ${PROGRAM_ID}, 'No aplica E2E', 'SG-SST', '[]'::jsonb, true)
        on conflict (id) do nothing
      `
      for (const [index, activity] of [
        { id: ACTIVITY_ID, n: ACTIVITY_N, name: ACTIVITY_NAME },
        { id: REVIEW_ACTIVITY_ID, n: REVIEW_ACTIVITY_N, name: "Revisión de botiquines E2E (no aplica sembrado)" },
      ].entries()) {
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
          values (${`${activity.id}-sheet`}, ${SHEET_ID}, ${SHEET_CODE}, ${activity.id}, ${index + 1}, ${index + 1})
          on conflict (id) do nothing
        `
      }
      const plan = [
        [ACTIVITY_ID, CURRENT_MONTH, CURRENT_WEEK],
        [REVIEW_ACTIVITY_ID, 3, 3],
        [REVIEW_ACTIVITY_ID, 4, 3],
      ] as const
      for (const [activityId, month, week] of plan) {
        await sql`
          insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
          values (${`${activityId}-s-2026-${month}-${week}`}, ${activityId}, 2026, ${month}, ${week}, 1, 'manual-e2e')
          on conflict (id) do nothing
        `
      }
      await sql`
        insert into pdtp_execution_deviations (id, activity_id, worksite_id, year, month, week, kind, reason, status, created_by_user_id, created_at)
        values
          (${DEV_APPROVE}, ${REVIEW_ACTIVITY_ID}, ${WORKSITE_ID}, 2026, 3, 3, 'not_applicable', 'Faena detenida por mantención mayor esa semana.', 'pending_review', ${DECLARANT_ID}, ${stamp}),
          (${DEV_REJECT}, ${REVIEW_ACTIVITY_ID}, ${WORKSITE_ID}, 2026, 4, 3, 'not_applicable', 'No hubo extintores que revisar esa semana.', 'pending_review', ${DECLARANT_ID}, ${stamp})
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      const ids = [ACTIVITY_ID, REVIEW_ACTIVITY_ID]
      await sql`delete from pdtp_execution_deviations where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_change_log where program_id = ${PROGRAM_ID} and section in ${sql([`deviation:${ACTIVITY_N}`, `deviation:${REVIEW_ACTIVITY_N}`])}`
      await sql`delete from pdtp_activity_schedule where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_sheet_activities where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_activities where id in ${sql(ids)}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
    } finally { await sql.end() }
  })

  test("declarar 'No aplica' lo deja 'En revisión' y el declarante no puede aprobarlo", async ({ page }) => {
    await login(page)
    await page.goto(VIEW_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const row = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await row.getByRole("button", { name: new RegExp(`Declarar desvío en la actividad N°${ACTIVITY_N}`) }).click()
    const dialog = page.getByRole("dialog", { name: /Declarar desvío/ })
    await dialog.getByLabel("No aplica", { exact: true }).check()
    await expect(dialog.getByText(/otra persona/)).toBeVisible()
    await dialog.getByLabel("Motivo", { exact: true }).fill("La faena no operó esa semana por paro programado.")
    await dialog.getByRole("button", { name: "Registrar desvío" }).click()
    await expect(dialog).not.toBeVisible()

    const updatedRow = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await expect(updatedRow.getByText("En revisión")).toBeVisible()
    // Sigue exigiéndose: no se volvió "No programada".
    await expect(updatedRow.getByText("Pendiente")).toBeVisible()

    await page.goto("/prevencion/pdtp/aprobaciones")
    const own = page.getByRole("listitem").filter({ hasText: "La faena no operó esa semana por paro programado." })
    await expect(own.getByText("Lo declaraste tú: lo revisa otra persona.")).toBeVisible()
    await expect(own.getByRole("button", { name: /Aprobar/ })).toHaveCount(0)
  })

  test("otra persona aprueba desde Aprobaciones y queda vigente con su revisor", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    const item = page.getByRole("listitem").filter({ hasText: "Faena detenida por mantención mayor esa semana." })
    await expect(item).toBeVisible()
    await item.getByRole("button", { name: new RegExp(`Aprobar "no aplica" de N°${REVIEW_ACTIVITY_N}`) }).click()
    await expect(page.getByRole("listitem").filter({ hasText: "Faena detenida por mantención mayor esa semana." })).toHaveCount(0)

    const sql = openDb()
    try {
      const [row] = await sql`select status, reviewed_by_user_id from pdtp_execution_deviations where id = ${DEV_APPROVE}`
      expect(row).toMatchObject({ status: "active", reviewed_by_user_id: "user-admin-e2e" })
    } finally { await sql.end() }
  })

  test("rechazar exige motivo y deja la semana exigible", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    const item = page.getByRole("listitem").filter({ hasText: "No hubo extintores que revisar esa semana." })
    await item.getByRole("button", { name: new RegExp(`Rechazar "no aplica" de N°${REVIEW_ACTIVITY_N}`) }).click()
    const dialog = page.getByRole("dialog", { name: /Rechazar "no aplica"/ })
    const confirm = dialog.getByRole("button", { name: "Rechazar", exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel("Motivo del rechazo").fill("Hubo operación normal: el registro de turnos lo confirma.")
    await confirm.click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole("listitem").filter({ hasText: "No hubo extintores que revisar esa semana." })).toHaveCount(0)

    const sql = openDb()
    try {
      const [row] = await sql`select status, review_reason from pdtp_execution_deviations where id = ${DEV_REJECT}`
      expect(row).toMatchObject({ status: "rejected", review_reason: "Hubo operación normal: el registro de turnos lo confirma." })
    } finally { await sql.end() }
  })
})
