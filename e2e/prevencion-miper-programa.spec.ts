import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expectPageTitle, login, pickCurrentMonthDate, textoVisible, MINIMAL_PNG } from "./helpers"

/**
 * E2E MIPER F2 — el Programa de Trabajo Preventivo RE-04.1 (Task 9, Step 2 del
 * plan de la Parte III del spec 2026-09-30): pasos 6 y 11–15 del §12.
 *
 * Tres personas con **sólo** su permiso —`prev.faena@` (edición y ejecución
 * nominal), `jefa.prevencion@` (revisión técnica) y `legal.rrhh@` (aprobación
 * Legal y RRHH), sembradas en `e2e/setup-db.ts`—: la segregación que se prueba
 * es la del producto. El ciclo completo es el de F1 (crear el borrador, llenar
 * la matriz, enviar, revisar y sellar) porque las ocurrencias **sólo nacen con
 * la versión sellada** (§7.4): en borrador la actividad existe y el programa no
 * tiene ocurrencias ejecutables.
 *
 * El spec del flujo F1 (`prevencion-miper-flujo.spec.ts`) usa el período 2030 en
 * la misma faena; éste usa 2027 y una definición **anual** con fecha programada
 * de hoy, de modo que el período 2027 genera exactamente dos ocurrencias
 * (31-10-2026 y 31-10-2027): una para «Se hizo» y otra para «No se hizo».
 *
 * Trazabilidad (§7.2 / §8.1): la actividad y el riesgo se recorren en el sentido
 * que el producto ofrece hoy —de la actividad a la fila del MIPER con «Ver la
 * fila N en la MIPER», y del riesgo a sus medidas en la ficha—. El sentido
 * riesgo → actividades **no se afirma acá**: la ficha de la fila
 * (`entry-sheet.tsx`) no renderiza la sección «actividades derivadas» que el
 * spec promete, así que no existe control que localizar; queda reportado como
 * hallazgo de producto en `qa/reports/2026-10-01-miper-f2.md` y no se disimula
 * con un locator más laxo.
 */
test.describe.configure({ mode: "serial" })

const PERIOD = "2027"
const ACTIVITY_DESC = "Ejecutar las guardas de la correa transportadora"
const MEASURE_1 = "Instalar guardas fijas en la correa transportadora"
const MEASURE_2 = "Instalar guardas fijas en la correa de descarga"

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
 * Una celda de la grilla por su `aria-label` real (`matrix-grid.tsx`). Mismo
 * contrato que `prevencion-miper-flujo.spec.ts`: los dos casos son `combobox`
 * (las columnas de texto son `<input list>` y las demás `<select>` nativos).
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
 * sin acotar resolvería a dos nodos.
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

test("la prevencionista arma la matriz, el envío se bloquea sin medida vinculada y la generación agrupa dos medidas en una actividad", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto("/prevencion/miper")
  await expectPageTitle(page, "Matriz IPER (MIPER)")
  await page.getByRole("button", { name: "Nueva MIPER" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
  await dialog.getByRole("combobox").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.getByLabel("Período").fill(PERIOD)
  await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
  await dialog.getByLabel("Motivo").fill("Elaboración inicial del programa 2027 para la prueba E2E de F2.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?tab=antecedentes/)
  miperUrl = page.url().split("?")[0]!

  await page.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await page.getByLabel("N° total de trabajadores").fill("3")
  await page.getByLabel("Trabajadores hombres").fill("2")
  await page.getByLabel("Trabajadoras mujeres").fill("1")
  await page.getByLabel("Trabajadores otro").fill("0")
  await page.getByRole("button", { name: "Guardar antecedentes" }).click()
  await expect(textoVisible(page, "Antecedentes guardados")).toBeVisible()

  // Fila 1: Intolerable (P×C 4×4 → MR 16) con su medida.
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
  await expect(textoVisible(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()
  await cell(page, "¿Controlado?", 1).selectOption("partial")
  await agregarMedida(page, 1, { hierarchy: "engineering", description: MEASURE_1 })

  // Fila 2: Tolerable (P×C 1×2), con una medida que se parece a la de la fila 1.
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

  // Paso 7 del §12, la regla dura: sin medida vinculada, el Intolerable no se envía.
  // La UI **anticipa** el bloqueo del servidor (hallazgo H2-01 del informe): el
  // botón anuncia el pendiente y el clic abre el detalle de lo que falta, en vez
  // de dejar llegar el envío —y el rechazo— a la acción. El mismo conteo lo
  // aplica el servidor al enviar, con `requireProgramLink`.
  await page.getByRole("button", { name: "Enviar a revisión (1 pendientes)", exact: true }).click()
  const bloqueo = page.getByRole("dialog", { name: "Faltan 1 datos para enviar" })
  await expect(bloqueo).toContainText("Un riesgo Intolerable exige una medida vinculada a una actividad del Programa de Trabajo.")
  await page.keyboard.press("Escape")
  await expect(bloqueo).toBeHidden()
  // El bloqueo no movió el estado: sigue en borrador.
  await expect(estado(page, /Borrador/)).toBeVisible()

  // Paso 6 del §12: generar las actividades del programa reutilizando una para varias medidas.
  await page.getByRole("tab", { name: "Programa" }).click()
  await expect(textoVisible(page, "Esta MIPER todavía no tiene Programa de Trabajo")).toBeVisible()
  await page.getByRole("button", { name: "Generar actividades" }).click()
  const gen = page.getByRole("dialog", { name: "Generar actividades desde el MIPER" })
  // La deduplicación propone UNA agrupación con las dos medidas parecidas, y la
  // persona decide qué hacer con ella.
  await expect(gen.getByText("Medidas de la fila 1, 2")).toBeVisible()
  // `exact: true` obligatorio: el aviso de la fila Intolerable contiene la misma
  // descripción entre comillas («…») y sin `exact` resolvería a dos nodos.
  await expect(gen.getByText(MEASURE_1, { exact: true })).toBeVisible()
  await expect(gen.getByText(MEASURE_2, { exact: true })).toBeVisible()
  await expect(gen.getByRole("alert")).toContainText("La fila 1 tiene un riesgo Intolerable")
  // La persona decide: una sola actividad nueva que ejecuta las dos medidas.
  await gen.getByLabel("Actividad", { exact: true }).fill(ACTIVITY_DESC)
  await gen.getByRole("combobox", { name: "Responsable de la actividad de la fila 1, 2" }).click()
  await page.getByRole("option", { name: "Prevencionista Faena E2E", exact: true }).click()
  await gen.getByRole("combobox", { name: "Frecuencia de la actividad de la fila 1, 2" }).click()
  await page.getByRole("option", { name: "Anual", exact: true }).click()
  await gen.getByRole("button", { name: /Aplicar decisiones/ }).click()
  // El diálogo cierra al aplicar y el mensaje de la acción («Programa generado:
  // 1 actividad(es)…») no se pinta en ninguna parte (hallazgo F2-02 del informe):
  // la confirmación observable es la fila del programa, que se afirma abajo.
  await expect(gen).toBeHidden()

  // La actividad quedó vinculada a las DOS medidas (la fila 1 y la fila 2).
  await expect(textoVisible(page, ACTIVITY_DESC)).toBeVisible()
  await expect(textoVisible(page, "Filas 1, 2 del MIPER")).toBeVisible()
  await expect(textoVisible(page, "Anual")).toBeVisible()

  const sheet = await abrirActividad(page)
  await expect(sheet.getByText(MEASURE_1)).toBeVisible()
  await expect(sheet.getByText(MEASURE_2)).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Ver la fila 1 en la MIPER" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Ver la fila 2 en la MIPER" })).toBeVisible()
  // En borrador la actividad NO tiene ocurrencias ejecutables (§7.4).
  await expect(sheet.getByText("Sin ocurrencias: se generan al sellar la versión sellada del MIPER.")).toBeVisible()
  await expect(sheet.getByText("Sin ocurrencias planificadas")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Actividad N° 1" })).toBeHidden()

  // Con el vínculo hecho, la UI deja de anunciar el pendiente (mismo hallazgo
  // H2-01, el otro lado de la regresión) y el envío pasa.
  await expect(page.getByRole("button", { name: /Enviar a revisión \(\d+ pendientes\)/ })).toHaveCount(0)
  await page.getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  await expect(estado(page, "Enviado a revisión")).toBeVisible()
})

test("la Jefa aprueba la revisión técnica y la MIPER pasa a Legal y RRHH", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(miperUrl)
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, "En revisión por Prevención")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await jefa.getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("Legal y RRHH aprueba y sella la v1 y las ocurrencias nacen con la versión", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  await legal.getByRole("button", { name: "Aprobar (Legal y RRHH)" }).click()
  await legal.getByLabel("Resumen de cambios (hoja Modificaciones)").fill("Emisión inicial del MIPER 2027 con su Programa de Trabajo.")
  await legal.getByRole("button", { name: "Aprobar y sellar" }).click()
  await expect(estado(legal, "Vigente · v1")).toBeVisible()

  // Paso 11 del §12: el MIPER queda vigente y las ocurrencias aparecen. En borrador
  // no existían (aserción del primer test); acá son dos, las del programa anual.
  await legal.goto(`${miperUrl}?tab=programa`)
  await expect(legal.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  const sheet = await abrirActividad(legal)
  await expect(sheet.getByText("Vence el 31-10-2026")).toBeVisible()
  await expect(sheet.getByText("Vence el 31-10-2027")).toBeVisible()
  await expect(sheet.getByText("Sin ocurrencias planificadas")).toHaveCount(0)
})

test("sellada la v1, el responsable marca «Se hizo» con fecha efectiva y evidencia y el avance se actualiza", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  await expect(page.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  // Avance inicial: nada registrado, dos ocurrencias planificadas.
  await expect(page.getByText("0/2 realizadas")).toBeVisible()
  const sheet = await abrirActividad(page)
  await sheet.getByRole("button", { name: "Registrar la ocurrencia del 31-10-2026" }).click()
  const record = page.getByRole("dialog", { name: "Registrar la ocurrencia del 31-10-2026" })
  // La fecha efectiva NO viene prellenada con hoy aunque el diálogo declare ese
  // default (`OccurrenceDialog.handleOpenChange`): el diálogo se monta controlado
  // por `open`, así que Radix nunca dispara `onOpenChange(true)` y el estado
  // inicial queda vacío. Hay que elegir la fecha en el `DatePicker` o el submit
  // nunca se habilita (hallazgo F2-03 del informe, con su evidencia textual).
  await pickCurrentMonthDate(page, /Fecha efectiva de la ejecución/)
  // «Se hizo» exige la evidencia.
  await record.locator('input[type="file"]').setInputFiles({
    name: "e2e-ejecucion.png",
    mimeType: "image/png",
    buffer: MINIMAL_PNG,
  })
  await expect(record.getByText(/Archivo subido/)).toBeVisible()
  await record.getByRole("button", { name: "Registrar ocurrencia" }).click()
  // El diálogo cierra al registrar; el mensaje de la acción no se muestra (F2-02).
  await expect(record).toBeHidden()
  // El avance derivado se actualiza: 1 de 2, 50 %.
  await expect(sheet.getByText("Realizada")).toBeVisible()
  await expect(sheet.getByText("1/2 · 50% realizado")).toBeVisible()
  await expect(sheet.getByText("1 pendiente(s) · 0 incumplida(s)")).toBeVisible()

  // La ficha de evidencia nombra el archivo como lo vio la persona (hallazgo
  // H2-02 del informe): el rótulo es el nombre original que ella eligió y el
  // nombre interno de almacenamiento queda como dato secundario, nunca al revés.
  await sheet.getByRole("button", { name: "Ver la evidencia de la ocurrencia del 31-10-2026" }).click()
  const evidencia = page.getByRole("dialog", { name: "Evidencia de la ocurrencia" })
  await expect(evidencia.getByText("e2e-ejecucion.png")).toBeVisible()
  await expect(evidencia.getByText(/^Archivo almacenado: [\w-]+\.png$/)).toBeVisible()
  // El botón de retirar nombra el archivo con el mismo rótulo que ve la persona.
  await expect(evidencia.getByRole("button", { name: "Retirar la evidencia e2e-ejecucion.png" })).toBeVisible()
})

test("la otra ocurrencia se marca «No se hizo»: queda Incumplida y cuenta 0", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  const sheet = await abrirActividad(page)
  await sheet.getByRole("button", { name: "Registrar la ocurrencia del 31-10-2027" }).click()
  const record = page.getByRole("dialog", { name: "Registrar la ocurrencia del 31-10-2027" })
  await record.getByRole("combobox", { name: "Resultado de la ocurrencia" }).click()
  await page.getByRole("option", { name: "No se hizo", exact: true }).click()
  await record.getByLabel("Motivo", { exact: true }).fill("No se ejecutó por indisponibilidad de la guarda en bodega.")
  await record.getByRole("button", { name: "Registrar ocurrencia" }).click()
  await expect(record).toBeHidden()
  // Incumplida: no suma al avance (sigue 1 de 2) y queda contada aparte.
  await expect(sheet.getByText("No realizada")).toBeVisible()
  await expect(sheet.getByText("1/2 · 50% realizado")).toBeVisible()
  await expect(sheet.getByText("0 pendiente(s) · 1 incumplida(s)")).toBeVisible()
})

test("la Jefa consulta el avance general del programa", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(`${miperUrl}?tab=programa`)
  await expect(jefa.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
  // Avance del programa en el encabezado RE-04.1 y por actividad en la fila.
  await expect(jefa.getByText("1/2 realizadas")).toBeVisible()
  await expect(jefa.getByText("Avance del programa")).toBeVisible()
  const fila = jefa.getByRole("row").filter({ hasText: ACTIVITY_DESC })
  await expect(fila.getByText("1/2 · 50% realizado")).toBeVisible()
  // El filtro por estado deja a la vista la actividad con la ocurrencia incumplida.
  await jefa.getByRole("combobox", { name: "Filtrar por estado de la actividad" }).click()
  await jefa.getByRole("option", { name: "Con ocurrencias incumplidas", exact: true }).click()
  await expect(fila).toBeVisible()
})

test("trazabilidad: de la actividad al riesgo del MIPER y del riesgo a sus medidas", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto(`${miperUrl}?tab=programa`)
  const sheet = await abrirActividad(page)
  // De la actividad a las medidas del MIPER que ejecuta.
  await expect(sheet.getByText(MEASURE_1)).toBeVisible()
  await expect(sheet.getByText(MEASURE_2)).toBeVisible()
  // De la actividad al riesgo que la originó: «Ver la fila N en la MIPER» abre la ficha.
  await sheet.getByRole("button", { name: "Ver la fila 1 en la MIPER" }).click()
  await expect(page).toHaveURL(/tab=matriz/)
  await expect(page).toHaveURL(/fila=/)
  const risk = page.getByRole("dialog", { name: "Riesgo #1" })
  await expect(risk).toBeVisible()
  // Del riesgo a sus medidas.
  await expect(risk.getByText("Medidas de control (1)")).toBeVisible()
  await expect(risk.getByText(MEASURE_1)).toBeVisible()
  // Y del riesgo a la actividad del programa que la ejecuta (§7.3 en los dos
  // sentidos): sin esta sección la relación sólo se podía recorrer desde el
  // programa, que fue el hallazgo F2-01 del informe.
  await expect(risk.getByText("Programa de Trabajo (1)")).toBeVisible()
  await expect(risk.getByText("Actividad #1")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(risk).toBeHidden()
})
