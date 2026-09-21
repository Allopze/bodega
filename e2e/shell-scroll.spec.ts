import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * El pozo es el contenedor de scroll, y la TopBar scrollea con él.
 *
 * Dos decisiones de diseño del shell vivían sólo en comentarios de
 * `components/layout/app-shell.tsx` y `components/layout/top-bar.tsx`, sin una
 * sola prueba que las sostuviera: un `grep` de `scrollY|scrollTop|scrollTo|
 * mouse.wheel` en `e2e/` daba cero. Es decir, nada impedía que un refactor
 * mandara el scroll al documento —perdiendo la preservación de posición al
 * filtrar, que depende de que el scroll NO viva en el documento— o volviera
 * `sticky` la cabecera, que es lo que el diseño evita a propósito para que la
 * sombra `inset` del pozo la cruce sin costura.
 *
 * Este archivo fija ese contrato. Se escribió y se hizo pasar ANTES de sacar la
 * TopBar de `<main>` (el cambio que le devuelve el rol `banner`), justamente
 * para que mida el comportamiento real del shell y no la expectativa del cambio.
 */

/** El nodo con `overflow-y-auto`: el "pozo". */
const POZO = "[data-shell-scroll]"

/** Ruta con contenido suficiente para desbordar el pozo en desktop. */
const RUTA_LARGA = "/prevencion/inspecciones"

function cabecera(page: Page) {
  return page.getByRole("banner")
}

async function metricasDelPozo(page: Page) {
  return page.evaluate((selector) => {
    const pozo = document.querySelector(selector)
    if (!pozo) throw new Error(`No existe el contenedor de scroll del shell (${selector})`)
    return {
      scrollHeight: pozo.scrollHeight,
      clientHeight: pozo.clientHeight,
      scrollTop: pozo.scrollTop,
      documentoScrollTop: document.scrollingElement?.scrollTop ?? 0,
      ventanaScrollY: window.scrollY,
    }
  }, POZO)
}

test.describe("Shell — el scroll vive en el pozo, no en el documento", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto(RUTA_LARGA)
    await expect(cabecera(page)).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState("networkidle").catch(() => undefined)
  })

  test("el documento no scrollea: lo hace el contenedor del shell", async ({ page }) => {
    const antes = await metricasDelPozo(page)
    // Si esto falla, la ruta dejó de tener contenido suficiente para desbordar
    // y el resto del archivo mide sobre un pozo que no scrollea.
    expect(antes.scrollHeight, "el pozo debería desbordar en esta ruta").toBeGreaterThan(antes.clientHeight)
    expect(antes.scrollTop).toBe(0)
    // La cadena `h-[100dvh] overflow-hidden` → `min-h-0` → `flex-1` es lo que
    // mantiene el scroll dentro del pozo. Si alguien quita un `min-h-0`, el
    // scroll se va al documento y esta aserción lo delata en vez de dejar que
    // degrade en silencio.
    expect(antes.ventanaScrollY).toBe(0)
    expect(antes.documentoScrollTop).toBe(0)

    await page.mouse.move(400, 400)
    await page.mouse.wheel(0, 600)
    await expect.poll(async () => (await metricasDelPozo(page)).scrollTop).toBeGreaterThan(0)

    const despues = await metricasDelPozo(page)
    expect(despues.ventanaScrollY).toBe(0)
    expect(despues.documentoScrollTop).toBe(0)
  })

  test("la cabecera scrollea con el contenido: no es sticky", async ({ page }) => {
    const cajaAntes = await cabecera(page).boundingBox()
    expect(cajaAntes).not.toBeNull()

    await page.mouse.move(400, 400)
    await page.mouse.wheel(0, 400)
    await expect.poll(async () => (await metricasDelPozo(page)).scrollTop).toBeGreaterThan(0)

    const desplazado = (await metricasDelPozo(page)).scrollTop
    const cajaDespues = await cabecera(page).boundingBox()
    // Una cabecera `sticky` mantendría su `y`; ésta sube con el contenido. Es
    // la decisión que permite que no lleve fondo propio.
    expect(cajaDespues!.y).toBeLessThan(cajaAntes!.y)
    expect(cajaAntes!.y - cajaDespues!.y).toBeCloseTo(desplazado, -1)
  })

  test("activar un ancla desplaza el pozo, no el documento", async ({ page }) => {
    // `/combustibles/ciclo` enlaza a su propio ancla (`cycleQuery`) y la sección
    // lleva `scroll-mt-24` (6rem = 96px).
    //
    // El ancla NO se pide en el `goto`: con el hash en la URL inicial el
    // desplazamiento nativo del fragmento compite con la hidratación y el
    // resultado es intermitente —se vio fallar en una corrida con base recién
    // construida y pasar en la siguiente—. Eso es una carrera de carga
    // preexistente y ajena a lo que esta prueba afirma; lo que aquí se verifica
    // es que el offset de `scroll-mt` resuelve contra el pozo, así que el ancla
    // se activa con la página ya asentada.
    await page.goto("/combustibles/ciclo")
    const seccion = page.locator("#movimientos-ciclo")
    await expect(seccion).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const inicial = await metricasDelPozo(page)
    expect(inicial.scrollHeight, "el pozo debería desbordar en esta ruta").toBeGreaterThan(inicial.clientHeight)
    expect(inicial.scrollTop).toBe(0)

    await page.evaluate(() => { window.location.hash = "#movimientos-ciclo" })
    await expect.poll(async () => (await metricasDelPozo(page)).scrollTop).toBeGreaterThan(0)

    const finales = await metricasDelPozo(page)
    // No se assertea el offset exacto de `scroll-mt-24`: en esta ruta el pozo
    // llega a su tope de scroll (`scrollHeight - clientHeight`) antes de que la
    // sección pueda subir hasta los 96px, así que el offset medible depende de
    // cuánto contenido siembre la base por debajo. Lo que sí es invariante —y
    // es lo que esta prueba protege— es QUIÉN se desplazó.
    expect(finales.scrollTop).toBe(finales.scrollHeight - finales.clientHeight)
    expect(finales.ventanaScrollY).toBe(0)
    expect(finales.documentoScrollTop).toBe(0)

    const cajaSeccion = (await seccion.boundingBox())!
    const cajaPozo = (await page.locator(POZO).boundingBox())!
    expect(cajaSeccion.y).toBeGreaterThanOrEqual(cajaPozo.y)
    expect(cajaSeccion.y).toBeLessThan(cajaPozo.y + cajaPozo.height)
  })
})

test.describe("Shell — el skip link salta el banner", () => {
  test("aterriza en main y el Tab siguiente no vuelve al buscador", async ({ page }) => {
    await login(page)
    // `/dashboard` sí pinta el buscador del shell, que es el control que el
    // skip link debía saltar y no saltaba: apuntaba al nodo que CONTENÍA la
    // cabecera, así que el primer Tab posterior caía justo ahí.
    await page.goto("/dashboard")
    await expect(page.getByRole("banner")).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press("Tab")
    const enlace = page.locator(":focus")
    await expect(enlace).toHaveAttribute("href", "#main-content")
    await page.keyboard.press("Enter")

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main-content")

    await page.keyboard.press("Tab")
    const dentroDelBanner = await page.evaluate(() => {
      const activo = document.activeElement
      const banner = document.querySelector("header")
      return Boolean(activo && banner && banner.contains(activo))
    })
    expect(dentroDelBanner, "el Tab posterior al salto volvió al cromo de la cabecera").toBe(false)
  })
})
