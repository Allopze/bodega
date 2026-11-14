import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { resolveE2eDatabaseUrl } from "./environment"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E: Indicadores de mantención (`/mantencion/indicadores`).
 *
 * Siembra SUS PROPIAS órdenes de trabajo (folios `OT-QA-IND-…`, solicitante `QA_Indicadores`)
 * directo en la base —una abierta y una cerrada de reparación con su paso por taller— para que
 * los tiles y los gráficos de OT tengan algo que dibujar, y las borra al terminar. Todo lo demás
 * (pautas, registros, intervalos) es lo que traiga la carga inicial: las comprobaciones de
 * estructura valen con datos o sin ellos.
 *
 * Locators: `getByRole` ignora los nodos ocultos por CSS. Las comprobaciones sobre celdas del
 * panel miden el DOM pintado con `evaluate`; el gráfico diferido (`lazyChart`) deja un
 * `[data-chart-loading]` hasta que llega su chunk, y un gráfico sin datos devuelve `null` y su
 * celda se oculta (`empty:hidden`).
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(120_000)

const RUTA = "/mantencion/indicadores"
const FOLIO = "OT-QA-IND-"

const chileDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(Date.now() + offset * 86_400_000))
const hace = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

/** Espera a que ningún gráfico siga cargando: un esqueleto todavía no sabe si tendrá datos. */
async function esperarGraficos(page: Page) {
  await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 30_000 })
}

test.beforeAll(async () => {
  const url = resolveE2eDatabaseUrl()
  expect(url, "E2E_DATABASE_URL").toBeTruthy()
  const sql = postgres(url!, { max: 1 })
  try {
    await sql`delete from mant_work_orders where folio like ${`${FOLIO}%`}`
    const [admin] = await sql`select id from users where email = 'admin@e2e.chome.cl'`
    const [vehicle] = await sql`
      select v.id, v.code, v.plate, v.worksite_id, w.name as worksite
      from fuel_vehicles v
      join mant_equipment_profiles p on p.vehicle_id = v.id
      join worksites w on w.id = v.worksite_id
      where v.is_active
      order by v.code limit 1`
    if (!admin || !vehicle) throw new Error("La carga inicial no trae un administrador y un equipo con ficha de mantención")
    const snapshot = sql.json({ code: vehicle.code, plate: vehicle.plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: vehicle.worksite, unit: "km" })

    // Abierta: pedida hace 3 días, sin mecánico.
    await sql`
      insert into mant_work_orders (id, folio, vehicle_id, worksite_id, equipment_snapshot, repair, maintenance, request_date, requested_by_user_id, requester_name, repair_description, status)
      values (${randomUUID()}, ${`${FOLIO}0001`}, ${vehicle.id}, ${vehicle.worksite_id}, ${snapshot}, true, false, ${chileDay(-3)}, ${admin.id}, 'QA_Indicadores', 'QA_ Reparación abierta de prueba', 'solicitada')`

    // Cerrada: pedida hace 12 días, 30 h en taller, cerrada hace 5, con costo cargado.
    const entry = hace(10)
    const exit = new Date(Date.parse(entry) + 30 * 3_600_000).toISOString()
    await sql`
      insert into mant_work_orders (
        id, folio, vehicle_id, worksite_id, equipment_snapshot, repair, maintenance, request_date, requested_by_user_id, requester_name, repair_description,
        total_cost, status, assigned_to_user_id, assigned_by_user_id, assigned_at,
        workshop_kind, workshop_entry_at, estimated_delivery_date, started_at, started_by_user_id,
        workshop_exit_at, finished_at, finished_by_user_id,
        received_at, receiver_name, received_by_user_id, received_recorded_at,
        faena_received_at, faena_receiver_name, faena_received_by_user_id, closed_at
      ) values (
        ${randomUUID()}, ${`${FOLIO}0002`}, ${vehicle.id}, ${vehicle.worksite_id}, ${snapshot}, true, false, ${chileDay(-12)}, ${admin.id}, 'QA_Indicadores', 'QA_ Reparación cerrada de prueba',
        125000, 'cerrada', ${admin.id}, ${admin.id}, ${entry},
        'interno', ${entry}, ${chileDay(-8)}, ${entry}, ${admin.id},
        ${exit}, ${exit}, ${admin.id},
        ${exit}, 'QA_ Recibe Taller', ${admin.id}, ${exit},
        ${hace(5)}, 'QA_ Recibe Faena', ${admin.id}, ${hace(5)}
      )`
  } finally {
    await sql.end()
  }
})

test.afterAll(async () => {
  const url = resolveE2eDatabaseUrl()
  if (!url) return
  const sql = postgres(url, { max: 1 })
  try {
    await sql`delete from mant_work_orders where folio like ${`${FOLIO}%`}`
  } finally {
    await sql.end()
  }
})

test.describe("Indicadores de mantención", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("carga con su título, las dos secciones y sin gráficos colgados", async ({ page }) => {
    const errores: string[] = []
    page.on("pageerror", (error) => errores.push(error.message))
    page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) errores.push(message.text()) })

    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores de mantención")
    await expect(page.getByRole("region", { name: "Órdenes de trabajo", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Pautas y disponibilidad", exact: true })).toBeVisible()
    await esperarGraficos(page)
    expect(errores, "errores de consola y de JavaScript en la página").toEqual([])
  })

  test("las OT sembradas se ven en sus tiles y en el gráfico de creadas, cerradas y en cola", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores de mantención")
    await esperarGraficos(page)

    const ordenes = page.getByRole("region", { name: "Órdenes de trabajo", exact: true })
    await expect(ordenes.getByRole("link", { name: /OT abiertas/ })).toBeVisible()
    await expect(ordenes.getByRole("link", { name: /OT cerradas en el período/ })).toBeVisible()
    await expect(ordenes.getByRole("link", { name: /Tiempo medio de reparación/ })).toBeVisible()
    await expect(ordenes.getByRole("link", { name: /Mano de obra y taller/ })).toBeVisible()
    await expect(ordenes.locator('[data-chart-kind="bars"]').first()).toBeVisible()
    // El titular del gráfico dice la cifra, y «Ver datos» trae la misma tabla en texto.
    await expect(ordenes.getByRole("heading", { name: "Órdenes de trabajo: creadas, cerradas y en cola", exact: true })).toBeVisible()
    await expect(ordenes.getByText("Ver datos", { exact: true }).first()).toBeVisible()
  })

  test("ninguna celda visible de un panel queda vacía", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores de mantención")
    await esperarGraficos(page)

    const vacias = await page.locator("[data-dashboard-panel] > div > *").evaluateAll((celdas) =>
      celdas
        .filter((celda) => celda.getClientRects().length > 0)
        .filter((celda) => celda.innerHTML.trim() === "")
        .map((celda) => celda.className),
    )
    expect(vacias, "celdas visibles sin contenido").toEqual([])
  })

  test("a lo más ocho tiles en la página y cada uno lleva a su subconjunto", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores de mantención")
    await esperarGraficos(page)

    const tiles = await page.locator("[data-kpi-card]").count()
    expect(tiles, `${tiles} tiles`).toBeLessThanOrEqual(8)
    for (const region of ["Órdenes de trabajo", "Pautas y disponibilidad"]) {
      const enSeccion = await page.getByRole("region", { name: region, exact: true }).locator("[data-kpi-card]").count()
      expect(enSeccion, `${enSeccion} tiles en «${region}»`).toBeLessThanOrEqual(4)
    }
    // Cada tile es un enlace que contiene el `data-kpi-card`: mismos conteos.
    expect(await page.locator("a:has([data-kpi-card])").count(), "hay tiles que no son enlaces").toBe(tiles)
    for (const href of await page.locator("a:has([data-kpi-card])").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
      expect(href, "tile sin destino").toMatch(/^\/mantencion\//)
    }
  })

  test("cambiar el período escribe desde y hasta en la URL", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores de mantención")
    await expect(page).not.toHaveURL(/[?&]desde=/)

    await page.getByRole("group", { name: "Período", exact: true }).getByRole("button", { name: "Período anterior", exact: true }).click()
    await expect(page).toHaveURL(/[?&]desde=\d{4}-\d{2}-\d{2}/)
    await expect(page).toHaveURL(/[?&]hasta=\d{4}-\d{2}-\d{2}/)
    // Se aplica con `router.replace`: la pantalla sigue en su título y no se acumulan entradas de historial.
    await expectPageTitle(page, "Indicadores de mantención")
    await esperarGraficos(page)
  })

  test("un rango inválido en la URL avisa y cae al período por defecto", async ({ page }) => {
    await page.goto(`${RUTA}?desde=2026-13-45&hasta=2026-01-01`)
    await expectPageTitle(page, "Indicadores de mantención")
    await expect(page.getByText("El rango de fechas de la dirección no es válido", { exact: false })).toBeVisible()
  })

  test("aparece en el menú de Mantención y el ítem queda activo", async ({ page }) => {
    await page.goto(RUTA)
    // El menú se busca por href, no por rótulo: el href es el contrato (mismo criterio que control-operacional-navegacion).
    const item = page.getByRole("navigation", { name: "Navegación", exact: true }).locator('a[href="/mantencion/indicadores"]').first()
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute("aria-current", "page")
  })
})
