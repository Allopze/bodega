import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { login, pickCurrentMonthDate, selectRadixById } from "./helpers"

const REQUEST_NOTE = "E2E: confirmación explícita de stock EPP"

async function requestsWithPreflightNote(requestNote: string) {
  const databaseUrl = process.env.E2E_DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for the EPP stock preflight test")
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from purchase_requests
      where notes = ${requestNote}
    `
    return rows[0]?.count ?? 0
  } finally {
    await sql.end()
  }
}

async function fillEppWithAvailableStock(page: Page, requestNote: string) {
  await page.goto("/solicitudes")
  await page.getByRole("link", { name: /nueva/i }).click()
  await expect(page.getByRole("heading", { name: /nueva solicitud/i })).toBeVisible()

  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "EPP")
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.locator("#notes").fill(requestNote)

  const picker = page.getByPlaceholder(/Buscar en catálogo o escribir producto/i)
  await picker.fill("Casco Preflight E2E")
  // La opción muestra SKU + nombre, así que su nombre accesible es
  // "E2E-EPP-PREFLIGHT-001 Casco Preflight E2E": con `exact` sobre el nombre del
  // producto no puede matchear nunca.
  const option = page.getByRole("option", { name: /Casco Preflight E2E/ })
  await expect(option.first()).toBeVisible({ timeout: 15_000 })
  await option.first().click()
  await page.locator('input[id^="qty-"]').first().fill("2")
}

test("advierte el stock EPP, permite cancelar y crea una sola solicitud al continuar", async ({ page }, testInfo) => {
  const requestNote = `${REQUEST_NOTE} [${testInfo.testId}:retry-${testInfo.retry}]`

  await login(page)
  await expect.poll(() => requestsWithPreflightNote(requestNote)).toBe(0)
  await fillEppWithAvailableStock(page, requestNote)

  const submit = page.getByRole("button", { name: /crear y enviar a aprobación/i })
  await submit.click()

  const warning = page.getByRole("dialog", { name: "Hay EPP disponible en bodega" })
  await expect(warning).toBeVisible()
  await expect(warning).toContainText("Casco Preflight E2E")
  await expect(warning).toContainText("Solicitado: 2")
  await expect(warning).toContainText(/Disponible: 7/)
  await expect(warning).toContainText("Ubicación: Faena E2E")
  await expect(warning).toContainText("Cobertura total")

  await warning.getByRole("button", { name: "Cancelar y volver al formulario" }).click()
  await expect(warning).toBeHidden()
  await expect(page).toHaveURL(/\/solicitudes\/nueva/)
  await expect.poll(() => requestsWithPreflightNote(requestNote)).toBe(0)

  // La segunda revisión conserva el formulario, pero no crea hasta que la
  // persona pulse la decisión explícita del diálogo.
  await submit.click()
  await expect(warning).toBeVisible()
  await warning.getByRole("button", { name: "Continuar con la solicitud" }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 20_000 })
  await expect.poll(() => requestsWithPreflightNote(requestNote)).toBe(1)
})
