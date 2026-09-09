import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Las acciones del ledger de integridad son alcanzables directamente por su id
 * de Server Action: un caso ajeno o inexistente no puede distinguirse desde
 * fuera, y el permiso se reevalúa en cada llamada, no en el render de la página.
 */
const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockScan = vi.hoisted(() => vi.fn())
const mockAcknowledge = vi.hoisted(() => vi.fn())
const mockVerify = vi.hoisted(() => vi.fn())
const mockRevalidateOperationalViews = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/services/operational-integrity", () => ({
  scanOperationalIntegrity: mockScan,
  acknowledgeOperationalIntegrityCase: mockAcknowledge,
  verifyOperationalIntegrityCase: mockVerify,
}))
vi.mock("@/lib/services/operational-cache", () => ({
  revalidateOperationalViews: mockRevalidateOperationalViews,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/traceability-integrity-cases", () => ({
  scanTraceabilityIntegrity: vi.fn(),
  resolveTraceabilityIntegrityCase: vi.fn(),
}))

const {
  scanOperationalIntegrityAction,
  acknowledgeOperationalIntegrityCaseAction,
  verifyOperationalIntegrityCaseAction,
} = await import("./actions")

const INITIAL = { ok: false, message: "" }
const session = {
  user: {
    id: "u-1",
    email: "ops@example.test",
    isActive: true,
    permissions: ["warehouse:reconcile_integrity", "warehouse:view_traceability"],
  },
}

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequirePermission.mockResolvedValue(session)
  mockScan.mockResolvedValue({ found: 0, recorded: 0 })
  mockAcknowledge.mockResolvedValue(undefined)
  mockVerify.mockResolvedValue({ resolved: true })
})

describe("acciones del ledger de integridad operacional", () => {
  it("exige el permiso de reconciliación en cada acción", async () => {
    await scanOperationalIntegrityAction(INITIAL, form({ domains: "stock" }))
    await acknowledgeOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001", reason: "Revisado con bodega en terreno" }))
    await verifyOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001" }))

    expect(mockRequirePermission).toHaveBeenCalledTimes(3)
    for (const call of mockRequirePermission.mock.calls) expect(call[0]).toBe("warehouse:reconcile_integrity")
  })

  it("niega sin permiso y no toca el servicio", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))

    const state = await verifyOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001" }))

    expect(state.ok).toBe(false)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it("da la misma respuesta para un caso inexistente y uno fuera de alcance", async () => {
    mockVerify.mockRejectedValue(new Error("Caso no encontrado"))
    const absent = await verifyOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-absent-0001" }))

    mockVerify.mockRejectedValue(new Error("Caso no encontrado"))
    const foreign = await verifyOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-foreign-002" }))

    expect(absent).toEqual(foreign)
    expect(absent.ok).toBe(false)
  })

  it("no filtra el SQL de un error del driver", async () => {
    // Drizzle envuelve los errores del driver: `.message` trae la consulta y los
    // params completos. La forma (`query`/`cause`) es lo que los distingue de un
    // error de negocio, que sí es texto para el usuario.
    const driverError = Object.assign(
      new Error("Failed query: insert into \"operational_integrity_case_events\" ...\nparams: case-0001"),
      { query: "insert into \"operational_integrity_case_events\"", cause: { code: "23503" } },
    )
    mockAcknowledge.mockRejectedValue(driverError)

    const state = await acknowledgeOperationalIntegrityCaseAction(
      INITIAL,
      form({ caseId: "case-0001", reason: "Motivo suficientemente largo" }),
    )

    expect(state.ok).toBe(false)
    expect(state.message).not.toMatch(/operational_integrity_case_events|violates|insert into/i)
  })

  it("rechaza dominios fuera del enum sin llamar al servicio", async () => {
    const state = await scanOperationalIntegrityAction(INITIAL, form({ domains: "contabilidad" }))

    expect(state.ok).toBe(false)
    expect(mockScan).not.toHaveBeenCalled()
  })

  it("escanea los tres dominios cuando no se acota ninguno", async () => {
    await scanOperationalIntegrityAction(INITIAL, form({}))

    expect(mockScan).toHaveBeenCalledWith(session, ["stock", "receiving", "purchasing"])
  })

  it("valida el motivo del acuse entre 10 y 2000 caracteres", async () => {
    const short = await acknowledgeOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001", reason: "corto" }))
    const long = await acknowledgeOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001", reason: "x".repeat(2001) }))

    expect(short.ok).toBe(false)
    expect(long.ok).toBe(false)
    expect(mockAcknowledge).not.toHaveBeenCalled()
  })

  it("distingue el caso que sigue abierto del que quedó resuelto", async () => {
    mockVerify.mockResolvedValue({ resolved: false })
    const stillOpen = await verifyOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001" }))

    mockVerify.mockResolvedValue({ resolved: true })
    const closed = await verifyOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001" }))

    expect(stillOpen.ok).toBe(true)
    expect(closed.ok).toBe(true)
    expect(stillOpen.message).not.toBe(closed.message)
  })

  it("revalida las vistas operacionales tras una mutación exitosa", async () => {
    await acknowledgeOperationalIntegrityCaseAction(INITIAL, form({ caseId: "case-0001", reason: "Revisado con bodega en terreno" }))

    expect(mockRevalidateOperationalViews).toHaveBeenCalledWith(["/bodega/trazabilidad"])
  })
})
