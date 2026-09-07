import { describe, it, expect, vi, beforeEach } from "vitest"

const rows = vi.hoisted(() => ({ value: null as string | null }))

vi.mock("@/db", () => ({
  db: {
    query: { systemSettings: { findFirst: async () => (rows.value === null ? undefined : { value: rows.value }) } },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))

const { getOperationalSettings, DEFAULT_OPS_SETTINGS, OPS_SETTING_KEYS } = await import("@/lib/services/system-settings")

describe("tolerancia de conciliación configurable", () => {
  beforeEach(() => { rows.value = null })

  it("tiene su propia clave de configuración", () => {
    expect(OPS_SETTING_KEYS.purchasingClpTolerance).toBe("ops.compras.clp_tolerance")
  })

  it("por defecto es el peso de redondeo", async () => {
    expect(DEFAULT_OPS_SETTINGS.purchasingClpTolerance).toBe(1)
    const settings = await getOperationalSettings()
    expect(settings.purchasingClpTolerance).toBe(1)
  })

  it("respeta el valor guardado por administración", async () => {
    rows.value = "500"
    expect((await getOperationalSettings()).purchasingClpTolerance).toBe(500)
  })

  it("no acepta una tolerancia negativa: acotar hacia abajo es más seguro que confiar", async () => {
    rows.value = "-40"
    expect((await getOperationalSettings()).purchasingClpTolerance).toBe(0)
  })

  it("tampoco una que vuelva inútil la conciliación", async () => {
    rows.value = "99999999"
    expect((await getOperationalSettings()).purchasingClpTolerance).toBe(100_000)
  })
})
