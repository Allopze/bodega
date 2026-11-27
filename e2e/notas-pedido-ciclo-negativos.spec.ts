import { expect, test, type Page } from "@playwright/test"
import { listRecord, textoVisible } from "./helpers"
import { ADMIN_CONTRATO, JEFE, MECANICO, entrarPlataforma, vigilarConsola } from "./notas-pedido-helpers"
import {
  ACEPTAR_Y_ENVIAR, ADMIN, ADMIN_CONTRATO_CHO, CICLO, MECANICO_CHO, SUPERVISOR, cambiarDeSesion, capturarAccion, crearNotaPorUi, esperarEstadoDeNota, estadoDeNota,
  comprasDeNota, eventosDeNota, notaPorId, repetirAccion, sesionComo, textoDelExcel, type AccionCapturada, type NotaEnBase,
} from "./notas-pedido-ciclo-helpers"

/**
 * Casos negativos de la nota de pedido sin OT (ADR mantención 0001): el SERVIDOR decide, no lo que muestra la pantalla.
 * Las acciones de la interfaz se capturan (`next-action`) y se repiten por HTTP con la sesión de otra persona o con otros
 * argumentos; la acción vieja se usa también desde una pantalla desactualizada.
 *
 *   1  transición inválida: «Aceptar y enviar a compra» con la pantalla vieja sobre una nota que otra persona ya anuló (y no sale solicitud);
 *   2  motivo faltante al poner en espera y al rechazar (pantalla y servidor);
 *   3  rechazar la nota entera y reabrirla;
 *   4  sin permiso: el mecánico no ve acciones y el servidor le responde error; el supervisor no puede reabrir;
 *   5  otra faena: el detalle es 404, no aparece en la bandeja y el servidor rechaza la acción;
 *   6  exportación: sin sesión nada (401 o a /login), sin permiso 403 explícito, con permiso un .xlsx (acotado al alcance de faena).
 *
 * Con estado y en orden; crea sus propias notas por la interfaz (texto libre, sufijo por corrida).
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(240_000)

type Clave = "aceptar" | "en_espera" | "rechazar" | "anular" | "reabrir"

test.describe("Nota de pedido · casos negativos", () => {
  let anulable: NotaEnBase
  let rechazable: NotaEnBase
  const acciones: Partial<Record<Clave, AccionCapturada>> = {}
  const detalle = (id: string) => `/mantencion/notas-pedido/${id}`
  /** El mismo 404 de una nota que no existe (el detalle responde 200 al empezar a transmitir: lo que vale es el panel). */
  const expectNoEncontrada = async (page: Page, ruta: string, codigo: string) => {
    await page.goto(ruta)
    await expect(page.getByRole("heading", { level: 1, name: "No encontramos este registro" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(codigo)).toHaveCount(0)
  }
  const resumen = async (id: string) => (await eventosDeNota(id)).map((evento) => `${evento.from ?? "·"}>${evento.to}`)

  test("0 · jefatura crea por la interfaz las dos notas de prueba", async ({ page }) => {
    await entrarPlataforma(page, JEFE)
    anulable = await crearNotaPorUi(page, { descripcion: `QA_NEG Bomba de agua A ${CICLO}` })
    rechazable = await crearNotaPorUi(page, { descripcion: `QA_NEG Bomba de agua B ${CICLO}`, cantidad: 2 })
    expect([anulable.status, rechazable.status]).toEqual(["enviada", "enviada"])
  })

  test("1 · transición inválida: con la pantalla vieja, aceptar una nota que otra persona ya anuló es rechazado por el servidor", async ({ page, browser }) => {
    expect(anulable?.id, "depende del paso 0").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto(detalle(anulable.id))
    const aceptar = page.getByRole("button", { name: ACEPTAR_Y_ENVIAR, exact: true })
    await expect(aceptar).toBeVisible()

    // Otra persona (administración) la anula con su motivo mientras esta pantalla sigue abierta.
    const otra = await sesionComo(browser, ADMIN)
    await otra.page.goto(detalle(anulable.id))
    await otra.page.getByRole("button", { name: "Anular nota", exact: true }).click()
    const dialogo = otra.page.getByRole("dialog", { name: `Anular ${anulable.code}` })
    await dialogo.getByLabel("Motivo de la anulación").fill("QA_NEG Pedido duplicado por error")
    acciones.anular = await capturarAccion(otra.page, () => dialogo.getByRole("button", { name: "Anular nota", exact: true }).click())
    await esperarEstadoDeNota(anulable.id, "anulada")
    await expect(otra.page.getByText("Esta nota está anulada")).toBeVisible({ timeout: 30_000 })
    await expect(otra.page.getByText("Motivo: QA_NEG Pedido duplicado por error").first()).toBeVisible()
    await otra.context.close()

    // La pantalla vieja todavía ofrece «Aceptar y enviar a compra»: el servidor lo rechaza, no sale ninguna solicitud y la nota no cambia.
    acciones.aceptar = await capturarAccion(page, () => aceptar.click())
    await expect(textoVisible(page, `La nota ${anulable.code} ya está anulada.`).first()).toBeVisible({ timeout: 30_000 })
    expect(await estadoDeNota(anulable.id)).toBe("anulada")
    expect(await resumen(anulable.id)).toEqual(["·>enviada", "enviada>anulada"])
    expect(await comprasDeNota(anulable.id), "aceptar una nota anulada no manda nada a Compras").toEqual([])
    // Recargada, la nota ya no ofrece acciones.
    await page.reload()
    await expect(page.getByText("Esta nota está anulada")).toBeVisible()
    await expect(page.getByRole("button", { name: ACEPTAR_Y_ENVIAR, exact: true })).toHaveCount(0)
    // Y por HTTP, con la sesión de jefatura: aceptar y anular una nota anulada se rechazan igual.
    expect(await repetirAccion(page, acciones.aceptar, { noteId: anulable.id })).toMatchObject({ ok: false, message: `La nota ${anulable.code} ya está anulada.` })
    expect(await repetirAccion(page, acciones.anular, { noteId: anulable.id, reason: "QA_NEG Otra vez" })).toMatchObject({ ok: false, message: `La nota ${anulable.code} ya está anulada.` })
    expect(await resumen(anulable.id)).toEqual(["·>enviada", "enviada>anulada"])
    expect(errores).toEqual([])
  })

  test("2 · motivo faltante: «Poner en espera» y «Rechazar nota» no se envían sin motivo y el servidor lo exige igual", async ({ page }) => {
    expect(rechazable?.id, "depende del paso 0").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto(detalle(rechazable.id))

    // Rechazar con un motivo corto: el botón del diálogo sigue deshabilitado.
    await page.getByRole("button", { name: "Rechazar nota", exact: true }).click()
    const rechazo = page.getByRole("dialog", { name: `Rechazar ${rechazable.code}` })
    await expect(rechazo.getByRole("button", { name: "Rechazar nota", exact: true })).toBeDisabled()
    await rechazo.getByLabel("Motivo del rechazo").fill("abc")
    await expect(rechazo.getByRole("button", { name: "Rechazar nota", exact: true })).toBeDisabled()
    await rechazo.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(rechazo).toHaveCount(0)
    expect(await estadoDeNota(rechazable.id)).toBe("enviada")

    // En espera con motivo válido (y se captura la acción).
    await page.getByRole("button", { name: "Poner en espera", exact: true }).click()
    const espera = page.getByRole("dialog", { name: `Poner ${rechazable.code} en espera` })
    await espera.getByLabel("Motivo de la espera").fill("Falta confirmar el modelo de la bomba")
    acciones.en_espera = await capturarAccion(page, () => espera.getByRole("button", { name: "Poner en espera", exact: true }).click())
    await esperarEstadoDeNota(rechazable.id, "en_espera")

    // El servidor: motivo corto o en blanco → error de campo, la nota sigue como estaba y no hay eventos nuevos.
    for (const reason of ["abc", "   ", ""]) {
      const respuesta = await repetirAccion(page, acciones.en_espera, { noteId: rechazable.id, reason })
      expect(respuesta.ok, `motivo «${reason}»`).toBe(false)
      expect(respuesta.raw).toContain("Escribe un motivo de al menos 5 caracteres.")
    }
    // Con motivo válido pero la nota ya en espera: tampoco.
    expect(await repetirAccion(page, acciones.en_espera, { noteId: rechazable.id, reason: "Otro motivo válido" })).toMatchObject({ ok: false, message: `La nota ${rechazable.code} ya está en espera.` })
    expect(await resumen(rechazable.id)).toEqual(["·>enviada", "enviada>en_espera"])
    expect(errores).toEqual([])
  })

  test("3 · rechazar la nota entera deja sus líneas rechazadas con el motivo y «Reabrir» las devuelve a pendiente", async ({ page }) => {
    expect(rechazable?.id, "depende del paso 2").toBeTruthy()
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto(detalle(rechazable.id))
    await expect(page.getByText("Esta nota está en espera")).toBeVisible()

    // Rechazar desde la espera: la espera no lo impide.
    await page.getByRole("button", { name: "Rechazar nota", exact: true }).click()
    const rechazo = page.getByRole("dialog", { name: `Rechazar ${rechazable.code}` })
    await rechazo.getByLabel("Motivo del rechazo").fill("QA_NEG No corresponde a esta faena")
    acciones.rechazar = await capturarAccion(page, () => rechazo.getByRole("button", { name: "Rechazar nota", exact: true }).click())
    await esperarEstadoDeNota(rechazable.id, "rechazada")
    expect((await notaPorId(rechazable.id))!.lines.map((linea) => linea.resolution)).toEqual(["rechazada"])
    await expect(page.getByText("Motivo: QA_NEG No corresponde a esta faena").first()).toBeVisible({ timeout: 30_000 })
    // Rechazada: ya no se acepta ni se pone en espera; sólo se puede reabrir.
    await expect(page.getByRole("button", { name: ACEPTAR_Y_ENVIAR, exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Poner en espera", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Reabrir", exact: true })).toBeVisible()

    // Reabrir (jefatura tiene `mant:np:reopen`): la línea vuelve a pendiente y la nota a su estado derivado.
    await page.getByRole("button", { name: "Reabrir", exact: true }).click()
    const reapertura = page.getByRole("dialog", { name: `Reabrir ${rechazable.code}` })
    await reapertura.getByLabel("Motivo de la reapertura").fill("QA_NEG Sí corresponde, faltaba el modelo")
    acciones.reabrir = await capturarAccion(page, () => reapertura.getByRole("button", { name: "Reabrir", exact: true }).click())
    await expect.poll(() => estadoDeNota(rechazable.id), { timeout: 30_000 }).toMatch(/^(enviada|aceptada)$/)
    expect((await notaPorId(rechazable.id))!.lines.map((linea) => linea.resolution)).toEqual(["pendiente"])
    expect((await resumen(rechazable.id)).slice(0, 4)).toEqual(["·>enviada", "enviada>en_espera", "en_espera>rechazada", expect.stringMatching(/^rechazada>(enviada|aceptada)$/)])
    // Reabrir una nota que ya no tiene líneas rechazadas: el servidor lo rechaza.
    const otra = await repetirAccion(page, acciones.reabrir, { noteId: rechazable.id, reason: "QA_NEG Segunda reapertura" })
    expect(otra.ok).toBe(false)
    expect(otra.message).toMatch(/no se puede reabrir/)
    expect(errores).toEqual([])
  })

  test("4 · sin permiso: el mecánico no ve acciones y el servidor le contesta error; el supervisor no puede reabrir", async ({ page, browser }) => {
    expect(acciones.aceptar && acciones.rechazar && acciones.reabrir, "depende de los pasos 1 a 3").toBeTruthy()
    const antes = await resumen(rechazable.id)
    const estadoAntes = await estadoDeNota(rechazable.id)

    // El mecánico (sólo `create` y `view_own`): no ve la nota de jefatura ni la bandeja de las demás, y el servidor rechaza cada acción.
    await entrarPlataforma(page, MECANICO)
    await expectNoEncontrada(page, detalle(rechazable.id), rechazable.code)
    for (const [clave, argumentos] of [
      ["aceptar", { noteId: rechazable.id }],
      ["en_espera", { noteId: rechazable.id, reason: "Intento sin permiso" }],
      ["rechazar", { noteId: rechazable.id, reason: "Intento sin permiso" }],
      ["anular", { noteId: rechazable.id, reason: "Intento sin permiso" }],
      ["reabrir", { noteId: rechazable.id, reason: "Intento sin permiso" }],
    ] as const) {
      const accion = acciones[clave]
      expect(accion, `acción «${clave}» capturada`).toBeTruthy()
      expect(await repetirAccion(page, accion!, argumentos), `«${clave}» como mecánico`).toMatchObject({ ok: false, message: "No tienes permisos para realizar esta acción" })
    }

    // El supervisor de Biodiversa resuelve notas (tiene `manage`) pero no reabre: el permiso es otro.
    const supervisor = await sesionComo(browser, SUPERVISOR)
    await supervisor.page.goto(detalle(rechazable.id))
    await expect(supervisor.page.getByRole("heading", { level: 1, name: new RegExp(`^${rechazable.code}`) })).toBeVisible({ timeout: 30_000 })
    expect(await repetirAccion(supervisor.page, acciones.reabrir!, { noteId: rechazable.id, reason: "Intento sin permiso" })).toMatchObject({ ok: false, message: "No tienes permisos para realizar esta acción" })
    await supervisor.context.close()

    expect(await estadoDeNota(rechazable.id)).toBe(estadoAntes)
    expect(await resumen(rechazable.id)).toEqual(antes)
    expect(await comprasDeNota(rechazable.id), "sin permiso, «Aceptar y enviar a compra» no manda nada a Compras").toEqual([])
  })

  test("5 · otra faena: el detalle es 404, la nota no aparece en la bandeja y el servidor rechaza la acción", async ({ page, browser }) => {
    expect(rechazable?.id && acciones.aceptar, "depende de los pasos anteriores").toBeTruthy()
    const antes = await resumen(rechazable.id)

    // El mecánico de Cholguan (sólo `view_own`).
    await entrarPlataforma(page, MECANICO_CHO)
    await expectNoEncontrada(page, detalle(rechazable.id), rechazable.code)

    // El administrador de contrato de Cholguan resuelve notas, pero de SU faena.
    const cholguan = await sesionComo(browser, ADMIN_CONTRATO_CHO)
    await expectNoEncontrada(cholguan.page, detalle(rechazable.id), rechazable.code)
    await expectNoEncontrada(cholguan.page, detalle(anulable.id), anulable.code)
    for (const estado of ["por_revisar", "en_compra", "en_recepcion", "cerradas"]) {
      await cholguan.page.goto(`/mantencion/notas-pedido?estado=${estado}`)
      await expect(cholguan.page.getByRole("heading", { level: 1, name: "Notas de pedido" })).toBeVisible({ timeout: 30_000 })
      await expect(listRecord(cholguan.page, rechazable.code), `«${estado}» de Cholguan no lista notas de Biodiversa`).toHaveCount(0)
      await expect(listRecord(cholguan.page, anulable.code)).toHaveCount(0)
    }
    const respuesta = await repetirAccion(cholguan.page, acciones.aceptar!, { noteId: rechazable.id }, { ruta: detalle(rechazable.id) })
    expect(respuesta.ok).toBe(false)
    expect(respuesta.message).toMatch(/alcance|no existe|ya no existe/i)
    // La exportación tampoco la lleva: el alcance de faena lo pone el servidor.
    const excel = await cholguan.page.request.get("/api/mantencion/notas-pedido/export")
    expect(excel.status()).toBe(200)
    const texto = await textoDelExcel(excel)
    expect(texto).not.toContain(rechazable.code)
    expect(texto).not.toContain(anulable.code)
    await cholguan.context.close()

    expect(await resumen(rechazable.id)).toEqual(antes)
    expect(await comprasDeNota(rechazable.id), "de otra faena, «Aceptar y enviar a compra» no manda nada a Compras").toEqual([])
  })

  test("6 · exportación: sin sesión 401, sin permiso 403 con su mensaje y con permiso un .xlsx con las notas", async ({ page, playwright }) => {
    expect(rechazable?.id, "depende del paso 0").toBeTruthy()
    const baseURL = test.info().project.use.baseURL
    const anonimo = await playwright.request.newContext({ baseURL })
    // Sin sesión no hay archivo: el proxy de acceso manda a /login (3xx) o la ruta contesta 401; nunca un .xlsx.
    const sinSesion = await anonimo.get("/api/mantencion/notas-pedido/export", { maxRedirects: 0 })
    expect([301, 302, 303, 307, 308, 401], `sin sesión contestó ${sinSesion.status()}`).toContain(sinSesion.status())
    expect(sinSesion.headers()["content-type"] ?? "").not.toContain("spreadsheetml")
    if (sinSesion.status() !== 401) expect(sinSesion.headers()["location"] ?? "").toContain("/login")
    await anonimo.dispose()

    // El mecánico y el supervisor no tienen `mant:np:export`: 403 explícito (no una redirección ni un archivo vacío).
    for (const email of [MECANICO, SUPERVISOR]) {
      await cambiarDeSesion(page, email)
      const respuesta = await page.request.get("/api/mantencion/notas-pedido/export", { maxRedirects: 0 })
      expect(respuesta.status(), `${email} sin permiso de exportar`).toBe(403)
      expect(await respuesta.json()).toMatchObject({ error: expect.stringMatching(/permiso/i) })
    }

    // Jefatura (tiene `mant:np:export`): descarga el Excel desde la bandeja y trae las notas de esta corrida.
    const errores = vigilarConsola(page)
    await cambiarDeSesion(page, JEFE)
    await page.goto("/mantencion/notas-pedido?estado=por_revisar")
    await page.getByRole("button", { name: "Exportar Excel" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    const descarga = page.waitForEvent("download", { timeout: 30_000 })
    await page.getByRole("link", { name: "Descargar" }).click()
    const archivo = await descarga
    expect(archivo.suggestedFilename()).toMatch(/\.xlsx$/)
    expect((await import("node:fs")).statSync((await archivo.path())!).size).toBeGreaterThan(0)

    const todo = await page.request.get("/api/mantencion/notas-pedido/export")
    expect(todo.status()).toBe(200)
    expect(todo.headers()["content-type"]).toContain("spreadsheetml.sheet")
    expect(todo.headers()["content-disposition"]).toMatch(/\.xlsx/)
    const texto = await textoDelExcel(todo)
    expect(texto).toContain(rechazable.code)
    expect(texto).toContain(anulable.code)
    expect(texto).toContain(`QA_NEG Bomba de agua B ${CICLO}`)
    // La pestaña filtra: las anuladas no están entre las que faltan por revisar.
    const pendientes = await textoDelExcel(await page.request.get("/api/mantencion/notas-pedido/export?estado=por_revisar"))
    expect(pendientes).toContain(rechazable.code)
    expect(pendientes).not.toContain(anulable.code)
    // El administrador de contrato de Biodiversa también exporta (de su faena).
    await cambiarDeSesion(page, ADMIN_CONTRATO)
    expect((await page.request.get("/api/mantencion/notas-pedido/export")).status()).toBe(200)
    expect(errores).toEqual([])
  })

  test("7 · jefatura anula con motivo la nota reabierta: la deja anulada, fuera de las por revisar, y sin acciones", async ({ page }) => {
    expect(rechazable?.id, "depende del paso 3").toBeTruthy()
    const errores = vigilarConsola(page)
    await cambiarDeSesion(page, JEFE)
    await page.goto(detalle(rechazable.id))
    await page.getByRole("button", { name: "Anular nota", exact: true }).click()
    const dialogo = page.getByRole("dialog", { name: `Anular ${rechazable.code}` })
    await dialogo.getByLabel("Motivo de la anulación").fill("QA_NEG Cierre de la prueba")
    await dialogo.getByRole("button", { name: "Anular nota", exact: true }).click()
    await esperarEstadoDeNota(rechazable.id, "anulada")
    await expect(page.getByText("Esta nota está anulada")).toBeVisible({ timeout: 30_000 })
    for (const nombre of [ACEPTAR_Y_ENVIAR, "Poner en espera", "Rechazar nota", "Anular nota", "Reabrir"]) {
      await expect(page.getByRole("button", { name: nombre, exact: true })).toHaveCount(0)
    }
    // Una nota anulada sale de «Por revisar» y queda en «Cerradas» (como las notas finales).
    await page.goto("/mantencion/notas-pedido?estado=por_revisar")
    await expect(listRecord(page, rechazable.code)).toHaveCount(0)
    await page.goto("/mantencion/notas-pedido?estado=cerradas")
    await expect(listRecord(page, rechazable.code)).toBeVisible({ timeout: 30_000 })
    expect((await resumen(rechazable.id)).at(-1)).toMatch(/>anulada$/)
    expect(errores).toEqual([])
  })
})
