import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { MINIMAL_PNG, campoInspeccion, crearInspeccion, login, responderItemInspeccion, textoVisible } from "./helpers"
import { esperarGuardado, estadoDeGuardado } from "./inspecciones-captura-helpers"

/**
 * E2E: captura de las respuestas en terreno — lo que la pantalla dice que guardó es lo que el servidor
 * tiene (`/prevencion/inspecciones/<runId>`).
 *
 * Son las regresiones de navegador de la Ola 1 de la auditoría UI/UX del módulo
 * (`qa/reports/2026-10-19-inspecciones-uiux-audit.md`). Lo que tienen en común es que el defecto vivía
 * en la distancia entre «lo que se ve» y «lo que está guardado», y por eso ninguna se puede probar
 * desde la misma pestaña: cuando hay que saber si algo está en el servidor, se abre **otra sesión**
 * (un contexto nuevo del navegador, con la misma cuenta pero sin el espejo del dispositivo, que vive
 * en `localStorage`). Recargar la misma pestaña no sirve: el espejo restituiría la respuesta y el
 * test pasaría aunque el servidor no la tuviera, que es exactamente el defecto P0-1.
 *
 * Los contadores («1 de 5 obligatorios · 1 de 10 totales») salen del borrador en pantalla y no del
 * servidor; en una sesión nueva sí son lo guardado.
 */

const crear = (page: Page) => crearInspeccion(page, { prefijo: "E2E-CAP" })

/**
 * Abre la misma inspección en otra sesión: un contexto nuevo con las cookies de login del actual.
 * Quien llama debe cerrarlo (`otra.contexto.close()`).
 */
async function abrirEnOtraSesion(browser: Browser, context: BrowserContext, url: string) {
  // Sólo las cookies de login: `storageState()` también copia el `localStorage` y con él el espejo
  // del dispositivo de la pestaña original, que haría que la «otra sesión» restaurara lo que el
  // servidor no tiene y el test pasara (o fallara) por lo que no es.
  const { cookies } = await context.storageState()
  const contexto = await browser.newContext({ storageState: { cookies, origins: [] } })
  const page = await contexto.newPage()
  await page.goto(url)
  return { contexto, page }
}

test.describe("Inspecciones — captura: lo mostrado es lo guardado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /**
   * P0-1: antes, tras recargar con trabajo sin enviar, la pantalla restauraba la respuesta desde el
   * dispositivo y decía «Guardado» sobre algo que sólo existía en esa pestaña. Cerrarla (o abrir la
   * inspección en otro equipo) lo perdía.
   */
  test("recargar antes de que dispare el autoguardado no pierde la respuesta: otra sesión la ve guardada", async ({ page, browser, context }) => {
    const { url } = await crear(page)
    // El autoguardado avisa antes de salir con trabajo sin enviar (`beforeunload`): quien insiste
    // en recargar acepta salir, y es justo entonces cuando el espejo del dispositivo tiene que valer.
    page.on("dialog", (dialog) => void dialog.accept())

    await responderItemInspeccion(page, "Manómetro", "Bueno")
    // Sin esperar: el debounce del autoguardado es de 1,2 s y todavía no disparó.
    await page.reload()

    // Lo recuperado del dispositivo vuelve a la pantalla y se manda al servidor.
    await expect(textoVisible(page, "1 de 5 obligatorios · 1 de 10 totales")).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, /Recuperamos cambios de este dispositivo que no alcanzaron a enviarse/)).toBeVisible({ timeout: 5_000 })
    await esperarGuardado(page)

    const otra = await abrirEnOtraSesion(browser, context, url)
    try {
      await expect(textoVisible(otra.page, "1 de 5 obligatorios · 1 de 10 totales")).toBeVisible({ timeout: 15_000 })
      await expect(campoInspeccion(otra.page, "Resultado de Manómetro")).toContainText("Bueno")
    } finally {
      await otra.contexto.close()
    }
  })

  /**
   * P1-1: el servidor valida el lote completo, así que una sola fila mala frenaba el guardado de las
   * demás. Ahora la fila mala se retiene (queda en el dispositivo, nombrada aparte) y el resto se guarda.
   */
  test("un «Malo» sin motivo no impide que las demás respuestas se guarden", async ({ page, browser, context }) => {
    const { url } = await crear(page)

    await responderItemInspeccion(page, "Manómetro", "Bueno")
    await responderItemInspeccion(page, "Sello", "Bueno")
    // Sin motivo: `validateAnswerRow` la rechazaría, y antes arrastraba a las dos de arriba.
    await responderItemInspeccion(page, "Certificado CECMEC", "Malo")
    await expect(textoVisible(page, "Respuestas que todavía no se guardan")).toBeVisible()

    // «Guardado, salvo 1 respuesta incompleta» sólo puede leerse después de un guardado real: las
    // dos respuestas buenas dejaban la pantalla sucia hasta ese momento.
    await expect(estadoDeGuardado(page)).toHaveText("Guardado, salvo 1 respuesta incompleta", { timeout: 30_000 })

    const otra = await abrirEnOtraSesion(browser, context, url)
    try {
      await expect(textoVisible(otra.page, "2 de 5 obligatorios · 2 de 10 totales")).toBeVisible({ timeout: 15_000 })
      await expect(campoInspeccion(otra.page, "Resultado de Manómetro")).toContainText("Bueno")
      await expect(campoInspeccion(otra.page, "Resultado de Sello")).toContainText("Bueno")
      // La retenida no viajó: en el servidor sigue sin responder.
      await expect(campoInspeccion(otra.page, "Resultado de Certificado CECMEC")).toContainText("Sin responder")

      // Al completar el motivo la fila deja de estar retenida y también se guarda.
      await campoInspeccion(page, "Comentario de Certificado CECMEC").fill("Certificado vencido hace ocho meses.")
      await expect(estadoDeGuardado(page)).toHaveText("Guardado", { timeout: 30_000 })
      await otra.page.reload()
      await expect(textoVisible(otra.page, "3 de 5 obligatorios · 3 de 10 totales")).toBeVisible({ timeout: 15_000 })
      await expect(campoInspeccion(otra.page, "Comentario de Certificado CECMEC"))
        .toHaveValue("Certificado vencido hace ocho meses.")
    } finally {
      await otra.contexto.close()
    }
  })

  /**
   * P1-2: sin señal, `useOperation` dejaba que la excepción de la Server Action subiera hasta el
   * límite de error de la ruta, y «Guardar respuestas» reemplazaba la inspección entera por «Algo salió
   * mal». Ahora el guardado sin red se queda en la pantalla, dice que no hay conexión y se envía solo al
   * volver la señal.
   */
  test("«Guardar respuestas» sin conexión no tumba la pantalla y se envía solo al volver la señal", async ({ page, context }) => {
    await crear(page)

    await context.setOffline(true)
    await responderItemInspeccion(page, "Manómetro", "Bueno")
    await page.getByRole("button", { name: "Guardar respuestas" }).click()

    await expect(page.getByText(/Sin conexión\. Tus respuestas quedan guardadas en este dispositivo/)).toBeVisible({ timeout: 30_000 })
    await expect(estadoDeGuardado(page)).toHaveAttribute("data-save-state", "offline")
    // La inspección sigue en pantalla, con lo que se había respondido y con «Guardar» disponible.
    await expect(page.getByText("Algo salió mal")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()
    await expect(campoInspeccion(page, "Resultado de Manómetro")).toContainText("Bueno")

    await context.setOffline(false)
    await esperarGuardado(page)
    await expect(page.getByText(/Sin conexión\. Tus respuestas quedan guardadas/)).toHaveCount(0)

    await page.reload()
    await expect(textoVisible(page, "1 de 5 obligatorios · 1 de 10 totales")).toBeVisible({ timeout: 15_000 })
  })

  /**
   * P1-7: el estado de guardado sólo existía en la cabecera de escritorio (`hidden md:inline`). En el
   * teléfono —donde se ejecuta la inspección, de pie, con una mano— no había ninguna señal de si se
   * podía salir de la pantalla. Ahora la barra fija de abajo lo pinta con el mismo componente.
   */
  test("a 390×844 el estado de guardado se ve en la barra inferior del teléfono", async ({ page }) => {
    const { url } = await crear(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(url)

    const barra = page.getByRole("group", { name: "Acciones de la inspección en el teléfono" })
    await expect(barra).toBeVisible({ timeout: 30_000 })
    const estado = barra.getByRole("status")
    await expect(estado).toHaveText("Guardado")
    // Dentro del viewport: es una barra fija, no algo que haya que scrollear para ver.
    await expect(estado).toBeInViewport()

    await campoInspeccion(page, "Resultado de Manómetro").click()
    await page.getByRole("option", { name: "Bueno", exact: true }).click()
    // Mientras el debounce espera, la barra dice que hay cambios sin guardar; luego, que se guardaron.
    await expect(estado).toHaveText("Cambios sin guardar")
    await expect(estado).toHaveText("Guardado", { timeout: 30_000 })
    await expect(estado).toBeInViewport()

    // La barra conserva sus dos acciones junto al estado.
    await expect(barra.getByRole("button", { name: "Guardar", exact: true })).toBeVisible()
    await expect(barra.getByRole("button", { name: "Declarar ejecutada" })).toBeVisible()
  })

  /**
   * P1-6: una foto equivocada dejaba el ítem imposible de corregir. El servidor no deja una respuesta
   * «sin responder» mientras tenga fotos, y la pantalla no tenía cómo quitarlas.
   *
   * Recorrido completo: con la foto puesta, dejar el ítem sin responder queda retenido y lo explica;
   * quitar la foto (acción destructiva, pide confirmación) libera la fila, y el ítem queda sin
   * responder también en el servidor.
   */
  test("quitar la foto de un ítem y dejarlo sin responder funciona", async ({ page }) => {
    await crear(page)

    await responderItemInspeccion(page, "Manómetro", "Bueno")
    await campoInspeccion(page, "Adjuntar fotos de Manómetro").setInputFiles({
      name: "manometro-e2e.png",
      mimeType: "image/png",
      buffer: MINIMAL_PNG,
    })
    const foto = page.getByRole("link", { name: /Ver foto 1 de Manómetro/ })
    await expect(foto).toBeVisible({ timeout: 60_000 })

    // Con la foto puesta no se puede dejar sin responder: se retiene y dice por qué.
    await campoInspeccion(page, "Resultado de Manómetro").click()
    await page.getByRole("option", { name: "Sin responder", exact: true }).click()
    await expect(page.getByRole("button", { name: /quita primero sus fotos/ })).toBeVisible()

    await page.getByRole("button", { name: /Quitar foto 1 de Manómetro/ }).click()
    const dialog = page.getByRole("dialog", { name: "Quitar foto" })
    await expect(dialog.getByText(/No se puede deshacer/)).toBeVisible()
    await dialog.getByRole("button", { name: "Quitar foto", exact: true }).click()
    await expect(foto).toHaveCount(0, { timeout: 30_000 })

    // Sin fotos la fila ya no está retenida: el ítem queda sin responder en el servidor.
    await expect(page.getByRole("button", { name: /quita primero sus fotos/ })).toHaveCount(0)
    await esperarGuardado(page)
    await expect(estadoDeGuardado(page)).toHaveText("Guardado")

    await page.reload()
    await expect(textoVisible(page, "0 de 5 obligatorios · 0 de 10 totales")).toBeVisible({ timeout: 15_000 })
    await expect(campoInspeccion(page, "Resultado de Manómetro")).toContainText("Sin responder")
    await expect(page.getByRole("link", { name: /Ver foto 1 de Manómetro/ })).toHaveCount(0)
  })
})
