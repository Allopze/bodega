import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"
import { cerrarSesion, listRecord, login, selectRadixById, textoVisible } from "./helpers"
import { chileDay } from "./mantencion-3-helpers"
import { definirPin, entrar, nuevoContexto } from "./mantencion-app-helpers"
import {
  ADMIN_CONTRATO, JEFE, MECANICO, NOMBRE_MECANICO, PIN, REPUESTO, REPUESTO_LIBRE,
  consumosDeLaOt, entrarPlataforma, equipoDePrueba, esperarEstado, eventosDeLaOt,
  esc, movimientosDelRepuesto, notaDeLaOt, registrarCorrectivaDesdeOt, registrosDeLaOt, reservaDeLaOt, sembrarRepuestoConStock, stockDe, vigilarConsola,
} from "./notas-pedido-helpers"

/**
 * Notas de pedido de repuestos de punta a punta (ADR mantención 0001), con la interfaz real.
 *
 *   1  jefatura crea la OT de un equipo de Biodiversa para un mecánico de Biodiversa; el mecánico
 *      registra el ingreso a taller en la app (la OT queda «en taller»); el repuesto de catálogo
 *      tiene stock en la faena (sembrado).
 *   2  SIN señal, el mecánico pide dos repuestos (uno con el nombre del repuesto de catálogo, otro
 *      texto libre) con «Enviar pedido»; vuelve la señal y la nota se envía sola.
 *   3  jefatura ve la nota en «Pendientes», resuelve la línea del catálogo con «Reservar de bodega» y
 *      comprueba el enlace «Comprar» de la otra (solicitud de repuestos prellenada desde la nota).
 *   4  el mecánico refresca el catálogo, ve «Llegó · 1 disponible» y registra una correctiva de la
 *      OT con el chip «Disponibles para esta OT».
 *   5  el kárdex de Bodega muestra «Uso en mantención» enlazado al registro y a la OT; el stock bajó 1.
 *   6  jefatura anula el registro (OT en taller): el stock vuelve.
 *   7  el mecánico registra otra correctiva sin repuestos y termina; recepción y conformidad: el
 *      diálogo avisa del repuesto reservado sin usar y, al conformar, la reserva queda liberada.
 *
 * Con estado y en orden, pero autocontenida: crea su propia OT y su propio repuesto (con un sufijo
 * por corrida), así que se puede repetir sobre la misma base. Usuarios de
 * `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`).
 *
 * Locators según «Locators in this repository» de qa/AGENTS.md: `getByRole` (ignora lo oculto) y
 * `exact: true` donde un rótulo es prefijo de otro.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(240_000)

test.describe("Notas de pedido de repuestos", () => {
  let equipo = { code: "", plate: "", worksiteId: "" }
  let otId = ""
  let folio = ""
  let nota = { id: "", code: "", lineaCatalogoId: "", lineaLibreId: "" }
  let registroId = ""
  let registroFolio = ""
  /** Última lectura que el test le dio al equipo (el ingreso y cada correctiva suben el odómetro). */
  let lectura = 0
  let telefono: BrowserContext
  let app: Page
  let erroresApp: string[]
  const respuestasNota: number[] = []

  // ── App del mecánico ──────────────────────────────────────────────────────────────────────────────

  const abrirOtEnApp = async (): Promise<Locator> => {
    await app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) }).click()
    const hoja = app.getByRole("dialog", { name: folio, exact: true })
    await expect(hoja).toBeVisible()
    return hoja
  }
  const cerrarOtEnApp = async (hoja: Locator) => {
    await hoja.getByRole("button", { name: "Cerrar", exact: true }).click()
    await expect(hoja).toHaveCount(0)
  }
  const seccionRepuestos = (hoja: Locator) => hoja.getByRole("region", { name: "Repuestos", exact: true })
  const filaRepuesto = (hoja: Locator, texto: string) => seccionRepuestos(hoja).getByRole("listitem").filter({ hasText: texto })

  /**
   * Refresca el catálogo del teléfono con «Actualizar». `cambio: true` = el servidor cambió desde la última carga (otra
   * persona resolvió la nota o anuló el registro): la respuesta debe ser 200 con catálogo nuevo, no un 304 que deje al
   * teléfono con la reserva vieja. Con `cambio: false` basta con que responda (la app ya se había refrescado sola).
   */
  const actualizarCatalogoEnApp = async ({ cambio }: { cambio: boolean }) => {
    const respuesta = app.waitForResponse((r) => /\/api\/mantencion\/sync\/catalogo/.test(r.url()) && r.request().method() === "GET")
    await app.getByRole("button", { name: "Actualizar", exact: true }).click()
    const estado = (await respuesta).status()
    if (cambio) expect(estado, "el catálogo cambió en el servidor: la ETag tiene que cambiar").toBe(200)
    else expect([200, 304]).toContain(estado)
  }

  /** Correctiva de la OT abierta en la app; lleva la cuenta de la última lectura firmada. */
  async function registrarCorrectiva(opciones: { descripcion: string; usarBodega: boolean }) {
    lectura = await registrarCorrectivaDesdeOt(app, { folio, equipoCode: equipo.code, lectura, ...opciones })
  }

  test.beforeAll(async ({ browser }) => {
    equipo = await equipoDePrueba()
    await sembrarRepuestoConStock(equipo.worksiteId)
    telefono = await nuevoContexto(browser, { width: 390, height: 844 })
    app = await telefono.newPage()
    erroresApp = vigilarConsola(app, { sinSenal: true })
    app.on("response", (respuesta) => {
      if (/\/api\/mantencion\/sync\/notas-pedido$/.test(respuesta.url()) && respuesta.request().method() === "POST") respuestasNota.push(respuesta.status())
    })
  })
  test.afterAll(async () => { await telefono.close() })

  // ── 1 · OT en taller y repuesto con stock ─────────────────────────────────────────────────────────

  test("1 · jefatura crea la OT para el mecánico y el mecánico registra el ingreso: la OT queda en taller", async ({ page }) => {
    // El repuesto sembrado tiene stock en la faena del equipo.
    expect(await stockDe(equipo.worksiteId)).toBe(REPUESTO.stockInicial)

    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto("/mantencion/ot")
    await page.getByRole("button", { name: /^(Nueva orden|Crear la primera orden)$/ }).first().click()
    const hoja = page.getByRole("dialog", { name: "Nueva orden de trabajo" })
    await expect(hoja).toBeVisible()
    await hoja.locator("#ot-equipo").click()
    await hoja.locator("#ot-equipo").fill(equipo.code)
    await page.getByRole("option", { name: new RegExp(esc(equipo.code)) }).first().click()
    await selectRadixById(page, "ot-mecanico", NOMBRE_MECANICO)
    await hoja.locator("#ot-reparacion-desc").fill("QA_NP Fuga en el circuito hidráulico")
    await hoja.getByRole("button", { name: "Crear orden", exact: true }).click()
    await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/, { timeout: 30_000 })
    otId = new URL(page.url()).pathname.split("/").pop() ?? ""
    const titulo = await page.getByRole("heading", { level: 1 }).first().innerText()
    folio = /OT-[A-Z]+-\d{4}/.exec(titulo)?.[0] ?? ""
    expect(folio, "el título de la OT lleva su folio").toMatch(/^OT-BIO-\d{4}$/)
    await expect(page.getByTestId("ot-estado")).toHaveText("Asignada", { timeout: 30_000 })
    expect(errores).toEqual([])
    await cerrarSesion(page)

    // El mecánico, con su teléfono: entra, abre la OT y registra el ingreso a taller.
    await entrar(app, MECANICO)
    await definirPin(app, PIN)
    const otEnApp = app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) })
    await expect(otEnApp).toBeVisible({ timeout: 30_000 })
    const sheet = await abrirOtEnApp()
    // Sin pedidos todavía: la sección «Repuestos» lo dice y ofrece pedir.
    await expect(seccionRepuestos(sheet).getByText("Aún no pediste repuestos para esta OT.")).toBeVisible()
    await sheet.getByRole("button", { name: "Registrar ingreso a taller", exact: true }).click()
    // La hoja cambia de título al entrar al formulario del ingreso.
    const ingreso = app.getByRole("dialog", { name: "Ingreso a taller", exact: true })
    await ingreso.getByRole("button", { name: "Interno", exact: true }).click()
    const sugerida = await ingreso.getByText(/Última lectura del [^:]+: [\d.]+/).innerText().catch(() => "")
    lectura = Number(/: ([\d.]+)/.exec(sugerida)?.[1]?.replace(/\./g, "") ?? "40000") + 5
    await ingreso.getByLabel(/^Odómetro al ingresar|^Horómetro al ingresar/).fill(String(lectura))
    await ingreso.getByLabel("Entrega estimada").fill(chileDay(3))
    await ingreso.getByRole("button", { name: "Registrar ingreso", exact: true }).click()
    await esperarEstado(folio, "en_ejecucion")
    await expect(sheet.getByText("Ingreso", { exact: true })).toBeVisible()
    await cerrarOtEnApp(sheet)
  })

  // ── 2 · Pedido del mecánico, sin señal ────────────────────────────────────────────────────────────

  test("2 · sin señal el mecánico pide dos repuestos: queda en el teléfono y, al volver la señal, la nota se envía", async () => {
    expect(otId, "depende del paso 1").not.toBe("")
    const sheet = await abrirOtEnApp()
    const repuestos = seccionRepuestos(sheet)

    await telefono.setOffline(true)
    await repuestos.getByRole("button", { name: "Pedir repuestos", exact: true }).click()
    const pedido = app.getByRole("dialog", { name: "Pedir repuestos", exact: true })
    await expect(pedido).toBeVisible()

    // Línea 1: el repuesto de catálogo, por su nombre. Una unidad.
    const linea1 = pedido.getByRole("group", { name: "Repuesto 1", exact: true })
    await linea1.getByLabel("¿Qué repuesto necesitas?").fill(REPUESTO.name)
    // Línea 2: texto libre, dos unidades (con el stepper).
    await pedido.getByRole("button", { name: "+ Otro repuesto", exact: true }).click()
    const linea2 = pedido.getByRole("group", { name: "Repuesto 2", exact: true })
    await linea2.getByLabel("¿Qué repuesto necesitas?").fill(REPUESTO_LIBRE)
    await linea2.getByRole("button", { name: "Sumar uno al repuesto 2", exact: true }).click()
    await expect(linea2.getByLabel("Cantidad")).toHaveValue("2")
    // El equipo está detenido esperando esto: se avisará como urgente.
    await pedido.getByRole("switch", { name: "El equipo está detenido esperando esto" }).check()
    await expect(pedido.getByText("Se avisará como urgente.")).toBeVisible()

    await pedido.getByRole("button", { name: "Enviar pedido", exact: true }).click()
    await expect(pedido).toHaveCount(0)
    await expect(repuestos.getByText("Pedido guardado en el teléfono. Se envía cuando haya señal.")).toBeVisible()
    await expect(filaRepuesto(sheet, REPUESTO.name)).toContainText("Pedido · por enviar")
    await expect(filaRepuesto(sheet, REPUESTO_LIBRE)).toContainText("Pedido · por enviar")
    expect(await notaDeLaOt(otId), "sin señal el servidor no ve la nota").toBeNull()
    expect(respuestasNota).toEqual([])

    // Vuelve la señal: se envía sola, una sola vez, y el catálogo la trae con su folio.
    await telefono.setOffline(false)
    await expect.poll(() => respuestasNota.filter((estado) => estado === 200).length, { timeout: 90_000 }).toBe(1)
    // Tras el envío, el teléfono refresca el catálogo y la nota aparece con su folio (antes el refresco se
    // fundía con el del evento `online`, que salía antes del POST, y la línea seguía «por enviar»).
    await expect(seccionRepuestos(sheet).getByText(/^NP-\d{4}-\d{4}$/)).toHaveCount(2, { timeout: 30_000 })
    await expect(filaRepuesto(sheet, REPUESTO.name).getByText("Pedido", { exact: true })).toBeVisible()
    await expect(filaRepuesto(sheet, REPUESTO_LIBRE).getByText("Pedido", { exact: true })).toBeVisible()
    await expect(sheet.getByText("Pedido · por enviar")).toHaveCount(0)

    const guardada = await notaDeLaOt(otId)
    expect(guardada, "la nota llegó al servidor").not.toBeNull()
    expect(guardada!.status).toBe("enviada")
    expect(guardada!.equipmentStopped).toBe(true)
    expect(guardada!.items.map((item) => [item.description, item.quantity, item.resolution])).toEqual([
      [REPUESTO.name, 1, "pendiente"],
      [REPUESTO_LIBRE, 2, "pendiente"],
    ])
    nota = { id: guardada!.id, code: guardada!.code, lineaCatalogoId: guardada!.items[0]!.id, lineaLibreId: guardada!.items[1]!.id }
    expect(respuestasNota).toEqual([200])
    await cerrarOtEnApp(sheet)
    expect(erroresApp).toEqual([])
  })

  // ── 3 · Jefatura resuelve ─────────────────────────────────────────────────────────────────────────

  test("3 · jefatura ve la nota en «Pendientes», reserva el repuesto de la bodega y comprueba el enlace «Comprar» de la otra línea", async ({ page }) => {
    expect(nota.id, "depende del paso 2").not.toBe("")
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)

    // Bandeja: la nota está en «Pendientes», con el equipo detenido a la vista.
    await page.goto("/mantencion/notas-pedido")
    await expect(page).toHaveURL(/\/mantencion\/notas-pedido\?estado=pendientes/)
    await expect(page.getByRole("heading", { level: 1, name: "Notas de pedido" })).toBeVisible()
    const pestanas = page.getByRole("navigation", { name: "Estado de las notas de pedido" })
    for (const etiqueta of [/^Pendientes/, /^En gestión/, /^Cerradas/, /^Por conciliar/]) await expect(pestanas.getByRole("link", { name: etiqueta })).toBeVisible()
    await expect(pestanas.getByRole("link", { name: /^Pendientes/ })).toHaveAttribute("aria-current", "page")
    const fila = listRecord(page, nota.code)
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila).toContainText("Equipo detenido")
    await expect(fila).toContainText("2 de 2")
    await expect(fila.getByRole("link", { name: `Ver la OT ${folio}` })).toBeVisible()
    await fila.getByRole("link", { name: nota.code, exact: true }).click()

    // Detalle de la nota.
    await expect(page).toHaveURL(new RegExp(`/mantencion/notas-pedido/${nota.id}$`))
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${nota.code} · ${esc(equipo.code)}`) })).toBeVisible()
    const lineas = page.getByRole("list", { name: "Líneas de la nota", exact: true })
    await expect(lineas.getByRole("listitem")).toHaveCount(2)
    const lineaCatalogo = lineas.getByRole("listitem").filter({ hasText: REPUESTO.name })
    const lineaLibre = lineas.getByRole("listitem").filter({ hasText: REPUESTO_LIBRE })

    // El mecánico pide en texto libre (sin producto de catálogo): en «Reservar de bodega» jefatura elige cuál de los
    // repuestos con stock libre en la faena es.
    const reservar = lineaCatalogo.getByRole("button", { name: "Reservar de bodega", exact: true })

    // Reservar de bodega, cantidad 1: lo libre se ve y el tope es lo pedido.
    await expect(reservar).toBeEnabled()
    await reservar.click()
    const dialogo = page.getByRole("dialog", { name: "Reservar de bodega", exact: true })
    const elegir = dialogo.getByRole("combobox", { name: "Repuesto de la bodega" })
    await expect(elegir).toBeVisible()
    if (!(await elegir.textContent())?.includes(REPUESTO.name)) {
      await elegir.click()
      await page.getByRole("option", { name: new RegExp(`^${esc(REPUESTO.name)}`) }).click()
    }
    await expect(elegir).toContainText(REPUESTO.name)
    await expect(dialogo.getByText(`${REPUESTO.stockInicial} libres en Biodiversa`)).toBeVisible()
    await expect(dialogo.getByLabel("Cantidad a reservar")).toHaveValue("1")
    await dialogo.getByRole("button", { name: "Reservar de bodega", exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(textoVisible(page, /Se reservó 1 de/).first()).toBeVisible({ timeout: 30_000 })
    await expect(lineaCatalogo).toContainText("Reservado")
    await expect(lineaCatalogo).toContainText("Llegó 1 · Usado 0")
    await expect(lineaCatalogo.getByRole("button", { name: "Reservar de bodega", exact: true })).toHaveCount(0)
    const reserva = await reservaDeLaOt(otId)
    expect(reserva, "la OT tiene una reserva activa").toMatchObject({ status: "activa", quantity: 1 })
    expect(await stockDe(equipo.worksiteId), "reservar no mueve el stock").toBe(REPUESTO.stockInicial)

    // La otra línea no es de catálogo: su salida es «Comprar», que abre la solicitud de repuestos con la nota precargada.
    const comprar = lineaLibre.getByRole("link", { name: "Comprar", exact: true })
    await expect(comprar).toHaveAttribute("href", `/solicitudes/nueva?tipo=repuestos&np=${nota.id}`)
    await expect(lineaLibre.getByRole("button", { name: "Rechazar", exact: true })).toBeVisible()
    await comprar.click()
    await expect(page).toHaveURL(new RegExp(`/solicitudes/nueva\\?tipo=repuestos&np=${nota.id}$`))
    await expect(textoVisible(page, `Solicitud desde la nota de pedido ${nota.code} de la OT ${folio}. Revisa las cantidades antes de enviar.`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("combobox", { name: "Faena" })).toContainText("Biodiversa")
    await expect(page.getByRole("combobox", { name: "Equipo de flota" })).toHaveValue(new RegExp(esc(equipo.plate)))
    await expect(page.getByRole("combobox", { name: "Orden de trabajo" })).toContainText(folio)
    await expect(page.getByPlaceholder("Describe el ítem requerido...")).toHaveValue(REPUESTO_LIBRE)
    await expect(textoVisible(page, "Viene de una nota de pedido: el equipo y la OT no se pueden cambiar.")).toBeVisible()
    // El equipo estaba detenido: la urgencia sale crítica.
    await expect(page.locator("#urgency")).toContainText("Crítica")

    // La OT lo muestra: lo reservado sin usar (con «Liberar») y la nota con su avance.
    await page.goto(`/mantencion/ot/${otId}`)
    const reservados = page.getByRole("list", { name: "Repuestos reservados sin usar" })
    await expect(reservados.getByText(`1 × ${REPUESTO.name}`)).toBeVisible({ timeout: 30_000 })
    await expect(reservados.getByRole("button", { name: `Liberar ${REPUESTO.name}` })).toBeVisible()
    await expect(page.getByRole("list", { name: "Notas de pedido de esta orden" }).getByRole("link", { name: nota.code, exact: true })).toBeVisible()
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  // ── 4 · El mecánico ve el repuesto y lo usa ───────────────────────────────────────────────────────

  test("4 · el mecánico ve «Llegó · 1 disponible» y registra la correctiva con el chip «Disponibles para esta OT»", async () => {
    expect(nota.id, "depende del paso 2").not.toBe("")
    await actualizarCatalogoEnApp({ cambio: true })
    const sheet = await abrirOtEnApp()
    await expect(filaRepuesto(sheet, REPUESTO.name)).toContainText("Llegó · 1 disponible")
    await expect(filaRepuesto(sheet, REPUESTO_LIBRE)).toContainText("Pedido")
    await expect(filaRepuesto(sheet, REPUESTO_LIBRE)).not.toContainText("Llegó")

    await registrarCorrectiva({ descripcion: "QA_NP Cambio del filtro hidráulico con repuesto de bodega", usarBodega: true })

    // El servidor descontó y enlazó el movimiento al registro.
    await expect.poll(async () => (await consumosDeLaOt(otId)).length, { timeout: 60_000 }).toBe(1)
    const [consumo] = await consumosDeLaOt(otId)
    expect(consumo).toMatchObject({ source: "stock", stockStatus: "descontado", productId: REPUESTO.id, quantity: 1, recordStatus: "vigente" })
    expect(consumo!.movementId).not.toBeNull()
    expect(consumo!.allocationId).toBe((await reservaDeLaOt(otId))!.id)
    registroId = consumo!.recordId
    registroFolio = consumo!.folio ?? ""
    expect(registroFolio).toMatch(/^MC-BIO-\d{4}$/)

    // Con el catálogo al día (la app lo refresca sola al enviar el registro), la línea dice «Usado 1 de 1».
    await actualizarCatalogoEnApp({ cambio: false })
    const hoja = await abrirOtEnApp()
    await expect(filaRepuesto(hoja, REPUESTO.name)).toContainText("Usado 1 de 1")
    await cerrarOtEnApp(hoja)
    expect(erroresApp).toEqual([])
  })

  // ── 5 · Kárdex y stock ────────────────────────────────────────────────────────────────────────────

  test("5 · el kárdex muestra «Uso en mantención» enlazado al registro y a la OT, y el stock bajó en 1", async ({ page }) => {
    expect(registroId, "depende del paso 4").not.toBe("")
    expect(await stockDe(equipo.worksiteId)).toBe(REPUESTO.stockInicial - 1)

    const errores = vigilarConsola(page)
    await login(page)
    await page.goto(`/bodega?vista=kardex&faena=${equipo.worksiteId}&q=${encodeURIComponent(REPUESTO.name)}`)
    const uso = page.getByRole("row").filter({ hasText: "Uso en mantención" })
    await expect(uso).toHaveCount(1, { timeout: 30_000 })
    await expect(uso).toContainText(REPUESTO.name)
    await expect(uso).toContainText("Biodiversa")
    await expect(uso).toContainText("-1")
    await expect(uso).toContainText(new RegExp(`${REPUESTO.stockInicial}\\s*→\\s*${REPUESTO.stockInicial - 1}`))
    await expect(uso.getByRole("link", { name: /Registro de mantención/ })).toHaveAttribute("href", `/mantencion/registros/${registroId}`)
    await expect(uso.getByRole("link", { name: new RegExp(`OT ${folio}`) })).toHaveAttribute("href", `/mantencion/ot/${otId}`)

    // El movimiento de la base es el mismo que enlaza la línea del registro.
    const movimientos = await movimientosDelRepuesto(equipo.worksiteId)
    expect(movimientos.map((movimiento) => [movimiento.type, movimiento.quantity, movimiento.stockBefore, movimiento.stockAfter])).toEqual([
      ["ajuste", REPUESTO.stockInicial, 0, REPUESTO.stockInicial],
      ["egreso_mantencion", -1, REPUESTO.stockInicial, REPUESTO.stockInicial - 1],
    ])
    expect(movimientos[1]).toMatchObject({ referenceType: "mant_record", referenceId: registroId })
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  // ── 6 · Anular el registro repone ─────────────────────────────────────────────────────────────────

  test("6 · jefatura anula el registro con la OT en taller y el stock vuelve", async ({ page }) => {
    expect(registroId, "depende del paso 4").not.toBe("")
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    // Antes de anular, la OT declara el repuesto como «Descontado» y enlazado a su registro.
    await page.goto(`/mantencion/ot/${otId}`)
    const declarados = page.getByRole("list", { name: "Repuestos declarados en los registros" })
    await expect(declarados.getByText(`1 × ${REPUESTO.name}`)).toBeVisible({ timeout: 30_000 })
    await expect(declarados.getByText("Descontado")).toBeVisible()
    await expect(declarados.getByRole("link", { name: registroFolio, exact: true })).toHaveAttribute("href", `/mantencion/registros/${registroId}`)
    await expect(page.getByRole("list", { name: "Repuestos reservados sin usar" })).toHaveCount(0)

    await page.goto(`/mantencion/registros/${registroId}`)
    await expect(page.getByRole("heading", { level: 1, name: /^Correctiva · / })).toBeVisible()
    await expect(page.getByRole("main").getByText(`${registroFolio} · Biodiversa`)).toBeVisible()
    await page.getByRole("button", { name: "Anular", exact: true }).click()
    const confirmar = page.getByRole("dialog", { name: `Anular ${registroFolio}`, exact: true })
    await expect(confirmar).toBeVisible()
    await confirmar.getByLabel("Motivo de la anulación").fill("QA_NP Se registró el repuesto equivocado")
    await confirmar.getByRole("button", { name: "Anular registro", exact: true }).click()
    const anulado = page.getByRole("dialog", { name: "Registro anulado", exact: true })
    await expect(anulado).toBeVisible({ timeout: 30_000 })
    // «Cerrar» está dos veces (pie y «X»): se cierra con Esc.
    await page.keyboard.press("Escape")
    await expect(anulado).toHaveCount(0)

    // El stock vuelve y la línea queda revertida, con el movimiento de reverso enlazado.
    await expect.poll(() => stockDe(equipo.worksiteId), { timeout: 30_000 }).toBe(REPUESTO.stockInicial)
    const [consumo] = await consumosDeLaOt(otId)
    expect(consumo).toMatchObject({ stockStatus: "revertido", recordStatus: "anulado" })
    expect(consumo!.reversalId).not.toBeNull()
    const movimientos = await movimientosDelRepuesto(equipo.worksiteId)
    expect(movimientos.at(-1)).toMatchObject({ type: "ingreso_anulacion", quantity: 1, referenceType: "mant_record_void", referenceId: registroId, stockBefore: REPUESTO.stockInicial - 1, stockAfter: REPUESTO.stockInicial })

    // La OT ya no cuenta ese registro (anulado) y el repuesto vuelve a estar reservado sin usar.
    await page.goto(`/mantencion/ot/${otId}`)
    await expect(page.getByRole("list", { name: "Repuestos reservados sin usar" }).getByText(`1 × ${REPUESTO.name}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Ningún registro enlazado declara repuestos.")).toBeVisible()
    await expect(page.getByRole("list", { name: "Repuestos declarados en los registros" })).toHaveCount(0)
    await expect(page.getByTestId("ot-estado")).toHaveText("En taller")

    // El kárdex deja el reverso a la vista.
    await page.goto(`/bodega?vista=kardex&faena=${equipo.worksiteId}&q=${encodeURIComponent(REPUESTO.name)}`)
    const reverso = page.getByRole("row").filter({ hasText: "Reverso de uso en mantención" })
    await expect(reverso).toHaveCount(1, { timeout: 30_000 })
    await expect(reverso).toContainText("+1")
    await expect(reverso.getByRole("link", { name: /Anulación de registro/ })).toHaveAttribute("href", `/mantencion/registros/${registroId}`)
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  // ── 7 · Cierre de la OT: lo reservado sin usar se libera ──────────────────────────────────────────

  test("7 · la OT llega a cerrada: la conformidad avisa del repuesto reservado sin usar y, al conformar, la reserva queda liberada", async ({ page }) => {
    expect(registroId, "depende del paso 6").not.toBe("")
    // Con el único trabajo anulado, el mecánico registra otro (sin repuestos) y termina.
    await actualizarCatalogoEnApp({ cambio: true })
    const sheet = await abrirOtEnApp()
    // Lo reservado sigue disponible para quien lo pida: la línea ya no figura como usada.
    await expect(filaRepuesto(sheet, REPUESTO.name)).toContainText("Llegó · 1 disponible")
    await registrarCorrectiva({ descripcion: "QA_NP Se limpió el circuito, sin repuestos", usarBodega: false })
    const hoja = await abrirOtEnApp()
    await hoja.getByRole("button", { name: /^Registrar salida de taller/ }).click()
    // La hoja cambia de título al entrar al formulario de salida.
    const terminar = app.getByRole("dialog", { name: "Registrar salida de taller", exact: true })
    await expect(terminar.getByText("Todo listo: ítems marcados y trabajo registrado.")).toBeVisible()
    await terminar.getByRole("button", { name: "Registrar salida y avisar", exact: true }).click()
    await esperarEstado(folio, "trabajo_terminado")
    await cerrarOtEnApp(hoja)
    expect((await registrosDeLaOt(otId)).map((registro) => registro.status)).toEqual(["anulado", "vigente"])
    expect(await reservaDeLaOt(otId), "mientras la OT sigue abierta la reserva sigue activa").toMatchObject({ status: "activa" })

    // Recepción y conformidad (administrador de contrato de Biodiversa).
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN_CONTRATO)
    await page.goto(`/mantencion/ot/${otId}`)
    await expect(page.getByTestId("ot-estado")).toHaveText("Por recibir", { timeout: 30_000 })
    await page.getByRole("button", { name: "Recibir equipo", exact: true }).click()
    const recibir = page.getByRole("dialog")
    // «Recibir» no cierra la OT: no avisa de repuestos.
    await expect(recibir.getByText(/reservados? sin usar/)).toHaveCount(0)
    await recibir.getByRole("button", { name: "Recibir equipo", exact: true }).click()
    await expect(recibir).toHaveCount(0)
    await expect(page.getByTestId("ot-estado")).toHaveText("Por conformidad", { timeout: 30_000 })

    await page.getByRole("button", { name: "Dar conformidad", exact: true }).click()
    const conformar = page.getByRole("dialog")
    await expect(conformar.getByText("Queda 1 repuesto reservado sin usar; pasa a stock libre de Biodiversa.")).toBeVisible()
    await conformar.getByRole("button", { name: "Dar conformidad", exact: true }).click()
    await expect(conformar).toHaveCount(0)
    await expect(page.getByTestId("ot-estado")).toHaveText("Cerrada", { timeout: 30_000 })

    // La reserva quedó liberada: la tarjeta «Repuestos» ya no lo muestra como reservado ni ofrece «Liberar».
    const seccion = page.getByRole("heading", { level: 2, name: "Repuestos", exact: true })
    await expect(seccion).toBeVisible()
    await expect(page.getByRole("list", { name: "Notas de pedido de esta orden" })).toBeVisible()
    await expect(page.getByRole("list", { name: "Repuestos reservados sin usar" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Reservados sin usar" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^Liberar / })).toHaveCount(0)

    expect(await reservaDeLaOt(otId)).toMatchObject({ status: "liberada", released: 1 })
    expect(await stockDe(equipo.worksiteId), "liberar vuelve lo reservado a stock libre, sin mover stock").toBe(REPUESTO.stockInicial)
    const eventos = await eventosDeLaOt(otId)
    expect(eventos).toEqual(expect.arrayContaining(["parts_note_created", "parts_note_resolved", "parts_allocated", "parts_consumed", "parts_released"]))
    // Lo único que quedó en el kárdex es el ciclo completo: ingreso, uso y reverso.
    expect((await movimientosDelRepuesto(equipo.worksiteId)).map((movimiento) => movimiento.type)).toEqual(["ajuste", "egreso_mantencion", "ingreso_anulacion"])
    expect(errores).toEqual([])
    expect(erroresApp).toEqual([])
    await cerrarSesion(page)
  })
})
