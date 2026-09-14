import { expect, test } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

// El sidebar de admin reemplaza el árbol de negocio mientras `pathname`
// empieza con `/admin` (ver components/layout/admin-nav.ts). Cada categoría
// con más de un módulo se pinta como un acordeón (`button`); "Prevención"
// quedó con un solo módulo y por eso no tiene encabezado propio — solo se ve
// su ítem, igual que ya hace `AreaSection` para el árbol de negocio.
const ADMIN_CATEGORIES = [
  "Catálogos",
  "Configuración de plataforma",
  "Personas y acceso",
  "Comunicaciones e integraciones",
  "Activos operativos",
  "Seguridad y trazabilidad",
  "Productos y abastecimiento",
] as const

const BUSINESS_AREA_LABELS = ["Adquisiciones", "Bodega", "Facturación", "Reportes"] as const

test("el sidebar agrupa Administración por categorías y oculta las áreas de negocio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await login(page)
  await page.goto("/admin/cargos")

  const sidebar = page.getByRole("navigation", { name: "Navegación" })

  for (const category of ADMIN_CATEGORIES) {
    await expect(sidebar.getByRole("button", { name: category, exact: true })).toBeVisible()
  }
  await expect(sidebar.getByRole("button", { name: "Prevención", exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole("link", { name: "Taxonomía documental SST" })).toBeVisible()

  for (const label of BUSINESS_AREA_LABELS) {
    await expect(sidebar.getByText(label, { exact: true })).toHaveCount(0)
  }
  // "Soporte" depende de que `areas` incluya un área con id "soporte" — las
  // categorías de admin nunca la tienen, así que el link pineado desaparece.
  await expect(sidebar.getByRole("link", { name: "Soporte" })).toHaveCount(0)

  // /admin/cargos pertenece a "Catálogos": esa categoría se auto-expande.
  await expect(sidebar.getByRole("button", { name: "Catálogos", exact: true })).toHaveAttribute("aria-expanded", "true")
  await expect(sidebar.getByRole("link", { name: "Cargos y capacidades" })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Productos", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Catálogos de flota" })).toBeVisible()
})

test("Catálogos de flota expone sus 5 sub-rutas y marca activo solo el destino exacto", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await login(page)
  await page.goto("/admin/flota-catalogos/tipos-equipo")

  const sidebar = page.getByRole("navigation", { name: "Navegación" })

  await expect(sidebar.getByRole("link", { name: "Tipos de equipo" })).toHaveAttribute("aria-current", "page")
  // Antes de este fix, la fila padre también se marcaba "activa" al ver un
  // hijo: `REGISTERED_NAV_HREFS` (nav-items.ts) solo conoce hrefs de negocio.
  await expect(sidebar.getByRole("link", { name: "Catálogos de flota" })).not.toHaveAttribute("aria-current", "page")

  for (const child of [
    "Estanques de combustible",
    "Productos de combustible",
    "Vehículos",
    "Proveedores de combustible",
  ]) {
    await expect(sidebar.getByRole("link", { name: child })).toBeVisible()
  }
})

test("salir de /admin restaura el sidebar de negocio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await login(page)
  await page.goto("/admin/cargos")
  const sidebar = page.getByRole("navigation", { name: "Navegación" })
  await expect(sidebar.getByRole("button", { name: "Catálogos", exact: true })).toBeVisible()

  await sidebar.getByRole("link", { name: "Inicio" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(sidebar.getByRole("button", { name: "Catálogos", exact: true })).toHaveCount(0)
  for (const label of BUSINESS_AREA_LABELS) {
    await expect(sidebar.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(sidebar.getByRole("link", { name: "Soporte" })).toBeVisible()
})

/**
 * Esta prueba afirmaba lo contrario —un resumen corto, cero enlaces `/admin/`
 * dentro de `<main>`— y describía un diseño que se revirtió: la pantalla de
 * entrada sabía exactamente qué podía hacer la sesión y no mostraba nada,
 * remitía al panel lateral, que en móvil está colapsado. Hoy `AdminAreaIndex`
 * pinta el mismo árbol filtrado por permiso como índice de destinos.
 */
test("/admin ofrece un índice de destinos agrupado por categoría", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await login(page)
  await page.goto("/admin")
  await expectPageTitle(page, "Panel de Administración")

  // Un solo landmark de navegación para las ocho áreas, no uno por área.
  const indice = page.getByRole("navigation", { name: "Índice de administración" })
  await expect(indice).toBeVisible()

  for (const category of ADMIN_CATEGORIES) {
    await expect(indice.getByRole("heading", { name: category, level: 2 })).toBeVisible()
  }

  // Cada destino es un enlace real a su pantalla, no un rótulo muerto.
  await expect(indice.getByRole("link", { name: "Cargos y capacidades" }))
    .toHaveAttribute("href", "/admin/cargos")

  // Los hijos de una rama también son destinos alcanzables desde acá: es lo
  // que el panel lateral no ofrece en móvil, donde nace colapsado.
  await expect(indice.getByRole("link", { name: "Proveedores de combustible" }))
    .toHaveAttribute("href", "/admin/flota-catalogos/proveedores-combustible")
})

test("el rail colapsado también agrupa Administración por categoría, con flyout por ítems", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await login(page)
  await page.goto("/admin/cargos")

  // Colapsado, desktop-nav.tsx cambia el aria-label del <nav> de "Navegación"
  // a "Áreas" y reemplaza el acordeón por un ícono + flyout por área
  // (RailFlyout) — un componente distinto de AccordionAreas, nunca antes
  // ejercitado con datos de admin.
  await page.getByRole("button", { name: "Ocultar panel" }).click()
  const rail = page.getByRole("navigation", { name: "Áreas" })

  const catalogosRailButton = rail.getByRole("button", { name: "Catálogos", exact: true })
  await expect(catalogosRailButton).toBeVisible()
  await catalogosRailButton.click()
  // El flyout (Popover) se porta fuera del <nav>, así que se busca en toda la página.
  await expect(page.getByRole("link", { name: "Cargos y capacidades" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Catálogos de flota" })).toBeVisible()
})

test("una sesión con permisos de admin parciales solo ve sus categorías e ítems autorizados", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await login(page, "admin.parcial@e2e.chome.cl")
  await page.goto("/admin/productos")

  const sidebar = page.getByRole("navigation", { name: "Navegación" })

  // Solo admin:products + admin:product_catalogs (en "Catálogos") y
  // admin:notifications + admin:smtp (en "Comunicaciones e integraciones") —
  // el resto de las 7 categorías no debería aparecer en absoluto.
  await expect(sidebar.getByRole("button", { name: "Catálogos", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "Comunicaciones e integraciones", exact: true })).toBeVisible()
  for (const category of [
    "Configuración de plataforma",
    "Personas y acceso",
    "Activos operativos",
    "Seguridad y trazabilidad",
    "Productos y abastecimiento",
  ]) {
    await expect(sidebar.getByRole("button", { name: category, exact: true })).toHaveCount(0)
  }
  // "Prevención" (Taxonomía documental SST, admin:document_taxonomy) tampoco
  // está autorizada para esta sesión.
  await expect(sidebar.getByRole("link", { name: "Taxonomía documental SST" })).toHaveCount(0)

  // /admin/productos pertenece a "Catálogos", así que esa categoría llega
  // auto-expandida (AccordionAreas solo abre una a la vez). Sus dos ítems
  // autorizados se ven; el resto (p.ej. Cargos y capacidades, que pide
  // admin:worker_positions) no.
  await expect(sidebar.getByRole("link", { name: "Productos", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Catálogos de productos" })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Cargos y capacidades" })).toHaveCount(0)
  await expect(sidebar.getByRole("link", { name: "Catálogos de flota" })).toHaveCount(0)

  // Abrir "Comunicaciones e integraciones" (colapsa "Catálogos", el acordeón
  // solo mantiene una sección abierta) y verificar lo mismo ahí.
  await sidebar.getByRole("button", { name: "Comunicaciones e integraciones", exact: true }).click()
  await expect(sidebar.getByRole("link", { name: "Notificaciones" })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Correo SMTP" })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Sincronización DTE" })).toHaveCount(0)
  await expect(sidebar.getByRole("link", { name: "Plantillas de correo" })).toHaveCount(0)
})

test("en mobile, el drawer también agrupa por categoría y Prevención se pinta sin disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await page.goto("/admin/cargos")

  // Reintento por una condición de carrera real de este repo: un clic previo
  // a la hidratación mueve el foco pero no corre el handler (ver
  // navegacion-por-rol.spec.ts).
  const opener = page.getByRole("button", { name: "Abrir menú" })
  await expect(opener).toBeVisible()
  const panel = page.getByRole("navigation")
  await expect(async () => {
    await opener.click()
    await expect(panel.getByRole("button", { name: "Catálogos", exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  await expect(panel.getByRole("link", { name: "Taxonomía documental SST" })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Prevención", exact: true })).toHaveCount(0)
})
