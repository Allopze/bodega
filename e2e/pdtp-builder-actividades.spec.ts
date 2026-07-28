import { expect, test, type Page } from "@playwright/test"
import { login, setPdtpResponsable } from "./helpers"

/**
 * E2E: PDTP — tabs "Objetivos" y "Actividades" del builder
 * (`/prevencion/pdtp/[programId]/editar`). Antes de este spec solo se
 * verificaba que las tabs existieran, nunca se interactuaba con su
 * contenido real.
 */

async function goToActividades(page: Page) {
  await page.getByRole("tab", { name: /Actividades/ }).click()
  return page.locator("table")
}

async function createDraftProgram(page: Page, title: string): Promise<string> {
  await page.goto("/prevencion/pdtp/nuevo")
  await page.getByLabel("Título del programa").fill(title)
  await page.getByRole("button", { name: "Crear programa" }).click()
  await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })
  return new URL(page.url()).pathname.split("/")[3]!
}

async function addActivity(page: Page, activity: string, objective: string, expectedCount: number) {
  await goToActividades(page)
  await page.getByLabel("Nombre del nuevo objetivo").fill(objective)
  await page.getByLabel("¿Qué actividad preventiva se realizará?").fill(activity)
  await setPdtpResponsable(page)
  await page.getByRole("button", { name: "Guardar actividad" }).click()
  // No se espera el toast "Actividad guardada.": el submit exitoso dispara
  // router.refresh(), que a veces remonta las tabs antes de que Playwright
  // llegue a leer el mensaje transitorio. El contador de actividades de la
  // cabecera sí es estable porque viene de datos de servidor.
  await expect(page.getByText(`${expectedCount} actividad(es)`, { exact: false })).toBeVisible({ timeout: 15_000 })
}

test.describe("PDTP — Builder: Actividades", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("crear, reordenar, duplicar, editar y eliminar actividades", async ({ page }) => {
    const title = "Programa Builder Actividades E2E"
    await createDraftProgram(page, title)
    await addActivity(page, "Actividad A", "Objetivo Compartido", 1)
    await addActivity(page, "Actividad B", "Objetivo Compartido", 2)

    let table = await goToActividades(page)
    await expect(table).toContainText("Actividad A")
    await expect(table).toContainText("Actividad B")

    // Reordenar: B sube sobre A. Se espera el resultado en la página viva
    // (sin recargar) para no cortar a mitad de camino la mutación en curso
    // — recargar de inmediato puede abortar el fetch del server action.
    await goToActividades(page)
    const rowB = page.getByRole("row").filter({ hasText: "Actividad B" })
    await rowB.getByRole("button", { name: "Subir" }).click()
    await expect(page.locator("tbody tr").first()).toContainText("Actividad B", { timeout: 15_000 })

    // Duplicar A: aparece una segunda fila con el mismo texto ("(copia)").
    // router.refresh() remonta BuilderTabs de vuelta a "Datos básicos" de
    // forma consistente tras esta mutación — se espera primero el contador
    // de la cabecera (fuera de las tabs, no se remonta) como prueba de que
    // la duplicación ya terminó en el servidor, y solo entonces se vuelve
    // a la tab para leer la tabla ya actualizada.
    await goToActividades(page)
    const rowA = page.getByRole("row").filter({ hasText: "Actividad A" })
    await rowA.getByRole("button", { name: "Duplicar" }).click()
    await expect(page.getByText("3 actividad(es)", { exact: false })).toBeVisible({ timeout: 15_000 })
    await goToActividades(page)
    await expect(page.getByRole("row").filter({ hasText: "Actividad A" })).toHaveCount(2)

    // Editar: cambia el texto de una de las actividades A.
    await page.getByRole("row").filter({ hasText: "Actividad A" }).first().getByRole("button", { name: "Editar" }).click()
    const editDialog = page.getByRole("dialog", { name: /Editar actividad/ })
    await editDialog.getByLabel("Actividad preventiva").fill("Actividad A editada")
    await editDialog.getByRole("button", { name: "Guardar" }).click()
    await expect(editDialog).not.toBeVisible()
    table = await goToActividades(page)
    await expect(table).toContainText("Actividad A editada", { timeout: 15_000 })

    // Eliminar la actividad B.
    await page.getByRole("row").filter({ hasText: "Actividad B" }).getByRole("button", { name: "Eliminar" }).click()
    const confirmDialog = page.getByRole("dialog", { name: "¿Eliminar actividad?" })
    await confirmDialog.getByRole("button", { name: "Eliminar" }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect(page.getByText("2 actividad(es)", { exact: false })).toBeVisible({ timeout: 15_000 })
    await goToActividades(page)
    await expect(page.getByRole("row").filter({ hasText: "Actividad B" })).toHaveCount(0)
  })

  test("renombrar el objetivo compartido desde la tab Objetivos", async ({ page }) => {
    await createDraftProgram(page, "Programa Builder Objetivos E2E")
    await addActivity(page, "Actividad del objetivo", "Objetivo Original E2E", 1)

    await page.getByRole("tab", { name: /Objetivos/ }).click()
    // El input de renombrar objetivo no tiene label/aria-label asociado y es
    // el único textbox de esta tab con un solo objetivo: se ubica por rol.
    const objectiveInput = page.getByRole("tabpanel").getByRole("textbox")
    await expect(objectiveInput).toHaveValue("Objetivo Original E2E")
    await objectiveInput.fill("Objetivo Renombrado E2E")
    await page.getByRole("button", { name: "Guardar" }).click()

    await page.reload()
    await page.getByRole("tab", { name: /Objetivos/ }).click()
    await expect(page.getByRole("tabpanel").getByRole("textbox")).toHaveValue("Objetivo Renombrado E2E")
  })
})
