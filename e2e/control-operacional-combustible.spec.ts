import { expect, test } from "@playwright/test"
import { withSql } from "./combustibles-control-helpers"
import { login } from "./helpers"

/**
 * Panel operacional: el activo cruza su combustible del período.
 *
 * La carga y la factura se insertan con SQL porque el seed no trae cargas
 * asociadas a `fuel-veh-e2e`; se borran al final para no alterar las cifras de
 * otros recorridos. El período por defecto (90 días) cubre octubre de 2026.
 */
const VEHICLE_ID = "fuel-veh-e2e"
const PLATE = "E2E-FUEL-1"
const WORKSITE_ID = "ws-e2e"
const PRODUCT_ID = "fuel-diesel"
const SUPPLIER_ID = "fuel-sup-e2e"
const ADMIN_ID = "user-admin-e2e"

const LOAD_OK = "qa-panel-fuel-load-ok"
const LOAD_FLAGGED = "qa-panel-fuel-load-flagged"
const SUB_OK = "qa-panel-fuel-sub-ok"
const SUB_FLAGGED = "qa-panel-fuel-sub-flagged"
const INVOICE_ID = "qa-panel-fuel-invoice"

async function cleanup() {
  await withSql(async (sql) => {
    await sql`delete from fuel_equipment_loads where id in (${LOAD_OK}, ${LOAD_FLAGGED})`
    await sql`delete from fuel_tae_submissions where id in (${SUB_OK}, ${SUB_FLAGGED})`
    await sql`delete from fuel_loads where id = ${INVOICE_ID}`
  })
}

test.describe("Panel operacional — combustible por activo", () => {
  test.beforeEach(async ({ page }) => {
    await cleanup()
    await withSql(async (sql) => {
      for (const [id, clientId, token, liters, at] of [
        [SUB_OK, "qa-panel-fuel-client-ok", "qa-panel-fuel-token-ok", 100, "2026-10-15T15:00:00.000Z"],
        [SUB_FLAGGED, "qa-panel-fuel-client-flagged", "qa-panel-fuel-token-flagged", 50, "2026-10-16T15:00:00.000Z"],
      ] as const) {
        await sql`
          insert into fuel_tae_submissions
            (id, client_submission_id, public_result_token, worksite_id, vehicle_id, product_id,
             equipment_code_snapshot, plate_snapshot, loaded_at, submitted_at,
             driver_name_snapshot, supervisor_name_snapshot, meter_type, liters)
          values
            (${id}, ${clientId}, ${token}, ${WORKSITE_ID}, ${VEHICLE_ID}, ${PRODUCT_ID},
             ${PLATE}, ${PLATE}, ${at}, ${at}, 'Conductor QA', 'Supervisor QA', 'odometer', ${liters})
        `
      }
      await sql`
        insert into fuel_equipment_loads
          (id, source, tae_submission_id, vehicle_id, worksite_id, occurred_at, month, liters,
           performance_unit, performance_value, performance_status, review_status)
        values
          (${LOAD_OK}, 'field', ${SUB_OK}, ${VEHICLE_ID}, ${WORKSITE_ID}, '2026-10-15T15:00:00.000Z', '2026-10', 100,
           'km_per_liter', 12.5, 'computed', 'ok'),
          (${LOAD_FLAGGED}, 'field', ${SUB_FLAGGED}, ${VEHICLE_ID}, ${WORKSITE_ID}, '2026-10-16T15:00:00.000Z', '2026-10', 50,
           'km_per_liter', 0, 'computed', 'flagged')
      `
      await sql`
        insert into fuel_loads
          (id, load_date, month, service_type, vehicle_id, fuel_supplier_id, worksite_id, product,
           product_id, liters, base_amount, total_amount, status, created_by)
        values
          (${INVOICE_ID}, '2026-10-15', '2026-10', 'TCT', ${VEHICLE_ID}, ${SUPPLIER_ID}, ${WORKSITE_ID}, 'PETROLEO DIESEL',
           ${PRODUCT_ID}, 100, 50000, 50000, 'registered', ${ADMIN_ID})
      `
    })
    await login(page)
  })

  test.afterEach(async () => {
    await cleanup()
  })

  test("la fila del vehículo muestra litros, rendimiento, cargas por decidir y costo facturado", async ({ page }) => {
    // Período explícito: la prueba no depende de la fecha en que se ejecute.
    await page.goto("/control-operacional?desde=2026-10-01&hasta=2026-10-31")

    const table = page.getByRole("table", { name: "Activos operacionales" })
    await expect(table).toBeVisible()
    // La tabla pagina de a 25; el vehículo de la prueba no tiene por qué caer
    // en la primera página. La búsqueda del TopBar filtra en memoria.
    await page.getByRole("searchbox", { name: "Filtrar en esta página" }).fill(PLATE)
    const row = table.getByRole("row").filter({ hasText: PLATE })
    await expect(row).toBeVisible()

    // El administrador ve todas las columnas. Se resuelve el índice por
    // encabezado para que la prueba no dependa del orden de las columnas.
    // Las columnas ordenables exponen «Ordenar por …» como nombre accesible.
    const headers = (await table.getByRole("columnheader").allTextContents())
      .map((header) => header.replace(/^Ordenar por /, "").trim())
    const column = (label: string) => {
      const index = headers.findIndex((header) => header === label)
      if (index < 0) throw new Error(`No se encontró la columna «${label}»`)
      return index
    }
    const cells = row.getByRole("cell")
    await expect(cells.nth(column("Litros"))).toHaveText("150")
    await expect(cells.nth(column("Rendimiento promedio"))).toHaveText("12,5 km/L")
    await expect(cells.nth(column("Cargas marcadas (período)"))).toHaveText("1")
    await expect(cells.nth(column("Casos abiertos"))).toHaveText("0")
    await expect(cells.nth(column("Costo combustible (proveedor)"))).toContainText("$50.000")
    await expect(row.getByRole("link", { name: "Combustible" })).toHaveAttribute(
      "href",
      `/combustibles/consumo/equipos/${VEHICLE_ID}`,
    )
  })
})
