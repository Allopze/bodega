import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { expectPageTitle, login, textoVisible } from "./helpers"
import { crearTarea, escribir, irAPaso, volverALaTarea } from "./miper-helpers"

/**
 * E2E MIPER — acciones masivas (Fase D, spec §9):
 *   • «Seleccionar» en la vista de una tarea, dos casillas y «Agregar medida a 2»:
 *     la medida queda en esos dos riesgos y no en el tercero, y el historial lo
 *     dice con el motivo «Edición masiva».
 *   • En la matriz filtrada, «Seleccionar los N resultados» y «Cambiar
 *     ¿controlado?»; repetir el mismo valor avisa que no había nada que cambiar.
 *   • «Editar tarea» renombra la tarea de todos sus riesgos y la URL pasa a la
 *     tarea nueva con replace: «atrás» no vuelve a la clave vieja.
 *   • axe sobre la barra de selección y el diálogo de la medida.
 *
 * `riskmatrix-masivas-e2e` (2040, «Faena Restringida E2E») llega con la tarea
 * «Trasvasije de solventes» y tres riesgos sembrados (`e2e/setup-db.ts`): dos
 * Moderados y un Tolerable. Ningún otro spec la toca. Lo que este spec escribe
 * lleva el número de reintento, así un reintento de CI (que no vuelve a sembrar)
 * no tropieza con lo que dejó el intento anterior.
 */
const MATRIZ = "/prevencion/miper/riskmatrix-masivas-e2e"
const TAREA = "Trasvasije de solventes"
const riesgo = (page: Page, numero: number, peligro: string) => page.getByRole("link", { name: `Riesgo #${numero}: ${peligro}`, exact: true })

async function auditar(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).include(selector).analyze()
  expect(results.violations).toEqual([])
}

async function abrirTarea(page: Page) {
  await page.goto(MATRIZ)
  await expectPageTitle(page, "Matriz de riesgos · Faena Restringida E2E 2040")
  await page.getByRole("link", { name: new RegExp(`^${TAREA}`) }).click()
  await expect(page.getByRole("heading", { level: 2, name: TAREA })).toBeVisible()
}

/** En la matriz filtrada a los dos Moderados: los selecciona todos y abre «Cambiar ¿controlado?». */
async function abrirControlado(page: Page) {
  await page.goto(`${MATRIZ}?clasificacion=moderate`)
  await expect(riesgo(page, 1, "Derrame de solvente")).toBeVisible()
  await expect(riesgo(page, 3, "Tambor en altura")).toHaveCount(0)
  await page.getByRole("button", { name: "Seleccionar riesgos", exact: true }).click()
  await page.getByRole("button", { name: "Seleccionar los 2 resultados", exact: true }).click()
  const barra = page.getByRole("region", { name: "Acciones sobre la selección" })
  await expect(barra).toContainText("2 riesgos seleccionados")
  await barra.getByRole("button", { name: "Cambiar ¿controlado?", exact: true }).click()
  return page.getByRole("dialog", { name: "¿Está controlado? en 2 riesgos" })
}

test("«Agregar medida a 2»: la medida queda en los dos riesgos elegidos, no en el tercero, y el historial dice «Edición masiva»", async ({ page }, testInfo) => {
  const medida = `Bandeja antiderrame bajo el tambor ${testInfo.retry + 1}`
  await login(page)
  await abrirTarea(page)
  // Sin el modo, ninguna casilla: la vista queda liviana.
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await page.getByRole("button", { name: "Seleccionar riesgos", exact: true }).click()
  await page.getByRole("checkbox", { name: "Seleccionar el riesgo #1: Derrame de solvente", exact: true }).check()
  await page.getByRole("checkbox", { name: "Seleccionar el riesgo #2: Vapores de solvente", exact: true }).check()
  const barra = page.getByRole("region", { name: "Acciones sobre la selección" })
  await expect(barra).toContainText("2 riesgos seleccionados")
  await auditar(page, '[role="region"][aria-label="Acciones sobre la selección"]')

  await barra.getByRole("button", { name: "Agregar medida a 2", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Agregar una medida a 2 riesgos" })
  await dialogo.getByRole("radio", { name: "Ya está implementada", exact: true }).click()
  await dialogo.getByLabel("Frecuencia de verificación", { exact: true }).fill("Mensual")
  await dialogo.getByLabel("Descripción de la medida", { exact: true }).fill(medida)
  await dialogo.getByLabel("Nombre o cargo responsable", { exact: true }).fill("Jefe de bodega")
  await auditar(page, '[role="dialog"]')
  await dialogo.getByRole("button", { name: "Agregar a 2", exact: true }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  // Terminó bien: la selección se vació y la barra se fue.
  await expect(barra).toBeHidden()

  const tarjeta = page.getByRole("article", { name: `Medida: ${medida}`, exact: true })
  for (const [numero, peligro] of [[1, "Derrame de solvente"], [2, "Vapores de solvente"]] as const) {
    await riesgo(page, numero, peligro).click()
    await irAPaso(page, "Medidas de control")
    await expect(tarjeta).toContainText("Existente · verificación Mensual")
    await expect(tarjeta).toContainText("Responsable: Jefe de bodega")
    await volverALaTarea(page)
  }
  await riesgo(page, 3, "Tambor en altura").click()
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("heading", { level: 3, name: /^Medidas de control/ })).toBeVisible()
  await expect(tarjeta).toHaveCount(0)

  // Una entrada por riesgo, con el motivo de la acción masiva (un reintento de CI puede sumar las de su intento).
  await page.goto(`${MATRIZ}?tab=historial`)
  const entradas = page.getByRole("listitem").filter({ hasText: "Medida agregada" }).filter({ hasText: "Edición masiva" })
  await expect(entradas.first()).toBeVisible()
  expect(await entradas.count()).toBeGreaterThanOrEqual(2)
})

test("en la matriz filtrada, «Seleccionar los N resultados» y «Cambiar ¿controlado?» cambian todos los que coinciden; repetir el valor avisa que no había nada que cambiar", async ({ page }, testInfo) => {
  // Un reintento de CI no vuelve a sembrar: el valor alterna para que el primer cambio siempre cambie algo.
  const [valor, mostrado] = testInfo.retry % 2 === 0 ? (["Parcialmente", "Controlado: Parcialmente"] as const) : (["Sí", "Controlado: Sí"] as const)
  await login(page)
  // Los dos Moderados de la tarea; el tercero es Tolerable y queda fuera del filtro.
  const dialogo = await abrirControlado(page)
  await dialogo.getByRole("radio", { name: valor, exact: true }).click()
  await dialogo.getByRole("button", { name: "Aplicar a 2", exact: true }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  await expect(riesgo(page, 1, "Derrame de solvente")).toContainText(mostrado)
  await expect(riesgo(page, 2, "Vapores de solvente")).toContainText(mostrado)
  // Lo guardado, no sólo la pantalla; y el que no estaba a la vista no cambió.
  await page.goto(`${MATRIZ}?buscar=tambor`)
  await expect(riesgo(page, 3, "Tambor en altura")).toContainText("Controlado: No")
  await page.goto(`${MATRIZ}?clasificacion=moderate`)
  await expect(riesgo(page, 2, "Vapores de solvente")).toContainText(mostrado)

  // El mismo valor otra vez: los dos riesgos ya lo tienen, así que el servicio no escribe nada y lo dice.
  const repetido = await abrirControlado(page)
  await repetido.getByRole("radio", { name: valor, exact: true }).click()
  await repetido.getByRole("button", { name: "Aplicar a 2", exact: true }).click()
  await expect(textoVisible(page, "No había nada que cambiar en los riesgos seleccionados.")).toBeVisible({ timeout: 30_000 })
  await expect(riesgo(page, 1, "Derrame de solvente")).toContainText(mostrado)
})

test("«Editar tarea» renombra la tarea de todos sus riesgos; la URL pasa a la tarea nueva sin dejar la vieja en el historial", async ({ page }, testInfo) => {
  const actividad = `Mantención de grúa ${testInfo.retry + 1}`
  // La tarea también lleva el reintento: renombrar a un nombre que ya existe junta las tareas.
  const tarea = `Cambio de cable ${testInfo.retry + 1}`
  const renombrada = `${tarea} de izaje`
  await login(page)
  await page.goto(MATRIZ)
  await crearTarea(page, { actividad, tarea, puesto: "Mecánico", peligro: "Cable cortado" })
  await volverALaTarea(page)
  await page.getByRole("button", { name: "Agregar peligro", exact: true }).click()
  await expect(page).toHaveURL(/paso=identificacion/)
  await volverALaTarea(page)
  await expect(page.getByRole("heading", { level: 2, name: tarea })).toBeVisible()
  const antes = new URL(page.url()).searchParams.get("tarea")

  await page.getByRole("button", { name: "Editar contexto de la tarea", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Editar tarea", exact: true })
  await expect(dialogo).toContainText(`de «${tarea}», o el puesto y el lugar de sus 2 riesgos`)
  await escribir(dialogo, "Tarea", renombrada)
  await dialogo.getByRole("button", { name: "Guardar cambios", exact: true }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole("heading", { level: 2, name: renombrada })).toBeVisible()
  const despues = new URL(page.url()).searchParams.get("tarea")
  expect(despues).not.toBeNull()
  expect(despues).not.toBe(antes)
  await expect(page.getByRole("link", { name: /^Riesgo #\d+: Cable cortado$/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /^Riesgo #\d+: peligro sin describir$/ })).toBeVisible()
  await expect(page.getByText("Esta tarea ya no existe")).toHaveCount(0)

  // Replace: «atrás» no vuelve a la clave vieja (con push, mostraría «Esta tarea ya no existe»).
  await page.goBack()
  await expect(page).not.toHaveURL(new RegExp(`tarea=${antes}(&|$)`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`tarea=${despues}(&|$)`))
  // Lo guardado: al recargar, la tarea nueva sigue con sus dos riesgos.
  await page.reload()
  await expect(page.getByRole("heading", { level: 2, name: renombrada })).toBeVisible()
  await expect(page.getByRole("heading", { level: 3, name: "Peligros identificados (2)" })).toBeVisible()
})
