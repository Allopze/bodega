import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))

const mockFindFirst = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => {
  const db = {
    query: { fuelAnomalyRules: { findFirst: mockFindFirst } },
    transaction: vi.fn(async <T,>(fn: (tx: unknown) => T): Promise<T> => fn({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      insert: vi.fn(() => ({ values: vi.fn() })),
    })),
  }
  return { db }
})
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "rule-1") }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { createAnomalyRuleAction, updateAnomalyRuleAction, setAnomalyRuleStatusAction } = await import("./actions")

const prevState = { ok: false as const, message: "" }

function makeForm(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("code", "regla_test")
  fd.set("name", "Regla de prueba")
  fd.set("severity", "medium")
  fd.set("config", "{}")
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

/**
 * Sección 19 — "Permisos granulares positivos y negativos" para
 * combustibles:manage_anomaly_rules (sección 12, pantalla de reglas).
 */
describe("acciones de reglas de anomalía — combustibles:manage_anomaly_rules", () => {
  beforeEach(() => vi.clearAllMocks())

  it("createAnomalyRuleAction bloquea sin el permiso", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await createAnomalyRuleAction(prevState, makeForm())
    expect(res.ok).toBe(false)
    expect(res.message).toBe("Sin permisos")
  })

  it("updateAnomalyRuleAction bloquea sin el permiso", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await updateAnomalyRuleAction(prevState, makeForm({ id: "rule-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toBe("Sin permisos")
  })

  it("setAnomalyRuleStatusAction bloquea sin el permiso", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await setAnomalyRuleStatusAction("rule-1", false)
    expect(res.ok).toBe(false)
    expect(res.message).toBe("Sin permisos")
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it("setAnomalyRuleStatusAction permite con el permiso", async () => {
    mockRequirePermission.mockResolvedValueOnce({ user: { id: "user-1", email: "a@test.cl" } })
    mockFindFirst.mockResolvedValueOnce({ id: "rule-1", code: "regla_test", isActive: true })
    const res = await setAnomalyRuleStatusAction("rule-1", false)
    expect(res.ok).toBe(true)
    expect(res.message).toBe("Regla desactivada")
  })
})
