import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Dashboard de inicio.
 *
 * Cubre las regresiones de la auditoría 2026-07-30, en particular la que
 * motivó el resto: la pantalla mezclaba conteos de la población completa con
 * una página de filas cargadas, sin decirlo (D-01).
 */
test.describe("Dashboard operacional", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
  })

  test("la cifra del saludo coincide con el tile de tareas pendientes", async ({ page }) => {
    const greeting = page.getByText(/No tienes acciones pendientes|Tienes \d+ tareas? pendientes?/)
    await expect(greeting).toBeVisible()

    const greetingText = (await greeting.textContent()) ?? ""
    const expected = /^No tienes/.test(greetingText)
      ? "0"
      : greetingText.match(/Tienes (\d+) tareas? pendientes?/)?.[1]
    expect(expected).toBeTruthy()

    // El tile concatena label+valor+descripción sin separadores, así que no
    // sirve un \b: se compara contra el patrón completo del tile.
    const tile = page.getByRole("link", { name: /Tareas pendientes/ })
    await expect(tile).toContainText(new RegExp(`Tareas pendientes${expected}\\D`))
  })

  // D-01: los atajos anuncian el backlog completo y navegan a /pendientes; no
  // filtran en cliente las filas visibles.
  test("los atajos de la cola navegan a la cola completa", async ({ page }) => {
    const shortcuts = page.getByRole("navigation", { name: "Atajos a la cola completa" })
    await expect(shortcuts).toBeVisible()

    const all = shortcuts.getByRole("link", { name: /Todas/ })
    await expect(all).toHaveAttribute("href", "/pendientes")
    await all.click()
    await expect(page).toHaveURL(/\/pendientes/)
  })

  // D-01: si la cola está truncada tiene que decirlo. Si no lo está, no debe
  // inventar un aviso.
  test("declara el truncamiento sólo cuando lo hay", async ({ page }) => {
    const queue = page.getByRole("region", { name: "Cola de trabajo" })
    const notice = queue.getByText(/Mostrando las .* más urgentes de/)
    const visibleCount = queue.getByText(/\d+ de \d+ visibles?/)
    await expect(visibleCount).toBeVisible()

    const counts = ((await visibleCount.textContent()) ?? "").match(/(\d+) de (\d+)/)
    const loaded = Number(counts?.[2] ?? 0)
    const total = Number(
      ((await page.getByText(/Tienes (\d+) tareas? pendientes?/).textContent().catch(() => "")) ?? "")
        .match(/Tienes (\d+)/)?.[1] ?? loaded,
    )

    if (total > loaded) await expect(notice).toBeVisible()
    else await expect(notice).toHaveCount(0)
  })

  // L-02: la cola es el widget principal; no puede exigir scroll horizontal en
  // un portátil estándar.
  test("la cola de trabajo no scrollea horizontalmente a 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const scroller = page.locator("#cola-de-trabajo div.overflow-x-auto").first()
    if ((await scroller.count()) === 0) test.skip(true, "Sin tareas en la cola para este usuario")

    const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  // L-01: PageHeader ya emite el <h1> de la página; el saludo no debe ser otro.
  test("la página tiene un solo h1", async ({ page }) => {
    await expect(page.locator("h1")).toHaveCount(1)
  })
})

/**
 * Gating por permisos de tiles, alertas y lateral.
 *
 * `restricted-roles.spec.ts` entra al dashboard pero sólo para aterrizar y
 * navegar a /solicitudes: no afirma nada sobre esta pantalla. Aquí se cubre lo
 * que deciden `buildOperationalMetrics` y `buildOperationalAlerts`, que es la
 * lógica que la remediación de la auditoría reescribió.
 *
 * `scoped@e2e.chome.cl` tiene requests:{create,view_own,submit},
 * receiving:{view,register_faena}, warehouse:{view_stock,register_movement} y
 * operations:view_work. NO tiene approvals:approve, purchasing:view,
 * deliveries:create ni prevention:pdtp:view.
 */
test.describe("Dashboard con rol restringido", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "scoped@e2e.chome.cl", "scoped2026")
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")
  })

  test("no muestra tiles ni alertas fuera de su permiso", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })
    await expect(strip).toBeVisible()

    // Sin approvals:approve ni purchasing:view.
    await expect(strip.getByText("Por aprobar")).toHaveCount(0)
    await expect(strip.getByText("Inversión del mes")).toHaveCount(0)
    await expect(page.getByText("ítems esperan aprobación")).toHaveCount(0)

    // Sin prevention:pdtp:view no se instancia la sección del lateral.
    await expect(page.getByRole("heading", { name: "Programa de Trabajo Preventivo" })).toHaveCount(0)
  })

  test("muestra los cuatro tiles que su rol sí autoriza", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Indicadores Operacionales" })

    // El orden de buildOperationalMetrics con canApprove=false deja estos cuatro
    // en el slice(0,4) — "Stock crítico" queda cortado pese a warehouse:view_stock.
    for (const label of ["Tareas pendientes", "Tareas críticas", "Tareas vencidas", "Por recibir"]) {
      await expect(strip.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test("el flujo del mes sólo lista los módulos autorizados", async ({ page }) => {
    const flow = page.getByRole("region", { name: "Flujo del mes" })
    await expect(flow).toBeVisible()

    await expect(flow.getByText("Solicitudes creadas", { exact: false })).toBeVisible()
    await expect(flow.getByText("Recepciones", { exact: false })).toBeVisible()
    await expect(flow.getByText("OC emitidas", { exact: false })).toHaveCount(0)
    await expect(flow.getByText("Inversión emitida", { exact: false })).toHaveCount(0)
  })
})
