import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { expectPageTitle, login } from "./helpers"

const WORKBOOK = path.resolve(
  process.cwd(),
  "docs/SGI Chome_2026/Inventario extintores/INVENTARIO DE EXTINTORES FAENA BIODIVERSA 2026.xlsx",
)

const INITIAL_PLATES = [
  "SGCP77-3",
  "SGCP84-6",
  "SJFC66-0",
  "SJFC34",
  "SRCJ-39-1",
  "SRCJ-42-1",
  "SRCJ-44-8",
  "SRCJ-47-2",
]

function databaseClient() {
  const databaseUrl = process.env.E2E_DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es obligatoria para esta prueba.")
  return postgres(databaseUrl, { max: 1 })
}

async function upsertFleetVehicle(
  client: ReturnType<typeof postgres>,
  plate: string,
  index: number,
) {
  await client`
    INSERT INTO fuel_vehicles (
      id, plate, code, type, equipment_type_id, brand, worksite_id,
      meter_type, performance_unit, operational_status, is_active
    ) VALUES (
      ${`veh-extintor-e2e-${index}`}, ${plate}, ${`EXT-FLOTA-${index}`},
      'CAMIÓN', 'fet-extintor-e2e', 'E2E', 'ws-e2e',
      'none', 'not_applicable', 'operativo', true
    )
    ON CONFLICT (plate) DO UPDATE SET
      worksite_id = EXCLUDED.worksite_id,
      equipment_type_id = EXCLUDED.equipment_type_id,
      is_active = true
  `
}

test.describe("catálogo operativo de extintores", () => {
  test("reconcilia el Excel real, confirma cobertura y abre la recarga canónica", async ({ page }) => {
    test.setTimeout(180_000)
    const client = databaseClient()
    const consoleErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })

    try {
      await client`
        INSERT INTO fuel_equipment_types (
          id, slug, name, category, default_meter_type, default_performance_unit,
          is_system, is_active
        ) VALUES (
          'fet-extintor-e2e', 'vehiculo-extintor-e2e', 'Vehículo extintores E2E',
          'other', 'none', 'not_applicable', false, true
        )
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_active = true
      `
      for (const [index, plate] of INITIAL_PLATES.entries()) {
        await upsertFleetVehicle(client, plate, index + 1)
      }

      await login(page)
      await page.goto("/admin/inventario-faena")
      await expectPageTitle(page, "Inventario de faena")
      await expect(page.getByRole("button", { name: "Importar", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Exportar Excel" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Nuevo recurso" })).toBeVisible()

      await page.getByRole("button", { name: "Importar", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Importar inventario supervisado" })
      await expect(dialog).toBeVisible()
      await dialog.getByRole("combobox").first().click()
      await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
      await dialog.locator('input[type="file"]').setInputFiles(WORKBOOK)
      await dialog.getByRole("button", { name: "Generar preview" }).click()

      await expect(dialog.getByText("La patente SBRP15 no existe en Flota para esta faena.", { exact: true })).toBeVisible()
      await expect(dialog.getByText("Conflictos", { exact: true }).locator("..")).toContainText("1")
      await expect(dialog.getByRole("button", { name: "Confirmar lote" })).toBeDisabled()

      await upsertFleetVehicle(client, "SBRP15", 9)
      await dialog.getByRole("button", { name: "Cambiar archivo" }).click()
      await dialog.getByRole("button", { name: "Generar preview" }).click()

      await expect(dialog.getByText("Conflictos", { exact: true }).locator("..")).toContainText("0")
      await expect(dialog.getByRole("button", { name: "Confirmar lote" })).toBeEnabled()
      await dialog.getByRole("button", { name: "Confirmar lote" }).click()
      await expect(dialog).toBeHidden()

      const [manifest] = await client<[{ assets: number; points: number; operational: number; maintenance: number }]>`
        SELECT
          (SELECT COUNT(*)::int FROM prevention_emergency_resources WHERE worksite_id = 'ws-e2e' AND asset_code IS NOT NULL) AS assets,
          (SELECT COUNT(*)::int FROM prevention_emergency_resource_points WHERE worksite_id = 'ws-e2e') AS points,
          (SELECT COUNT(*)::int FROM prevention_emergency_resources WHERE worksite_id = 'ws-e2e' AND asset_code IS NOT NULL AND status = 'operational') AS operational,
          (SELECT COUNT(*)::int FROM prevention_emergency_resources WHERE worksite_id = 'ws-e2e' AND asset_code IS NOT NULL AND status = 'needs_maintenance') AS maintenance
      `
      expect(manifest).toEqual({ assets: 14, points: 14, operational: 13, maintenance: 1 })

      await page.reload()
      // El fixture global de Inspecciones conserva además un extintor histórico
      // sin assetCode; el manifiesto canónico recién importado son los 14 de arriba.
      await expect(page.getByRole("tab", { name: "Activos (15)" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Cobertura" })).toContainText("13/14")
      await expect(page.getByRole("button", { name: "Brechas críticas" })).toContainText("1")

      await page.getByRole("tab", { name: "Puntos de cobertura (14)" }).click()
      await page.getByRole("combobox", { name: "Estado de cobertura" }).click()
      await page.getByRole("option", { name: "Brechas críticas" }).click()
      await expect(page).toHaveURL(/cobertura=gap/)
      await expect(page.getByRole("row")).toHaveCount(2)
      const gapRow = page.getByRole("row").filter({ hasText: /Taller de soldadura - puesto 5/i })
      await expect(gapRow).toContainText("Brecha")
      await expect(gapRow).toContainText("EXT-014")
      await expect(gapRow).toContainText("Extintor no operativo")

      await page.getByRole("tab", { name: "Activos (15)" }).click()
      const ext014 = page.getByRole("row").filter({ hasText: "EXT-014" })
      await expect(ext014).toContainText("Requiere mantención")
      await ext014.getByRole("link", { name: "Solicitar recarga" }).click()
      await expect(page).toHaveURL(/\/solicitudes\/nueva\?.*recursoEmergencia=/)
      await expectPageTitle(page, "Nueva solicitud")
      await expect(page.getByText(/EXT-014/).first()).toBeVisible()
      await expect(page.getByText("Recarga y mantención de extintor").first()).toBeVisible()

      expect(consoleErrors).toEqual([])
    } finally {
      await client.end()
    }
  })
})
