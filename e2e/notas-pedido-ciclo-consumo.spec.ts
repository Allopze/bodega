import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { cerrarSesion, listRecord, selectRadixById } from "./helpers"
import { chileDay } from "./mantencion-3-helpers"
import { definirPin, entrar, nuevoContexto } from "./mantencion-app-helpers"
import {
  JEFE, MECANICO, NOMBRE_MECANICO, PIN, consumosDeLaOt, entrarPlataforma, equipoDePrueba, esc, esperarEstado, registrarCorrectivaDesdeOt,
  vigilarConsola,
} from "./notas-pedido-helpers"
import {
  REPUESTO_CONSUMO, escapar, esperarEstadoDeNota, movimientosDe, notaPorDescripcion, retirarTodoElStock, sembrarRepuestoConsumo, stockEnFaena,
} from "./notas-pedido-ciclo-helpers"

/**
 * Consumo de lo pedido por una nota CON OT, y que el stock nunca baja de cero (ADR mantención 0001, D6). El flujo feliz del
 * consumo (reservar, usar en un registro, anular y reponer, cierre de la OT) ya lo recorre `notas-pedido.spec.ts`; aquí
 * se cubre el caso en que la bodega se quedó sin el repuesto entre que el teléfono lo ofreció y el registro llegó:
 *
 *   1  jefatura crea la OT, el mecánico registra el ingreso a taller en la app y el repuesto tiene 1 en la bodega;
 *   2  jefatura crea la nota CON OT desde el PC (`?ot=`) con ese repuesto y lo reserva;
 *   3  el mecánico registra la correctiva con el chip de lo reservado, pero a sus espaldas alguien retiró el repuesto de la
 *      bodega: el registro se guarda igual (nunca se rechaza por stock), el uso queda «pendiente de conciliar» y el stock
 *      sigue en 0, sin movimiento de uso;
 *   4  «Por conciliar»: «Descontar ahora» no alcanza y no mueve nada; «No salió de bodega» cierra la línea sin movimiento.
 *
 * Usuarios de `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`).
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(300_000)

test.describe("Nota de pedido con OT · consumo sin stock", () => {
  let equipo = { code: "", plate: "", worksiteId: "" }
  let otId = ""
  let folio = ""
  let notaId = ""
  let notaCode = ""
  let lectura = 0
  let registroFolio = ""
  let telefono: BrowserContext
  let app: Page
  let erroresApp: string[]

  const abrirOtEnApp = async () => {
    await app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) }).click()
    const hoja = app.getByRole("dialog", { name: folio, exact: true })
    await expect(hoja).toBeVisible()
    return hoja
  }

  test.beforeAll(async ({ browser }) => {
    equipo = await equipoDePrueba()
    await sembrarRepuestoConsumo(equipo.worksiteId, 1)
    telefono = await nuevoContexto(browser, { width: 390, height: 844 })
    app = await telefono.newPage()
    erroresApp = vigilarConsola(app, { sinSenal: true })
  })
  test.afterAll(async () => { await telefono.close() })

  test("1 · jefatura crea la OT y el mecánico registra el ingreso a taller en la app", async ({ page }) => {
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CONSUMO.id)).toBe(1)
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
    await hoja.locator("#ot-reparacion-desc").fill("QA_CONS Cambio de la bomba de refrigerante")
    await hoja.getByRole("button", { name: "Crear orden", exact: true }).click()
    await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/, { timeout: 30_000 })
    otId = new URL(page.url()).pathname.split("/").pop() ?? ""
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(/OT-[A-Z]+-\d{4}/, { timeout: 30_000 })
    folio = /OT-[A-Z]+-\d{4}/.exec(await page.getByRole("heading", { level: 1 }).first().innerText())?.[0] ?? ""
    expect(folio).toMatch(/^OT-BIO-\d{4}$/)
    expect(errores).toEqual([])
    await cerrarSesion(page)

    await entrar(app, MECANICO)
    await definirPin(app, PIN)
    await expect(app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) })).toBeVisible({ timeout: 30_000 })
    const sheet = await abrirOtEnApp()
    await sheet.getByRole("button", { name: "Registrar ingreso a taller", exact: true }).click()
    const ingreso = app.getByRole("dialog", { name: "Ingreso a taller", exact: true })
    await ingreso.getByRole("button", { name: "Interno", exact: true }).click()
    const sugerida = await ingreso.getByText(/Última lectura del [^:]+: [\d.]+/).innerText().catch(() => "")
    lectura = Number(/: ([\d.]+)/.exec(sugerida)?.[1]?.replace(/\./g, "") ?? "40000") + 5
    await ingreso.getByLabel(/^Odómetro al ingresar|^Horómetro al ingresar/).fill(String(lectura))
    await ingreso.getByLabel("Entrega estimada").fill(chileDay(3))
    await ingreso.getByRole("button", { name: "Registrar ingreso", exact: true }).click()
    await esperarEstado(folio, "en_ejecucion")
    await sheet.getByRole("button", { name: "Cerrar", exact: true }).click()
  })

  test("2 · jefatura crea la nota CON OT desde el PC y reserva el repuesto de la bodega", async ({ page }) => {
    expect(otId, "depende del paso 1").not.toBe("")
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    // `?ot=` abre el formulario con esa OT elegida: la faena sale de la OT y el cargo de cada línea es su equipo.
    await page.goto(`/mantencion/notas-pedido/nueva?ot=${otId}`)
    await expect(page.getByRole("combobox", { name: /^Orden de trabajo/ })).toHaveValue(new RegExp(esc(folio)), { timeout: 30_000 })
    const linea = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Repuesto 1", exact: true }) })
    await linea.getByRole("combobox", { name: /^Repuesto/ }).fill(REPUESTO_CONSUMO.name)
    await page.getByRole("option", { name: new RegExp(escapar(REPUESTO_CONSUMO.name)) }).first().click()
    await expect(linea.getByRole("group", { name: "Repuesto elegido" })).toContainText(REPUESTO_CONSUMO.name)
    await expect(linea.getByRole("combobox", { name: /^Cargo a/ })).toHaveValue(new RegExp(esc(equipo.code)))
    await linea.getByLabel(/^Cantidad/).fill("1")
    await page.getByRole("button", { name: "Enviar nota", exact: true }).click()
    await expect(page).toHaveURL(/\/mantencion\/notas-pedido\/(?!nueva)[^/?]+$/, { timeout: 30_000 })

    const nota = await notaPorDescripcion(REPUESTO_CONSUMO.name)
    expect(nota).toMatchObject({ status: "enviada", workOrderId: otId })
    notaId = nota!.id
    notaCode = nota!.code
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${notaCode}`) })).toBeVisible()
    // Con OT sí se aparta stock: la línea ofrece «Reservar de bodega» (y no se puede hacer sin reservar el único que hay).
    const fila = page.getByRole("list", { name: "Líneas de la nota", exact: true }).getByRole("listitem").filter({ hasText: REPUESTO_CONSUMO.name })
    await fila.getByRole("button", { name: "Reservar de bodega", exact: true }).click()
    const dialogo = page.getByRole("dialog", { name: "Reservar de bodega", exact: true })
    await expect(dialogo.getByText("1 libres en Biodiversa")).toBeVisible()
    await dialogo.getByRole("button", { name: "Reservar de bodega", exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(fila).toContainText("Reservado", { timeout: 30_000 })
    await esperarEstadoDeNota(notaId, "cerrada")
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CONSUMO.id), "reservar no mueve el stock").toBe(1)
    expect(errores).toEqual([])
  })

  test("3 · el repuesto se retira de la bodega a espaldas del teléfono: el registro se guarda y el uso queda pendiente de conciliar, sin bajar de 0", async () => {
    expect(notaId, "depende del paso 2").not.toBe("")
    // El teléfono trae lo reservado (1 disponible) y lo ofrece con el chip.
    const respuesta = app.waitForResponse((r) => /\/api\/mantencion\/sync\/catalogo/.test(r.url()) && r.request().method() === "GET")
    await app.getByRole("button", { name: "Actualizar", exact: true }).click()
    expect([200, 304]).toContain((await respuesta).status())
    const hoja = await abrirOtEnApp()
    await expect(hoja.getByRole("region", { name: "Repuestos", exact: true }).getByRole("listitem").filter({ hasText: REPUESTO_CONSUMO.name })).toContainText("Llegó · 1 disponible")

    lectura = await registrarCorrectivaDesdeOt(app, {
      folio, equipoCode: equipo.code, lectura, descripcion: "QA_CONS Cambio de la bomba sin stock en bodega", usarBodega: true, repuesto: REPUESTO_CONSUMO.name,
      // Con el registro ya armado y revisado, alguien se lleva el repuesto de la bodega por fuera de la plataforma.
      antesDeFirmar: () => retirarTodoElStock(equipo.worksiteId, REPUESTO_CONSUMO.id),
    })

    // El registro nunca se rechaza por falta de stock (D6): queda vigente con el uso pendiente de conciliar.
    await expect.poll(async () => (await consumosDeLaOt(otId)).length, { timeout: 60_000 }).toBe(1)
    const [consumo] = await consumosDeLaOt(otId)
    expect(consumo).toMatchObject({ source: "stock", stockStatus: "pendiente_conciliar", productId: REPUESTO_CONSUMO.id, quantity: 1, recordStatus: "vigente" })
    expect(consumo!.movementId, "sin movimiento de stock").toBeNull()
    registroFolio = consumo!.folio ?? ""
    expect(registroFolio).toMatch(/^MC-BIO-\d{4}$/)
    // El stock no bajó de cero ni hay movimiento de uso: sólo el ajuste inicial y el retiro físico.
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CONSUMO.id)).toBe(0)
    expect((await movimientosDe(equipo.worksiteId, REPUESTO_CONSUMO.id)).map((movimiento) => [movimiento.type, movimiento.antes, movimiento.despues])).toEqual([["ajuste", 0, 1], ["ajuste", 1, 0]])
    expect(erroresApp).toEqual([])
  })

  test("4 · «Por conciliar»: «Descontar ahora» no alcanza y no mueve nada; «No salió de bodega» cierra la línea sin movimiento", async ({ page }) => {
    expect(registroFolio, "depende del paso 3").not.toBe("")
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto("/mantencion/notas-pedido?estado=por_conciliar")
    await expect(page.getByRole("navigation", { name: "Estado de las notas de pedido" }).getByRole("link", { name: /^Por conciliar/ })).toHaveAttribute("aria-current", "page")
    const fila = listRecord(page, registroFolio)
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila).toContainText(REPUESTO_CONSUMO.name)
    await expect(fila).toContainText("0 libres ahora")
    await expect(fila).toContainText("No alcanza para lo declarado")

    // «Descontar ahora»: sigue faltando; el servidor lo dice y no escribe nada.
    await fila.getByRole("button", { name: /^Descontar ahora/ }).click()
    await expect(fila.getByRole("alert")).toBeVisible({ timeout: 30_000 })
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CONSUMO.id)).toBe(0)
    expect((await consumosDeLaOt(otId))[0]).toMatchObject({ stockStatus: "pendiente_conciliar", movementId: null })
    expect((await movimientosDe(equipo.worksiteId, REPUESTO_CONSUMO.id)).map((movimiento) => movimiento.type)).toEqual(["ajuste", "ajuste"])

    // «No salió de bodega»: con motivo, la línea queda sin movimiento y sale de la lista.
    await fila.getByRole("button", { name: /^No salió de bodega/ }).click()
    const motivo = page.getByRole("dialog", { name: "No salió de bodega" })
    await motivo.getByLabel("Motivo").fill("QA_CONS El repuesto se lo llevó otro equipo")
    await motivo.getByRole("button", { name: "Registrar sin movimiento", exact: true }).click()
    await expect(motivo).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(async () => (await consumosDeLaOt(otId))[0]?.stockStatus, { timeout: 30_000 }).toBe("sin_movimiento")
    expect(await stockEnFaena(equipo.worksiteId, REPUESTO_CONSUMO.id)).toBe(0)
    await expect(listRecord(page, registroFolio)).toHaveCount(0, { timeout: 30_000 })
    expect(errores).toEqual([])
  })
})
