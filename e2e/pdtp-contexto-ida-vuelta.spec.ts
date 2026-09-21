import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * Ida y vuelta del visor de actividades PDTP (TASK-UI-009).
 *
 * El criterio dice: *"deep link abre el campo correcto y retorna al KPI/actividad
 * con contexto"* y *"conservar año/faena/programa; contexto persiste"*. La
 * pantalla acepta diez parámetros de URL —`programa`, `hoja`, `faena`, `vista`,
 * `anio`, `estado`, `mes`, `semana`, `objetivo`, `asignado`— y hasta ahora nada
 * comprobaba que sobrevivieran a salir y volver.
 *
 * Importa porque el hallazgo PDTP-STATE-001 era exactamente esto: un editor que
 * abre en error y obliga a rehacer la selección. Un contexto que se pierde al
 * ir al detalle y volver tiene el mismo costo, sólo que repartido.
 *
 * `CONTEXTO` usaba `vista=mes` y `estado=pendiente`, dos valores que NO están en
 * las whitelists del server (`actividades/page.tsx`: `semana|anual` y
 * `executed|pending|overdue|not_scheduled|not_performed|en_cero`). La pantalla los
 * descartaba y renderizaba la vista anual sin filtro, pero el test seguía verde
 * porque sólo comparaba la URL consigo misma. Un eco no prueba que el parámetro
 * haga algo: de ahí que ahora haya un caso que verifica el EFECTO —la pestaña de
 * estado marcada con `aria-pressed`— y no sólo la supervivencia del querystring.
 */
const CONTEXTO = "programa=prog-e2e&vista=anual&anio=2026&estado=pending&mes=3"

test.describe("PDTP — el contexto sobrevive la ida y la vuelta", () => {
  test("los parámetros del visor se conservan al volver desde otra ruta", async ({ page }) => {
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

  test("el estado de la URL llega al control, no sólo a la barra de direcciones", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/actividades?vista=anual&anio=2026&estado=overdue")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // El eco de la URL no prueba nada: lo que importa es que el filtro esté
    // aplicado. `PdtpActivitySummary` marca la pestaña activa con
    // `aria-pressed`, así que es comprobable sin depender del color.
    const grupo = page.getByRole("group", { name: "Filtrar por estado" })
    if ((await grupo.count()) === 0) test.skip(true, "sin actividades que resumir en este entorno")

    const atrasadas = grupo.getByRole("button", { name: /^Atrasadas/ })
    await expect(atrasadas).toHaveAttribute("aria-pressed", "true")

    // Y el complemento: una pestaña que no viene en la URL no puede estar activa.
    await expect(grupo.getByRole("button", { name: /^Ejecutadas/ })).toHaveAttribute("aria-pressed", "false")
  })

  test("un parámetro fuera de whitelist no rompe la pantalla ni se aplica", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/pdtp/actividades?vista=mes&estado=pendiente&anio=2026")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // `vista=mes` y `estado=pendiente` no existen: el server cae a sus defaults
    // (vista anual, sin filtro de estado). Lo que se verifica es que degrade sin
    // reventar — este caso era el único que el `CONTEXTO` viejo cubría de verdad,
    // sin que nadie lo hubiera escrito a propósito.
    await expect(page.locator("main")).toBeVisible()

    const grupo = page.getByRole("group", { name: "Filtrar por estado" })
    if ((await grupo.count()) > 0) {
      await expect(grupo.getByRole("button", { name: /^Todas/ })).toHaveAttribute("aria-pressed", "true")
    }
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
