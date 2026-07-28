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

/** Log in as an E2E user (admin by default) and verify we land on dashboard. */
export async function login(page: Page, email = "admin@e2e.chome.cl", password = "chome2026") {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill(email)
  await page.getByLabel("Contraseña").fill(password)
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
 * Set the "Responsable principal" field of the PDTP guided activity form
 * (`guided-activity-form.tsx`). It renders a plain text Input while
 * `pdtpResponsibleCatalog` is empty, but becomes a Select once any row
 * exists there — which other PDTP e2e specs populate as a side effect
 * (e.g. applying an Excel import writes to that shared catalog table), so
 * which one renders depends on suite-wide execution order, not on this
 * test alone. When it's a Select, the specific option doesn't matter to
 * these tests, so just pick the first one.
 */
export async function setPdtpResponsable(page: Page, name = "Prevencionista E2E") {
  const field = page.getByLabel("Responsable principal")
  const tagName = await field.evaluate((el) => el.tagName)
  if (tagName === "INPUT") {
    await field.fill(name)
  } else {
    await field.click()
    await page.getByRole("option").first().click()
  }
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
