import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expectPageTitle, login, textoVisible } from "./helpers"
import {
  abrirRiesgo, agregarMedida, cabecera, crearTarea, elegir, elegirOpcion, escribir, guardado, irAPaso, nivel, volverALaTarea,
} from "./miper-helpers"

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
  await expectPageTitle(page, "Matriz de riesgos")
  await cabecera(page).getByRole("button", { name: "Crear matriz", exact: true }).click()
  await page.getByRole("dialog", { name: "Crear matriz de riesgos" }).getByRole("button", { name: /^Completar en la plataforma/ }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
  // El único combobox del diálogo es la faena: el período es un número y el
  // punto de partida, radios.
  await dialog.getByRole("combobox").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.getByLabel("Período").fill(PERIOD)
  await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
  await dialog.getByLabel("Motivo").fill("Elaboración inicial del período para la prueba E2E.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  // La MIPER nueva abre con la «Ficha del documento» (los antecedentes RE-04).
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?tab=resumen&ficha=1/)
  miperUrl = page.url().split("?")[0]!
  const ficha = page.getByRole("dialog", { name: "Ficha del documento" })
  await expect(ficha).toBeVisible()

  // Antecedentes (paso 2): representante en faena y dotación coherente.
  await ficha.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await ficha.getByLabel("N° total de trabajadores").fill("3")
  await ficha.getByLabel("Trabajadores hombres").fill("2")
  await ficha.getByLabel("Trabajadoras mujeres").fill("1")
  await ficha.getByLabel("Trabajadores otro").fill("0")
  await ficha.getByRole("button", { name: "Guardar antecedentes" }).click()
  // `updateMiperHeaderAction` anuncia lo que hizo, no el "Cambio registrado"
  // genérico del hook; guardar cierra la ficha.
  await expect(textoVisible(page, "Antecedentes guardados")).toBeVisible()
  await expect(ficha).toBeHidden()
  await expect(page).not.toHaveURL(/ficha=1/)

  // Matriz (pasos 3–5): una tarea con su primer riesgo, P×C y clasificación automática.
  await crearTarea(page, { actividad: "Transporte de lodo", tarea: "Descarga en predio", puesto: "Conductor profesional", peligro: "Camión en pendiente" })
  await escribir(page, "Riesgo", "Volcamiento")
  await escribir(page, "Daño probable", "Politraumatismo")
  await elegirOpcion(page, "Factor de riesgo", "Mecánico")
  await elegir(page, "¿Es una tarea rutinaria?", "Rutinaria")
  await irAPaso(page, "Evaluación")
  await elegir(page, "Probabilidad", /^4 · Alta/)
  await elegir(page, "Consecuencia", /^4 · Alta/)
  // El badge del RE-04 pega rótulo y magnitud sin espacio entre nodos
  // ("Intolerable· MR 16"): el `\s*` no es laxitud, es el DOM real.
  await expect(nivel(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Intolerable" })).toBeVisible()
  await irAPaso(page, "Medidas de control")
  await guardado(page, () => elegir(page, "¿Está controlado el riesgo?", "Parcialmente"))

  // Medida con jerarquía, responsable y plazo.
  await agregarMedida(page, { tipo: "III. Controles de ingeniería", descripcion: "Topes de descarga y señalero en pendiente", responsable: "Supervisor de turno" })
  await volverALaTarea(page)

  // Envío (paso 7). La recarga relee el servidor: además de tirar el estado
  // optimista, comprueba que el riesgo y su medida quedaron persistidos antes de
  // enviar —el guardado automático es asíncrono y un envío a medio guardar
  // enviaría una foto incompleta—.
  await expect(async () => {
    await page.reload()
    const riesgo = page.getByRole("link", { name: "Riesgo #1: Camión en pendiente", exact: true })
    await expect(riesgo).toContainText(/Intolerable\s*·\s*MR 16/, { timeout: 5_000 })
    await expect(riesgo).toContainText("1 medida", { timeout: 5_000 })
    await expect(riesgo).toContainText("Controlado: Parcialmente", { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  // La F2 activó la regla del §5.1: un riesgo Intolerable no se envía sin una
  // medida vinculada a una actividad del Programa de Trabajo, así que el flujo
  // incluye ese paso (el detalle de la ejecución se prueba en
  // `prevencion-miper-programa.spec.ts`).
  await page.getByRole("tab", { name: "Plan de medidas" }).click()
  await cabecera(page).getByRole("button", { name: "Generar actividades" }).click()
  const generador = page.getByRole("dialog", { name: "Generar actividades desde el MIPER" })
  await generador.getByLabel("Actividad", { exact: true }).fill("Inspección de la pendiente de descarga")
  await generador.getByRole("combobox", { name: "Responsable de la actividad de la fila 1" }).click()
  await page.getByRole("option", { name: "Prevencionista Faena E2E", exact: true }).click()
  await generador.getByRole("combobox", { name: "Frecuencia de la actividad de la fila 1" }).click()
  await page.getByRole("option", { name: "Anual", exact: true }).click()
  await generador.getByRole("button", { name: /Aplicar decisiones/ }).click()
  await expect(generador).toBeHidden()

  await page.getByRole("tab", { name: "Revisión" }).click()
  await cabecera(page).getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  await expect(estado(page, "Enviado a revisión")).toBeVisible()
})

test("la Jefa observa el riesgo y la prevencionista corrige y reenvía", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto("/prevencion/miper")
  // La base E2E es compartida: otra prueba puede dejar su propia ronda pendiente
  // en la misma faena. La portada por faena (Fase B) da un enlace por cada MIPER
  // que espera algo de ti, «<motivo> · MIPER <período>»: se busca el de ESTE
  // período y se comprueba que lleva a ESTA MIPER.
  const id = miperUrl.split("/").pop()!
  await expect(jefa.getByRole("link", { name: `Revisar · Faena E2E · ${PERIOD}`, exact: true })).toHaveAttribute("href", `/prevencion/miper/${id}?tab=revision`)
  await jefa.goto(miperUrl)
  // La apertura de la ronda la registra el cliente al entrar y no revalida, así
  // que la etiqueta sólo cambia cuando la página vuelve a leer el servidor: se
  // reintenta el par recarga + aserción en vez de asumir que el efecto alcanzó.
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, "En revisión por Prevención")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  // La Jefa abre el riesgo desde la matriz y lo observa desde el panel lateral,
  // que la deja en el paso «Seguimiento».
  await abrirRiesgo(jefa, 1, "Camión en pendiente")
  await jefa.getByRole("button", { name: "Observar este riesgo", exact: true }).click()
  await expect(jefa.getByRole("tab", { name: /Seguimiento/, selected: true })).toBeVisible()
  await jefa.getByLabel("Nueva observación").fill("Revisar consecuencia. De acuerdo con el daño probable indicado debería evaluarse nuevamente la probabilidad.")
  await jefa.getByRole("button", { name: "Registrar observación", exact: true }).click()
  await expect(jefa.getByRole("region", { name: "Observaciones del riesgo" }).getByText("Abierta", { exact: true })).toBeVisible()
  await jefa.goto(`${miperUrl}?tab=revision`)
  await cabecera(jefa).getByRole("button", { name: "Devolver con observaciones", exact: true }).click()
  const confirm = jefa.getByRole("dialog", { name: "Devolver con observaciones" })
  await confirm.getByRole("textbox").fill("Revisar la evaluación del riesgo #1.")
  await confirm.getByRole("button", { name: "Devolver" }).click()
  await expect(estado(jefa, "Con observaciones")).toBeVisible()

  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(`${miperUrl}?tab=revision`)
  await prev.getByLabel("Tu respuesta").fill("Se reevaluó la probabilidad: el tránsito en pendiente es ocasional.")
  await prev.getByRole("button", { name: "Responder" }).click()
  await prev.getByRole("tab", { name: /Riesgos/ }).click()
  await abrirRiesgo(prev, 1, "Camión en pendiente")
  await irAPaso(prev, "Evaluación")
  await guardado(prev, () => elegir(prev, "Probabilidad", /^2 · Media/))
  await expect(nivel(prev, /Importante\s*·\s*MR 8/)).toBeVisible()
  // La reevaluación tiene que estar en la base antes de reenviar: si no, la
  // ronda llevaría la evaluación anterior y la Jefa no vería ninguna modificación.
  await expect(async () => {
    await prev.reload()
    await expect(nivel(prev, /Importante\s*·\s*MR 8/)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await prev.goto(`${miperUrl}?tab=revision`)
  await cabecera(prev).getByRole("button", { name: "Reenviar a revisión", exact: true }).click()
  await expect(estado(prev, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()

  // La Jefa ve el riesgo «Modificada» en la tarea y aprueba técnicamente.
  await jefa.reload()
  await jefa.goto(miperUrl)
  await abrirRiesgo(jefa, 1, "Camión en pendiente")
  await volverALaTarea(jefa)
  await expect(jefa.getByRole("link", { name: "Riesgo #1: Camión en pendiente", exact: true })).toContainText("Modificada")
  await jefa.goto(`${miperUrl}?tab=revision`)
  await cabecera(jefa).getByRole("button", { name: "Aprobar revisión técnica", exact: true }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("Legal y RRHH aprueba: queda vigente v1 y un cambio posterior queda pendiente", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(`${miperUrl}?tab=revision`)
  await cabecera(legal).getByRole("button", { name: "Aprobar (Legal y RRHH)", exact: true }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Emisión inicial del documento.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(estado(legal, "Vigente · v1")).toBeVisible()
  // La descarga de la versión sellada vive en «Más» de la cabecera.
  await cabecera(legal).getByRole("button", { name: "Más acciones de la MIPER", exact: true }).click()
  const download = legal.waitForEvent("download")
  await legal.getByRole("menuitem", { name: "Descargar v1 (Excel)", exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^RE-04-MIPER-E2E-001-2030-v1\.xlsx$/)

  // Paso 16: el vigente es mutable; el cambio queda pendiente de revisión.
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(miperUrl)
  await crearTarea(prev, { actividad: "Transporte de lodo", tarea: "Limpieza de la tolva", puesto: "Conductor profesional", peligro: "Superficie resbaladiza" })
  // Igual que arriba: la etiqueta depende de `updated_at > published_at`, que la
  // escribe la mutación, así que se reintenta la recarga en vez de correr una
  // carrera contra el guardado.
  await expect(async () => {
    await prev.reload()
    await expect(estado(prev, "Vigente v1 · cambios pendientes de revisión")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  // Paso 17: historial con actor y rol.
  // Tras crear la tarea el editor sigue abierto: «Volver al documento» devuelve a las áreas.
  await prev.getByRole("link", { name: "Volver al documento" }).click()
  await prev.getByRole("tab", { name: "Historial" }).click()
  await expect(textoVisible(prev, "Aprobada y sellada por Legal y RRHH")).toBeVisible()
  await expect(textoVisible(prev, "Devuelta con observaciones")).toBeVisible()
  // El actor va sobre la línea del sellado, no suelto: la misma persona y el
  // mismo rol firmaron también la apertura de la ronda ("Revisión iniciada"), y
  // la aserción suelta resolvía a dos nodos.
  await expect(prev.getByRole("listitem").filter({ hasText: "Aprobada y sellada por Legal y RRHH" }))
    .toContainText("Legal y RRHH E2E (Legal y RRHH)")
})
