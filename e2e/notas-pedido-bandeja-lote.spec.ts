import { expect, test, type Page } from "@playwright/test"
import { listRecord, textoVisible } from "./helpers"
import { JEFE, entrarPlataforma, vigilarConsola } from "./notas-pedido-helpers"
import { comprasDeNota, decisionesDeSolicitud, escapar, esperarEstadoDeNota, eventosDeNota, notaPorId } from "./notas-pedido-ciclo-helpers"
import {
  CORRIDA_LOTE, PESTANAS, PREFIJO_LOTE, idsBase, leerPestanas, limpiarNotasLote, motivosDeRechazo, pestanas, sembrarNota,
  type ConteoPestanas, type IdsBase, type NotaSembrada, type Pestana,
} from "./notas-pedido-bandeja-helpers"

/**
 * Bandeja de notas de pedido de punta a punta (ADR mantención 0001, D30 a D34 y puntos 3 y 4 de la fase 2), con la interfaz real y
 * sólo en escritorio (el chip «N urgentes» vive en la barra superior, de xl para arriba):
 *
 *   1  las pestañas «Por revisar», «En compra», «En recepción» y «Cerradas» cuentan y listan cada nota en UNA sola;
 *   2  elegir líneas de DOS notas con las casillas y «Enviar a compra» desde la barra al pie: el aviso trae los enlaces a las
 *      solicitudes, las notas pasan a «En compra» y en la base las solicitudes nacieron APROBADAS (decisión de jefatura);
 *   3  «Rechazar» en lote exige un motivo (diálogo) y deja la nota en «Cerradas», rechazada;
 *   4  el gráfico de antigüedad es el selector del filtro: pulsar un tramo recorta la bandeja y pulsarlo otra vez la deja como estaba;
 *   5  el chip «N urgentes» lleva a las urgentes y, activo, es la salida.
 *
 * Con estado y en orden, pero autocontenida: siembra sus notas por SQL (código `QA_LOTE-<corrida>-NP-nnnn`), las acota con la
 * búsqueda de la bandeja (`?q=`) para no depender de lo que dejaron las otras specs, y al terminar borra lo suyo, solicitudes incluidas.
 * Usuarios de `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`).
 *
 * Locators según «Locators in this repository» de qa/AGENTS.md: `getByRole` (ignora lo oculto) y `exact: true`.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(240_000)

const BANDEJA = "/mantencion/notas-pedido"
/** La bandeja acotada a las notas de esta corrida: sus conteos, sus tramos de antigüedad y su lista son exactos. */
const MIAS = (estado: string) => `${BANDEJA}?estado=${estado}&q=${PREFIJO_LOTE}`

type Clave = "a" | "b" | "c" | "urgente" | "antigua" | "recibida" | "cerrada"

test.describe("Bandeja de notas de pedido · pestañas, lote, antigüedad y urgentes", () => {
  let base: IdsBase
  const notas = {} as Record<Clave, NotaSembrada>
  const descripcion = (texto: string) => `QA_LOTE ${CORRIDA_LOTE} ${texto}`

  const filaDe = (page: Page, nota: NotaSembrada) => listRecord(page, nota.code)
  const barra = (page: Page) => page.getByRole("region", { name: "Acciones sobre las líneas elegidas", exact: true })
  const pestana = (page: Page, nombre: Pestana) => pestanas(page).getByRole("link", { name: new RegExp(`^${nombre}\\s+\\d+$`) })

  async function abrirBandeja(page: Page, estado = "por_revisar") {
    await entrarPlataforma(page, JEFE)
    await page.goto(MIAS(estado))
    await expect(pestanas(page)).toBeVisible({ timeout: 30_000 })
  }

  test.afterAll(async () => {
    await limpiarNotasLote()
  })

  // ── 1 · Pestañas con sus conteos ───────────────────────────────────────────────────────────────

  test("1 · las cuatro pestañas cuentan y listan cada nota en una sola, por el recorrido de la compra", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrarPlataforma(page, JEFE)
    await page.goto(BANDEJA)
    // Sin pestaña en la URL, jefatura abre donde está su trabajo y la pestaña activa queda marcada.
    await expect(page).toHaveURL(/estado=por_revisar/, { timeout: 30_000 })
    await expect(pestana(page, "Por revisar")).toHaveAttribute("aria-current", "page")
    const antes: ConteoPestanas = await leerPestanas(page)

    base = await idsBase()
    // Cinco por revisar (tres con dos líneas; la urgente y la antigua, con una), una recibida en parte y una cerrada.
    notas.a = await sembrarNota(base, { numero: 1, estado: "enviada", lineas: [descripcion("Filtro de aire A1"), descripcion("Filtro de aire A2")] })
    notas.b = await sembrarNota(base, { numero: 2, estado: "enviada", lineas: [descripcion("Manguera B1"), descripcion("Manguera B2")] })
    notas.c = await sembrarNota(base, { numero: 3, estado: "enviada", lineas: [descripcion("Sello C1"), descripcion("Sello C2")] })
    notas.urgente = await sembrarNota(base, { numero: 4, estado: "enviada", lineas: [descripcion("Bomba urgente")], urgente: true })
    notas.antigua = await sembrarNota(base, { numero: 5, estado: "enviada", lineas: [descripcion("Correa antigua")], diasEnElEstado: 20 })
    notas.recibida = await sembrarNota(base, { numero: 6, estado: "recibida_parcial", lineas: [descripcion("Cañería recibida")], diasEnElEstado: 3 })
    notas.cerrada = await sembrarNota(base, { numero: 7, estado: "cerrada", lineas: [descripcion("Perno cerrado")], diasEnElEstado: 5 })

    // Los contadores de las pestañas suben exactamente lo sembrado (la antigua y las demás por revisar, la recibida en recepción, la cerrada).
    await page.reload()
    const despues = await leerPestanas(page)
    expect(despues).toEqual({
      "Por revisar": antes["Por revisar"] + 5, "En compra": antes["En compra"], "En recepción": antes["En recepción"] + 1, "Cerradas": antes["Cerradas"] + 1,
    })

    // Acotada a esta corrida: cada pestaña dice cuántas son suyas y lista cada nota donde corresponde, y en ninguna otra.
    await page.goto(MIAS("por_revisar"))
    await expect.poll(() => leerPestanas(page), { timeout: 30_000 }).toEqual({ "Por revisar": 5, "En compra": 0, "En recepción": 1, "Cerradas": 1 })
    const dondeEsta: Record<Pestana, Clave[]> = {
      "Por revisar": ["a", "b", "c", "urgente", "antigua"], "En compra": [], "En recepción": ["recibida"], "Cerradas": ["cerrada"],
    }
    for (const nombre of PESTANAS) {
      await pestana(page, nombre).click()
      await expect(pestana(page, nombre)).toHaveAttribute("aria-current", "page", { timeout: 30_000 })
      for (const clave of Object.keys(notas) as Clave[]) {
        const aqui = dondeEsta[nombre].includes(clave)
        if (aqui) await expect(filaDe(page, notas[clave]), `«${nombre}» lista ${notas[clave].code}`).toBeVisible({ timeout: 30_000 })
        else await expect(filaDe(page, notas[clave]), `«${nombre}» no lista ${notas[clave].code}`).toHaveCount(0)
      }
    }
    // La nota recibida en parte se ve con su estado; la cerrada, también.
    await expect(filaDe(page, notas.cerrada)).toContainText("Cerrada")
    await pestana(page, "En recepción").click()
    await expect(filaDe(page, notas.recibida)).toContainText("Recibida parcial")
    expect(errores).toEqual([])
  })

  // ── 2 · Enviar a compra en lote ────────────────────────────────────────────────────────────────

  test("2 · elegir líneas de dos notas y «Enviar a compra» desde la barra crea una solicitud aprobada por nota", async ({ page }) => {
    expect(notas.a?.id, "depende del paso 1").toBeTruthy()
    const errores = vigilarConsola(page)
    await abrirBandeja(page)
    await expect(barra(page)).toHaveCount(0)

    // La casilla de la nota elige todas sus líneas; desplegada la otra, se eligen una por una.
    await page.getByRole("checkbox", { name: `Elegir las 2 líneas pendientes de ${notas.a.code}`, exact: true }).check()
    await expect(barra(page)).toContainText("2 líneas de 1 nota")
    await page.getByRole("button", { name: `Ver las líneas pendientes de ${notas.b.code}`, exact: true }).click()
    const lineasB = page.getByRole("list", { name: `Líneas pendientes de ${notas.b.code}`, exact: true })
    for (const linea of notas.b.lineas) await lineasB.getByRole("checkbox", { name: new RegExp(`^${escapar(linea)}`) }).check()
    await expect(barra(page)).toContainText("4 líneas de 2 notas")
    // Sin OT no hay stock que sacar: la barra ofrece comprar y rechazar, y «Sacar de bodega» queda apagado con su motivo.
    await expect(barra(page).getByRole("button", { name: "Sacar de bodega", exact: true })).toBeDisabled()
    expect(await notaPorId(notas.a.id)).toMatchObject({ status: "enviada" })

    await barra(page).getByRole("button", { name: "Enviar a compra", exact: true }).click()

    // El aviso cuenta lo que salió y enlaza cada solicitud creada (una por nota), ya aprobadas.
    await expect(barra(page).getByText("4 líneas enviadas a compra.", { exact: true })).toBeVisible({ timeout: 60_000 })
    await esperarEstadoDeNota(notas.a.id, "en_compra")
    await esperarEstadoDeNota(notas.b.id, "en_compra")
    const comprasA = await comprasDeNota(notas.a.id)
    const comprasB = await comprasDeNota(notas.b.id)
    expect(comprasA).toHaveLength(2)
    expect(comprasB).toHaveLength(2)
    const solicitudA = comprasA[0]!
    const solicitudB = comprasB[0]!
    expect(solicitudA.requestId, "una solicitud por nota").not.toBe(solicitudB.requestId)
    for (const solicitud of [solicitudA, solicitudB]) {
      await expect(barra(page).getByRole("link", { name: solicitud.requestCode, exact: true })).toHaveAttribute("href", `/solicitudes/${solicitud.requestId}`)
    }
    await expect(barra(page).getByText("Solicitudes creadas:")).toContainText(/\(aprobada\), .*\(aprobada\)$/)

    // En la base nacieron aprobadas: la decisión de jefatura reemplaza a Aprobaciones, a nombre de quien las envió.
    for (const [nota, compras] of [[notas.a, comprasA], [notas.b, comprasB]] as const) {
      expect(new Set(compras.map((compra) => compra.requestId)).size).toBe(1)
      expect(compras.map((compra) => compra.noteItemId)).toEqual(nota.lineIds)
      expect(compras.map((compra) => compra.status)).toEqual(["approved", "approved"])
      expect(compras[0]).toMatchObject({ requestStatus: "approved", requestType: "repuestos", worksiteId: base.faenaId, workOrderId: null })
      expect(await decisionesDeSolicitud(compras[0]!.requestId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "approve", roleContext: "mantencion_np", decidedBy: JEFE }),
      ]))
      expect((await notaPorId(nota.id))!.lines.map((linea) => linea.resolution)).toEqual(["en_compra", "en_compra"])
      expect((await eventosDeNota(nota.id)).at(-1)).toMatchObject({ kind: "transicion", to: "en_compra" })
    }

    // Las dos notas salieron de «Por revisar» y están en «En compra» (esperan su orden de compra).
    await expect(filaDe(page, notas.a)).toHaveCount(0, { timeout: 30_000 })
    await expect(filaDe(page, notas.b)).toHaveCount(0)
    await expect.poll(() => leerPestanas(page), { timeout: 30_000 }).toEqual({ "Por revisar": 3, "En compra": 2, "En recepción": 1, "Cerradas": 1 })
    await pestana(page, "En compra").click()
    await expect(pestana(page, "En compra")).toHaveAttribute("aria-current", "page", { timeout: 30_000 })
    for (const nota of [notas.a, notas.b]) {
      await expect(filaDe(page, nota)).toBeVisible({ timeout: 30_000 })
      await expect(filaDe(page, nota)).toContainText("En compra")
    }
    expect(errores).toEqual([])
  })

  // ── 3 · Rechazar en lote exige motivo ──────────────────────────────────────────────────────────

  test("3 · rechazar en lote exige un motivo y deja la nota en «Cerradas», rechazada", async ({ page }) => {
    expect(notas.c?.id, "depende del paso 1").toBeTruthy()
    const errores = vigilarConsola(page)
    await abrirBandeja(page)
    await page.getByRole("checkbox", { name: `Elegir las 2 líneas pendientes de ${notas.c.code}`, exact: true }).check()
    await expect(barra(page)).toContainText("2 líneas de 1 nota")

    await barra(page).getByRole("button", { name: "Rechazar", exact: true }).click()
    const dialogo = page.getByRole("dialog", { name: "Rechazar las líneas", exact: true })
    await expect(dialogo).toBeVisible()
    const confirmar = dialogo.getByRole("button", { name: "Rechazar", exact: true })
    // Sin motivo, o con uno de menos de 5 letras, no se puede confirmar.
    await expect(confirmar).toBeDisabled()
    await dialogo.getByLabel("Motivo", { exact: false }).fill("abc")
    await expect(confirmar).toBeDisabled()
    // Cancelar no decide nada y conserva la selección.
    await dialogo.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(barra(page)).toContainText("2 líneas de 1 nota")
    expect(await notaPorId(notas.c.id)).toMatchObject({ status: "enviada" })

    // Con motivo, rechaza las dos líneas de la nota.
    const motivo = "Pedido duplicado: ya se compró en otra nota"
    await barra(page).getByRole("button", { name: "Rechazar", exact: true }).click()
    await dialogo.getByLabel("Motivo", { exact: false }).fill(motivo)
    await expect(confirmar).toBeEnabled()
    await confirmar.click()
    await expect(dialogo).toHaveCount(0, { timeout: 30_000 })
    await expect(textoVisible(page, "2 líneas rechazadas.").first()).toBeVisible({ timeout: 30_000 })

    await esperarEstadoDeNota(notas.c.id, "rechazada")
    expect((await notaPorId(notas.c.id))!.lines.map((linea) => linea.resolution)).toEqual(["rechazada", "rechazada"])
    expect(await motivosDeRechazo(notas.c.id)).toEqual([motivo, motivo])
    expect(await comprasDeNota(notas.c.id), "rechazar no compra nada").toEqual([])
    // El lote rechaza línea por línea: a la primera la nota queda «En gestión» y con la última, rechazada (el estado se deriva de las líneas).
    expect((await eventosDeNota(notas.c.id)).map((evento) => `${evento.from ?? "·"}>${evento.to}`)).toEqual(["·>enviada", "enviada>en_gestion", "en_gestion>rechazada"])

    // Salió de «Por revisar» y está en «Cerradas», con su estado.
    await expect(filaDe(page, notas.c)).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => leerPestanas(page), { timeout: 30_000 }).toEqual({ "Por revisar": 2, "En compra": 2, "En recepción": 1, "Cerradas": 2 })
    await pestana(page, "Cerradas").click()
    await expect(filaDe(page, notas.c)).toBeVisible({ timeout: 30_000 })
    await expect(filaDe(page, notas.c)).toContainText("Rechazada")
    expect(errores).toEqual([])
  })

  // ── 4 · El gráfico de antigüedad filtra ────────────────────────────────────────────────────────

  test("4 · el gráfico de antigüedad filtra la bandeja al pulsar un tramo y lo quita al pulsarlo otra vez", async ({ page }) => {
    expect(notas.antigua?.id, "depende del paso 1").toBeTruthy()
    const errores = vigilarConsola(page)
    await abrirBandeja(page)
    // Quedan dos por revisar: la urgente (recién llegada) y la antigua (20 días en su estado).
    await expect(filaDe(page, notas.urgente)).toBeVisible({ timeout: 30_000 })
    await expect(filaDe(page, notas.antigua)).toBeVisible()
    await expect(page.getByRole("img", { name: /^Notas de pedido por antigüedad en su estado actual\./ })).toBeVisible()
    const tramo = (nombre: string) => page.getByRole("link", { name: new RegExp(`^${nombre}\\s+\\d+$`) })

    await tramo("14 días o más").click()
    await expect(page).toHaveURL(/antiguedad=14(%2B|\+)/, { timeout: 30_000 })
    await expect(tramo("14 días o más")).toHaveAttribute("aria-current", "true")
    await expect(filaDe(page, notas.antigua)).toBeVisible()
    await expect(filaDe(page, notas.urgente)).toHaveCount(0)
    await expect(page.getByText("Filtrando por «14 días o más»: 1 de 2 notas.")).toBeVisible()

    // Pulsar el tramo vigente es la salida: la bandeja vuelve a mostrar las dos.
    await tramo("14 días o más").click()
    await expect(page).not.toHaveURL(/antiguedad=/, { timeout: 30_000 })
    await expect(filaDe(page, notas.urgente)).toBeVisible({ timeout: 30_000 })
    await expect(filaDe(page, notas.antigua)).toBeVisible()

    // El tramo de los recién llegados deja sólo la urgente, y «Quitar filtro» también es salida.
    await tramo("0–2 días").click()
    await expect(page).toHaveURL(/antiguedad=0-2/, { timeout: 30_000 })
    await expect(filaDe(page, notas.urgente)).toBeVisible()
    await expect(filaDe(page, notas.antigua)).toHaveCount(0)
    await page.getByRole("link", { name: "Quitar filtro", exact: true }).click()
    await expect(page).not.toHaveURL(/antiguedad=/, { timeout: 30_000 })
    await expect(filaDe(page, notas.antigua)).toBeVisible({ timeout: 30_000 })
    expect(errores).toEqual([])
  })

  // ── 5 · El chip «N urgentes» ───────────────────────────────────────────────────────────────────

  test("5 · el chip «N urgentes» lleva a las urgentes y, activo, quita el filtro", async ({ page }) => {
    expect(notas.urgente?.id, "depende del paso 1").toBeTruthy()
    const errores = vigilarConsola(page)
    await abrirBandeja(page)
    await expect(filaDe(page, notas.antigua)).toBeVisible({ timeout: 30_000 })

    // El chip está en la barra superior y cuenta las urgentes abiertas del alcance (al menos la de esta corrida).
    const chip = page.getByRole("link", { name: /^\d+ urgentes?$/ })
    await expect(chip).toBeVisible({ timeout: 30_000 })
    expect(Number(/^(\d+)/.exec(await chip.innerText())?.[1])).toBeGreaterThanOrEqual(1)

    await chip.click()
    await expect(page).toHaveURL(/urgencia=urgente/, { timeout: 30_000 })
    await expect(filaDe(page, notas.urgente)).toBeVisible({ timeout: 30_000 })
    await expect(filaDe(page, notas.antigua)).toHaveCount(0)
    // Todo lo que lista es urgente (o de un equipo detenido, que ya se sabe urgente).
    await expect(page.getByRole("table").getByRole("row").filter({ has: page.getByRole("link", { name: /-NP-\d+$/ }) }).filter({ hasNotText: /Urgente|Equipo detenido/ })).toHaveCount(0)

    // Activo, el chip se marca y su enlace es la salida.
    const quitar = page.getByRole("link", { name: /^Quitar filtro: urgentes?$/ })
    await expect(quitar).toHaveAttribute("aria-current", "page")
    await quitar.click()
    await expect(page).not.toHaveURL(/urgencia=/, { timeout: 30_000 })
    await expect(filaDe(page, notas.antigua)).toBeVisible({ timeout: 30_000 })
    await expect(filaDe(page, notas.urgente)).toBeVisible()
    expect(errores).toEqual([])
  })
})
