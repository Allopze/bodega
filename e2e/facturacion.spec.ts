/**
 * E2E: módulo de Facturación y Cobranza.
 *
 * Qué prueba esto que no prueban las suites de integración: que el módulo es
 * **alcanzable y utilizable en el navegador** con permisos reales, que los
 * estados vacíos dicen algo útil en vez de dejar la pantalla muda, y —lo más
 * importante— que un rol sin permiso **no llega** a las rutas, no solo que no ve
 * el botón.
 *
 * Fixtures de `e2e/setup-db.ts`: `admin@e2e.chome.cl` es administrador y
 * `scoped@e2e.chome.cl` tiene `solicitante_faena`, que no recibe ningún permiso
 * `billing:*`.
 */
import { test, expect, type Page } from "@playwright/test"
import { clearRateLimits, login } from "./helpers"

async function loginAs(page: Page, email: string, password: string) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill(email)
  await page.getByLabel("Contraseña").fill(password)
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
}

test.describe("Facturación — acceso y navegación", () => {
  test("el administrador entra al resumen y ve el módulo identificado", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion")

    await expect(page.getByRole("heading", { name: "Facturación y cobranza", level: 1 })).toBeVisible()
    // El encabezado tiene que decir qué significan las cifras: sin eso, un
    // número en un panel es una afirmación sin respaldo.
    await expect(page.getByText(/saldo pendiente y el vencido consideran todas las facturas abiertas/i).first()).toBeVisible()
  })

  test("un rol sin permiso no alcanza las rutas del módulo, no solo no ve el botón", async ({ page }) => {
    await loginAs(page, "scoped@e2e.chome.cl", "scoped2026")

    for (const route of [
      "/facturacion",
      "/facturacion/facturas",
      "/facturacion/cobranza",
      "/facturacion/pendientes",
      "/facturacion/propuestas",
      "/facturacion/clientes",
      "/facturacion/sincronizacion",
    ]) {
      await page.goto(route)
      // La guarda es del servidor: redirige a /forbidden en vez de renderizar.
      await expect(page, `ruta protegida: ${route}`).toHaveURL(/\/forbidden/, { timeout: 15_000 })
    }
  })

  test("el área de Facturación aparece en la navegación del administrador", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion")

    const nav = page.locator('nav[aria-label="Navegación"], nav[aria-label="Áreas"]').first()
    const current = nav.locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
  })
})

test.describe("Facturación — estados vacíos útiles", () => {
  test("sin facturas, el resumen explica de dónde vendrían y adónde ir", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion")

    const empty = page.getByText(/Todavía no hay facturas de venta/i)
    if (await empty.isVisible().catch(() => false)) {
      await expect(page.getByText(/libro de ventas de FacturaEnLínea/i)).toBeVisible()
      await expect(page.getByRole("link", { name: /Ir a Sincronización/i })).toBeVisible()
    }
  })

  test("sin clientes, la pantalla dice por qué importa registrarlos", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/clientes")

    await expect(page.getByRole("heading", { name: "Clientes y contratos", level: 1 })).toBeVisible()
    const empty = page.getByText(/Todavía no hay clientes registrados/i)
    if (await empty.isVisible().catch(() => false)) {
      await expect(page.getByText(/calcular vencimientos a partir de su plazo de pago/i)).toBeVisible()
    }
    // El alta tiene que estar disponible para quien administra el maestro.
    await expect(page.getByRole("button", { name: "Nuevo cliente" })).toBeVisible()
  })

  test("pendientes de facturar declara su alcance real", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/pendientes")

    await expect(page.getByRole("heading", { name: "Pendientes de facturar", level: 1 })).toBeVisible()
    // La pantalla NO puede presentarse como inventario completo de trabajo
    // ejecutado: la plataforma no registra servicios uno por uno.
    await expect(page.getByText(/no registra servicios ejecutados uno por uno/i).first()).toBeVisible()
  })
})

test.describe("Facturación — el módulo no emite documentos tributarios", () => {
  test("propuestas advierte que aprobar no emite un DTE", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/propuestas")

    await expect(page.getByRole("heading", { name: "Propuestas de facturación", level: 1 })).toBeVisible()
    await expect(page.getByText(/aprobar no emite ningún documento tributario/i).first()).toBeVisible()
  })
})

test.describe("Facturación — centro de sincronización", () => {
  test("muestra el estado real de cada proveedor, incluido el que está bloqueado", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/sincronizacion")

    await expect(page.getByRole("heading", { name: "Sincronización de facturación", level: 1 })).toBeVisible()
    await expect(page.getByRole("heading", { name: "FacturaEnLínea", level: 3 })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Chipax", level: 3 })).toBeVisible()

    // Chipax no puede aparecer como operativo: su contrato de datos no es legible.
    const chipax = page.locator("article").filter({ hasText: "Chipax" }).first()
    await expect(chipax.getByText(/Inactivo|Sin configurar|Con problema/)).toBeVisible()
  })

  test("la carga manual no se presenta como un proveedor de sincronización", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/sincronizacion")

    // No es una fuente que se sincronice: mostrarla con ficha de proveedor la
    // hacía parecer un proveedor averiado.
    await expect(page.getByRole("heading", { name: "Carga manual", level: 3 })).toHaveCount(0)
    await expect(page.getByText(/pueden cargarse a mano o importando su XML/i)).toBeVisible()
  })

  test("sin credenciales, un proveedor se marca «Sin configurar» y no como falla", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/sincronizacion")

    const fel = page.locator("article").filter({ hasText: "FacturaEnLínea" }).first()
    // El entorno e2e no tiene credenciales del portal: eso es una tarea
    // pendiente, no una caída.
    await expect(fel.getByText("Sin configurar")).toBeVisible()
    await expect(fel.getByText(/no es una falla/i)).toBeVisible()
    // Y sin credenciales no tiene sentido ofrecer la comprobación.
    await expect(fel.getByRole("button", { name: "Probar conexión" })).toBeDisabled()
  })

  test("la comprobación de conexión es por proveedor y a pedido", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/sincronizacion")

    // Un botón dentro de cada tarjeta, no un enlace suelto entre los controles
    // de sincronización: la comprobación es por proveedor.
    const buttons = page.getByRole("button", { name: "Probar conexión" })
    expect(await buttons.count()).toBeGreaterThan(1)

    // Nunca se comprobó nada todavía, y la pantalla lo dice en vez de fingir.
    await expect(page.getByText("nunca").first()).toBeVisible()
  })

  test("el diagnóstico no expone credenciales", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/sincronizacion")

    const body = (await page.textContent("body")) ?? ""
    expect(body).not.toMatch(/clave=/i)
    expect(body).not.toMatch(/rut_usr/i)
    expect(body).not.toMatch(/secret_key/i)
    expect(body).not.toMatch(/CHIPAX_SECRET_KEY/i)
  })
})

test.describe("Facturación — cobranza", () => {
  test("distingue explícitamente cobrado de facturado", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/cobranza")

    await expect(page.getByRole("heading", { name: "Cobranza", level: 1 })).toBeVisible()
    await expect(page.getByText(/Solo los pagos confirmados por una persona descuentan del saldo/i).first()).toBeVisible()
  })

  test("el listado de facturas emitidas se puede filtrar por período", async ({ page }) => {
    await login(page)
    await page.goto("/facturacion/facturas")

    await expect(page.getByRole("heading", { name: "Facturas emitidas", level: 1 })).toBeVisible()
    // El filtro de período vive en la URL: el resultado tiene que ser enlazable.
    await page.goto("/facturacion/facturas?periodo=2026-07")
    await expect(page).toHaveURL(/periodo=2026-07/)
    await expect(page.getByRole("heading", { name: "Facturas emitidas", level: 1 })).toBeVisible()
  })
})
