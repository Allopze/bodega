import { describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

// `lib/auth/can` arrastra NextAuth, `next/headers` y la base: aquí solo importa
// la comprobación pura de permisos, que se replica tal cual.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

import { canManageMaintenanceDocumentPolicies, maintenanceNavItems } from "./maintenance-section-nav"

function session(options: { isGlobal: boolean; permissions: string[] }) {
  return { user: { id: "u-1", isGlobal: options.isGlobal, worksiteIds: [], permissions: options.permissions } } as unknown as Session
}

describe("maintenanceNavItems", () => {
  it("siempre ofrece órdenes de trabajo y planes preventivos, en ese orden", () => {
    const items = maintenanceNavItems(session({ isGlobal: false, permissions: ["mantenciones:view"] }))
    expect(items.map((item) => [item.key, item.href])).toEqual([
      ["ot", "/mantenciones"],
      ["planes", "/mantenciones/planes"],
    ])
  })

  it("agrega las políticas documentales solo a un rol global que puede editar", () => {
    const items = maintenanceNavItems(session({ isGlobal: true, permissions: ["mantenciones:view", "mantenciones:edit"] }))
    expect(items.map((item) => item.key)).toEqual(["ot", "planes", "politica"])
    expect(items.at(-1)?.href).toBe("/mantenciones/politicas-documentales")
  })

  it("no las ofrece a un rol global sin edición ni a uno con edición pero acotado a faenas", () => {
    expect(canManageMaintenanceDocumentPolicies(session({ isGlobal: true, permissions: ["mantenciones:view"] }))).toBe(false)
    expect(canManageMaintenanceDocumentPolicies(session({ isGlobal: false, permissions: ["mantenciones:view", "mantenciones:edit"] }))).toBe(false)
    expect(maintenanceNavItems(session({ isGlobal: false, permissions: ["mantenciones:view", "mantenciones:edit"] })).map((item) => item.key))
      .toEqual(["ot", "planes"])
  })
})
