import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))

const mockFindFirst = vi.hoisted(() => vi.fn())
const mockInsertValues = vi.hoisted(() => vi.fn())
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: vi.fn() })))
vi.mock("@/db", () => {
  const db = {
    query: { fuelAnomalyRules: { findFirst: mockFindFirst } },
    transaction: vi.fn(async <T,>(fn: (tx: unknown) => T): Promise<T> => fn({
      update: vi.fn(() => ({ set: mockUpdateSet })),
      insert: vi.fn(() => ({ values: mockInsertValues })),
    })),
  }
  return { db }
})
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "rule-1") }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { createAnomalyRuleAction, updateAnomalyRuleAction, setAnomalyRuleStatusAction } = await import("./actions")

const prevState = { ok: false as const, message: "" }
const session = { user: { id: "user-1", email: "a@test.cl" } }

function makeForm(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("code", "regla_test")
  fd.set("name", "Regla de prueba")
  fd.set("severity", "medium")
  fd.set("config", "{}")
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

/** Lo que se guardó como `config` en el último alta o edición. */
const savedConfig = (call: unknown[][]) => JSON.parse((call.at(-1)?.[0] as { config: string }).config) as Record<string, unknown>

/**
 * Sección 19 — "Permisos granulares positivos y negativos" para
 * combustibles:manage_anomaly_rules (sección 12, pantalla de reglas).
 */
describe("acciones de reglas de anomalía — combustibles:manage_anomaly_rules", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockReset()
  })

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
    mockRequirePermission.mockResolvedValueOnce(session)
    mockFindFirst.mockResolvedValueOnce({ id: "rule-1", code: "regla_test", isActive: true })
    const res = await setAnomalyRuleStatusAction("rule-1", false)
    expect(res.ok).toBe(true)
    expect(res.message).toBe("Regla desactivada")
  })
})

describe("parámetros de la regla en el formulario", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockReset()
    mockRequirePermission.mockResolvedValue(session)
  })

  it("mezcla los campos en el JSON, convierte el margen a fracción y conserva las excepciones por tipo de equipo", async () => {
    const res = await createAnomalyRuleAction(prevState, makeForm({
      code: "litros_supera_capacidad",
      config: '{"equipmentTypes":{"grua":{"margin":0.1}}}',
      "param:margin": "7,5",
    }))
    expect(res.ok).toBe(true)
    expect(savedConfig(mockInsertValues.mock.calls)).toEqual({ equipmentTypes: { grua: { margin: 0.1 } }, margin: 0.075 })
  })

  it("los campos ganan sobre el JSON, y un campo vacío vuelve al valor del sistema", async () => {
    await createAnomalyRuleAction(prevState, makeForm({
      code: "exceso_cargas_ventana",
      config: '{"maxLoads":9,"windowHours":9,"otra":true}',
      "param:maxLoads": "4",
      "param:windowHours": "",
    }))
    expect(savedConfig(mockInsertValues.mock.calls)).toEqual({ maxLoads: 4, otra: true })
  })

  it("el límite de filas se escribe a la chilena y sólo existe en reglas por lotes", async () => {
    await createAnomalyRuleAction(prevState, makeForm({ code: "evidencia_duplicada", "param:batchRowLimit": "20.000" }))
    expect(savedConfig(mockInsertValues.mock.calls)).toEqual({ batchRowLimit: 20000 })
    // Una regla que no es por lotes ignora el campo.
    await createAnomalyRuleAction(prevState, makeForm({ code: "sello_repetido", "param:batchRowLimit": "20.000" }))
    expect(savedConfig(mockInsertValues.mock.calls)).toEqual({})
  })

  it("un valor fuera de rango se informa en su campo y no guarda nada", async () => {
    const res = await createAnomalyRuleAction(prevState, makeForm({ code: "exceso_cargas_ventana", "param:maxLoads": "0", "param:windowHours": "dos" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.["param:maxLoads"]?.[0]).toContain("debe estar entre 1 y 50")
    expect(res.fieldErrors?.["param:windowHours"]?.[0]).toContain("escribe un número")
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it("un JSON ilegible se rechaza en vez de reemplazarse por {} (no se pierde la configuración)", async () => {
    const res = await createAnomalyRuleAction(prevState, makeForm({ code: "exceso_cargas_ventana", config: '{"maxLoads": 4,', "param:maxLoads": "5" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.config?.[0]).toBe("El JSON de configuración no es válido")
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it("un JSON que no es un objeto también se rechaza", async () => {
    const res = await createAnomalyRuleAction(prevState, makeForm({ config: "[1,2]" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.config?.[0]).toContain("objeto JSON")
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it("editar una regla guarda los parámetros nuevos y no toca el código", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "rule-1", code: "exceso_cargas_ventana", name: "Exceso", severity: "medium", isActive: true, config: '{"maxLoads":3}' })
    const res = await updateAnomalyRuleAction(prevState, makeForm({
      id: "rule-1", code: "exceso_cargas_ventana", name: "Exceso de cargas", config: '{"maxLoads":3}', "param:maxLoads": "5", "param:windowHours": "24",
    }))
    expect(res.ok).toBe(true)
    expect(savedConfig(mockUpdateSet.mock.calls as unknown as unknown[][])).toEqual({ maxLoads: 5, windowHours: 24 })
  })

  it("el código de una regla del catálogo no se puede cambiar: el motor la dejaría de reconocer", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "rule-1", code: "sello_repetido", name: "Sello repetido", severity: "high", isActive: true, config: "{}" })
    const res = await updateAnomalyRuleAction(prevState, makeForm({ id: "rule-1", code: "sello_repetido_2" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.code?.[0]).toContain("No se puede cambiar")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("el código de una regla propia (que el motor no conoce) sí se puede corregir", async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: "rule-1", code: "regla_mal_escrita", name: "Propia", severity: "low", isActive: true, config: "{}" })
      .mockResolvedValueOnce(undefined)
    const res = await updateAnomalyRuleAction(prevState, makeForm({ id: "rule-1", code: "sello_repetido" }))
    expect(res.ok).toBe(true)
  })
})
