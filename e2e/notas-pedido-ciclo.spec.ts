import { expect, test, type Page } from "@playwright/test"
import { listRecord, pickCurrentMonthDate, receiptSubmitName, selectRadixById, textoVisible, issueOrderFromDetail } from "./helpers"
import { JEFE, MECANICO, entrarPlataforma, vigilarConsola } from "./notas-pedido-helpers"
import {
  ADMIN, CANTIDAD, LIBRE_CICLO, LIBRE_PARTE, REPUESTO_CICLO, cambiarDeSesion, comprasDeNota, contarNotasConLinea,
  equipoDeCargo, escapar, esperarEstadoDeNota, eventosDeNota, movimientosDe, notaPorDescripcion, productoPorNumeroDeParte,
  sembrarRepuestoCiclo, stockEnFaena, type EquipoDeCargo, type NotaEnBase,
} from "./notas-pedido-ciclo-helpers"

/**
 * Ciclo de la nota de pedido SIN OT de punta a punta (ADR mantención 0001, decisiones 2026-11-27), con la interfaz real:
 *
 *   1  el mecánico crea la nota en `/mantencion/notas-pedido/nueva` (faena de su alcance; una línea del catálogo con cargo a un
 *      equipo y otra en texto libre) y un fallo de red que pierde la respuesta —el servidor ya la creó— no duplica: el reenvío
 *      con el mismo borrador devuelve la misma nota;
 *   2  jefatura la acepta; la pone en espera con motivo y la vuelve a aceptar;
 *   3  «Comprar» abre la solicitud de repuestos con la nota precargada (sin OT, en su faena), se guarda, se envía, se aprueba
 *      y Compras arma y emite la OC: la nota pasa a «En compra»;
 *   4  la recepción en faena de una parte → «Recibida parcial» y el stock de la faena sube; recibir más de lo comprado se rechaza;
 *   5  la recepción del resto cierra la nota sola, y el historial cuenta todas las transiciones.
 *
 * Con estado y en orden, pero autocontenida: siembra su propio repuesto (sufijo por corrida). Usuarios de
 * `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`). Los casos negativos y el consumo viven en
 * `notas-pedido-ciclo-negativos.spec.ts` y `notas-pedido.spec.ts`.
 *
 * Locators según «Locators in this repository» de qa/AGENTS.md: `getByRole` (ignora lo oculto) y `exact: true`.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(300_000)

test.describe("Nota de pedido sin OT · ciclo completo", () => {
  let equipo: EquipoDeCargo
  let nota: NotaEnBase
  let requestId = ""
  let orderId = ""
  let libreProductId = ""

  const detalle = (id: string) => `/mantencion/notas-pedido/${id}`
  const lineaDe = (page: Page, texto: string) => page.getByRole("list", { name: "Líneas de la nota", exact: true }).getByRole("listitem").filter({ hasText: texto })
  const historial = (page: Page) => page.getByRole("list", { name: "Historial de la nota", exact: true }).getByRole("listitem")

  test.beforeAll(async () => {
    equipo = await equipoDeCargo()
    await sembrarRepuestoCiclo()
  })

  // ── 1 · Alta por el mecánico, con un reenvío tras perder la respuesta ───────────────────────────

  test("1 · el mecánico crea la nota sin OT y reenviarla tras perder la respuesta no la duplica", async ({ page }) => {
    // Sin señal el navegador avisa de cargas que no pudo hacer (la respuesta cortada a propósito): no son de la app.
    const errores = vigilarConsola(page, { sinSenal: true })
    await entrarPlataforma(page, MECANICO)
    await page.goto("/mantencion/notas-pedido/nueva")
    await expect(page.getByRole("heading", { level: 1, name: "Nueva nota de pedido" })).toBeVisible()
    // Una sola faena en su alcance: viene elegida y no hay OT que escoger (opcional).
    await expect(page.getByRole("textbox", { name: /^Faena/ })).toHaveValue(equipo.worksiteName)
    await expect(page.getByRole("combobox", { name: /^Orden de trabajo/ })).toHaveValue("")

    const linea = (numero: number) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Repuesto ${numero}`, exact: true }) })

    // Línea 1: del catálogo, 3 unidades, con cargo al equipo.
    const uno = linea(1)
    await uno.getByRole("combobox", { name: /^Repuesto/ }).fill(REPUESTO_CICLO.name)
    await page.getByRole("option", { name: new RegExp(escapar(REPUESTO_CICLO.name)) }).first().click()
    await expect(uno.getByRole("group", { name: "Repuesto elegido" })).toContainText(REPUESTO_CICLO.name)
    await uno.getByLabel(/^Cantidad/).fill(String(CANTIDAD.catalogo))
    const cargo = uno.getByRole("combobox", { name: /^Cargo a/ })
    await cargo.click()
    await cargo.fill(equipo.code)
    await page.getByRole("option", { name: new RegExp(escapar(equipo.code)) }).first().click()
    await expect(cargo).toHaveValue(new RegExp(escapar(equipo.code)))

    // Línea 2: texto libre, 2 unidades, sin cargo.
    await page.getByRole("button", { name: "Agregar repuesto", exact: true }).click()
    const dos = linea(2)
    await dos.getByRole("combobox", { name: /^Repuesto/ }).fill(LIBRE_CICLO)
    await dos.getByLabel(/^Cantidad/).fill(String(CANTIDAD.libre))
    await dos.getByLabel(/^N° de parte/).fill(LIBRE_PARTE)
    await page.getByLabel("Es urgente").check()
    await page.getByLabel(/^Observación/).fill("QA_CICLO Pedido de reposición del taller")

    // El primer envío llega al servidor y su respuesta se pierde: la nota SE CREA pero la pantalla no se entera.
    let envios = 0
    await page.route((url) => url.pathname === "/mantencion/notas-pedido/nueva", async (route) => {
      const peticion = route.request()
      // La búsqueda del catálogo también es una Server Action de esta página: sólo el alta lleva el id de operación.
      if (peticion.method() !== "POST" || !peticion.headers()["next-action"] || !(peticion.postData() ?? "").includes("clientOpId")) return route.continue()
      envios += 1
      if (envios === 1) {
        await route.fetch()
        return route.abort("connectionreset")
      }
      return route.continue()
    })
    await page.getByRole("button", { name: "Enviar nota", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Sin conexión: no se pudo enviar" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("alert").filter({ hasText: "la nota no se duplica" })).toBeVisible()
    await expect(page).toHaveURL(/\/mantencion\/notas-pedido\/nueva$/)
    // Lo escrito sigue ahí y la nota ya existe en el servidor (una sola).
    await expect(uno.getByRole("group", { name: "Repuesto elegido" })).toContainText(REPUESTO_CICLO.name)
    await expect(dos.getByRole("combobox", { name: /^Repuesto/ })).toHaveValue(LIBRE_CICLO)
    expect(await contarNotasConLinea(LIBRE_CICLO)).toBe(1)

    // El reintento usa el mismo id de operación: el servidor devuelve la misma nota y la pantalla abre su detalle.
    await page.getByRole("button", { name: "Enviar nota", exact: true }).click()
    await expect(page).toHaveURL(/\/mantencion\/notas-pedido\/(?!nueva)[^/?]+$/, { timeout: 30_000 })
    expect(envios).toBe(2)
    expect(await contarNotasConLinea(LIBRE_CICLO), "reenviar el mismo borrador no duplica la nota").toBe(1)

    const guardada = await notaPorDescripcion(LIBRE_CICLO)
    expect(guardada).not.toBeNull()
    nota = guardada!
    expect(nota).toMatchObject({ status: "enviada", workOrderId: null, worksiteId: equipo.worksiteId, urgent: true })
    expect(nota.code).toMatch(/^NP-\d{4}-\d{4}$/)
    expect(nota.lines.map((linea) => [linea.description, linea.quantity, linea.productId, linea.chargeVehicleId, linea.resolution])).toEqual([
      [REPUESTO_CICLO.name, CANTIDAD.catalogo, REPUESTO_CICLO.id, equipo.id, "pendiente"],
      [LIBRE_CICLO, CANTIDAD.libre, null, null, "pendiente"],
    ])
    expect(await eventosDeNota(nota.id)).toMatchObject([{ kind: "creada", from: null, to: "enviada" }])

    // El detalle que ve quien la pidió (sólo `view_own`): sin acciones de resolución.
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${nota.code}`) })).toBeVisible()
    await expect(page.getByText("Sin OT", { exact: true }).first()).toBeVisible()
    await expect(lineaDe(page, REPUESTO_CICLO.name)).toContainText(`Cargo: ${equipo.code}`)
    await expect(lineaDe(page, LIBRE_CICLO)).toContainText("× 2")
    for (const nombre of ["Aceptar", "Poner en espera", "Rechazar nota", "Anular nota", "Comprar", "Reservar de bodega"]) {
      await expect(page.getByRole("button", { name: nombre, exact: true }), `«${nombre}» no se ofrece a quien sólo pide`).toHaveCount(0)
      await expect(page.getByRole("link", { name: nombre, exact: true })).toHaveCount(0)
    }
    expect(errores).toEqual([])
  })

  // ── 2 · Jefatura acepta, pone en espera con motivo y vuelve a aceptar ───────────────────────────

  test("2 · jefatura acepta la nota; en espera exige un motivo y «Aceptar» la devuelve a su curso", async ({ page }) => {
    expect(nota?.id, "depende del paso 1").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto("/mantencion/notas-pedido?estado=por_revisar")
    const fila = listRecord(page, nota.code)
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila).toContainText("Sin OT")
    await expect(fila).toContainText("Urgente")
    await fila.getByRole("link", { name: nota.code, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${detalle(nota.id)}$`))
    // Sin OT no se aparta stock: la línea del catálogo ofrece comprar o rechazar, no reservar.
    await expect(lineaDe(page, REPUESTO_CICLO.name).getByRole("link", { name: "Comprar", exact: true })).toBeVisible()
    await expect(lineaDe(page, REPUESTO_CICLO.name).getByRole("button", { name: "Reservar de bodega", exact: true })).toHaveCount(0)

    // Aceptar: sin motivo ni confirmación.
    await page.getByRole("button", { name: "Aceptar", exact: true }).click()
    await expect(textoVisible(page, `La nota ${nota.code} quedó aceptada.`).first()).toBeVisible({ timeout: 30_000 })
    await esperarEstadoDeNota(nota.id, "aceptada")
    await expect(historial(page).filter({ hasText: "Aceptada" })).toHaveCount(1, { timeout: 30_000 })
    await expect(historial(page).filter({ hasText: "Jefatura Mantención E2E" })).toHaveCount(1)

    // En espera: el motivo es obligatorio (al menos 5 letras) y se muestra en la nota.
    await page.getByRole("button", { name: "Poner en espera", exact: true }).click()
    const dialogo = page.getByRole("dialog", { name: `Poner ${nota.code} en espera` })
    const confirmar = dialogo.getByRole("button", { name: "Poner en espera", exact: true })
    await expect(confirmar).toBeDisabled()
    await dialogo.getByLabel("Motivo de la espera").fill("abc")
    await expect(confirmar).toBeDisabled()
    await dialogo.getByLabel("Motivo de la espera").fill("Esperando el visto bueno del jefe de taller")
    await expect(confirmar).toBeEnabled()
    await confirmar.click()
    await expect(dialogo).toHaveCount(0, { timeout: 30_000 })
    await esperarEstadoDeNota(nota.id, "en_espera")
    await expect(page.getByText("Esta nota está en espera")).toBeVisible()
    await expect(page.getByText("Motivo: Esperando el visto bueno del jefe de taller").first()).toBeVisible()
    // En espera las líneas no se resuelven: no hay «Comprar» ni «Rechazar» por línea.
    await expect(page.getByRole("link", { name: "Comprar", exact: true })).toHaveCount(0)
    await expect(lineaDe(page, LIBRE_CICLO).getByRole("button", { name: "Rechazar", exact: true })).toHaveCount(0)

    // Aceptar desde la espera vuelve al estado de las líneas (todas pendientes: aceptada).
    await page.getByRole("button", { name: "Aceptar", exact: true }).click()
    await esperarEstadoDeNota(nota.id, "aceptada")
    await expect(page.getByText("Esta nota está en espera")).toHaveCount(0, { timeout: 30_000 })
    await expect(lineaDe(page, REPUESTO_CICLO.name).getByRole("link", { name: "Comprar", exact: true })).toBeVisible()

    expect((await eventosDeNota(nota.id)).map((evento) => `${evento.from ?? "·"}>${evento.to}`)).toEqual([
      "·>enviada", "enviada>aceptada", "aceptada>en_espera", "en_espera>aceptada",
    ])
    expect(errores).toEqual([])
  })

  // ── 3 · Comprar: solicitud precargada → aprobación → OC emitida ─────────────────────────────────

  test("3 · «Comprar» abre la solicitud con la nota, se envía, se aprueba y Compras emite la OC: la nota queda «En compra»", async ({ page }) => {
    expect(nota?.id, "depende del paso 1").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto(detalle(nota.id))
    await lineaDe(page, REPUESTO_CICLO.name).getByRole("link", { name: "Comprar", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/solicitudes/nueva\\?tipo=repuestos&np=${nota.id}$`))
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Precargada: en la faena de la nota, sin OT, una línea por cada línea pendiente y el equipo de cargo en la primera.
    await expect(textoVisible(page, `Solicitud desde la nota de pedido ${nota.code} (sin orden de trabajo). Revisa las cantidades antes de enviar.`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("combobox", { name: "Faena" })).toContainText(equipo.worksiteName)
    await expect(page.getByRole("combobox", { name: "Equipo de flota" }).first()).toHaveValue(new RegExp(escapar(equipo.plate)))
    // La línea del catálogo viene como repuesto elegido; la libre, como texto en el campo de descripción.
    await expect(page.getByRole("group", { name: "Repuesto elegido" })).toContainText(REPUESTO_CICLO.name)
    await expect(page.getByPlaceholder("Describe el ítem requerido...")).toHaveValue(LIBRE_CICLO)
    // La nota era urgente: la urgencia sale crítica.
    await expect(page.locator("#urgency")).toContainText("Crítica")

    // Bajo el umbral basta el precio estimado (sin cotización).
    const precios = page.getByLabel("Precio unitario estimado (CLP)")
    await precios.nth(0).fill("20000")
    await precios.nth(1).fill("15000")
    await pickCurrentMonthDate(page, "Seleccionar fecha")
    await page.getByRole("button", { name: /Guardar borrador/ }).click()
    await expect(textoVisible(page, /^Borrador guardado/).first()).toBeVisible({ timeout: 30_000 })

    // Cada línea de la nota quedó atada a su ítem de solicitud: sin OT, en la faena de la nota y con el equipo de cargo.
    let compras = await comprasDeNota(nota.id)
    await expect.poll(async () => (compras = await comprasDeNota(nota.id)).length, { timeout: 30_000, message: "las dos líneas de la nota se compran en la solicitud" }).toBe(2)
    requestId = compras[0]!.requestId
    expect(compras.map((compra) => compra.noteItemId)).toEqual(nota.lines.map((linea) => linea.id))
    expect(new Set(compras.map((compra) => compra.requestId)).size).toBe(1)
    expect(compras.every((compra) => compra.workOrderId === null && compra.worksiteId === equipo.worksiteId)).toBe(true)
    expect(compras[0]).toMatchObject({ productId: REPUESTO_CICLO.id, vehicleId: equipo.id })

    // Se envía a aprobación desde su ficha.
    await page.goto(`/solicitudes/${requestId}`)
    const enviar = page.getByRole("button", { name: /Enviar a aprobación/ })
    await expect(enviar).toBeVisible({ timeout: 30_000 })
    await enviar.click()
    await expect(enviar).toHaveCount(0, { timeout: 30_000 })

    // Compras: aprueba sin cotización (bajo el umbral), arma la OC —cataloga la línea libre— y la emite.
    await cambiarDeSesion(page, ADMIN)
    await page.goto(`/solicitudes/${requestId}`)
    await expect(page.getByRole("heading", { name: "Cotizaciones" })).toBeVisible({ timeout: 15_000 })
    const aprobar = page.getByRole("button", { name: "Aprobar sin cotización", exact: true })
    const dialogoAprobar = page.getByRole("dialog", { name: "Aprobar sin cotización" })
    await expect(async () => {
      await aprobar.click()
      await expect(dialogoAprobar).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await dialogoAprobar.getByRole("button", { name: "Confirmar aprobación" }).click()
    await expect(textoVisible(page, "Aprobada").first()).toBeVisible({ timeout: 15_000 })

    await page.goto(`/compras/nueva?faena=${equipo.worksiteId}&solicitud=${requestId}`)
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await selectRadixById(page, "supplierId", "Proveedor E2E")
    const catalogar = page.getByRole("button", { name: "Catalogar", exact: true })
    await expect(catalogar).toHaveCount(1)
    await catalogar.click()
    const hoja = page.getByRole("dialog", { name: "Catalogar repuesto" })
    await expect(hoja).toBeVisible()
    await hoja.getByRole("button", { name: "Crear uno nuevo", exact: true }).click()
    await expect(hoja.getByLabel("Nombre del repuesto")).toHaveValue(LIBRE_CICLO)
    if (!(await hoja.getByLabel("N° de parte").inputValue())) await hoja.getByLabel("N° de parte").fill(LIBRE_PARTE)
    await hoja.getByRole("button", { name: "Crear y vincular", exact: true }).click()
    await expect(hoja).toBeHidden({ timeout: 15_000 })
    libreProductId = await productoPorNumeroDeParte(LIBRE_PARTE)
    for (const compra of compras) {
      const precio = page.locator(`#price-${compra.id}`)
      if (!(await precio.inputValue())) await precio.fill("15000")
    }
    await page.getByRole("button", { name: /Crear OC \(2 ítems\)/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: /^OC-/ })).toBeVisible({ timeout: 30_000 })
    orderId = new URL(page.url()).pathname.split("/").pop() ?? ""
    expect(orderId).not.toBe("nueva")
    await issueOrderFromDetail(page)
    await expect(page.getByText(/Pendiente de recepción/).first()).toBeVisible({ timeout: 30_000 })

    // La nota ya espera la compra: «En compra», con la solicitud y la OC a la vista en cada línea.
    await esperarEstadoDeNota(nota.id, "en_compra")
    await page.goto(detalle(nota.id))
    await expect(page.getByText("En compra", { exact: true }).first()).toBeVisible()
    await expect(lineaDe(page, REPUESTO_CICLO.name).getByRole("list", { name: `Compras de ${REPUESTO_CICLO.name}` }).getByRole("link", { name: /^OC-/ })).toBeVisible()
    await expect(lineaDe(page, LIBRE_CICLO).getByRole("list", { name: `Compras de ${LIBRE_CICLO}` }).getByRole("link", { name: /^SOL-|^REP-/ })).toBeVisible()
    expect(errores).toEqual([])
  })

  // ── 4 · Recepción parcial en faena ──────────────────────────────────────────────────────────────

  test("4 · recibir más de lo comprado se rechaza; la recepción parcial en faena deja la nota «Recibida parcial» y sube el stock", async ({ page }) => {
    expect(orderId, "depende del paso 3").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN)
    await page.goto(`/recepcion/nueva?oc=${orderId}`)
    const cantidadCatalogo = page.getByRole("spinbutton", { name: new RegExp(`^Cantidad a recibir de ${escapar(REPUESTO_CICLO.name)}( ·|$)`) })
    const cantidadLibre = page.getByRole("spinbutton", { name: new RegExp(`^Cantidad a recibir de ${escapar(LIBRE_CICLO)}( ·|$)`) })
    await expect(cantidadCatalogo).toHaveValue(String(CANTIDAD.catalogo))

    // Más de lo comprado: rechazado (la cantidad no pasa del saldo) y nada cambia.
    await cantidadCatalogo.fill(String(CANTIDAD.catalogo + 1))
    await expect(page.getByText(new RegExp(`Recibido \\+ rechazado \\+ dañado supera lo pendiente \\(${CANTIDAD.catalogo}`)).filter({ visible: true })).toBeVisible()
    await expect(page.getByRole("button", { name: receiptSubmitName("Faena") })).toBeDisabled()
    await expect(page).toHaveURL(/\/recepcion\/nueva\?oc=/)
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CICLO.id)).toBe(0)
    expect(await movimientosDe(equipo.worksiteId, REPUESTO_CICLO.id)).toEqual([])

    // Parcial: 1 del catálogo y nada del libre.
    await cantidadCatalogo.fill("1")
    await cantidadLibre.fill("0")
    await page.getByRole("button", { name: receiptSubmitName("Faena") }).click()
    await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })

    await esperarEstadoDeNota(nota.id, "recibida_parcial")
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CICLO.id), "lo recibido entra al stock LIBRE de la faena").toBe(1)
    expect(await movimientosDe(equipo.worksiteId, REPUESTO_CICLO.id)).toEqual([{ type: "ingreso_oc", quantity: 1, antes: 0, despues: 1 }])
    expect(await stockEnFaena(equipo.worksiteId, libreProductId)).toBe(0)

    // Bodega lo muestra en el kárdex de la faena.
    await page.goto(`/bodega?vista=kardex&faena=${equipo.worksiteId}&q=${encodeURIComponent(REPUESTO_CICLO.name)}`)
    const ingreso = page.getByRole("row").filter({ hasText: "Ingreso OC" })
    await expect(ingreso).toHaveCount(1, { timeout: 30_000 })
    await expect(ingreso).toContainText(REPUESTO_CICLO.name)
    await expect(ingreso).toContainText("+1")

    // La nota: «Recibida parcial», con lo que llegó de la línea del catálogo.
    await page.goto(detalle(nota.id))
    await expect(page.getByText("Recibida parcial", { exact: true }).first()).toBeVisible()
    await expect(lineaDe(page, REPUESTO_CICLO.name).getByRole("list", { name: "Avance de la línea" })).toContainText(`Llegó 1/${CANTIDAD.catalogo}`)
    await expect(historial(page).filter({ hasText: "Recibida parcial" })).toHaveCount(1)
    expect(errores).toEqual([])
  })

  // ── 5 · El resto llega: cierre automático ───────────────────────────────────────────────────────

  test("5 · la recepción del resto cierra la nota sola y el historial cuenta todas las transiciones", async ({ page }) => {
    expect(orderId, "depende del paso 3").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN)
    await page.goto(`/recepcion/nueva?oc=${orderId}`)
    const cantidadCatalogo = page.getByRole("spinbutton", { name: new RegExp(`^Cantidad a recibir de ${escapar(REPUESTO_CICLO.name)}( ·|$)`) })
    const cantidadLibre = page.getByRole("spinbutton", { name: new RegExp(`^Cantidad a recibir de ${escapar(LIBRE_CICLO)}( ·|$)`) })
    // El saldo ya viene propuesto: 2 del catálogo (3 - 1) y las 2 del libre.
    await expect(cantidadCatalogo).toHaveValue(String(CANTIDAD.catalogo - 1))
    await expect(cantidadLibre).toHaveValue(String(CANTIDAD.libre))
    await page.getByRole("button", { name: receiptSubmitName("Faena") }).click()
    await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })

    await esperarEstadoDeNota(nota.id, "cerrada")
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CICLO.id)).toBe(CANTIDAD.catalogo)
    expect(await stockEnFaena(equipo.worksiteId, libreProductId)).toBe(CANTIDAD.libre)
    expect((await movimientosDe(equipo.worksiteId, REPUESTO_CICLO.id)).map((movimiento) => [movimiento.type, movimiento.quantity, movimiento.despues])).toEqual([
      ["ingreso_oc", 1, 1], ["ingreso_oc", 2, 3],
    ])

    // Todas las transiciones, la última automática (sin persona).
    const eventos = await eventosDeNota(nota.id)
    expect(eventos.map((evento) => `${evento.from ?? "·"}>${evento.to}`)).toEqual([
      "·>enviada", "enviada>aceptada", "aceptada>en_espera", "en_espera>aceptada", "aceptada>en_compra", "en_compra>recibida_parcial", "recibida_parcial>cerrada",
    ])
    expect(eventos.slice(-3).map((evento) => evento.actor !== null)).toEqual([true, true, true])
    await cambiarDeSesion(page, JEFE)
    await page.goto(detalle(nota.id))
    await expect(historial(page)).toHaveCount(7, { timeout: 30_000 })
    await expect(historial(page).first()).toContainText("Nota creada")
    await expect(historial(page).last()).toContainText("Recibida parcial")
    await expect(historial(page).last()).toContainText("Cerrada")
    await expect(historial(page).filter({ hasText: "Motivo: Esperando el visto bueno del jefe de taller" })).toHaveCount(1)
    await expect(page.getByText("Cerrada", { exact: true }).first()).toBeVisible()
    // Cerrada: ya no ofrece acciones de cabecera ni de línea.
    for (const nombre of ["Aceptar", "Poner en espera", "Rechazar nota", "Anular nota"]) {
      await expect(page.getByRole("button", { name: nombre, exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole("link", { name: "Comprar", exact: true })).toHaveCount(0)

    // La bandeja la pasa a «Cerradas».
    await page.goto("/mantencion/notas-pedido?estado=cerradas")
    await expect(listRecord(page, nota.code)).toBeVisible({ timeout: 30_000 })
    await page.goto("/mantencion/notas-pedido?estado=por_revisar")
    await expect(listRecord(page, nota.code)).toHaveCount(0)
    expect(errores).toEqual([])
  })
})
