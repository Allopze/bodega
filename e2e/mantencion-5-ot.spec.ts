import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { clearRateLimits, cerrarSesion, selectRadixById, textoVisible } from "./helpers"
import { campoLectura, definirPin, entrar, jpeg, nuevoContexto } from "./mantencion-app-helpers"
import { chileDay, fichaValue, withSql } from "./mantencion-3-helpers"

/**
 * §9 E2E · Orden de trabajo (OT) de punta a punta, con la interfaz real.
 *
 *   administrador de contrato crea → jefatura ve el aviso y asigna a un mecánico
 *   de OTRA faena → el mecánico, desde la app, registra el ingreso a taller,
 *   marca los ítems, registra la correctiva enlazada y termina → recepción →
 *   el administrador de contrato RECHAZA en la conformidad (con motivo) → el
 *   mecánico ve «Devuelta», registra una correctiva NUEVA y termina otra vez →
 *   recepción → conformidad → «Cerrada», con el rechazo en el historial y el PDF.
 *
 * Con estado y en orden, pero autocontenida: no depende de lo que dejaron
 * `mantencion-1…4` (crea su propia OT), así que se puede correr sola sobre una
 * base recién sembrada. Usuarios de `e2e/fixtures/mantencion-setup.ts`
 * (contraseña `chome2026`): `admin.contrato@` (Biodiversa), `admin.contrato.cho@`
 * (Cholguan, sólo para el alcance), `jefe.mant@` (global) y `mecanico.cho@`
 * (Cholguan: la OT es de un equipo de Biodiversa, que él toma y ejecuta igual).
 *
 * Locators según «Locators in this repository» de AGENTS.md.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(240_000)

const ADMIN = "admin.contrato@e2e.chome.cl"
const ADMIN_CHO = "admin.contrato.cho@e2e.chome.cl"
const JEFE = "jefe.mant@e2e.chome.cl"
const MECANICO = "mecanico.cho@e2e.chome.cl"
const NOMBRE_MECANICO = "Mecánico Cholguan E2E"
const PIN = "4321"
const MOTIVO_RECHAZO = "QA_ Falta apretar las mangueras y limpiar el equipo"
const ITEM_ANEXO = "QA_ Cambiar pastillas de freno"
const ITEM_MANTENCION = "QA_ Cambio de aceite y filtros"
const DESCRIPCION = "QA_ Pierde aceite por el carter y hace ruido al frenar"

/** Errores de consola y de página de UNA página (el listado de «Failed to load resource» sin señal no aplica: aquí siempre hay red). */
function vigilarConsola(page: Page): string[] {
  const errores: string[] = []
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error" && !/favicon/i.test(mensaje.text())) errores.push(mensaje.text())
  })
  page.on("pageerror", (error) => errores.push(error.message))
  return errores
}

/** Login de la plataforma sin suponer adónde aterriza el rol (el administrador de contrato no tiene por qué ver el tablero). */
async function entrarPlataforma(page: Page, email: string) {
  for (const intento of [1, 2]) {
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill(email)
    await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    try {
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
      return
    } catch (error) {
      if (intento === 2) throw error
    }
  }
}

async function estadoOt(folio: string): Promise<{ status: string; rejectionCount: number; linked: number } | null> {
  return withSql(async (sql) => {
    const [row] = await sql`select id, status, rejection_count from mant_work_orders where folio = ${folio}`
    if (!row) return null
    const [linked] = await sql`select count(*)::int as n from mant_records where work_order_id = ${row.id}`
    return { status: row.status as string, rejectionCount: row.rejection_count as number, linked: linked?.n as number }
  })
}

/** Espera a que el servidor tenga la OT en ese estado (la cola del teléfono ya la envió). */
async function esperarEstado(folio: string, status: string) {
  await expect.poll(async () => (await estadoOt(folio))?.status, { timeout: 90_000, message: `la OT ${folio} debe quedar «${status}» en el servidor` }).toBe(status)
}

/** Cada detalle de la OT en la plataforma: el estado que muestra su ficha. */
async function expectEstadoEnFicha(page: Page, etiqueta: string) {
  await expect(fichaValue(page, "Estado")).toHaveText(etiqueta, { timeout: 30_000 })
}

/** Un diálogo de acción del detalle: su botón de envío. */
const dialogo = (page: Page) => page.getByRole("dialog")

/** El equipo de la prueba: el último (por código) de los km de Biodiversa; las otras specs usan los primeros. */
async function equipoDePrueba(): Promise<{ code: string; plate: string }> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select v.code as code, v.plate as plate
      from mant_equipment_profiles p
      join fuel_vehicles v on v.id = p.vehicle_id
      join fuel_equipment_types t on t.id = v.equipment_type_id
      join worksites w on w.id = v.worksite_id
      where w.name = 'Biodiversa' and t.default_meter_type = 'odometer' and v.is_active = true and v.operational_status = 'operativo'
        and v.code is not null
      order by v.code desc
      limit 1`
    expect(row, "Biodiversa necesita un equipo km operativo en la carga inicial").toBeTruthy()
    return { code: row!.code as string, plate: row!.plate as string }
  })
}

test.describe("Orden de trabajo (OT)", () => {
  let equipo = { code: "", plate: "" }
  let folio = ""
  let otId = ""
  let telefono: BrowserContext
  let app: Page
  let erroresApp: string[]
  /** Última lectura que el test le dio al equipo (el ingreso y cada correctiva suben el odómetro). */
  let lectura = 0

  const abrirOtEnApp = async () => {
    await app.getByRole("button", { name: new RegExp(folio) }).click()
    await expect(app.getByRole("dialog")).toBeVisible()
  }

  /** Registra la correctiva de la OT abierta en la app (equipo fijo, sin «¿queda en taller?»). Termina en «Registro guardado» ya enviado. */
  async function registrarCorrectivaDesdeOt(descripcion: string) {
    await app.getByRole("dialog").getByRole("button", { name: "Registrar correctiva", exact: true }).click()
    // El equipo es el de la OT: el flujo entra directo a la lectura.
    await expect(app.getByText("PASO 2/5")).toBeVisible()
    await expect(app.getByRole("button", { name: /^Cambiar equipo/ })).toHaveCount(0)
    // Si el equipo ya tiene lecturas, la app dice cuál fue la última; si no, manda la que dejó el ingreso.
    await expect(app.getByText(/Última lectura registrada: [\d.]+|No hay lecturas anteriores de este equipo\./)).toBeVisible()
    const anterior = await app.getByText(/Última lectura registrada: [\d.]+/).count()
      ? Number(/registrada: ([\d.]+)/.exec(await app.getByText(/Última lectura registrada: [\d.]+/).innerText())?.[1]?.replace(/\./g, ""))
      : 0
    lectura = Math.max(lectura, anterior) + 10
    await campoLectura(app).fill(String(lectura))
    await app.getByRole("button", { name: "Continuar", exact: true }).click()

    await app.getByRole("group", { name: "Agregar trabajo" }).getByRole("button").first().click()
    await expect(app.getByText(/^Total: /)).toBeVisible()
    await app.getByRole("button", { name: "No se cambió aceite", exact: true }).click()
    await app.getByLabel("Trabajo realizado").fill(descripcion)
    await app.getByRole("checkbox", { name: "No se usaron repuestos" }).check()
    await app.getByLabel(/Conductores de las últimas 24 h/).fill("a")
    await app.getByRole("group", { name: "Conductores encontrados" }).getByRole("button").first().click()
    // Con una OT, ella lleva el taller: un chip con su folio reemplaza a «¿sigue en taller?».
    await expect(app.getByRole("group", { name: "Orden de trabajo" }).getByText(folio)).toBeVisible()
    await expect(app.getByText("¿El equipo sigue en taller?")).toHaveCount(0)
    await expect(app.getByText("Nº de OT en papel")).toHaveCount(0)
    await app.getByRole("button", { name: "Continuar a fotos", exact: true }).click()

    await expect(app.getByText("PASO 4/5")).toBeVisible()
    await app.getByLabel("Agregar foto del trabajo").setInputFiles(await jpeg(app, `${equipo.code} OT`))
    await expect(app.getByRole("img", { name: "Foto 1 del trabajo" })).toBeVisible()
    await app.getByRole("button", { name: "Revisar registro", exact: true }).click()
    await app.getByRole("button", { name: "Firmar y guardar", exact: true }).click()
    await expect(app.getByRole("heading", { name: "Registro guardado" })).toBeVisible()
    await expect(app.getByText(`Quedó enlazado a ${folio}.`)).toBeVisible()
    await expect(app.getByText("Ya llegó a la plataforma.")).toBeVisible({ timeout: 60_000 })
    await app.getByRole("button", { name: "Volver al inicio", exact: true }).click()
  }

  /** «Terminar (salida de taller)» desde la hoja de la OT; deja la hoja cerrada y la cola vacía. */
  async function terminarEnApp() {
    const hoja = app.getByRole("dialog")
    await hoja.getByRole("button", { name: /^Terminar \(salida de taller\)/ }).click()
    await expect(hoja.getByText("Todo listo: ítems marcados y trabajo registrado.")).toBeVisible()
    await hoja.getByRole("button", { name: "Terminar y avisar", exact: true }).click()
    await esperarEstado(folio, "trabajo_terminado")
  }

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    equipo = await equipoDePrueba()
    telefono = await nuevoContexto(browser, { width: 390, height: 844 })
    app = await telefono.newPage()
    erroresApp = vigilarConsola(app)
  })
  test.afterAll(async () => { await telefono.close() })

  test("a · el administrador de contrato crea la OT de un equipo de su faena", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN)
    await page.goto("/mantencion/ot")
    await expect(page.getByRole("heading", { level: 1, name: "Órdenes de trabajo" })).toBeVisible()

    await page.getByRole("button", { name: "Nueva OT", exact: true }).click()
    const hoja = page.getByRole("dialog", { name: "Nueva orden de trabajo" })
    await expect(hoja).toBeVisible()
    // El administrador de contrato no asigna al crear: ese selector es de la jefatura.
    await expect(hoja.getByLabel("Mecánico (opcional)")).toHaveCount(0)

    await hoja.locator("#ot-equipo").click()
    await hoja.locator("#ot-equipo").fill(equipo.code)
    await page.getByRole("option", { name: new RegExp(equipo.code) }).first().click()
    await expect(hoja.getByText(/Faena: Biodiversa\. La OT queda en la faena del equipo\./)).toBeVisible()

    // REPARACIÓN viene marcada; se agrega MANTENCIÓN y una línea en cada lista.
    await hoja.getByRole("checkbox", { name: "Mantención", exact: true }).check()
    await hoja.locator("#ot-reparacion-desc").fill(DESCRIPCION)
    await hoja.getByRole("button", { name: "Agregar línea" }).first().click()
    await hoja.getByRole("textbox", { name: /Trabajos anexos \(reparación\), línea 1/ }).fill(ITEM_ANEXO)
    await hoja.getByRole("button", { name: "Agregar línea" }).last().click()
    await hoja.getByRole("textbox", { name: /Mantenciones solicitadas o asignadas en taller, línea 1/ }).fill(ITEM_MANTENCION)
    await hoja.getByRole("button", { name: "Crear OT", exact: true }).click()

    await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/, { timeout: 30_000 })
    otId = new URL(page.url()).pathname.split("/").pop() ?? ""
    const titulo = await page.getByRole("heading", { level: 1 }).first().innerText()
    folio = /OT-BIO-\d{4}/.exec(titulo)?.[0] ?? ""
    expect(folio, "el título de la OT lleva su folio").toMatch(/^OT-BIO-\d{4}$/)
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${folio} · ${equipo.code}`) })).toBeVisible()
    await expectEstadoEnFicha(page, "Por asignar")
    await expect(textoVisible(page, ITEM_ANEXO)).toBeVisible()
    await expect(textoVisible(page, ITEM_MANTENCION)).toBeVisible()
    await expect(page.getByRole("list", { name: "Historial de la orden de trabajo" }).getByText("OT solicitada")).toBeVisible()
    // El administrador de contrato no asigna ni anula la de otro: no ve «Asignar».
    await expect(page.getByRole("button", { name: "Asignar", exact: true })).toHaveCount(0)

    // La lista la muestra «Por asignar».
    await page.goto("/mantencion/ot")
    await page.getByRole("navigation", { name: "Estado de las órdenes de trabajo" }).getByRole("link", { name: /^Por asignar/ }).click()
    await expect(page.getByRole("link", { name: `Ver la OT ${folio}` })).toBeVisible()
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  test("b · la jefatura ve el aviso y asigna a un mecánico de otra faena", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto("/mantencion/ot")
    await expect(page.getByRole("heading", { level: 1, name: "Órdenes de trabajo" })).toBeVisible()

    await page.getByRole("button", { name: /^Notificaciones/ }).click()
    const aviso = page.getByRole("link", { name: new RegExp(`Nueva orden de trabajo ${folio}`) }).first()
    await expect(aviso).toBeVisible({ timeout: 30_000 })
    await expect(aviso).toContainText("Está por asignar")
    await aviso.click()
    await expect(page).toHaveURL(new RegExp(`/mantencion/ot/${otId}$`))
    await expectEstadoEnFicha(page, "Por asignar")

    await page.getByRole("button", { name: "Asignar", exact: true }).click()
    await selectRadixById(page, "ot-assign-mechanic", new RegExp(NOMBRE_MECANICO))
    await dialogo(page).getByRole("button", { name: "Asignar", exact: true }).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expectEstadoEnFicha(page, "Asignada")
    await expect(textoVisible(page, new RegExp(`${NOMBRE_MECANICO}.*desde`))).toBeVisible()
    await expect(page.getByRole("list", { name: "Historial de la orden de trabajo" }).getByText("Mecánico asignado")).toBeVisible()
    // Ya asignada, «Reasignar» pasa a «Más acciones».
    await page.getByRole("button", { name: /^Más acciones/ }).click()
    await expect(page.getByRole("menuitem", { name: "Reasignar", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  test("c · el mecánico (de Cholguan) ve la OT en la app: ingreso, ítems SÍ/NO, correctiva enlazada y terminar", async () => {
    await entrar(app, MECANICO)
    await definirPin(app, PIN)

    const seccion = app.getByRole("region", { name: "Órdenes de trabajo" })
    await expect(seccion.getByRole("button", { name: new RegExp(folio) })).toBeVisible({ timeout: 30_000 })
    await expect(seccion.getByText("Asignada")).toBeVisible()
    await abrirOtEnApp()
    const hoja = app.getByRole("dialog")
    await expect(hoja.getByText(/Equipo de otra faena \(Biodiversa\)\. Puedes trabajarla igual\./)).toBeVisible()
    await expect(hoja.getByText(DESCRIPCION)).toBeVisible()

    // Ingreso a taller: lectura del equipo y fecha estimada de entrega.
    await hoja.getByRole("button", { name: "Registrar ingreso a taller", exact: true }).click()
    await hoja.getByRole("button", { name: "Interno", exact: true }).click()
    const sugerida = await hoja.getByText(/Última lectura del [^:]+: [\d.]+/).innerText().catch(() => "")
    lectura = Number(/: ([\d.]+)/.exec(sugerida)?.[1]?.replace(/\./g, "") ?? "40000") + 5
    await hoja.getByLabel("Odómetro al ingresar").fill(String(lectura))
    await hoja.getByLabel("Fecha estimada de entrega").fill(chileDay(3))
    await hoja.getByRole("button", { name: "Registrar ingreso", exact: true }).click()
    await esperarEstado(folio, "en_ejecucion")
    await expect(hoja.getByText("Ingreso", { exact: true })).toBeVisible()
    await expect(hoja.getByRole("button", { name: "Registrar ingreso a taller", exact: true })).toHaveCount(0)

    // Marca los ítems: el de reparación SÍ, el de mantención NO (con motivo).
    await hoja.getByRole("button", { name: /^Marcar ítems SÍ \/ NO/ }).click()
    await hoja.getByRole("group", { name: ITEM_ANEXO }).getByRole("button", { name: "SÍ", exact: true }).click()
    await hoja.getByRole("group", { name: ITEM_MANTENCION }).getByRole("button", { name: "NO", exact: true }).click()
    await hoja.getByLabel(new RegExp(`Motivo de «${ITEM_MANTENCION}»`)).fill("QA_ Faltó el filtro")
    await hoja.getByRole("button", { name: "Guardar marcas", exact: true }).click()
    await expect(hoja.getByText("todos marcados")).toBeVisible({ timeout: 30_000 })

    // Terminar sin trabajo registrado: la app dice qué falta antes de enviar nada.
    await hoja.getByRole("button", { name: /^Terminar \(salida de taller\)/ }).click()
    await expect(hoja.getByText("Antes de terminar")).toBeVisible()
    await hoja.getByRole("button", { name: "Volver", exact: true }).click()

    // Correctiva enlazada: equipo fijo, sin «¿queda en taller?».
    await registrarCorrectivaDesdeOt("QA_ Cambio de manguera hidráulica desde la OT")
    await abrirOtEnApp()
    await expect(app.getByRole("dialog").getByText(/Trabajo registrado/)).toBeVisible()
    await expect(app.getByRole("dialog").getByText(/Correctiva · MC-BIO-\d{4}/)).toBeVisible()
    await terminarEnApp()

    await app.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click()
    const tarjeta = app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) })
    await expect(tarjeta.getByText("Por recibir")).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta.getByText("Sin enviar")).toHaveCount(0)
    expect((await estadoOt(folio))?.linked).toBe(1)
    expect(erroresApp).toEqual([])
  })

  test("d · recepción, rechazo en la conformidad con motivo y la OT vuelve a taller", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN)
    await page.goto(`/mantencion/ot/${otId}`)
    await expectEstadoEnFicha(page, "Por recibir")
    await expect(textoVisible(page, /Todavía no hay|Aún no se registra la recepción/)).toBeVisible()

    await page.getByRole("button", { name: "Recepcionar", exact: true }).click()
    await expect(dialogo(page).getByLabel("Sr. (quien recibe)")).toHaveValue(/Admin Contrato Biodiversa E2E/)
    await dialogo(page).getByRole("button", { name: "Registrar recepción", exact: true }).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expectEstadoEnFicha(page, "Por conformidad")

    await page.getByRole("button", { name: "Rechazar", exact: true }).click()
    // Sin motivo no se puede rechazar.
    await expect(dialogo(page).getByRole("button", { name: "Rechazar", exact: true })).toBeDisabled()
    await dialogo(page).getByLabel("¿Qué hay que corregir?").fill(MOTIVO_RECHAZO)
    await dialogo(page).getByRole("button", { name: "Rechazar", exact: true }).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expectEstadoEnFicha(page, "En taller")
    await expect(page.getByText("Esta orden fue devuelta una vez")).toBeVisible()
    await expect(page.getByText(`Motivo: ${MOTIVO_RECHAZO}`).first()).toBeVisible()
    const historial = page.getByRole("list", { name: "Historial de la orden de trabajo" })
    await expect(historial.getByText("Rechazada")).toBeVisible()
    await expect(historial.getByText(MOTIVO_RECHAZO)).toBeVisible()
    expect((await estadoOt(folio))?.rejectionCount).toBe(1)
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  test("e · la app muestra «Devuelta», exige una correctiva nueva y termina otra vez", async () => {
    await app.getByRole("button", { name: "Actualizar", exact: true }).click()
    const tarjeta = app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) })
    await expect(tarjeta.getByText(`Devuelta: ${MOTIVO_RECHAZO}`)).toBeVisible({ timeout: 60_000 })
    await expect(tarjeta.getByText("En taller", { exact: true })).toBeVisible()

    await tarjeta.click()
    const hoja = app.getByRole("dialog")
    await expect(hoja.getByText(`Devuelta: ${MOTIVO_RECHAZO}`)).toBeVisible()

    // Tras un rechazo, terminar exige una correctiva firmada DESPUÉS de él: la del primer turno no cuenta.
    await hoja.getByRole("button", { name: /^Terminar \(salida de taller\)/ }).click()
    await expect(hoja.getByText("Antes de terminar")).toBeVisible()
    await expect(hoja.getByText("Registra una correctiva o preventiva nueva, después de la devolución")).toBeVisible()
    await hoja.getByRole("button", { name: "Volver", exact: true }).click()
    // La hoja ya no lista el trabajo de antes de la devolución.
    await expect(hoja.getByText("Trabajo registrado")).toHaveCount(0)

    await registrarCorrectivaDesdeOt("QA_ Se apretaron las mangueras y se limpió el equipo")
    await abrirOtEnApp()
    // Sólo cuenta el trabajo posterior a la devolución: el de antes sigue en el servidor, pero ya no se lista aquí.
    await expect(app.getByRole("dialog").getByText(/Correctiva · MC-BIO-\d{4}/)).toHaveCount(1)
    await terminarEnApp()
    await app.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click()
    const lista = app.getByRole("region", { name: "Órdenes de trabajo" }).getByRole("button", { name: new RegExp(folio) })
    await expect(lista.getByText("Por recibir")).toBeVisible({ timeout: 30_000 })
    await expect(lista.getByText(/Devuelta:/)).toHaveCount(0)
    expect((await estadoOt(folio))?.linked).toBe(2)
    expect(erroresApp).toEqual([])
  })

  test("f · recepción de nuevo, conformidad, OT cerrada, historial con el rechazo y PDF", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN)
    await page.goto(`/mantencion/ot/${otId}`)
    await expectEstadoEnFicha(page, "Por recibir")
    await page.getByRole("button", { name: "Recepcionar", exact: true }).click()
    await dialogo(page).getByRole("button", { name: "Registrar recepción", exact: true }).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expectEstadoEnFicha(page, "Por conformidad")

    await page.getByRole("button", { name: "Dar conformidad", exact: true }).click()
    await dialogo(page).getByRole("button", { name: "Dar conformidad", exact: true }).click()
    await expect(dialogo(page)).toHaveCount(0)
    await expectEstadoEnFicha(page, "Cerrada")
    expect((await estadoOt(folio))?.status).toBe("cerrada")
    // Cerrada: ya no hay acciones de flujo (sólo el PDF).
    for (const accion of ["Recepcionar", "Rechazar", "Dar conformidad", "Registrar salida"]) {
      await expect(page.getByRole("button", { name: accion, exact: true })).toHaveCount(0)
    }

    const historial = page.getByRole("list", { name: "Historial de la orden de trabajo" })
    for (const evento of ["OT solicitada", "Mecánico asignado", "Ingreso a taller", "Rechazada", "Recepción en faena (conformidad)"]) {
      await expect(historial.getByText(evento).first()).toBeVisible()
    }
    await expect(historial.getByText(MOTIVO_RECHAZO)).toBeVisible()
    // Los dos registros de mantención (el de antes y el de después del rechazo) quedan enlazados.
    // El administrador de contrato no tiene permisos de registros: ve los folios, pero no puede abrirlos.
    const enlazados = page.getByRole("complementary", { name: "Historial y registros enlazados" })
    await expect(enlazados.getByText(/^MC-BIO-\d{4}$/)).toHaveCount(2)
    await expect(enlazados.getByText(/Correctiva · .* · sin acceso para abrirlo/)).toHaveCount(2)

    // PDF: el botón descarga un PDF de verdad.
    const descarga = page.waitForEvent("download", { timeout: 90_000 })
    await page.getByRole("button", { name: /^Más acciones/ }).click()
    await page.getByRole("menuitem", { name: "Descargar PDF" }).click()
    const archivo = await descarga
    expect(archivo.suggestedFilename()).toMatch(/\.pdf$/i)
    const respuesta = await page.request.get(`/api/mantencion/ot/${otId}/pdf`)
    expect(respuesta.status()).toBe(200)
    expect(respuesta.headers()["content-type"]).toContain("application/pdf")
    expect((await respuesta.body()).subarray(0, 4).toString("latin1")).toBe("%PDF")
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })

  test("g · alcance: el administrador de contrato de Cholguan no ve ni crea sobre equipos de Biodiversa", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, ADMIN_CHO)

    // La OT de otra faena es un 404 (el mismo que una que no existe), por la ficha y por el PDF.
    await page.goto(`/mantencion/ot/${otId}`)
    await expect(page.getByRole("heading", { name: "No encontramos este registro", level: 1 })).toBeVisible()
    await expect(page.getByText(folio)).toHaveCount(0)
    expect((await page.request.get(`/api/mantencion/ot/${otId}/pdf`)).status()).toBe(404)

    // La lista no la trae, ni en Cerradas, y el formulario no ofrece el equipo.
    await page.goto("/mantencion/ot?estado=cerrada")
    await expect(page.getByRole("heading", { level: 1, name: "Órdenes de trabajo" })).toBeVisible()
    await expect(page.getByText(folio)).toHaveCount(0)
    await page.getByRole("button", { name: /^(Nueva OT|Crear la primera orden)$/ }).first().click()
    const hoja = page.getByRole("dialog", { name: "Nueva orden de trabajo" })
    await hoja.locator("#ot-equipo").click()
    await hoja.locator("#ot-equipo").fill(equipo.code)
    await expect(page.getByRole("option")).toHaveCount(0)
    await hoja.locator("#ot-equipo").fill("")
    await expect(page.getByRole("option").first()).toContainText("Cholguan")
    expect(errores).toEqual([])
    await cerrarSesion(page)
  })
})
