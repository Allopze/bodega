import { expect, test } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

test.describe("MIPER — recorrido inicial de escritorio", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
  })

  test("la portada explica el trabajo y prioriza faena, estado, pendiente y acción", async ({ page }) => {
    await page.goto("/prevencion/miper")
    await expectPageTitle(page, "Matriz de riesgos")
    const table = page.getByRole("table", { name: "MIPER por faena" })
    await expect(table.getByRole("columnheader")).toHaveText(["Faena", "Estado", "Trabajo pendiente", "Acción"])
    await expect(page.getByRole("banner").getByRole("button", { name: "Crear matriz", exact: true })).toBeVisible()
    await expect(page.getByText("Identificar peligros → Evaluar riesgos → Definir medidas → Revisar y dar seguimiento.")).toBeHidden()
    await page.getByText("Cómo se trabaja aquí").click()
    await expect(page.getByText(/Identificar peligros → Evaluar riesgos/)).toBeVisible()
  })

  test("Inicio lleva completos a completos y mantiene el dato sin enlace cuando es cero", async ({ page }) => {
    await page.goto("/prevencion/miper/riskmatrix-revision-e2e?tab=resumen")
    await expect(page.getByRole("tab", { name: "Inicio", selected: true })).toBeVisible()
    const complete = page.getByRole("link", { name: /^Riesgos completos/ })
    await expect(complete).toHaveAttribute("href", /completitud=completos/)
    await complete.click()
    await expect(page).toHaveURL(/completitud=completos/)
    await expect(page.getByRole("heading", { name: "Lista de riesgos" })).toBeVisible()

    await page.goto("/prevencion/miper/riskmatrix-masivas-e2e?tab=resumen")
    await expect(page.getByText("Riesgos completos", { exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: /^Riesgos completos/ })).toHaveCount(0)
  })

  test("la estructura, resultados y selección tienen modos visibles sin filtros", async ({ page }) => {
    await page.goto("/prevencion/miper/riskmatrix-masivas-e2e?tab=matriz")
    await expect(page.getByRole("heading", { name: "Por actividades y tareas" })).toBeVisible()
    await page.getByRole("button", { name: "Seleccionar riesgos" }).click()
    await expect(page).toHaveURL(/vista=resultados/)
    await expect(page.getByRole("heading", { name: "Lista de riesgos" })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Seleccionar los \d+ resultados$/ })).toBeVisible()
    await page.getByRole("button", { name: "Terminar selección" }).click()
    await page.getByRole("button", { name: "Por actividad", exact: true }).click()
    await expect(page).toHaveURL(/vista=estructura/)
    await expect(page.getByRole("heading", { name: "Por actividades y tareas" })).toBeVisible()
  })
})
