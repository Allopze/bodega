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
  // Todos los workers comparten la misma IP y la misma tabla `rate_limits`, así
  // que mientras `negative-flows.spec.ts` acumula fallos a propósito para
  // verificar el bloqueo, el login de otro worker en paralelo puede quedar
  // bloqueado por IP y terminar en /login. Limpiar antes no alcanza: es una
  // carrera, el otro spec vuelve a llenar la tabla. Se reintenta una vez.
  for (const attempt of [1, 2]) {
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill(email)
    await page.getByLabel("Contraseña").fill(password)
    await page.getByRole("button", { name: "Ingresar" }).click()
    try {
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

/**
 * Asserts the page title, siempre acotado al `h1`.
 *
 * `getByRole("heading", { name })` a secas es ambiguo en cualquier pantalla del
 * shell, por dos motivos independientes:
 *
 * 1. El título se renderiza dos veces — la copia `lg:sr-only` de `PageHeader` y
 *    la del TopBar (que además es un `<p>`, no un heading).
 * 2. El nombre del módulo suele ser substring del `h2` de su estado vacío
 *    ("Recepción" ⊂ "Sin OCs pendientes de recepción"), así que la pantalla
 *    empieza a fallar por strict mode justo cuando se queda sin datos.
 *
 * El subtítulo NO se asserta: en el TopBar es `display:none` bajo 1536px y en la
 * página es `sr-only` en desktop, así que afirmar que "está visible" no dice
 * nada del usuario real.
 */
export async function expectPageTitle(page: Page, name: string | RegExp) {
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
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
