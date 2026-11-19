import { test, expect } from "@playwright/test"
import postgres from "postgres"
import { expectPageTitle, login, textoVisible } from "./helpers"

/**
 * Contratos dentro de la faena: se crea un contrato con su mandante desde el
 * detalle de la faena, se le asigna el equipo del fixture y el contrato aparece
 * en la ficha del equipo y en «Costo por contrato» del Panel operacional.
 *
 * `RUN` desambigua el nombre del contrato entre reintentos. El mandante usa un
 * RUT fijo a propósito: crearlo dos veces devuelve el mismo cliente.
 */
const RUN = Date.now().toString(36).slice(-5).toUpperCase()
const CONTRATO = `QA_Residuos ${RUN}`
const VEHICULO = "fuel-veh-e2e"
const PATENTE = "E2E-FUEL-1"

test.setTimeout(180_000)

test.describe("Contratos de faena", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("contratos de faena: crear, asignar y ver el costo", async ({ page }) => {
    await page.goto("/admin/faenas")
    await page.getByRole("link", { name: "Faena E2E", exact: true }).click()
    await expectPageTitle(page, "Faena E2E")

    // Contrato nuevo con su mandante creado en línea.
    await page.getByRole("button", { name: "Nuevo contrato", exact: true }).first().click()
    const contractSheet = page.getByRole("dialog", { name: "Nuevo contrato" })
    await contractSheet.getByLabel("Nombre del contrato").fill(CONTRATO)
    await contractSheet.getByRole("button", { name: "Crear mandante", exact: true }).click()
    await contractSheet.getByLabel("RUT del mandante").fill("76.123.456-0")
    await contractSheet.getByLabel("Razón social").fill("QA_Mandante E2E")
    await contractSheet.getByRole("button", { name: "Guardar mandante", exact: true }).click()
    await expect(contractSheet.getByRole("button", { name: "Guardar mandante", exact: true })).toBeHidden()
    await contractSheet.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(contractSheet).toBeHidden()

    // El contrato queda como tarjeta propia; se le asigna el equipo del fixture.
    const card = page.getByRole("region", { name: CONTRATO })
    await expect(card).toBeVisible()
    await card.getByRole("button", { name: "Asignar equipos", exact: true }).click()
    const assignSheet = page.getByRole("dialog", { name: "Asignar equipos" })
    await assignSheet.getByRole("checkbox", { name: new RegExp(PATENTE) }).check()
    await assignSheet.getByRole("button", { name: "Asignar 1 equipo", exact: true }).click()
    await expect(assignSheet).toBeHidden()
    await expect(card.getByText(PATENTE)).toBeVisible()

    const client = postgres(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL!, { max: 1 })
    try {
      const rows = await client`
        select c.code, c.billing_cycle, a.valid_to
        from contract_vehicle_assignments a join contracts c on c.id = a.contract_id
        where a.vehicle_id = ${VEHICULO} and c.name = ${CONTRATO}`
      expect(rows).toHaveLength(1)
      expect(rows[0].code).toMatch(/^CTR-\d{4}-\d{4}$/)
      expect(rows[0].billing_cycle).toBe("none")
      expect(rows[0].valid_to).toBeNull()
    } finally {
      await client.end()
    }

    // La ficha del equipo nombra el contrato junto a la faena.
    await page.goto(`/flota/${VEHICULO}`)
    await expect(textoVisible(page, CONTRATO).first()).toBeVisible()

    // El Panel operacional lo muestra en «Costo por contrato».
    await page.goto("/control-operacional")
    const section = page.getByRole("region", { name: "Costo por contrato" })
    await expect(section.getByRole("link", { name: CONTRATO, exact: true })).toBeVisible()
  })
})
