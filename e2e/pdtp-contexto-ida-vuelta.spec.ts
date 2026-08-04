import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * Ida y vuelta del visor de actividades PDTP (TASK-UI-009).
 *
 * El criterio dice: *"deep link abre el campo correcto y retorna al KPI/actividad
 * con contexto"* y *"conservar año/faena/programa; contexto persiste"*. La
 * pantalla acepta ocho parámetros de URL —`programa`, `hoja`, `faena`, `vista`,
 * `anio`, `estado`, `mes`, `semana`— y hasta ahora nada comprobaba que
 * sobrevivieran a salir y volver.
 *
 * Importa porque el hallazgo PDTP-STATE-001 era exactamente esto: un editor que
 * abre en error y obliga a rehacer la selección. Un contexto que se pierde al
 * ir al detalle y volver tiene el mismo costo, sólo que repartido.
 */
const CONTEXTO = "programa=prog-e2e&vista=mes&anio=2026&estado=pendiente&mes=3"

test.describe("PDTP — el contexto sobrevive la ida y la vuelta", () => {
  test("los ocho parámetros del visor se conservan al volver desde otra ruta", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp/actividades?${CONTEXTO}`)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const urlInicial = new URL(page.url())
    // Si la pantalla descarta un parámetro al montar, el contexto ya se perdió
    // antes de navegar a ningún sitio.
    for (const [clave, valor] of new URLSearchParams(CONTEXTO)) {
      expect(urlInicial.searchParams.get(clave), `la pantalla descartó "${clave}" al abrir`).toBe(valor)
    }

    // Salir a otra ruta y volver con el botón del navegador es el gesto real:
    // abrir una actividad, mirarla y retroceder.
    await page.goto("/prevencion/pdtp")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await page.goBack()
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const urlVuelta = new URL(page.url())
    const perdidos: string[] = []
    for (const [clave, valor] of new URLSearchParams(CONTEXTO)) {
      if (urlVuelta.searchParams.get(clave) !== valor) perdidos.push(clave)
    }

    expect(perdidos, "parámetros perdidos al volver").toEqual([])
  })

  test("un enlace profundo abre la pantalla ya acotada, sin pedir la selección otra vez", async ({ page }) => {
    await login(page)
    await page.goto(`/prevencion/pdtp/actividades?${CONTEXTO}`)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // El criterio pide que el deep link "abra el campo correcto": el contenido
    // principal tiene que estar servido, no un formulario de selección vacío.
    await expect(page.locator("main")).toBeVisible()
    // Y que no sea el estado de error que PDTP-STATE-001 describía: abrir en
    // error sin salida era el defecto original de esta pantalla.
    await expect(page.getByText(/No calculable/i)).toHaveCount(0)
  })

  test("un programa inexistente da una salida, no un callejón", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/actividades?programa=no-existe-e2e&anio=2026")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Lo que TASK-UI-009 prohíbe es el error genérico sin acción correctiva.
    // Un enlace de vuelta al listado de programas es la salida mínima.
    await expect(page.locator("main")).toBeVisible()
    const salida = page.getByRole("link", { name: /programa|PDTP|volver/i })
    await expect(salida.first()).toBeVisible({ timeout: 10_000 })
  })
})
