import { expect, test } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

// El orden espeja el de `app/(app)/admin/page.tsx`, que agrupa tarjetas de
// tamaño parecido por fila del grid. `toHaveText(GROUPS)` lo verifica, así que
// si allá cambia el orden, acá también.
const MODULES_BY_GROUP = [
  {
    title: "Catálogos",
    hrefs: [
      "/admin/cargos",
      "/admin/productos",
      "/admin/epps",
      "/admin/catalogos-productos",
      "/admin/desviaciones",
      "/admin/pdtp-catalogos",
      "/admin/flota-catalogos",
      "/admin/tipos-activo",
    ],
  },
  {
    title: "Configuración de plataforma",
    hrefs: [
      "/admin/configuracion",
      "/admin/parametros-operativos",
      "/admin/modulos",
      "/admin/backups",
      "/admin/almacenamiento",
    ],
  },
  {
    title: "Personas y acceso",
    hrefs: [
      "/admin/usuarios",
      "/admin/faenas",
      "/admin/trabajadores",
      "/admin/roles",
    ],
  },
  {
    title: "Comunicaciones e integraciones",
    hrefs: [
      "/admin/notificaciones",
      "/admin/dte",
      "/admin/correo-smtp",
      "/admin/plantillas",
    ],
  },
  {
    title: "Activos operativos",
    hrefs: [
      "/admin/inventario-faena",
      "/admin/contenedores",
      "/admin/equipos",
    ],
  },
  {
    title: "Seguridad y trazabilidad",
    hrefs: [
      "/admin/folios",
      "/admin/seguridad",
      "/admin/auditoria",
    ],
  },
  {
    title: "Productos y abastecimiento",
    hrefs: [
      "/admin/proveedores",
      "/admin/centros-costo",
    ],
  },
  {
    title: "Prevención",
    hrefs: [
      "/admin/taxonomia-sst",
    ],
  },
] as const

const GROUPS = MODULES_BY_GROUP.map(({ title }) => title)

const LEGACY_GROUPS = [
  "Catálogos operativos",
  "Control operacional",
  "Control del sistema",
  "Correo SMTP",
] as const

const MODULE_HREFS = MODULES_BY_GROUP.flatMap(({ hrefs }) => hrefs)

async function openAdminIndex(page: import("@playwright/test").Page) {
  await login(page)
  await page.goto("/admin")
  await expectPageTitle(page, "Panel de Administración")
}

test("admin index groups modules by responsibility and preserves destinations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await openAdminIndex(page)

  for (const group of GROUPS) {
    await expect(page.getByRole("heading", { level: 2, name: group, exact: true })).toBeVisible()
  }
  await expect(page.locator("main h2")).toHaveText(GROUPS)

  for (const group of LEGACY_GROUPS) {
    await expect(page.getByRole("heading", { level: 2, name: group, exact: true })).toHaveCount(0)
  }

  for (const href of MODULE_HREFS) {
    const link = page.locator(`main a[href="${href}"]`)
    await expect(link).toHaveCount(1)
    await expect(link).toBeVisible()
  }

  for (const { title, hrefs } of MODULES_BY_GROUP) {
    const section = page.locator("main section").filter({
      has: page.getByRole("heading", { level: 2, name: title, exact: true }),
    })
    await expect(section).toHaveCount(1)
    for (const href of hrefs) {
      await expect(section.locator(`a[href="${href}"]`)).toHaveCount(1)
    }
  }

  const layout = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("main section"), (section) => {
      const rect = section.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })

    const overlaps = sections.some((a, index) => sections.slice(index + 1).some((b) => {
      const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      return horizontal && vertical
    }))

    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      sectionCount: sections.length,
      overlaps,
    }
  })

  expect(layout.horizontalOverflow).toBe(false)
  expect(layout.sectionCount).toBe(GROUPS.length)
  expect(layout.overlaps).toBe(false)
})

test("admin index reflows on mobile without undersized targets or overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAdminIndex(page)

  for (const group of GROUPS) {
    await expect(page.getByRole("heading", { level: 2, name: group, exact: true })).toBeVisible()
  }
  for (const group of LEGACY_GROUPS) {
    await expect(page.getByRole("heading", { level: 2, name: group, exact: true })).toHaveCount(0)
  }

  const layout = await page.evaluate(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('main a[href^="/admin/"]'))
      .map((target) => {
        const rect = target.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })

    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      undersizedTargets: targets.filter(({ width, height }) => width < 44 || height < 44).length,
    }
  })

  expect(layout.horizontalOverflow).toBe(false)
  expect(layout.undersizedTargets).toBe(0)
})
