import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login, pickCurrentMonthDate } from "./helpers"

/**
 * E2E MIPER F1 — lo que el recorrido de navegación declaró no recorrido
 * (`qa/reports/2026-09-30-miper-f1.md` §3): el teclado de la grilla, las
 * acciones «duplicar» y «agregar debajo» del renglón, y el guardián de dos
 * pestañas editando la misma fila.
 *
 * Las matrices de estos escenarios se siembran en `e2e/setup-db.ts`
 * (`riskmatrix-teclado-e2e`, `riskmatrix-estructura-e2e` y
 * `riskmatrix-concurrencia-e2e`, las tres en «Faena Restringida E2E»): cada
 * prueba arranca de una matriz **vacía** que ningún otro spec toca, que es lo
 * que hace determinista una aserción sobre «la fila 2». El actor es el admin
 * porque es el único sembrado con alcance global y `prevention:risk:edit` sobre
 * cualquier faena.
 */
const MATRIZ_TECLADO = "/prevencion/miper/riskmatrix-teclado-e2e?tab=matriz"
const MATRIZ_ESTRUCTURA = "/prevencion/miper/riskmatrix-estructura-e2e?tab=matriz"
const MATRIZ_CONCURRENCIA = "/prevencion/miper/riskmatrix-concurrencia-e2e?tab=matriz"

/**
 * Una celda de la grilla por su `aria-label` real (`matrix-grid.tsx`:
 * `` `${COLUMNS[colIndex].label} riesgo ${entry.rowNumber}` ``).
 *
 * Los dos casos son `combobox`: las columnas de texto son `<input list="…">` —y
 * ese `list` les da el rol ARIA de combobox, igual que a un `<select>`—, y las
 * demás son `<select>` nativos. El `exact` es obligatorio: sin él «Riesgo» es
 * subcadena de «Factor de riesgo».
 *
 * `row` es el **número visible** de la fila (el del RE-04), no el índice del DOM.
 */
const cell = (page: Page, column: string, row = 1) =>
  page.getByRole("combobox", { name: `${column} riesgo ${row}`, exact: true })

/** Escribe una celda y la guarda: la grilla persiste al perder el foco. */
async function escribir(page: Page, column: string, row: number, value: string) {
  const celda = cell(page, column, row)
  await celda.fill(value)
  await celda.press("Tab")
}

/**
 * Confirma contra el servidor que una celda quedó guardada.
 *
 * El guardado viaja en una Server Action posterior al `blur`, así que una
 * recarga inmediata corre contra la escritura y a veces lee el valor viejo: se
 * reintenta el par recarga + aserción, que es el mismo patrón con el que el spec
 * del flujo evita esa carrera.
 */
async function expectPersistido(page: Page, column: string, row: number, value: string) {
  await expect(async () => {
    await page.reload()
    await expect(cell(page, column, row)).toHaveValue(value, { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
}

/**
 * Agrega una fila con el botón de la barra de filtros, que es el único «Agregar
 * fila» sin ambigüedad: el del estado vacío se llama «Agregar la primera fila» y
 * el de cada renglón «Agregar fila debajo del riesgo N».
 */
async function agregarFila(page: Page, row: number) {
  await page.getByRole("button", { name: "Agregar fila", exact: true }).click()
  await expect(cell(page, "Peligro", row)).toBeVisible()
}

test("flechas, Enter y Escape mueven el foco a la misma columna y revierten la edición en curso", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_TECLADO)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2037")

  await agregarFila(page, 1)
  await agregarFila(page, 2)

  // Flechas: a la MISMA columna de la fila vecina, no a la celda siguiente.
  const peligro1 = cell(page, "Peligro", 1)
  const peligro2 = cell(page, "Peligro", 2)
  await peligro1.focus()
  await peligro1.press("ArrowDown")
  await expect(peligro2).toBeFocused()
  await peligro2.press("ArrowUp")
  await expect(peligro1).toBeFocused()
  // Enter baja y Shift+Enter sube, igual que las flechas.
  await peligro1.press("Enter")
  await expect(peligro2).toBeFocused()
  await peligro2.press("Shift+Enter")
  await expect(peligro1).toBeFocused()

  // Salir de una celda con una flecha no pierde la edición: la que perdió el
  // foco guarda, y la que lo recibe queda vacía.
  const actividad1 = cell(page, "Actividad", 1)
  await actividad1.fill("Transporte de lodo")
  await actividad1.press("ArrowDown")
  await expect(cell(page, "Actividad", 2)).toBeFocused()
  await expectPersistido(page, "Actividad", 1, "Transporte de lodo")
  await expect(cell(page, "Actividad", 2)).toHaveValue("")

  // Escape revierte la edición en curso: la celda vuelve a su valor de fila.
  const riesgo1 = cell(page, "Riesgo", 1)
  await riesgo1.fill("Edición que Escape debe descartar")
  await expect(riesgo1).toHaveValue("Edición que Escape debe descartar")
  await riesgo1.press("Escape")
  await expect(riesgo1).toHaveValue("")
  // …y no se guardó: la recarga relee el servidor.
  await page.reload()
  await expect(cell(page, "Riesgo", 1)).toHaveValue("")
})

test("«+» agrega una fila debajo heredando actividad, tarea, puesto y lugar, y «duplicar» copia la fila con sus medidas", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_ESTRUCTURA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2038")

  await agregarFila(page, 1)
  await agregarFila(page, 2)
  await escribir(page, "Actividad", 1, "Transporte de lodo")
  await escribir(page, "Tarea", 1, "Descarga en predio")
  await escribir(page, "Puesto de trabajo", 1, "Conductor profesional")
  await escribir(page, "Lugar específico", 1, "Patio de descarga")
  await escribir(page, "Actividad", 2, "Mantención de la correa")

  // Una medida en la fila 1: es lo que tiene que viajar con el duplicado.
  await page.getByRole("button", { name: "Medidas de control del riesgo 1 (0)" }).click()
  const ficha = page.getByRole("dialog", { name: "Riesgo #1" })
  await ficha.getByRole("button", { name: "Agregar medida" }).click()
  await ficha.getByLabel("Tipo de control", { exact: true }).selectOption("engineering")
  await ficha.getByLabel("Descripción de la medida").fill("Guardas fijas en la correa")
  await ficha.getByLabel("Nombre o cargo responsable").fill("Supervisor de turno")
  await pickCurrentMonthDate(page, /Plazo de la medida/)
  await ficha.getByRole("button", { name: "Agregar medida" }).click()
  await expect(ficha.getByText("Guardas fijas en la correa")).toBeVisible()
  // La ficha vive en `?fila=<id>` y el cliente limpia el parámetro con un
  // `router.replace` asíncrono: recargar sin esperar a que cierre la reabre.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Riesgo #1" })).toBeHidden()
  await expect(page).not.toHaveURL(/fila=/)

  // «+»: inserta debajo y hereda actividad, tarea, puesto y lugar.
  await page.getByRole("button", { name: "Agregar fila debajo del riesgo 1" }).click()
  await expect(cell(page, "Actividad", 2)).toHaveValue("Transporte de lodo")
  await expect(cell(page, "Tarea", 2)).toHaveValue("Descarga en predio")
  await expect(cell(page, "Puesto de trabajo", 2)).toHaveValue("Conductor profesional")
  await expect(cell(page, "Lugar específico", 2)).toHaveValue("Patio de descarga")
  // No hereda lo que es de la situación y no del puesto: peligro ni medidas.
  await expect(cell(page, "Riesgo", 2)).toHaveValue("")
  await expect(page.getByRole("button", { name: "Medidas de control del riesgo 2 (0)" })).toBeVisible()
  // Renumeración: la que era la fila 2 pasó a la 3, con sus datos.
  await expect(cell(page, "Actividad", 3)).toHaveValue("Mantención de la correa")
  await expect(page.getByRole("button", { name: "Medidas de control del riesgo 3 (0)" })).toBeVisible()

  // Marca distintiva en la fila intercalada, para poder seguirla al renumerar.
  await escribir(page, "Riesgo", 2, "Fila intercalada")
  await expectPersistido(page, "Riesgo", 2, "Fila intercalada")

  // «Duplicar»: copia la fila completa —medidas incluidas— debajo de la original.
  await page.getByRole("button", { name: "Duplicar riesgo 1" }).click()
  await expect(page.getByRole("button", { name: "Medidas de control del riesgo 2 (1)" })).toBeVisible()
  await expect(cell(page, "Actividad", 2)).toHaveValue("Transporte de lodo")
  await expect(cell(page, "Tarea", 2)).toHaveValue("Descarga en predio")
  await expect(cell(page, "Lugar específico", 2)).toHaveValue("Patio de descarga")
  // La copia no se lleva el peligro de la original, y las otras dos filas
  // volvieron a correrse una posición sin perder su contenido.
  await expect(cell(page, "Riesgo", 2)).toHaveValue("")
  await expect(cell(page, "Riesgo", 3)).toHaveValue("Fila intercalada")
  await expect(cell(page, "Actividad", 4)).toHaveValue("Mantención de la correa")
})

test("dos pestañas sobre la fila: la segunda edición recibe «La fila cambió mientras la editabas» y no pisa el cambio de la otra", async ({ browser }) => {
  // Dos pestañas de la MISMA persona (mismo `context`, la misma cookie): es el
  // escenario real —la matriz abierta en dos ventanas— y el único que hace
  // chocar el candado optimista de la fila contra sí mismo.
  const context = await browser.newContext()
  const a = await context.newPage()
  try {
    await login(a, "admin@e2e.chome.cl")
    await a.goto(MATRIZ_CONCURRENCIA)
    await expectPageTitle(a, "MIPER Faena Restringida E2E 2039")
    await agregarFila(a, 1)
    await escribir(a, "Actividad", 1, "Transporte de lodo")

    // La segunda pestaña se abre DESPUÉS: conoce la fila en su versión actual.
    const b = await context.newPage()
    await b.goto(MATRIZ_CONCURRENCIA)
    await expect(cell(b, "Actividad", 1)).toHaveValue("Transporte de lodo")

    // La primera edita y confirma contra el servidor: la recarga prueba que
    // quedó persistido —no sólo en el estado optimista del cliente— y fija el
    // orden de la prueba antes de que la segunda escriba.
    await escribir(a, "Tarea", 1, "Descarga en predio A")
    await expectPersistido(a, "Tarea", 1, "Descarga en predio A")

    // La segunda, con la versión vieja, escribe la MISMA columna de la MISMA fila.
    await escribir(b, "Tarea", 1, "Descarga en predio B")
    await expect(b.locator("[data-sonner-toast]").filter({ hasText: "La fila cambió mientras la editabas" })).toBeVisible()
    // La celda queda marcada como inválida en vez de mentir sobre lo guardado…
    await expect(cell(b, "Tarea", 1)).toHaveAttribute("aria-invalid", "true")
    // …y el valor de la base sigue siendo el de la otra pestaña.
    await b.reload()
    await expect(cell(b, "Tarea", 1)).toHaveValue("Descarga en predio A")
    await a.reload()
    await expect(cell(a, "Tarea", 1)).toHaveValue("Descarga en predio A")
  } finally {
    await context.close()
  }
})
