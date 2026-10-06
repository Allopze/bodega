import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Seguimiento de solicitudes (`/seguimiento`, antes `/bodega/trazabilidad`).
 *
 * Covers:
 *   • Carga de la vista consolidada.
 *   • Las dos pestañas (seguimiento por faena y búsqueda por código).
 *   • Las redirecciones de compatibilidad desde `/trazabilidad` y `/bodega/trazabilidad`.
 *
 * La pantalla se mudó de Bodega a Adquisiciones y abre en "Todas las faenas"
 * para quien ve más de una; las URLs viejas redirigen conservando la query.
 */
test.describe("Seguimiento de solicitudes", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista consolidada carga correctamente", async ({ page }) => {
    await page.goto("/seguimiento")

    await expect(
      page.getByRole("heading", { name: "Seguimiento de solicitudes" }),
    ).toBeVisible()
    // La descripción existe dos veces: el bloque semántico del PageHeader y su
    // eco visual en la barra superior. Una vez hidratada la cabecera, un
    // selector sin acotar viola el modo estricto de forma intermitente.
    await expect(page.getByText(/Qué pasó con cada solicitud/i).first()).toBeVisible()
    await expect(page.getByLabel("Seleccionar faena")).toBeVisible()
  })

  test("la pestaña de búsqueda por código abre el buscador", async ({ page }) => {
    await page.goto("/seguimiento?faena=ws-audit-1")

    await page.getByRole("link", { name: /Buscar por código/i }).click()

    await expect(page).toHaveURL(/tab=documento/)
    await expect(page.getByRole("searchbox", { name: /Código del documento/i })).toBeVisible()
    // La faena viaja en la URL: perderla al cambiar de pestaña obligaba a
    // re-seleccionarla al volver.
    await expect(page).toHaveURL(/faena=ws-audit-1/)
  })

  test("las rutas legadas redirigen al seguimiento conservando la query", async ({ page }) => {
    await page.goto("/trazabilidad")
    await expect(page).toHaveURL(/\/seguimiento$/)
    await expect(
      page.getByRole("heading", { name: "Seguimiento de solicitudes" }),
    ).toBeVisible()

    await page.goto("/bodega/trazabilidad?tab=documento&faena=ws-audit-1")
    await expect(page).toHaveURL(/\/seguimiento\?tab=documento&faena=ws-audit-1/)
  })

  test("con más de una faena visible abre en Todas las faenas", async ({ page }) => {
    await page.goto("/seguimiento")

    const selector = page.getByLabel("Seleccionar faena")
    await expect(selector).toBeVisible()
    // Sólo aplica a quien ve varias faenas: el usuario del E2E es global.
    await expect(selector).toContainText("Todas las faenas")
  })
})
