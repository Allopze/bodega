import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { ADMIN_AREAS, getAdminAreas } from "@/components/layout/admin-nav"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"

function sessionWithPermissions(permissions: string[]): Session {
  return {
    user: {
      id: "user-test",
      name: "Admin",
      email: "admin@test.cl",
      roles: ["administrador"],
      permissions,
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      isGlobal: true,
    },
    expires: "2030-01-01T00:00:00.000Z",
  } satisfies Session
}

const ALL_ADMIN_PERMISSIONS = Array.from(
  new Set(
    ADMIN_AREAS.flatMap((area) => area.items).flatMap((item) => [
      ...(item.permissions ?? []),
      ...(item.children?.flatMap((child) => child.permissions ?? []) ?? []),
    ]),
  ),
)

describe("getAdminAreas", () => {
  // ALL_ADMIN_PERMISSIONS por sí sola no detecta un typo en admin-nav.ts: si el
  // string estuviera mal escrito, este set lo heredaría igual y el test de
  // "permiso completo" seguiría en verde. Este chequeo lo hace contra el
  // catálogo real de permisos (ALL_MODULE_PERMISSIONS, derivado del registry),
  // no contra los mismos datos que se están probando.
  it("only references permission strings that actually exist in the registry", () => {
    const validPermissions = new Set(ALL_MODULE_PERMISSIONS)
    for (const invalid of ALL_ADMIN_PERMISSIONS.filter((p) => !validPermissions.has(p as never))) {
      expect.fail(`"${invalid}" is not a permission declared by any registered module`)
    }
  })

  // Se busca por `label` y no por `href` a propósito: cuando el padre no es visible por sí
  // mismo su `href` deja de ser el propio, así que buscarlo por ahí devolvía `undefined` y
  // el test fallaba sin decir por qué.
  it("keeps a branch item visible when the session only holds a child's permission, not the parent's", () => {
    const areas = getAdminAreas(sessionWithPermissions(["combustibles:manage_suppliers"]))
    const fleet = areas
      .find((area) => area.id === "catalogos")
      ?.items.find((item) => item.label === "Catálogos de flota")

    expect(fleet?.children?.map((child) => child.href)).toEqual(["/admin/flota-catalogos/proveedores-combustible"])
  })

  // El árbol se pinta con el padre como enlace, así que un padre conservado sólo por sus
  // hijos no puede seguir apuntando a su propia pantalla: `/admin/flota-catalogos` exige
  // `admin:fleet_catalog` y esta sesión no lo tiene, de modo que el enlace llevaba a
  // /forbidden. Apunta al primer hijo visible, que es adonde esa sesión iba de todos modos.
  it("points a branch kept only by its children at the first visible child", () => {
    const areas = getAdminAreas(sessionWithPermissions(["combustibles:manage_suppliers"]))
    const fleet = areas
      .find((area) => area.id === "catalogos")
      ?.items.find((item) => item.label === "Catálogos de flota")

    expect(fleet?.href).toBe("/admin/flota-catalogos/proveedores-combustible")
  })

  // La contracara: con permiso sobre el padre, el enlace es el suyo y no el del hijo.
  it("keeps a self-visible branch pointing at its own screen", () => {
    const areas = getAdminAreas(sessionWithPermissions(["admin:fleet_catalog"]))
    const fleet = areas
      .find((area) => area.id === "catalogos")
      ?.items.find((item) => item.label === "Catálogos de flota")

    expect(fleet?.href).toBe("/admin/flota-catalogos")
  })

  it("returns all 8 categories, in order, with a full admin permission set", () => {
    const areas = getAdminAreas(sessionWithPermissions(ALL_ADMIN_PERMISSIONS))

    expect(areas.map((area) => area.id)).toEqual([
      "catalogos",
      "plataforma",
      "personas",
      "comunicaciones",
      "activos",
      "seguridad",
      "abastecimiento",
      "prevencion",
    ])
    expect(areas.map((area) => area.label)).toEqual([
      "Catálogos",
      "Configuración de plataforma",
      "Personas y acceso",
      "Comunicaciones e integraciones",
      "Activos operativos",
      "Seguridad y trazabilidad",
      "Productos y abastecimiento",
      "Prevención",
    ])

    const catalogos = areas.find((area) => area.id === "catalogos")
    expect(catalogos?.items).toHaveLength(8)
    const prevencion = areas.find((area) => area.id === "prevencion")
    expect(prevencion?.items).toHaveLength(1)
  })

  it("hides items the session lacks permission for, and drops empty categories", () => {
    const areas = getAdminAreas(sessionWithPermissions(["admin:document_taxonomy"]))

    expect(areas).toHaveLength(1)
    expect(areas[0]?.id).toBe("prevencion")
    expect(areas[0]?.items.map((item) => item.href)).toEqual(["/admin/taxonomia-sst"])
  })

  it("drops a single item from a category without emptying the whole category", () => {
    const withoutWorkerPositions = sessionWithPermissions(
      ALL_ADMIN_PERMISSIONS.filter((permission) => permission !== "admin:worker_positions"),
    )
    const areas = getAdminAreas(withoutWorkerPositions)
    const catalogos = areas.find((area) => area.id === "catalogos")

    expect(catalogos?.items.map((item) => item.href)).not.toContain("/admin/cargos")
    expect(catalogos?.items.length).toBeGreaterThan(0)
  })

  it("exposes the 5 real sub-routes of Catálogos de flota as children, filtered by permission", () => {
    const areas = getAdminAreas(sessionWithPermissions(ALL_ADMIN_PERMISSIONS))
    const fleet = areas
      .find((area) => area.id === "catalogos")
      ?.items.find((item) => item.href === "/admin/flota-catalogos")

    expect(fleet?.children?.map((child) => child.href)).toEqual([
      "/admin/flota-catalogos/estanques-combustible",
      "/admin/flota-catalogos/productos-combustible",
      "/admin/flota-catalogos/tipos-equipo",
      "/admin/flota-catalogos/vehiculos",
      "/admin/flota-catalogos/proveedores-combustible",
    ])
  })

  it("hides only the flota-catalogos children the session lacks permission for", () => {
    const withoutFleetVehicles = sessionWithPermissions(
      ALL_ADMIN_PERMISSIONS.filter((permission) => permission !== "admin:fleet_vehicles"),
    )
    const areas = getAdminAreas(withoutFleetVehicles)
    const fleet = areas
      .find((area) => area.id === "catalogos")
      ?.items.find((item) => item.href === "/admin/flota-catalogos")

    expect(fleet?.children?.map((child) => child.href)).not.toContain("/admin/flota-catalogos/vehiculos")
    expect(fleet?.children?.length).toBeGreaterThan(0)
  })

  it("does not include operational links (Viajes y consumo, Mantenciones) as flota-catalogos children", () => {
    const areas = getAdminAreas(sessionWithPermissions(ALL_ADMIN_PERMISSIONS))
    const fleet = areas
      .find((area) => area.id === "catalogos")
      ?.items.find((item) => item.href === "/admin/flota-catalogos")

    expect(fleet?.children?.map((child) => child.href)).not.toContain("/flota")
    expect(fleet?.children?.map((child) => child.href)).not.toContain("/mantenciones")
  })

  it("returns nothing for a session with no admin permissions", () => {
    expect(getAdminAreas(sessionWithPermissions(["repuestos:view_own"]))).toEqual([])
  })
})
