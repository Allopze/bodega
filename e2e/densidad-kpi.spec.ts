/**
 * E2E: densidad de métricas y filtros (TASK-UI-006).
 *
 * La tarea pide como evidencia un "conteo DOM automatizado", que hasta ahora no
 * existía: el límite de cuatro tiles y seis filtros sólo podía comprobarse a
 * ojo, pantalla por pantalla, y cualquier KPI añadido después pasaba
 * inadvertido. Estas pruebas cuentan sobre el DOM real.
 *
 * El tope se aplica **por sección** en el tablero —que agrupa dominios— y por
 * pantalla en el resto, que es como quedó definido en la pasada 44.
 */
import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

const MAX_KPIS = 4
const MAX_FILTROS = 6

/** Pantallas de gestión nombradas por TASK-UI-006. */
const PANTALLAS = [
  { path: "/flota", name: "Flota" },
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/admin/backups", name: "Respaldos" },
  { path: "/prevencion/capa", name: "CAPA" },
  { path: "/prevencion/incidentes", name: "Incidentes" },
  { path: "/prevencion/capacitacion", name: "Capacitación" },
  { path: "/prevencion/permisos", name: "Permisos" },
  { path: "/prevencion/higiene", name: "Higiene" },
  { path: "/prevencion/emergencias", name: "Emergencias" },
]

/** Controles de filtro que el usuario ve sin desplegar "Más filtros". */
async function contarFiltrosVisibles(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body
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

  test("el tablero respeta el tope dentro de cada sección de dominio", async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // El tablero agrupa varios dominios, así que el tope es por sección: un
    // conteo de página entera no diría nada útil sobre la carga de cada bloque.
    const excedidas = await page.evaluate((max) => {
      const fuera: string[] = []
      for (const section of document.querySelectorAll("section[aria-labelledby]")) {
        const total = section.querySelectorAll("[data-kpi-card]").length
        if (total > max) {
          const titulo = document.getElementById(section.getAttribute("aria-labelledby") ?? "")
          fuera.push(`${titulo?.textContent?.trim() ?? section.id}: ${total}`)
        }
      }
      return fuera
    }, MAX_KPIS)

    expect(excedidas).toEqual([])
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
  const KPIS_DE_SUBCONJUNTO = [
    { label: "Incidentes abiertos", destino: "/prevencion/incidentes?quick=open" },
    { label: "CAPA vencidas", destino: "/prevencion/capa?vista=overdue" },
    { label: "Riesgos críticos sin control", destino: "/prevencion/miper#bloqueos" },
    { label: "Hallazgos críticos abiertos", destino: "/prevencion/inspecciones?vista=critical" },
    { label: "Simulacros por mejorar", destino: "/prevencion/emergencias?tab=drills&vista=needs_improvement" },
    { label: "Mediciones sobre el límite", destino: "/prevencion/higiene?tab=groups&vista=above_limit" },
  ]

  test("los indicadores del tablero enlazan a su destino acotado", async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const sinAcotar: string[] = []
    for (const kpi of KPIS_DE_SUBCONJUNTO) {
      // `KpiCard` envuelve la tarjeta en el enlace, no al revés: el ancla es el
      // `<a>` que contiene el `data-kpi-card`, no un `<a>` dentro de él.
      const enlace = page.locator("a:has([data-kpi-card])").filter({ hasText: kpi.label }).first()
      const tarjeta = page.locator("[data-kpi-card]").filter({ hasText: kpi.label }).first()
      // Un dominio puede no estar visible para el rol o la faena sembrada; lo
      // que no puede pasar es que esté visible y no sepa acotar.
      if (await tarjeta.count() === 0) continue
      if (await enlace.count() === 0) {
        sinAcotar.push(`${kpi.label}: sin enlace`)
        continue
      }
      const href = await enlace.getAttribute("href")
      if (href !== kpi.destino) sinAcotar.push(`${kpi.label}: ${href ?? "sin enlace"}`)
    }

    expect(sinAcotar).toEqual([])
  })

  test("cada destino acotado reconoce su filtro y ofrece quitarlo", async ({ page }) => {
    await login(page)

    await page.goto("/prevencion/capa?vista=overdue")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("button", { name: "Ver todas" })).toBeVisible()

    await page.goto("/prevencion/inspecciones?vista=critical")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.locator("[aria-pressed='true']").first()).toBeVisible()
  })
})
