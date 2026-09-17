import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: aplicar un preset de planificación desde la pestaña "Actividades" del
 * editor y ver la carga por rol resultante.
 *
 * Usa `pdtp-draft-e2e` (el único programa editable que siembra
 * `e2e/setup-db.ts`) y su actividad fixture EXCLUSIVA "Actividad de
 * planificación por preset E2E" (N°92, responsables `sup` + `jt`, sin
 * planificación al sembrar). La suite corre con un solo worker, en serie y en
 * orden alfabético contra la misma base (`playwright.config.ts`), y las otras
 * dos actividades fixture del mismo programa NO son ancla segura para este
 * spec:
 *   - N°90 termina retirada por `pdtp-annual-adjustments.spec.ts` (corre antes).
 *   - N°91 la usa `pdtp-objetivos.spec.ts` para su propio filtro.
 * La N°92 es exclusiva de este archivo — ningún otro spec la toca.
 */
test.describe("PDTP — presets de planificación y carga por rol", () => {
  test("aplica 'Diario (5 por semana)' a la actividad fixture y la carga por rol lo refleja", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // La planificación global vive en un `<details>` colapsado dentro de la
    // pestaña "Actividades" (la que abre por defecto).
    await page.locator("summary").filter({ hasText: "Programación global avanzada" }).first().click()

    // La tabla "Actividades guardadas" (más arriba en la misma pestaña) también
    // tiene una fila con el mismo nombre y su propia casilla de selección (otra
    // función, ajena a esta): hay que acotar a la tabla de planificación
    // semanal, identificada por su caption accesible, para no matchear las dos.
    const planningTable = page.getByRole("table", { name: /Planificación semanal/ })
    const row = planningTable.getByRole("row").filter({ hasText: "Actividad de planificación por preset E2E" })
    await expect(row).toBeVisible()

    await row.getByRole("checkbox", { name: "Seleccionar la actividad N°92" }).check()
    await expect(page.getByText("1 seleccionada")).toBeVisible()

    await page.getByRole("button", { name: "Aplicar patrón…" }).click()
    const dialog = page.getByRole("dialog", { name: "Aplicar patrón de planificación" })
    await expect(dialog).toBeVisible()

    await dialog.getByRole("combobox", { name: "Patrón" }).click()
    await page.getByRole("option", { name: "Diario (n por semana)" }).click()
    // El valor por defecto ya es 5 (`defaultParamsFor("daily")`); no hace
    // falta tocar el campo de cantidad.
    await expect(dialog.getByLabel("Cantidad por semana")).toHaveValue("5")

    await dialog.getByRole("button", { name: "Aplicar" }).click()
    // Sin conflictos, el diálogo se cierra solo y avisa por toast (no se
    // queda esperando un "Cerrar" en una pantalla de resultado: el
    // `router.refresh()` que dispara al aplicar remonta todo el editor —
    // `PdtpBuilderTabs` vive bajo una `key` en `page.tsx` — así que cualquier
    // estado que el diálogo mantuviera para después del refresh desaparecería
    // con él antes de que el usuario llegara a verlo; ver JSDoc de
    // `ApplyPresetDialog`). La llamada recorre server action + Postgres real:
    // más lenta que el timeout por defecto de `expect` (5 s) bajo el
    // `resource-guard` local, así que se le da el mismo presupuesto que
    // `actionTimeout`.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/1 actividad actualizada/)).toBeVisible()

    // El remonte también colapsa "Programación global avanzada" (un
    // `<details>` nativo sin estado persistido, a diferencia de "Carga por
    // rol" más abajo): hay que reabrirlo para leer la fila.
    await page.locator("summary").filter({ hasText: "Programación global avanzada" }).first().click()

    // El preset "diario" sin restricción de meses proyecta 48 celdas de
    // cantidad 5: 240 en el total de la fila.
    await expect(row.getByRole("cell").last()).toHaveText("240")

    // Panel de carga por rol: sup y jt son los únicos responsables de esta
    // actividad (las otras dos fixture del programa no tienen responsables
    // asignados), así que ambos deben mostrar exactamente 240.
    await page.locator("summary").filter({ hasText: "Carga por rol" }).click()
    const roleLoadTable = page.getByRole("table", { name: "Carga de planificación por responsable" })
    const supRow = roleLoadTable.getByRole("row").filter({ hasText: "sup" })
    await expect(supRow).toBeVisible()
    await expect(supRow.getByRole("cell").last()).toHaveText("1")
    await expect(supRow).toContainText("240")

    const jtRow = roleLoadTable.getByRole("row").filter({ hasText: "jt" })
    await expect(jtRow).toContainText("240")
  })
})
