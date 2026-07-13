import { expect, type Page } from "@playwright/test"
import postgres from "postgres"

export async function clearRateLimits() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) return
  const client = postgres(databaseUrl, { max: 1 })
  try {
    await client`delete from rate_limits`
  } finally {
    await client.end()
  }
}

/** Log in as the E2E admin user and verify we land on dashboard. */
export async function login(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

/** Select an option inside a Radix Select identified by `id`. */
export async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).first().click()
}

/** Pick the current visible-month day in the shared DatePicker component. */
export async function pickCurrentMonthDate(page: Page, triggerName: string | RegExp) {
  const day = String(new Date().getDate())
  await page.getByRole("button", { name: triggerName }).click()
  await page.locator("button").filter({ hasText: new RegExp(`^${day}$`) }).first().click()
}

/**
 * Fill the PPA form using manual identification (no RUT verification).
 * This is the only reliable path for offline tests since the server
 * worker lookup requires network. Shared by e2e/ppa-offline.spec.ts and
 * e2e/tae-ppa-coexistence.spec.ts.
 */
export async function fillManualPpaForm(page: Page, faena = "Faena E2E") {
  await page.getByRole("button", { name: "No estoy en la lista" }).click()

  await page.locator("#worksite").click()
  await page.getByRole("option", { name: faena }).first().click()

  await page.locator("#wname").fill("Trabajador Offline E2E")

  await selectRadixById(page, "tipo", "Conductor Batea")

  await page.getByTestId("cambio-no").click()
  await page.getByTestId("peligro-no").click()

  await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
  await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()

  await page.getByTestId("seguro-si").click()
}
