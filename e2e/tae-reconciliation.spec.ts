import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

test.describe("TAE — conciliación con Copec TCT", () => {
  test.beforeAll(async () => {
    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await sql`
        insert into fuel_vehicles (
          id, plate, code, type, worksite_id, responsible_user_id,
          operational_status, is_active
        ) values (
          'fuel-veh-recon-e2e', 'RECON-E2E-1', 'E2E-90', 'camioneta',
          'ws-e2e', 'user-admin-e2e', 'operativo', true
        ) on conflict (id) do nothing
      `
      await sql`
        insert into fuel_import_batches (
          id, worksite_id, fuente, periodo_desde, periodo_hasta, archivo_nombre,
          hash_archivo, estado, total_filas, filas_validas, total_cantidad,
          total_monto, importado_por
        ) values
          ('tct-diesel-e2e', 'ws-e2e', 'Copec TCT Diesel', '2026-07-01', '2026-07-31', 'diesel.xlsx', 'hash-diesel-e2e', 'importado', 1, 1, 80, 96000, 'user-admin-e2e'),
          ('tct-bluemax-e2e', 'ws-e2e', 'Copec TCT BlueMax', '2026-07-01', '2026-07-31', 'bluemax.xlsx', 'hash-bluemax-e2e', 'importado', 1, 1, 15, 18000, 'user-admin-e2e')
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_consumption_records (
          id, batch_id, worksite_id, vehicle_id, patente, numero_tarjetas,
          numero_transacciones, cantidad_unidad, monto, periodo_desde,
          periodo_hasta, fuente
        ) values
          ('tct-record-diesel-e2e', 'tct-diesel-e2e', 'ws-e2e', 'fuel-veh-recon-e2e', 'RECON-E2E-1', 1, 1, 80, 96000, '2026-07-01', '2026-07-31', 'Copec TCT Diesel'),
          ('tct-record-bluemax-e2e', 'tct-bluemax-e2e', 'ws-e2e', 'fuel-veh-recon-e2e', 'RECON-E2E-1', 1, 1, 15, 18000, '2026-07-01', '2026-07-31', 'Copec TCT BlueMax')
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_tae_submissions (
          id, client_submission_id, source, public_result_token, worksite_id,
          vehicle_id, equipment_code_snapshot, plate_snapshot, loaded_at,
          submitted_at, driver_name_snapshot, supervisor_name_snapshot,
          meter_type, meter_reading, meter_reading_source, liters, status
        ) values (
          'tae-recon-e2e', 'tae-recon-client-e2e', 'public_pwa', 'tae-recon-result-e2e',
          'ws-e2e', 'fuel-veh-recon-e2e', 'E2E-90', 'RECON-E2E-1',
          '2026-07-15T15:00:00.000Z', '2026-07-15T15:05:00.000Z',
          'Conductor E2E', 'Supervisor E2E', 'odometer', 1234, 'manual', 120, 'validated'
        ) on conflict (id) do nothing
      `
    } finally {
      await sql.end()
    }
  })

  test("presenta ambos canales por producto y exporta XLSX", async ({ page }) => {
    await login(page)
    await page.goto("/combustibles/tae/conciliacion?desde=2026-07-01&hasta=2026-07-31&faena=ws-e2e")

    await expect(page.getByRole("heading", { name: "Conciliación TAE–Copec TCT" })).toBeVisible()
    const equipmentRow = page.getByRole("row").filter({ hasText: "E2E-90" })
    await expect(equipmentRow).toContainText("120 L")
    await expect(equipmentRow).toContainText("80 L")
    await expect(equipmentRow).toContainText("15 L")
    await expect(equipmentRow).toContainText("215 L")
    await expect(equipmentRow).toContainText("Ambos")

    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: "Exportar XLSX" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^conciliacion_tae_tct_.*\.xlsx$/)
  })
})
