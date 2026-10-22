import { expect, test } from "@playwright/test"
import { login, textoVisible } from "./helpers"
import {
  VEHICLE_ID,
  VEHICLE_CODE,
  VEHICLE_PLATE,
  WORKSITE_ID,
  WORKSITE_NAME,
  POINT_ID,
  POINT_NAME,
  MANDANTE_ID,
  MEDIUM_ID,
  MEDIUM_NAME,
  PRODUCT_ID,
  GUIDE_REFERENCE,
  IMPORT_FILE_NAME,
  NO_FUEL_USER,
  R0,
  LITERS,
  HISTORY_KM_PER_LITER,
  OUTLIER_KM_PER_LITER,
  twoDecimals,
  litersText,
  average,
  withSql,
  parseLiters,
  postLoad,
  expectCreated,
  submissionRow,
  equipmentLoad,
  equipmentRow,
  pickSelect,
  fillFieldLoad,
  buildSupplyWorkbook,
  openSupplyImportPreview,
  flowFigure,
} from "./combustibles-control-helpers"

/**
 * Control de combustible, de punta a punta y con estado: registrar en terreno
 * (UI y API autenticada), cadena de sellos, rendimiento con atípico, revisión
 * humana que lo devuelve al promedio, importación de entradas del proveedor con
 * su conciliación por mandante, y autorización de la API sin pasar por la UI.
 *
 * Todo cuelga de un equipo propio (`fuel-veh-ctl-e2e`) en `ws-e2e`: así ningún
 * otro spec mueve sus promedios, y este spec no mueve los de nadie. Las cifras
 * esperadas salen de los datos que se registran aquí, no de la base.
 */

const state: {
  uiSubmissionId?: string
  uiEvidenceId?: string
  outlierSubmissionId?: string
  meanBeforeApproval?: string
} = {}

test.describe.serial("Control de combustible — registro, revisión y conciliación", () => {
  test.beforeAll(async () => {
    await withSql(async (sql) => {
      // Re-ejecutable sobre la misma base (servidor reutilizado): se borra lo que
      // dejó una corrida anterior de ESTE spec. Las cargas arrastran por cascada
      // su evidencia, sus movimientos de sello y su fila proyectada.
      await sql`delete from fuel_tae_submissions where vehicle_id = ${VEHICLE_ID}`
      await sql`
        delete from fuel_control_import_batches
        where id in (select batch_id from fuel_supply_inputs where reference = ${GUIDE_REFERENCE} and batch_id is not null)
           or (kind = 'supply_inputs' and file_name = ${IMPORT_FILE_NAME})
      `
      await sql`delete from fuel_supply_inputs where reference = ${GUIDE_REFERENCE}`

      await sql`
        insert into fuel_vehicles (id, plate, code, type, equipment_type_id, meter_type, performance_unit, tank_capacity_liters, brand, model, year, worksite_id, operational_status, is_active)
        values (${VEHICLE_ID}, ${VEHICLE_PLATE}, ${VEHICLE_CODE}, 'camion', 'fet-camion', 'odometer', 'km_per_liter', 300, 'Volvo', 'FMX CTL E2E', 2024, ${WORKSITE_ID}, 'operativo', true)
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_vehicle_products (vehicle_id, product_id)
        values (${VEHICLE_ID}, ${PRODUCT_ID})
        on conflict do nothing
      `
      await sql`
        insert into fuel_tae_loading_points (id, worksite_id, name, type, is_active)
        values (${POINT_ID}, ${WORKSITE_ID}, ${POINT_NAME}, 'fixed_dispenser', true)
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_mandantes (id, name, tolerance_pct, is_active)
        values (${MANDANTE_ID}, 'Mandante CTL E2E', 2, true)
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_mandante_worksites (worksite_id, mandante_id)
        values (${WORKSITE_ID}, ${MANDANTE_ID})
        on conflict (worksite_id) do update set mandante_id = excluded.mandante_id
      `
    })
  })

  test("1 · registra una carga con sellos desde la app", async ({ page }) => {
    test.setTimeout(150_000)
    await login(page)
    await page.goto("/combustibles/control/registrar")
    await pickSelect(page, "registrar-faena", WORKSITE_NAME)
    await expect(page).toHaveURL(/faena=ws-e2e/)
    // Con un solo lugar activo en la faena queda elegido solo; con más, se elige.
    if (!/lugar=ctl-point-e2e/.test(page.url())) await pickSelect(page, "registrar-lugar", POINT_NAME)
    await expect(page).toHaveURL(/lugar=ctl-point-e2e/)

    await fillFieldLoad(page, R0, "CTL-1000", "CTL-1001")
    await page.getByRole("button", { name: "Enviar carga" }).click()
    await expect(page.getByRole("heading", { name: "Carga registrada" })).toBeVisible({ timeout: 45_000 })

    const rows = await withSql((sql) => sql<Array<{ id: string; source: string; loaded_at_source: string; seal_chain_status: string; meter_reading: string; liters: string; supply_medium_id: string }>>`
      select id, source, loaded_at_source, seal_chain_status, meter_reading::text, liters::text, supply_medium_id
      from fuel_tae_submissions where vehicle_id = ${VEHICLE_ID}
    `)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({ source: "internal_app", loaded_at_source: "server", seal_chain_status: "no_previous", supply_medium_id: MEDIUM_ID })
    expect(Number(row!.meter_reading)).toBe(R0)
    expect(Number(row!.liters)).toBe(LITERS)
    state.uiSubmissionId = row!.id

    const projected = await equipmentLoad(row!.id)
    expect(projected, "la carga debe proyectarse a fuel_equipment_loads").toBeTruthy()
    expect(projected).toMatchObject({ source: "field", performance_status: "first_load", review_status: "ok" })

    const evidence = await withSql((sql) => sql<Array<{ id: string; kind: string }>>`
      select id, kind from fuel_tae_evidence where submission_id = ${row!.id} order by kind
    `)
    expect(evidence.map((item) => item.kind).sort()).toEqual(["installed_seal", "liter_meter", "odometer", "removed_seal"])
    state.uiEvidenceId = evidence.find((item) => item.kind === "odometer")!.id
  })

  test("2 · la carga siguiente valida la cadena de sellos y no rechaza un sello roto", async ({ page }) => {
    expect(state.uiSubmissionId, "depende de la prueba 1").toBeTruthy()
    await login(page)

    const okId = await expectCreated(await postLoad(page, { reading: R0 + 1000, removed: "CTL-1001", installed: "CTL-1002" }))
    expect(await submissionRow(okId)).toMatchObject({ source: "internal_app", loaded_at_source: "server", seal_chain_status: "ok" })

    // Se retira un sello que no es el instalado en la carga anterior: alerta, nunca rechazo.
    const brokenId = await expectCreated(await postLoad(page, { reading: R0 + 2050, removed: "CTL-9999", installed: "CTL-1003" }))
    expect(await submissionRow(brokenId)).toMatchObject({ seal_chain_status: "mismatch", seal_chain_expected: "CTL-1002" })
  })

  test("3 · con historial suficiente marca la carga atípica y rechaza el retroceso del medidor", async ({ page }) => {
    await login(page)
    // Las cargas 2 y 3 ya rindieron 10 y 10,5 km/L; faltan 9,5 · 10,2 · 9,8.
    let reading = R0 + 2050
    let installed = "CTL-1003"
    let seal = 1004
    for (const kmPerLiter of HISTORY_KM_PER_LITER.slice(2)) {
      reading += kmPerLiter * LITERS
      const id = await expectCreated(await postLoad(page, { reading, removed: installed, installed: `CTL-${seal}` }))
      installed = `CTL-${seal}`
      seal += 1
      expect(await equipmentLoad(id)).toMatchObject({ performance_status: "computed", review_status: "ok" })
    }

    const values = await withSql((sql) => sql<Array<{ value: string }>>`
      select performance_value::text as value from fuel_equipment_loads
      where vehicle_id = ${VEHICLE_ID} and performance_status = 'computed' and review_status in ('ok', 'approved')
      order by occurred_at
    `)
    expect(values.map((row) => Number(row.value))).toEqual(HISTORY_KM_PER_LITER)

    reading += OUTLIER_KM_PER_LITER * LITERS
    const outlierId = await expectCreated(await postLoad(page, { reading, removed: installed, installed: `CTL-${seal}` }))
    state.outlierSubmissionId = outlierId
    const outlier = await equipmentLoad(outlierId)
    expect(outlier).toMatchObject({ performance_status: "computed", review_status: "flagged" })
    expect(Number(outlier!.performance_value)).toBe(OUTLIER_KM_PER_LITER)
    expect(outlier!.flag_reasons).toContain("outlier")
    expect(outlier!.flag_reasons).not.toContain("implausible")

    // Una lectura menor que la última se rechaza al registrar (422), y no deja rastro.
    const before = await withSql((sql) => sql<Array<{ n: number }>>`select count(*)::int as n from fuel_tae_submissions where vehicle_id = ${VEHICLE_ID}`)
    const regression = await postLoad(page, { reading: reading - 500, removed: `CTL-${seal}`, installed: `CTL-${seal + 1}` })
    const regressionBody = await regression.json() as { ok: boolean; code?: string; field?: string; message?: string }
    expect(regression.status(), JSON.stringify(regressionBody)).toBe(422)
    expect(regressionBody).toMatchObject({ ok: false, code: "meter_regression", field: "meterReading" })
    const after = await withSql((sql) => sql<Array<{ n: number }>>`select count(*)::int as n from fuel_tae_submissions where vehicle_id = ${VEHICLE_ID}`)
    expect(after[0]!.n).toBe(before[0]!.n)
  })

  test("4 · el tablero de camiones muestra el equipo y deja la atípica fuera del promedio", async ({ page }) => {
    await login(page)
    await page.goto(`/combustibles/control/rendimiento/camiones?equipo=${VEHICLE_PLATE}`)
    const row = equipmentRow(page)
    await expect(row).toHaveCount(1, { timeout: 20_000 })
    const cells = row.getByRole("cell")
    await expect(cells.nth(1)).toHaveText(VEHICLE_CODE)
    await expect(cells.nth(2)).toHaveText(VEHICLE_PLATE)
    // Cargas válidas: las cinco del historial; la primera no rinde y la atípica espera revisión.
    await expect(cells.nth(7)).toHaveText(String(HISTORY_KM_PER_LITER.length))
    const mean = (await cells.nth(8).innerText()).trim()
    expect(mean).toBe(twoDecimals.format(average(HISTORY_KM_PER_LITER)))
    state.meanBeforeApproval = mean
    await expect(textoVisible(page, /1 carga en revisión no entra al promedio/).first()).toBeVisible()
  })

  test("5 · aprobar la atípica la devuelve al promedio y queda auditada", async ({ page }) => {
    expect(state.outlierSubmissionId, "depende de la prueba 3").toBeTruthy()
    const load = await equipmentLoad(state.outlierSubmissionId!)
    await login(page)
    await page.goto("/combustibles/control/revision")

    const approve = page.getByRole("button", { name: new RegExp(`^Aprobar carga de ${VEHICLE_CODE}`) })
    await expect(approve).toHaveCount(1, { timeout: 20_000 })
    const queueRow = page.getByRole("row").filter({ has: approve })
    await expect(queueRow).toContainText("Rendimiento atípico para el equipo")

    await expect(async () => {
      await approve.click()
      await expect(page.getByRole("dialog", { name: "Aprobar carga" })).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    const dialog = page.getByRole("dialog", { name: "Aprobar carga" })
    await dialog.getByRole("textbox").fill("Ruta larga en carretera, verificado con GPS (E2E).")
    await dialog.getByRole("button", { name: "Aprobar carga", exact: true }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expect(approve).toHaveCount(0, { timeout: 20_000 })

    const decided = await withSql((sql) => sql<Array<{ review_status: string; review_note: string | null; reviewed_by: string | null }>>`
      select review_status, review_note, reviewed_by from fuel_equipment_loads where id = ${load!.id}
    `)
    expect(decided[0]).toMatchObject({ review_status: "approved", reviewed_by: "user-admin-e2e" })
    const audit = await withSql((sql) => sql<Array<{ action: string; reason: string | null; user_id: string | null }>>`
      select action, reason, user_id from audit_log
      where entity_type = 'fuel_equipment_load' and entity_id = ${load!.id}
    `)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "status_change", user_id: "user-admin-e2e" })
    expect(audit[0]!.reason).toContain("verificado con GPS")

    await page.goto(`/combustibles/control/rendimiento/camiones?equipo=${VEHICLE_PLATE}`)
    const cells = equipmentRow(page).getByRole("cell")
    await expect(cells.nth(7)).toHaveText(String(HISTORY_KM_PER_LITER.length + 1), { timeout: 20_000 })
    const expectedMean = twoDecimals.format(average([...HISTORY_KM_PER_LITER, OUTLIER_KM_PER_LITER]))
    await expect(cells.nth(8)).toHaveText(expectedMean)
    expect(expectedMean).not.toBe(state.meanBeforeApproval)
    await expect(textoVisible(page, "Ninguna carga en revisión queda fuera del promedio.").first()).toBeVisible()
  })

  test("6 · importa las entradas del proveedor y la conciliación por mandante las refleja", async ({ page }) => {
    test.setTimeout(150_000)
    await login(page)
    const sellosUrl = `/combustibles/control/sellos?mandante=${MANDANTE_ID}`

    await page.goto(sellosUrl)
    await expect(textoVisible(page, "Mandante CTL E2E").first()).toBeVisible({ timeout: 20_000 })
    const inputBefore = parseLiters(await flowFigure(page, "Entrada").innerText())

    const file = await buildSupplyWorkbook()
    const preview = await openSupplyImportPreview(page, file)
    await expect(preview.getByText("Primeras filas válidas")).toBeVisible()
    await expect(preview.getByRole("button", { name: /Confirmar importación \(1 filas\)/ })).toBeEnabled()
    await preview.getByRole("button", { name: /Confirmar importación/ }).click()
    const done = page.getByRole("dialog", { name: "Importación terminada" })
    await expect(done).toBeVisible({ timeout: 30_000 })
    await expect(done.getByText(/1 fila nueva/)).toBeVisible()
    // Dos «Cerrar» visibles: el del pie y la X del diálogo (rótulo sr-only). Ambos cierran; se usa el del pie.
    await done.getByRole("button", { name: "Cerrar" }).first().click()
    await expect(done).toBeHidden()

    const inputs = await withSql((sql) => sql<Array<{ liters: string; worksite_id: string; supply_medium_id: string }>>`
      select liters::text, worksite_id, supply_medium_id from fuel_supply_inputs where reference = ${GUIDE_REFERENCE}
    `)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ worksite_id: WORKSITE_ID, supply_medium_id: MEDIUM_ID })
    expect(Number(inputs[0]!.liters)).toBe(1000)

    await page.goto(sellosUrl)
    const entrada = flowFigure(page, "Entrada")
    await expect(entrada).toBeVisible({ timeout: 20_000 })
    expect(parseLiters(await entrada.innerText()) - inputBefore).toBe(1000)
    await expect(flowFigure(page, "Diferencia")).toHaveText(/^[−-]?[\d.]+(,\d)? L$/)

    // C-03: el medio informa 1.000 L contra lo registrado en terreno con ese medio.
    const fieldLiters = await withSql(async (sql) => {
      const [row] = await sql<Array<{ liters: number }>>`
        select coalesce(sum(liters), 0)::float8 as liters from fuel_tae_submissions
        where worksite_id = ${WORKSITE_ID} and supply_medium_id = ${MEDIUM_ID} and status <> 'voided'
          and extract(year from loaded_at at time zone 'America/Santiago') = extract(year from now() at time zone 'America/Santiago')
      `
      return row!.liters
    })
    expect(fieldLiters).toBeGreaterThanOrEqual(7 * LITERS)
    const mediumRow = page.locator('div[role="region"][aria-label="Cruce por medio de suministro"]').getByRole("row").filter({ hasText: MEDIUM_NAME })
    await expect(mediumRow).toHaveCount(1)
    const mediumCells = mediumRow.getByRole("cell")
    await expect(mediumCells.nth(1)).toContainText(litersText(fieldLiters))
    await expect(mediumCells.nth(2)).toHaveText(litersText(1000))
    await expect(mediumCells.nth(3)).toHaveText(litersText(1000 - fieldLiters))

    // Reimportar el mismo archivo se bloquea: el contenido ya entró en un lote vigente.
    const again = await openSupplyImportPreview(page, file)
    await expect(again.getByRole("alert").filter({ hasText: "Este archivo ya fue importado" })).toBeVisible()
    await expect(again.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled()
    const stillOne = await withSql((sql) => sql<Array<{ n: number }>>`select count(*)::int as n from fuel_supply_inputs where reference = ${GUIDE_REFERENCE}`)
    expect(stillOne[0]!.n).toBe(1)
  })

  test("7 · la API niega registrar y ver evidencia a quien no tiene permisos de combustible", async ({ page, browser }) => {
    expect(state.uiEvidenceId, "depende de la prueba 1").toBeTruthy()
    // El admin SÍ puede ver la foto: el 403 de abajo es por permisos, no porque falte.
    await login(page)
    const adminEvidence = await page.request.get(`/api/tae/evidence/${state.uiEvidenceId}`)
    expect(adminEvidence.status()).toBe(200)
    expect(adminEvidence.headers()["content-type"]).toMatch(/^image\//)

    const context = await browser.newContext()
    try {
      const outsider = await context.newPage()
      await login(outsider, NO_FUEL_USER, "chome2026")
      const before = await withSql((sql) => sql<Array<{ n: number }>>`select count(*)::int as n from fuel_tae_submissions where vehicle_id = ${VEHICLE_ID}`)

      const post = await postLoad(outsider, { reading: R0 + 50_000, removed: "CTL-7000", installed: "CTL-7001" })
      expect(post.status()).toBe(403)
      expect(await post.json()).toMatchObject({ ok: false, message: "No tienes permiso para registrar cargas." })

      const evidence = await outsider.request.get(`/api/tae/evidence/${state.uiEvidenceId}`)
      expect(evidence.status()).toBe(403)

      const after = await withSql((sql) => sql<Array<{ n: number }>>`select count(*)::int as n from fuel_tae_submissions where vehicle_id = ${VEHICLE_ID}`)
      expect(after[0]!.n).toBe(before[0]!.n)
    } finally {
      await context.close()
    }
  })
})
