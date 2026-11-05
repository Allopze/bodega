import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login, selectRadixById, textoVisible } from "./helpers"

/**
 * Clasificación masiva de trabajadores (plan de vencimientos y licencias, Fase 7).
 *
 * Una dotación recién importada llega sin cargo: la vista «Sin cargo» de
 * `/admin/trabajadores` permite elegir a muchos y asignarles el cargo en un paso.
 * El recorrido crea sus propios datos —un cargo y dos trabajadores con prefijo
 * `QA_`— en vez de apoyarse en los trabajadores del seed: otros specs usan esos
 * trabajadores y reclasificarlos cambiaría sus capacidades preventivas.
 *
 * El cargo no lleva capacidades a propósito. «Conduce vehículos» metería a los
 * dos trabajadores de prueba en las obligaciones del PDTP por capacidad y
 * movería los conteos de otros specs que comparten la base; lo que el diálogo
 * cuenta cuando el cargo sí conduce («Pasarán a Conductores; N sin licencia
 * registrada») lo cubre `bulk-assign-dialog.test.tsx`.
 */

const SIN_CARGO_BAR = "Acciones sobre la selección"

/** Dígitos al final del rótulo de la pestaña: «Sin cargo 33». */
async function tabCount(tab: Locator): Promise<number> {
  const text = (await tab.innerText()).trim()
  const match = /(\d+)\s*$/.exec(text)
  if (!match) throw new Error(`La pestaña no muestra un contador: «${text}»`)
  return Number(match[1])
}

/** Alta de un trabajador sin elegir cargo: el formulario lo deja en «Sin clasificar». */
async function crearTrabajadorSinCargo(page: Page, firstName: string, lastName: string) {
  await page.getByRole("button", { name: /nuevo trabajador/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo trabajador" })
  await dialog.getByLabel("Nombre").fill(firstName)
  await dialog.getByLabel("Apellido").fill(lastName)
  await selectRadixById(page, "wrk-ws", "Faena E2E")
  await dialog.getByRole("button", { name: "Crear trabajador" }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

test("trabajadores: clasificar en bloque desde «Sin cargo»", async ({ page }) => {
  await login(page)
  const stamp = Date.now().toString(36)
  const cargoName = `QA_Conductor ${stamp}`
  const prefix = `QA_Clasif${stamp}`

  // ── Un cargo que exige A4 o A5, marcado con las fichas de licencia ─────────
  await page.goto("/admin/cargos")
  await page.getByRole("button", { name: /nuevo registro/i }).click()
  await page.getByRole("menuitem", { name: /nuevo cargo/i }).click()
  const cargoDialog = page.getByRole("dialog", { name: "Nuevo cargo" })
  await cargoDialog.getByRole("textbox", { name: /Código/ }).fill(`QA-COND-${stamp}`)
  await cargoDialog.getByRole("textbox", { name: /Nombre del cargo/ }).fill(cargoName)

  const licencia = cargoDialog.getByRole("group", { name: "Licencia de conducir" })
  const a4 = licencia.getByRole("button", { name: /^A4/ })
  const a5 = licencia.getByRole("button", { name: /^A5/ })
  await expect(a4).toHaveAttribute("aria-pressed", "false")
  await a4.click()
  await a5.click()
  await expect(a4).toHaveAttribute("aria-pressed", "true")
  await expect(a5).toHaveAttribute("aria-pressed", "true")
  await expect(cargoDialog.getByText(/Basta con que tenga una de las marcadas/)).toBeVisible()

  await cargoDialog.getByRole("button", { name: "Crear cargo" }).click()
  await expect(cargoDialog).toBeHidden({ timeout: 30_000 })

  // El catálogo muestra la licencia que exige, junto a sus capacidades.
  await page.getByPlaceholder("Filtrar en esta página...").fill(cargoName)
  const cargoRow = page.getByRole("row", { name: new RegExp(cargoName) })
  await expect(cargoRow.getByRole("group", { name: "Exige licencia A4 o A5" })).toBeVisible()

  // Y al volver a abrir el cargo, las fichas siguen marcadas.
  await page.getByRole("button", { name: `Editar cargo ${cargoName}` }).click()
  const editar = page.getByRole("dialog", { name: "Editar cargo" })
  const editarLicencia = editar.getByRole("group", { name: "Licencia de conducir" })
  await expect(editarLicencia.getByRole("button", { name: /^A4/ })).toHaveAttribute("aria-pressed", "true")
  await expect(editarLicencia.getByRole("button", { name: /^A5/ })).toHaveAttribute("aria-pressed", "true")
  await expect(editarLicencia.getByRole("button", { name: /^B/ })).toHaveAttribute("aria-pressed", "false")
  await editar.getByRole("button", { name: "Cancelar" }).click()
  await expect(editar).toBeHidden()

  // ── Dos trabajadores sin cargo ─────────────────────────────────────────────
  await page.goto("/admin/trabajadores")
  await expectPageTitle(page, "Trabajadores")
  await crearTrabajadorSinCargo(page, `${prefix}A`, "Uno")
  await crearTrabajadorSinCargo(page, `${prefix}B`, "Dos")

  // ── La vista «Sin cargo» viaja en la URL y los cuenta ──────────────────────
  await page.goto("/admin/trabajadores")
  await page.getByRole("tab", { name: /Sin cargo/ }).click()
  await expect(page).toHaveURL(/[?&]vista=sin-cargo/)
  const sinCargoTab = page.getByRole("tab", { name: /Sin cargo/ })
  await expect(sinCargoTab).toHaveAttribute("aria-selected", "true")
  const antes = await tabCount(sinCargoTab)
  expect(antes).toBeGreaterThanOrEqual(2)

  // Un enlace directo cae en la misma vista (es el destino de «Asignar cargos»).
  await page.goto("/admin/trabajadores?vista=sin-cargo")
  await expect(page.getByRole("tab", { name: /Sin cargo/ })).toHaveAttribute("aria-selected", "true")

  // La barra superior filtra; la selección vale sólo para lo que se ve.
  await page.getByPlaceholder("Filtrar en esta página...").fill(prefix)
  const filaA = page.getByRole("row", { name: new RegExp(`${prefix}A`) })
  const filaB = page.getByRole("row", { name: new RegExp(`${prefix}B`) })
  await expect(filaA).toBeVisible()
  await expect(filaB).toBeVisible()
  await expect(page.getByRole("region", { name: SIN_CARGO_BAR })).toHaveCount(0)

  // ── Seleccionar: aparece la barra con el conteo ────────────────────────────
  await filaA.getByRole("checkbox", { name: /Seleccionar a/ }).check()
  const barra = page.getByRole("region", { name: SIN_CARGO_BAR })
  await expect(barra).toContainText("1 seleccionado")
  await page.getByRole("checkbox", { name: /Seleccionar los 2 que coinciden/ }).check()
  await expect(barra).toContainText("2 seleccionados")

  // Limpiar la selección quita la barra; se vuelve a elegir con «seleccionar todos».
  await barra.getByRole("button", { name: "Limpiar selección" }).click()
  await expect(page.getByRole("region", { name: SIN_CARGO_BAR })).toHaveCount(0)
  await page.getByRole("checkbox", { name: /Seleccionar los 2 que coinciden/ }).check()
  await expect(barra).toContainText("2 seleccionados")

  // ── Asignar cargo: buscar, leer qué implica y confirmar ────────────────────
  await barra.getByRole("button", { name: "Asignar cargo" }).click()
  const dialog = page.getByRole("dialog", { name: "Asignar cargo" })
  await expect(dialog.getByRole("button", { name: "Asignar a 2" })).toBeDisabled()

  await dialog.getByRole("combobox", { name: "Cargo" }).fill(cargoName)
  await dialog.getByRole("option", { name: new RegExp(cargoName) }).click()
  await expect(dialog.getByText("exige licencia A4 o A5")).toBeVisible()
  await expect(dialog.getByText(/No conduce ni opera maquinaria/)).toBeVisible()

  await dialog.getByRole("button", { name: "Asignar a 2" }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(textoVisible(page, /2 trabajadores clasificados como/)).toBeVisible()

  // ── Salen de «Sin cargo» y el contador baja ────────────────────────────────
  await expect(page.getByRole("row", { name: new RegExp(prefix) })).toHaveCount(0)
  await expect(page.getByRole("region", { name: SIN_CARGO_BAR })).toHaveCount(0)
  await expect.poll(() => tabCount(page.getByRole("tab", { name: /Sin cargo/ })), { timeout: 15_000 })
    .toBe(antes - 2)

  // ── Y figuran en «Activos» con el cargo nuevo ──────────────────────────────
  await page.getByRole("tab", { name: /^Activos/ }).click()
  await expect(page).not.toHaveURL(/[?&]vista=/)
  await expect(page.getByRole("row", { name: new RegExp(`${prefix}A.*${cargoName}`) })).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(`${prefix}B.*${cargoName}`) })).toBeVisible()
})

test("trabajadores: «Sin cargo» no ofrece seleccionar en las otras vistas", async ({ page }) => {
  await login(page)

  await page.goto("/admin/trabajadores")
  await expect(page.getByRole("tab", { name: /^Activos/ })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("checkbox", { name: /Seleccionar a/ })).toHaveCount(0)

  await page.getByRole("tab", { name: /Inactivos/ }).click()
  await expect(page).toHaveURL(/[?&]vista=inactivos/)
  await expect(page.getByRole("checkbox", { name: /Seleccionar a/ })).toHaveCount(0)
})
