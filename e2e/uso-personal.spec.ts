import { expect, test, type Page } from "@playwright/test"
import { withSql } from "./combustibles-control-helpers"
import { login, pickCurrentMonthDate } from "./helpers"

/**
 * Uso personal de equipos: marcar un período en la ficha saca su combustible de
 * Control operacional (con la nota «Excluye N días de uso personal») y quitarlo
 * lo devuelve. Quien no tiene `flota:personal_use` ve la ficha sin el botón.
 *
 * Las fechas son relativas a hoy en Chile: el período va de hoy−6 a hoy−2 (ninguna
 * fecha puede ser futura) y Control operacional se consulta de hoy−12 a hoy. El
 * combustible se inserta con SQL y se borra al final para no alterar otros recorridos.
 */
const VEHICLE_ID = "fuel-veh-e2e"
const PLATE = "E2E-FUEL-1"
const WORKSITE_ID = "ws-e2e"
const PRODUCT_ID = "fuel-diesel"
const SUPPLIER_ID = "fuel-sup-e2e"
const SYNC_RUN_ID = "qa-pu-sync"
const TX_INSIDE = "qa-pu-tx-inside"
const TX_OUTSIDE = "qa-pu-tx-outside"
const ROLE_ID = "qa-pu-role-solo-flota"
const USER_ID = "qa-pu-user-solo-flota"
const USER_EMAIL = "qa.uso.personal@e2e.chome.cl"

function chileDay(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date())
  const date = new Date(`${today}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

const FROM = chileDay(-6)
const TO = chileDay(-2)
const RANGE = `${ddmmyyyy(FROM)} → ${ddmmyyyy(TO)}`

async function cleanup() {
  await withSql(async (sql) => {
    await sql`delete from fuel_vehicle_personal_use_periods where vehicle_id = ${VEHICLE_ID}`
    await sql`delete from fuel_provider_transactions where id in (${TX_INSIDE}, ${TX_OUTSIDE})`
    await sql`delete from fuel_provider_sync_runs where id = ${SYNC_RUN_ID}`
  })
}

async function seedFuel() {
  await withSql(async (sql) => {
    await sql`
      insert into fuel_provider_sync_runs (id, provider, requested_from, requested_to, correlation_id)
      values (${SYNC_RUN_ID}, 'copec', ${chileDay(-12)}, ${chileDay(0)}, ${SYNC_RUN_ID})
    `
    for (const [id, day, amount] of [[TX_INSIDE, chileDay(-4), 40_000], [TX_OUTSIDE, chileDay(-10), 10_000]] as const) {
      await sql`
        insert into fuel_provider_transactions
          (id, sync_run_id, provider, source_account, supplier_id, identity_key, fingerprint, source_row_key,
           payload_hash, worksite_id, vehicle_id, product_id, source_plate, occurred_at, quantity, amount,
           status, granularity)
        values
          (${id}, ${SYNC_RUN_ID}, 'copec', 'tct:diesel', ${SUPPLIER_ID}, ${id}, ${id}, ${id}, ${id}, ${WORKSITE_ID},
           ${VEHICLE_ID}, ${PRODUCT_ID}, ${PLATE}, ${`${day}T15:00:00.000Z`}, 50, ${amount}, 'accepted', 'transaction')
      `
    }
  })
}

/** La fila del vehículo en Control operacional, con sólo las columnas que la prueba lee. */
async function controlRow(page: Page) {
  const columnas = ["code", "worksiteName", "fuelBilledAmount"].join(",")
  await page.goto(`/control-operacional?desde=${chileDay(-12)}&hasta=${chileDay(0)}&control-operacional-activos_cols=${columnas}`)
  const table = page.getByRole("table", { name: "Activos operacionales" })
  await expect(table).toBeVisible()
  await page.getByRole("searchbox", { name: "Filtrar en esta página" }).fill(PLATE)
  const row = table.getByRole("row").filter({ hasText: PLATE })
  await expect(row).toBeVisible()
  const headers = (await table.getByRole("columnheader").allTextContents()).map((h) => h.replace(/^Ordenar por /, "").trim())
  const costIndex = headers.findIndex((h) => h === "Costo combustible (proveedor)")
  expect(costIndex, "columna de costo").toBeGreaterThanOrEqual(0)
  return { row, cost: row.getByRole("cell").nth(costIndex) }
}

test.describe("Uso personal de equipos", () => {
  test.beforeEach(async () => {
    await cleanup()
    await seedFuel()
  })

  test.afterEach(async () => {
    await cleanup()
  })

  test("marcar un período saca su combustible de Control operacional y quitarlo lo devuelve", async ({ page }) => {
    await login(page)

    // Antes: el costo suma las dos cargas.
    const before = await controlRow(page)
    await expect(before.cost).toContainText("$50.000")
    await expect(before.row.getByText(/Excluye \d+ días? de uso personal/)).toHaveCount(0)

    // Marcar desde la ficha.
    await page.goto(`/flota/${VEHICLE_ID}/flota`)
    await page.getByRole("button", { name: "Marcar uso personal", exact: true }).click()
    const sheet = page.getByRole("dialog", { name: "Marcar uso personal" })
    await expect(sheet).toBeVisible()
    await pickCurrentMonthDate(page, /^Desde/, FROM)
    await pickCurrentMonthDate(page, /^Hasta/, TO)
    await sheet.getByLabel("Nota").fill("QA_ viaje del dueño")
    await sheet.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByText(RANGE)).toBeVisible()

    // Después: sólo cuenta la carga fuera del período, con la nota de los 5 días.
    const marked = await controlRow(page)
    await expect(marked.cost).toContainText("$10.000")
    await expect(marked.row.getByText("Excluye 5 días de uso personal")).toBeVisible()

    // Quitar el período devuelve la cifra.
    await page.goto(`/flota/${VEHICLE_ID}/flota`)
    await page.getByRole("button", { name: `Quitar ${RANGE}`, exact: true }).click()
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Quitar uso personal" }))
    await confirm.getByRole("button", { name: "Quitar", exact: true }).click()
    await expect(page.getByText(RANGE)).toHaveCount(0)

    const removed = await controlRow(page)
    await expect(removed.cost).toContainText("$50.000")
    await expect(removed.row.getByText(/Excluye \d+ días? de uso personal/)).toHaveCount(0)
  })

  test("sin flota:personal_use la ficha muestra el bloque pero no el botón", async ({ page }) => {
    await withSql(async (sql) => {
      await sql`delete from user_roles where user_id = ${USER_ID}`
      await sql`delete from worksite_users where user_id = ${USER_ID}`
      await sql`delete from users where id = ${USER_ID}`
      await sql`delete from role_permissions where role_id = ${ROLE_ID}`
      await sql`delete from roles where id = ${ROLE_ID}`
      await sql`insert into roles (id, name, label) values (${ROLE_ID}, 'qa_solo_flota', 'QA_ sólo ver flota')`
      await sql`insert into role_permissions (role_id, permission_id) values (${ROLE_ID}, 'p-flot-view')`
      await sql`
        insert into users (id, name, email, hashed_password, is_active)
        select ${USER_ID}, 'QA_ Solo Flota', ${USER_EMAIL}, hashed_password, true from users where email = 'admin@e2e.chome.cl'
      `
      await sql`insert into user_roles (user_id, role_id) values (${USER_ID}, ${ROLE_ID})`
      await sql`insert into worksite_users (user_id, worksite_id, is_primary) values (${USER_ID}, ${WORKSITE_ID}, true)`
    })
    try {
      await login(page, USER_EMAIL)
      await page.goto(`/flota/${VEHICLE_ID}/flota`)
      await expect(page.getByText("Este equipo no tiene uso personal marcado")).toBeVisible()
      await expect(page.getByRole("button", { name: "Marcar uso personal" })).toHaveCount(0)
    } finally {
      await withSql(async (sql) => {
        await sql`delete from user_roles where user_id = ${USER_ID}`
        await sql`delete from worksite_users where user_id = ${USER_ID}`
        await sql`delete from users where id = ${USER_ID}`
        await sql`delete from role_permissions where role_id = ${ROLE_ID}`
        await sql`delete from roles where id = ${ROLE_ID}`
      })
    }
  })
})
