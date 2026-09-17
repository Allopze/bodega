import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: objetivos del programa PDTP — alta desde el editor, asignación por
 * actividad y filtro en el visor transversal de actividades.
 *
 * Usa `pdtp-draft-e2e` (el único programa editable que siembra
 * `e2e/setup-db.ts`) y sus dos actividades fixture en la hoja general:
 * "Actividad ajustable anual E2E" (N°90) y "Actividad sin objetivo E2E"
 * (N°91). La segunda existe sólo para que el filtro tenga algo que excluir —
 * sin ella, filtrar por objetivo se vería igual que no filtrar.
 *
 * El objetivo se asigna a la N°91 y no a la N°90 a propósito: la suite
 * completa corre en serie y en orden alfabético contra la misma base
 * (`playwright.config.ts`: `workers: 1`, `fullyParallel: false`), y
 * `pdtp-annual-adjustments.spec.ts` (que corre antes, alfabéticamente) retira
 * la N°90 al final de su propia corrida. Una actividad retirada tiene su
 * select de objetivo deshabilitado (coherente con el resto de su fila), así
 * que apuntar la asignación a la N°90 haría este spec depender del orden y
 * del estado que deja otro archivo. La N°91 es exclusiva de este spec.
 */
test.describe("PDTP — objetivos y filtro de actividades", () => {
  test("crea un objetivo, lo asigna a una actividad y el visor de actividades filtra por ese objetivo", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // El catálogo de objetivos vive en un `<details>` colapsado dentro de la
    // pestaña "Actividades" (la que abre por defecto).
    await page.locator("summary").filter({ hasText: "Objetivos del programa" }).first().click()

    await page.getByRole("button", { name: "Agregar objetivo" }).click()
    const createDialog = page.getByRole("dialog", { name: "Agregar objetivo" })
    await createDialog.getByLabel(/Código/).fill("E2E")
    await createDialog.getByLabel(/Nombre/).fill("Objetivo E2E")
    await createDialog.getByRole("button", { name: "Guardar" }).click()
    await expect(createDialog).not.toBeVisible()
    await expect(page.getByRole("cell", { name: "Objetivo E2E" })).toBeVisible()

    // Asigna el objetivo recién creado a "Actividad sin objetivo E2E" (N°91)
    // desde el select de su fila, en la tabla de actividades guardadas.
    const activityRow = page.getByRole("row").filter({ hasText: "Actividad sin objetivo E2E" })
    await activityRow.getByRole("combobox", { name: "Objetivo de la actividad 91" }).click()
    await page.getByRole("option", { name: /Objetivo E2E/ }).click()
    // El select se re-renderiza tras `router.refresh()`; su valor confirma
    // que la asignación llegó a la base antes de navegar al visor.
    await expect(activityRow.getByRole("combobox", { name: "Objetivo de la actividad 91" })).toContainText("Objetivo E2E")

    // Visor transversal: sin filtro, las dos actividades de la hoja general
    // son visibles.
    await page.goto("/prevencion/pdtp/actividades?programa=pdtp-draft-e2e&anio=2027&vista=anual")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("row").filter({ hasText: "Actividad ajustable anual E2E" })).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: "Actividad sin objetivo E2E" })).toBeVisible()

    // Filtrar por el objetivo recién creado deja sólo la actividad asignada.
    await page.getByRole("combobox", { name: "Seleccionar objetivo" }).click()
    await page.getByRole("option", { name: /Objetivo E2E/ }).click()
    await page.waitForLoadState("networkidle").catch(() => undefined)

    await expect(page).toHaveURL(/[?&]objetivo=/)
    await expect(page.getByRole("row").filter({ hasText: "Actividad sin objetivo E2E" })).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: "Actividad ajustable anual E2E" })).not.toBeVisible()
  })
})
