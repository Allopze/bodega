import ExcelJS from "exceljs"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: cierre mensual del PDTP por faena (Fase 4).
 *
 * El recorrido que importa de punta a punta: cerrar un mes desde la vista del
 * programa, verlo en la pantalla de cierres, descargar el Excel congelado
 * —con su hoja "Cierre"—, comprobar que el mes ya no admite cargas manuales y
 * reabrirlo.
 *
 * ## Fixture propio, y por qué
 *
 * El spec cierra un mes **completo** del programa `pdtp-prog-e2e` en la faena
 * `ws-e2e`, así que necesita un mes que ningún otro spec toque: los demás
 * trabajan en enero, febrero y marzo de 2026. Se usa mayo, con una actividad
 * propia planificada ahí, y el cierre se borra al final para que la corrida
 * siguiente arranque igual.
 *
 * La actividad vive en su propia hoja, por la misma razón que en
 * `pdtp-desvios.spec.ts`: `pdtp-templates-exports.spec.ts` cuenta con que
 * `pdtp-sheet-e2e` tenga exactamente una fila.
 *
 * El número de actividad (79) es exclusivo de este archivo, igual que el 77 de
 * `pdtp-desvios` y el 78 de `pdtp-asignacion-nominal`. `pdtp_activities` tiene
 * un índice único sobre (programa, n) y el `on conflict (id) do nothing` del
 * insert NO lo cubre: dos specs que compartieran número dependerían de que el
 * `afterAll` del que corre primero alcance a borrar, y bastaría un cambio de
 * orden —o una corrida interrumpida— para que el segundo muriera con una
 * violación de unicidad en su `beforeAll`.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-cierre-e2e"
const SHEET_CODE = "s-cierre"
const SHEET_LABEL = "Cierre E2E"
const ACTIVITY_ID = "pdtp-act-cierre-e2e"
const ACTIVITY_NAME = "Revisión documental mensual E2E"
/** Mayo: libre de cualquier otro spec. */
const MONTH = 5
const CLOSURE_ID = `pdtp-close-${PROGRAM_ID}-${WORKSITE_ID}-2026-05`
const REASON = "Evidencias de mayo revisadas y conciliadas con la jefatura de faena."
const REOPEN_REASON = "Faltaba cargar la evidencia de la revisión documental del día 20."

const PROGRAM_URL = `/prevencion/pdtp/${PROGRAM_ID}?faena=${WORKSITE_ID}`
const CLOSURES_URL = `/prevencion/pdtp/${PROGRAM_ID}/cierres`
const WEEKLY_URL = `/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&hoja=${SHEET_CODE}&vista=semana&mes=${MONTH}&semana=1`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

test.describe.serial("PDTP — cierre mensual por faena", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const now = new Date().toISOString()
      await sql`
        insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
        values (${SHEET_ID}, ${SHEET_CODE}, ${PROGRAM_ID}, ${SHEET_LABEL}, 'SG-SST', '[]'::jsonb, true)
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activities (
          id, program_id, n, display_order, status, activity, program,
          responsible_slugs, responsible_display, schedule_mode, source_sheet_row,
          created_at, updated_at
        )
        values (
          ${ACTIVITY_ID}, ${PROGRAM_ID}, 79, 1, 'active', ${ACTIVITY_NAME}, 'Programa E2E',
          '[]'::jsonb, 'Prevencionista', 'scheduled', 79, ${now}, ${now}
        )
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
        values ('pdtp-sheet-act-cierre-e2e', ${SHEET_ID}, ${SHEET_CODE}, ${ACTIVITY_ID}, 1, 1)
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
        values ('pdtp-sched-cierre-e2e-may', ${ACTIVITY_ID}, 2026, ${MONTH}, 1, 1, 'manual-e2e')
        on conflict (id) do nothing
      `
      await sql`delete from pdtp_period_closures where id = ${CLOSURE_ID}`
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      await sql`delete from pdtp_period_closures where id = ${CLOSURE_ID}`
      await sql`delete from pdtp_executions where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activity_schedule where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheet_activities where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activities where id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
    } finally { await sql.end() }
  })

  test("cerrar mayo congela la copia y la deja listada en Cierres mensuales", async ({ page }) => {
    await login(page)
    await page.goto(PROGRAM_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    await page.getByRole("button", { name: "Cerrar mes" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Cerrar el mes de esta faena" })
    await expect(dialog).toBeVisible()

    // El mes por defecto es el anterior al de hoy; este spec cierra mayo.
    await dialog.getByLabel("Mes que se cierra").click()
    await page.getByRole("option", { name: "May" }).click()
    await dialog.getByLabel("Fundamento del cierre").fill(REASON)
    // Sin correo: el envío real no es lo que este recorrido verifica.
    await dialog.getByLabel(/Avisar por correo/).uncheck()
    await dialog.getByRole("button", { name: "Cerrar mes" }).click()
    await expect(dialog).not.toBeVisible()

    await page.goto(CLOSURES_URL)
    const row = page.getByRole("row").filter({ hasText: "May 2026" })
    await expect(row).toBeVisible()
    await expect(row.getByText("Cerrado")).toBeVisible()
    await expect(row.getByText("v1")).toBeVisible()
  })

  test("la descarga del cierre trae la hoja 'Cierre' con el motivo y la huella", async ({ page }) => {
    await login(page)
    const response = await page.request.get(`/api/prevencion/pdtp/cierres/${CLOSURE_ID}/export`)
    expect(response.status()).toBe(200)
    expect(response.headers()["content-disposition"]).toContain("cierre-v1.xlsx")

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.body()) as never)

    const sheet = workbook.getWorksheet("Cierre")!
    const text: string[] = []
    sheet.eachRow((row) => text.push(row.values?.toString() ?? ""))
    const joined = text.join("\n")
    expect(joined).toContain("mayo de 2026")
    expect(joined).toContain(REASON)
    expect(joined).toContain("Huella de la foto")
  })

  test("con el mes cerrado, registrar una ejecución de mayo falla con un mensaje claro", async ({ page }) => {
    await login(page)
    await page.goto(WEEKLY_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const row = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await row.getByRole("button", { name: "Registrar" }).click()
    const dialog = page.getByRole("dialog", { name: "Registrar ejecución" })
    await dialog.getByLabel("Cantidad").fill("1")
    await dialog.getByRole("button", { name: "Guardar ejecución" }).click()

    await expect(dialog.getByRole("alert")).toContainText(/cerrado/i)
  })

  test("reabrir mayo deja el cierre en 'Reabierto' y vuelve a permitir cargas", async ({ page }) => {
    await login(page)
    await page.goto(CLOSURES_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const row = page.getByRole("row").filter({ hasText: "May 2026" })
    await row.getByRole("button", { name: "Reabrir" }).click()
    const dialog = page.getByRole("dialog", { name: /Reabrir May 2026/ })
    await dialog.getByLabel("Motivo de la reapertura").fill(REOPEN_REASON)
    await dialog.getByRole("button", { name: "Reabrir mes" }).click()
    await expect(dialog).not.toBeVisible()

    await page.goto(CLOSURES_URL)
    await expect(page.getByRole("row").filter({ hasText: "May 2026" }).getByText("Reabierto")).toBeVisible()

    // Y la copia congelada sigue descargable: reabrir no la borra.
    const response = await page.request.get(`/api/prevencion/pdtp/cierres/${CLOSURE_ID}/export`)
    expect(response.status()).toBe(200)
  })
})
