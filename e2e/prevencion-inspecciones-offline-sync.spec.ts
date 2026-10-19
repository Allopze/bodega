import { test, expect, type Page } from "@playwright/test"
import { crearInspeccion as crearInspeccionE2E, login, responderItemInspeccion, textoVisible } from "./helpers"
import { esperarGuardado } from "./inspecciones-captura-helpers"

/**
 * E2E Spec: Sincronización y Resiliencia Offline de Inspecciones.
 *
 * Cubre:
 *   • El cierre guardado en el dispositivo (IndexedDB) cuando se declara sin conexión.
 *   • Que ese cierre se entregue solo al volver la señal, o con «Enviar ahora».
 *   • Que un reenvío tras un envío que el servidor sí procesó (pero cuya respuesta se perdió)
 *     no duplique ni corrompa el run: la idempotencia la da el servidor.
 *   • Los indicadores de cierre pendiente en la UI.
 *
 * Ya no existe un botón «Encolar cierre en este dispositivo» siempre visible: sin conexión, el
 * diálogo de cierre ofrece «Guardar cierre en este dispositivo». Por eso los escenarios cortan la
 * red de verdad con `context.setOffline`: sin ese corte la rama no se muestra.
 */

const crearInspeccion = async (page: Page) => (await crearInspeccionE2E(page, { prefijo: "E2E-OFF" })).identificacion

const responderItem = responderItemInspeccion

/** Los cinco puntuables conformes salvo el que se pide incumpliendo, y el acta firmada. */
async function prepararCierre(page: Page, incumple: string, resultadoActa: string) {
  for (const item of ["Manómetro", "Sello", "Rótulo", "Manguera", "Certificado CECMEC"]) {
    if (item === incumple) await responderItem(page, item, "Malo", `${item} cortado; el extintor fue manipulado.`)
    else await responderItem(page, item, "Bueno")
  }
  await page.getByLabel("Resultado del acta").click()
  await page.getByRole("option", { name: resultadoActa, exact: true }).click()
  await page.getByLabel("Firma de prevencionista").fill("Prevencionista Terreno E2E")
  await page.getByLabel("Firma de supervisor").fill("Supervisor Terreno E2E")
  // Lo último ya está en el servidor: así el único envío pendiente al cortar la red es el cierre.
  await esperarGuardado(page)
}

/** Sin red, declara ejecutada: el diálogo ofrece guardar el cierre en el dispositivo y lo guarda. */
async function guardarCierreSinConexion(page: Page) {
  await page.getByRole("button", { name: "Declarar ejecutada" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText(/Sin conexión\. Puedes guardar el cierre en este dispositivo/)).toBeVisible()
  await dialog.getByRole("button", { name: "Guardar cierre en este dispositivo" }).click()
  await expect(page.getByText("Cierre guardado en este dispositivo", { exact: true })).toBeVisible({ timeout: 30_000 })
}

test.describe("Inspecciones — Operación offline y sincronización", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("guardar el cierre sin conexión y entregarlo solo al recuperar conectividad", async ({ page, context }) => {
    await crearInspeccion(page)
    await prepararCierre(page, "Sello", "Con observaciones")

    await context.setOffline(true)
    await guardarCierreSinConexion(page)
    // Pendiente: lo dice la barra de estado y lo dice el aviso, y no se puede enviar sin señal.
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeDisabled()
    await expect(page.locator('[data-save-state="queued_close"]').filter({ visible: true })).toBeVisible()

    // Al volver la señal se vacía solo: nadie aprieta nada.
    await context.setOffline(false)
    await expect(page.getByText("Cierre guardado en este dispositivo", { exact: true })).toBeHidden({ timeout: 30_000 })

    // Validar estado persistido en el servidor
    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "80%").first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
  })

  /**
   * El peor caso de un cierre en cola: el servidor lo recibe y lo ejecuta, pero la respuesta se
   * pierde por el camino. Para la cola es un fallo de red, así que lo reintenta —aquí con «Enviar
   * ahora»—, y el servidor tiene que reconocer que ya lo ejecutó esta misma persona y contestar
   * éxito, sin duplicar el run ni los hallazgos.
   *
   * El primer envío se deja pasar hasta el servidor y se corta al volver (`route.fetch` +
   * `route.abort`): simula la respuesta perdida sin tocar la aplicación.
   */
  test("idempotencia: reenviar un cierre que el servidor ya ejecutó no duplica ni corrompe el run", async ({ page, context }) => {
    await crearInspeccion(page)
    await prepararCierre(page, "Sello", "Operativo")

    await context.setOffline(true)
    await guardarCierreSinConexion(page)

    // Los envíos de cierre son Server Actions: POST a la propia ruta con la cabecera `next-action`.
    let envios = 0
    await page.route(/\/prevencion\/inspecciones\/[^/?]+$/, async (route) => {
      const peticion = route.request()
      if (peticion.method() !== "POST" || !peticion.headers()["next-action"]) return route.continue()
      envios += 1
      if (envios === 1) {
        // El servidor lo procesa de verdad; el navegador no se entera.
        await route.fetch()
        return route.abort("connectionreset")
      }
      return route.continue()
    })

    await context.setOffline(false)
    // El reenvío automático al volver la señal falla (la respuesta se perdió): el cierre sigue
    // guardado en el dispositivo y «Enviar ahora» está disponible.
    await expect.poll(() => envios, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
    const enviarAhora = page.getByRole("button", { name: "Enviar ahora" })
    await expect(enviarAhora).toBeEnabled({ timeout: 30_000 })
    await enviarAhora.click()

    // El segundo envío sí llega con su respuesta: el aviso se retira.
    await expect(page.getByText("Cierre guardado en este dispositivo", { exact: true })).toBeHidden({ timeout: 30_000 })
    expect(envios).toBe(2)

    // Recargar y verificar integridad: un solo cierre, un solo hallazgo, el mismo cumplimiento.
    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "80%").first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
  })
})
