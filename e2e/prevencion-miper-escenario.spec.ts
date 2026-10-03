import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expectPageTitle, listRecord, login, pickCurrentMonthDate, textoVisible, MINIMAL_PNG } from "./helpers"
import {
  abrirRiesgo, agregarMedida, cabecera, crearTarea, elegir, elegirOpcion, escribir, guardado, irAPaso, nivel, volverALaTarea,
} from "./miper-helpers"

/**
 * E2E MIPER — el **escenario completo del §12** (Task 8 de la Parte IV del
 * plan 2026-09-30, líneas 8789–8839): los 17 pasos en **un solo** recorrido
 * determinista, por UI y con las tres personas sembradas en `e2e/setup-db.ts`
 * (`prev.faena@`, `jefa.prevencion@` y `legal.rrhh@`).
 *
 * Cobertura por paso (§12) y de dónde sale cada localizador:
 *
 * | Paso | Test | Origen del localizador |
 * |---|---|---|
 * | 1 crear MIPER | 1 | `prevencion-miper-flujo.spec.ts` |
 * | 2 antecedentes | 1 | idem |
 * | 3 actividades/tareas/puestos, peligros/riesgos | 1 | idem |
 * | 4 P×C → MR y clasificación | 1 | idem |
 * | 5 medidas (tipo, responsable, plazo) | 1 | `prevencion-miper-programa.spec.ts` |
 * | 6 generar actividades reutilizando una | 1 | idem |
 * | 7 enviar a revisión | 1 | idem |
 * | 8 la Jefa observa | 2 | `prevencion-miper-flujo.spec.ts` |
 * | 9 responder, corregir, reenviar; «Modificada» | 2 | idem |
 * | 10 aprobar (técnica y Legal y RRHH) | 3 | idem |
 * | 11 vigente v1 y ocurrencias | 3 | `prevencion-miper-programa.spec.ts` |
 * | 12 «Se hizo» + evidencia + avance | 4 | idem |
 * | 13 «No se hizo» → Incumplida | 5 | idem |
 * | 14 avance general (Resumen de la MIPER + portada + programa) | 6 | Fase B: pestaña «Resumen» y fila de la portada |
 * | 15 trazabilidad en ambos sentidos | 7 | `prevencion-miper-programa.spec.ts` |
 * | 16 riesgo nuevo → v2 y v1 consultable | 8 | F1 + el ciclo de sellado |
 * | 17 historial con actor, rol, fecha y hora | 9 | `prevencion-miper-flujo.spec.ts` |
 *
 * **Nada de datos a mano ni cálculos fuera de la plataforma**: la MIPER se
 * crea por UI, el MR y la clasificación los calcula la plataforma (P×C), y el
 * avance se lee del que deriva el propio producto. El único dato que viaja en
 * este archivo es el vocabulario de la prueba (actividades, medidas y textos
 * que quien opera teclea), no una fila sembrada.
 *
 * **Período 2028 y no 2027 (el de F2).** El servicio rechaza dos MIPER del
 * mismo período para la misma faena (`createMiper`), así que compartir 2027 con
 * `prevencion-miper-programa.spec.ts` rompería la corrida completa: el que
 * llegue segundo no podría crear la suya. Con 2028 y una definición **anual**
 * cuya fecha programada por defecto es hoy (2026-10-01), el período genera
 * exactamente tres ocurrencias (31-10-2026, 31-10-2027 y 31-10-2028); los pasos
 * 12 y 13 usan las dos primeras. Es la misma dependencia del mes de la corrida
 * que ya tiene F2 (que espera 31-10-2026/2027), no una nueva.
 *
 * **Sobre el «responsable de actividad» (§12, línea 8798).** El plan pide tres
 * personas «más un responsable». El sembrado no trae una cuarta persona con
 * `prevention:risk:view` sobre `ws-e2e`, y la rama nominal del producto
 * (`canExecuteProgramAction`: responsable de la actividad con `risk:view`) la
 * ejerce la propia prevencionista, que es como ya lo hace F2. Se dejó así —sin
 * tocar `setup-db.ts`, que sólo se modifica si de verdad falta un dato— y la
 * desviación queda declarada en `qa/reports/2026-10-01-miper-f3.md`.
 */
test.describe.configure({ mode: "serial" })

const PERIOD = "2028"
const ACTIVITY_DESC = "Ejecutar las guardas de la correa transportadora"
const MEASURE_1 = "Instalar guardas fijas en la correa transportadora"
const MEASURE_2 = "Instalar guardas fijas en la correa de descarga"
const EVIDENCE_NAME = "e2e-ejecucion.png"

let miperUrl = ""

const contexts: BrowserContext[] = []

/**
 * Observabilidad del recorrido (no afirma nada): lo que el informe de la F3
 * necesita declarar sobre errores de consola y fallos de red. Se recoge de forma
 * pasiva —el último test del archivo los imprime— para que un `console.error`
 * del producto se vea en la salida de la corrida sin convertir la prueba en un
 * detector de ruido del entorno.
 */
const consoleProblems: string[] = []
const serverErrors: string[] = []
const failedRequests: string[] = []

async function as(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  page.on("console", (message) => { if (message.type() === "error") consoleProblems.push(`${email} · ${message.text()}`) })
  page.on("pageerror", (error) => consoleProblems.push(`${email} · pageerror: ${error.message}`))
  page.on("response", (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`) })
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "sin detalle"}`))
  await login(page, email)
  return page
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()))
})

/**
 * El rótulo de estado del espacio de trabajo (`miperStatusLabel`), acotado al
 * `banner` (el `TopBar`): la descripción de la página viaja dos veces al DOM y
 * sin acotar resolvería a dos nodos. Idéntico a los dos specs de la fase.
 */
const estado = (page: Page, label: string | RegExp) => page.getByRole("banner").getByText(label)

/**
 * Abre el detalle de la actividad N° 1 del panel del programa. Desde la Fase E
 * es una vista (`?actividad=`) y no un `Sheet`: un enlace que lleva a la
 * `region` «Actividad N° 1».
 */
async function abrirActividad(page: Page) {
  await page.getByRole("link", { name: "Abrir el detalle de la actividad N° 1", exact: true }).click()
  const detalle = page.getByRole("region", { name: "Actividad N° 1", exact: true })
  await expect(detalle).toBeVisible()
  return detalle
}

/**
 * Las ocurrencias del detalle, identificadas **por orden** y no por su fecha.
 *
 * F2 las localiza con la fecha literal («Registrar la ocurrencia del
 * 31-10-2026»), que ata la prueba al día en que se corre. Acá la agenda se lee
 * del propio producto: la primera ocurrencia del período es la de menor
 * vencimiento y las demás siguen. Se usan índices para no recalcular fechas
 * fuera de la plataforma.
 */
const ocurrenciasDe = (page: Page) => page.getByRole("button", { name: /^Registrar la ocurrencia del / })

test("pasos 1–7: la prevencionista crea la MIPER, la completa, genera el programa y la envía", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto("/prevencion/miper")
  await expectPageTitle(page, "Matriz IPER (MIPER)")
  // «Nueva MIPER» vive en la cabecera. La portada por faena (Fase B) ya no
  // repite el alta en un estado vacío, y la fila de una faena sin MIPER ofrece
  // «Crear MIPER de <faena>», que es otro nombre.
  await cabecera(page).getByRole("button", { name: "Nueva MIPER", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
  // El único combobox del diálogo es la faena: el período es un número y el
  // punto de partida, radios.
  await dialog.getByRole("combobox").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.getByLabel("Período").fill(PERIOD)
  await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
  await dialog.getByLabel("Motivo").fill("Escenario completo del §12 para la prueba E2E de la F3.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  // La MIPER nueva abre con la «Ficha del documento» (los antecedentes RE-04).
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?ficha=1/)
  miperUrl = page.url().split("?")[0]!
  const ficha = page.getByRole("dialog", { name: "Ficha del documento" })
  await expect(ficha).toBeVisible()

  // Paso 2: antecedentes (representante en faena y dotación coherente).
  await ficha.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await ficha.getByLabel("N° total de trabajadores").fill("3")
  await ficha.getByLabel("Trabajadores hombres").fill("2")
  await ficha.getByLabel("Trabajadoras mujeres").fill("1")
  await ficha.getByLabel("Trabajadores otro").fill("0")
  await ficha.getByRole("button", { name: "Guardar antecedentes" }).click()
  await expect(textoVisible(page, "Antecedentes guardados")).toBeVisible()
  await expect(ficha).toBeHidden()

  // Pasos 3–5: dos tareas, cada una con su riesgo evaluado y su medida. El
  // riesgo #1 es Intolerable (4×4 → MR 16) y el #2 Tolerable (1×2 → MR 2); la
  // plataforma calcula ambos.
  await crearTarea(page, { actividad: "Operación de la correa transportadora", tarea: "Transporte de material", puesto: "Operador de correa", peligro: "Correa en movimiento" })
  await escribir(page, "Riesgo", "Atrapamiento de la mano")
  await escribir(page, "Daño probable", "Amputación de dedo")
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
  await agregarMedida(page, { tipo: "III. Controles de ingeniería", descripcion: MEASURE_1, responsable: "Supervisor de turno" })

  await crearTarea(page, { actividad: "Mantención del sistema de descarga", tarea: "Mantención preventiva", puesto: "Técnico mecánico", peligro: "Partes móviles" })
  await escribir(page, "Riesgo", "Golpe en la mano")
  await escribir(page, "Daño probable", "Contusión")
  await elegirOpcion(page, "Factor de riesgo", "Mecánico")
  await elegir(page, "¿Es una tarea rutinaria?", "Rutinaria")
  await irAPaso(page, "Evaluación")
  await elegir(page, "Probabilidad", /^1 · Baja/)
  await elegir(page, "Consecuencia", /^2 · Media/)
  await expect(nivel(page, /Tolerable\s*·\s*MR 2/)).toBeVisible()
  await irAPaso(page, "Medidas de control")
  await guardado(page, () => elegir(page, "¿Está controlado el riesgo?", "Parcialmente"))
  await agregarMedida(page, { tipo: "IV. Controles administrativos", descripcion: MEASURE_2, responsable: "Supervisor de turno" })
  await volverALaTarea(page)

  // Paso 7, la regla dura: sin medida vinculada, el Intolerable no se envía. La
  // UI anticipa el bloqueo del servidor y el clic abre el detalle de lo que
  // falta —el hallazgo H2-01— en vez de dejar llegar el rechazo a la acción.
  await cabecera(page).getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  const bloqueo = page.getByRole("dialog", { name: "Falta 1 dato para enviar" })
  await expect(bloqueo).toContainText("Un riesgo Intolerable exige una medida vinculada a una actividad del Programa de Trabajo.")
  await page.keyboard.press("Escape")
  await expect(bloqueo).toBeHidden()
  await expect(estado(page, /Borrador/)).toBeVisible()

  // Paso 6: generar el programa reutilizando UNA actividad para las dos medidas.
  await page.getByRole("tab", { name: "Programa" }).click()
  await expect(textoVisible(page, "Esta MIPER todavía no tiene Programa de Trabajo")).toBeVisible()
  await page.getByRole("button", { name: "Generar actividades" }).click()
  const gen = page.getByRole("dialog", { name: "Generar actividades desde el MIPER" })
  // La deduplicación propone UNA agrupación con las dos medidas parecidas.
  await expect(gen.getByText("Medidas de la fila 1, 2")).toBeVisible()
  await gen.getByLabel("Actividad", { exact: true }).fill(ACTIVITY_DESC)
  await gen.getByRole("combobox", { name: "Responsable de la actividad de la fila 1, 2" }).click()
  await page.getByRole("option", { name: "Prevencionista Faena E2E", exact: true }).click()
  // La frecuencia por defecto del generador es «Mensual»: la del escenario es
  // anual, o el período generaría una ocurrencia por mes en vez de las tres.
  await gen.getByRole("combobox", { name: "Frecuencia de la actividad de la fila 1, 2" }).click()
  await page.getByRole("option", { name: "Anual", exact: true }).click()
  await gen.getByRole("button", { name: /Aplicar decisiones/ }).click()
  await expect(gen).toBeHidden()
  await expect(textoVisible(page, ACTIVITY_DESC)).toBeVisible()
  await expect(textoVisible(page, "Filas 1, 2 del MIPER")).toBeVisible()

  // Paso 7: con el vínculo hecho no queda ningún bloqueo —el «Siguiente paso»
  // lo dice— y el envío pasa sin abrir el detalle de pendientes.
  await expect(textoVisible(page, "Lista para enviar a revisión")).toBeVisible()
  await cabecera(page).getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  // Primero el estado nuevo (el envío ya resolvió) y recién entonces la
  // ausencia del diálogo: antes de eso el «0» pasaba aunque el diálogo fuera a abrirse.
  await expect(estado(page, "Enviado a revisión")).toBeVisible()
  await expect(page.getByRole("dialog", { name: /^Faltan \d+ datos? para enviar$/ })).toHaveCount(0)
})

test("pasos 8–9: la Jefa observa, la prevencionista corrige y reenvía, la Jefa ve «Modificada»", async ({ browser }) => {
  const id = miperUrl.split("/").pop()!
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto("/prevencion/miper")
  // Fase B: la portada por faena da un enlace por cada MIPER que espera algo de
  // ti, «<motivo> · MIPER <período>». Se busca el de ESTE período y se comprueba
  // que lleva a ESTA MIPER. La fila y la tarjeta móvil lo repiten; `getByRole`
  // sólo ve la visible.
  await expect(jefa.getByRole("link", { name: `Pendiente de tu revisión · MIPER ${PERIOD}`, exact: true })).toHaveAttribute("href", `/prevencion/miper/${id}`)

  // F3 — la «atención de Prevención» (§9.1) trae el hecho «esperando revisión
  // técnica», con enlace al paso de revisión de esta MIPER. Es la contraparte en
  // bandeja de la notificación de la campana.
  await jefa.goto("/prevencion")
  await expect(jefa.locator(`a[href="/prevencion/miper/${id}?tab=revision"]`)).toBeVisible()

  // F3 — la campana: el aviso del flujo salió al enviar («MIPER enviada a
  // revisión», `planMiperReviewStep`) y enlaza al paso de revisión de ESTA
  // MIPER. Se reintenta porque el aviso se crea después del COMMIT.
  await expect(async () => {
    await jefa.goto("/prevencion/miper")
    await jefa.getByRole("button", { name: /^Notificaciones/ }).click()
    await expect(jefa.locator(`a[href="/prevencion/miper/${id}?tab=revision"]`).first()).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  // Paso 8: abrir la MIPER registra el inicio de la ronda; la etiqueta sólo
  // cambia cuando la página vuelve a leer el servidor.
  await jefa.goto(miperUrl)
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, "En revisión por Prevención")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  // La Jefa abre el riesgo desde la matriz y lo observa desde el panel lateral,
  // que la deja en el paso «Seguimiento».
  await abrirRiesgo(jefa, 1, "Correa en movimiento")
  await jefa.getByRole("button", { name: "Observar este riesgo", exact: true }).click()
  await expect(jefa.getByRole("tab", { name: /Seguimiento/, selected: true })).toBeVisible()
  await jefa.getByLabel("Nueva observación").fill("Revisar consecuencia. De acuerdo con el daño probable indicado debería evaluarse nuevamente la probabilidad.")
  await jefa.getByRole("button", { name: "Registrar observación", exact: true }).click()
  await expect(jefa.getByRole("region", { name: "Observaciones del riesgo" }).getByText("Abierta", { exact: true })).toBeVisible()
  await cabecera(jefa).getByRole("button", { name: "Devolver con observaciones", exact: true }).click()
  const confirm = jefa.getByRole("dialog", { name: "Devolver con observaciones" })
  await confirm.getByRole("textbox").fill("Revisar la evaluación del riesgo #1.")
  await confirm.getByRole("button", { name: "Devolver" }).click()
  await expect(estado(jefa, "Con observaciones")).toBeVisible()

  // Paso 9: la prevencionista responde, reevalúa P y reenvía.
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(`${miperUrl}?tab=revision`)
  await prev.getByLabel("Tu respuesta").fill("Se reevaluó la probabilidad: el tránsito en la correa es ocasional.")
  await prev.getByRole("button", { name: "Responder" }).click()
  await prev.getByRole("tab", { name: /Matriz/ }).click()
  await abrirRiesgo(prev, 1, "Correa en movimiento")
  await irAPaso(prev, "Evaluación")
  await guardado(prev, () => elegir(prev, "Probabilidad", /^2 · Media/))
  await expect(nivel(prev, /Importante\s*·\s*MR 8/)).toBeVisible()
  // La reevaluación tiene que estar en la base antes de reenviar.
  await expect(async () => {
    await prev.reload()
    await expect(nivel(prev, /Importante\s*·\s*MR 8/)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await cabecera(prev).getByRole("button", { name: "Reenviar a revisión", exact: true }).click()
  await expect(estado(prev, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()

  // La Jefa ve el riesgo como «Modificada» en su tarea y aprueba técnicamente.
  await jefa.reload()
  await volverALaTarea(jefa)
  await expect(jefa.getByRole("link", { name: "Riesgo #1: Correa en movimiento", exact: true })).toContainText("Modificada")
  await cabecera(jefa).getByRole("button", { name: "Aprobar revisión técnica", exact: true }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("pasos 10–11: Legal y RRHH sella la v1, las ocurrencias nacen y el libro se descarga sellado y vivo", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  // Paso 10: aprobación de Legal y RRHH → v1 vigente.
  await cabecera(legal).getByRole("button", { name: "Aprobar (Legal y RRHH)", exact: true }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Emisión inicial del MIPER 2028 con su Programa de Trabajo.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(estado(legal, "Vigente · v1")).toBeVisible()

  // La descarga por defecto es la versión SELLADA: lo que se archiva al aprobar.
  // Vive en «Más» de la cabecera.
  await cabecera(legal).getByRole("button", { name: "Más acciones de la MIPER", exact: true }).click()
  const download = legal.waitForEvent("download")
  const sealedLink = legal.getByRole("menuitem", { name: "Descargar v1 (Excel)", exact: true })
  const sealedHref = await sealedLink.getAttribute("href")
  await sealedLink.click()
  expect((await download).suggestedFilename()).toMatch(/^RE-04-MIPER-E2E-001-2028-v1\.xlsx$/)

  // F3 — la exportación del ESTADO VIVO (`?estado=vivo`, Task 6) existe como ruta
  // y distingue la leyenda «Incluye cambios no aprobados» con el sufijo «-vivo».
  // **Hallazgo F3-01**: la UI no ofrece el enlace —sólo el sellado—, así que se
  // verifica por la ruta, no por pantalla.
  const liveResponse = await legal.request.get(new URL(`${sealedHref}?estado=vivo`, legal.url()).toString())
  expect(liveResponse.status()).toBe(200)
  expect(liveResponse.headers()["content-disposition"]).toContain("-vivo.xlsx")

  // Paso 11: con la versión sellada nacen las ocurrencias del programa. En
  // borrador no existían (asserción del paso 6); acá son las del período.
  await legal.goto(`${miperUrl}?tab=programa`)
  await expect(legal.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  const sheet = await abrirActividad(legal)
  await expect(sheet.getByText("Sin ocurrencias planificadas")).toHaveCount(0)
  // El período 2028 con una definición anual genera tres ocurrencias. Legal y
  // RRHH no ejecuta el programa (no es el responsable ni tiene el permiso de
  // ejecución), así que las ve con su vencimiento pero sin el botón «Registrar»:
  // se afirman las filas de ocurrencia, no el control de ejecución.
  await expect(sheet.getByText(/^Vence el /).nth(1)).toBeVisible()
})

test("paso 12: el responsable marca «Se hizo» con fecha efectiva y evidencia, y el avance se actualiza", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  await expect(page.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  // Avance inicial: nada registrado y las tres ocurrencias del período planificadas.
  await expect(page.getByText("0/3 realizadas")).toBeVisible()
  const sheet = await abrirActividad(page)
  await ocurrenciasDe(page).nth(0).click()
  const record = page.getByRole("dialog", { name: /Registrar la ocurrencia del / })
  // La fecha efectiva NO viene prellenada aunque el diálogo declare ese default
  // (`OccurrenceDialog.handleOpenChange`): sin elegirla en el `DatePicker` el
  // submit nunca se habilita (hallazgo F2-03).
  await pickCurrentMonthDate(page, /Fecha efectiva de la ejecución/)
  // «Se hizo» exige la evidencia.
  await record.locator('input[type="file"]').setInputFiles({
    name: EVIDENCE_NAME,
    mimeType: "image/png",
    buffer: MINIMAL_PNG,
  })
  await expect(record.getByText(/Archivo subido/)).toBeVisible()
  await record.getByRole("button", { name: "Registrar ocurrencia" }).click()
  await expect(record).toBeHidden()
  // El avance derivado se actualiza: 1 de 3, 33 %.
  await expect(sheet.getByText("Realizada")).toBeVisible()
  await expect(sheet.getByText("1/3 · 33% realizado")).toBeVisible()
  await expect(sheet.getByText("2 pendiente(s) · 0 incumplida(s)")).toBeVisible()
})

test("paso 13: la otra ocurrencia se marca «No se hizo», queda Incumplida y no suma al avance", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  const sheet = await abrirActividad(page)
  await ocurrenciasDe(page).nth(1).click()
  const record = page.getByRole("dialog", { name: /Registrar la ocurrencia del / })
  await record.getByRole("combobox", { name: "Resultado de la ocurrencia" }).click()
  await page.getByRole("option", { name: "No se hizo", exact: true }).click()
  await record.getByLabel("Motivo", { exact: true }).fill("No se ejecutó por indisponibilidad de la guarda en bodega.")
  await record.getByRole("button", { name: "Registrar ocurrencia" }).click()
  await expect(record).toBeHidden()
  // Incumplida: no suma al avance (sigue 1 de 3) y queda contada aparte.
  await expect(sheet.getByText("No realizada")).toBeVisible()
  await expect(sheet.getByText("1/3 · 33% realizado")).toBeVisible()
  await expect(sheet.getByText("1 pendiente(s) · 1 incumplida(s)")).toBeVisible()
})

test("paso 14: la Jefa consulta el avance en el «Resumen» de la MIPER, en la portada y en el programa", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(`${miperUrl}?tab=resumen`)
  await expectPageTitle(jefa, /^MIPER Faena E2E/)
  await expect(jefa.getByRole("tab", { name: "Resumen", selected: true })).toBeVisible()

  // Las cifras del Resumen que enlazan (A1). «No controlados» está en 0 (los dos riesgos quedaron
  // «Parcialmente»), así que no enlaza: se ve, pero no lleva a una lista vacía.
  for (const rotulo of [/^Riesgos completos/, /^Importantes e Intolerables/, /^Avance del programa/]) {
    await expect(jefa.getByRole("link", { name: rotulo })).toBeVisible()
  }
  // El avance es el que deriva `programProgress` de las ocurrencias: 1 de 3.
  const avance = jefa.getByRole("link", { name: /^Avance del programa/ })
  await expect(avance).toContainText("33%")
  await expect(avance).toContainText("1/3 realizadas")
  // La completitud por actividad, en el orden del RE-04.
  await expect(jefa.getByRole("progressbar", { name: /^Operación de la correa transportadora: / })).toBeVisible()

  // La fila de la faena en la portada muestra el mismo avance (el programa de la vigente).
  await jefa.goto("/prevencion/miper")
  await expect(listRecord(jefa, "Faena E2E")).toContainText("33% · 1/3")

  // «Elaboró» en la franja de la matriz: sin ronda abierta, quien elaboró la v1.
  await jefa.goto(miperUrl)
  await expect(jefa.getByRole("definition").filter({ hasText: "Prevencionista Faena E2E" })).toBeVisible()

  // La cifra del programa lleva a la pestaña Programa, que dice lo mismo.
  await jefa.goto(`${miperUrl}?tab=resumen`)
  await jefa.getByRole("link", { name: /^Avance del programa/ }).click()
  await expect(jefa).toHaveURL(/tab=programa/)
  await expect(jefa.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  await expect(jefa.getByText("1/3 realizadas")).toBeVisible()
})

test("paso 15: trazabilidad de la actividad al riesgo y del riesgo a sus medidas, actividades y evidencias", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  const sheet = await abrirActividad(page)
  // De la actividad a las medidas del MIPER que ejecuta.
  await expect(sheet.getByText(MEASURE_1)).toBeVisible()
  await expect(sheet.getByText(MEASURE_2)).toBeVisible()
  // …y a la evidencia que registró la ejecución de su ocurrencia. Desde la Fase E
  // vive en el diálogo «Evidencia de la ocurrencia» (C7), no en la lista de registros.
  await sheet.getByRole("listitem").filter({ has: page.getByText("Realizada", { exact: true }) })
    .getByRole("button", { name: /^Ver la evidencia de la ocurrencia del / }).click()
  const evidencia = page.getByRole("dialog", { name: "Evidencia de la ocurrencia" })
  await expect(evidencia.getByText(EVIDENCE_NAME)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(evidencia).toBeHidden()
  // De la actividad al riesgo que la originó: «Ver la fila N en la MIPER».
  // El enlace abre el editor del riesgo (la matriz, sin `tab`) y deja atrás el detalle.
  await sheet.getByRole("link", { name: "Ver la fila 1 en la MIPER", exact: true }).click()
  await expect(page).toHaveURL(/fila=/)
  await expect(page).not.toHaveURL(/tab=/)
  await expect(page.getByRole("region", { name: "Actividad N° 1", exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 2, name: "Correa en movimiento" })).toBeVisible()
  await expect(page.getByText(/^Riesgo #1 · /)).toBeVisible()
  // Del riesgo a sus medidas…
  await expect(page.getByRole("tab", { name: /Medidas de control \(1\)/ })).toBeVisible()
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: `Medida: ${MEASURE_1}` })).toBeVisible()
  // …y del riesgo a la actividad del programa que la ejecuta (§7.3, los dos sentidos).
  await irAPaso(page, "Seguimiento")
  const programa = page.getByRole("region", { name: "Programa de Trabajo del riesgo" })
  await expect(programa.getByRole("heading", { name: "Programa de Trabajo (1)" })).toBeVisible()
  await expect(programa.getByText("Actividad #1", { exact: true })).toBeVisible()
})

test("paso 16: un riesgo nuevo al vigente aplica al instante, se envía, se revisa y se sella la v2", async ({ browser }) => {
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(miperUrl)
  await expect(estado(prev, "Vigente · v1")).toBeVisible()

  // Riesgo #3, Tolerable (1×2 → MR 2) y no controlado: aplica al vigente de inmediato.
  expect(await crearTarea(prev, { actividad: "Limpieza de pasarelas", tarea: "Aseo programado", puesto: "Operario de aseo", peligro: "Superficie resbaladiza" })).toBe(3)
  await escribir(prev, "Riesgo", "Caída al mismo nivel")
  await escribir(prev, "Daño probable", "Contusión")
  await elegirOpcion(prev, "Factor de riesgo", "Mecánico")
  await elegir(prev, "¿Es una tarea rutinaria?", "Rutinaria")
  await irAPaso(prev, "Evaluación")
  await elegir(prev, "Probabilidad", /^1 · Baja/)
  await elegir(prev, "Consecuencia", /^2 · Media/)
  await expect(nivel(prev, /Tolerable\s*·\s*MR 2/)).toBeVisible()
  await irAPaso(prev, "Medidas de control")
  await guardado(prev, () => elegir(prev, "¿Está controlado el riesgo?", "No"))
  // La etiqueta «cambios pendientes» ya podía existir antes de este riesgo, así
  // que esperar sólo eso no prueba que su último dato se guardó: se espera
  // además el «Siguiente paso» que sólo aparece **sin ningún bloqueo** en el
  // servidor («Hay cambios sin revisar desde v1»; con un dato faltante diría
  // «Faltan datos en N riesgos»). Sin esto, la recarga puede ganarle a la
  // escritura y el envío abre el diálogo de bloqueos.
  await expect(async () => {
    await prev.goto(miperUrl)
    await expect(estado(prev, "Vigente v1 · cambios pendientes de revisión")).toBeVisible({ timeout: 5_000 })
    await expect(textoVisible(prev, "Hay cambios sin revisar desde v1")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  // El cambio pendiente se envía y vuelve a recorrer el flujo hasta sellar la v2.
  await cabecera(prev).getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  await expect(estado(prev, /enviado a revisión|en revisión por Prevención/)).toBeVisible()

  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(miperUrl)
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, /en revisión por Prevención/)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await cabecera(jefa).getByRole("button", { name: "Aprobar revisión técnica", exact: true }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /pendiente de aprobación Legal y RRHH/)).toBeVisible()

  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  await cabecera(legal).getByRole("button", { name: "Aprobar (Legal y RRHH)", exact: true }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Se agrega el riesgo de caída al mismo nivel en pasarelas.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(estado(legal, "Vigente · v2")).toBeVisible()

  // La v1 sigue consultable: la pestaña Historial lista las dos versiones
  // selladas, cada una con su descarga.
  await legal.goto(`${miperUrl}?tab=historial`)
  await expect(legal.getByRole("heading", { name: "Versiones aprobadas" })).toBeVisible()
  await expect(textoVisible(legal, "Versión 1")).toBeVisible()
  await expect(textoVisible(legal, "Versión 2")).toBeVisible()
  await expect(legal.getByRole("link", { name: "Descargar Excel" })).toHaveCount(2)
})

test("paso 17: todo el proceso queda en el historial con actor, rol, fecha y hora", async ({ browser }) => {
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(`${miperUrl}?tab=historial`)
  await expect(prev.getByRole("heading", { name: "Versiones aprobadas" })).toBeVisible()

  // El rótulo del actor nunca va suelto: la misma persona firmó también la
  // apertura de la ronda y el sellado, así que se acota a la línea del sellado.
  // Hay DOS sellados (v1 y v2): se toma la primera línea, que es la más reciente.
  await expect(textoVisible(prev, "Aprobada y sellada por Legal y RRHH").first()).toBeVisible()
  await expect(textoVisible(prev, "Devuelta con observaciones")).toBeVisible()
  const sellado = prev.getByRole("listitem").filter({ hasText: "Aprobada y sellada por Legal y RRHH" }).first()
  await expect(sellado).toContainText("Legal y RRHH E2E (Legal y RRHH)")
  // Fecha y hora: la bitácora marca el instante con `formatDateTime` sobre el
  // `<time dateTime>`.
  await expect(sellado.locator("time")).toHaveAttribute("dateTime", /T\d{2}:\d{2}/)
  await expect(prev.getByRole("listitem").filter({ hasText: "Revisión técnica aprobada" }).first())
    .toContainText("Jefa Prevención E2E (Jefatura del Depto. de Prevención)")
})

/**
 * Notas del recorrido (no es un paso del §12 y no afirma nada): imprime lo que
 * la instrumentación pasiva de `as()` recogió durante los 17 pasos, para que el
 * informe de la F3 pueda declarar con datos —y no de memoria— si hubo errores de
 * consola, respuestas 5xx o peticiones fallidas.
 */
test("notas del escenario: consola y red observadas en los 17 pasos", async () => {
  const notas = {
    console: consoleProblems.length === 0 ? "sin errores de consola ni pageerror" : consoleProblems,
    "server-5xx": serverErrors.length === 0 ? "sin respuestas 5xx" : serverErrors,
    "request-failed": failedRequests.length === 0 ? "sin peticiones fallidas" : failedRequests,
  }
  console.log(`[miper-escenario] consola y red: ${JSON.stringify(notas)}`)
  test.info().annotations.push(...Object.entries(notas).map(([type, value]) => ({
    type,
    description: Array.isArray(value) ? Array.from(new Set(value)).join(" | ") : value,
  })))
})
