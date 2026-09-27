import { expect, test, type Locator, type Page } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

/**
 * E2E: PREV-I01 (D29) y W8 — registrar desde el teléfono y paginar la semana.
 *
 * El defecto I01: a 390 px la planilla anual fijaba N° + Actividad (48 + 352
 * px) y esa columna ocupaba todo el ancho visible. Por más que se deslizara la
 * tabla, la prueba de impacto sobre el centro de "Registrar" caía en "Ver
 * programa y responsables" y Playwright no podía pulsarlo ("subtree intercepts
 * pointer events"). D29: bajo `md` sólo el N° queda fijo.
 *
 * La comprobación es `document.elementFromPoint` en el centro del botón: lo
 * que el dedo toca de verdad, no si el nodo "es visible".
 *
 * W8: la vista semanal cortaba en 30 filas sin forma de ver las demás.
 *
 * ## Fixture propio
 *
 * Una hoja `pdtp_general` en el programa E2E con 32 actividades planificadas
 * en la semana en curso (así entran todas a la vista semanal). Se borra al
 * final; los specs corren en serie.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-general-movil-e2e"
const YEAR = 2026
const now = new Date()
const CURRENT_MONTH = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", month: "numeric" }).format(now))
const CURRENT_WEEK = Math.min(4, Math.ceil(Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", day: "numeric" }).format(now)) / 7))
const MOBILE = { width: 390, height: 844 }

const ACTIVITIES = Array.from({ length: 32 }, (_, index) => {
  const label = String(index + 1).padStart(2, "0")
  return { id: `pdtp-act-movil-${label}-e2e`, n: 900 + index + 1, name: `MOV-${label} Charla de seguridad en terreno` }
})
const FIRST = ACTIVITIES[0]!
const LAST = ACTIVITIES[ACTIVITIES.length - 1]!

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

function programHref(vista: "anual" | "semana", extra = "") {
  return `/prevencion/pdtp/${PROGRAM_ID}?hoja=pdtp_general&faena=${WORKSITE_ID}&vista=${vista}${extra}`
}

/** Lo que hay de verdad bajo el centro del botón. */
async function hitTest(button: Locator) {
  return button.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    const inViewport = x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight
    return {
      inViewport,
      topmost: hit !== null && element.contains(hit),
      hit: hit ? `${hit.tagName.toLowerCase()} "${(hit.textContent ?? "").trim().slice(0, 40)}"` : null,
    }
  })
}

async function expectRegistrarReachable(page: Page, rowText: string) {
  const row = page.getByRole("row").filter({ hasText: rowText })
  const button = row.getByRole("button", { name: "Registrar", exact: true })
  await button.scrollIntoViewIfNeeded()
  const afterScrollIntoView = await hitTest(button)
  expect(afterScrollIntoView, `centro de "Registrar" tras deslizar hasta él: ${afterScrollIntoView.hit}`).toMatchObject({ inViewport: true, topmost: true })

  // Tabla deslizada al máximo: el caso del informe (la columna fija tapaba el
  // botón aun ahí).
  await row.evaluate((element) => {
    const scroller = element.closest("[role=region]") as HTMLElement | null
    if (scroller) scroller.scrollLeft = scroller.scrollWidth
  })
  await button.scrollIntoViewIfNeeded()
  const atMaxScroll = await hitTest(button)
  expect(atMaxScroll, `centro de "Registrar" con la tabla al máximo: ${atMaxScroll.hit}`).toMatchObject({ inViewport: true, topmost: true })
  return button
}

async function expectDialogNamesActivity(page: Page, button: Locator, activity: { n: number; name: string }) {
  // Sin `force`: si algo tapara el botón, Playwright fallaría acá.
  await button.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: new RegExp(`N°${activity.n}\\b`) })).toBeVisible()
  await expect(dialog.getByText(activity.name, { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test.describe.serial("PDTP — registrar desde el teléfono (PREV-I01) y paginación semanal (W8)", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const stamp = new Date().toISOString()
      await sql`
        insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
        values (${SHEET_ID}, 'pdtp_general', ${PROGRAM_ID}, 'General E2E móvil', 'SG-SST', '[]'::jsonb, true)
        on conflict (id) do nothing
      `
      for (const [index, activity] of ACTIVITIES.entries()) {
        await sql`
          insert into pdtp_activities (
            id, program_id, n, display_order, status, activity, program,
            responsible_slugs, responsible_display, schedule_mode, source_sheet_row, created_at, updated_at
          ) values (
            ${activity.id}, ${PROGRAM_ID}, ${activity.n}, ${index + 1}, 'active', ${activity.name}, 'Programa E2E',
            '[]'::jsonb, 'Prevencionista', 'scheduled', ${activity.n}, ${stamp}, ${stamp}
          ) on conflict (id) do nothing
        `
        await sql`
          insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
          values (${`${activity.id}-general`}, ${SHEET_ID}, 'pdtp_general', ${activity.id}, ${index + 1}, ${index + 1})
          on conflict (id) do nothing
        `
        await sql`
          insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
          values (${`${activity.id}-s-${YEAR}-${CURRENT_MONTH}-${CURRENT_WEEK}`}, ${activity.id}, ${YEAR}, ${CURRENT_MONTH}, ${CURRENT_WEEK}, 1, 'manual-e2e')
          on conflict (id) do nothing
        `
      }
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      const ids = ACTIVITIES.map((activity) => activity.id)
      await sql`delete from pdtp_executions where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_activity_schedule where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_sheet_activities where activity_id in ${sql(ids)}`
      await sql`delete from pdtp_activities where id in ${sql(ids)}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
    } finally { await sql.end() }
  })

  test("a 390 px, en la planilla anual 'Registrar' queda encima y el diálogo nombra la actividad", async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await login(page)
    await page.goto(programHref("anual"))
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const button = await expectRegistrarReachable(page, FIRST.name)
    await expectDialogNamesActivity(page, button, FIRST)
  })

  test("a 390 px, en la vista semanal 'Registrar' queda encima y el diálogo nombra la actividad", async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await login(page)
    await page.goto(programHref("semana"))
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const button = await expectRegistrarReachable(page, FIRST.name)
    await expectDialogNamesActivity(page, button, FIRST)
  })

  test("a 390 px el tablero PDTP, inicio y la planilla no desbordan el pozo del shell", async ({ page }) => {
    // El contenido desplaza `[data-shell-scroll]`, no el documento: medir sólo
    // `documentElement` (como `reflow-anchos.spec.ts`) no veía los 7 px del
    // tablero PDTP ni los 9 px de inicio que midió T6.
    await page.setViewportSize(MOBILE)
    await login(page)
    const desbordan: string[] = []
    for (const path of ["/prevencion/pdtp", "/dashboard", programHref("anual"), programHref("semana"), "/prevencion/pdtp/actividades"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle").catch(() => undefined)
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        const well = document.querySelector<HTMLElement>("[data-shell-scroll]")
        return Math.max(doc.scrollWidth - doc.clientWidth, well ? well.scrollWidth - well.clientWidth : 0)
      })
      if (overflow > 1) desbordan.push(`${path}: ${overflow}px`)
    }
    expect(desbordan).toEqual([])
  })

  test("la vista semanal con más de 30 actividades pagina y la página viaja en la URL", async ({ page }) => {
    await login(page)
    await page.goto(programHref("semana"))
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const rows = page.getByRole("row").filter({ hasText: /MOV-\d{2} / })
    await expect(rows).toHaveCount(30)
    await expect(rows.filter({ hasText: LAST.name })).toHaveCount(0)

    await page.getByRole("button", { name: "Página siguiente", exact: true }).click()
    await expect(page).toHaveURL(/[?&]page=2\b/)
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: LAST.name })).toHaveCount(1)

    // Volver con la URL deja la misma página (al regresar desde una ficha).
    await page.reload()
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(rows.filter({ hasText: LAST.name })).toHaveCount(1)

    // La última también se puede registrar desde su página.
    await expectDialogNamesActivity(page, rows.filter({ hasText: LAST.name }).getByRole("button", { name: "Registrar", exact: true }), LAST)
  })
})
