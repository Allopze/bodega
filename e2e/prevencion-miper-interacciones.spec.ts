import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import {
  agregarMedida, anterior, campo, crearTarea, elegir, escribir, guardado, irAPaso, nivel, numeroDelRiesgo, volverALaMatriz, volverALaTarea,
} from "./miper-helpers"

/**
 * E2E MIPER — las interacciones del espacio de trabajo por niveles (spec
 * 2026-10-02 §3–§5) que reemplazaron a la grilla tipo planilla: navegar
 * matriz › tarea › riesgo con «atrás» conservando los filtros, «Agregar peligro»
 * heredando la tarea y «Duplicar riesgo» copiando sus medidas, el guardado
 * automático (y Escape descartando una edición en curso), el guardián de dos
 * pestañas editando el mismo riesgo y «Siguiente pendiente». Es la continuación
 * de lo que el recorrido de la F1 declaró no recorrido
 * (`qa/reports/2026-09-30-miper-f1.md` §3) sobre la grilla.
 *
 * Las matrices de estos escenarios se siembran en `e2e/setup-db.ts`
 * (`riskmatrix-teclado-e2e`, `riskmatrix-estructura-e2e` y
 * `riskmatrix-concurrencia-e2e`, las tres en «Faena Restringida E2E»): llegan
 * **vacías** a cada corrida —el sembrado reconstruye la base cada vez que
 * arranca el servidor E2E— y ningún otro spec las toca. Dentro de este archivo
 * «teclado» y «estructura» las usan dos pruebas cada una, y «concurrencia»
 * tres (cada una con sus propias actividades), así que ninguna aserción supone
 * un N° absoluto: el N° se lee del editor (`crearTarea` lo devuelve) y
 * «Siguiente pendiente» se prueba dentro de un filtro. El actor es
 * el admin porque es el único sembrado con alcance global y
 * `prevention:risk:edit` sobre cualquier faena.
 */
const MATRIZ_TECLADO = "/prevencion/miper/riskmatrix-teclado-e2e"
const MATRIZ_ESTRUCTURA = "/prevencion/miper/riskmatrix-estructura-e2e"
const MATRIZ_CONCURRENCIA = "/prevencion/miper/riskmatrix-concurrencia-e2e"

test("navegación por niveles: tarea → riesgo y «atrás» vuelve a la matriz con su búsqueda", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_TECLADO)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2037")

  const numero = await crearTarea(page, { actividad: "Transporte de lodo", tarea: "Carga en planta", puesto: "Conductor", peligro: "Camión en movimiento" })
  // Del riesgo a su tarea y de la tarea a la matriz, sin ida al servidor.
  await volverALaTarea(page)
  await expect(page.getByRole("heading", { level: 2, name: "Carga en planta" })).toBeVisible()
  await volverALaMatriz(page)
  await expect(page.getByRole("heading", { level: 2, name: /Transporte de lodo/ })).toBeVisible()

  // La búsqueda viaja en la URL; con ella la matriz lista los riesgos que calzan.
  await page.getByLabel("Buscar en la matriz", { exact: true }).fill("camión")
  await expect(page).toHaveURL(/buscar=cami/)
  await page.getByRole("link", { name: `Riesgo #${numero}: Camión en movimiento`, exact: true }).click()
  await expect(page).toHaveURL(/fila=/)
  await expect(page.getByRole("heading", { level: 2, name: "Camión en movimiento" })).toBeVisible()
  // El riesgo se abrió con push: «atrás» devuelve la matriz con la búsqueda intacta.
  await page.goBack()
  await expect(page).not.toHaveURL(/fila=/)
  await expect(page).toHaveURL(/buscar=cami/)
  await expect(page.getByLabel("Buscar en la matriz", { exact: true })).toHaveValue("camión")
  await expect(page.getByRole("link", { name: `Riesgo #${numero}: Camión en movimiento`, exact: true })).toBeVisible()
})

test("«Agregar peligro» hereda puesto y lugar de la tarea, y «Duplicar riesgo» copia el riesgo con sus medidas debajo del original", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_ESTRUCTURA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2038")

  const original = await crearTarea(page, { actividad: "Mantención", tarea: "Cambio de neumáticos", puesto: "Mecánico", lugar: "Taller de neumáticos", peligro: "Neumático presurizado" })
  // Una medida en el original: es lo que tiene que viajar con el duplicado.
  await agregarMedida(page, { tipo: "III. Controles de ingeniería", descripcion: "Jaula de inflado para neumáticos", responsable: "Supervisor de turno" })

  // «Agregar peligro»: un riesgo nuevo en la misma tarea, justo después del último.
  await volverALaTarea(page)
  await expect(page.getByRole("heading", { level: 2, name: "Cambio de neumáticos" })).toBeVisible()
  await page.getByRole("button", { name: "Agregar peligro", exact: true }).click()
  await expect(page).toHaveURL(/paso=identificacion/)
  await expect(page.getByRole("heading", { level: 2, name: "Peligro sin describir" })).toBeVisible()
  expect(await numeroDelRiesgo(page)).toBe(original + 1)
  // Hereda lo que es del puesto…
  await expect(campo(page, "Puesto de trabajo")).toHaveValue("Mecánico")
  await expect(campo(page, "Lugar específico")).toHaveValue("Taller de neumáticos")
  // …y no lo que es de la situación: ni el peligro ni las medidas.
  await expect(campo(page, "Peligro")).toHaveValue("")
  await expect(page.getByRole("tab", { name: /Medidas de control \(0\)/ })).toBeVisible()
  await guardado(page, () => escribir(page, "Peligro", "Gata hidráulica"))
  await expect(page.getByRole("heading", { level: 2, name: "Gata hidráulica" })).toBeVisible()

  // «Duplicar riesgo» sobre el original: la copia va inmediatamente debajo y el
  // que estaba después se corre un N°.
  await anterior(page).click()
  await expect(page.getByRole("heading", { level: 2, name: "Neumático presurizado" })).toBeVisible()
  const urlOriginal = page.url()
  await page.getByRole("button", { name: `Más acciones del riesgo ${original}`, exact: true }).click()
  await page.getByRole("menuitem", { name: "Duplicar riesgo", exact: true }).click()
  await expect(page).not.toHaveURL(urlOriginal)
  await expect(page.getByText(`Riesgo #${original + 1} · Cambio de neumáticos · Mecánico`, { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Neumático presurizado" })).toBeVisible()
  // La copia se lleva la medida.
  await expect(page.getByRole("tab", { name: /Medidas de control \(1\)/ })).toBeVisible()
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: "Medida: Jaula de inflado para neumáticos" })).toBeVisible()

  // La tarea queda con los tres riesgos en orden: original, copia y el intercalado corrido.
  await volverALaTarea(page)
  await expect(page.getByRole("heading", { level: 3, name: "Peligros identificados (3)" })).toBeVisible()
  await expect(page.getByRole("link", { name: `Riesgo #${original}: Neumático presurizado`, exact: true })).toContainText("1 medida")
  await expect(page.getByRole("link", { name: `Riesgo #${original + 1}: Neumático presurizado`, exact: true })).toContainText("1 medida")
  await expect(page.getByRole("link", { name: `Riesgo #${original + 2}: Gata hidráulica`, exact: true })).toContainText("0 medidas")
})

test("el guardado automático persiste tras recargar, Escape descarta la edición en curso y un Intolerable se anuncia", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_TECLADO)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2037")
  await crearTarea(page, { actividad: "Bodega", tarea: "Apilado", puesto: "Bodeguero", peligro: "Carga suspendida" })

  await escribir(page, "Riesgo", "Golpeado por carga")
  // Escape revierte lo que se está escribiendo: el campo vuelve a su valor y
  // salir de él después no guarda nada.
  const dano = campo(page, "Daño probable")
  await dano.click()
  await dano.fill("Edición que Escape debe descartar")
  await dano.press("Escape")
  await expect(dano).toHaveValue("")
  await dano.blur()
  await expect(dano).toHaveValue("")

  await irAPaso(page, "Evaluación")
  await elegir(page, "Probabilidad", /^4 · Alta/)
  await guardado(page, () => elegir(page, "Consecuencia", /^4 · Alta/))
  // El badge del RE-04 pega rótulo y magnitud sin espacio entre nodos
  // ("Intolerable· MR 16"): el `\s*` no es laxitud, es el DOM real.
  await expect(nivel(page, /Intolerable\s*·\s*MR 16/)).toBeVisible()

  // La recarga relee el servidor: el riesgo, la evaluación y la ausencia del
  // texto descartado vienen de la base, no del estado optimista del cliente.
  // Cada vuelta fija el paso: el anterior dejó `paso=identificacion` en la URL.
  await expect(async () => {
    await page.reload()
    await irAPaso(page, "Evaluación")
    await expect(nivel(page, /Intolerable\s*·\s*MR 16/)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole("alert").filter({ hasText: "Intolerable" })).toBeVisible({ timeout: 5_000 })
    await irAPaso(page, "Identificación")
    await expect(campo(page, "Riesgo")).toHaveValue("Golpeado por carga", { timeout: 5_000 })
    await expect(campo(page, "Daño probable")).toHaveValue("", { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
})

test("dos pestañas sobre el mismo riesgo: la segunda ve el conflicto en el campo, el valor vuelve atrás y «Recargar riesgo» la pone al día", async ({ browser }) => {
  // Dos pestañas de la MISMA persona (mismo `context`, la misma cookie): es el
  // escenario real —la MIPER abierta en dos ventanas— y el único que hace
  // chocar el candado optimista de la fila contra sí mismo.
  const context = await browser.newContext()
  try {
    const first = await context.newPage()
    await login(first)
    await first.goto(MATRIZ_CONCURRENCIA)
    await expectPageTitle(first, "MIPER Faena Restringida E2E 2039")
    await crearTarea(first, { actividad: "Taller", tarea: "Soldadura", puesto: "Soldador", peligro: "Arco eléctrico" })

    // La segunda pestaña se abre DESPUÉS: conoce el riesgo en su versión actual.
    const second = await context.newPage()
    await second.goto(first.url())
    await expect(campo(second, "Peligro")).toHaveValue("Arco eléctrico")

    // La primera edita y el servidor lo confirma antes de que la segunda escriba.
    await guardado(first, () => escribir(first, "Riesgo", "Quemadura por proyección"))

    // La segunda, con la versión vieja, escribe el MISMO campo del MISMO riesgo.
    const input = campo(second, "Riesgo")
    await input.click()
    await input.fill("Radiación UV")
    await input.press("Tab")
    // El motivo aparece en el estado de guardado y bajo el campo (role=alert)…
    await expect(second.getByRole("status").filter({ hasText: /^No se guardó: La fila cambió mientras la editabas/ })).toBeVisible()
    await expect(second.getByRole("alert").filter({ hasText: /La fila cambió mientras la editabas/ })).toBeVisible()
    // …y el campo no miente sobre lo guardado: vuelve al último valor que conocía.
    await expect(input).toHaveValue("")

    // «Recargar riesgo» trae lo que la otra pestaña guardó, y desde ahí se puede seguir.
    // El conflicto queda resuelto: el campo pierde el aviso y el guardado
    // siguiente se anuncia como guardado, no como «No se guardó».
    await second.getByRole("button", { name: "Recargar riesgo", exact: true }).click()
    await expect(input).toHaveValue("Quemadura por proyección")
    await expect(second.getByRole("alert").filter({ hasText: /La fila cambió mientras la editabas/ })).toHaveCount(0)
    await guardado(second, () => escribir(second, "Daño probable", "Quemadura de segundo grado"))

    // La base tiene el valor de la primera pestaña y el cambio posterior de la segunda.
    await first.reload()
    await expect(campo(first, "Riesgo")).toHaveValue("Quemadura por proyección")
    await expect(campo(first, "Daño probable")).toHaveValue("Quemadura de segundo grado")
  } finally {
    await context.close()
  }
})

test("«Siguiente pendiente» lleva al próximo riesgo con datos faltantes y, con un filtro, no sale de él", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_ESTRUCTURA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2038")
  await crearTarea(page, { actividad: "Oficina", tarea: "Digitación", puesto: "Administrativo", peligro: "Postura prolongada" })
  await volverALaTarea(page)
  await page.getByRole("button", { name: "Agregar peligro", exact: true }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Peligro sin describir" })).toBeVisible()
  await guardado(page, () => escribir(page, "Peligro", "Pantalla con reflejo"))

  // Por N°: del primero de la tarea al siguiente con pendientes.
  await anterior(page).click()
  await expect(page.getByRole("heading", { level: 2, name: "Postura prolongada" })).toBeVisible()
  await page.getByRole("link", { name: "Siguiente pendiente", exact: true }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Pantalla con reflejo" })).toBeVisible()

  // Con la matriz filtrada por la tarea, desde el último pendiente del filtro
  // «Siguiente pendiente» da la vuelta DENTRO del filtro: no salta a los
  // riesgos pendientes de otras tareas de la misma matriz.
  await volverALaTarea(page)
  await volverALaMatriz(page)
  await page.getByLabel("Buscar en la matriz", { exact: true }).fill("Digitación")
  await expect(page).toHaveURL(/buscar=Digitaci/)
  await page.getByRole("link", { name: /^Riesgo #\d+: Pantalla con reflejo$/ }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Pantalla con reflejo" })).toBeVisible()
  await page.getByRole("link", { name: "Siguiente pendiente", exact: true }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Postura prolongada" })).toBeVisible()

  await agregarMedida(page, { tipo: "IV. Controles administrativos", descripcion: "Pausas activas cada dos horas", responsable: "Supervisor" })
})

test("«atrás» después de «Agregar peligro» muestra el riesgo nuevo y lo ya guardado, no la foto de antes de crearlo", async ({ page }) => {
  // Regresión C1 (revisión final de la Fase A): la vista de la tarea es una
  // entrada de historial nativa que hereda la foto del último render del
  // servidor; guardar un campo no revalida, así que «atrás» restauraba la foto
  // previa —sin el riesgo nuevo y con el campo guardado de vuelta en blanco—
  // hasta recargar. Crear un riesgo ahora revalida y vacía esa caché.
  await login(page)
  await page.goto(MATRIZ_CONCURRENCIA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2039")
  const original = await crearTarea(page, { actividad: "Lavado de equipos", tarea: "Lavado de tolva", puesto: "Operador de lavado", peligro: "Piso mojado" })
  await guardado(page, () => escribir(page, "Riesgo", "Caída al mismo nivel"))

  await volverALaTarea(page)
  const fila = page.getByRole("link", { name: `Riesgo #${original}: Piso mojado`, exact: true })
  await expect(fila).toContainText("Caída al mismo nivel")
  await page.getByRole("button", { name: "Agregar peligro", exact: true }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Peligro sin describir" })).toBeVisible()
  const nuevo = await numeroDelRiesgo(page)

  await page.goBack()
  await expect(page).not.toHaveURL(/fila=/)
  await expect(page.getByRole("heading", { level: 2, name: "Lavado de tolva" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 3, name: "Peligros identificados (2)" })).toBeVisible()
  await expect(page.getByRole("link", { name: `Riesgo #${nuevo}: peligro sin describir`, exact: true })).toBeVisible()
  await expect(fila).toContainText("Caída al mismo nivel")
})

test("volver de una tarea a la matriz conserva el scroll y las actividades plegadas", async ({ page }) => {
  // Regresión I2: abrir una tarea desmonta la matriz; sin memoria, «atrás»
  // llegaba arriba de todo y con todas las actividades abiertas. Una ventana
  // baja hace que la matriz tenga scroll con pocas actividades.
  await page.setViewportSize({ width: 1280, height: 520 })
  await login(page)
  await page.goto(MATRIZ_CONCURRENCIA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2039")
  await crearTarea(page, { actividad: "Bodega de repuestos", tarea: "Recepción de repuestos", puesto: "Bodeguero" })
  await crearTarea(page, { actividad: "Patio de maniobras", tarea: "Estacionamiento de camiones", puesto: "Conductor" })
  await volverALaTarea(page)
  await volverALaMatriz(page)

  const plegar = page.getByRole("button", { name: /^Bodega de repuestos/ })
  await plegar.click()
  await expect(plegar).toHaveAttribute("aria-expanded", "false")

  // Al fondo del pozo, la última tarea queda a la vista (el clic no tiene que scrollear).
  const pozo = page.locator("[data-shell-scroll]")
  await pozo.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  const tarea = page.getByRole("link", { name: /^Estacionamiento de camiones/ })
  await expect(tarea).toBeInViewport()
  const scrollAntes = await pozo.evaluate((element) => element.scrollTop)
  expect(scrollAntes).toBeGreaterThan(50)

  await tarea.click()
  await expect(page.getByRole("heading", { level: 2, name: "Estacionamiento de camiones" })).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/tarea=/)
  await expect(plegar).toHaveAttribute("aria-expanded", "false")
  await expect.poll(async () => Math.abs((await pozo.evaluate((element) => element.scrollTop)) - scrollAntes)).toBeLessThanOrEqual(4)
})

/**
 * Dos cuadros de animación: el del montaje de la vista y el de
 * `useRestoreWorkspaceScroll`, que restaura dentro de un `requestAnimationFrame`.
 * Pasados los dos, un scroll que no se restauró ya no se va a restaurar.
 */
const dosCuadros = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

test("el scroll vuelve con Atrás y con «‹ Volver a la matriz»; cambiar de pestaña o reabrir una tarea llega arriba", async ({ page }) => {
  // A2, fila 1: la memoria de scroll restauraba también tras una navegación
  // hacia adelante (cambiar de pestaña, reabrir una tarea), porque la clave de
  // la matriz quedaba guardada desde que se abrió una tarea. «‹ Volver a la
  // matriz» es un «volver» para la persona y sigue restaurando (regresión I2).
  await page.setViewportSize({ width: 1280, height: 520 })
  await login(page)
  await page.goto(MATRIZ_CONCURRENCIA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2039")
  await crearTarea(page, { actividad: "Casino", tarea: "Lavado de loza", puesto: "Auxiliar de casino" })
  await crearTarea(page, { actividad: "Portería", tarea: "Control de acceso", puesto: "Guardia" })
  await volverALaTarea(page)
  await volverALaMatriz(page)

  const pozo = page.locator("[data-shell-scroll]")
  const scrollDelPozo = () => pozo.evaluate((element) => element.scrollTop)
  const alFondo = async () => {
    await pozo.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    expect(await scrollDelPozo()).toBeGreaterThan(50)
  }
  const tarea = page.getByRole("link", { name: /^Control de acceso/ })
  const tituloTarea = page.getByRole("heading", { level: 2, name: "Control de acceso" })

  // (a) «‹ Volver a la matriz» restaura el scroll con el que se dejó la matriz.
  await alFondo()
  const scrollAntes = await scrollDelPozo()
  await tarea.click()
  await expect(tituloTarea).toBeVisible()
  await volverALaMatriz(page)
  await expect(tarea).toBeAttached()
  await expect.poll(async () => Math.abs((await scrollDelPozo()) - scrollAntes)).toBeLessThanOrEqual(4)

  // (b) Atrás del navegador también restaura.
  await tarea.click()
  await expect(tituloTarea).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/tarea=/)
  await expect.poll(async () => Math.abs((await scrollDelPozo()) - scrollAntes)).toBeLessThanOrEqual(4)

  // (c) Matriz → Programa → Matriz (dos replace) no restaura, aunque la clave de la matriz existía.
  await page.getByRole("tab", { name: "Programa", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Programa", exact: true })).toHaveAttribute("aria-selected", "true")
  await pozo.evaluate((element) => element.scrollTo({ top: 0 }))
  await page.getByRole("tab", { name: /^Matriz \(/ }).click()
  await expect(tarea).toBeAttached()
  await dosCuadros(page)
  expect(await scrollDelPozo()).toBeLessThanOrEqual(4)

  // (d) Reabrir una tarea ya visitada, desde la matriz, llega arriba. Se siembra una clave
  // vieja de la tarea: sin el olvido del destino, esa clave la restauraría y el test fallaría.
  const hrefTarea = await tarea.getAttribute("href")
  expect(hrefTarea).toContain("tarea=")
  const claveTarea = `miper:scroll:${hrefTarea}`
  await page.evaluate((clave) => sessionStorage.setItem(clave, "300"), claveTarea)
  await tarea.click()
  await expect(tituloTarea).toBeVisible()
  await dosCuadros(page)
  expect(await scrollDelPozo()).toBeLessThanOrEqual(4)
  // Independiente del alto de la página (un scroll de 300 podría quedar acotado a 0):
  // la navegación hacia adelante tiene que haber olvidado la clave sembrada.
  expect(await page.evaluate((clave) => sessionStorage.getItem(clave), claveTarea)).toBeNull()
})
