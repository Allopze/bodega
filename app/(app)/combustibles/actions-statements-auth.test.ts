import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockIsGlobalRole = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockPreview = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  guardPermission: mockGuardPermission,
  can: mockCan,
  isGlobalRole: mockIsGlobalRole,
}))
vi.mock("@/db", () => ({ db: { transaction: mockTransaction } }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/combustibles/statements-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/combustibles/statements-preview")>()),
  previewMonthlyStatement: mockPreview,
}))

const { createMonthlyStatementAction, addPaymentAction, previewMonthlyStatementAction } = await import("./actions-module/statements")

const globalSession = {
  user: {
    id: "finance-user",
    email: "finance@example.test",
    isGlobal: true,
    worksiteIds: [],
    roles: [],
    permissions: ["combustibles:manage_statements", "combustibles:view", "combustibles:view_costs"],
  },
}

function statementForm() {
  const form = new FormData()
  form.set("month", "2026-08")
  form.set("fuelSupplierId", "supplier-1")
  return form
}

function paymentForm() {
  const form = new FormData()
  form.set("statementId", "statement-1")
  form.set("paymentDate", "2026-08-20")
  form.set("amount", "1000")
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequirePermission.mockResolvedValue(globalSession)
  // Mismo contrato que `guardPermission` real: sesión o un `{ ok: false, message }` listo para devolver.
  mockGuardPermission.mockImplementation(async (permission: string, operationPathname?: string) => {
    try {
      return { session: await mockRequirePermission(permission, operationPathname), error: null }
    } catch {
      return { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
    }
  })
  mockCan.mockReturnValue(true)
  mockIsGlobalRole.mockReturnValue(true)
  mockTransaction.mockResolvedValue({ ok: true, message: "ok" })
})

describe("autorización de estados de cuenta", () => {
  it("creación y pago exigen el permiso explícito de gestión financiera", async () => {
    await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(mockRequirePermission).toHaveBeenNthCalledWith(1, "combustibles:manage_statements", "/combustibles/pagos")
    expect(mockRequirePermission).toHaveBeenNthCalledWith(2, "combustibles:manage_statements", "/combustibles/pagos")
    expect(mockCan).toHaveBeenNthCalledWith(1, globalSession, "combustibles:view")
    expect(mockCan).toHaveBeenNthCalledWith(2, globalSession, "combustibles:view_costs")
    expect(mockCan).toHaveBeenNthCalledWith(3, globalSession, "combustibles:view")
    expect(mockCan).toHaveBeenNthCalledWith(4, globalSession, "combustibles:view_costs")
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it("bloquea ambas mutaciones cuando el actor sólo puede leer costos", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))

    const create = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    const pay = await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(create).toMatchObject({ ok: false })
    expect(pay).toMatchObject({ ok: false })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("bloquea ambas mutaciones si puede gestionar pero no ver costos", async () => {
    mockCan.mockReturnValue(false)

    const create = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    const pay = await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(create.message).toMatch(/permisos/i)
    expect(pay.message).toMatch(/permisos/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("bloquea ambas mutaciones si tiene costos pero no lectura operacional", async () => {
    mockCan.mockImplementation((_session, permission) => permission === "combustibles:view_costs")

    const create = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    const pay = await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(create.message).toMatch(/permisos/i)
    expect(pay.message).toMatch(/permisos/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("bloquea ambas mutaciones a un rol scoped aunque conozca los identificadores", async () => {
    mockIsGlobalRole.mockReturnValue(false)

    const create = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    const pay = await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(create.message).toMatch(/permisos/i)
    expect(pay.message).toMatch(/permisos/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe("vista previa de un estado de cuenta", () => {
  it("exige el mismo permiso que la acción que confirma y delega en el servicio con la sesión", async () => {
    mockPreview.mockResolvedValue({ loads: 3 })

    const result = await previewMonthlyStatementAction({ month: "2026-08", fuelSupplierId: "supplier-1" })

    expect(mockRequirePermission).toHaveBeenCalledWith("combustibles:manage_statements", "/combustibles/pagos")
    expect(mockPreview).toHaveBeenCalledWith(globalSession, { month: "2026-08", fuelSupplierId: "supplier-1" })
    expect(result).toEqual({ ok: true, data: { preview: { loads: 3 } } })
  })

  it("no consulta nada si falta el permiso, si falta costos o si el rol es acotado", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("forbidden"))
    expect(await previewMonthlyStatementAction({ month: "2026-08", fuelSupplierId: "supplier-1" })).toMatchObject({ ok: false })

    mockCan.mockReturnValue(false)
    expect(await previewMonthlyStatementAction({ month: "2026-08", fuelSupplierId: "supplier-1" })).toMatchObject({ ok: false })

    mockCan.mockReturnValue(true)
    mockIsGlobalRole.mockReturnValue(false)
    expect(await previewMonthlyStatementAction({ month: "2026-08", fuelSupplierId: "supplier-1" })).toMatchObject({ ok: false })

    expect(mockPreview).not.toHaveBeenCalled()
  })

  it("rechaza un mes mal formado antes de tocar la base", async () => {
    const result = await previewMonthlyStatementAction({ month: "agosto", fuelSupplierId: "supplier-1" })

    expect(result).toMatchObject({ ok: false })
    expect(mockPreview).not.toHaveBeenCalled()
  })
})

describe("crear un estado de cuenta tras la vista previa", () => {
  const candidateLoads = [
    { id: "l-1", liters: 100, baseAmount: 1000, iecTotal: 100, ivaAmount: 190, totalAmount: 1290 },
  ]
  const insertValues = vi.fn(async () => undefined)

  function runTransactionWith(loads: typeof candidateLoads) {
    const tx = {
      query: { fuelMonthlyStatements: { findFirst: vi.fn(async () => undefined) } },
      select: () => ({ from: () => ({ where: () => ({ for: async () => loads }) }) }),
      insert: () => ({ values: insertValues }),
      update: () => ({ set: () => ({ where: vi.fn(async () => undefined) }) }),
    }
    mockTransaction.mockImplementation(async (callback: (t: typeof tx) => unknown) => callback(tx))
  }

  function confirmedForm(expected: { loads: string; total: string }) {
    const form = statementForm()
    form.set("expectedLoadCount", expected.loads)
    form.set("expectedTotalAmount", expected.total)
    return form
  }

  it("crea el estado de cuenta cuando lo confirmado coincide con lo que hay", async () => {
    runTransactionWith(candidateLoads)

    const result = await createMonthlyStatementAction({ ok: false, message: "" }, confirmedForm({ loads: "1", total: "1290" }))

    expect(result).toMatchObject({ ok: true, message: "Estado de cuenta creado con 1 carga" })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 1290, totalIec: 100, totalIva: 190 }))
  })

  it("no guarda si las cargas cambiaron desde la vista previa: pide revisarla de nuevo", async () => {
    runTransactionWith(candidateLoads)

    const byCount = await createMonthlyStatementAction({ ok: false, message: "" }, confirmedForm({ loads: "2", total: "1290" }))
    const byTotal = await createMonthlyStatementAction({ ok: false, message: "" }, confirmedForm({ loads: "1", total: "999" }))

    expect(byCount).toMatchObject({ ok: false, message: expect.stringMatching(/cambiaron/i) })
    expect(byTotal).toMatchObject({ ok: false, message: expect.stringMatching(/cambiaron/i) })
    expect(insertValues).not.toHaveBeenCalled()
  })

  it("sin vista previa (otro cliente) sigue creándose como siempre", async () => {
    runTransactionWith(candidateLoads)

    const result = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())

    expect(result).toMatchObject({ ok: true })
  })
})
