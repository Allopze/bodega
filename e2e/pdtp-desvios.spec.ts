import ExcelJS from "exceljs"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: desvíos por celda del PDTP (Fase 3).
 *
 * El recorrido completo de un "no realizada": se declara desde la vista
 * semanal por faena, cambia el badge de la actividad, queda listado bajo la
 * fila con su motivo y aparece en el documento RE-36 —con `E = 0` y una nota
 * en la celda, más su fila en la hoja "Desvíos"— que es lo que el mandante
 * termina leyendo.
 *
 * ## Fixture propio, y por qué
 *
 * No se reutiliza `pdtp-act-e2e` (la única actividad del fixture base): está
 * planificada en enero semana 1 y ya tiene una ejecución aprobada ahí, así que
 * no hay celda libre donde declarar un desvío sin ejecución. Este spec crea su
 * propia hoja (`s-desvio`) y su propia actividad, y las borra al final.
 *
 * Dos detalles del fixture no son adorno:
 *
 *  - La actividad vive en una hoja NUEVA, no en `pdtp-sheet-e2e`:
 *    `pdtp-templates-exports.spec.ts` afirma `SUM(F16:F16)` sobre esa hoja, o
 *    sea que cuenta con que tenga exactamente una fila.
 *  - Lleva dos celdas planificadas —febrero semana 1 y marzo semana 1— y una
 *    ejecución aprobada en MARZO que cubre las dos, así que su avance anual es
 *    100 % (`pdtp-reporte-gestion.spec.ts` espera que el filtro "En desviación"
 *    no devuelva ninguna fila) y febrero queda libre: el estado de la
 *    actividad es mensual, así que una ejecución en el mismo mes del desvío
 *    habría tapado el badge "No realizada (con motivo)" que este spec prueba.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-desvio-e2e"
const SHEET_CODE = "s-desvio"
const SHEET_LABEL = "Desvíos E2E"
const ACTIVITY_ID = "pdtp-act-desvio-e2e"
const ACTIVITY_NAME = "Inspección de orden y aseo E2E"
/** Febrero semana 1: libre de ejecuciones, y el fixture base no la usa. */
const MONTH = 2
const WEEK = 1
const REASON = "Faena suspendida por alerta meteorológica de la autoridad regional."

const VIEW_URL = `/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&hoja=${SHEET_CODE}&vista=semana&mes=${MONTH}&semana=${WEEK}`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

test.describe.serial("PDTP — desvíos por celda", () => {
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
          ${ACTIVITY_ID}, ${PROGRAM_ID}, 77, 1, 'active', ${ACTIVITY_NAME}, 'Programa E2E',
          '[]'::jsonb, 'Prevencionista', 'scheduled', 77, ${now}, ${now}
        )
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
        values ('pdtp-sheet-act-desvio-e2e', ${SHEET_ID}, ${SHEET_CODE}, ${ACTIVITY_ID}, 1, 1)
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
        values
          ('pdtp-sched-desvio-e2e-feb', ${ACTIVITY_ID}, 2026, ${MONTH}, ${WEEK}, 1, 'manual-e2e'),
          ('pdtp-sched-desvio-e2e-mar', ${ACTIVITY_ID}, 2026, 3, 1, 1, 'manual-e2e')
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_executions (
          id, activity_id, worksite_id, year, month, week, executed_quantity, status, created_at, updated_at
        )
        values (
          'pdtp-exec-desvio-e2e', ${ACTIVITY_ID}, ${WORKSITE_ID}, 2026, 3, 1, 2, 'approved', ${now}, ${now}
        )
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      // El orden importa sólo para legibilidad: las FK son ON DELETE CASCADE
      // desde la actividad, pero borrar explícito deja claro qué crea el spec.
      await sql`delete from pdtp_execution_deviations where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_executions where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activity_schedule where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheet_activities where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activities where id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
    } finally { await sql.end() }
  })

  test("declarar 'No realizada' cambia el badge y deja el motivo a la vista", async ({ page }) => {
    await login(page)
    await page.goto(VIEW_URL)
    // Diálogos y selects son cliente puro: sin hidratar, el primer clic no
    // abre nada y el fallo se lee como "no existe el botón".
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const row = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await expect(row).toBeVisible()

    await row.getByRole("button", { name: /Declarar desvío en la actividad N°77/ }).click()
    const dialog = page.getByRole("dialog", { name: /Declarar desvío/ })
    await dialog.getByLabel("No realizada").check()
    await dialog.getByLabel("Motivo", { exact: true }).fill(REASON)
    await dialog.getByRole("button", { name: "Registrar desvío" }).click()
    await expect(dialog).not.toBeVisible()

    const updatedRow = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await expect(updatedRow.getByText("No realizada (con motivo)")).toBeVisible()
    await expect(updatedRow.getByText(REASON)).toBeVisible()
    await expect(updatedRow.getByRole("button", { name: "Retirar" })).toBeVisible()
  })

  test("el RE-36 muestra la celda con E = 0, la nota del motivo y la fila en Desvíos", async ({ page }) => {
    await login(page)
    const response = await page.request.get(
      `/api/prevencion/pdtp/export?programId=${PROGRAM_ID}&faena=${WORKSITE_ID}&formato=re36`,
    )
    expect(response.status()).toBe(200)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.body()) as never)

    const anexo = workbook.getWorksheet("Desvíos")!
    const rows: string[] = []
    anexo.eachRow((row) => rows.push(row.values?.toString() ?? ""))
    const declared = rows.find((text) => text.includes(ACTIVITY_NAME))
    expect(declared).toBeTruthy()
    // Tipo en castellano, no el enum de la columna.
    expect(declared).toContain("No realizada")
    expect(declared).toContain("alerta meteorológica")

    // La hoja del programa: febrero semana 1 de la actividad 77 queda con
    // `E = 0` ("se reportó la semana y no se ejecutó", leyenda del formato) y
    // una nota con el motivo, en vez de una celda vacía que se leería como
    // "no se reportó".
    const sheet = workbook.getWorksheet(SHEET_LABEL)!
    let foundZeroWithNote = false
    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value === 0 && cell.note) foundZeroWithNote = true
      })
    })
    expect(foundZeroWithNote).toBe(true)
  })

  test("retirar el desvío devuelve la actividad a pendiente", async ({ page }) => {
    await login(page)
    await page.goto(VIEW_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const row = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await row.getByRole("button", { name: "Retirar" }).click()
    const dialog = page.getByRole("dialog", { name: "Retirar desvío" })
    await dialog.getByLabel("Motivo del retiro").fill("La faena confirmó que la actividad sí se ejecutó esa semana.")
    await dialog.getByRole("button", { name: "Retirar desvío" }).click()
    await expect(dialog).not.toBeVisible()

    const updatedRow = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
    await expect(updatedRow.getByText("No realizada (con motivo)")).toHaveCount(0)
  })
})
