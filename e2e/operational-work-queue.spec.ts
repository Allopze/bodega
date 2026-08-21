import { test, expect, type Page } from "@playwright/test"
import { clearRateLimits, login, pickCurrentMonthDate } from "./helpers"

async function loginScopedUser(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("scoped@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("scoped2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test.describe("Centro de control operacional", () => {
  test("admin reaches the complete prioritized queue and quick filters update the URL", async ({ page }) => {
    await login(page)
    await page.goto("/pendientes")

    await expect(page.getByRole("heading", { name: "Mis pendientes" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Cola de trabajo" })).toBeVisible()
    // `.first()`: la cola renderiza la tabla (desde `md`) y una lista de tarjetas
    // (bajo `md`) para el mismo dato, así que el código aparece dos veces en el
    // DOM. Sólo una rama es visible por viewport — la otra va con `display:none`,
    // fuera del árbol de accesibilidad — pero un `getByText` sin acotar cae en
    // strict mode. Mismo patrón que ya usan las líneas de abajo con `tr`.
    await expect(page.getByText("SOL-BULK-E2E-001").first()).toBeVisible()

    await page.getByRole("button", { name: "Críticas" }).click()
    await expect(page).toHaveURL(/quick=critical/)
    await expect(page.getByRole("button", { name: "Críticas" })).toHaveAttribute("aria-pressed", "true")

    await page.getByRole("button", { name: "Todas" }).click()
    await expect(page).not.toHaveURL(/quick=critical/)
  })

  test("a scoped user sees only authorized worksite data in the queue", async ({ page }) => {
    await loginScopedUser(page)
    await page.goto("/pendientes")

    await expect(page.getByRole("heading", { name: "Mis pendientes" })).toBeVisible()
    await expect(page.getByText("Faena E2E").first()).toBeVisible()
    await expect(page.locator("body")).not.toContainText("Faena Restringida E2E")
    await expect(page.locator("body")).not.toContainText("E2E-RESTR")
  })

  test("admin commits a due date on a stable purchase stage", async ({ page }) => {
    await login(page)
    await page.goto("/pendientes?module=compras")

    const row = page.locator("tr", { hasText: "SOL-BULK-E2E-001" }).first()
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: /Fijar fecha de compromiso/ }).click()
    const dialog = page.getByRole("dialog", { name: "Fecha de compromiso" })
    await expect(dialog).toBeVisible()
    await pickCurrentMonthDate(page, /Seleccionar fecha|Sin fecha adicional/)
    await dialog.getByRole("button", { name: "Guardar compromiso" }).click()
    await expect(dialog).toBeHidden()

    await page.reload()
    const committedRow = page.locator("tr", { hasText: "SOL-BULK-E2E-001" }).first()
    await expect(committedRow.getByRole("button", { name: /Cambiar fecha de compromiso/ })).toBeVisible()
  })
})
