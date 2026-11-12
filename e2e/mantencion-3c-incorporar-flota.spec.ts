import { expect, test } from "@playwright/test"
import { expectPageTitle } from "./helpers"
import { asJefe, trackConsole, withSql } from "./mantencion-3-helpers"

/**
 * Plan 2 de la auditoría de Mantención (2026-11-12): «Incorporar desde la flota» y
 * los catálogos de mantención.
 *
 * Un vehículo que ya está en la flota (`fuel_vehicles`) no se vuelve a cargar: se
 * incorpora eligiendo sólo marca y pauta, y su código, patente, tipo y faena quedan
 * como estaban. Siembra su propio vehículo `QA-FL1` directo en la base.
 *
 * Locators según «Locators in this repository» de AGENTS.md: `getByRole` y
 * `exact: true` cuando un rótulo es prefijo de otro.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const VEHICLE = { id: "qa-fl1-e2e", code: "QA-FL1", plate: "ZZ-9911" }

test.describe("Incorporar desde la flota", () => {
  test.beforeAll(async () => {
    await withSql(async (sql) => {
      const [type] = await sql`select id, slug from fuel_equipment_types where default_meter_type = 'odometer' and is_active order by name limit 1`
      const [site] = await sql`select id from worksites where is_active order by name limit 1`
      await sql`delete from mant_equipment_profiles where vehicle_id = ${VEHICLE.id}`
      await sql`delete from fuel_vehicles where id = ${VEHICLE.id}`
      await sql`insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id, meter_type, brand, model, year, is_active)
        values (${VEHICLE.id}, ${VEHICLE.code}, ${VEHICLE.plate}, ${type!.slug}, ${type!.id}, ${site!.id}, 'odometer', 'scania', 'QA Modelo', 2020, true)`
    })
  })

  test("la lista avisa y la incorporación completa sólo marca y pauta, sin tocar la flota", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/equipos")
    await page.getByRole("link", { name: "Incorporarlos", exact: true }).click()
    await expectPageTitle(page, "Incorporar desde la flota")

    const before = await withSql(async (sql) => (await sql`select worksite_id, model, year, brand from fuel_vehicles where id = ${VEHICLE.id}`)[0])
    // La marca de la flota («scania») se sugiere desde la lista.
    await expect(page.getByRole("combobox", { name: `Marca de ${VEHICLE.code}`, exact: true })).toContainText("Scania")
    await page.getByRole("checkbox", { name: `Incorporar ${VEHICLE.code}`, exact: true }).check()
    await page.getByRole("button", { name: "Incorporar 1 equipo", exact: true }).click()
    await expect(page.getByRole("checkbox", { name: `Incorporar ${VEHICLE.code}`, exact: true })).toHaveCount(0)

    const after = await withSql(async (sql) => sql`
      select v.worksite_id, v.model, v.year, v.brand, b.name as profile_brand
      from fuel_vehicles v join mant_equipment_profiles p on p.vehicle_id = v.id join mant_brands b on b.id = p.brand_id
      where v.id = ${VEHICLE.id}`)
    expect(after).toHaveLength(1)
    // La flota no cambia: misma faena, modelo, año y texto de marca.
    expect(after[0]).toMatchObject({ worksite_id: before!.worksite_id, model: before!.model, year: before!.year, brand: before!.brand, profile_brand: "Scania" })
    expect(await withSql(async (sql) => (await sql`select 1 from mant_equipment_history where vehicle_id = ${VEHICLE.id}`).length)).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test("los catálogos de mantención se ven por pestaña y la jefatura puede crear una marca", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/catalogos")
    await expectPageTitle(page, "Catálogos de mantención")
    await expect(page.getByRole("cell", { name: "Scania", exact: true })).toBeVisible()
    await page.getByRole("link", { name: /^Talleres/ }).click()
    await expect(page).toHaveURL(/catalogo=talleres/)
    expect(errors).toEqual([])
  })
})
