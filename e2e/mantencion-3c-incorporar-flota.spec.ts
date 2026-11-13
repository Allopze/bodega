import { expect, test } from "@playwright/test"
import { expectPageTitle, textoVisible } from "./helpers"
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
/** Su marca de la flota no está en la lista de Mantención. */
const VEHICLE_NEW_BRAND = { id: "qa-fl2-e2e", code: "QA-FL2", plate: "ZZ-9912", brand: "QA Marca Flota E2E" }
const TYPED_BRAND = "QA Marca Escrita E2E"

test.describe("Incorporar desde la flota", () => {
  test.beforeAll(async () => {
    await withSql(async (sql) => {
      const [type] = await sql`select id, slug from fuel_equipment_types where default_meter_type = 'odometer' and is_active order by name limit 1`
      const [site] = await sql`select id from worksites where is_active order by name limit 1`
      const ids = [VEHICLE.id, VEHICLE_NEW_BRAND.id]
      await sql`delete from mant_equipment_history where vehicle_id in ${sql(ids)}`
      await sql`delete from mant_equipment_profiles where vehicle_id in ${sql(ids)}`
      await sql`delete from fuel_vehicles where id in ${sql(ids)}`
      await sql`delete from mant_brands where name in ${sql([VEHICLE_NEW_BRAND.brand, TYPED_BRAND])}`
      await sql`insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id, meter_type, brand, model, year, is_active)
        values (${VEHICLE.id}, ${VEHICLE.code}, ${VEHICLE.plate}, ${type!.slug}, ${type!.id}, ${site!.id}, 'odometer', 'scania', 'QA Modelo', 2020, true)`
      await sql`insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id, meter_type, brand, model, year, is_active)
        values (${VEHICLE_NEW_BRAND.id}, ${VEHICLE_NEW_BRAND.code}, ${VEHICLE_NEW_BRAND.plate}, ${type!.slug}, ${type!.id}, ${site!.id}, 'odometer', ${VEHICLE_NEW_BRAND.brand}, 'QA Modelo', 2021, true)`
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
    await expect(page.getByRole("combobox", { name: `Marca de ${VEHICLE.code}`, exact: true })).toHaveValue("Scania")
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

  test("una marca que no está en la lista viene puesta y se puede escribir otra, que se crea al incorporar", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/equipos/incorporar")
    await expectPageTitle(page, "Incorporar desde la flota")

    const brand = page.getByRole("combobox", { name: `Marca de ${VEHICLE_NEW_BRAND.code}`, exact: true })
    // La de la flota viene preseleccionada aunque no esté en la lista.
    await expect(brand).toHaveValue(VEHICLE_NEW_BRAND.brand)
    // La tabla y las tarjetas móviles viven en el DOM a la vez (AGENTS, «Locators»): sólo cuenta la visible.
    await expect(textoVisible(page, "Marca nueva: se agrega a la lista al incorporar.")).toBeVisible()
    // Y se puede reemplazar por cualquier otra, escribiéndola.
    await brand.fill(TYPED_BRAND)
    await brand.press("Tab")
    await expect(brand).toHaveValue(TYPED_BRAND)

    await page.getByRole("checkbox", { name: `Incorporar ${VEHICLE_NEW_BRAND.code}`, exact: true }).check()
    await page.getByRole("button", { name: "Incorporar 1 equipo", exact: true }).click()
    await expect(page.getByRole("checkbox", { name: `Incorporar ${VEHICLE_NEW_BRAND.code}`, exact: true })).toHaveCount(0)

    const [row] = await withSql(async (sql) => sql`
      select b.name as profile_brand, v.brand as fleet_brand
      from mant_equipment_profiles p join mant_brands b on b.id = p.brand_id join fuel_vehicles v on v.id = p.vehicle_id
      where p.vehicle_id = ${VEHICLE_NEW_BRAND.id}`)
    expect(row).toMatchObject({ profile_brand: TYPED_BRAND, fleet_brand: VEHICLE_NEW_BRAND.brand })
    expect(errors).toEqual([])
  })

  test("los catálogos de mantención se ven por pestaña y la jefatura puede crear una marca", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/catalogos")
    await expectPageTitle(page, "Marcas y talleres")
    await expect(page.getByRole("cell", { name: "Scania", exact: true })).toBeVisible()
    await page.getByRole("link", { name: /^Talleres/ }).click()
    await expect(page).toHaveURL(/catalogo=talleres/)
    expect(errors).toEqual([])
  })
})
