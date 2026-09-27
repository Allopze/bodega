import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: PREV-C07 sobre ocurrencias programadas (migración 0334).
 *
 * El "no aplica" y la cancelación de una ocurrencia ya no la sacan del
 * denominador en el acto: quedan como solicitud en revisión y aparecen en la
 * sección "No aplica por revisar" de Aprobaciones, junto a los de celda.
 *
 * Fixture propio (actividad N°81 del programa E2E, con tres ocurrencias en
 * meses que ninguna otra prueba cierra):
 *  - un "no aplica" y una cancelación pedidos por el jefe de terreno (el
 *    admin, que es quien corre la prueba, puede revisarlos);
 *  - un "no aplica" pedido por el propio admin: no lo revisa, lo retira.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const ACTIVITY_ID = "pdtp-act-ocurrencia-na-e2e"
const ACTIVITY_N = 81
const DECLARANT_ID = "user-jefe-terreno-e2e"
const ADMIN_ID = "user-admin-e2e"
const INSTANCES = [
  { id: "pdtp-inst-na-e2e-feb", date: "2026-02-09", isoWeek: 7 },
  { id: "pdtp-inst-na-e2e-jun", date: "2026-06-08", isoWeek: 24 },
  { id: "pdtp-inst-na-e2e-jul", date: "2026-07-06", isoWeek: 28 },
] as const
const REQ_APPROVE = "pdtp-sor-e2e-aprobar"
const REQ_REJECT = "pdtp-sor-e2e-rechazar"
const REQ_OWN = "pdtp-sor-e2e-propia"
const REASON_APPROVE = "Faena detenida toda la semana por mantención mayor (E2E)."
const REASON_REJECT = "Ocurrencia duplicada con la del mes siguiente (E2E)."
const REASON_OWN = "La faena no operó esa semana por paro programado (E2E)."

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

test.describe.serial("PDTP — revisión del 'no aplica' y la cancelación de ocurrencias (PREV-C07, 0334)", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const stamp = new Date().toISOString()
      await sql`
        insert into pdtp_activities (
          id, program_id, n, display_order, status, activity, program,
          responsible_slugs, responsible_display, schedule_mode, source_sheet_row, created_at, updated_at
        ) values (
          ${ACTIVITY_ID}, ${PROGRAM_ID}, ${ACTIVITY_N}, ${ACTIVITY_N}, 'active', 'Inspección programada E2E (ocurrencias)', 'Programa E2E',
          '[]'::jsonb, 'Prevencionista', 'scheduled', ${ACTIVITY_N}, ${stamp}, ${stamp}
        ) on conflict (id) do nothing
      `
      for (const instance of INSTANCES) {
        await sql`
          insert into pdtp_scheduled_instances (
            id, program_id, activity_id, worksite_id, scheduled_for, iso_week_year, iso_week,
            planned_quantity, status, idempotency_key, source_metadata_json, created_at, updated_at
          ) values (
            ${instance.id}, ${PROGRAM_ID}, ${ACTIVITY_ID}, ${WORKSITE_ID}, ${instance.date}, 2026, ${instance.isoWeek},
            1, 'pending', ${`e2e:${instance.id}`}, '{}'::jsonb, ${stamp}, ${stamp}
          ) on conflict (id) do nothing
        `
      }
      await sql`
        insert into pdtp_scheduled_instance_outcome_requests (id, instance_id, outcome, reason, status, requested_by_user_id, requested_at)
        values
          (${REQ_APPROVE}, ${INSTANCES[0].id}, 'not_applicable', ${REASON_APPROVE}, 'pending_review', ${DECLARANT_ID}, ${stamp}),
          (${REQ_REJECT}, ${INSTANCES[1].id}, 'cancelled', ${REASON_REJECT}, 'pending_review', ${DECLARANT_ID}, ${stamp}),
          (${REQ_OWN}, ${INSTANCES[2].id}, 'not_applicable', ${REASON_OWN}, 'pending_review', ${ADMIN_ID}, ${stamp})
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      // Las solicitudes se van por cascada con sus ocurrencias.
      await sql`delete from pdtp_scheduled_instances where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_change_log where program_id = ${PROGRAM_ID} and section = ${`scheduled_instance:${ACTIVITY_N}`}`
      await sql`delete from pdtp_activities where id = ${ACTIVITY_ID}`
    } finally { await sql.end() }
  })

  test("otra persona aprueba el 'no aplica' de una ocurrencia y recién ahí cambia su estado", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    const item = page.getByRole("listitem").filter({ hasText: REASON_APPROVE })
    await expect(item.getByText(/Ocurrencia del 09-02-2026/)).toBeVisible()
    await item.getByRole("button", { name: new RegExp(`Aprobar "no aplica" de N°${ACTIVITY_N}`) }).click()
    await expect(page.getByRole("listitem").filter({ hasText: REASON_APPROVE })).toHaveCount(0)

    const sql = openDb()
    try {
      const [request] = await sql`select status, reviewed_by_user_id from pdtp_scheduled_instance_outcome_requests where id = ${REQ_APPROVE}`
      expect(request).toMatchObject({ status: "approved", reviewed_by_user_id: ADMIN_ID })
      const [instance] = await sql`select status, not_applicable_reason from pdtp_scheduled_instances where id = ${INSTANCES[0].id}`
      expect(instance).toMatchObject({ status: "not_applicable", not_applicable_reason: REASON_APPROVE })
    } finally { await sql.end() }
  })

  test("rechazar una cancelación exige motivo y la ocurrencia sigue exigible", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    const item = page.getByRole("listitem").filter({ hasText: REASON_REJECT })
    await item.getByRole("button", { name: new RegExp(`Rechazar cancelación de N°${ACTIVITY_N}`) }).click()
    const dialog = page.getByRole("dialog", { name: /Rechazar cancelación/ })
    const confirm = dialog.getByRole("button", { name: "Rechazar", exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel("Motivo del rechazo").fill("No está duplicada: son dos inspecciones distintas.")
    await confirm.click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole("listitem").filter({ hasText: REASON_REJECT })).toHaveCount(0)

    const sql = openDb()
    try {
      const [request] = await sql`select status, review_reason from pdtp_scheduled_instance_outcome_requests where id = ${REQ_REJECT}`
      expect(request).toMatchObject({ status: "rejected", review_reason: "No está duplicada: son dos inspecciones distintas." })
      const [instance] = await sql`select status from pdtp_scheduled_instances where id = ${INSTANCES[1].id}`
      expect(instance!.status).toBe("pending")
    } finally { await sql.end() }
  })

  test("quien pidió no puede aprobar lo propio, pero puede retirarlo con confirmación", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    const own = page.getByRole("listitem").filter({ hasText: REASON_OWN })
    await expect(own.getByText("La pediste tú: la revisa otra persona.")).toBeVisible()
    await expect(own.getByRole("button", { name: /Aprobar/ })).toHaveCount(0)
    await own.getByRole("button", { name: new RegExp(`Retirar "no aplica" de N°${ACTIVITY_N}`) }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Retirar solicitud" }).click()
    await expect(page.getByRole("listitem").filter({ hasText: REASON_OWN })).toHaveCount(0)

    const sql = openDb()
    try {
      const [request] = await sql`select status, withdrawn_by_user_id from pdtp_scheduled_instance_outcome_requests where id = ${REQ_OWN}`
      expect(request).toMatchObject({ status: "withdrawn", withdrawn_by_user_id: ADMIN_ID })
      const [instance] = await sql`select status from pdtp_scheduled_instances where id = ${INSTANCES[2].id}`
      expect(instance!.status).toBe("pending")
    } finally { await sql.end() }
  })
})
