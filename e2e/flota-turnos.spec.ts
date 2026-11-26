import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login, textoVisible } from "./helpers"

/**
 * `/flota/turnos` («Turnos y ralentí»): el administrador de contrato registra quién
 * operó un equipo en un turno y la plataforma le pone el % de ralentí con los
 * tramos de VisionLink.
 *
 * El seed (`e2e/setup-db.ts`, bloque «Turnos y ralentí») enciende el submódulo y deja:
 * - `contrato@e2e.chome.cl`, admin. de contrato de «Faena E2E»;
 * - `QA-TUR-01` (Faena E2E) con tramos por hora de AYER de 06 a 14: 1 h de ralentí y
 *   3 h de trabajo → 25,0 % con meta 30 % («En meta»);
 * - `QA-TUR-02` en otra faena (no debe ofrecerse);
 * - el trabajador «QA Operador Turnos» (Operador de maquinaria).
 *
 * La vista Día abre por defecto en ayer. Las tablas se dibujan también como tarjetas
 * móviles ocultas: los textos se buscan con `textoVisible`.
 */

const CONTRATO = "contrato@e2e.chome.cl"
const OPERADOR = "QA Operador Turnos"

/** Elige en un Combobox del formulario: escribe y toma la opción; reintenta si el clic llegó antes de hidratar. */
async function pickCombobox(page: Page, id: string, query: string, option: RegExp) {
  await expect(async () => {
    const input = page.locator(`#${id}`)
    await input.click()
    await input.fill(query)
    await page.getByRole("option", { name: option }).click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** Abre un OptionSelect (Radix) y elige la opción exacta. */
async function pickSelect(page: Page, id: string, option: string) {
  await expect(async () => {
    await page.locator(`#${id}`).click()
    await page.getByRole("option", { name: option, exact: true }).click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

test.describe.serial("Turnos y ralentí", () => {
  test("el admin. de contrato registra un turno y ve su % de ralentí y el ranking", async ({ page }) => {
    await login(page, CONTRATO)
    await page.goto("/control-operacional")
    // En el Panel el grupo abierto del menú es Seguimiento: Flota queda plegado y su enlace no existe hasta abrirlo.
    // Se reintenta el clic: uno anterior a la hidratación mueve el foco pero no corre el manejador.
    const grupoFlota = page.getByRole("navigation", { name: "Navegación", exact: true }).getByRole("button", { name: /^Flota/ })
    await expect(async () => {
      if ((await grupoFlota.getAttribute("aria-expanded")) === "false") await grupoFlota.click()
      await expect(grupoFlota).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    await page.getByRole("link", { name: "Turnos y ralentí", exact: true }).first().click()
    await expect(page).toHaveURL(/\/flota\/turnos/)
    await expectPageTitle(page, "Turnos y ralentí")

    // El equipo de otra faena no se ofrece.
    const vehicle = page.locator("#shift-vehicle")
    await expect(async () => {
      await vehicle.click()
      await vehicle.fill("QA-TUR")
      await expect(page.getByRole("option", { name: /QA-TUR-01/ })).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    await expect(page.getByRole("option", { name: /QA-TUR-02/ })).toHaveCount(0)
    await page.keyboard.press("Escape")

    await pickCombobox(page, "shift-vehicle", "QA-TUR-01", /QA-TUR-01/)
    await pickSelect(page, "shift-preset", "Mañana 06–14")
    await pickCombobox(page, "shift-operator", "QA Operador", new RegExp(OPERADOR))
    await page.getByRole("button", { name: "Guardar turno", exact: true }).click()

    const turnos = page.getByRole("region", { name: "Turnos del día" })
    const fila = turnos.getByRole("row").filter({ hasText: "QA-TUR-01" }).filter({ hasText: OPERADOR })
    await expect(fila).toBeVisible({ timeout: 20_000 })
    await expect(fila).toContainText(/25,0\s?%/)
    await expect(fila).toContainText("En meta")

    // Ranking de operadores: 1 = menor % de ralentí.
    await page.getByRole("link", { name: "Operadores", exact: true }).click()
    await expect(page).toHaveURL(/vista=operadores/)
    const ranking = page.getByRole("row").filter({ hasText: OPERADOR }).filter({ visible: true })
    await expect(ranking).toBeVisible({ timeout: 20_000 })
    await expect(ranking.getByRole("cell").first()).toHaveText("1")
    await expect(textoVisible(page, /Ranking: 1 = menor % de ralentí/)).toBeVisible()
  })

  test("un usuario sin el permiso no entra", async ({ page }) => {
    await login(page, "jt@e2e.chome.cl")
    await page.goto("/flota/turnos")
    await expect(page).toHaveURL(/\/forbidden/)
  })
})
