import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { expectPageTitle, login, textoVisible } from "./helpers"
import { cabecera, irAPaso, type PasoDelRiesgo } from "./miper-helpers"

/**
 * E2E MIPER — revisión y sólo lectura (Fase E, V1):
 *   • una MIPER lista (`riskmatrix-revision-e2e`, 2041) pasa por la revisión
 *     técnica con la Jefa: «Recorrer la MIPER», el filtro en la URL,
 *     «Siguiente del filtro» (avanza y da la vuelta) y el enlace de la observación;
 *   • Legal y RRHH ve el editor sin campos editables —salvo «Nueva observación»
 *     en Seguimiento: revisa su etapa— y recorre el mismo filtro;
 *   • `miper.lectura@` (sólo `prevention:risk:view`) no ve ningún control de
 *     edición, ni en la MIPER en revisión ni en la reemplazada, y la bitácora de
 *     la reemplazada (60 eventos sembrados) pagina de 50 en 50;
 *   • el teclado recorre la tarea en orden visual y cada foco se ve;
 *   • axe y ni un píxel de scroll horizontal a 768, 1024 y 1280 px.
 *
 * Serial: la MIPER avanza de estado entre pruebas. Nunca se sella (Legal y RRHH
 * sólo mira): queda en revisión para el resto de la corrida. Las personas con
 * una sola cuenta —admin envía y responde; la Jefa revisa— son las del sembrado.
 */
test.describe.configure({ mode: "serial" })

const REV = "/prevencion/miper/riskmatrix-revision-e2e"
const REEMPLAZADA = "/prevencion/miper/riskmatrix-reemplazada-e2e"
const ENTRADA_1 = "riskentry-revision-e2e-1"
const PELIGRO_1 = "Rodamiento caliente"
const PELIGRO_3 = "Polea sin protección"
const TAREA = "Cambio de rodamientos"
const PASOS: PasoDelRiesgo[] = ["Identificación", "Evaluación", "Medidas de control", "Seguimiento"]

/** Lo que la Jefa recorrió: la URL del editor sin `fila`/`paso`/`tab` (el filtro), para repetirla con Legal y RRHH. */
let filtro = ""

const contexts: BrowserContext[] = []

async function as(browser: Browser, email?: string): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  await login(page, email)
  return page
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()))
})

/** El rótulo de estado, leído del `banner` (la descripción viaja dos veces al DOM). */
const estado = (page: Page, label: string | RegExp) => page.getByRole("banner").getByText(label)

/** Los controles que una persona podría escribir: ninguno puede quedar habilitado en sólo lectura. */
const editables = (page: Page): Locator =>
  page.locator("main").locator('input:not([type="hidden"]), textarea, select, [role="combobox"], [role="radio"], [role="checkbox"], [contenteditable="true"]')
    .and(page.locator(':not([disabled]):not([readonly]):not([aria-disabled="true"]):not([aria-readonly="true"])'))

/**
 * Quien revisa la etapa abierta no edita el riesgo, pero sí lo observa (§5.4:
 * «si es revisor, observar»; `addMiperObservation` lo acepta también en la
 * etapa de Legal y RRHH). Lo único que puede escribir es «Nueva observación»,
 * y sólo en Seguimiento: las dos cuentas juntas prueban que es ése y no otro.
 */
async function soloObserva(page: Page, paso: PasoDelRiesgo) {
  const esperados = paso === "Seguimiento" ? 1 : 0
  await expect(editables(page)).toHaveCount(esperados)
  await expect(editables(page).and(page.getByRole("textbox", { name: "Nueva observación", exact: true }))).toHaveCount(esperados)
}

async function sinControlesDeEdicion(page: Page) {
  for (const nombre of ["Nueva tarea", "Seleccionar", "Editar tarea", "Vincular medidas", "Editar antecedentes", "Completar antecedentes"]) {
    await expect(page.getByRole("button", { name: nombre, exact: true })).toHaveCount(0)
  }
}

async function auditar(page: Page) {
  // Como en `accessibility.spec.ts`: axe mide el contraste del color pintado, y a
  // mitad de un fundido de entrada el texto todavía está aclarado.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))))
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).analyze()
  expect(results.violations).toEqual([])
}

/** Sin scroll horizontal, ni en la página ni en el pozo del shell. */
async function sinScrollHorizontal(page: Page, vista: string) {
  const medidas = await page.evaluate(() => {
    const well = document.querySelector("[data-shell-scroll]")
    return {
      pagina: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      pozo: well ? [well.scrollWidth, well.clientWidth] : null,
    }
  })
  expect(medidas.pagina![0]!, `scroll horizontal en ${vista}`).toBeLessThanOrEqual(medidas.pagina![1]!)
  if (medidas.pozo) expect(medidas.pozo[0]!, `scroll horizontal del shell en ${vista}`).toBeLessThanOrEqual(medidas.pozo[1]!)
}

/** Desde la pestaña Revisión: «Importantes e Intolerables (n)» abre el editor con el filtro en la URL. */
async function recorrerImportantes(page: Page) {
  await page.goto(`${REV}?tab=revision`)
  const recorrido = page.getByRole("region", { name: "Recorrer la MIPER", exact: true })
  await expect(recorrido).toBeVisible()
  await recorrido.getByRole("link", { name: /^Importantes e Intolerables \(2\)$/ }).click()
  await expect(page).toHaveURL(/fila=/)
  await expect(page.getByRole("heading", { level: 2, name: PELIGRO_1 })).toBeVisible()
  const params = new URL(page.url()).searchParams
  for (const clave of ["fila", "paso", "tab"]) params.delete(clave)
  expect([...params.keys()].length, "el filtro del recorrido viaja en la URL").toBeGreaterThan(0)
  return params.toString()
}

async function siguienteDelFiltro(page: Page, peligro: string) {
  await page.getByRole("link", { name: "Siguiente del filtro", exact: true }).click()
  await expect(page.getByRole("heading", { level: 2, name: peligro })).toBeVisible()
}

test("el admin envía la MIPER lista a revisión y queda la ronda abierta", async ({ browser }) => {
  const page = await as(browser)
  await page.goto(REV)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2041")
  // Un reintento de CI no vuelve a sembrar: si ya se envió, el botón no está.
  const enviar = cabecera(page).getByRole("button", { name: "Enviar a revisión", exact: true })
  if (await enviar.count()) {
    await enviar.click()
    await expect(page.getByRole("dialog", { name: /^Faltan? \d+ datos? para enviar$/ })).toHaveCount(0)
  }
  await expect(estado(page, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()
})

test("la Jefa recorre los Importantes con «Siguiente del filtro», observa un riesgo y sigue el enlace de la observación", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(REV)
  // La apertura de la ronda la registra el cliente al entrar: se relee hasta verla.
  await expect(async () => {
    await jefa.reload()
    await expect(jefa.getByText("Estás revisando la versión enviada")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  filtro = await recorrerImportantes(jefa)
  // Avanza al otro Importante y, desde el último, da la vuelta al primero.
  await siguienteDelFiltro(jefa, PELIGRO_3)
  await siguienteDelFiltro(jefa, PELIGRO_1)

  // Observa el riesgo #1 desde el panel lateral.
  await jefa.getByRole("button", { name: "Observar este riesgo", exact: true }).click()
  await expect(jefa.getByRole("tab", { name: /Seguimiento/, selected: true })).toBeVisible()
  await jefa.getByLabel("Nueva observación").fill("Verificar la frecuencia de revisión del rodamiento caliente antes de aprobar.")
  await jefa.getByRole("button", { name: "Registrar observación", exact: true }).click()
  await expect(jefa.getByRole("region", { name: "Observaciones del riesgo" }).getByText("Abierta", { exact: true })).toBeVisible()

  // En Revisión, la observación nombra su riesgo con un enlace que abre el paso Seguimiento.
  await jefa.goto(`${REV}?tab=revision`)
  await expect(jefa.getByRole("region", { name: "Recorrer la MIPER", exact: true }).getByRole("link", { name: /^Observados \(1\)$/ })).toBeVisible()
  await jefa.getByRole("link", { name: new RegExp(PELIGRO_1) }).click()
  await expect(jefa).toHaveURL(/fila=[^&]+&paso=seguimiento|paso=seguimiento&fila=/)
  await expect(jefa.getByRole("heading", { level: 2, name: PELIGRO_1 })).toBeVisible()

  // Una observación abierta impide aprobar: se devuelve (la aprobación es dos pruebas más abajo).
  await cabecera(jefa).getByRole("button", { name: "Devolver con observaciones", exact: true }).click()
  const confirmar = jefa.getByRole("dialog", { name: "Devolver con observaciones" })
  await confirmar.getByRole("textbox").fill("Revisar la observación del riesgo #1.")
  await confirmar.getByRole("button", { name: "Devolver" }).click()
  await expect(estado(jefa, "Con observaciones")).toBeVisible()
})

test("el admin responde la observación y reenvía; la Jefa aprueba la revisión técnica", async ({ browser }) => {
  const admin = await as(browser)
  await admin.goto(`${REV}?tab=revision`)
  await admin.getByLabel("Tu respuesta").fill("La frecuencia de revisión es mensual y consta en la medida existente.")
  await admin.getByRole("button", { name: "Responder", exact: true }).click()
  await cabecera(admin).getByRole("button", { name: "Reenviar a revisión", exact: true }).click()
  await expect(estado(admin, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()

  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(REV)
  await expect(async () => {
    await jefa.reload()
    await expect(cabecera(jefa).getByRole("button", { name: "Aprobar revisión técnica", exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await cabecera(jefa).getByRole("button", { name: "Aprobar revisión técnica", exact: true }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("Legal y RRHH ve el editor sin campos editables y recorre el mismo filtro; no sella", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(`${REV}?fila=${ENTRADA_1}&paso=identificacion&${filtro}`)
  await expect(legal.getByRole("heading", { level: 2, name: PELIGRO_1 })).toBeVisible()
  for (const paso of PASOS) {
    await irAPaso(legal, paso)
    await soloObserva(legal, paso)
  }
  await siguienteDelFiltro(legal, PELIGRO_3)
  // «Siguiente del filtro» conserva el paso: sigue en Seguimiento, donde sólo observa.
  await expect(legal.getByRole("tab", { name: /Seguimiento/, selected: true })).toBeVisible()
  await soloObserva(legal, "Seguimiento")
  // No se aprueba ni se sella: la MIPER sigue esperando a Legal y RRHH.
  await legal.goto(REV)
  await expect(estado(legal, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("quien sólo puede ver: la portada lista las faenas y ninguna MIPER ofrece editar", async ({ browser }) => {
  const page = await as(browser, "miper.lectura@e2e.chome.cl")
  await page.goto("/prevencion/miper")
  await expectPageTitle(page, "Matriz IPER (MIPER)")
  await expect(textoVisible(page, "Faena Restringida E2E")).toBeVisible()

  // La MIPER en revisión: matriz, tarea, editor y programa sin controles de edición.
  await page.goto(REV)
  await sinControlesDeEdicion(page)
  await page.getByRole("link", { name: new RegExp(`^${TAREA}`) }).click()
  await expect(page.getByRole("heading", { level: 2, name: TAREA })).toBeVisible()
  await sinControlesDeEdicion(page)
  await page.getByRole("link", { name: new RegExp(`^Riesgo #1: ${PELIGRO_1}`) }).click()
  for (const paso of PASOS) {
    await irAPaso(page, paso)
    await expect(editables(page)).toHaveCount(0)
  }
  await page.goto(`${REV}?tab=programa`)
  await sinControlesDeEdicion(page)

  // La reemplazada: el aviso de sólo lectura y lo mismo.
  await page.goto(REEMPLAZADA)
  await expect(textoVisible(page, "Esta MIPER fue reemplazada por la de otro período: se conserva como historia.")).toBeVisible()
  await sinControlesDeEdicion(page)
  await page.goto(`${REEMPLAZADA}?fila=riskentry-reemplazada-e2e&paso=identificacion`)
  await expect(editables(page)).toHaveCount(0)

  // Bitácora: 50 eventos, «Cargar más», más de 50, y el botón se va cuando no queda nada.
  await page.goto(`${REEMPLAZADA}?tab=historial`)
  await expect(page.getByRole("heading", { level: 2, name: "Bitácora" })).toBeVisible()
  const conteo = page.getByRole("status").filter({ hasText: /^Mostrando \d+ eventos$/ })
  await expect(conteo).toHaveText("Mostrando 50 eventos")
  await page.getByRole("button", { name: "Cargar más", exact: true }).click()
  await expect(conteo).not.toHaveText("Mostrando 50 eventos")
  const mostrados = Number((await conteo.textContent())!.match(/\d+/)![0])
  expect(mostrados).toBeGreaterThan(50)
  await expect(page.getByRole("button", { name: "Cargar más", exact: true })).toHaveCount(0)
})

test("con teclado: Tab recorre la tarea en orden visual hasta el primer riesgo, Enter abre el editor y cada foco se ve", async ({ browser }) => {
  const page = await as(browser, "miper.lectura@e2e.chome.cl")
  await page.goto(REV)
  await page.getByRole("link", { name: new RegExp(`^${TAREA}`) }).click()
  await expect(page.getByRole("heading", { level: 2, name: TAREA })).toBeVisible()

  // Se parte del enlace «Volver a la matriz», lo primero del contenido; lo de antes (menú, cabecera) no es la vista.
  await page.getByRole("link", { name: "‹ Volver a la matriz", exact: true }).focus()
  const primero = page.getByRole("link", { name: new RegExp(`^Riesgo #1: ${PELIGRO_1}`) })
  let arriba = -Infinity
  let llegó = false
  for (let paso = 0; paso < 40 && !llegó; paso++) {
    await page.keyboard.press("Tab")
    const foco = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const estilo = getComputedStyle(el)
      return {
        top: el.getBoundingClientRect().top,
        contorno: estilo.outlineStyle !== "none" || estilo.boxShadow !== "none",
        nombre: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 60) ?? "",
      }
    })
    expect(foco, "el foco quedó fuera de la página").not.toBeNull()
    expect(foco!.contorno, `el foco de «${foco!.nombre}» no tiene contorno visible`).toBe(true)
    expect(foco!.top, `«${foco!.nombre}» está más arriba que el foco anterior`).toBeGreaterThanOrEqual(arriba - 2)
    arriba = foco!.top
    llegó = await primero.evaluate((el) => el === document.activeElement)
  }
  expect(llegó, "Tab no llegó al primer riesgo").toBe(true)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/fila=/)
  await expect(page.getByRole("heading", { level: 2, name: PELIGRO_1 })).toBeVisible()
})

test("axe y sin scroll horizontal a 768, 1024 y 1280 px en matriz, tarea, editor, Revisión, Programa y detalle de una actividad", async ({ browser }) => {
  test.setTimeout(240_000)
  const page = await as(browser, "miper.lectura@e2e.chome.cl")
  for (const ancho of [768, 1024, 1280]) {
    await page.setViewportSize({ width: ancho, height: 900 })
    const revisar = async (vista: string) => {
      await page.waitForLoadState("networkidle")
      await sinScrollHorizontal(page, `${vista} a ${ancho}px`)
      await auditar(page)
    }

    await page.goto(REV)
    await expect(page.getByRole("link", { name: new RegExp(`^${TAREA}`) })).toBeVisible()
    await revisar("la matriz")

    await page.getByRole("link", { name: new RegExp(`^${TAREA}`) }).click()
    await expect(page.getByRole("heading", { level: 2, name: TAREA })).toBeVisible()
    await revisar("la tarea")

    await page.getByRole("link", { name: new RegExp(`^Riesgo #1: ${PELIGRO_1}`) }).click()
    await expect(page.getByRole("heading", { level: 2, name: PELIGRO_1 })).toBeVisible()
    for (const paso of PASOS) {
      await irAPaso(page, paso)
      await revisar(`el editor, paso ${paso}`)
    }

    await page.goto(`${REV}?tab=revision`)
    await expect(page.getByRole("region", { name: "Recorrer la MIPER", exact: true })).toBeVisible()
    await revisar("Revisión")

    await page.goto(`${REV}?tab=programa`)
    await expect(page.getByRole("link", { name: "Abrir el detalle de la actividad N° 1", exact: true })).toBeVisible()
    await revisar("el Programa")

    await page.getByRole("link", { name: "Abrir el detalle de la actividad N° 1", exact: true }).click()
    await expect(page.getByRole("region", { name: "Actividad N° 1", exact: true })).toBeVisible()
    await revisar("el detalle de la actividad")
  }
})
