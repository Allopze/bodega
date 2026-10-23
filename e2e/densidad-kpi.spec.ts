/**
 * E2E: densidad de métricas y filtros (TASK-UI-006).
 *
 * La tarea pide como evidencia un "conteo DOM automatizado", que hasta ahora no
 * existía: el límite de cuatro tiles y seis filtros sólo podía comprobarse a
 * ojo, pantalla por pantalla, y cualquier KPI añadido después pasaba
 * inadvertido. Estas pruebas cuentan sobre el DOM real.
 *
 * El tope se aplica **por vista** en el tablero —que pinta una a la vez— y por
 * pantalla en el resto. El tablero tiene su propio techo, más alto y con grupos
 * rotulados sobre cuatro: es la excepción declarada en AGENTS.md §A1.
 */
import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

const MAX_KPIS = 4
const MAX_FILTROS = 6
/** Excepción de AGENTS.md §A1 para el tablero: 8 por vista, en grupos. */
const MAX_KPIS_TABLERO = 8

/** Pantallas de gestión nombradas por TASK-UI-006. */
const PANTALLAS = [
  { path: "/flota", name: "Flota" },
  // Panel operacional (área «Control operacional», reordenada por tarea el
  // 2026-10-22): cuatro tiles de «Requiere atención ahora» y debajo una tira
  // editorial (`SummaryBar`, que no usa `data-kpi-card`) con el desempeño del
  // período. El conteo impide que un quinto tile —o la tira convertida en
  // tarjetas— entre sin que nadie lo decida.
  { path: "/control-operacional", name: "Panel operacional" },
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/admin/backups", name: "Respaldos" },
  // El panel de administración ganó tiles de estado y con ellos el tope de A1.
  // Sus candidatas son cinco (respaldos, correo, DTE, bloqueos e
  // infraestructura) y la fila se arma con las peores cuatro: esta guarda es lo
  // que impide que el recorte se caiga y aparezcan las cinco.
  { path: "/admin", name: "Panel de Administración" },
  { path: "/prevencion/capa", name: "CAPA" },
  { path: "/prevencion/incidentes", name: "Incidentes" },
  { path: "/prevencion/capacitacion", name: "Capacitación" },
  { path: "/prevencion/permisos", name: "Permisos" },
  { path: "/prevencion/higiene", name: "Higiene" },
  { path: "/prevencion/emergencias", name: "Emergencias" },
  // Fase B: la portada MIPER por faena tiene franja (SummaryBar, no tarjetas) y dos filtros a la vista.
  { path: "/prevencion/miper", name: "MIPER" },
]

/**
 * Controles de filtro que el usuario ve sin desplegar "Más filtros".
 *
 * Se mide sobre `[data-shell-scroll]` —el pozo— y no sobre `<main>`: desde que
 * la TopBar salió de `<main>` para recuperar el rol `banner`, su input
 * "Filtrar en esta página..." dejó de estar dentro del landmark del contenido.
 * Para el presupuesto de A2 ese input ES un filtro que compite por la atención,
 * así que medir sobre `<main>` bajaría el conteo en uno y relajaría el tope de
 * seis sin que nadie lo hubiera decidido.
 */
async function contarFiltrosVisibles(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("[data-shell-scroll]") ?? document.body
    const controles = main.querySelectorAll<HTMLElement>(
      'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, [role="combobox"]',
    )
    let visibles = 0
    for (const control of controles) {
      const rect = control.getBoundingClientRect()
      // Un control sin caja no está compitiendo por la atención de nadie.
      if (rect.width > 0 && rect.height > 0) visibles++
    }
    return visibles
  })
}

test.describe("Densidad — máximo cuatro KPI y seis filtros", () => {
  for (const { path, name } of PANTALLAS) {
    test(`${name} (${path})`, async ({ page }) => {
      await login(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      const kpis = await page.locator("[data-kpi-card]").count()
      expect(kpis, `${name}: ${kpis} tiles`).toBeLessThanOrEqual(MAX_KPIS)

      const filtros = await contarFiltrosVisibles(page)
      expect(filtros, `${name}: ${filtros} filtros visibles`).toBeLessThanOrEqual(MAX_FILTROS)
    })
  }

  test("cada vista del tablero respeta su tope y agrupa sobre cuatro tiles", async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Se recorren las vistas reales, no una lista fija: una vista nueva no puede
    // quedar fuera de la guarda por olvido. Los dominios ya no son pestañas sino
    // items de un desplegable, así que hay que abrirlo — sin eso la guarda
    // seguiría pasando en verde cubriendo sólo dos de las nueve vistas.
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    await tabs.getByRole("button").click()
    const toHref = (links: Element[]) => links.map((link) => (link as HTMLAnchorElement).href)
    const hrefs = [
      ...await tabs.getByRole("link").evaluateAll(toHref),
      ...await page.getByRole("menuitem").evaluateAll(toHref),
    ]
    expect(hrefs.length).toBeGreaterThan(2)

    const excedidas: string[] = []
    const sinAgrupar: string[] = []
    for (const href of hrefs) {
      await page.goto(href)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      const vista = new URL(href).searchParams.get("vista") ?? "resumen"
      const total = await page.locator("[data-kpi-card]").count()
      if (total > MAX_KPIS_TABLERO) excedidas.push(`${vista}: ${total}`)

      // Sobre cuatro tiles la fila tiene que estar rotulada por grupos: ocho
      // cifras seguidas sin ese corte se leen como una sola lista.
      if (total > MAX_KPIS) {
        const grupos = await page.locator("section[aria-labelledby] h3").count()
        if (grupos < 2) sinAgrupar.push(`${vista}: ${total} tiles, ${grupos} grupos`)
      }
    }

    expect(excedidas).toEqual([])
    expect(sinAgrupar).toEqual([])
  })
})

test.describe("Densidad — el estado cero conduce a una acción", () => {
  test("una lista vacía por filtro distingue su causa y ofrece cómo salir", async ({ page }) => {
    await login(page)
    // `status` es un filtro real de la URL en CAPA; con un estado sin registros
    // la lista queda vacía **por filtro**, no por falta de datos. Son dos
    // estados distintos y el segundo necesita una salida, no sólo un mensaje.
    await page.goto("/prevencion/capa?status=cancelled")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    await expect(page.getByText("No hay acciones con estos filtros")).toBeVisible()
    await expect(page.getByRole("button", { name: "Ver todas" })).toBeVisible()
  })

  test("el filtro por vencimiento se anuncia y se puede quitar", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/documentacion?vence=30")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // El criterio pide filtro activo **removible**: una lista recortada sin
    // decir por qué ni cómo volver es la queja que originó la tarea.
    await expect(page.getByText("Vencen en 30 días")).toBeVisible()
    await expect(page.getByRole("link", { name: "Quitar filtro de vencimiento" })).toBeVisible()
  })
})

/**
 * Un indicador que anuncia una urgencia y lleva a la lista completa obliga a
 * buscar a mano lo que la cifra ya contó. En la pasada 64 apareció tres veces
 * el mismo defecto, y la pasada 65 lo barrió en el resto del tablero: cada KPI
 * cuyo enunciado nombra un subconjunto debe llegar a ese subconjunto, no al
 * total. Esta prueba fija ese contrato para que un KPI nuevo no lo pierda.
 */
test.describe("Densidad — todo KPI de subconjunto llega a su subconjunto", () => {
  /**
   * Cada KPI declara **en qué vista** vive.
   *
   * Con el tablero por pestañas, buscarlos todos en `/dashboard` los saltaba a
   * todos menos uno por el `continue` de abajo: la prueba pasaba verde sin
   * comprobar casi nada. La vista es parte del contrato, no un detalle.
   */
  const KPIS_DE_SUBCONJUNTO = [
    { vista: "prevencion", label: "Incidentes abiertos", destino: "/prevencion/incidentes?quick=open" },
    { vista: "prevencion", label: "CAPA vencidas", destino: "/prevencion/capa?vista=overdue" },
    { vista: "prevencion", label: "Riesgos críticos sin control", destino: "/prevencion/miper?sincontrol=1" },
    { vista: "terreno", label: "Hallazgos críticos abiertos", destino: "/prevencion/inspecciones?vista=critical" },
    { vista: "terreno", label: "Simulacros por mejorar", destino: "/prevencion/emergencias?tab=drills&vista=needs_improvement" },
    { vista: "terreno", label: "Mediciones sobre el límite", destino: "/prevencion/higiene?tab=groups&vista=above_limit" },
  ]

  test("los indicadores del tablero enlazan a su destino acotado", async ({ page }) => {
    await login(page)

    const sinAcotar: string[] = []
    const noEncontrados: string[] = []
    for (const kpi of KPIS_DE_SUBCONJUNTO) {
      await page.goto(`/dashboard?vista=${kpi.vista}`)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      // `KpiCard` envuelve la tarjeta en el enlace, no al revés: el ancla es el
      // `<a>` que contiene el `data-kpi-card`, no un `<a>` dentro de él.
      const enlace = page.locator("a:has([data-kpi-card])").filter({ hasText: kpi.label }).first()
      const tarjeta = page.locator("[data-kpi-card]").filter({ hasText: kpi.label }).first()
      if (await tarjeta.count() === 0) {
        // Ya no se salta en silencio: si el KPI no está donde dice la tabla, o
        // se movió de vista o desapareció, y las dos cosas hay que verlas.
        noEncontrados.push(`${kpi.label}: no está en ?vista=${kpi.vista}`)
        continue
      }
      if (await enlace.count() === 0) {
        sinAcotar.push(`${kpi.label}: sin enlace`)
        continue
      }
      const href = await enlace.getAttribute("href")
      if (href !== kpi.destino) sinAcotar.push(`${kpi.label}: ${href ?? "sin enlace"}`)
    }

    expect(noEncontrados).toEqual([])
    expect(sinAcotar).toEqual([])
  })

  /**
   * El panel operacional no vive en el tablero, así que no entra en la tabla de
   * arriba (que navega por `?vista=`); su contrato es el mismo: «Equipos
   * detenidos» no puede llevar a la lista completa de vehículos.
   *
   * La tabla se declara por **destino**, no por rótulo: el rótulo es texto del
   * tile y puede afinarse sin que el contrato cambie, mientras que a dónde
   * lleva es justo lo que esta guarda protege. Con todos los permisos (el
   * administrador del seed) hay un tile por dominio; un rol acotado ve menos,
   * y eso lo cubre `control-operacional-navegacion.spec.ts`.
   */
  const TILES_DEL_PANEL = [
    { dominio: "Equipos detenidos", destino: "/flota?estado=detenidos" },
    { dominio: "OT abiertas", destino: "/mantenciones?status=abiertas" },
    { dominio: "Documentos vencidos", destino: "/flota?vencimiento=vencidos" },
    { dominio: "Combustible por revisar", destino: "/combustibles/revision" },
  ]

  test("los tiles del panel operacional enlazan a su subconjunto, no al total", async ({ page }) => {
    await login(page)
    await page.goto("/control-operacional")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // `KpiCard` envuelve la tarjeta en el enlace (ver la prueba de arriba).
    const enlaces = page.locator("a:has([data-kpi-card])")
    await expect(enlaces.first()).toBeVisible()
    const hrefs = await enlaces.evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "(sin href)"))

    // Un tile sin ancla no lleva a ninguna parte: cada tarjeta tiene que ser un enlace.
    expect(await page.locator("[data-kpi-card]").count(), "hay tiles que no son enlaces").toBe(hrefs.length)

    const faltantes = TILES_DEL_PANEL
      .filter((tile) => !hrefs.includes(tile.destino))
      .map((tile) => `${tile.dominio}: no enlaza a ${tile.destino}`)
    const sobrantes = hrefs.filter((href) => !TILES_DEL_PANEL.some((tile) => tile.destino === href))
    expect(faltantes).toEqual([])
    expect(sobrantes, "tiles con un destino que la tabla no declara").toEqual([])
  })

  test("cada destino acotado reconoce su filtro y ofrece quitarlo", async ({ page }) => {
    await login(page)

    await page.goto("/prevencion/capa?vista=overdue")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("button", { name: "Ver todas" })).toBeVisible()

    await page.goto("/prevencion/inspecciones?vista=critical")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.locator("[aria-pressed='true']").first()).toBeVisible()

    // Fase B: la portada MIPER reconoce «sin control» con un chip que se puede quitar.
    await page.goto("/prevencion/miper?sincontrol=1")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("button", { name: "Eliminar filtro Riesgos críticos", exact: true })).toBeVisible()
  })
})
