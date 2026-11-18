import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: «Traslado de equipos entre faenas».
 *
 * El equipo del spec es `fuel-veh-traslado-e2e` (código `QA-TRAS-1`, sembrado en `e2e/setup-db.ts` en
 * «Faena E2E»): lo traslada a «Faena Restringida E2E» y después anula el traslado, así que termina donde
 * empezó y ningún otro spec depende de dónde queda. El interruptor `submodule.enabled:flota:/flota/traslados`
 * lo enciende el mismo seed (la migración lo deja apagado).
 *
 * Locators: `getByRole` ignora la copia móvil (tarjetas `md:hidden`) de la lista y del encabezado, por eso
 * no hay `.first()`. El modal se acota con su `dialog`; el botón «Anular» de la fila lleva
 * `aria-label="Anular traslado TR-…"`, así que el del diálogo se pide con `exact: true`.
 */

const VEHICLE_ID = "fuel-veh-traslado-e2e"
const VEHICLE_CODE = "QA-TRAS-1"
const ORIGIN = "Faena E2E"
const DESTINATION = "Faena Restringida E2E"

test.describe("Traslado de equipos entre faenas", () => {
  test("traslada un equipo, lo ve en la lista y en su recorrido, y al anular vuelve a su faena", async ({ page }) => {
    // Motivos únicos por corrida: si un reintento deja un traslado atrás, no se confunde con el nuevo.
    const run = Date.now()
    const reason = `QA_traslado ${run} por cambio de contrato`
    const voidReason = `QA_anulación ${run} registrado por error`
    const stays = page.locator("#recorrido-faenas").getByRole("listitem")

    await login(page)

    // La ficha parte con una sola estadía: la de alta, en la faena de origen.
    await page.goto(`/flota/${VEHICLE_ID}/flota`)
    await expect(page.getByRole("heading", { name: "Recorrido por faena", level: 2 })).toBeVisible()
    await expect(stays).toHaveCount(1)
    await expect(stays.first()).toContainText(ORIGIN)

    // 1) Registrar el traslado desde Flota.
    await page.goto("/flota")
    await page.getByRole("button", { name: "Trasladar equipos", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Trasladar equipos" })
    await expect(dialog).toBeVisible()

    await dialog.getByRole("combobox", { name: "A la faena" }).click()
    await page.getByRole("option", { name: DESTINATION, exact: true }).click()
    await dialog.getByRole("textbox", { name: "Motivo" }).fill(reason)
    await dialog.getByRole("textbox", { name: "Autorizado por" }).fill("QA_Gerencia")

    // El buscador deja sólo este equipo a la vista y la casilla de grupo marca únicamente los visibles.
    await dialog.getByRole("searchbox", { name: "Buscar por código, patente o marca" }).fill(VEHICLE_CODE)
    await dialog.getByRole("checkbox", { name: `Marcar todos los equipos de ${ORIGIN}` }).check()
    await expect(dialog.getByRole("checkbox", { name: `Trasladar ${VEHICLE_CODE}` })).toBeChecked()

    await dialog.getByRole("button", { name: "Trasladar", exact: true }).click()
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /TR-\d+/ })).toBeVisible()
    await expect(dialog).toBeHidden()

    // 2) La lista de traslados muestra la fila, vigente.
    await page.goto("/flota/traslados")
    const row = page.getByRole("row").filter({ hasText: reason })
    await expect(row).toBeVisible()
    await expect(row).toContainText(VEHICLE_CODE)
    await expect(row).toContainText(DESTINATION)
    await expect(row).toContainText("Vigente")

    // 3) La ficha del equipo cuenta dos estadías: la de origen, cerrada, y la del destino, abierta.
    await page.goto(`/flota/${VEHICLE_ID}/flota`)
    await expect(stays).toHaveCount(2)
    await expect(stays.first()).toContainText(ORIGIN)
    await expect(stays.last()).toContainText(DESTINATION)
    await expect(stays.last()).toContainText(/TR-\d+/)

    // 4) Anular el traslado exige motivo y deja el equipo otra vez con una sola estadía.
    await page.goto("/flota/traslados")
    await page.getByRole("row").filter({ hasText: reason }).getByRole("button", { name: /^Anular traslado TR-/ }).click()
    const voidDialog = page.getByRole("dialog", { name: /^Anular traslado TR-/ })
    await expect(voidDialog).toBeVisible()
    await voidDialog.getByRole("textbox", { name: "Motivo de la anulación" }).fill(voidReason)
    await voidDialog.getByRole("button", { name: "Anular traslado", exact: true }).click()
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /TR-\d+ anulado/ })).toBeVisible()
    await expect(voidDialog).toBeHidden()

    const voidedRow = page.getByRole("row").filter({ hasText: reason })
    await expect(voidedRow).toContainText("Anulado")
    await expect(voidedRow.getByRole("button", { name: /^Anular traslado/ })).toHaveCount(0)

    await page.goto(`/flota/${VEHICLE_ID}/flota`)
    await expect(stays).toHaveCount(1)
    await expect(stays.first()).toContainText(ORIGIN)
  })

  test("un usuario sin permisos de flota no ve «Trasladar equipos» ni puede abrir Flota", async ({ page }) => {
    // `scoped@e2e.chome.cl` (solicitante_faena) no tiene `flota:view` ni `flota:transfer`: Flota lo manda a
    // /forbidden, y la lista de traslados también. Se asegura lo uno y lo otro, no sólo la ausencia del botón.
    await login(page, "scoped@e2e.chome.cl", "scoped2026")
    await page.goto("/flota")
    await expect(page).toHaveURL(/\/forbidden/)
    await expect(page.getByRole("button", { name: "Trasladar equipos", exact: true })).toHaveCount(0)

    await page.goto("/flota/traslados")
    await expect(page).toHaveURL(/\/forbidden/)
    await expect(page.getByRole("button", { name: "Trasladar equipos", exact: true })).toHaveCount(0)
  })
})
