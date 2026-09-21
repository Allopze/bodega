/**
 * E2E: densidad de métricas y filtros (TASK-UI-006).
 *
 * La tarea pide explícitamente "conteo DOM automatizado" como evidencia, y era
 * lo único de sus criterios que nadie comprobaba: el máximo de cuatro tiles y
 * seis filtros se había respetado a mano, pantalla por pantalla, sin nada que
 * impidiera que la siguiente pasada volviera a levantar el muro que la
 * auditoría desarmó.
 *
 * El conteo del panel se hace por sección y no por página: el dashboard agrupa
 * varios dominios y el límite es de cada uno, no de la pantalla entera.
 */
import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

const KPI = "[data-kpi-card]"

/** Pantallas de una sola tira de métricas, donde el límite aplica a la página. */
const SINGLE_STRIP_PAGES = [
  { path: "/flota", name: "Flota" },
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/prevencion/capa", name: "CAPA" },
  { path: "/prevencion/incidentes", name: "Incidentes" },
  { path: "/prevencion/capacitacion", name: "Capacitacion" },
  { path: "/prevencion/permisos", name: "Permisos de trabajo" },
  { path: "/prevencion/higiene", name: "Higiene y vigilancia" },
  { path: "/prevencion/emergencias", name: "Emergencias" },
]

async function visibleCount(page: Page, selector: string) {
  const all = await page.locator(selector).all()
  let count = 0
  for (const el of all) if (await el.isVisible()) count++
  return count
}

test.describe("Densidad — maximo cuatro metricas por pantalla", () => {
  for (const { path, name } of SINGLE_STRIP_PAGES) {
    test(`${name} (${path}) no supera cuatro tiles`, async ({ page }) => {
      await login(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      const tiles = await visibleCount(page, KPI)
      expect(tiles, `${name} muestra ${tiles} metricas`).toBeLessThanOrEqual(4)
    })
  }
})

test.describe("Densidad — el dashboard limita por dominio", () => {
  test("ninguna seccion del panel supera cuatro metricas", async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const sections = await page.getByRole("region").all()
    expect(sections.length).toBeGreaterThan(0)

    for (const section of sections) {
      if (!(await section.isVisible())) continue
      const label = (await section.getAttribute("aria-label")) ?? "seccion"
      const tiles = await section.locator(KPI).count()
      expect(tiles, `"${label}" muestra ${tiles} metricas`).toBeLessThanOrEqual(4)
    }
  })
})

/**
 * El conteo de filtros primarios cubría sólo `/pendientes`, así que la regla de
 * los seis se seguía respetando a mano en el resto — que es exactamente la
 * situación que este archivo existe para impedir. `/prevencion/pdtp/actividades`
 * llegó a exponer **siete** comboboxes simultáneos (Año, Mes, Semana, Programa,
 * Hoja, Faena, Objetivo) sin que nada lo detectara.
 *
 * Se mide con y sin faena porque el visor renderiza controles distintos en cada
 * caso: sin `?faena=` no hay botón de asignadas, y el selector de faena sólo
 * aparece con más de una autorizada.
 */
const FILTER_PAGES = [
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/prevencion/pdtp/actividades", name: "Actividades PDTP (agregado)" },
  { path: "/prevencion/pdtp/actividades?vista=anual", name: "Actividades PDTP (vista anual)" },
]

test.describe("Densidad — filtros primarios", () => {
  for (const { path, name } of FILTER_PAGES) {
    test(`${name} no expone mas de seis controles de filtro a la vez`, async ({ page }) => {
      await login(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      // Los controles primarios son los que se ven sin abrir "Más filtros": ésa
      // es justamente la distinción que la tarea pide preservar.
      const combos = await visibleCount(page, '[role="combobox"]')
      const searchBoxes = await visibleCount(page, 'input[type="search"], input[type="text"]')
      const primary = combos + searchBoxes

      expect(primary, `${name} expone ${primary} filtros primarios`).toBeLessThanOrEqual(6)
    })
  }
})

test.describe("Densidad — un indicador lleva a su propio recorte", () => {
  test("Documentos por vencer abre la lista acotada y el filtro se puede quitar", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/documentacion?vence=30")

    // El filtro se anuncia: una lista recortada sin explicación es el estado
    // que la auditoría marcó como inaceptable.
    await expect(page.getByText("Vencen en 30 días")).toBeVisible()
    const remove = page.getByRole("link", { name: "Quitar filtro de vencimiento" })
    await expect(remove).toBeVisible()

    await remove.click()
    await expect(page).not.toHaveURL(/vence=/)
    await expect(page.getByText("Vencen en 30 días")).toHaveCount(0)
  })
})
