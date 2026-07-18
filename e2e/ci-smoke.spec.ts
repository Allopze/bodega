import { expect, test } from "@playwright/test"
import { login } from "./helpers"

const CRITICAL_ROUTES = [
  "/dashboard",
  "/solicitudes",
  "/aprobaciones",
  "/compras",
  "/recepcion",
  "/combustibles",
  "/admin/trabajadores",
  "/admin/roles",
]

test.describe("Critical route smoke", () => {
  for (const route of CRITICAL_ROUTES) {
    test(`${route} carga con sesión admin`, async ({ page }) => {
      await login(page)
      const response = await page.goto(route)
      expect(response?.ok(), `La ruta ${route} no respondió correctamente`).toBeTruthy()
      await expect(page.locator("main")).toBeVisible()
      await expect(page).not.toHaveURL(/\/login/)
    })
  }
})
