import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { panelVariantForSession, resolvePanelVariant } from "./role-variant"

const view = "combustibles:view"
const approve = "combustibles:approve_flagged"
const costs = "combustibles:view_costs"
const register = "combustibles:register_load"
const importar = "combustibles:import"

describe("variante del Panel de combustible por rol", () => {
  it("quien decide las cargas marcadas ve el Panel de jefatura, global o no", () => {
    expect(resolvePanelVariant({ permissions: [view, approve], isGlobal: true })).toBe("jefatura")
    expect(resolvePanelVariant({ permissions: [view, approve], isGlobal: false })).toBe("jefatura")
  })

  it("approve_flagged gana sobre registrar e importar", () => {
    expect(resolvePanelVariant({ permissions: [view, approve, register, importar], isGlobal: false })).toBe("jefatura")
  })

  it("un rol global con montos ve jefatura aunque no decida", () => {
    expect(resolvePanelVariant({ permissions: [view, costs], isGlobal: true })).toBe("jefatura")
  })

  it("los montos sin alcance global no alcanzan: el paso de pagos exige rol global", () => {
    expect(resolvePanelVariant({ permissions: [view, costs], isGlobal: false })).toBe("consulta")
    expect(resolvePanelVariant({ permissions: [view, costs, register], isGlobal: false })).toBe("terreno")
  })

  it("un rol global con montos y registro, sin decidir, sigue viendo jefatura", () => {
    expect(resolvePanelVariant({ permissions: [view, costs, register, importar], isGlobal: true })).toBe("jefatura")
  })

  it("registrar + importar sin decidir es contrato", () => {
    expect(resolvePanelVariant({ permissions: [view, register, importar], isGlobal: false })).toBe("contrato")
    expect(resolvePanelVariant({ permissions: [view, register, importar], isGlobal: true })).toBe("contrato")
  })

  it("registrar sin importar es terreno", () => {
    expect(resolvePanelVariant({ permissions: [view, register], isGlobal: false })).toBe("terreno")
  })

  it("importar sin registrar no es contrato: se lee como consulta", () => {
    expect(resolvePanelVariant({ permissions: [view, importar], isGlobal: false })).toBe("consulta")
  })

  it("sólo ver es consulta, y sin permisos tampoco inventa una variante de trabajo", () => {
    expect(resolvePanelVariant({ permissions: [view], isGlobal: false })).toBe("consulta")
    expect(resolvePanelVariant({ permissions: [], isGlobal: false })).toBe("consulta")
  })

  it("lee permisos y alcance de la sesión", () => {
    const session = (permissions: string[], isGlobal: boolean) =>
      ({
        user: { id: "u", name: "U", email: "u@example.com", roles: [], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal },
        expires: "2099-01-01T00:00:00.000Z",
      }) as unknown as Session
    expect(panelVariantForSession(session([view, costs], true))).toBe("jefatura")
    expect(panelVariantForSession(session([view, register], false))).toBe("terreno")
    expect(panelVariantForSession(null)).toBe("consulta")
  })
})
