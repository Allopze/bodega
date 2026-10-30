import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { clearRateLimits, listRecord } from "./helpers"

/**
 * §16 E2E 1–4 · App del mecánico (`/m/mantencion`, PWA sin conexión).
 *
 * Con estado y en orden. Los escenarios 1, 2 y 4 comparten UN teléfono (mismo
 * contexto: el service worker, IndexedDB y la sesión sobreviven entre pruebas,
 * que es justamente lo que se verifica); el 3 usa una tablet aparte.
 *
 * Usuarios (contraseña `chome2026`, fixtures de `e2e/fixtures/mantencion-setup.ts`):
 * `mecanico1@e2e.chome.cl` y `mecanico2@e2e.chome.cl` (Biodiversa) y
 * `jefe.mant@e2e.chome.cl`. Tres equipos de Biodiversa en km quedan «Próximos»
 * (39.900 km → toca la de 40.000): las pruebas toman el primero de «Le toca
 * mantención» y nunca un código fijo.
 *
 * Locators según «Locators in this repository» de AGENTS.md: `getByRole` (ignora lo
 * oculto) y `exact: true` donde un rótulo es prefijo de otro.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(240_000)

const MEC1 = "mecanico1@e2e.chome.cl"
const MEC2 = "mecanico2@e2e.chome.cl"
const JEFE = "jefe.mant@e2e.chome.cl"
const NOMBRE_MEC1 = "Mecánico Uno E2E"
const NOMBRE_MEC2 = "Mecánico Dos E2E"
const PIN_MEC1 = "1111"
const PIN_MEC2 = "2222"
const CAMBIOS_EXPECTED = /ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR_/

/** Errores de consola y de página (§16: la consola de las E2E no debe traer errores). Sin señal el navegador avisa de las cargas que no pudo hacer: no son de la app. */
function vigilarConsola(page: Page): string[] {
  const errores: string[] = []
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error" && !CAMBIOS_EXPECTED.test(mensaje.text()) && !/favicon/i.test(mensaje.text())) errores.push(mensaje.text())
  })
  page.on("pageerror", (error) => errores.push(error.message))
  return errores
}

async function nuevoContexto(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100"
  return browser.newContext({ baseURL, viewport, hasTouch: true, serviceWorkers: "allow" })
}

/** Entra por el login PROPIO de la app (no el de la plataforma), como al abrirla instalada o con «Entrar con otra cuenta». */
async function entrar(page: Page, email: string) {
  await clearRateLimits()
  if (!/\/m\/mantencion\/entrar/.test(page.url())) await page.goto("/m/mantencion/entrar")
  await page.getByLabel("Correo", { exact: true }).fill(email)
  await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await expect(page).toHaveURL(/\/m\/mantencion$/, { timeout: 30_000 })
}

async function teclearPin(page: Page, pin: string) {
  const teclado = page.getByRole("group", { name: "Teclado numérico" })
  for (const digito of pin) await teclado.getByRole("button", { name: digito, exact: true }).click()
}

async function definirPin(page: Page, pin: string) {
  await expect(page.getByRole("heading", { name: "Define tu PIN" })).toBeVisible({ timeout: 30_000 })
  await teclearPin(page, pin)
  await expect(page.getByRole("heading", { name: "Repite tu PIN" })).toBeVisible()
  await teclearPin(page, pin)
  // El saludo también está en la pantalla del PIN: el inicio se reconoce por «Nuevo registro».
  await expect(page.getByRole("region", { name: "Nuevo registro" })).toBeVisible({ timeout: 30_000 })
}

/** El service worker tiene que haber guardado la app y sus archivos ANTES de cortar la señal. */
async function esperarSwListo(page: Page) {
  // Se pregunta por el registro y no por `controller`: si la app se abre por navegación del lado
  // del cliente desde fuera de su alcance, el documento no queda controlado hasta la próxima
  // carga. Lo que importa para abrir sin señal es que el worker esté activo y los cachés llenos.
  await expect.poll(() => page.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration("/m/mantencion")
    return Boolean(registro?.active?.state === "activated")
  }), { timeout: 30_000 }).toBe(true)
  const tamano = (nombre: string) => page.evaluate(async (cache) => (await (await caches.open(cache)).keys()).length, nombre)
  await expect.poll(() => tamano("mant-shell-v2"), { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(() => tamano("mant-static-v2"), { timeout: 30_000 }).toBeGreaterThan(0)
}

/** JPEG pequeño y válido, generado en memoria en el propio navegador (sin archivos ni dependencias). */
async function jpeg(page: Page, rotulo: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const base64 = await page.evaluate((texto) => {
    const lienzo = document.createElement("canvas")
    lienzo.width = 640
    lienzo.height = 480
    const contexto = lienzo.getContext("2d")
    if (!contexto) return ""
    contexto.fillStyle = "#cfd6d2"
    contexto.fillRect(0, 0, 640, 480)
    contexto.fillStyle = "#1d1d1b"
    contexto.font = "32px sans-serif"
    contexto.fillText(texto, 30, 80)
    return lienzo.toDataURL("image/jpeg", 0.8).split(",")[1] ?? ""
  }, rotulo)
  return { name: `${rotulo.replace(/\W+/g, "-")}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") }
}

/** Última lectura que muestra el paso «Lectura» (número sin puntos). */
async function ultimaLectura(page: Page): Promise<number> {
  const texto = await page.getByText(/Última lectura registrada: [\d.]+ (km|h)/).innerText()
  return Number(/registrada: ([\d.]+)/.exec(texto)?.[1]?.replace(/\./g, "") ?? "0")
}

const campoLectura = (page: Page) => page.getByLabel(/Odómetro actual|Horómetro actual/)

/** Correctiva completa. Con `fotos` 1–3. Devuelve el código del equipo. Deja la pantalla en «Registro guardado». */
async function registrarCorrectiva(page: Page, opciones: { indice?: number; descripcion: string; fotos?: number; enTaller?: boolean; sumarLectura?: number; antesDeLaLectura?: () => Promise<void> }): Promise<string> {
  await page.getByRole("button", { name: /^Mantención correctiva/ }).click()
  await expect(page.getByRole("heading", { name: "¿Qué equipo vas a mantener?" })).toBeVisible()
  const fila = page.getByRole("group", { name: "Equipos", exact: true }).getByRole("button").nth(opciones.indice ?? 0)
  const codigo = ((await fila.innerText()).split("\n")[0] ?? "").split(" · ")[0] ?? ""
  await fila.click()
  await page.getByRole("button", { name: `Continuar con ${codigo}`, exact: true }).click()

  const ultima = await ultimaLectura(page)
  await campoLectura(page).fill(String(ultima + (opciones.sumarLectura ?? 50)))
  await page.getByRole("button", { name: "Continuar", exact: true }).click()
  await opciones.antesDeLaLectura?.()

  // Un trabajo del primer tipo del catálogo: sus horas (por defecto 1 h) y «No se usaron repuestos» van dentro de su tarjeta.
  await page.getByRole("group", { name: "Agregar trabajo" }).getByRole("button").first().click()
  await expect(page.getByText(/^Total: /)).toBeVisible()
  await page.getByRole("button", { name: "No se cambió aceite", exact: true }).click()
  await page.getByLabel("Trabajo realizado").fill(opciones.descripcion)
  await page.getByRole("checkbox", { name: "No se usaron repuestos" }).check()
  await page.getByLabel(/Conductores de las últimas 24 h/).fill("a")
  await page.getByRole("group", { name: "Conductores encontrados" }).getByRole("button").first().click()
  // «¿Sigue en taller?» cierra el paso «Trabajo»; con «Sí» pide el motivo.
  await page.getByRole("button", { name: opciones.enTaller === false ? "No, ya salió" : "Sí, sigue", exact: true }).click()
  if (opciones.enTaller !== false) await page.getByLabel("¿Por qué sigue en taller?").fill("QA_ Espera un repuesto")
  await page.getByRole("button", { name: "Continuar a fotos", exact: true }).click()

  // Las fotos tienen su propio paso (4/5), a todo el ancho como las de la preventiva.
  await expect(page.getByText("PASO 4/5")).toBeVisible()
  const cantidad = opciones.fotos ?? 1
  for (let n = 1; n <= cantidad; n++) {
    await page.getByLabel("Agregar foto del trabajo").setInputFiles(await jpeg(page, `${codigo} foto ${n}`))
    await expect(page.getByRole("img", { name: `Foto ${n} del trabajo` })).toBeVisible()
  }
  await page.getByRole("button", { name: "Revisar registro", exact: true }).click()
  await page.getByRole("button", { name: "Firmar y guardar", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Registro guardado" })).toBeVisible()
  return codigo
}

const resumen = (page: Page) => page.getByRole("region", { name: "Mis últimos registros" })

test.describe("App del mecánico", () => {
  let telefono: BrowserContext
  let pagina: Page
  let errores: string[]
  let codigoPreventiva = ""
  let folioPreventiva = ""
  let codigoCorrectiva = ""
  const respuestasRegistro: Array<{ id: string; estado: number }> = []

  test.beforeAll(async ({ browser }) => {
    telefono = await nuevoContexto(browser, { width: 390, height: 844 })
    pagina = await telefono.newPage()
    errores = vigilarConsola(pagina)
    pagina.on("response", async (respuesta) => {
      if (!/\/api\/mantencion\/sync\/registros$/.test(respuesta.url()) || respuesta.request().method() !== "POST") return
      const id = (respuesta.request().postDataJSON() as { id?: string } | null)?.id ?? ""
      respuestasRegistro.push({ id, estado: respuesta.status() })
    })
  })
  test.afterAll(async () => { await telefono.close() })

  test("0 · la app es aparte: sin sesión abre su propio login, no el de la plataforma", async () => {
    await pagina.goto("/m/mantencion")
    await expect(pagina).toHaveURL(/\/m\/mantencion\/entrar/)
    await expect(pagina.getByRole("heading", { name: "Entrar", level: 1 })).toBeVisible()
    await expect(pagina.getByRole("heading", { name: /Iniciar sesión/ })).toHaveCount(0)
    // El manifest de la app (no el de la plataforma) es el que el teléfono instala.
    await expect(pagina.locator('link[rel="manifest"]')).toHaveAttribute("href", "/mant-manifest.json")

    // Si el navegador la ofrece como instalable (Chrome en Android), la app invita a instalarla y
    // el botón abre el diálogo nativo. El evento se simula: Playwright no lo emite solo.
    await pagina.evaluate(() => {
      const evento = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => { (window as unknown as { __instalada?: boolean }).__instalada = true },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      })
      window.dispatchEvent(evento)
    })
    const invitacion = pagina.getByRole("region", { name: "Instala la app en tu teléfono" })
    await expect(invitacion).toBeVisible()
    await invitacion.getByRole("button", { name: "Instalar app", exact: true }).click()
    await expect.poll(() => pagina.evaluate(() => (window as unknown as { __instalada?: boolean }).__instalada === true)).toBe(true)
    await expect(invitacion).toHaveCount(0)
  })

  test("0b · en iPhone, abierta en Safari, la app muestra cómo agregarla a inicio", async ({ browser }) => {
    const iphone = await browser.newContext({
      baseURL: test.info().project.use.baseURL ?? "http://localhost:3100",
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    })
    try {
      const telefonoIos = await iphone.newPage()
      await telefonoIos.goto("/m/mantencion")
      const pasos = telefonoIos.getByRole("region", { name: "Instala la app en tu iPhone" })
      await expect(pasos).toBeVisible()
      await expect(pasos.getByText("Agregar a inicio")).toBeVisible()
      await pasos.getByRole("button", { name: "Ahora no", exact: true }).click()
      await expect(pasos).toHaveCount(0)
    } finally {
      await iphone.close()
    }
  })

  test("1 · con señal: desde «Le toca mantención», «Todo realizado» por sistema, una excepción con motivo, «Cambiar», firmar y folio", async () => {
    await entrar(pagina, MEC1)
    await definirPin(pagina, PIN_MEC1)
    await esperarSwListo(pagina)

    const toca = pagina.getByRole("region", { name: "Le toca mantención" })
    const primero = toca.getByRole("button").first()
    await expect(primero).toBeVisible({ timeout: 30_000 })
    codigoPreventiva = ((await primero.innerText()).split("\n")[0] ?? "").split(" · ")[0] ?? ""
    expect(codigoPreventiva).not.toBe("")
    await primero.click()

    // Entra directo al paso 2 con el equipo ya elegido.
    await expect(pagina.getByText("PASO 2/5")).toBeVisible()
    const ultima = await ultimaLectura(pagina)
    await campoLectura(pagina).fill(String(ultima + 110))
    await expect(pagina.getByText(/toca la de 40\.000 km/)).toBeVisible()
    await pagina.getByRole("button", { name: "Ver pauta", exact: true }).click()

    // Pauta: «Todo realizado» y «Listo · seguir con …», sistema por sistema.
    // «Continuar» no se bloquea: con ítems sin marcar valida al tocarlo, dice cuántos faltan y se queda en la pauta.
    await pagina.getByRole("button", { name: "Continuar a fotos", exact: true }).click()
    await expect(pagina.getByRole("alert").filter({ hasText: /^Faltan \d+ ítems por marcar\.$/ })).toBeVisible()
    await expect(pagina.getByText("PASO 3/5")).toBeVisible()
    for (let vuelta = 0; vuelta < 12; vuelta++) {
      const todo = pagina.getByRole("button", { name: /^(Todo realizado en|Marcar los \d+ que faltan)/ })
      if (!(await todo.count())) break
      await todo.first().click()
      if (vuelta === 0) {
        // Corregir una excepción con motivo: el sistema deja de estar completo hasta que se explica.
        const primerItem = pagina.locator(".tri").first()
        await primerItem.getByRole("button", { name: "No realizado", exact: true }).click()
        await expect(pagina.getByRole("button", { name: /^Listo · / })).toHaveCount(0)
        await pagina.getByRole("button", { name: "Falta repuesto", exact: true }).click()
      }
      await pagina.getByRole("button", { name: /^Listo · / }).click()
    }
    await expect(pagina.getByText("Pauta completa.")).toBeVisible()
    await pagina.getByRole("button", { name: "Continuar a fotos", exact: true }).click()

    await pagina.getByLabel("Tomar foto de Filtros usados").setInputFiles(await jpeg(pagina, "Filtros"))
    await expect(pagina.getByRole("img", { name: "Foto: Filtros usados" })).toBeVisible()
    await pagina.getByLabel("Tomar foto de Sticker de mantención realizada").setInputFiles(await jpeg(pagina, "Sticker"))
    await expect(pagina.getByRole("img", { name: "Foto: Sticker de mantención realizada" })).toBeVisible()
    // Las notas son obligatorias: «Revisar registro» valida al tocarlo y «Sin novedad» las llena de un toque.
    await pagina.getByRole("button", { name: "Revisar registro", exact: true }).click()
    await expect(pagina.getByText("Escribe tus notas, o toca «Sin novedad» si no hay nada que anotar.")).toBeVisible()
    await pagina.getByRole("button", { name: "Sin novedad", exact: true }).click()
    await expect(pagina.getByLabel(/^Notas/)).toHaveValue("Sin novedad")
    await pagina.getByRole("button", { name: "Revisar registro", exact: true }).click()

    // «Cambiar» lleva al paso y vuelve DIRECTO a Revisar.
    await expect(pagina.getByText(`Firmas como ${NOMBRE_MEC1}.`)).toBeVisible()
    await pagina.getByRole("button", { name: "Cambiar notas", exact: true }).click()
    await expect(pagina.getByText("PASO 4/5")).toBeVisible()
    await pagina.getByLabel(/^Notas/).fill("Sin novedad. Se cambió el sticker.")
    await pagina.getByRole("button", { name: "Volver a revisar", exact: true }).click()
    await expect(pagina.getByRole("button", { name: "Firmar y guardar", exact: true })).toBeVisible()
    await expect(pagina.getByText("Sin novedad. Se cambió el sticker.")).toBeVisible()

    await pagina.getByRole("button", { name: "Firmar y guardar", exact: true }).click()
    await expect(pagina.getByRole("heading", { name: "Registro guardado" })).toBeVisible()
    await expect(pagina.getByText("Ya llegó a la plataforma.")).toBeVisible({ timeout: 60_000 })
    const linea = await pagina.getByText(new RegExp(`^MP-BIO-\\d{4} · ${codigoPreventiva}$`)).innerText()
    folioPreventiva = linea.split(" · ")[0] ?? ""
    expect(folioPreventiva).toMatch(/^MP-BIO-\d{4}$/)

    await pagina.getByRole("button", { name: "Volver al inicio", exact: true }).click()
    await expect(resumen(pagina).getByText(folioPreventiva)).toBeVisible()
    expect(errores).toEqual([])
  })

  test("2 · sin conexión: correctiva con 3 fotos y actualización de taller; recargar; al volver la señal se sincroniza sin duplicados", async () => {
    await pagina.getByRole("button", { name: "Actualizar", exact: true }).click().catch(() => {})
    await esperarSwListo(pagina)
    await telefono.setOffline(true)

    codigoCorrectiva = await registrarCorrectiva(pagina, { descripcion: "QA_ Cambio de manguera sin señal", fotos: 3, enTaller: true })
    await expect(pagina.getByText("Folio pendiente · " + codigoCorrectiva)).toBeVisible()
    await expect(pagina.getByText(/Está guardado en el teléfono\. Se enviará solo/)).toBeVisible()
    await pagina.getByRole("button", { name: "Volver al inicio", exact: true }).click()

    // El equipo en taller aparece sin esperar al servidor y se puede actualizar.
    const taller = pagina.getByRole("region", { name: /^Equipos? en taller$/ })
    await expect(taller.getByText(codigoCorrectiva)).toBeVisible()
    await taller.getByRole("button", { name: `Actualizar estado de ${codigoCorrectiva}` }).click()
    const hoja = pagina.getByRole("dialog", { name: "Estado del equipo" })
    await hoja.getByRole("button", { name: "Sigue en taller", exact: true }).click()
    await hoja.getByLabel("¿Por qué aún no sale?").fill("Esperando repuesto")
    await hoja.getByRole("button", { name: "Guardar estado", exact: true }).click()
    await expect(pagina.getByText("Estado guardado en el teléfono.")).toBeVisible()

    // Recargar sin señal: la app abre desde el caché y no se perdió nada.
    await pagina.reload()
    await expect(pagina.getByRole("heading", { name: /^Hola, / })).toBeVisible({ timeout: 30_000 })
    await expect(resumen(pagina).getByText("Folio pendiente")).toBeVisible()
    await expect(resumen(pagina).getByText("En el teléfono")).toBeVisible()
    await expect(pagina.getByRole("region", { name: /^Equipos? en taller$/ }).getByText(codigoCorrectiva)).toBeVisible()
    await expect(pagina.getByText(/Sin señal · 2 registros guardados|Sin señal · 1 registro guardado/)).toBeVisible()

    // Vuelve la señal: se envía solo, una sola vez.
    await telefono.setOffline(false)
    await expect(resumen(pagina).getByText(/MC-BIO-\d{4}/)).toBeVisible({ timeout: 90_000 })
    await expect(resumen(pagina).getByText("Folio pendiente")).toHaveCount(0)
    await expect(pagina.getByText(/Sin señal/)).toHaveCount(0)
    await pagina.reload()
    await expect(resumen(pagina).getByText(/MC-BIO-\d{4}/)).toHaveCount(1)
    const enviados = respuestasRegistro.filter((respuesta) => respuesta.estado === 200)
    const ids = enviados.map((respuesta) => respuesta.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(errores).toEqual([])
  })

  test("4 · salto de lectura: pide confirmar con la pregunta, y la jefatura lo ve como alerta", async ({ browser }) => {
    await pagina.getByRole("button", { name: /^Mantención correctiva/ }).click()
    const fila = pagina.getByRole("group", { name: "Equipos", exact: true }).getByRole("button").first()
    const codigo = ((await fila.innerText()).split("\n")[0] ?? "").split(" · ")[0] ?? ""
    await fila.click()
    await pagina.getByRole("button", { name: `Continuar con ${codigo}`, exact: true }).click()
    const ultima = await ultimaLectura(pagina)
    await campoLectura(pagina).fill(String(ultima + 363_000))
    await pagina.getByRole("button", { name: "Continuar", exact: true }).click()

    const aviso = pagina.getByRole("alert").filter({ hasText: "Son 363.000 km más que la última vez. ¿Está bien?" })
    await expect(aviso).toBeVisible()
    await expect(pagina.getByText("PASO 2/5")).toBeVisible() // no avanzó sin confirmar
    await aviso.getByRole("button", { name: "Sí, está bien", exact: true }).click()
    await expect(pagina.getByText("PASO 3/5")).toBeVisible()

    // Mismo orden que `registrarCorrectiva`: trabajos con sus repuestos y «¿sigue en taller?»; después, las fotos en su paso.
    await pagina.getByRole("group", { name: "Agregar trabajo" }).getByRole("button").first().click()
    await pagina.getByRole("button", { name: "No se cambió aceite", exact: true }).click()
    await pagina.getByLabel("Trabajo realizado").fill("QA_ Lectura con salto confirmado")
    await pagina.getByRole("checkbox", { name: "No se usaron repuestos" }).check()
    await pagina.getByLabel(/Conductores de las últimas 24 h/).fill("a")
    await pagina.getByRole("group", { name: "Conductores encontrados" }).getByRole("button").first().click()
    await pagina.getByRole("button", { name: "No, ya salió", exact: true }).click()
    await pagina.getByRole("button", { name: "Continuar a fotos", exact: true }).click()
    await pagina.getByLabel("Agregar foto del trabajo").setInputFiles(await jpeg(pagina, `${codigo} salto`))
    await expect(pagina.getByRole("img", { name: "Foto 1 del trabajo" })).toBeVisible()
    await pagina.getByRole("button", { name: "Revisar registro", exact: true }).click()
    await pagina.getByRole("button", { name: "Firmar y guardar", exact: true }).click()
    await expect(pagina.getByText("Ya llegó a la plataforma.")).toBeVisible({ timeout: 60_000 })
    const folio = ((await pagina.getByText(/^MC-BIO-\d{4} · /).innerText()).split(" · ")[0]) ?? ""

    // Jefatura: el registro llega con la alerta de salto de lectura (el servidor la recalcula).
    const jefatura = await nuevoContexto(browser, { width: 1366, height: 900 })
    try {
      const paginaJefe = await jefatura.newPage()
      await entrar(paginaJefe, JEFE).catch(async () => {
        // El login de jefatura vuelve a la app (callbackUrl): basta con que haya sesión.
      })
      await paginaJefe.goto("/mantencion/registros")
      await expect(listRecord(paginaJefe, folio).first()).toBeVisible({ timeout: 30_000 })
      await listRecord(paginaJefe, folio).first().getByRole("link", { name: folio }).click()
      await expect(paginaJefe.getByText(/salto de lectura/i).first()).toBeVisible()
    } finally {
      await jefatura.close()
    }
    expect(errores).toEqual([])
  })
})

test.describe("Salir de un registro", () => {
  test.describe.configure({ mode: "serial" })

  test("5 · salir guarda el avance (sobrevive a recargar) y descartar es una acción aparte", async ({ browser }) => {
    const telefono = await nuevoContexto(browser, { width: 390, height: 844 })
    const pagina = await telefono.newPage()
    const errores = vigilarConsola(pagina)
    try {
      // Teléfono propio (contexto nuevo): entra una vez con señal y define su PIN, como al instalarla.
      await entrar(pagina, MEC1)
      await definirPin(pagina, PIN_MEC1)

      await pagina.getByRole("button", { name: /^Mantención correctiva/ }).click()
      const fila = pagina.getByRole("group", { name: "Equipos", exact: true }).getByRole("button").first()
      const codigo = ((await fila.innerText()).split("\n")[0] ?? "").split(" · ")[0] ?? ""
      await fila.click()
      await pagina.getByRole("button", { name: `Continuar con ${codigo}`, exact: true }).click()
      await expect(pagina.getByText("PASO 2/5")).toBeVisible()

      // «Salir» está en la barra de arriba en cada paso; el diálogo conserva por defecto.
      await pagina.getByRole("button", { name: "Salir del registro", exact: true }).click()
      const dialogo = pagina.getByRole("alertdialog", { name: "¿Salir del registro?" })
      await expect(dialogo.getByText(/Tu avance queda guardado en este teléfono/)).toBeVisible()
      await expect(dialogo.getByRole("button", { name: "Guardar y salir", exact: true })).toBeFocused()
      await dialogo.getByRole("button", { name: "Seguir registrando", exact: true }).click()
      await expect(dialogo).toHaveCount(0)
      await expect(pagina.getByText("PASO 2/5")).toBeVisible()

      await pagina.getByRole("button", { name: "Salir del registro", exact: true }).click()
      await dialogo.getByRole("button", { name: "Guardar y salir", exact: true }).click()
      const borradores = pagina.getByRole("region", { name: "Registros sin terminar" })
      await expect(borradores.getByText(new RegExp(`^Correctiva sin terminar · ${codigo}`))).toBeVisible()

      // El borrador sobrevive a recargar y «Seguir» lo abre en el mismo paso.
      await pagina.reload()
      await expect(borradores.getByText(new RegExp(`^Correctiva sin terminar · ${codigo}`))).toBeVisible({ timeout: 30_000 })
      await borradores.getByRole("button", { name: /^Seguir Correctiva sin terminar/ }).click()
      await expect(pagina.getByText("PASO 2/5")).toBeVisible()

      // Descartar es la única forma de perderlo.
      await pagina.getByRole("button", { name: "Salir del registro", exact: true }).click()
      await dialogo.getByRole("button", { name: "Descartar registro", exact: true }).click()
      await expect(pagina.getByRole("region", { name: "Nuevo registro" })).toBeVisible()
      await expect(borradores).toHaveCount(0)
      expect(errores).toEqual([])
    } finally {
      await telefono.close()
    }
  })
})

test.describe("Tablet compartida", () => {
  test("3 · dos mecánicos sin señal con cambio de cuenta por PIN: cada registro llega con su autor", async ({ browser }) => {
    const tablet = await nuevoContexto(browser, { width: 820, height: 1180 })
    const pagina = await tablet.newPage()
    const errores = vigilarConsola(pagina)
    try {
      // Cada uno entra UNA vez con señal y define su PIN.
      await entrar(pagina, MEC1)
      await definirPin(pagina, PIN_MEC1)
      await pagina.getByRole("button", { name: /^Cuenta de .*Cambiar de cuenta/ }).click()
      await pagina.getByRole("button", { name: "Entrar con otra cuenta", exact: true }).click()
      await expect(pagina).toHaveURL(/\/m\/mantencion\/entrar/, { timeout: 30_000 })
      await entrar(pagina, MEC2)
      await definirPin(pagina, PIN_MEC2)
      await esperarSwListo(pagina)

      // Sin señal: mecánico 2 registra, cambia a mecánico 1 con su PIN y registra el suyo.
      await tablet.setOffline(true)
      await registrarCorrectiva(pagina, { indice: 1, descripcion: "QA_ Tablet mecánico dos", fotos: 1, enTaller: false })
      await pagina.getByRole("button", { name: "Volver al inicio", exact: true }).click()

      await pagina.getByRole("button", { name: /^Cuenta de .*Cambiar de cuenta/ }).click()
      await pagina.getByRole("button", { name: new RegExp(NOMBRE_MEC1) }).click()
      await teclearPin(pagina, "9999") // PIN equivocado: no entra
      await expect(pagina.getByText(/PIN incorrecto\. Te quedan 4 intentos\./)).toBeVisible()
      await teclearPin(pagina, PIN_MEC1)
      await expect(pagina.getByText(`Ahora registras como ${NOMBRE_MEC1}.`)).toBeVisible()
      await registrarCorrectiva(pagina, { indice: 0, descripcion: "QA_ Tablet mecánico uno", fotos: 1, enTaller: false })
      await pagina.getByRole("button", { name: "Volver al inicio", exact: true }).click()
      await expect(resumen(pagina).getByText("Folio pendiente")).toHaveCount(1)

      // Vuelve la señal: la cola se envía sola, cada elemento con la credencial de SU autor.
      await tablet.setOffline(false)
      // El mecánico 1 ya traía la correctiva del escenario 2: su registro nuevo es el folio más alto.
      await expect(resumen(pagina).getByText("Folio pendiente")).toHaveCount(0, { timeout: 90_000 })
      const foliosUno = (await resumen(pagina).getByText(/MC-BIO-\d{4}/).allInnerTexts()).map((texto) => texto.match(/MC-BIO-\d{4}/)?.[0] ?? "")
      expect(foliosUno.length).toBeGreaterThanOrEqual(2)
      const folioUno = foliosUno.sort().at(-1) ?? ""

      await pagina.getByRole("button", { name: /^Cuenta de .*Cambiar de cuenta/ }).click()
      await pagina.getByRole("button", { name: new RegExp(NOMBRE_MEC2) }).click()
      await teclearPin(pagina, PIN_MEC2)
      await expect(pagina.getByText(`Ahora registras como ${NOMBRE_MEC2}.`)).toBeVisible()
      await expect(resumen(pagina).getByText(/MC-BIO-\d{4}/)).toBeVisible({ timeout: 60_000 })
      await expect(resumen(pagina).getByText(/MC-BIO-\d{4}/)).toHaveCount(1)
      const folioDos = (await resumen(pagina).getByText(/MC-BIO-\d{4}/).first().innerText()).trim()
      // Lo que el servidor atribuye a cada cuenta es SU registro (el catálogo trae sólo los del autor).
      expect(folioUno.match(/MC-BIO-\d{4}/)?.[0]).not.toBe(folioDos.match(/MC-BIO-\d{4}/)?.[0])
      expect(errores).toEqual([])
    } finally {
      await tablet.close()
    }
  })
})
