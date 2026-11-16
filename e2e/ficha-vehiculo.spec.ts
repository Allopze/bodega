import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: la ficha única del vehículo (crítica UI/UX de Control operacional, 2026-11-15, paso 4a).
 *
 * Antes había tres fichas por vehículo —Flota, Mantención y Combustible— con los datos del
 * equipo repetidos y botones para saltar entre ellas. Ahora hay una dirección, `/flota/[id]`,
 * con «Resumen» y una pestaña por área; las direcciones viejas redirigen a su pestaña y
 * conservan la query.
 *
 * El administrador ve las tres áreas. Lo que ve cada perfil (una sola área sin pestañas, 404 en
 * otra faena) lo fijan `lib/services/vehicle-ficha.test.ts` y `app/(app)/flota/[id]/ficha.test.tsx`.
 *
 * Locators: `getByRole` ignora la copia móvil (`lg:hidden`) de las acciones del `PageHeader`.
 */

const VEHICLE = "fuel-veh-e2e"

const fichaTabs = (page: Page) => page.getByRole("navigation", { name: /^Ficha de / })

test.describe("Ficha única del vehículo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("abre en el Resumen, con una pestaña por área y una línea por área que lleva a su pestaña", async ({ page }) => {
    await page.goto(`/flota/${VEHICLE}`)
    const tabs = fichaTabs(page)
    await expect(tabs).toBeVisible()
    for (const name of ["Resumen", "Flota", "Mantención", "Combustible"]) {
      await expect(tabs.getByRole("link", { name, exact: true })).toBeVisible()
    }
    await expect(tabs.getByRole("link", { name: "Resumen", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("heading", { name: /^Cómo está / })).toBeVisible()
    await expect(page.getByRole("link", { name: /Ver Mantención/ })).toHaveAttribute("href", `/flota/${VEHICLE}/mantencion`)
    await expect(page.getByRole("link", { name: /Ver documentos/ })).toHaveAttribute("href", `/flota/${VEHICLE}/flota#documentos`)
    // La ficha no tiene una lista que el buscador de la TopBar pueda filtrar.
    await expect(page.getByRole("searchbox", { name: "Filtrar en esta página" })).toHaveCount(0)
  })

  test("las pestañas son rutas: cada una se marca activa y ninguna ofrece el buscador de la shell", async ({ page }) => {
    await page.goto(`/flota/${VEHICLE}`)
    for (const [name, path] of [["Flota", "flota"], ["Mantención", "mantencion"], ["Combustible", "combustible"]] as const) {
      await fichaTabs(page).getByRole("link", { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/flota/${VEHICLE}/${path}`))
      await expect(fichaTabs(page).getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page")
      await expect(page.getByRole("searchbox", { name: "Filtrar en esta página" })).toHaveCount(0)
    }
    // Flota ya no tiene los botones que llevaban a las otras dos fichas.
    await page.goto(`/flota/${VEHICLE}/flota`)
    await expect(page.getByRole("link", { name: "Ficha de mantención", exact: true })).toHaveCount(0)
  })

  test("las direcciones viejas llevan a su pestaña sin perder la query", async ({ page }) => {
    // Un 308 de borde, no un 200 que redirige en el cliente: con el `loading.tsx` de Equipos, la página vieja
    // respondía con el esqueleto de la lista y una segunda carga detrás (crítica 2026-11-15).
    const vieja = await page.request.get(`/mantencion/equipos/${VEHICLE}?vida=40`, { maxRedirects: 0 })
    expect(vieja.status()).toBe(308)
    expect(vieja.headers()["location"]).toMatch(new RegExp(`/flota/${VEHICLE}/mantencion\\?vida=40$`))
    for (const hermana of ["nuevo", "importar", "incorporar"]) {
      expect((await page.request.get(`/mantencion/equipos/${hermana}`, { maxRedirects: 0 })).headers()["location"] ?? "", hermana).not.toContain("/flota/")
    }
    await page.goto(`/mantencion/equipos/${VEHICLE}?vida=40`)
    await expect(page).toHaveURL(new RegExp(`/flota/${VEHICLE}/mantencion\\?vida=40$`))
    await page.goto(`/combustibles/consumo/equipos/${VEHICLE}?periodo=2026-10`)
    await expect(page).toHaveURL(new RegExp(`/flota/${VEHICLE}/combustible\\?periodo=2026-10$`))
    // El período de Combustible viaja al cambiar de pestaña.
    await fichaTabs(page).getByRole("link", { name: "Resumen", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/flota/${VEHICLE}\\?periodo=2026-10$`))
  })
})
