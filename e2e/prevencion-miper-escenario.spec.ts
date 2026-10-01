import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expectPageTitle, login, pickCurrentMonthDate, textoVisible, MINIMAL_PNG } from "./helpers"

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
 * | 14 avance general (Resumen + programa) | 6 | F3: `dashboard-panel.tsx` |
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
 * Una celda de la grilla por su `aria-label` real (`matrix-grid.tsx`). Mismo
 * contrato que los dos specs de F1/F2: los dos casos son `combobox`.
 */
const cell = (page: Page, column: string, row = 1) =>
  page.getByRole("combobox", { name: `${column} riesgo ${row}`, exact: true })

/** Escribe una celda y la guarda: la grilla persiste al perder el foco. */
async function escribir(page: Page, column: string, row: number, value: string) {
  await cell(page, column, row).fill(value)
  await cell(page, column, row).press("Tab")
}

/**
 * El rótulo de estado del espacio de trabajo (`miperStatusLabel`), acotado al
 * `banner` (el `TopBar`): la descripción de la página viaja dos veces al DOM y
 * sin acotar resolvería a dos nodos. Idéntico a los dos specs de la fase.
 */
const estado = (page: Page, label: string | RegExp) => page.getByRole("banner").getByText(label)

/** Agrega una medida a la fila indicada desde su ficha (`Riesgo #N`). */
async function agregarMedida(page: Page, row: number, medida: { hierarchy: string; description: string }) {
  await page.getByRole("button", { name: new RegExp(`Medidas de control del riesgo ${row}`) }).click()
  const sheet = page.getByRole("dialog", { name: `Riesgo #${row}` })
  await sheet.getByRole("button", { name: "Agregar medida" }).click()
  await sheet.getByLabel("Tipo de control", { exact: true }).selectOption(medida.hierarchy)
  await sheet.getByLabel("Descripción de la medida").fill(medida.description)
  await sheet.getByLabel("Nombre o cargo responsable").fill("Supervisor de turno")
  await pickCurrentMonthDate(page, /Plazo de la medida/)
  await sheet.getByRole("button", { name: "Agregar medida" }).click()
  await expect(sheet.getByText(medida.description)).toBeVisible()
  // La ficha vive en `?fila=<id>`: cerrarla es un `router.replace` asíncrono.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: `Riesgo #${row}` })).toBeHidden()
  await expect(page).not.toHaveURL(/fila=/)
}

/** Abre el detalle de la actividad N° 1 del panel del programa. */
async function abrirActividad(page: Page) {
  await page.getByRole("button", { name: "Abrir el detalle de la actividad N° 1" }).click()
  return page.getByRole("dialog", { name: "Actividad N° 1" })
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
  await dialog.getByLabel("Motivo").fill("Escenario completo del §12 para la prueba E2E de la F3.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?tab=antecedentes/)
  miperUrl = page.url().split("?")[0]!

  // Paso 2: antecedentes (representante en faena y dotación coherente).
  await page.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await page.getByLabel("N° total de trabajadores").fill("3")
  await page.getByLabel("Trabajadores hombres").fill("2")
  await page.getByLabel("Trabajadoras mujeres").fill("1")
  await page.getByLabel("Trabajadores otro").fill("0")
  await page.getByRole("button", { name: "Guardar antecedentes" }).click()
  await expect(textoVisible(page, "Antecedentes guardados")).toBeVisible()

  // Pasos 3–5: dos filas con su evaluación y su medida. La fila 1 es Intolerable
  // (4×4 → MR 16) y la 2 Tolerable (1×2 → MR 2); la plataforma calcula ambos.
  await page.getByRole("tab", { name: /Matriz/ }).click()
  await page.getByRole("button", { name: "Agregar la primera fila" }).click()
  await expect(cell(page, "Actividad", 1)).toBeVisible()
  await escribir(page, "Actividad", 1, "Operación de la correa transportadora")
  await escribir(page, "Tarea", 1, "Transporte de material")
  await escribir(page, "Puesto de trabajo", 1, "Operador de correa")
  await escribir(page, "Peligro", 1, "Correa en movimiento")
  await escribir(page, "Riesgo", 1, "Atrapamiento de la mano")
  await escribir(page, "Daño probable", 1, "Amputación de dedo")
  await cell(page, "Factor de riesgo", 1).selectOption({ label: "Mecánico" })
  await cell(page, "Rutinaria", 1).selectOption("yes")
  await cell(page, "Probabilidad", 1).selectOption("4")
  await cell(page, "Consecuencia", 1).selectOption("4")
  // El badge del RE-04 pega rótulo y magnitud sin espacio entre nodos
  // ("Intolerable· MR 16"): el `\s*` no es laxitud, es el DOM real.
  await expect(textoVisible(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Intolerable" })).toBeVisible()
  await cell(page, "¿Controlado?", 1).selectOption("partial")
  await agregarMedida(page, 1, { hierarchy: "engineering", description: MEASURE_1 })

  await page.getByRole("button", { name: "Agregar fila", exact: true }).click()
  await expect(cell(page, "Actividad", 2)).toBeVisible()
  await escribir(page, "Actividad", 2, "Mantención del sistema de descarga")
  await escribir(page, "Tarea", 2, "Mantención preventiva")
  await escribir(page, "Puesto de trabajo", 2, "Técnico mecánico")
  await escribir(page, "Peligro", 2, "Partes móviles")
  await escribir(page, "Riesgo", 2, "Golpe en la mano")
  await escribir(page, "Daño probable", 2, "Contusión")
  await cell(page, "Factor de riesgo", 2).selectOption({ label: "Mecánico" })
  await cell(page, "Rutinaria", 2).selectOption("yes")
  await cell(page, "Probabilidad", 2).selectOption("1")
  await cell(page, "Consecuencia", 2).selectOption("2")
  await expect(textoVisible(page, /Tolerable\s*·\s*MR 2/)).toBeVisible()
  await cell(page, "¿Controlado?", 2).selectOption("partial")
  await agregarMedida(page, 2, { hierarchy: "administrative", description: MEASURE_2 })

  // Paso 7, la regla dura: sin medida vinculada, el Intolerable no se envía. La
  // UI anticipa el bloqueo del servidor y el clic abre el detalle de lo que
  // falta —el hallazgo H2-01— en vez de dejar llegar el rechazo a la acción.
  await page.getByRole("button", { name: "Enviar a revisión (1 pendientes)", exact: true }).click()
  const bloqueo = page.getByRole("dialog", { name: "Faltan 1 datos para enviar" })
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

  // Paso 7: con el vínculo hecho, el aviso del pendiente desaparece y el envío pasa.
  await expect(page.getByRole("button", { name: /Enviar a revisión \(\d+ pendientes\)/ })).toHaveCount(0)
  await page.getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  await expect(estado(page, "Enviado a revisión")).toBeVisible()
})

test("pasos 8–9: la Jefa observa, la prevencionista corrige y reenvía, la Jefa ve «Modificada»", async ({ browser }) => {
  const id = miperUrl.split("/").pop()!
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto("/prevencion/miper")
  // La tarjeta de la bandeja se identifica por el enlace a ESTA MIPER y no por el
  // rótulo suelto (que podría repetirse con otra ronda pendiente).
  await expect(jefa.locator(`a[href="/prevencion/miper/${id}"]`)).toContainText("Pendiente de tu revisión")

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

  // Paso 9: la prevencionista responde, reevalúa P y reenvía.
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(`${miperUrl}?tab=revision`)
  await prev.getByLabel("Tu respuesta").fill("Se reevaluó la probabilidad: el tránsito en la correa es ocasional.")
  await prev.getByRole("button", { name: "Responder" }).click()
  await prev.getByRole("tab", { name: /Matriz/ }).click()
  await cell(prev, "Probabilidad").selectOption("2")
  await expect(textoVisible(prev, /Importante\s*·\s*MR 8/)).toBeVisible()
  // La reevaluación tiene que estar en la base antes de reenviar.
  await prev.reload()
  await expect(textoVisible(prev, /Importante\s*·\s*MR 8/)).toBeVisible()
  await prev.getByRole("button", { name: "Reenviar a revisión" }).click()
  await expect(estado(prev, /Enviado a revisión|En revisión por Prevención/)).toBeVisible()

  // La Jefa ve la fila como «Modificada» y aprueba técnicamente.
  await jefa.reload()
  await expect(textoVisible(jefa, "Modificada")).toBeVisible()
  await jefa.getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("pasos 10–11: Legal y RRHH sella la v1, las ocurrencias nacen y el libro se descarga sellado y vivo", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  // Paso 10: aprobación de Legal y RRHH → v1 vigente.
  await legal.getByRole("button", { name: "Aprobar (Legal y RRHH)" }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Emisión inicial del MIPER 2028 con su Programa de Trabajo.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(estado(legal, "Vigente · v1")).toBeVisible()

  // La descarga por defecto es la versión SELLADA: lo que se archiva al aprobar.
  const download = legal.waitForEvent("download")
  const sealedLink = legal.getByRole("link", { name: "Descargar v1 (Excel)" })
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

test("paso 14: la Jefa consulta el avance general en la pestaña «Resumen» y en el programa", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto("/prevencion/miper?tab=resumen")
  await expectPageTitle(jefa, "Matriz IPER (MIPER)")

  // Los CUATRO tiles accionables (regla A1): cada uno enlaza a su subconjunto.
  for (const label of [/Por hacer/, /Intolerables e Importantes/, /Sin controlar/, /Avance del programa/]) {
    await expect(jefa.getByRole("link", { name: label })).toBeVisible()
  }
  // La franja secundaria en texto, con las cifras que no son KPI de tarjeta.
  // `exact: true` es obligatorio: «Tolerables» es subcadena de «Intolerables e
  // Importantes» y de «Riesgos no tolerables sin control declarado» (los tiles),
  // y sin exacto la aserción resolvía a tres nodos.
  for (const figure of ["MIPER vigentes", "Con observaciones", "Tolerables", "Moderados", "Medidas pendientes", "Actividades vencidas"]) {
    await expect(jefa.getByText(figure, { exact: true })).toBeVisible()
  }
  // El avance del tablero es el derivado por `programProgress` sobre las
  // ocurrencias: 1 de 3, el mismo que muestra la pestaña del programa.
  await expect(textoVisible(jefa, "1 de 3 actividades realizadas")).toBeVisible()
  await expect(textoVisible(jefa, "33% · 1/3")).toBeVisible()

  await jefa.goto(`${miperUrl}?tab=programa`)
  await expect(jefa.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  await expect(jefa.getByText("1/3 realizadas")).toBeVisible()
  await expect(textoVisible(jefa, "Avance del programa")).toBeVisible()
})

test("paso 15: trazabilidad de la actividad al riesgo y del riesgo a sus medidas, actividades y evidencias", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  const sheet = await abrirActividad(page)
  // De la actividad a las medidas del MIPER que ejecuta.
  await expect(sheet.getByText(MEASURE_1)).toBeVisible()
  await expect(sheet.getByText(MEASURE_2)).toBeVisible()
  // …y a la evidencia que registró la ejecución de su ocurrencia.
  await expect(textoVisible(page, EVIDENCE_NAME)).toBeVisible()
  // De la actividad al riesgo que la originó: «Ver la fila N en la MIPER».
  await sheet.getByRole("button", { name: "Ver la fila 1 en la MIPER" }).click()
  await expect(page).toHaveURL(/tab=matriz/)
  await expect(page).toHaveURL(/fila=/)
  const risk = page.getByRole("dialog", { name: "Riesgo #1" })
  await expect(risk).toBeVisible()
  // Del riesgo a sus medidas…
  await expect(risk.getByText("Medidas de control (1)")).toBeVisible()
  await expect(risk.getByText(MEASURE_1)).toBeVisible()
  // …y del riesgo a la actividad del programa que la ejecuta (§7.3, los dos sentidos).
  await expect(risk.getByText("Programa de Trabajo (1)")).toBeVisible()
  await expect(risk.getByText("Actividad #1")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(risk).toBeHidden()
})

test("paso 16: un riesgo nuevo al vigente aplica al instante, se envía, se revisa y se sella la v2", async ({ browser }) => {
  const prev = await as(browser, "prev.faena@e2e.chome.cl")
  await prev.goto(miperUrl)
  await expect(estado(prev, "Vigente · v1")).toBeVisible()

  // Fila 3, Tolerable (1×2 → MR 2) y no controlada: aplica al vigente de inmediato.
  await prev.getByRole("button", { name: "Agregar fila", exact: true }).click()
  await expect(cell(prev, "Actividad", 3)).toBeVisible()
  await escribir(prev, "Actividad", 3, "Limpieza de pasarelas")
  await escribir(prev, "Tarea", 3, "Aseo programado")
  await escribir(prev, "Puesto de trabajo", 3, "Operario de aseo")
  await escribir(prev, "Peligro", 3, "Superficie resbaladiza")
  await escribir(prev, "Riesgo", 3, "Caída al mismo nivel")
  await escribir(prev, "Daño probable", 3, "Contusión")
  await cell(prev, "Factor de riesgo", 3).selectOption({ label: "Mecánico" })
  await cell(prev, "Factor de riesgo", 3).press("Tab")
  await cell(prev, "Rutinaria", 3).selectOption("yes")
  await cell(prev, "Rutinaria", 3).press("Tab")
  // Cada `selectOption` se cierra con Tab: la grilla guarda la fila al perder el
  // foco, y sin eso la última celda —la que no tiene otra interacción detrás—
  // nunca llega al servidor y la fila queda incompleta ("Indica si el riesgo está
  // controlado"), con el envío bloqueado.
  await cell(prev, "Probabilidad", 3).selectOption("1")
  await cell(prev, "Probabilidad", 3).press("Tab")
  await cell(prev, "Consecuencia", 3).selectOption("2")
  await cell(prev, "Consecuencia", 3).press("Tab")
  await cell(prev, "¿Controlado?", 3).selectOption("no")
  await cell(prev, "¿Controlado?", 3).press("Tab")
  // La etiqueta «cambios pendientes» ya podía existir antes de esta fila, así que
  // esperar sólo eso no prueba que la última celda se guardó: se espera el botón
  // **sin contador**, que exige la fila completa en el servidor. Sin esto, la
  // recarga puede ganarle a la escritura y el envío abre el diálogo de bloqueos.
  await expect(async () => {
    await prev.reload()
    await expect(estado(prev, "Vigente v1 · cambios pendientes de revisión")).toBeVisible({ timeout: 5_000 })
    await expect(prev.getByRole("button", { name: "Enviar a revisión", exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  // El cambio pendiente se envía y vuelve a recorrer el flujo hasta sellar la v2.
  await prev.getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  await expect(estado(prev, /enviado a revisión|en revisión por Prevención/)).toBeVisible()

  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(miperUrl)
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, /en revisión por Prevención/)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await jefa.getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /pendiente de aprobación Legal y RRHH/)).toBeVisible()

  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  await legal.getByRole("button", { name: "Aprobar (Legal y RRHH)" }).click()
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
