/**
 * E2E: rediseño de Combustible «El mes como hilo» (2026-10-31).
 *
 * Cubre lo que sólo se ve en el navegador y que las pruebas unitarias no
 * pueden afirmar: que cada URL anterior al rediseño llegue a su pantalla nueva
 * (favoritos, notificaciones y QR impresos), que el período elegido viaje por
 * el menú y que el QR viejo `/tae/acceso/<token>` abra el formulario.
 *
 * La tabla de destinos completa, con sus parámetros, la prueba
 * `lib/combustibles/legacy-redirects.test.ts` fila por fila; aquí se recorre
 * una muestra por sección para comprobar que los puentes están conectados.
 *
 * Al final del archivo, tres flujos de punta a punta con datos propios (`QA_E2E`
 * / `REV-E2E-n`): registrar una carga de otro día y decidirla en «Por revisar»
 * (decidir, deshacer, decidir en lote), y los enlaces guardados en las
 * notificaciones de antes del rediseño.
 */
import { createHash } from "node:crypto"
import { expect, test, type Locator, type Page } from "@playwright/test"
import postgres from "postgres"
import AxeBuilder from "@axe-core/playwright"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { expectPageTitle, login, textoVisible } from "./helpers"
import {
  WORKSITE_ID,
  WORKSITE_NAME,
  equipmentLoad,
  escapeRegExp,
  expectCreated,
  fillFieldLoad,
  openInboxItem,
  pickSelect,
  postLoad,
  withSql,
  type PostLoadTarget,
} from "./combustibles-control-helpers"

const LEGACY_ACCESS_TOKEN = "tae-e2e-acceso-legacy"

test.describe("Combustible — URL anteriores al rediseño", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("cada ruta vieja llega a su pantalla nueva, con los filtros traducidos", async ({ page }) => {
    /** `[URL vieja, pathname nuevo, parámetros que deben llegar]`. */
    const puentes: ReadonlyArray<readonly [string, string, Record<string, string>]> = [
      ["/combustibles/bitacora?fuente=invoiced", "/combustibles/cargas", { como: "factura" }],
      ["/combustibles/tae?estado=observed", "/combustibles/cargas", { estado: "con-observacion" }],
      ["/combustibles/control/registrar?lugar=tae-point-e2e", "/combustibles/cargas/registrar", { punto: "tae-point-e2e" }],
      ["/combustibles/control/revision?estado=aprobadas", "/combustibles/revisar", { vista: "decididas", decision: "cuenta" }],
      ["/combustibles/anomalias", "/combustibles/revisar", { tipo: "caso" }],
      ["/combustibles/tae/conciliacion", "/combustibles/cuadratura/tarjeta-y-terreno", {}],
      ["/combustibles/ciclo", "/combustibles/cuadratura/estanques", {}],
      ["/combustibles/control/rendimiento/maquinaria?anio=2026&meses=9", "/combustibles/consumo/rendimiento/maquinaria", { periodo: "2026-09" }],
      ["/combustibles/control/ralenti", "/combustibles/consumo/motor-en-vacio", {}],
      ["/combustibles?vista=analisis", "/combustibles/consumo/litros", { seccion: "tarjetas" }],
      ["/combustibles/facturas", "/combustibles/pagos", {}],
      ["/combustibles/cuenta-corriente", "/combustibles/pagos/estados", {}],
      ["/combustibles/importar?tab=operaciones", "/combustibles/fuentes/agregar/planilla", {}],
      ["/combustibles/tae/importar/historial", "/combustibles/fuentes/archivos", { tipo: "sellos" }],
      ["/combustibles/control/configuracion", "/combustibles/ajustes/mandantes", {}],
      ["/combustibles/anomalias/reglas", "/combustibles/ajustes/reglas", {}],
    ]

    for (const [vieja, nueva, params] of puentes) {
      await page.goto(vieja)
      await expect.soft(page, `${vieja} debe llegar a ${nueva}`).toHaveURL((url) => url.pathname === nueva, { timeout: 20_000 })
      const url = new URL(page.url())
      for (const [key, value] of Object.entries(params)) {
        expect.soft(url.searchParams.get(key), `${vieja}: «${key}»`).toBe(value)
      }
    }
  })

  test("las entradas del menú sin pantalla propia abren su primera vista", async ({ page }) => {
    await page.goto("/combustibles/cuadratura")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/cuadratura/mandante")
    await page.goto("/combustibles/consumo")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/rendimiento/camiones")
    await page.goto("/combustibles/ajustes")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/ajustes/mandantes")
  })
})

test.describe("Combustible — período compartido", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el período elegido viaja por el menú y queda en el enlace", async ({ page }) => {
    await page.goto("/combustibles/cargas")
    const periodo = page.getByRole("group", { name: "Período" })
    await periodo.getByRole("button", { name: "Período anterior" }).click()
    await expect(page).toHaveURL(/[?&]periodo=/)
    const elegido = new URL(page.url()).searchParams.get("periodo")
    expect(elegido).toBeTruthy()

    // El ítem del menú no lleva parámetros: la pantalla siguiente lo recupera
    // de la cookie y lo escribe en su URL para que el enlace sea compartible.
    await page
      .getByRole("navigation", { name: "Navegación", exact: true })
      .locator('a[href="/combustibles/revisar"]')
      .click()
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/revisar" && url.searchParams.get("periodo") === elegido)
  })
})

test.describe("Combustible — QR impresos", () => {
  test.beforeAll(async () => {
    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await sql`
        insert into fuel_tae_loading_points (id, worksite_id, name, type, is_active)
        values ('tae-point-e2e', 'ws-e2e', 'Surtidor TAE E2E', 'tae', true)
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_tae_public_links (id, worksite_id, loading_point_id, label, token_hash, created_by)
        values ('tae-link-e2e-acceso-legacy', 'ws-e2e', 'tae-point-e2e', 'Acceso E2E (QR viejo)', ${createHash("sha256").update(LEGACY_ACCESS_TOKEN).digest("hex")}, 'user-admin-e2e')
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test("el QR con la ruta vieja /tae/acceso abre el formulario en terreno", async ({ page }) => {
    await page.goto(`/tae/acceso/${LEGACY_ACCESS_TOKEN}`)
    await expect(page).toHaveURL(/\/tae$/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Carga TAE" })).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Por revisar: registrar una carga de otro día, decidir, deshacer y decidir en lote
// ─────────────────────────────────────────────────────────────────────────────

/** Día civil de Chile desplazado `offsetDays` días de hoy (`YYYY-MM-DD`). */
function chileDay(offsetDays: number): string {
  const target = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(target)
}

/**
 * Tres equipos propios en `ws-e2e` y un punto de carga que no menciona ningún medio
 * (así el formulario no preselecciona uno y la prueba lo elige, como el operador):
 * 1 se registra por la pantalla, 2 y 3 por la API, y 4 sirve a los enlaces de las
 * notificaciones. Ninguno comparte historial con `CTL-E2E-1` ni con `E2E-FUEL-1`.
 */
const REV_POINT_ID = "rev-point-e2e"
const REV_POINT_NAME = "Surtidor revisión E2E"
const REV_VEHICLES = [1, 2, 3, 4, 5].map((n) => ({ id: `fuel-veh-rev-e2e-${n}`, code: `REV-E2E-${n}`, plate: `REVE2${n}` }))
type RevVehicle = typeof REV_VEHICLES[number]
const [REV_UI, REV_API_A, REV_API_B, REV_NOTIFICATIONS, REV_AXE] = REV_VEHICLES as [RevVehicle, RevVehicle, RevVehicle, RevVehicle, RevVehicle]
const revTarget = (vehicle: typeof REV_VEHICLES[number]): PostLoadTarget => ({ vehicle, pointId: REV_POINT_ID })
/** «CA-14 · KPRT·14»: así se rotula el equipo en «Por revisar» (`equipmentLabelOf`: código y patente). */
const equipmentLabel = (vehicle: typeof REV_VEHICLES[number]) => `${vehicle.code} · ${vehicle.plate}`

async function seedRevisionVehicles() {
  await withSql(async (sql) => {
    // Re-ejecutable sobre la misma base: lo que dejó una corrida anterior de ESTE spec se borra. Las cargas
    // arrastran por cascada su evidencia, sus movimientos de sello y su fila proyectada.
    await sql`delete from fuel_tae_submissions where vehicle_id in ${sql(REV_VEHICLES.map((vehicle) => vehicle.id))}`
    await sql`
      insert into fuel_tae_loading_points (id, worksite_id, name, type, is_active)
      values (${REV_POINT_ID}, ${WORKSITE_ID}, ${REV_POINT_NAME}, 'fixed_dispenser', true)
      on conflict (id) do nothing
    `
    for (const vehicle of REV_VEHICLES) {
      await sql`
        insert into fuel_vehicles (id, plate, code, type, equipment_type_id, meter_type, performance_unit, tank_capacity_liters, brand, model, year, worksite_id, operational_status, is_active)
        values (${vehicle.id}, ${vehicle.plate}, ${vehicle.code}, 'camion', 'fet-camion', 'odometer', 'km_per_liter', 300, 'Volvo', 'FMX REV E2E', 2024, ${WORKSITE_ID}, 'operativo', true)
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_vehicle_products (vehicle_id, product_id)
        values (${vehicle.id}, 'fuel-diesel')
        on conflict do nothing
      `
    }
  })
}

/** El botón de la fila de «Por revisar» se nombra «<Acción>: <qué pasó>, <equipo>» (`InboxList`). */
function inboxRowButton(page: Page, action: "Decidir" | "Deshacer", vehicle: typeof REV_VEHICLES[number]): Locator {
  return page.getByRole("button", { name: new RegExp(`^${action}: .+, ${escapeRegExp(equipmentLabel(vehicle))}$`) })
}

/** La hoja de decisión de una fila (`?item=`): se nombra con el equipo y la faena. */
function inboxSheet(page: Page, vehicle: typeof REV_VEHICLES[number]): Locator {
  return page.getByRole("dialog", { name: `${equipmentLabel(vehicle)} · ${WORKSITE_NAME}` })
}

/**
 * Elige un día en el calendario del bloque «¿Es una carga de otro día?». El calendario abre en el
 * mes de hoy (`DatePicker`), así que un día pasado está en ese mes o en uno anterior.
 */
async function pickPastDay(page: Page, trigger: Locator, isoDay: string) {
  await trigger.click()
  const calendar = page.getByRole("dialog").filter({ has: page.getByRole("grid") })
  await expect(calendar.getByRole("grid")).toBeVisible()
  const cell = calendar.locator(`[data-day="${isoDay}"]:not([data-outside]) button`)
  // La flecha «mes anterior» es el primer botón de la navegación del calendario.
  const previousMonth = calendar.getByRole("navigation").getByRole("button").first()
  for (let attempt = 0; attempt < 3 && (await cell.count()) === 0; attempt += 1) await previousMonth.click()
  await cell.click()
}

const UI_REASON = "QA_E2E: la carga se hizo ayer en la noche y no se alcanzó a registrar"
const DECIDE_NOTE = "QA_E2E: fecha confirmada con el operador del turno"
const UNDO_NOTE = "QA_E2E: faltaba la guía de despacho"
const BATCH_NOTE = "QA_E2E: cargas de otro día confirmadas en lote"

const revision: { uiSubmissionId?: string; uiLoadId?: string; apiLoadIds: string[] } = { apiLoadIds: [] }

test.describe.serial("Combustible — Por revisar: cargas de otro día, decidir, deshacer y decidir en lote", () => {
  test.beforeAll(seedRevisionVehicles)

  test("1 · una carga de otro día se registra desde «Registrar carga» y llega a «Por revisar» como «Registrada después»", async ({ page }) => {
    test.setTimeout(150_000)
    await login(page)
    await page.goto("/combustibles/cargas/registrar")
    await expect(page.getByText("Paso 1 de 7")).toBeVisible({ timeout: 20_000 })
    // Es la única faena con puntos de carga activos: queda elegida sin preguntar.
    await expect(page.locator("#registrar-faena")).toContainText(WORKSITE_NAME)
    if (!new RegExp(`punto=${REV_POINT_ID}`).test(page.url())) await pickSelect(page, "registrar-punto", REV_POINT_NAME)
    await expect(page).toHaveURL(new RegExp(`punto=${REV_POINT_ID}`))

    // El administrador tiene `register_past_load`: el bloque plegado está en el paso «Dónde».
    const otroDia = page.getByRole("button", { name: /^¿Es una carga de otro día\?/ })
    await expect(async () => {
      if ((await otroDia.getAttribute("aria-expanded")) !== "true") await otroDia.click({ timeout: 3_000 })
      await expect(otroDia).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })

    // Sin motivo ni fecha no se avanza, y el aviso dice qué falta.
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()
    await expect(textoVisible(page, "Indica la fecha y la hora en que se hizo la carga.")).toBeVisible()

    const day = chileDay(-3)
    await pickPastDay(page, page.locator("#registrar-otro-dia-fecha-date"), day)
    await page.locator("#registrar-otro-dia-fecha-time").fill("10:30")
    await page.locator("#registrar-otro-dia-motivo").fill(UI_REASON)
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()

    // Las fotos son opcionales en una carga de otro día: el formulario avanza sin ellas.
    await fillFieldLoad(page, 80_000, "REV-1000", "REV-1001", { stepsBefore: 1, vehicleCode: REV_UI.code, withPhotos: false })
    // «Cambiar» lleva un rótulo sr-only con el mismo texto en minúscula: la coincidencia exacta distingue la fila del botón.
    await expect(page.getByText("Fecha de la carga", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Enviar carga" }).click()
    await expect(page.getByRole("heading", { name: "Carga registrada" })).toBeVisible({ timeout: 45_000 })
    await expect(textoVisible(page, "Quedó por decidir")).toBeVisible()
    await expect(textoVisible(page, "Registrada después (fecha pasada).")).toBeVisible()

    const [submission] = await withSql((sql) => sql<Array<{ id: string; source: string; loaded_at_source: string; backdate_reason: string | null; loaded_day: string }>>`
      select id, source, loaded_at_source, backdate_reason, to_char(loaded_at at time zone 'America/Santiago', 'YYYY-MM-DD') as loaded_day
      from fuel_tae_submissions where vehicle_id = ${REV_UI.id}
    `)
    expect(submission).toMatchObject({ source: "internal_app", loaded_at_source: "backdated", backdate_reason: UI_REASON, loaded_day: day })
    revision.uiSubmissionId = submission!.id
    const projected = await equipmentLoad(submission!.id)
    expect(projected).toMatchObject({ review_status: "flagged" })
    expect(projected!.flag_reasons).toContain("late_entry")
    revision.uiLoadId = projected!.id

    // «Ir a Por revisar» abre la bandeja con la hoja de ESA carga ya abierta (`?item=carga:<id>`).
    await page.getByRole("link", { name: "Ir a Por revisar" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/revisar" && url.searchParams.get("item") === `carga:${revision.uiLoadId}`)
    const sheet = inboxSheet(page, REV_UI)
    await expect(sheet).toBeVisible({ timeout: 20_000 })
    await expect(sheet.getByText("Registrada después (fecha pasada)")).toBeVisible()
    await expect(sheet.getByText(/Motivo de la persona que la anotó/)).toContainText(UI_REASON)
    // Aún nadie la decidió: la hoja ofrece decidir, no deshacer.
    await expect(sheet.getByRole("radio", { name: "Cuenta", exact: true })).toBeVisible()
    await expect(sheet.getByRole("radio", { name: "No cuenta", exact: true })).toBeVisible()
  })

  test("2 · decidir una carga por decidir: «Cuenta» con su nota, sin pedir confirmación", async ({ page }) => {
    expect(revision.uiLoadId, "depende de la prueba 1").toBeTruthy()
    await login(page)
    await page.goto("/combustibles/revisar?tipo=carga&faena=ws-e2e")

    const decide = inboxRowButton(page, "Decidir", REV_UI)
    await expect(decide).toHaveCount(1, { timeout: 20_000 })
    const row = page.getByRole("listitem").filter({ has: decide })
    await expect(row).toContainText("Registrada después (fecha pasada)")
    await expect(row).toContainText("Cargada el")

    const sheet = inboxSheet(page, REV_UI)
    await openInboxItem(page, decide, sheet)
    // La nota es obligatoria (10 a 500 caracteres): con una corta el botón no se habilita.
    const confirm = sheet.getByRole("button", { name: "Confirmar decisión" })
    await sheet.getByRole("radio", { name: "Cuenta", exact: true }).click()
    await sheet.getByRole("textbox", { name: "Nota de la decisión" }).fill("corta")
    await expect(confirm).toBeDisabled()
    await sheet.getByRole("textbox", { name: "Nota de la decisión" }).fill(DECIDE_NOTE)
    await expect(confirm).toBeEnabled()
    await confirm.click()
    // Decidir es rutina: no hay diálogo de confirmación, la hoja se cierra sola.
    await expect(sheet).toBeHidden({ timeout: 20_000 })
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await expect(decide).toHaveCount(0, { timeout: 20_000 })

    const [decided] = await withSql((sql) => sql<Array<{ review_status: string; review_note: string | null; reviewed_by: string | null }>>`
      select review_status, review_note, reviewed_by from fuel_equipment_loads where id = ${revision.uiLoadId!}
    `)
    expect(decided).toMatchObject({ review_status: "approved", review_note: DECIDE_NOTE, reviewed_by: "user-admin-e2e" })

    // Ahora está en «Decididas», con su nota y la decisión en palabras.
    await page.goto("/combustibles/revisar?vista=decididas&tipo=carga&faena=ws-e2e")
    const undo = inboxRowButton(page, "Deshacer", REV_UI)
    await expect(undo).toHaveCount(1, { timeout: 20_000 })
    const decidedRow = page.getByRole("listitem").filter({ has: undo })
    await expect(decidedRow).toContainText("Cuenta")
    await expect(decidedRow).toContainText(DECIDE_NOTE)
  })

  test("3 · deshacer la decisión pide una nota de 10 o más caracteres, no una confirmación, y la carga vuelve a «Pendientes»", async ({ page }) => {
    expect(revision.uiLoadId, "depende de la prueba 2").toBeTruthy()
    await login(page)
    await page.goto("/combustibles/revisar?vista=decididas&tipo=carga&faena=ws-e2e")

    const undo = inboxRowButton(page, "Deshacer", REV_UI)
    await expect(undo).toHaveCount(1, { timeout: 20_000 })
    const sheet = inboxSheet(page, REV_UI)
    await openInboxItem(page, undo, sheet)
    await expect(sheet.getByText(DECIDE_NOTE, { exact: false })).toBeVisible()

    // El primer botón abre el campo de la nota (un formulario, no un diálogo); su nombre dice sobre qué carga.
    await sheet.getByRole("button", { name: /^Deshacer la decisión sobre/ }).click()
    const submit = sheet.getByRole("button", { name: "Deshacer decisión", exact: true })
    await sheet.getByRole("textbox", { name: "¿Por qué se deshace?" }).fill("corta")
    await expect(submit).toBeDisabled()
    await expect(textoVisible(page, /Escribe al menos 10 caracteres/)).toBeVisible()
    await sheet.getByRole("textbox", { name: "¿Por qué se deshace?" }).fill(UNDO_NOTE)
    await expect(submit).toBeEnabled()
    await submit.click()
    // Sin diálogo de confirmación: la única superficie modal es la propia hoja.
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await expect(page.getByRole("dialog")).toHaveCount(1)

    // «Registrada después» es una marca de origen: sobrevive a la decisión, así que la carga vuelve a estar por decidir.
    await expect.poll(async () => (await equipmentLoad(revision.uiSubmissionId!))?.review_status, { timeout: 20_000 }).toBe("flagged")
    const [audit] = await withSql((sql) => sql<Array<{ n: number }>>`
      select count(*)::int as n from audit_log
      where entity_type = 'fuel_equipment_load' and entity_id = ${revision.uiLoadId!} and reason = ${UNDO_NOTE}
    `)
    expect(audit!.n).toBe(1)

    await page.goto("/combustibles/revisar?tipo=carga&faena=ws-e2e")
    await expect(inboxRowButton(page, "Decidir", REV_UI)).toHaveCount(1, { timeout: 20_000 })
  })

  test("4 · decidir en lote: varias cargas con una nota común y una auditoría por carga", async ({ page }) => {
    test.setTimeout(150_000)
    expect(revision.uiLoadId, "depende de la prueba 3").toBeTruthy()
    await login(page)

    // Dos cargas más de otro día, por la API autenticada y sin fotos (que una carga de otro día no exige).
    const day = chileDay(-4)
    for (const [vehicle, reading, liters] of [[REV_API_A, 60_000, 90], [REV_API_B, 70_000, 75]] as const) {
      const id = await expectCreated(await postLoad(
        page,
        { reading, removed: `REV-${vehicle.code.slice(-1)}000`, installed: `REV-${vehicle.code.slice(-1)}001` },
        { target: revTarget(vehicle), pastLoad: { loadedAt: `${day}T09:00`, reason: "QA_E2E: carga de otro día para decidir en lote" }, withPhotos: false, liters },
      ))
      const load = await equipmentLoad(id)
      expect(load).toMatchObject({ review_status: "flagged" })
      expect(load!.flag_reasons).toContain("late_entry")
      revision.apiLoadIds.push(load!.id)
    }

    await page.goto("/combustibles/revisar?tipo=carga&faena=ws-e2e")
    const checkbox = (vehicle: typeof REV_VEHICLES[number]) => page.getByRole("checkbox", { name: `Seleccionar la carga de ${equipmentLabel(vehicle)} para decidir en lote` })
    const bar = page.getByRole("region", { name: "Decidir las cargas seleccionadas" })
    await expect(checkbox(REV_UI)).toBeVisible({ timeout: 20_000 })

    // Un clic anterior a la hidratación marca la casilla del navegador pero no la selección de React: se
    // desmarca y se vuelve a marcar hasta que aparece la barra de decisión en lote.
    const primera = checkbox(REV_UI)
    await expect(async () => {
      if (await bar.isVisible()) return
      await primera.setChecked(false, { timeout: 3_000 })
      await primera.check({ timeout: 3_000 })
      await expect(bar).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    await checkbox(REV_API_A).check()
    await checkbox(REV_API_B).check()
    await expect(bar.getByText("3 seleccionadas")).toBeVisible()

    // La nota es común y obligatoria: sin ella no se decide.
    const cuentan = bar.getByRole("button", { name: "Cuentan", exact: true })
    await expect(cuentan).toBeDisabled()
    await bar.getByRole("textbox", { name: /^Nota común de la decisión/ }).fill(BATCH_NOTE)
    await expect(cuentan).toBeEnabled()
    await cuentan.click()
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await expect(bar).toBeHidden({ timeout: 20_000 })

    const ids = [revision.uiLoadId!, ...revision.apiLoadIds]
    const decided = await withSql((sql) => sql<Array<{ id: string; review_status: string; review_note: string | null }>>`
      select id, review_status, review_note from fuel_equipment_loads where id in ${sql(ids)}
    `)
    expect(decided).toHaveLength(3)
    for (const load of decided) expect(load, `carga ${load.id}`).toMatchObject({ review_status: "approved", review_note: BATCH_NOTE })
    const audits = await withSql((sql) => sql<Array<{ entity_id: string }>>`
      select entity_id from audit_log
      where entity_type = 'fuel_equipment_load' and entity_id in ${sql(ids)} and reason = ${BATCH_NOTE}
    `)
    expect(audits.map((row) => row.entity_id).sort()).toEqual([...ids].sort())

    // Ninguna queda por decidir (así esta prueba no deja pendientes que otros specs cuenten).
    for (const vehicle of [REV_UI, REV_API_A, REV_API_B]) {
      await expect(inboxRowButton(page, "Decidir", vehicle)).toHaveCount(0, { timeout: 20_000 })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Enlaces guardados en notificaciones de antes del rediseño
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notifications.entity_href` guarda la URL de entonces, y una notificación vieja se abre meses después:
 * detalle TAE (`/combustibles/tae/<id>`), carga facturada (`/combustibles/<id>`), estado de cuenta
 * (`/combustibles/cuenta-corriente/<id>`) e historial (`/combustibles/bitacora/historial/<tipo>/<id>`).
 * Cada una se abre como la abre la persona, desde la campana, y debe terminar en su ficha nueva.
 */
const NTF_LOAD_ID = "fuel-load-rediseno-ntf-e2e"
const NTF_STATEMENT_ID = "fuel-stmt-rediseno-ntf-e2e"

test.describe.serial("Combustible — enlaces guardados en las notificaciones", () => {
  test.beforeAll(async () => {
    await seedRevisionVehicles()
    await withSql(async (sql) => {
      // Una carga facturada en borrador (no suma a ninguna cifra) y un estado de cuenta de un mes pasado, sin cargas.
      await sql`
        insert into fuel_loads (id, load_date, month, service_type, vehicle_id, fuel_supplier_id, worksite_id, product, product_id, receipt_number, liters, base_amount, iva_amount, total_amount, status, created_by)
        values (${NTF_LOAD_ID}, '2026-01-15', '2026-01', 'TCT', 'fuel-veh-e2e', 'fuel-sup-e2e', ${WORKSITE_ID}, 'PETROLEO DIESEL', 'fuel-diesel', 'QA_E2E-NTF', 100, 100000, 19000, 119000, 'draft', 'user-admin-e2e')
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_monthly_statements (id, month, fuel_supplier_id, status, created_by)
        values (${NTF_STATEMENT_ID}, '2026-01', 'fuel-sup-e2e', 'open', 'user-admin-e2e')
        on conflict (id) do nothing
      `
    })
  })

  test("detalle TAE, carga facturada, estado de cuenta e historial llegan a su ficha nueva", async ({ page }) => {
    test.setTimeout(150_000)
    await login(page)

    // Una carga de terreno real para el detalle TAE y el historial (con fotos: no es de otro día).
    const submissionId = await expectCreated(await postLoad(page, { reading: 90_000, removed: "REV-4000", installed: "REV-4001" }, { target: revTarget(REV_NOTIFICATIONS) }))

    const enlaces = [
      { clave: "tae", titulo: "QA_E2E enlace guardado: detalle TAE", href: `/combustibles/tae/${submissionId}`, destino: `/combustibles/cargas/terreno/${submissionId}`, ficha: new RegExp(`^Carga de ${escapeRegExp(REV_NOTIFICATIONS.code)}`) },
      { clave: "factura", titulo: "QA_E2E enlace guardado: carga facturada", href: `/combustibles/${NTF_LOAD_ID}`, destino: `/combustibles/cargas/factura/${NTF_LOAD_ID}`, ficha: /^Carga de / },
      { clave: "estado", titulo: "QA_E2E enlace guardado: estado de cuenta", href: `/combustibles/cuenta-corriente/${NTF_STATEMENT_ID}`, destino: `/combustibles/pagos/estados/${NTF_STATEMENT_ID}`, ficha: /^Proveedor Combustible E2E · / },
      { clave: "historial", titulo: "QA_E2E enlace guardado: historial", href: `/combustibles/bitacora/historial/fuel_tae_submission/${submissionId}`, destino: `/combustibles/cargas/terreno/${submissionId}/historial`, ficha: new RegExp(`^Historial de la carga de ${escapeRegExp(REV_NOTIFICATIONS.code)}`) },
    ] as const

    // Las notificaciones se siembran con el href de ANTES; `created_at` = ahora para que queden arriba de la lista de la campana.
    await withSql(async (sql) => {
      for (const enlace of enlaces) {
        await sql`
          insert into notifications (id, user_id, type, title, body, entity_type, entity_id, entity_href, is_read)
          values (${`notif-rediseno-${enlace.clave}-e2e`}, 'user-admin-e2e', 'system_alert', ${enlace.titulo}, 'Enlace guardado antes del rediseño de Combustible', null, null, ${enlace.href}, false)
          on conflict (id) do update set entity_href = excluded.entity_href, title = excluded.title, is_read = false, created_at = now()
        `
      }
    })

    for (const enlace of enlaces) {
      await page.goto("/dashboard")
      const campana = page.getByRole("button", { name: /^Notificaciones/ })
      const fila = page.getByRole("link", { name: new RegExp(escapeRegExp(enlace.titulo)) })
      // Un clic anterior a la hidratación no abre la campana: se repite sólo mientras la lista no esté a la vista.
      await expect(async () => {
        if (!(await fila.isVisible())) await campana.click({ timeout: 3_000 })
        await expect(fila).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 30_000 })
      await expect(fila).toHaveAttribute("href", enlace.href)
      await fila.click()

      await expect.soft(page, `${enlace.href} debe terminar en ${enlace.destino}`).toHaveURL((url) => url.pathname === enlace.destino, { timeout: 30_000 })
      await expectPageTitle(page, enlace.ficha)
    }
  })
})

/**
 * Las fichas dinámicas del rediseño no entran al recorrido de `accessibility.spec.ts`: su
 * `ROUTE_URL_OVERRIDES` sólo admite ids del sembrado, y sembrar una carga, un estado de cuenta o
 * un archivo en `setup-db.ts` cambiaría los estados vacíos que verifican otras especificaciones.
 * Se auditan aquí, con datos propios y las mismas reglas.
 */
const AXE_LOAD_ID = "fuel-load-rediseno-axe-e2e"
const AXE_STATEMENT_ID = "fuel-stmt-rediseno-axe-e2e"
const AXE_BATCH_ID = "fuel-batch-rediseno-axe-e2e"

test.describe.serial("Combustible — accesibilidad de las fichas (axe)", () => {
  test.beforeAll(async () => {
    await seedRevisionVehicles()
    await withSql(async (sql) => {
      await sql`
        insert into fuel_loads (id, load_date, month, service_type, vehicle_id, fuel_supplier_id, worksite_id, product, product_id, receipt_number, liters, base_amount, iva_amount, total_amount, status, created_by)
        values (${AXE_LOAD_ID}, '2026-02-15', '2026-02', 'TCT', 'fuel-veh-e2e', 'fuel-sup-e2e', ${WORKSITE_ID}, 'PETROLEO DIESEL', 'fuel-diesel', 'QA_E2E-AXE', 100, 100000, 19000, 119000, 'draft', 'user-admin-e2e')
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_monthly_statements (id, month, fuel_supplier_id, status, created_by)
        values (${AXE_STATEMENT_ID}, '2026-02', 'fuel-sup-e2e', 'open', 'user-admin-e2e')
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_import_batches (id, worksite_id, fuente, periodo_desde, periodo_hasta, archivo_nombre, hash_archivo, importado_por)
        values (${AXE_BATCH_ID}, ${WORKSITE_ID}, 'Copec TCT Diesel', '2026-02-01', '2026-02-28', 'QA_E2E-axe.xlsx', 'qa-e2e-axe-hash', 'user-admin-e2e')
        on conflict (id) do nothing
      `
    })
  })

  test("ficha de carga (terreno y factura), estado de cuenta y archivo importado sin violaciones", async ({ page }) => {
    test.setTimeout(150_000)
    await login(page)
    const submissionId = await expectCreated(await postLoad(page, { reading: 50_000, removed: "REV-5000", installed: "REV-5001" }, { target: revTarget(REV_AXE) }))

    const fichas = [
      `/combustibles/cargas/terreno/${submissionId}`,
      `/combustibles/cargas/factura/${AXE_LOAD_ID}`,
      `/combustibles/pagos/estados/${AXE_STATEMENT_ID}`,
      `/combustibles/fuentes/archivos/tarjeta/${AXE_BATCH_ID}`,
    ]
    for (const ficha of fichas) {
      await page.goto(ficha)
      await page.waitForLoadState("networkidle")
      expect.soft(new URL(page.url()).pathname, `${ficha} no debe redirigir`).toBe(ficha)
      const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).analyze()
      expect.soft(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`), ficha).toEqual([])
    }
  })
})
