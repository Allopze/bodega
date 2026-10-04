import { expect, type Locator, type Page } from "@playwright/test"
import { pickCurrentMonthDate } from "./helpers"

/**
 * Helpers del espacio de trabajo de la MIPER (spec 2026-10-02 §5): matriz por
 * actividad y tarea → vista de la tarea → editor del riesgo en cuatro pasos.
 * Reemplazan al `cell(column, row)` de la grilla, que se retiró.
 *
 * Las vistas nuevas no duplican un árbol móvil y otro de escritorio, así que los
 * roles bastan: no hace falta `textoVisible()` para estos campos. Lo que sí viaja
 * dos veces al DOM son las acciones del `PageHeader` (el `TopBar` y la copia
 * `lg:sr-only`, que Playwright considera visible), y por eso todo lo de la
 * cabecera se acota al `banner` con `cabecera()`.
 *
 * Navegar entre vistas (tarea, riesgo, paso, ficha, filtros) es
 * `history.pushState`/`replaceState` sin ida al servidor: nada de esperar
 * `networkidle` ni una navegación; se espera el elemento de la vista nueva.
 */

const escapar = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Las acciones de la cabecera, leídas de la copia pintada (el `TopBar`). */
export const cabecera = (page: Page) => page.getByRole("banner")

/**
 * Un campo de texto con sugerencias (`Combobox` con `allowCustomValue`) por su
 * rótulo. `exact` es obligatorio: «Riesgo» es subcadena de «Factor de riesgo».
 */
export const campo = (page: Page | Locator, label: string) => page.getByRole("combobox", { name: label, exact: true })

/**
 * Escribe un campo con sugerencias y lo confirma **al salir del campo**, que es
 * cuando el `Combobox` guarda el valor libre.
 *
 * Se sale con `blur()` y no con Tab a propósito: Tab enfoca el combobox
 * siguiente, que abre su lista de sugerencias (`absolute`, bajo el campo) sobre
 * los campos de abajo, y el clic siguiente de la prueba caía en esa lista. Que
 * el valor quede guardado lo afirma quien llama, envolviendo la escritura en
 * `guardado()` o recargando.
 *
 * El valor se compara sin distinguir mayúsculas: si el diccionario de la faena
 * ya tiene la misma palabra escrita de otra forma, el campo adopta la grafía del
 * diccionario (§6.1) y eso es lo correcto.
 */
export async function escribir(page: Page | Locator, label: string, value: string) {
  const input = campo(page, label)
  await input.click()
  await input.fill(value)
  await input.blur()
  await expect(input).toHaveValue(new RegExp(`^${escapar(value)}$`, "i"))
}

/**
 * Una tarjeta de un grupo de radio: P, C, «¿Está controlado el riesgo?» y
 * «¿Es una tarea rutinaria?». Con texto, el nombre es exacto: «Rutinaria» es
 * subcadena de «No rutinaria». Con regex, el llamador ancla lo que haga falta
 * (`/^4 · Alta/`): el nombre de P y C es sólo el título («4 · Alta», o «4 · Alta
 * (extremadamente dañino)» en Consecuencia) y el criterio del RE-04 va como
 * descripción accesible (A2, fila 14).
 */
export async function elegir(page: Page, grupo: string, opcion: string | RegExp) {
  const radio = page.getByRole("radiogroup", { name: grupo, exact: true })
    .getByRole("radio", typeof opcion === "string" ? { name: opcion, exact: true } : { name: opcion })
  await radio.click()
  await expect(radio).toHaveAttribute("aria-checked", "true")
}

/** Un `OptionSelect` (Radix): factor de riesgo, tipo de control, responsable. */
export async function elegirOpcion(page: Page, label: string, opcion: string) {
  const trigger = page.getByRole("combobox", { name: label, exact: true })
  await trigger.click()
  await page.getByRole("option", { name: opcion, exact: true }).click()
  await expect(trigger).toContainText(opcion)
}

export type PasoDelRiesgo = "Identificación" | "Evaluación" | "Medidas de control" | "Seguimiento"

/**
 * Un paso del editor. El nombre accesible lleva el número y el estado
 * («3. Medidas de control (1) · 2 pendientes»), así que se busca por regex.
 */
export async function irAPaso(page: Page, paso: PasoDelRiesgo) {
  const tab = page.getByRole("tab", { name: new RegExp(escapar(paso)) })
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
}

/** La región que anuncia la magnitud y la clasificación P×C del paso Evaluación (y el estado de guardado). */
export const nivel = (page: Page, texto: RegExp) => page.getByRole("status").filter({ hasText: texto })

/**
 * Hace `accion` y espera a que el editor confirme ESE guardado.
 *
 * Mirar sólo «Guardado a las HH:MM» no alcanza: el rótulo de un guardado
 * anterior ya dice eso (y en el mismo minuto, con la misma hora), y un campo de
 * texto guarda recién al salir de él, así que la aserción podía pasar antes de
 * que el guardado nuevo empezara. Por eso se exige ver «Guardando…» DESPUÉS de
 * empezar la acción (un `MutationObserver` lo registra aunque dure un cuadro) y
 * recién entonces «Guardado a las HH:MM», que el editor muestra cuando el riesgo
 * abierto ya no tiene guardados en curso. Si `accion` hace varios cambios, la
 * espera cubre al último: cada cambio pinta «Guardando…» en el mismo render que
 * lo muestra en pantalla.
 */
export async function guardado(page: Page, accion: () => Promise<unknown>) {
  await page.evaluate(() => {
    const scope = window as unknown as { __miperGuardando?: boolean; __miperGuardandoObserver?: MutationObserver }
    scope.__miperGuardandoObserver?.disconnect()
    scope.__miperGuardando = false
    const check = () => {
      if (Array.from(document.querySelectorAll('[role="status"]')).some((node) => node.textContent === "Guardando…")) scope.__miperGuardando = true
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    scope.__miperGuardandoObserver = observer
    // Si ya hay un guardado en curso, el de la acción se suma a esa cola: el
    // rótulo no vuelve a cambiar a «Guardando…» y «Guardado a las» sólo
    // aparece cuando terminan todos.
    check()
  })
  await accion()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __miperGuardando?: boolean }).__miperGuardando), { message: "el cambio no inició un guardado («Guardando…»)" }).toBe(true)
  await expect(page.getByRole("status").filter({ hasText: /^Guardado a las \d{2}:\d{2}$/ })).toBeVisible()
  await page.evaluate(() => (window as unknown as { __miperGuardandoObserver?: MutationObserver }).__miperGuardandoObserver?.disconnect())
}

/** El N° visible del riesgo abierto en el editor, leído de su subtítulo («Riesgo #3 · Tarea · Puesto»). */
export async function numeroDelRiesgo(page: Page): Promise<number> {
  const subtitulo = page.getByText(/^Riesgo #\d+ · /)
  await expect(subtitulo).toBeVisible()
  return Number((await subtitulo.textContent())!.match(/^Riesgo #(\d+)/)![1])
}

/**
 * «Nueva tarea» en la cabecera: crea el primer riesgo de la tarea y deja el
 * editor abierto en Identificación. Devuelve el N° del riesgo creado, para que
 * las pruebas que comparten una matriz sembrada no supongan el #1.
 */
export async function crearTarea(page: Page, valores: { actividad: string; tarea: string; puesto: string; lugar?: string; peligro?: string }): Promise<number> {
  const newTask = cabecera(page).getByRole("button", { name: "Nueva tarea", exact: true })
  if (!(await newTask.isVisible())) {
    // En el editor las acciones generales se ocultan para dar prioridad al
    // riesgo actual. Regresa a la lista antes de iniciar otra tarea.
    const url = new URL(page.url())
    await page.goto(`${url.origin}${url.pathname}?tab=matriz`)
  }
  await newTask.click()
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" })
  const campos: Array<[string, string | undefined]> = [
    ["Actividad", valores.actividad],
    ["Tarea", valores.tarea],
    ["Puesto de trabajo", valores.puesto],
    ["Lugar específico", valores.lugar],
    ["Primer peligro", valores.peligro],
  ]
  for (const [label, value] of campos) {
    if (value) await escribir(dialog, label, value)
  }
  await dialog.getByRole("button", { name: "Crear tarea", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/fila=[^&]+&paso=identificacion/)
  await expect(page.getByRole("tab", { name: /Identificación/, selected: true })).toBeVisible()
  if (valores.peligro) await expect(page.getByRole("heading", { level: 2, name: valores.peligro })).toBeVisible()
  return numeroDelRiesgo(page)
}

/**
 * Agrega una medida al riesgo abierto: va al paso «Medidas de control», llena el
 * alta y espera la tarjeta de la medida, que llega con la foto del servidor.
 * «Agregar medida» es el nombre del botón que abre el alta y del que la envía:
 * nunca están los dos a la vez, pero se pide `exact`.
 */
export async function agregarMedida(page: Page, valores: { tipo?: string; descripcion: string; responsable: string }) {
  await irAPaso(page, "Medidas de control")
  await page.getByRole("button", { name: "Agregar medida", exact: true }).click()
  if (valores.tipo) await elegirOpcion(page, "Tipo de control", valores.tipo)
  await page.getByLabel("Descripción de la medida", { exact: true }).fill(valores.descripcion)
  await page.getByLabel("Nombre o cargo responsable", { exact: true }).fill(valores.responsable)
  await pickCurrentMonthDate(page, /Plazo de la medida/)
  await page.getByRole("button", { name: "Agregar medida", exact: true }).click()
  await expect(page.getByRole("article", { name: `Medida: ${valores.descripcion.slice(0, 60)}` })).toBeVisible()
}

/**
 * Desde la matriz (la estructura): abre un riesgo por su N° y su peligro, a
 * través del buscador de la matriz. La búsqueda queda en la URL (`buscar=`), así
 * que «atrás» vuelve a la matriz filtrada.
 */
export async function abrirRiesgo(page: Page, numero: number, peligro: string) {
  await page.getByLabel("Buscar en la matriz", { exact: true }).fill(peligro)
  await page.getByRole("link", { name: `Riesgo #${numero}: ${peligro}`, exact: true }).click()
  await expect(page).toHaveURL(/fila=/)
  await expect(page.getByRole("heading", { level: 2, name: peligro })).toBeVisible()
}

/** «‹ Volver a la tarea» desde el editor: sale del riesgo (la URL deja de tener `fila=`). */
export async function volverALaTarea(page: Page) {
  await page.getByRole("link", { name: "‹ Volver a la tarea", exact: true }).click()
  await expect(page).not.toHaveURL(/fila=/)
}

/** «‹ Volver a la matriz» desde la vista de la tarea. */
export async function volverALaMatriz(page: Page) {
  await page.getByRole("link", { name: "‹ Volver a la matriz", exact: true }).click()
  await expect(page).not.toHaveURL(/tarea=/)
}

/** «‹ Anterior» del pie del editor: el riesgo previo de la tarea. */
export const anterior = (page: Page) => page.getByRole("link", { name: "‹ Riesgo anterior", exact: true })
