import ExcelJS from "exceljs"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: asignación nominal de actividades del PDTP a personas, por faena
 * (Fase 5).
 *
 * El recorrido que importa es el cambio de visibilidad, porque es el que puede
 * dejar trabajo invisible si está mal: se asigna la actividad a UN jefe de
 * terreno y, a partir de ahí, en `/pendientes` la ve él —con su nombre— y deja
 * de verla el otro jefe de terreno de la misma faena. Después se exporta el
 * RE-36 `?por_persona=1` y la pestaña con su nombre trae exactamente lo suyo.
 *
 * ## Fixture propio, y por qué
 *
 * Hoja y actividad nuevas, como en `pdtp-desvios.spec.ts`: la única actividad
 * del fixture base (`pdtp-act-e2e`) no declara responsables, así que nadie
 * sería candidato a recibirla, y `pdtp-templates-exports.spec.ts` cuenta con
 * que su hoja tenga exactamente una fila.
 *
 * Dos detalles del fixture no son adorno:
 *
 *  - La actividad declara el responsable `jt_asg_e2e`, mapeado al rol
 *    `jefe_terreno` en `pdtp_responsible_catalog`. Sin ese mapeo no hay
 *    candidatos que ofrecer ni fila en la cola: el dueño de una actividad sale
 *    del catálogo de responsables, no del texto del documento.
 *  - Lleva 9 de 10 instancias planificadas ya ejecutadas y aprobadas (enero) y
 *    deja 1 pendiente en el mes en curso. El 90 % es exactamente la meta del
 *    programa, así que la actividad sigue contando como "Cumple meta" y no
 *    aparece bajo el filtro "En desviación" de `pdtp-reporte-gestion.spec.ts`,
 *    que corre contra la misma base y espera que ese filtro no devuelva nada.
 *    La instancia pendiente del mes en curso es la que produce la tarjeta en
 *    `/pendientes`.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-asignacion-e2e"
const SHEET_CODE = "s-asignacion"
const SHEET_LABEL = "Asignación E2E"
const ACTIVITY_ID = "pdtp-act-asignacion-e2e"
const ACTIVITY_N = 78
const ACTIVITY_NAME = "Charla de cinco minutos del turno E2E"
const CATALOG_SLUG = "jt_asg_e2e"
const ASSIGNED_USER = { email: "jt@e2e.chome.cl", name: "JT Asignado E2E" }
const OTHER_JT_EMAIL = "jefe.faena@e2e.chome.cl"

/** El programa fixture es del 2026 y la cola sólo mira el año y mes en curso. */
const YEAR = 2026
const CURRENT_MONTH = new Date().getMonth() + 1

const ANNUAL_VIEW_URL =
  `/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&hoja=${SHEET_CODE}&vista=anual&anio=${YEAR}`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

test.describe.serial("PDTP — asignación nominal por faena", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const now = new Date().toISOString()
      await sql`
        insert into pdtp_responsible_catalog (slug, display_name, role_name, kind, is_active)
        values (${CATALOG_SLUG}, 'Jefe de terreno E2E', 'jefe_terreno', 'rbac_role', true)
        on conflict (slug) do nothing
      `
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
          ${ACTIVITY_ID}, ${PROGRAM_ID}, ${ACTIVITY_N}, 1, 'active', ${ACTIVITY_NAME}, 'Programa E2E',
          ${sql.json([CATALOG_SLUG])}, 'Jefe de terreno E2E', 'scheduled', ${ACTIVITY_N}, ${now}, ${now}
        )
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
        values ('pdtp-sheet-act-asignacion-e2e', ${SHEET_ID}, ${SHEET_CODE}, ${ACTIVITY_ID}, 1, 1)
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
        values
          ('pdtp-sched-asignacion-e2e-cumplido', ${ACTIVITY_ID}, ${YEAR}, 1, 1, 9, 'manual-e2e'),
          ('pdtp-sched-asignacion-e2e-pendiente', ${ACTIVITY_ID}, ${YEAR}, ${CURRENT_MONTH}, 1, 1, 'manual-e2e')
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_executions (
          id, activity_id, worksite_id, year, month, week, executed_quantity, status, created_at, updated_at
        )
        values (
          'pdtp-exec-asignacion-e2e', ${ACTIVITY_ID}, ${WORKSITE_ID}, ${YEAR}, 1, 1, 9, 'approved', ${now}, ${now}
        )
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      await sql`delete from pdtp_activity_worksite_assignees where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_executions where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activity_schedule where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheet_activities where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activities where id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
      await sql`delete from pdtp_responsible_catalog where slug = ${CATALOG_SLUG}`
    } finally { await sql.end() }
  })

  test("sin asignar, los dos jefes de terreno ven la actividad en sus pendientes", async ({ page }) => {
    for (const email of [ASSIGNED_USER.email, OTHER_JT_EMAIL]) {
      await login(page, email)
      await page.goto("/pendientes")
      await expect(page.getByText(ACTIVITY_NAME).first()).toBeVisible()
      await page.context().clearCookies()
    }
  })

  test("asignar la actividad a una persona deja el chip con su nombre en la planilla", async ({ page }) => {
    await login(page)
    await page.goto(ANNUAL_VIEW_URL)
    // Diálogos y checkboxes son cliente puro: sin hidratar, el primer clic no
    // abre nada y el fallo se lee como "no existe el botón".
    await page.waitForLoadState("networkidle").catch(() => undefined)

    await page.getByRole("button", { name: `Asignar la actividad N°${ACTIVITY_N} a una persona` }).click()
    await page.getByLabel(ASSIGNED_USER.name).check()
    await page.getByRole("button", { name: /Guardar asignación/ }).click()

    await expect(page.getByText(`Asignada a: ${ASSIGNED_USER.name}`).first()).toBeVisible()
  })

  test("con asignado, la ve él en /pendientes con su nombre y deja de verla el otro jefe de terreno", async ({ page }) => {
    await login(page, ASSIGNED_USER.email)
    await page.goto("/pendientes")
    await expect(page.getByText(ACTIVITY_NAME).first()).toBeVisible()
    await expect(page.getByText(`Asignada a ${ASSIGNED_USER.name}`).first()).toBeVisible()
    await page.context().clearCookies()

    // El cambio delicado de la fase: el otro del mismo cargo deja de verla.
    await login(page, OTHER_JT_EMAIL)
    await page.goto("/pendientes")
    await expect(page.getByText(ACTIVITY_NAME)).toHaveCount(0)
  })

  test("el filtro ?asignado=yo deja la vista de actividades acotada a lo propio", async ({ page }) => {
    await login(page, ASSIGNED_USER.email)
    await page.goto(`${ANNUAL_VIEW_URL}&asignado=yo`)
    await expect(page.getByText(ACTIVITY_NAME).first()).toBeVisible()
  })

  test("el RE-36 ?por_persona=1 arma una pestaña con el nombre del asignado", async ({ page }) => {
    await login(page)
    const response = await page.request.get(
      `/api/prevencion/pdtp/export?programId=${PROGRAM_ID}&faena=${WORKSITE_ID}&formato=re36&por_persona=1`,
    )
    expect(response.status()).toBe(200)
    expect(response.headers()["content-disposition"]).toContain("RE-36-PDTP-POR-PERSONA-2026-E2E-001-v1.xlsx")

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.body()) as never)
    expect(workbook.worksheets.map((ws) => ws.name)).toContain(ASSIGNED_USER.name)

    const sheet = workbook.getWorksheet(ASSIGNED_USER.name)
    expect(sheet).toBeDefined()
    // Columna D: la actividad asignada. Columna E: el cargo del programa
    // firmado MÁS el nombre entre paréntesis — el cargo no se reemplaza.
    expect(String(sheet!.getCell("D16").value)).toContain(ACTIVITY_NAME)
    expect(String(sheet!.getCell("E16").value)).toContain("Jefe de terreno E2E")
    expect(String(sheet!.getCell("E16").value)).toContain(ASSIGNED_USER.name)
  })

  test("dejarla sin asignar la devuelve a todos los del cargo", async ({ page }) => {
    await login(page)
    await page.goto(ANNUAL_VIEW_URL)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    await page.getByRole("button", { name: `Asignar la actividad N°${ACTIVITY_N} a una persona` }).click()
    await page.getByLabel(ASSIGNED_USER.name).uncheck()
    await page.getByRole("button", { name: /Dejar sin asignar/ }).click()
    await expect(page.getByText(`Asignada a: ${ASSIGNED_USER.name}`)).toHaveCount(0)

    await page.context().clearCookies()
    await login(page, OTHER_JT_EMAIL)
    await page.goto("/pendientes")
    await expect(page.getByText(ACTIVITY_NAME).first()).toBeVisible()
  })
})
