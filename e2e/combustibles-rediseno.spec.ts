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
 */
import { createHash } from "node:crypto"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

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
