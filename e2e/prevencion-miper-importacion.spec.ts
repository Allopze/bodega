import { test, expect, type Locator, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import ExcelJS from "exceljs"
import { RE04_COLUMNS, RE04_SHEET_NAME } from "../lib/prevention/miper/re04-import"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { expectPageTitle, login } from "./helpers"
import { abrirRiesgo, cabecera, irAPaso } from "./miper-helpers"

/**
 * E2E: importación del RE-04 con medidas (Fase C, spec §8).
 *
 * Cubre:
 *   • Archivo → Filas → Medidas detectadas → Confirmar, con un `.xlsx` hecho con
 *     ExcelJS (frases y plazos del RE-04 real; responsables que son cargos).
 *   • Revisar los tipos no es obligatorio: «Siguiente» avanza con lo sugerido.
 *   • Un FACTORES DE RIESGO con errata («MCANICO») viene asignado a Mecánico y la
 *     fila se carga con ese factor.
 *   • Un responsable del Excel se asigna a una persona; los plazos se mapean una
 *     vez por valor (TRIMESTRAL → existente; INMEDIATO → por implementar hoy).
 *   • El servidor rechaza un mapeo adulterado (falta una frase) y no crea nada.
 *   • Las medidas quedan en cada riesgo con «Existente · verificación …» o «Por
 *     implementar · plazo …», y «…REQUIERE ACCIÓN INMEDIATA» es «Parcialmente».
 *   • axe sobre el paso «Medidas detectadas».
 *   • En Chromium, lo que jsdom no puede probar del paso (Task 9): la «sin pista»
 *     va primero con su tipo como marcador, y elegirlo cuenta; el foco pasa a la
 *     frase siguiente y no al comienzo del diálogo; el camino con teclado; y las
 *     páginas conservan lo decidido.
 *
 * Va a «Faena Restringida E2E», período 2046 (2047 en el reintento de CI):
 * ningún otro spec afirma esa fila ni esos períodos, y el sembrado sólo trae
 * 2035–2040 en esa faena.
 */
const FAENA = "Faena Restringida E2E"

type Fila = Partial<Record<(typeof RE04_COLUMNS)[number], string | number>>
const FILAS: Fila[] = [
  {
    "N°": 1, "ACTIVIDAD": "Traslado de lodo", "TAREA": "Descarga en predio", "PUESTO DE TRABAJO": "Conductor", "FACTORES DE RIESGO": "Mecánico",
    "PELIGRO": "Camión en pendiente", "RIESGO": "Volcamiento", "DAÑO PROBABLE": "Politraumatismo", "PROBABILIDAD": 2, "CONSECUENCIA": 4, "MR": 8,
    "CLASIFICACIÓN DEL RIESGO": "IMPORTANTE",
    "MEDIDA DE CONTROL": "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, SEÑALIZACIÓN DE ÁREAS",
    "¿ESTÁ CONTROLADO EL RIESGO?": "PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA", "RESPONSABLE": "SUPERVISOR/PREVENCION",
    "PLAZOS": "INMEDIATO / ANTES DE CONTINUAR LA TAREA",
  },
  {
    "N°": 2, "ACTIVIDAD": "Mantención", "TAREA": "Cambio de neumático", "PUESTO DE TRABAJO": "Mecánico", "FACTORES DE RIESGO": "Mecánico",
    "PELIGRO": "Herramientas manuales", "RIESGO": "Golpes", "DAÑO PROBABLE": "Contusiones", "PROBABILIDAD": 2, "CONSECUENCIA": 2, "MR": 4,
    "CLASIFICACIÓN DEL RIESGO": "MODERADO",
    "MEDIDA DE CONTROL": "INSTALAR RESGUARDOS EN MAQUINAS\nGUANTES, CASCO, CALZADO DE SEGURIDAD",
    "¿ESTÁ CONTROLADO EL RIESGO?": "PARCIALMENTE CONTROLADO", "RESPONSABLE": "SUPERVISOR/PREVENCION", "PLAZOS": "TRIMESTRAL",
  },
  {
    "N°": 3, "ACTIVIDAD": "Mantención", "TAREA": "Orden de taller", "PUESTO DE TRABAJO": "Mecánico", "FACTORES DE RIESGO": "Físico",
    "PELIGRO": "Piso resbaladizo", "RIESGO": "Caída al mismo nivel", "DAÑO PROBABLE": "Esguince", "PROBABILIDAD": 1, "CONSECUENCIA": 2, "MR": 2,
    "CLASIFICACIÓN DEL RIESGO": "TOLERABLE",
    "MEDIDA DE CONTROL": "MANTENER ORDEN Y LIMPIEZA", "¿ESTÁ CONTROLADO EL RIESGO?": "SÍ, CONTROLADO", "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL",
  },
  {
    // Errata del RE-04 real de Biodiversa: el catálogo no la reconoce por nombre y la vista previa la asigna a Mecánico.
    "N°": 4, "ACTIVIDAD": "Mantención", "TAREA": "Ajuste de frenos", "PUESTO DE TRABAJO": "Mecánico", "FACTORES DE RIESGO": "MCANICO",
    "PELIGRO": "Partes en movimiento", "RIESGO": "Atrapamiento", "DAÑO PROBABLE": "Fracturas", "PROBABILIDAD": 1, "CONSECUENCIA": 2, "MR": 2,
    "CLASIFICACIÓN DEL RIESGO": "TOLERABLE",
  },
]

/** Libro con la forma del RE-04 real (encabezado en 12-13, datos desde la 14) y una marca única en A1. */
async function libro(filas: readonly Fila[] = FILAS): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(RE04_SHEET_NAME)
  sheet.getCell("A1").value = `Matriz IPER · E2E ${Date.now()}`
  RE04_COLUMNS.forEach((label, index) => { sheet.getRow(12).getCell(index + 1).value = label })
  for (const [column, label] of [[14, "PROBABILIDAD"], [15, "CONSECUENCIA"], [16, "MR"], [17, "CLASIFICACIÓN DEL RIESGO"]] as const) {
    sheet.getRow(13).getCell(column).value = label
  }
  filas.forEach((fila, index) => {
    const row = sheet.getRow(14 + index)
    RE04_COLUMNS.forEach((label, column) => {
      const value = fila[label]
      if (value !== undefined) row.getCell(column + 1).value = value
    })
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const pasoActual = (dialogo: Locator) => dialogo.locator('[aria-current="step"]')

/** axe sobre el diálogo abierto (el `Sheet` es modal: lo de atrás queda `aria-hidden`). */
async function auditarDialogo(page: Page) {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).include('[role="dialog"]').analyze()
  expect(results.violations).toEqual([])
}

/** Hoy en Chile como lo escribe `formatDate` (DD-MM-AAAA): «INMEDIATO» se sugiere con esa fecha. */
function hoyEnChile(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value
  return `${part("day")}-${part("month")}-${part("year")}`
}

/** Abre «Importar», llena el paso «Archivo» y pide la vista previa. Devuelve el diálogo. */
async function revisarArchivo(page: Page, buffer: Buffer, periodo?: string): Promise<Locator> {
  await page.goto("/prevencion/miper")
  // Las acciones del PageHeader se pintan en el TopBar (banner) y en una copia `lg:sr-only`.
  await cabecera(page).getByRole("button", { name: "Importar", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Importar el RE-04" })
  await expect(dialogo).toBeVisible()
  await dialogo.getByRole("combobox", { name: "Faena", exact: true }).click()
  await page.getByRole("option", { name: FAENA, exact: true }).click()
  if (periodo) await dialogo.getByLabel("Período del borrador", { exact: true }).fill(periodo)
  await dialogo.getByLabel("Archivo del RE-04", { exact: true }).setInputFiles({
    name: "RE-04 E2E.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer,
  })
  await dialogo.getByRole("button", { name: "Revisar el archivo", exact: true }).click()
  return dialogo
}

test("importar un RE-04 con medidas: tipo, responsable y plazo o frecuencia; el servidor rechaza un mapeo adulterado", async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  // Un reintento en CI encuentra el borrador que dejó la carga del intento anterior: con el mismo
  // período, «Cargar en borrador» quedaría deshabilitado («Ya existe un MIPER del período…») y el
  // timeout taparía la falla original.
  const periodo = String(2046 + testInfo.retry)
  await login(page)

  // 1. Archivo
  const dialogo = await revisarArchivo(page, await libro(), periodo)

  // 2. Filas
  await expect(dialogo.getByText("4 filas en «RE-04 IPER»: 3 para cargar, 1 por revisar y 0 sin cargar.", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(pasoActual(dialogo)).toHaveText("2. Filas")
  const factores = dialogo.getByRole("region", { name: "Factores de riesgo que el catálogo no reconoce", exact: true })
  await expect(factores.getByRole("combobox", { name: "Factor del catálogo para «MCANICO»", exact: true })).toHaveText("Mecánico")
  await expect(dialogo.getByRole("cell", { name: "Lista · factor asignado", exact: true })).toBeVisible()
  await dialogo.getByRole("button", { name: "Siguiente", exact: true }).click()

  // 3. Medidas detectadas: 8 frases, todas con palabra clave; PLAZOS ya sugerido. Revisar los
  // tipos no es obligatorio: «Siguiente» está habilitado desde el comienzo.
  await expect(pasoActual(dialogo)).toHaveText("3. Medidas detectadas")
  const siguiente = dialogo.getByRole("button", { name: "Siguiente", exact: true })
  await expect(siguiente).toBeEnabled()
  await expect(dialogo.getByRole("textbox", { name: "Frecuencia de verificación para «TRIMESTRAL»", exact: true })).toHaveValue("TRIMESTRAL")
  await expect(dialogo.getByRole("combobox", { name: "Cómo se cargan las medidas con «INMEDIATO / ANTES DE CONTINUAR LA TAREA»", exact: true }))
    .toContainText("Por implementar")
  // «INMEDIATO» nace venciendo hoy, y el paso lo dice junto a la decisión, con cuántas medidas afecta.
  await expect(dialogo.getByText("3 medidas vencen hoy, el día de la importación.", { exact: true })).toBeVisible()
  await dialogo.getByRole("combobox", { name: "Responsable para «PREVENCION»", exact: true }).click()
  await page.getByRole("option", { name: "Admin E2E", exact: true }).click()
  await auditarDialogo(page)
  await siguiente.click()

  // 4. Confirmar
  await expect(pasoActual(dialogo)).toHaveText("4. Confirmar")
  await expect(dialogo.getByRole("region", { name: "Qué se va a cargar" })).toContainText("4 riesgos listos para cargar.")
  await expect(dialogo.getByRole("region", { name: "Qué se va a cargar" })).toContainText("8 medidas: 5 existentes y 3 por implementar.")

  // Un cliente adulterado: el cuerpo de la Server Function pierde una frase del mapeo de tipos.
  // El servidor recalcula las claves desde el lote, lo rechaza y no crea nada.
  let adulterado = false
  // Predicado y no glob: la Server Function va a la URL de la página, con o sin query string.
  // Un cuerpo que no se puede adulterar (otra forma de serializar) se aborta: dejarlo pasar
  // haría la carga de verdad y la prueba moriría esperando el rechazo, sin decir por qué.
  await page.route((url) => url.pathname === "/prevencion/miper", async (route) => {
    const request = route.request()
    if (adulterado || request.method() !== "POST" || !request.headers()["next-action"]) return route.fallback()
    let args: unknown
    try { args = JSON.parse(request.postData() ?? "") } catch { return route.abort() }
    const payload = Array.isArray(args) ? (args[0] as { measureMapping?: Record<string, string> } | undefined) : undefined
    if (!payload?.measureMapping) return route.abort()
    delete payload.measureMapping[Object.keys(payload.measureMapping)[0]!]
    adulterado = true
    return route.continue({ postData: JSON.stringify(args) })
  })
  await dialogo.getByRole("button", { name: "Cargar en borrador", exact: true }).click()
  await expect.poll(() => adulterado, {
    message: "el cuerpo de la Server Function no se pudo leer como JSON con `measureMapping`: revisar cómo serializa Next los argumentos",
  }).toBe(true)
  await expect(dialogo.getByRole("alert")).toContainText("falta decidir el tipo de 1 medida", { timeout: 30_000 })
  await page.unrouteAll({ behavior: "wait" })

  // La carga de verdad.
  await dialogo.getByRole("button", { name: "Cargar en borrador", exact: true }).click()
  await page.waitForURL(/\/prevencion\/miper\/riskmatrix-[^/?]+$/, { timeout: 60_000 })
  await expectPageTitle(page, `MIPER ${FAENA} ${periodo}`)
  const matriz = page.url()

  // Riesgo 1 (Importante): medidas por implementar con el responsable escrito y el plazo de hoy.
  // «¿Está controlado el riesgo?» vive en el paso «Medidas de control».
  await abrirRiesgo(page, 1, "Camión en pendiente")
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("radiogroup", { name: "¿Está controlado el riesgo?" }).getByRole("radio", { name: "Parcialmente", exact: true }))
    .toHaveAttribute("aria-checked", "true")
  const epp = page.getByRole("article", { name: "Medida: USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", exact: true })
  await expect(epp).toContainText("V. Elementos de protección personal")
  await expect(epp).toContainText(`Por implementar · plazo ${hoyEnChile()}`)
  await expect(epp).toContainText("Responsable: SUPERVISOR/PREVENCION")

  // Riesgo 2 (Moderado): medidas existentes con su frecuencia, el tipo de cada una.
  await page.goto(matriz)
  await abrirRiesgo(page, 2, "Herramientas manuales")
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: "Medida: GUANTES", exact: true })).toContainText("Existente · verificación TRIMESTRAL")
  await expect(page.getByRole("article", { name: "Medida: INSTALAR RESGUARDOS EN MAQUINAS", exact: true })).toContainText("III. Controles de ingeniería")

  // Riesgo 3: «PREVENCION» quedó asignado a la persona elegida.
  await page.goto(matriz)
  await abrirRiesgo(page, 3, "Piso resbaladizo")
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: "Medida: MANTENER ORDEN Y LIMPIEZA", exact: true })).toContainText("Responsable: Admin E2E")

  // Riesgo 4: la errata «MCANICO» quedó cargada con el factor Mecánico del catálogo.
  await page.goto(matriz)
  await abrirRiesgo(page, 4, "Partes en movimiento")
  await irAPaso(page, "Identificación")
  await expect(page.getByRole("combobox", { name: "Factor de riesgo", exact: true })).toHaveText("Mecánico")
})

/* Un RE-04 de 31 frases distintas en una fila: 30 con palabra clave («CHARLA» es
 * IV) y una «sin pista», que sólo calza el descarte. La «sin pista» va primero:
 * la página 1 lleva la «sin pista» y CHARLA 01–24, y la 2, CHARLA 25–30. */
const charla = (numero: number) => `CHARLA DE SEGURIDAD ${String(numero).padStart(2, "0")}`
const SIN_PISTA = "MATERIAL ABSORBENTE DISPONIBLE"
const FILA_GRANDE: Fila = {
  "N°": 1, "ACTIVIDAD": "Bodega", "TAREA": "Orden de bodega", "PUESTO DE TRABAJO": "Bodeguero", "FACTORES DE RIESGO": "Físico",
  "PELIGRO": "Cajas apiladas", "RIESGO": "Caída de objetos", "DAÑO PROBABLE": "Contusiones", "PROBABILIDAD": 1, "CONSECUENCIA": 2, "MR": 2,
  "CLASIFICACIÓN DEL RIESGO": "TOLERABLE",
  "MEDIDA DE CONTROL": [...Array.from({ length: 30 }, (_, index) => charla(index + 1)), SIN_PISTA].join("\n"),
  "¿ESTÁ CONTROLADO EL RIESGO?": "SÍ, CONTROLADO", "RESPONSABLE": "JEFE DE FAENA", "PLAZOS": "TRIMESTRAL",
}

test("«Medidas detectadas» en Chromium: nada bloquea, la «sin pista» va primero, el foco sigue a la frase y las páginas conservan lo elegido", async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  // Sólo la vista previa: no se carga nada, así que el período queda el de la portada.
  const dialogo = await revisarArchivo(page, await libro([FILA_GRANDE]))
  await expect(dialogo.getByText("1 fila en «RE-04 IPER»: 1 para cargar, 0 por revisar y 0 sin cargar.", { exact: true })).toBeVisible({ timeout: 30_000 })
  await dialogo.getByRole("button", { name: "Siguiente", exact: true }).click()
  await expect(pasoActual(dialogo)).toHaveText("3. Medidas detectadas")
  // Revisar los tipos no es obligatorio (decisión del usuario, 2026-10-03).
  await expect(dialogo.getByRole("button", { name: "Siguiente", exact: true })).toBeEnabled()

  const nombreTipo = (frase: string) => ({ name: `Tipo de control de «${frase}»`, exact: true })
  const tipo = (frase: string) => dialogo.getByRole("combobox", nombreTipo(frase))
  // `has` se busca DENTRO de la fila: el localizador interno parte de `page`, no del diálogo.
  const fila = (frase: string) => dialogo.getByRole("row").filter({ has: page.getByRole("combobox", nombreTipo(frase)) })
  const selectores = dialogo.getByRole("region", { name: "Tipo de cada medida detectada", exact: true }).getByRole("combobox")
  const elegirTipo = async (frase: string, opcion: string) => {
    await tipo(frase).click()
    await page.getByRole("option", { name: opcion, exact: true }).click()
  }
  /**
   * Con el teclado: Enter abre el selector (el foco cae en «Buscar en opciones»), End va a «V.»,
   * con `subir` ↑ va a «IV.», y `tecla` lo elige. Radix mueve el foco de End y ↑ con un
   * `setTimeout`: cada tecla espera el foco de la anterior. Después, ningún selector puede quedar
   * abierto: antes de la corrección de la Task 10, el clic que el navegador sintetiza con Enter
   * caía en el selector que acababa de recibir el foco y lo abría.
   */
  const elegirConTeclado = async (frase: string, tecla: "Enter" | " ", subir = false) => {
    await tipo(frase).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("textbox", { name: "Buscar en opciones", exact: true })).toBeFocused()
    await page.keyboard.press("End")
    await expect(page.getByRole("option", { name: "V. Elementos de protección personal", exact: true })).toBeFocused()
    if (subir) {
      await page.keyboard.press("ArrowUp")
      await expect(page.getByRole("option", { name: "IV. Controles administrativos", exact: true })).toBeFocused()
    }
    await page.keyboard.press(tecla)
    await expect(page.getByRole("listbox")).toHaveCount(0)
  }

  // La «sin pista» va primero y su tipo es un marcador; la sugerida por palabra clave ya es el valor.
  await expect(selectores.nth(0)).toHaveAccessibleName(`Tipo de control de «${SIN_PISTA}»`)
  await expect(tipo(SIN_PISTA)).toHaveAttribute("data-placeholder", "")
  await expect(fila(SIN_PISTA)).toContainText("Sin pista")
  await expect(tipo(charla(1))).toHaveText("IV. Controles administrativos")
  await expect(tipo(charla(1))).not.toHaveAttribute("data-placeholder")
  await expect(fila(charla(1))).toContainText("Sugerida")
  await expect(dialogo.getByText(
    "1 frase sin pista: ninguna palabra clave calzó y se carga como IV. Controles administrativos si no eliges otro tipo. Van primero.",
    { exact: true },
  )).toBeVisible()

  // Elegir otro tipo la marca «Elegida»; el foco se queda en la fila, no vuelve al comienzo del diálogo.
  await elegirTipo(charla(1), "III. Controles de ingeniería")
  await expect(tipo(charla(1))).toHaveText("III. Controles de ingeniería")
  await expect(fila(charla(1))).toContainText("Elegida")
  await expect(tipo(charla(1))).toBeFocused()
  // Con teclado y Enter, sin filtro: la fila se queda, elegida, y su selector conserva el foco.
  await elegirConTeclado(charla(10), "Enter")
  await expect(fila(charla(10))).toContainText("Elegida")
  await expect(tipo(charla(10))).toBeFocused()

  // Las páginas conservan lo elegido: se elige en la 2, se vuelve a la 1 y otra vez a la 2.
  await dialogo.getByRole("button", { name: "Página siguiente", exact: true }).click()
  await expect(tipo(charla(1))).toHaveCount(0)
  await elegirTipo(charla(26), "II. Sustitución")
  await dialogo.getByRole("button", { name: "Página anterior", exact: true }).click()
  await expect(tipo(charla(1))).toHaveText("III. Controles de ingeniería")
  await expect(fila(charla(10))).toContainText("Elegida")
  await dialogo.getByRole("button", { name: "Página siguiente", exact: true }).click()
  await expect(tipo(charla(26))).toHaveText("II. Sustitución")

  // «Sólo sin pista» vuelve a la página 1 con la única que queda. Elegir con Espacio el MISMO tipo
  // que el marcador también cuenta: la fila sale y el foco pasa al filtro, que sigue en su lugar.
  await dialogo.getByRole("checkbox", { name: "Sólo sin pista", exact: true }).check()
  await expect(selectores).toHaveCount(1)
  await elegirConTeclado(SIN_PISTA, " ", true)
  await expect(dialogo.getByText("No quedan frases sin pista.", { exact: true })).toBeVisible()
  await expect(dialogo.getByRole("checkbox", { name: "Sólo sin pista", exact: true })).toBeFocused()
  await expect(dialogo.getByRole("button", { name: "Siguiente", exact: true })).toBeEnabled()
})
