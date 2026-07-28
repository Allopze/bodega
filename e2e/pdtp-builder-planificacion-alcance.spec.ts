import { expect, test, type Page } from "@playwright/test"
import { login, setPdtpResponsable } from "./helpers"

/**
 * E2E: PDTP — tabs "Cuándo se realiza" (matriz de planificación) y "Datos
 * básicos → alcance por faena" del builder. Antes de este spec solo se
 * verificaba que las tabs existieran.
 */

async function createDraftProgramWithActivity(page: Page, title: string): Promise<string> {
  await page.goto("/prevencion/pdtp/nuevo")
  await page.getByLabel("Título del programa").fill(title)
  await page.getByRole("button", { name: "Crear programa" }).click()
  await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })
  const programId = new URL(page.url()).pathname.split("/")[3]!

  await page.getByRole("tab", { name: /Actividades/ }).click()
  await page.getByLabel("Nombre del nuevo objetivo").fill(`Objetivo ${title}`)
  await page.getByLabel("¿Qué actividad preventiva se realizará?").fill(`Actividad preventiva de ${title}`)
  await setPdtpResponsable(page)
  await page.getByRole("button", { name: "Guardar actividad" }).click()
  await expect(page.getByText(/1 actividad\(es\)/)).toBeVisible({ timeout: 15_000 })
  return programId
}

test.describe("PDTP — Builder: Cuándo se realiza", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("rellenar y guardar la matriz de planificación semanal", async ({ page }) => {
    await createDraftProgramWithActivity(page, "Programa Builder Planificacion E2E")
    await page.getByRole("tab", { name: /Cuándo se realiza/ }).click()

    await page.getByLabel("Cantidad a llenar").fill("3")
    await page.getByRole("button", { name: "Rellenar" }).click()
    // "Guardar" hace match parcial también con "Guardar cambios"/"Guardar
    // faenas" de Datos básicos — hace falta exact para no ambigüar cuando
    // BuilderTabs remonta de vuelta a esa tab (ver más abajo).
    const saveButton = page.getByRole("button", { name: "Guardar", exact: true })
    await saveButton.click()
    // router.refresh() remonta BuilderTabs de vuelta a "Datos básicos" de
    // forma consistente tras este guardado (incluso reafirmando la tab
    // después, vuelve a caer ahí), así que ninguna señal dentro de la tab
    // Planificación es fiable para confirmar que terminó. Se espera a que
    // la red se asiente antes de recargar — recargar antes de que el
    // fetch del autosave termine lo abortaría a mitad de camino.
    await page.waitForLoadState("networkidle")
    await page.reload()
    await page.getByRole("tab", { name: /Cuándo se realiza/ }).click()
    await expect(page.getByLabel("Ene · Semana 1")).toHaveValue("3")
  })
})

test.describe("PDTP — Builder: alcance por faena", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("restringir el programa a una faena y excluir una actividad", async ({ page }) => {
    await createDraftProgramWithActivity(page, "Programa Builder Alcance E2E")
    // El alcance es su propio paso: depende de que ya existan actividades.
    await page.getByRole("tab", { name: /Alcance/ }).click()

    await page.getByRole("checkbox", { name: /Faena E2E/ }).check()
    const saveWorksitesButton = page.getByRole("button", { name: "Guardar faenas" })
    await saveWorksitesButton.click()
    // "1 de N faenas marcadas" es estado local que cambia apenas se marca el
    // checkbox, antes de guardar — no sirve como señal de que el guardado ya
    // terminó. El botón sí: vuelve a deshabilitarse solo cuando el servidor
    // confirma y ya no hay cambios sin guardar.
    await expect(saveWorksitesButton).toBeDisabled({ timeout: 15_000 })

    await page.reload()
    await page.getByRole("tab", { name: /Alcance/ }).click()
    await expect(page.getByRole("checkbox", { name: /Faena E2E/ })).toBeChecked()

    const activityTrigger = page.getByRole("combobox", { name: "Actividad a excluir" })
    await activityTrigger.click()
    await page.getByRole("option", { name: /^N°1/ }).click()
    // Regresión del truncado del Select: con una opción larga seleccionada el
    // trigger conserva su altura de control. Sin truncado, el texto se partía
    // en varias líneas y se dibujaba fuera del borde, encima del encabezado.
    const triggerBox = await activityTrigger.boundingBox()
    expect(triggerBox!.height).toBeLessThanOrEqual(44)
    const valueStyle = await activityTrigger.evaluate((el) => {
      const span = el.querySelector(":scope > span")!
      const style = getComputedStyle(span)
      return {
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        // El nombre del fixture es más largo que la columna: si esto es false,
        // la precondición del test se rompió (columna más ancha), no el fix.
        clipped: span.scrollWidth > span.clientWidth,
      }
    })
    expect(valueStyle.whiteSpace).toBe("nowrap")
    expect(valueStyle.textOverflow).toBe("ellipsis")
    expect(valueStyle.clipped).toBe(true)

    await page.getByRole("combobox", { name: "Faena a excluir" }).click()
    await page.getByRole("option", { name: "Faena E2E" }).click()
    await page.getByPlaceholder("Motivo (mín. 10 caracteres)").fill("Esta faena no ejecuta esta actividad puntual.")
    await page.getByRole("button", { name: "Excluir" }).click()
    await expect(page.getByText(/N°1 — Faena E2E/)).toBeVisible({ timeout: 15_000 })
  })
})
