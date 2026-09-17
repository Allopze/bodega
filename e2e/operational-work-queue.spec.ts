import { test, expect, type Page } from "@playwright/test"
import { clearRateLimits, login } from "./helpers"

async function loginScopedUser(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico", { exact: true }).fill("scoped@e2e.chome.cl")
  await page.getByLabel("Contraseña", { exact: true }).fill("scoped2026")
  await page.getByRole("button", { name: "Ingresar", exact: true }).click()
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

  // Aquí vivía "admin commits a due date on a stable purchase stage". La fecha
  // de compromiso se retiró de la cola en 0a5bb3f1 ("consolidate operational
  // work queue flows"): ese commit borró `work-commitment-control.tsx`, su
  // acción, el servicio `operational-assignments.ts`, el permiso del manifest
  // y la columna, pero no este caso — que quedó esperando durante 2,6 minutos
  // un botón que ya no existe en ninguna parte del código.
})
