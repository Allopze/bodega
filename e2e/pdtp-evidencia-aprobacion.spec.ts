import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { cerrarSesion, login } from "./helpers"

/**
 * E2E: evidencia con aprobación, de punta a punta (tanda T4, PREV-M08).
 *
 * Ningún E2E subía un archivo ni aprobaba después de cargar. Este recorre el
 * camino completo que la auditoría del 2026-09-26 no pudo verificar en
 * navegador:
 *
 *  1. un jefe de terreno registra la actividad con un PDF (subida real);
 *  2. otro jefe de terreno de la misma faena no puede reemplazar ese envío
 *     pendiente (PREV-B03);
 *  3. la cola de aprobaciones enlaza el PDF y la descarga responde (PREV-I05,
 *     M02-A: se sirve como PDF porque la extensión sale del tipo detectado);
 *  4. se rechaza con motivo, se reenvía con otro archivo y se aprueba;
 *  5. el detalle muestra el "Historial de envíos" con los cuatro hechos y el
 *     archivo rechazado sigue descargable (PREV-I04).
 *
 * ## Fixture propio
 *
 * Hoja y actividad nuevas, como `pdtp-cierre-mes.spec.ts`. El número 83 es
 * exclusivo de este archivo (77 desvíos, 78 asignación, 79 cierre, 90-92 T5):
 * `pdtp_activities` tiene un único sobre (programa, n). Junio queda libre de
 * los demás specs.
 */

const PROGRAM_ID = "pdtp-prog-e2e"
const WORKSITE_ID = "ws-e2e"
const SHEET_ID = "pdtp-sheet-evidencia-e2e"
const SHEET_CODE = "s-evidencia"
const SHEET_LABEL = "Evidencia E2E"
const ACTIVITY_ID = "pdtp-act-evidencia-e2e"
const ACTIVITY_N = 83
const ACTIVITY_NAME = "Charla de evidencia con aprobación E2E"
const MONTH = 6
const WEEK = 2
const AUTHOR = "jt@e2e.chome.cl"
const PEER = "jefe.faena@e2e.chome.cl"
const REJECTION = "El acta no trae la firma del supervisor E2E"
// PREV-I03: sin asignación, registra quien tiene el rol responsable. La
// actividad declara al jefe de terreno; sin esta fila no la registra nadie más
// que Prevención.
const CATALOG_SLUG = "jt-evidencia-e2e"

const WEEKLY_URL = `/prevencion/pdtp/actividades?programa=${PROGRAM_ID}&faena=${WORKSITE_ID}&hoja=${SHEET_CODE}&vista=semana&mes=${MONTH}&semana=${WEEK}`

function openDb() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
  return postgres(databaseUrl, { max: 1 })
}

function pdf(label: string) {
  return { name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`) }
}

async function executionRow() {
  const sql = openDb()
  try {
    const [row] = await sql<Array<{ id: string; status: string; evidence_url: string | null; evidence_photos: string[]; source_metadata_json: Record<string, unknown> }>>`
      select id, status, evidence_url, evidence_photos, source_metadata_json
      from pdtp_executions
      where activity_id = ${ACTIVITY_ID} and worksite_id = ${WORKSITE_ID} and origin = 'manual'
    `
    return row
  } finally { await sql.end() }
}

async function registerWithFile(page: import("@playwright/test").Page, file: ReturnType<typeof pdf>) {
  await page.goto(WEEKLY_URL)
  // El diálogo es cliente puro: sin hidratar, el primer clic no abre nada.
  await page.waitForLoadState("networkidle").catch(() => undefined)
  const row = page.getByRole("row").filter({ hasText: ACTIVITY_NAME })
  await row.getByRole("button", { name: "Registrar" }).click()
  const dialog = page.getByRole("dialog", { name: "Registrar ejecución" })
  await dialog.getByLabel("Cantidad").fill("1")
  await dialog.locator("#exec-file").setInputFiles(file)
  await dialog.getByRole("button", { name: "Guardar ejecución" }).click()
  return dialog
}

test.describe.serial("PDTP — evidencia con aprobación", () => {
  test.beforeAll(async () => {
    const sql = openDb()
    try {
      const now = new Date().toISOString()
      await sql`
        insert into pdtp_responsible_catalog (slug, display_name, role_name, kind, is_active)
        values (${CATALOG_SLUG}, 'Jefe de terreno Evidencia E2E', 'jefe_terreno', 'rbac_role', true)
        on conflict (slug) do nothing
      `
      await sql`
        insert into pdtp_sheets (id, code, program_id, label, area, default_scope_roles, is_active)
        values (${SHEET_ID}, ${SHEET_CODE}, ${PROGRAM_ID}, ${SHEET_LABEL}, 'SG-SST', '[]'::jsonb, true)
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activities (
          id, program_id, n, display_order, status, activity, program,
          responsible_slugs, responsible_display, schedule_mode, source_sheet_row,
          created_at, updated_at
        )
        values (
          ${ACTIVITY_ID}, ${PROGRAM_ID}, ${ACTIVITY_N}, 1, 'active', ${ACTIVITY_NAME}, 'Programa E2E',
          ${sql.json([CATALOG_SLUG])}, 'Jefe de terreno', 'scheduled', ${ACTIVITY_N}, ${now}, ${now}
        )
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_sheet_activities (id, sheet_id, sheet_code, activity_id, sheet_row, display_order)
        values ('pdtp-sheet-act-evidencia-e2e', ${SHEET_ID}, ${SHEET_CODE}, ${ACTIVITY_ID}, 1, 1)
        on conflict (id) do nothing
      `
      await sql`
        insert into pdtp_activity_schedule (id, activity_id, year, month, week, planned_quantity, source_column)
        values ('pdtp-sched-evidencia-e2e', ${ACTIVITY_ID}, 2026, ${MONTH}, ${WEEK}, 1, 'manual-e2e')
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test.afterAll(async () => {
    const sql = openDb()
    try {
      await sql`
        delete from audit_log
        where entity_type = 'pdtp:execution'
          and entity_id in (select id from pdtp_executions where activity_id = ${ACTIVITY_ID})
      `
      await sql`delete from pdtp_change_log where section in (select 'execution:' || id from pdtp_executions where activity_id = ${ACTIVITY_ID})`
      await sql`delete from pdtp_executions where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activity_schedule where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheet_activities where activity_id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_activities where id = ${ACTIVITY_ID}`
      await sql`delete from pdtp_sheets where id = ${SHEET_ID}`
      await sql`delete from pdtp_responsible_catalog where slug = ${CATALOG_SLUG}`
    } finally { await sql.end() }
  })

  test("el jefe de terreno registra la actividad con un PDF y queda su sha256", async ({ page }) => {
    await login(page, AUTHOR)
    const dialog = await registerWithFile(page, pdf("acta-original"))
    await expect(dialog).not.toBeVisible()

    const row = await executionRow()
    expect(row?.status).toBe("submitted")
    expect(row?.evidence_url).toMatch(/^storage\/pdtp-evidence\/[A-Za-z0-9_-]+\.pdf$/)
    const sha = (row?.source_metadata_json.evidenceSha256 ?? {}) as Record<string, string>
    expect(sha[row!.evidence_url!]).toMatch(/^[0-9a-f]{64}$/)
  })

  test("otro jefe de terreno de la faena no puede reemplazar el envío pendiente (PREV-B03)", async ({ page }) => {
    await login(page, PEER)
    const dialog = await registerWithFile(page, pdf("acta-ajena"))
    await expect(dialog.getByRole("alert")).toContainText(/otra persona/i)
    const row = await executionRow()
    expect(row?.evidence_photos ?? []).toHaveLength(0)
  })

  test("la cola enlaza el PDF, se descarga como PDF y se rechaza con motivo", async ({ page }) => {
    const row = await executionRow()
    const name = row!.evidence_url!.split("/").pop()!
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const link = page.locator(`a[href="/api/prevencion/pdtp/evidence/${name}"]`)
    await expect(link).toBeVisible()
    const download = await page.request.get(`/api/prevencion/pdtp/evidence/${name}`)
    expect(download.status()).toBe(200)
    expect(download.headers()["content-type"]).toBe("application/pdf")
    // M-03: sin reinterpretar el tipo, y con la CSP de la plataforma (script
    // por nonce): un archivo mostrado en el navegador no ejecuta scripts.
    expect(download.headers()["x-content-type-options"]).toBe("nosniff")
    const scriptSrc = /script-src ([^;]+)/.exec(download.headers()["content-security-policy"] ?? "")?.[1] ?? ""
    expect(scriptSrc).toMatch(/'nonce-[^']+'/)
    expect(scriptSrc).not.toContain("unsafe-inline")

    await page.getByRole("button", { name: `Rechazar ejecución Jun semana ${WEEK}` }).click()
    await page.getByPlaceholder(/^Motivo del rechazo/).fill(REJECTION)
    await page.getByRole("button", { name: "Rechazar y devolver" }).click()
    await expect(page.locator("[data-sonner-toast]").getByText(/rechazada/i)).toBeVisible()
    await expect.poll(async () => (await executionRow())?.status).toBe("rejected")
  })

  test("el autor reenvía con otro archivo y el anterior sigue referenciado", async ({ page }) => {
    const before = await executionRow()
    await login(page, AUTHOR)
    const dialog = await registerWithFile(page, pdf("acta-corregida"))
    await expect(dialog).not.toBeVisible()

    const after = await executionRow()
    expect(after?.status).toBe("submitted")
    expect(after?.evidence_url).not.toBe(before?.evidence_url)
    expect(after?.evidence_photos).toContain(before?.evidence_url)
  })

  test("otra persona aprueba y el detalle muestra el historial completo", async ({ page }) => {
    const row = await executionRow()
    await login(page)
    await page.goto("/prevencion/pdtp/aprobaciones")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await page.getByRole("button", { name: `Aprobar ejecución Jun semana ${WEEK}` }).click()
    await expect(page.locator("[data-sonner-toast]").getByText(/aprobada/)).toBeVisible()
    await expect.poll(async () => (await executionRow())?.status).toBe("approved")

    await page.goto(`/prevencion/pdtp/${PROGRAM_ID}/ejecucion/${row!.id}`)
    const history = page.getByRole("list", { name: "Historial de envíos" })
    const items = history.getByRole("listitem")
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toContainText("Enviado")
    await expect(items.nth(1)).toContainText("Rechazado")
    await expect(items.nth(1)).toContainText(REJECTION)
    await expect(items.nth(2)).toContainText("Reenviado")
    await expect(items.nth(2)).toContainText("Intento 2")
    await expect(items.nth(3)).toContainText("Aprobado")

    // El archivo del intento rechazado sigue descargable.
    const rejectedName = row!.evidence_photos[0]!.split("/").pop()!
    const download = await page.request.get(`/api/prevencion/pdtp/evidence/${rejectedName}`)
    expect(download.status()).toBe(200)
    await cerrarSesion(page)
  })
})
