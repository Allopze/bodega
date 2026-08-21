import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockIsGlobalRole = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  can: mockCan,
  isGlobalRole: mockIsGlobalRole,
}))
vi.mock("@/db", () => ({ db: { transaction: mockTransaction } }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { createMonthlyStatementAction, addPaymentAction } = await import("./actions-module/statements")

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
  mockCan.mockReturnValue(true)
  mockIsGlobalRole.mockReturnValue(true)
  mockTransaction.mockResolvedValue({ ok: true, message: "ok" })
})

describe("autorización de cuenta corriente", () => {
  it("creación y pago exigen el permiso explícito de gestión financiera", async () => {
    await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(mockRequirePermission).toHaveBeenNthCalledWith(1, "combustibles:manage_statements", "/combustibles")
    expect(mockRequirePermission).toHaveBeenNthCalledWith(2, "combustibles:manage_statements", "/combustibles")
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

    expect(create.message).toMatch(/sin permisos/i)
    expect(pay.message).toMatch(/sin permisos/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("bloquea ambas mutaciones si tiene costos pero no lectura operacional", async () => {
    mockCan.mockImplementation((_session, permission) => permission === "combustibles:view_costs")

    const create = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    const pay = await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(create.message).toMatch(/sin permisos/i)
    expect(pay.message).toMatch(/sin permisos/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("bloquea ambas mutaciones a un rol scoped aunque conozca los identificadores", async () => {
    mockIsGlobalRole.mockReturnValue(false)

    const create = await createMonthlyStatementAction({ ok: false, message: "" }, statementForm())
    const pay = await addPaymentAction({ ok: false, message: "" }, paymentForm())

    expect(create.message).toMatch(/sin permisos/i)
    expect(pay.message).toMatch(/sin permisos/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
