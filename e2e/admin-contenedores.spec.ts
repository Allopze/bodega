import { test, expect } from "@playwright/test"
import postgres from "postgres"
import { expectPageTitle, login } from "./helpers"

/**
 * Catálogo de contenedores: alta en Administración, uso como sujeto obligatorio
 * de la inspección del Anexo 14, y retención de la ficha que ya es evidencia.
 *
 * `RUN` desambigua el código entre reintentos: el código es único global, así
 * que repetir "CT-E2E-NEW" en un retry chocaría con el índice único.
 */
const RUN = Date.now().toString(36).slice(-5).toUpperCase()
const NUEVO = `CT-E2E-${RUN}`

test.setTimeout(180_000)

test.describe("Catálogo de contenedores", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("da de alta un contenedor y lo deja disponible como sujeto de inspección", async ({ page }) => {
    await page.goto("/admin/contenedores")
    await expectPageTitle(page, "Catálogo de contenedores")

    // El fixture de la faena E2E ya está en el padrón.
    await expect(page.getByRole("cell", { name: "CT-E2E-001", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Nuevo contenedor" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Código").fill(NUEVO)
    await dialog.getByLabel("Ubicación").fill("Rampa sur E2E")
    await dialog.getByRole("button", { name: "Agregar" }).click()

    await expect(page.getByRole("cell", { name: NUEVO, exact: true })).toBeVisible()

    const client = postgres(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL!, { max: 1 })
    try {
      const rows = await client`select code, location, status from prevention_containers where code = ${NUEVO}`
      expect(rows).toHaveLength(1)
      expect(rows[0]!.location).toBe("Rampa sur E2E")
      expect(rows[0]!.status).toBe("operational")
    } finally {
      await client.end()
    }
  })

  test("la ficha muestra el historial de inspecciones del contenedor", async ({ page }) => {
    await page.goto("/admin/contenedores")
    await page.getByRole("link", { name: "CT-E2E-001" }).click()
    await expect(page.getByRole("heading", { name: "CT-E2E-001" }).first()).toBeVisible()
    await expect(page.getByText("Inspecciones de este contenedor")).toBeVisible()
    await expect(page.getByText("Acopio norte E2E").first()).toBeVisible()
  })
})
