import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { expectPageTitle, login, textoVisible } from "./helpers"
import {
  TRAINING_CATALOGS_BY_YEAR,
  occurrenceSeedRows,
  trainingCatalogItemId,
  trainingCatalogVersionForYear,
} from "../lib/prevention/training-occurrences-catalog"

/**
 * E2E: UX-01 — `/prevencion/capacitacion` se pagina en el servidor.
 *
 * La pantalla pintaba las ~3.900 ocurrencias del año a la vez: 29,8 MB de HTML,
 * 134 mil nodos de DOM y el título del TopBar a los 3,7 s. Lo que se afirma acá
 * es lo que el usuario nota si el defecto vuelve: cuántas tarjetas hay, cuánto
 * pesa el documento, cuándo aparece el título y que la lista siga coherente
 * después de actuar sobre una fila.
 *
 * Fixture propio, en el **año 2027** (el catálogo ya lo publica): la base E2E no
 * trae ocurrencias, y sembrarlas en el año operativo habría movido las cifras
 * de cumplimiento del PDTP que otras pruebas leen. Se siembra el programa
 * completo de una faena (390 casillas, igual que en producción) y se retira al
 * terminar, fila por fila: sólo lo que esta prueba insertó.
 */

const YEAR = 2027
const WORKSITE_ID = "ws-e2e"
const TITLE = "Campañas y capacitación"
const LIST_URL = `/prevencion/capacitacion?year=${YEAR}`
const PAGE_SIZE = 25
const DOCUMENT_BUDGET_BYTES = 1.5 * 1024 * 1024
/** El título debe estar casi de inmediato; el defecto lo mostraba a los 3,7 s. En CI el runner es más lento. */
const TITLE_BUDGET_MS = process.env.CI ? 8_000 : 5_000
const OBSERVATION = "QA_ capacitación paginada: se reprograma"

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

/** Lo que la prueba insertó de verdad (`on conflict do nothing`): es lo único que después se borra. */
const seeded = { occurrenceIds: [] as string[], catalogIds: [] as string[] }

/** Las tarjetas se cuentan por su menú «Más acciones»: otras secciones de la página también usan `<article>`. */
function cardMenus(page: Page) {
  return page.getByRole("button", { name: /^Más acciones de (CAP|CAM)-/ })
}

function statusTabs(page: Page) {
  return page.getByRole("navigation", { name: "Filtrar por estado", exact: true })
}

async function tabCount(page: Page, label: string): Promise<number> {
  const tab = statusTabs(page).getByRole("link", { name: new RegExp(`^${label}\\s*\\d+$`) })
  return Number((await tab.innerText()).replace(/\D/g, ""))
}

function complianceCalendar(page: Page) {
  return page.getByRole("region", {
    name: `Cumplimiento mensual de campañas y capacitaciones ${YEAR}, por faena`,
    exact: true,
  })
}

test.describe.serial("Capacitación — lista paginada en el servidor (UX-01)", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const catalog = TRAINING_CATALOGS_BY_YEAR[YEAR]
      if (!catalog) throw new Error(`El catálogo de capacitación ${YEAR} dejó de existir: elige otro año para el fixture.`)

      const catalogRows = catalog.items.map((item) => ({
        id: trainingCatalogItemId(YEAR, item.code),
        code: item.code,
        title: item.title,
        item_type: item.itemType,
        audience: item.audience,
        catalog_version: trainingCatalogVersionForYear(YEAR),
        source_row: item.sourceRow,
        schedule_json: item.schedule,
        pdtp_activity_numbers: item.pdtpActivityNumbers,
        sort_order: item.sortOrder,
      }))
      const insertedCatalog = await sql<{ id: string }[]>`
        insert into prevention_training_catalog_items (
          id, code, title, item_type, audience, catalog_version, source_row,
          schedule_json, pdtp_activity_numbers, is_active, sort_order
        )
        select id, code, title, item_type, audience, catalog_version, source_row,
               schedule_json, pdtp_activity_numbers, true, sort_order
        from jsonb_to_recordset(${sql.json(catalogRows as unknown as postgres.JSONValue)}) as r(
          id text, code text, title text, item_type text, audience text, catalog_version text,
          source_row int, schedule_json jsonb, pdtp_activity_numbers jsonb, sort_order int
        )
        on conflict (catalog_version, code) do nothing
        returning id
      `
      seeded.catalogIds = insertedCatalog.map((row) => row.id)

      const occurrenceRows = catalog.items.flatMap((item) => occurrenceSeedRows(item, WORKSITE_ID, YEAR)).map((row) => ({
        id: row.id,
        catalog_item_id: trainingCatalogItemId(YEAR, row.catalogCode),
        worksite_id: row.worksiteId,
        year: row.year,
        slot_key: row.slotKey,
        scheduled_month: row.scheduledMonth,
        scheduled_week: row.scheduledWeek,
      }))
      const insertedOccurrences = await sql<{ id: string }[]>`
        insert into prevention_training_occurrences (
          id, catalog_item_id, worksite_id, year, slot_key, scheduled_month, scheduled_week, status, version
        )
        select id, catalog_item_id, worksite_id, year, slot_key, scheduled_month, scheduled_week, 'pending', 1
        from jsonb_to_recordset(${sql.json(occurrenceRows as unknown as postgres.JSONValue)}) as r(
          id text, catalog_item_id text, worksite_id text, year int, slot_key text,
          scheduled_month int, scheduled_week int
        )
        on conflict (catalog_item_id, worksite_id, year, slot_key) do nothing
        returning id
      `
      seeded.occurrenceIds = insertedOccurrences.map((row) => row.id)
    } finally {
      await sql.end()
    }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      // La evidencia de una fila (si la prueba llegara a subir una) cuelga de ella por FK.
      if (seeded.occurrenceIds.length > 0) {
        await sql`delete from prevention_training_occurrence_evidence where occurrence_id in ${sql(seeded.occurrenceIds)}`
        await sql`delete from prevention_training_occurrences where id in ${sql(seeded.occurrenceIds)}`
      }
      if (seeded.catalogIds.length > 0) {
        await sql`delete from prevention_training_catalog_items where id in ${sql(seeded.catalogIds)}`
      }
    } finally {
      await sql.end()
    }
  })

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la primera página trae a lo más 25 tarjetas y la paginación para llegar al resto", async ({ page }) => {
    await page.goto(LIST_URL)
    await expectPageTitle(page, TITLE)

    // Sembradas hay cientos de casillas pendientes: la página está llena y no más.
    await expect(cardMenus(page)).toHaveCount(PAGE_SIZE)
    const pagination = page.getByRole("navigation", { name: "Paginación", exact: true })
    await expect(pagination).toBeVisible()

    expect(await tabCount(page, "Todas")).toBeGreaterThan(PAGE_SIZE)

    await pagination.getByRole("link", { name: "Página siguiente", exact: true }).click()
    await expect(page).toHaveURL(/[?&]page=2(&|$)/)
    await expect(pagination.getByRole("link", { name: "Ir a página 2", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(cardMenus(page)).toHaveCount(PAGE_SIZE)
  })

  test("el documento de la navegación pesa menos de 1,5 MB", async ({ page }) => {
    const response = await page.goto(LIST_URL)
    expect(response, "la navegación debe responder").not.toBeNull()
    expect(response!.ok()).toBe(true)
    const body = await response!.body()
    expect(body.length, `el HTML de la lista pesó ${(body.length / 1024 / 1024).toFixed(2)} MB`).toBeLessThan(DOCUMENT_BUDGET_BYTES)
  })

  test("el título del TopBar aparece enseguida", async ({ page }) => {
    await page.goto(LIST_URL, { waitUntil: "commit" })
    await expect(page.getByRole("heading", { level: 1, name: TITLE, exact: true })).toBeVisible({ timeout: TITLE_BUDGET_MS })
  })

  test("sin `estado` la vista es «Pendientes»; un valor desconocido se normaliza a ella", async ({ page }) => {
    await page.goto(LIST_URL)
    await expect(statusTabs(page).getByRole("link", { name: /^Pendientes/ })).toHaveAttribute("aria-current", "page")

    // El `estado=pendiente` de un enlace viejo no deja la pantalla sin pestaña activa.
    await page.goto(`${LIST_URL}&estado=pendiente`)
    await expect(page).not.toHaveURL(/estado=/)
    await expect(statusTabs(page).getByRole("link", { name: /^Pendientes/ })).toHaveAttribute("aria-current", "page")
  })

  test("una celda del calendario filtra por faena y mes en «Todas»; volver a pulsarla quita el filtro", async ({ page }) => {
    await page.goto(LIST_URL)
    await expectPageTitle(page, TITLE)

    const cell = complianceCalendar(page).getByRole("row", { name: /Faena E2E/ }).getByRole("link").first()
    // Hasta hidratar, el `Link` navega igual (es un `<a>`), pero conviene esperar a que la lista esté pintada.
    await expect(cardMenus(page).first()).toBeVisible()
    await cell.click()

    await expect(page).toHaveURL(new RegExp(`faena=${WORKSITE_ID}`))
    await expect(page).toHaveURL(/[?&]mes=\d+/)
    await expect(page).toHaveURL(/[?&]estado=todas(&|$)/)
    // Una celda verde aterrizando en «Pendientes» llevaría a una pestaña vacía: aquí aterriza en «Todas».
    await expect(statusTabs(page).getByRole("link", { name: /^Todas/ })).toHaveAttribute("aria-current", "page")
    await expect(page.getByText("Filtros activos:")).toBeVisible()
    await expect(cardMenus(page).first()).toBeVisible()

    // La celda activa es el filtro: pulsarla de nuevo lo quita y conserva faena y año.
    await complianceCalendar(page).locator('a[aria-current="true"]').click()
    await expect(page).not.toHaveURL(/[?&]mes=/)
    await expect(page).not.toHaveURL(/[?&]estado=/)
    await expect(page).toHaveURL(new RegExp(`faena=${WORKSITE_ID}`))
    await expect(statusTabs(page).getByRole("link", { name: /^Pendientes/ })).toHaveAttribute("aria-current", "page")
  })

  test("marcar una actividad como no hecha mueve su cifra de pestaña y la lista sigue llena", async ({ page }) => {
    await page.goto(LIST_URL)
    await expect(cardMenus(page)).toHaveCount(PAGE_SIZE)

    const pendingBefore = await tabCount(page, "Pendientes")
    const notDoneBefore = await tabCount(page, "No hechas")
    const allBefore = await tabCount(page, "Todas")

    const trigger = cardMenus(page).first()
    const label = await trigger.getAttribute("aria-label")
    const menuItem = page.getByRole("menuitem", { name: "Marcar no hecha", exact: true })
    // El menú es de Radix: un clic antes de hidratar no lo abre, así que se reintenta hasta que aparezca.
    await expect(async () => {
      await page.getByRole("button", { name: label!, exact: true }).click()
      await expect(menuItem).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    await menuItem.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Marcar capacitación como no hecha", { exact: true })).toBeVisible()
    await dialog.getByLabel("Observación").fill(OBSERVATION)
    await dialog.getByRole("button", { name: "Confirmar no hecha", exact: true }).click()

    await expect(textoVisible(page, "Capacitación marcada como no hecha.")).toBeVisible()
    await expect(dialog).toBeHidden()

    // La acción revalida la ruta: sin recargar a mano, las cifras de las pestañas cambian...
    await expect.poll(() => tabCount(page, "Pendientes")).toBe(pendingBefore - 1)
    expect(await tabCount(page, "No hechas")).toBe(notDoneBefore + 1)
    expect(await tabCount(page, "Todas")).toBe(allBefore)
    // ...y «Pendientes» sigue mostrando una página llena: la fila que salió la repone la siguiente.
    await expect(cardMenus(page)).toHaveCount(PAGE_SIZE)

    // La actividad aparece en «No hechas» con la observación que se escribió.
    await statusTabs(page).getByRole("link", { name: /^No hechas/ }).click()
    await expect(page).toHaveURL(/[?&]estado=no_hecha(&|$)/)
    await expect(textoVisible(page, OBSERVATION)).toBeVisible()
    await expect(cardMenus(page)).toHaveCount(notDoneBefore + 1)
  })
})
