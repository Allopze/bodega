import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expectPageTitle, login, pickCurrentMonthDate, textoVisible } from "./helpers"

/**
 * E2E MIPER F1 — pasos 1–5, 7–10, 16 y 17 del §12 del spec 2026-09-30.
 *
 * Tres personas con **sólo** su permiso (`prevencionista_faena`,
 * `prevencionista` de la Jefatura y `gerente_legal_rrhh`, sembradas en
 * `e2e/setup-db.ts`): la segregación que se prueba es la del producto, no la del
 * admin —que tiene los cuatro permisos y por eso no distingue un hueco de
 * autorización de una excepción—. El programa de trabajo (pasos 6 y 11–15) llega
 * en F2.
 */
test.describe.configure({ mode: "serial" })

const PERIOD = "2030"
let miperUrl = ""

const contexts: BrowserContext[] = []

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  await login(page, email)
  return page
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()))
})

/**
 * Una celda de la grilla por su `aria-label` real (`matrix-grid.tsx`).
 *
 * Los dos casos son `combobox`: las columnas de texto son `<input list="…">` —y
 * ese `list` les da el rol ARIA de combobox, igual que a un `<select>`—, y las
 * demás son `<select>` nativos. El `exact` es obligatorio: sin él "Riesgo" es
 * subcadena de "Factor de riesgo" y "¿Controlado?" lo es de nada, pero "Actividad"
 * lo es de ninguna otra sólo por suerte.
 */
const cell = (page: Page, column: string, row = 1) => page.getByRole("combobox", { name: `${column} riesgo ${row}`, exact: true })

/**
 * El rótulo de estado del espacio de trabajo (`miperStatusLabel`), leído de la
 * copia que el shell pinta **pintada**.
 *
 * La descripción de la página viaja dos veces al DOM: la del `PageHeader` local
 * —`lg:sr-only` en escritorio, pero con caja de 1 px, así que Playwright la
 * considera visible— y la del `TopBar`. `textoVisible(page, "Vigente · v1")`
 * resuelve a las dos y Playwright aborta por strict mode, que es el mismo modo
 * de fallar que documenta `helpers.ts` para los pares móvil/escritorio. Se acota
 * al `banner` (el `TopBar`, que es el que se lee a 1280 px) en vez de tomar
 * `.first()`, que escondería cuál de las dos copias se está mirando.
 */
const estado = (page: Page, label: string | RegExp) => page.getByRole("banner").getByText(label)

test("la prevencionista crea la MIPER, la completa y la envía a revisión", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto("/prevencion/miper")
  await expectPageTitle(page, "Matriz IPER (MIPER)")
  // Dos "Nueva MIPER" en pantalla —el CTA del header y el del estado vacío—, el
  // mismo alta ofrecida en dos sitios; no es la copia móvil/escritorio de un
  // `DataTable`, y el CTA del header va primero en el DOM.
  await page.getByRole("button", { name: "Nueva MIPER" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
  // El único combobox del diálogo es la faena: el período es un número y el
  // punto de partida, radios.
  await dialog.getByRole("combobox").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.getByLabel("Período").fill(PERIOD)
  await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
  await dialog.getByLabel("Motivo").fill("Elaboración inicial del período para la prueba E2E.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?tab=antecedentes/)
  miperUrl = page.url().split("?")[0]!

  // Antecedentes (paso 2): representante en faena y dotación coherente.
  await page.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await page.getByLabel("N° total de trabajadores").fill("3")
  await page.getByLabel("Trabajadores hombres").fill("2")
  await page.getByLabel("Trabajadoras mujeres").fill("1")
  await page.getByLabel("Trabajadores otro").fill("0")
  await page.getByRole("button", { name: "Guardar antecedentes" }).click()
  // `updateMiperHeaderAction` anuncia lo que hizo, no el "Cambio registrado"
  // genérico del hook.
  await expect(textoVisible(page, "Antecedentes guardados")).toBeVisible()

  // Matriz (pasos 3–5): fila con P×C y clasificación automática.
  await page.getByRole("tab", { name: /Matriz/ }).click()
  await page.getByRole("button", { name: "Agregar la primera fila" }).click()
  await expect(cell(page, "Actividad")).toBeVisible()
  const fill = async (column: string, value: string) => {
    await cell(page, column).fill(value)
    // La celda guarda al perder el foco: sin el Tab no hay mutación.
    await cell(page, column).press("Tab")
  }
  await fill("Actividad", "Transporte de lodo")
  await fill("Tarea", "Descarga en predio")
  await fill("Puesto de trabajo", "Conductor profesional")
  await fill("Peligro", "Camión en pendiente")
  await fill("Riesgo", "Volcamiento")
  await fill("Daño probable", "Politraumatismo")
  await cell(page, "Factor de riesgo").selectOption({ label: "Mecánico" })
  await cell(page, "Rutinaria").selectOption("yes")
  await cell(page, "Probabilidad").selectOption("4")
  await cell(page, "Consecuencia").selectOption("4")
  // El badge del RE-04 pega rótulo y magnitud sin espacio entre nodos
  // ("Intolerable· MR 16"): el `\s*` no es laxitud, es el DOM real.
  await expect(textoVisible(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Intolerable" })).toBeVisible()
  await cell(page, "¿Controlado?").selectOption("partial")

  // Medida con jerarquía, responsable y plazo.
  await page.getByRole("button", { name: /Medidas de control del riesgo 1/ }).click()
  const sheet = page.getByRole("dialog", { name: "Riesgo #1" })
  await sheet.getByRole("button", { name: "Agregar medida" }).click()
  await sheet.getByLabel("Tipo de control", { exact: true }).selectOption("engineering")
  await sheet.getByLabel("Descripción de la medida").fill("Topes de descarga y señalero en pendiente")
  await sheet.getByLabel("Nombre o cargo responsable").fill("Supervisor de turno")
  await pickCurrentMonthDate(page, /Plazo de la medida/)
  // Con el editor abierto el botón del alta deja de existir: sólo queda el del
  // pie del editor, así que no hay ambigüedad de nombre.
  await sheet.getByRole("button", { name: "Agregar medida" }).click()
  await expect(sheet.getByText("Topes de descarga y señalero en pendiente")).toBeVisible()
  // La ficha se identifica por `?fila=<id>` en la URL: Escape la cierra y el
  // cliente limpia el parámetro con `router.replace`, que es asíncrono. Sin
  // esperar a que cierre, la recarga volvía a abrir la ficha —la URL seguía
  // apuntándole— y quedaban dos badges "Intolerable · MR 16" en pantalla.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Riesgo #1" })).toBeHidden()
  await expect(page).not.toHaveURL(/fila=/)

  // Envío (paso 7). La recarga relee el servidor: además de tirar el estado
  // optimista, comprueba que la fila y su medida quedaron persistidas antes de
  // enviar —el guardado por celda es asíncrono y un envío a medio guardar
  // enviaría una foto incompleta—.
  await page.reload()
  await expect(cell(page, "Peligro")).toHaveValue("Camión en pendiente")
  await expect(textoVisible(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Medidas de control del riesgo 1 \(1\)/ })).toBeVisible()

  // La F2 activó la regla del §5.1: un riesgo Intolerable no se envía sin una
  // medida vinculada a una actividad del Programa de Trabajo, así que el flujo
  // incluye ese paso (el detalle de la ejecución se prueba en
  // `prevencion-miper-programa.spec.ts`).
  await page.getByRole("tab", { name: "Programa" }).click()
  await page.getByRole("button", { name: "Generar actividades" }).click()
  const generador = page.getByRole("dialog", { name: "Generar actividades desde el MIPER" })
  await generador.getByLabel("Actividad", { exact: true }).fill("Inspección de la pendiente de descarga")
  await generador.getByRole("combobox", { name: "Responsable de la actividad de la fila 1" }).click()
  await page.getByRole("option", { name: "Prevencionista Faena E2E", exact: true }).click()
  await generador.getByRole("combobox", { name: "Frecuencia de la actividad de la fila 1" }).click()
  await page.getByRole("option", { name: "Anual", exact: true }).click()
  await generador.getByRole("button", { name: /Aplicar decisiones/ }).click()
  await expect(generador).toBeHidden()

  await page.getByRole("button", { name: /^Enviar a revisión$/ }).click()
  await expect(estado(page, "Enviado a revisión")).toBeVisible()
})

test("la Jefa observa el riesgo y la prevencionista corrige y reenvía", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto("/prevencion/miper")
  // La bandeja de la Jefatura puede traer más de una ronda pendiente —la base
  // E2E es compartida y cualquier otra prueba que envíe una MIPER deja la suya—,
  // así que la tarjeta esperada se identifica por el enlace a ESTA MIPER y no
  // por el rótulo suelto (que pasaría a resolver dos nodos).
  const id = miperUrl.split("/").pop()!
  await expect(jefa.locator(`a[href="/prevencion/miper/${id}"]`)).toContainText("Pendiente de tu revisión")
  await jefa.goto(miperUrl)
  // La apertura de la ronda la registra el cliente al entrar y no revalida, así
  // que la etiqueta sólo cambia cuando la página vuelve a leer el servidor: se
  // reintenta el par recarga + aserción en vez de asumir que el efecto alcanzó.
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, "En revisión por Prevención")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await jefa.getByRole("button", { name: "Observar riesgo 1", exact: true }).click()
  const sheet = jefa.getByRole("dialog", { name: "Riesgo #1" })
  await sheet.getByLabel("Nueva observación").fill("Revisar consecuencia. De acuerdo con el daño probable indicado debería evaluarse nuevamente la probabilidad.")
  await sheet.getByRole("button", { name: "Registrar observación" }).click()
  await expect(sheet.getByText("Abierta")).toBeVisible()
  await jefa.keyboard.press("Escape")
  await expect(jefa.getByRole("dialog", { name: "Riesgo #1" })).toBeHidden()
  await jefa.getByRole("button", { name: "Devolver con observaciones" }).click()
  const confirm = jefa.getByRole("dialog", { name: "Devolver con observaciones" })
  await confirm.getByRole("textbox").fill("Revisar la evaluación del riesgo #1.")
  await confirm.getByRole("button", { name: "Devolver" }).click()
  await expect(estado(jefa, "Con observaciones")).toBeVisible()

  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(`${miperUrl}?tab=revision`)
  await prev.getByLabel("Tu respuesta").fill("Se reevaluó la probabilidad: el tránsito en pendiente es ocasional.")
  await prev.getByRole("button", { name: "Responder" }).click()
  await prev.getByRole("tab", { name: /Matriz/ }).click()
  await cell(prev, "Probabilidad").selectOption("2")
  await expect(textoVisible(prev, /Importante\s*·\s*MR 8/)).toBeVisible()
  await prev.reload()
  // La reevaluación tiene que estar en la base antes de reenviar: si no, la
  // ronda llevaría la evaluación anterior y la Jefa no vería ninguna modificación.
  await expect(textoVisible(prev, /Importante\s*·\s*MR 8/)).toBeVisible()
  await prev.getByRole("button", { name: "Reenviar a revisión" }).click()
  await expect(estado(prev, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()

  await jefa.reload()
  await expect(textoVisible(jefa, "Modificada")).toBeVisible()
  await jefa.getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("Legal y RRHH aprueba: queda vigente v1 y un cambio posterior queda pendiente", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  await legal.getByRole("button", { name: "Aprobar (Legal y RRHH)" }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Emisión inicial del documento.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(estado(legal, "Vigente · v1")).toBeVisible()
  const download = legal.waitForEvent("download")
  await legal.getByRole("link", { name: "Descargar v1 (Excel)" }).click()
  expect((await download).suggestedFilename()).toMatch(/^RE-04-MIPER-E2E-001-2030-v1\.xlsx$/)

  // Paso 16: el vigente es mutable; el cambio queda pendiente de revisión.
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(miperUrl)
  await prev.getByRole("button", { name: "Agregar fila", exact: true }).click()
  await expect(cell(prev, "Actividad", 2)).toBeVisible()
  await cell(prev, "Peligro", 2).fill("Superficie resbaladiza")
  await cell(prev, "Peligro", 2).press("Tab")
  // Igual que arriba: la etiqueta depende de `updated_at > published_at`, que la
  // escribe la mutación, así que se reintenta la recarga en vez de correr una
  // carrera contra el guardado de la celda.
  await expect(async () => {
    await prev.reload()
    await expect(estado(prev, "Vigente v1 · cambios pendientes de revisión")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  // Paso 17: historial con actor y rol.
  await prev.getByRole("tab", { name: "Historial" }).click()
  await expect(textoVisible(prev, "Aprobada y sellada por Legal y RRHH")).toBeVisible()
  await expect(textoVisible(prev, "Devuelta con observaciones")).toBeVisible()
  // El actor va sobre la línea del sellado, no suelto: la misma persona y el
  // mismo rol firmaron también la apertura de la ronda ("Revisión iniciada"), y
  // la aserción suelta resolvía a dos nodos.
  await expect(prev.getByRole("listitem").filter({ hasText: "Aprobada y sellada por Legal y RRHH" }))
    .toContainText("Legal y RRHH E2E (Legal y RRHH)")
})
