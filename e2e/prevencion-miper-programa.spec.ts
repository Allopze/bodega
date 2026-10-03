import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expectPageTitle, login, pickCurrentMonthDate, textoVisible, MINIMAL_PNG } from "./helpers"
import {
  agregarMedida, cabecera, crearTarea, elegir, elegirOpcion, escribir, guardado, irAPaso, nivel, volverALaTarea,
} from "./miper-helpers"

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
 * Trazabilidad (§7.2 / §8.1): de la actividad al riesgo del MIPER con «Ver la
 * fila N en la MIPER», que abre el editor del riesgo; ahí, el paso «Medidas de
 * control» lista sus medidas y el paso «Seguimiento» las actividades del
 * programa que las ejecutan (el sentido riesgo → actividades, que faltaba en la
 * ficha de la grilla: hallazgo F2-01 de `qa/reports/2026-10-01-miper-f2.md`).
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
 * El rótulo de estado del espacio de trabajo (`miperStatusLabel`), acotado al
 * `banner` (el `TopBar`): la descripción de la página viaja dos veces al DOM y
 * sin acotar resolvería a dos nodos.
 */
const estado = (page: Page, label: string | RegExp) => page.getByRole("banner").getByText(label)

/** Abre el detalle de la actividad N° 1 del panel del programa. */
async function abrirActividad(page: Page) {
  await page.getByRole("button", { name: "Abrir el detalle de la actividad N° 1" }).click()
  return page.getByRole("dialog", { name: "Actividad N° 1" })
}

test("la prevencionista arma la matriz, el envío se bloquea sin medida vinculada y la generación agrupa dos medidas en una actividad", async ({ browser }) => {
  const page = await as(browser, "prev.faena@e2e.chome.cl")
  await page.goto("/prevencion/miper")
  await expectPageTitle(page, "Matriz IPER (MIPER)")
  await cabecera(page).getByRole("button", { name: "Nueva MIPER", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
  await dialog.getByRole("combobox").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  await dialog.getByLabel("Período").fill(PERIOD)
  await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
  await dialog.getByLabel("Motivo").fill("Elaboración inicial del programa 2027 para la prueba E2E de F2.")
  await dialog.getByRole("button", { name: "Crear borrador" }).click()
  // La MIPER nueva abre con la «Ficha del documento» (los antecedentes RE-04).
  await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?ficha=1/)
  miperUrl = page.url().split("?")[0]!
  const ficha = page.getByRole("dialog", { name: "Ficha del documento" })
  await expect(ficha).toBeVisible()

  await ficha.getByLabel("Representante de la empresa en la faena (Administrador de contrato)").fill("Administrador E2E")
  await ficha.getByLabel("N° total de trabajadores").fill("3")
  await ficha.getByLabel("Trabajadores hombres").fill("2")
  await ficha.getByLabel("Trabajadoras mujeres").fill("1")
  await ficha.getByLabel("Trabajadores otro").fill("0")
  await ficha.getByRole("button", { name: "Guardar antecedentes" }).click()
  await expect(textoVisible(page, "Antecedentes guardados")).toBeVisible()
  await expect(ficha).toBeHidden()

  // Riesgo #1: Intolerable (P×C 4×4 → MR 16) con su medida.
  await crearTarea(page, { actividad: "Operación de la correa transportadora", tarea: "Transporte de material", puesto: "Operador de correa", peligro: "Correa en movimiento" })
  await escribir(page, "Riesgo", "Atrapamiento de la mano")
  await escribir(page, "Daño probable", "Amputación de dedo")
  await elegirOpcion(page, "Factor de riesgo", "Mecánico")
  await elegir(page, "¿Es una tarea rutinaria?", "Rutinaria")
  await irAPaso(page, "Evaluación")
  await elegir(page, "Probabilidad", /^4 · Alta/)
  await elegir(page, "Consecuencia", /^4 · Alta/)
  await expect(nivel(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()
  await irAPaso(page, "Medidas de control")
  await guardado(page, () => elegir(page, "¿Está controlado el riesgo?", "Parcialmente"))
  await agregarMedida(page, { tipo: "III. Controles de ingeniería", descripcion: MEASURE_1, responsable: "Supervisor de turno" })

  // Riesgo #2: Tolerable (P×C 1×2), con una medida que se parece a la del #1.
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

  // Paso 7 del §12, la regla dura: sin medida vinculada, el Intolerable no se envía.
  // La UI **anticipa** el bloqueo del servidor (hallazgo H2-01 del informe): el
  // clic abre el detalle de lo que falta, en vez de dejar llegar el envío —y el
  // rechazo— a la acción. El mismo conteo lo aplica el servidor al enviar, con
  // `requireProgramLink`.
  await cabecera(page).getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  const bloqueo = page.getByRole("dialog", { name: "Falta 1 dato para enviar" })
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
  // H2-01, el otro lado de la regresión): el «Siguiente paso» dice que está
  // lista y el envío pasa sin abrir el detalle de pendientes.
  await expect(textoVisible(page, "Lista para enviar a revisión")).toBeVisible()
  await cabecera(page).getByRole("button", { name: "Enviar a revisión", exact: true }).click()
  // Primero el estado nuevo (el envío ya resolvió) y recién entonces la
  // ausencia del diálogo: antes de eso el «0» pasaba aunque el diálogo fuera a abrirse.
  await expect(estado(page, "Enviado a revisión")).toBeVisible()
  await expect(page.getByRole("dialog", { name: /^Faltan? \d+ datos? para enviar$/ })).toHaveCount(0)
})

test("la Jefa aprueba la revisión técnica y la MIPER pasa a Legal y RRHH", async ({ browser }) => {
  const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
  await jefa.goto(miperUrl)
  await expect(async () => {
    await jefa.reload()
    await expect(estado(jefa, "En revisión por Prevención")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await cabecera(jefa).getByRole("button", { name: "Aprobar revisión técnica", exact: true }).click()
  await jefa.getByRole("dialog", { name: "Aprobar revisión técnica" }).getByRole("button", { name: "Aprobar revisión técnica" }).click()
  await expect(estado(jefa, /Pendiente de aprobación Legal y RRHH/)).toBeVisible()
})

test("Legal y RRHH aprueba y sella la v1 y las ocurrencias nacen con la versión", async ({ browser }) => {
  const legal = await as(browser, "legal.rrhh@e2e.chome.cl")
  await legal.goto(miperUrl)
  await cabecera(legal).getByRole("button", { name: "Aprobar (Legal y RRHH)", exact: true }).click()
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
  // De la actividad al riesgo que la originó: «Ver la fila N en la MIPER» abre
  // el editor del riesgo (la matriz, sin `tab`) y deja atrás el detalle.
  await sheet.getByRole("button", { name: "Ver la fila 1 en la MIPER" }).click()
  await expect(page).toHaveURL(/fila=/)
  await expect(page).not.toHaveURL(/tab=/)
  await expect(page.getByRole("dialog", { name: "Actividad N° 1" })).toBeHidden()
  await expect(page.getByRole("heading", { level: 2, name: "Correa en movimiento" })).toBeVisible()
  await expect(page.getByText(/^Riesgo #1 · /)).toBeVisible()
  // Del riesgo a sus medidas.
  await expect(page.getByRole("tab", { name: /Medidas de control \(1\)/ })).toBeVisible()
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: `Medida: ${MEASURE_1}` })).toBeVisible()
  // Y del riesgo a la actividad del programa que la ejecuta (§7.3 en los dos
  // sentidos): sin esta sección la relación sólo se podía recorrer desde el
  // programa, que fue el hallazgo F2-01 del informe.
  await irAPaso(page, "Seguimiento")
  const programa = page.getByRole("region", { name: "Programa de Trabajo del riesgo" })
  await expect(programa.getByRole("heading", { name: "Programa de Trabajo (1)" })).toBeVisible()
  await expect(programa.getByText("Actividad #1", { exact: true })).toBeVisible()
})
