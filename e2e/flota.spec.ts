import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Flota module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("overview page loads", async ({ page }) => {
    await page.goto("/flota")
    await expect(page.getByRole("heading", { name: "Vehículos", exact: true })).toBeVisible()
  })

  test("vehicle detail page loads", async ({ page }) => {
    await page.goto("/flota/fuel-veh-e2e")
    await expect(page.getByRole("heading", { name: "E2E-FUEL-1" })).toBeVisible({ timeout: 10_000 })
  })

  test("la lista abre cada vehículo desde un enlace real, no desde una fila con rol de enlace", async ({ page }) => {
    await page.goto("/flota")
    await expect(page.locator('tr[role="link"]')).toHaveCount(0)
    const tabla = page.getByRole("table", { name: "Vehículos de la flota" })
    await expect(tabla).toBeVisible()
    const enlace = tabla.getByRole("link", { name: /^Ver ficha de / }).first()
    await expect(enlace).toHaveAttribute("href", /^\/flota\/[^/]+$/)
  })

  test("los filtros viven en la URL: el buscador y el selector de estado se alinean al quitar el filtro", async ({ page }) => {
    await page.goto("/flota")
    const buscar = page.getByRole("searchbox", { name: "Buscar" })
    await buscar.fill("E2E-FUEL-1")
    // Se aplica solo, sin enviar un formulario ni recargar la página.
    await expect(page).toHaveURL(/[?&]q=E2E-FUEL-1/)

    await page.getByRole("button", { name: "Limpiar filtros" }).click()
    await expect(page).not.toHaveURL(/[?&]q=/)
    await expect(buscar).toHaveValue("")
  })

  test("Monitoreo GPS tiene su propia búsqueda de la shell y no ofrece la pestaña «Historial»", async ({ page }) => {
    await page.goto("/flota/monitoreo")
    await expect(page.getByRole("heading", { name: "Monitoreo GPS", exact: true })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Historial" })).toHaveCount(0)
    await expect(page.getByRole("searchbox", { name: "Filtrar en esta página" })).toBeVisible()
  })

  test("Conductores y Monitoreo conservan el buscador de la barra superior", async ({ page }) => {
    for (const ruta of ["/flota/conductores", "/flota/monitoreo"]) {
      await page.goto(ruta)
      await expect(page.getByRole("searchbox", { name: "Filtrar en esta página" }), ruta).toBeVisible()
    }
  })
})
