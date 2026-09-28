import { test, expect, type Page } from "@playwright/test"
import { cerrarSesion, expectPageTitle, login, pickCurrentMonthDate, textoVisible } from "./helpers"

/**
 * E2E Spec: Gestión del cambio, de la solicitud a la aprobación.
 *
 * D1 (auditoría de Prevención 2026-09): la fecha de revisión posterior se
 * escribe sólo al aprobar, pero la ficha exigía esa misma fecha para habilitar
 * el botón "Aprobar cambio", que es el que abre el diálogo donde se declara.
 * Con las seis dimensiones evaluadas el botón seguía deshabilitado y ningún
 * cambio podía aprobarse nunca. Este recorrido es la regresión: crea un
 * cambio, evalúa las seis dimensiones y lo aprueba otra persona con la fecha.
 *
 * Dos usuarios porque la aprobación está segregada: quien solicita no ve los
 * botones de decisión. `comprador@e2e.chome.cl` tiene el rol administrador de
 * `e2e/setup-db.ts` y la misma faena, así que puede aprobar lo que solicitó
 * `admin@e2e.chome.cl`.
 */

const APPROVER_EMAIL = "comprador@e2e.chome.cl"

/** Mañana en la zona de operación: la aprobación exige una fecha posterior a hoy. */
function tomorrowInChile() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
  const [year, month, day] = today.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10)
}

async function evaluateAllDimensions(page: Page) {
  // Cada guardado revalida la ficha y el botón pasa a "Reevaluar": se toma
  // siempre el primer "Evaluar" que quede, hasta que no quede ninguno.
  for (let done = 0; done < 6; done++) {
    const evaluar = page.getByRole("button", { name: "Evaluar", exact: true }).first()
    await expect(evaluar).toBeVisible({ timeout: 30_000 })
    await evaluar.click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("textbox", { name: /Notas/ }).fill("El cambio no altera esta dimensión: control vigente suficiente.")
    await dialog.getByRole("button", { name: "Guardar evaluación", exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Evaluar", exact: true })).toHaveCount(5 - done, { timeout: 30_000 })
  }
}

test.describe("Prevención — Gestión del cambio", () => {
  test("un cambio con las seis dimensiones evaluadas se aprueba con su fecha de revisión", async ({ page }) => {
    test.setTimeout(240_000)
    const title = `QA_Cambio de proveedor E2E ${Date.now()}`

    // 1. Quien solicita crea el cambio desde el header de la lista.
    await login(page)
    await page.goto("/prevencion/gestion-cambio")
    await expectPageTitle(page, "Gestión del cambio")
    await page.getByRole("button", { name: "Nuevo cambio", exact: true }).first().click()
    const createDialog = page.getByRole("dialog")
    await createDialog.getByRole("textbox", { name: "Título" }).fill(title)
    await createDialog.getByRole("combobox", { name: "Tipo de cambio" }).click()
    await page.getByRole("option", { name: "Proveedor o contratista", exact: true }).click()
    await createDialog.getByRole("textbox", { name: /Descripción del cambio/ }).fill("Se reemplaza el proveedor de candados de bloqueo por uno certificado.")
    await createDialog.getByRole("textbox", { name: /Motivo/ }).fill("El proveedor anterior discontinuó la línea.")
    await createDialog.getByRole("button", { name: "Crear", exact: true }).click()
    await expect(createDialog).toBeHidden({ timeout: 30_000 })

    await page.getByRole("link", { name: title, exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/gestion-cambio\/[^/?]+$/, { timeout: 30_000 })
    const changeUrl = page.url()

    // 2. Se evalúan las seis dimensiones; el aviso de bloqueos desaparece.
    await expect(textoVisible(page, "El cambio no puede aprobarse todavía:")).toBeVisible()
    await evaluateAllDimensions(page)
    await expect(textoVisible(page, "El cambio no puede aprobarse todavía:")).toHaveCount(0)
    // Quien solicitó no decide su propio cambio.
    await expect(page.getByRole("button", { name: "Aprobar cambio", exact: true })).toHaveCount(0)

    // 3. Otra persona lo aprueba declarando la fecha de revisión posterior.
    await cerrarSesion(page)
    await login(page, APPROVER_EMAIL)
    await page.goto(changeUrl)
    const aprobar = page.getByRole("button", { name: "Aprobar cambio", exact: true })
    await expect(aprobar).toBeEnabled({ timeout: 30_000 })
    await aprobar.click()
    const approveDialog = page.getByRole("dialog")
    const reviewDate = tomorrowInChile()
    await pickCurrentMonthDate(page, "Seleccionar fecha", reviewDate)
    await approveDialog.getByRole("button", { name: "Aprobar", exact: true }).click()
    await expect(approveDialog).toBeHidden({ timeout: 30_000 })

    await expect(textoVisible(page, "Aprobado").first()).toBeVisible({ timeout: 30_000 })
    await expect(textoVisible(page, reviewDate)).toBeVisible()
    await expect(page.getByRole("button", { name: "Aprobar cambio", exact: true })).toHaveCount(0)
  })
})
